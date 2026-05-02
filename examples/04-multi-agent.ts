/**
 * 04 — Multi-agent fan-out with eventType filtering
 *
 * Three logical agents (`planner`, `coder`, `reviewer`) emit events on
 * one channel. Two subscribers attach: one filters by `eventType` for
 * `agent.error` only, the other listens to everything.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Run:
 *   bun run examples/04-multi-agent.ts
 */

import { AxonPush, RealtimeClient } from "../src/index";
import { CHANNEL_ID, ENVIRONMENT, requireEnv } from "./config";

const AGENTS = ["planner", "coder", "reviewer"] as const;
const TYPES = ["agent.start", "agent.message", "agent.error", "agent.end"] as const;

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const client = new AxonPush();
  const realtime = (await client.connectRealtime({ environment: ENVIRONMENT })) as RealtimeClient;
  await realtime.connect();

  await realtime.subscribe({ channelId: CHANNEL_ID }, (event) => {
    console.log(`[all] ${event.eventType} from ${event.agentId}`);
  });

  await realtime.subscribe({ channelId: CHANNEL_ID, eventType: "agent.error" }, (event) => {
    console.log(`[errors] ${event.identifier}: ${JSON.stringify(event.payload)}`);
  });

  for (let i = 0; i < 12; i++) {
    const agentId = AGENTS[i % AGENTS.length]!;
    const eventType = TYPES[i % TYPES.length]!;
    await client.events.publish({
      identifier: `${agentId}-${i}`,
      channelId: CHANNEL_ID,
      agentId,
      eventType,
      payload: eventType === "agent.error" ? { reason: "synthetic failure" } : { step: i },
    });
  }

  await new Promise((r) => setTimeout(r, 1500));
  await realtime.disconnect();
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
