import type { components } from "../schema";
import type { TransportClient } from "../transport.js";

type Event = components["schemas"]["EventResponseDto"];

export class TracesResource {
  constructor(
    private api: TransportClient,
    _failOpen: boolean,
  ) {}

  async list(opts: { page?: number; limit?: number } = {}) {
    const { data } = await this.api.GET("/traces", {
      params: {
        query: { page: opts.page ?? 1, limit: opts.limit ?? 20 },
      },
    });
    return data;
  }

  async getEvents(traceId: string): Promise<Event[]> {
    const { data } = await this.api.GET("/traces/{traceId}/events", {
      params: { path: { traceId } },
    });
    return data ?? [];
  }

  async getSummary(traceId: string) {
    const { data } = await this.api.GET("/traces/{traceId}/summary", {
      params: { path: { traceId } },
    });
    return data;
  }

  async getStats() {
    const { data } = await this.api.GET("/traces/stats");
    return data;
  }
}
