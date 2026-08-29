// Phase 30 (PS30-07): integration tests for the backend-authoritative
// pane_state architecture. Replaces the Phase-29 integration suite that
// exercised entry-triggers / snapshot rearm / client-inference — every
// mechanism from that suite is DELETED in Phase 30, so its tests DELETE
// too. The Phase-30 architecture is TRIVIALLY testable by comparison:
// mount PrettyView with mocked WS, dispatch pane_state frames, assert
// the correct overlay mounts. No delay-arm timers to coordinate, no
// snapshot rearm to reason about, no entry-trigger edges to simulate.
//
// Structure:
//   GROUP 1 — structural-grep gates (Task 3 acceptance criteria) locked
//     as vitest tests so regressions pin exact file+identifier
//   GROUP 2-7 — six mount-behavior tests (A-F):
//     A — pane_state:active → no overlay (message view)
//     B — pane_state:holding → SessionHoldingOverlay
//     C — pane_state:holding then pane_state:active → SessionHoldingOverlay
//         unmounts, message view visible
//     D — no pane_state received → PrettyViewLoadingOverlay (resolving)
//     E — WS ladder terminally exhausted → PrettyViewErrorOverlay
//     F — pane_state:holding then transient WS drop → overlay does NOT
//         flip to resolving (D-11 don't-flicker)
//   Test G — reset button click assertion (patch #381 anti-pattern
//     DELETED) — lives inside GROUP 1's grep gates rather than as a
//     runtime test, because the assertion is a source-code invariant
//     (onResetClicked's body contains no client-side pane-state
//     mutation) not a rendered-DOM invariant.
//
// Sub-step I / Test H — backend-side round-trip latency approximation
// (F4 acknowledgment on record) — NOT included at the integration level
// here because it exercises the backend detectIdReset + pane-state-
// emitter path, which lives under src/backend/claude-session/. Plan
// 30-01's pane-state-emitter.test.ts already covers the synchronous
// emit contract; adding a duplicated frontend-integration variant here
// would test the same synchronous-emit invariant twice without new
// coverage. This file covers the FRONTEND-side receive-to-render window
// per Tests A-F.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── WS-mock harness (mirrors PrettyView.test.tsx §36-77 shape) ────────────
// Each render creates a fresh stub; wsStubs[wsStubs.length-1] is the current
// one. openClaudeSessionSocket is mocked to push a new stub on every call.
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
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
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
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: vi.fn(() => ({ identity: null, identityHue: null })),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";
// Phase 53 Plan 03 — import publishFleetStatusSessionState + __resetForTest to
// seed the working-store recycling axis for GROUP 3 Test B, GROUP 4 Test C,
// and GROUP 7 Test F (which assert SessionHoldingOverlay mount/unmount; the
// overlay is now gated on isRecycling from the working-store, not paneState).
import {
  publishFleetStatusSessionState,
  __resetForTest as resetWorkingStore,
} from "@/state/session-working-store";

// ─────────────────────────────────────────────────────────────────────────────
// Source-path anchors for grep-level tests (GROUP 1 below).
// ─────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const PV_SRC_PATH = join(HERE, "PrettyView.tsx");
const HOOK_SRC_PATH = join(HERE, "usePaneResolvingMachine.ts");
const RESOLVE_SRC_PATH = join(HERE, "resolve-phase.ts");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendFrame(ws: WsStub, frame: Record<string, unknown>): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(frame),
      }),
    );
  });
}

function fireClose(ws: WsStub): void {
  act(() => {
    ws.readyState = 3;
    ws.onclose?.();
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Structural-grep gates (Task 3 acceptance criteria)
//
// These gates prove the Phase-30 rewrite deleted every trace of the Phase-29
// client-inference machinery (code AND comments) — they run cheaply as
// vitest tests so a regression pins the exact file+identifier.
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 — structural-grep gates (PS30-04 + PS30-05 + PS30-06)", () => {
  const pvSrc = readFileSync(PV_SRC_PATH, "utf-8");
  const hookSrc = readFileSync(HOOK_SRC_PATH, "utf-8");
  const resolveSrc = readFileSync(RESOLVE_SRC_PATH, "utf-8");

  it("PrettyView.tsx: zero captureFirstFrame references (code AND comments)", () => {
    expect(pvSrc).not.toMatch(/captureFirstFrame/);
  });

  it("PrettyView.tsx: zero backendFirstFrame references (code AND comments)", () => {
    expect(pvSrc).not.toMatch(/backendFirstFrame|BackendFirstFrame/);
  });

  it("PrettyView.tsx: exactly one `case \"pane_state\"` handler in the WS switch", () => {
    // Match the handler CASE (with the opening brace) — the two comment
    // references to `case "pane_state"` in JSDoc don't have the brace.
    const matches = pvSrc.match(/case "pane_state": \{/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("PrettyView.tsx: zero Phase-29 zombie comment blocks (F3 gate)", () => {
    expect(pvSrc).not.toMatch(/phase-29 \(plan 29-05 test-audit fix\)/);
    expect(pvSrc).not.toMatch(/usePaneResolvingMachine: captureFirstFrame/);
  });

  it("PrettyView.tsx: zero rearm-snapshot / has-resolved-this-pane sentinel refs", () => {
    expect(pvSrc).not.toMatch(/rearmSnapshotRef|hasResolvedThisPaneRef/);
  });

  it("PrettyView.tsx: zero requestRetry / handleRetry / bare-showSpinner references (Phase-29 hook surface gone)", () => {
    // phase-30-restore-resolving-overlay-paint-delay (2026-08-10): the
    // `showResolvingSpinner` local was legitimately reintroduced AT THE
    // CALLER SITE as PS30-06's comment authorized after Ashley UAT surfaced
    // the flash Phase 30's delay-arm deletion left exposed. It is NOT a
    // resurrection of the Phase-29 hook surface — the hook stays trivial
    // (see usePaneResolvingMachine.ts) — so the grep guard drops it and
    // only continues to fence the truly-retired hook-return prop names.
    expect(pvSrc).not.toMatch(/\brequestRetry\b|\bhandleRetry\b/);
    // showSpinner alone is also gone (was a Phase-29 hook return prop;
    // distinct from the caller-site `showResolvingSpinner`).
    expect(pvSrc).not.toMatch(/\bshowSpinner\b/);
  });

  it("PrettyView.tsx: overlay mount gates use renderedState === '...' (backend-authoritative) — dormant/error/inactive use renderedState; resolving uses showResolvingSpinner; holding moved to useSessionIsRecycling (Phase 53 Plan 03)", () => {
    // Phase 53 Plan 03: "holding" was intentionally moved off renderedState
    // and is now driven by useSessionIsRecycling (working-store Axis E).
    // The other overlays still use renderedState — locked by assertions below.
    // The new hook consumption is locked by the new grep gate below.
    expect(pvSrc).toMatch(/renderedState === "dormant"/);
    expect(pvSrc).toMatch(/renderedState === "error"/);
    expect(pvSrc).toMatch(/renderedState === "inactive"/);
    // phase-30-restore-resolving-overlay-paint-delay (2026-08-10): the
    // resolving-state mount is gated on `showResolvingSpinner`, a boolean
    // flipped by a 400ms paint-delay useEffect observing renderedState.
    // Direct `renderedState === "resolving"` gating is retired — that was
    // the pattern that produced Ashley's UAT flash. See PrettyView.tsx
    // for the delay-arm effect + mount gate.
    expect(pvSrc).toMatch(/showResolvingSpinner &&/);
  });

  it("Phase 60 finish-line: ComposeBox canSend widens beyond `status === 'streaming'` to include `renderedState === 'dormant'` and `renderedState === 'active'` (2026-08-29 Ashley regression: Send stayed disabled on dormant panes)", () => {
    // Phase 60 (patch #519, 2026-08-29) mounted the ComposeBox for dormant
    // panes so Ashley can type-and-send into a sleeping session and the
    // backend invisibly wakes it. The MOUNT gate above (line ~3286) was
    // widened to include `renderedState === "dormant"` and
    // `renderedState === "active"` (cold-dormant → wake transition). But
    // the canSend prop kept `status === "streaming"` only, so ComposeBox's
    // internal `sendDisabled` predicate still gated Send off via
    // `(canSend === false && !hasAttachments)`. Ashley UAT 2026-08-29:
    // "sometimes typing into the main text area of the compose box or
    // pasting stuff in there doesn't enable the send button." This test
    // pins the widened predicate so the same class of regression can't
    // silently reappear on a future edit.
    //
    // Locate the ComposeBox canSend prop specifically (not any other
    // canSend reference elsewhere in the file); assert the full widened
    // predicate is present.
    expect(pvSrc).toMatch(
      /canSend=\{[\s\S]*?status === "streaming"[\s\S]*?renderedState === "dormant"[\s\S]*?renderedState === "active"[\s\S]*?\}/
    );
    // Deliberately NOT included: `status === "error"` / `renderedState === "error"`.
    // An errored WS should not accept new sends until it recovers — the
    // MOUNT gate keeps ComposeBox mounted for error states (bubbles
    // preserved) but Send stays disabled per patch #339.
    // (No negative-match assertion here — canSend may legally reference
    // "error" via unrelated identifiers in future edits; the positive
    // pattern above is the load-bearing invariant.)
  });

  it("Test G: onResetClicked no longer contains any client-side pane-state mutation (patch #381 anti-pattern DELETED)", () => {
    // Find the onResetClicked useCallback body and assert it contains no
    // setIsHolding, no captureFirstFrame, no setPaneState.
    const anchorIdx = pvSrc.indexOf("const onResetClicked = useCallback");
    expect(anchorIdx).toBeGreaterThan(0);
    // Body extends until the closing `}, [])` (mount-once useCallback).
    const bodyEnd = pvSrc.indexOf("}, [])", anchorIdx);
    expect(bodyEnd).toBeGreaterThan(anchorIdx);
    const body = pvSrc.slice(anchorIdx, bodyEnd);
    expect(body).not.toMatch(/setIsHolding\(/);
    expect(body).not.toMatch(/captureFirstFrame\(/);
    expect(body).not.toMatch(/setPaneState\(/);
  });

  it("Phase 53 Plan 03: PrettyView consumes useSessionIsRecycling from the working-store (NOT the retired session-recycling-store bridge)", () => {
    // (i) The retired call site is gone — no live open-paren call.
    // Tombstone comment may name the identifier but must not include `(`.
    expect(pvSrc).not.toMatch(/publishSessionRecycling\(/);
    // (ii) No live import from the retired store.
    expect(pvSrc).not.toMatch(/from ["']@\/state\/session-recycling-store["']/);
    // (iii) New hook consumed from the working-store.
    expect(pvSrc).toMatch(/useSessionIsRecycling/);
    // (iv) Overlay mount gate reads isRecycling (not renderedState === "holding").
    expect(pvSrc).toMatch(/\{isRecycling && <SessionHoldingOverlay/);
  });

  it("usePaneResolvingMachine.ts: reduced to trivial derivation (<60 LOC, zero React state/effect machinery)", () => {
    const loc = hookSrc.split("\n").length;
    expect(loc).toBeLessThan(60);
    expect(hookSrc).not.toMatch(/useState|useEffect|useRef|useCallback/);
    expect(hookSrc).not.toMatch(/setTimeout|setInterval|requestIdleCallback/);
  });

  it("resolve-phase.ts: pure reducer (zero imports)", () => {
    const importLines = resolveSrc.split("\n").filter((l) => /^import /.test(l));
    expect(importLines.length).toBe(0);
  });

  it("resolve-phase.ts: exports the new Phase-30 type surface (WsTransportState, PaneState, RenderedState)", () => {
    expect(resolveSrc).toMatch(/^export type WsTransportState/m);
    expect(resolveSrc).toMatch(/^export type PaneState/m);
    expect(resolveSrc).toMatch(/^export type RenderedState/m);
    expect(resolveSrc).toMatch(/^export function resolveRenderedState/m);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Test A: pane_state:active → no overlay (message view baseline)
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test A: pane_state:active → no overlay mounts", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("session + pane_state:active → no overlay, message view baseline", () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    act(() => { ws.onopen?.(); });
    // Session frame flips status to streaming; pane_state:active flips
    // renderedState off "resolving" into "active" (which mounts no
    // overlay).
    sendFrame(ws, { type: "session", sessionFile: "/tmp/x.jsonl" });
    sendFrame(ws, { type: "pane_state", state: "active" });
    // No overlay of any kind.
    expect(screen.queryByRole("status", { name: /Loading conversation/i })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Session recycling/i)).toBeNull();
    expect(screen.queryByText(/Session is asleep/i)).toBeNull();
    expect(screen.queryByText(/no active Claude session/i)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Test B: pane_state:holding → SessionHoldingOverlay
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test B: pane_state:holding → SessionHoldingOverlay mounts", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("session then pane_state:holding → SessionHoldingOverlay mounted", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    act(() => { ws.onopen?.(); });
    sendFrame(ws, { type: "session", sessionFile: "/tmp/x.jsonl" });
    sendFrame(ws, { type: "pane_state", state: "holding", reason: "id_reset" });
    // Phase 53 Plan 03 — SessionHoldingOverlay mount is now gated on the
    // backend-authoritative recycling axis (useSessionIsRecycling), not
    // pane_state:holding. Seed the working-store so the overlay mounts.
    await act(async () => {
      publishFleetStatusSessionState("1", {
        hostId: "1",
        tmuxSession: "s1",
        sessionId: "test-session",
        pid: 12345,
        status: "idle",
        backgroundTasks: [],
        updatedAt: Date.now(),
        lastMessageAt: null,
        aiTitle: null,
        dormant: false,
        recycling: true,
      });
    });
    // SessionHoldingOverlay carries the "Session recycling" copy per
    // patch #74's centered card. Look for the recycling status text.
    expect(screen.getByText(/Session recycling/i)).toBeTruthy();
    // No other terminal overlay simultaneously.
    expect(screen.queryByText(/Session is asleep/i)).toBeNull();
    expect(screen.queryByText(/no active Claude session/i)).toBeNull();
    // Clean up store for subsequent tests.
    act(() => { resetWorkingStore(); });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Test C: holding → active swap unmounts SessionHoldingOverlay
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test C: holding → active swap unmounts the overlay", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pane_state:holding then pane_state:active → SessionHoldingOverlay unmounts", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    act(() => { ws.onopen?.(); });
    sendFrame(ws, { type: "session", sessionFile: "/tmp/x.jsonl" });
    sendFrame(ws, { type: "pane_state", state: "holding", reason: "id_reset" });
    // Phase 53 Plan 03 — seed recycling:true to mount the overlay.
    await act(async () => {
      publishFleetStatusSessionState("1", {
        hostId: "1",
        tmuxSession: "s1",
        sessionId: "test-session",
        pid: 12345,
        status: "idle",
        backgroundTasks: [],
        updatedAt: Date.now(),
        lastMessageAt: null,
        aiTitle: null,
        dormant: false,
        recycling: true,
      });
    });
    expect(screen.getByText(/Session recycling/i)).toBeTruthy();

    // Backend emits pane_state:active (recycle completed OR
    // dormancy_cleared OR same_file_recovery — reason omitted for
    // simplicity, any active is a "swap back to normal" signal).
    sendFrame(ws, { type: "pane_state", state: "active" });
    // Phase 53 Plan 03 — follow-up publish with recycling:false to clear overlay.
    await act(async () => {
      publishFleetStatusSessionState("1", {
        hostId: "1",
        tmuxSession: "s1",
        sessionId: "test-session",
        pid: 12345,
        status: "idle",
        backgroundTasks: [],
        updatedAt: Date.now(),
        lastMessageAt: null,
        aiTitle: null,
        dormant: false,
        recycling: false,
      });
    });
    // SessionHoldingOverlay unmounts.
    expect(screen.queryByText(/Session recycling/i)).toBeNull();
    // Clean up store for subsequent tests.
    act(() => { resetWorkingStore(); });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Test D: no pane_state → PrettyViewLoadingOverlay
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test D: no pane_state received → resolving spinner", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fresh mount, no pane_state received → PrettyViewLoadingOverlay mounted after 400ms paint-delay (renderedState === 'resolving')", () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    // phase-30-restore-resolving-overlay-paint-delay (2026-08-10): the
    // spinner now sits behind a 400ms delay-arm useEffect at the caller
    // site. Sub-400ms resolves (typical warm re-entry) never mount the
    // overlay. Genuinely-slow resolves (this test's scenario — no
    // pane_state ever received) mount after the delay-arm fires.
    expect(screen.queryByRole("status", { name: /Loading conversation/i })).toBeNull();
    advance(400);
    expect(
      screen.getByRole("status", { name: /Loading conversation/i }),
    ).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 6 — Test E: WS ladder exhausted → PrettyViewErrorOverlay
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test E: WS ladder exhausted → PrettyViewErrorOverlay", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("WS retry ladder terminally exhausts (MAX_RECONNECT_ATTEMPTS=5) → PrettyViewErrorOverlay mounts", () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    // Exhaust the retry ladder: 5 closes with backoff windows (2/4/6/8/8s).
    const backoffs = [2000, 4000, 6000, 8000, 8000];
    for (const delay of backoffs) {
      const ws = getCurrentWs();
      fireClose(ws);
      advance(delay);
    }
    // 6th close hits the cap → wsTransportState = "failed-permanently".
    fireClose(getCurrentWs());
    // PrettyViewErrorOverlay carries role=alert with the "Connection
    // failed" name (per PrettyViewErrorOverlay.tsx alert semantic).
    const errorOverlay = screen.getByRole("alert", {
      name: /Connection failed/i,
    });
    expect(errorOverlay).toBeTruthy();
    // Resolving spinner gone.
    expect(
      screen.queryByRole("status", { name: /Loading conversation/i }),
    ).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP 7 — Test F: D-11 don't-flicker on transient WS drop
// ═════════════════════════════════════════════════════════════════════════════

describe("Phase 30 integration — Test F: D-11 don't-flicker (transient WS drop keeps last-known)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pane_state:holding then transient WS close → SessionHoldingOverlay stays mounted (D-11)", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws0 = getCurrentWs();
    act(() => { ws0.onopen?.(); });
    sendFrame(ws0, { type: "session", sessionFile: "/tmp/x.jsonl" });
    sendFrame(ws0, { type: "pane_state", state: "holding", reason: "id_reset" });
    // Phase 53 Plan 03 (B5 belt-and-suspenders fix) — SessionHoldingOverlay
    // mount is now gated on the backend-authoritative recycling axis
    // (useSessionIsRecycling), not pane_state:holding. Seed the working-store
    // so the overlay mounts, then verify it stays mounted through a WS drop.
    await act(async () => {
      publishFleetStatusSessionState("1", {
        hostId: "1",
        tmuxSession: "s1",
        sessionId: "test-session",
        pid: 12345,
        status: "idle",
        backgroundTasks: [],
        updatedAt: Date.now(),
        lastMessageAt: null,
        aiTitle: null,
        dormant: false,
        recycling: true,
      });
    });
    expect(screen.getByText(/Session recycling/i)).toBeTruthy();

    // Transient close — a single retry attempt. wsTransportState goes
    // to "opening" (status=error, reconnectAttempts=1). Under Phase 30
    // the resolveRenderedState reducer's D-11 branch keeps rendering
    // the last-known paneState="holding" instead of reverting to the
    // resolving spinner. Under Phase 53, the overlay stays because
    // the working-store recycling axis (isRecycling=true) is independent
    // of the WS transport state — the backend-authoritative signal
    // outlives the transient disconnect.
    fireClose(ws0);
    // Do NOT advance timers past the backoff — we're mid-drop, not
    // fully-retried. The overlay must stay mounted.
    expect(screen.getByText(/Session recycling/i)).toBeTruthy();
    // No spinner flicker.
    expect(
      screen.queryByRole("status", { name: /Loading conversation/i }),
    ).toBeNull();
    // Clean up store for subsequent tests.
    act(() => { resetWorkingStore(); });
  });
});
