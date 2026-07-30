import type { ResolvedSettings } from "../config.js";
import type {
  DatasetItem,
  EvaluationItemResult,
  GateResult,
  GateThresholds,
  GitLineage,
} from "./types.js";

export class EvaluationApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EvaluationApiError";
  }
}

export interface EvaluationApi {
  fetchDatasetRevisionItems(
    datasetId: string,
    revision: number | string,
    signal?: AbortSignal,
  ): Promise<DatasetItem[]>;
  submitResults(
    experimentId: string,
    results: EvaluationItemResult[],
    signal?: AbortSignal,
  ): Promise<void>;
  startExperiment(experimentId: string, signal?: AbortSignal): Promise<void>;
  getExperimentStatus(experimentId: string, signal?: AbortSignal): Promise<string>;
  cancelExperiment(experimentId: string): Promise<void>;
  gateExperiment(
    experimentId: string,
    thresholds?: GateThresholds,
    signal?: AbortSignal,
  ): Promise<GateResult>;
}

export interface CreateExperimentOptions extends GitLineage {
  name: string;
  datasetId: string;
  datasetRevision: number | string;
  targetId: string;
  evaluatorVersions?: Array<{ evaluatorId: string; version: number | string }>;
  baselineExperimentId?: string;
  configuration?: Record<string, unknown>;
}

function unwrapData(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value)
    return (value as { data: unknown }).data;
  return value;
}

function normalizeItems(value: unknown): DatasetItem[] {
  const data = unwrapData(value);
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items)
      ? (data as { items: unknown[] }).items
      : undefined;
  if (!items)
    throw new EvaluationApiError("Dataset revision response did not contain an item list");
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") {
      throw new EvaluationApiError(`Dataset revision item ${index} is missing an id`);
    }
    const record = item as Record<string, unknown>;
    return {
      id: record.id as string,
      input: record.input,
      expectedOutput: record.expectedOutput,
      metadata: record.metadata as Record<string, unknown> | undefined,
      attachments: record.attachments as unknown[] | undefined,
      toolTrajectory: record.toolTrajectory,
    };
  });
}

/** Direct v2 evaluation API used before generated OpenAPI types are published. */
export class HttpEvaluationApi implements EvaluationApi {
  constructor(private readonly settings: ResolvedSettings) {}

  async fetchDatasetRevisionItems(
    datasetId: string,
    revision: number | string,
    signal?: AbortSignal,
  ): Promise<DatasetItem[]> {
    const result = await this.request(
      `/v2/datasets/${encodeURIComponent(datasetId)}/revisions/${encodeURIComponent(String(revision))}/items`,
      { signal },
    );
    return normalizeItems(result);
  }

  async submitResults(
    experimentId: string,
    results: EvaluationItemResult[],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(`/v2/experiments/${encodeURIComponent(experimentId)}/results`, {
      method: "POST",
      signal,
      body: JSON.stringify({
        results: results.map(
          ({ itemId, output, traceId, latencyMs, totalTokens, costUsd, error }) => ({
            itemId,
            output,
            ...(traceId === undefined ? {} : { traceId }),
            latencyMs,
            ...(totalTokens === undefined ? {} : { totalTokens }),
            ...(costUsd === undefined ? {} : { costUsd }),
            ...(error === undefined ? {} : { error }),
          }),
        ),
      }),
    });
  }

  async createExperiment(
    input: CreateExperimentOptions,
    signal?: AbortSignal,
  ): Promise<{ id: string }> {
    const result = unwrapData(
      await this.request("/v2/experiments", {
        method: "POST",
        signal,
        body: JSON.stringify(input),
      }),
    );
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as { id?: unknown }).id !== "string"
    ) {
      throw new EvaluationApiError("Create experiment response was invalid");
    }
    return { id: (result as { id: string }).id };
  }

  async startExperiment(experimentId: string, signal?: AbortSignal): Promise<void> {
    await this.request(`/v2/experiments/${encodeURIComponent(experimentId)}/run`, {
      method: "POST",
      signal,
    });
  }

  async getExperimentStatus(experimentId: string, signal?: AbortSignal): Promise<string> {
    const result = unwrapData(
      await this.request(`/v2/experiments/${encodeURIComponent(experimentId)}`, { signal }),
    );
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as { status?: unknown }).status !== "string"
    ) {
      throw new EvaluationApiError("Experiment response was invalid");
    }
    return (result as { status: string }).status;
  }

  async cancelExperiment(experimentId: string): Promise<void> {
    await this.request(`/v2/experiments/${encodeURIComponent(experimentId)}/cancel`, {
      method: "POST",
    });
  }

  async gateExperiment(
    experimentId: string,
    thresholds?: GateThresholds,
    signal?: AbortSignal,
  ): Promise<GateResult> {
    const result = unwrapData(
      await this.request(`/v2/experiments/${encodeURIComponent(experimentId)}/gate`, {
        method: "POST",
        signal,
        body: JSON.stringify(thresholds ?? {}),
      }),
    );
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as { passed?: unknown }).passed !== "boolean"
    ) {
      throw new EvaluationApiError("Experiment gate response was invalid");
    }
    const gate = result as Record<string, unknown>;
    return {
      passed: gate.passed as boolean,
      reasons: Array.isArray(gate.reasons)
        ? gate.reasons.filter((reason): reason is string => typeof reason === "string")
        : [],
      experimentId: typeof gate.experimentId === "string" ? gate.experimentId : experimentId,
      ...(typeof gate.baselineExperimentId === "string"
        ? { baselineExperimentId: gate.baselineExperimentId }
        : {}),
      ...(gate.metrics && typeof gate.metrics === "object"
        ? { metrics: gate.metrics as Record<string, unknown> }
        : {}),
    };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const url = new URL(
      path,
      this.settings.baseUrl.endsWith("/") ? this.settings.baseUrl : `${this.settings.baseUrl}/`,
    );
    if (this.settings.environment) url.searchParams.set("environment", this.settings.environment);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("AxonPush evaluation API request timed out")),
      this.settings.timeout,
    );
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.settings.apiKey
            ? { "x-api-key": this.settings.apiKey, authorization: `Bearer ${this.settings.apiKey}` }
            : {}),
          ...(this.settings.tenantId ? { "x-tenant-id": this.settings.tenantId } : {}),
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      let body: unknown = undefined;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const detail =
          body && typeof body === "object" && "message" in body
            ? String((body as { message: unknown }).message)
            : response.statusText;
        throw new EvaluationApiError(
          `AxonPush evaluation API ${response.status}: ${detail}`,
          response.status,
          body,
        );
      }
      return body;
    } catch (error) {
      if (error instanceof EvaluationApiError) throw error;
      throw new EvaluationApiError(
        error instanceof Error ? error.message : "Evaluation API request failed",
      );
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }
  }
}
