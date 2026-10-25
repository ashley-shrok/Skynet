/**
 * Phase 137 Plan 03 Task 2 — Combined pane upgrade dispatcher tests.
 *
 * Tests the `combinedPaneUpgradeDispatcher` function extracted from
 * database.ts (for testability), which routes WebSocket upgrades to
 * handleAppPaneUpgrade (/apps/) before falling back to socket.destroy()
 * for unknown paths.
 *
 * RESEARCH Pitfall 6 invariant:
 *   - /apps/:hostId/:slug/pane/* → handleAppPaneUpgrade
 *   - Anything else → socket.destroy() (including the retired
 *     /interactive/ widget-pane prefix)
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

/* ------------------------------------------------------------------------ */
/*  Hoisted mocks — mock BEFORE import so the module sees the stubs         */
/* ------------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  handleAppPaneUpgrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../app-pane-router.js", () => ({
  appPaneRouter: {},
  handleAppPaneUpgrade: mocks.handleAppPaneUpgrade,
}));

// Mock everything else database.ts needs so the import resolves.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  systemLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ------------------------------------------------------------------------ */
/*  Import the dispatcher under test                                         */
/* ------------------------------------------------------------------------ */

import { combinedPaneUpgradeDispatcher } from "../../database/combined-pane-upgrade-dispatcher.js";

/* ------------------------------------------------------------------------ */
/*  Helper — make a minimal fake upgrade request                             */
/* ------------------------------------------------------------------------ */

function makeReq(url: string): IncomingMessage {
  return { url } as unknown as IncomingMessage;
}

function makeSocket(): Socket & { destroyed: boolean; destroyCalled: boolean } {
  const s = {
    destroyed: false,
    destroyCalled: false,
    destroy() {
      this.destroyCalled = true;
      this.destroyed = true;
    },
  } as unknown as Socket & { destroyed: boolean; destroyCalled: boolean };
  return s;
}

const HEAD = Buffer.alloc(0);

/* ------------------------------------------------------------------------ */
/*  Suite                                                                    */
/* ------------------------------------------------------------------------ */

describe("combinedPaneUpgradeDispatcher (Phase 137 Plan 03 Task 2)", () => {
  beforeEach(() => {
    mocks.handleAppPaneUpgrade.mockReset().mockResolvedValue(undefined);
  });

  /* ---- Test 2: /apps/ path → handleAppPaneUpgrade --------------------- */

  it("Test 2 — /apps/:hostId/:slug/pane/* dispatches to handleAppPaneUpgrade", async () => {
    const req = makeReq("/apps/3/counter/pane/ws");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleAppPaneUpgrade).toHaveBeenCalledTimes(1);
    expect(mocks.handleAppPaneUpgrade).toHaveBeenCalledWith(req, socket, HEAD);
    expect(socket.destroyCalled).toBe(false);
  });

  /* ---- Test 3: bogus path → socket.destroy() -------------------------- */

  it("Test 3 — unrecognized path destroys the socket", async () => {
    const req = makeReq("/other-thing");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });

  /* ---- Test 4: /apps/ prefix but not /pane/* → destroy (outer guard) -- */

  it("Test 4 — /apps/3/counter/icon (no /pane) → destroy (regex doesn't match)", async () => {
    const req = makeReq("/apps/3/counter/icon");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    // The handler is not called because the path doesn't match its regex.
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });

  /* ---- Test 5: retired /interactive/ widget pane → destroy ----------- */

  it("Test 5 — /interactive/3/poll-abc/pane/ws (retired widget pane) → destroy", async () => {
    const req = makeReq("/interactive/3/poll-abc/pane/ws");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });
});
