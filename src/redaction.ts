import type { ResolvedSettings } from "./config.js";

const SECRET_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|api[-_.]?key|access[-_.]?token|refresh[-_.]?token|private[-_.]?key)$/i;
const CONTENT_KEY =
  /^(prompt|prompts|messages?|completion|completions|input|output|response|tool[-_.]?(arguments?|result|output)|retrieval[-_.]?(documents?|content))$/i;

export function redactTelemetry<T>(value: T, settings: ResolvedSettings): T {
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      return current.length > settings.maxContentLength
        ? `${current.slice(0, settings.maxContentLength)}…[TRUNCATED]`
        : current;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (
        SECRET_KEY.test(key) ||
        settings.redactKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()) ||
        (settings.contentCaptureMode === "metadata_only" && CONTENT_KEY.test(key))
      ) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = visit(child);
      }
    }
    return output;
  };
  return visit(value) as T;
}
