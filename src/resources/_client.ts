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

/**
 * Shape of a generated `@hey-api` operation function. `args` is the
 * options bag accepted by the generated function; the chokepoint
 * (`AxonPush.invoke`) extracts `{ data }` from the resolved promise and
 * returns it.
 */
// biome-ignore lint/suspicious/noExplicitAny: the generated ops have per-op argument types we cannot polymorph here without parameterising every consumer.
export type GeneratedOp<T = unknown> = (args: any) => Promise<{ data?: T; [k: string]: unknown }>;

/**
 * Subset of the `AxonPush` class consumed by resources.
 *
 * Resources never construct or import the concrete class — they receive
 * an instance via DI from {@link AxonPush}'s constructor.
 */
export interface ResourceClient {
  readonly environment: string | undefined;
  getOrCreateTrace(seedTraceId?: string): TraceContextLike;
  invoke<T>(op: GeneratedOp<T>, args?: unknown): Promise<T | null>;
}
