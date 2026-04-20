/**
 * Sentry SDK integration helper.
 *
 * Builds a Sentry DSN from AxonPush credentials and forwards to Sentry.init().
 * Usable with `@sentry/node`, `@sentry/browser`, `@sentry/nextjs`, etc.
 *
 * Usage (Node):
 *   import * as Sentry from "@sentry/node";
 *   import { installSentry } from "@axonpush/sdk/integrations/sentry";
 *   installSentry(Sentry, {
 *     apiKey: process.env.AXONPUSH_API_KEY!,
 *     channelId: 42,
 *     environment: "production",
 *     release: process.env.RELEASE,
 *   });
 */

import { logger } from "../logger.js";

const ENV_PRECEDENCE = [
  "AXONPUSH_ENVIRONMENT",
  "SENTRY_ENVIRONMENT",
  "NODE_ENV",
  "APP_ENV",
  "ENV",
] as const;

function detectEnvironment(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  for (const name of ENV_PRECEDENCE) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }
  return undefined;
}

export interface InstallSentryOptions {
  apiKey?: string;
  channelId?: number;
  host?: string;
  dsn?: string;
  environment?: string;
  release?: string;
  [key: string]: unknown;
}

export interface SentryLike {
  init: (options: Record<string, unknown>) => unknown;
}

export function buildDsn(apiKey: string, channelId: number, host: string): string {
  const scheme = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${scheme}://${apiKey}@${host}/${channelId}`;
}

export function installSentry(
  sentry: SentryLike,
  options: InstallSentryOptions = {},
): void {
  let dsn = options.dsn;
  if (!dsn) {
    const apiKey = options.apiKey ?? process.env.AXONPUSH_API_KEY;
    const channelIdRaw =
      options.channelId !== undefined
        ? options.channelId
        : process.env.AXONPUSH_CHANNEL_ID
          ? Number(process.env.AXONPUSH_CHANNEL_ID)
          : undefined;
    const host = options.host ?? process.env.AXONPUSH_HOST ?? "api.axonpush.xyz";
    if (!apiKey || !channelIdRaw) {
      throw new Error(
        "installSentry needs apiKey + channelId (or a fully-formed dsn). " +
          "Pass them in options or set AXONPUSH_API_KEY / AXONPUSH_CHANNEL_ID.",
      );
    }
    dsn = buildDsn(apiKey, channelIdRaw, host);
  }

  const resolvedEnv = options.environment ?? detectEnvironment();
  logger.debug(
    `installSentry: dsn host=${dsn.split("@")[1] ?? dsn} environment=${resolvedEnv ?? "<none>"} release=${options.release ?? "<none>"}`,
  );

  const {
    apiKey: _a,
    channelId: _c,
    host: _h,
    dsn: _d,
    environment: _e,
    release: _r,
    ...extraInitOptions
  } = options;
  void _a; void _c; void _h; void _d; void _e; void _r;

  const initOptions: Record<string, unknown> = {
    dsn,
    ...extraInitOptions,
  };
  if (resolvedEnv !== undefined && !("environment" in initOptions)) {
    initOptions.environment = resolvedEnv;
  }
  if (options.release !== undefined && !("release" in initOptions)) {
    initOptions.release = options.release;
  }

  sentry.init(initOptions);
}
