import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MqttFactory, type MqttLikeClient, RealtimeClient } from "./mqtt.js";

class FakeMqttClient implements MqttLikeClient {
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  readonly published: Array<{ topic: string; payload: string }> = [];
  ended = false;
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: any, cb: any): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    if (event === "connect") queueMicrotask(() => cb());
  }

  subscribe(topic: string): void {
    this.subscribed.push(topic);
  }

  unsubscribe(topic: string): void {
    this.unsubscribed.push(topic);
  }

  publish(topic: string, payload: string): void {
    this.published.push({ topic, payload });
  }

  end(): void {
    this.ended = true;
    const arr = this.listeners.get("close") ?? [];
    for (const cb of arr) cb();
  }

  emitMessage(topic: string, payload: object): void {
    const arr = this.listeners.get("message") ?? [];
    const buf = new TextEncoder().encode(JSON.stringify(payload));
    for (const cb of arr) cb(topic, buf);
  }
}

function buildOpts(fakeClient: FakeMqttClient, fetchImpl?: typeof fetch) {
  const factory: MqttFactory = vi.fn(async () => fakeClient);
  const fetchMock =
    fetchImpl ??
    (vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            endpoint: "abc-ats.iot.us-east-1.amazonaws.com",
            presignedWssUrl: "wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?sig=x",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch);
  return {
    baseUrl: "https://api.example.com",
    headers: { "X-API-Key": "ak_test" },
    orgId: "org_1",
    appId: "app_2",
    mqttFactory: factory,
    fetchImpl: fetchMock,
  };
}

describe("RealtimeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches credentials and connects to the presigned WSS URL", async () => {
    const fake = new FakeMqttClient();
    const opts = buildOpts(fake);
    const client = new RealtimeClient(opts);

    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.mqttFactory).toHaveBeenCalledTimes(1);
    const factoryMock = opts.mqttFactory as unknown as { mock: { calls: any[][] } };
    const [call] = factoryMock.mock.calls;
    expect(call?.[0]).toBe("wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?sig=x");
  });

  it("subscribe() builds a topic with wildcards and forwards to the client", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    client.subscribe(42, { eventType: "agent.error" });
    expect(fake.subscribed).toContain("axonpush/org_1/+/app_2/42/agent.error/+");
  });

  it("subscribe() with environment pins the env slug", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    client.subscribe(42, { environment: "prod", eventType: "agent.error" });
    expect(fake.subscribed).toContain("axonpush/org_1/prod/app_2/42/agent.error/+");
  });

  it("subscribe() resubscribes on reconnect", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);
    client.subscribe(1);
    expect(fake.subscribed).toEqual(["axonpush/org_1/+/app_2/1/+/+"]);
  });

  it("publish() calls client.publish with a serialized payload on the deterministic topic", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    client.publish({
      channelId: 7,
      identifier: "my-event",
      payload: { foo: "bar" },
      eventType: "custom",
      agentId: "agent-9",
      environment: "staging",
    });
    expect(fake.published).toHaveLength(1);
    const [first] = fake.published;
    expect(first?.topic).toBe("axonpush/org_1/staging/app_2/7/custom/agent-9");
    const decoded = JSON.parse(first?.payload ?? "{}");
    expect(decoded.identifier).toBe("my-event");
    expect(decoded.payload.foo).toBe("bar");
  });

  it("onEvent() receives messages parsed from the broker", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const handler = vi.fn();
    client.onEvent(handler);
    fake.emitMessage("axonpush/org_1/dev/app_2/1/custom/_", { id: 1, identifier: "test" });
    expect(handler).toHaveBeenCalledTimes(1);
    const [handlerCall] = handler.mock.calls;
    expect(handlerCall?.[0]).toMatchObject({ id: 1, identifier: "test" });
  });

  it("disconnect() ends the underlying client and resolves wait()", async () => {
    const fake = new FakeMqttClient();
    const client = new RealtimeClient(buildOpts(fake));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const waitPromise = client.wait();
    await client.disconnect();
    await expect(Promise.race([waitPromise, Promise.resolve("ok")])).resolves.toBe("ok");
    expect(fake.ended).toBe(true);
  });

  it("schedules a refresh before the credential expiry", async () => {
    const fake = new FakeMqttClient();
    const expiry = new Date(Date.now() + 120_000).toISOString();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            endpoint: "x",
            presignedWssUrl: "wss://x/mqtt?sig=1",
            expiresAt: expiry,
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const client = new RealtimeClient(buildOpts(fake, fetchMock as unknown as typeof fetch));
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(70_000);
    expect(
      (fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    await client.disconnect();
  });
});
