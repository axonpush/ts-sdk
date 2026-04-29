# Changelog

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
