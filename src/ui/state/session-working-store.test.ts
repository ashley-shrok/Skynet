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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  publishFleetStatusSessionState,
  publishFleetStatusSessionGone,
  useSessionIsWorking,
  useSessionIsWorkingRaw,
  getSessionWorkingSnapshot,
  getSessionLastMessageAt,
  seedSessionLastMessageAt,
  seedSessionAiTitle,
  getSessionAiTitle,
  useSessionAiTitle,
  subscribeSessionWorkingStore,
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 Plan 03 — Reconciliation chokepoint (max-wins) + seed API + single-
// chokepoint routing (2 axes → 2 notifies on co-change frames).
//
// Test 1 (seed-only): seedSessionLastMessageAt writes + creates dormant record.
// Test 2 (WS-only, no prior seed): publish writes lastMessageAt.
// Test 3 (seed then WS newer): max-wins allows advance.
// Test 4 (WS then seed newer): max-wins allows advance; isWorking preserved.
// Test 5 (seed then WS older — no regression): max-wins holds; isWorking flips.
// Test 6 (WS then seed older — no regression): max-wins holds.
// Test 7 (seed null — no-op): no record created; cache stays empty.
// Test 8 (WS null after cached advance — no regression): cached value preserved.
// Test 9 (identical ts seed → no double-notify): notify count locked.
// Test 10 (seed-only-created record isWorking:false — dormant default).
// Test 11 (key-format contract for seedSessionLastMessageAt).
// Test 12 (publishFleetStatusSessionGone still deletes with lastMessageAt cached).
// Test 13 (single-chokepoint notify: WS Axis B only → +1).
// Test 14 (single-chokepoint notify: WS Axis A only → +1; max-wins preserves cache).
// Test 15 (single-chokepoint notify: co-change frame → +2 — LOAD-BEARING).
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store (Phase 44 Plan 03): reconciliation chokepoint — max-wins + seed API + single-chokepoint routing", () => {
  // Test 1 — seed-only writes cached value + creates dormant record
  it("Test 1 (seed-only): seedSessionLastMessageAt(1, 'tina', 1000) → cache reads 1000; record isWorking:false", () => {
    seedSessionLastMessageAt(1, "tina", 1000);
    expect(getSessionLastMessageAt("1:tina")).toBe(1000);

    const snap = getSessionWorkingSnapshot();
    const record = snap.get("1:tina");
    expect(record).toBeDefined();
    expect(record?.isWorking).toBe(false);
    expect(record?.lastMessageAt).toBe(1000);
  });

  // Test 2 — WS-only, no prior seed: publish writes lastMessageAt via Axis B
  it("Test 2 (WS-only): publishFleetStatusSessionState with lastMessageAt:1000 → cache reads 1000", () => {
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );
    expect(getSessionLastMessageAt("1:tina")).toBe(1000);
    const record = getSessionWorkingSnapshot().get("1:tina");
    expect(record?.isWorking).toBe(false);
  });

  // Test 3 — seed then WS newer → advance
  it("Test 3 (seed then WS newer): seed=1000, WS=2000 → cache reads 2000", () => {
    seedSessionLastMessageAt(1, "tina", 1000);
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 2000,
      }),
    );
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    // isWorking reflects the WS frame's derived value (main = busy → true)
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
  });

  // Test 4 — WS then seed newer → advance; isWorking preserved from WS frame
  it("Test 4 (WS then seed newer): WS=1000 busy, seed=2000 → cache reads 2000; isWorking preserved true", () => {
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );
    seedSessionLastMessageAt(1, "tina", 2000);
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    // Seed does NOT touch isWorking axis — preserved from WS frame
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
  });

  // Test 5 — seed then WS older → max-wins holds (cache stays fresher)
  it("Test 5 (seed then WS older — no regression): seed=2000, WS=1000 → cache stays 2000", () => {
    seedSessionLastMessageAt(1, "tina", 2000);
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );
    // max-wins preserved
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    // isWorking axis is NOT subject to max-wins — reflects WS frame's derived value
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
  });

  // Test 6 — WS then seed older → max-wins holds
  it("Test 6 (WS then seed older — no regression): WS=2000, seed=1000 → cache stays 2000", () => {
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 2000,
      }),
    );
    seedSessionLastMessageAt(1, "tina", 1000);
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
  });

  // Test 7 — seed null on empty cache → no-op, no record created
  it("Test 7 (seed null — no-op): seed(hostId, tmux, null) with empty cache → cache stays empty", () => {
    seedSessionLastMessageAt(1, "tina", null);
    expect(getSessionLastMessageAt("1:tina")).toBe(null);
    expect(getSessionWorkingSnapshot().size).toBe(0);
  });

  // Test 8 — WS with null lastMessageAt after cached advance → no regression
  it("Test 8 (WS null after cached advance — no regression): seed=2000, WS lastMessageAt:null → cache stays 2000", () => {
    seedSessionLastMessageAt(1, "tina", 2000);
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        // lastMessageAt omitted → undefined → normalized to null in publish
      }),
    );
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
  });

  // Test 9 — identical seed ts → no double-notify
  it("Test 9 (identical ts seed → no double-notify): two seeds w/ ts=1000, listener fires once", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    seedSessionLastMessageAt(1, "tina", 1000);
    seedSessionLastMessageAt(1, "tina", 1000);

    // First seed writes + notifies; second is max-wins no-op + no-notify.
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });

  // Test 10 — seed-only-created record has isWorking:false (dormant default)
  it("Test 10 (isWorking axis on seed-only-created record): new key via seed → record.isWorking === false", () => {
    seedSessionLastMessageAt(42, "fresh", 1000);
    const record = getSessionWorkingSnapshot().get("42:fresh");
    expect(record).toBeDefined();
    expect(record?.isWorking).toBe(false);
  });

  // Test 11 — key-format contract
  it("Test 11 (seedSessionLastMessageAt key-format contract): hostId=42, tmux='my-session' → key '42:my-session'", () => {
    seedSessionLastMessageAt(42, "my-session", 1000);
    // Exact key format `${String(hostId)}:${tmuxSession}` matches getSessionLastMessageAt's consumer format
    expect(getSessionLastMessageAt("42:my-session")).toBe(1000);
    expect(getSessionWorkingSnapshot().has("42:my-session")).toBe(true);
  });

  // Test 12 — publishFleetStatusSessionGone still deletes even with lastMessageAt cached
  it("Test 12 (gone-frame regression lock): seed=1000, then gone → record removed; getSessionLastMessageAt null", () => {
    seedSessionLastMessageAt(1, "tina", 1000);
    expect(getSessionLastMessageAt("1:tina")).toBe(1000);

    publishFleetStatusSessionGone("1", "tina", "sess-1");

    expect(getSessionLastMessageAt("1:tina")).toBe(null);
    expect(getSessionWorkingSnapshot().has("1:tina")).toBe(false);
  });

  // Test 13 — single-chokepoint notify: Axis B only (isWorking unchanged, lastMessageAt advances)
  it("Test 13 (Axis B only — WS unchanged isWorking + fresher lastMessageAt): notify count += 1", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // Pre-populate: idle + lastMessageAt=1000
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );
    const n0 = cb.mock.calls.length;

    // Trigger under test: SAME isWorking (idle → false), FRESHER lastMessageAt
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 2000,
      }),
    );

    // Axis A no-ops (isWorking unchanged); Axis B fires (advanceSessionLastMessageAt writes + notifies)
    expect(cb.mock.calls.length).toBe(n0 + 1);
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    dispose();
  });

  // Test 14 — single-chokepoint notify: Axis A only (isWorking changes, lastMessageAt stale)
  it("Test 14 (Axis A only — WS changed isWorking + stale lastMessageAt): notify count += 1; cache preserved", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // Pre-populate: idle + lastMessageAt=2000
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 2000,
      }),
    );
    const n0 = cb.mock.calls.length;

    // Trigger under test: CHANGED isWorking (busy → true), STALE lastMessageAt
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );

    // Axis A fires swap-and-notify (isWorking changed); Axis B no-ops (ts not fresher)
    expect(cb.mock.calls.length).toBe(n0 + 1);
    // max-wins preserved cached value
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    // isWorking axis updated
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
    dispose();
  });

  // Test 15 — LOAD-BEARING single-chokepoint notify: both axes fire (2 notifies)
  it("Test 15 (LOAD-BEARING: co-change frame — changed isWorking AND fresher lastMessageAt): notify count += 2", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // Pre-populate: idle + lastMessageAt=1000
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
      }),
    );
    const n0 = cb.mock.calls.length;

    // Trigger under test: CHANGED isWorking (busy → true) AND FRESHER lastMessageAt
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 2000,
      }),
    );

    // Axis A + Axis B both fire → 2 notifies. This is the correct observable contract of
    // the single-chokepoint architecture (Phase 44 Plan 03 § single-chokepoint architecture);
    // any future refactor that collapses the two axes into an atomic-swap-then-notify-once
    // path — the pattern CONTEXT.md § Reconciliation helper prohibits — would fail this test.
    expect(cb.mock.calls.length).toBe(n0 + 2);
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
    dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 47 Plan 03 — Reconciliation chokepoint (LAST-WINS for aiTitle) + seed
// API + three-axis single-chokepoint routing (3 axes → 3 notifies on
// co-change frames). Extends the Phase 44 Plan 03 two-axes-two-notifies
// contract to three axes. LAST-WINS distinct from lastMessageAt's max-wins
// because ai-title EVOLVES: as the session's topic drifts across turns, the
// freshest ARRIVAL is the correct value — strings have no numeric ordering.
//
// Test 1 (seed-only): seedSessionAiTitle writes + creates dormant record.
// Test 2 (WS-only, no prior seed): publish writes aiTitle via Axis C.
// Test 3 (seed then WS newer, LAST-WINS): WS string overwrites seed string.
// Test 4 (WS then seed newer, LAST-WINS): seed overwrites WS; isWorking preserved.
// Test 5 (seed then WS "older", LAST-WINS regardless): WS wins by arrival order.
// Test 6 (seed null — no-op): no record created; cache stays empty.
// Test 7 (WS null after cached string — no regression): null does NOT overwrite.
// Test 8 (identical string seed → no double-notify): Object.is guard locks it.
// Test 9 (seed-created record isWorking:false + lastMessageAt:null — dormant defaults).
// Test 10 (key-format contract for seedSessionAiTitle).
// Test 11 (gone-frame regression lock): seed=X then gone → record removed; cache null.
// Test 12 (single-chokepoint notify: WS Axis C only → +1).
// Test 13 (LOAD-BEARING single-chokepoint notify: co-change frame → +3).
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store (Phase 47 Plan 03): reconciliation chokepoint — last-wins + seed API + three-axis single-chokepoint routing", () => {
  // Test 1 — seed-only writes cached value + creates dormant record
  it("Test 1 (seed-only): seedSessionAiTitle(1, 'tina', 'Fix bug X') → cache reads 'Fix bug X'; record isWorking:false + lastMessageAt:null", () => {
    seedSessionAiTitle(1, "tina", "Fix bug X");
    expect(getSessionAiTitle("1:tina")).toBe("Fix bug X");

    const snap = getSessionWorkingSnapshot();
    const record = snap.get("1:tina");
    expect(record).toBeDefined();
    expect(record?.isWorking).toBe(false);
    expect(record?.lastMessageAt).toBe(null);
    expect(record?.aiTitle).toBe("Fix bug X");
  });

  // Test 2 — WS-only, no prior seed: publish writes aiTitle via Axis C
  it("Test 2 (WS-only): publishFleetStatusSessionState with aiTitle:'Fix bug X' → cache reads 'Fix bug X'", () => {
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        aiTitle: "Fix bug X",
      }),
    );
    expect(getSessionAiTitle("1:tina")).toBe("Fix bug X");
    const record = getSessionWorkingSnapshot().get("1:tina");
    expect(record?.isWorking).toBe(false);
    expect(record?.aiTitle).toBe("Fix bug X");
  });

  // Test 3 — seed then WS newer → LAST-WINS: WS string overwrites seed string
  it("Test 3 (seed then WS newer, LAST-WINS): seed='Debug X', WS='Fix Y' → cache reads 'Fix Y'", () => {
    seedSessionAiTitle(1, "tina", "Debug X");
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        aiTitle: "Fix Y",
      }),
    );
    expect(getSessionAiTitle("1:tina")).toBe("Fix Y");
    // isWorking reflects the WS frame's derived value (main = busy → true)
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
  });

  // Test 4 — WS then seed newer → LAST-WINS: seed overwrites WS; isWorking preserved from WS frame
  it("Test 4 (WS then seed newer, LAST-WINS): WS='Debug X' busy, seed='Fix Y' → cache reads 'Fix Y'; isWorking:true preserved", () => {
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        aiTitle: "Debug X",
      }),
    );
    seedSessionAiTitle(1, "tina", "Fix Y");
    expect(getSessionAiTitle("1:tina")).toBe("Fix Y");
    // Seed does NOT touch isWorking axis — preserved from WS frame
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
  });

  // Test 5 — seed then WS "older" (by pretend chronology): LAST-WINS applies regardless
  it("Test 5 (seed then WS 'older' — LAST-WINS applies regardless): seed='Fix Y', WS='Debug X' → cache reads 'Debug X'", () => {
    // Ai-title is LAST-WINS (not max-wins like lastMessageAt) because strings have no
    // numeric ordering — the freshest ARRIVAL is the correct value. Ashley 2026-08-19:
    // "If WS says Debug X and later WS says Fix Y, we want Fix Y".
    seedSessionAiTitle(1, "tina", "Fix Y");
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        aiTitle: "Debug X",
      }),
    );
    // LAST-WINS: WS arrived after seed, so WS wins even though its string is not "newer" in any
    // chronological sense. THIS IS THE KEY DIFFERENCE FROM MAX-WINS lastMessageAt.
    expect(getSessionAiTitle("1:tina")).toBe("Debug X");
  });

  // Test 6 — seed null on empty cache → no-op, no record created
  it("Test 6 (seed null — no-op): seed(hostId, tmux, null) with empty cache → cache stays empty", () => {
    seedSessionAiTitle(1, "tina", null);
    expect(getSessionAiTitle("1:tina")).toBe(null);
    expect(getSessionWorkingSnapshot().size).toBe(0);
  });

  // Test 7 — WS with null aiTitle after cached string → no regression (LAST-WINS null-no-op)
  it("Test 7 (WS null after cached string — no regression): seed='Fix Y', WS aiTitle:null → cache stays 'Fix Y'", () => {
    seedSessionAiTitle(1, "tina", "Fix Y");
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        // aiTitle omitted → undefined → normalized to null in publish → Axis C no-op
      }),
    );
    // Invariant 1: null does NOT overwrite an existing string (fail-open guard).
    expect(getSessionAiTitle("1:tina")).toBe("Fix Y");
  });

  // Test 8 — identical string seed → no double-notify (Object.is guard)
  it("Test 8 (identical string seed → no double-notify): two seeds w/ title='X', listener fires once", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    seedSessionAiTitle(1, "tina", "X");
    seedSessionAiTitle(1, "tina", "X");

    // First seed writes + notifies; second is Object.is no-op + no-notify.
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });

  // Test 9 — seed-only-created record has isWorking:false + lastMessageAt:null (dormant defaults)
  it("Test 9 (dormant defaults on seed-only-created record): seed → record.isWorking===false, lastMessageAt===null", () => {
    seedSessionAiTitle(42, "fresh", "Some topic");
    const record = getSessionWorkingSnapshot().get("42:fresh");
    expect(record).toBeDefined();
    expect(record?.isWorking).toBe(false);
    expect(record?.lastMessageAt).toBe(null);
    expect(record?.aiTitle).toBe("Some topic");
  });

  // Test 10 — key-format contract
  it("Test 10 (seedSessionAiTitle key-format contract): hostId=42, tmux='my-session' → key '42:my-session'", () => {
    seedSessionAiTitle(42, "my-session", "X");
    // Exact key format `${String(hostId)}:${tmuxSession}` matches getSessionAiTitle's consumer format
    expect(getSessionAiTitle("42:my-session")).toBe("X");
    expect(getSessionWorkingSnapshot().has("42:my-session")).toBe(true);
  });

  // Test 11 — publishFleetStatusSessionGone still deletes even with aiTitle cached
  it("Test 11 (gone-frame regression lock): seed='X' then gone → record removed; getSessionAiTitle null", () => {
    seedSessionAiTitle(1, "tina", "X");
    expect(getSessionAiTitle("1:tina")).toBe("X");

    publishFleetStatusSessionGone("1", "tina", "sess-1");

    expect(getSessionAiTitle("1:tina")).toBe(null);
    expect(getSessionWorkingSnapshot().has("1:tina")).toBe(false);
  });

  // Test 12 — single-chokepoint notify: Axis C only (isWorking unchanged, lastMessageAt unchanged, aiTitle changes)
  it("Test 12 (Axis C only — WS unchanged isWorking + unchanged lastMessageAt + changed aiTitle): notify count += 1", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // Pre-populate: idle + lastMessageAt=1000 + aiTitle='A'
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
        aiTitle: "A",
      }),
    );
    const n0 = cb.mock.calls.length;

    // Trigger under test: SAME isWorking (idle → false), SAME lastMessageAt, DIFFERENT aiTitle
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
        aiTitle: "B",
      }),
    );

    // Axis A no-ops (isWorking unchanged); Axis B no-ops (ts unchanged);
    // Axis C fires (advanceSessionAiTitle writes + notifies).
    expect(cb.mock.calls.length).toBe(n0 + 1);
    expect(getSessionAiTitle("1:tina")).toBe("B");
    dispose();
  });

  // Test 13 — LOAD-BEARING single-chokepoint notify: all three axes fire (3 notifies)
  it("Test 13 (LOAD-BEARING: three-axis co-change frame — changed isWorking AND fresher lastMessageAt AND changed aiTitle): notify count += 3", () => {
    // Load-bearing lock for the THREE-axis single-chokepoint architecture (extends
    // Phase 44 Plan 03 Test 15's n0+2 to n0+3). Would fail under any
    // atomic-swap-then-notify-once implementation. See 47-CONTEXT.md § Working-store third axis.
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // Pre-populate: idle + lastMessageAt=1000 + aiTitle='A'
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "idle",
        backgroundTasks: [],
        lastMessageAt: 1000,
        aiTitle: "A",
      }),
    );
    const n0 = cb.mock.calls.length;

    // Trigger under test: CHANGED isWorking (busy → true) AND FRESHER lastMessageAt AND CHANGED aiTitle
    publishFleetStatusSessionState(
      "1",
      makeState({
        hostId: "1",
        tmuxSession: "tina",
        status: "busy",
        backgroundTasks: [],
        lastMessageAt: 2000,
        aiTitle: "B (drifted)",
      }),
    );

    // Axis A + Axis B + Axis C all fire → 3 notifies. This is the correct observable
    // contract of the three-axis single-chokepoint architecture (Phase 47 Plan 03
    // § Working-store third axis); any future refactor that collapses the three axes
    // into an atomic-swap-then-notify-once path would fail this test.
    expect(cb.mock.calls.length).toBe(n0 + 3);
    expect(getSessionAiTitle("1:tina")).toBe("B (drifted)");
    expect(getSessionLastMessageAt("1:tina")).toBe(2000);
    expect(getSessionWorkingSnapshot().get("1:tina")?.isWorking).toBe(true);
    dispose();
  });

  // Test 14 (hook parity) — useSessionAiTitle short-circuits and reads cached value
  it("Test 14 (hook parity): useSessionAiTitle(null) → null; useSessionAiTitle(unknown) → null; useSessionAiTitle(known) → cached value", () => {
    // null key short-circuit
    const { result: r1 } = renderHook(() => useSessionAiTitle(null));
    expect(r1.current).toBe(null);

    // unknown key
    const { result: r2 } = renderHook(() => useSessionAiTitle("nope:key"));
    expect(r2.current).toBe(null);

    // known key — seed then read via hook
    seedSessionAiTitle(1, "tina", "Wired via hook");
    const { result: r3, rerender } = renderHook(() => useSessionAiTitle("1:tina"));
    rerender();
    expect(r3.current).toBe("Wired via hook");
  });
});
