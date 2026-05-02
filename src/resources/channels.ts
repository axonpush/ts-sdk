import {
  channelControllerCreateChannel,
  channelControllerDeleteChannel,
  channelControllerGetChannel,
  channelControllerListChannels,
  channelControllerUpdateChannel,
} from "../_internal/api/sdk.gen.js";
import type { OkResponseDto } from "../_internal/api/types.gen.js";
import type { Channel } from "../models.js";
import type { ResourceClient } from "./_client.js";

/** Mutable channel fields accepted by {@link ChannelsResource.update}. */
export interface ChannelUpdateFields {
  name?: string;
}

/**
 * Manage channels — the `appId`-scoped fan-out unit that events,
 * webhooks, and realtime subscriptions hang off.
 */
export class ChannelsResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * List channels for an app.
   *
   * @param appId - Parent app UUID.
   * @returns The channels, or `null` on fail-open error.
   */
  async list(appId: string): Promise<Channel[] | null> {
    return this.client.invoke(channelControllerListChannels, { query: { appId } });
  }

  /**
   * Fetch a channel by UUID.
   *
   * @param id - Channel UUID.
   * @returns The channel, or `null` on fail-open error.
   */
  async get(id: string): Promise<Channel | null> {
    return this.client.invoke(channelControllerGetChannel, { path: { id } });
  }

  /**
   * Create a channel under the given app.
   *
   * @param name - Human-readable channel name.
   * @param appId - Parent app UUID.
   * @returns The created channel, or `null` on fail-open error.
   */
  async create(name: string, appId: string): Promise<Channel | null> {
    return this.client.invoke(channelControllerCreateChannel, { body: { name, appId } });
  }

  /**
   * Update mutable channel fields.
   *
   * The current backend definition does not declare a request body for
   * the channel update endpoint; we still pass the patch through so
   * the server can extend the contract without an SDK release.
   *
   * @param id - Channel UUID.
   * @param fields - Patch object; only provided keys are applied.
   * @returns Server ack, or `null` on fail-open error.
   */
  async update(id: string, fields: ChannelUpdateFields): Promise<OkResponseDto | null> {
    return this.client.invoke(channelControllerUpdateChannel, {
      path: { id },
      body: fields,
    } as unknown as Parameters<typeof channelControllerUpdateChannel>[0]);
  }

  /**
   * Soft-delete a channel.
   *
   * @param id - Channel UUID.
   * @returns Server ack, or `null` on fail-open error.
   */
  async delete(id: string): Promise<OkResponseDto | null> {
    return this.client.invoke(channelControllerDeleteChannel, { path: { id } });
  }
}
