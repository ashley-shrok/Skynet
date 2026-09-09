/**
 * Phase 90 Plan 90-06 Task 4 — scope-switch-absent regression guard.
 *
 * Rewritten from the Phase 72 Plan 03 scope-switch test suite. The segmented
 * Role/Identity scope switch was DELETED in Phase 90 Plan 90-06 Task 1
 * (D-09). This file survives as a two-test regression guard so that a future
 * refactor accidentally re-introducing the scope switch (or any role-scope
 * tab body in the identity modal) fails loudly here.
 *
 * The planner-pick from the 90-06-PLAN.md Test H behavior spec: rewrite as
 * an absence-assertion regression guard rather than delete the file.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub ──────────────────────────────────────────────────────────────────
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
};

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  openedSockets.push(ws);
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

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

import { IdentityModal } from "./IdentityModal";

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  task: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

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

describe("IdentityModal (Phase 90 D-09): scope switch removed", () => {
  it("does NOT render a Scope segmented group", async () => {
    render(
      <IdentityModal
        open={true}
        onOpenChange={vi.fn()}
        identity={BASE_IDENTITY}
        hue={200}
        hostId={7}
        onOpenRoleModal={vi.fn()}
        container={document.body}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // Two absence signals — both must hold.
    expect(screen.queryByRole("group", { name: /scope/i })).toBeNull();
    expect(document.querySelector('[data-testid="scope-switch-role"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="scope-switch-identity"]'),
    ).toBeNull();
  });

  it("does NOT render role-scope tabs (Role file / Runbooks / Bounties)", async () => {
    render(
      <IdentityModal
        open={true}
        onOpenChange={vi.fn()}
        identity={BASE_IDENTITY}
        hue={200}
        hostId={7}
        onOpenRoleModal={vi.fn()}
        container={document.body}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // Nav-bar buttons carry the tab labels — none of the role-scope tabs
    // should be present post-Phase-90-06.
    const navButtons = Array.from(
      document.querySelectorAll(".shrink-0.flex.items-stretch button"),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Role file");
    expect(navButtons).not.toContain("Runbooks");
    expect(navButtons).not.toContain("Bounties");
    // Also verify no matching tabpanels exist.
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    for (const p of panels) {
      const id = p.getAttribute("id") ?? "";
      expect(id).not.toMatch(/-role$/);
      expect(id).not.toMatch(/runbooks/);
      expect(id).not.toMatch(/bounties/);
      expect(id).not.toMatch(/role-wakeups/);
    }
  });
});
