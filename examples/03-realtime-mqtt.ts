/**
 * 03 — Realtime MQTT subscribe + publish
 *
 * Opens a single realtime connection, subscribes to a channel, and runs
 * an "agent loop" that publishes 5 events. The subscriber prints each
 * event as it arrives and disconnects gracefully when the loop is done.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Run:
 *   bun run examples/03-realtime-mqtt.ts
 */

import { AxonPush, RealtimeClient } from "../src/index";
import { CHANNEL_ID, ENVIRONMENT, requireEnv } from "./config";

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const client = new AxonPush();
  const realtime = (await client.connectRealtime({ environment: ENVIRONMENT })) as RealtimeClient;
  await realtime.connect();
  console.log("realtime connected");

  let received = 0;
  await realtime.subscribe({ channelId: CHANNEL_ID }, async (event) => {
    received += 1;
    console.log(`<- ${event.identifier} payload=${JSON.stringify(event.payload)}`);
  });

  for (let i = 0; i < 5; i++) {
    await client.events.publish({
      identifier: `loop-${i}-${Date.now()}`,
      channelId: CHANNEL_ID,
      agentId: "agent-loop",
      eventType: "custom",
      payload: { step: i, ts: new Date().toISOString() },
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  await new Promise((r) => setTimeout(r, 1500));
  console.log(`received ${received} events; disconnecting`);
  await realtime.disconnect();
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
