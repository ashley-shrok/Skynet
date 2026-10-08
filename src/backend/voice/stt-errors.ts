/**
 * Error types shared by the STT providers (see stt-provider.ts).
 * Kept in their own module so the provider registry and the provider
 * implementations can both import them without an import cycle.
 */

/**
 * Thrown when the instance's STT config can't work (unknown STT_PROVIDER,
 * missing API key). Every provider's `isUnavailable` treats it as a 503.
 */
export class SttNotConfiguredError extends Error {
  override name = "SttNotConfiguredError";
}

/**
 * Non-2xx response from an HTTP STT provider. `body` is a truncated copy of
 * the response text for server logs only — never returned to clients.
 */
export class SttHttpError extends Error {
  override name = "SttHttpError";
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} STT HTTP ${status}: ${body}`);
  }
}

/**
 * The request never produced an HTTP response: DNS/socket failure, or the
 * client-side timeout fired. Always worth a retry.
 */
export class SttNetworkError extends Error {
  override name = "SttNetworkError";
  constructor(
    readonly provider: string,
    cause: unknown,
  ) {
    super(`${provider} STT request failed: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`, { cause });
  }
}
