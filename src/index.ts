/**
 * AxonPush — real-time event infrastructure for AI agent systems.
 *
 * Top-level package. Public API is re-exported here; internal helpers
 * live under `./_internal` and are not part of the supported surface.
 */

// Core (Stream A)
export { AxonPush } from "./client";
export type { AxonPushOptions } from "./config";
export {
  APIConnectionError,
  AuthenticationError,
  AxonPushError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  RetryableError,
  ServerError,
  ValidationError,
} from "./errors";
// Integrations — primitives + helpers (Stream D).
// Framework-specific installers are reachable via
// `@axonpush/sdk/integrations/<name>` per package.json `exports`.
export {
  type ChannelIdInput,
  coerceChannelId,
  type IntegrationConfig,
  safePublish,
  truncate,
} from "./integrations/_base";
export {
  BullMQPublisher,
  type BullMQPublisherOptions,
  type BullMQWorkerOptions,
  createBullMQWorker,
} from "./integrations/_bullmq_publisher";
export {
  BackgroundPublisher,
  type BackgroundPublisherOptions,
  DEFAULT_QUEUE_SIZE,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  detectServerless,
  type Flushable,
  flushAfterInvocation,
  type OverflowPolicy,
  type PublisherMode,
} from "./integrations/_publisher";
export { AxonPushAnthropicTracer } from "./integrations/anthropic";
export {
  type ConsoleCaptureConfig,
  type ConsoleCaptureHandle,
  setupConsoleCapture,
} from "./integrations/console";
export { axonPushADKCallbacks } from "./integrations/google-adk";
export { AxonPushCallbackHandler } from "./integrations/langchain";
export { AxonPushLangGraphHandler } from "./integrations/langgraph";
export { AxonPushLlamaIndexHandler } from "./integrations/llamaindex";
export { AxonPushMastraHooks } from "./integrations/mastra";
export { AxonPushRunHooks } from "./integrations/openai-agents";
export { AxonPushSpanExporter, type OtelExporterConfig } from "./integrations/otel";
export {
  type AxonPushPinoStream,
  createAxonPushPinoStream,
  type PinoStreamConfig,
} from "./integrations/pino";
export {
  buildDsn as buildSentryDsn,
  type InstallSentryOptions,
  installSentry,
  type SentryLike,
} from "./integrations/sentry";
export { axonPushMiddleware } from "./integrations/vercel-ai";
export {
  createAxonPushWinstonTransport,
  type WinstonTransportConfig,
} from "./integrations/winston";
// Models + Resources (Stream B)
export type {
  ApiKey,
  App,
  Channel,
  CreateEventDto,
  Environment,
  Event,
  EventDetails,
  EventListResponseDto,
  EventType,
  Organization,
  TraceListItem,
  TraceSummary,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreateResponseDto,
} from "./models";
export type {
  IotCredentials,
  PublishData,
  RealtimeOptions,
  SubscribeFilters,
  TopicParts,
} from "./realtime";
// Realtime (Stream C)
export { RealtimeClient } from "./realtime";
export { ApiKeysResource } from "./resources/api-keys";
export { AppsResource } from "./resources/apps";
export { ChannelsResource } from "./resources/channels";
export { EnvironmentsResource } from "./resources/environments";
export { EventsResource } from "./resources/events";
export { OrganizationsResource } from "./resources/organizations";
export { TracesResource } from "./resources/traces";
export { WebhooksResource } from "./resources/webhooks";
export { currentTrace, getOrCreateTrace, TraceContext } from "./tracing";
export { __version__ } from "./version";
