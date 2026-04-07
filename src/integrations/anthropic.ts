import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import type { TraceContext } from "../tracing.js";
import { type IntegrationConfig, initTrace, safePublish, truncate } from "./_base.js";

export class AxonPushAnthropicTracer {
  private client: AxonPush;
  private channelId: number;
  private agentId: string;
  private trace: TraceContext;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = config.channelId;
    this.agentId = config.agentId ?? "claude";
    this.trace = initTrace(config.traceId);
  }

  private emit(identifier: string, eventType: EventType, payload: Record<string, unknown>) {
    safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: this.agentId,
      trace: this.trace,
      metadata: { framework: "anthropic" },
    });
  }

  async createMessage(anthropicClient: any, params: Record<string, any>): Promise<any> {
    this.emit("conversation.turn", "agent.start", {
      model: params.model,
      message_count: params.messages?.length ?? 0,
    });

    const response = await anthropicClient.messages.create(params);
    this.processResponse(response);
    return response;
  }

  sendToolResult(toolUseId: string, result: unknown): void {
    this.emit("tool.result", "agent.tool_call.end", {
      tool_use_id: toolUseId,
      result_preview: String(result).slice(0, 500),
    });
  }

  private processResponse(response: any): void {
    for (const block of response?.content ?? []) {
      if (block.type === "tool_use") {
        this.emit(`tool.${block.name}.start`, "agent.tool_call.start", {
          tool_name: block.name,
          tool_use_id: block.id,
          input: truncate(block.input, 500),
        });
      } else if (block.type === "text") {
        this.emit("agent.response", "agent.message", {
          text_length: block.text?.length ?? 0,
        });
      }
    }
  }
}
