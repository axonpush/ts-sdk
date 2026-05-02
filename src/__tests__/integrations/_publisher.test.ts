import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxonPush } from "../../client.js";
import { runInPublisherScope } from "../../integrations/_base.js";
import {
  BackgroundPublisher,
  detectServerless,
  type Flushable,
  flushAfterInvocation,
  inPublisherScope,
} from "../../integrations/_publisher.js";
import type { PublishParams } from "../../resources/events.js";

function makeParams(id: string): PublishParams {
  return {
    identifier: id,
    payload: { body: id } as unknown as Record<string, never>,
    channelId: "ch-1",
    eventType: "app.log",
  };
}

class FakeEventsResource {
  public published: PublishParams[] = [];
  public failures = 0;
  public latencyMs = 0;
  public shouldThrow = false;
  public observedScopeFlag: boolean | undefined;

  async publish(params: PublishParams): Promise<undefined> {
    this.observedScopeFlag = inPublisherScope();
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    if (this.shouldThrow) {
      this.failures++;
      throw new Error("simulated publish failure");
    }
    this.published.push(params);
    return undefined;
  }
}

function makeFakeClient(events = new FakeEventsResource()): {
  client: AxonPush;
  events: FakeEventsResource;
} {
  const client = { events } as unknown as AxonPush;
  return { client, events };
}

describe("BackgroundPublisher basics", () => {
  it("submits drain on the background queue", async () => {
    const { client, events } = makeFakeClient();
    const pub = new BackgroundPublisher(client);
    for (let i = 0; i < 5; i++) pub.submit(makeParams(`r_${i}`));
    await pub.flush(2000);
    expect(events.published).toHaveLength(5);
    expect(events.published[0]?.identifier).toBe("r_0");
    await pub.close();
  });

  it("publish runs inside publisherScope", async () => {
    const { client, events } = makeFakeClient();
    const pub = new BackgroundPublisher(client);
    pub.submit(makeParams("scoped"));
    await pub.flush(2000);
    expect(events.observedScopeFlag).toBe(true);
    await pub.close();
  });

  it("inPublisherScope is false outside the publisher", () => {
    expect(inPublisherScope()).toBe(false);
  });

  it("flush blocks until drained", async () => {
    const { client, events } = makeFakeClient();
    events.latencyMs = 20;
    const pub = new BackgroundPublisher(client);
    pub.submit(makeParams("a"));
    pub.submit(makeParams("b"));
    pub.submit(makeParams("c"));
    await pub.flush(2000);
    expect(events.published).toHaveLength(3);
    await pub.close();
  });

  it("flush respects timeout", async () => {
    const { client, events } = makeFakeClient();
    events.latencyMs = 200;
    const pub = new BackgroundPublisher(client);
    for (let i = 0; i < 10; i++) pub.submit(makeParams(`x_${i}`));
    const start = Date.now();
    await pub.flush(20);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    await pub.close();
  });

  it("close drains pending records before returning", async () => {
    const { client, events } = makeFakeClient();
    const pub = new BackgroundPublisher(client);
    for (let i = 0; i < 5; i++) pub.submit(makeParams(`r_${i}`));
    await pub.close();
    expect(events.published).toHaveLength(5);
  });

  it("close is idempotent", async () => {
    const { client } = makeFakeClient();
    const pub = new BackgroundPublisher(client);
    await pub.close();
    await pub.close();
    await pub.close();
  });

  it("submit after close is silently dropped", async () => {
    const { client, events } = makeFakeClient();
    const pub = new BackgroundPublisher(client);
    await pub.close();
    pub.submit(makeParams("after_close"));
    expect(events.published).toHaveLength(0);
  });
});

describe("BackgroundPublisher overflow policies", () => {
  it("default 'drop-oldest' evicts head when full", async () => {
    const { client, events } = makeFakeClient();
    events.latencyMs = 50;
    const pub = new BackgroundPublisher(client, { queueSize: 2 });
    for (let i = 0; i < 10; i++) pub.submit(makeParams(`x_${i}`));
    await pub.flush(2000);
    expect(pub.droppedCount).toBeGreaterThan(0);
    expect(events.published.length).toBeLessThan(10);
    await pub.close();
  });

  it("'drop-newest' refuses new submissions when full", async () => {
    const { client, events } = makeFakeClient();
    events.latencyMs = 50;
    const pub = new BackgroundPublisher(client, {
      queueSize: 2,
      overflowPolicy: "drop-newest",
    });
    for (let i = 0; i < 10; i++) pub.submit(makeParams(`x_${i}`));
    await pub.flush(2000);
    expect(pub.droppedCount).toBeGreaterThan(0);
    const ids = events.published.map((p) => p.identifier);
    expect(ids[0]).toBe("x_0");
    await pub.close();
  });

  it("'block' eventually accepts every submission", async () => {
    const { client, events } = makeFakeClient();
    events.latencyMs = 5;
    const pub = new BackgroundPublisher(client, {
      queueSize: 2,
      overflowPolicy: "block",
    });
    for (let i = 0; i < 8; i++) pub.submit(makeParams(`x_${i}`));
    await pub.flush(5000);
    expect(events.published).toHaveLength(8);
    expect(pub.droppedCount).toBe(0);
    await pub.close();
  });

  it("publish failures do not kill the drain loop", async () => {
    const { client, events } = makeFakeClient();
    events.shouldThrow = true;
    const pub = new BackgroundPublisher(client);
    pub.submit(makeParams("will_fail"));
    await pub.flush(2000);
    expect(events.failures).toBe(1);

    events.shouldThrow = false;
    pub.submit(makeParams("should_succeed"));
    await pub.flush(2000);
    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.identifier).toBe("should_succeed");
    await pub.close();
  });
});

describe("runInPublisherScope helper", () => {
  it("sets the flag for the synchronous body", () => {
    expect(inPublisherScope()).toBe(false);
    runInPublisherScope(() => {
      expect(inPublisherScope()).toBe(true);
    });
    expect(inPublisherScope()).toBe(false);
  });
});

describe("detectServerless", () => {
  const VARS = [
    "AWS_LAMBDA_FUNCTION_NAME",
    "FUNCTION_TARGET",
    "AZURE_FUNCTIONS_ENVIRONMENT",
  ] as const;

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] !== undefined) process.env[v] = saved[v];
      else delete process.env[v];
    }
  });

  it("returns null when no marker env var is set", () => {
    expect(detectServerless()).toBeNull();
  });

  it("detects AWS Lambda", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";
    expect(detectServerless()).toBe("AWS Lambda");
  });

  it("detects Google Cloud Functions", () => {
    process.env.FUNCTION_TARGET = "handler";
    expect(detectServerless()).toBe("Google Cloud Functions");
  });

  it("detects Azure Functions", () => {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Development";
    expect(detectServerless()).toBe("Azure Functions");
  });
});

describe("flushAfterInvocation", () => {
  class FakeHandler implements Flushable {
    public flushes = 0;
    public lastTimeout: number | undefined;
    async flush(timeoutMs?: number): Promise<void> {
      this.flushes++;
      this.lastTimeout = timeoutMs;
    }
  }

  it("wraps and flushes on success", async () => {
    const h = new FakeHandler();
    const wrapped = flushAfterInvocation(h, async (x: number) => x * 2);
    expect(await wrapped(3)).toBe(6);
    expect(h.flushes).toBe(1);
  });

  it("flushes even when the wrapped function throws", async () => {
    const h = new FakeHandler();
    const wrapped = flushAfterInvocation(h, async () => {
      throw new Error("boom");
    });
    await expect(wrapped()).rejects.toThrow("boom");
    expect(h.flushes).toBe(1);
  });

  it("supports multiple handlers", async () => {
    const h1 = new FakeHandler();
    const h2 = new FakeHandler();
    const wrapped = flushAfterInvocation([h1, h2], async () => "ok");
    expect(await wrapped()).toBe("ok");
    expect(h1.flushes).toBe(1);
    expect(h2.flushes).toBe(1);
  });

  it("forwards the custom timeout", async () => {
    const h = new FakeHandler();
    const wrapped = flushAfterInvocation(h, async () => "ok", { timeoutMs: 1500 });
    await wrapped();
    expect(h.lastTimeout).toBe(1500);
  });

  it("default timeout is 5 seconds", async () => {
    const h = new FakeHandler();
    const wrapped = flushAfterInvocation(h, async () => "ok");
    await wrapped();
    expect(h.lastTimeout).toBe(5000);
  });

  it("handler flush errors are swallowed", async () => {
    const warnSpy = vi.fn();
    const h: Flushable = {
      async flush() {
        throw new Error("flush exploded");
      },
    };
    const sdkLogger = await import("../../logger.js");
    const origWarn = sdkLogger.logger.warn.bind(sdkLogger.logger);
    sdkLogger.logger.warn = ((...args: unknown[]) => {
      warnSpy(...args);
      return origWarn(...(args as Parameters<typeof origWarn>));
    }) as typeof sdkLogger.logger.warn;

    try {
      const wrapped = flushAfterInvocation(h, async () => "ok");
      expect(await wrapped()).toBe("ok");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      sdkLogger.logger.warn = origWarn;
    }
  });
});
