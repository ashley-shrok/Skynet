// ─── cross-window-drag.ts ─────────────────────────────────────────────────
// Shared client-side coordination for drag/drop across same-origin Skynet
// windows (drag starts in window A, drop lands in window B). BroadcastChannel
// is the transport — same-origin, purely client-side, no server hop.
//
// Contract:
//   - Source (window A): at dragstart, `armOutboundDrag(dragId, tabId)` records
//     that this window originated the drag. The dragId is embedded in the drag
//     payload so window B can echo it back on drop-accept.
//   - Target (window B): on successful drop, calls `postDragAccept(dragId)`.
//     The BroadcastChannel delivers the message to every OTHER same-origin
//     window (BUT NOT the sender's own window — see spec note below).
//   - AppShell subscribes via `subscribeToDragAccepts(cb)` at boot. When an
//     accept lands, the subscriber's cb receives the tabId that was armed for
//     the matching dragId — AppShell closes that tab to complete the hard-move.
//
// Spec note (MDN): "The BroadcastChannel object receives messages sent by any
// other tab or window with the same origin, EXCEPT for messages sent by the
// same BroadcastChannel object." Since this module keeps a singleton channel
// per window, a same-window drop's postDragAccept doesn't loop back to the
// source's arming — which is desired: same-window drop moves the leaf within
// the split tree via existing swap/openSessionInTree paths; closing the
// source tab would double-remove it.
//
// The whole surface is a no-op when BroadcastChannel is unavailable (Safari
// 15.4+ and every other modern browser 2016+; tests may shim it).

const CHANNEL_NAME = "skynet-drag-accept";
// 60s — was 5000, but a manual cross-window drag can easily take longer than
// five seconds (user positions cursor across panes, alt-tabs to the target
// window, drops deliberately). At 5s the armedDrags entry got reaped before
// the target's accept message could arrive back through BroadcastChannel,
// leaving the subscriber with no match and silently skipping the source-
// close. 60s is generous enough that only genuinely abandoned drags reap
// (e.g. user Esc-cancels and never drops), while still bounding the map.
// Symptom trace: term.gigaashley.click console log 2026-09-18 21:03:48 —
// George dragstart (dragId 723f1d9d) at line 543 saw no accept-match because
// the deliberate cross-window drop exceeded the old reap; Magma (85dc69dc)
// second drag was faster and worked.
const REAP_MS = 60000;

let channel: BroadcastChannel | null = null;
const armedDrags = new Map<string, string>(); // dragId → tabId
const acceptSubscribers = new Set<(tabId: string) => void>();

function ensureChannel(): BroadcastChannel | null {
  if (channel !== null) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent) => {
    const data = e.data as unknown;
    if (data === null || typeof data !== "object") return;
    const dragId = (data as { acceptedDragId?: unknown }).acceptedDragId;
    if (typeof dragId !== "string" || dragId.length === 0) return;
    const tabId = armedDrags.get(dragId);
    if (tabId === undefined) {
      // eslint-disable-next-line no-console
      console.info(
        `[cross-window-drag] accept received but no armed drag matches — likely reaped (drag exceeded REAP_MS=${REAP_MS}) or wrong window; dragId=${dragId}`,
      );
      return;
    }
    armedDrags.delete(dragId);
    for (const sub of acceptSubscribers) {
      try {
        sub(tabId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[cross-window-drag] accept subscriber threw: ${(err as Error).message}`,
        );
      }
    }
  };
  return channel;
}

/**
 * Called by drag sources (IdentityBadge, PrettyConversationRow) at dragstart.
 * Records that this window originated a drag with the given dragId for the
 * given tabId. If a cross-window drop accepts this dragId within REAP_MS,
 * subscribers get the tabId — AppShell uses it to close the source tab so
 * the drag behaves as a hard MOVE (session lives in exactly one window at a
 * time, per user's directive 2026-09-17).
 *
 * Auto-reaps after REAP_MS so a cancelled or ignored drag doesn't leak an
 * entry indefinitely.
 */
export function armOutboundDrag(dragId: string, tabId: string): void {
  if (
    typeof dragId !== "string" ||
    dragId.length === 0 ||
    typeof tabId !== "string" ||
    tabId.length === 0
  ) {
    return;
  }
  ensureChannel();
  armedDrags.set(dragId, tabId);
  // eslint-disable-next-line no-console
  console.info(
    `[cross-window-drag] arm tabId=${tabId} dragId=${dragId} reapMs=${REAP_MS}`,
  );
  setTimeout(() => armedDrags.delete(dragId), REAP_MS);
}

/**
 * Called by drop handlers at the point a drag payload has been accepted
 * (same-window normal move, or cross-window fresh-session-open from
 * descriptor). BroadcastChannel delivers this to every OTHER same-origin
 * window's channel; the sender's own channel does NOT receive it, which is
 * what makes same-window drops naturally skip the source-close path.
 */
export function postDragAccept(dragId: string): void {
  if (typeof dragId !== "string" || dragId.length === 0) return;
  const ch = ensureChannel();
  if (ch === null) return;
  // eslint-disable-next-line no-console
  console.info(`[cross-window-drag] post dragId=${dragId}`);
  ch.postMessage({ acceptedDragId: dragId });
}

/**
 * AppShell subscribes at boot. Callback receives the tabId that was armed
 * for the accepted dragId; AppShell closes that tab. Returns an
 * unsubscribe function.
 */
export function subscribeToDragAccepts(
  cb: (tabId: string) => void,
): () => void {
  ensureChannel();
  acceptSubscribers.add(cb);
  return () => acceptSubscribers.delete(cb);
}

/**
 * Mints a fresh dragId for a dragstart. UUID when available; otherwise a
 * timestamp+random fallback (test environments / older browsers). Uniqueness
 * only needs to hold within the ~REAP_MS window per origin.
 */
export function mintDragId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
