import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type WebhookEndpoint = components["schemas"]["WebhookEndpointResponseDto"];
type WebhookEndpointCreateResponse = components["schemas"]["WebhookEndpointCreateResponseDto"];
type WebhookDelivery = components["schemas"]["WebhookDeliveryResponseDto"];
type CreateWebhookEndpointDto = components["schemas"]["CreateWebhookEndpointDto"];

export class WebhooksResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async createEndpoint(
    params: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointCreateResponse | undefined> {
    const { data } = await this.api.POST("/webhooks/endpoints", {
      body: params,
    });
    return data;
  }

  async listEndpoints(channelId: string): Promise<WebhookEndpoint[]> {
    const { data } = await this.api.GET("/webhooks/endpoints/channel/{channelId}", {
      params: { path: { channelId } },
    });
    return data ?? [];
  }

  async deleteEndpoint(id: string): Promise<void> {
    await this.api.DELETE("/webhooks/endpoints/{id}", {
      params: { path: { id } },
    });
  }

  async getDeliveries(endpointId: string): Promise<WebhookDelivery[]> {
    const { data } = await this.api.GET("/webhooks/deliveries/{endpointId}", {
      params: { path: { endpointId } },
    });
    return data ?? [];
  }
}
