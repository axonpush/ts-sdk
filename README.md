# @axonpush/sdk

TypeScript SDK for [AxonPush](https://axonpush.xyz) — real-time event infrastructure for AI agent systems.

## Install

```bash
bun add @axonpush/sdk
```

```bash
npm install @axonpush/sdk
```

## Quick Start

```ts
import { AxonPush } from "@axonpush/sdk";

const client = new AxonPush({
  apiKey: "ak_...",
  tenantId: "1",
  environment: "production",
});

const app = await client.apps.create("my-app");
const channel = await client.channels.create("events", app!.id);

const event = await client.events.publish({
  identifier: "task.started",
  payload: { task: "summarize article" },
  channelId: channel!.id,
  agentId: "research-agent",
  eventType: "agent.start",
});
// event.queued === true, event.id is undefined — publishes are async-ingested
// by default. See "Response shape" below.

const events = await client.events.list(channel!.id);
```

### Response shape

By default, `events.publish()` returns as soon as the server has queued the event — typically under 1&nbsp;ms. The returned event carries `identifier`, `queued: true`, `createdAt`, and the resolved `environmentId`, but **not** a DB-assigned `id` (`event.id` is `undefined`). Treat `event.identifier` and `event.traceId` as the durable correlation keys. List endpoints and subscriptions return the fully-persisted shape (with `id`) once the event is written. If you need an audit-critical write, pass `sync: true` on the publish call to force the server's synchronous write path.

## Configuration

```ts
const client = new AxonPush({
  apiKey: "ak_...",       // required
  tenantId: "1",          // required
  baseUrl: "https://...", // default: https://api.axonpush.xyz
  failOpen: true,         // default: true — suppresses errors with warnings
  environment: "production", // optional, auto-detected from env vars if omitted
});
```

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
const app = await client.apps.get(1);
await client.apps.update(1, "new-name");
await client.apps.delete(1);
```

### Channels

```ts
const channel = await client.channels.create("events", appId);
const channel = await client.channels.get(1);
await client.channels.update(1);
await client.channels.delete(1);
```

### Events

```ts
const event = await client.events.publish({
  identifier: "agent.task",
  payload: { key: "value" },
  channelId: 1,
  agentId: "my-agent",
  traceId: "tr_abc123",        // optional, auto-generated if omitted
  eventType: "agent.start",    // "agent.start" | "agent.end" | "agent.message" | "agent.tool_call.start" | "agent.tool_call.end" | "agent.error" | "agent.handoff" | "agent.llm.token" | "custom"
  metadata: { custom: "data" },
});

const events = await client.events.list(channelId, { page: 1, limit: 20 });
```

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

## Real-time

### SSE (Server-Sent Events)

```ts
const subscription = client.channels.subscribe(channelId, {
  agentId: "my-agent",
  eventType: "agent.error",
  traceId: "tr_abc123",
});

for await (const event of subscription) {
  console.log(event.identifier, event.payload);
}

// cancel
subscription.abort();
```

Subscribe to a single event identifier on a channel:

```ts
const sub = client.channels.subscribeToEvent(channelId, "web_search");
for await (const event of sub) {
  console.log(event.payload);
}
```

### WebSocket

Requires `socket.io-client`:

```bash
bun add socket.io-client
```

```ts
const ws = client.connectWebSocket();
await ws.connect();

ws.onEvent((event) => {
  console.log(event.identifier, event.payload);
});

ws.subscribe(channelId, { eventType: "agent.error" });
ws.publish({
  channelId: 1,
  identifier: "task.update",
  payload: { status: "running" },
});

await ws.wait();     // blocks until disconnect
await ws.disconnect();
```

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

### Vercel AI SDK

```ts
import { axonPushMiddleware } from "@axonpush/sdk";
import { wrapLanguageModel } from "ai";

const middleware = axonPushMiddleware(config);
const model = wrapLanguageModel({ model: openai("gpt-4o"), middleware });

const result = await generateText({ model, prompt: "Hello" });
```

Events: `llm.start`, `llm.end`, `llm.token`

### LangChain.js

```ts
import { AxonPushCallbackHandler } from "@axonpush/sdk";

const handler = new AxonPushCallbackHandler(config);
await chain.invoke({ input: "..." }, { callbacks: [handler] });
```

Events: `chain.start/end/error`, `llm.start/end/error`, `llm.token`, `tool.{name}.start`, `tool.end`, `tool.error`

### LangGraph.js

```ts
import { AxonPushLangGraphHandler } from "@axonpush/sdk";

const handler = new AxonPushLangGraphHandler(config);
await graph.invoke({ input: "..." }, { callbacks: [handler] });
```

Events: everything from LangChain + `graph.node.start/end`

### OpenAI Agents SDK

```ts
import { AxonPushRunHooks } from "@axonpush/sdk";

const hooks = new AxonPushRunHooks(config);
const result = await Runner.run(agent, { input: "...", hooks });
```

Events: `agent.run.start/end`, `tool.{name}.start/end`, `agent.handoff`

### Anthropic SDK

```ts
import { AxonPushAnthropicTracer } from "@axonpush/sdk";
import Anthropic from "@anthropic-ai/sdk";

const tracer = new AxonPushAnthropicTracer(config);
const anthropic = new Anthropic();

const response = await tracer.createMessage(anthropic, {
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

// when sending tool results back
tracer.sendToolResult("toolu_123", { result: "42" });
```

Events: `conversation.turn`, `tool.{name}.start`, `agent.response`, `tool.result`

### Mastra

```ts
import { AxonPushMastraHooks } from "@axonpush/sdk";

const hooks = new AxonPushMastraHooks(config);

hooks.onWorkflowStart("my-workflow", input);
hooks.beforeToolUse("search", { query: "..." });
hooks.afterToolUse("search", results);
hooks.onWorkflowEnd("my-workflow", output);
```

Events: `workflow.start/end/error`, `tool.{name}.start/end`

### LlamaIndex.TS

```ts
import { AxonPushLlamaIndexHandler } from "@axonpush/sdk";

const handler = new AxonPushLlamaIndexHandler(config);

handler.onLLMStart("gpt-4o", 3);
handler.onRetrieverStart("what is axonpush?");
handler.onRetrieverEnd(5);
handler.onLLMEnd(response);
```

Events: `llm.start/end`, `llm.token`, `embedding.start/end`, `retriever.query/result`, `query.start/end`

### Google ADK

```ts
import { axonPushADKCallbacks } from "@axonpush/sdk";

const callbacks = axonPushADKCallbacks(config);
// pass to ADK agent configuration
```

Events: `agent.start/end`, `llm.start/end`, `tool.{name}.start/end`

## Logging & Observability

Ship logs and traces from your existing Node.js observability stack to AxonPush. Four integrations are shipped: **Pino**, **Winston**, `console` capture, and an **OpenTelemetry** `SpanExporter`. All four emit OpenTelemetry-shaped payloads, so the events line up with anything else you're already sending to an OTel-compatible backend.

> **Non-blocking by default (v0.0.2+).** Each integration submits publishes onto a bounded in-memory queue and drains them from a single background task, so `log.info(...)` stays O(microseconds) on the caller's path — no HTTP round-trip on the hot path. The queue is bounded (default 1000 records); overflow drops the oldest with a rate-limited warning. Call `.flush(timeoutMs?)` or use `flushAfterInvocation(handler, fn)` at known checkpoints (end of a Lambda invocation, end of a test) to guarantee delivery. Pass `mode: "sync"` on any integration if you need blocking publishes. A `beforeExit` / `SIGTERM` / `SIGINT` hook drains all live publishers automatically at process shutdown.

### Pino

```ts
import pino from "pino";
import { AxonPush } from "@axonpush/sdk";
import { createAxonPushPinoStream } from "@axonpush/sdk/integrations/pino";

const client = new AxonPush({ apiKey: "ak_..." });
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

const client = new AxonPush({ apiKey: "ak_..." });
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

const client = new AxonPush({ apiKey: "ak_..." });
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
      client: new AxonPush({ apiKey: "ak_..." }),
      channelId: 1,
      serviceName: "my-api",
    }),
  ),
);
provider.register();
```

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
  // OR: createAxonPushWinstonTransport from ".../integrations/winston"
} from "@axonpush/sdk/integrations/pino";
import { flushAfterInvocation } from "@axonpush/sdk/integrations/pino";

const client = new AxonPush({ apiKey: process.env.AXONPUSH_API_KEY! });
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

Error classes: `AxonPushError`, `AuthenticationError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ValidationError` (400), `RateLimitError` (429), `ServerError` (5xx), `ConnectionError`

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
