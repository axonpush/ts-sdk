import {
  apiKeyControllerCreateApiKey,
  apiKeyControllerListApiKeys,
  apiKeyControllerRevokeApiKey,
} from "../_internal/api/sdk.gen.js";
import type { CreateApiKeyDto, MessageResponseDto } from "../_internal/api/types.gen.js";
import type { ApiKey, ApiKeyCreateResponseDto } from "../models.js";
import type { ResourceClient } from "./_client.js";

export type ApiKeyScope = NonNullable<CreateApiKeyDto["scopes"]>[number];

/** Optional fields for {@link ApiKeysResource.create} beyond the canonical name+scopes. */
export interface ApiKeyCreateOptions {
  /** Org UUID. When omitted, the server resolves it from the caller's auth context. */
  organizationId?: string;
  /** Bind this key to a specific app. */
  appId?: string;
  /** Bind this key to a specific environment. */
  environmentId?: string;
  /** Allow per-request env override via header / event body. */
  allowEnvironmentOverride?: boolean;
}

/** Manage org API keys. */
export class ApiKeysResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * Create a new API key. The raw key is only returned at creation time.
   *
   * @param name - Human-readable label for the key.
   * @param scopes - Optional permission scopes; defaults to server policy.
   * @param options - Optional binding overrides; see {@link ApiKeyCreateOptions}.
   * @returns The created key, or `null` on fail-open error.
   */
  async create(
    name: string,
    scopes?: ApiKeyScope[],
    options: ApiKeyCreateOptions = {},
  ): Promise<ApiKeyCreateResponseDto | null> {
    const body: CreateApiKeyDto = {
      name,
      organizationId: options.organizationId ?? "",
      ...(scopes !== undefined ? { scopes } : {}),
      ...(options.appId !== undefined ? { appId: options.appId } : {}),
      ...(options.environmentId !== undefined ? { environmentId: options.environmentId } : {}),
      ...(options.allowEnvironmentOverride !== undefined
        ? { allowEnvironmentOverride: options.allowEnvironmentOverride }
        : {}),
    };
    return this.client.invoke(apiKeyControllerCreateApiKey, { body });
  }

  /**
   * List API keys visible to the calling org.
   *
   * @returns Array of keys, or `null` on fail-open error.
   */
  async list(): Promise<ApiKey[] | null> {
    return this.client.invoke(apiKeyControllerListApiKeys, {});
  }

  /**
   * Revoke an API key.
   *
   * @param id - API key UUID.
   * @returns Server message, or `null` on fail-open error.
   */
  async delete(id: string): Promise<MessageResponseDto | null> {
    return this.client.invoke(apiKeyControllerRevokeApiKey, { path: { id } });
  }
}
