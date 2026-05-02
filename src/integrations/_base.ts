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
  type OverflowPolicy,
  BackgroundPublisher as Publisher,
  type PublisherMode,
} from "./_publisher.js";

export { inPublisherScope, runInPublisherScope } from "./_publisher.js";

/**
 * Public boundary type for `channelId` arguments accepted by every
 * integration. v0.0.4 allowed `number`; v0.0.5 standardises on string
 * UUIDs but keeps the `number` form working with a deprecation warning
 * routed through {@link coerceChannelId}.
 */
export type ChannelIdInput = string | number;

/**
 * Coerce a v0.0.4-style numeric channelId to the v0.0.5 string form.
 * Logs a single `console.warn` per coercion so callers can migrate
 * incrementally.
 */
export function coerceChannelId(value: ChannelIdInput): string {
  if (typeof value === "number") {
    console.warn("[axonpush] channelId as number is deprecated; pass a string UUID instead.");
    return String(value);
  }
  return value;
}

export interface IntegrationConfig {
  client: AxonPush;
  channelId: ChannelIdInput;
  agentId?: string;
  traceId?: string;
  mode?: PublisherMode;
  queueSize?: number;
  overflowPolicy?: OverflowPolicy;
  shutdownTimeoutMs?: number;
  concurrency?: number;
  bullmqOptions?: BullMQPublisherOptions;
}

/**
 * Narrow shim around the SHARED-CONTRACT-guaranteed
 * `client.events.publish(...)` chokepoint. Stream A's lazy
 * `AxonPush.events` typing (`Promise<unknown>`) is a transitional
 * detail — integrations rely only on the call shape promised in §3 of
 * `SHARED-CONTRACT.md`, so we cast through this helper rather than
 * coupling to the shifting facade type.
 */
interface PublishLike {
  events: { publish(params: PublishParams): Promise<unknown> };
}

function asPublisher(client: AxonPush): PublishLike {
  return client as unknown as PublishLike;
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
  channelId: ChannelIdInput,
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
    await asPublisher(client).events.publish({
      identifier,
      payload: payload as Record<string, never>,
      channelId: coerceChannelId(channelId),
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
    await asPublisher(client).events.publish(params);
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
  if (config.overflowPolicy !== undefined) opts.overflowPolicy = config.overflowPolicy;
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
