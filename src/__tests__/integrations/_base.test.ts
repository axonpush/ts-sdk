import { describe, expect, it, vi } from "vitest";
import {
  coerceChannelId,
  deriveModelName,
  deriveRunnableName,
  extractRunMetadata,
  truncate,
} from "../../integrations/_base.js";

describe("coerceChannelId", () => {
  it("returns string inputs unchanged", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(coerceChannelId("ch-uuid")).toBe("ch-uuid");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("coerces numeric inputs and warns about deprecation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(coerceChannelId(42)).toBe("42");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/deprecated/);
    warnSpy.mockRestore();
  });
});

describe("truncate", () => {
  it("returns small JSON unchanged", () => {
    expect(truncate({ a: 1 })).toEqual({ a: 1 });
  });

  it("truncates oversized values", () => {
    const big = { s: "x".repeat(5000) };
    const out = truncate(big, 100);
    expect(typeof out).toBe("string");
    expect((out as string).endsWith("...")).toBe(true);
  });

  it("preserves bigints by stringifying them", () => {
    const out = truncate({ n: 1n });
    expect(out).toEqual({ n: "1" });
  });
});

describe("deriveRunnableName", () => {
  it("prefers explicit runName (LangGraph node case)", () => {
    expect(deriveRunnableName({}, "researcher", { langgraph_node: "researcher" })).toBe(
      "researcher",
    );
  });

  it("falls back to metadata.langgraph_node when runName missing", () => {
    expect(deriveRunnableName({}, undefined, { langgraph_node: "writer" })).toBe("writer");
  });

  it("uses serialized.name when runName + metadata absent", () => {
    expect(deriveRunnableName({ name: "MyChain" }, undefined, {})).toBe("MyChain");
  });

  it("falls back to last segment of serialized.id", () => {
    expect(deriveRunnableName({ id: ["langchain", "chains", "LLMChain"] })).toBe("LLMChain");
  });

  it("returns 'Runnable' rather than 'unknown' when nothing is set", () => {
    expect(deriveRunnableName({}, undefined, {})).toBe("Runnable");
    expect(deriveRunnableName(null)).toBe("Runnable");
  });
});

describe("deriveModelName", () => {
  it("reads invocation_params.model first (Chat* runtime case)", () => {
    expect(
      deriveModelName(
        { name: "ChatOpenAI", kwargs: { model: "gpt-4o-mini" } },
        { invocation_params: { model: "gpt-4o-mini-2024-07-18" } },
      ),
    ).toBe("gpt-4o-mini-2024-07-18");
  });

  it("falls back to extraParams.model_name", () => {
    expect(deriveModelName({ name: "ChatAnthropic" }, { model_name: "claude-sonnet-4-6" })).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("falls back to serialized.kwargs.model", () => {
    expect(deriveModelName({ kwargs: { model: "claude-haiku-4-5" } })).toBe("claude-haiku-4-5");
  });

  it("returns wrapper class name as final non-unknown fallback", () => {
    expect(deriveModelName({ name: "ChatOpenAI" })).toBe("ChatOpenAI");
  });

  it("returns 'unknown' only when there is genuinely nothing", () => {
    expect(deriveModelName({})).toBe("unknown");
    expect(deriveModelName(null)).toBe("unknown");
  });
});

describe("extractRunMetadata", () => {
  it("propagates LangGraph metadata into the event", () => {
    expect(
      extractRunMetadata(
        ["graph:my_graph"],
        { langgraph_node: "researcher", langgraph_step: 3, thread_id: "t-abc" },
        "chain",
      ),
    ).toEqual({
      tags: ["graph:my_graph"],
      langgraph_node: "researcher",
      langgraph_step: 3,
      thread_id: "t-abc",
      run_type: "chain",
    });
  });

  it("returns an empty object when nothing useful is available", () => {
    expect(extractRunMetadata()).toEqual({});
    expect(extractRunMetadata([], {})).toEqual({});
  });
});
