import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

export function currentEnvironment(): string | undefined {
  return storage.getStore();
}

export function withEnvironment<T>(environment: string, fn: () => T): T {
  return storage.run(environment, fn);
}
