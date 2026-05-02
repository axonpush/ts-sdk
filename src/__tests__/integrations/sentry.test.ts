import { describe, expect, it, vi } from "vitest";
import { buildDsn, installSentry } from "../../integrations/sentry.js";

describe("buildDsn", () => {
  it("uses https for production hosts", () => {
    expect(buildDsn("api-key", "ch-uuid", "api.axonpush.xyz")).toBe(
      "https://api-key@api.axonpush.xyz/ch-uuid",
    );
  });

  it("uses http for localhost", () => {
    expect(buildDsn("api-key", "ch-uuid", "localhost:3000")).toBe(
      "http://api-key@localhost:3000/ch-uuid",
    );
  });

  it("coerces a numeric channelId with a deprecation warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dsn = buildDsn("api-key", 42, "api.axonpush.xyz");
    expect(dsn).toBe("https://api-key@api.axonpush.xyz/42");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("installSentry", () => {
  it("forwards a built dsn to sentry.init", () => {
    const sentry = { init: vi.fn() };
    installSentry(sentry, {
      apiKey: "ak",
      channelId: "ch-uuid",
      host: "api.axonpush.xyz",
      environment: "test",
      release: "v1",
    });
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const opts = sentry.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.dsn).toBe("https://ak@api.axonpush.xyz/ch-uuid");
    expect(opts.environment).toBe("test");
    expect(opts.release).toBe("v1");
  });

  it("throws when neither dsn nor apiKey+channelId are supplied", () => {
    const sentry = { init: vi.fn() };
    const oldKey = process.env.AXONPUSH_API_KEY;
    const oldCh = process.env.AXONPUSH_CHANNEL_ID;
    delete process.env.AXONPUSH_API_KEY;
    delete process.env.AXONPUSH_CHANNEL_ID;
    try {
      expect(() => installSentry(sentry)).toThrow(/installSentry/);
    } finally {
      if (oldKey) process.env.AXONPUSH_API_KEY = oldKey;
      if (oldCh) process.env.AXONPUSH_CHANNEL_ID = oldCh;
    }
  });

  it("respects an explicit dsn override", () => {
    const sentry = { init: vi.fn() };
    installSentry(sentry, { dsn: "https://x@host/9" });
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect((sentry.init.mock.calls[0]?.[0] as Record<string, unknown>).dsn).toBe(
      "https://x@host/9",
    );
  });
});
