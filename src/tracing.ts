import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";

/**
 * Per-async-flow trace context using W3C-compatible trace and span ids.
 */
export class TraceContext {
  /** Stable trace identifier propagated as `X-Axonpush-Trace-Id`. */
  readonly traceId: string;

  /**
   * @param traceId Optional seed trace id; when omitted a fresh UUID is
   *   generated. Useful for stitching together upstream and downstream traces.
   */
  constructor(traceId?: string) {
    this.traceId = traceId ?? randomBytes(16).toString("hex");
  }

  /**
   * Mint a fresh span id within this trace.
   *
   * @returns A UUID identifying a single logical operation under {@link traceId}.
   */
  nextSpanId(): string {
    return randomBytes(8).toString("hex");
  }

  /** Return a W3C-compatible 32-hex trace id for HTTP propagation. */
  w3cTraceId(): string {
    const compact = this.traceId.replaceAll("-", "").toLowerCase();
    if (/^[0-9a-f]{32}$/.test(compact) && !/^0+$/.test(compact)) return compact;
    return createHash("sha256").update(this.traceId).digest("hex").slice(0, 32);
  }

  /** Create a W3C `traceparent` header with a fresh child span id. */
  traceparent(spanId = this.nextSpanId()): string {
    return `00-${this.w3cTraceId()}-${spanId}-01`;
  }
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Read the trace context attached to the current async flow.
 *
 * @returns The active {@link TraceContext}, or `undefined` if none is bound.
 */
export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Return the active trace context if one exists, otherwise create a new one
 * (without binding it). Callers that want the new context propagated should
 * pass it to {@link setCurrentTrace} explicitly or wrap their work in
 * {@link withTrace}.
 *
 * @param seedTraceId Optional pre-existing trace id to adopt.
 * @returns The active trace, or a new one constructed with `seedTraceId`.
 */
export function getOrCreateTrace(seedTraceId?: string): TraceContext {
  const existing = storage.getStore();
  if (existing) return existing;
  return new TraceContext(seedTraceId);
}

/**
 * Bind a trace context to the current async flow. The binding lasts for the
 * lifetime of the enclosing async scope.
 *
 * @param ctx The {@link TraceContext} to install.
 */
export function setCurrentTrace(ctx: TraceContext): void {
  storage.enterWith(ctx);
}

/**
 * Detach any trace context from the current async flow.
 */
export function clearCurrentTrace(): void {
  storage.enterWith(undefined as unknown as TraceContext);
}

/**
 * Run `fn` inside a freshly-bound {@link TraceContext}. The new context is
 * scoped to the invocation and does not leak to the caller.
 *
 * @param seedTraceId Optional trace id to adopt for this scope.
 * @param fn Function executed with the new context bound.
 * @returns The return value of `fn`.
 */
export function withTrace<T>(seedTraceId: string | undefined, fn: () => T): T {
  const ctx = new TraceContext(seedTraceId);
  return storage.run(ctx, fn);
}
