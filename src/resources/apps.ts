import {
  appsControllerCreateApp,
  appsControllerDeleteApp,
  appsControllerEditApp,
  appsControllerGetAllApps,
  appsControllerGetApp,
} from "../_internal/api/sdk.gen.js";
import type { OkResponseDto } from "../_internal/api/types.gen.js";
import type { App } from "../models.js";
import type { ResourceClient } from "./_client.js";

/** Manage apps — the top-level container for channels & API keys. */
export class AppsResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * List all apps visible to the calling org.
   *
   * @returns Array of apps, or `null` on fail-open error.
   */
  async list(): Promise<App[] | null> {
    return this.client.invoke(appsControllerGetAllApps, {});
  }

  /**
   * Fetch an app by UUID.
   *
   * @param id - App UUID.
   * @returns The app, or `null` on fail-open error.
   */
  async get(id: string): Promise<App | null> {
    return this.client.invoke(appsControllerGetApp, { path: { id } });
  }

  /**
   * Create a new app.
   *
   * @param name - Human-readable app name.
   * @returns The created app, or `null` on fail-open error.
   */
  async create(name: string): Promise<App | null> {
    return this.client.invoke(appsControllerCreateApp, { body: { name } });
  }

  /**
   * Rename an app.
   *
   * @param id - App UUID.
   * @param name - New app name.
   * @returns Server ack, or `null` on fail-open error.
   */
  async update(id: string, name: string): Promise<OkResponseDto | null> {
    return this.client.invoke(appsControllerEditApp, { path: { id }, body: { name } });
  }

  /**
   * Soft-delete an app.
   *
   * @param id - App UUID.
   * @returns Server ack, or `null` on fail-open error.
   */
  async delete(id: string): Promise<OkResponseDto | null> {
    return this.client.invoke(appsControllerDeleteApp, { path: { id } });
  }
}
