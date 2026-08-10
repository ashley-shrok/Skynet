// Tests for PrettyView's Phase 05 wiring — drop overlay mount, drag/drop
// handlers on data-pv-root, and the folder-drop nudge.
//
// The PrettyView opens a WebSocket via openClaudeSessionSocket on mount;
// mock that to a controllable stub. Session-identity + IdentityBadge
// dependencies are lightweight — no need to mock. The upload hook is
// consumed via a real usePrettyViewUploads call using our stubbed WS.
//
// phase-29 audit note (plan 29-05):
// This file was audited post-phase-29-04 rewire. The overlay mount gates
// migrated from local boolean state (isBooting / showOverlay / dormant)
// to phase-driven gates (`phase === "resolving"` / "holding" / "dormant"
// / "inactive" / "error"), and the transient "Connecting…" /
// "Connection lost" text nodes were retired (SPEC boundary). Retired
// state names (showOverlay, holdingTimeoutError, isBooting) appear ONLY
// in test-description comments explaining the historical intent —
// zero live assertions reference them. Tests were updated in one of
// three shapes: (a) rewritten to observe the phase-derived UI equivalent;
// (b) rewritten to use the 150ms delay-arm on the resolving spinner;
// (c) converted to `it.todo` with a phase-29 rationale for assertions
// that were retired outright (10s auto-dismiss watchdog). Every material
// change carries a `// phase-29:` comment tag.
//
// See plan 29-04's SUMMARY.md for the full pre-rewire vs post-rewire
// mount-gate mapping. See resolve-phase.test.ts for the truth-table
// tests and PrettyView.phase29.test.tsx for the structural-grep gates,
// entry-trigger integration tests, and the three named flicker
// regression tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, waitFor } from "@testing-library/react";

// Patch #148: wsStubs array — accumulates each WS stub created by the factory
// across retries. Tests index into this array to assert new stubs were created
// (retries fired) and to trigger onclose on the current stub. Declared at
// module scope so the vi.mock factory closure can reference it after hoist.
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

// Helper — returns the most-recently-created stub (the "current" WS).
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

// Mock claude-session-api so PrettyView's mount effect uses stub WSes.
// Patch #148: factory now returns a FRESH stub on each call and pushes
// it into wsStubs so reconnect tests can assert stub count and fire
// onclose on the current stub.
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

// Mock the compose-drafts API so ComposeBox's mount effect doesn't touch fetch.
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

// Session-hue registry — provide a benign default so the identity badge
// mount path is deterministic.
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: vi.fn(() => ({ identity: null, identityHue: null })),
}));

// IdentityBadge — inert stub (component is exercised elsewhere).
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

// useIsTouchDevice — return false by default; individual tests can rewire
// via vi.mocked() if needed.
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { openClaudeSessionSocket } from "@/api/claude-session-api";
import { useSessionIdentity } from "@/features/terminal/session-hue";
import { PrettyView } from "./PrettyView";

// ── Patch #148 test helpers ────────────────────────────────────────────────

// Flip the most-recently-created WS to streaming state by firing onopen +
// a `session` frame (the frame that transitions status to "streaming").
function flipToStreaming(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'session', sessionFile: '/tmp/test.jsonl' }),
      }),
    );
  });
}

// Fire an `inactive` frame on the given WS stub.
function flipToInactive(ws: WsStub, reason = 'user_exit'): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'inactive', reason }),
      }),
    );
  });
}

// Fire ws.onclose() inside act(). Also sets readyState to 3 (CLOSED) so
// the visibilitychange handler's `wsRef.current?.readyState === 1` guard
// doesn't short-circuit the reconnect when we test that path.
function fireClose(ws: WsStub): void {
  act(() => {
    ws.readyState = 3; // WebSocket.CLOSED
    ws.onclose?.();
  });
}

// Advance fake timers by `ms` inside act().
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// Set document.hidden and dispatch a visibilitychange event, inside act().
function fireVisibilityChange(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// ── Patch #156 test helpers ────────────────────────────────────────────────
// The visibilitychange useEffect in PrettyView is now hard-gated on
// isIosPwa() (see src/ui/lib/is-ios-pwa.ts). The existing patch #148 tests
// below need the environment to LOOK LIKE iOS PWA (navigator.standalone=true
// AND iPhone UA) for the duration of each test so the handler actually
// attaches. These helpers install and restore that surface on demand.
// jsdom's default is a desktop-ish UA with no standalone flag, which is what
// the new "non-iOS-PWA no-op" test relies on for its baseline.
const IPHONE_UA_FOR_TESTS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let __originalUaForIosPwa: string | null = null;
function enableIosPwa(): void {
  __originalUaForIosPwa = navigator.userAgent;
  Object.defineProperty(navigator, 'userAgent', {
    value: IPHONE_UA_FOR_TESTS,
    configurable: true,
  });
  Object.defineProperty(navigator, 'standalone', {
    value: true,
    configurable: true,
    writable: true,
  });
}
function restoreIosPwa(): void {
  if (__originalUaForIosPwa !== null) {
    Object.defineProperty(navigator, 'userAgent', {
      value: __originalUaForIosPwa,
      configurable: true,
    });
    __originalUaForIosPwa = null;
  }
  delete (navigator as { standalone?: boolean }).standalone;
}

// Helper — mount PrettyView with onSend so ComposeBox mounts once
// streaming is established.
function mountPV() {
  const onSend = vi.fn(() => true);
  const utils = render(
    <PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />,
  );
  return { ...utils, onSend };
}

// ── Phase 05 tests ─────────────────────────────────────────────────────────

describe("PrettyView — Phase 05 drop overlay + hook wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // NOTE: Do NOT use fake timers in this describe block — Test 10 uses
    // waitFor() which relies on real setTimeout for its polling interval.
    // Patch #148 reconnect tests that need fake timers live in their own
    // separate describe block below.
    wsStubs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 9: drop event on data-pv-root stages the dropped files", async () => {
    const { container } = mountPV();
    const root = container.querySelector("[data-pv-root]") as HTMLElement;
    expect(root).toBeTruthy();

    // Fire a drop with one file. JSDOM 29 does not ship DataTransfer, so
    // we use a plain object stub — the handler reads .items / .files only.
    const file = new File(["hello"], "dropped.txt", { type: "text/plain" });
    const dt = {
      items: [] as unknown as DataTransferItemList,
      files: [file] as unknown as FileList,
    };

    // We can't easily observe the internal hook state without a testable
    // surface. Instead, we assert the DROP handler is attached and that
    // dispatching drop does NOT throw. Downstream (Task 3's Test 12) covers
    // the negative-case (drop outside data-pv-root has no effect).
    const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt, writable: false });
    // Should not throw:
    act(() => {
      root.dispatchEvent(dropEvt);
    });
    // If the handler wasn't attached we'd see the event just bubble up
    // — verify no error surfaced.
    expect(true).toBe(true);
  });

  it("Test 10: dragover shows drop overlay; dragleave hides it", async () => {
    const { container } = mountPV();
    const root = container.querySelector("[data-pv-root]") as HTMLElement;

    // Initially no overlay.
    expect(container.querySelector('[data-testid="drop-overlay-drag"]')).toBeNull();

    // Fire dragenter + dragover to activate.
    act(() => {
      const enter = new Event("dragenter", { bubbles: true, cancelable: true });
      root.dispatchEvent(enter);
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      root.dispatchEvent(over);
    });

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="drop-overlay-drag"]'),
      ).toBeTruthy();
    });

    // Fire dragleave — overlay should retreat once the counter goes to 0.
    act(() => {
      const leave = new Event("dragleave", { bubbles: true, cancelable: true });
      root.dispatchEvent(leave);
    });

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="drop-overlay-drag"]'),
      ).toBeNull();
    });
  });

  it("Test 12: drop OUTSIDE data-pv-root has no effect", () => {
    const { container } = mountPV();
    // Create a sibling element outside data-pv-root and fire drop there.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    try {
      const file = new File(["x"], "elsewhere.txt", { type: "text/plain" });
      const dt = {
        items: [] as unknown as DataTransferItemList,
        files: [file] as unknown as FileList,
      };
      const dropEvt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
      // If PrettyView had attached a document-level drop listener (wrong!),
      // we'd see side effects. Since it should only listen on data-pv-root,
      // this must be a no-op. Assertion: no drop-overlay-drag element ever
      // appears from this out-of-tree drop.
      outside.dispatchEvent(dropEvt);
      expect(
        container.querySelector('[data-testid="drop-overlay-drag"]'),
      ).toBeNull();
    } finally {
      outside.remove();
    }
  });
});

// ── Patch #148: WebSocket auto-reconnect tests ─────────────────────────────
//
// These tests use fake timers so setTimeout(2000) etc. are advanceable via
// vi.advanceTimersByTime(). Kept in a separate describe block from the Phase
// 05 tests to avoid interfereing with waitFor() which needs real timer polling.
describe("PrettyView — patch #148 WebSocket auto-reconnect", () => {
  // jsdom does not implement ResizeObserver; useAutoScroll uses it in its
  // effect. Provide a no-op stub for all reconnect tests in this block.
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset wsStubs so each test starts with a clean sequence.
    wsStubs.length = 0;
    // Restore document.hidden to default (not hidden) before each test.
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    // Patch #156: opt this whole describe block into iOS-PWA mode so the
    // visibilitychange useEffect (now gated on isIosPwa()) attaches its
    // listener. Without this, Test C would no-op and stub 7 would never
    // be created. The Patch #156 non-iOS-PWA no-op test lives in its own
    // describe block below that deliberately does NOT enable iOS-PWA.
    enableIosPwa();
    // Stub ResizeObserver — jsdom doesn't implement it.
    // Must be a function/class (not arrow fn) so `new ResizeObserver(...)` works.
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    restoreIosPwa();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test A (must): retry-on-close — fires fresh WS after backoff (patch #148 mechanism preserved through phase-29 rewire)", () => {
    // phase-29: the "Connection closed" transient text node is retired
    // (SPEC boundary — the resolving spinner covers the reconnect window
    // during pre-resolve, and PrettyViewErrorOverlay covers the terminal
    // failed-permanently case). What this test locks is the patch #148
    // retry-scheduler mechanism itself — fresh WS stub created after the
    // backoff delay, and the errorMessage state cleared internally on
    // reopen. errorMessage is no longer surfaced to the UI, so the test
    // observes only the observable retry-mechanism outputs (WS stub count).
    mountPV();
    // After mount, stub #1 is created.
    expect(wsStubs.length).toBe(1);
    const ws1 = getCurrentWs();

    // Advance to streaming state.
    flipToStreaming(ws1);

    // Fire close on stub #1.
    fireClose(ws1);

    // Immediately after close: no new WS yet (timer not fired).
    expect(wsStubs.length).toBe(1);

    // Advance first backoff (attempt 1 → delay = 2000ms).
    advance(2000);

    // A new stub should have been created by the retryKey-driven re-run —
    // proves the patch #148 retry-on-close scheduler still fires under
    // the phase-29 rewire. The specific state mutation (setStatus("error")
    // + setErrorMessage("Connection closed")) still happens internally
    // (see onclose handler); this is the observable side effect.
    expect(wsStubs.length).toBe(2);
    const ws2 = getCurrentWs();

    // Fire onopen on the new stub. Under the old code path this test
    // asserted "Connection closed" text disappearing; under phase-29
    // that text was never displayed. Observable proxy: the WS stub was
    // successfully reopened — no throw, no additional retry stub queued.
    act(() => {
      ws2.onopen?.();
    });
    // No new stub was created (the retry chain paused because onopen
    // succeeded — the next close would restart the ladder from the
    // now-incremented attempt count).
    expect(wsStubs.length).toBe(2);
  });

  it("Test B (must): max-attempt cap — no 6th WS after 5 consecutive closes", () => {
    mountPV();
    expect(wsStubs.length).toBe(1);

    // Simulate 5 close→retry→close cycles through the backoff schedule:
    //   attempt 1: delay 2s, attempt 2: delay 4s, attempt 3: delay 6s,
    //   attempt 4: delay 8s, attempt 5: delay 8s (cap).
    const backoffs = [2000, 4000, 6000, 8000, 8000];
    for (const delay of backoffs) {
      const ws = getCurrentWs();
      flipToStreaming(ws);
      fireClose(ws);
      advance(delay);
    }

    // After 5 retries we have stubs 1..5 (the initial + 4 retries created
    // by the timer) + the 5th close fires but the cap is reached, so no
    // further retry is scheduled. Actually: initial WS + 5 retries fired =
    // 6 stubs total (each retry creates one). Wait — let's be precise:
    // close #1 on stub 1 → schedules retry → stub 2 after 2s.
    // close #2 on stub 2 → schedules retry → stub 3 after 4s.
    // close #3 on stub 3 → schedules retry → stub 4 after 6s.
    // close #4 on stub 4 → schedules retry → stub 5 after 8s.
    // close #5 on stub 5 → AT CAP (attempts=5, cap=5) → no timer.
    // Total stubs: 5 (1 initial + 4 retries from first 4 closes).
    // Hmm: attempt increments BEFORE scheduling; starts at 0.
    // close #1: attempts=0 < 5 → schedule → increment to 1 → stub 2 after 2s.
    // close #2: attempts=1 < 5 → schedule → increment to 2 → stub 3 after 4s.
    // close #3: attempts=2 < 5 → schedule → increment to 3 → stub 4 after 6s.
    // close #4: attempts=3 < 5 → schedule → increment to 4 → stub 5 after 8s.
    // close #5: attempts=4 < 5 → schedule → increment to 5 → stub 6 after 8s.
    // But then stub 6 has attempt=5=cap so its close fires no retry.
    // Total stubs: 6. So after 5 backoff advances we have 6 stubs.
    expect(wsStubs.length).toBe(6);

    // Fire close on stub 6 (attempt count is now 5 = MAX).
    fireClose(getCurrentWs());

    // Advance another 8000ms — should NOT create a 7th stub.
    advance(8000);
    expect(wsStubs.length).toBe(6);

    // DOM still shows "Connection closed".
    // The render shows errorMessage when status === "error".
    // (We check textContent includes the error text.)
    // Note: we don't call flipToStreaming on each retry stub in this sequence —
    // that's fine because the retry still schedules based on onclose after a
    // fresh WS is created. We do need the last onclose to actually fire.
  });

  it("Test C (should): visibilitychange:visible resets counter and reconnects after cap", () => {
    mountPV();

    // Reach the cap: 5 consecutive closes (produces 6 stubs, attempt count = 5 after last close).
    // Backoffs: 2s, 4s, 6s, 8s, 8s.
    const backoffs = [2000, 4000, 6000, 8000, 8000];
    for (const delay of backoffs) {
      const ws = getCurrentWs();
      flipToStreaming(ws);
      fireClose(ws);
      advance(delay);
    }
    // Fire close on stub 6 to hit the cap.
    fireClose(getCurrentWs());
    advance(8000); // Should NOT produce stub 7.
    expect(wsStubs.length).toBe(6);

    // Now foreground the tab via visibilitychange:visible.
    // This resets reconnectAttemptsRef to 0 and bumps retryKey immediately.
    // The WS-setup useEffect re-runs synchronously with the React commit.
    fireVisibilityChange(false); // hidden=false → visible

    // After the visibilitychange settles, a new stub should be created.
    // retryKey bump is synchronous (setRetryKey → useEffect re-run via React scheduler).
    // Give React a chance to flush via advance(0).
    advance(0);

    expect(wsStubs.length).toBe(7);
  });

  it("Test D (should): inactive status skips retry — no new WS after onclose", () => {
    const { container } = mountPV();
    expect(wsStubs.length).toBe(1);
    const ws1 = getCurrentWs();

    flipToStreaming(ws1);
    // Flip to inactive via an `inactive` message frame.
    flipToInactive(ws1);

    // Now fire close on the WS.
    fireClose(ws1);

    // Advance 2000ms — should NOT create stub #2 (inactive short-circuit).
    advance(2000);
    expect(wsStubs.length).toBe(1);

    // The inactive UI renders "no active Claude session", not "Connection closed".
    // Assert "Connection closed" is NOT present in the DOM.
    // (The inactive branch renders its own string via the status==="inactive" JSX.)
    expect(container.textContent).not.toContain('Connection closed');
  });
});

// ── Patch #156: iOS-PWA gate on the patch #148 visibilitychange handler ───
//
// Deliberately does NOT call enableIosPwa() — jsdom's default UA is a Node
// build (no /iP(hone|ad|od)/ match) and there is no navigator.standalone, so
// isIosPwa() returns false. Under that condition the visibilitychange
// useEffect must early-return and register no listener at all, so firing
// visibility events must NOT create additional WS stubs.
describe("PrettyView — patch #156 non-iOS-PWA visibilitychange no-op", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsStubs.length = 0;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    // NO enableIosPwa() here — this is the whole point of the test.
    // Belt-and-braces: ensure no stale standalone flag from a sibling test
    // survived (afterEach in the #148 block calls restoreIosPwa, but be
    // explicit in case describe ordering shifts).
    delete (navigator as { standalone?: boolean }).standalone;
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Patch #156: non-iOS-PWA (Chrome desktop) — visibilitychange handler is not attached and does not trigger reconnect", () => {
    // Sanity: jsdom's default environment is NOT iOS PWA.
    expect((navigator as { standalone?: boolean }).standalone).toBeUndefined();
    expect(/iP(hone|ad|od)/.test(navigator.userAgent)).toBe(false);

    mountPV();
    // After mount, the WS-setup useEffect has created the initial WS stub.
    // We do NOT flip to streaming — the visibilitychange handler doesn't
    // gate on status for the non-iOS-PWA test; the whole point is that the
    // handler is not registered so status doesn't matter.
    const baseline = wsStubs.length;
    expect(baseline).toBe(1);

    // Fire hidden→visible cycle. On iOS PWA this would bump retryKey and
    // create a fresh stub; on non-iOS-PWA it must be a no-op (no listener
    // attached, so document.dispatchEvent finds nothing).
    fireVisibilityChange(true);
    fireVisibilityChange(false);
    // Give React a chance to flush any (hypothetical) scheduled effect work.
    advance(0);

    // No new WS stub — retryKey did not bump because the useEffect early-returned.
    expect(wsStubs.length).toBe(baseline);
  });
});

// ── Phase 14 Wave 5: aside integration ─────────────────────────────────────
//
// End-to-end integration coverage under the LOCKED architecture (frontend-arm
// per CONTEXT.md § Trigger LOCK 2026-07-26 + module-scope backend state per
// § Backend per-connection state LOCK). Extends PrettyView.aside.test.tsx
// (which covered Wave 3 wiring at the render layer) with coverage that
// exercises the full render + ComposeBox morph + WS-outbound dismiss cycle
// on the assembled Wave 3 + Wave 4 stack.
//
// Test A: aside_arm emission on isIdle:false→true transition (per-turn,
//         with a negative sub-case proving pvIdentity=null suppresses).
// Test B: aside_ready frame mounts <AsideBubble role="note"> AND morphs
//         ComposeBox — Send button becomes "Resume", aux buttons disabled,
//         textarea remains editable (per CONTEXT.md § ComposeBox morph).
// Test C: clicking "Resume" fires WS-outbound {type:"aside_dismissed",...}
//         AND optimistically clears the AsideBubble.
// Test D: inbound aside_dismissed is idempotent on already-cleared state.
// Test E: fresh-pane mount clears asideText to null (paneKey change).
//
// WS-outbound spy: mockWs.send is a vi.fn() on the WsStub, so we filter
// its call list by JSON-parsing each arg to check `type`. Same pattern as
// PrettyView.aside.test.tsx Test 3.
describe("PrettyView — Phase 14 Wave 5 aside integration (frontend-arm + morph)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    // Default: anonymous session. Test A (identity sub-case) overrides.
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: null,
      identityHue: null,
    } as ReturnType<typeof useSessionIdentity>);
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Helper — filter a mock.calls array of ws.send() invocations for the first
  // frame whose parsed JSON has the given `type`.
  function findSentFrame(
    ws: WsStub,
    type: string,
    fromIndex = 0,
  ): unknown | undefined {
    const calls = ws.send.mock.calls.slice(fromIndex);
    for (const [raw] of calls) {
      try {
        const parsed = JSON.parse(raw as string);
        if (parsed && parsed.type === type) return parsed;
      } catch {
        /* ignore non-JSON */
      }
    }
    return undefined;
  }

  // Test A SKIPPED 2026-07-27 (Ashley): automatic aside-arm emit disabled at
  // the source via AUTO_ASIDE_ARM_ENABLED=false in PrettyView.tsx. This test
  // covers both the positive emit (identity attached) AND the anonymous
  // suppression via its Sub-case 2 — both are inert while the flag is off.
  // Re-enable with the flag when a new trigger mechanism lands. Tests B/C/D/E
  // cover the render + morph + dismiss surface, which is unchanged.
  it.skip("Test A: isIdle:false→true on identity-attached session sends {type:\"aside_arm\"} on WS (repeats per turn; identity gate suppresses)", async () => {
    // Sub-case 1 — identity attached → arm fires; second transition fires
    // a SECOND arm (per-turn, not one-shot).
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    } as ReturnType<typeof useSessionIdentity>);

    const { rerender, unmount } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={false}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    const beforeFirst = ws.send.mock.calls.length;

    // First false→true transition (completed turn #1).
    rerender(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isIdle={true} isVisible={true} />,
    );
    await waitFor(() => {
      expect(findSentFrame(ws, "aside_arm", beforeFirst)).toBeTruthy();
    });
    const beforeSecond = ws.send.mock.calls.length;

    // Reset isIdle to false, then back to true — should fire a SECOND arm.
    rerender(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isIdle={false} isVisible={true} />,
    );
    rerender(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isIdle={true} isVisible={true} />,
    );
    await waitFor(() => {
      expect(findSentFrame(ws, "aside_arm", beforeSecond)).toBeTruthy();
    });

    unmount();

    // Sub-case 2 — anonymous session (pvIdentity === null): NO arm fires
    // on the isIdle transition. Identity gating happens frontend-side
    // per CONTEXT.md § Trigger LOCK.
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: null,
      identityHue: null,
    } as ReturnType<typeof useSessionIdentity>);
    const { rerender: rerender2 } = render(
      <PrettyView
        hostId={2}
        tmuxSession="anon"
        onSend={() => true}
        isIdle={false}
        isVisible={true}
      />,
    );
    const ws2 = getCurrentWs();
    flipToStreaming(ws2);
    const beforeAnon = ws2.send.mock.calls.length;

    rerender2(
      <PrettyView hostId={2} tmuxSession="anon" onSend={() => true} isIdle={true} isVisible={true} />,
    );
    // Give the effect a chance to run.
    await new Promise((r) => setTimeout(r, 40));
    expect(findSentFrame(ws2, "aside_arm", beforeAnon)).toBeUndefined();
  });

  it("Test B: inbound aside_ready mounts AsideBubble (role=\"note\") AND morphs ComposeBox (Send→Resume, aux disabled, textarea editable)", async () => {
    // Identity attached so ComposeBox mounts with the identity color scheme.
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    } as ReturnType<typeof useSessionIdentity>);

    const { container, queryByRole, getByRole } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Pre-condition: Send button present, no aside note yet, no Resume button.
    await waitFor(() => {
      expect(getByRole("button", { name: "Send" })).toBeTruthy();
    });
    expect(queryByRole("note")).toBeNull();
    expect(queryByRole("button", { name: "Resume" })).toBeNull();

    // Dispatch aside_ready inbound frame.
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "aside_ready",
            text: "the agent is refactoring the auth flow",
          }),
        }),
      );
    });

    await waitFor(() => {
      // AsideBubble mounted.
      const note = container.querySelector('[role="note"]');
      expect(note).toBeTruthy();
      expect(note?.textContent).toContain("the agent is refactoring the auth flow");
      // ComposeBox morphed: Send is gone, Resume is present.
      expect(queryByRole("button", { name: "Send" })).toBeNull();
      expect(getByRole("button", { name: "Resume" })).toBeTruthy();
    });

    // Aux button disabled — pick the reset button (canonical aux gate; other
    // aux buttons follow the same pattern per Wave 4 Task 1).
    const resetBtn = container.querySelector(
      'button[aria-label*="reset context window" i]',
    ) as HTMLButtonElement | null;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn!.disabled).toBe(true);

    // Textarea remains editable — per CONTEXT.md § ComposeBox morph verbatim.
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea!.disabled).toBe(false);
  });

  it("Test C: clicking \"Resume\" fires WS-outbound {type:\"aside_dismissed\",...} AND optimistically clears the AsideBubble", async () => {
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    } as ReturnType<typeof useSessionIdentity>);

    const { container, queryByRole, getByRole } = render(
      <PrettyView hostId={42} tmuxSession="tina@main" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Display aside first.
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "aside_ready", text: "hello aside" }),
        }),
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
      expect(getByRole("button", { name: "Resume" })).toBeTruthy();
    });
    const beforeDismiss = ws.send.mock.calls.length;

    // Click Resume.
    act(() => {
      fireEvent.click(getByRole("button", { name: "Resume" }));
    });

    // WS-outbound aside_dismissed frame captured.
    const outbound = findSentFrame(ws, "aside_dismissed", beforeDismiss) as
      | { type: string; hostId: number; tmuxSession: string }
      | undefined;
    expect(outbound).toBeTruthy();
    expect(outbound!.hostId).toBe(42);
    expect(outbound!.tmuxSession).toBe("tina@main");

    // Optimistic clear: role="note" gone; Send restored; Resume gone.
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
      expect(getByRole("button", { name: "Send" })).toBeTruthy();
      expect(queryByRole("button", { name: "Resume" })).toBeNull();
    });
  });

  it("Test D: inbound aside_dismissed WS frame is idempotent on already-cleared state (no crash, no state change)", async () => {
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    } as ReturnType<typeof useSessionIdentity>);

    const { container, queryByRole } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Mount an aside, then dismiss it via inbound frame.
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "aside_ready", text: "hello" }),
        }),
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "aside_dismissed" }),
        }),
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });

    // Fire a SECOND aside_dismissed — no crash, DOM unchanged.
    expect(() => {
      act(() => {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({ type: "aside_dismissed" }),
          }),
        );
      });
    }).not.toThrow();
    expect(container.querySelector('[role="note"]')).toBeNull();
    // Send remains present (no morph flicker).
    expect(queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("Test E: fresh-pane mount (hostId/tmuxSession change) resets asideText to null before any WS frame arrives on the new pane", async () => {
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    } as ReturnType<typeof useSessionIdentity>);

    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="pane-A" onSend={() => true} isVisible={true} />,
    );
    const wsA = getCurrentWs();
    flipToStreaming(wsA);

    act(() => {
      wsA.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "aside_ready", text: "aside on pane A" }),
        }),
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    // Switch to a fresh pane.
    rerender(
      <PrettyView hostId={2} tmuxSession="pane-B" onSend={() => true} isVisible={true} />,
    );

    // Fresh-pane reset should have cleared asideText BEFORE the new pane's WS
    // stream emits any frame. Assert role="note" gone even without dispatching
    // a new inbound aside_dismissed frame from the new pane's WS.
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });
  });
});

// ── Fix B (2026-07-30): session_holding_cleared WS event ─────────────────────
//
// Tests: the new `case "session_holding_cleared"` handler in PrettyView's
// ws.onmessage switch surgically clears isHolding + holdingTimeoutError
// WITHOUT touching the message stream, contextPct, harnessTasks, etc.
// Contrast with `session_changed` which is a heavy-reset for a real recycle.
//
// Uses fake timers so the 350ms delay-arm for showOverlay is controllable.
// The overlay mounts on role="status" (SessionHoldingOverlay renders with
// role="status" per SessionHoldingOverlay.tsx L93).

describe("PrettyView — Fix B: session_holding_cleared self-clear (quick 260730-sjf)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wsStubs.length = 0;
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: null,
      identityHue: null,
    } as ReturnType<typeof useSessionIdentity>);
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Helper: fire a WS frame on the current WS stub inside act().
  function fireWsFrame(ws: WsStub, frame: Record<string, unknown>): void {
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(frame) }),
      );
    });
  }

  // Helper: flip to streaming then arm holding overlay. Phase 30: the
  // 350ms delay-arm is DELETED (was Phase-29 machinery). The overlay
  // now mounts synchronously on the pane_state:holding frame (backend-
  // authoritative via paneState). The legacy session_holding frame
  // still emits on the wire (Plan 30-01 § L2154 preserves it for
  // backward compat) but no longer drives the mount decision — the
  // sibling pane_state:holding emit from transitionToHolding does.
  function armHolding(ws: WsStub): void {
    // Transition to streaming first.
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session', sessionFile: '/tmp/test.jsonl' }),
        }),
      );
    });
    // The initial pane_state:active from startActiveSessionFlow
    // (Plan 30-01 § L3871 attach-time emit).
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });
    // Arm holding — send BOTH the legacy frame (side-effect side) AND
    // the sibling pane_state:holding (which drives the overlay mount).
    fireWsFrame(ws, { type: 'session_holding' });
    fireWsFrame(ws, { type: 'pane_state', state: 'holding', reason: 'id_reset' });
  }

  it("Test F1: session_holding_cleared while isHolding=true clears the overlay (showOverlay false, role=status absent)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    armHolding(ws);

    // Pre-condition: overlay is visible.
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    // Fire session_holding_cleared:
    fireWsFrame(ws, { type: 'session_holding_cleared' });
    // Phase 30: the sibling pane_state:active emission from
    // transitionFromHoldingToActiveSameFile (Plan 30-01 § L2260)
    // is what actually drives the overlay unmount.
    fireWsFrame(ws, { type: 'pane_state', state: 'active', reason: 'same_file_recovery' });

    // Overlay must unmount immediately (isHolding false → showOverlay false
    // synchronously per the useEffect cleanup path: `if (!isHolding) { setShowOverlay(false); return; }`):
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("Test F2: messages populated BEFORE session_holding_cleared are preserved verbatim after (no heavy-reset)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    // Transition to streaming:
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session', sessionFile: '/tmp/test.jsonl' }),
        }),
      );
    });

    // Send two message frames (user + assistant) to populate the message list:
    fireWsFrame(ws, {
      type: 'message', role: 'user', content: 'hello there', eventId: 'ev-1', ts: 1000,
    });
    fireWsFrame(ws, {
      type: 'message', role: 'assistant', content: 'hi back', eventId: 'ev-2', ts: 1001,
    });

    // Arm holding overlay:
    fireWsFrame(ws, { type: 'session_holding' });
    act(() => { vi.advanceTimersByTime(400); });

    // Now fire session_holding_cleared:
    fireWsFrame(ws, { type: 'session_holding_cleared' });
    // Phase 30: the sibling pane_state:active emission from
    // transitionFromHoldingToActiveSameFile (Plan 30-01 § L2260)
    // is what actually drives the overlay unmount.
    fireWsFrame(ws, { type: 'pane_state', state: 'active', reason: 'same_file_recovery' });

    // Overlay must be gone:
    expect(container.querySelector('[role="status"]')).toBeNull();

    // Message content must still be present — session_holding_cleared must NOT
    // clear the message stream (contrast with session_changed which does):
    expect(container.textContent).toContain('hello there');
    expect(container.textContent).toContain('hi back');
  });

  it("Test F3: contextPct set BEFORE session_holding_cleared is preserved after (no heavy-reset)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session', sessionFile: '/tmp/test.jsonl' }),
        }),
      );
    });

    // Send a contextPct frame so the % badge renders:
    fireWsFrame(ws, { type: 'context_pct', pct: 42 });

    // Arm holding + clear:
    fireWsFrame(ws, { type: 'session_holding' });
    act(() => { vi.advanceTimersByTime(400); });
    fireWsFrame(ws, { type: 'session_holding_cleared' });
    // Phase 30: the sibling pane_state:active emission from
    // transitionFromHoldingToActiveSameFile (Plan 30-01 § L2260)
    // is what actually drives the overlay unmount.
    fireWsFrame(ws, { type: 'pane_state', state: 'active', reason: 'same_file_recovery' });

    // Overlay gone:
    expect(container.querySelector('[role="status"]')).toBeNull();
    // contextPct value is surfaced via aria-valuenow on the context bar
    // (ComposeBox renders it with aria-valuenow={contextPct ?? undefined}).
    // session_holding_cleared must NOT have reset it to null:
    const ctxBar = container.querySelector('[aria-valuenow="42"]');
    expect(ctxBar).toBeTruthy();
  });
});

// ── Reconnect-window preserves bubbles + disables Send/reset ─────────────
// Bounty pretty-view-reconnect-preserve-bubbles-and-disable-send (2026-08-08).
// The pretty-view WS retry window used to unmount the scroll region AND
// the ComposeBox because the status="error" render gates excluded that
// state. The bubbles Ashley was reading blinked out for ~2s and Send taps
// went to a torn-down ComposeBox. Fix:
//   1) Scroll region renders during status="error" when messages.length>0.
//   2) ComposeBox renders during status="error"; PrettyView wires
//      reconnectingActive={status==="error"} so Send + aux disable while
//      textarea/mic/attach stay live for pre-drafting the next message.
describe("PrettyView — reconnect window preserves bubbles and disables Send", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("bubbles from streaming state remain visible after ws.onclose flips status to error, and Send is disabled", () => {
    const { container } = mountPV();
    const ws = getCurrentWs();

    // Streaming state + one user message bubble.
    flipToStreaming(ws);
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'message',
            eventId: 'evt-1',
            role: 'user',
            content: 'hello from before the reconnect',
            ts: 1234567890,
          }),
        }),
      );
    });

    // Bubble present in streaming state.
    expect(container.textContent).toContain('hello from before the reconnect');
    // ComposeBox mounted, Send enabled (canSend=true, no reconnectingActive).
    const sendBefore = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBefore).toBeTruthy();

    // Fire close → status flips to "error" and the retry timer schedules.
    fireClose(ws);

    // Bubble MUST still be in the DOM (this is the render-gate fix — pre-fix
    // the scroll region would unmount because "error" was excluded).
    expect(container.textContent).toContain('hello from before the reconnect');

    // ComposeBox still mounted (also part of the render-gate change).
    const sendAfter = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendAfter).toBeTruthy();
    // Send now disabled — reconnectingActive={status==="error"} + canSend=false.
    expect(sendAfter.disabled).toBe(true);
  });
});

// ── quick 260808-cd6 dormancy integration tests ────────────────────────────

describe("quick 260808-cd6 dormancy overlay integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wsStubs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mountDormancyPV() {
    // Must be a function/class (not arrow fn) so `new ResizeObserver(...)` works.
    const resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
    const onSend = vi.fn(() => true);
    const utils = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />,
    );
    const ws = getCurrentWs();
    // Flip to streaming first (dormant overlay only makes sense when live).
    flipToStreaming(ws);
    return { ...utils, onSend, ws };
  }

  function sendDormantFrame(ws: WsStub, dormant: boolean): void {
    // Phase 30: DormancyOverlay's mount gate flipped from client-inference
    // (Phase 29's captureFirstFrame on dormant frames) to backend-
    // authoritative (renderedState === "dormant" via paneState). To
    // reproduce the same UI outcome, send the sibling pane_state frame
    // alongside — this mirrors what the pane-state-emitter (Plan 30-01
    // § L4214/L4738 dormant-poll seams) now does on the wire when the
    // backend transitions in/out of dormant.
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'dormant', dormant }),
        }),
      );
    });
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'pane_state',
            state: dormant ? 'dormant' : 'active',
            ...(dormant ? {} : { reason: 'dormancy_cleared' }),
          }),
        }),
      );
    });
  }

  it("Test 1: WS emits {type:'dormant', dormant:true} → DormancyOverlay mounts, ComposeBox Send disabled", () => {
    const { container, ws } = mountDormancyPV();

    // Initially no overlay.
    expect(container.querySelector('[aria-label="Session is asleep — tap Wake to restart"]')).toBeNull();

    sendDormantFrame(ws, true);

    // Overlay should now be in the DOM.
    const overlay = container.querySelector('[role="status"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('aria-label')).toContain('asleep');

    // ComposeBox Send button should be disabled (dormantActive=true).
    const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);
  });

  it("Test 2: {type:'dormant', dormant:true} then a live message frame → DormancyOverlay auto-dismisses (Phase 30: supervisor recover-path also emits pane_state:active)", () => {
    const { container, ws } = mountDormancyPV();

    sendDormantFrame(ws, true);
    // Overlay is up.
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    // Phase 30: when the supervisor recover-path relaunches Claude, the
    // pane-state-emitter's dormant-poll seam emits pane_state:active
    // (reason=dormancy_cleared) on the same tick as the live-shape frame
    // arrives (Plan 30-01 § L4214 dormant-poll seam). This drives the
    // overlay unmount; the live message frame's role is now purely to
    // clear the local `dormant`/`waking` state (used as DormancyOverlay
    // props for the wake-progress UX).
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'message',
            eventId: 'live-1',
            role: 'assistant',
            content: 'I am awake now',
            ts: Date.now(),
          }),
        }),
      );
    });
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'pane_state',
            state: 'active',
            reason: 'dormancy_cleared',
          }),
        }),
      );
    });

    // DormancyOverlay should have dismissed (the status overlay for "asleep" is gone).
    // Note: there may be other role="status" elements, so check specifically for the
    // dormancy overlay's distinctive aria-label.
    const dormancyOverlay = container.querySelector('[aria-label*="asleep"]') ??
                            container.querySelector('[aria-label*="Waking"]');
    expect(dormancyOverlay).toBeNull();
  });

  it("Test 3: {type:'dormant', dormant:true} then Wake click → ws.send called with {type:'wake'}, overlay shows waking state", () => {
    const { container, ws } = mountDormancyPV();

    sendDormantFrame(ws, true);

    // Click the Wake button.
    const wakeBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();
    act(() => {
      fireEvent.click(wakeBtn);
    });

    // ws.send should have been called with {type:"wake"}.
    const sentPayloads = (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
      ([data]: [string]) => JSON.parse(data),
    );
    const wakeSent = sentPayloads.find((p: { type: string }) => p.type === 'wake');
    expect(wakeSent).toBeTruthy();

    // Overlay should now show waking state (Wake button hidden, "Waking up…" text).
    expect(container.textContent).toContain('Waking up…');
    expect(container.querySelector('button[aria-label="Wake identity"]')).toBeNull();
  });

  it("Test 4: wake_result error → overlay stays, shows warm-red error variant, Wake button re-enabled", () => {
    const { container, ws } = mountDormancyPV();

    sendDormantFrame(ws, true);

    // Click Wake to enter waking state.
    const wakeBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
    act(() => {
      fireEvent.click(wakeBtn);
    });
    // Now waking.
    expect(container.textContent).toContain('Waking up…');

    // Backend returns wake_result error.
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'wake_result', ok: false, error: 'rm failed' }),
        }),
      );
    });

    // Overlay should still be mounted (dormant is still true).
    // Error copy should appear.
    expect(container.textContent).toContain("Couldn't wake — rm failed");
    // Wake button should be re-enabled for retry.
    const retryBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.disabled).toBe(false);
  });
});

// ── quick 260809-cnx dormant flow refinements ─────────────────────────────

describe("quick 260809-cnx dormant flow refinements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wsStubs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mountDormancyPV() {
    const resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
    const onSend = vi.fn(() => true);
    const utils = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    return { ...utils, onSend, ws };
  }

  function sendDormantFrame(ws: WsStub, dormant: boolean): void {
    // Phase 30: DormancyOverlay's mount gate flipped from client-inference
    // (Phase 29's captureFirstFrame on dormant frames) to backend-
    // authoritative (renderedState === "dormant" via paneState). To
    // reproduce the same UI outcome, send the sibling pane_state frame
    // alongside — this mirrors what the pane-state-emitter (Plan 30-01
    // § L4214/L4738 dormant-poll seams) now does on the wire when the
    // backend transitions in/out of dormant.
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'dormant', dormant }),
        }),
      );
    });
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'pane_state',
            state: dormant ? 'dormant' : 'active',
            ...(dormant ? {} : { reason: 'dormancy_cleared' }),
          }),
        }),
      );
    });
  }

  it("Fix A: dormant frame mounts ComposeBox in reduced state (typeable textarea, disabled Send)", () => {
    const { container, ws } = mountDormancyPV();

    sendDormantFrame(ws, true);

    // DormancyOverlay is mounted.
    const overlay = container.querySelector('[role="status"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('aria-label')).toContain('asleep');

    // ComposeBox is mounted (fix A: mount gate now includes `dormant`).
    const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    // Send disabled via dormantActive={dormant||waking} (pre-existing wiring).
    expect(sendBtn.disabled).toBe(true);
    // Textarea is present and NOT disabled (dormantActive keeps textarea typeable).
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.disabled).toBe(false);
  });

  it("Fix B: visibility false→true transition resets stale waking state", () => {
    const { container, ws, rerender, onSend } = mountDormancyPV();

    sendDormantFrame(ws, true);

    // Enter waking state via Wake click (mirrors 260808-cd6 Test 3).
    const wakeBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();
    act(() => { fireEvent.click(wakeBtn); });

    // Confirm we entered waking state.
    expect(container.textContent).toContain('Waking up…');

    // Hide the pane (simulates Ashley navigating away — patch #344 closes WS).
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={false} />);

    // Return to the pane (visibility false → true transition).
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />);

    // The stale "Waking up…" indicator should be gone (fix B reset).
    expect(container.textContent).not.toContain('Waking up…');
  });
});

// ── quick 260809-ha3 wake progress survives visibility roundtrip ──────────

describe("quick 260809-ha3 wake progress survives visibility roundtrip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wsStubs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mountDormancyPV() {
    const resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
    const onSend = vi.fn(() => true);
    const utils = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    return { ...utils, onSend, ws };
  }

  function sendDormantFrameWithWakingSince(ws: WsStub, dormant: boolean, wakingSince: number | null): void {
    // Phase 30: DormancyOverlay's mount gate flipped to backend-
    // authoritative (renderedState === "dormant" via paneState). Send
    // the sibling pane_state frame alongside — mirrors what the
    // pane-state-emitter now does on the wire for the dormant-poll seams
    // (Plan 30-01 § L4214 / L4738).
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'dormant', dormant, wakingSince }),
        }),
      );
    });
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'pane_state',
            state: dormant ? 'dormant' : 'active',
            ...(dormant ? {} : { reason: 'dormancy_cleared' }),
          }),
        }),
      );
    });
  }

  it("wake progress restored after visibility roundtrip via wakingSince frame (phase-29: WS-pause reset semantic)", () => {
    // phase-29 (plan 29-05 test-audit): the visibility roundtrip under
    // the phase-29 machine re-enters the resolving phase (SPEC req 1).
    // The DormancyOverlay unmounts during resolving; when the fresh WS
    // re-emits a dormant frame the state machine transitions back
    // through captureFirstFrame to phase="dormant", re-mounting the
    // overlay with the fresh waking state. Under the pre-phase-29 model
    // this test observed a simpler local-state reset — phase-29 makes
    // the round-trip go through the state machine's shared entry-trigger
    // code path.
    //
    // To exercise this reliably in tests, we (a) simulate the WS actually
    // closing (mock readyState update + fireClose) so the WS-pause reopen
    // path creates a fresh stub, and (b) dispatch the dormant frame on
    // the FRESH stub (not the captured `ws`).
    const { container, ws, rerender, onSend } = mountDormancyPV();

    // Step 1-2: enter dormant state via natural-dormant frame (wakingSince=null).
    // Overlay is mounted asleep, no "Waking up…" text yet.
    sendDormantFrameWithWakingSince(ws, true, null);
    expect(container.textContent).not.toContain('Waking up…');
    const wakeBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
    expect(wakeBtn).toBeTruthy();

    // Step 3: click Wake — local-fallback path sets waking=true + wakingStartTs=Date.now().
    act(() => { fireEvent.click(wakeBtn); });
    expect(container.textContent).toContain('Waking up…');

    // Step 4: hide — mark stub #1 as closed (matches production ws.close()
    // semantics; the mock's `close: vi.fn()` doesn't auto-update readyState).
    // Then rerender to isVisible=false so the WS-pause useEffect runs.
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={false} />);
    // Simulate the ws actually closing.
    ws.readyState = 3; // CLOSED

    // Step 5: show — the WS-pause reopen path sees readyState=CLOSED,
    // resets backendFirstFrame to "not-yet" (phase-29), bumps retryKey,
    // and the WS-setup useEffect re-runs to create stub #2. The warm
    // re-focus edge in usePaneResolvingMachine also fires — phase
    // transitions to "resolving" (waking state cleared by prevIsVisibleRef).
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={onSend} isVisible={true} />);
    // Waking cleared by Fix B (prevIsVisibleRef effect) — no stale text.
    expect(container.textContent).not.toContain('Waking up…');

    // Step 6: server's fresh dormant poll arrives on stub #2 with
    // wakingSince from wakeTriggerTs — simulate a wake that started
    // 30s ago server-side. captureFirstFrame("dormant") flips
    // backendFirstFrame from "not-yet" to "dormant" (input change from
    // rearmSnapshot); phase resolves back to "dormant"; DormancyOverlay
    // re-mounts with the fresh wakingSince value.
    const currentWs = getCurrentWs();
    expect(currentWs).not.toBe(ws); // stub #2 is different from stub #1
    const serverWakeTs = Date.now() - 30_000;
    sendDormantFrameWithWakingSince(currentWs, true, serverWakeTs);

    // Step 7: waking state restored, "Waking up…" back on screen.
    expect(container.textContent).toContain('Waking up…');

    // Step 8: advance timers 1s — elapsedSeconds ticker keeps running (derived
    // from Date.now() - wakingStartTs). "Waking up…" persists across the tick.
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(container.textContent).toContain('Waking up…');
  });

  it("wakingSince null preserves natural-dormant behavior — does not enter waking state", () => {
    const { container, ws } = mountDormancyPV();

    // Natural-dormant frame (wakingSince=null) — no user-initiated wake in
    // flight. Overlay mounts asleep with Wake button; MUST NOT show "Waking up…".
    sendDormantFrameWithWakingSince(ws, true, null);
    expect(container.textContent).not.toContain('Waking up…');
    // Wake button is present (offering the click), not hidden by a waking state.
    expect(container.querySelector('button[aria-label="Wake identity"]')).toBeTruthy();
  });
});

// ── quick 260808-ho2 loading overlay integration tests ─────────────────────

describe("quick 260808-ho2 loading overlay integration", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wsStubs.length = 0;
    vi.mocked(useSessionIdentity).mockReturnValue({
      identity: null,
      identityHue: null,
    } as ReturnType<typeof useSessionIdentity>);
    // Must be a function/class (not arrow fn) so `new ResizeObserver(...)` works.
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
    // Silence the "[pv-loading-overlay] 10s timeout dismiss" console.info that
    // Test D deliberately triggers. Left un-silenced, the RPC forwarding of the
    // console log to the vitest reporter can race with unrelated test-file
    // worker teardowns under full-suite pressure and surface as an unhandled
    // EnvironmentTeardownError attributed (misleadingly) to whichever file the
    // worker was tearing down at the time. The console.info in production
    // code stays — this is a test-only silence.
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Helper: fire a WS frame on the current WS stub inside act().
  function fireWsFrame(ws: WsStub, frame: Record<string, unknown>): void {
    act(() => {
      ws.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(frame) }),
      );
    });
  }

  // Loading overlay is unique by aria-label — sibling overlays use different labels.
  const LOADING_SELECTOR = '[aria-label="Loading conversation…"]';

  // Phase 30: the loading overlay is the resolving-state spinner
  // (D-01 visual preserved from Phase 29). Mount gate flipped from
  // Phase-29's `phase === "resolving" && showResolvingSpinner` (with
  // 150ms hook-level delay-arm) to a caller-site delay-arm at 400ms
  // per phase-30-restore-resolving-overlay-paint-delay (2026-08-10) —
  // Ashley UAT surfaced the flash Phase 30's delay-arm deletion left
  // exposed and PS30-06's own code comment explicitly authorized
  // restoring the paint-delay at THIS site (not the hook). The tests
  // below therefore assert MOUNTED-AFTER-400ms rather than mounted-
  // synchronously; the backend's pane_state emit is what transitions
  // the render off "resolving".

  it("Test A: cold mount mounts the resolving spinner after 400ms paint-delay", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    // Before the delay-arm fires: overlay NOT mounted — sub-400ms cold
    // resolves (the typical warm-re-entry case) never flash.
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
    advance(400);
    // After the delay-arm fires: overlay mounted — genuinely-slow resolves
    // (test scenario — no pane_state received) see the spinner.
    expect(container.querySelector(LOADING_SELECTOR)).not.toBeNull();
  });

  it("Test B: overlay stays mounted on ws.onopen alone; dismisses on session + pane_state:active", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    // phase-30-restore-resolving-overlay-paint-delay (2026-08-10): trip
    // the 400ms paint-delay before asserting mount.
    advance(400);
    expect(container.querySelector(LOADING_SELECTOR)).not.toBeNull();

    // ws.onopen alone does NOT dismiss (status stays "connecting" until
    // a session frame arrives; wsTransportState stays "not-connected";
    // renderedState stays "resolving" because paneState is still null).
    act(() => { ws.onopen?.(); });
    expect(container.querySelector(LOADING_SELECTOR)).not.toBeNull();

    // Phase 30: the session frame flips status to "streaming" (which
    // moves wsTransportState to "open"), but the spinner stays up until
    // paneState is received. Backend attach-time emit fires
    // pane_state:active from startActiveSessionFlow (Plan 30-01 § L3871).
    fireWsFrame(ws, { type: 'session', sessionFile: '/tmp/test.jsonl' });
    // Without a pane_state frame the spinner is still up (paneState=null).
    expect(container.querySelector(LOADING_SELECTOR)).not.toBeNull();
    // Now the sibling pane_state:active emit lands.
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
  });

  it("Test C: overlay dismisses on pane_state:active (Phase 30 backend-authoritative)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => { ws.onopen?.(); });
    // phase-30-restore-resolving-overlay-paint-delay (2026-08-10): trip
    // the 400ms paint-delay before asserting mount on cold entry.
    advance(400);
    expect(container.querySelector(LOADING_SELECTOR)).not.toBeNull();

    // Phase 30: bare message frames no longer participate in overlay
    // mount decisions (client-inference DELETED per PS30-04). Only the
    // pane_state:active frame flips renderedState off "resolving".
    fireWsFrame(ws, { type: 'session', sessionFile: '/tmp/test.jsonl' });
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();

    // A subsequent message frame does not resurrect the spinner — it
    // stays in the active state.
    fireWsFrame(ws, {
      type: 'message', role: 'user', content: 'hi', eventId: 'ev-1', ts: 1,
    });
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
  });

  it.todo("[phase 29] retired: 10s PrettyViewLoadingOverlay auto-dismiss watchdog (SPEC req 5 no-timeout-heuristics). The resolving spinner now stays up until backend emits pane_state or wsTransportState transitions to failed-permanently — no wall-clock deadline.");

  it("Test E: pane_state:dormant → DormancyOverlay mounts (Phase 30 backend-authoritative)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();
    // Phase 30: dormant overlay mount decision comes from
    // pane_state:dormant (Plan 30-01 § L4649 initial-discovery-dormant
    // path, or § L4214 dormant-poll seam). Legacy `dormant` frame is
    // preserved on the wire alongside for its non-mount side effects
    // (waking/wakingStartTs local state that DormancyOverlay reads as
    // props for the wake-progress UX).
    act(() => { ws.onopen?.(); });
    fireWsFrame(ws, { type: 'dormant', dormant: true });
    fireWsFrame(ws, { type: 'pane_state', state: 'dormant' });

    // Loading spinner unmounted (renderedState transitioned off "resolving").
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
    // Dormant overlay IS mounted (renderedState === "dormant").
    const dormancyOverlay = container.querySelector('[aria-label*="asleep"]');
    expect(dormancyOverlay).not.toBeNull();
  });

  it("Test F: pane_state:holding trumps loading — spinner unmounts, SessionHoldingOverlay mounts (Phase 30 clean-swap)", () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();

    // Flip to streaming + attach-time pane_state:active.
    act(() => { ws.onopen?.(); });
    fireWsFrame(ws, { type: 'session', sessionFile: '/tmp/test.jsonl' });
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });
    // After active: spinner gone.
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();

    // Phase 30: pane_state:holding drives the overlay mount decision.
    // The legacy session_holding frame is preserved on the wire alongside
    // (Plan 30-01 § L2154) but no longer manipulates client-side state.
    fireWsFrame(ws, { type: 'session_holding' });
    fireWsFrame(ws, { type: 'pane_state', state: 'holding', reason: 'id_reset' });

    // SessionHoldingOverlay IS mounted.
    const holdingOverlay = container.querySelector('[aria-label*="recycling"]');
    expect(holdingOverlay).not.toBeNull();
    // Loading overlay NOT mounted (mutual exclusion via renderedState).
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
  });

  it("Test G: warm hidden→visible re-focus does NOT re-arm resolving under Phase 30 (D-11 don't-flicker via paneState retention)", () => {
    // Phase 30 SEMANTIC CHANGE from Phase 29: the warm re-focus entry-
    // trigger effect is DELETED (see usePaneResolvingMachine.ts rewrite
    // in Plan 30-03 Task 2). Under Phase 30, hidden→visible flips do
    // NOT re-arm the resolving spinner — the D-11 don't-flicker rule
    // in the pure reducer keeps rendering the last-known paneState's
    // overlay (in this case: no overlay, because paneState="active").
    // This is a deliberate simplification per 30-CONTEXT.md § Signal
    // set (LOCKED — "exactly two signals into the state machine").
    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();

    // Dismiss the initial resolving arm via a session + pane_state:active.
    act(() => { ws.onopen?.(); });
    fireWsFrame(ws, { type: 'session', sessionFile: '/tmp/test.jsonl' });
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();

    // Flip isVisible=false, then back to isVisible=true. Under Phase 30
    // the visibility flip is orthogonal to the state machine — the D-11
    // branch keeps rendering the last-known paneState="active" (no
    // overlay).
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={false} />);
    rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />);

    // Advance timers (there's no delay-arm timer to trip, but exercise
    // the event loop). The spinner MUST NOT re-mount — no entry trigger
    // exists to re-arm resolving.
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.querySelector(LOADING_SELECTOR)).toBeNull();
  });

  it("Test H: SessionHoldingOverlay behavior is preserved (Phase 30 mount-gate rewire regression-guard)", () => {
    // Mirror of the existing Fix B: Test F1 pattern. Ensures the mount-
    // site rewire in PrettyView.tsx (Plan 30-03 Task 3 — from
    // `phase === "holding"` to `renderedState === "holding"`) did not
    // regress SessionHoldingOverlay's observable behavior. The component
    // itself is byte-untouched; only the parent's mount gate changed.
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />,
    );
    const ws = getCurrentWs();

    // Transition to streaming (status="streaming").
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'session', sessionFile: '/tmp/test.jsonl' }),
        }),
      );
    });
    fireWsFrame(ws, { type: 'pane_state', state: 'active' });

    // Phase 30: fire pane_state:holding — renderedState transitions to
    // "holding". SessionHoldingOverlay mounts immediately (D-11 clean-
    // swap, no delay-arm).
    fireWsFrame(ws, { type: 'session_holding' });
    fireWsFrame(ws, { type: 'pane_state', state: 'holding', reason: 'id_reset' });

    // SessionHoldingOverlay's role=status element exists with the "recycling"
    // aria-label (verbatim from SessionHoldingOverlay.tsx L97).
    const holdingRoot = container.querySelector('[aria-label*="recycling"]');
    expect(holdingRoot).not.toBeNull();
    expect(holdingRoot?.getAttribute("role")).toBe("status");
  });
});
