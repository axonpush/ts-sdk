import { spawn } from "node:child_process";
import type { EvaluationApi } from "./api.js";
import { captureGitLineage } from "./git.js";
import type {
  DatasetItem,
  EvaluationItemResult,
  EvaluationRunResult,
  LocalEvaluationInput,
  LocalEvaluationOutput,
  LocalRunnerOptions,
} from "./types.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_POLL_INTERVAL_MS = 250;

class CancelledError extends Error {
  constructor() {
    super("Evaluation was cancelled");
    this.name = "CancelledError";
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1)
    throw new TypeError(`${label} must be a positive integer`);
  return result;
}

function readOutput(stdout: string): LocalEvaluationOutput {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("Evaluator command produced no JSONL result");
  // Permit diagnostics before the result; the last JSON line is authoritative.
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed: unknown = JSON.parse(lines[index] ?? "");
      if (!parsed || typeof parsed !== "object" || !("output" in parsed)) continue;
      const record = parsed as Record<string, unknown>;
      return {
        output: record.output,
        ...(typeof record.traceId === "string" ? { traceId: record.traceId } : {}),
        ...(typeof record.totalTokens === "number" ? { totalTokens: record.totalTokens } : {}),
        ...(typeof record.costUsd === "number" ? { costUsd: record.costUsd } : {}),
        ...(record.metadata && typeof record.metadata === "object"
          ? { metadata: record.metadata as Record<string, unknown> }
          : {}),
        ...(typeof record.error === "string" ? { error: record.error } : {}),
      };
    } catch {
      // Continue searching for the single protocol result line.
    }
  }
  throw new Error("Evaluator command did not emit a JSON object with an output field");
}

async function executeItem(
  command: string,
  payload: LocalEvaluationInput,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<LocalEvaluationOutput> {
  if (signal?.aborted) throw new CancelledError();
  return new Promise((resolve, reject) => {
    // The command is deliberately a shell string: it is executed only on the customer's
    // machine and makes normal CI commands (for example `node ./eval.mjs`) ergonomic.
    const child = spawn(command, [], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let closed = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const terminate = () => {
      if (!child.killed) child.kill("SIGTERM");
      const force = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 1_000);
      force.unref();
    };
    const abort = () => {
      terminate();
      finish(() => reject(new CancelledError()));
    };
    const timeout = setTimeout(() => {
      terminate();
      finish(() => reject(new Error(`Evaluator timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, childSignal) => {
      closed = true;
      finish(() => {
        if (signal?.aborted) return reject(new CancelledError());
        if (code !== 0) {
          return reject(
            new Error(
              `Evaluator exited with ${childSignal ? `signal ${childSignal}` : `code ${String(code)}`}${stderr ? `: ${stderr.trim()}` : ""}`,
            ),
          );
        }
        try {
          resolve(readOutput(stdout));
        } catch (error) {
          reject(error);
        }
      });
    });
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function failedResult(item: DatasetItem, latencyMs: number, error: unknown): EvaluationItemResult {
  return {
    itemId: item.id,
    output: null,
    latencyMs,
    error: error instanceof Error ? error.message : String(error),
    status: error instanceof CancelledError ? "cancelled" : "failed",
  };
}

async function waitForRunning(
  api: EvaluationApi,
  experimentId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (signal.aborted) throw new CancelledError();
    const status = await api.getExperimentStatus(experimentId, signal);
    if (status === "running") return;
    if (status === "failed" || status === "cancelled" || status === "completed") {
      throw new Error(
        `Experiment ${experimentId} entered ${status} before local execution started`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new CancelledError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, STARTUP_POLL_INTERVAL_MS);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  throw new Error(`Experiment ${experimentId} did not reach running within ${timeoutMs}ms`);
}

/**
 * Executes an immutable dataset revision using a local JSONL command and submits every
 * result independently. The evaluator executes on the customer/CI host; no customer code
 * is uploaded or run by AxonPush.
 */
export async function runLocalEvaluation(
  api: EvaluationApi,
  options: LocalRunnerOptions,
): Promise<EvaluationRunResult> {
  if (!options.datasetId || !options.experimentId || !options.command.trim()) {
    throw new TypeError("datasetId, experimentId, and command are required");
  }
  const concurrency = positiveInteger(options.concurrency, DEFAULT_CONCURRENCY, "concurrency");
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const startupTimeoutMs = positiveInteger(
    options.startupTimeoutMs,
    DEFAULT_STARTUP_TIMEOUT_MS,
    "startupTimeoutMs",
  );
  const startedAt = new Date().toISOString();
  const lineage = captureGitLineage();
  const controller = new AbortController();
  const externalAbort = () => controller.abort(options.signal?.reason ?? new CancelledError());
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();

  const results: EvaluationItemResult[] = [];
  let next = 0;
  let submissionError: unknown;
  let cancelRequested = false;
  try {
    try {
      await api.startExperiment(options.experimentId, controller.signal);
      await waitForRunning(api, options.experimentId, startupTimeoutMs, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      cancelRequested = true;
    }
    let items: DatasetItem[];
    try {
      items = cancelRequested
        ? []
        : await api.fetchDatasetRevisionItems(
            options.datasetId,
            options.datasetRevision,
            controller.signal,
          );
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      cancelRequested = true;
      items = [];
    }
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const index = next++;
        const item = items[index];
        if (!item) return;
        const clock = performance.now();
        let result: EvaluationItemResult;
        try {
          const output = await executeItem(
            options.command,
            {
              type: "axonpush.evaluation.input",
              experimentId: options.experimentId,
              item,
              configuration: options.configuration,
            },
            timeoutMs,
            controller.signal,
          );
          result = {
            itemId: item.id,
            output: output.output,
            ...(output.traceId === undefined ? {} : { traceId: output.traceId }),
            ...(output.totalTokens === undefined ? {} : { totalTokens: output.totalTokens }),
            ...(output.costUsd === undefined ? {} : { costUsd: output.costUsd }),
            ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
            ...(output.error === undefined ? {} : { error: output.error }),
            latencyMs: Math.round(performance.now() - clock),
            status: output.error ? "failed" : "passed",
          };
        } catch (error) {
          result = failedResult(item, Math.round(performance.now() - clock), error);
        }
        results.push(result);
        if (result.status === "cancelled") {
          cancelRequested = true;
          controller.abort(new CancelledError());
          return;
        }
        try {
          await api.submitResults(options.experimentId, [result], controller.signal);
          await options.onResult?.(result);
        } catch (error) {
          if (controller.signal.aborted) {
            cancelRequested = true;
            return;
          }
          submissionError = error;
          controller.abort(error);
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  } finally {
    options.signal?.removeEventListener("abort", externalAbort);
  }

  const cancelled = cancelRequested || Boolean(options.signal?.aborted);
  if (cancelled) {
    try {
      await api.cancelExperiment(options.experimentId);
    } catch {
      // The local cancellation is still authoritative. Preserve its stable exit behaviour.
    }
  }
  if (submissionError) throw submissionError;
  return {
    experimentId: options.experimentId,
    datasetId: options.datasetId,
    datasetRevision: options.datasetRevision,
    startedAt,
    completedAt: new Date().toISOString(),
    cancelled,
    lineage,
    results: results.sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
}
