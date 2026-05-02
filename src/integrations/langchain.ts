import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import type { TraceContext } from "../tracing.js";
import {
  coerceChannelId,
  type IntegrationConfig,
  initTrace,
  safePublish,
  truncate,
} from "./_base.js";

/**
 * LangChain.js callback handler.
 *
 * Subclasses LangChain's loose callback interface — register an
 * instance via `runManager.callbacks.push(handler)` or supply through
 * the `callbacks` option on a chain/LLM constructor.
 *
 * The handler maps LangChain's `runId` / `parentRunId` to AxonPush
 * trace metadata so that traces stitched across LangChain's own runtree
 * remain navigable in the AxonPush UI.
 *
 * Tested against `langchain@^0.3` / `@langchain/core@^0.3`. Install:
 *   npm install @langchain/core
 */
export class AxonPushCallbackHandler {
  name = "AxonPushCallbackHandler";

  private client: AxonPush;
  private channelId: string;
  private agentId: string;
  private trace: TraceContext;
  private baseMeta: Record<string, unknown>;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = coerceChannelId(config.channelId);
    this.agentId = config.agentId ?? "langchain";
    this.trace = initTrace(config.traceId);
    this.baseMeta = { framework: "langchain" };
  }

  private emit(
    identifier: string,
    eventType: EventType,
    payload: Record<string, unknown>,
    runId?: string,
    parentRunId?: string,
  ): void {
    const meta = { ...this.baseMeta } as Record<string, unknown>;
    if (runId) meta.langchain_run_id = runId;
    if (parentRunId) meta.langchain_parent_run_id = parentRunId;

    void safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: this.agentId,
      trace: this.trace,
      metadata: meta,
    });
  }

  handleChainStart(
    serialized: Record<string, any>,
    inputs: Record<string, unknown>,
    runId?: string,
    parentRunId?: string,
  ): void {
    this.emit(
      "chain.start",
      "agent.start",
      {
        chain_type: serialized?.name ?? "unknown",
        inputs: truncate(inputs),
      },
      runId,
      parentRunId,
    );
  }

  handleChainEnd(outputs: Record<string, unknown>, runId?: string, parentRunId?: string): void {
    this.emit("chain.end", "agent.end", { outputs: truncate(outputs) }, runId, parentRunId);
  }

  handleChainError(err: Error, runId?: string, parentRunId?: string): void {
    this.emit(
      "chain.error",
      "agent.error",
      { error: err.message, error_type: err.name },
      runId,
      parentRunId,
    );
  }

  handleLLMStart(
    serialized: Record<string, any>,
    prompts: string[],
    runId?: string,
    parentRunId?: string,
  ): void {
    this.emit(
      "llm.start",
      "agent.start",
      {
        model: serialized?.name ?? "unknown",
        prompt_count: prompts.length,
      },
      runId,
      parentRunId,
    );
  }

  handleLLMEnd(output: { generations?: any[] }, runId?: string, parentRunId?: string): void {
    this.emit(
      "llm.end",
      "agent.end",
      { generations: output.generations?.length ?? 0 },
      runId,
      parentRunId,
    );
  }

  handleLLMNewToken(token: string, _idx?: any, runId?: string, parentRunId?: string): void {
    this.emit("llm.token", "agent.llm.token", { token }, runId, parentRunId);
  }

  handleToolStart(
    serialized: Record<string, any>,
    input: string,
    runId?: string,
    parentRunId?: string,
  ): void {
    const toolName = serialized?.name ?? "unknown";
    this.emit(
      `tool.${toolName}.start`,
      "agent.tool_call.start",
      { tool_name: toolName, input: String(input).slice(0, 2000) },
      runId,
      parentRunId,
    );
  }

  handleToolEnd(output: string, runId?: string, parentRunId?: string): void {
    this.emit("tool.end", "agent.tool_call.end", { output: truncate(output) }, runId, parentRunId);
  }

  handleToolError(err: Error, runId?: string, parentRunId?: string): void {
    this.emit(
      "tool.error",
      "agent.error",
      { error: err.message, error_type: err.name },
      runId,
      parentRunId,
    );
  }

  handleLLMError(err: Error, runId?: string, parentRunId?: string): void {
    this.emit(
      "llm.error",
      "agent.error",
      { error: err.message, error_type: err.name },
      runId,
      parentRunId,
    );
  }
}
