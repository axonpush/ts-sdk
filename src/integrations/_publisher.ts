import { AsyncLocalStorage } from "node:async_hooks";
import type { AxonPush } from "../client.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";

const publisherScope = new AsyncLocalStorage<true>();

/**
 * Run `fn` inside a marker scope identifying that the current async
 * flow is traversing the publisher's emit path. Logging integrations
 * check this flag (via {@link inPublisherScope}) and skip their own
 * emission so internal SDK warnings can never loop back through a
 * patched logger.
 */
export function runInPublisherScope<T>(fn: () => T): T {
  return publisherScope.run(true, fn);
}

/** True when the current async flow is inside a publisher emit path. */
export function inPublisherScope(): boolean {
  return publisherScope.getStore() === true;
}

/**
 * Shared non-blocking publisher used by the logging integrations
 * (pino, winston, console capture, OpenTelemetry span exporter).
 *
 * `submit()` never touches the network on the caller's path — it pushes
 * the publish args onto a bounded in-memory queue and returns immediately.
 * A single async drain loop dequeues entries and awaits
 * `client.events.publish(...)` in the background, so logging from an
 * async request handler stays O(microseconds) on the event loop.
 *
 * The drain path is wrapped with `runInPublisherScope` so that any
 * downstream `console.warn` / `logger.warn` produced while publishing
 * cannot loop back into a logging integration that has patched the
 * caller's logger.
 *
 * Call `flush(timeoutMs?)` at known checkpoints (end of a Lambda
 * invocation, end of a test) to guarantee delivery. `close()` drains
 * pending records and stops the drain loop; an atexit-style
 * `beforeExit` / `SIGTERM` / `SIGINT` hook closes all live publishers
 * automatically on normal process shutdown.
 */

export const DEFAULT_QUEUE_SIZE = 1000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;
export const DEFAULT_DROP_WARNING_INTERVAL_MS = 10_000;
export const DEFAULT_CONCURRENCY = 1;

const IDLE_POLL_INTERVAL_MS = 5;
const BLOCK_POLL_INTERVAL_MS = 1;

export type PublisherMode = "background" | "sync" | "bullmq";

/**
 * What the publisher does when its bounded queue is full.
 *
 * - `drop-oldest` (default): evict the head entry to make room — newest
 *   submissions always make it in.
 * - `drop-newest`: silently drop the incoming submission — oldest
 *   entries are preserved.
 * - `block`: best-effort spin until a slot frees up. Submissions become
 *   asynchronous; suitable only when the caller can tolerate latency.
 */
export type OverflowPolicy = "drop-oldest" | "drop-newest" | "block";

export interface BackgroundPublisherOptions {
  queueSize?: number;
  /** Default: `'drop-oldest'`. */
  overflowPolicy?: OverflowPolicy;
  shutdownTimeoutMs?: number;
  dropWarningIntervalMs?: number;
  concurrency?: number;
}

export class BackgroundPublisher {
  private readonly client: AxonPush;
  private readonly queueSize: number;
  private readonly overflowPolicy: OverflowPolicy;
  private readonly shutdownTimeoutMs: number;
  private readonly dropWarningIntervalMs: number;
  private readonly concurrency: number;
  private readonly queue: PublishParams[] = [];
  private draining = 0;
  private drops = 0;
  private lastDropWarn = 0;
  private closed = false;

  constructor(client: AxonPush, opts: BackgroundPublisherOptions = {}) {
    this.client = client;
    this.queueSize = opts.queueSize ?? DEFAULT_QUEUE_SIZE;
    this.overflowPolicy = opts.overflowPolicy ?? "drop-oldest";
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.dropWarningIntervalMs = opts.dropWarningIntervalMs ?? DEFAULT_DROP_WARNING_INTERVAL_MS;
    this.concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    registerPublisher(this);
  }

  /** Total records dropped since construction (any overflow policy). */
  get droppedCount(): number {
    return this.drops;
  }

  submit(params: PublishParams): void {
    if (this.closed) return;
    if (this.queue.length >= this.queueSize) {
      this.handleOverflow(params);
      return;
    }
    this.queue.push(params);
    this.ensureDraining();
  }

  async flush(timeoutMs?: number): Promise<void> {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    while (this.queue.length > 0 || this.draining > 0) {
      if (Date.now() >= deadline) return;
      await sleep(IDLE_POLL_INTERVAL_MS);
    }
  }

  async close(timeoutMs?: number): Promise<void> {
    if (this.closed) {
      unregisterPublisher(this);
      return;
    }
    this.closed = true;
    await this.flush(timeoutMs ?? this.shutdownTimeoutMs);
    if (this.drops > 0) {
      sdkLogger.warn(
        `axonpush publisher closed with ${this.drops} dropped records ` +
          `(queueSize=${this.queueSize}, policy=${this.overflowPolicy})`,
      );
    }
    unregisterPublisher(this);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private handleOverflow(params: PublishParams): void {
    switch (this.overflowPolicy) {
      case "drop-newest":
        this.recordDrop();
        return;
      case "drop-oldest":
        this.queue.shift();
        this.recordDrop();
        this.queue.push(params);
        this.ensureDraining();
        return;
      case "block":
        void this.blockUntilSpace(params);
        return;
    }
  }

  private async blockUntilSpace(params: PublishParams): Promise<void> {
    while (!this.closed && this.queue.length >= this.queueSize) {
      await sleep(BLOCK_POLL_INTERVAL_MS);
    }
    if (this.closed) return;
    this.queue.push(params);
    this.ensureDraining();
  }

  private ensureDraining(): void {
    while (this.draining < this.concurrency && this.queue.length > 0) {
      this.draining++;
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    try {
      while (!this.closed || this.queue.length > 0) {
        const params = this.queue.shift();
        if (params === undefined) return;
        try {
          await runInPublisherScope(() =>
            (
              this.client as unknown as {
                events: { publish(p: PublishParams): Promise<unknown> };
              }
            ).events.publish(params),
          );
        } catch (err) {
          runInPublisherScope(() => {
            sdkLogger.warn(`axonpush publish failed: ${(err as Error).message ?? err}`);
          });
        }
      }
    } finally {
      this.draining--;
    }
  }

  private recordDrop(): void {
    this.drops++;
    const now = Date.now();
    if (now - this.lastDropWarn < this.dropWarningIntervalMs) return;
    this.lastDropWarn = now;
    runInPublisherScope(() => {
      sdkLogger.warn(
        `axonpush publisher queue full; ${this.drops} records dropped so far ` +
          `(queueSize=${this.queueSize}, policy=${this.overflowPolicy}) — consider ` +
          "increasing queueSize or switching overflowPolicy",
      );
    });
  }
}

const SERVERLESS_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["AWS_LAMBDA_FUNCTION_NAME", "AWS Lambda"],
  ["FUNCTION_TARGET", "Google Cloud Functions"],
  ["AZURE_FUNCTIONS_ENVIRONMENT", "Azure Functions"],
] as const;

export function detectServerless(): string | null {
  for (const [envVar, name] of SERVERLESS_MARKERS) {
    if (process.env[envVar]) return name;
  }
  return null;
}

export interface Flushable {
  flush(timeoutMs?: number): Promise<void>;
}

export function flushAfterInvocation<TArgs extends unknown[], TReturn>(
  handlers: Flushable | readonly Flushable[],
  fn: (...args: TArgs) => Promise<TReturn> | TReturn,
  opts: { timeoutMs?: number } = {},
): (...args: TArgs) => Promise<TReturn> {
  const list = Array.isArray(handlers) ? handlers : [handlers as Flushable];
  const timeoutMs = opts.timeoutMs ?? 5000;
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } finally {
      for (const h of list) {
        try {
          await h.flush(timeoutMs);
        } catch (err) {
          sdkLogger.warn(`flushAfterInvocation: ${(err as Error).message ?? err}`);
        }
      }
    }
  };
}

const LIVE_PUBLISHERS = new Set<BackgroundPublisher>();
let lifecycleInstalled = false;

function registerPublisher(p: BackgroundPublisher): void {
  LIVE_PUBLISHERS.add(p);
  installLifecycleHooks();
}

function unregisterPublisher(p: BackgroundPublisher): void {
  LIVE_PUBLISHERS.delete(p);
}

function installLifecycleHooks(): void {
  if (lifecycleInstalled) return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  lifecycleInstalled = true;

  const drainAll = async (): Promise<void> => {
    const all = Array.from(LIVE_PUBLISHERS);
    await Promise.all(
      all.map((p) =>
        p.close().catch((err) => {
          sdkLogger.warn(`axonpush publisher close failed: ${(err as Error).message ?? err}`);
        }),
      ),
    );
  };

  process.on("beforeExit", () => {
    void drainAll();
  });

  const signalHandler = (signal: NodeJS.Signals) => {
    void drainAll().finally(() => {
      process.kill(process.pid, signal);
    });
    process.removeListener(signal, signalHandler);
  };

  process.once("SIGTERM", signalHandler);
  process.once("SIGINT", signalHandler);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
