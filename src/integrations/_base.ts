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

/**
 * Derive a human-readable Runnable name from LangChain's
 * `handleChainStart(serialized, inputs, runId, parentRunId, tags, metadata, runType, runName)`
 * positional callback. LangGraph nodes pass `serialized={}` and surface the
 * node identity via the trailing `runName` arg + `metadata.langgraph_node`,
 * so reading only `serialized.name` left every graph step labelled
 * `chain_type: "unknown"`.
 *
 * Resolution order: explicit `runName` -> `metadata.langgraph_node` ->
 * `serialized.name` -> last segment of `serialized.id` -> `"Runnable"`.
 */
export function deriveRunnableName(
  serialized: Record<string, any> | undefined | null,
  runName?: string,
  metadata?: Record<string, unknown>,
): string {
  if (runName && typeof runName === "string") return runName;
  const node = (metadata as { langgraph_node?: unknown } | undefined)?.langgraph_node;
  if (typeof node === "string" && node) return node;
  const s = serialized || {};
  if (typeof s.name === "string" && s.name) return s.name;
  if (Array.isArray(s.id) && s.id.length > 0) {
    return String(s.id[s.id.length - 1]);
  }
  return "Runnable";
}

/**
 * Derive the actual configured LLM model id, not the wrapper class
 * (`ChatOpenAI` / `ChatAnthropic`). LangChain.js puts the runtime model
 * in `extraParams.invocation_params` (or just `extraParams`), and the
 * static config in `serialized.kwargs`.
 *
 * Resolution order:
 *   1. extraParams.invocation_params.{model,model_name,model_id}
 *   2. extraParams.{model,model_name,model_id}
 *   3. serialized.kwargs.{model,model_name,model_id}
 *   4. serialized.name (class-name fallback — still useful)
 *   5. "unknown"
 */
export function deriveModelName(
  serialized: Record<string, any> | undefined | null,
  extraParams?: Record<string, unknown>,
): string {
  const ep = extraParams || {};
  const inv = (ep.invocation_params as Record<string, unknown> | undefined) || {};
  for (const k of ["model", "model_name", "model_id"] as const) {
    const v = inv[k];
    if (typeof v === "string" && v) return v;
  }
  for (const k of ["model", "model_name", "model_id"] as const) {
    const v = ep[k];
    if (typeof v === "string" && v) return v;
  }
  const s = serialized || {};
  const sk = (s.kwargs as Record<string, unknown> | undefined) || {};
  for (const k of ["model", "model_name", "model_id"] as const) {
    const v = sk[k];
    if (typeof v === "string" && v) return v;
  }
  if (typeof s.name === "string" && s.name) return s.name;
  return "unknown";
}

/**
 * Pull useful per-run metadata out of the trailing positional args of
 * LangChain's callbacks (`tags`, `metadata`, `runType`). The returned
 * object is suitable for shallow-merging into a per-event metadata block,
 * so the AxonPush UI can group and filter events by graph node and tag
 * without the user wiring a custom `metadata=` at handler construction.
 *
 * Returned keys (each only when non-empty):
 *   - `langgraph_node`, `langgraph_step`, `langgraph_triggers`, `thread_id`
 *   - `run_type`
 *   - `tags`
 */
export function extractRunMetadata(
  tags?: string[],
  metadata?: Record<string, unknown>,
  runType?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const md = metadata || {};
  for (const k of ["langgraph_node", "langgraph_step", "langgraph_triggers", "thread_id"]) {
    const v = (md as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  if (runType) out.run_type = runType;
  if (tags && tags.length > 0) out.tags = tags;
  return out;
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
