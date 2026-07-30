import type { EvaluationRunResult } from "./types.js";

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serialize a stable machine-readable record suitable for CI artifacts. */
export function toJsonReport(result: EvaluationRunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Render a compact JUnit report so any CI system can surface failures per dataset item. */
export function toJUnitXml(result: EvaluationRunResult): string {
  const failures = result.results.filter((entry) => entry.status !== "passed");
  const cases = result.results
    .map((entry) => {
      const attrs = `classname="axonpush.evaluation" name="${xml(entry.itemId)}" time="${(entry.latencyMs / 1000).toFixed(3)}"`;
      if (entry.status === "passed") return `  <testcase ${attrs}/>`;
      const kind = entry.status === "cancelled" ? "skipped" : "failure";
      return `  <testcase ${attrs}><${kind} message="${xml(entry.error ?? entry.status)}"/></testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="axonpush.evaluation" tests="${result.results.length}" failures="${failures.length}" skipped="${result.results.filter((entry) => entry.status === "cancelled").length}" timestamp="${xml(result.startedAt)}">\n${cases}\n</testsuite>\n`;
}

/** Markdown accepted by GitHub Actions step summaries. */
export function toGitHubSummary(result: EvaluationRunResult): string {
  const passed = result.results.filter((entry) => entry.status === "passed").length;
  const failed = result.results.filter((entry) => entry.status === "failed").length;
  const status = result.cancelled
    ? "Cancelled"
    : result.gate
      ? result.gate.passed
        ? "Passed"
        : "Failed"
      : failed
        ? "Completed with failures"
        : "Passed";
  const lines = [
    "## AxonPush evaluation",
    "",
    `**${status}** · ${passed}/${result.results.length} item(s) passed${failed ? ` · ${failed} failed` : ""}`,
    "",
    "| Experiment | Dataset revision | Commit |",
    "| --- | --- | --- |",
    `| \`${result.experimentId}\` | \`${result.datasetId}@${result.datasetRevision}\` | ${result.lineage.gitCommit ? `\`${result.lineage.gitCommit.slice(0, 12)}\`` : "—"} |`,
  ];
  if (result.gate) {
    lines.push("", "### Release gate", "", result.gate.passed ? "Gate passed." : "Gate failed.");
    if (result.gate.reasons.length)
      lines.push("", ...result.gate.reasons.map((reason) => `- ${reason}`));
  }
  const unsuccessful = result.results.filter((entry) => entry.status !== "passed");
  if (unsuccessful.length) {
    lines.push(
      "",
      "### Failed items",
      "",
      ...unsuccessful.map((entry) => `- \`${entry.itemId}\`: ${entry.error ?? entry.status}`),
    );
  }
  return `${lines.join("\n")}\n`;
}
