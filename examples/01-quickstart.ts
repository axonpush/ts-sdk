/**
 * 01 — Quickstart
 *
 * Construct the client purely from `AXONPUSH_*` env vars and publish a
 * single event. The response includes the persisted event id you can use
 * to navigate to the trace in the AxonPush UI.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY
 *   AXONPUSH_TENANT_ID
 *   AXONPUSH_CHANNEL_ID
 *
 * Optional:
 *   AXONPUSH_BASE_URL       (default http://localhost:3000)
 *   AXONPUSH_ENVIRONMENT
 *
 * Run:
 *   bun run examples/01-quickstart.ts
 */

import { AxonPush } from "../src/index";
import { CHANNEL_ID, requireEnv } from "./config";

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) {
    throw new Error("Set AXONPUSH_CHANNEL_ID to the UUID of a channel you can publish to.");
  }

  const client = new AxonPush();
  const event = await client.events.publish({
    identifier: `quickstart-${Date.now()}`,
    channelId: CHANNEL_ID,
    eventType: "custom",
    payload: { hello: "world", source: "examples/01-quickstart" },
  });

  console.log("published event:", event);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
