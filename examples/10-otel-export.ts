/**
 * 10 — OpenTelemetry SpanExporter
 *
 * Wires `AxonPushSpanExporter` into a basic OTel SDK setup. We use
 * `BasicTracerProvider` from `@opentelemetry/sdk-trace-base` so the
 * example doesn't need the full Node auto-instrumentation bundle.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Optional peer deps:
 *   bun add @opentelemetry/api @opentelemetry/sdk-trace-base
 *
 * Run:
 *   bun run examples/10-otel-export.ts
 */

import { AxonPush, AxonPushSpanExporter } from "../src/index";
import { CHANNEL_ID, requireEnv, tryImport } from "./config";

interface OtelApiMod {
  trace?: { getTracer: (name: string, version?: string) => unknown };
  default?: { trace?: { getTracer: (name: string, version?: string) => unknown } };
}

interface OtelSdkMod {
  BasicTracerProvider?: new (opts?: Record<string, unknown>) => {
    addSpanProcessor: (p: unknown) => void;
    register: () => void;
    shutdown: () => Promise<void>;
    getTracer: (name: string, version?: string) => {
      startSpan: (name: string) => { setAttribute: (k: string, v: unknown) => void; end: () => void };
    };
  };
  SimpleSpanProcessor?: new (exp: unknown) => unknown;
}

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const otelApi = await tryImport<OtelApiMod>("@opentelemetry/api");
  const otelSdk = await tryImport<OtelSdkMod>("@opentelemetry/sdk-trace-base");
  if (!otelApi || !otelSdk?.BasicTracerProvider || !otelSdk.SimpleSpanProcessor) {
    console.log(
      "@opentelemetry/api or @opentelemetry/sdk-trace-base is not installed — skipping live setup.",
    );
    console.log(
      "Install with: bun add @opentelemetry/api @opentelemetry/sdk-trace-base",
    );
    return;
  }

  const client = new AxonPush();
  const exporter = new AxonPushSpanExporter({
    client,
    channelId: CHANNEL_ID,
    serviceName: "examples-otel",
    serviceVersion: "0.0.5",
  });

  const provider = new otelSdk.BasicTracerProvider();
  provider.addSpanProcessor(new otelSdk.SimpleSpanProcessor(exporter));
  provider.register();

  const tracer = provider.getTracer("examples-otel", "0.0.5");
  const span = tracer.startSpan("demo-operation");
  span.setAttribute("user.id", "demo-user");
  span.setAttribute("payload.size", 1024);
  span.end();

  await exporter.forceFlush();
  await provider.shutdown();
  client.close();
  console.log("flushed 1 span via AxonPushSpanExporter");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
