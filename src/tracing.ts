import { AsyncLocalStorage } from "node:async_hooks";

export class TraceContext {
  readonly traceId: string;
  private spanCounter = 0;

  constructor(traceId?: string) {
    this.traceId = traceId ?? `tr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }

  nextSpanId(): string {
    this.spanCounter++;
    return `sp_${this.traceId.slice(3)}_${String(this.spanCounter).padStart(4, "0")}`;
  }
}

const storage = new AsyncLocalStorage<TraceContext>();

export function getOrCreateTrace(traceId?: string): TraceContext {
  const existing = storage.getStore();
  if (existing) return existing;
  return new TraceContext(traceId);
}

export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

export function withTrace<T>(traceId: string | undefined, fn: () => T): T {
  const ctx = new TraceContext(traceId);
  return storage.run(ctx, fn);
}
