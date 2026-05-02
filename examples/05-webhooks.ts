/**
 * 05 — Webhook endpoints + delivery history
 *
 * Creates a webhook endpoint pointed at a public URL, lists all
 * endpoints on the channel, then prints recent delivery attempts.
 *
 * For local development with a tunnel like ngrok:
 *   ngrok http 3001
 * Use the resulting public HTTPS URL as `WEBHOOK_URL`.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *   WEBHOOK_URL                  - public HTTPS endpoint that AxonPush can POST to
 *
 * Run:
 *   bun run examples/05-webhooks.ts
 */

import { AxonPush } from "../src/index";
import { CHANNEL_ID, requireEnv } from "./config";

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const webhookUrl = requireEnv("WEBHOOK_URL");
  const client = new AxonPush();

  const created = await client.webhooks.createEndpoint({
    url: webhookUrl,
    channelId: CHANNEL_ID,
    description: "examples/05-webhooks",
    eventTypes: ["custom", "agent.end"],
  });
  if (!created) throw new Error("createEndpoint returned null");
  console.log("created endpoint", created.endpointId);
  console.log("signing secret (store now, only shown once):", created.rawSecret ?? "<none>");

  const endpoints = await client.webhooks.listEndpoints(CHANNEL_ID);
  console.log(`channel has ${endpoints?.length ?? 0} endpoints`);

  await client.events.publish({
    identifier: `webhook-trigger-${Date.now()}`,
    channelId: CHANNEL_ID,
    eventType: "agent.end",
    payload: { result: "ok" },
  });

  await new Promise((r) => setTimeout(r, 2000));

  const deliveries = await client.webhooks.deliveries(created.endpointId);
  console.log(`found ${deliveries?.length ?? 0} delivery attempts`);
  for (const d of deliveries ?? []) {
    console.log(`  - status=${(d as { status?: string }).status} eventId=${(d as { eventId?: string }).eventId}`);
  }

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
