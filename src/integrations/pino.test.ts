import { describe, expect, it } from "vitest";
import type { AxonPush } from "../client.js";
import type { PublishParams } from "../resources/events.js";
import { createAxonPushPinoStream } from "./pino.js";

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

describe("pino stream", () => {
  it("parses a Pino JSON record and publishes an app.log event", async () => {
    const { client, published } = makeFakeClient();
    const stream = createAxonPushPinoStream({
      client,
      channelId: 5,
      serviceName: "pino-svc",
    });
    stream.write(
      JSON.stringify({
        level: 50,
        msg: "connection refused",
        time: 1_700_000_000,
        user: "alice",
      }),
    );
    await stream.flush(2000);

    expect(published).toHaveLength(1);
    const event = published[0]!;
    expect(event.channelId).toBe(5);
    expect(event.eventType).toBe("app.log");
    expect(event.identifier).toBe("pino");
    const payload = event.payload as Record<string, unknown>;
    expect(payload.severityText).toBe("ERROR");
    expect(payload.severityNumber).toBe(17);
    expect(payload.body).toBe("connection refused");
    const attributes = payload.attributes as Record<string, unknown>;
    expect(attributes.user).toBe("alice");
    expect((payload.resource as Record<string, unknown>)["service.name"]).toBe("pino-svc");

    await stream.close();
  });

  it("maps each Pino level to its OTel severity", async () => {
    const { client, published } = makeFakeClient();
    const stream = createAxonPushPinoStream({ client, channelId: 5 });
    const cases: Array<[number, number, string]> = [
      [10, 1, "TRACE"],
      [20, 5, "DEBUG"],
      [30, 9, "INFO"],
      [40, 13, "WARN"],
      [50, 17, "ERROR"],
      [60, 21, "FATAL"],
    ];
    for (const [level, _, __] of cases) {
      stream.write(JSON.stringify({ level, msg: "msg" }));
    }
    await stream.flush(2000);
    expect(published).toHaveLength(cases.length);
    cases.forEach(([, expectedNum, expectedText], i) => {
      const p = published[i]!.payload as Record<string, unknown>;
      expect(p.severityNumber).toBe(expectedNum);
      expect(p.severityText).toBe(expectedText);
    });
    await stream.close();
  });

  it("non-blocking emit returns immediately in background mode", async () => {
    const { client } = makeFakeClient();
    const stream = createAxonPushPinoStream({ client, channelId: 5 });
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      stream.write(JSON.stringify({ level: 30, msg: `msg_${i}` }));
    }
    const writeElapsed = Date.now() - start;
    expect(writeElapsed).toBeLessThan(50);
    await stream.flush(2000);
    await stream.close();
  });
});
