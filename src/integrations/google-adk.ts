import type { EventType } from "../index.js";
import {
  coerceChannelId,
  type IntegrationConfig,
  initTrace,
  safePublish,
  truncate,
} from "./_base.js";

/**
 * Google Agent Development Kit (ADK) callbacks.
 *
 * Returns an object compatible with ADK's `before*` / `after*` hook
 * shape. Wire it into your `Agent` constructor's callback config.
 *
 * Tested against the public Google ADK preview (`@google/adk` ^0.1).
 * The hook surface is still in flux; this integration tracks the
 * `before/after Agent`, `before/after Model`, `before/after Tool` quad
 * which has been stable since the developer preview.
 */

interface ADKCallbacks {
  beforeAgent: (agent: any) => void;
  afterAgent: (agent: any, output: any) => void;
  beforeModel: (model: any, params: any) => void;
  afterModel: (model: any, response: any) => void;
  beforeTool: (tool: any, input: any) => void;
  afterTool: (tool: any, output: any) => void;
}

export function axonPushADKCallbacks(config: IntegrationConfig): ADKCallbacks {
  const client = config.client;
  const channelId = coerceChannelId(config.channelId);
  const agentId = config.agentId ?? "google-adk";
  const trace = initTrace(config.traceId);

  function emit(identifier: string, eventType: EventType, payload: Record<string, unknown>): void {
    void safePublish(client, channelId, identifier, eventType, payload, {
      agentId,
      trace,
      metadata: { framework: "google-adk" },
    });
  }

  return {
    beforeAgent(agent) {
      emit("agent.start", "agent.start", {
        agent_name: agent?.name ?? "unknown",
      });
    },

    afterAgent(agent, output) {
      emit("agent.end", "agent.end", {
        agent_name: agent?.name ?? "unknown",
        output: truncate(output, 500),
      });
    },

    beforeModel(model, params) {
      emit("llm.start", "agent.start", {
        model: model?.modelId ?? model?.name ?? "unknown",
        params: truncate(params, 500),
      });
    },

    afterModel(model, response) {
      emit("llm.end", "agent.end", {
        model: model?.modelId ?? model?.name ?? "unknown",
        response: truncate(response, 500),
      });
    },

    beforeTool(tool, input) {
      const toolName = tool?.name ?? "unknown";
      emit(`tool.${toolName}.start`, "agent.tool_call.start", {
        tool_name: toolName,
        input: truncate(input, 500),
      });
    },

    afterTool(tool, output) {
      const toolName = tool?.name ?? "unknown";
      emit(`tool.${toolName}.end`, "agent.tool_call.end", {
        tool_name: toolName,
        output: truncate(output, 500),
      });
    },
  };
}
