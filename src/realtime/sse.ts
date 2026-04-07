import type { components } from "../schema";

type Event = components["schemas"]["Event"];

export interface SSESubscribeOptions {
  agentId?: string;
  eventType?: string;
  traceId?: string;
}

export class SSESubscription implements AsyncIterable<Event> {
  private controller = new AbortController();

  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {}

  abort(): void {
    this.controller.abort();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Event> {
    const response = await fetch(this.url, {
      headers: {
        ...this.headers,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal: this.controller.signal,
    });

    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          } else if (line === "" && dataLines.length > 0) {
            try {
              const event: Event = JSON.parse(dataLines.join("\n"));
              yield event;
            } catch {}
            dataLines = [];
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
