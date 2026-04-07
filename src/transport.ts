import createClient, { type Middleware } from "openapi-fetch";
import { ConnectionError, mapError } from "./errors.js";
import { logger } from "./logger.js";
import type { paths } from "./schema";

export interface TransportOptions {
  apiKey: string;
  tenantId: string;
  baseUrl: string;
  failOpen: boolean;
}

function createAuthMiddleware(opts: TransportOptions): Middleware {
  return {
    async onRequest({ request }) {
      request.headers.set("X-API-Key", opts.apiKey);
      request.headers.set("x-tenant-id", opts.tenantId);
      request.headers.set("Content-Type", "application/json");
      return request;
    },
  };
}

function createErrorMiddleware(opts: TransportOptions): Middleware {
  return {
    async onResponse({ response }) {
      if (response.ok) return response;

      let body: { message?: string; error?: string } | undefined;
      try {
        body = (await response.clone().json()) as { message?: string; error?: string };
      } catch {}

      const error = mapError(response.status, body);

      if (opts.failOpen) {
        logger.warn(`${error.name}: ${error.message}`);
        return response;
      }

      throw error;
    },
  };
}

export type TransportClient = ReturnType<typeof createClient<paths>>;

export function createTransport(opts: TransportOptions): TransportClient {
  const client = createClient<paths>({ baseUrl: opts.baseUrl });
  client.use(createAuthMiddleware(opts));
  client.use(createErrorMiddleware(opts));
  return client;
}

export async function safeFetch(
  url: string,
  init: RequestInit,
  failOpen: boolean,
): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (!response.ok && !failOpen) {
      let body: { message?: string; error?: string } | undefined;
      try {
        body = (await response.clone().json()) as { message?: string; error?: string };
      } catch {}
      throw mapError(response.status, body);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && !err.constructor.name.includes("AxonPush")) {
      const connErr = new ConnectionError(err.message);
      if (failOpen) {
        logger.warn(`${connErr.name}: ${connErr.message}`);
        throw connErr;
      }
      throw connErr;
    }
    throw err;
  }
}
