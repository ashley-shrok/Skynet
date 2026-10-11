/**
 * IdentityBadge — core render tests.
 *
 * (Long-press-timer tests A/B/C/D/E/H/I retired when the tap-and-hold
 * primitive was deleted — the view-mode toggle now lives on the badge's
 * context-menu item, and mobile long-press → menu is driven by the
 * browser-native contextmenu event, not a JS timer. See shape-context-
 * menu-on-identity-badge-mobile for the consolidation.)
 *
 * Anti-regression tests kept:
 *   F. hover-fade class (patch #38 `hover:opacity-0`) is GONE
 *   G. when onClick is omitted, root renders as a non-interactive <div aria-hidden>
 *
 * Mock @/state/identities-store so the badge finds a matching identity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Identity } from "@/api/identities-api";

// ── Fixture identity (must satisfy full Identity shape) ─────────────────────
// Phase 68: Identity no longer has id/createdAt/updatedAt; avatarUrl bakes
// hostId at backend (no avatarUrlWithHost on frontend).
const FIXTURE: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Session coordinator",
  colorHue: 200,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
  task: null,
  project: null,
};

// Mock identities-store: byKey.get("tina") returns FIXTURE so the badge renders.
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [FIXTURE],
    byKey: new Map([["tina", FIXTURE]]),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

// Phase 104 Plan 02 — per-test override handle for useTrappedWork.
// Default is undefined (pre-fetch / D-06 start-absent).
let currentBadgeTrappedWork: { hasTrappedWork: boolean } | undefined =
  undefined;

vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: vi.fn(() => currentBadgeTrappedWork),
}));

// Per-test override handle for useProjects. Default is empty list — the
// project breadcrumb renders only when the identity's project slug resolves
// against this list; empty = no breadcrumb, matching the pre-project baseline.
type BadgeTestProjectRow = {
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
};
let currentBadgeProjects: readonly BadgeTestProjectRow[] = [];

// Per-test override handle for usePinnedIds. Default is empty set — the pin
// indicator renders only when the badge's tabId OR shadow fleet-row id is in
// this set. Empty = no indicator, matching the pre-pin baseline.
let currentBadgePinnedIds: ReadonlySet<string> = new Set<string>();

vi.mock("@/state/conversation-store", () => ({
  useProjects: vi.fn(() => currentBadgeProjects),
  usePinnedIds: vi.fn(() => currentBadgePinnedIds),
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
}));

// Late import — after the mock is registered.
import { IdentityBadge } from "./IdentityBadge";
import { useTrappedWork } from "@/state/trapped-work-store";

describe("IdentityBadge — core render", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("F: hover-fade class (patch #38 `hover:opacity-0`) is GONE from the rendered root", () => {
    const onClick = vi.fn();
    render(<IdentityBadge identityKey="tina" onClick={onClick} />);
    const root = screen.getByTestId("identity-badge-root");
    expect(root.className).not.toContain("hover:opacity-0");
  });

  it("G: when onClick is omitted, root is a non-interactive <div aria-hidden='true'>", () => {
    render(<IdentityBadge identityKey="tina" />);
    const root = screen.getByTestId("identity-badge-root");
    expect(root.tagName.toLowerCase()).toBe("div");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    // Sanity: also no button role available in the DOM.
    expect(screen.queryByRole("button")).toBeNull();
  });

  // iOS Safari suppresses its native long-press callout (magnifier /
  // share-sheet / "Look Up") when the element carries
  // `-webkit-touch-callout:none`. Locks the class token so a future
  // Tailwind rewrite can't silently regress the mobile long-press →
  // context-menu path. Parallels MicButton's Test 12 pattern.
  it("K: root className includes [-webkit-touch-callout:none] (iOS callout suppression)", () => {
    const onClick = vi.fn();
    render(<IdentityBadge identityKey="tina" onClick={onClick} />);
    const root = screen.getByTestId("identity-badge-root");
    expect(root.className).toContain("[-webkit-touch-callout:none]");
  });

  // Badge kebab (shared RowKebabMenu surface). menuItems non-empty → a ⋮
  // trigger renders inside the pill and right-click opens the same menu.
  // Touch long-press is retired (kebab is the mobile path, as on rows).
  describe("badge kebab menu", () => {
    const items = () => [
      { label: "Move to new window", onClick: vi.fn() },
      { label: "Archive", danger: true, onClick: vi.fn() },
    ];

    it("KEB-1: open button and kebab trigger are SIBLING controls inside a plain <div> root (no nested interactives)", () => {
      render(<IdentityBadge identityKey="tina" onClick={vi.fn()} menuItems={items()} />);
      const root = screen.getByTestId("identity-badge-root");
      expect(root.tagName).toBe("DIV");
      expect(root.getAttribute("role")).toBeNull();
      const open = screen.getByRole("button", { name: "Open agent info" });
      const trigger = screen.getByRole("button", { name: "Agent menu" });
      expect(root.contains(open) && root.contains(trigger)).toBe(true);
      expect(open.contains(trigger)).toBe(false);
      expect(trigger.contains(open)).toBe(false);
    });

    it("KEB-2: no menuItems (or empty) → no kebab trigger", () => {
      const { rerender } = render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
      expect(screen.queryByTestId("identity-badge-kebab-trigger")).toBeNull();
      rerender(<IdentityBadge identityKey="tina" onClick={vi.fn()} menuItems={[]} />);
      expect(screen.queryByTestId("identity-badge-kebab-trigger")).toBeNull();
    });

    it("KEB-3: kebab opens the menu, item click fires its onClick, badge onClick does NOT fire", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const its = items();
      render(<IdentityBadge identityKey="tina" onClick={onClick} menuItems={its} />);
      await user.click(screen.getByTestId("identity-badge-kebab-trigger"));
      await user.click(screen.getByRole("menuitem", { name: "Move to new window" }));
      expect(its[0].onClick).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("KEB-4: mouse right-click on the pill opens the same menu", async () => {
      render(<IdentityBadge identityKey="tina" onClick={vi.fn()} menuItems={items()} />);
      fireEvent.contextMenu(screen.getByTestId("identity-badge-root"), { clientX: 100, clientY: 40 });
      expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
    });

    it("KEB-5: touch long-press contextmenu does NOT open the menu", () => {
      render(<IdentityBadge identityKey="tina" onClick={vi.fn()} menuItems={items()} />);
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "pointerType", { value: "touch" });
      act(() => {
        screen.getByTestId("identity-badge-root").dispatchEvent(ev);
      });
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("KEB-6: keyboard on the open button fires onClick once per press; Enter on the kebab does not", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(<IdentityBadge identityKey="tina" onClick={onClick} menuItems={items()} />);
      screen.getByRole("button", { name: "Open agent info" }).focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");
      expect(onClick).toHaveBeenCalledTimes(2);
      screen.getByRole("button", { name: "Agent menu" }).focus();
      await user.keyboard("{Enter}");
      expect(onClick).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("menu")).toBeTruthy();
    });

    it("KEB-7: a drag starting on the kebab is cancelled (doesn't drag the badge)", () => {
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
      render(<IdentityBadge identityKey="tina" tabId="tab-1" onClick={vi.fn()} menuItems={items()} />);
      const trigger = screen.getByTestId("identity-badge-kebab-trigger");
      const ev = new Event("dragstart", { bubbles: true, cancelable: true });
      act(() => {
        trigger.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
      expect(consoleInfo.mock.calls.some((c) => String(c[0]).includes("[badge-drag]"))).toBe(false);
      consoleInfo.mockRestore();
    });

    it("KEB-8: non-interactive (no onClick) badge never renders a kebab, even with menuItems", () => {
      render(<IdentityBadge identityKey="tina" menuItems={items()} />);
      expect(screen.getByTestId("identity-badge-root").getAttribute("aria-hidden")).toBe("true");
      expect(screen.queryByTestId("identity-badge-kebab-trigger")).toBeNull();
    });

    it("KEB-9: clicking the pill padding (root itself) still fires onClick", () => {
      const onClick = vi.fn();
      render(<IdentityBadge identityKey="tina" onClick={onClick} menuItems={items()} />);
      fireEvent.click(screen.getByTestId("identity-badge-root"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 58 Plan 01: IdentityBadge as third-gesture drag source
// ─────────────────────────────────────────────────────────────────────────────
// Tests defending Phase 58 must_haves.truths (PV58-BADGE-DRAG-SOURCE,
// PV58-BADGE-PAYLOAD-DUAL-MIME, PV58-GESTURE-COEXISTENCE, PV58-STRUCTURED-LOGGING):
//   Phase 58 A: dragstart writes dual-MIME payload
//                  (text/plain + application/x-skynet-badge + effectAllowed=move)
//   Phase 58 B: dragstart emits [badge-drag] structured log
//                  (single console.info with tabId + hasIdentity fields)
//   Phase 58 C: mobile viewport suppresses draggable
//                  (useIsMobile returns true → draggable=false)
//   Phase 58 D: absent tabId suppresses draggable
//                  (tabId undefined → draggable=false regardless of viewport)
//   Phase 58 E: regression — click still fires post-drag-enabled
//
// (Phase 58 F/G — long-press-still-fires-post-drag-enabled + dragstart-
//  cancels-long-press-timer — retired when the long-press primitive was
//  deleted alongside the view-mode toggle's move to the badge context-
//  menu item.)
//
// jsdom does NOT construct a real DataTransfer, so we pass a stub with
// setData/getData/effectAllowed via fireEvent.dragStart's init object.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: build a stub DataTransfer for fireEvent.dragStart to spread onto the
// synthetic event. Backed by a Map so we can read back what the handler wrote.
function makeDataTransferStub() {
  const store = new Map<string, string>();
  const stub = {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "none" as string,
    // Some code paths iterate .types; expose a getter that reflects the map.
    get types() {
      return Array.from(store.keys());
    },
  };
  return stub;
}

// Helper: force useIsMobile to a specific value by mocking matchMedia +
// innerWidth for the render. Mirrors the pattern in use-mobile.test.ts.
function setMobileViewport(isMobile: boolean) {
  const width = isMobile ? 500 : 1280;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("IdentityBadge — Phase 58 Plan 01: badge as drag source", () => {
  beforeEach(() => {
    // Real timers because useIsMobile's initial useEffect reads
    // window.innerWidth synchronously via React's flush; fake timers
    // could interfere with the state update.
    vi.useRealTimers();
    // Default to desktop viewport for tests that don't override.
    setMobileViewport(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Phase 58 A: dragstart writes dual-MIME payload (text/plain + application/x-skynet-badge) with effectAllowed=move", async () => {
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    // Sanity: drag-source is enabled on desktop with a tabId.
    expect(root.getAttribute("draggable")).toBe("true");

    const dt = makeDataTransferStub();
    fireEvent.dragStart(root, { dataTransfer: dt });

    expect(dt.getData("text/plain")).toBe("tab-tina-42");
    const badgePayload = dt.getData("application/x-skynet-badge");
    expect(badgePayload).not.toBe("");
    expect(JSON.parse(badgePayload).tabId).toBe("tab-tina-42");
    expect(dt.effectAllowed).toBe("move");
  });

  it("Phase 58 B: dragstart emits a single [badge-drag] structured log with tabId + hasIdentity fields", () => {
    const onClick = vi.fn();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    const dt = makeDataTransferStub();
    fireEvent.dragStart(root, { dataTransfer: dt });

    // Exactly one [badge-drag] emission.
    const badgeCalls = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && call[0].startsWith("[badge-drag] "),
    );
    expect(badgeCalls).toHaveLength(1);
    const line = badgeCalls[0]![0] as string;
    expect(line).toContain("tabId=tab-tina-42");
    expect(line).toContain("hasIdentity=true");
  });

  it("Phase 58 C: mobile viewport suppresses draggable (useIsMobile=true → draggable=false)", () => {
    setMobileViewport(true);
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    // Accept either the attribute absent or serialized as "false".
    const draggableAttr = root.getAttribute("draggable");
    expect(draggableAttr === null || draggableAttr === "false").toBe(true);
  });

  it("Phase 58 D: absent tabId suppresses draggable (draggable=false regardless of viewport)", () => {
    const onClick = vi.fn();
    render(<IdentityBadge identityKey="tina" onClick={onClick} />);
    const root = screen.getByTestId("identity-badge-root");
    const draggableAttr = root.getAttribute("draggable");
    expect(draggableAttr === null || draggableAttr === "false").toBe(true);
  });

  it("Phase 58 E: regression — click still fires on tap when tabId is present (drag-enabled does not break click)", () => {
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.click(root);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // (Phase 58 F/G — long-press-still-fires-post-drag-enabled + dragstart-
  //  cancels-timer — retired alongside the long-press primitive itself
  //  when the view-mode toggle moved to the context-menu item.)
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 67 Plan 67-02 Track B — coordinator watermark on the IdentityBadge.
// Two tests: presence-when-true / absence-when-absent for the badge's inner
// fragment watermark span. Both branches (interactive <button> + non-
// interactive <div>) share the same `inner` fragment, so asserting via the
// interactive branch (default onClick present) covers both by construction.
// ─────────────────────────────────────────────────────────────────────────────
import { useIdentities } from "@/state/identities-store";

describe("IdentityBadge — Phase 67 coordinator watermark", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setMobileViewport(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BADGE-COORD-1: identity.coordinator === true renders data-testid=coordinator-watermark inside the badge root", () => {
    const coordFixture = { ...FIXTURE, coordinator: true };
    vi.mocked(useIdentities).mockReturnValue({
      identities: [coordFixture],
      byKey: new Map([["tina", coordFixture]]),
      loaded: true,
      refresh: vi.fn(),
    });
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    const root = screen.getByTestId("identity-badge-root");
    const watermark = root.querySelector('[data-testid="coordinator-watermark"]');
    expect(watermark).not.toBeNull();
  });

  it("BADGE-COORD-2: identity.coordinator absent → no coordinator-watermark element in DOM", () => {
    // Explicitly restore the FIXTURE-without-coordinator baseline. Vitest
    // does NOT roll back `vi.mocked(fn).mockReturnValue(...)` overrides
    // between tests in the same describe block on its own — a prior test
    // (BADGE-COORD-1) swapped in a coordinator-true FIXTURE, so we must
    // pin the baseline back explicitly before rendering to defend against
    // test-ordering-dependent bleed. FIXTURE has no coordinator field —
    // undefined at runtime, resolves to false-branch under the strict
    // `=== true` guard on the render side.
    vi.mocked(useIdentities).mockReturnValue({
      identities: [FIXTURE],
      byKey: new Map([["tina", FIXTURE]]),
      loaded: true,
      refresh: vi.fn(),
    });
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    expect(
      screen.queryByTestId("coordinator-watermark"),
    ).toBeNull();
  });

  it("BADGE-COORD-3 (Phase 67 /close 2026-09-01 follow-up, M3): coordinator watermark null-hue fallback is 216 (unified with row + modal)", () => {
    // Pre-fix, the badge fell back to hue 35 (chrome default) for the
    // watermark when identity.colorHue was null — mismatching the row's
    // CSS `--pv-hue: 216` default. Post-fix, the watermark's null-hue
    // fallback is 216 across all three surfaces (chrome fallback stays at
    // 35 — see comment at IdentityBadge.tsx `const hue = ...`).
    // JSDOM canonicalizes inline CSS colors on read (hsl → rgb), so this
    // test asserts on the rgb() equivalents:
    //   hsl(216, 85%, 78%) → rgb(151, 189, 247)  (fallback: unified 216)
    //   hsl(35,  85%, 78%) → rgb(247, 207, 151)  (pre-fix bug: chrome-35)
    const nullHueCoordFixture = {
      ...FIXTURE,
      colorHue: null as number | null,
      coordinator: true,
    };
    vi.mocked(useIdentities).mockReturnValue({
      identities: [nullHueCoordFixture],
      byKey: new Map([["tina", nullHueCoordFixture]]),
      loaded: true,
      refresh: vi.fn(),
    });
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    const watermark = screen.getByTestId("coordinator-watermark");
    const inlineStyle = watermark.getAttribute("style") ?? "";
    expect(inlineStyle).toContain("rgb(151, 189, 247)"); // = hsl(216, 85%, 78%)
    expect(inlineStyle).not.toContain("rgb(247, 207, 151)"); // ≠ hsl(35, 85%, 78%)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 104 Plan 02 — trapped-work indicator on IdentityBadge (D-05 same-visual
// consistency across the two identity surfaces).
// ─────────────────────────────────────────────────────────────────────────────
// The BADGE-TRAP-* tests defend the D-05 same-visual invariant across the two
// identity surfaces + D-06 start-absent + D-07 tooltip copy + Pattern 4 hostId
// reactivation (Phase 68 made hostId a no-op for avatar-URL construction;
// Phase 104 reactivates it for the store lookup). Coordinator watermark
// coexistence is asserted so the two overlays never collide.

describe("IdentityBadge — Phase 104 trapped-work indicator", () => {
  beforeEach(() => {
    vi.useRealTimers();
    // Reset the trapped-work override so each test starts pre-fetch.
    currentBadgeTrappedWork = undefined;
    // Reset the useTrappedWork mock's call log so BADGE-TRAP-6 can inspect
    // mock.calls without prior-test leakage.
    vi.mocked(useTrappedWork).mockClear();
    // Baseline identities-store fixture (non-coordinator).
    vi.mocked(useIdentities).mockReturnValue({
      identities: [FIXTURE],
      byKey: new Map([["tina", FIXTURE]]),
      loaded: true,
      refresh: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BADGE-TRAP-1: hasTrappedWork:true renders data-testid=pv-trapped-work-indicator inside the badge root", () => {
    currentBadgeTrappedWork = { hasTrappedWork: true };
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    const root = screen.getByTestId("identity-badge-root");
    const indicator = root.querySelector(
      '[data-testid="pv-trapped-work-indicator"]',
    );
    expect(indicator).not.toBeNull();
  });

  it("BADGE-TRAP-2: undefined OR {hasTrappedWork:false} renders NO indicator", () => {
    // Case A — undefined (pre-fetch).
    currentBadgeTrappedWork = undefined;
    const { unmount } = render(
      <IdentityBadge identityKey="tina" onClick={vi.fn()} />,
    );
    expect(screen.queryByTestId("pv-trapped-work-indicator")).toBeNull();
    unmount();

    // Case B — {hasTrappedWork:false}.
    currentBadgeTrappedWork = { hasTrappedWork: false };
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    expect(screen.queryByTestId("pv-trapped-work-indicator")).toBeNull();
  });

  it("BADGE-TRAP-3: tooltip title=\"Has local work not yet pushed to any remote\" (D-07) and icon aria-hidden=true", () => {
    currentBadgeTrappedWork = { hasTrappedWork: true };
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    const indicator = screen.getByTestId("pv-trapped-work-indicator");
    expect(indicator.getAttribute("title")).toBe(
      "Has local work not yet pushed to any remote",
    );
    const svg = indicator.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("BADGE-TRAP-4: coordinator=true + hasTrappedWork:true → BOTH coordinator-watermark AND pv-trapped-work-indicator render", () => {
    const coordFixture = { ...FIXTURE, coordinator: true };
    vi.mocked(useIdentities).mockReturnValue({
      identities: [coordFixture],
      byKey: new Map([["tina", coordFixture]]),
      loaded: true,
      refresh: vi.fn(),
    });
    currentBadgeTrappedWork = { hasTrappedWork: true };
    render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
    expect(screen.getByTestId("coordinator-watermark")).not.toBeNull();
    expect(screen.getByTestId("pv-trapped-work-indicator")).not.toBeNull();
  });

  it("BADGE-TRAP-5: identityKey=null → no indicator (early-return short-circuit before the render)", () => {
    // The badge component early-returns `null` when identity is not found.
    // useTrappedWork itself short-circuits on null identityKey — but the
    // render never gets past `if (!identity) return null` anyway when
    // identityKey is null, so the indicator element is absent regardless.
    currentBadgeTrappedWork = { hasTrappedWork: true };
    // Render with identityKey=null — badge returns null; nothing is rendered.
    const { container } = render(
      <IdentityBadge identityKey={null} onClick={vi.fn()} />,
    );
    expect(
      container.querySelector('[data-testid="pv-trapped-work-indicator"]'),
    ).toBeNull();
  });

  it("BADGE-TRAP-6 (hostId threading — Pattern 4 reactivation): useTrappedWork receives (identityKey, hostId) from props, not (identityKey, null)", () => {
    currentBadgeTrappedWork = { hasTrappedWork: true };
    render(
      <IdentityBadge identityKey="tina" hostId={42} onClick={vi.fn()} />,
    );
    // Verify the hook was called with the hostId prop threaded through.
    // Filter to calls that carry the identityKey (there may be prior calls
    // from other renders in the same test suite; we're asserting on
    // "at least one call has (tina, 42)" for robustness against re-render).
    const calls = vi.mocked(useTrappedWork).mock.calls;
    const found = calls.some(
      (c) => c[0] === "tina" && c[1] === 42,
    );
    expect(found).toBe(true);
    // Explicitly assert it did NOT get called with (tina, null) for this render.
    const nullCalls = calls.filter(
      (c) => c[0] === "tina" && c[1] === null,
    );
    expect(nullCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project-breadcrumb row — identity.project slug → projects list displayName.
// ─────────────────────────────────────────────────────────────────────────────

// Fixture with hostId + project set, so the projects-list lookup can resolve.
const PROJECT_FIXTURE: Identity = {
  identityKey: "tina",
  hostId: 7,
  displayName: "Tina",
  title: "Session coordinator",
  colorHue: 200,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
  task: null,
  project: "fleet-substrate",
};

describe("IdentityBadge — project breadcrumb", () => {
  const useIdentitiesMock = vi.mocked(useIdentities);

  afterEach(() => {
    currentBadgeProjects = [];
    // Restore the default identities mock for other describe blocks.
    useIdentitiesMock.mockReturnValue({
      identities: [FIXTURE],
      byKey: new Map([["tina", FIXTURE]]),
      loaded: true,
      refresh: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.clearAllMocks();
  });

  it("renders the breadcrumb when identity.project slug resolves against the projects list on the same hostId", () => {
    useIdentitiesMock.mockReturnValue({
      identities: [PROJECT_FIXTURE],
      byKey: new Map([["tina", PROJECT_FIXTURE]]),
      loaded: true,
      refresh: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    currentBadgeProjects = [
      {
        slug: "fleet-substrate",
        displayName: "Fleet Substrate",
        hostId: "7",
        hostname: "t1000",
        archived: false,
      },
    ];
    render(<IdentityBadge identityKey="tina" hostId={7} />);
    const crumb = screen.getByTestId("pv-identity-project-breadcrumb");
    expect(crumb.textContent).toContain("Fleet Substrate");
  });

  it("omits the breadcrumb when identity.project is null", () => {
    // Default FIXTURE has project: null.
    render(<IdentityBadge identityKey="tina" />);
    expect(
      screen.queryByTestId("pv-identity-project-breadcrumb"),
    ).toBeNull();
  });

  it("omits the breadcrumb when the projects list has no matching slug on the identity's hostId (unknown / cross-host project)", () => {
    useIdentitiesMock.mockReturnValue({
      identities: [PROJECT_FIXTURE],
      byKey: new Map([["tina", PROJECT_FIXTURE]]),
      loaded: true,
      refresh: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // Same slug, but on a different hostId — projects are per-host.
    currentBadgeProjects = [
      {
        slug: "fleet-substrate",
        displayName: "Fleet Substrate",
        hostId: "99",
        hostname: "somewhere-else",
        archived: false,
      },
    ];
    render(<IdentityBadge identityKey="tina" hostId={7} />);
    expect(
      screen.queryByTestId("pv-identity-project-breadcrumb"),
    ).toBeNull();
  });
});

describe("IdentityBadge — role line", () => {
  const useIdentitiesMock = vi.mocked(useIdentities);
  const renderWith = (overrides: Partial<Identity>) => {
    const identity = { ...FIXTURE, ...overrides } as Identity;
    useIdentitiesMock.mockReturnValue({
      identities: [identity],
      byKey: new Map([["tina", identity]]),
      loaded: true,
      refresh: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    render(<IdentityBadge identityKey="tina" />);
    return screen.queryByTestId("pv-identity-role-line");
  };

  it("shows the role's displayName, not the identity's own title", () => {
    expect(
      renderWith({
        title: "Session coordinator",
        role: "box-maintainer",
        roles: ["box-maintainer"],
        roleDefaults: { displayName: "Skynet" },
      })?.textContent,
    ).toBe("Skynet");
  });

  it("falls back to the title-cased slug for a role with no displayName", () => {
    expect(
      renderWith({ title: null, role: "general-purpose", roles: ["general-purpose"], roleDefaults: {} })
        ?.textContent,
    ).toBe("General Purpose");
  });

  it("lists every role for a multi-role identity, with the full list on hover", () => {
    const line = renderWith({ title: null, role: null, roles: ["box-maintainer", "sky-uat"], roleDefaults: null });
    expect(line?.textContent).toBe("Box Maintainer, Sky Uat");
    expect(line?.getAttribute("title")).toBe("Box Maintainer, Sky Uat");
  });

  it("renders no role line when there is no title and no role", () => {
    expect(renderWith({ title: null, role: null, roles: [] })).toBeNull();
  });
});
