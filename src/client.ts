import { withEnvironment } from "./environment.js";
import { logger } from "./logger.js";
import { RealtimeClient } from "./realtime/mqtt.js";
import { ApiKeysResource } from "./resources/api-keys.js";
import { AppsResource } from "./resources/apps.js";
import { ChannelsResource } from "./resources/channels.js";
import { EnvironmentsResource } from "./resources/environments.js";
import { EventsResource } from "./resources/events.js";
import { TracesResource } from "./resources/traces.js";
import { WebhooksResource } from "./resources/webhooks.js";
import { createTransport, type TransportClient } from "./transport.js";

const DEFAULT_BASE_URL = "https://api.axonpush.xyz";

const ENV_VAR_PRECEDENCE = [
  "AXONPUSH_ENVIRONMENT",
  "SENTRY_ENVIRONMENT",
  "NODE_ENV",
  "APP_ENV",
  "ENV",
] as const;

function detectEnvironment(): string | undefined {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  if (!env) return undefined;
  for (const name of ENV_VAR_PRECEDENCE) {
    const v = env[name];
    if (v && v.length > 0) return v;
  }
  return undefined;
}

export interface AxonPushOptions {
  apiKey: string;
  tenantId: string;
  baseUrl?: string;
  wsUrl?: string;
  iotEndpoint?: string;
  failOpen?: boolean;
  environment?: string;
  orgId?: string;
  appId?: string;
}

export class AxonPush {
  readonly events: EventsResource;
  readonly channels: ChannelsResource;
  readonly apps: AppsResource;
  readonly environments: EnvironmentsResource;
  readonly traces: TracesResource;
  readonly webhooks: WebhooksResource;
  readonly apiKeys: ApiKeysResource;

  private readonly api: TransportClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tenantId: string;
  private readonly failOpen: boolean;
  private readonly wsUrl: string | undefined;
  private readonly iotEndpoint: string | undefined;
  private readonly orgId: string;
  private readonly appId: string;
  readonly environment: string | undefined;

  constructor(opts: AxonPushOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = opts.apiKey;
    this.tenantId = opts.tenantId;
    this.failOpen = opts.failOpen ?? true;
    this.environment = opts.environment ?? detectEnvironment();
    this.wsUrl = opts.wsUrl;
    this.iotEndpoint = opts.iotEndpoint;
    this.orgId = opts.orgId ?? opts.tenantId;
    this.appId = opts.appId ?? "default";

    if (this.environment) {
      const source = opts.environment ? "parameter" : "env var";
      logger.debug(`AxonPush environment=${this.environment} (resolved from ${source})`);
    }

    this.api = createTransport({
      apiKey: opts.apiKey,
      tenantId: opts.tenantId,
      baseUrl: this.baseUrl,
      failOpen: this.failOpen,
      environment: this.environment,
      ...(this.wsUrl ? { wsUrl: this.wsUrl } : {}),
      ...(this.iotEndpoint ? { iotEndpoint: this.iotEndpoint } : {}),
    });

    const headers: Record<string, string> = {
      "X-API-Key": opts.apiKey,
      "x-tenant-id": opts.tenantId,
    };
    if (this.environment) {
      headers["X-Axonpush-Environment"] = this.environment;
    }

    this.events = new EventsResource(this.api, this.failOpen, this.environment);
    this.channels = new ChannelsResource(this.api, this.failOpen, {
      baseUrl: this.baseUrl,
      headers,
      orgId: this.orgId,
      appId: this.appId,
    });
    this.apps = new AppsResource(this.api, this.failOpen);
    this.environments = new EnvironmentsResource(this.api, this.failOpen);
    this.traces = new TracesResource(this.api, this.failOpen);
    this.webhooks = new WebhooksResource(this.api, this.failOpen);
    this.apiKeys = new ApiKeysResource(this.api, this.failOpen);
  }

  connectWebSocket(): RealtimeClient {
    return this.connectRealtime();
  }

  connectRealtime(): RealtimeClient {
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "x-tenant-id": this.tenantId,
    };
    if (this.environment) headers["X-Axonpush-Environment"] = this.environment;
    return new RealtimeClient({
      baseUrl: this.baseUrl,
      headers,
      orgId: this.orgId,
      appId: this.appId,
      ...(this.environment ? { defaultEnvironment: this.environment } : {}),
    });
  }

  withEnvironment<T>(environment: string, fn: () => T): T {
    return withEnvironment(environment, fn);
  }

  [Symbol.dispose](): void {}
}
