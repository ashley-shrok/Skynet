/**
 * openHarness deep-link parser — successor to open-room-deep-link.ts.
 *
 * Reads `?openHarness=<mxid>&host=<hostId>` from window.location.search,
 * validates the mxid shape + numeric hostId, fires the injected
 * `openHarness({ mxid, hostId })` callback, then strips BOTH params via
 * history.replaceState so a page reload doesn't re-trigger the deep-link
 * and a copied URL doesn't embed the routing information.
 *
 * The service worker's notificationclick handler (public/sw.js) navigates
 * clients to `${BASE_PATH}/?openHarness=<mxid>&host=<hostId>`; this parser
 * is the AppShell-side receiver that closes the loop end-to-end (per
 * shape-notifications-to-harness.md).
 *
 * Malformed input (whitespace, empty, garbage without `:` in the mxid,
 * non-numeric host) is treated as absent — no callback fire, no throw,
 * one console.warn line for diagnosability. A callback that throws is
 * caught and warned identically; a failed open MUST NOT crash the
 * AppShell mount.
 *
 * The callback is injected (not imported) so this module has no coupling
 * to AppShell's openTab / selectConversationDeferred surface and stays
 * unit-testable without a full app mount.
 */

/**
 * Rough Matrix user-id shape check. Matrix user IDs are of the form
 * `@<opaque>:<server>` — starting with `@` and containing a `:`. We do
 * NOT do full grammar validation here — that's up to the AppShell open-
 * callback (which will resolve mxid → identity and fall back to a toast
 * if resolution fails).
 */
const MXID_SHAPE = /^@.+:.+/;

export interface HarnessOpenTarget {
  mxid: string;
  hostId: number;
}

export function parseAndOpenHarnessFromUrl(
  openHarness: (target: HarnessOpenTarget) => void,
): void {
  let search: string;
  let pathname: string;
  try {
    search = window.location.search;
    pathname = window.location.pathname;
  } catch {
    // Extremely defensive — location access shouldn't throw in normal
    // browser contexts, but guarding here means test / SSR shims can't
    // crash the mount.
    return;
  }

  const params = new URLSearchParams(search);
  const rawMxid = params.get("openHarness");
  if (rawMxid === null) return; // no param → no-op, URL untouched

  const mxid = rawMxid.trim();
  if (mxid === "") return; // empty or whitespace-only → treat as absent

  if (!MXID_SHAPE.test(mxid)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openHarness] ignored malformed mxid in URL param: ${JSON.stringify(mxid).slice(0, 100)}`,
    );
    return;
  }

  const rawHost = params.get("host");
  if (rawHost === null || rawHost.trim() === "") {
    // eslint-disable-next-line no-console
    console.warn(
      `[openHarness] ignored URL param — host missing for mxid=${mxid}`,
    );
    return;
  }

  const hostId = Number(rawHost);
  if (!Number.isFinite(hostId) || !Number.isInteger(hostId) || hostId <= 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openHarness] ignored URL param — host not a positive integer: ${JSON.stringify(rawHost).slice(0, 100)}`,
    );
    return;
  }

  try {
    openHarness({ mxid, hostId });
  } catch (err) {
    // Open-callback failure MUST NOT crash the mount. Warn + swallow;
    // user sees the default landing.
    // eslint-disable-next-line no-console
    console.warn(
      `[openHarness] open-callback threw for mxid=${mxid}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Strip both params post-open so a page reload doesn't re-trigger and
  // a copied URL doesn't embed the routing information.
  try {
    window.history.replaceState(null, "", pathname);
  } catch {
    // history.replaceState failure is non-fatal — the harness view is
    // already open, the URL just retains the params.
  }
}
