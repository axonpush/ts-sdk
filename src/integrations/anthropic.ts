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
 * Anthropic SDK tracer.
 *
 * Wraps `messages.create()` calls and emits AxonPush events for the
 * conversation turn, the model's text/tool_use response blocks, and any
 * tool results the caller forwards via {@link sendToolResult}.
 *
 * Tested against `@anthropic-ai/sdk@^0.30` and the Messages API
 * streaming surface (`messages.stream({...})`).
 *
 * Install:
 *   npm install @anthropic-ai/sdk
 */

export class AxonPushAnthropicTracer {
  private client: AxonPush;
  private channelId: string;
  private agentId: string;
  private trace: TraceContext;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = coerceChannelId(config.channelId);
    this.agentId = config.agentId ?? "claude";
    this.trace = initTrace(config.traceId);
  }

  private emit(identifier: string, eventType: EventType, payload: Record<string, unknown>): void {
    void safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: this.agentId,
      trace: this.trace,
      metadata: { framework: "anthropic" },
    });
  }

  /**
   * Wrap `client.messages.create(...)`. Emits `agent.start` / `agent.end`
   * with token usage and stop reason, plus per-tool-use and per-text
   * blocks from the response.
   */
  async createMessage(anthropicClient: any, params: Record<string, any>): Promise<any> {
    this.emit("conversation.turn", "agent.start", {
      model: params.model,
      message_count: params.messages?.length ?? 0,
    });

    const response = await anthropicClient.messages.create(params);
    this.processResponse(response);
    this.emitFinish(response);
    return response;
  }

  /**
   * Wrap a streaming `messages.stream(...)` call. Tokens are forwarded
   * via the returned async iterator after recording each delta as an
   * `agent.llm.token` event. The final usage / stop_reason is captured
   * from the terminal `message_stop` event.
   */
  async *streamMessage(
    anthropicClient: any,
    params: Record<string, any>,
  ): AsyncGenerator<unknown, void, void> {
    this.emit("conversation.turn", "agent.start", {
      model: params.model,
      message_count: params.messages?.length ?? 0,
      streaming: true,
    });

    const stream = anthropicClient.messages.stream
      ? anthropicClient.messages.stream(params)
      : await anthropicClient.messages.create({ ...params, stream: true });

    let finalMessage: Record<string, unknown> | undefined;
    for await (const event of stream as AsyncIterable<Record<string, any>>) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        this.emit("llm.token", "agent.llm.token", { token: event.delta.text });
      } else if (event.type === "message_delta" && event.usage) {
        finalMessage = {
          stop_reason: event.delta?.stop_reason,
          usage: event.usage,
        };
      } else if (event.type === "message_stop" && event.message) {
        finalMessage = event.message as Record<string, unknown>;
      }
      yield event;
    }

    if (finalMessage) {
      this.emitFinish(finalMessage);
    }
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

  private emitFinish(response: Record<string, unknown>): void {
    const usage = (response.usage ?? {}) as Record<string, unknown>;
    this.emit("conversation.turn.end", "agent.end", {
      stop_reason: response.stop_reason ?? null,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    });
  }
}
