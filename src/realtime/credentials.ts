export interface IotCredentials {
  endpoint: string;
  presignedWssUrl: string;
  expiresAt: string;
}

export interface FetchCredentialsOptions {
  baseUrl: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export async function fetchIotCredentials(opts: FetchCredentialsOptions): Promise<IotCredentials> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/auth/iot-credentials`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { ...opts.headers, Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch IoT credentials: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  const body = (await response.json()) as IotCredentials;
  if (!body?.presignedWssUrl || !body?.expiresAt) {
    throw new Error("IoT credentials response missing presignedWssUrl or expiresAt");
  }
  return body;
}

export function msUntilRefresh(expiresAt: string, leadSeconds = 60): number {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, expiry - Date.now() - leadSeconds * 1000);
}
