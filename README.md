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
});

const app = await client.apps.create("my-app");
const channel = await client.channels.create("events", app!.id);

await client.events.publish({
  identifier: "task.started",
  payload: { task: "summarize article" },
  channelId: channel!.id,
  agentId: "research-agent",
  eventType: "agent.start",
});

const events = await client.events.list(channel!.id);
```

## Configuration

```ts
const client = new AxonPush({
  apiKey: "ak_...",       // required
  tenantId: "1",          // required
  baseUrl: "https://...", // default: https://api.axonpush.xyz
  failOpen: true,         // default: true — suppresses errors with warnings
});
```

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

## Framework Integrations

All integrations share a common config:

```ts
import type { IntegrationConfig } from "@axonpush/sdk";

const config: IntegrationConfig = {
  client,            // AxonPush instance
  channelId: 1,      // channel to publish events to
  agentId: "my-bot", // optional, defaults per framework
  traceId: "tr_...", // optional, auto-generated if omitted
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
