import { currentEnvironment } from "../environment.js";
import { type SSESubscribeOptions, SSESubscription } from "../realtime/sse.js";
import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type Channel = components["schemas"]["ChannelResponseDto"];

export interface ChannelsResourceContext {
  baseUrl: string;
  headers: Record<string, string>;
  orgId: string;
  appId: string;
}

export class ChannelsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
    private ctx: ChannelsResourceContext,
  ) {}

  async create(name: string, appId: string): Promise<Channel | undefined> {
    const { data } = await this.api.POST("/channel", {
      body: { name, appId },
    });
    return data;
  }

  async get(id: string): Promise<Channel | undefined> {
    const { data } = await this.api.GET("/channel/{id}", {
      params: { path: { id } },
    });
    return data;
  }

  async update(id: string): Promise<void> {
    await this.api.PUT("/channel/{id}", {
      params: { path: { id } },
    });
  }

  async delete(id: string): Promise<void> {
    await this.api.DELETE("/channel/{id}", {
      params: { path: { id } },
    });
  }

  subscribe(channelId: string | number, opts?: SSESubscribeOptions): SSESubscription {
    return new SSESubscription({
      channelId,
      ...(opts ? { filters: opts } : {}),
      realtimeOpts: {
        baseUrl: this.ctx.baseUrl,
        headers: this.buildHeaders(opts?.environment),
        orgId: this.ctx.orgId,
        appId: this.ctx.appId,
        ...(opts?.environment ? { defaultEnvironment: opts.environment } : {}),
      },
    });
  }

  subscribeToEvent(
    channelId: string | number,
    eventIdentifier: string,
    opts?: SSESubscribeOptions,
  ): SSESubscription {
    return new SSESubscription({
      channelId,
      eventIdentifier,
      ...(opts ? { filters: opts } : {}),
      realtimeOpts: {
        baseUrl: this.ctx.baseUrl,
        headers: this.buildHeaders(opts?.environment),
        orgId: this.ctx.orgId,
        appId: this.ctx.appId,
        ...(opts?.environment ? { defaultEnvironment: opts.environment } : {}),
      },
    });
  }

  private buildHeaders(envOverride?: string): Record<string, string> {
    const env = envOverride ?? currentEnvironment();
    if (!env) return this.ctx.headers;
    return { ...this.ctx.headers, "X-Axonpush-Environment": env };
  }
}
