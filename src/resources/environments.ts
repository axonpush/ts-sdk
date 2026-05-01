import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type Environment = components["schemas"]["EnvironmentResponseDto"];
type CreateEnvironmentDto = components["schemas"]["CreateEnvironmentDto"];
type UpdateEnvironmentDto = components["schemas"]["UpdateEnvironmentDto"];

export class EnvironmentsResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async list(): Promise<Environment[]> {
    const { data } = await this.api.GET("/environments");
    return data ?? [];
  }

  async create(input: CreateEnvironmentDto): Promise<Environment | undefined> {
    const { data } = await this.api.POST("/environments", { body: input });
    return data;
  }

  async update(id: string, input: UpdateEnvironmentDto): Promise<Environment | undefined> {
    const { data } = await this.api.PATCH("/environments/{id}", {
      params: { path: { id } },
      body: input,
    });
    return data;
  }

  async delete(id: string): Promise<void> {
    await this.api.DELETE("/environments/{id}", {
      params: { path: { id } },
    });
  }

  async promoteToDefault(id: string): Promise<Environment | undefined> {
    const { data } = await this.api.POST("/environments/{id}/promote-to-default", {
      params: { path: { id } },
    });
    return data as Environment | undefined;
  }
}
