/**
 * Phase 137 Plan 03 Task 2 — Combined pane upgrade dispatcher tests.
 *
 * Tests the `combinedPaneUpgradeDispatcher` function extracted from
 * database.ts (for testability), which routes WebSocket upgrades to
 * either handleImPaneUpgrade (/interactive/) or handleAppPaneUpgrade
 * (/apps/) before falling back to socket.destroy() for unknown paths.
 *
 * RESEARCH Pitfall 6 invariant:
 *   - /interactive/:hostId/:slug/pane/* → handleImPaneUpgrade
 *   - /apps/:hostId/:slug/pane/* → handleAppPaneUpgrade
 *   - Anything else → socket.destroy()
 *
 * Order of path-testing: /interactive/ first, /apps/ second, destroy last.
 * The two regexes have disjoint prefixes so order is not load-bearing, but
 * it is documented as the intended shape.
 */

import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

/* ------------------------------------------------------------------------ */
/*  Hoisted mocks — mock BEFORE import so the module sees the stubs         */
/* ------------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  handleImPaneUpgrade: vi.fn().mockResolvedValue(undefined),
  handleAppPaneUpgrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../im-pane-router.js", () => ({
  imPaneRouter: {},
  handleImPaneUpgrade: mocks.handleImPaneUpgrade,
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
    mocks.handleImPaneUpgrade.mockReset().mockResolvedValue(undefined);
    mocks.handleAppPaneUpgrade.mockReset().mockResolvedValue(undefined);
  });

  /* ---- Test 1: /interactive/ path → handleImPaneUpgrade --------------- */

  it("Test 1 — /interactive/:hostId/:slug/pane/* dispatches to handleImPaneUpgrade", async () => {
    const req = makeReq("/interactive/3/poll-abc/pane/ws");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleImPaneUpgrade).toHaveBeenCalledTimes(1);
    expect(mocks.handleImPaneUpgrade).toHaveBeenCalledWith(req, socket, HEAD);
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(false);
  });

  /* ---- Test 2: /apps/ path → handleAppPaneUpgrade --------------------- */

  it("Test 2 — /apps/:hostId/:slug/pane/* dispatches to handleAppPaneUpgrade", async () => {
    const req = makeReq("/apps/3/counter/pane/ws");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleAppPaneUpgrade).toHaveBeenCalledTimes(1);
    expect(mocks.handleAppPaneUpgrade).toHaveBeenCalledWith(req, socket, HEAD);
    expect(mocks.handleImPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(false);
  });

  /* ---- Test 3: bogus path → socket.destroy() -------------------------- */

  it("Test 3 — unrecognized path destroys the socket", async () => {
    const req = makeReq("/other-thing");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleImPaneUpgrade).not.toHaveBeenCalled();
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });

  /* ---- Test 4: /apps/ prefix but not /pane/* → destroy (outer guard) -- */

  it("Test 4 — /apps/3/counter/icon (no /pane) → destroy (regex doesn't match)", async () => {
    const req = makeReq("/apps/3/counter/icon");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    // Neither handler is called because the path doesn't match either regex.
    expect(mocks.handleImPaneUpgrade).not.toHaveBeenCalled();
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });

  /* ---- Test 5: /interactive/ prefix but not /pane/* → destroy ---------- */

  it("Test 5 — /interactive/3/poll-abc/icon (no /pane) → destroy", async () => {
    const req = makeReq("/interactive/3/poll-abc/icon");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleImPaneUpgrade).not.toHaveBeenCalled();
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(true);
  });

  /* ---- Test 6: /interactive/ pane with no trailing segment ------------- */

  it("Test 6 — /interactive/3/poll-abc/pane (no trailing /) dispatches to handleImPaneUpgrade", async () => {
    const req = makeReq("/interactive/3/poll-abc/pane");
    const socket = makeSocket();
    await combinedPaneUpgradeDispatcher(req, socket, HEAD);

    expect(mocks.handleImPaneUpgrade).toHaveBeenCalledTimes(1);
    expect(mocks.handleAppPaneUpgrade).not.toHaveBeenCalled();
    expect(socket.destroyCalled).toBe(false);
  });
});
