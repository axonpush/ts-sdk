import {
  environmentControllerCreate,
  environmentControllerList,
  environmentControllerPromote,
  environmentControllerRemove,
  environmentControllerUpdate,
} from "../_internal/api/sdk.gen.js";
import type {
  CreateEnvironmentDto,
  OkResponseDto,
  UpdateEnvironmentDto,
} from "../_internal/api/types.gen.js";
import type { Environment } from "../models.js";
import type { ResourceClient } from "./_client.js";

export type EnvironmentCreateInput = CreateEnvironmentDto;
export type EnvironmentUpdateInput = UpdateEnvironmentDto;

/** Manage org-level environments (e.g. `prod`, `staging`, `dev`). */
export class EnvironmentsResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * List all environments configured for the org.
   *
   * @returns Array of environments, or `null` on fail-open error.
   */
  async list(): Promise<Environment[] | null> {
    return this.client.invoke(environmentControllerList, {});
  }

  /**
   * Create a new environment.
   *
   * @param input - Environment fields; see {@link EnvironmentCreateInput}.
   * @returns The created environment, or `null` on fail-open error.
   */
  async create(input: EnvironmentCreateInput): Promise<Environment | null> {
    return this.client.invoke(environmentControllerCreate, { body: input });
  }

  /**
   * Update an existing environment.
   *
   * @param id - Environment UUID.
   * @param input - Patch object.
   * @returns The updated environment, or `null` on fail-open error.
   */
  async update(id: string, input: EnvironmentUpdateInput): Promise<Environment | null> {
    return this.client.invoke(environmentControllerUpdate, { path: { id }, body: input });
  }

  /**
   * Soft-delete an environment.
   *
   * @param id - Environment UUID.
   * @returns Server ack, or `null` on fail-open error.
   */
  async delete(id: string): Promise<OkResponseDto | null> {
    return this.client.invoke(environmentControllerRemove, { path: { id } });
  }

  /**
   * Promote an environment to be the org default.
   *
   * @param id - Environment UUID.
   * @returns The promoted environment, or `null` on fail-open error.
   */
  async promoteToDefault(id: string): Promise<Environment | null> {
    return this.client.invoke(environmentControllerPromote, {
      path: { id },
    }) as Promise<Environment | null>;
  }
}
