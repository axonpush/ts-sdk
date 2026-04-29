import type { components } from "../schema";
import { RealtimeClient, type RealtimeClientOptions } from "./mqtt.js";

type Event = components["schemas"]["Event"];

export interface SSESubscribeOptions {
  agentId?: string;
  eventType?: string;
  traceId?: string;
  environment?: string;
}

export interface SSESubscriptionInit {
  channelId: string | number;
  filters?: SSESubscribeOptions;
  eventIdentifier?: string;
  realtimeOpts: RealtimeClientOptions;
}

let warned = false;
function warnDeprecated(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[axonpush] SSE subscription has been removed. The SSESubscription class now uses MQTT under the hood; migrate to RealtimeClient for full features.",
  );
}

export class SSESubscription implements AsyncIterable<Event> {
  private aborted = false;
  private readonly client: RealtimeClient;
  private readonly init: SSESubscriptionInit;

  constructor(init: SSESubscriptionInit) {
    warnDeprecated();
    this.init = init;
    this.client = new RealtimeClient(init.realtimeOpts);
  }

  abort(): void {
    this.aborted = true;
    void this.client.disconnect();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Event> {
    if (this.aborted) return;
    const queue: Event[] = [];
    let resolveWaiter: (() => void) | null = null;

    this.client.onEvent((event) => {
      if (this.init.eventIdentifier && event.identifier !== this.init.eventIdentifier) return;
      const traceId = this.init.filters?.traceId;
      if (traceId && event.traceId !== traceId) return;
      queue.push(event);
      resolveWaiter?.();
      resolveWaiter = null;
    });

    await this.client.connect();
    this.client.subscribe(this.init.channelId, this.init.filters);

    try {
      while (!this.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
          continue;
        }
        const next = queue.shift();
        if (next) yield next;
      }
    } finally {
      await this.client.disconnect();
    }
  }
}
