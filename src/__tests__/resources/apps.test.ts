import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../../_internal/api/sdk.gen.js";
import type { ResourceClient } from "../../resources/_client.js";
import { AppsResource } from "../../resources/apps.js";

vi.mock("../../_internal/api/sdk.gen.js", () => ({
  appsControllerCreateApp: vi.fn(),
  appsControllerDeleteApp: vi.fn(),
  appsControllerEditApp: vi.fn(),
  appsControllerGetAllApps: vi.fn(),
  appsControllerGetApp: vi.fn(),
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

describe("AppsResource", () => {
  it("list() invokes getAllApps with empty args", async () => {
    const { client, calls } = makeClient();
    await new AppsResource(client).list();
    expect(calls[0]?.op).toBe(ops.appsControllerGetAllApps);
    expect(calls[0]?.args).toEqual({});
  });

  it("get(id) sends a path arg", async () => {
    const { client, calls } = makeClient();
    await new AppsResource(client).get("app-1");
    expect(calls[0]?.op).toBe(ops.appsControllerGetApp);
    expect(calls[0]?.args).toEqual({ path: { id: "app-1" } });
  });

  it("create(name) packages a body", async () => {
    const { client, calls } = makeClient();
    await new AppsResource(client).create("checkout");
    expect(calls[0]?.op).toBe(ops.appsControllerCreateApp);
    expect(calls[0]?.args).toEqual({ body: { name: "checkout" } });
  });

  it("update(id, name) sends a path + body", async () => {
    const { client, calls } = makeClient();
    await new AppsResource(client).update("app-1", "renamed");
    expect(calls[0]?.op).toBe(ops.appsControllerEditApp);
    expect(calls[0]?.args).toEqual({ path: { id: "app-1" }, body: { name: "renamed" } });
  });

  it("delete(id) sends only a path arg", async () => {
    const { client, calls } = makeClient();
    await new AppsResource(client).delete("app-1");
    expect(calls[0]?.op).toBe(ops.appsControllerDeleteApp);
    expect(calls[0]?.args).toEqual({ path: { id: "app-1" } });
  });
});
