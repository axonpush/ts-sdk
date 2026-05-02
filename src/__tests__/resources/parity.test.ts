import { describe, expect, it, vi } from "vitest";
import type { ResourceClient } from "../../resources/_client.js";
import { ApiKeysResource } from "../../resources/api-keys.js";
import { AppsResource } from "../../resources/apps.js";
import { ChannelsResource } from "../../resources/channels.js";
import { EnvironmentsResource } from "../../resources/environments.js";
import { EventsResource } from "../../resources/events.js";
import { OrganizationsResource } from "../../resources/organizations.js";
import { TracesResource } from "../../resources/traces.js";
import { WebhooksResource } from "../../resources/webhooks.js";

vi.mock("../../_internal/api/sdk.gen.js", async () => {
  const real = await vi.importActual<Record<string, unknown>>("../../_internal/api/sdk.gen.js");
  const stub: Record<string, unknown> = {};
  for (const k of Object.keys(real)) stub[k] = vi.fn();
  return stub;
});

const stubClient: ResourceClient = {
  environment: undefined,
  getOrCreateTrace: () => ({ traceId: "tr_x", nextSpanId: () => "sp_x" }),
  invoke: async () => null,
};

const expectations: Array<{ name: string; instance: object; methods: string[] }> = [
  {
    name: "EventsResource",
    instance: new EventsResource(stubClient),
    methods: ["publish", "list", "search"],
  },
  {
    name: "ChannelsResource",
    instance: new ChannelsResource(stubClient),
    methods: ["get", "create", "update", "delete"],
  },
  {
    name: "AppsResource",
    instance: new AppsResource(stubClient),
    methods: ["list", "get", "create", "update", "delete"],
  },
  {
    name: "EnvironmentsResource",
    instance: new EnvironmentsResource(stubClient),
    methods: ["list", "create", "update", "delete", "promoteToDefault"],
  },
  {
    name: "WebhooksResource",
    instance: new WebhooksResource(stubClient),
    methods: ["createEndpoint", "listEndpoints", "deleteEndpoint", "deliveries"],
  },
  {
    name: "TracesResource",
    instance: new TracesResource(stubClient),
    methods: ["list", "stats", "events", "summary"],
  },
  {
    name: "ApiKeysResource",
    instance: new ApiKeysResource(stubClient),
    methods: ["create", "list", "delete"],
  },
  {
    name: "OrganizationsResource",
    instance: new OrganizationsResource(stubClient),
    methods: [
      "create",
      "get",
      "list",
      "update",
      "delete",
      "invite",
      "removeMember",
      "transferOwnership",
    ],
  },
];

describe("resource method parity (contract §3)", () => {
  for (const { name, instance, methods } of expectations) {
    for (const m of methods) {
      it(`${name} exposes ${m}()`, () => {
        expect(typeof (instance as Record<string, unknown>)[m]).toBe("function");
      });
    }
  }
});
