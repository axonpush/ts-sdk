import { currentEnvironment } from "../environment.js";
import type { components } from "../schema";
import { getOrCreateTrace } from "../tracing.js";
import type { TransportClient } from "../transport.js";

type Event = components["schemas"]["Event"];
type CreateEventDto = components["schemas"]["CreateEventDto"];

export type PublishParams = Omit<CreateEventDto, "channel_id"> & {
  channelId: number;
  environment?: string;
  /** Force the server's synchronous write path for this call. Default is
   * async — the server returns a {identifier, queued: true} shape and the
   * event persists ~100ms later. Use sync=true for audit-critical writes. */
  sync?: boolean;
};

export class EventsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
    private defaultEnvironment?: string,
  ) {}

  async publish(params: PublishParams): Promise<Event | undefined> {
    const trace = getOrCreateTrace(params.traceId);
    const spanId = params.spanId ?? trace.nextSpanId();

    const effectiveEnv = params.environment ?? currentEnvironment() ?? this.defaultEnvironment;
    const init: RequestInit | undefined = effectiveEnv
      ? { headers: { "X-Axonpush-Environment": effectiveEnv } }
      : undefined;

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
        environment: effectiveEnv,
        ...(params.sync ? { sync: true } : {}),
      },
      ...(init ? { init } : {}),
    });
    return data;
  }

  async list(
    channelId: number,
    opts: { page?: number; limit?: number; environment?: string } = {},
  ): Promise<Event[]> {
    const effectiveEnv = opts.environment ?? currentEnvironment() ?? this.defaultEnvironment;
    const { data } = await this.api.GET("/event/{channelId}/list", {
      params: {
        path: { channelId },
        query: {
          page: opts.page ?? 1,
          limit: opts.limit ?? 10,
          ...(effectiveEnv ? { environment: effectiveEnv } : {}),
        },
      },
    });
    return (data as Event[] | undefined) ?? [];
  }
}
