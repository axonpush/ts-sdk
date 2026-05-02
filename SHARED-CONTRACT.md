# SDK v0.0.5 — Shared Contract

**Read this before editing anything in `src/`.** This document is the
single source of truth shared between the parallel work streams.

---

## 1. Branch & version

- Working branch: `feat/sdk-v0.0.5-rewrite`.
- `package.json` and `src/version.ts` both read `"0.0.5"`.
- Latest released: GitHub `v0.0.4`, npm `0.0.4`. We are shipping `0.0.5` next.

## 2. Generated layer (do not edit)

The OpenAPI-generated SDK lives at:

```
src/_internal/api/
├── client/                  # @hey-api fetch core (don't touch)
│   └── client.gen.ts
├── client.gen.ts            # createClient(...) — calls back into ../transport.ts
├── core/                    # serializers + helpers
├── sdk.gen.ts               # 74 operation functions (one per controller method)
├── types.gen.ts             # request/response/schema types
└── index.ts                 # re-exports
```

Regeneration: `bun run codegen` (boots backend on `:3000`, dumps spec, runs
patcher, runs `@hey-api/openapi-ts`). Don't edit anything inside
`_internal/api/` by hand — the next codegen overwrites.

The generated `client.gen.ts` calls `createClientConfig` from
`../transport.ts` (i.e., `src/_internal/transport.ts`). **Stream A owns
that file** and must export the function with the right shape (see §5).

## 3. Public surface

### `axonpush.client` — `AxonPush` class (Stream A)

```ts
class AxonPush {
  /** Create a client. Falsy options fall through to AXONPUSH_* env vars. */
  constructor(options?: AxonPushOptions);

  // Resource accessors (lazy — Stream B owns these classes)
  readonly events: EventsResource;
  readonly channels: ChannelsResource;
  readonly apps: AppsResource;
  readonly environments: EnvironmentsResource;
  readonly webhooks: WebhooksResource;
  readonly traces: TracesResource;
  readonly apiKeys: ApiKeysResource;
  readonly organizations: OrganizationsResource;

  // Realtime (Stream C)
  connectRealtime(opts?: RealtimeOptions): Promise<RealtimeClient>;

  // Cross-cutting
  invoke<T>(op: GeneratedOp<T>, args: unknown): Promise<T | null>;
  getOrCreateTrace(seedTraceId?: string): TraceContext;
  readonly environment: string | undefined;

  close(): void; // idempotent
}
```

### Resource accessor names (FROZEN — Stream B owns)

`events`, `channels`, `apps`, `environments`, `webhooks`, `traces`,
`apiKeys`, `organizations`. Method names per resource:

| Resource | Methods |
|---|---|
| events | `publish`, `list(channelId, params?)`, `search(params?)` |
| channels | `list`, `get(id)`, `create(name, appId)`, `update(id, fields)`, `delete(id)` |
| apps | `list`, `get(id)`, `create(name)`, `update(id, name)`, `delete(id)` |
| environments | `list`, `create(input)`, `update(id, input)`, `delete(id)`, `promoteToDefault(id)` |
| webhooks | `createEndpoint`, `listEndpoints(channelId)`, `deleteEndpoint(id)`, `deliveries(endpointId)` |
| traces | `list(params)`, `stats(params)`, `events(traceId, params?)`, `summary(traceId, params?)` |
| apiKeys | `create(name, scopes)`, `list`, `delete(id)` |
| organizations | `create(name)`, `get(id)`, `list`, `update(id, fields)`, `delete(id)`, `invite(orgId, email)`, `removeMember(orgId, userId)`, `transferOwnership(orgId, targetUserId)` |

### Exceptions (FROZEN — Stream A owns)

```
AxonPushError                     // base — { code?, message, hint?, requestId?, statusCode? }
├── APIConnectionError
├── AuthenticationError           // 401
├── ForbiddenError                // 403
├── NotFoundError                 // 404
├── ValidationError               // 400 / 422
├── RateLimitError                // 429 (carries retryAfter?: number)
├── ServerError                   // 5xx
└── RetryableError                // mixin — APIConnectionError, RateLimitError, ServerError tagged via instanceof
```

### `axonpush.models` (PUBLIC re-exports — Stream B owns)

This module is the **only** path users should use to access models.

```ts
export type {
  AppResponseDto as App,
  ChannelResponseDto as Channel,
  CreateEventDto,
  EventIngestResponseDto as Event,
  EventResponseDto as EventDetails,
  EventListResponseDto,
  CreateEventDtoEventType as EventType,
  EnvironmentResponseDto as Environment,
  WebhookEndpointResponseDto as WebhookEndpoint,
  WebhookEndpointCreateResponseDto,
  WebhookDeliveryResponseDto as WebhookDelivery,
  TraceListItemDto as TraceListItem,
  TraceSummaryResponseDto as TraceSummary,
  UserResponseDto as User,
  ApiKeyResponseDto as ApiKey,
  OrganizationResponseDto as Organization,
} from "@/_internal/api/types.gen";
```

Verify each name actually exists in `src/_internal/api/types.gen.ts` first.
If something is missing, find the close match and report.

## 4. ID type rule (FROZEN)

**All IDs are `string` UUIDs on the public boundary**: `orgId`, `appId`,
`channelId`, `environmentId`, `eventId`, `traceId`, `endpointId`,
`userId`, `apiKeyId`, `releaseId`, `agentId`, `spanId`, `parentEventId`.

Integrations under `src/integrations/` accept `number | string` for
`channelId` only as a v0.0.4 softening, routed through
`integrations/_base.coerceChannelId(value)` which logs `console.warn` on
`number`. Internally everything is `string`.

## 5. Stream A's `_internal/transport.ts` contract

The generated `client.gen.ts` does:

```ts
import { createClientConfig } from "../transport.ts";
export const client = createClient(createClientConfig(createConfig<ClientOptions2>()));
```

So `src/_internal/transport.ts` must export:

```ts
export const createClientConfig: CreateClientConfig = (override) => ({
  baseUrl: settings.baseUrl,
  // ...auth/tracing/error/retry middlewares mounted here
  ...override,
});
```

Stream A also exports the `client` symbol (re-exporting the generated
one) plus `invokeSync<T>(op, args)` — the chokepoint that resources call
through. The chokepoint owns: retries on `RetryableError` with backoff
`[250, 500, 1000, 2000, 4000]ms` honouring `RateLimitError.retryAfter`,
fail-open swallowing of `APIConnectionError` (returning `null`), and
exception mapping from raw fetch responses.

## 6. File ownership matrix

| Path | Owner |
|---|---|
| `src/index.ts` | **Orchestrator** — agents write `_exports_<stream>.txt` |
| `src/resources/index.ts` (if needed) | **Orchestrator** |
| `src/{client,config,errors,tracing,version}.ts`, `src/_internal/transport.ts` | **Stream A** |
| `src/resources/*.ts`, `src/models.ts` | **Stream B** |
| `src/realtime/*.ts` | **Stream C** |
| `src/integrations/*.ts` | **Stream D** |
| `examples/`, `README.md`, `CHANGELOG.md` | **Stream E** (after A–D land) |
| `src/_internal/api/**` | **Generator only** — never edit |
| `src/schema.d.ts` | DELETE (Stream A or merge pass) — replaced by generated types |
| `src/transport.ts` (legacy openapi-fetch wrapper) | DELETE (Stream A) |
| `src/realtime/sse.ts` (if exists) | DELETE (Stream C) |

## 7. `_exports_<stream>.txt` protocol

Each stream that wants a public top-level re-export writes lines to
`_exports_<stream>.txt` at repo root, one ESM `export` line per row:

```
// _exports_a.txt (Stream A)
export { AxonPush } from "./client";
export type { AxonPushOptions } from "./config";
export {
  AxonPushError,
  APIConnectionError, AuthenticationError, ForbiddenError, NotFoundError,
  RateLimitError, RetryableError, ServerError, ValidationError,
} from "./errors";
```

The orchestrator concatenates these into `src/index.ts` in the merge pass
and removes the `_exports_*.txt` files.

## 8. Quality bar

- `bun run typecheck` clean (project `tsconfig.json`, strict mode).
- `bun run lint` clean (biome).
- Every public class/method/function has a TSDoc with `@param`,
  `@returns`, `@throws` sections. Internal helpers may be undocumented if
  naming makes them obvious.
- Minimal inline comments. Prefer well-named identifiers.
- All async surfaces work with `await` and `for await ... of` where
  appropriate.

## 9. Test layout

- `src/__tests__/*.test.ts` — fast vitest unit tests, no network.
  Mock the generated functions:
  `vi.mock("@/_internal/api", () => ({ eventControllerCreateEvent: vi.fn(), ...}))`.
- `src/__tests__/realtime/*.test.ts` — MQTT clients are mocked.
- `src/__tests__/integrations/*.test.ts` — Stream D's tests.
- `src/__tests__/**/*.e2e.test.ts` — opt-in E2E. Requires backend on
  `http://localhost:3000`. Run with `bunx vitest --run -t e2e`.

## 10. Final-merge order (orchestrator)

1. Stream A merges first.
2. Streams B and C merge in parallel.
3. Stream D merges after B.
4. Concat `_exports_*.txt` into `src/index.ts`.
5. Re-run `bun run codegen` (backend may have updated annotations).
6. `bun run lint:fix && bun run format && bun run typecheck && bun run test`.
7. Stream E launches against the merged tree.
8. Final commit + tag prep. Push held until user confirms.
