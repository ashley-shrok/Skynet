/**
 * Quick 260806-lzd — IdentityBadge: single-variant refactor + onLongPress primitive
 *
 * Tests A-G defend the plan's must_haves.truths:
 *   A. onLongPress fires after 500ms of held pointerdown
 *   B. pointermove before 500ms cancels the long-press timer
 *   C. pointerup before 500ms cancels the long-press AND fires onClick (tap semantics)
 *   D. pointercancel clears the timer
 *   E. completed long-press suppresses the subsequent onClick (no double-fire)
 *   F. hover-fade class (patch #38 `hover:opacity-0`) is GONE — anti-regression gate
 *   G. when onClick is omitted, root renders as a non-interactive <div aria-hidden>
 *
 * Fake timers so 500ms is deterministic, not wall-clock.
 * Mock @/state/identities-store so the badge finds a matching identity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

// Late import — after the mock is registered.
import { IdentityBadge } from "./IdentityBadge";
import { useTrappedWork } from "@/state/trapped-work-store";

describe("IdentityBadge — single-variant + onLongPress (quick 260806-lzd)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("A: onLongPress fires after 500ms of held pointerdown", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("B: pointermove before 500ms cancels the long-press timer", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerMove(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("C: pointerup before 500ms cancels long-press AND allows onClick (tap)", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(root);
    // JSDOM doesn't synthesize click from pointerdown+pointerup on <button>;
    // dispatch it explicitly to model the browser's tap-completion behavior.
    fireEvent.click(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("D: pointercancel clears the long-press timer", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerCancel(root);
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("E: a completed long-press suppresses the trailing onClick (no double-fire)", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // Browser fires a click at the end of the press. It must be swallowed.
    fireEvent.click(root);
    expect(onClick).not.toHaveBeenCalled();
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 58 Plan 01: IdentityBadge as third-gesture drag source
// ─────────────────────────────────────────────────────────────────────────────
// Six new tests defend Phase 58 must_haves.truths (PV58-BADGE-DRAG-SOURCE,
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
//   Phase 58 F: regression — long-press still fires post-drag-enabled
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
    // Phase 58 tests use REAL timers because useIsMobile's initial useEffect
    // reads window.innerWidth synchronously via React's flush; fake timers
    // could interfere with the state update. Long-press regression tests
    // (E + F) still work at real-time by using 500ms real timer.
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

  it("Phase 58 E: regression — click still fires on short-press when tabId is present (drag-enabled does not break click)", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(root);
    fireEvent.click(root);
    vi.advanceTimersByTime(400);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("Phase 58 F: regression — long-press still fires at 500ms when tabId is present (drag-enabled does not break long-press)", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("Phase 58 G (inline-260902 drag-cancels-long-press): dragstart cancels the armed long-press timer so a slow drag doesn't fire onLongPress mid-drag", () => {
    // Repro: pointerdown arms the 500ms timer. Native HTML5 drag suppresses
    // pointermove after promotion, so the pointermove-based cancel never
    // fires. Before the fix, a drag lasting >500ms triggered onLongPress
    // (PV↔terminal toggle) mid-drag. dragStart must clear the timer.
    vi.useFakeTimers();
    const onClick = vi.fn();
    const onLongPress = vi.fn();
    render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-tina-42"
        onClick={onClick}
        onLongPress={onLongPress}
      />,
    );
    const root = screen.getByTestId("identity-badge-root");
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(100);
    // Drag starts (typical browser: promoted from pointerdown after ~5px
    // movement, WITHOUT a pointermove ever reaching this element).
    fireEvent.dragStart(root, { dataTransfer: makeDataTransferStub() });
    // Slow drag: user hovers over drop targets past the 500ms threshold.
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });
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

  // ── onContextMenu wire-up (pv-identity-badge-move-to-new-window bounty) ──
  // Guards the identity-badge → PV context-menu integration surface. The
  // badge itself only owns the handler wire; the menu rendering + item
  // semantics live upstream (PrettyView + IdentitySessionPane). If a
  // future refactor drops onContextMenu from the button/div render branches
  // the "Move to new window" affordance goes silent — this catches it.
  describe("onContextMenu prop", () => {
    beforeEach(() => {
      vi.mocked(useIdentities).mockReturnValue({
        identities: [FIXTURE],
        byKey: new Map([["tina", FIXTURE]]),
        loaded: true,
        refresh: vi.fn(),
      });
    });

    it("CTX-1: interactive <button> branch fires onContextMenu on right-click", () => {
      const onContextMenu = vi.fn();
      render(
        <IdentityBadge
          identityKey="tina"
          onClick={vi.fn()}
          onContextMenu={onContextMenu}
        />,
      );
      const root = screen.getByTestId("identity-badge-root");
      expect(root.tagName).toBe("BUTTON");
      fireEvent.contextMenu(root);
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("CTX-2: non-interactive <div> branch also fires onContextMenu on right-click", () => {
      const onContextMenu = vi.fn();
      render(
        <IdentityBadge identityKey="tina" onContextMenu={onContextMenu} />,
      );
      const root = screen.getByTestId("identity-badge-root");
      expect(root.tagName).toBe("DIV");
      fireEvent.contextMenu(root);
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("CTX-3: no onContextMenu → default browser context menu is not suppressed", () => {
      render(<IdentityBadge identityKey="tina" onClick={vi.fn()} />);
      const root = screen.getByTestId("identity-badge-root");
      // No throw + no attached handler ⇒ the event bubbles without React
      // catching it. Just verify the render is clean.
      expect(root).toBeTruthy();
      fireEvent.contextMenu(root); // must not throw
    });
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
