import { describe, expect, it } from "vitest";
import { buildPublishTopic, buildSubscribeTopic, sanitiseSegment } from "./topics.js";

describe("sanitiseSegment", () => {
  it("preserves alphanumerics, underscore and hyphen", () => {
    expect(sanitiseSegment("abc_123-XYZ")).toBe("abc_123-XYZ");
  });

  it("replaces unsafe characters with underscore", () => {
    expect(sanitiseSegment("agent.error")).toBe("agent_error");
    expect(sanitiseSegment("hello world")).toBe("hello_world");
    expect(sanitiseSegment("a/b#c+d")).toBe("a_b_c_d");
    expect(sanitiseSegment("user@example.com")).toBe("user_example_com");
  });

  it("collapses null/undefined/empty to underscore", () => {
    expect(sanitiseSegment(undefined)).toBe("_");
    expect(sanitiseSegment(null)).toBe("_");
    expect(sanitiseSegment("")).toBe("_");
  });
});

describe("buildPublishTopic", () => {
  it("builds the 7-segment publish shape with envSlug above appId", () => {
    expect(
      buildPublishTopic({
        orgId: "org_1",
        envSlug: "prod",
        appId: "app_2",
        channelId: "chan_3",
        eventType: "agent.error",
        agentId: "agent_4",
      }),
    ).toBe("axonpush/org_1/prod/app_2/chan_3/agent_error/agent_4");
  });

  it("falls back to 'default' when envSlug is missing", () => {
    expect(
      buildPublishTopic({
        orgId: "org_1",
        appId: "app_2",
        channelId: "chan_3",
        eventType: "log",
      }),
    ).toBe("axonpush/org_1/default/app_2/chan_3/log/_");
  });

  it("uses underscore for missing eventType / agentId", () => {
    expect(
      buildPublishTopic({
        orgId: "org_1",
        envSlug: "dev",
        appId: "app_2",
        channelId: "chan_3",
      }),
    ).toBe("axonpush/org_1/dev/app_2/chan_3/_/_");
  });

  it("sanitises every input segment", () => {
    expect(
      buildPublishTopic({
        orgId: "org/1",
        envSlug: "prod!",
        appId: "a b",
        channelId: "c#d",
        eventType: "evt+x",
        agentId: "agt!1",
      }),
    ).toBe("axonpush/org_1/prod_/a_b/c_d/evt_x/agt_1");
  });

  it("never produces wildcards", () => {
    const topic = buildPublishTopic({
      orgId: "o",
      envSlug: "dev",
      appId: "a",
      channelId: "1",
      eventType: "custom",
      agentId: "_",
    });
    expect(topic.includes("+")).toBe(false);
    expect(topic.includes("#")).toBe(false);
  });
});

describe("buildSubscribeTopic", () => {
  it("uses + for every missing segment", () => {
    expect(buildSubscribeTopic({ orgId: "org_1" })).toBe("axonpush/org_1/+/+/+/+/+");
  });

  it("substitutes concrete values and sanitises them", () => {
    expect(
      buildSubscribeTopic({
        orgId: "org_1",
        envSlug: "staging",
        channelId: "c1",
        eventType: "agent.error",
      }),
    ).toBe("axonpush/org_1/staging/+/c1/agent_error/+");
  });

  it("round-trips a fully-specified subscription with sanitisation", () => {
    expect(
      buildSubscribeTopic({
        orgId: "o",
        envSlug: "dev",
        appId: "a",
        channelId: "1",
        eventType: "agent.start",
        agentId: "agent-1",
      }),
    ).toBe("axonpush/o/dev/a/1/agent_start/agent-1");
  });
});
