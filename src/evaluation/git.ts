import { execFileSync } from "node:child_process";
import type { GitLineage } from "./types.js";

function git(args: string[]): string | undefined {
  try {
    return (
      execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Capture repository state without making the evaluation depend on git being installed.
 * This is intentionally best-effort: a non-git checkout is still a valid CI environment.
 */
export function captureGitLineage(cwd = process.cwd()): GitLineage {
  const options = ["-C", cwd];
  const gitCommit = git([...options, "rev-parse", "HEAD"]);
  if (!gitCommit) return {};
  const branch = git([...options, "rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git([...options, "status", "--porcelain", "--untracked-files=normal"]);
  return {
    gitCommit,
    gitBranch: branch === "HEAD" ? undefined : branch,
    gitDirty: Boolean(status),
  };
}
