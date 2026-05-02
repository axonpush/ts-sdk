import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iotCredentialsControllerGetCredentials } from "../_internal/api/sdk.gen.js";
import { type AxonPushLike, fetchIotCredentials, msUntilRefresh } from "./credentials.js";

function makeClient(invokeImpl: (op: unknown, args?: unknown) => Promise<unknown>): AxonPushLike {
  return {
    invoke: vi.fn(invokeImpl) as unknown as AxonPushLike["invoke"],
  };
}

describe("fetchIotCredentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes the generated iotCredentialsControllerGetCredentials op", async () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const invoke = vi.fn(async (_op: unknown, _args?: unknown) => ({
      endpoint: "abc-ats.iot.us-east-1.amazonaws.com",
      presignedWssUrl: "wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?sig=x",
      expiresAt,
      topicPrefix: "axonpush/org_1",
      envSlug: "default",
      topicTemplate: "axonpush/{orgId}/{envSlug}/{appId}/{channelId}/{eventType}/{agentId}",
      clientId: "org_1",
      region: "us-east-1",
    }));
    const client: AxonPushLike = { invoke: invoke as unknown as AxonPushLike["invoke"] };

    const creds = await fetchIotCredentials(client);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe(iotCredentialsControllerGetCredentials);
    expect(creds.endpoint).toContain("iot.us-east-1.amazonaws.com");
    expect(creds.presignedWssUrl.startsWith("wss://")).toBe(true);
    expect(creds.expiresAt).toBe(expiresAt);
    expect(creds.topicPrefix).toBe("axonpush/org_1");
    expect(creds.envSlug).toBe("default");
    expect(creds.region).toBe("us-east-1");
  });

  it("propagates errors from the underlying op", async () => {
    const client = makeClient(async () => {
      throw new Error("boom");
    });
    await expect(fetchIotCredentials(client)).rejects.toThrow(/boom/);
  });

  it("throws when the response is missing presignedWssUrl/expiresAt", async () => {
    const client = makeClient(async () => ({ endpoint: "x" }));
    await expect(fetchIotCredentials(client)).rejects.toThrow(/presignedWssUrl/);
  });

  it("throws when invoke returns null (fail-open path)", async () => {
    const client = makeClient(async () => null);
    await expect(fetchIotCredentials(client)).rejects.toThrow(/no credentials/);
  });
});

describe("msUntilRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ms until expiry minus the lead window", () => {
    const expiresAt = new Date("2026-04-29T01:00:00Z").toISOString();
    expect(msUntilRefresh(expiresAt, 60_000)).toBe(60 * 60 * 1000 - 60_000);
  });

  it("returns 0 for past expiry", () => {
    expect(msUntilRefresh(new Date("2026-04-28T23:00:00Z").toISOString())).toBe(0);
  });

  it("returns 0 for invalid date", () => {
    expect(msUntilRefresh("not-a-date")).toBe(0);
  });
});
