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

function renderModal(): void {
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={BASE_IDENTITY}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
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
});

afterEach(() => {
  // Ensure no leftover sockets between tests
  openedSockets.length = 0;
});

// After the whole file, restore any global mocks.
afterAll(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Test 21 — default activeTab is "bounties" (Ashley 2026-08-05: bounties
// is the tab you actually want to see first on identity-badge click,
// changed from "role" which was the SRIC-06 default).
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — default tab and position", () => {
  it("test 21: opens with exactly one active tab pane on initial render (default = 'bounties')", () => {
    renderModal();

    // Exactly one TabsContent has data-state="active" on initial render.
    // The active pane is Bounties per the 2026-08-05 default change.
    const tabPanels = document.querySelectorAll('[role="tabpanel"]');
    const activePanels = Array.from(tabPanels).filter(
      (el) => el.getAttribute("data-state") === "active",
    );
    expect(activePanels).toHaveLength(1);
    expect(activePanels[0].getAttribute("data-state")).toBe("active");
  });

  // ──────────────────────────────────────────────────────────────────────
  // Test 22 — NAV_SECTIONS position 0 is Role
  // ──────────────────────────────────────────────────────────────────────
  it("test 22: bottom nav's FIRST button is the 'Role' tab (position 0)", () => {
    renderModal();

    // The bottom nav renders one <button> per NAV_SECTIONS entry. First
    // button in DOM order should carry the label "Role".
    const navButtons = document
      .querySelector(".shrink-0.flex.items-stretch")
      ?.querySelectorAll("button");
    expect(navButtons).toBeDefined();
    expect(navButtons!.length).toBe(6); // role + 5 existing
    // First button label = "Role"
    expect(navButtons![0].textContent).toContain("Role");
    // Sanity: second button should be "Identity" (existing tab moved to position 1)
    expect(navButtons![1].textContent).toContain("Identity");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 23 — Sixth openOneShot fires identity:get-role-file
// ──────────────────────────────────────────────────────────────────────
describe("IdentityModal — role-file fetch on open (Phase 22 SRIC-06)", () => {
  it("test 23: fires identity:get-role-file WS request with (identityKey, hostId); response sets roleFileState to ready", async () => {
    renderModal();

    // Give the queueMicrotask a chance to fire the onopen handlers so send
    // is invoked on each fake socket.
    await new Promise((r) => setTimeout(r, 0));

    // 2026-08-05: default tab changed from "role" to "bounties" — click the
    // Role nav button so the Role pane is active and RoleFileTab renders.
    // The get-role-file WS request itself fires on modal MOUNT regardless of
    // the active tab, so this click only affects the "render the markdown"
    // assertion further down.
    const roleNavBtn = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).find((b) => b.textContent?.includes("Role")) as HTMLButtonElement;
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
    renderModal();
    await new Promise((r) => setTimeout(r, 0));

    // 2026-08-05: default tab changed from "role" to "bounties" — click the
    // Role nav button so the Role pane is active and RoleFileTab renders
    // (Edit + Save buttons only exist when the pane is mounted).
    const roleNavBtn = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).find((b) => b.textContent?.includes("Role")) as HTMLButtonElement;
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
