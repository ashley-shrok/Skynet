/**
 * Phase 90 Plan 90-06 Task 1 — IdentityModal title-line clickable treatment.
 *
 * Covers:
 *   A: post-refactor tab count (3 tabs — Identity file / Wakeups /
 *      Files/Workspace).
 *   B: no scope switch — `queryByRole('group', {name: /scope/i})` is null.
 *   C: no role-scope Role file tab.
 *   D: no Role skills tab in identity modal.
 *   E: no Bounties tab in identity modal.
 *   F: only ONE Wakeups tab (identity-wakeups); no role-wakeups tab.
 *   G: each role under the name is a real <button> (title / aria-label /
 *      trailing "›" on the last one).
 *   H: click closes the agent window (onOpenChange(false)) and opens the
 *      roles window on that role — after the leave guard answers.
 *   H2: multi-role — comma-separated links, each opening its own role.
 *   I: link text is the role's display name, else the title-cased slug.
 *   J: keyboard Enter/Space on the focused link activate it.
 *   K: no role — no links; the name still renders.
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
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Identity } from "@/api/identities-api";

// ── WS stub (mirrors role skills-swap test scaffold) ────────────────────────────
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
  // IdentityModal doesn't import getUserInfo; mock kept for other callers of
  // @/main-axios that the module graph may pull in.
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1", is_admin: true }),
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
  project: null,
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
  it("A: renders 3 identity-scope tabs (Identity file / Wakeups / Files)", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // The bottom nav bar renders as plain buttons (not role="tab"). Radix
    // Tabs still creates one TabsContent per NAV_SECTIONS entry — count those
    // (role="tabpanel"): exactly 3 for everyone (Identity file / Wakeups /
    // Files).
    // The Git tab only appears when the workspace holds a repo; the repo
    // probe isn't stubbed here, so it stays hidden (see GitTab.test.tsx).
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
      document.querySelectorAll('[data-slot="modal-tabs"] button'),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Role file");
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels.find((p) => p.getAttribute("id")?.match(/-role$/))).toBeUndefined();
  });

  it("D: no Skills nav button + no skills TabsContent", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const navButtons = Array.from(
      document.querySelectorAll('[data-slot="modal-tabs"] button'),
    ).map((b) => b.textContent?.trim() ?? "");
    expect(navButtons).not.toContain("Skills");
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    expect(panels.find((p) => p.getAttribute("id")?.includes("skills"))).toBeUndefined();
  });

  it("E: no Bounties nav button + no bounties TabsContent", async () => {
    renderModal();
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const navButtons = Array.from(
      document.querySelectorAll('[data-slot="modal-tabs"] button'),
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
    // NAV_SECTIONS nav-bar buttons carry a stable testid per section value.
    // Exactly one identity-scope wake-ups nav button post-refactor.
    const wakeupsButtons = document.querySelectorAll(
      '[data-testid="identity-modal-nav-identity-wakeups"]',
    );
    expect(wakeupsButtons.length).toBe(1);
    // Belt-and-suspenders: NO role-wakeups nav button exists.
    expect(
      document.querySelector('[data-testid="identity-modal-nav-role-wakeups"]'),
    ).toBeNull();
    // Also verify there is NO role-wakeups tabpanel in the DOM.
    const roleWakeupsPanel = Array.from(
      document.querySelectorAll('[role="tabpanel"]'),
    ).find((p) => p.getAttribute("id")?.includes("role-wakeups"));
    expect(roleWakeupsPanel).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests G–K — the role links under the name (each a real button)
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal — role links", () => {
  it("G: each role is a real button with an accessible name; the last carries the ›", async () => {
    renderModal({ title: "Skynet", role: "box-maintainer", roleDefaults: null });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    expect(jump.tagName).toBe("BUTTON");
    expect(jump.getAttribute("type")).toBe("button");
    expect(jump.getAttribute("title")).toBe("Open Box Maintainer in Roles");
    expect(jump.getAttribute("aria-label")).toBe("Open role: Box Maintainer");
    expect(jump.getAttribute("data-identity-key")).toBe("tabitha");
    expect(screen.getByRole("button", { name: "Open role: Box Maintainer" })).toBe(jump);
    // The chevron is decoration — hidden from screen readers.
    const chevron = jump.querySelector("span");
    expect(chevron?.textContent).toBe("›");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
  });

  it("H: click closes the agent window, then opens the roles window on the role", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("identity-modal-title-line-jump"));
    // The click first asks the leave guard (async), so the calls land a tick later.
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledTimes(1));
    const [firstArg, roleName] = onOpenRoleModal.mock.calls[0];
    expect(firstArg.identityKey).toBe("tabitha");
    expect(firstArg.role).toBe("box-maintainer");
    expect(roleName).toBe("box-maintainer");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(onOpenRoleModal.mock.invocationCallOrder[0]);
  });

  it("H2: multi-role — one comma-separated link per role; only the last has the ›; each opens its own role", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal(
      { role: null, roles: ["box-maintainer", "sky-uat"], roleDefaults: null },
      onOpenRoleModal,
      onOpenChange,
    );
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const links = screen.getAllByTestId("identity-modal-title-line-jump");
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.textContent)).toEqual(["Box Maintainer", "Sky Uat›"]);
    // The comma sits between the links, outside the buttons.
    expect(screen.getByTestId("identity-modal-role-links").textContent).toBe("Box Maintainer,Sky Uat›");
    fireEvent.click(links[1]);
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledTimes(1));
    expect(onOpenRoleModal.mock.calls[0][1]).toBe("sky-uat");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("I: role text — roleDefaults.displayName wins; title-cased slug is the fallback (pretty-names shape 2026-09-30)", async () => {
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    // No roleDefaults → the title-cased slug via roleDisplayName; never the raw slug.
    renderModal({ role: "box-maintainer", roleDefaults: null }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jumps = screen.getAllByTestId("identity-modal-title-line-jump");
    expect(jumps.length).toBe(1);
    expect(jumps[0].textContent).toBe("Box Maintainer›");
    // The name is never the link; only the roles are.
    expect(jumps[0].textContent).not.toContain("Tabitha");
    cleanup();

    renderModal(
      { role: "box-maintainer", roleDefaults: { displayName: "Skynet" } },
      onOpenRoleModal,
      onOpenChange,
    );
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jumps2 = screen.getAllByTestId("identity-modal-title-line-jump");
    expect(jumps2.length).toBe(1);
    expect(jumps2[0].textContent).toBe("Skynet›");
    fireEvent.click(jumps2[0]);
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledTimes(1));
    // The link opens the role by slug, whatever it is called.
    expect(onOpenRoleModal.mock.calls[0][1]).toBe("box-maintainer");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("J: keyboard Enter on the focused link opens the role (a11y)", async () => {
    const user = userEvent.setup();
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    jump.focus();
    expect(document.activeElement).toBe(jump);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("J.2: keyboard Space on the focused link also opens the role (a11y)", async () => {
    const user = userEvent.setup();
    const onOpenRoleModal = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ title: "Skynet", role: "box-maintainer" }, onOpenRoleModal, onOpenChange);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const jump = screen.getByTestId("identity-modal-title-line-jump");
    jump.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(onOpenRoleModal).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("K: no role at all — no role links, the name still shows", async () => {
    const onOpenRoleModal = vi.fn();
    renderModal({ title: "Skynet", role: null, roles: [] }, onOpenRoleModal);
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    expect(screen.queryByTestId("identity-modal-title-line-jump")).toBeNull();
    expect(screen.queryByTestId("identity-modal-role-links")).toBeNull();
    expect(screen.getByTestId("identity-modal-hero").textContent).toContain("Tabitha");
    // The dialog is still named after the agent (screen-reader title).
    expect(screen.getByRole("dialog", { name: "Tabitha" })).toBeTruthy();
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
