/**
 * Concatenate `_exports_<stream>.txt` into `src/index.ts`.
 *
 * Run after the parallel-stream rewrite when all streams have committed.
 * Each stream drops its public re-exports as a line-per-export file at
 * the repo root; this script merges them into a single `src/index.ts`,
 * prepends a small preamble, and removes the temporary files.
 *
 * Mirrors `tools/merge-exports.py` from axonpush-python.
 */

import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const INDEX = join(REPO, "src", "index.ts");

const PREAMBLE = `/**
 * AxonPush — real-time event infrastructure for AI agent systems.
 *
 * Top-level package. Public API is re-exported here; internal helpers
 * live under \`./_internal\` and are not part of the supported surface.
 */

export { __version__ } from "./version";

`;

function main(): number {
  const snippets = readdirSync(REPO)
    .filter((f) => /^_exports_[a-z0-9]+\.txt$/.test(f))
    .sort();
  if (snippets.length === 0) {
    console.log("No _exports_*.txt files at repo root; nothing to merge.");
    return 1;
  }
  const seen = new Set<string>();
  const body: string[] = [];
  for (const name of snippets) {
    const path = join(REPO, name);
    body.push(`// from ${name}`);
    for (const raw of readFileSync(path, "utf-8").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line) {
        body.push(line);
        continue;
      }
      if (line.startsWith("//")) {
        body.push(line);
        continue;
      }
      if (seen.has(line)) continue;
      seen.add(line);
      body.push(line);
    }
    body.push("");
  }
  writeFileSync(INDEX, PREAMBLE + body.join("\n").replace(/\n+$/, "") + "\n");
  for (const name of snippets) unlinkSync(join(REPO, name));
  console.log(`Wrote ${INDEX} from ${snippets.length} export file(s).`);
  return 0;
}

process.exit(main());
