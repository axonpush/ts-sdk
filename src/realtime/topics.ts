export interface TopicParts {
  orgId: string;
  appId: string;
  channelId: string | number;
  envSlug?: string;
  eventType?: string;
  agentId?: string;
}

const WILDCARD = "+";

export function buildSubscribeTopic(parts: TopicParts): string {
  const envSlug = parts.envSlug ?? WILDCARD;
  const eventType = parts.eventType ?? WILDCARD;
  const agentId = parts.agentId ?? WILDCARD;
  return `axonpush/${parts.orgId}/${envSlug}/${parts.appId}/${parts.channelId}/${eventType}/${agentId}`;
}

export function buildPublishTopic(
  parts: Required<Omit<TopicParts, "envSlug" | "eventType" | "agentId">> & {
    envSlug: string;
    eventType: string;
    agentId: string;
  },
): string {
  return `axonpush/${parts.orgId}/${parts.envSlug}/${parts.appId}/${parts.channelId}/${parts.eventType}/${parts.agentId}`;
}
