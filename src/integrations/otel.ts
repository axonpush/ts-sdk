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
 * OpenTelemetry SpanExporter for AxonPush.
 *
 * Implements the OTel `SpanExporter` interface so that any Node.js service
 * already instrumented with `@opentelemetry/sdk-trace-node` can ship spans
 * to AxonPush by adding this exporter to its tracer provider:
 *
 *   import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 *   import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
 *   import { AxonPush } from '@axonpush/sdk';
 *   import { AxonPushSpanExporter } from '@axonpush/sdk/integrations/otel';
 *
 *   const provider = new NodeTracerProvider();
 *   provider.addSpanProcessor(
 *     new SimpleSpanProcessor(
 *       new AxonPushSpanExporter({
 *         client: new AxonPush({ apiKey: '...' }),
 *         channelId: 42,
 *         serviceName: 'my-api',
 *       }),
 *     ),
 *   );
 *   provider.register();
 *
 * Span exports are **non-blocking** by default: each span is pushed onto a
 * bounded in-memory queue and drained by a background task. The OTel
 * `forceFlush()` hook drains the queue synchronously — it's called by the
 * tracer provider before shutdown, so a `provider.shutdown()` at process
 * exit guarantees pending spans are delivered. In a Lambda handler, call
 * `exporter.forceFlush()` (or wrap the handler with `flushAfterInvocation`)
 * at the end of each invocation.
 *
 * `@opentelemetry/api` and `@opentelemetry/sdk-trace-base` are OPTIONAL peer
 * dependencies. Install them alongside the SDK:
 *   npm install @opentelemetry/api @opentelemetry/sdk-trace-base
 */

export interface OtelExporterConfig extends IntegrationConfig {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
}

interface ReadableSpanLike {
  name: string;
  kind: number;
  spanContext(): { traceId: string; spanId: string; traceFlags?: number };
  parentSpanId?: string;
  parentSpanContext?: { spanId: string };
  startTime: [number, number];
  endTime: [number, number];
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: Array<{
    time: [number, number];
    name: string;
    attributes?: Record<string, unknown>;
  }>;
  links: Array<{
    context: { traceId: string; spanId: string };
    attributes?: Record<string, unknown>;
  }>;
  resource?: { attributes?: Record<string, unknown> };
  instrumentationLibrary?: { name: string; version?: string };
  instrumentationScope?: { name: string; version?: string };
}

interface ExportResultLike {
  code: number;
  error?: Error;
}

const EXPORT_SUCCESS = 0;
const EXPORT_FAILED = 1;

export class AxonPushSpanExporter {
  private readonly client: AxonPush;
  private readonly channelId: number;
  private readonly trace: ReturnType<typeof initTrace>;
  private readonly resourceOverride: Record<string, unknown>;
  private readonly holder: PublisherHolder;

  constructor(config: OtelExporterConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
    this.trace = initTrace(config.traceId);
    this.holder = makePublisher(config.client, config, "otelExporter");

    const r: Record<string, unknown> = {};
    if (config.serviceName) r["service.name"] = config.serviceName;
    if (config.serviceVersion) r["service.version"] = config.serviceVersion;
    if (config.environment) r["deployment.environment"] = config.environment;
    this.resourceOverride = r;
  }

  export(spans: ReadableSpanLike[], resultCallback: (result: ExportResultLike) => void): void {
    try {
      for (const span of spans) {
        this.exportSingleSpan(span);
      }
      resultCallback({ code: EXPORT_SUCCESS });
    } catch (err) {
      sdkLogger.warn(`otel exporter failed: ${(err as Error).message}`);
      resultCallback({ code: EXPORT_FAILED, error: err as Error });
    }
  }

  async shutdown(): Promise<void> {
    if (this.holder.publisher) await this.holder.publisher.close();
  }

  async forceFlush(): Promise<void> {
    if (this.holder.publisher) await this.holder.publisher.flush();
  }

  async flush(timeoutMs?: number): Promise<void> {
    if (this.holder.publisher) await this.holder.publisher.flush(timeoutMs);
  }

  private exportSingleSpan(span: ReadableSpanLike): void {
    const ctx = span.spanContext();
    const eventType: EventType = "app.span";

    const payload: Record<string, unknown> = {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      name: span.name,
      kind: span.kind,
      startTimeUnixNano: hrTimeToNanoString(span.startTime),
      endTimeUnixNano: hrTimeToNanoString(span.endTime),
      flags: ctx.traceFlags,
      status: {
        code: span.status?.code ?? 0,
        message: span.status?.message ?? "",
      },
      attributes: { ...(span.attributes ?? {}) },
    };

    const parentSpanId = span.parentSpanContext?.spanId ?? span.parentSpanId;
    if (parentSpanId) {
      payload.parentSpanId = parentSpanId;
    }

    if (span.events && span.events.length > 0) {
      payload.events = span.events.map((e) => ({
        timeUnixNano: hrTimeToNanoString(e.time),
        name: e.name,
        attributes: { ...(e.attributes ?? {}) },
      }));
    }

    if (span.links && span.links.length > 0) {
      payload.links = span.links.map((l) => ({
        traceId: l.context?.traceId,
        spanId: l.context?.spanId,
        attributes: { ...(l.attributes ?? {}) },
      }));
    }

    const resource: Record<string, unknown> = {
      ...(span.resource?.attributes ?? {}),
      ...this.resourceOverride,
    };
    if (Object.keys(resource).length > 0) {
      payload.resource = resource;
    }

    const scope = span.instrumentationScope ?? span.instrumentationLibrary;
    if (scope) {
      payload.scope = { name: scope.name, version: scope.version };
    }

    const params: PublishParams = {
      identifier: span.name,
      payload: payload as Record<string, never>,
      channelId: this.channelId,
      traceId: this.trace.traceId,
      spanId: this.trace.nextSpanId(),
      eventType,
      metadata: { framework: "opentelemetry" } as unknown as Record<string, never>,
    };
    dispatchPublish(this.client, this.holder, params);
  }
}

function hrTimeToNanoString(t: [number, number] | undefined): string | undefined {
  if (!t) return undefined;
  const [seconds, nanos] = t;
  const total = BigInt(seconds) * 1_000_000_000n + BigInt(nanos);
  return total.toString();
}
