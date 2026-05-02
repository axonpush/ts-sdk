/**
 * 09 — Sentry installer
 *
 * `installSentry(Sentry, opts)` builds a DSN of the shape
 *   <scheme>://<apiKey>@<host>/<channelId>
 * and forwards it to `Sentry.init`. Any extra fields on the options bag
 * are passed through (e.g. `tracesSampleRate`).
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_CHANNEL_ID
 *
 * Optional peer dep:
 *   bun add @sentry/node
 *
 * Run:
 *   bun run examples/09-sentry.ts
 */

import { buildSentryDsn, installSentry, type SentryLike } from "../src/index";
import { CHANNEL_ID, requireEnv, tryImport } from "./config";

async function main() {
  const apiKey = requireEnv("AXONPUSH_API_KEY");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const dsn = buildSentryDsn(apiKey, CHANNEL_ID, "api.axonpush.xyz");
  console.log("derived DSN:", dsn.replace(apiKey, "<api-key>"));

  type SentryNodeMod = SentryLike & {
    captureException: (err: unknown) => string;
    flush: (timeoutMs?: number) => Promise<boolean>;
  };
  const sentryMod = await tryImport<{ default?: SentryNodeMod } & Partial<SentryNodeMod>>(
    "@sentry/node",
  );
  const sentry = (sentryMod?.default ?? sentryMod) as SentryNodeMod | undefined;

  if (!sentry?.init) {
    console.log("@sentry/node not installed — DSN was built but no init was performed.");
    return;
  }

  installSentry(sentry, {
    apiKey,
    channelId: CHANNEL_ID,
    environment: process.env.AXONPUSH_ENVIRONMENT ?? "development",
    release: "examples@0.0.5",
    tracesSampleRate: 1.0,
  });

  try {
    throw new Error("synthetic error from examples/09-sentry");
  } catch (err) {
    const id = sentry.captureException(err);
    console.log("captured exception, event id:", id);
  }

  await sentry.flush(2000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
