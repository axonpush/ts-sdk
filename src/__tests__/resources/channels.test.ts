import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../../_internal/api/sdk.gen.js";
import type { ResourceClient } from "../../resources/_client.js";
import { ChannelsResource } from "../../resources/channels.js";

vi.mock("../../_internal/api/sdk.gen.js", () => ({
  channelControllerCreateChannel: vi.fn(),
  channelControllerDeleteChannel: vi.fn(),
  channelControllerGetChannel: vi.fn(),
  channelControllerUpdateChannel: vi.fn(),
}));

interface InvokeCall {
  op: unknown;
  args: unknown;
}

function makeClient(): { client: ResourceClient; calls: InvokeCall[] } {
  const calls: InvokeCall[] = [];
  const client: ResourceClient = {
    environment: undefined,
    getOrCreateTrace: vi.fn(),
    invoke: vi.fn().mockImplementation(async (op, args) => {
      calls.push({ op, args });
      return null;
    }),
  };
  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChannelsResource", () => {
  it("get(id) calls the right op with a path arg", async () => {
    const { client, calls } = makeClient();
    await new ChannelsResource(client).get("ch-id");
    expect(calls[0]?.op).toBe(ops.channelControllerGetChannel);
    expect(calls[0]?.args).toEqual({ path: { id: "ch-id" } });
  });

  it("create(name, appId) packages a body", async () => {
    const { client, calls } = makeClient();
    await new ChannelsResource(client).create("orders", "app-1");
    expect(calls[0]?.op).toBe(ops.channelControllerCreateChannel);
    expect(calls[0]?.args).toEqual({ body: { name: "orders", appId: "app-1" } });
  });

  it("update(id, fields) sends a path + body patch", async () => {
    const { client, calls } = makeClient();
    await new ChannelsResource(client).update("ch", { name: "renamed" });
    expect(calls[0]?.op).toBe(ops.channelControllerUpdateChannel);
    expect(calls[0]?.args).toEqual({ path: { id: "ch" }, body: { name: "renamed" } });
  });

  it("delete(id) sends only a path arg", async () => {
    const { client, calls } = makeClient();
    await new ChannelsResource(client).delete("ch");
    expect(calls[0]?.op).toBe(ops.channelControllerDeleteChannel);
    expect(calls[0]?.args).toEqual({ path: { id: "ch" } });
  });
});
