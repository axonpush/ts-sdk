import { type GeneratedOp, invokeSync, setSettings } from "./_internal/transport";
import { type AxonPushOptions, type ResolvedSettings, resolveSettings } from "./config";
import { getOrCreateTrace, type TraceContext } from "./tracing";

/**
 * High-level facade over the AxonPush REST + realtime APIs.
 *
 * Resource accessors (`events`, `channels`, ...) are loaded lazily on first
 * access via dynamic `import()` so that tree-shakers can drop unused
 * resources, and so that resource modules compile independently of the core
 * client during the v0.0.5 rewrite.
 */
export class AxonPush {
  /** Fully-resolved configuration, materialised in the constructor. */
  readonly settings: ResolvedSettings;

  private readonly _resources: Record<string, unknown> = {};

  /**
   * @param options Optional caller overrides; falsy fields fall through to
   *   `AXONPUSH_*` env vars and then documented defaults.
   */
  constructor(options?: AxonPushOptions) {
    this.settings = resolveSettings(options);
    setSettings(this.settings);
  }

  /** The configured environment label (or `undefined` if none). */
  get environment(): string | undefined {
    return this.settings.environment;
  }

  /**
   * Lazily import a resource module and instantiate its class with `this`.
   * Resources are cached per-instance after first construction.
   */
  private async _resource(name: string, modulePath: string, exportName: string): Promise<unknown> {
    const cached = this._resources[name];
    if (cached) return cached;
    const mod = (await import(modulePath)) as Record<string, unknown>;
    const Ctor = mod[exportName] as new (parent: AxonPush) => unknown;
    const instance = new Ctor(this);
    this._resources[name] = instance;
    return instance;
  }

  /** Events resource — `publish`, `list`, `search`. */
  get events(): Promise<unknown> {
    return this._resource("events", "./resources/events", "EventsResource");
  }

  /** Channels resource. */
  get channels(): Promise<unknown> {
    return this._resource("channels", "./resources/channels", "ChannelsResource");
  }

  /** Apps resource. */
  get apps(): Promise<unknown> {
    return this._resource("apps", "./resources/apps", "AppsResource");
  }

  /** Environments resource. */
  get environments(): Promise<unknown> {
    return this._resource("environments", "./resources/environments", "EnvironmentsResource");
  }

  /** Webhooks resource. */
  get webhooks(): Promise<unknown> {
    return this._resource("webhooks", "./resources/webhooks", "WebhooksResource");
  }

  /** Traces resource. */
  get traces(): Promise<unknown> {
    return this._resource("traces", "./resources/traces", "TracesResource");
  }

  /** API keys resource. */
  get apiKeys(): Promise<unknown> {
    return this._resource("apiKeys", "./resources/api-keys", "ApiKeysResource");
  }

  /** Organizations resource. */
  get organizations(): Promise<unknown> {
    return this._resource("organizations", "./resources/organizations", "OrganizationsResource");
  }

  /**
   * Open a realtime (MQTT-over-WSS) connection. The realtime module is
   * imported lazily so callers that never use realtime do not pay for the
   * `mqtt` peer dependency.
   *
   * @param opts Realtime client options (forwarded as the second arg).
   * @returns A `RealtimeClient` instance ready to subscribe / publish.
   */
  async connectRealtime(opts?: unknown): Promise<unknown> {
    const mod = (await import("./realtime")) as {
      RealtimeClient: new (parent: AxonPush, options?: unknown) => unknown;
    };
    return new mod.RealtimeClient(this, opts);
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
