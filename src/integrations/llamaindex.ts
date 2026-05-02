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
 * LlamaIndex.TS instrumentation hooks.
 *
 * Wire each method into the corresponding callback in your `Settings`
 * or per-query `Callbacks` object. Each hook emits a single AxonPush
 * event tagged with `framework: "llamaindex"`.
 *
 * Tested against `llamaindex@^0.8`. Install:
 *   npm install llamaindex
 */
export class AxonPushLlamaIndexHandler {
  private client: AxonPush;
  private channelId: string;
  private agentId: string;
  private trace: TraceContext;

  constructor(config: IntegrationConfig) {
    this.client = config.client;
    this.channelId = coerceChannelId(config.channelId);
    this.agentId = config.agentId ?? "llamaindex";
    this.trace = initTrace(config.traceId);
  }

  private emit(identifier: string, eventType: EventType, payload: Record<string, unknown>): void {
    void safePublish(this.client, this.channelId, identifier, eventType, payload, {
      agentId: this.agentId,
      trace: this.trace,
      metadata: { framework: "llamaindex" },
    });
  }

  onLLMStart(model?: string, promptCount?: number): void {
    this.emit("llm.start", "agent.start", {
      model: model ?? "unknown",
      prompt_count: promptCount ?? 0,
    });
  }

  onLLMEnd(output?: unknown): void {
    this.emit("llm.end", "agent.end", { output: truncate(output, 500) });
  }

  onLLMStream(token: string): void {
    this.emit("llm.token", "agent.llm.token", { token });
  }

  onEmbeddingStart(model?: string, textCount?: number): void {
    this.emit("embedding.start", "agent.tool_call.start", {
      model: model ?? "unknown",
      text_count: textCount ?? 0,
    });
  }

  onEmbeddingEnd(embeddingCount?: number): void {
    this.emit("embedding.end", "agent.tool_call.end", {
      embedding_count: embeddingCount ?? 0,
    });
  }

  onRetrieverStart(query: string): void {
    this.emit("retriever.query", "agent.tool_call.start", {
      query: query.slice(0, 500),
    });
  }

  onRetrieverEnd(nodeCount?: number): void {
    this.emit("retriever.result", "agent.tool_call.end", {
      node_count: nodeCount ?? 0,
    });
  }

  onQueryStart(query: string): void {
    this.emit("query.start", "agent.start", {
      query: query.slice(0, 500),
    });
  }

  onQueryEnd(response?: unknown): void {
    this.emit("query.end", "agent.end", {
      response: truncate(response, 500),
    });
  }
}
