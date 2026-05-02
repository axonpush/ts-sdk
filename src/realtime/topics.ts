/**
 * MQTT topic builders for the AxonPush 7-segment topic shape:
 *
 *   axonpush/{orgId}/{envSlug}/{appId}/{channelId}/{eventType}/{agentId}
 *
 * Mirrors the backend's `pubsub/topic-builder.ts` so SDK-built topics match
 * what the broker accepts/publishes.
 */

const PREFIX = "axonpush";
const DEFAULT_ENV = "default";
const FALLBACK_SEGMENT = "_";
const WILDCARD = "+";

export interface TopicParts {
  orgId: string;
  envSlug?: string;
  appId: string;
  channelId: string;
  eventType?: string;
  agentId?: string;
}

/**
 * Replace anything outside `[a-zA-Z0-9_-]` with `_`. Empty / nullish
 * values collapse to `_` so callers can use the result as a plain segment.
 */
export function sanitiseSegment(s: string | null | undefined): string {
  if (s === null || s === undefined || s === "") return FALLBACK_SEGMENT;
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_") || FALLBACK_SEGMENT;
}

/**
 * Build a publish-side topic. Every concrete segment is sanitised. Missing
 * `envSlug` falls back to `"default"`; missing `eventType` / `agentId` fall
 * back to `_` to match the backend.
 *
 * @param parts segments identifying where the event lives
 * @returns the 7-segment publish topic
 */
export function buildPublishTopic(parts: TopicParts): string {
  return [
    PREFIX,
    sanitiseSegment(parts.orgId),
    parts.envSlug && parts.envSlug !== "" ? sanitiseSegment(parts.envSlug) : DEFAULT_ENV,
    sanitiseSegment(parts.appId),
    sanitiseSegment(parts.channelId),
    sanitiseSegment(parts.eventType),
    sanitiseSegment(parts.agentId),
  ].join("/");
}

/**
 * Build a subscribe-side topic. Missing optional segments become the MQTT
 * single-level wildcard (`+`); concrete segments are sanitised.
 *
 * @param parts orgId is required; everything else may be omitted
 * @returns the 7-segment subscribe topic, possibly containing wildcards
 */
export function buildSubscribeTopic(parts: Partial<TopicParts> & { orgId: string }): string {
  const wildcardOr = (v: string | undefined): string =>
    v === undefined || v === "" ? WILDCARD : sanitiseSegment(v);
  return [
    PREFIX,
    sanitiseSegment(parts.orgId),
    wildcardOr(parts.envSlug),
    wildcardOr(parts.appId),
    wildcardOr(parts.channelId),
    wildcardOr(parts.eventType),
    wildcardOr(parts.agentId),
  ].join("/");
}
