import { currentEnvironment } from "../environment.js";
import type { components } from "../schema";
import { getOrCreateTrace } from "../tracing.js";
import type { TransportClient } from "../transport.js";

type Event = components["schemas"]["EventResponseDto"];
type EventIngestResponse = components["schemas"]["EventIngestResponseDto"];
type CreateEventDto = components["schemas"]["CreateEventDto"];

export type PublishParams = Omit<CreateEventDto, "channel_id" | "sync"> & {
  channelId: string | number;
  environment?: string;
  sync?: boolean;
};

export interface EventQueryParams {
  channelId?: string | number;
  appId?: string;
  environmentId?: string;
  eventType?: string | string[];
  agentId?: string;
  traceId?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  payloadFilter?: Record<string, unknown>;
  environment?: string;
}

export interface EventListPage {
  data: Event[];
  cursor?: string;
}

const DEFAULT_LIMIT = 100;

export class EventsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
    private defaultEnvironment?: string,
  ) {}

  async publish(params: PublishParams): Promise<EventIngestResponse | undefined> {
    const trace = getOrCreateTrace(params.traceId);
    const spanId = params.spanId ?? trace.nextSpanId();

    const effectiveEnv = params.environment ?? currentEnvironment() ?? this.defaultEnvironment;
    const init: RequestInit | undefined = effectiveEnv
      ? { headers: { "X-Axonpush-Environment": effectiveEnv } }
      : undefined;

    const body: CreateEventDto = {
      identifier: params.identifier,
      payload: params.payload,
      channel_id: String(params.channelId),
      eventType: params.eventType ?? "custom",
      sync: params.sync ?? false,
      ...(params.agentId ? { agentId: params.agentId } : {}),
      traceId: trace.traceId,
      spanId,
      ...(params.parentEventId ? { parentEventId: params.parentEventId } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(effectiveEnv ? { environment: effectiveEnv } : {}),
    };

    const { data } = await this.api.POST("/event", {
      body,
      ...(init ? { init } : {}),
    });
    return data;
  }

  async list(channelId: string | number, params: EventQueryParams = {}): Promise<EventListPage> {
    const merged: EventQueryParams = { ...params, channelId };
    return this.runQuery("/event/{channelId}/list", { channelId: String(channelId) }, merged);
  }

  async search(params: EventQueryParams = {}): Promise<EventListPage> {
    return this.runQuery("/events/search", undefined, params);
  }

  private async runQuery(
    path: string,
    pathParams: Record<string, string> | undefined,
    params: EventQueryParams,
  ): Promise<EventListPage> {
    const effectiveEnv = params.environment ?? currentEnvironment() ?? this.defaultEnvironment;
    const query = serializeEventQuery(params);
    if (effectiveEnv) query.environment = effectiveEnv;

    const requestPath = pathParams
      ? Object.entries(pathParams).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), path)
      : path;

    const url = appendQuery(requestPath, query);
    const { data } = await (
      this.api as unknown as {
        GET: (
          url: string,
          opts?: Record<string, unknown>,
        ) => Promise<{ data?: { data?: Event[]; meta?: unknown; cursor?: string } }>;
      }
    ).GET(url);

    if (Array.isArray(data)) return { data: data as Event[] };
    const events = (data?.data ?? []) as Event[];
    const cursor = (data as { cursor?: string } | undefined)?.cursor;
    return { data: events, ...(cursor ? { cursor } : {}) };
  }
}

export function serializeEventQuery(params: EventQueryParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.channelId !== undefined) out.channelId = String(params.channelId);
  if (params.appId !== undefined) out.appId = String(params.appId);
  if (params.environmentId) out.environmentId = params.environmentId;
  if (params.agentId) out.agentId = params.agentId;
  if (params.traceId) out.traceId = params.traceId;
  if (params.since) out.since = params.since;
  if (params.until) out.until = params.until;
  if (params.cursor) out.cursor = params.cursor;
  out.limit = String(params.limit ?? DEFAULT_LIMIT);

  if (params.eventType) {
    out.eventType = Array.isArray(params.eventType) ? params.eventType.join(",") : params.eventType;
  }

  if (params.payloadFilter && Object.keys(params.payloadFilter).length > 0) {
    out.payloadFilter = JSON.stringify(params.payloadFilter);
  }
  return out;
}

function appendQuery(path: string, query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return path;
  const search = new URLSearchParams();
  for (const [k, v] of entries) search.set(k, v);
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${search.toString()}`;
}
