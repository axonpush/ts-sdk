# Changelog

## 0.0.11

### Breaking

- **MQTT topic shape changed.** Topics now embed an environment slug between
  the org and app segments:
  - Before: `axonpush/{orgId}/{appId}/{channelId}/{eventType}/{agentId}`
  - After:  `axonpush/{orgId}/{envSlug}/{appId}/{channelId}/{eventType}/{agentId}`

  Subscribers wildcard the env slot (`+`) when no `environment` filter is
  supplied. `RealtimeClient.publish()` falls back to `defaultEnvironment` (the
  client-resolved environment) and finally to `"dev"` when no env is given.
  `RealtimeClient.subscribe()` now accepts an `environment` filter alongside
  `agentId` / `eventType` / `traceId`.

- **Environments are org-level, not per-app.** The SDK now exposes a top-level
  `client.environments` resource. Endpoints:
  - `GET /environments` — `list()`
  - `POST /environments` — `create({ name, slug?, color?, isProduction?, isDefault?, cloneFromEnvId? })`
  - `PATCH /environments/:id` — `update(id, body)`
  - `DELETE /environments/:id` — `delete(id)`
  - `POST /environments/:id/promote-to-default` — `promoteToDefault(id)`

  The previous per-app endpoint `GET /apps/:appId/environments` was removed
  upstream and is no longer reachable from any SDK call.

- **Schema regenerated.** `src/schema.d.ts` was regenerated from the new
  OpenAPI document. Several response types were renamed to their `*ResponseDto`
  forms (`App` → `AppResponseDto`, `Channel` → `ChannelResponseDto`, `Event` →
  `EventResponseDto`, etc.). The re-exported `App`, `Channel`, `AxonEvent`,
  `WebhookEndpoint`, `WebhookDelivery`, `ApiKey` aliases now point at the new
  DTOs and a new `Environment` alias is exported.

- **ID parameters are now strings.** The backend models entity IDs as UUID
  strings. `apps.get/update/delete`, `channels.get/update/delete`, `apiKeys.revoke`,
  `webhooks.deleteEndpoint/getDeliveries/listEndpoints` now take `string` ids.
  `events.list(channelId)` and `events.publish({ channelId })` accept
  `string | number`.

## 0.1.0

### Breaking

- **Realtime transport replaced with MQTT-over-WSS** against AWS IoT Core.
  - `WebSocketClient` is now an alias of the new `RealtimeClient`. The class
    keeps the same public surface (`connect`, `subscribe`, `unsubscribe`,
    `publish`, `onEvent`, `disconnect`, `wait`) but talks MQTT under the hood.
  - The SDK fetches a short-lived presigned WSS URL from
    `GET /auth/iot-credentials` on connect and refreshes 60s before expiry.
  - Dependency: `socket.io-client` removed. `mqtt` (^5) added.
- **SSE removed.** `SSESubscription` and `client.channels.subscribe(...)` /
  `subscribeToEvent(...)` are kept as deprecation shims. They open an MQTT
  connection internally and yield events through the same `AsyncIterable<Event>`
  surface, but emit a one-time `console.warn` on first use.
- **`events.search()` / `events.list()` Lucene removed.** The `q` parameter is
  gone. Both calls now accept `EventQueryParams`:
  `{ channelId?, appId?, environmentId?, eventType?, agentId?, traceId?, since?, until?, payloadFilter?, cursor?, limit? }`.
  `payloadFilter` is JSON-stringified into a single query param and validated
  server-side via `sift.js` (MongoDB-style operators).
- **`AxonPushConfig` / `AxonPushOptions`** gained optional `wsUrl`, `iotEndpoint`,
  `orgId`, `appId`. `wsUrl` / `iotEndpoint` are decoupled from `baseUrl`.

### Follow-ups

- `src/schema.d.ts` regeneration is deferred until backend Phase 2c publishes
  the new OpenAPI document. The hand-rolled `EventQueryParams` type will be
  superseded by the regenerated schema.
