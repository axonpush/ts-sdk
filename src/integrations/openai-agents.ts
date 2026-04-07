import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import type { TraceContext } from "../tracing.js";
import { type IntegrationConfig, initTrace, safePublish } from "./_base.js";

export class AxonPushRunHooks {
  private client: AxonPush;
  private channelId: number;
  private defaultAgentId: string;
  private trace: TraceContext;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
    this.defaultAgentId = config.agentId ?? "openai-agent";
    this.trace = initTrace(config.traceId);
  }

  private emit(
    identifier: string,
    eventType: EventType,
    payload: Record<string, unknown>,
    agentId?: string,
  ) {
    safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: agentId ?? this.defaultAgentId,
      trace: this.trace,
      metadata: { framework: "openai-agents" },
    });
  }

  async onAgentStart(_context: unknown, agent: any): Promise<void> {
    const name = agent?.name ?? this.defaultAgentId;
    this.emit("agent.run.start", "agent.start", { agent_name: name, model: agent?.model }, name);
  }

  async onAgentEnd(_context: unknown, agent: any, output: string): Promise<void> {
    const name = agent?.name ?? this.defaultAgentId;
    this.emit(
      "agent.run.end",
      "agent.end",
      { agent_name: name, output_length: output?.length ?? 0 },
      name,
    );
  }

  async onToolStart(_context: unknown, agent: any, tool: any): Promise<void> {
    const agentName = agent?.name ?? "openai-agent";
    const toolName = tool?.name ?? "unknown";
    this.emit(
      `tool.${toolName}.start`,
      "agent.tool_call.start",
      { tool_name: toolName, agent_name: agentName },
      agentName,
    );
  }

  async onToolEnd(_context: unknown, agent: any, tool: any, result: string): Promise<void> {
    const agentName = agent?.name ?? "openai-agent";
    const toolName = tool?.name ?? "unknown";
    this.emit(
      `tool.${toolName}.end`,
      "agent.tool_call.end",
      { tool_name: toolName, result_length: result?.length ?? 0 },
      agentName,
    );
  }

  async onHandoff(_context: unknown, fromAgent: any, toAgent: any): Promise<void> {
    const fromName = fromAgent?.name ?? "openai-agent";
    const toName = toAgent?.name ?? "openai-agent";
    this.emit(
      "agent.handoff",
      "agent.handoff",
      { from_agent: fromName, to_agent: toName },
      fromName,
    );
  }
}
