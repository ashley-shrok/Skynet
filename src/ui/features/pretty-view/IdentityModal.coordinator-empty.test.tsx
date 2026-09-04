/**
 * Phase 72 Plan 04 — IdentityModal coordinator empty-state tests.
 *
 * 5 tests locking the coordinator-Identity-view empty captions + the
 * Add-wakeup pill-in-both-branches invariant. The coordinator-Identity-
 * scope-empty case is the ONLY branch that omits the pill; every other
 * branch (actor-identity-empty + role-scope-empty for both actor and coord)
 * MUST render it so first-wakeup flow is reachable.
 *
 *   C1: coordinator + Identity scope + empty wakeups list →
 *       wakeups-coordinator-empty-identity caption present, "No scheduled
 *       wake-ups." NOT present, Add-wakeup pill NOT rendered.
 *   C2: coordinator + Handoff tab (Identity scope) → handoff-coordinator-empty
 *       caption present, no markdown editor (short-circuit).
 *   C3: coordinator + Identity file tab → renders normally (no coord short-
 *       circuit; IdentityFileTab's own render path is unaffected).
 *   C4: actor + Identity scope + empty wakeups → normal "No scheduled wake-
 *       ups." caption + Add-wakeup pill present.
 *   C5: pill-in-both-branches invariant — WakeupsTab standalone with
 *       scope='role', isCoordinator=false, (a) empty list → pill in empty
 *       state, (b) non-empty list → pill above the row list.
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
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { Wakeup } from "@/api/claude-session-api";

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
import { WakeupsTab } from "./WakeupsTab";
import { __resetModalScopeForTest } from "@/state/modal-scope-store";

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

// Seed empty identity-scope wakeups list so tab renders in "ready" (empty).
function deliverEmptyIdentityWakeups(): void {
  const sock = findSocketForRequestType("identity:list-wakeups");
  expect(sock).toBeDefined();
  act(() => {
    sock!.onmessage!({
      data: JSON.stringify({ type: "identity:wakeups", wakeups: [] }),
    } as MessageEvent<string>);
  });
}

// Seed the handoff read so state.data is populated (proves short-circuit
// fires even when there's markdown to render).
function deliverHandoff(markdown: string): void {
  const sock = findSocketForRequestType("identity:get-handoff");
  expect(sock).toBeDefined();
  act(() => {
    sock!.onmessage!({
      data: JSON.stringify({ type: "identity:handoff", markdown }),
    } as MessageEvent<string>);
  });
}

function switchScope(scope: "role" | "identity"): void {
  const btn = document.querySelector(
    `[data-testid="scope-switch-${scope}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`scope-switch-${scope} button not found`);
  fireEvent.click(btn);
}

// Click a nav button in the currently-visible bottom bar by label substring.
function clickNav(labelSubstring: string): void {
  const btn = Array.from(
    document.querySelectorAll(".shrink-0.flex.items-stretch button"),
  ).find((b) => b.textContent?.includes(labelSubstring)) as
    | HTMLButtonElement
    | undefined;
  expect(btn).toBeDefined();
  fireEvent.click(btn!);
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
// Test C1 — coordinator + Identity scope + empty wakeups → caption, no pill
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal coordinator empty states — Wakeups", () => {
  it("test C1: coordinator + Identity scope + empty wakeups shows caption without Add-wakeup pill", async () => {
    // Coordinator mount → defaults to Role scope; flip to Identity.
    renderModal({ coordinator: true });
    await new Promise((r) => setTimeout(r, 0));
    switchScope("identity");
    clickNav("Wakeups");
    // Seed empty identity-scope wakeups so the empty branch fires.
    deliverEmptyIdentityWakeups();

    await waitFor(() => {
      expect(
        screen.queryByTestId("wakeups-coordinator-empty-identity"),
      ).toBeTruthy();
    });

    // Locked caption text.
    const captionEl = screen.getByTestId("wakeups-coordinator-empty-identity");
    expect(captionEl.textContent).toBe(
      "Coordinators use role-scope wakeups only. Switch to Role view to manage.",
    );

    // No Add-wakeup pill in this branch.
    expect(screen.queryByTestId("wakeup-add-button")).toBeNull();

    // No "No scheduled wake-ups." fallback either — the coord branch replaces
    // it, doesn't augment it.
    expect(screen.queryByText("No scheduled wake-ups.")).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test C2 — coordinator + Handoff tab (Identity scope) → coord caption
  // ───────────────────────────────────────────────────────────────────────────
  it("test C2: coordinator + Handoff tab shows coordinator caption even with non-empty markdown", async () => {
    renderModal({ coordinator: true });
    await new Promise((r) => setTimeout(r, 0));
    switchScope("identity");
    clickNav("Handoff");
    // Deliberately deliver non-empty markdown to prove the short-circuit
    // fires BEFORE the empty-check — a coord with a stray handoff.md still
    // gets the caption.
    deliverHandoff("# Some stray handoff content");

    await waitFor(() => {
      expect(screen.queryByTestId("handoff-coordinator-empty")).toBeTruthy();
    });

    const captionEl = screen.getByTestId("handoff-coordinator-empty");
    expect(captionEl.textContent).toBe(
      "Coordinators are stateless routers — no handoff to display.",
    );

    // No markdown editor (toolbar Edit button) — the coord branch precedes
    // both the empty-state fallback AND the render-body.
    expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
    // No stray handoff prose either.
    expect(screen.queryByText("# Some stray handoff content")).toBeNull();
    expect(screen.queryByText("Some stray handoff content")).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test C3 — coordinator + Identity file tab → renders normally
  // ───────────────────────────────────────────────────────────────────────────
  it("test C3: coordinator + Identity file tab renders normally (no coord short-circuit)", async () => {
    renderModal({ coordinator: true });
    await new Promise((r) => setTimeout(r, 0));
    switchScope("identity");
    // Identity scope defaults to Identity file tab — no nav click needed.

    // The active TabsContent should be "identity" (Identity file) — assert
    // via Radix's id-suffix pattern (mirrors scope-switch tests).
    const activePanels = document.querySelectorAll(
      '[role="tabpanel"][data-state="active"]',
    );
    // Exactly one active panel; its id encodes value="identity".
    expect(activePanels.length).toBeGreaterThanOrEqual(1);
    const identityPane = Array.from(activePanels).find((p) =>
      p.getAttribute("id")?.match(/content-identity$/),
    );
    expect(identityPane).toBeTruthy();

    // No coord short-circuit rendered anywhere in the Identity file pane.
    expect(
      screen.queryByTestId("wakeups-coordinator-empty-identity"),
    ).toBeNull();
    expect(screen.queryByTestId("handoff-coordinator-empty")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C4 — actor + Identity scope + empty wakeups → normal caption + pill
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal coordinator empty states — actor regression guard", () => {
  it("test C4: actor + Identity scope + empty wakeups shows normal caption AND Add-wakeup pill", async () => {
    renderModal({ coordinator: false });
    await new Promise((r) => setTimeout(r, 0));
    // Actor default is Identity scope — sanity flip is a no-op.
    switchScope("identity");
    clickNav("Wakeups");
    deliverEmptyIdentityWakeups();

    await waitFor(() => {
      expect(screen.queryByText("No scheduled wake-ups.")).toBeTruthy();
    });

    // Add-wakeup pill IS present (first-wakeup flow reachable).
    expect(screen.getByTestId("wakeup-add-button")).toBeTruthy();

    // Coord caption is NOT present.
    expect(
      screen.queryByTestId("wakeups-coordinator-empty-identity"),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C5 — pill-in-both-branches invariant (WakeupsTab standalone)
// ─────────────────────────────────────────────────────────────────────────────
describe("WakeupsTab — Add-wakeup pill invariant (Phase 72 Plan 04)", () => {
  const BASE_WAKEUP: Wakeup = {
    slug: "hourly-role-check",
    name: "hourly-role-check",
    enabled: true,
    schedule: { type: "interval", every: "1h" },
    scheduleHuman: "every 1h",
    instruction: "Check the role folder.",
  };

  it("test C5a: scope=role, isCoordinator=false, empty list → pill renders in empty-state", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [] }}
        hue={200}
        scope="role"
        isCoordinator={false}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // Empty-state caption present.
    expect(screen.getByText("No scheduled wake-ups.")).toBeTruthy();
    // Pill also present in the empty-state branch.
    expect(screen.getByTestId("wakeup-add-button")).toBeTruthy();
  });

  it("test C5b: scope=role, isCoordinator=false, non-empty list → pill renders above the row list", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="role"
        isCoordinator={false}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // Pill present in the data-branch (above the wakeup rows).
    expect(screen.getByTestId("wakeup-add-button")).toBeTruthy();
    // Empty-state caption absent (data branch, not empty branch).
    expect(screen.queryByText("No scheduled wake-ups.")).toBeNull();
    // The row is present.
    expect(screen.getByText("hourly-role-check")).toBeTruthy();
  });
});
