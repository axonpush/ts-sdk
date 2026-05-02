import { type GeneratedOp, invokeSync, setSettings } from "./_internal/transport";
import { type AxonPushOptions, type ResolvedSettings, resolveSettings } from "./config";
import type { RealtimeClient, RealtimeOptions } from "./realtime";
import { ApiKeysResource } from "./resources/api-keys";
import { AppsResource } from "./resources/apps";
import { ChannelsResource } from "./resources/channels";
import { EnvironmentsResource } from "./resources/environments";
import { EventsResource } from "./resources/events";
import { OrganizationsResource } from "./resources/organizations";
import { TracesResource } from "./resources/traces";
import { WebhooksResource } from "./resources/webhooks";
import { getOrCreateTrace, type TraceContext } from "./tracing";

/**
 * High-level facade over the AxonPush REST + realtime APIs.
 *
 * Resource accessors (`events`, `channels`, ...) are constructed once
 * per `AxonPush` instance and exposed as plain properties so callers can
 * write `client.events.publish(...)` without awaiting.
 */
export class AxonPush {
  /** Fully-resolved configuration, materialised in the constructor. */
  readonly settings: ResolvedSettings;

  /** Events resource — `publish`, `list`, `search`. */
  readonly events: EventsResource;
  /** Channels resource — `create`, `get`, `update`, `delete`. */
  readonly channels: ChannelsResource;
  /** Apps resource — `list`, `get`, `create`, `update`, `delete`. */
  readonly apps: AppsResource;
  /** Environments resource — `list`, `create`, `update`, `delete`, `promoteToDefault`. */
  readonly environments: EnvironmentsResource;
  /** Webhooks resource — `createEndpoint`, `listEndpoints`, `deleteEndpoint`, `deliveries`. */
  readonly webhooks: WebhooksResource;
  /** Traces resource — `list`, `stats`, `events`, `summary`. */
  readonly traces: TracesResource;
  /** API keys resource — `create`, `list`, `delete`. */
  readonly apiKeys: ApiKeysResource;
  /** Organizations resource — `create`, `get`, `list`, `update`, `delete`, `invite`, `removeMember`, `transferOwnership`. */
  readonly organizations: OrganizationsResource;

  /**
   * @param options Optional caller overrides; falsy fields fall through to
   *   `AXONPUSH_*` env vars and then documented defaults.
   */
  constructor(options?: AxonPushOptions) {
    this.settings = resolveSettings(options);
    setSettings(this.settings);
    this.events = new EventsResource(this);
    this.channels = new ChannelsResource(this);
    this.apps = new AppsResource(this);
    this.environments = new EnvironmentsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.traces = new TracesResource(this);
    this.apiKeys = new ApiKeysResource(this);
    this.organizations = new OrganizationsResource(this);
  }

  /** The configured environment label (or `undefined` if none). */
  get environment(): string | undefined {
    return this.settings.environment;
  }

  /**
   * Open a realtime (MQTT-over-WSS) connection. The realtime module is
   * imported lazily so callers that never use realtime do not pay for the
   * `mqtt` peer dependency at module-load time.
   *
   * @param opts Realtime client options (forwarded as the second arg).
   * @returns A `RealtimeClient` instance ready to subscribe / publish.
   */
  async connectRealtime(opts?: RealtimeOptions): Promise<RealtimeClient> {
    const { RealtimeClient: Ctor } = await import("./realtime");
    return new Ctor(this, opts);
  }

  /**
   * Run a generated SDK operation through the transport chokepoint.
   *
   * @typeParam T Success-response type returned by `op`.
   * @param op A function from `src/_internal/api/sdk.gen.ts`.
   * @param args Options bag forwarded to `op`.
   * @returns The unwrapped response data, or `null` if `failOpen` swallowed
   *   an `APIConnectionError`.
   * @throws {AxonPushError} On non-retryable failures.
   */
  invoke<T>(op: GeneratedOp<T>, args?: unknown): Promise<T | null> {
    return invokeSync<T>(op, args, {
      failOpen: this.settings.failOpen,
      maxRetries: this.settings.maxRetries,
    });
  }

  /**
   * Return the active {@link TraceContext} or create a fresh one.
   *
   * @param seedTraceId Optional pre-existing trace id to adopt.
   * @returns The trace context for the current async flow.
   */
  getOrCreateTrace(seedTraceId?: string): TraceContext {
    return getOrCreateTrace(seedTraceId);
  }

  /**
   * Idempotent teardown hook. Currently a no-op; reserved for releasing
   * realtime connections, flushing publishers, etc. once those are owned by
   * the facade.
   */
  close(): void {
    /* noop */
  }
}

export type { AxonPushOptions } from "./config";
