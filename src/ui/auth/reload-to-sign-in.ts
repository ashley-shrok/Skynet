// Ends a signed-in session in this browser tab by loading the app fresh.
//
// The sidebar stores (conversations, projects, apps, identities) hold their
// snapshots in module scope. Unmounting AppShell doesn't drop them, so a
// logout that only swapped back to <Auth> let the next account's first paint
// show the previous account's rows until its own fetch landed. A full load
// is the only reset that covers every store, including ones added later.
//
// Two reasons, two depths:
//   - "logout": someone else may sign in next. Drop the URL's query + hash
//     (the open-tab layout) and this tab's open-conversation set, so nothing
//     from the old session is restored for the next account.
//   - "session-expired": almost always the same person signing back in.
//     Plain reload — in-memory state goes, but the URL layout and the
//     open-conversation set survive so they get their conversations back.
//
// The other open tabs of this browser share the sign-in cookie, so a sign-in
// in this tab would silently carry them over to the next account. Each
// sign-out is broadcast through localStorage (the `storage` event fires in
// every other tab) and those tabs reload the same way.
//
// localStorage caches are owner-tagged and handled by
// clearSkynetSessionStorage / the read-time owner check.

import { PENDING_TAB_STORAGE_KEY } from "@/lib/tab-url";

export type SignOutReason = "logout" | "session-expired";

export const SIGN_OUT_BROADCAST_KEY = "skynet:sign-out-broadcast";

// Mirrors ACTIVE_SET_STORAGE_KEY in state/conversation-store.ts — not
// imported, to keep that store out of the entry chunk.
const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";

export function reloadToSignIn(
  reason: SignOutReason,
  { broadcast = true }: { broadcast?: boolean } = {},
): void {
  console.info(
    `[auth] reload-to-sign-in reason=${reason} source=${broadcast ? "this-tab" : "other-tab"}`,
  );
  if (broadcast) {
    try {
      // `at` makes every write a change, so the event fires every time.
      localStorage.setItem(
        SIGN_OUT_BROADCAST_KEY,
        JSON.stringify({ reason, at: Date.now() }),
      );
    } catch {
      // Other tabs still fall back to their own 401 → session-expired path.
    }
  }
  if (reason === "session-expired") {
    window.location.reload();
    return;
  }
  for (const key of [ACTIVE_SET_STORAGE_KEY, PENDING_TAB_STORAGE_KEY]) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // sessionStorage may be blocked; the reload still drops in-memory state.
    }
  }
  window.location.replace(window.location.pathname);
}

// Reads a sign-out broadcast from another tab's `storage` event. Returns null
// for any other key or a malformed value.
export function readSignOutBroadcast(e: StorageEvent): SignOutReason | null {
  if (e.key !== SIGN_OUT_BROADCAST_KEY || !e.newValue) return null;
  try {
    const parsed = JSON.parse(e.newValue) as { reason?: unknown } | null;
    const reason = parsed?.reason;
    return reason === "logout" || reason === "session-expired" ? reason : null;
  } catch {
    return null;
  }
}
