import {
  webhookControllerCreateEndpoint,
  webhookControllerDeleteEndpoint,
  webhookControllerGetDeliveries,
  webhookControllerListEndpoints,
} from "../_internal/api/sdk.gen.js";
import type { CreateWebhookEndpointDto, MessageResponseDto } from "../_internal/api/types.gen.js";
import type {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreateResponseDto,
} from "../models.js";
import type { ResourceClient } from "./_client.js";

export type WebhookEndpointCreateInput = CreateWebhookEndpointDto;

/** Manage outbound webhook endpoints and inspect their delivery history. */
export class WebhooksResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * Create a webhook endpoint subscribed to a channel.
   *
   * @param input - Endpoint fields; see {@link WebhookEndpointCreateInput}.
   * @returns The created endpoint (with raw signing secret), or `null` on fail-open error.
   */
  async createEndpoint(
    input: WebhookEndpointCreateInput,
  ): Promise<WebhookEndpointCreateResponseDto | null> {
    return this.client.invoke(webhookControllerCreateEndpoint, { body: input });
  }

  /**
   * List endpoints subscribed to a channel.
   *
   * @param channelId - Channel UUID.
   * @returns Endpoints, or `null` on fail-open error.
   */
  async listEndpoints(channelId: string): Promise<WebhookEndpoint[] | null> {
    return this.client.invoke(webhookControllerListEndpoints, { path: { channelId } });
  }

  /**
   * Delete a webhook endpoint.
   *
   * @param id - Endpoint UUID.
   * @returns Server ack, or `null` on fail-open error.
   */
  async deleteEndpoint(id: string): Promise<MessageResponseDto | null> {
    return this.client.invoke(webhookControllerDeleteEndpoint, { path: { id } });
  }

  /**
   * Fetch recent delivery attempts for an endpoint.
   *
   * @param endpointId - Endpoint UUID.
   * @returns Delivery records, or `null` on fail-open error.
   */
  async deliveries(endpointId: string): Promise<WebhookDelivery[] | null> {
    return this.client.invoke(webhookControllerGetDeliveries, { path: { endpointId } });
  }
}
