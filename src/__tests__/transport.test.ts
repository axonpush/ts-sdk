import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { healthControllerCheck } from "../_internal/api";
import { invokeSync, setSettings } from "../_internal/transport";
import { resolveSettings } from "../config";
import { APIConnectionError, AuthenticationError, ServerError, ValidationError } from "../errors";
import { setCurrentTrace, TraceContext } from "../tracing";

const BASE = "http://transport-test.local";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(async () => {
  await setSettings(
    resolveSettings({
      apiKey: "test-key",
      tenantId: "tenant-1",
      baseUrl: BASE,
      environment: "production",
      failOpen: false,
      maxRetries: 0,
    }),
  );
});

describe("transport interceptors", () => {
  it("attaches X-API-Key, x-tenant-id, X-Axonpush-Environment headers", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({ status: "ok" });
      }),
    );

    const result = await invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 });

    expect(result).toBeDefined();
    expect(captured?.get("x-api-key")).toBe("test-key");
    expect(captured?.get("x-tenant-id")).toBe("tenant-1");
    expect(captured?.get("x-axonpush-environment")).toBe("production");
  });

  it("attaches X-Axonpush-Trace-Id when a trace context is bound", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({ status: "ok" });
      }),
    );

    const ctx = new TraceContext("11111111-2222-3333-4444-555555555555");
    setCurrentTrace(ctx);
    await invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 });

    expect(captured?.get("x-axonpush-trace-id")).toBe("11111111-2222-3333-4444-555555555555");
    expect(captured?.get("x-axonpush-span-id")).toBeTruthy();
  });

  it("maps 401 to AuthenticationError with envelope fields", async () => {
    server.use(
      http.get(`${BASE}/health`, () =>
        HttpResponse.json(
          { code: "AUTH_FAILED", message: "bad key", hint: "rotate", requestId: "rq-1" },
          { status: 401 },
        ),
      ),
    );

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 }),
    ).rejects.toMatchObject({
      name: "AuthenticationError",
      statusCode: 401,
      code: "AUTH_FAILED",
      hint: "rotate",
      requestId: "rq-1",
    });
  });

  it("maps 429 to RateLimitError carrying retryAfter from header", async () => {
    server.use(
      http.get(`${BASE}/health`, () =>
        HttpResponse.json(
          { message: "slow down" },
          { status: 429, headers: { "Retry-After": "7" } },
        ),
      ),
    );

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 }),
    ).rejects.toMatchObject({ name: "RateLimitError", statusCode: 429, retryAfter: 7 });
  });

  it("maps 503 to ServerError", async () => {
    server.use(
      http.get(`${BASE}/health`, () => HttpResponse.json({ message: "upstream" }, { status: 503 })),
    );

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 }),
    ).rejects.toMatchObject({ name: "ServerError", statusCode: 503 });
  });

  it("maps 422 to ValidationError", async () => {
    server.use(
      http.get(`${BASE}/health`, () =>
        HttpResponse.json({ message: "bad input" }, { status: 422 }),
      ),
    );

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("retries retryable errors, then succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls++;
        if (calls < 3) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ status: "ok" });
      }),
    );

    const t0 = Date.now();
    const result = await invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 3 });
    const elapsed = Date.now() - t0;

    expect(result).toBeDefined();
    expect(calls).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(250 + 500 - 50);
  }, 15_000);

  it("retries APIConnectionError and exhausts attempts", async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.error()));

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(APIConnectionError);
  }, 10_000);

  it("returns null when failOpen is true and APIConnectionError is final", async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.error()));

    const result = await invokeSync(healthControllerCheck, {}, { failOpen: true, maxRetries: 0 });

    expect(result).toBeNull();
  }, 10_000);

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls++;
        return HttpResponse.json({ message: "bad" }, { status: 401 });
      }),
    );

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 5 }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(calls).toBe(1);
  });

  it("throws ServerError for 500 with no JSON body", async () => {
    server.use(http.get(`${BASE}/health`, () => new HttpResponse("internal", { status: 500 })));

    await expect(
      invokeSync(healthControllerCheck, {}, { failOpen: false, maxRetries: 0 }),
    ).rejects.toBeInstanceOf(ServerError);
  });
});
