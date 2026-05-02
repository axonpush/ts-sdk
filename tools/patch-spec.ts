/**
 * Patch the dumped backend OpenAPI spec before codegen.
 *
 * NestJS swagger emits two shapes that openapi-ts will trip over:
 *
 *  1. `items.required` as a boolean (legal only on parameters, not array
 *     item schemas). Drop it.
 *  2. Duplicate header parameters under different casings
 *     (`x-axonpush-channel` AND `X-Axonpush-Channel` on the same op).
 *     Collapse to one Title-Case version.
 *
 * Mirrors `tools/patch-spec.py` in axonpush-python.
 */

import { readFileSync, writeFileSync } from "node:fs";

type Json = unknown;

function fixArrayItemsRequired(node: Json): void {
  if (Array.isArray(node)) {
    for (const v of node) fixArrayItemsRequired(v);
    return;
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, Json>;
    const items = obj.items;
    if (
      items !== null &&
      typeof items === "object" &&
      !Array.isArray(items) &&
      typeof (items as Record<string, Json>).required === "boolean"
    ) {
      delete (items as Record<string, Json>).required;
    }
    for (const v of Object.values(obj)) fixArrayItemsRequired(v);
  }
}

function dedupeHeaderParams(spec: Record<string, Json>): void {
  const paths = (spec.paths as Record<string, Record<string, Json>>) ?? {};
  for (const ops of Object.values(paths)) {
    for (const op of Object.values(ops)) {
      if (op === null || typeof op !== "object" || Array.isArray(op)) continue;
      const opObj = op as Record<string, Json>;
      const params = (opObj.parameters as Array<Record<string, Json>>) ?? [];
      const seen = new Map<string, Record<string, Json>>();
      for (const p of params) {
        if (p.in !== "header") continue;
        const key = String(p.name).toLowerCase();
        const incumbent = seen.get(key);
        if (!incumbent) {
          seen.set(key, p);
        } else if (p.required && !incumbent.required) {
          seen.set(key, p);
        }
      }
      const next: Array<Record<string, Json>> = params.filter((p) => p.in !== "header");
      for (const p of seen.values()) {
        const cloned = { ...p };
        cloned.name = String(p.name)
          .split("-")
          .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part))
          .join("-");
        next.push(cloned);
      }
      opObj.parameters = next;
    }
  }
}

function main(path: string): void {
  const raw = readFileSync(path, "utf-8");
  const spec = JSON.parse(raw) as Record<string, Json>;
  fixArrayItemsRequired(spec);
  dedupeHeaderParams(spec);
  writeFileSync(path, JSON.stringify(spec, null, 2));
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: bun run tools/patch-spec.ts <path-to-openapi.json>");
  process.exit(2);
}
main(inputPath);
