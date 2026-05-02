import { describe, expect, it } from "vitest";
import type { AxonPush } from "../../client.js";
import { AxonPushAnthropicTracer } from "../../integrations/anthropic.js";
import type { PublishParams } from "../../resources/events.js";

function makeFakeClient() {
  const published: PublishParams[] = [];
  const client = {
    events: {
      async publish(p: PublishParams) {
        published.push(p);
        return undefined;
      },
    },
  } as unknown as AxonPush;
  return { client, published };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("AxonPushAnthropicTracer", () => {
  it("captures usage tokens and stop_reason from createMessage", async () => {
    const { client, published } = makeFakeClient();
    const tracer = new AxonPushAnthropicTracer({ client, channelId: "ch-1" });

    const fakeAnthropic = {
      messages: {
        async create(_params: any) {
          return {
            content: [{ type: "text", text: "hi" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 12, output_tokens: 7 },
          };
        },
      },
    };

    await tracer.createMessage(fakeAnthropic as any, {
      model: "claude-sonnet",
      messages: [{ role: "user", content: "hello" }],
    });
    await settle();

    const finish = published.find((p) => p.identifier === "conversation.turn.end");
    expect(finish).toBeDefined();
    const payload = finish?.payload as Record<string, unknown>;
    expect(payload.input_tokens).toBe(12);
    expect(payload.output_tokens).toBe(7);
    expect(payload.stop_reason).toBe("end_turn");
  });

  it("emits per-token events when streaming", async () => {
    const { client, published } = makeFakeClient();
    const tracer = new AxonPushAnthropicTracer({ client, channelId: "ch-1" });

    async function* fakeStream(): AsyncGenerator<Record<string, any>, void, void> {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "he" } };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "llo" } };
      yield {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 3, output_tokens: 2 },
      };
    }

    const fakeAnthropic = {
      messages: {
        stream(_params: any) {
          return fakeStream();
        },
      },
    };

    const events: unknown[] = [];
    for await (const ev of tracer.streamMessage(fakeAnthropic as any, { model: "x" })) {
      events.push(ev);
    }
    await settle();

    const tokens = published.filter((p) => p.identifier === "llm.token");
    expect(tokens).toHaveLength(2);
    const finish = published.find((p) => p.identifier === "conversation.turn.end");
    const payload = finish?.payload as Record<string, unknown>;
    expect(payload.input_tokens).toBe(3);
    expect(payload.output_tokens).toBe(2);
    expect(payload.stop_reason).toBe("end_turn");
  });
});
