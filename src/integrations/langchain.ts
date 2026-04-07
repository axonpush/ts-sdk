import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import type { TraceContext } from "../tracing.js";
import { type IntegrationConfig, initTrace, safePublish, truncate } from "./_base.js";

export class AxonPushCallbackHandler {
  name = "AxonPushCallbackHandler";

  private client: AxonPush;
  private channelId: number;
  private agentId: string;
  private trace: TraceContext;
  private baseMeta: Record<string, unknown>;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
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
  ) {
    const meta = { ...this.baseMeta } as Record<string, unknown>;
    if (runId) meta.langchain_run_id = runId;
    if (parentRunId) meta.langchain_parent_run_id = parentRunId;

    safePublish(this.client, this.channelId, identifier, eventType, payload, {
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
  ) {
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

  handleChainEnd(outputs: Record<string, unknown>, runId?: string, parentRunId?: string) {
    this.emit("chain.end", "agent.end", { outputs: truncate(outputs) }, runId, parentRunId);
  }

  handleChainError(err: Error, runId?: string, parentRunId?: string) {
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
  ) {
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

  handleLLMEnd(output: { generations?: any[] }, runId?: string, parentRunId?: string) {
    this.emit(
      "llm.end",
      "agent.end",
      { generations: output.generations?.length ?? 0 },
      runId,
      parentRunId,
    );
  }

  handleLLMNewToken(token: string, _idx?: any, runId?: string, parentRunId?: string) {
    this.emit("llm.token", "agent.llm.token", { token }, runId, parentRunId);
  }

  handleToolStart(
    serialized: Record<string, any>,
    input: string,
    runId?: string,
    parentRunId?: string,
  ) {
    const toolName = serialized?.name ?? "unknown";
    this.emit(
      `tool.${toolName}.start`,
      "agent.tool_call.start",
      { tool_name: toolName, input: String(input).slice(0, 2000) },
      runId,
      parentRunId,
    );
  }

  handleToolEnd(output: string, runId?: string, parentRunId?: string) {
    this.emit("tool.end", "agent.tool_call.end", { output: truncate(output) }, runId, parentRunId);
  }

  handleToolError(err: Error, runId?: string, parentRunId?: string) {
    this.emit(
      "tool.error",
      "agent.error",
      { error: err.message, error_type: err.name },
      runId,
      parentRunId,
    );
  }

  handleLLMError(err: Error, runId?: string, parentRunId?: string) {
    this.emit(
      "llm.error",
      "agent.error",
      { error: err.message, error_type: err.name },
      runId,
      parentRunId,
    );
  }
}
