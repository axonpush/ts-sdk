import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";
import {
  dispatchPublish,
  type IntegrationConfig,
  initTrace,
  makePublisher,
  type PublisherHolder,
} from "./_base.js";

export { flushAfterInvocation } from "./_publisher.js";

/**
 * Pino transport for AxonPush.
 *
 * Pino is the fastest Node.js logger and the modern standard for backend
 * services. This integration adapts Pino's stream-based output into AxonPush
 * `app.log` events with OpenTelemetry-shaped payloads.
 *
 * Publishing is **non-blocking** by default: each record is pushed onto a
 * bounded in-memory queue and drained by a single background task, so
 * `log.info(...)` stays O(microseconds) on the caller's path. Call
 * `stream.flush(timeoutMs?)` at known checkpoints (end of a Lambda
 * invocation, end of a test) to guarantee delivery, or `stream.close()`
 * on graceful shutdown.
 *
 * Pino is an OPTIONAL peer dependency — install it alongside the SDK:
 *   npm install pino
 *
 * Usage:
 *   import pino from 'pino';
 *   import { AxonPush } from '@axonpush/sdk';
 *   import { createAxonPushPinoStream } from '@axonpush/sdk/integrations/pino';
 *
 *   const client = new AxonPush({ apiKey: '...' });
 *   const stream = createAxonPushPinoStream({
 *     client,
 *     channelId: 42,
 *     serviceName: 'my-api',
 *   });
 *   const log = pino({ level: 'info' }, stream);
 *   log.info({ user: 'alice' }, 'login succeeded');
 */

const PINO_LEVELS: Record<number, { number: number; text: string }> = {
  10: { number: 1, text: "TRACE" },
  20: { number: 5, text: "DEBUG" },
  30: { number: 9, text: "INFO" },
  40: { number: 13, text: "WARN" },
  50: { number: 17, text: "ERROR" },
  60: { number: 21, text: "FATAL" },
};

export interface PinoStreamConfig extends IntegrationConfig {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
}

export interface AxonPushPinoStream {
  write(chunk: string): void;
  flush(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export function createAxonPushPinoStream(config: PinoStreamConfig): AxonPushPinoStream {
  const client = config.client;
  const channelId = config.channelId;
  const trace = initTrace(config.traceId);
  const eventType: EventType = "app.log";
  const holder = makePublisher(client, config, "pinoStream");

  const resource: Record<string, unknown> = {};
  if (config.serviceName) resource["service.name"] = config.serviceName;
  if (config.serviceVersion) resource["service.version"] = config.serviceVersion;
  if (config.environment) resource["deployment.environment"] = config.environment;
  const resourceOrUndefined = Object.keys(resource).length > 0 ? resource : undefined;

  const write = (chunk: string): void => {
    const trimmed = chunk.trim();
    if (!trimmed) return;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed);
    } catch {
      emit(client, holder, channelId, trace, eventType, {
        severityNumber: 9,
        severityText: "INFO",
        body: trimmed,
        resource: resourceOrUndefined,
      });
      return;
    }

    const level = typeof record.level === "number" ? record.level : 30;
    const severity = PINO_LEVELS[level] ?? PINO_LEVELS[30]!;

    const { msg, time, level: _l, hostname, pid, ...rest } = record;

    const attributes: Record<string, unknown> = { ...rest };
    if (hostname !== undefined) attributes["host.name"] = hostname;
    if (pid !== undefined) attributes["process.pid"] = pid;

    emit(client, holder, channelId, trace, eventType, {
      timeUnixNano: typeof time === "number" ? String(time * 1_000_000) : undefined,
      severityNumber: severity.number,
      severityText: severity.text,
      body: typeof msg === "string" ? msg : msg !== undefined ? msg : trimmed,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      resource: resourceOrUndefined,
    });
  };

  return {
    write,
    async flush(timeoutMs?: number): Promise<void> {
      if (holder.publisher) await holder.publisher.flush(timeoutMs);
    },
    async close(): Promise<void> {
      if (holder.publisher) await holder.publisher.close();
    },
  };
}

function emit(
  client: AxonPush,
  holder: PublisherHolder,
  channelId: number,
  trace: ReturnType<typeof initTrace>,
  eventType: EventType,
  payload: Record<string, unknown>,
): void {
  try {
    const params: PublishParams = {
      identifier: "pino",
      payload: payload as Record<string, never>,
      channelId,
      traceId: trace.traceId,
      spanId: trace.nextSpanId(),
      eventType,
      metadata: { framework: "pino" } as unknown as Record<string, never>,
    };
    dispatchPublish(client, holder, params);
  } catch (err) {
    sdkLogger.warn(`pino transport failed: ${(err as Error).message}`);
  }
}
