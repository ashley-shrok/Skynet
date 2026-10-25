/**
 * Phase 137 Plan 03 Task 2 — Combined pane upgrade dispatcher.
 *
 * Extracted from the inline httpServer.on("upgrade", ...) handler in
 * database.ts for testability. Routes WebSocket upgrade events to the
 * correct pane handler before falling back to socket.destroy().
 *
 * RESEARCH Pitfall 6 (Phase 137): the dispatcher path-tests
 * /apps/:hostId/:slug/pane/* BEFORE routing so a non-matching upgrade is
 * destroyed by this outer handler, NOT by the inner handler. (The
 * /interactive/ widget-pane handler that once shared this server was
 * retired 2026-10-25.)
 *
 * `handleAppPaneUpgrade`'s legacy internal destroy-on-non-match branch
 * (HIGH-3 fix, 2026-09-19) becomes dead code once this dispatcher is in
 * place — the outer path-test guarantees the internal regex will always
 * match. Retained in app-pane-router.ts for defense-in-depth.
 */

import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { handleAppPaneUpgrade } from "../apps/app-pane-router.js";

/**
 * Regex for /apps/:hostId/:slug/pane/* upgrade paths.
 * Mirrors PANE_UPGRADE_PATH_RE in app-pane-router.ts.
 */
const APP_PANE_UPGRADE_RE =
  /^\/apps\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/;

/**
 * WebSocket upgrade dispatcher for the app pane route.
 *
 * Exported for unit testing. Wired to httpServer.on("upgrade", ...) in
 * database.ts as the sole upgrade listener on the primary HTTP server.
 *
 * Routing:
 *   1. /apps/:hostId/:slug/pane/* → handleAppPaneUpgrade
 *   2. Anything else              → socket.destroy()
 */
export async function combinedPaneUpgradeDispatcher(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const url = req.url ?? "";
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
