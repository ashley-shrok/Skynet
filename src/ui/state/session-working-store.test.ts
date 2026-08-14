// ─── session-working-store — Vitest coverage (Phase 34 Plan 06, Task 1) ──────
// 12 tests (A–L) covering the fleet-status-channel-sourced composite working-state
// store and the derived useSessionIsWorking hook:
//
//   A. publishFleetStatusSessionState(hostId, {status:'busy',...}) → useSessionIsWorking true
//   B. status:'shell' → useSessionIsWorking false (harness reports shell for ANY local tool exec, including persistent Monitors — see store header)
//   C. status:'idle' + backgroundTasks w/ running shell → true (bg dominates)
//   D. status:'idle' + backgroundTasks:[] → false
//   E. status:'waiting' + backgroundTasks:[] → FALSE (waiting is NOT working per D-CTX)
//   F. publishFleetStatusSessionGone deletes key → subsequent useSessionIsWorking false
//   G. no-op notify guard: unchanged isWorking publish skips notify
//   H. publishFleetStatusSessionGone on unknown key is a no-op (no crash)
//   I. Unknown key → useSessionIsWorking returns false
//   J. Null key → useSessionIsWorking(null) returns false (short-circuit)
//   K. Multiple keys are independent
//   L. Source-level grep: publishSessionTtyBusy + publishSessionHasBackgroundedWork NOT imported in test file
//
// Pattern mirrors src/ui/state/conversation-store.test.ts — Vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  publishFleetStatusSessionState,
  publishFleetStatusSessionGone,
  useSessionIsWorking,
  useSessionIsWorkingRaw,
  getSessionWorkingSnapshot,
  __resetForTest,
} from "./session-working-store.js";

import type { SessionState } from "../api/fleet-status-types.js";

beforeEach(() => {
  __resetForTest();
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    hostId: "h1",
    tmuxSession: "s1",
    sessionId: "sess-1",
    pid: 1234,
    status: "idle",
    backgroundTasks: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test A — status:'busy' → isWorking true
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test A — status:'busy' → isWorking true", () => {
  it("publishFleetStatusSessionState with status:'busy' → useSessionIsWorking returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );
    expect(result.current).toBe(false); // unknown → false

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "busy" }));
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B — status:'shell' + bg:[] → isWorking false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test B — status:'shell' + bg:[] → isWorking false", () => {
  it("publishFleetStatusSessionState with status:'shell' → useSessionIsWorking returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "shell" }));
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C — status:'idle' + bg shell task → isWorking true
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test C — idle + bg shell task → isWorking true", () => {
  it("status:'idle' + one running shell background task → true (bg dominates)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          backgroundTasks: [
            { id: "bt-1", type: "shell", status: "running" },
          ],
        }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D — status:'idle' + no bg tasks → isWorking false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test D — idle + no bg tasks → isWorking false", () => {
  it("status:'idle' + backgroundTasks:[] → useSessionIsWorking returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", backgroundTasks: [] }),
      );
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E — status:'waiting' → isWorking FALSE (waiting is NOT working per D-CTX)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test E — status:'waiting' → isWorking FALSE", () => {
  it("status:'waiting' + backgroundTasks:[] → useSessionIsWorking returns false (waiting is NOT working per D-CTX)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          tmuxSession: "s1",
          status: "waiting",
          backgroundTasks: [],
          sessionId: "x",
          pid: 1,
          updatedAt: 0,
          hostId: "h1",
          waitingFor: "approve Bash",
        }),
      );
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F — publishFleetStatusSessionGone deletes key → useSessionIsWorking false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test F — publishFleetStatusSessionGone clears key", () => {
  it("after gone, useSessionIsWorking returns false and key is absent from snapshot", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    // First publish working state
    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "busy" }));
    });
    rerender();
    expect(result.current).toBe(true);

    // Now send gone
    act(() => {
      publishFleetStatusSessionGone("h1", "s1", "sess-1");
    });
    rerender();
    expect(result.current).toBe(false);

    // Key should be absent from the snapshot map
    const snap = getSessionWorkingSnapshot();
    expect(snap.has("h1:s1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — no-op notify guard: unchanged isWorking skips notify
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test G — no-op notify guard (unchanged isWorking)", () => {
  it("publishing the same isWorking value twice does NOT bump snapshot reference", () => {
    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "busy" }));
    });

    const snapBefore = getSessionWorkingSnapshot();

    // Publish same effective state (still busy → isWorking=true)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "busy", updatedAt: Date.now() + 1 }),
      );
    });

    const snapAfter = getSessionWorkingSnapshot();
    // Map reference unchanged because notify was skipped
    expect(snapAfter).toBe(snapBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — publishFleetStatusSessionGone on unknown key is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test H — gone on unknown key is a no-op", () => {
  it("publishFleetStatusSessionGone on unknown key does not throw", () => {
    expect(() => {
      publishFleetStatusSessionGone("unknown-host", "unknown-session", "no-sess-id");
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I — Unknown key → useSessionIsWorking returns false
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test I — unknown key returns false", () => {
  it("useSessionIsWorking on a never-published key returns false", () => {
    const { result } = renderHook(() =>
      useSessionIsWorking("never-set"),
    );
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test J — Null key → false, no subscribe
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test J — null key short-circuits to false", () => {
  it("useSessionIsWorking(null) returns false (short-circuit)", () => {
    const { result } = renderHook(() => useSessionIsWorking(null));
    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K — Multiple keys are independent
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test K — multiple keys are independent", () => {
  it("publishing to key A does NOT alter key B's composite state", () => {
    const { result: a, rerender: rerenderA } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );
    const { result: b, rerender: rerenderB } = renderHook(() =>
      useSessionIsWorking("h2:s2"),
    );

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ hostId: "h1", tmuxSession: "s1", status: "busy" }));
      publishFleetStatusSessionState(
        "h2",
        makeState({
          hostId: "h2",
          tmuxSession: "s2",
          status: "idle",
          backgroundTasks: [{ id: "bt", type: "subagent", status: "running" }],
        }),
      );
    });
    rerenderA();
    rerenderB();

    expect(a.current).toBe(true);
    expect(b.current).toBe(true);

    // Clear key A
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ hostId: "h1", tmuxSession: "s1", status: "idle", backgroundTasks: [] }),
      );
    });
    rerenderA();
    rerenderB();
    expect(a.current).toBe(false);
    expect(b.current).toBe(true); // key B unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test L — Source-level grep: retired functions NOT in test file
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test L — retired functions not imported in test file", () => {
  it("retired feeder symbols do not appear in import statements of this test file", () => {
    const src = readFileSync(
      resolve(__dirname, "session-working-store.test.ts"),
      "utf8",
    );
    // Only check import lines — that's where forbidden symbols would be imported.
    // String literals in test descriptions and token-split assignments are intentional.
    const importLines = src
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");

    // Use token split to avoid self-matching in THIS file's source text
    const retiredA = "publish" + "SessionTtyBusy";
    const retiredB = "publish" + "SessionHas" + "BackgroundedWork";

    expect(importLines.includes(retiredA)).toBe(false);
    expect(importLines.includes(retiredB)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests M–Q — useSessionIsWorkingRaw (Phase 41 Plan 01, Task 1)
// The "raw" three-state hook that distinguishes "never published" from
// "published idle". Delta from useSessionIsWorking: unknown-key → null (NOT
// false). This distinction is load-bearing for PrettyView's aside-arm gate.
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test M — null key → useSessionIsWorkingRaw returns null", () => {
  it("useSessionIsWorkingRaw(null) returns null (not false)", () => {
    const { result } = renderHook(() => useSessionIsWorkingRaw(null));
    expect(result.current).toBe(null);
  });
});

describe("session-working-store: Test N — absent key → useSessionIsWorkingRaw returns null (NOT false)", () => {
  it("useSessionIsWorkingRaw on a never-published key returns null", () => {
    const { result } = renderHook(() =>
      useSessionIsWorkingRaw("never-published-host:s1"),
    );
    // CRITICAL: must be null, not false — this is the three-state distinction
    expect(result.current).toBe(null);
  });
});

describe("session-working-store: Test O — idle publish → useSessionIsWorkingRaw returns false", () => {
  it("after publishFleetStatusSessionState with status:'idle', raw hook returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorkingRaw("h1:s1"),
    );
    expect(result.current).toBe(null); // not yet published

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "idle", backgroundTasks: [] }));
    });
    rerender();
    expect(result.current).toBe(false); // published + idle
  });
});

describe("session-working-store: Test P — busy publish → useSessionIsWorkingRaw returns true", () => {
  it("after publishFleetStatusSessionState with status:'busy', raw hook returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorkingRaw("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "busy" }));
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

describe("session-working-store: Test Q — session-gone → useSessionIsWorkingRaw returns null again", () => {
  it("after publishFleetStatusSessionGone, raw hook returns null (key deleted)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorkingRaw("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState("h1", makeState({ status: "busy" }));
    });
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      publishFleetStatusSessionGone("h1", "s1", "sess-1");
    });
    rerender();
    // Key is deleted → null again (not false — truly absent)
    expect(result.current).toBe(null);
  });
});
