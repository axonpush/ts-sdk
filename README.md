# @axonpush/sdk

TypeScript SDK for [AxonPush](https://axonpush.xyz) — real-time event infrastructure for AI agent systems. ESM-only; works in Node and browser runtimes.

## Install

```bash
bun add @axonpush/sdk
```

```bash
npm install @axonpush/sdk
```

> **v0.1.0 is a breaking release.** The realtime transport moved from Socket.IO/SSE to MQTT-over-WSS against AWS IoT Core, and `events.search()` / `events.list()` no longer accept a Lucene `q` string. See [Migrating from 0.0.x](#migrating-from-00x).

## Quick Start

```ts
import { AxonPush } from "@axonpush/sdk";

const client = new AxonPush({
  apiKey: "ak_...",
  tenantId: "1",
  orgId: "org_123",
  appId: "app_456",
  environment: "production",
});

// publish via REST
await client.events.publish({
  identifier: "task.started",
  payload: { task: "summarize article" },
  channelId: 1,
  agentId: "research-agent",
  eventType: "agent.start",
});

// subscribe via MQTT
const realtime = client.connectRealtime();
await realtime.connect();
realtime.onEvent((event) => {
  console.log(event.identifier, event.payload);
});
realtime.subscribe(1, { eventType: "agent.start" });
await realtime.wait();
```

### Response shape

By default, `events.publish()` returns as soon as the server has queued the event — typically under 1&nbsp;ms. The returned event carries `identifier`, `queued: true`, `createdAt`, and the resolved `environmentId`, but **not** a DB-assigned `id` (`event.id` is `undefined`). Treat `event.identifier` and `event.traceId` as the durable correlation keys. List endpoints and subscriptions return the fully-persisted shape (with `id`) once the event is written. If you need an audit-critical write, pass `sync: true` on the publish call to force the server's synchronous write path.

## Configuration

```ts
const client = new AxonPush({
  apiKey: "ak_...",          // required
  tenantId: "1",             // required
  orgId: "org_123",          // optional, defaults to tenantId
  appId: "app_456",          // optional, defaults to "default"
  baseUrl: "https://...",    // default: https://api.axonpush.xyz
  iotEndpoint: "...",        // optional override; otherwise auto-fetched
  wsUrl: "...",              // optional override for the realtime WSS URL
  failOpen: true,            // default: true — suppresses errors with warnings
  environment: "production", // optional, auto-detected from env vars if omitted
});
```

`iotEndpoint` and `wsUrl` are advanced overrides — by default the SDK fetches a short-lived presigned WSS URL from `GET /auth/iot-credentials` on each `connect()` and refreshes it 60 seconds before expiry. `orgId` and `appId` form the MQTT topic prefix `axonpush/<orgId>/<appId>/<channelId>/<eventType>/<agentId>`.

## Environments

Tag every event with the environment it came from (`"production"`, `"staging"`, `"eval"`, or any string your team uses). AxonPush uses the tag server-side for isolation, filtering, and per-env quotas. The SDK forwards it as an `X-Axonpush-Environment` header on every request.

### Constructor

```ts
const client = new AxonPush({ apiKey: "ak_...", tenantId: "1", environment: "production" });
```

If you omit `environment`, the SDK auto-detects it from the first of these that's set: **`AXONPUSH_ENVIRONMENT`** → `SENTRY_ENVIRONMENT` → `NODE_ENV` → `APP_ENV` → `ENV`. That ordering means existing Sentry/12-factor setups work out of the box, and you can override with `AXONPUSH_ENVIRONMENT` when you need to.

### Per-call override

```ts
await client.events.publish({
  identifier: "rerun_eval",
  payload: { dataset: "v2" },
  channelId: 1,
  environment: "eval",  // this event only — doesn't change the client default
});
```

### Scoped override with `withEnvironment`

Useful for isolating eval runs, backfills, or shadow traffic from your production event stream without constructing a second client. Propagates through nested async calls via `AsyncLocalStorage`:

```ts
await client.withEnvironment("eval", async () => {
  for (const row of dataset) {
    await client.events.publish({
      identifier: "row_processed",
      payload: { id: row.id },
      channelId: 1,
    });
  }
});
// outside the callback: environment reverts to whatever the client was constructed with
```

Resolution order on every publish: **per-call `environment` arg → `withEnvironment` scope → ctor `environment` → env-var autodetect**.

## Resources

### Apps

```ts
const app = await client.apps.create("my-app");
const apps = await client.apps.list();
const found = await client.apps.get(1);
await client.apps.update(1, "new-name");
await client.apps.delete(1);
```

### Channels

```ts
const channel = await client.channels.create("events", appId);
const found = await client.channels.get(1);
await client.channels.update(1);
await client.channels.delete(1);
```

### Events

#### Publishing

```ts
await client.events.publish({
  identifier: "agent.task",
  payload: { key: "value" },
  channelId: 1,
  agentId: "my-agent",
  traceId: "tr_abc123",        // optional, auto-generated if omitted
  eventType: "agent.start",    // "agent.start" | "agent.end" | "agent.message" | "agent.tool_call.start" | "agent.tool_call.end" | "agent.error" | "agent.handoff" | "agent.llm.token" | "custom"
  metadata: { custom: "data" },
});
```

#### Searching (REST)

`events.list()` and `events.search()` take a typed `EventQueryParams`:

```ts
const page = await client.events.list(channelId, {
  eventType: "agent.error",
  agentId: "my-agent",
  traceId: "tr_abc123",
  since: "2026-04-01T00:00:00Z",
  until: "2026-04-29T00:00:00Z",
  limit: 50,
  cursor: previousPage.cursor,
});
```

`payloadFilter` accepts MongoDB-style operators (validated server-side via `sift.js`) and is JSON-stringified into the query string:

```ts
const errors = await client.events.search({
  channelId: 1,
  eventType: "agent.error",
  payloadFilter: {
    "user.id": { $eq: "u_123" },
    "retries":  { $gte: 3 },
  },
  limit: 100,
});
```

The Lucene `q: "..."` parameter is gone — translate any prior queries into the structured shape above.

### Traces

```ts
const traces = await client.traces.list({ page: 1, limit: 20 });
const events = await client.traces.getEvents("tr_abc123");
const summary = await client.traces.getSummary("tr_abc123");
const stats = await client.traces.getStats();
```

### Webhooks

```ts
const endpoint = await client.webhooks.createEndpoint({
  url: "https://example.com/webhook",
  channelId: 1,
  secret: "whsec_...",
  eventTypes: ["agent.error"],
  description: "Error alerts",
});

const endpoints = await client.webhooks.listEndpoints(channelId);
const deliveries = await client.webhooks.getDeliveries(endpointId);
await client.webhooks.deleteEndpoint(1);
```

### API Keys

```ts
const key = await client.apiKeys.create({
  name: "my-key",
  organizationId: 1,
  scopes: ["publish", "subscribe"],
});

const keys = await client.apiKeys.list();
await client.apiKeys.revoke(1);
```

## Real-time (MQTT)

Realtime uses MQTT-over-WSS against AWS IoT Core. Topics follow the shape:

```
axonpush/<orgId>/<appId>/<channelId>/<eventType>/<agentId>
```

When you call `subscribe()` without filters, the SDK substitutes `+` (single-segment wildcard) for `eventType` / `agentId`, so a bare subscribe receives every event on the channel; passing filters narrows the topic and AWS IoT does the matching.

```ts
const realtime = client.connectRealtime();   // or client.connectWebSocket() — same class
await realtime.connect();

realtime.onEvent((event) => {
  console.log(event.identifier, event.payload);
});

realtime.subscribe(channelId, { eventType: "agent.error" });
realtime.subscribe(channelId, { agentId: "research-agent" });

realtime.publish({
  channelId: 1,
  identifier: "task.update",
  payload: { status: "running" },
  eventType: "custom",
  agentId: "controller",
});

realtime.unsubscribe(channelId, { eventType: "agent.error" });

await realtime.wait();         // resolves when disconnect() is called
await realtime.disconnect();
```

The class is exported as both `RealtimeClient` and `WebSocketClient` (the latter is a subclass alias kept for back-compat with code that imported `WebSocketClient` from 0.0.x). They behave identically.

### Credential lifecycle

`connect()` calls `GET /auth/iot-credentials` (using your API key + tenant ID), receives a presigned WSS URL with embedded SigV4 query params, and connects `mqtt.js` to it. A timer fires 60 seconds before the credential expiry, fetches a new presigned URL, opens a fresh MQTT client, swaps it in, and tears down the old connection — re-subscribing all live topics on the new client.

If a refresh fails, the SDK retries after 30 seconds and logs a warning via `consola`. `mqtt.js`'s own auto-reconnect handles transient socket-level drops; credential expiry is handled by the SDK's swap.

## Distributed Tracing

Trace context propagates automatically via `AsyncLocalStorage`:

```ts
import { withTrace, currentTrace, getOrCreateTrace } from "@axonpush/sdk";

withTrace("tr_my_trace", async () => {
  // all events published here share this trace ID
  await client.events.publish({ ... });

  const trace = currentTrace();
  console.log(trace?.traceId);       // "tr_my_trace"
  console.log(trace?.nextSpanId());  // "sp_my_trace_0001"
});

// auto-generated trace
const trace = getOrCreateTrace();
console.log(trace.traceId); // "tr_<random>"
```

## Publishing Modes

Every integration (framework callbacks and logging sinks) accepts a `mode` parameter that controls how events reach AxonPush:

| Mode | Backend | Best for |
|------|---------|----------|
| `"background"` (default) | In-process bounded queue drained by a single async loop | Most apps — zero config, O(microseconds) on the hot path |
| `"bullmq"` | Redis-backed [BullMQ](https://docs.bullmq.io/) | Durable delivery, serverless, high volume |
| `"sync"` | Direct HTTP call | Debugging, tests |

### BullMQ mode

Offload event publishing to a separate worker process backed by Redis. Events survive app restarts and are retried on transient failures.

```bash
bun add bullmq
```

```ts
import IORedis from "ioredis";
import { AxonPush, AxonPushCallbackHandler } from "@axonpush/sdk";

const client = new AxonPush({ apiKey: "ak_...", tenantId: "1" });
const connection = new IORedis("redis://localhost:6379", { maxRetriesPerRequest: null });

const handler = new AxonPushCallbackHandler({
  client,
  channelId: 1,
  mode: "bullmq",
  bullmqOptions: { connection, queueName: "axonpush" },
});
await chain.invoke({ input: "..." }, { callbacks: [handler] });
```

Start a worker to drain the queue in a separate process:

```ts
// worker.ts
import IORedis from "ioredis";
import { AxonPush, createBullMQWorker } from "@axonpush/sdk";

const client = new AxonPush({ apiKey: process.env.AXONPUSH_API_KEY!, tenantId: "1" });
const connection = new IORedis("redis://localhost:6379", { maxRetriesPerRequest: null });

const worker = await createBullMQWorker({ client, connection, queueName: "axonpush" });
process.once("SIGTERM", () => worker.close());
```

`bullmqOptions` accepts the same `connection`, `queueName`, and `jobOptions` (attempts, removeOnComplete, removeOnFail, etc.) on every integration — pino stream, winston transport, console capture, OTel exporter, and all framework callbacks.

## Framework Integrations

All integrations share a common config:

```ts
import type { IntegrationConfig } from "@axonpush/sdk";

const config: IntegrationConfig = {
  client,            // AxonPush instance
  channelId: 1,      // channel to publish events to
  agentId: "my-bot", // optional, defaults per framework
  traceId: "tr_...", // optional, auto-generated if omitted
  mode: "background",// optional: "background" | "sync" | "bullmq"
};
```

All integrations import from `@axonpush/sdk` and accept the `IntegrationConfig` shown above. Pick the one(s) that match your stack:

| Framework | Import | Events emitted |
|-----------|--------|----------------|
| Vercel AI SDK | `axonPushMiddleware` — wrap into `wrapLanguageModel({ middleware })` | `llm.start/end`, `llm.token` |
| LangChain.js | `AxonPushCallbackHandler` — pass via `{ callbacks: [handler] }` | `chain.*`, `llm.*`, `tool.*` |
| LangGraph.js | `AxonPushLangGraphHandler` — same callback shape | LangChain set + `graph.node.start/end` |
| OpenAI Agents | `AxonPushRunHooks` — pass as `{ hooks }` to `Runner.run` | `agent.run.start/end`, `tool.*`, `agent.handoff` |
| Anthropic SDK | `AxonPushAnthropicTracer` — wraps `messages.create` and tool results | `conversation.turn`, `tool.*`, `agent.response`, `tool.result` |
| Mastra | `AxonPushMastraHooks` — `onWorkflowStart/End`, `beforeToolUse`, `afterToolUse` | `workflow.*`, `tool.*` |
| LlamaIndex.TS | `AxonPushLlamaIndexHandler` — `onLLMStart/End`, `onRetrieverStart/End` | `llm.*`, `embedding.*`, `retriever.*`, `query.*` |
| Google ADK | `axonPushADKCallbacks` — pass to ADK agent config | `agent.*`, `llm.*`, `tool.*` |

Example (LangChain — others follow the same pattern):

```ts
import { AxonPushCallbackHandler } from "@axonpush/sdk";

const handler = new AxonPushCallbackHandler(config);
await chain.invoke({ input: "..." }, { callbacks: [handler] });
```

## Logging & Observability

Ship logs and traces from your existing Node.js observability stack to AxonPush. Four integrations are shipped: **Pino**, **Winston**, `console` capture, and an **OpenTelemetry** `SpanExporter`. All four emit OpenTelemetry-shaped payloads via REST `POST /event`, so the events line up with anything else you're already sending to an OTel-compatible backend.

> **Non-blocking by default.** Each integration submits publishes onto a bounded in-memory queue and drains them from a single background task, so `log.info(...)` stays O(microseconds) on the caller's path — no HTTP round-trip on the hot path. The queue is bounded (default 1000 records); overflow drops the oldest with a rate-limited warning. Call `.flush(timeoutMs?)` or use `flushAfterInvocation(handler, fn)` at known checkpoints (end of a Lambda invocation, end of a test) to guarantee delivery. Pass `mode: "sync"` on any integration if you need blocking publishes. A `beforeExit` / `SIGTERM` / `SIGINT` hook drains all live publishers automatically at process shutdown.

### Pino

```ts
import pino from "pino";
import { AxonPush } from "@axonpush/sdk";
import { createAxonPushPinoStream } from "@axonpush/sdk/integrations/pino";

const client = new AxonPush({ apiKey: "ak_...", tenantId: "1" });
const stream = createAxonPushPinoStream({
  client,
  channelId: 1,
  serviceName: "my-api",
});
const log = pino({ level: "info" }, stream);
log.info({ user: "alice" }, "login succeeded");
```

### Winston

```ts
import winston from "winston";
import { AxonPush } from "@axonpush/sdk";
import { createAxonPushWinstonTransport } from "@axonpush/sdk/integrations/winston";

const client = new AxonPush({ apiKey: "ak_...", tenantId: "1" });
const log = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    await createAxonPushWinstonTransport({ client, channelId: 1, serviceName: "my-api" }),
  ],
});
log.error({ message: "connection refused", user: "alice" });
```

### `console` capture

For AI agents that emit free-form output via `console.log`:

```ts
import { AxonPush } from "@axonpush/sdk";
import { setupConsoleCapture } from "@axonpush/sdk/integrations/console";

const client = new AxonPush({ apiKey: "ak_...", tenantId: "1" });
const handle = setupConsoleCapture({ client, channelId: 1, agentId: "my-agent" });

console.log("agent starting");  // captured AND still written to the terminal
handle.unpatch();  // restore the original console methods
```

### OpenTelemetry

```ts
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AxonPush } from "@axonpush/sdk";
import { AxonPushSpanExporter } from "@axonpush/sdk/integrations/otel";

const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new SimpleSpanProcessor(
    new AxonPushSpanExporter({
      client: new AxonPush({ apiKey: "ak_...", tenantId: "1" }),
      channelId: 1,
      serviceName: "my-api",
    }),
  ),
);
provider.register();
```

The exporter posts span batches to the same `/event` REST endpoint as everything else — it does not route through MQTT.

### Sentry

If your app is already using `@sentry/node`, point it at AxonPush with a one-liner. `installSentry()` builds a Sentry DSN from your AxonPush credentials and calls `Sentry.init(...)` for you — errors captured anywhere in your app (including Sentry's framework instrumentations) flow into your AxonPush channel instead of Sentry's cloud.

```bash
bun add @sentry/node   # @axonpush/sdk does not bundle Sentry
```

```ts
import * as Sentry from "@sentry/node";
import { installSentry } from "@axonpush/sdk";

installSentry(Sentry, {
  apiKey: "ak_...",
  projectId: "proj_42",
  channelId: 42,
  environment: "production",
  release: "my-app@1.2.3",
  // Any extra keys are forwarded to Sentry.init() unchanged:
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});

// That's it — Sentry.captureException / captureMessage now ship to AxonPush.
```

`apiKey`, `channelId`, and `host` fall back to `AXONPUSH_API_KEY`, `AXONPUSH_CHANNEL_ID`, and `AXONPUSH_HOST` (default `api.axonpush.xyz`) if omitted. `environment` uses the same auto-detect precedence as the client (`AXONPUSH_ENVIRONMENT` → `SENTRY_ENVIRONMENT` → `NODE_ENV` → `APP_ENV` → `ENV`). If you need a fully-formed DSN instead, pass `dsn: "..."` and the other args are ignored.

### AWS Lambda / Google Cloud Functions / Azure Functions

Serverless containers are **frozen between invocations**, so the background worker doesn't get a chance to drain while the process is paused. To guarantee delivery, call `.flush()` at the end of each invocation. The `flushAfterInvocation` helper wraps your handler and flushes in a `finally:` block:

```ts
import { AxonPush } from "@axonpush/sdk";
import {
  createAxonPushPinoStream,
  flushAfterInvocation,
} from "@axonpush/sdk/integrations/pino";

const client = new AxonPush({ apiKey: process.env.AXONPUSH_API_KEY!, tenantId: "1" });
const stream = createAxonPushPinoStream({
  client,
  channelId: Number(process.env.AXONPUSH_CHANNEL_ID_LOGGING),
  serviceName: "my-lambda",
});

export const handler = flushAfterInvocation(stream, async (event, _context) => {
  // your handler code
  return { statusCode: 200 };
});
```

Pass `[handler1, handler2, ...]` to flush multiple integrations in one wrap. The integrations auto-detect Lambda / GCF / Azure Functions at construction time and log a one-time reminder to use `flushAfterInvocation`.

An alternative strategy on serverless is `mode: "bullmq"` with a long-running worker elsewhere — `submit()` becomes a tiny Redis enqueue and you don't need per-invocation flushing at all.

### Graceful shutdown

All four integrations expose `.flush(timeoutMs?)` to drain pending records and `.close()` (or `.shutdown()` on the OTel exporter) to stop the background task. A module-level `beforeExit` / `SIGTERM` / `SIGINT` hook also closes every live publisher automatically on normal process exit — you don't need to call `.close()` explicitly in long-running servers.

### Internal logger

The SDK uses [consola](https://github.com/unjs/consola) for diagnostics. Configure log level:

```ts
import { logger } from "@axonpush/sdk";

logger.level = 0; // silent
logger.level = 3; // warnings (default)
logger.level = 5; // verbose
```

## Migrating from 0.0.x

**Realtime: Socket.IO and SSE → MQTT.** The Socket.IO `/events` namespace and the SSE `/subscribe` stream are gone. The new transport is MQTT-over-WSS to AWS IoT Core, fronted by the same `connectWebSocket()` / `connectRealtime()` calls you already had — `WebSocketClient` is an alias of `RealtimeClient` and keeps its public surface (`connect`, `subscribe`, `unsubscribe`, `publish`, `onEvent`, `disconnect`, `wait`). Remove `socket.io-client` from your `package.json` — it's no longer a dependency.

**SSE shims still work, with a deprecation warning.** `client.channels.subscribe(channelId, ...)` and `client.channels.subscribeToEvent(channelId, identifier, ...)` still return an `AsyncIterable<Event>` and accept the same options; internally they now open an MQTT connection and adapt it to the iterable. They emit a one-time `console.warn` on first use and will be removed in a future version — migrate to `RealtimeClient` for new code.

**`events.search()` / `events.list()`: no more Lucene.** The `q: "channelId:1 AND ..."` shape is gone. Replace it with the typed query object:

```ts
// 0.0.x
await client.events.search({ q: 'channelId:1 AND payload.user.id:"u_123"' });

// 0.1.x
await client.events.search({
  channelId: 1,
  payloadFilter: { "user.id": { $eq: "u_123" } },
});
```

**Constructor: new options.** `AxonPushOptions` gained `iotEndpoint`, `wsUrl`, `orgId`, and `appId`. None are required for managed AxonPush — `orgId` defaults to `tenantId` and `appId` defaults to `"default"`. Selfhost deployments will typically pass all four.

## Error Handling

When `failOpen: true` (default), errors are logged as warnings and methods return `undefined`. When `failOpen: false`, errors are thrown:

```ts
import { AxonPushError, AuthenticationError, RateLimitError } from "@axonpush/sdk";

const client = new AxonPush({ apiKey: "ak_...", tenantId: "1", failOpen: false });

try {
  await client.apps.list();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log("retry after", err.retryAfter);
  } else if (err instanceof AuthenticationError) {
    console.log("bad API key");
  }
}
```

Error classes: `AxonPushError`, `AuthenticationError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ValidationError` (400), `RateLimitError` (429), `ServerError` (5xx), `ConnectionError`.

### Realtime errors

`mqtt.js` handles transient socket-level reconnects automatically. Credential expiry is handled by the SDK as described in [Real-time (MQTT)](#real-time-mqtt). `connect()` rejects on the first hard failure (e.g. a 401 from `/auth/iot-credentials` — your API key is bad) so you can fail fast; after a successful connect, transient errors are logged but do not reject any pending promise.

## Types

All types are derived from the OpenAPI spec — no hand-written models:

```ts
import type {
  AxonEvent,
  Channel,
  App,
  WebhookEndpoint,
  WebhookDelivery,
  ApiKey,
  CreateEventDto,
  EventType,
  EventQueryParams,
  EventListPage,
  PublishParams,
  components,
  paths,
} from "@axonpush/sdk";
```

## Development

```bash
bun install
bun run generate:local   # regenerate types from local backend (localhost:3000)
bun run generate         # regenerate types from production API
bun run typecheck        # type-check
bun run build            # build to dist/
```
