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
 * Canonical event-type discriminators accepted by
 * {@link EventsResource.publish}. Backend defines a fixed enum
 * (`agent.tool_call.start`, `agent.handoff`, `app.log`, etc.) but
 * downstream consumers also dispatch on user-defined strings; this
 * alias widens to `string` while keeping the canonical members in
 * editor autocomplete via the `string & {}` no-op intersection.
 */
export type EventType = NonNullable<_CreateEventDto["eventType"]> | (string & {});

/** Just the canonical (closed) backend enum without the string widening. */
export type CanonicalEventType = NonNullable<_CreateEventDto["eventType"]>;

/** Status enum for {@link WebhookDelivery.status}. */
export type WebhookDeliveryStatus = NonNullable<
  import("./_internal/api/types.gen.js").WebhookDeliveryResponseDto["status"]
>;

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
