import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type WebhookEndpoint = components["schemas"]["WebhookEndpoint"];
type WebhookDelivery = components["schemas"]["WebhookDelivery"];
type CreateWebhookEndpointDto = components["schemas"]["CreateWebhookEndpointDto"];

export class WebhooksResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async createEndpoint(params: CreateWebhookEndpointDto): Promise<WebhookEndpoint | undefined> {
    const { data } = await this.api.POST("/webhooks/endpoints", {
      body: params,
    });
    return data;
  }

  async listEndpoints(channelId: number): Promise<WebhookEndpoint[]> {
    const { data } = await this.api.GET("/webhooks/endpoints/channel/{channelId}", {
      params: { path: { channelId } },
    });
    return data ?? [];
  }

  async deleteEndpoint(id: number): Promise<void> {
    await this.api.DELETE("/webhooks/endpoints/{id}", {
      params: { path: { id } },
    });
  }

  async getDeliveries(endpointId: number): Promise<WebhookDelivery[]> {
    const { data } = await this.api.GET("/webhooks/deliveries/{endpointId}", {
      params: { path: { endpointId } },
    });
    return data ?? [];
  }
}
