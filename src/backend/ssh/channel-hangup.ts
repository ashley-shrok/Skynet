import { sshLogger } from "../utils/logger.js";

/**
 * Hang up an exec channel whose command may still be writing output.
 *
 * Tailscale SSH drops the WHOLE connection when the client closes a channel
 * while the server is still sending on it — every other channel on that
 * connection dies with "No response from server" and later execs throw
 * "Not connected". OpenSSH tolerates the same close. So: ask the command to
 * stop (channel signal TERM — Tailscale SSH honours it, OpenSSH ignores it),
 * keep draining while it winds down, and let the server close the channel.
 * Only if it hasn't closed after `graceMs` (OpenSSH, or a command that
 * ignores TERM) is it closed from our side — safe there, since OpenSSH is the
 * server that ignored the signal.
 *
 * Idempotent per channel. Closing a channel that has already closed is a
 * harmless no-op.
 */
export type HangUpChannel = {
  signal?: (name: string) => unknown;
  close?: () => unknown;
  resume?: () => unknown;
  once?: (event: "close", fn: () => void) => unknown;
};

export const HANGUP_GRACE_MS = 2000;

const hungUp = new WeakSet<object>();

export function hangUpChannel(stream: HangUpChannel | null | undefined, graceMs = HANGUP_GRACE_MS): void {
  if (!stream || hungUp.has(stream)) return;
  hungUp.add(stream);
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    stream.once?.("close", () => {
      done = true;
      if (timer !== null) clearTimeout(timer);
    });
  } catch {
    /* no event API — fall through to signal + timed close */
  }
  // Keep the channel flowing so the server isn't stalled on a full window
  // while the command handles the signal.
  try {
    stream.resume?.();
  } catch {
    /* not a readable */
  }
  try {
    stream.signal?.("TERM");
  } catch (err) {
    sshLogger.info(
      `[channel-hangup] signal TERM threw: ${err instanceof Error ? err.message : String(err)}`,
      { operation: "channel_hangup_signal_threw" },
    );
  }
  timer = setTimeout(() => {
    if (done) return;
    try {
      stream.close?.();
    } catch {
      /* already closed */
    }
  }, graceMs);
  timer.unref?.();
}
