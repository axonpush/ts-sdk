import {
  eventControllerCreateEvent,
  eventControllerListEvents,
  eventsSearchControllerSearch,
} from "../_internal/api/sdk.gen.js";
import type {
  CreateEventDto,
  EventControllerListEventsData,
  EventsSearchControllerSearchData,
} from "../_internal/api/types.gen.js";
import type { Event, EventDetails, EventListResponseDto, EventType } from "../models.js";
import type { ResourceClient } from "./_client.js";

/** Parameters accepted by {@link EventsResource.publish}. */
export interface PublishParams {
  /** Stable, caller-supplied identifier — used for dedupe. */
  identifier: string;
  /** Free-form JSON body. */
  payload: Record<string, unknown>;
  /** Channel UUID this event belongs to. */
  channelId: string;
  /** Logical agent that produced this event. */
  agentId?: string;
  /** Trace UUID to attach this event to. Auto-generated when omitted. */
  traceId?: string;
  /** Span ID. Auto-generated from the trace context when omitted. */
  spanId?: string;
  /** Parent event ID — used to model hand-offs. */
  parentEventId?: string;
  /** Discriminator. Defaults to `"custom"` when omitted. */
  eventType?: EventType;
  /** Free-form metadata. */
  metadata?: Record<string, unknown>;
  /**
   * Environment slug override. Only honoured when the API key has
   * `allowEnvironmentOverride=true`. Falls through to the client's
   * default environment when omitted.
   */
  environment?: string;
  /**
   * When true, wait for the event to be persisted to the DB before
   * returning. Use only for audit-critical calls.
   */
  sync?: boolean;
}

/** Common pagination/filter options for {@link EventsResource.list} & {@link EventsResource.search}. */
export interface EventListParams {
  payloadFilter?: string;
  /** 1–1000. Defaults server-side to 100. */
  limit?: number;
  cursor?: string;
  /** ISO 8601 datetime (exclusive upper bound). */
  until?: string;
  /** ISO 8601 datetime (inclusive lower bound). */
  since?: string;
  traceId?: string;
  agentId?: string;
  /** Repeat or comma-separate to filter by multiple event types. */
  eventType?: string[];
  environment?: string;
}

/** Search-specific filters (cross-channel). */
export interface EventSearchParams extends EventListParams {
  source?: string;
  channelId?: string;
  appId?: string;
}

/**
 * Publish, list, and search events.
 *
 * Resources never throw on transport errors when the client was
 * constructed with `failOpen=true` (the default). Callers receive
 * `null` instead.
 */
export class EventsResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * Publish a single event to a channel.
   *
   * @param params - Event parameters; see {@link PublishParams}.
   * @returns The persisted event ingest response, or `null` when fail_open swallowed a transport error.
   * @throws {AxonPushError} when fail_open is false and the call fails.
   */
  async publish(params: PublishParams): Promise<Event | null> {
    const trace = this.client.getOrCreateTrace(params.traceId);
    const body: CreateEventDto = {
      identifier: params.identifier,
      payload: params.payload,
      channel_id: params.channelId,
      traceId: trace.traceId,
      spanId: params.spanId ?? trace.nextSpanId(),
      eventType: (params.eventType ?? "custom") as CreateEventDto["eventType"],
      sync: params.sync ?? false,
      ...(params.agentId !== undefined ? { agentId: params.agentId } : {}),
      ...(params.parentEventId !== undefined ? { parentEventId: params.parentEventId } : {}),
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      ...((params.environment ?? this.client.environment)
        ? { environment: params.environment ?? this.client.environment }
        : {}),
    };
    return this.client.invoke(eventControllerCreateEvent, { body });
  }

  /**
   * List events on a single channel, ordered newest-first.
   *
   * @param channelId - Channel UUID.
   * @param params - Optional pagination & filter parameters.
   * @returns Paginated list response, or `null` on fail-open error.
   */
  async list(
    channelId: string,
    params: EventListParams = {},
  ): Promise<EventListResponseDto | null> {
    const args: Omit<EventControllerListEventsData, "url"> = {
      path: { channelId },
      query: this.buildListQuery(params),
    };
    return this.client.invoke(eventControllerListEvents, args);
  }

  /**
   * Search events across channels using server-side filters.
   *
   * @param params - Optional pagination & filter parameters.
   * @returns Paginated search response, or `null` on fail-open error.
   */
  async search(params: EventSearchParams = {}): Promise<EventListResponseDto | null> {
    const args: Omit<EventsSearchControllerSearchData, "url"> = {
      query: this.buildSearchQuery(params),
    };
    return this.client.invoke(eventsSearchControllerSearch, args);
  }

  private buildListQuery(p: EventListParams): EventControllerListEventsData["query"] {
    const env = p.environment ?? this.client.environment;
    return {
      ...(p.payloadFilter !== undefined ? { payloadFilter: p.payloadFilter } : {}),
      ...(p.limit !== undefined ? { limit: p.limit } : {}),
      ...(p.cursor !== undefined ? { cursor: p.cursor } : {}),
      ...(p.until !== undefined ? { until: p.until } : {}),
      ...(p.since !== undefined ? { since: p.since } : {}),
      ...(p.traceId !== undefined ? { traceId: p.traceId } : {}),
      ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
      ...(p.eventType !== undefined ? { eventType: p.eventType } : {}),
      ...(env !== undefined ? { environment: env } : {}),
    };
  }

  private buildSearchQuery(p: EventSearchParams): EventsSearchControllerSearchData["query"] {
    const env = p.environment ?? this.client.environment;
    return {
      ...(p.source !== undefined ? { source: p.source } : {}),
      ...(p.channelId !== undefined ? { channelId: p.channelId } : {}),
      ...(p.appId !== undefined ? { appId: p.appId } : {}),
      ...(p.payloadFilter !== undefined ? { payloadFilter: p.payloadFilter } : {}),
      ...(p.limit !== undefined ? { limit: p.limit } : {}),
      ...(p.cursor !== undefined ? { cursor: p.cursor } : {}),
      ...(p.until !== undefined ? { until: p.until } : {}),
      ...(p.since !== undefined ? { since: p.since } : {}),
      ...(p.traceId !== undefined ? { traceId: p.traceId } : {}),
      ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
      ...(p.eventType !== undefined ? { eventType: p.eventType } : {}),
      ...(env !== undefined ? { environment: env } : {}),
    };
  }
}

export type { EventDetails };
