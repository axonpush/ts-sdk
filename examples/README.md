# AxonPush SDK examples

Each file is runnable on its own with `bun run examples/<file>.ts`.
The shared loader lives in `examples/config.ts`.

Set the standard SDK env vars before running anything:

```
export AXONPUSH_API_KEY=ax_...
export AXONPUSH_TENANT_ID=<org-uuid>
export AXONPUSH_CHANNEL_ID=<channel-uuid>
export AXONPUSH_BASE_URL=http://localhost:3000   # optional
export AXONPUSH_ENVIRONMENT=development          # optional
```

| File | What it does | Extra env / deps |
|---|---|---|
| `01-quickstart.ts` | Construct `new AxonPush()` from env, publish one event. | — |
| `02-agent-tracing.ts` | Three events under one `traceId`, linked via `parentEventId`. | — |
| `03-realtime-mqtt.ts` | Open a realtime MQTT connection, subscribe + publish, disconnect. | — |
| `04-multi-agent.ts` | Fan-out across `agentId`s with an `eventType`-filtered subscriber. | — |
| `05-webhooks.ts` | Create a webhook endpoint, list endpoints, inspect deliveries. | `WEBHOOK_URL` (public HTTPS, ngrok ok) |
| `06-error-handling.ts` | Catch `AuthenticationError`, `NotFoundError`, `RateLimitError`, `RetryableError`. | — |
| `07-langchain.ts` | Drive `AxonPushCallbackHandler` from a synthetic LangChain runtree. | optional `@langchain/core` |
| `08-winston-logger.ts` | Ship winston log records as `app.log` events with severity mapping. | optional `winston`, `winston-transport` |
| `09-sentry.ts` | Build the AxonPush DSN and call `installSentry(Sentry, opts)`. | optional `@sentry/node` |
| `10-otel-export.ts` | Register `AxonPushSpanExporter` with a `BasicTracerProvider`. | optional `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` |

The optional peer-dep examples (07–10) detect their host library at
runtime and exit cleanly with a hint when it isn't installed, so they
don't crash on a fresh checkout.
