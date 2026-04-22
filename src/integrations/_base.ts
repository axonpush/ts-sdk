import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import { logger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";
import { getOrCreateTrace, type TraceContext } from "../tracing.js";
import { BullMQPublisher, type BullMQPublisherOptions } from "./_bullmq_publisher.js";
import {
  type BackgroundPublisher,
  type BackgroundPublisherOptions,
  detectServerless,
  BackgroundPublisher as Publisher,
  type PublisherMode,
} from "./_publisher.js";

export interface IntegrationConfig {
  client: AxonPush;
  channelId: number;
  agentId?: string;
  traceId?: string;
  mode?: PublisherMode;
  queueSize?: number;
  shutdownTimeoutMs?: number;
  concurrency?: number;
  bullmqOptions?: BullMQPublisherOptions;
}

export function truncate(value: unknown, maxLen = 2000): unknown {
  try {
    const s = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (s.length > maxLen) return `${s.slice(0, maxLen)}...`;
    return JSON.parse(s);
  } catch {
    const s = String(value);
    return s.slice(0, maxLen);
  }
}

export async function safePublish(
  client: AxonPush,
  channelId: number,
  identifier: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  opts: {
    agentId?: string;
    trace: TraceContext;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await client.events.publish({
      identifier,
      payload: payload as Record<string, never>,
      channelId,
      agentId: opts.agentId,
      traceId: opts.trace.traceId,
      spanId: opts.trace.nextSpanId(),
      eventType,
      metadata: opts.metadata as Record<string, never>,
    });
  } catch {
    logger.warn(`failed to emit event "${identifier}", suppressing.`);
  }
}

export async function safePublishParams(client: AxonPush, params: PublishParams): Promise<void> {
  try {
    await client.events.publish(params);
  } catch {
    logger.warn(`failed to emit event "${params.identifier}", suppressing.`);
  }
}

export function initTrace(traceId?: string): TraceContext {
  return getOrCreateTrace(traceId);
}

export interface PublisherHolder {
  publisher: BackgroundPublisher | BullMQPublisher | null;
}

export function makePublisher(
  client: AxonPush,
  config: IntegrationConfig,
  integrationName: string,
): PublisherHolder {
  const mode = config.mode ?? "background";
  if (mode !== "background" && mode !== "sync" && mode !== "bullmq") {
    throw new Error(`mode must be 'background', 'sync', or 'bullmq', got ${String(mode)}`);
  }
  if (mode === "sync") {
    return { publisher: null };
  }
  if (mode === "bullmq") {
    if (!config.bullmqOptions) {
      throw new Error(
        "mode: 'bullmq' requires bullmqOptions: { connection, queueName?, jobOptions? }",
      );
    }
    return { publisher: new BullMQPublisher(client, config.bullmqOptions) };
  }
  const opts: BackgroundPublisherOptions = {};
  if (config.queueSize !== undefined) opts.queueSize = config.queueSize;
  if (config.shutdownTimeoutMs !== undefined) opts.shutdownTimeoutMs = config.shutdownTimeoutMs;
  if (config.concurrency !== undefined) opts.concurrency = config.concurrency;

  const publisher = new Publisher(client, opts);

  const serverless = detectServerless();
  if (serverless) {
    logger.info(
      `AxonPush detected ${serverless}. Call ${integrationName}.flush() at the end of ` +
        "each invocation (or wrap your handler with flushAfterInvocation) to avoid " +
        "losing records when the container is frozen.",
    );
  }

  return { publisher };
}

export function dispatchPublish(
  client: AxonPush,
  holder: PublisherHolder,
  params: PublishParams,
): void {
  if (holder.publisher !== null) {
    holder.publisher.submit(params);
    return;
  }
  void safePublishParams(client, params);
}
