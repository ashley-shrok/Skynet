// ─── mobile-flow.test.ts ──────────────────────────────────────────────────────
// 11-case coverage of the Plan 06-03 mobile-flow state machine + its
// round-trip through the extended tab-url.ts `mobileView` field. Reproduces
// the plan's `<behavior>` block scenarios one-to-one.
//
// jsdom notes:
//   - `history.pushState` + `history.replaceState` are supported; hashchange
//     fires on `location.hash =` assignment but NOT on pushState/replaceState
//     (per WHATWG spec + jsdom impl). mobile-flow's action functions
//     manually recompute-and-emit after pushState/replaceState calls so
//     subscribers stay in sync.
//   - `history.back()` fires popstate asynchronously on the microtask queue
//     in jsdom; use `await Promise.resolve()` or a small timer to flush.
//   - Module-scoped state (currentScreen, listeners set) must be reset via
//     `__resetMobileFlowForTest()` between cases so hash changes from one
//     test don't leak into the next.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useMobileScreen,
  navigateToView,
  navigateToList,
  __resetMobileFlowForTest,
  __recomputeForTest,
} from "@/lib/mobile-flow";
import {
  encodeWorkspaceSpec,
  consumePendingWorkspace,
  writeWorkspaceToUrl,
  type WorkspaceSpec,
} from "@/lib/tab-url";

// Helpers ────────────────────────────────────────────────────────────────────

function setHash(next: string): void {
  // Assigning window.location.hash fires hashchange synchronously in jsdom,
  // which our module-load listener handles by recomputing currentScreen.
  window.location.hash = next;
}

function clearUrl(): void {
  // Reset the URL state between tests via replaceState (no history-stack
  // append; no test-time entry proliferation). jsdom does NOT expose an
  // API to wipe the full session-history back-stack — prior tests' pushed
  // entries leak into later tests' history.back() traversals. Test 6
  // works around that by driving hashchange+popstate directly rather than
  // routing through history.back().
  window.history.replaceState({}, "", "/");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// jsdom fires popstate via `window.setTimeout(fireEvents, 0)` for non-blocking
// history traversals (jsdom SessionHistory.js line 135-136). Real setTimeout(0)
// yield gets us onto the macrotask queue where jsdom's popstate lives.
function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  // Clear sessionStorage so consumePendingWorkspace tests read from URL only.
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
  clearUrl();
  __resetMobileFlowForTest();
  // Fire the module's own recompute so currentScreen matches the freshly
  // cleared URL (in case a prior test left mv=1 in the hash before clear).
  __recomputeForTest();
});

// ─── Tests 1-3 (initial state / parsing) ────────────────────────────────────

describe("mobile-flow: initial state parsing", () => {
  it("Test 1 — empty hash yields list", () => {
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("list");
  });

  it("Test 2 — #mv=1 yields view", () => {
    setHash("#mv=1");
    __recomputeForTest();
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("view");
  });

  it("Test 3 — mv=1 combined with tab= yields view + WorkspaceSpec { mobileView: true, tabs: [...] }", () => {
    setHash("#tab=terminal:hostA&mv=1");
    __recomputeForTest();
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("view");
    const ws = consumePendingWorkspace();
    expect(ws).not.toBeNull();
    expect(ws!.mobileView).toBe(true);
    expect(ws!.tabs).toEqual([{ protocol: "terminal", host: "hostA" }]);
  });
});

// ─── Tests 4-6 (imperative navigation actions) ──────────────────────────────

describe("mobile-flow: navigateToView / navigateToList / back gesture", () => {
  it("Test 4 — navigateToView writes mv=1 + hook returns 'view'", () => {
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("list");
    act(() => {
      navigateToView();
    });
    expect(window.location.hash).toContain("mv=1");
    expect(result.current).toBe("view");
  });

  it("Test 5 — navigateToList removes mv + hook returns 'list' (replaceState fallback path)", () => {
    // Start on a deep-link (mv=1 in hash, NO prior pushState sentinel).
    // navigateToList should use the replaceState fallback path.
    setHash("#mv=1");
    __recomputeForTest();
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("view");
    act(() => {
      navigateToList();
    });
    expect(window.location.hash).not.toContain("mv=1");
    expect(result.current).toBe("list");
  });

  it("Test 6 — popstate returns to list (simulated browser-back)", async () => {
    // Per the plan's Test 6 spec:  "…simulating browser back via dispatching a
    // synthetic popstate event with the pre-view state → useMobileScreen()
    // returns 'list'". We drive the module's listener directly rather than
    // relying on jsdom's history.back() traversal, because jsdom's session-
    // history state leaks across tests within a file (each pushState from a
    // prior case remains in the back-stack; there is no test API to reset
    // it, per WHATWG spec). Directly manipulating window.location.hash +
    // dispatching hashchange (which is what a real browser back would fire)
    // gives us a deterministic assertion of the listener→recompute→emit path
    // that navigateToList's history.back() branch relies on in production.
    const { result } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("list");
    act(() => {
      navigateToView();
    });
    expect(result.current).toBe("view");
    expect(window.location.hash).toContain("mv=1");

    // Simulate the browser having navigated back: the hash becomes empty
    // and hashchange + popstate fire (matching a real browser's behavior
    // for a same-document history traversal).
    await act(async () => {
      window.location.hash = ""; // fires hashchange synchronously in jsdom
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      await flushMacrotasks();
    });
    expect(result.current).toBe("list");
    expect(window.location.hash).not.toContain("mv=1");
  });
});

// ─── Tests 7-9 (tab-url.ts round-trip + write idempotency) ──────────────────

describe("mobile-flow: tab-url.ts round-trip", () => {
  it("Test 7 — encodeWorkspaceSpec + consumePendingWorkspace round-trips mobileView", () => {
    const spec: WorkspaceSpec = {
      tabs: [{ protocol: "tmux", host: "hostA", session: "s1" }],
      mobileView: true,
    };
    const payload = encodeWorkspaceSpec(spec);
    expect(payload).toContain("mv=1");
    // Stash into sessionStorage the way snapshotPendingTab would, then read.
    window.sessionStorage.setItem("skynet_pending_tab", payload);
    const parsed = consumePendingWorkspace();
    expect(parsed).not.toBeNull();
    expect(parsed!.mobileView).toBe(true);
    expect(parsed!.tabs).toEqual([
      { protocol: "tmux", host: "hostA", session: "s1" },
    ]);
  });

  it("Test 8 — writeWorkspaceToUrl is idempotent with mobileView=true", () => {
    const spec: WorkspaceSpec = {
      tabs: [{ protocol: "terminal", host: "hostA" }],
      activeIndex: 0,
      mobileView: true,
    };
    writeWorkspaceToUrl(spec);
    const hashAfterFirst = window.location.hash;
    expect(hashAfterFirst).toContain("mv=1");
    expect(hashAfterFirst).toContain("tab=terminal");
    writeWorkspaceToUrl(spec);
    const hashAfterSecond = window.location.hash;
    expect(hashAfterSecond).toBe(hashAfterFirst);
  });

  it("Test 9 — writeWorkspaceToUrl(null) clears mv=1 alongside tab=", () => {
    setHash("#tab=terminal:hostA&mv=1");
    writeWorkspaceToUrl(null);
    expect(window.location.hash).toBe("");
    expect(window.location.hash).not.toContain("mv=1");
  });
});

// ─── Test 10 (malformed mv) ─────────────────────────────────────────────────

describe("mobile-flow: malformed mv value", () => {
  it("Test 10 — mv=0, mv=yes, mv=true all parse to list (only mv=1 counts)", () => {
    setHash("#mv=yes");
    __recomputeForTest();
    let { result, unmount } = renderHook(() => useMobileScreen());
    expect(result.current).toBe("list");
    unmount();

    clearUrl();
    __resetMobileFlowForTest();
    setHash("#mv=0");
    __recomputeForTest();
    ({ result, unmount } = renderHook(() => useMobileScreen()));
    expect(result.current).toBe("list");
    unmount();

    clearUrl();
    __resetMobileFlowForTest();
    setHash("#mv=true");
    __recomputeForTest();
    ({ result } = renderHook(() => useMobileScreen()));
    expect(result.current).toBe("list");

    // consumePendingWorkspace with an mv=yes value in a tab-carrying URL —
    // mobileView should be undefined (falsy).
    setHash("#tab=terminal:hostA&mv=yes");
    const ws = consumePendingWorkspace();
    expect(ws).not.toBeNull();
    expect(ws!.mobileView).toBeUndefined();
  });
});

// ─── Test 11 (desktop URL preserves marker for cross-device portability) ────

describe("mobile-flow: cross-device link portability", () => {
  it("Test 11 — #tab=...&active=0&mv=1 parses tabs cleanly AND preserves mobileView", () => {
    setHash("#tab=terminal:hostA&active=0&mv=1");
    const ws = consumePendingWorkspace();
    expect(ws).not.toBeNull();
    expect(ws!.tabs).toEqual([{ protocol: "terminal", host: "hostA" }]);
    expect(ws!.activeIndex).toBe(0);
    expect(ws!.mobileView).toBe(true);
    // A desktop viewport that renders this WorkspaceSpec ignores mobileView
    // (AppShell's mobile branch is gated on useIsTouchDevice()). But the
    // marker must survive a subsequent writeWorkspaceToUrl if the caller
    // passes it through — proven by Test 8 idempotency.
  });
});
