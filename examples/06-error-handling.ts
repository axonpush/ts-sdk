/**
 * 06 — Exception hierarchy in practice
 *
 * Demonstrates each branch of `AxonPushError`:
 *   - `AuthenticationError` from a deliberately bad API key
 *   - `NotFoundError` from `apps.get(<bogus-uuid>)`
 *   - `RateLimitError` -> back off via `err.retryAfter`
 *   - `RetryableError` mixin -> blanket retry
 *
 * The 429 path is illustrative — comment-driven, since most local
 * backends won't actually rate-limit you. The first two paths run live.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID
 *
 * Run:
 *   bun run examples/06-error-handling.ts
 */

import {
  APIConnectionError,
  AuthenticationError,
  AxonPush,
  NotFoundError,
  RateLimitError,
  RetryableError,
  ValidationError,
} from "../src/index";
import { requireEnv } from "./config";

async function main() {
  requireEnv("AXONPUSH_TENANT_ID");

  // --- 401: bad API key ---
  const badAuthClient = new AxonPush({
    apiKey: "ax_definitely_invalid_key",
    failOpen: false,
    maxRetries: 0,
  });
  try {
    await badAuthClient.apps.list();
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.log(`[auth] caught AuthenticationError code=${err.code} hint=${err.hint ?? "<none>"}`);
    } else {
      console.log("[auth] unexpected:", err);
    }
  }
  badAuthClient.close();

  // --- 404: real key, fake id ---
  requireEnv("AXONPUSH_API_KEY");
  const client = new AxonPush({ failOpen: false, maxRetries: 0 });
  const bogusId = "00000000-0000-0000-0000-000000000000";
  try {
    await client.apps.get(bogusId);
  } catch (err) {
    if (err instanceof NotFoundError) {
      console.log(`[404] caught NotFoundError for app ${bogusId}; requestId=${err.requestId ?? "<none>"}`);
    } else if (err instanceof ValidationError) {
      console.log("[404] backend rejected the id format:", err.message);
    } else {
      console.log("[404] unexpected:", err);
    }
  }

  // --- blanket retry sketch ---
  async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof RateLimitError) {
          const waitMs = (err.retryAfter ?? 1) * 1000;
          console.log(`[retry] rate limited; sleeping ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (err instanceof RetryableError || err instanceof APIConnectionError) {
          await new Promise((r) => setTimeout(r, 2 ** i * 250));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  const apps = await withRetry(() => client.apps.list());
  console.log(`[retry] apps.list returned ${apps?.length ?? 0} app(s)`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
