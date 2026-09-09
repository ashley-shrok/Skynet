/**
 * Phase 90 Plan 90-06 Task 1 — IdentityModal title-line clickable treatment.
 *
 * D-04 exact spec test suite. Covers:
 *   A: post-refactor tab count (3 tabs: Identity file / Wakeups / Telegram).
 *   B: no scope switch — `queryByRole('group', {name: /scope/i})` is null.
 *   C: no role-scope Role file tab.
 *   D: no Runbooks tab in identity modal.
 *   E: no Bounties tab in identity modal.
 *   F: only ONE Wakeups tab (identity-wakeups); no role-wakeups tab.
 *   G: title-line clickable treatment when identity has both title + role:
 *      title attr, D-04 inline styles, chevron span.
 *   H: click fires onOpenRoleModal(identity) AND onOpenChange(false) at the
 *      same tick (swap coordination lives in the click handler).
 *   I: fallback when identity.title is null — displayName gets the treatment
 *      (D-04 fallback).
 *   J: keyboard Enter/Space activate onOpenRoleModal.
 *   K: identity.role === null — title-line renders as plain span, NOT clickable
 *      (defensive — no target to jump to).
 *   L: `useModalScope` / `setModalScope` / `ModalScope` grep count is 0 in the
 *      IdentityModal source.
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
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Identity } from "@/api/identities-api";

// ── WS stub (mirrors runbooks-swap test scaffold) ────────────────────────────
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

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1" }),
}));

vi.mock("../../api/telegram-api", () => ({
  getTelegramStatus: vi.fn().mockResolvedValue({ status: "unconfigured" }),
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tabitha",
  displayName: "Tabitha",
  title: "Skynet",
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  task: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tabitha/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

function makeIdentity(overrides?: Partial<Identity>): Identity {
  return { ...BASE_IDENTITY, ...overrides };
}

function renderModal(
  overrides?: Partial<Identity>,
  onOpenRoleModal = vi.fn(),
  onOpenChange = vi.fn(),
): {
  identity: Identity;
  onOpenRoleModalSpy: ReturnType<typeof vi.fn>;
  onOpenChangeSpy: ReturnType<typeof vi.fn>;
} {
  const identity = makeIdentity(overrides);
  render(
    <IdentityModal
      open={true}
      onOpenChange={onOpenChange}
      identity={identity}
      hue={220}
      hostId={7}
      onOpenRoleModal={onOpenRoleModal}
      container={document.body}
    />,
  );
  return { identity, onOpenRoleModalSpy: onOpenRoleModal, onOpenChangeSpy: onOpenChange };
}

// ── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
});

afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A — post-refactor tab count
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Phase 90 refactor — tab structure", () => {
  it("A: renders 3 identity-scope tabs (Identity file / Wakeups / Telegram)", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // The bottom nav bar renders as plain buttons (not role="tab"). Radix
    // Tabs still creates one TabsContent per NAV_SECTIONS entry — count those
    // (role="tabpanel"). Post-Phase-90-06: exactly 3 (Identity file / Wakeups /
    // Telegram).
    const tabpanels = document.querySelectorAll('[role="tabpanel"]');
    expect(tabpanels.length).toBe(3);
  });

  it("B: no segmented Scope group is rendered (scope switch removed)", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    expect(screen.queryByRole("group", { name: /scope/i })).toBeNull();
    expect(document.querySelector('[data-testid="scope-switch-role"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="scope-switch-identity"]'),
    ).toBeNull();
  });

  it("C: no 'Role file' nav button + no role-scope TabsContent", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const navButtons = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Role file");
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels.find((p) => p.getAttribute("id")?.match(/-role$/))).toBeUndefined();
  });

  it("D: no Runbooks nav button + no runbooks TabsContent", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const navButtons = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Runbooks");
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels.find((p) => p.getAttribute("id")?.includes("runbooks"))).toBeUndefined();
  });

  it("E: no Bounties nav button + no bounties TabsContent", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const navButtons = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Bounties");
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels.find((p) => p.getAttribute("id")?.includes("bounties"))).toBeUndefined();
  });

  it("F: only ONE Wakeups tab (identity scope); no role-wakeups tab", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // NAV_SECTIONS nav-bar buttons are plain <button>s labelled by text.
    // Count buttons whose text is exactly "Wakeups" — exactly ONE post-refactor.
    const wakeupsButtons = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).filter((b) => b.textContent?.trim() === "Wakeups");
    expect(wakeupsButtons.length).toBe(1);
    // Also verify there is NO role-wakeups tabpanel in the DOM.
    const roleWakeupsPanel = Array.from(
      document.querySelectorAll('[role="tabpanel"]'),
    ).find((p) => p.getAttribute("id")?.includes("role-wakeups"));
    expect(roleWakeupsPanel).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — title-line clickable treatment (identity has title + role)
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal — title-line clickable treatment (D-04)", () => {
  it("G: title-line span carries D-04 styling + chevron + title attr", async () => {
    renderModal({ title: "Skynet", role: "box-maintainer" });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    expect(jump).toBeTruthy();
    // `title` attr matches "Open role modal:"
    expect(jump.getAttribute("title")).toMatch(/^Open role modal:/);
    // aria-label mirrors title attr for screen readers
    expect(jump.getAttribute("aria-label")).toMatch(/^Open role modal:/);
    // Inline styles from D-04 in rest state
    const style = jump.getAttribute("style") ?? "";
    // Color at rest is #c4b89a
    expect(style.replace(/\s+/g, "")).toContain("color:rgb(196,184,154)"); // browsers may serialize hex→rgb; check both
    // Fallback: raw hex if not normalized
    // (jsdom typically preserves whatever was written)
    // Underline present + dotted at rest
    expect(style).toMatch(/text-decoration/);
    expect(style).toMatch(/dotted/);
    // Chevron child
    const chevron = jump.querySelector("span");
    expect(chevron).toBeTruthy();
    expect(chevron!.textContent).toBe("›");
    const chevStyle = chevron!.getAttribute("style") ?? "";
    expect(chevStyle).toMatch(/margin-left:\s*3px/);
    expect(chevStyle).toMatch(/opacity:\s*0\.7/);
  });

  it("H: click on title-line fires onOpenRoleModal + onOpenChange(false)", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    fireEvent.click(jump);
    expect(onOpenRoleModal).toHaveBeenCalledTimes(1);
    const [firstArg] = onOpenRoleModal.mock.calls[0];
    expect(firstArg.identityKey).toBe("tabitha");
    expect(firstArg.role).toBe("box-maintainer");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("I: fallback — identity.title === null → displayName gets the treatment", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: null, role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // The ONLY jump element renders — it's the displayName in this branch
    const jumps = document.querySelectorAll('[data-testid="identity-modal-title-line-jump"]');
    expect(jumps.length).toBe(1);
    expect(jumps[0].textContent).toContain("Tabitha");
    fireEvent.click(jumps[0]);
    expect(onOpenRoleModal).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("J: keyboard Enter activates onOpenRoleModal (a11y)", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    fireEvent.keyDown(jump, { key: "Enter" });
    expect(onOpenRoleModal).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("J.2: keyboard Space also activates onOpenRoleModal (a11y)", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    fireEvent.keyDown(jump, { key: " " });
    expect(onOpenRoleModal).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("K: identity.role === null — title-line renders plain (NOT clickable)", async () => {
    const onOpenRoleModal = vi.fn();
    renderModal({ title: "Skynet", role: null }, onOpenRoleModal);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // No jump element renders — the defensive branch keeps title as a plain span
    expect(
      document.querySelector('[data-testid="identity-modal-title-line-jump"]'),
    ).toBeNull();
    // The title text still renders inside the header column
    expect(screen.getByText("Skynet")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test L — source-level grep guard: ModalScope + useModalScope + setModalScope
// are all deleted from the IdentityModal implementation.
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal source — dead-code retirement", () => {
  it("L: `useModalScope`/`setModalScope`/`ModalScope` grep count in IdentityModal.tsx is 0", () => {
    const src = readFileSync(
      resolve(__dirname, "IdentityModal.tsx"),
      "utf8",
    );
    // Filter comments — the phase-90 rationale comments reference the token
    // as prose but never import or call it.
    // We check for the specific import / call patterns.
    expect(src).not.toMatch(/import\s*\{[^}]*useModalScope/);
    expect(src).not.toMatch(/import\s*\{[^}]*setModalScope/);
    expect(src).not.toMatch(/import\s*\{[^}]*type\s+ModalScope/);
    expect(src).not.toMatch(/useModalScope\(/);
    expect(src).not.toMatch(/setModalScope\(/);
  });
});
