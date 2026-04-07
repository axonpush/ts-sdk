import type { EventType } from "../index.js";
import { type IntegrationConfig, initTrace, safePublish } from "./_base.js";

interface LanguageModelMiddleware {
  wrapGenerate?: (opts: any) => Promise<any>;
  wrapStream?: (opts: any) => Promise<any>;
}

export function axonPushMiddleware(config: IntegrationConfig): LanguageModelMiddleware {
  const client = config.client;
  const channelId = config.channelId;
  const agentId = config.agentId ?? "vercel-ai";
  const trace = initTrace(config.traceId);

  function emit(identifier: string, eventType: EventType, payload: Record<string, unknown>) {
    safePublish(client, channelId, identifier, eventType, payload, {
      agentId,
      trace,
      metadata: { framework: "vercel-ai" },
    });
  }

  return {
    async wrapGenerate(opts) {
      emit("llm.start", "agent.start", {
        model: opts.model?.modelId,
        prompt_tokens: opts.params?.prompt?.length ?? 0,
      });

      const result = await opts.doGenerate();

      emit("llm.end", "agent.end", {
        model: opts.model?.modelId,
        usage: result.usage,
        finish_reason: result.finishReason,
      });

      return result;
    },

    async wrapStream(opts) {
      emit("llm.start", "agent.start", {
        model: opts.model?.modelId,
        streaming: true,
      });

      const result = await opts.doStream();

      const originalStream = result.stream;
      const transform = new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === "text-delta") {
            emit("llm.token", "agent.llm.token", { token: chunk.textDelta });
          } else if (chunk.type === "finish") {
            emit("llm.end", "agent.end", {
              model: opts.model?.modelId,
              usage: chunk.usage,
              finish_reason: chunk.finishReason,
            });
          }
          controller.enqueue(chunk);
        },
      });

      return {
        ...result,
        stream: originalStream.pipeThrough(transform),
      };
    },
  };
}
