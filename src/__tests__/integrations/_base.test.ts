import { describe, expect, it, vi } from "vitest";
import { coerceChannelId, truncate } from "../../integrations/_base.js";

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
