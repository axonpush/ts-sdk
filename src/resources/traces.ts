import {
  traceControllerGetDashboardStats,
  traceControllerGetTraceEvents,
  traceControllerGetTraceSummary,
  traceControllerListTraces,
} from "../_internal/api/sdk.gen.js";
import type {
  TraceControllerGetDashboardStatsResponse,
  TraceControllerListTracesResponse,
} from "../_internal/api/types.gen.js";
import type { EventDetails, TraceSummary } from "../models.js";
import type { ResourceClient } from "./_client.js";

/** Pagination & filters for {@link TracesResource.list}. */
export interface TraceListParams {
  page?: number;
  /** Page size. */
  limit?: number;
  appId?: string;
  environment?: string;
}

/** Filters for {@link TracesResource.stats}. */
export interface TraceStatsParams {
  appId?: string;
  environment?: string;
}

/** Filters for trace-scoped reads. */
export interface TraceScopedParams {
  appId?: string;
  environment?: string;
}

export type TraceListPage = NonNullable<TraceControllerListTracesResponse>;
export type DashboardStats = NonNullable<TraceControllerGetDashboardStatsResponse>;

/** Read aggregated traces and per-trace events/summaries. */
export class TracesResource {
  constructor(private readonly client: ResourceClient) {}

  /**
   * List trace summaries, newest-first.
   *
   * @param params - Pagination & filter parameters.
   * @returns Paginated trace list, or `null` on fail-open error.
   */
  async list(params: TraceListParams = {}): Promise<TraceListPage | null> {
    return this.client.invoke(traceControllerListTraces, {
      query: this.applyEnv(params),
    });
  }

  /**
   * Fetch aggregated dashboard stats for the org.
   *
   * @param params - Optional filter parameters.
   * @returns Dashboard stats, or `null` on fail-open error.
   */
  async stats(params: TraceStatsParams = {}): Promise<DashboardStats | null> {
    return this.client.invoke(traceControllerGetDashboardStats, {
      query: this.applyEnv(params),
    });
  }

  /**
   * Fetch all events belonging to a trace, ordered by `createdAt` ASC.
   *
   * @param traceId - Trace UUID.
   * @param params - Optional filter parameters.
   * @returns Events, or `null` on fail-open error.
   */
  async events(traceId: string, params: TraceScopedParams = {}): Promise<EventDetails[] | null> {
    return this.client.invoke(traceControllerGetTraceEvents, {
      path: { traceId },
      query: this.applyEnv(params),
    });
  }

  /**
   * Fetch the summary for a single trace.
   *
   * @param traceId - Trace UUID.
   * @param params - Optional filter parameters.
   * @returns Trace summary, or `null` on fail-open error.
   */
  async summary(traceId: string, params: TraceScopedParams = {}): Promise<TraceSummary | null> {
    return this.client.invoke(traceControllerGetTraceSummary, {
      path: { traceId },
      query: this.applyEnv(params),
    }) as Promise<TraceSummary | null>;
  }

  private applyEnv<T extends { environment?: string }>(p: T): T {
    if (p.environment !== undefined) return p;
    const env = this.client.environment;
    return env !== undefined ? { ...p, environment: env } : p;
  }
}
