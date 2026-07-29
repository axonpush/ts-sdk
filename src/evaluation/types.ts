/** A redacted immutable item returned from a dataset revision. */
export interface DatasetItem {
  id: string;
  input: unknown;
  expectedOutput?: unknown;
  metadata?: Record<string, unknown>;
  attachments?: unknown[];
  toolTrajectory?: unknown;
}

/** A result emitted by a local customer evaluation command. */
export interface LocalEvaluationOutput {
  output: unknown;
  traceId?: string;
  totalTokens?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  /** Optional human-readable diagnostic. A non-empty value marks the item failed. */
  error?: string;
}

/** The newline-delimited JSON input passed to a local evaluation command. */
export interface LocalEvaluationInput {
  type: "axonpush.evaluation.input";
  experimentId: string;
  item: DatasetItem;
  configuration?: Record<string, unknown>;
}

/** One finished item, including local execution timing and API submission state. */
export interface EvaluationItemResult {
  itemId: string;
  output: unknown;
  traceId?: string;
  totalTokens?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
  status: "passed" | "failed" | "cancelled";
}

export interface GitLineage {
  gitCommit?: string;
  gitBranch?: string;
  gitDirty?: boolean;
}

export interface GateThresholds {
  /** Maximum tolerated score regression relative to baseline (for example 0.02). */
  maxScoreRegression?: number;
  /** Maximum candidate cost increase ratio relative to baseline (for example 0.1). */
  maxCostIncreaseRatio?: number;
  /** Maximum candidate latency increase ratio relative to baseline. */
  maxLatencyIncreaseRatio?: number;
  /** Absolute minimum score, when an evaluator yields a numeric score. */
  minimumScore?: number;
  /** Absolute maximum cost in USD per item/aggregate as interpreted by the server. */
  maximumCostUsd?: number;
  /** Absolute maximum latency in milliseconds as interpreted by the server. */
  maximumLatencyMs?: number;
}

export interface GateResult {
  passed: boolean;
  reasons: string[];
  experimentId: string;
  baselineExperimentId?: string;
  metrics?: Record<string, unknown>;
}

export interface EvaluationRunResult {
  experimentId: string;
  datasetId: string;
  datasetRevision: number | string;
  startedAt: string;
  completedAt: string;
  cancelled: boolean;
  lineage: GitLineage;
  results: EvaluationItemResult[];
  gate?: GateResult;
}

export interface LocalRunnerOptions {
  /** Immutable revision to fetch. */
  datasetId: string;
  datasetRevision: number | string;
  /** An existing experiment to receive results. */
  experimentId: string;
  /** Trusted local command. It receives exactly one JSONL input on stdin per item. */
  command: string;
  configuration?: Record<string, unknown>;
  concurrency?: number;
  timeoutMs?: number;
  /** Maximum time to wait for the API to transition the experiment to running. Default: 30s. */
  startupTimeoutMs?: number;
  signal?: AbortSignal;
  onResult?: (result: EvaluationItemResult) => void | Promise<void>;
}

export const EXIT_CODES = {
  success: 0,
  gateFailed: 1,
  usage: 2,
  remoteFailure: 3,
  evaluationFailure: 4,
  cancelled: 130,
} as const;
