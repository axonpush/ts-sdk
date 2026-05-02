import type { ResolvedSettings } from "../config";
import {
  APIConnectionError,
  AxonPushError,
  fromResponse,
  isRetryable,
  RateLimitError,
} from "../errors";
import { currentTrace } from "../tracing";
import type { Config } from "./api/client";
import type { CreateClientConfig } from "./api/client.gen";

const DEFAULT_BASE_URL = "http://localhost:3000";

let currentSettings: ResolvedSettings = {
  apiKey: undefined,
  tenantId: undefined,
  orgId: undefined,
  appId: undefined,
  baseUrl: DEFAULT_BASE_URL,
  environment: undefined,
  iotEndpoint: undefined,
  wsUrl: undefined,
  timeout: 30_000,
  maxRetries: 3,
  failOpen: false,
};

/**
 * `createClientConfig` is invoked by the generated `client.gen.ts` exactly
 * once at module load. We supply the default base URL up-front; per-request
 * behaviour (auth headers, tracing headers, error mapping) is wired via
 * {@link ensureInterceptors}, which runs lazily on the first call to the
 * client to avoid the circular import that would otherwise block top-level
 * `import { client }` from this module.
 *
 * @param override Optional overrides supplied by the generated layer.
 * @returns A client config with our base URL merged into `override`.
 */
export const createClientConfig: CreateClientConfig = (override) => {
  const merged = {
    baseUrl: currentSettings.baseUrl,
    ...override,
  } as Config;
  return merged as ReturnType<CreateClientConfig>;
};

let interceptorsAttached = false;
let lastAppliedBaseUrl: string | undefined;

async function ensureInterceptors(): Promise<void> {
  if (interceptorsAttached) return;
  interceptorsAttached = true;
  const { client } = await import("./api/client.gen");
  if (!client) {
    interceptorsAttached = false;
    return;
  }

  client.interceptors.request.use((request) => {
    const s = currentSettings;
    if (s.apiKey) request.headers.set("X-API-Key", s.apiKey);
    if (s.tenantId) request.headers.set("x-tenant-id", s.tenantId);
    if (s.environment) request.headers.set("X-Axonpush-Environment", s.environment);
    const trace = currentTrace();
    if (trace) {
      request.headers.set("X-Axonpush-Trace-Id", trace.traceId);
      request.headers.set("X-Axonpush-Span-Id", trace.nextSpanId());
    }
    return request;
  });

  client.interceptors.error.use((error, response, _request, _options) => {
    if (error instanceof AxonPushError) return error;
    if (response) {
      let body: unknown;
      if (error && typeof error === "object") {
        body = error;
      } else if (typeof error === "string") {
        try {
          body = JSON.parse(error);
        } catch {
          body = { message: error };
        }
      }
      return fromResponse(response, body);
    }
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Network error";
    return new APIConnectionError(message);
  });
}

/**
 * Update the module-scoped settings used by the request interceptors.
 *
 * The generated `client.gen.ts` constructs a single global client at import
 * time; rather than rebuild that client on every {@link AxonPush} ctor call,
 * the interceptors read live from this slot so the most recently constructed
 * facade wins.
 *
 * Synchronous on purpose: callers (notably the {@link AxonPush} constructor)
 * must be able to install settings without awaiting. The base URL is reapplied
 * to the generated client lazily inside {@link invokeSync}.
 *
 * @param s Resolved settings produced by `resolveSettings`.
 */
export function setSettings(s: ResolvedSettings): void {
  currentSettings = s;
}

async function applyBaseUrlIfChanged(): Promise<void> {
  if (lastAppliedBaseUrl === currentSettings.baseUrl) return;
  const { client } = await import("./api/client.gen");
  if (!client) return;
  client.setConfig({ baseUrl: currentSettings.baseUrl });
  lastAppliedBaseUrl = currentSettings.baseUrl;
}

/**
 * Read the currently-active settings. Exposed for diagnostics and tests.
 *
 * @returns The {@link ResolvedSettings} backing the global client.
 */
export function getSettings(): ResolvedSettings {
  return currentSettings;
}

/**
 * Generated operation function signature. `args` is the typed options bag
 * accepted by `sdk.gen.ts` functions; `T` is the success-response type
 * returned in the `data` field when `throwOnError: true`.
 */
export type GeneratedOp<T> = (args: {
  throwOnError: true;
  [k: string]: unknown;
}) => Promise<{ data: T; request: Request; response: Response }>;

const RETRY_BACKOFF_MS = [250, 500, 1000, 2000, 4000] as const;

function delayFor(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return Math.max(0, retryAfter * 1000);
  const idx = Math.min(attempt, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[idx] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 0;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Single chokepoint that resources call through. Adds:
 *
 * - Retries on retryable errors with backoff `[250, 500, 1000, 2000, 4000]ms`,
 *   honouring {@link RateLimitError.retryAfter} when present.
 * - Fail-open semantics: when `opts.failOpen` is true and the final attempt
 *   ends in {@link APIConnectionError}, return `null` instead of throwing.
 * - Exception passthrough for all other errors.
 *
 * @typeParam T Success-response type returned by the generated op.
 * @param op A function from `src/_internal/api/sdk.gen.ts`.
 * @param args Options bag forwarded to `op` after `throwOnError: true` is set.
 * @param opts Per-call retry / fail-open overrides.
 * @returns The unwrapped `data` field of the response, or `null` when
 *   `failOpen` swallowed an {@link APIConnectionError}.
 * @throws {AxonPushError} On non-retryable failures or when retries are
 *   exhausted and `failOpen` is false.
 */
export async function invokeSync<T>(
  op: GeneratedOp<T>,
  args: unknown,
  opts: { failOpen?: boolean; maxRetries?: number } = {},
): Promise<T | null> {
  await ensureInterceptors();
  await applyBaseUrlIfChanged();
  const failOpen = opts.failOpen ?? currentSettings.failOpen;
  const maxRetries = opts.maxRetries ?? currentSettings.maxRetries;
  const baseArgs = (args ?? {}) as Record<string, unknown>;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await op({ ...baseArgs, throwOnError: true });
      return result.data;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) break;
      const retryAfter = err instanceof RateLimitError ? err.retryAfter : undefined;
      await sleep(delayFor(attempt, retryAfter));
    }
  }

  if (failOpen && lastErr instanceof APIConnectionError) return null;
  throw lastErr;
}
