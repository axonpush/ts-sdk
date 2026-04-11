import type { EventType } from "../index.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";
import { dispatchPublish, type IntegrationConfig, initTrace, makePublisher } from "./_base.js";

export { flushAfterInvocation } from "./_publisher.js";

/**
 * Winston transport for AxonPush.
 *
 * Winston is the legacy Node.js logging standard, still widely used. This
 * integration provides a Winston Transport that forwards each log record
 * to AxonPush as an `app.log` event with an OpenTelemetry-shaped payload.
 *
 * Publishing is **non-blocking** by default: the transport's `log()` method
 * pushes each record onto a bounded in-memory queue and returns immediately.
 * A background task drains the queue. Call `transport.flushAxonPush(timeoutMs?)`
 * at known checkpoints (end of a Lambda invocation, end of a test) to
 * guarantee delivery. Winston's native `close()` method also drains pending
 * records before shutting down.
 *
 * `winston` and `winston-transport` are OPTIONAL peer dependencies. Install
 * them alongside the SDK:
 *   npm install winston winston-transport
 *
 * Usage:
 *   import winston from 'winston';
 *   import { AxonPush } from '@axonpush/sdk';
 *   import { createAxonPushWinstonTransport } from '@axonpush/sdk/integrations/winston';
 *
 *   const client = new AxonPush({ apiKey: '...' });
 *   const log = winston.createLogger({
 *     transports: [
 *       new winston.transports.Console(),
 *       await createAxonPushWinstonTransport({ client, channelId: 42, serviceName: 'my-api' }),
 *     ],
 *   });
 *   log.error({ message: 'connection refused', user: 'alice' });
 */

const WINSTON_LEVELS: Record<string, { number: number; text: string }> = {
  silly: { number: 1, text: "TRACE" },
  trace: { number: 1, text: "TRACE" },
  debug: { number: 5, text: "DEBUG" },
  verbose: { number: 5, text: "DEBUG" },
  http: { number: 9, text: "INFO" },
  info: { number: 9, text: "INFO" },
  notice: { number: 11, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  warning: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
  crit: { number: 21, text: "FATAL" },
  alert: { number: 21, text: "FATAL" },
  emerg: { number: 21, text: "FATAL" },
  fatal: { number: 21, text: "FATAL" },
};

export interface WinstonTransportConfig extends IntegrationConfig {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
}

type AbstractTransport = new (
  opts: Record<string, unknown>,
) => {
  log(info: Record<string, unknown>, callback: () => void): void;
};

export async function createAxonPushWinstonTransport(
  config: WinstonTransportConfig,
): Promise<unknown> {
  let TransportBase: AbstractTransport;
  try {
    const mod = (await import("winston-transport" as string)) as {
      default: AbstractTransport;
    };
    TransportBase = mod.default;
  } catch {
    throw new Error(
      "winston-transport is not installed. Run: npm install winston winston-transport",
    );
  }

  const client = config.client;
  const channelId = config.channelId;
  const trace = initTrace(config.traceId);
  const eventType: EventType = "app.log";
  const holder = makePublisher(client, config, "winstonTransport");

  const resource: Record<string, unknown> = {};
  if (config.serviceName) resource["service.name"] = config.serviceName;
  if (config.serviceVersion) resource["service.version"] = config.serviceVersion;
  if (config.environment) resource["deployment.environment"] = config.environment;
  const resourceOrUndefined = Object.keys(resource).length > 0 ? resource : undefined;

  return new (class AxonPushWinstonTransport extends TransportBase {
    constructor() {
      super({});
    }

    override log(info: Record<string, unknown>, callback: () => void) {
      try {
        const level = String(info.level ?? "info").toLowerCase();
        const severity = WINSTON_LEVELS[level] ?? WINSTON_LEVELS.info!;

        const { level: _l, message, timestamp, ...rest } = info;

        const payload: Record<string, unknown> = {
          severityNumber: severity.number,
          severityText: severity.text,
          body: typeof message === "string" ? message : message,
          attributes: Object.keys(rest).length > 0 ? rest : undefined,
          resource: resourceOrUndefined,
        };

        if (typeof timestamp === "string" || typeof timestamp === "number") {
          const ms = typeof timestamp === "number" ? timestamp : Date.parse(timestamp as string);
          if (Number.isFinite(ms)) {
            payload.timeUnixNano = String(ms * 1_000_000);
          }
        }

        const params: PublishParams = {
          identifier: "winston",
          payload: payload as Record<string, never>,
          channelId,
          traceId: trace.traceId,
          spanId: trace.nextSpanId(),
          eventType,
          metadata: { framework: "winston" } as unknown as Record<string, never>,
        };
        dispatchPublish(client, holder, params);
      } catch (err) {
        sdkLogger.warn(`winston transport failed: ${(err as Error).message}`);
      }

      callback();
    }

    async flushAxonPush(timeoutMs?: number): Promise<void> {
      if (holder.publisher) await holder.publisher.flush(timeoutMs);
    }

    close(): void {
      if (holder.publisher) {
        void holder.publisher.close();
      }
    }
  })();
}
