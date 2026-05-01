import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type App = components["schemas"]["AppResponseDto"];

export class AppsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async create(name: string): Promise<App | undefined> {
    const { data } = await this.api.POST("/apps", {
      body: { name },
    });
    return data;
  }

  async get(id: string): Promise<App | undefined> {
    const { data } = await this.api.GET("/apps/{id}", {
      params: { path: { id } },
    });
    return data;
  }

  async list(): Promise<App[]> {
    const { data } = await this.api.GET("/apps");
    return data ?? [];
  }

  async update(id: string, name: string): Promise<void> {
    await this.api.PATCH("/apps/{id}", {
      params: { path: { id } },
      body: { name },
    });
  }

  async delete(id: string): Promise<void> {
    await this.api.DELETE("/apps/{id}", {
      params: { path: { id } },
    });
  }
}
