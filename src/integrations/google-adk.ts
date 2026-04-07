import type { EventType } from "../index.js";
import { type IntegrationConfig, initTrace, safePublish, truncate } from "./_base.js";

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
  const channelId = config.channelId;
  const agentId = config.agentId ?? "google-adk";
  const trace = initTrace(config.traceId);

  function emit(identifier: string, eventType: EventType, payload: Record<string, unknown>) {
    safePublish(client, channelId, identifier, eventType, payload, {
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
