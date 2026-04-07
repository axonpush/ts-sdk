import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type ApiKey = components["schemas"]["ApiKey"];
type ApiKeyResponse = components["schemas"]["ApiKeyResponseDto"];
type CreateApiKeyDto = components["schemas"]["CreateApiKeyDto"];

export class ApiKeysResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async create(params: CreateApiKeyDto): Promise<ApiKeyResponse | undefined> {
    const { data } = await this.api.POST("/api-keys", {
      body: params,
    });
    return data;
  }

  async list(): Promise<ApiKey[]> {
    const { data } = await this.api.GET("/api-keys");
    return data ?? [];
  }

  async revoke(id: number): Promise<void> {
    await this.api.DELETE("/api-keys/{id}", {
      params: { path: { id } },
    });
  }
}
