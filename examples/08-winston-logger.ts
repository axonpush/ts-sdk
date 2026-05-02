/**
 * 08 — Winston transport
 *
 * Attaches the AxonPush winston transport to a logger and ships a few
 * records through it. Each record becomes an `app.log` event with an
 * OTel-shaped payload (`severityNumber`, `severityText`, `body`,
 * `attributes`). Winston levels are mapped automatically.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Optional peer deps:
 *   bun add winston winston-transport
 *
 * Run:
 *   bun run examples/08-winston-logger.ts
 */

import { AxonPush, createAxonPushWinstonTransport } from "../src/index";
import { CHANNEL_ID, requireEnv, tryImport } from "./config";

interface WinstonLikeModule {
  default?: {
    createLogger: (opts: Record<string, unknown>) => {
      info: (msg: string, meta?: Record<string, unknown>) => void;
      warn: (msg: string, meta?: Record<string, unknown>) => void;
      error: (msg: string, meta?: Record<string, unknown>) => void;
      close?: () => void;
    };
    transports: { Console: new () => unknown };
  };
}

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const client = new AxonPush();

  const winstonMod = await tryImport<WinstonLikeModule>("winston");
  if (!winstonMod?.default) {
    console.log("winston is not installed; install it with: bun add winston winston-transport");
    client.close();
    return;
  }
  const winston = winstonMod.default;

  const transport = (await createAxonPushWinstonTransport({
    client,
    channelId: CHANNEL_ID,
    serviceName: "examples-winston",
    serviceVersion: "0.0.5",
  })) as unknown;

  const logger = winston.createLogger({
    level: "debug",
    transports: [new winston.transports.Console(), transport as never],
  });

  logger.info("api booted", { port: 3000 });
  logger.warn("retrying upstream", { attempt: 2, host: "db.local" });
  logger.error("upstream timeout", { code: "ETIMEDOUT", durationMs: 1500 });

  await new Promise((r) => setTimeout(r, 750));
  (transport as { flushAxonPush?: (ms?: number) => Promise<void> }).flushAxonPush?.(2000);
  logger.close?.();
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
