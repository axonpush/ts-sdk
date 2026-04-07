import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import { logger } from "../logger.js";
import { getOrCreateTrace, type TraceContext } from "../tracing.js";

export interface IntegrationConfig {
  client: AxonPush;
  channelId: number;
  agentId?: string;
  traceId?: string;
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

export function initTrace(traceId?: string): TraceContext {
  return getOrCreateTrace(traceId);
}
