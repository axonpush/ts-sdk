import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../../_internal/api/sdk.gen.js";
import type { ResourceClient, TraceContextLike } from "../../resources/_client.js";
import { EventsResource } from "../../resources/events.js";

vi.mock("../../_internal/api/sdk.gen.js", () => ({
  eventControllerCreateEvent: vi.fn(),
  eventControllerListEvents: vi.fn(),
  eventsSearchControllerSearch: vi.fn(),
}));

interface InvokeCall {
  op: unknown;
  args: unknown;
}

function makeClient(env: string | undefined = undefined): {
  client: ResourceClient;
  calls: InvokeCall[];
  trace: TraceContextLike;
} {
  const calls: InvokeCall[] = [];
  const trace: TraceContextLike = {
    traceId: "tr_deadbeef",
    nextSpanId: vi.fn().mockReturnValue("sp_deadbeef_0001"),
  };
  const client: ResourceClient = {
    environment: env,
    getOrCreateTrace: vi.fn().mockReturnValue(trace),
    invoke: vi.fn().mockImplementation(async (op, args) => {
      calls.push({ op, args });
      return { data: "fake" } as unknown;
    }),
  };
  return { client, calls, trace };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventsResource.publish", () => {
  it("forwards required fields and seeds trace/span ids", async () => {
    const { client, calls, trace } = makeClient();
    const r = new EventsResource(client);

    await r.publish({
      identifier: "evt-1",
      payload: { hello: "world" },
      channelId: "ch-uuid",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe(ops.eventControllerCreateEvent);
    const body = (calls[0]?.args as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      identifier: "evt-1",
      channel_id: "ch-uuid",
      payload: { hello: "world" },
      traceId: trace.traceId,
      spanId: "sp_deadbeef_0001",
      eventType: "custom",
      sync: false,
    });
    expect(client.getOrCreateTrace).toHaveBeenCalledWith(undefined);
  });

  it("honours an explicit eventType, agentId, and parentEventId", async () => {
    const { client, calls } = makeClient();
    const r = new EventsResource(client);

    await r.publish({
      identifier: "id-2",
      payload: {},
      channelId: "ch",
      agentId: "agent-x",
      parentEventId: "evt-parent",
      eventType: "agent.tool_call.start",
      metadata: { tool: "search" },
    });

    const body = (calls[0]?.args as { body: Record<string, unknown> }).body;
    expect(body.agentId).toBe("agent-x");
    expect(body.parentEventId).toBe("evt-parent");
    expect(body.eventType).toBe("agent.tool_call.start");
    expect(body.metadata).toEqual({ tool: "search" });
  });

  it("falls through to the client's environment when params.environment is omitted", async () => {
    const { client, calls } = makeClient("staging");
    const r = new EventsResource(client);

    await r.publish({ identifier: "i", payload: {}, channelId: "c" });

    const body = (calls[0]?.args as { body: Record<string, unknown> }).body;
    expect(body.environment).toBe("staging");
  });

  it("explicit params.environment overrides the client default", async () => {
    const { client, calls } = makeClient("staging");
    const r = new EventsResource(client);

    await r.publish({
      identifier: "i",
      payload: {},
      channelId: "c",
      environment: "prod",
    });

    const body = (calls[0]?.args as { body: Record<string, unknown> }).body;
    expect(body.environment).toBe("prod");
  });

  it("propagates a caller-supplied traceId via getOrCreateTrace", async () => {
    const { client } = makeClient();
    const r = new EventsResource(client);

    await r.publish({ identifier: "i", payload: {}, channelId: "c", traceId: "tr_caller" });

    expect(client.getOrCreateTrace).toHaveBeenCalledWith("tr_caller");
  });
});

describe("EventsResource.list", () => {
  it("passes channelId via path and forwards filters as query", async () => {
    const { client, calls } = makeClient("dev");
    const r = new EventsResource(client);

    await r.list("ch-uuid", { limit: 50, eventType: ["agent.start"], traceId: "tr-1" });

    expect(calls[0]?.op).toBe(ops.eventControllerListEvents);
    expect(calls[0]?.args).toEqual({
      path: { channelId: "ch-uuid" },
      query: {
        limit: 50,
        eventType: ["agent.start"],
        traceId: "tr-1",
        environment: "dev",
      },
    });
  });
});

describe("EventsResource.search", () => {
  it("forwards channelId/appId/source as query params", async () => {
    const { client, calls } = makeClient();
    const r = new EventsResource(client);

    await r.search({ channelId: "ch", appId: "app", source: "sentry" });

    expect(calls[0]?.op).toBe(ops.eventsSearchControllerSearch);
    expect((calls[0]?.args as { query: Record<string, unknown> }).query).toMatchObject({
      channelId: "ch",
      appId: "app",
      source: "sentry",
    });
  });
});
