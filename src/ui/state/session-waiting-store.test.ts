// ─── session-waiting-store — Vitest coverage (Phase 34 Plan 06, Task 1) ──────
// Tests G–I from the plan spec plus edge cases:
//
//   G. publishFleetStatusWaitingFor(hostId, tmuxSession, 'approve Bash') → useSessionWaitingFor returns 'approve Bash'
//   H. publishFleetStatusWaitingFor(hostId, tmuxSession, null) → useSessionWaitingFor returns null
//   I. waiting-store is INDEPENDENT of working-store — updates to one do not trigger notify on the other
//
// Additional edge cases:
//   - Null key → useSessionWaitingFor(null) returns null (short-circuit)
//   - Unknown key → useSessionWaitingFor returns null
//   - waitingFor string updates correctly on repeated publishes

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishFleetStatusWaitingFor,
  useSessionWaitingFor,
  __resetForTestWaiting,
} from "./session-waiting-store.js";

import {
  publishFleetStatusSessionState,
  __resetForTest,
  getSessionWorkingSnapshot,
} from "./session-working-store.js";

beforeEach(() => {
  __resetForTestWaiting();
  __resetForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — publishFleetStatusWaitingFor with string → useSessionWaitingFor returns it
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: Test G — publish string → useSessionWaitingFor returns it", () => {
  it("publishFleetStatusWaitingFor('h1', 's1', 'approve Bash') → useSessionWaitingFor('h1:s1') returns 'approve Bash'", () => {
    const { result, rerender } = renderHook(() =>
      useSessionWaitingFor("h1:s1"),
    );
    expect(result.current).toBe(null); // unknown → null

    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "approve Bash");
    });
    rerender();
    expect(result.current).toBe("approve Bash");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — publishFleetStatusWaitingFor with null → useSessionWaitingFor returns null
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: Test H — publish null → useSessionWaitingFor returns null", () => {
  it("publishing null for a key removes it so useSessionWaitingFor returns null", () => {
    const { result, rerender } = renderHook(() =>
      useSessionWaitingFor("h1:s1"),
    );

    // First set a value
    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "sandbox request");
    });
    rerender();
    expect(result.current).toBe("sandbox request");

    // Then clear it
    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", null);
    });
    rerender();
    expect(result.current).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I — waiting-store INDEPENDENT of working-store
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: Test I — independence from working-store", () => {
  it("publishing to waiting-store does NOT affect working-store's snapshot", () => {
    // Publish to working-store
    act(() => {
      publishFleetStatusSessionState("h1", {
        hostId: "h1",
        tmuxSession: "s1",
        sessionId: "sess-1",
        pid: 1,
        status: "busy",
        backgroundTasks: [],
        updatedAt: 0,
      });
    });

    const workingSnapBefore = getSessionWorkingSnapshot();

    // Publish to waiting-store — should NOT touch working-store
    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "worker request");
    });

    const workingSnapAfter = getSessionWorkingSnapshot();
    // Working-store snapshot reference should be unchanged
    expect(workingSnapAfter).toBe(workingSnapBefore);
  });

  it("publishing to working-store does NOT affect waiting-store's hook output", () => {
    // Set waiting
    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "dialog open");
    });

    const { result: waitingResult, rerender: waitingRerender } = renderHook(() =>
      useSessionWaitingFor("h1:s1"),
    );
    waitingRerender();
    expect(waitingResult.current).toBe("dialog open");

    // Update working-store for same key — waiting-store should be unaffected
    act(() => {
      publishFleetStatusSessionState("h1", {
        hostId: "h1",
        tmuxSession: "s1",
        sessionId: "sess-1",
        pid: 1,
        status: "idle",
        backgroundTasks: [],
        updatedAt: 1,
      });
    });
    waitingRerender();

    // Still reports the waiting value
    expect(waitingResult.current).toBe("dialog open");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge case: null key → useSessionWaitingFor returns null (short-circuit)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: null key → useSessionWaitingFor returns null", () => {
  it("useSessionWaitingFor(null) returns null (short-circuit, no subscribe work)", () => {
    const { result } = renderHook(() => useSessionWaitingFor(null));
    expect(result.current).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge case: unknown key → useSessionWaitingFor returns null
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: unknown key → useSessionWaitingFor returns null", () => {
  it("useSessionWaitingFor on a never-published key returns null", () => {
    const { result } = renderHook(() =>
      useSessionWaitingFor("never-published:key"),
    );
    expect(result.current).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge case: waitingFor string updates correctly on repeated publishes
// ─────────────────────────────────────────────────────────────────────────────

describe("session-waiting-store: repeated publishes update value", () => {
  it("publishing different values in sequence correctly updates the hook", () => {
    const { result, rerender } = renderHook(() =>
      useSessionWaitingFor("h1:s1"),
    );

    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "approve Bash");
    });
    rerender();
    expect(result.current).toBe("approve Bash");

    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", "sandbox request");
    });
    rerender();
    expect(result.current).toBe("sandbox request");

    act(() => {
      publishFleetStatusWaitingFor("h1", "s1", null);
    });
    rerender();
    expect(result.current).toBe(null);
  });
});
