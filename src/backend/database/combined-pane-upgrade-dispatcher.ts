/**
 * Phase 137 Plan 03 Task 2 — Combined pane upgrade dispatcher.
 *
 * Extracted from the inline httpServer.on("upgrade", ...) handler in
 * database.ts for testability. Routes WebSocket upgrade events to the
 * correct pane handler before falling back to socket.destroy().
 *
 * RESEARCH Pitfall 6 (Phase 137): two upgrade handlers now coexist on this
 * server — both /apps/:hostId/:slug/pane/* and /interactive/:hostId/:slug/pane/*.
 * The dispatcher path-tests BEFORE routing so a non-matching upgrade is
 * destroyed by this outer handler, NOT by the inner handlers.
 *
 * `handleAppPaneUpgrade`'s legacy internal destroy-on-non-match branch
 * (HIGH-3 fix, 2026-09-19) becomes dead code once this dispatcher is in
 * place — the outer path-test guarantees the internal regex will always
 * match. Retained in app-pane-router.ts for defense-in-depth.
 *
 * Order (im-pane tested first) is not load-bearing since the two regexes
 * have disjoint prefixes; test-first is for readability.
 */

import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { handleImPaneUpgrade } from "../apps/im-pane-router.js";
import { handleAppPaneUpgrade } from "../apps/app-pane-router.js";

/**
 * Regex for /interactive/:hostId/:slug/pane/* upgrade paths.
 * Mirrors IM_PANE_UPGRADE_PATH_RE in im-pane-router.ts.
 */
const IM_PANE_UPGRADE_RE =
  /^\/interactive\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/;

/**
 * Regex for /apps/:hostId/:slug/pane/* upgrade paths.
 * Mirrors PANE_UPGRADE_PATH_RE in app-pane-router.ts.
 */
const APP_PANE_UPGRADE_RE =
  /^\/apps\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/;

/**
 * Combined WebSocket upgrade dispatcher for both pane routes.
 *
 * Exported for unit testing. Wired to httpServer.on("upgrade", ...) in
 * database.ts as the sole upgrade listener on the primary HTTP server.
 *
 * Routing:
 *   1. /interactive/:hostId/:slug/pane/* → handleImPaneUpgrade
 *   2. /apps/:hostId/:slug/pane/*        → handleAppPaneUpgrade
 *   3. Anything else                     → socket.destroy()
 */
export async function combinedPaneUpgradeDispatcher(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const url = req.url ?? "";
  if (IM_PANE_UPGRADE_RE.test(url)) {
    void handleImPaneUpgrade(req, socket, head);
    return;
  }
  if (APP_PANE_UPGRADE_RE.test(url)) {
    void handleAppPaneUpgrade(req, socket, head);
    return;
  }
  try {
    socket.destroy();
  } catch {
    /* socket may already be broken */
  }
}
