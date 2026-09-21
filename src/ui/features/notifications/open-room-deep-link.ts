/**
 * Phase 128 Plan 07 Task 3 — openRoom deep-link parser.
 *
 * Reads `?openRoom=<roomId>` from `window.location.search`, guards on
 * non-empty + basic Matrix-room-id shape (starts with `!`, contains `:`),
 * fires the supplied open-room callback with the roomId, then strips the
 * param via `window.history.replaceState` so a page reload doesn't
 * re-trigger the deep-link (also removes the roomId from any URL the
 * user might copy after arriving — T-126-38 mitigation).
 *
 * The public/sw.js `notificationclick` handler (Plan 04) navigates
 * clients to `/?openRoom=<roomId>`, so this parser is the AppShell-side
 * receiver that closes the D-08 loop end-to-end.
 *
 * Malformed input (whitespace, empty, garbage without `:`) is treated as
 * absent — no callback fire, no throw, one console.warn line for
 * diagnosability. A callback that throws is caught and warned identically;
 * a failed open MUST NOT crash the AppShell mount (T-126-36).
 *
 * The callback is injected (not imported) so this module has no coupling
 * to AppShell's openTab / selectConversationDeferred surface and stays
 * unit-testable without a full app mount.
 */

/**
 * Rough Matrix room-id shape check. Matrix room IDs are of the form
 * `!<opaque>:<server>` — starting with `!` and containing a `:`. We do
 * NOT do full RFC-shape validation (server-name grammar, opaque-part
 * length) here — that's up to the backend/Synapse to reject if given
 * garbage. This regex catches the "obvious garbage" cases so a hostile
 * `?openRoom=<script>` URL doesn't reach the open-callback.
 */
const MATRIX_ROOM_ID_SHAPE = /^!.+:.+/;

export function parseAndOpenRoomFromUrl(
  openRoom: (roomId: string) => void,
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

  const raw = new URLSearchParams(search).get("openRoom");
  if (raw === null) return; // no param → no-op, URL untouched

  const trimmed = raw.trim();
  if (trimmed === "") return; // empty or whitespace-only → treat as absent

  if (!MATRIX_ROOM_ID_SHAPE.test(trimmed)) {
    // Malformed — warn but do not throw. AppShell's mount continues; the
    // user lands on the default view instead of the target room.
    // eslint-disable-next-line no-console
    console.warn(
      `[openRoom] ignored malformed roomId in URL param: ${JSON.stringify(trimmed).slice(0, 100)}`,
    );
    return;
  }

  try {
    openRoom(trimmed);
  } catch (err) {
    // Open-callback failure MUST NOT crash the mount. Warn + swallow;
    // user sees the default landing.
    // eslint-disable-next-line no-console
    console.warn(
      `[openRoom] open-callback threw for roomId=${trimmed}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Strip the openRoom param post-open so a page reload doesn't re-trigger
  // (and a copied URL doesn't embed the roomId — T-126-38 confidentiality).
  try {
    window.history.replaceState(null, "", pathname);
  } catch {
    // history.replaceState failure is non-fatal — the room is already open,
    // the URL just retains the param.
  }
}
