/**
 * Caller-supplied AxonPush configuration. Falsy values fall through to the
 * matching `AXONPUSH_*` environment variable; any field still unset after
 * that fall-through receives the documented default.
 */
export interface AxonPushOptions {
  /** API key minted via the AxonPush dashboard. Required at request time. */
  apiKey?: string;
  /** Tenant (organisation) UUID the API key belongs to. */
  tenantId?: string;
  /** Convenience alias for {@link tenantId}; takes precedence when set. */
  orgId?: string;
  /** Default app id used by resources that need one but didn't get one. */
  appId?: string;
  /** REST API base URL. Defaults to `http://localhost:3000`. */
  baseUrl?: string;
  /** Logical environment label (e.g. `production`, `staging`). */
  environment?: string;
  /** AWS IoT Core MQTT-over-WSS endpoint, used by realtime. */
  iotEndpoint?: string;
  /** Override websocket URL; defaults to `iotEndpoint` when omitted. */
  wsUrl?: string;
  /** Request timeout in milliseconds. Default `30_000`. */
  timeout?: number;
  /** Maximum number of retry attempts for retryable errors. Default `3`. */
  maxRetries?: number;
  /**
   * When true, swallow {@link APIConnectionError} and resolve `null` instead
   * of throwing. Useful in fire-and-forget telemetry paths. Default `false`.
   */
  failOpen?: boolean;
}

/**
 * Fully-resolved settings produced by {@link resolveSettings}. Every optional
 * field on {@link AxonPushOptions} that has a sensible default is materialised
 * here so the rest of the SDK can rely on concrete values.
 */
export interface ResolvedSettings {
  apiKey: string | undefined;
  tenantId: string | undefined;
  orgId: string | undefined;
  appId: string | undefined;
  baseUrl: string;
  environment: string | undefined;
  iotEndpoint: string | undefined;
  wsUrl: string | undefined;
  timeout: number;
  maxRetries: number;
  failOpen: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

function envString(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function envBool(name: string): boolean | undefined {
  const raw = envString(name);
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return undefined;
}

function envInt(name: string): number | undefined {
  const raw = envString(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Merge caller-supplied options with `AXONPUSH_*` environment variables and
 * documented defaults. Caller options always win when defined.
 *
 * @param options Optional partial configuration from the caller.
 * @returns A {@link ResolvedSettings} record with every default applied.
 */
export function resolveSettings(options?: AxonPushOptions): ResolvedSettings {
  const opts = options ?? {};
  const orgId = opts.orgId ?? envString("AXONPUSH_ORG_ID") ?? envString("AXONPUSH_TENANT_ID");
  const tenantId = opts.tenantId ?? envString("AXONPUSH_TENANT_ID") ?? orgId;
  return {
    apiKey: opts.apiKey ?? envString("AXONPUSH_API_KEY"),
    tenantId,
    orgId: orgId ?? tenantId,
    appId: opts.appId ?? envString("AXONPUSH_APP_ID"),
    baseUrl: opts.baseUrl ?? envString("AXONPUSH_BASE_URL") ?? DEFAULT_BASE_URL,
    environment: opts.environment ?? envString("AXONPUSH_ENVIRONMENT"),
    iotEndpoint: opts.iotEndpoint ?? envString("AXONPUSH_IOT_ENDPOINT"),
    wsUrl: opts.wsUrl ?? envString("AXONPUSH_WS_URL"),
    timeout: opts.timeout ?? envInt("AXONPUSH_TIMEOUT") ?? DEFAULT_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? envInt("AXONPUSH_MAX_RETRIES") ?? DEFAULT_MAX_RETRIES,
    failOpen: opts.failOpen ?? envBool("AXONPUSH_FAIL_OPEN") ?? false,
  };
}
