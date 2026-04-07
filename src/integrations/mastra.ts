import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import type { TraceContext } from "../tracing.js";
import { type IntegrationConfig, initTrace, safePublish, truncate } from "./_base.js";

export class AxonPushMastraHooks {
  private client: AxonPush;
  private channelId: number;
  private agentId: string;
  private trace: TraceContext;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
    this.agentId = config.agentId ?? "mastra";
    this.trace = initTrace(config.traceId);
  }

  private emit(identifier: string, eventType: EventType, payload: Record<string, unknown>) {
    safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: this.agentId,
      trace: this.trace,
      metadata: { framework: "mastra" },
    });
  }

  beforeToolUse(toolName: string, input?: unknown): void {
    this.emit(`tool.${toolName}.start`, "agent.tool_call.start", {
      tool_name: toolName,
      input: truncate(input, 500),
    });
  }

  afterToolUse(toolName: string, output?: unknown): void {
    this.emit(`tool.${toolName}.end`, "agent.tool_call.end", {
      tool_name: toolName,
      output: truncate(output, 500),
    });
  }

  onWorkflowStart(workflowName: string, input?: unknown): void {
    this.emit("workflow.start", "agent.start", {
      workflow_name: workflowName,
      input: truncate(input, 500),
    });
  }

  onWorkflowEnd(workflowName: string, output?: unknown): void {
    this.emit("workflow.end", "agent.end", {
      workflow_name: workflowName,
      output: truncate(output, 500),
    });
  }

  onWorkflowError(workflowName: string, error: Error): void {
    this.emit("workflow.error", "agent.error", {
      workflow_name: workflowName,
      error: error.message,
      error_type: error.name,
    });
  }
}
