import type { AxonPush } from "../client.js";
import type { TraceContext } from "../tracing.js";
import { type IntegrationConfig, initTrace, safePublish, truncate } from "./_base.js";
import { AxonPushCallbackHandler } from "./langchain.js";

export class AxonPushLangGraphHandler extends AxonPushCallbackHandler {
  private _client: AxonPush;
  private _channelId: number;
  private _agentId: string;
  private _trace: TraceContext;

  constructor(config: IntegrationConfig) {
    super({ ...config, agentId: config.agentId ?? "langgraph" });
    this._client = config.client;
    this._channelId = config.channelId;
    this._agentId = config.agentId ?? "langgraph";
    this._trace = initTrace(config.traceId);
  }

  override handleChainStart(
    serialized: Record<string, any>,
    inputs: Record<string, unknown>,
    runId?: string,
    parentRunId?: string,
  ) {
    super.handleChainStart(serialized, inputs, runId, parentRunId);

    const nodeName = serialized?.name;
    if (nodeName) {
      safePublish(
        this._client,
        this._channelId,
        "graph.node.start",
        "agent.start",
        { node_name: nodeName, inputs: truncate(inputs) },
        {
          agentId: this._agentId,
          trace: this._trace,
          metadata: { framework: "langgraph", node: nodeName },
        },
      );
    }
  }

  override handleChainEnd(outputs: Record<string, unknown>, runId?: string, parentRunId?: string) {
    super.handleChainEnd(outputs, runId, parentRunId);

    safePublish(
      this._client,
      this._channelId,
      "graph.node.end",
      "agent.end",
      { outputs: truncate(outputs) },
      {
        agentId: this._agentId,
        trace: this._trace,
        metadata: { framework: "langgraph" },
      },
    );
  }
}
