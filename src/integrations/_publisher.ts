import type { AxonPush } from "../client.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";

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

export type PublisherMode = "background" | "sync";

export interface BackgroundPublisherOptions {
  queueSize?: number;
  shutdownTimeoutMs?: number;
  dropWarningIntervalMs?: number;
  concurrency?: number;
}

export class BackgroundPublisher {
  private readonly client: AxonPush;
  private readonly queueSize: number;
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
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.dropWarningIntervalMs = opts.dropWarningIntervalMs ?? DEFAULT_DROP_WARNING_INTERVAL_MS;
    this.concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    registerPublisher(this);
  }

  submit(params: PublishParams): void {
    if (this.closed) return;
    if (this.queue.length >= this.queueSize) {
      this.recordDrop();
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

  async close(): Promise<void> {
    if (this.closed) {
      unregisterPublisher(this);
      return;
    }
    this.closed = true;
    await this.flush(this.shutdownTimeoutMs);
    unregisterPublisher(this);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
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
          await this.client.events.publish(params);
        } catch (err) {
          sdkLogger.warn(`axonpush publish failed: ${(err as Error).message ?? err}`);
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
    sdkLogger.warn(
      `axonpush publisher queue full; ${this.drops} records dropped so far ` +
        `(queueSize=${this.queueSize}) — consider increasing queueSize`,
    );
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
