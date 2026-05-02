/**
 * Public model aliases over the auto-generated `_internal/api/types.gen.ts`.
 *
 * Importers should use these names rather than reaching into the
 * private `_internal` package directly. Names are stable across the
 * public API; field changes still flow through codegen.
 *
 * Note: `EventType` is the inline union literal extracted from
 * `CreateEventDto.eventType` because the generator does not emit a
 * standalone `CreateEventDtoEventType` for inline enums.
 *
 * Trace summary/list shapes are inline in the generated controller
 * response types; we re-export the response wrapper aliases.
 */

export type {
  ApiKeyCreateResponseDto,
  ApiKeyResponseDto as ApiKey,
  AppResponseDto as App,
  ChannelResponseDto as Channel,
  CreateEventDto,
  EnvironmentResponseDto as Environment,
  EventIngestResponseDto as Event,
  EventListResponseDto,
  EventResponseDto as EventDetails,
  OrganizationResponseDto as Organization,
  UserResponseDto as User,
  WebhookDeliveryResponseDto as WebhookDelivery,
  WebhookEndpointCreateResponseDto,
  WebhookEndpointResponseDto as WebhookEndpoint,
} from "./_internal/api/types.gen.js";

import type {
  CreateEventDto as _CreateEventDto,
  TraceControllerGetTraceSummaryResponse,
  TraceControllerListTracesResponse,
} from "./_internal/api/types.gen.js";

/**
 * The set of canonical event-type discriminators accepted by
 * {@link EventsResource.publish}. Generated as an inline union literal on
 * `CreateEventDto.eventType`; aliased here for ergonomic re-use.
 */
export type EventType = NonNullable<_CreateEventDto["eventType"]>;

/**
 * One row in the paginated trace list returned by
 * {@link TracesResource.list}.
 */
export type TraceListItem = NonNullable<TraceControllerListTracesResponse>["data"][number];

/**
 * Aggregated summary for a single trace, returned by
 * {@link TracesResource.summary}.
 */
export type TraceSummary = NonNullable<TraceControllerGetTraceSummaryResponse>;
