import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedOp } from "../_internal/transport";
import { AxonPush } from "../client";
import { APIConnectionError, AuthenticationError, RateLimitError, ServerError } from "../errors";

const ENV_KEYS = [
  "AXONPUSH_API_KEY",
  "AXONPUSH_TENANT_ID",
  "AXONPUSH_ORG_ID",
  "AXONPUSH_APP_ID",
  "AXONPUSH_BASE_URL",
  "AXONPUSH_ENVIRONMENT",
  "AXONPUSH_TIMEOUT",
  "AXONPUSH_MAX_RETRIES",
  "AXONPUSH_FAIL_OPEN",
];

type Saved = Record<string, string | undefined>;

function snapshotEnv(): Saved {
  const out: Saved = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Saved): void {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function makeOp<T>(impl: () => Promise<T>): GeneratedOp<T> {
  return (async () => {
    const data = await impl();
    return { data, request: new Request("http://x"), response: new Response() };
  }) as GeneratedOp<T>;
}

describe("AxonPush facade", () => {
  let saved: Saved;

  beforeEach(() => {
    saved = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(saved);
    vi.restoreAllMocks();
  });

  it("falls back to defaults when no options or env are present", () => {
    const c = new AxonPush();
    expect(c.settings.baseUrl).toBe("http://localhost:3000");
    expect(c.settings.failOpen).toBe(false);
    expect(c.settings.maxRetries).toBe(3);
    expect(c.settings.timeout).toBe(30_000);
    expect(c.environment).toBeUndefined();
  });

  it("reads AXONPUSH_* env vars when no kwargs supplied", () => {
    process.env.AXONPUSH_API_KEY = "envkey";
    process.env.AXONPUSH_TENANT_ID = "envten";
    process.env.AXONPUSH_BASE_URL = "https://api.example.com";
    process.env.AXONPUSH_ENVIRONMENT = "staging";
    process.env.AXONPUSH_FAIL_OPEN = "true";
    process.env.AXONPUSH_MAX_RETRIES = "5";
    process.env.AXONPUSH_TIMEOUT = "12345";

    const c = new AxonPush();
    expect(c.settings.apiKey).toBe("envkey");
    expect(c.settings.tenantId).toBe("envten");
    expect(c.settings.baseUrl).toBe("https://api.example.com");
    expect(c.environment).toBe("staging");
    expect(c.settings.failOpen).toBe(true);
    expect(c.settings.maxRetries).toBe(5);
    expect(c.settings.timeout).toBe(12345);
  });

  it("kwargs override env vars", () => {
    process.env.AXONPUSH_API_KEY = "envkey";
    process.env.AXONPUSH_BASE_URL = "https://from-env";

    const c = new AxonPush({
      apiKey: "ctorkey",
      baseUrl: "https://from-ctor",
      failOpen: true,
    });

    expect(c.settings.apiKey).toBe("ctorkey");
    expect(c.settings.baseUrl).toBe("https://from-ctor");
    expect(c.settings.failOpen).toBe(true);
  });

  it("invoke returns the unwrapped data field on success", async () => {
    const c = new AxonPush({ apiKey: "k", tenantId: "t" });
    const op = makeOp(async () => ({ id: "evt_1" }));
    const result = await c.invoke(op, {});
    expect(result).toEqual({ id: "evt_1" });
  });

  it("invoke returns null on APIConnectionError when failOpen is true", async () => {
    const c = new AxonPush({ apiKey: "k", tenantId: "t", failOpen: true, maxRetries: 0 });
    const op = makeOp(async () => {
      throw new APIConnectionError("boom");
    });
    const result = await c.invoke(op, {});
    expect(result).toBeNull();
  });

  it("invoke rethrows APIConnectionError when failOpen is false", async () => {
    const c = new AxonPush({ apiKey: "k", tenantId: "t", failOpen: false, maxRetries: 0 });
    const op = makeOp(async () => {
      throw new APIConnectionError("boom");
    });
    await expect(c.invoke(op, {})).rejects.toBeInstanceOf(APIConnectionError);
  });

  it("invoke does not swallow non-connection errors even when failOpen is true", async () => {
    const c = new AxonPush({ apiKey: "k", tenantId: "t", failOpen: true, maxRetries: 0 });
    const op = makeOp(async () => {
      throw new AuthenticationError("nope");
    });
    await expect(c.invoke(op, {})).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("invoke retries retryable errors then succeeds", async () => {
    vi.useFakeTimers();
    const c = new AxonPush({ apiKey: "k", tenantId: "t", maxRetries: 3 });
    let attempts = 0;
    const op = makeOp(async () => {
      attempts++;
      if (attempts < 3) throw new ServerError("upstream");
      return { ok: true };
    });
    const promise = c.invoke(op, {});
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
    vi.useRealTimers();
  });

  it("invoke honours RateLimitError.retryAfter for backoff", async () => {
    vi.useFakeTimers();
    const c = new AxonPush({ apiKey: "k", tenantId: "t", maxRetries: 1 });
    let attempts = 0;
    const op = makeOp(async () => {
      attempts++;
      if (attempts === 1) throw new RateLimitError("slow", { retryAfter: 2 });
      return { ok: true };
    });
    const promise = c.invoke(op, {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });

  it("environment getter mirrors settings.environment", () => {
    const c = new AxonPush({ environment: "prod" });
    expect(c.environment).toBe("prod");
  });

  it("close() is idempotent", () => {
    const c = new AxonPush();
    expect(() => {
      c.close();
      c.close();
    }).not.toThrow();
  });
});
