import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type ApiKey = components["schemas"]["ApiKeyResponseDto"];
type ApiKeyCreateResponse = components["schemas"]["ApiKeyCreateResponseDto"];
type CreateApiKeyDto = components["schemas"]["CreateApiKeyDto"];

export class ApiKeysResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async create(params: CreateApiKeyDto): Promise<ApiKeyCreateResponse | undefined> {
    const { data } = await this.api.POST("/api-keys", {
      body: params,
    });
    return data;
  }

  async list(): Promise<ApiKey[]> {
    const { data } = await this.api.GET("/api-keys");
    return data ?? [];
  }

  async revoke(id: string): Promise<void> {
    await this.api.DELETE("/api-keys/{id}", {
      params: { path: { id } },
    });
  }
}
