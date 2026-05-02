# @axonpush/sdk

TypeScript SDK for [AxonPush](https://axonpush.xyz) — real-time event
infrastructure for AI agent systems. ESM-only, runs on Node 20+ and Bun.

- **Publish** events over a typed REST client generated from the AxonPush
  OpenAPI spec.
- **Subscribe** in realtime over MQTT-over-WSS (AWS IoT Core), with
  presigned credentials issued by the SDK.
- **Trace** multi-agent workflows via `traceId` / `parentEventId`.
- **Integrate** with LangChain, LangGraph, LlamaIndex, OpenAI Agents,
  Vercel AI SDK, Mastra, Google ADK, OpenTelemetry, Sentry, pino,
  winston, console capture, BullMQ, and the Anthropic SDK.

## Install

```bash
npm install @axonpush/sdk
# or
bun add @axonpush/sdk
```

The framework integrations live behind optional peer deps. The package
will load fine without any of them; install the host library you want to
wire up:

```bash
npm install @langchain/core         # for AxonPushCallbackHandler
npm install winston winston-transport
npm install pino
npm install @opentelemetry/api @opentelemetry/sdk-trace-base
npm install @sentry/node
npm install bullmq
npm install @anthropic-ai/sdk
```

## Quickstart

This snippet matches `examples/01-quickstart.ts` exactly.

```ts
import { AxonPush } from "@axonpush/sdk";

const client = new AxonPush();
const event = await client.events.publish({
  identifier: `quickstart-${Date.now()}`,
  channelId: process.env.AXONPUSH_CHANNEL_ID!,
  eventType: "custom",
  payload: { hello: "world", source: "examples/01-quickstart" },
});
console.log("published event:", event);
client.close();
```

`new AxonPush()` resolves credentials from `AXONPUSH_*` env vars (see
[Configuration](#configuration)). Pass an options bag to override.

## Configuration

| Field | Env var | Default | Notes |
|---|---|---|---|
| `apiKey` | `AXONPUSH_API_KEY` | — | Required. |
| `tenantId` | `AXONPUSH_TENANT_ID` | — | Org UUID; falls back to `AXONPUSH_ORG_ID`. |
| `orgId` | `AXONPUSH_ORG_ID` | mirrors `tenantId` | |
| `appId` | `AXONPUSH_APP_ID` | — | Default app for resources that need one. |
| `baseUrl` | `AXONPUSH_BASE_URL` | `http://localhost:3000` | REST API root. |
| `environment` | `AXONPUSH_ENVIRONMENT` | — | Logical env slug (`production`, `staging`). |
| `iotEndpoint` | `AXONPUSH_IOT_ENDPOINT` | — | AWS IoT Core MQTT-over-WSS endpoint. |
| `wsUrl` | `AXONPUSH_WS_URL` | mirrors `iotEndpoint` | Realtime override. |
| `timeout` | `AXONPUSH_TIMEOUT` | `30_000` | Per-request timeout (ms). |
| `maxRetries` | `AXONPUSH_MAX_RETRIES` | `3` | Retries on `RetryableError`. |
| `failOpen` | `AXONPUSH_FAIL_OPEN` | `false` | Swallow `APIConnectionError` and resolve `null`. |

Caller-supplied options always win when defined.

```ts
const client = new AxonPush({
  apiKey: process.env.AXONPUSH_API_KEY,
  tenantId: process.env.AXONPUSH_TENANT_ID,
  baseUrl: "https://api.axonpush.xyz",
  environment: "production",
  failOpen: true,
});
```

## Realtime in 30 seconds

```ts
import { AxonPush, RealtimeClient } from "@axonpush/sdk";

const client = new AxonPush();
const realtime = (await client.connectRealtime({ environment: "production" })) as RealtimeClient;
await realtime.connect();

await realtime.subscribe({ channelId: "ch-uuid" }, (event) => {
  console.log(event.identifier, event.payload);
});

await client.events.publish({
  identifier: `tick-${Date.now()}`,
  channelId: "ch-uuid",
  eventType: "custom",
  payload: { hello: "from realtime" },
});

await realtime.disconnect();
```

Credentials are short-lived; the SDK pre-emptively refreshes 60 s before
expiry with backoff `[5, 15, 30, 60] s` if the broker is flaky.

## Integrations

Every integration is reachable from the package root **and** as a
sub-path import for tree-shaking:

```ts
import { AxonPushCallbackHandler } from "@axonpush/sdk";
import { AxonPushCallbackHandler } from "@axonpush/sdk/integrations/langchain";
```

| Import | What it wires up |
|---|---|
| `AxonPushCallbackHandler` | LangChain.js callback handler. |
| `AxonPushLangGraphHandler` | LangGraph node lifecycle hook. |
| `AxonPushLlamaIndexHandler` | LlamaIndex.ts callback. |
| `AxonPushAnthropicTracer` | Wraps `@anthropic-ai/sdk` calls; records token usage and `streamMessage()`. |
| `AxonPushRunHooks` | OpenAI Agents SDK lifecycle hooks. |
| `axonPushMiddleware` | Vercel AI SDK middleware. |
| `AxonPushMastraHooks` | Mastra agent hooks. |
| `axonPushADKCallbacks` | Google ADK callback bundle. |
| `AxonPushSpanExporter` | OTel `SpanExporter`. |
| `installSentry(Sentry, opts)` | Builds the AxonPush DSN and calls `Sentry.init`. |
| `createAxonPushPinoStream` | pino transport stream. |
| `createAxonPushWinstonTransport` | winston transport. |
| `setupConsoleCapture` | Mirror `console.*` to AxonPush. |
| `BackgroundPublisher` | Bounded in-memory publish queue (used by transports). |
| `BullMQPublisher` | Forward events through a BullMQ queue. |
| `safePublish` / `truncate` / `coerceChannelId` | Building blocks for custom integrations. |

Each integration accepts the same `IntegrationConfig`:

```ts
{ client, channelId, agentId?, traceId?, mode?, queueSize?, overflowPolicy?, shutdownTimeoutMs?, concurrency?, bullmqOptions? }
```

`mode` is `"background"` (default), `"sync"`, or `"bullmq"`.

## Errors

```ts
import {
  AxonPushError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  RetryableError,
  ValidationError,
} from "@axonpush/sdk";

try {
  await client.apps.get(id);
} catch (err) {
  if (err instanceof RateLimitError) {
    await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000));
  } else if (err instanceof AuthenticationError) {
    rotateApiKey();
  } else if (err instanceof RetryableError) {
    // safe to retry with your own backoff
  } else if (err instanceof NotFoundError || err instanceof ValidationError) {
    throw err; // not retryable
  }
}
```

The SDK already retries `RetryableError` with backoff
`[250, 500, 1000, 2000, 4000] ms` (honouring `Retry-After`) up to
`maxRetries` times — handle these in your code only when you need a
custom policy.

## Tracing

```ts
import { getOrCreateTrace } from "@axonpush/sdk";

const trace = getOrCreateTrace();
await client.events.publish({
  identifier: "plan",
  channelId,
  traceId: trace.traceId,
  eventType: "agent.start",
  payload: { goal: "..." },
});
```

`traceId` is propagated as `X-Axonpush-Trace-Id` and stored on every
event, so the UI can stitch agent runs across services. Pass
`parentEventId` to model hand-offs between agents.

## Migration: 0.0.4 → 0.0.5

- **All IDs are `string` UUIDs.** `numeric` ids are gone from the public
  boundary; integrations still accept `number` for `channelId` with a
  one-time `console.warn` and migrate it for you.
- **No more `connectWebSocket` / `WebSocketClient`.** Use
  `connectRealtime()` and `RealtimeClient`.
- **`channels.subscribe()` SSE shim is removed.** Subscribe via
  realtime.
- **`events.list()` returns `EventListResponseDto`** (`{ data, meta }`),
  not a bare array. Read `.data` for the events.
- **Models live in flat re-exports.** Import `App`, `Channel`, `Event`,
  `EventType`, etc. from `@axonpush/sdk` directly.
- **Zero-arg constructor.** `new AxonPush()` reads `AXONPUSH_*` env
  vars; the explicit options bag is optional.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full list, including the
new exception envelope and the audit improvements that landed alongside
the rewrite.

## Examples

Ten runnable examples covering quickstart, tracing, realtime, multi-
agent fan-out, webhooks, error handling, and every framework integration
live in [`examples/`](./examples). Each one is a single file you can run
with `bun run examples/<name>.ts`.

## Advanced topics

For the full v0.0.5 contract — public surface, ID rules, transport
chokepoint, exception envelope, generated layer ownership — see
[`SHARED-CONTRACT.md`](./SHARED-CONTRACT.md).

## License

MIT.

## Contributing

Issues and PRs welcome at [github.com/axonpush/ts-sdk](https://github.com/axonpush/ts-sdk).
Please run `bun run lint && bun run typecheck && bun run test` before
sending a PR.
