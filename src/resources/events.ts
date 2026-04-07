import type { components } from "../schema";
import { getOrCreateTrace } from "../tracing.js";
import type { TransportClient } from "../transport.js";

type Event = components["schemas"]["Event"];
type CreateEventDto = components["schemas"]["CreateEventDto"];

export type PublishParams = Omit<CreateEventDto, "channel_id"> & {
  channelId: number;
};

export class EventsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async publish(params: PublishParams): Promise<Event | undefined> {
    const trace = getOrCreateTrace(params.traceId);
    const spanId = params.spanId ?? trace.nextSpanId();

    const { data } = await this.api.POST("/event", {
      body: {
        identifier: params.identifier,
        payload: params.payload,
        channel_id: params.channelId,
        agentId: params.agentId,
        traceId: trace.traceId,
        spanId,
        parentEventId: params.parentEventId,
        eventType: params.eventType ?? "custom",
        metadata: params.metadata,
      },
    });
    return data;
  }

  async list(channelId: number, opts: { page?: number; limit?: number } = {}): Promise<Event[]> {
    const { data } = await this.api.GET("/event/{channelId}/list", {
      params: {
        path: { channelId },
        query: { page: opts.page ?? 1, limit: opts.limit ?? 10 },
      },
    });
    return (data as Event[] | undefined) ?? [];
  }
}
