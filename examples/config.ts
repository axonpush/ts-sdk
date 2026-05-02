/**
 * Shared environment loader for the AxonPush SDK examples.
 *
 * The examples expect the standard `AXONPUSH_*` environment variables
 * resolved by `new AxonPush()` itself, plus a couple of extras that the
 * facade does not consume directly (channel id, etc.).
 *
 * Set what you need, then run any example with `bun run examples/<file>.ts`.
 */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Set it in your shell or a .env file before running the examples.`,
    );
  }
  return v;
}

export const API_KEY = process.env.AXONPUSH_API_KEY ?? "";
export const TENANT_ID = process.env.AXONPUSH_TENANT_ID ?? "";
export const CHANNEL_ID = process.env.AXONPUSH_CHANNEL_ID ?? "";
export const APP_ID = process.env.AXONPUSH_APP_ID ?? "";
export const BASE_URL = process.env.AXONPUSH_BASE_URL ?? "http://localhost:3000";
export const ENVIRONMENT = process.env.AXONPUSH_ENVIRONMENT;

export function bail(reason: string): never {
  console.error(`[axonpush-example] ${reason}`);
  process.exit(1);
}

export async function tryImport<T>(spec: string): Promise<T | null> {
  try {
    return (await import(spec)) as T;
  } catch {
    return null;
  }
}
