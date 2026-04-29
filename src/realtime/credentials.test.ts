import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIotCredentials, msUntilRefresh } from "./credentials.js";

describe("fetchIotCredentials", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls the configured baseUrl + /auth/iot-credentials with headers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            endpoint: "abc-ats.iot.us-east-1.amazonaws.com",
            presignedWssUrl: "wss://abc-ats.iot.us-east-1.amazonaws.com/mqtt?X-Amz-Signature=...",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const creds = await fetchIotCredentials({
      baseUrl: "https://api.example.com/",
      headers: { "X-API-Key": "ak_test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const [first] = calls;
    expect(first?.[0]).toBe("https://api.example.com/auth/iot-credentials");
    expect(first?.[1].method).toBe("GET");
    expect(first?.[1].headers).toMatchObject({ "X-API-Key": "ak_test" });
    expect(creds.endpoint).toContain("iot.us-east-1.amazonaws.com");
    expect(creds.presignedWssUrl.startsWith("wss://")).toBe(true);
  });

  it("throws on non-OK responses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    await expect(
      fetchIotCredentials({
        baseUrl: "https://api.example.com",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws when payload is missing fields", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ endpoint: "x" }), { status: 200 }),
    );
    await expect(
      fetchIotCredentials({
        baseUrl: "https://api.example.com",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/presignedWssUrl/);
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

  it("returns ms until expiry minus lead", () => {
    const expiresAt = new Date("2026-04-29T01:00:00Z").toISOString();
    expect(msUntilRefresh(expiresAt, 60)).toBe(60 * 60 * 1000 - 60 * 1000);
  });

  it("returns 0 for past expiry", () => {
    const expiresAt = new Date("2026-04-28T23:00:00Z").toISOString();
    expect(msUntilRefresh(expiresAt)).toBe(0);
  });

  it("returns 0 for invalid date", () => {
    expect(msUntilRefresh("not-a-date")).toBe(0);
  });
});
