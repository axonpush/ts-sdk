import { describe, expect, it } from "vitest";
import type { AxonPush } from "../../client.js";
import { AxonPushMastraExporter } from "../../integrations/mastra.js";
import type { PublishParams } from "../../resources/events.js";

function makeFakeClient(): { client: AxonPush; published: PublishParams[] } {
  const published: PublishParams[] = [];
  const client = {
    events: {
      async publish(params: PublishParams) {
        published.push(params);
        return undefined;
      },
    },
  } as unknown as AxonPush;
  return { client, published };
}

describe("AxonPushMastraExporter", () => {
  it("exports a Mastra 1.x ended span with hierarchy and lineage", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushMastraExporter({
      client,
      channelId: "ch-1",
      serviceName: "support-agent",
      serviceVersion: "2.3.1",
      release: "release-42",
    });

    await exporter.onTracingEvent({
      type: "span_ended",
      exportedSpan: {
        id: "b".repeat(16),
        traceId: "a".repeat(32),
        parentSpanId: "c".repeat(16),
        name: "weather.search",
        type: "tool_call",
        startTime: new Date("2026-07-29T10:00:00.000Z"),
        endTime: new Date("2026-07-29T10:00:01.500Z"),
        attributes: { "gen_ai.tool.name": "weather" },
        input: { city: "Kolkata" },
        output: { celsius: 31 },
      },
    } as never);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: "app.span",
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      parentSpanId: "c".repeat(16),
    });
    expect(published[0]?.payload).toMatchObject({
      startTimeUnixNano: "1785319200000000000",
      endTimeUnixNano: "1785319201500000000",
      resource: {
        "service.name": "support-agent",
        "service.version": "2.3.1",
        "deployment.release": "release-42",
      },
    });
  });

  it("exports Mastra logs, metrics, scores, and feedback as correlated signals", async () => {
    const { client, published } = makeFakeClient();
    const exporter = new AxonPushMastraExporter({ client, channelId: "ch-1" });
    const timestamp = new Date("2026-07-29T10:00:00.000Z");

    await exporter.onLogEvent({
      type: "log",
      log: {
        message: "tool failed",
        level: "error",
        timestamp,
        traceId: "trace",
        spanId: "span",
      },
    } as never);
    await exporter.onMetricEvent({
      type: "metric",
      metric: { name: "tokens", value: 42, timestamp, traceId: "trace", spanId: "span" },
    } as never);
    await exporter.onScoreEvent({
      type: "score",
      score: { scorerId: "quality", score: 0.8, timestamp, traceId: "trace", spanId: "span" },
    } as never);
    await exporter.onFeedbackEvent({
      type: "feedback",
      feedback: {
        feedbackType: "thumbs",
        value: true,
        timestamp,
        traceId: "trace",
        spanId: "span",
      },
    } as never);

    expect(published.map((event) => event.metadata?.signal ?? event.eventType)).toEqual([
      "app.log",
      "metric",
      "score",
      "feedback",
    ]);
    expect(published.every((event) => event.traceId === "trace")).toBe(true);
  });
});
