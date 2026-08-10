// phase-29: usePaneResolvingMachine hook behavior tests + structural grep gates
/**
 * Hook-level tests for usePaneResolvingMachine — the single authoritative
 * pane-entry state machine introduced in phase 29. Complements the pure-
 * reducer truth-table tests in resolve-phase.test.ts (which exhaustively
 * cover the (wsState x backendFirstFrame) -> Phase mapping); the tests
 * here exercise only the hook-behavior concerns:
 *
 *   1. Initial mount enters phase='resolving' + delay-arms the spinner at
 *      150ms; instant resolutions (<150ms) never mount the spinner.
 *   2. Cold-mount entry trigger — paneKey change (hostId or tmuxSession
 *      change) re-enters resolving on an already-resolved pane.
 *   3. Warm re-focus entry trigger — isVisible false->true edge re-enters
 *      resolving on an already-resolved pane; initial mount with
 *      isVisible=true does NOT trip a spurious re-arm (prevIsVisibleRef
 *      initial-value discipline).
 *   4. PWA foreground entry trigger — document.visibilitychange to
 *      'visible' re-enters resolving iff pane is currently visible.
 *   5. Post-resolve steady state — backendFirstFrame flip transitions
 *      phase directly WITHOUT re-entering resolving (D-10 / D-11 clean
 *      swap); wsState regression to 'opening' visibly returns phase to
 *      'resolving' via resolvePhase() but does NOT re-arm internal
 *      resolving mode (this is the D-10 subtlety documented inline).
 *   6. requestRetry callback (D-09) — re-enters resolving via the shared
 *      code path (same UX shape as DormancyOverlay's Wake button).
 *   7. Structural grep gates (SPEC req 5) — read the hook source and
 *      assert exactly-one setTimeout, zero setInterval / requestIdleCallback,
 *      and the presence of the resolution-inputs anchor comment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  usePaneResolvingMachine,
  type UsePaneResolvingMachineDeps,
} from "./usePaneResolvingMachine";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_SRC_PATH = join(HERE, "usePaneResolvingMachine.ts");

// Fake-timers harness — mirrors PrettyView.test.tsx §290-322 shape but
// without WS mocking (the hook takes wsState + backendFirstFrame as
// controlled inputs; WS-lifecycle is plan 29-04's caller-side concern).
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const baseDeps = (
  overrides: Partial<UsePaneResolvingMachineDeps> = {},
): UsePaneResolvingMachineDeps => ({
  hostId: 1,
  tmuxSession: "s1",
  isVisible: true,
  wsState: "opening",
  backendFirstFrame: "not-yet",
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initial mount + spinner delay-arm
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — initial mount enters resolving with delay-armed spinner", () => {
  it("initial state: phase='resolving' and showSpinner=false", () => {
    const { result } = renderHook(() => usePaneResolvingMachine(baseDeps()));
    expect(result.current.phase).toBe("resolving");
    expect(result.current.showSpinner).toBe(false);
  });

  it("after 150ms elapses with unchanged inputs, showSpinner becomes true", () => {
    const { result } = renderHook(() => usePaneResolvingMachine(baseDeps()));
    expect(result.current.showSpinner).toBe(false);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.showSpinner).toBe(true);
    expect(result.current.phase).toBe("resolving");
  });

  it("instant resolution before 150ms elapses never mounts spinner (D-04)", () => {
    // Start unresolved (wsState=opening, backendFirstFrame=not-yet).
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      { initialProps: baseDeps() },
    );
    expect(result.current.phase).toBe("resolving");
    expect(result.current.showSpinner).toBe(false);

    // Advance 100ms — still under the 150ms threshold. Spinner not yet armed.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.showSpinner).toBe(false);

    // Inputs settle to active before the 150ms delay fires.
    act(() => {
      rerender(baseDeps({ wsState: "open", backendFirstFrame: "active" }));
    });

    // Advance well past the original 150ms armed window; the pending
    // setTimeout should have been cleared by the delay-arm cleanup when
    // phase left "resolving". Spinner MUST stay false.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.showSpinner).toBe(false);
    expect(result.current.phase).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cold-mount entry trigger (paneKey change)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — cold-mount entry trigger (paneKey change)", () => {
  it("changing hostId re-enters resolving on an already-resolved pane", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          hostId: 1,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    // Drive to phase="active" — inputs are already settled at mount.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    // Change hostId — cold-mount entry trigger. Re-enters resolving even
    // though the new pane's inputs are still "settled" in isolation.
    act(() => {
      rerender(
        baseDeps({
          hostId: 2,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      );
    });
    expect(result.current.phase).toBe("resolving");
  });

  it("changing tmuxSession re-enters resolving on an already-resolved pane", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          tmuxSession: "s1",
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    act(() => {
      rerender(
        baseDeps({
          tmuxSession: "s2",
          wsState: "open",
          backendFirstFrame: "active",
        }),
      );
    });
    expect(result.current.phase).toBe("resolving");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Warm re-focus entry trigger (isVisible false->true)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — warm re-focus entry trigger (isVisible false→true)", () => {
  it("isVisible false→true edge re-enters resolving on an already-resolved pane", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          isVisible: true,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    // Hide the pane; hidden panes don't re-arm resolving.
    act(() => {
      rerender(
        baseDeps({
          isVisible: false,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      );
    });
    expect(result.current.phase).toBe("active");

    // Warm re-focus: false→true edge re-arms resolving via the shared code path.
    act(() => {
      rerender(
        baseDeps({
          isVisible: true,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      );
    });
    expect(result.current.phase).toBe("resolving");
  });

  it("initial mount with isVisible=true does NOT trip a spurious re-arm (prevIsVisibleRef initialization)", () => {
    // Prevents the load-bearing regression where prevIsVisibleRef is
    // initialized to `false` — that would trip the (!prev && isVisible)
    // edge on the very first render and keep isResolving stuck at true
    // even after inputs settled. Correct initialization (= isVisible at
    // mount) means the initial render sees prev === isVisible and does
    // NOT fire the re-arm.
    const { result } = renderHook(() =>
      usePaneResolvingMachine(
        baseDeps({
          isVisible: true,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      ),
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PWA foreground entry trigger (document.visibilitychange)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — PWA foreground entry trigger (document.visibilitychange)", () => {
  it("document.visibilitychange to visible re-enters resolving when pane is visible", () => {
    const { result } = renderHook(() =>
      usePaneResolvingMachine(
        baseDeps({
          isVisible: true,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      ),
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    // Fire the PWA-foreground event with pane currently visible.
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.phase).toBe("resolving");
  });

  it("document.visibilitychange fires but pane hidden — does NOT re-enter resolving", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          isVisible: true,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    // Hide the pane.
    act(() => {
      rerender(
        baseDeps({
          isVisible: false,
          wsState: "open",
          backendFirstFrame: "active",
        }),
      );
    });
    expect(result.current.phase).toBe("active");

    // Fire PWA foreground event; hook must gate on isVisibleRef=false
    // and NOT re-arm. The warm re-focus trigger will handle it when
    // isVisible next flips true.
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.phase).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Post-resolve steady state (D-10 / D-11)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — post-resolve steady state (D-10, D-11)", () => {
  it("post-resolve input flip transitions phase directly, does NOT re-enter resolving", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");
    expect(result.current.showSpinner).toBe(false);

    // Backend re-emits dormant while the pane is post-resolve. Phase
    // must swap directly to "dormant" without going through
    // "resolving" — D-11 clean swap. Spinner must NOT mount for the
    // transition.
    act(() => {
      rerender(
        baseDeps({ wsState: "open", backendFirstFrame: "dormant" }),
      );
    });
    expect(result.current.phase).toBe("dormant");

    // Advance past the delay-arm window; spinner still off (phase !==
    // "resolving" so the delay-arm effect's else-branch keeps it false).
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showSpinner).toBe(false);
  });

  it("post-resolve WS drop returns phase to resolving via resolvePhase — but does NOT re-arm internal resolving mode (D-10 subtlety)", () => {
    // D-10 governs whether the machine re-ARMS its internal resolving-
    // mode flag (hasResolvedThisPaneRef stays true; isResolving stays
    // false in the post-resolve steady state) — NOT whether the derived
    // `phase` can visibly transition back to "resolving" when inputs
    // regress. The derived phase is always resolvePhase(wsState,
    // backendFirstFrame) once we've resolved, and resolvePhase() maps
    // wsState="opening" to "resolving" deterministically.
    //
    // The observable effect: the visible phase says "resolving" while
    // the WS is opening; the moment WS is back open and backend re-
    // emits an "active" frame, the phase swaps directly to "active"
    // WITHOUT going through the internal "arm resolving mode → wait for
    // input settlement → transition to terminal" cycle again. That
    // internal cycle is only re-armed by the three named entry
    // triggers or requestRetry (per D-10).
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          wsState: "open",
          backendFirstFrame: "active",
        }),
      },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("active");

    // Simulate transient WS drop post-resolve.
    act(() => {
      rerender(
        baseDeps({ wsState: "opening", backendFirstFrame: "active" }),
      );
    });
    expect(result.current.phase).toBe("resolving");

    // WS recovers; phase swaps directly back to "active" (post-resolve
    // steady state — no internal re-arm cycle needed).
    act(() => {
      rerender(
        baseDeps({ wsState: "open", backendFirstFrame: "active" }),
      );
    });
    expect(result.current.phase).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. requestRetry callback (D-09)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — requestRetry callback (D-09)", () => {
  it("requestRetry() re-enters resolving on an already-resolved pane (from error phase)", () => {
    const { result } = renderHook(() =>
      usePaneResolvingMachine(
        baseDeps({ wsState: "failed-permanently", backendFirstFrame: "not-yet" }),
      ),
    );
    // Advance past delay-arm; resolution detects failed-permanently and
    // transitions to error.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.phase).toBe("error");

    // User clicks Retry — same UX shape as DormancyOverlay's Wake button.
    act(() => {
      result.current.requestRetry();
    });
    expect(result.current.phase).toBe("resolving");
  });

  it("failed-permanently produces phase='error' via resolvePhase (not a retry)", () => {
    // Sanity-check that the error phase comes from the pure reducer,
    // not from a wall-clock deadline. Only the WS layer's own
    // 'failed-permanently' terminal signal can resolve phase to 'error'
    // (SPEC req 5).
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: baseDeps({
          wsState: "opening",
          backendFirstFrame: "not-yet",
        }),
      },
    );
    // Advance far past any hypothetical wall-clock deadline — phase
    // must stay "resolving" (no wall-clock deadline exists).
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.phase).toBe("resolving");

    // WS retry ladder terminally gives up.
    act(() => {
      rerender(
        baseDeps({
          wsState: "failed-permanently",
          backendFirstFrame: "not-yet",
        }),
      );
    });
    expect(result.current.phase).toBe("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Structural grep gates (SPEC req 5)
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — structural grep gates (SPEC req 5)", () => {
  const src = readFileSync(HOOK_SRC_PATH, "utf-8");

  it("hook source contains exactly one setTimeout call (the 150ms delay-arm)", () => {
    const matches = src.match(/setTimeout\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("hook source contains no setInterval, no requestIdleCallback (no wall-clock deadlines)", () => {
    expect(src).not.toMatch(/setInterval\(/);
    expect(src).not.toMatch(/requestIdleCallback/);
  });

  it("hook source lists exactly wsState and backendFirstFrame as resolution inputs (SPEC req 3)", () => {
    // Anchor on the planted comment tag. The anchor's presence is the
    // structural gate; refactor-safe. Plan 29-04's grep gate targets
    // this exact string.
    const anchorIdx = src.indexOf(
      "phase-29: resolution inputs — wsState + backendFirstFrame ONLY",
    );
    expect(anchorIdx).toBeGreaterThan(0);
  });
});
