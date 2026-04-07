import { type SSESubscribeOptions, SSESubscription } from "../realtime/sse.js";
import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type Channel = components["schemas"]["Channel"];

export class ChannelsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
    private baseUrl: string,
    private headers: Record<string, string>,
  ) {}

  async create(name: string, appId: number): Promise<Channel | undefined> {
    const { data } = await this.api.POST("/channel", {
      body: { name, appId },
    });
    return data;
  }

  async get(id: number): Promise<Channel | undefined> {
    const { data } = await this.api.GET("/channel/{id}", {
      params: { path: { id } },
    });
    return data;
  }

  async update(id: number): Promise<void> {
    await this.api.PUT("/channel/{id}", {
      params: { path: { id } },
    });
  }

  async delete(id: number): Promise<void> {
    await this.api.DELETE("/channel/{id}", {
      params: { path: { id } },
    });
  }

  subscribe(channelId: number, opts?: SSESubscribeOptions): SSESubscription {
    const params = new URLSearchParams();
    if (opts?.agentId) params.set("agentId", opts.agentId);
    if (opts?.eventType) params.set("eventType", opts.eventType);
    if (opts?.traceId) params.set("traceId", opts.traceId);

    const qs = params.toString();
    const url = `${this.baseUrl}/channel/${channelId}/subscribe${qs ? `?${qs}` : ""}`;
    return new SSESubscription(url, this.headers);
  }

  subscribeToEvent(
    channelId: number,
    eventIdentifier: string,
    opts?: SSESubscribeOptions,
  ): SSESubscription {
    const params = new URLSearchParams();
    if (opts?.agentId) params.set("agentId", opts.agentId);
    if (opts?.eventType) params.set("eventType", opts.eventType);
    if (opts?.traceId) params.set("traceId", opts.traceId);

    const qs = params.toString();
    const url = `${this.baseUrl}/channel/${channelId}/${eventIdentifier}/subscribe${qs ? `?${qs}` : ""}`;
    return new SSESubscription(url, this.headers);
  }
}
