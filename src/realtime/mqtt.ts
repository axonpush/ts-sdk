import { logger } from "../logger.js";
import type { components } from "../schema";
import {
  type FetchCredentialsOptions,
  fetchIotCredentials,
  type IotCredentials,
  msUntilRefresh,
} from "./credentials.js";
import { buildPublishTopic, buildSubscribeTopic, type TopicParts } from "./topics.js";

type Event = components["schemas"]["Event"];

export interface SubscribeFilters {
  agentId?: string;
  eventType?: string;
  traceId?: string;
}

export interface PublishData {
  channelId: string | number;
  identifier: string;
  payload: Record<string, unknown>;
  agentId?: string;
  traceId?: string;
  eventType?: string;
}

export interface RealtimeClientOptions {
  baseUrl: string;
  headers: Record<string, string>;
  orgId: string;
  appId: string;
  fetchImpl?: typeof fetch;
  mqttFactory?: MqttFactory;
  refreshLeadSeconds?: number;
}

export type MqttFactory = (
  url: string,
  options: Record<string, unknown>,
) => Promise<MqttLikeClient>;

export interface MqttLikeClient {
  on(event: "connect", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "message", cb: (topic: string, payload: Uint8Array | Buffer) => void): void;
  on(event: "close", cb: () => void): void;
  subscribe(topic: string, opts?: { qos?: 0 | 1 | 2 }): void;
  unsubscribe(topic: string): void;
  publish(topic: string, payload: string, opts?: { qos?: 0 | 1 | 2 }): void;
  end(force?: boolean): void;
}

type EventHandler = (event: Event) => void;

const DEFAULT_QOS = 1 as const;

async function defaultMqttFactory(
  url: string,
  options: Record<string, unknown>,
): Promise<MqttLikeClient> {
  let mqttModule: any;
  try {
    mqttModule = await import("mqtt");
  } catch {
    throw new Error("MQTT support requires the `mqtt` package. Install it with: bun add mqtt");
  }
  const connect = mqttModule.connect ?? mqttModule.default?.connect;
  if (typeof connect !== "function") {
    throw new Error("Loaded `mqtt` module is missing a connect() export");
  }
  return connect(url, options) as MqttLikeClient;
}

interface SubscriptionRecord {
  topic: string;
  parts: TopicParts;
  filters: { traceId?: string };
}

export class RealtimeClient {
  private client: MqttLikeClient | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly eventHandlers: EventHandler[] = [];
  private readonly disconnectHandlers: Array<() => void> = [];
  private readonly mqttFactory: MqttFactory;
  private readonly refreshLeadSeconds: number;
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly opts: RealtimeClientOptions) {
    this.mqttFactory = opts.mqttFactory ?? defaultMqttFactory;
    this.refreshLeadSeconds = opts.refreshLeadSeconds ?? 60;
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.bringUp();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  subscribe(channelId: string | number, filters?: SubscribeFilters): void {
    this.requireOpen();
    const parts: TopicParts = {
      orgId: this.opts.orgId,
      appId: this.opts.appId,
      channelId,
      eventType: filters?.eventType,
      agentId: filters?.agentId,
    };
    const topic = buildSubscribeTopic(parts);
    if (this.subscriptions.has(topic)) return;
    this.subscriptions.set(topic, { topic, parts, filters: { traceId: filters?.traceId } });
    this.client?.subscribe(topic, { qos: DEFAULT_QOS });
  }

  unsubscribe(channelId: string | number, filters?: SubscribeFilters): void {
    const topic = buildSubscribeTopic({
      orgId: this.opts.orgId,
      appId: this.opts.appId,
      channelId,
      eventType: filters?.eventType,
      agentId: filters?.agentId,
    });
    if (!this.subscriptions.delete(topic)) return;
    this.client?.unsubscribe(topic);
  }

  publish(data: PublishData): void {
    this.requireOpen();
    const topic = buildPublishTopic({
      orgId: this.opts.orgId,
      appId: this.opts.appId,
      channelId: data.channelId,
      eventType: data.eventType ?? "custom",
      agentId: data.agentId ?? "_",
    });
    this.client?.publish(topic, JSON.stringify(data), { qos: DEFAULT_QOS });
  }

  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.client?.end(true);
    this.client = null;
  }

  async wait(): Promise<void> {
    if (this.closed) return;
    return new Promise((resolve) => {
      this.disconnectHandlers.push(resolve);
    });
  }

  private async bringUp(): Promise<void> {
    if (this.closed) throw new Error("RealtimeClient is closed");
    const credentials = await this.fetchCredentials();
    const client = await this.mqttFactory(credentials.presignedWssUrl, {
      reconnectPeriod: 0,
      clean: true,
      protocolVersion: 4,
    });
    this.client = client;
    this.scheduleRefresh(credentials.expiresAt);

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => resolve();
      const onError = (err: Error) => reject(err);
      client.on("connect", onConnect);
      client.on("error", onError);
    });

    client.on("message", (topic, payload) => this.handleMessage(topic, payload));
    client.on("close", () => this.handleClose());

    for (const sub of this.subscriptions.values()) {
      client.subscribe(sub.topic, { qos: DEFAULT_QOS });
    }
  }

  private fetchCredentials(): Promise<IotCredentials> {
    const fetchOpts: FetchCredentialsOptions = {
      baseUrl: this.opts.baseUrl,
      headers: this.opts.headers,
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
    };
    return fetchIotCredentials(fetchOpts);
  }

  private scheduleRefresh(expiresAt: string): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const delay = msUntilRefresh(expiresAt, this.refreshLeadSeconds);
    if (delay <= 0) return;
    this.refreshTimer = setTimeout(() => {
      void this.refreshConnection();
    }, delay);
  }

  private async refreshConnection(): Promise<void> {
    if (this.closed) return;
    try {
      const next = await this.fetchCredentials();
      const previous = this.client;
      const newClient = await this.mqttFactory(next.presignedWssUrl, {
        reconnectPeriod: 0,
        clean: true,
        protocolVersion: 4,
      });
      this.client = newClient;
      await new Promise<void>((resolve, reject) => {
        newClient.on("connect", () => resolve());
        newClient.on("error", (err) => reject(err));
      });
      newClient.on("message", (topic, payload) => this.handleMessage(topic, payload));
      newClient.on("close", () => this.handleClose());
      for (const sub of this.subscriptions.values()) {
        newClient.subscribe(sub.topic, { qos: DEFAULT_QOS });
      }
      previous?.end(true);
      this.scheduleRefresh(next.expiresAt);
    } catch (err) {
      logger.warn(`MQTT credential refresh failed: ${(err as Error).message}`);
      this.scheduleRefresh(new Date(Date.now() + 30_000).toISOString());
    }
  }

  private handleMessage(_topic: string, payload: Uint8Array | Buffer): void {
    let parsed: Event;
    try {
      const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
      parsed = JSON.parse(text) as Event;
    } catch {
      return;
    }
    for (const handler of this.eventHandlers) {
      try {
        handler(parsed);
      } catch {}
    }
  }

  private handleClose(): void {
    if (this.closed) {
      for (const cb of this.disconnectHandlers) cb();
      this.disconnectHandlers.length = 0;
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new Error("RealtimeClient is closed");
  }
}

export class WebSocketClient extends RealtimeClient {}
