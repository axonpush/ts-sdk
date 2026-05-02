import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxonPushLike } from "./credentials.js";
import { type MqttFactory, type MqttLikeClient, RealtimeClient } from "./mqtt.js";

class FakeMqttClient implements MqttLikeClient {
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  readonly published: Array<{ topic: string; payload: string }> = [];
  ended = false;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  autoConnect = true;

  on(event: "connect", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "message", cb: (topic: string, payload: Uint8Array | Buffer) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: string, cb: (...args: never[]) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb as (...args: unknown[]) => void);
    this.listeners.set(event, arr);
    if (event === "connect" && this.autoConnect) {
      queueMicrotask(() => (cb as () => void)());
    }
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
    if (this.ended) return;
    this.ended = true;
    const arr = this.listeners.get("close") ?? [];
    for (const cb of arr) cb();
  }
  emitMessage(topic: string, payload: object): void {
    const arr = this.listeners.get("message") ?? [];
    const buf = new TextEncoder().encode(JSON.stringify(payload));
    for (const cb of arr) cb(topic, buf);
  }
  emitError(err: Error): void {
    const arr = this.listeners.get("error") ?? [];
    for (const cb of arr) cb(err);
  }
}

interface BuildOpts {
  expiresAtMs?: number;
  invokeImpl?: () => Promise<unknown>;
  onError?: (err: Error) => void;
  refreshLeadMs?: number;
}

function buildClientAndFactory(opts: BuildOpts = {}): {
  client: AxonPushLike;
  invoke: ReturnType<typeof vi.fn>;
  fakes: FakeMqttClient[];
  factory: MqttFactory;
} {
  const fakes: FakeMqttClient[] = [];
  const expiresAt = new Date(Date.now() + (opts.expiresAtMs ?? 3600_000)).toISOString();
  const invoke = vi.fn(
    opts.invokeImpl ??
      (async () => ({
        endpoint: "abc-ats.iot.us-east-1.amazonaws.com",
        presignedWssUrl: "wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?sig=x",
        expiresAt,
        topicPrefix: "axonpush/org_1",
        envSlug: "dev",
        clientId: "org_1",
        region: "us-east-1",
      })),
  );
  const client: AxonPushLike = { invoke: invoke as unknown as AxonPushLike["invoke"] };
  const factory = vi.fn(async () => {
    const fake = new FakeMqttClient();
    fakes.push(fake);
    return fake;
  }) as unknown as MqttFactory;
  return { client, invoke, fakes, factory };
}

describe("RealtimeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connect() fetches credentials and dials the presigned WSS URL", async () => {
    const { client, invoke, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });

    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect((factory as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
    const [call] = (factory as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(call?.[0]).toBe("wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?sig=x");
  });

  it("subscribe() routes events that match the filter to the per-call callback", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    const cb = vi.fn();
    await rt.subscribe({ channelId: "42", eventType: "agent.error" }, cb);
    expect(fakes[0]?.subscribed).toContain("axonpush/org_1/dev/+/42/agent_error/+");

    fakes[0]?.emitMessage("axonpush/org_1/dev/x/42/agent_error/y", {
      id: "e1",
      identifier: "boom",
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("subscribe() allows missing-segment wildcard subscriptions", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    await rt.subscribe({}, () => {});
    expect(fakes[0]?.subscribed).toContain("axonpush/org_1/dev/+/+/+/+");
  });

  it("publish() builds a deterministic topic and serialises the payload", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    await rt.publish({
      channelId: "7",
      appId: "app_2",
      identifier: "my-event",
      payload: { foo: "bar" },
      eventType: "custom",
      agentId: "agent-9",
      environment: "staging",
    });
    expect(fakes[0]?.published).toHaveLength(1);
    const [first] = fakes[0]?.published ?? [];
    expect(first?.topic).toBe("axonpush/org_1/staging/app_2/7/custom/agent-9");
    expect(JSON.parse(first?.payload ?? "{}")).toMatchObject({
      identifier: "my-event",
      payload: { foo: "bar" },
    });
  });

  it("publish() defaults environment to 'default' when no env is configured", async () => {
    const { client, fakes, factory } = buildClientAndFactory({
      invokeImpl: async () => ({
        endpoint: "x",
        presignedWssUrl: "wss://x/mqtt?sig=1",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        topicPrefix: "axonpush/org_1",
        clientId: "org_1",
      }),
    });
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    await rt.publish({ channelId: "c", identifier: "i", payload: {} });
    expect(fakes[0]?.published[0]?.topic).toBe("axonpush/org_1/default/default/c/_/_");
  });

  it("onEvent() invokes every handler and isolates per-callback failures", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const onError = vi.fn();
    const rt = new RealtimeClient(client, { mqttFactory: factory, onError });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    const good = vi.fn();
    rt.onEvent(() => {
      throw new Error("user code blew up");
    });
    rt.onEvent(good);
    fakes[0]?.emitMessage("axonpush/org_1/dev/a/1/custom/_", { id: "e1", identifier: "test" });

    expect(good).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]?.message).toMatch(/user code/);
  });

  it("schedules a refresh only after the broker confirms connection", async () => {
    const expiry = new Date(Date.now() + 90_000).toISOString();
    const invoke = vi.fn(async () => ({
      endpoint: "x",
      presignedWssUrl: "wss://x/mqtt?sig=1",
      expiresAt: expiry,
      topicPrefix: "axonpush/org_1",
      clientId: "org_1",
    }));
    const fakes: FakeMqttClient[] = [];
    const factory = vi.fn(async () => {
      const fake = new FakeMqttClient();
      fake.autoConnect = false;
      fakes.push(fake);
      return fake;
    }) as unknown as MqttFactory;
    const rt = new RealtimeClient(
      { invoke: invoke as unknown as AxonPushLike["invoke"] },
      { mqttFactory: factory, credentialsRefreshLeadMs: 60_000 },
    );

    const connectPromise = rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(invoke).toHaveBeenCalledTimes(1);

    const fake = fakes[0];
    const arr = (fake as unknown as { listeners: Map<string, Array<() => void>> }).listeners.get(
      "connect",
    );
    arr?.[0]?.();
    await connectPromise;

    await vi.advanceTimersByTimeAsync(35_000);
    expect(invoke).toHaveBeenCalledTimes(2);

    await rt.disconnect();
  });

  it("retries refresh on failure with [5,15,30,60]s backoff", async () => {
    let call = 0;
    const callTimes: number[] = [];
    const expiry = () => new Date(Date.now() + 90_000).toISOString();
    const invoke = vi.fn(async () => {
      call += 1;
      callTimes.push(Date.now());
      if (call === 1) {
        return {
          endpoint: "x",
          presignedWssUrl: "wss://x/mqtt?sig=1",
          expiresAt: expiry(),
          topicPrefix: "axonpush/org_1",
          clientId: "org_1",
        };
      }
      throw new Error("refresh failed");
    });
    const factory = vi.fn(async () => new FakeMqttClient()) as unknown as MqttFactory;
    const rt = new RealtimeClient(
      { invoke: invoke as unknown as AxonPushLike["invoke"] },
      { mqttFactory: factory, credentialsRefreshLeadMs: 60_000 },
    );
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    // first refresh fires at expiresAt - leadMs = 30s
    // then backoff retries at +5s, +15s, +30s, +60s, +60s, ...
    // total to reach 6 invocations: 30 + 5 + 15 + 30 + 60 = 140s
    await vi.advanceTimersByTimeAsync(140_500);
    expect(call).toBeGreaterThanOrEqual(6);

    const startTime = callTimes[0] ?? 0;
    const gaps = callTimes.slice(1, 6).map((t, i) => t - (callTimes[i] ?? 0));
    expect(callTimes[1]).toBeDefined();
    expect((callTimes[1] ?? 0) - startTime).toBeGreaterThanOrEqual(29_000);
    expect((callTimes[1] ?? 0) - startTime).toBeLessThanOrEqual(31_000);
    expect(gaps[1]).toBeGreaterThanOrEqual(4_500);
    expect(gaps[1]).toBeLessThanOrEqual(5_500);
    expect(gaps[2]).toBeGreaterThanOrEqual(14_500);
    expect(gaps[2]).toBeLessThanOrEqual(15_500);
    expect(gaps[3]).toBeGreaterThanOrEqual(29_500);
    expect(gaps[3]).toBeLessThanOrEqual(30_500);
    expect(gaps[4]).toBeGreaterThanOrEqual(59_500);
    expect(gaps[4]).toBeLessThanOrEqual(60_500);

    await rt.disconnect();
  });

  it("disconnect() is idempotent and resolves wait()", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    const waitPromise = rt.wait();
    await rt.disconnect();
    await rt.disconnect();
    await rt.disconnect();
    await expect(waitPromise).resolves.toBeUndefined();
    expect(fakes[0]?.ended).toBe(true);
  });

  it("unsubscribe() removes a previously registered subscription", async () => {
    const { client, fakes, factory } = buildClientAndFactory();
    const rt = new RealtimeClient(client, { mqttFactory: factory });
    await rt.connect();
    await vi.advanceTimersByTimeAsync(0);

    const filters = { channelId: "42", eventType: "evt" };
    await rt.subscribe(filters, () => {});
    expect(fakes[0]?.subscribed).toHaveLength(1);
    await rt.unsubscribe(filters);
    expect(fakes[0]?.unsubscribed).toContain("axonpush/org_1/dev/+/42/evt/+");
  });
});
