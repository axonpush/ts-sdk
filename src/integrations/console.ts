import type { AxonPush } from "../client.js";
import type { EventType } from "../index.js";
import { logger as sdkLogger } from "../logger.js";
import type { PublishParams } from "../resources/events.js";
import {
  type ChannelIdInput,
  coerceChannelId,
  dispatchPublish,
  type IntegrationConfig,
  initTrace,
  inPublisherScope,
  makePublisher,
  type PublisherHolder,
} from "./_base.js";

export { flushAfterInvocation } from "./_publisher.js";

/**
 * Capture `console.log` / `console.info` / `console.warn` / `console.error` /
 * `console.debug` calls and emit them to AxonPush as OpenTelemetry-shaped
 * log events. Each captured call still passes through to the original
 * console method, so user output is unaffected.
 *
 * Publishing is **non-blocking** by default — captured lines are pushed
 * onto a bounded queue and drained by a background task. Call
 * `handle.flush(timeoutMs?)` at known checkpoints (end of a Lambda
 * invocation, end of a test) to guarantee delivery, or `handle.close()`
 * on graceful shutdown.
 *
 * Re-entrancy: when the SDK's own `consola` logger emits a warning while
 * the publisher is mid-flight, those records are filtered out via the
 * `inPublisherScope()` flag so they don't loop back into AxonPush.
 *
 * On `process.exit`, `beforeExit`, and `uncaughtException`, the patch is
 * restored automatically so a crashing app still sees its original
 * console output.
 *
 * Use the `source` option to control whether captured logs are tagged as
 * `agent.log` (the default — for AI agent projects) or `app.log` (for
 * backend services). The wizard wires this up automatically based on
 * detected project type.
 */

const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

const SEVERITY_MAP: Record<ConsoleLevel, { number: number; text: string }> = {
  debug: { number: 5, text: "DEBUG" },
  log: { number: 9, text: "INFO" },
  info: { number: 9, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
};

export interface ConsoleCaptureConfig extends IntegrationConfig {
  source?: "agent" | "app";
  serviceName?: string;
  maxBodyLength?: number;
}

export interface ConsoleCaptureHandle {
  unpatch(): void;
  flush(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export function setupConsoleCapture(config: ConsoleCaptureConfig): ConsoleCaptureHandle {
  const client = config.client;
  const channelId = coerceChannelId(config.channelId);
  const trace = initTrace(config.traceId);
  const source = config.source ?? "agent";
  const eventType: EventType = source === "app" ? "app.log" : "agent.log";
  const maxBodyLength = config.maxBodyLength ?? 4000;
  const serviceName = config.serviceName;
  const holder = makePublisher(client, config, "consoleCapture");

  const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
  let unpatched = false;

  const consoleUnknown = console as unknown as Record<string, unknown>;
  for (const level of CONSOLE_LEVELS) {
    const orig = consoleUnknown[level] as (...args: unknown[]) => void;
    if (typeof orig !== "function") continue;
    originals[level] = orig;

    consoleUnknown[level] = (...args: unknown[]) => {
      try {
        orig.apply(console, args);
      } catch {
        // extremely unlikely
      }

      if (inPublisherScope()) return;

      try {
        emitCaptured(client, holder, channelId, eventType, level, args, {
          trace,
          agentId: config.agentId,
          serviceName,
          maxBodyLength,
        });
      } catch (err) {
        sdkLogger.warn(`console capture failed: ${(err as Error).message}`);
      }
    };
  }

  const restore = (): void => {
    if (unpatched) return;
    unpatched = true;
    for (const level of CONSOLE_LEVELS) {
      const orig = originals[level];
      if (orig) {
        consoleUnknown[level] = orig;
      }
    }
  };

  const lifecycle = installConsoleLifecycle(restore);

  return {
    unpatch() {
      restore();
      lifecycle.dispose();
    },
    async flush(timeoutMs?: number): Promise<void> {
      if (holder.publisher) await holder.publisher.flush(timeoutMs);
    },
    async close(): Promise<void> {
      restore();
      lifecycle.dispose();
      if (holder.publisher) await holder.publisher.close();
    },
  };
}

function installConsoleLifecycle(restore: () => void): { dispose(): void } {
  if (typeof process === "undefined" || typeof process.on !== "function") {
    return { dispose() {} };
  }
  const onExit = (): void => {
    try {
      restore();
    } catch {
      // restoration must never throw
    }
  };
  const onUncaught = (err: Error): void => {
    onExit();
    // re-emit so the default handler still runs (Node prints stack and
    // exits with 1 if no other handler intercepts).
    process.nextTick(() => {
      throw err;
    });
  };
  process.on("exit", onExit);
  process.on("beforeExit", onExit);
  process.on("uncaughtException", onUncaught);
  return {
    dispose(): void {
      process.removeListener("exit", onExit);
      process.removeListener("beforeExit", onExit);
      process.removeListener("uncaughtException", onUncaught);
    },
  };
}

function emitCaptured(
  client: AxonPush,
  holder: PublisherHolder,
  channelId: ChannelIdInput,
  eventType: EventType,
  level: ConsoleLevel,
  args: unknown[],
  opts: {
    trace: ReturnType<typeof initTrace>;
    agentId?: string;
    serviceName?: string;
    maxBodyLength: number;
  },
): void {
  const severity = SEVERITY_MAP[level];
  const body = formatBody(args, opts.maxBodyLength);

  const payload: Record<string, unknown> = {
    timeUnixNano: String(Date.now() * 1_000_000),
    severityNumber: severity.number,
    severityText: severity.text,
    body,
    attributes: {
      "log.iostream": level === "error" || level === "warn" ? "stderr" : "stdout",
      "log.source": "console",
    },
  };

  if (opts.serviceName) {
    payload.resource = { "service.name": opts.serviceName };
  }

  const params: PublishParams = {
    identifier: "console",
    payload: payload as Record<string, never>,
    channelId: coerceChannelId(channelId),
    agentId: opts.agentId,
    traceId: opts.trace.traceId,
    spanId: opts.trace.nextSpanId(),
    eventType,
    metadata: { framework: "console-capture" } as unknown as Record<string, never>,
  };
  dispatchPublish(client, holder, params);
}

function formatBody(args: unknown[], maxLength: number): unknown {
  if (args.length === 1) {
    const v = args[0];
    if (typeof v === "string") return truncateString(v, maxLength);
    return safeStringify(v, maxLength);
  }

  const parts = args.map((a) => (typeof a === "string" ? a : safeStringify(a, maxLength)));
  return truncateString(parts.join(" "), maxLength);
}

function safeStringify(v: unknown, maxLength: number): string {
  try {
    const s = JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2);
    return truncateString(s, maxLength);
  } catch {
    return truncateString(String(v), maxLength);
  }
}

function truncateString(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength)}…[truncated]`;
}
