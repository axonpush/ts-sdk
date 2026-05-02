/**
 * 07 — LangChain.js callback handler
 *
 * Wires `AxonPushCallbackHandler` into a LangChain runtree. To keep the
 * example dependency-light we don't drive a real LLM: we instantiate the
 * handler and synthesise a couple of LangChain-style lifecycle calls so
 * you can see the matching events arrive in the AxonPush UI.
 *
 * Required env vars:
 *   AXONPUSH_API_KEY, AXONPUSH_TENANT_ID, AXONPUSH_CHANNEL_ID
 *
 * Optional peer dep (real flows):
 *   bun add @langchain/core
 *
 * Run:
 *   bun run examples/07-langchain.ts
 */

import { AxonPush, AxonPushCallbackHandler } from "../src/index";
import { CHANNEL_ID, requireEnv, tryImport } from "./config";

async function main() {
  requireEnv("AXONPUSH_API_KEY");
  requireEnv("AXONPUSH_TENANT_ID");
  if (!CHANNEL_ID) throw new Error("AXONPUSH_CHANNEL_ID required");

  const client = new AxonPush();
  const handler = new AxonPushCallbackHandler({
    client,
    channelId: CHANNEL_ID,
    agentId: "langchain-demo",
  });

  const langchainCore = await tryImport<unknown>("@langchain/core/runnables");
  if (langchainCore) {
    console.log("@langchain/core detected; you can pass `callbacks: [handler]` to any runnable.");
  } else {
    console.log("@langchain/core not installed — running a synthetic lifecycle instead.");
  }

  const runId = crypto.randomUUID();
  handler.handleChainStart(
    { name: "demo-chain" },
    { question: "what's the capital of France?" },
    runId,
  );

  const llmRunId = crypto.randomUUID();
  handler.handleLLMStart({ name: "fake-openai" }, ["what's the capital of France?"], llmRunId, runId);
  handler.handleLLMEnd(
    { generations: [[{ text: "Paris" }]] },
    llmRunId,
    runId,
  );

  handler.handleChainEnd({ answer: "Paris" }, runId);

  await new Promise((r) => setTimeout(r, 500));
  console.log("synthetic chain emitted; check the AxonPush UI for chain.start / llm.* / chain.end");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
