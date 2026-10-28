import { sshLogger } from "../utils/logger.js";

/**
 * Hang up an exec channel whose command may still be writing output.
 *
 * Tailscale SSH drops the WHOLE connection when the client closes a channel
 * while the server is still sending on it — every other channel on that
 * connection dies with "No response from server" and later execs throw
 * "Not connected". OpenSSH tolerates the same close. So the channel is never
 * closed from our side while the command may be writing; instead:
 *
 *   1. End our side of stdin. A command wrapped in `stopOnInputEof` (and the
 *      session tail's stdin blocker) sees EOF and kills what it runs. This is
 *      the reliable stop: Tailscale SSH delivers a TERM signal only to the
 *      session's shell, so a pipeline under it keeps writing.
 *   2. Send TERM. Stops a single-process command on Tailscale SSH and the
 *      whole command on OpenSSH. ssh2 skips it once stdin has ended (e.g.
 *      execCommandWithStdin), so it is best-effort.
 *   3. Keep stdout and stderr draining so the command isn't stalled on a full
 *      window while it winds down.
 *   4. Close from our side only if the server hasn't closed the channel after
 *      `graceMs` — a command that ignores both, where the close is the last
 *      resort it always was.
 *
 * Idempotent per channel. Closing a channel that has already closed is a
 * harmless no-op.
 */
export type HangUpChannel = {
  end?: () => unknown;
  signal?: (name: string) => unknown;
  close?: () => unknown;
  resume?: () => unknown;
  stderr?: { resume?: () => unknown };
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
    /* no event API — fall through to the timed close */
  }
  try {
    stream.resume?.();
    stream.stderr?.resume?.();
  } catch {
    /* not a readable */
  }
  try {
    stream.end?.();
  } catch {
    /* stdin already ended */
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

/**
 * Shell fragment running `pipeline` so that EOF on the command's stdin (our
 * `hangUpChannel`) kills it, while a pipeline that finishes on its own ends
 * the command as before. `$!` is the pipeline's last process; killing it
 * takes the upstream members down with SIGPIPE on their next write. Leaves
 * `$?` set to the pipeline's status (143 when stopped) without exiting, so
 * the fragment can sit mid-script.
 */
export function stopOnInputEof(pipeline: string): string {
  return (
    `exec 3<&0; ${pipeline} & _hp=$!; ` +
    `( read -r _ <&3; kill $_hp 2>/dev/null ) & _hr=$!; ` +
    `wait $_hp; _hs=$?; kill $_hr 2>/dev/null; (exit $_hs)`
  );
}
