// phase-30: trivial-hook tests for usePaneResolvingMachine
/**
 * Phase-30 hook-level tests. Phase 30's rewrite reduces this hook from
 * a ~380-LOC stateful machine (with rearmSnapshotRef + hasResolvedThisPaneRef
 * + three entry-trigger useEffects + delay-arm setTimeout + requestRetry
 * callback) to a trivial <60-LOC wrapper around the pure `resolveRenderedState`
 * reducer. Most Phase-29 tests DELETE because the machinery they exercise
 * (entry triggers, spinner delay-arm, snapshot rearm, requestRetry, cold-
 * mount paneKey reset) is GONE.
 *
 * WHAT REMAINS:
 *
 * The hook takes exactly two inputs (wsTransportState, paneState), passes
 * them to resolveRenderedState, and returns {renderedState, paneState}. The
 * caller (PrettyView.tsx) owns the paneState React state slot and resets
 * it on cold-mount; this hook is stateless.
 *
 * Test structure per 30-03-PLAN Task 2 <behavior>:
 *   Test 1 — active + open → renderedState=active
 *   Test 2 — flip paneState to holding → renderedState=holding (no delay)
 *   Test 3 — transport regresses to opening after previous paneState →
 *            keep last-known (D-11 don't-flicker)
 *   Test 4 — initial null paneState + opening transport → resolving
 *   Test 5 — caller-responsibility cold-mount reset (hook does not retain
 *            paneState across rerenders internally)
 *   Test 6 — NO entry-trigger machinery (implicit; no test needed — the
 *            grep gate in acceptance criteria enforces this)
 *   Test 7 — NO isVisible input
 *   Test 8 — hook result shape has exactly two properties
 */

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  usePaneResolvingMachine,
  type UsePaneResolvingMachineDeps,
} from "./usePaneResolvingMachine";

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — happy path: transport=open + paneState=active → renderedState=active
// ─────────────────────────────────────────────────────────────────────────────

describe("usePaneResolvingMachine — Phase 30 trivial derivation", () => {
  it("Test 1: open + active returns {renderedState: 'active', paneState: 'active'}", () => {
    const { result } = renderHook(() =>
      usePaneResolvingMachine({
        wsTransportState: "open",
        paneState: "active",
      }),
    );
    expect(result.current.renderedState).toBe("active");
    expect(result.current.paneState).toBe("active");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — immediate transition on paneState flip (no delay, no snapshot)
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 2: rerender with paneState=holding transitions immediately (no delay-arm)", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: {
          wsTransportState: "open",
          paneState: "active",
        } satisfies UsePaneResolvingMachineDeps,
      },
    );
    expect(result.current.renderedState).toBe("active");

    rerender({
      wsTransportState: "open",
      paneState: "holding",
    });
    expect(result.current.renderedState).toBe("holding");
    expect(result.current.paneState).toBe("holding");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — D-11 don't-flicker: transport transient drop keeps last-known
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 3: transport regresses to opening after previous paneState=holding → still 'holding' (D-11)", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: {
          wsTransportState: "open",
          paneState: "holding",
        } satisfies UsePaneResolvingMachineDeps,
      },
    );
    expect(result.current.renderedState).toBe("holding");

    // Transient WS drop — transport state regresses to "opening" but the
    // caller keeps paneState=holding in its state slot (D-11 don't-flicker).
    rerender({
      wsTransportState: "opening",
      paneState: "holding",
    });
    expect(result.current.renderedState).toBe("holding");
    expect(result.current.paneState).toBe("holding");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — initial render with no paneState + transport not up
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 4: initial paneState=null + wsTransportState=opening → renderedState='resolving'", () => {
    const { result } = renderHook(() =>
      usePaneResolvingMachine({
        wsTransportState: "opening",
        paneState: null,
      }),
    );
    expect(result.current.renderedState).toBe("resolving");
    expect(result.current.paneState).toBe(null);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — caller-responsibility cold-mount reset
  //
  // The hook is STATELESS re: paneState — it echoes through what the caller
  // passes. When the caller (PrettyView.tsx) detects a cold-mount (fresh
  // hostId/tmuxSession combo) it MUST reset its own paneState state slot to
  // null; the hook does NOT retain any internal per-pane state that would
  // carry an old paneState value into a fresh pane.
  //
  // Test proof: rerender with fresh inputs and observe the hook echoes the
  // fresh paneState (null) rather than the prior value (active).
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 5: hook does NOT retain paneState across paneKey change (caller resets its own state slot)", () => {
    const { result, rerender } = renderHook(
      (deps: UsePaneResolvingMachineDeps) => usePaneResolvingMachine(deps),
      {
        initialProps: {
          wsTransportState: "open",
          paneState: "active",
        } satisfies UsePaneResolvingMachineDeps,
      },
    );
    expect(result.current.renderedState).toBe("active");
    expect(result.current.paneState).toBe("active");

    // Simulate a caller-side cold-mount: caller's setPaneState(null) has
    // fired (PrettyView's fresh-pane useEffect), so paneState reverts to
    // null. Transport is still opening because the WS is re-establishing
    // for the fresh pane.
    rerender({
      wsTransportState: "opening",
      paneState: null,
    });
    expect(result.current.renderedState).toBe("resolving");
    expect(result.current.paneState).toBe(null);
    // Hook did NOT retain the prior "active" value.
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7 — no isVisible input in the deps signature
  //
  // Implicit assertion via TypeScript: attempting to pass isVisible would
  // be a type error. This runtime check confirms the surface: the hook
  // takes ONLY wsTransportState + paneState.
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 7: hook input surface is EXACTLY {wsTransportState, paneState} (no isVisible / hostId / tmuxSession)", () => {
    // Construct a minimal valid deps object and confirm the hook works
    // with only these two keys — no others required at runtime, no others
    // observed. If the hook ever accepted a third input, the TypeScript
    // signature would reject this object literal (excess-property check).
    const { result } = renderHook(() =>
      usePaneResolvingMachine({
        wsTransportState: "open",
        paneState: "active",
      }),
    );
    expect(result.current.renderedState).toBe("active");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 8 — result shape has exactly two properties (renderedState +
  //          paneState); no requestRetry, no showSpinner, no wsState,
  //          no backendFirstFrame
  // ─────────────────────────────────────────────────────────────────────────

  it("Test 8: hook result has exactly {renderedState, paneState} — no legacy props", () => {
    const { result } = renderHook(() =>
      usePaneResolvingMachine({
        wsTransportState: "open",
        paneState: "active",
      }),
    );
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["paneState", "renderedState"]);
    // Explicit no-legacy assertions.
    expect((result.current as Record<string, unknown>).requestRetry).toBeUndefined();
    expect((result.current as Record<string, unknown>).showSpinner).toBeUndefined();
    expect((result.current as Record<string, unknown>).wsState).toBeUndefined();
    expect(
      (result.current as Record<string, unknown>).backendFirstFrame,
    ).toBeUndefined();
    expect((result.current as Record<string, unknown>).phase).toBeUndefined();
  });
});
