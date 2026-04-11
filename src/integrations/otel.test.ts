import { describe, expect, it } from "vitest";
import type { AxonPush } from "../client.js";
import type { PublishParams } from "../resources/events.js";
import { AxonPushSpanExporter } from "./otel.js";

function makeFakeClient() {
  const published: PublishParams[] = [];
  const client = {
    events: {
      async publish(p: PublishParams) {
        published.push(p);
        return undefined;
      },
    },
  } as unknown as AxonPush;
  return { client, published };
}

function makeFakeSpan(overrides: Record<string, unknown> = {}): any {
  return {
    name: "test-span",
    kind: 1,
    spanContext: () => ({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: 1,
    }),
    startTime: [1_700_000_000, 0],
    endTime: [1_700_000_001, 0],
    status: { code: 0, message: "" },
    attributes: { "http.method": "POST" },
    events: [],
    links: [],
    resource: { attributes: { "service.name": "from-span" } },
    ...overrides,
  };
}

describe("AxonPushSpanExporter", () => {
  it("translates a span into an app.span event", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushSpanExporter({
      client,
      channelId: 9,
      serviceName: "otel-svc",
    });
    const span = makeFakeSpan();

    await new Promise<void>((resolve, reject) => {
      exporter.export([span], (result) => {
        if (result.code === 0) resolve();
        else reject(result.error);
      });
    });
    await exporter.forceFlush();

    expect(published).toHaveLength(1);
    const event = published[0]!;
    expect(event.channelId).toBe(9);
    expect(event.eventType).toBe("app.span");
    expect(event.identifier).toBe("test-span");
    const payload = event.payload as Record<string, unknown>;
    expect(payload.name).toBe("test-span");
    expect(payload.traceId).toBe("a".repeat(32));
    expect(payload.spanId).toBe("b".repeat(16));
    const attrs = payload.attributes as Record<string, unknown>;
    expect(attrs["http.method"]).toBe("POST");
    const resource = payload.resource as Record<string, unknown>;
    expect(resource["service.name"]).toBe("otel-svc");

    await exporter.shutdown();
  });

  it("exports multiple spans in a single batch", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushSpanExporter({ client, channelId: 9 });
    const spans = [
      makeFakeSpan({ name: "a" }),
      makeFakeSpan({ name: "b" }),
      makeFakeSpan({ name: "c" }),
    ];

    await new Promise<void>((resolve, reject) => {
      exporter.export(spans, (result) => {
        if (result.code === 0) resolve();
        else reject(result.error);
      });
    });
    await exporter.forceFlush();

    expect(published).toHaveLength(3);
    expect(published.map((p) => p.identifier)).toEqual(["a", "b", "c"]);

    await exporter.shutdown();
  });

  it("propagates parent span id from parentSpanContext", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushSpanExporter({ client, channelId: 9 });
    const span = makeFakeSpan({ parentSpanContext: { spanId: "c".repeat(16) } });

    await new Promise<void>((resolve, reject) => {
      exporter.export([span], (result) => {
        if (result.code === 0) resolve();
        else reject(result.error);
      });
    });
    await exporter.forceFlush();

    const payload = published[0]!.payload as Record<string, unknown>;
    expect(payload.parentSpanId).toBe("c".repeat(16));

    await exporter.shutdown();
  });

  it("shutdown drains pending spans and closes the publisher", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushSpanExporter({ client, channelId: 9 });
    const span = makeFakeSpan();

    await new Promise<void>((resolve, reject) => {
      exporter.export([span], (result) => {
        if (result.code === 0) resolve();
        else reject(result.error);
      });
    });
    await exporter.shutdown();
    expect(published).toHaveLength(1);
  });
});
