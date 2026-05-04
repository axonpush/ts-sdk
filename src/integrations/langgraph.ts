import type { AxonPush } from "../client.js";
import type { TraceContext } from "../tracing.js";
import {
  coerceChannelId,
  type IntegrationConfig,
  initTrace,
  safePublish,
  truncate,
} from "./_base.js";
import { AxonPushCallbackHandler } from "./langchain.js";

/**
 * LangGraph callback handler.
 *
 * Extends {@link AxonPushCallbackHandler} with two extra events
 * (`graph.node.start` / `graph.node.end`) that record the per-node
 * traversal of a `StateGraph`. The callback uses LangChain's run-tree
 * `runId`/`parentRunId` for trace stitching.
 *
 * Tested against `@langchain/langgraph@^0.4` (which still consumes
 * LangChain.js's callback interface).
 */
export class AxonPushLangGraphHandler extends AxonPushCallbackHandler {
  private _client: AxonPush;
  private _channelId: string;
  private _agentId: string;
  private _trace: TraceContext;

  constructor(config: IntegrationConfig) {
    super({ ...config, agentId: config.agentId ?? "langgraph" });
    this._client = config.client;
    this._channelId = coerceChannelId(config.channelId);
    this._agentId = config.agentId ?? "langgraph";
    this._trace = initTrace(config.traceId);
  }

  override handleChainStart(
    serialized: Record<string, any>,
    inputs: Record<string, unknown>,
    runId?: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string,
  ): void {
    super.handleChainStart(
      serialized,
      inputs,
      runId,
      parentRunId,
      tags,
      metadata,
      runType,
      runName,
    );

    const nodeName =
      runName ||
      (typeof metadata?.langgraph_node === "string" ? (metadata.langgraph_node as string) : "") ||
      serialized?.name;
    if (nodeName) {
      void safePublish(
        this._client,
        this._channelId,
        "graph.node.start",
        "agent.start",
        { node_name: nodeName, inputs: truncate(inputs) },
        {
          agentId: this._agentId,
          trace: this._trace,
          metadata: {
            framework: "langgraph",
            node: nodeName,
            ...(runId ? { langchain_run_id: runId } : {}),
            ...(parentRunId ? { langchain_parent_run_id: parentRunId } : {}),
          },
        },
      );
    }
  }

  override handleChainEnd(
    outputs: Record<string, unknown>,
    runId?: string,
    parentRunId?: string,
  ): void {
    super.handleChainEnd(outputs, runId, parentRunId);

    void safePublish(
      this._client,
      this._channelId,
      "graph.node.end",
      "agent.end",
      { outputs: truncate(outputs) },
      {
        agentId: this._agentId,
        trace: this._trace,
        metadata: {
          framework: "langgraph",
          ...(runId ? { langchain_run_id: runId } : {}),
          ...(parentRunId ? { langchain_parent_run_id: parentRunId } : {}),
        },
      },
    );
  }
}
