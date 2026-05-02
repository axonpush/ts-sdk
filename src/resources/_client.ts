/**
 * Minimal client surface that {@link EventsResource} & friends rely on.
 *
 * Stream A's `AxonPush` class implements this. We import only the type so
 * resources stay free of runtime coupling to `client.ts`.
 *
 * @internal
 */

/** A trace context as returned by `client.getOrCreateTrace()`. */
export interface TraceContextLike {
  readonly traceId: string;
  nextSpanId(): string;
}

/** Shape of a generated `@hey-api` operation function. */
export type GeneratedOp<TArgs, TResult> = (args: TArgs) => Promise<{ data?: TResult }>;

/**
 * Subset of the `AxonPush` class consumed by resources.
 *
 * Resources never construct or import the concrete class — they receive
 * an instance via DI from {@link AxonPush}'s constructor.
 */
export interface ResourceClient {
  readonly environment: string | undefined;
  getOrCreateTrace(seedTraceId?: string): TraceContextLike;
  invoke<TArgs, TResult>(op: GeneratedOp<TArgs, TResult>, args: TArgs): Promise<TResult | null>;
}
