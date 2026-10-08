import { toast } from "sonner";

/**
 * Visible notice when a speak button can't speak — the provider is
 * unavailable (503: unknown/misconfigured provider, rejected key, out of
 * credits) or errored. Speech must never just go silent; the server never
 * falls back to another provider, so this notice is how a failing provider
 * shows up.
 */
export function notifySpeakFailed(status?: number): void {
  toast.error("Couldn't speak this message", {
    description:
      status === 503
        ? "The voice service is unavailable."
        : status !== undefined
          ? "The voice service had a problem. Try again in a moment."
          : "Speech stopped before it finished.",
  });
}

/** Pull the HTTP status out of a `postSpeakStream returned <status>` error. */
export function speakErrorStatus(err: unknown): number | undefined {
  const m = err instanceof Error ? /returned (\d{3})/.exec(err.message) : null;
  return m ? Number(m[1]) : undefined;
}
