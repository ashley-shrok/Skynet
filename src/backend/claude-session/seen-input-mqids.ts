// Cross-connection dedupe for pretty-view compose sends.
//
// After a WS drop the client resends a compose send whose bytes it believes
// never left the browser (PrettyView flushResendQueue). bufferedAmount can lag
// the real transmission, so a send the server already typed may come back on
// the next connection. Compose mqids (`pv-optim-<ms>-<rand>`) are minted fresh
// per send, so a repeat within the window is always such a resend and is
// dropped. Other mqid shapes are left alone.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;
const COMPOSE_MQID = /^pv-optim-/;

const seen = new Map<string, number>();

// True when mqid is a compose send already accepted within the window;
// otherwise records it and returns false.
export function isRepeatComposeMqid(mqid: string | undefined, now = Date.now()): boolean {
  if (!mqid || !COMPOSE_MQID.test(mqid)) return false;
  const at = seen.get(mqid);
  if (at !== undefined && now - at < WINDOW_MS) return true;
  seen.set(mqid, now);
  // Map iterates in insertion order, so the oldest entries come first.
  for (const [key, ts] of seen) {
    if (seen.size <= MAX_ENTRIES && now - ts < WINDOW_MS) break;
    seen.delete(key);
  }
  return false;
}

export function resetSeenInputMqidsForTests(): void {
  seen.clear();
}
