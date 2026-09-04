/**
 * Phase 22 SRIC-06 / Plan 22-06 Task 3 — IdentityModal Role tab integration.
 *
 * Four tests covering the Role tab wiring:
 *   21. IdentityModal opens with activeTab === "role" (default).
 *   22. NAV_SECTIONS position 0 is {value: "role", label: "Role", Icon: Users}.
 *   23. On modal open, a sixth openOneShot fires with `identity:get-role-file`;
 *       on response `identity:role-file` the roleFileState becomes ready.
 *   24. updateRoleFile save handler sends `identity:update-role-file` and
 *       re-hydrates roleFileState from the `identity:role-file-updated` echo.
 *
 * Mocking strategy (mirrors IdentityModal.test.tsx):
 *   - openClaudeSessionSocket returns a fake WS whose behavior is scripted
 *     per-test via a manual queue of incoming messages. The modal opens 6
 *     parallel WS (1 for bounties, 5 for artifacts including the new role file).
 *   - identities-api / identities-store / bounty-counts-store mocked as no-ops.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub with scriptable message queue ────────────────────────────────────
type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  __sentPayloads: string[];
};

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((payload: string) => {
      ws.__sentPayloads.push(payload);
    }),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    __sentPayloads: [],
  };
  openedSockets.push(ws);
  // Auto-fire onopen on next tick so the modal's `send` code inside sock.onopen
  // runs deterministically per test.
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
// Phase 72 Plan 03: per-test reset of the modal-scope-store so scope memory
// from one test never leaks into the next (the store lives at module scope).
import { __resetModalScopeForTest } from "@/state/modal-scope-store";

// ── Fixture ──────────────────────────────────────────────────────────────────
// Phase 68: Identity no longer has id/createdAt/updatedAt; avatarUrl bakes
// hostId at backend (no avatarUrlWithHost on frontend).
const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Old title",
  colorHue: null,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
};

function renderModal(identityOverrides?: Partial<Identity>): void {
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={identity}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
}

// Phase 72 Plan 03: tap the segmented Role/Identity scope switch that lives
// above the Tabs component in IdentityModal. Tests below use it to reach the
// Role-scope-only tabs (Role file, Bounties, History, role-wakeups) from an
// actor mount whose default scope is now "identity".
function switchScope(scope: "role" | "identity"): void {
  const btn = document.querySelector(
    `[data-testid="scope-switch-${scope}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`scope-switch-${scope} button not found`);
  fireEvent.click(btn);
}

/**
 * Find the socket whose first-sent payload matched the given type.
 * The modal opens 6 sockets (bounties + 5 artifact fetches); each sends its
 * request payload inside sock.onopen. This helper filters to the matching one.
 */
function findSocketForRequestType(reqType: string): WsStub | undefined {
  return openedSockets.find((ws) => {
    if (ws.__sentPayloads.length === 0) return false;
    try {
      const parsed = JSON.parse(ws.__sentPayloads[0]) as { type?: string };
      return parsed.type === reqType;
    } catch {
      return false;
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
  __resetModalScopeForTest();
});

afterEach(() => {
  // Ensure no leftover sockets between tests
  openedSockets.length = 0;
});

// After the whole file, restore any global mocks.
afterAll(() => {
  vi.restoreAllMocks();
});

// Tests 21-24 — Phase 72 scope-split rewrite: actor default scope='identity'
// (Identity file pane); coordinator default scope='role' (Role file pane).
// Tests that reach into Role-scope tabs (Bounties, History, Role file,
// role-wakeups) must call switchScope('role') first when starting from an
// actor mount.

// ──────────────────────────────────────────────────────────────────────
// Tests 21a / 21b — default scope + default active pane per coordinator flag
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — default scope on open (Phase 72 Plan 03)", () => {
  it("test 21a: actor identity (coordinator: false) mounts with scope='identity' + Identity file pane active", () => {
    renderModal({ coordinator: false });

    // Segmented scope switch reads Identity-side pressed.
    const identityBtn = document.querySelector(
      '[data-testid="scope-switch-identity"]',
    );
    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    );
    expect(identityBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(roleBtn?.getAttribute("aria-pressed")).toBe("false");

    // Exactly one TabsContent pane is active; its value is "identity"
    // (the Identity file tab is the scope's default landing tab).
    const tabPanels = document.querySelectorAll('[role="tabpanel"]');
    const activePanels = Array.from(tabPanels).filter(
      (el) => el.getAttribute("data-state") === "active",
    );
    expect(activePanels).toHaveLength(1);
    // Radix TabsContent encodes its `value` prop into the pane's `id`
    // attribute as "radix-<hash>-content-<value>" (no data-value attribute).
    // Assert the id ends with the expected value.
    expect(activePanels[0].getAttribute("id")).toMatch(/content-identity$/);
  });

  it("test 21b: coordinator identity (coordinator: true) mounts with scope='role' + Role file pane active", () => {
    renderModal({ coordinator: true });

    const identityBtn = document.querySelector(
      '[data-testid="scope-switch-identity"]',
    );
    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    );
    expect(roleBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(identityBtn?.getAttribute("aria-pressed")).toBe("false");

    const tabPanels = document.querySelectorAll('[role="tabpanel"]');
    const activePanels = Array.from(tabPanels).filter(
      (el) => el.getAttribute("data-state") === "active",
    );
    expect(activePanels).toHaveLength(1);
    expect(activePanels[0].getAttribute("id")).toMatch(/content-role$/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests 22a / 22b — bottom-nav button count + first-tab label per scope
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — per-scope NAV_SECTIONS (Phase 72 Plan 03)", () => {
  it("test 22a: under Role scope, bottom nav has 4 buttons; first button label is 'Role file'", () => {
    renderModal({ coordinator: false });
    // Actor mount starts in Identity scope — flip to Role.
    switchScope("role");

    const navButtons = document
      .querySelector(".shrink-0.flex.items-stretch")
      ?.querySelectorAll("button");
    expect(navButtons).toBeDefined();
    expect(navButtons!.length).toBe(4); // role / bounties / history / role-wakeups
    expect(navButtons![0].textContent).toContain("Role file");
    // Sanity: second button is Bounties.
    expect(navButtons![1].textContent).toContain("Bounties");
  });

  it("test 22b: under Identity scope, bottom nav has 3 buttons; first button label is 'Identity file'", () => {
    renderModal({ coordinator: false });
    // Actor mount starts in Identity scope — no switch needed. Sanity-flip
    // to prove the button count assertion below is scope-conditional.
    const navButtons = document
      .querySelector(".shrink-0.flex.items-stretch")
      ?.querySelectorAll("button");
    expect(navButtons).toBeDefined();
    expect(navButtons!.length).toBe(3); // identity / identity-wakeups / handoff
    expect(navButtons![0].textContent).toContain("Identity file");
    // Sanity: second button is Wakeups (identity-wakeups pane).
    expect(navButtons![1].textContent).toContain("Wakeups");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 23 — get-role-file fetch fires on MOUNT regardless of active tab,
// but rendering the Box Maintainer markdown requires scope='role' + the
// Role file tab active.
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — role-file fetch on open (Phase 22 SRIC-06)", () => {
  it("test 23: fires identity:get-role-file WS request with (identityKey, hostId); response sets roleFileState to ready", async () => {
    renderModal({ coordinator: false });

    // Give the queueMicrotask a chance to fire the onopen handlers so send
    // is invoked on each fake socket.
    await new Promise((r) => setTimeout(r, 0));

    // Phase 72: actor default is scope='identity' — the Role nav button is
    // NOT visible until we flip scope. get-role-file itself fires on modal
    // MOUNT (all artifact fetches are scope-agnostic), so the switchScope
    // call only affects the markdown-render assertion further down.
    switchScope("role");
    const roleNavBtn = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).find((b) => b.textContent?.includes("Role file")) as HTMLButtonElement;
    fireEvent.click(roleNavBtn);

    // Find the socket that sent identity:get-role-file
    const roleFileSock = findSocketForRequestType("identity:get-role-file");
    expect(roleFileSock).toBeDefined();

    // The sent payload should carry (identityKey, hostId) — mirroring the
    // identity-file fetch shape. Role NOT in the payload (backend two-step).
    const payload = JSON.parse(roleFileSock!.__sentPayloads[0]) as {
      type: string;
      identityKey: string;
      hostId: number;
    };
    expect(payload.type).toBe("identity:get-role-file");
    expect(payload.identityKey).toBe("tina");
    expect(payload.hostId).toBe(1);

    // Simulate the server's identity:role-file response
    roleFileSock!.onmessage!({
      data: JSON.stringify({
        type: "identity:role-file",
        markdown: "# Box Maintainer\n\n## Role\n\nKeeps the boxes running.",
      }),
    } as MessageEvent<string>);

    // RoleFileTab renders its markdown preview after state.status === "ready".
    // The "Box Maintainer" heading appears once markdown flows in.
    await waitFor(() => {
      expect(screen.getByText("Box Maintainer")).toBeTruthy();
      expect(screen.getByText(/Keeps the boxes running/)).toBeTruthy();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 24 — updateRoleFile save handler
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — updateRoleFile save handler (Phase 22 SRIC-06)", () => {
  it("test 24: clicking Save after edit sends identity:update-role-file; response identity:role-file-updated re-hydrates state", async () => {
    renderModal({ coordinator: false });
    await new Promise((r) => setTimeout(r, 0));

    // Phase 72: actor default is scope='identity' — flip scope so the Role
    // nav button becomes visible + the Role file pane can mount its Edit
    // button (RoleFileTab renders Edit only when state.status === 'ready').
    switchScope("role");
    const roleNavBtn = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).find((b) => b.textContent?.includes("Role file")) as HTMLButtonElement;
    fireEvent.click(roleNavBtn);

    // First, hydrate the role file state with an initial payload so the
    // edit flow can proceed (Edit button requires state.status === "ready").
    const roleFileSock = findSocketForRequestType("identity:get-role-file");
    expect(roleFileSock).toBeDefined();
    roleFileSock!.onmessage!({
      data: JSON.stringify({
        type: "identity:role-file",
        markdown: "# Original\n",
      }),
    } as MessageEvent<string>);

    // Wait for the Edit button to appear (RoleFileTab renders it when ready+onSave)
    const editBtn = await screen.findByRole("button", { name: /^edit$/i });
    fireEvent.click(editBtn);

    // Textarea appears — change its value
    const textarea = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Edited via IdentityModal\n" } });

    // Click Save — this triggers sendIdentityMutation which opens a NEW socket
    // (openClaudeSessionSocket is called again inside sendIdentityMutation)
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    // Give the microtask queue a chance to fire onopen + send on the new socket
    await new Promise((r) => setTimeout(r, 0));

    // Find the update socket
    const updateSock = findSocketForRequestType("identity:update-role-file");
    expect(updateSock).toBeDefined();
    const updatePayload = JSON.parse(updateSock!.__sentPayloads[0]) as {
      type: string;
      identityKey: string;
      hostId: number;
      contents: string;
    };
    expect(updatePayload.type).toBe("identity:update-role-file");
    expect(updatePayload.identityKey).toBe("tina");
    expect(updatePayload.hostId).toBe(1);
    expect(updatePayload.contents).toBe("# Edited via IdentityModal\n");

    // Simulate the server's identity:role-file-updated echo
    updateSock!.onmessage!({
      data: JSON.stringify({
        type: "identity:role-file-updated",
        markdown: "# Edited via IdentityModal (server echo)\n",
      }),
    } as MessageEvent<string>);

    // RoleFileTab re-renders in read mode with the server's confirmed markdown
    await waitFor(() => {
      expect(screen.getByText(/Edited via IdentityModal \(server echo\)/)).toBeTruthy();
    });
  });
});
