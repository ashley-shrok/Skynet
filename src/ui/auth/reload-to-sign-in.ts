// Ends a signed-in session in this browser tab by loading the app fresh.
//
// The sidebar stores (conversations, projects, apps, identities) hold their
// snapshots in module scope. Unmounting AppShell doesn't drop them, so a
// logout that only swapped back to <Auth> let the next account's first paint
// show the previous account's rows until its own fetch landed. A full load
// is the only reset that covers every store, including ones added later.
//
// The query string is dropped so a ?tab= spec from the old session can't be
// restored for the next account, and sessionStorage (open-conversation set,
// pending tab, reload-loop sentinel — all per-session UI state) is cleared
// for the same reason. localStorage caches are owner-tagged and handled by
// clearSkynetSessionStorage / the read-time owner check.
export function reloadToSignIn(reason: string): void {
  console.info(`[auth] reload-to-sign-in reason=${reason}`);
  try {
    window.sessionStorage.clear();
  } catch {
    // sessionStorage may be blocked; the reload still drops in-memory state.
  }
  window.location.replace(window.location.pathname);
}
