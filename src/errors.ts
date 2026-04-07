export class AxonPushError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "AxonPushError";
  }
}

export class AuthenticationError extends AxonPushError {
  constructor(message: string) {
    super(message, 401);
    this.name = "AuthenticationError";
  }
}

export class ForbiddenError extends AxonPushError {
  constructor(message: string) {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AxonPushError {
  constructor(message: string) {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AxonPushError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AxonPushError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, 429);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends AxonPushError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode);
    this.name = "ServerError";
  }
}

export class ConnectionError extends AxonPushError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

const ERROR_MAP: Record<number, new (message: string) => AxonPushError> = {
  400: ValidationError,
  401: AuthenticationError,
  403: ForbiddenError,
  404: NotFoundError,
};

export function mapError(
  status: number,
  body?: { message?: string; error?: string },
): AxonPushError {
  const message = body?.message ?? body?.error ?? `Request failed with status ${status}`;

  if (status === 429) {
    return new RateLimitError(message);
  }

  const ErrorClass = ERROR_MAP[status];
  if (ErrorClass) return new ErrorClass(message);

  if (status >= 500) return new ServerError(message, status);

  return new AxonPushError(message, status);
}
