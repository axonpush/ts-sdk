/**
 * 02 — Agent tracing with parent/child spans
 *
 * Demonstrates manual trace propagation: a single trace id is shared
 * across three events, and `parentEventId` stitches them into a tree
 * (planner -> tool call -> reply).
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Run:
 *   bun run examples/02-agent-tracing.ts
 */

import { AxonPush, getOrCreateTrace } from "../src/index";
import { CHANNEL_ID, requireEnv } from "./config";

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const client = new AxonPush();
  const trace = getOrCreateTrace();
  console.log("traceId:", trace.traceId);

  const planner = await client.events.publish({
    identifier: `plan-${Date.now()}`,
    channelId: CHANNEL_ID,
    agentId: "planner",
    traceId: trace.traceId,
    eventType: "agent.start",
    payload: { goal: "answer the user's question about TypeScript generics" },
  });
  const planEventId = planner?.eventId;

  const tool = await client.events.publish({
    identifier: `tool-${Date.now()}`,
    channelId: CHANNEL_ID,
    agentId: "search-tool",
    traceId: trace.traceId,
    parentEventId: planEventId,
    eventType: "agent.tool_call.start",
    payload: { tool: "web_search", query: "typescript generic constraints" },
  });
  const toolEventId = tool?.eventId;

  await client.events.publish({
    identifier: `reply-${Date.now()}`,
    channelId: CHANNEL_ID,
    agentId: "planner",
    traceId: trace.traceId,
    parentEventId: toolEventId,
    eventType: "agent.end",
    payload: {
      summary: "explained extends constraint with example",
      tokensUsed: 482,
    },
  });

  console.log("published 3 linked events under trace", trace.traceId);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
