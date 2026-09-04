/**
 * Phase 72 Plan 03 — IdentityModal scope switch (segmented Role/Identity).
 *
 * 8 tests covering the segmented control's render + memory behavior:
 *   S1: Segmented control renders 2 buttons with data-testid scope-switch-role
 *       and scope-switch-identity.
 *   S2: Actor identity (coordinator=false) mounts with scope-switch-identity
 *       aria-pressed=true; scope-switch-role aria-pressed=false.
 *   S3: Coordinator identity (coordinator=true) mounts with
 *       scope-switch-role aria-pressed=true.
 *   S4: Clicking scope-switch-role on an actor identity flips scope;
 *       scope-switch-role becomes aria-pressed=true; Role scope's first tab
 *       (value="role") becomes active.
 *   S5: Clicking scope-switch-identity on a coordinator identity flips scope;
 *       scope-switch-identity becomes aria-pressed=true; Identity scope's
 *       first tab (value="identity") becomes active.
 *   S6: Memory-across-open — mount modal for identityKey "tina" → tap
 *       scope-switch-role → unmount → re-mount → assert scope-switch-role is
 *       STILL aria-pressed=true (memory preserved via store).
 *   S7: No-leak-across-identities — mount modal for "tina" → tap
 *       scope-switch-role → unmount → mount modal for "nelly" (also actor)
 *       → assert scope-switch-identity is aria-pressed=true for nelly
 *       (default not leaked from tina).
 *   S8: Scope flip resets activeTab — mount actor, click a non-default nav
 *       button (handoff), click scope-switch-role, assert activeTab is now
 *       "role" (not "handoff") via the active tabpanel's id suffix.
 *
 * Mocking strategy mirrors IdentityModal.role-tab.test.tsx: WsStub factory
 * + module mocks on @/api/claude-session-api / @/api/identities-api /
 * @/state/identities-store / @/state/bounty-counts-store.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
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
    getIdentityNoDormancy: vi.fn().mockResolvedValue(false),
    setIdentityNoDormancy: vi.fn().mockResolvedValue(false),
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
import { __resetModalScopeForTest } from "@/state/modal-scope-store";

// ── Fixture ──────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
};

function renderModal(identityOverrides?: Partial<Identity>): {
  unmount: () => void;
} {
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  const { unmount } = render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={identity}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
  return { unmount };
}

function scopeButton(scope: "role" | "identity"): HTMLButtonElement {
  const btn = document.querySelector(
    `[data-testid="scope-switch-${scope}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`scope-switch-${scope} button not found`);
  return btn;
}

function switchScope(scope: "role" | "identity"): void {
  fireEvent.click(scopeButton(scope));
}

function activePanelIdSuffix(): string | null {
  const tabPanels = document.querySelectorAll('[role="tabpanel"]');
  const active = Array.from(tabPanels).find(
    (el) => el.getAttribute("data-state") === "active",
  );
  const id = active?.getAttribute("id") ?? null;
  if (!id) return null;
  // Radix format: "radix-<hash>-content-<value>"
  const m = id.match(/content-(.+)$/);
  return m ? m[1] : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
  __resetModalScopeForTest();
});

afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S1 — segmented control renders 2 buttons
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal scope switch — render", () => {
  it("test S1: segmented control renders 2 buttons with data-testid scope-switch-role and scope-switch-identity", () => {
    renderModal();
    expect(document.querySelector('[data-testid="scope-switch-role"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="scope-switch-identity"]')).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test S2 — actor identity mounts with scope-switch-identity pressed
  // ───────────────────────────────────────────────────────────────────────────
  it("test S2: actor identity (coordinator=false) mounts with scope-switch-identity aria-pressed=true", () => {
    renderModal({ coordinator: false });
    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("false");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test S3 — coordinator identity mounts with scope-switch-role pressed
  // ───────────────────────────────────────────────────────────────────────────
  it("test S3: coordinator identity (coordinator=true) mounts with scope-switch-role aria-pressed=true", () => {
    renderModal({ coordinator: true });
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S4 — clicking scope-switch-role flips scope on actor identity
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal scope switch — tap flips view", () => {
  it("test S4: clicking scope-switch-role on an actor identity flips scope; Role tab (value='role') becomes active", () => {
    renderModal({ coordinator: false });
    expect(activePanelIdSuffix()).toBe("identity");

    switchScope("role");

    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("false");
    expect(activePanelIdSuffix()).toBe("role");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test S5 — clicking scope-switch-identity flips scope on coordinator
  // ───────────────────────────────────────────────────────────────────────────
  it("test S5: clicking scope-switch-identity on a coordinator identity flips scope; Identity tab (value='identity') becomes active", () => {
    renderModal({ coordinator: true });
    expect(activePanelIdSuffix()).toBe("role");

    switchScope("identity");

    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("false");
    expect(activePanelIdSuffix()).toBe("identity");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S6 — memory across open/close of same identity
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal scope switch — memory across open", () => {
  it("test S6: tapping scope, unmounting, and re-mounting the SAME identity preserves the scope choice", () => {
    // First mount: actor identity, flip to Role.
    const first = renderModal({ identityKey: "tina", coordinator: false });
    switchScope("role");
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("true");
    first.unmount();

    // Re-mount the same identity — scope memory persists via the store.
    renderModal({ identityKey: "tina", coordinator: false });
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("false");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test S7 — no leak across identities
  // ───────────────────────────────────────────────────────────────────────────
  it("test S7: scope choice on identity A does NOT leak to identity B (new identity gets its own default)", () => {
    // Mount tina, flip to Role.
    const first = renderModal({ identityKey: "tina", coordinator: false });
    switchScope("role");
    first.unmount();

    // Mount nelly (also actor) — should see the actor default (identity),
    // NOT tina's stored role.
    renderModal({ identityKey: "nelly", coordinator: false });
    expect(scopeButton("identity").getAttribute("aria-pressed")).toBe("true");
    expect(scopeButton("role").getAttribute("aria-pressed")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S8 — activeTab reset on scope flip
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal scope switch — activeTab reset", () => {
  it("test S8: clicking a non-default nav button then flipping scope resets activeTab to the new scope's default", () => {
    // Actor mount → default scope=identity, default activeTab=identity.
    renderModal({ coordinator: false });
    expect(activePanelIdSuffix()).toBe("identity");

    // Click the Handoff nav button so activeTab becomes "handoff".
    const handoffNavBtn = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).find((b) => b.textContent?.includes("Handoff")) as
      | HTMLButtonElement
      | undefined;
    expect(handoffNavBtn).toBeDefined();
    fireEvent.click(handoffNavBtn!);
    expect(activePanelIdSuffix()).toBe("handoff");

    // Now flip scope to Role — activeTab should reset to "role"
    // (the Role scope's default landing tab), NOT stay on "handoff"
    // (which no longer exists under Role scope's NAV_SECTIONS).
    switchScope("role");
    expect(activePanelIdSuffix()).toBe("role");
  });
});
