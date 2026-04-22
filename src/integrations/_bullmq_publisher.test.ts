import { describe, expect, it, vi } from "vitest";
import type { AxonPush } from "../client.js";
import type { PublishParams } from "../resources/events.js";
import { BullMQPublisher } from "./_bullmq_publisher.js";

function makeParams(id: string): PublishParams {
  return {
    identifier: id,
    payload: { body: id } as unknown as Record<string, never>,
    channelId: 5,
    eventType: "app.log",
  };
}

const fakeClient = {} as AxonPush;

class FakeQueue {
  public added: Array<{ name: string; data: unknown; opts?: unknown }> = [];
  public closed = false;
  async add(name: string, data: unknown, opts?: unknown): Promise<void> {
    this.added.push({ name, data, opts });
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("BullMQPublisher", () => {
  it("throws if constructed without a connection", () => {
    expect(
      () => new BullMQPublisher(fakeClient, { connection: undefined as unknown as object }),
    ).toThrow(/connection/);
  });

  it("surfaces a helpful error when bullmq isn't installed", async () => {
    const publisher = new BullMQPublisher(fakeClient, { connection: {} });
    const logger = (await import("../logger.js")).logger;
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    publisher.submit(makeParams("e1"));
    await flushMicrotasks();

    // Either the lazy import failed (expected — no bullmq installed in CI) or
    // the queue.add succeeded. If it failed, the warning must mention bullmq.
    const enqueueFailed = warn.mock.calls.some((args) => String(args[0] ?? "").includes("bullmq"));
    const importFailed = warn.mock.calls.some((args) =>
      String(args[0] ?? "").match(/bullmq|'bullmq'/i),
    );
    expect(enqueueFailed || importFailed).toBe(true);

    warn.mockRestore();
    await publisher.close();
  });

  it("enqueues jobs when a queue is wired", async () => {
    const fakeQueue = new FakeQueue();
    const publisher = new BullMQPublisher(fakeClient, { connection: {} });
    (publisher as unknown as { queue: FakeQueue }).queue = fakeQueue;

    publisher.submit(makeParams("e1"));
    publisher.submit(makeParams("e2"));
    await flushMicrotasks();

    expect(fakeQueue.added).toHaveLength(2);
    expect(fakeQueue.added[0]?.name).toBe("publish");
    expect((fakeQueue.added[0]?.data as PublishParams).identifier).toBe("e1");
    expect(fakeQueue.added[0]?.opts).toMatchObject({ attempts: 3 });

    await publisher.close();
    expect(fakeQueue.closed).toBe(true);
  });

  it("drops submissions after close", async () => {
    const fakeQueue = new FakeQueue();
    const publisher = new BullMQPublisher(fakeClient, { connection: {} });
    (publisher as unknown as { queue: FakeQueue }).queue = fakeQueue;

    await publisher.close();
    publisher.submit(makeParams("e1"));
    await flushMicrotasks();

    expect(fakeQueue.added).toHaveLength(0);
  });

  it("flush() is a no-op (durable queue)", async () => {
    const publisher = new BullMQPublisher(fakeClient, { connection: {} });
    await expect(publisher.flush(100)).resolves.toBeUndefined();
  });

  it("merges user jobOptions over defaults", async () => {
    const fakeQueue = new FakeQueue();
    const publisher = new BullMQPublisher(fakeClient, {
      connection: {},
      jobOptions: { attempts: 7 },
    });
    (publisher as unknown as { queue: FakeQueue }).queue = fakeQueue;

    publisher.submit(makeParams("e1"));
    await flushMicrotasks();

    expect(fakeQueue.added[0]?.opts).toMatchObject({
      attempts: 7,
      removeOnComplete: true,
    });

    await publisher.close();
  });
});
