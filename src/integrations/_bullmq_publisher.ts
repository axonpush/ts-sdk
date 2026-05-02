import type { AxonPush } from "../client.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";

/**
 * Durable Redis-backed publisher using BullMQ.
 *
 * Each `submit()` enqueues a job to a BullMQ queue (a fast Redis LPUSH) —
 * jobs are executed by a separate worker process, so event publishing
 * survives app restarts and is retried on transient failures. Equivalent
 * of python-axonpush's `RqPublisher`.
 *
 * Tested against `bullmq@^5`. See https://docs.bullmq.io for connection
 * options. Requires `bun add bullmq` (optional peer dependency).
 */

type ConnectionLike = unknown;

export interface BullMQPublisherOptions {
  connection: ConnectionLike;
  queueName?: string;
  /** BullMQ job options — merged with the publisher defaults
   * (`attempts=3`, `removeOnComplete=true`, `removeOnFail` keeps 24h). */
  jobOptions?: Record<string, unknown>;
}

interface BullMQQueue {
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

interface BullMQModule {
  Queue: new (name: string, opts: { connection: ConnectionLike }) => BullMQQueue;
  Worker: new (
    name: string,
    processor: (job: { data: unknown }) => Promise<void>,
    opts: { connection: ConnectionLike },
  ) => { close(): Promise<void> };
}

async function loadBullMQ(): Promise<BullMQModule> {
  try {
    const moduleName: string = "bullmq";
    return (await import(moduleName)) as unknown as BullMQModule;
  } catch {
    throw new Error(
      "BullMQPublisher requires the 'bullmq' optional peer dependency. " +
        "Install it with: bun add bullmq",
    );
  }
}

const DEFAULT_QUEUE_NAME = "axonpush";
const DEFAULT_JOB_OPTIONS: Record<string, unknown> = {
  attempts: 3,
  removeOnComplete: true,
  removeOnFail: { age: 86400 },
};

/**
 * Durable submit-ahead publisher. Mirrors {@link BackgroundPublisher}'s
 * surface (`submit`, `flush`, `close`, `Symbol.asyncDispose`) so callers
 * can swap implementations behind {@link PublisherHolder}.
 */
export class BullMQPublisher {
  private readonly queueName: string;
  private readonly jobOptions: Record<string, unknown>;
  private readonly connection: ConnectionLike;
  private queue: BullMQQueue | null = null;
  private initPromise: Promise<void> | null = null;
  private inFlight = 0;
  private dropped = 0;
  private closed = false;

  constructor(_client: AxonPush, opts: BullMQPublisherOptions) {
    if (!opts.connection) {
      throw new Error("BullMQPublisher requires { connection } (IORedis instance or options).");
    }
    this.connection = opts.connection;
    this.queueName = opts.queueName ?? DEFAULT_QUEUE_NAME;
    this.jobOptions = { ...DEFAULT_JOB_OPTIONS, ...(opts.jobOptions ?? {}) };
  }

  get droppedCount(): number {
    return this.dropped;
  }

  submit(params: PublishParams): void {
    if (this.closed) {
      this.dropped++;
      return;
    }
    this.inFlight++;
    void this.enqueue(params)
      .catch((err) => {
        sdkLogger.warn(`axonpush bullmq enqueue failed: ${(err as Error).message ?? err}`);
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  private async enqueue(params: PublishParams): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add("publish", params, this.jobOptions);
  }

  private async ensureQueue(): Promise<BullMQQueue> {
    if (this.queue) return this.queue;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const mod = await loadBullMQ();
        this.queue = new mod.Queue(this.queueName, { connection: this.connection });
      })();
    }
    await this.initPromise;
    if (!this.queue) throw new Error("BullMQPublisher queue failed to initialize");
    return this.queue;
  }

  /**
   * Wait for in-flight enqueues to resolve. The Redis queue itself is
   * durable, so this only drains the local microtask backlog.
   */
  async flush(timeoutMs?: number): Promise<void> {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    while (this.inFlight > 0) {
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  async close(timeoutMs?: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush(timeoutMs);
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        sdkLogger.warn(`axonpush bullmq queue close failed: ${(err as Error).message ?? err}`);
      }
      this.queue = null;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export interface BullMQWorkerOptions {
  client: AxonPush;
  connection: ConnectionLike;
  queueName?: string;
}

/**
 * Spin up a BullMQ worker that drains axonpush jobs and publishes them
 * via the provided client. Returns the worker instance — call
 * `.close()` on graceful shutdown.
 */
export async function createBullMQWorker(
  opts: BullMQWorkerOptions,
): Promise<{ close(): Promise<void> }> {
  const mod = await loadBullMQ();
  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME;
  const worker = new mod.Worker(
    queueName,
    async (job) => {
      const params = job.data as PublishParams;
      await (
        opts.client as unknown as {
          events: { publish(p: PublishParams): Promise<unknown> };
        }
      ).events.publish(params);
    },
    { connection: opts.connection },
  );
  return worker;
}
