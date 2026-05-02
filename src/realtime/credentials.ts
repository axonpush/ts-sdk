import { iotCredentialsControllerGetCredentials } from "../_internal/api/sdk.gen.js";
import type { IotCredentialsResponseDto } from "../_internal/api/types.gen.js";

/**
 * IoT credentials returned by the backend's `/auth/iot-credentials`
 * endpoint. Shape matches the generated `IotCredentialsResponseDto` but
 * widens the optional fields so older backends remain consumable.
 */
export interface IotCredentials {
  endpoint: string;
  presignedWssUrl: string;
  expiresAt: string;
  topicPrefix?: string;
  envSlug?: string;
  topicTemplate?: string;
  clientId?: string;
  region?: string;
}

/** Subset of `AxonPush` we depend on — kept loose so Stream A's class can land independently. */
export interface AxonPushLike {
  invoke<T>(op: unknown, args?: unknown): Promise<T | null>;
}

/**
 * Fetch a fresh set of IoT MQTT credentials.
 *
 * Delegates to the generated `iotCredentialsControllerGetCredentials` op
 * via `client.invoke(...)` so retries, error mapping and tracing all run
 * through the central transport chokepoint.
 *
 * @param client the AxonPush instance to invoke through
 * @param opts optional override (`endpoint` reserved for future scope)
 * @returns parsed IoT credentials
 * @throws AxonPushError if the underlying call fails (and `failOpen` is off)
 */
export async function fetchIotCredentials(
  client: AxonPushLike,
  _opts?: { endpoint?: string },
): Promise<IotCredentials> {
  const result = await client.invoke<IotCredentialsResponseDto>(
    iotCredentialsControllerGetCredentials,
    undefined,
  );
  if (!result?.presignedWssUrl || !result.expiresAt) {
    throw new Error(
      "iotCredentialsControllerGetCredentials returned no credentials (presignedWssUrl/expiresAt missing)",
    );
  }
  const out: IotCredentials = {
    endpoint: result.endpoint,
    presignedWssUrl: result.presignedWssUrl,
    expiresAt: result.expiresAt,
  };
  if (result.topicPrefix) out.topicPrefix = result.topicPrefix;
  if (result.envSlug) out.envSlug = result.envSlug;
  if (result.topicTemplate) out.topicTemplate = result.topicTemplate;
  if (result.clientId) out.clientId = result.clientId;
  if (result.region) out.region = result.region;
  return out;
}

/** Milliseconds until we should refresh, given a credential expiry timestamp and a lead window. */
export function msUntilRefresh(expiresAt: string, leadMs = 60_000): number {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, expiry - Date.now() - leadMs);
}
