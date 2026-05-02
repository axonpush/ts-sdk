import type { EventResponseDto } from "../_internal/api/types.gen.js";
import { logger } from "../logger.js";
import {
  type AxonPushLike,
  fetchIotCredentials,
  type IotCredentials,
  msUntilRefresh,
} from "./credentials.js";
import { buildPublishTopic, buildSubscribeTopic, type TopicParts } from "./topics.js";

/** Public event shape relayed to user callbacks. */
export type AxonEvent = EventResponseDto;

export interface SubscribeFilters {
  appId?: string;
  channelId?: string;
  agentId?: string;
  eventType?: string;
  traceId?: string;
  environment?: string;
}

export interface PublishData {
  channelId: string;
  appId?: string;
  identifier: string;
  payload: Record<string, unknown>;
  agentId?: string;
  traceId?: string;
  eventType?: string;
  environment?: string;
}

export interface RealtimeOptions {
  /** Default environment slug to use on publish when not specified per-message. */
  environment?: string;
  /** Refresh credentials this many ms before they expire. Default 60_000. */
  credentialsRefreshLeadMs?: number;
  /** Called when refresh / reconnect ultimately fails — caller drives recovery. */
  onError?: (err: Error) => void;
  /** Test hook: supply a fake mqtt client factory. */
  mqttFactory?: MqttFactory;
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

type EventHandler = (event: AxonEvent) => void | Promise<void>;

const DEFAULT_QOS = 1 as const;
const REFRESH_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

async function defaultMqttFactory(
  url: string,
  options: Record<string, unknown>,
): Promise<MqttLikeClient> {
  let mqttModule: { connect?: unknown; default?: { connect?: unknown } };
  try {
    mqttModule = (await import("mqtt")) as {
      connect?: unknown;
      default?: { connect?: unknown };
    };
  } catch {
    throw new Error("MQTT support requires the `mqtt` package. Install it with: bun add mqtt");
  }
  const connect = mqttModule.connect ?? mqttModule.default?.connect;
  if (typeof connect !== "function") {
    throw new Error("Loaded `mqtt` module is missing a connect() export");
  }
  return (connect as (u: string, o: Record<string, unknown>) => MqttLikeClient)(url, options);
}

interface SubscriptionRecord {
  topic: string;
  filters: SubscribeFilters;
  callbacks: Set<(event: AxonEvent) => void | Promise<void>>;
}

/**
 * Long-lived MQTT-over-WSS client for AxonPush realtime.
 *
 * Connects with credentials fetched via the generated
 * `iotCredentialsControllerGetCredentials` op, schedules pre-emptive
 * refreshes, and routes broker messages through user callbacks with
 * per-callback error isolation.
 */
export class RealtimeClient {
  private readonly client: AxonPushLike;
  private readonly opts: RealtimeOptions;
  private readonly mqttFactory: MqttFactory;
  private readonly refreshLeadMs: number;
  private mqtt: MqttLikeClient | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshAttempt = 0;
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly eventHandlers = new Set<EventHandler>();
  private readonly disconnectHandlers: Array<() => void> = [];
  private connectingPromise: Promise<void> | null = null;
  private orgId: string | null = null;
  private envSlug: string | undefined;
  private closed = false;

  constructor(client: AxonPushLike, opts: RealtimeOptions = {}) {
    this.client = client;
    this.opts = opts;
    this.mqttFactory = opts.mqttFactory ?? defaultMqttFactory;
    this.refreshLeadMs = opts.credentialsRefreshLeadMs ?? 60_000;
  }

  /** Open the broker connection. Idempotent — concurrent calls share the in-flight attempt. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error("RealtimeClient is closed");
    if (this.mqtt) return;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this.bringUp();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  /**
   * Subscribe to a topic and run `callback` for every matching event.
   * Multiple callbacks on the same filter coexist — one failure does not
   * affect the others.
   */
  async subscribe(filters: SubscribeFilters, callback: EventHandler): Promise<void> {
    this.requireOpen();
    if (!this.mqtt || !this.orgId) await this.connect();
    if (!this.mqtt || !this.orgId) throw new Error("RealtimeClient: not connected");
    const topic = buildSubscribeTopic(this.toTopicParts(filters));
    const existing = this.subscriptions.get(topic);
    if (existing) {
      existing.callbacks.add(callback);
      return;
    }
    const record: SubscriptionRecord = {
      topic,
      filters,
      callbacks: new Set([callback]),
    };
    this.subscriptions.set(topic, record);
    this.mqtt.subscribe(topic, { qos: DEFAULT_QOS });
  }

  /** Drop the subscription with the given filters. No-op if it isn't registered. */
  async unsubscribe(filters: SubscribeFilters): Promise<void> {
    if (!this.orgId) return;
    const topic = buildSubscribeTopic(this.toTopicParts(filters));
    if (!this.subscriptions.delete(topic)) return;
    this.mqtt?.unsubscribe(topic);
  }

  /** Publish a single event onto the broker. Requires `connect()` to have completed. */
  async publish(data: PublishData): Promise<void> {
    this.requireOpen();
    if (!this.mqtt || !this.orgId) await this.connect();
    if (!this.mqtt || !this.orgId) throw new Error("RealtimeClient: not connected");
    const parts: TopicParts = {
      orgId: this.orgId,
      envSlug: data.environment ?? this.opts.environment ?? this.envSlug ?? "default",
      appId: data.appId ?? "default",
      channelId: data.channelId,
      ...(data.eventType !== undefined ? { eventType: data.eventType } : {}),
      ...(data.agentId !== undefined ? { agentId: data.agentId } : {}),
    };
    const topic = buildPublishTopic(parts);
    this.mqtt.publish(topic, JSON.stringify(data), { qos: DEFAULT_QOS });
  }

  /** Register a handler that receives every incoming event. Returns an unsubscribe fn. */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /** Tear the connection down. Idempotent. */
  async disconnect(): Promise<void> {
    if (this.closed && !this.mqtt) return;
    this.closed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const mqtt = this.mqtt;
    this.mqtt = null;
    mqtt?.end(true);
    for (const cb of this.disconnectHandlers) cb();
    this.disconnectHandlers.length = 0;
  }

  /** Resolves once `disconnect()` (or remote close) finishes. */
  async wait(): Promise<void> {
    if (this.closed) return;
    return new Promise((resolve) => {
      this.disconnectHandlers.push(resolve);
    });
  }

  private async bringUp(): Promise<void> {
    const credentials = await fetchIotCredentials(this.client);
    this.envSlug = credentials.envSlug ?? this.envSlug;
    this.orgId = this.deriveOrgIdFromCredentials(credentials);
    const mqtt = await this.mqttFactory(credentials.presignedWssUrl, {
      reconnectPeriod: 0,
      clean: true,
      protocolVersion: 4,
    });
    this.mqtt = mqtt;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      mqtt.on("connect", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      mqtt.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

    mqtt.on("message", (topic, payload) => this.handleMessage(topic, payload));
    mqtt.on("close", () => this.handleClose());
    mqtt.on("error", (err) => this.handleError(err));

    this.refreshAttempt = 0;
    this.scheduleRefresh(credentials.expiresAt);

    for (const sub of this.subscriptions.values()) {
      mqtt.subscribe(sub.topic, { qos: DEFAULT_QOS });
    }
  }

  private deriveOrgIdFromCredentials(credentials: IotCredentials): string {
    if (credentials.topicPrefix) {
      const parts = credentials.topicPrefix.split("/");
      const last = parts[parts.length - 1];
      if (last) return last;
    }
    if (credentials.clientId) return credentials.clientId;
    return "default";
  }

  private toTopicParts(filters: SubscribeFilters): Partial<TopicParts> & { orgId: string } {
    if (!this.orgId) throw new Error("RealtimeClient: orgId unknown — call connect() first");
    const parts: Partial<TopicParts> & { orgId: string } = { orgId: this.orgId };
    const env = filters.environment ?? this.opts.environment ?? this.envSlug;
    if (env !== undefined) parts.envSlug = env;
    if (filters.appId !== undefined) parts.appId = filters.appId;
    if (filters.channelId !== undefined) parts.channelId = filters.channelId;
    if (filters.eventType !== undefined) parts.eventType = filters.eventType;
    if (filters.agentId !== undefined) parts.agentId = filters.agentId;
    return parts;
  }

  private scheduleRefresh(expiresAt: string): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.closed) return;
    const delay = msUntilRefresh(expiresAt, this.refreshLeadMs);
    this.refreshTimer = setTimeout(() => {
      void this.refreshConnection();
    }, delay);
  }

  private async refreshConnection(): Promise<void> {
    if (this.closed) return;
    try {
      const next = await fetchIotCredentials(this.client);
      const newClient = await this.mqttFactory(next.presignedWssUrl, {
        reconnectPeriod: 0,
        clean: true,
        protocolVersion: 4,
      });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        newClient.on("connect", () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        newClient.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      });
      const previous = this.mqtt;
      this.mqtt = newClient;
      newClient.on("message", (topic, payload) => this.handleMessage(topic, payload));
      newClient.on("close", () => this.handleClose());
      newClient.on("error", (err) => this.handleError(err));
      previous?.end(true);
      this.envSlug = next.envSlug ?? this.envSlug;
      for (const sub of this.subscriptions.values()) {
        newClient.subscribe(sub.topic, { qos: DEFAULT_QOS });
      }
      this.refreshAttempt = 0;
      this.scheduleRefresh(next.expiresAt);
    } catch (err) {
      const error = err as Error;
      logger.warn(`MQTT credential refresh failed: ${error.message}`);
      const idx = Math.min(this.refreshAttempt, REFRESH_BACKOFF_MS.length - 1);
      const delay = REFRESH_BACKOFF_MS[idx] ?? REFRESH_BACKOFF_MS[REFRESH_BACKOFF_MS.length - 1];
      this.refreshAttempt += 1;
      if (this.refreshAttempt > REFRESH_BACKOFF_MS.length * 2) {
        this.opts.onError?.(error);
        return;
      }
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        void this.refreshConnection();
      }, delay);
    }
  }

  private handleMessage(_topic: string, payload: Uint8Array | Buffer | string): void {
    let parsed: AxonEvent;
    try {
      const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
      parsed = JSON.parse(text) as AxonEvent;
    } catch (err) {
      logger.warn(`MQTT message parse failed: ${(err as Error).message}`);
      return;
    }
    for (const handler of this.eventHandlers) {
      this.dispatch(handler, parsed);
    }
    for (const sub of this.subscriptions.values()) {
      if (!this.matchesFilters(parsed, sub.filters)) continue;
      for (const cb of sub.callbacks) this.dispatch(cb, parsed);
    }
  }

  private dispatch(handler: EventHandler, event: AxonEvent): void {
    try {
      const result = handler(event);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err) => this.reportCallbackError(err));
      }
    } catch (err) {
      this.reportCallbackError(err);
    }
  }

  private reportCallbackError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn(`Realtime user callback threw: ${error.message}`);
    this.opts.onError?.(error);
  }

  private matchesFilters(event: AxonEvent, filters: SubscribeFilters): boolean {
    if (filters.traceId && (event as { traceId?: string }).traceId !== filters.traceId)
      return false;
    return true;
  }

  private handleClose(): void {
    if (this.closed) {
      for (const cb of this.disconnectHandlers) cb();
      this.disconnectHandlers.length = 0;
    }
  }

  private handleError(err: Error): void {
    logger.warn(`MQTT client error: ${err.message}`);
    this.opts.onError?.(err);
  }

  private requireOpen(): void {
    if (this.closed) throw new Error("RealtimeClient is closed");
  }
}
