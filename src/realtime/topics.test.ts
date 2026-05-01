import { describe, expect, it } from "vitest";
import { buildPublishTopic, buildSubscribeTopic } from "./topics.js";

describe("buildSubscribeTopic", () => {
  it("uses + wildcards for absent envSlug, eventType and agentId", () => {
    expect(buildSubscribeTopic({ orgId: "org_1", appId: "app_2", channelId: 42 })).toBe(
      "axonpush/org_1/+/app_2/42/+/+",
    );
  });

  it("substitutes envSlug when provided", () => {
    expect(
      buildSubscribeTopic({
        orgId: "org_1",
        appId: "app_2",
        channelId: 42,
        envSlug: "prod",
      }),
    ).toBe("axonpush/org_1/prod/app_2/42/+/+");
  });

  it("substitutes eventType when provided", () => {
    expect(
      buildSubscribeTopic({
        orgId: "org_1",
        appId: "app_2",
        channelId: 42,
        eventType: "agent.error",
      }),
    ).toBe("axonpush/org_1/+/app_2/42/agent.error/+");
  });

  it("substitutes agentId when provided", () => {
    expect(
      buildSubscribeTopic({
        orgId: "org_1",
        appId: "app_2",
        channelId: "c-9",
        agentId: "agent-7",
      }),
    ).toBe("axonpush/org_1/+/app_2/c-9/+/agent-7");
  });

  it("substitutes all filters", () => {
    expect(
      buildSubscribeTopic({
        orgId: "o",
        appId: "a",
        channelId: 1,
        envSlug: "dev",
        eventType: "agent.start",
        agentId: "agent-1",
      }),
    ).toBe("axonpush/o/dev/a/1/agent.start/agent-1");
  });

  it("accepts string channelId", () => {
    expect(buildSubscribeTopic({ orgId: "o", appId: "a", channelId: "ch_1" })).toBe(
      "axonpush/o/+/a/ch_1/+/+",
    );
  });
});

describe("buildPublishTopic", () => {
  it("never has wildcards", () => {
    const topic = buildPublishTopic({
      orgId: "o",
      appId: "a",
      channelId: 1,
      envSlug: "dev",
      eventType: "custom",
      agentId: "_",
    });
    expect(topic).toBe("axonpush/o/dev/a/1/custom/_");
    expect(topic.includes("+")).toBe(false);
    expect(topic.includes("#")).toBe(false);
  });
});
