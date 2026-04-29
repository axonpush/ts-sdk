import { describe, expect, it } from "vitest";
import { serializeEventQuery } from "./events.js";

describe("serializeEventQuery", () => {
  it("emits scalar query params verbatim", () => {
    expect(
      serializeEventQuery({
        channelId: 42,
        agentId: "agent-1",
        traceId: "trace-2",
        since: "2026-04-01T00:00:00Z",
        until: "2026-04-30T00:00:00Z",
        cursor: "abc",
        limit: 25,
      }),
    ).toEqual({
      channelId: "42",
      agentId: "agent-1",
      traceId: "trace-2",
      since: "2026-04-01T00:00:00Z",
      until: "2026-04-30T00:00:00Z",
      cursor: "abc",
      limit: "25",
    });
  });

  it("joins eventType array with commas", () => {
    expect(serializeEventQuery({ eventType: ["agent.start", "agent.end"] })).toMatchObject({
      eventType: "agent.start,agent.end",
    });
  });

  it("JSON-stringifies payloadFilter", () => {
    const out = serializeEventQuery({
      payloadFilter: { "resource.service": "api", severity: { $gte: 17 } },
    });
    expect(out.payloadFilter).toBe(
      JSON.stringify({ "resource.service": "api", severity: { $gte: 17 } }),
    );
  });

  it("omits empty payloadFilter", () => {
    const out = serializeEventQuery({ payloadFilter: {} });
    expect(out.payloadFilter).toBeUndefined();
  });

  it("defaults limit when omitted", () => {
    expect(serializeEventQuery({}).limit).toBe("100");
  });

  it("does not include a `q` Lucene parameter", () => {
    const out = serializeEventQuery({ traceId: "t" });
    expect(out).not.toHaveProperty("q");
  });
});
