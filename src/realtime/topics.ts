export interface TopicParts {
  orgId: string;
  appId: string;
  channelId: string | number;
  eventType?: string;
  agentId?: string;
}

const WILDCARD = "+";

export function buildSubscribeTopic(parts: TopicParts): string {
  const eventType = parts.eventType ?? WILDCARD;
  const agentId = parts.agentId ?? WILDCARD;
  return `axonpush/${parts.orgId}/${parts.appId}/${parts.channelId}/${eventType}/${agentId}`;
}

export function buildPublishTopic(
  parts: Required<Omit<TopicParts, "eventType" | "agentId">> & {
    eventType: string;
    agentId: string;
  },
): string {
  return `axonpush/${parts.orgId}/${parts.appId}/${parts.channelId}/${parts.eventType}/${parts.agentId}`;
}
