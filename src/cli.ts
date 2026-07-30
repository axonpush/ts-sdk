#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AxonPush } from "./client.js";
import { EvaluationApiError, HttpEvaluationApi } from "./evaluation/api.js";
import { captureGitLineage } from "./evaluation/git.js";
import { toGitHubSummary, toJsonReport, toJUnitXml } from "./evaluation/reports.js";
import { runLocalEvaluation } from "./evaluation/runner.js";
import { EXIT_CODES, type GateThresholds } from "./evaluation/types.js";

type Arguments = Record<string, string | boolean | string[]>;

function usage(): string {
  return `Usage:
  axonpush-eval run --dataset <id> --revision <revision> --experiment <id> --command '<command>' [options]
  axonpush-eval run --dataset <id> --revision <revision> --target <id> --command '<command>' [options]

The evaluator command reads one JSON object from stdin and writes one JSON object to stdout:
  {"type":"axonpush.evaluation.input","experimentId":"…","item":{"id":"…","input":…}}
  {"output": <any JSON value>, "traceId"?: "…", "totalTokens"?: 12, "costUsd"?: 0.01, "error"?: "…"}

Options:
  --concurrency <n>           Local processes in flight (default: 4)
  --timeout <ms>              Per-item evaluator timeout (default: 30000)
  --startup-timeout <ms>      Wait for local experiment to enter running (default: 30000)
  --configuration <json>      Target configuration stored in input protocol/new experiment
  --target <id>               Create a new experiment and capture git lineage
  --name <name>               New experiment name (default: local-<ISO timestamp>)
  --evaluator <id>@<version>  Repeatable evaluator version for a new experiment
  --baseline <id>             Baseline experiment for a new experiment
  --no-gate                   Do not invoke the release gate
  --minimum-score <n>         Gate threshold
  --max-score-regression <n>  Gate threshold
  --maximum-cost-usd <n>      Gate threshold
  --max-cost-increase-ratio <n> Gate threshold
  --maximum-latency-ms <n>    Gate threshold
  --max-latency-increase-ratio <n> Gate threshold
  --json <path>               Write a JSON artifact
  --junit <path>              Write a JUnit XML artifact
  --github-summary <path>     Write GitHub Actions markdown (defaults to GITHUB_STEP_SUMMARY)

Exit codes: 0 passed, 1 gate failed, 2 invalid usage, 3 API failure, 4 evaluator failure, 130 cancelled.
Credentials use AXONPUSH_API_KEY, AXONPUSH_TENANT_ID/AXONPUSH_ORG_ID, AXONPUSH_BASE_URL, and AXONPUSH_ENVIRONMENT.`;
}

function parse(argv: string[]): { command?: string; args: Arguments } {
  const [command, ...rest] = argv;
  const args: Arguments = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token?.startsWith("--")) throw new TypeError(`Unexpected argument: ${token ?? ""}`);
    const [key, inline] = token.slice(2).split("=", 2);
    if (!key) throw new TypeError("Option name cannot be empty");
    if (key === "no-gate") {
      args[key] = true;
      continue;
    }
    const value = inline ?? rest[++index];
    if (!value || value.startsWith("--")) throw new TypeError(`Option --${key} requires a value`);
    if (key === "evaluator") {
      const existing = args[key];
      args[key] = [
        ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
        value,
      ];
    } else {
      args[key] = value;
    }
  }
  return { command, args };
}

function required(args: Arguments, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new TypeError(`--${name} is required`);
  return value;
}

function optionalNumber(args: Arguments, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`--${name} must be a number`);
  return parsed;
}

function jsonObject(args: Arguments, name: string): Record<string, unknown> | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`--${name} must be JSON`);
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`--${name} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function thresholds(args: Arguments): GateThresholds {
  const map: Array<[keyof GateThresholds, string]> = [
    ["minimumScore", "minimum-score"],
    ["maxScoreRegression", "max-score-regression"],
    ["maximumCostUsd", "maximum-cost-usd"],
    ["maxCostIncreaseRatio", "max-cost-increase-ratio"],
    ["maximumLatencyMs", "maximum-latency-ms"],
    ["maxLatencyIncreaseRatio", "max-latency-increase-ratio"],
  ];
  return Object.fromEntries(
    map.flatMap(([property, argument]) => {
      const value = optionalNumber(args, argument);
      return value === undefined ? [] : [[property, value]];
    }),
  ) as GateThresholds;
}

async function artifact(path: string | undefined, contents: string): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function evaluatorVersions(
  value: Arguments["evaluator"] | undefined,
): Array<{ evaluatorId: string; version: string }> {
  const all = Array.isArray(value) ? value : value ? [String(value)] : [];
  return all.map((entry) => {
    const at = entry.lastIndexOf("@");
    if (at <= 0 || at === entry.length - 1)
      throw new TypeError("--evaluator must have the form <id>@<version>");
    return { evaluatorId: entry.slice(0, at), version: entry.slice(at + 1) };
  });
}

async function main(argv: string[]): Promise<number> {
  const parsed = parse(argv);
  if (parsed.command !== "run") throw new TypeError("Only the `run` command is supported");
  const datasetId = required(parsed.args, "dataset");
  const datasetRevision = required(parsed.args, "revision");
  const command = required(parsed.args, "command");
  const client = new AxonPush();
  const api = new HttpEvaluationApi(client.settings);
  const configuration = jsonObject(parsed.args, "configuration");
  let experimentId =
    typeof parsed.args.experiment === "string" ? parsed.args.experiment : undefined;
  if (!experimentId) {
    const targetId = required(parsed.args, "target");
    const lineage = captureGitLineage();
    const created = await api.createExperiment({
      name:
        typeof parsed.args.name === "string"
          ? parsed.args.name
          : `local-${new Date().toISOString()}`,
      datasetId,
      datasetRevision,
      targetId,
      evaluatorVersions: evaluatorVersions(parsed.args.evaluator),
      ...(typeof parsed.args.baseline === "string"
        ? { baselineExperimentId: parsed.args.baseline }
        : {}),
      ...(configuration ? { configuration } : {}),
      ...lineage,
    });
    experimentId = created.id;
  }
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new Error("Interrupted"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await runLocalEvaluation(api, {
      datasetId,
      datasetRevision,
      experimentId,
      command,
      configuration,
      concurrency: optionalNumber(parsed.args, "concurrency"),
      timeoutMs: optionalNumber(parsed.args, "timeout"),
      startupTimeoutMs: optionalNumber(parsed.args, "startup-timeout"),
      signal: cancellation.signal,
    });
    if (!parsed.args["no-gate"] && !result.cancelled)
      result.gate = await api.gateExperiment(experimentId, thresholds(parsed.args));
    await Promise.all([
      artifact(
        typeof parsed.args.json === "string" ? parsed.args.json : undefined,
        toJsonReport(result),
      ),
      artifact(
        typeof parsed.args.junit === "string" ? parsed.args.junit : undefined,
        toJUnitXml(result),
      ),
      artifact(
        typeof parsed.args["github-summary"] === "string"
          ? parsed.args["github-summary"]
          : process.env.GITHUB_STEP_SUMMARY,
        toGitHubSummary(result),
      ),
    ]);
    process.stdout.write(toJsonReport(result));
    if (result.cancelled) return EXIT_CODES.cancelled;
    if (result.gate && !result.gate.passed) return EXIT_CODES.gateFailed;
    if (result.results.some((entry) => entry.status !== "passed"))
      return EXIT_CODES.evaluationFailure;
    return EXIT_CODES.success;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

void main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`axonpush-eval: ${message}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode =
      error instanceof EvaluationApiError ? EXIT_CODES.remoteFailure : EXIT_CODES.usage;
  },
);
