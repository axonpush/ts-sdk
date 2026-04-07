import { WebSocketClient } from "./realtime/websocket.js";
import { ApiKeysResource } from "./resources/api-keys.js";
import { AppsResource } from "./resources/apps.js";
import { ChannelsResource } from "./resources/channels.js";
import { EventsResource } from "./resources/events.js";
import { TracesResource } from "./resources/traces.js";
import { WebhooksResource } from "./resources/webhooks.js";
import { createTransport, type TransportClient } from "./transport.js";

const DEFAULT_BASE_URL = "https://api.axonpush.xyz";

export interface AxonPushOptions {
  apiKey: string;
  tenantId: string;
  baseUrl?: string;
  failOpen?: boolean;
}

export class AxonPush {
  readonly events: EventsResource;
  readonly channels: ChannelsResource;
  readonly apps: AppsResource;
  readonly traces: TracesResource;
  readonly webhooks: WebhooksResource;
  readonly apiKeys: ApiKeysResource;

  private readonly api: TransportClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly failOpen: boolean;

  constructor(opts: AxonPushOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = opts.apiKey;
    this.failOpen = opts.failOpen ?? true;

    this.api = createTransport({
      apiKey: opts.apiKey,
      tenantId: opts.tenantId,
      baseUrl: this.baseUrl,
      failOpen: this.failOpen,
    });

    const headers: Record<string, string> = {
      "X-API-Key": opts.apiKey,
      "x-tenant-id": opts.tenantId,
    };

    this.events = new EventsResource(this.api, this.failOpen);
    this.channels = new ChannelsResource(this.api, this.failOpen, this.baseUrl, headers);
    this.apps = new AppsResource(this.api, this.failOpen);
    this.traces = new TracesResource(this.api, this.failOpen);
    this.webhooks = new WebhooksResource(this.api, this.failOpen);
    this.apiKeys = new ApiKeysResource(this.api, this.failOpen);
  }

  connectWebSocket(): WebSocketClient {
    return new WebSocketClient(this.baseUrl, this.apiKey);
  }

  [Symbol.dispose](): void {}
}
