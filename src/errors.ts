/**
 * AxonPush error hierarchy. The shape mirrors the backend's standard error
 * envelope `{ code, message, hint, requestId }`. All thrown errors from the
 * SDK extend {@link AxonPushError} so callers can catch the base class.
 */

/**
 * Backend error envelope decoded from a non-2xx JSON response body.
 *
 * Fields follow Nest's `ProblemDetailsDto` shape; all are optional because
 * upstreams (gateways, edge proxies) sometimes return non-conforming bodies.
 */
export interface ErrorEnvelope {
  code?: string;
  message?: string;
  hint?: string;
  requestId?: string;
}

/**
 * Base class for every error thrown by the SDK. Carries the HTTP status code,
 * the backend's machine-readable `code`, an optional human-readable `hint`,
 * and the per-request `requestId` from the error envelope.
 */
export class AxonPushError extends Error {
  /** Machine-readable error code from the backend envelope. */
  readonly code?: string;
  /** Optional remediation hint surfaced from the backend. */
  readonly hint?: string;
  /** Server-issued request id, useful for support tickets. */
  readonly requestId?: string;
  /** HTTP status code that produced the error, when known. */
  readonly statusCode?: number;

  /**
   * @param message Human-readable message.
   * @param info Optional metadata sourced from the response envelope.
   */
  constructor(
    message: string,
    info?: { code?: string; hint?: string; requestId?: string; statusCode?: number },
  ) {
    super(message);
    this.name = "AxonPushError";
    if (info?.code !== undefined) this.code = info.code;
    if (info?.hint !== undefined) this.hint = info.hint;
    if (info?.requestId !== undefined) this.requestId = info.requestId;
    if (info?.statusCode !== undefined) this.statusCode = info.statusCode;
  }
}

/**
 * Network-level failure: DNS resolution failed, connection refused, TLS
 * handshake aborted, or the request never reached the server. Considered
 * retryable; honours `failOpen` so callers may opt to swallow it.
 */
export class APIConnectionError extends AxonPushError {
  constructor(
    message: string = "Connection to AxonPush failed",
    info?: { code?: string; hint?: string; requestId?: string },
  ) {
    super(message, info);
    this.name = "APIConnectionError";
  }
}

/** 401 — the API key is missing, malformed, or revoked. */
export class AuthenticationError extends AxonPushError {
  constructor(
    message: string = "Authentication failed",
    info?: { code?: string; hint?: string; requestId?: string },
  ) {
    super(message, { ...info, statusCode: 401 });
    this.name = "AuthenticationError";
  }
}

/** 403 — the API key is valid but lacks the required scope. */
export class ForbiddenError extends AxonPushError {
  constructor(
    message: string = "Forbidden",
    info?: { code?: string; hint?: string; requestId?: string },
  ) {
    super(message, { ...info, statusCode: 403 });
    this.name = "ForbiddenError";
  }
}

/** 404 — the requested resource does not exist or is not visible to this tenant. */
export class NotFoundError extends AxonPushError {
  constructor(
    message: string = "Not found",
    info?: { code?: string; hint?: string; requestId?: string },
  ) {
    super(message, { ...info, statusCode: 404 });
    this.name = "NotFoundError";
  }
}

/** 400 / 422 — request payload failed validation. */
export class ValidationError extends AxonPushError {
  constructor(
    message: string = "Validation failed",
    info?: { code?: string; hint?: string; requestId?: string; statusCode?: number },
  ) {
    super(message, { ...info, statusCode: info?.statusCode ?? 400 });
    this.name = "ValidationError";
  }
}

/**
 * 429 — rate limit exceeded. `retryAfter` (seconds) is parsed from the
 * `Retry-After` header when present; the transport's retry loop honours it.
 */
export class RateLimitError extends AxonPushError {
  /** Seconds the caller should wait before retrying. */
  readonly retryAfter?: number;

  constructor(
    message: string = "Rate limit exceeded",
    info?: { code?: string; hint?: string; requestId?: string; retryAfter?: number },
  ) {
    super(message, { ...info, statusCode: 429 });
    this.name = "RateLimitError";
    if (info?.retryAfter !== undefined) this.retryAfter = info.retryAfter;
  }
}

/** 5xx — the server failed to fulfil an apparently valid request. Retryable. */
export class ServerError extends AxonPushError {
  constructor(
    message: string = "Server error",
    info?: { code?: string; hint?: string; requestId?: string; statusCode?: number },
  ) {
    super(message, { ...info, statusCode: info?.statusCode ?? 500 });
    this.name = "ServerError";
  }
}

/**
 * Marker class used purely as a TypeScript discriminator. Existing retryable
 * errors ({@link APIConnectionError}, {@link RateLimitError},
 * {@link ServerError}) are retryable by virtue of being recognised by
 * {@link isRetryable}; the public symbol is exposed so callers may extend the
 * set in subclasses if needed.
 */
export class RetryableError extends AxonPushError {}

/**
 * Returns true if the SDK should retry the operation that produced `err`.
 *
 * @param err Any value caught from a transport call.
 * @returns True for {@link APIConnectionError}, {@link RateLimitError},
 *   {@link ServerError}, or any subclass of {@link RetryableError}.
 */
export function isRetryable(err: unknown): boolean {
  return (
    err instanceof APIConnectionError ||
    err instanceof RateLimitError ||
    err instanceof ServerError ||
    err instanceof RetryableError
  );
}

function toEnvelope(body: unknown): ErrorEnvelope {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const env: ErrorEnvelope = {};
  if (typeof b.code === "string") env.code = b.code;
  if (typeof b.message === "string") env.message = b.message;
  else if (Array.isArray(b.message)) env.message = (b.message as unknown[]).join(", ");
  else if (typeof b.error === "string") env.message = b.error as string;
  if (typeof b.hint === "string") env.hint = b.hint;
  if (typeof b.requestId === "string") env.requestId = b.requestId;
  else if (typeof b.request_id === "string") env.requestId = b.request_id;
  return env;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const ts = Date.parse(header);
  if (Number.isNaN(ts)) return undefined;
  const deltaMs = ts - Date.now();
  return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
}

/**
 * Map a fetch {@link Response} (and optional decoded JSON body) to the most
 * specific {@link AxonPushError} subclass.
 *
 * @param response The non-2xx response that triggered the error.
 * @param body Optional decoded JSON body; when present the standard envelope
 *   fields (`code`, `message`, `hint`, `requestId`) are extracted.
 * @returns A typed `AxonPushError` subclass suitable for throwing.
 */
export function fromResponse(response: Response, body?: unknown): AxonPushError {
  const env = toEnvelope(body);
  const status = response.status;
  const message = env.message ?? response.statusText ?? `HTTP ${status}`;
  const info = {
    ...(env.code !== undefined ? { code: env.code } : {}),
    ...(env.hint !== undefined ? { hint: env.hint } : {}),
    ...(env.requestId !== undefined ? { requestId: env.requestId } : {}),
  };

  if (status === 401) return new AuthenticationError(message, info);
  if (status === 403) return new ForbiddenError(message, info);
  if (status === 404) return new NotFoundError(message, info);
  if (status === 400 || status === 422) {
    return new ValidationError(message, { ...info, statusCode: status });
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    return new RateLimitError(message, {
      ...info,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }
  if (status >= 500) {
    return new ServerError(message, { ...info, statusCode: status });
  }
  return new AxonPushError(message, { ...info, statusCode: status });
}
