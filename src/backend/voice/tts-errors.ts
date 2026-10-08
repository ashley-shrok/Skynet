/**
 * Error types shared by the TTS providers (see tts-provider.ts).
 * Kept in their own module so the provider registry and the provider
 * implementations can both import them without an import cycle — same
 * split as stt-errors.ts.
 */

/**
 * Thrown when the instance's TTS config can't work (unknown TTS_PROVIDER,
 * missing API key). Every provider's `isUnavailable` treats it as a 503.
 */
export class TtsNotConfiguredError extends Error {
  override name = "TtsNotConfiguredError";
}

/**
 * Non-2xx response from an HTTP TTS provider. `body` is a truncated copy of
 * the response text for server logs only — never returned to clients.
 */
export class TtsHttpError extends Error {
  override name = "TtsHttpError";
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} TTS HTTP ${status}: ${body}`);
  }
}

/**
 * The request never produced an HTTP response: DNS/socket failure, or the
 * client-side timeout fired. Always worth a retry.
 */
export class TtsNetworkError extends Error {
  override name = "TtsNetworkError";
  constructor(
    readonly provider: string,
    cause: unknown,
  ) {
    super(`${provider} TTS request failed: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`, { cause });
  }
}
