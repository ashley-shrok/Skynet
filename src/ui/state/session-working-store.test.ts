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
  useSessionIsDormant,
  useSessionIsRecycling,
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
// Test B — status:'shell' + no-Stop-yet → isWorking TRUE
//   Phase 59 Plan 03 rollout-safety default-on branch
//   (SUPERSEDES inline-260823-wip-shell-is-work at the predicate boundary)
// ─────────────────────────────────────────────────────────────────────────────
// Phase 59 Plan 03 (2026-08-29) SUPERSEDES the inline-260823-wip-shell-is-work
// rule at the predicate boundary but preserves it as the FALLBACK for
// no-Stop-yet sessions. The new predicate reads
//   `main = busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))`
// so `shell` no longer counts as work unconditionally — it counts only when
// the session's status has transitioned since its last Stop-hook fire.
//
// This test now asserts the rollout-safety default-on branch: `shell` + no
// Stop-hook signal at all (fresh session, OR a lazy-rollout session that
// pre-dates the Phase 59 backend upgrade) → isWorking true. Matches
// CONTEXT.md D-05: "If we've never seen a 'turn ended' event for a session,
// treat it as if the session is still working — no evidence of any stop
// yet, so it defaults to on."
//
// The stale-shell case (shell + lastStatusChangeAt < lastStopAt — the
// Poppy/aqua/wilma pattern that motivated this phase) is covered by the
// new Test M below. The mid-turn shell case (shell + lastStatusChangeAt >
// lastStopAt, preserving the inline-260823-wip-shell-is-work truth) is
// covered by the new Test N.
//
// Deliberate revision, not deletion — 59-RESEARCH.md § Common Pitfalls
// Pitfall 8 flags "skipped Test B revision" as the EXACT bug this change
// prevents (leaving the pre-Phase-57 rule locked as a truth).

describe("session-working-store: Test B — status:'shell' + no-Stop-yet → isWorking true (Phase 59 rollout-safety default-on, supersedes inline-260823-wip-shell-is-work)", () => {
  it("shell + wire omitted lastStopAt/lastStatusChangeAt → useSessionIsWorking returns true (rollout-safety default-on per CONTEXT.md D-05)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      // makeState omits lastStopAt AND lastStatusChangeAt by default →
      // predicate normalizes both to null → default-on branch fires.
      publishFleetStatusSessionState("h1", makeState({ status: "shell" }));
    });
    rerender();
    expect(result.current).toBe(true);
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 52 Plan 01 — Dormant axis (Axis D) + useSessionIsDormant hook.
// Source: ~/.claude/identities/<tmuxSession>/.dormant sentinel file on the
// target host. Boolean strict (dormant: boolean default false in WorkingRecord).
//
// Test P52-01-i   (publish dormant:true → hook returns true)
// Test P52-01-ii  (publish dormant:false → hook returns false)
// Test P52-01-iii (publish without dormant field → hook returns false)
// Test P52-01-iv  (re-publish SAME dormant value → no additional notify beyond Axis A/B/C)
// Test P52-01-v   (toggle dormant while isWorking unchanged → notify fires)
// Test P52-01-vi  (null key → false; unknown key → false)
// Test P52-01-vii (dormant persists across Axis A (isWorking) republish)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store (Phase 52 Plan 01): dormant axis (Axis D) + useSessionIsDormant hook", () => {
  // Test P52-01-i — publish dormant:true → hook returns true
  it("Test P52-01-i: publishFleetStatusSessionState with dormant:true → useSessionIsDormant returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsDormant("h1:s1"),
    );
    expect(result.current).toBe(false); // unknown → false

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: true }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });

  // Test P52-01-ii — publish dormant:false → hook returns false
  it("Test P52-01-ii: publishFleetStatusSessionState with dormant:false → useSessionIsDormant returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsDormant("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: false }),
      );
    });
    rerender();
    expect(result.current).toBe(false);
  });

  // Test P52-01-iii — publish without dormant field → hook returns false
  it("Test P52-01-iii: publish without dormant field (omitted) → useSessionIsDormant returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsDormant("h1:s1"),
    );

    act(() => {
      // makeState omits dormant by default (undefined)
      publishFleetStatusSessionState("h1", makeState({ status: "idle" }));
    });
    rerender();
    expect(result.current).toBe(false);
  });

  // Test P52-01-iv — re-publish SAME dormant value → no additional Axis D notify
  it("Test P52-01-iv: re-publish with same dormant value (isWorking unchanged) → no additional Axis D notify beyond Axis A/B/C", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // First publish: dormant:true (sets Axis D, notifies once for Axis A + once for Axis D)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: true }),
      );
    });
    const n0 = cb.mock.calls.length; // captures Axis A + Axis D notifies

    // Second publish: SAME dormant value → Axis D must NOT notify again
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: true, updatedAt: Date.now() + 1 }),
      );
    });
    // Axis A no-ops (isWorking unchanged); Axis B no-ops (no lastMessageAt);
    // Axis C no-ops (no aiTitle); Axis D no-ops (dormant unchanged).
    expect(cb.mock.calls.length).toBe(n0);

    dispose();
  });

  // Test P52-01-v — toggle dormant (isWorking unchanged) → Axis D notify fires
  it("Test P52-01-v: toggle dormant (isWorking unchanged) → Axis D notify fires", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // First publish: dormant:false (Axis A fires for new key)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: false }),
      );
    });
    const n0 = cb.mock.calls.length;

    // Toggle dormant: false → true (isWorking unchanged at false)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: true }),
      );
    });
    // Axis D fires (dormant changed); Axis A no-ops (isWorking still false).
    expect(cb.mock.calls.length).toBe(n0 + 1);

    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.dormant).toBe(true);
    dispose();
  });

  // Test P52-01-vi — null key / unknown key → false
  it("Test P52-01-vi: null key → useSessionIsDormant returns false; unknown key → false", () => {
    const { result: r1 } = renderHook(() => useSessionIsDormant(null));
    expect(r1.current).toBe(false);

    const { result: r2 } = renderHook(() =>
      useSessionIsDormant("never-published:key"),
    );
    expect(r2.current).toBe(false);
  });

  // Test P52-01-vii — dormant preserved across Axis A (isWorking) republish
  it("Test P52-01-vii: dormant:true, then isWorking toggles → dormant still true (Axis A preserves Axis D cache)", () => {
    // Set dormant:true + idle
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", dormant: true }),
      );
    });

    // Publish again with isWorking flipping (busy → true), dormant omitted
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "busy" }), // dormant omitted → undefined → false in Axis D
      );
    });

    // After Axis A fires with isWorking=true, the cached dormant must still be preserved
    // in the Axis A write path (existing?.dormant ?? false). Since dormant was true,
    // Axis A preserves it.
    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.dormant).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 53 Plan 02 — Recycling axis (Axis E) + useSessionIsRecycling hook.
// Source: ~/.claude/identities/<tmuxSession>/.recycled-at sentinel file on the
// target host (identity being replaced via /id-reset). Boolean strict
// (`recycling: boolean` default false in WorkingRecord).
//
// Test P53-02-i   (publish recycling:true → hook returns true)
// Test P53-02-ii  (publish recycling:false → hook returns false)
// Test P53-02-iii (publish without recycling field → hook returns false)
// Test P53-02-iv  (re-publish SAME recycling value → no additional notify beyond Axis A/B/C/D)
// Test P53-02-v   (toggle recycling while isWorking unchanged → Axis E notify fires)
// Test P53-02-vi  (null key → false; unknown key → false)
// Test P53-02-vii (recycling persists across Axis A (isWorking) republish)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store (Phase 53 Plan 02): recycling axis (Axis E) + useSessionIsRecycling hook", () => {
  // Test P53-02-i — publish recycling:true → hook returns true
  it("Test P53-02-i: publishFleetStatusSessionState with recycling:true → useSessionIsRecycling returns true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsRecycling("h1:s1"),
    );
    expect(result.current).toBe(false); // unknown → false

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: true }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });

  // Test P53-02-ii — publish recycling:false → hook returns false
  it("Test P53-02-ii: publishFleetStatusSessionState with recycling:false → useSessionIsRecycling returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsRecycling("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: false }),
      );
    });
    rerender();
    expect(result.current).toBe(false);
  });

  // Test P53-02-iii — publish without recycling field → hook returns false
  it("Test P53-02-iii: publish without recycling field (omitted) → useSessionIsRecycling returns false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsRecycling("h1:s1"),
    );

    act(() => {
      // makeState omits recycling by default (undefined)
      publishFleetStatusSessionState("h1", makeState({ status: "idle" }));
    });
    rerender();
    expect(result.current).toBe(false);
  });

  // Test P53-02-iv — re-publish SAME recycling value → no additional Axis E notify
  it("Test P53-02-iv: re-publish with same recycling value (isWorking unchanged) → no additional Axis E notify beyond Axis A/B/C/D", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // First publish: recycling:true (sets Axis E, notifies once for Axis A + once for Axis E)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: true }),
      );
    });
    const n0 = cb.mock.calls.length; // captures Axis A + Axis E notifies

    // Second publish: SAME recycling value and bumped updatedAt → Axis E must NOT notify again
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: true, updatedAt: Date.now() + 1 }),
      );
    });
    // Axis A no-ops (isWorking unchanged); Axis B no-ops (no lastMessageAt);
    // Axis C no-ops (no aiTitle); Axis D no-ops (no dormant); Axis E no-ops (recycling unchanged).
    expect(cb.mock.calls.length).toBe(n0);

    dispose();
  });

  // Test P53-02-v — toggle recycling (isWorking unchanged) → Axis E notify fires
  it("Test P53-02-v: toggle recycling (isWorking unchanged) → Axis E notify fires", () => {
    const cb = vi.fn();
    const dispose = subscribeSessionWorkingStore(cb);

    // First publish: recycling:false (Axis A fires for new key)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: false }),
      );
    });
    const n0 = cb.mock.calls.length;

    // Toggle recycling: false → true (isWorking unchanged at false)
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: true }),
      );
    });
    // Axis E fires (recycling changed); Axis A no-ops (isWorking still false).
    expect(cb.mock.calls.length).toBe(n0 + 1);

    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.recycling).toBe(true);
    dispose();
  });

  // Test P53-02-vi — null key / unknown key → false
  it("Test P53-02-vi: null key → useSessionIsRecycling returns false; unknown key → false", () => {
    const { result: r1 } = renderHook(() => useSessionIsRecycling(null));
    expect(r1.current).toBe(false);

    const { result: r2 } = renderHook(() =>
      useSessionIsRecycling("never-published:key"),
    );
    expect(r2.current).toBe(false);
  });

  // Test P53-02-vii — recycling preserved across Axis A (isWorking) republish
  it("Test P53-02-vii: recycling:true, then isWorking toggles → recycling still true (Axis A preserves Axis E cache)", () => {
    // Set recycling:true + idle
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle", recycling: true }),
      );
    });

    // Publish again with isWorking flipping (busy → true), recycling omitted
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "busy" }), // recycling omitted → undefined → Axis E no-ops
      );
    });

    // After Axis A fires with isWorking=true, the cached recycling must still be preserved
    // in the Axis A write path (existing?.recycling ?? false). Since recycling was true,
    // Axis A preserves it. This is the Pitfall-3 defense test.
    const snap = getSessionWorkingSnapshot();
    expect(snap.get("h1:s1")?.recycling).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 59 Plan 03 — Shell-idle stop-gate canonical cases + Pitfall-3 guard.
// Four new tests locking the revised `main` predicate:
//
//   main = busy || (shell && (lastStopAt === null
//                             || lastStatusChangeAt > lastStopAt))
//
// Test M: shell + STALE stop (Poppy/aqua/wilma pattern) → isWorking FALSE
//         — the very false-positive that motivated this phase.
// Test N: shell + FRESH status-change (mid-turn) → isWorking TRUE
//         — preserves the inline-260823-wip-shell-is-work truth for real work.
// Test O: busy always wins regardless of lastStopAt/lastStatusChangeAt ordering
//         — busy bypasses the stop-gate unconditionally.
// Test P: Axis-A republish PRESERVES cached lastStopAt (Pitfall-3 regression
//         guard — snapshot inspection, NOT useSessionIsWorking shortcut).
//
// Test B above was REVISED (not deleted) to cover the rollout-safety default-on
// branch (shell + no-Stop-yet → true) — the "lazy rollout" case per
// CONTEXT.md D-05. Deliberate revision, not skip — 59-RESEARCH.md § Common
// Pitfalls Pitfall 8 flags "skipped Test B revision" as the EXACT bug this
// change prevents.
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store: Test M — status:'shell' + stale stop (Poppy/aqua/wilma pattern) → isWorking FALSE", () => {
  it("shell with lastStatusChangeAt strictly less than lastStopAt → false (stale-shell)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      // Transitioned to shell at t=1000, then Stop fired at t=5000 — status
      // has NOT moved since the last Stop, so shell is stale post-turn state.
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          lastStopAt: 5000,
          lastStatusChangeAt: 1000,
        }),
      );
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

describe("session-working-store: Test N — status:'shell' + fresh status-change (mid-turn) → isWorking TRUE", () => {
  it("shell with lastStatusChangeAt strictly greater than lastStopAt → true (real mid-turn shell)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      // Stop fired at t=1000; status transitioned to shell at t=5000 — the
      // turn is still running. Preserves the inline-260823-wip-shell-is-work
      // truth for real mid-turn shell (busy ↔ shell oscillation during work).
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          lastStopAt: 1000,
          lastStatusChangeAt: 5000,
        }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

describe("session-working-store: Test O — status:'busy' bypasses stop-gate → isWorking TRUE regardless of stop ordering", () => {
  it("busy with lastStatusChangeAt strictly less than lastStopAt → true (busy is unconditional)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      // Stale even by shell rules — but busy bypasses the stop-gate entirely.
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          lastStopAt: 5000,
          lastStatusChangeAt: 1000,
        }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });
});

describe("session-working-store: Test P — Axis A republish PRESERVES cached lastStopAt (Phase 59 Pitfall-3 regression guard)", () => {
  it("publishing an isWorking-flipping frame without lastStopAt preserves the cached lastStopAt", () => {
    // Load-bearing snapshot-inspection test (NOT a useSessionIsWorking
    // shortcut) — the useSessionIsWorking hook would return the correct
    // `false` on the second frame regardless of whether Axis A preserved
    // lastStopAt (idle → main false → isWorking false). Snapshot inspection
    // is what catches the Pitfall-3 bug: an Axis-A isWorking flip that
    // WIPES lastStopAt from cache would still yield the right isWorking
    // value but silently break subsequent frames that need lastStopAt to
    // decide shellCountsAsWork.

    // Frame 1: shell + fresh mid-turn state → isWorking:true, both axes cached.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          lastStopAt: 1000,
          lastStatusChangeAt: 5000,
        }),
      );
    });

    const snapBefore = getSessionWorkingSnapshot();
    expect(snapBefore.get("h1:s1")?.lastStopAt).toBe(1000);
    expect(snapBefore.get("h1:s1")?.lastStatusChangeAt).toBe(5000);
    expect(snapBefore.get("h1:s1")?.isWorking).toBe(true);

    // Frame 2: idle + wire omits BOTH stop-gate axes → Axis A fires
    // (isWorking flips true → false); Axes F/G no-op (both wire values
    // undefined). Cache MUST preserve the previous lastStopAt and
    // lastStatusChangeAt via the Axis A `existing?.lastStopAt ?? null`
    // guards added in Task 1.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle" }), // both stop-gate axes omitted
      );
    });

    const snapAfter = getSessionWorkingSnapshot();
    // Pitfall-3 regression guards: both cached values survive the Axis A flip.
    expect(snapAfter.get("h1:s1")?.lastStopAt).toBe(1000);
    expect(snapAfter.get("h1:s1")?.lastStatusChangeAt).toBe(5000);
    // Axis A did fire correctly (isWorking flipped).
    expect(snapAfter.get("h1:s1")?.isWorking).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 62 Plan 04 (WIP hook-based rewrite 2026-08-30) — direct-signal
// predicate + fallback branch + Pitfall-3 preservation for Axes H/I + bg
// axis retirement in the direct-signal branch (with byte-for-byte fallback
// branch preservation per CONTEXT.md §Rollout Option 1) + Nelly oscillation
// reproducer (§Philosophy end-to-end proof).
//
// Test key (see 62-04-PLAN.md <task 3>):
//   Test A: activity > stopped → true (direct-signal branch, status="shell"
//     to prove the predicate doesn't depend on status).
//   Test B: activity < stopped → false (direct-signal branch, status="busy"
//     to prove the predicate doesn't depend on status).
//   Test C: activity == stopped → false (strict >, not >=).
//   Test D: activity present, stopped null → true.
//   Test E: activity null, stopped present → false.
//   Test F: both null + status="busy" → fallback branch true.
//   Test G: both null + shell + lastStatusChangeAt > lastStopAt → fallback true.
//   Test H: both null + shell + stale → fallback false.
//   Test I: DIRECT-SIGNAL branch, bg=true → isWorking=false (bg dropped from
//     composition in the direct-signal branch per CONTEXT.md §Philosophy).
//   Test J: FALLBACK branch, bg=true → isWorking=true (bg PRESERVED byte-for-
//     byte per CONTEXT.md §Rollout Option 1's zero-behavior-change promise).
//     This is the primary regression guard for plan-review HIGH #1.
//   Test K: Axis H Pitfall-3 preservation across Axis-A republish.
//   Test L: Axis I Pitfall-3 preservation across Axis-A republish.
//   Test M: Axis H explicit-null reset (wire=null overwrites cache to null).
//   Test N: Axis I explicit-null reset (wire=null overwrites cache to null).
//   Test O: Nelly 6-frame oscillation reproducer — CORE test. Proves both
//     the false-positive fix AND the "PermissionRequest = done" design
//     choice from §Philosophy (frame 4 stays false because the permission
//     request bumps the stopped marker via stopped-hook.sh).
//   Test P: Direct-signal branch takes precedence over fallback branch when
//     any marker mtime is a number (even if fallback branch would say true).
// ─────────────────────────────────────────────────────────────────────────────

describe("session-working-store (Phase 62 Plan 04): direct-signal predicate", () => {
  // Test A — activity > stopped → true (predicate does NOT depend on status)
  it("Phase 62 Task 3 Test A: activityMtime=2000, stoppedMtime=1000, status='shell' → useSessionIsWorking true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          activityMtime: 2000,
          stoppedMtime: 1000,
        }),
      );
    });
    rerender();
    // Direct-signal branch: activity > stopped → true regardless of status.
    // Deliberately using status="shell" to prove the direct-signal predicate
    // does NOT depend on status (unlike the Phase 59 fallback which does).
    expect(result.current).toBe(true);
  });

  // Test B — activity < stopped → false (predicate does NOT depend on status)
  it("Phase 62 Task 3 Test B: activityMtime=1000, stoppedMtime=2000, status='busy' → useSessionIsWorking false", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          activityMtime: 1000,
          stoppedMtime: 2000,
        }),
      );
    });
    rerender();
    // Direct-signal branch: stopped > activity → false regardless of status.
    // Deliberately using status="busy" to prove the direct-signal predicate
    // does NOT depend on status (unlike the Phase 59 fallback where busy is
    // unconditional).
    expect(result.current).toBe(false);
  });

  // Test C — activity == stopped → false (strict >, not >=)
  it("Phase 62 Task 3 Test C: activityMtime=1000, stoppedMtime=1000 → useSessionIsWorking false (strict >, not >=)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 1000,
          stoppedMtime: 1000,
        }),
      );
    });
    rerender();
    // Strict >: equal collapses to false — activity must beat the latest stop.
    expect(result.current).toBe(false);
  });

  // Test D — activity present, stopped null → true
  it("Phase 62 Task 3 Test D: activityMtime=1000, stoppedMtime=null → useSessionIsWorking true (activity-only observed)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 1000,
          stoppedMtime: null,
        }),
      );
    });
    rerender();
    // Activity observed, no stop yet → row deserves Ashley's attention.
    expect(result.current).toBe(true);
  });

  // Test E — activity null, stopped present → false
  it("Phase 62 Task 3 Test E: activityMtime=null, stoppedMtime=1000 → useSessionIsWorking false (stop-only observed)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          activityMtime: null,
          stoppedMtime: 1000,
        }),
      );
    });
    rerender();
    // Only stop observed → row does NOT deserve attention right now.
    // status="busy" is deliberately used to prove the direct-signal branch
    // supersedes the Phase 59 predicate: the fallback branch would say true
    // (busy → main true) but the direct-signal branch says false and wins.
    expect(result.current).toBe(false);
  });

  // Test P — direct-signal branch takes precedence over fallback branch
  it("Phase 62 Task 3 Test P: activityMtime=1000 + stoppedMtime=2000 + fallback-would-say-true fields → isWorking false (direct-signal branch wins)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          // Direct-signal branch: stopped > activity → false.
          activityMtime: 1000,
          stoppedMtime: 2000,
          // Fallback branch would say TRUE if it ran (status=busy → main
          // true), but the fallback branch does NOT execute because at least
          // one mtime is a number.
          lastStopAt: null,
          lastStatusChangeAt: 999,
        }),
      );
    });
    rerender();
    // Direct-signal branch precedence: at least one mtime is a number, so the
    // fallback branch is bypassed even though it would have said true.
    expect(result.current).toBe(false);
  });
});

describe("session-working-store (Phase 62 Plan 04): fallback branch (Option-1 rollout — unupgraded box)", () => {
  // Test F — both null + status='busy' → fallback true
  it("Phase 62 Task 3 Test F: activityMtime=undefined + stoppedMtime=undefined + status='busy' → fallback branch → true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      // makeState omits activityMtime + stoppedMtime + lastStopAt +
      // lastStatusChangeAt entirely (all undefined) → both mtimes null →
      // fallback branch fires. status="busy" → main=true → isWorking=true.
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "busy" }),
      );
    });
    rerender();
    expect(result.current).toBe(true);
  });

  // Test G — both null + shell fresh transition → fallback true
  it("Phase 62 Task 3 Test G: both null + status='shell' + lastStatusChangeAt > lastStopAt → fallback branch → true", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          lastStopAt: 1000,
          lastStatusChangeAt: 2000,
        }),
      );
    });
    rerender();
    // Fallback branch's fresh-mid-turn-shell case (preserves the Phase 59
    // inline-260823-wip-shell-is-work truth for unupgraded boxes).
    expect(result.current).toBe(true);
  });

  // Test H — both null + shell stale → fallback false
  it("Phase 62 Task 3 Test H: both null + status='shell' + lastStatusChangeAt < lastStopAt → fallback branch → false (Poppy/aqua/wilma pattern)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          lastStopAt: 2000,
          lastStatusChangeAt: 1000,
        }),
      );
    });
    rerender();
    // Fallback branch's stale-shell case — the Phase 59 predicate correctly
    // handles this for unupgraded boxes. Phase 62's whole point is that the
    // direct-signal branch handles the Nelly false-positive that Phase 59
    // does NOT catch — see Test O below.
    expect(result.current).toBe(false);
  });
});

describe("session-working-store (Phase 62 Plan 04): bg axis retirement", () => {
  // Test I — DIRECT-SIGNAL BRANCH: bg=true does NOT contribute to isWorking
  it("Phase 62 Task 3 Test I: direct-signal branch (activity<stopped=false) + status='idle' + bg=true → isWorking false (bg dropped in direct-signal branch)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 1000,
          stoppedMtime: 2000, // Direct-signal predicate says false.
          backgroundTasks: [
            {
              type: "shell",
              id: "x",
              status: "running",
              description: "user task",
            },
          ],
        }),
      );
    });
    rerender();
    // Even with a running shell background task, the DIRECT-SIGNAL branch
    // says false because the shape's §Philosophy locks the direct-signal
    // predicate to marker mtimes alone. `bg` does NOT contribute here.
    // Without this test the executor could have accidentally left `bg`
    // wired into the direct-signal branch composition.
    expect(result.current).toBe(false);
  });

  // Test J — FALLBACK BRANCH: bg=true DOES contribute to isWorking (HIGH #1)
  it("Phase 62 Task 3 Test J (HIGH #1 regression guard): fallback branch (both mtimes null) + status='idle' + bg=true → isWorking true (bg PRESERVED in fallback per Option-1 rollout)", () => {
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          // Both direct-signal mtimes omitted → fallback branch fires.
          // Both Phase 59 axes null → shell-gate main=false.
          lastStopAt: null,
          lastStatusChangeAt: null,
          backgroundTasks: [
            {
              type: "shell",
              id: "x",
              status: "running",
              description: "user task",
            },
          ],
        }),
      );
    });
    rerender();
    // The byte-for-byte Phase 59 predicate in the fallback branch: main =
    // busy || (shell && …) = false, bg = true, isWorking = main || bg =
    // true. Unupgraded-box behavior MUST match Phase 59 exactly — dropping
    // `bg` in the fallback branch would silently flip every unupgraded-box
    // long-running-bg session from working to idle. This is the primary
    // regression guard for plan-review HIGH #1 (Option-1 rollout's core
    // promise per CONTEXT.md §Rollout).
    expect(result.current).toBe(true);
  });
});

describe("session-working-store (Phase 62 Plan 04): Axis H/I preservation + explicit-null reset", () => {
  // Test K — Axis H (activityMtime) Pitfall-3 preservation across Axis-A republish
  it("Phase 62 Task 3 Test K: publish activity=1000+stopped=500, then publish without activityMtime → cached activityMtime still 1000", () => {
    // Frame 1: direct-signal predicate says true (activity>stopped), Axis A fires.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 1000,
          stoppedMtime: 500,
        }),
      );
    });
    const snapBefore = getSessionWorkingSnapshot();
    expect(snapBefore.get("h1:s1")?.activityMtime).toBe(1000);
    expect(snapBefore.get("h1:s1")?.stoppedMtime).toBe(500);
    expect(snapBefore.get("h1:s1")?.isWorking).toBe(true);

    // Frame 2: same status, activityMtime OMITTED (pre-Phase-62-like frame),
    // stoppedMtime OMITTED too. Cache-preservation: the predicate reads the
    // cached values via `state_arg.activityMtime ?? existing?.activityMtime ??
    // null` so isWorking stays true; Axes H/I no-op because the wire signal
    // is undefined; Axis A's nextMap.set preserves the two axes via
    // `existing?.activityMtime ?? null`.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle" }),
      );
    });

    const snapAfter = getSessionWorkingSnapshot();
    // Pitfall-3 regression guard: activityMtime survives the omit-frame.
    expect(snapAfter.get("h1:s1")?.activityMtime).toBe(1000);
    expect(snapAfter.get("h1:s1")?.stoppedMtime).toBe(500);
  });

  // Test L — Axis I (stoppedMtime) Pitfall-3 preservation across Axis-A republish
  it("Phase 62 Task 3 Test L: publish activity=500+stopped=1000, then publish without stoppedMtime → cached stoppedMtime still 1000", () => {
    // Frame 1: direct-signal predicate says false (stopped>activity).
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 500,
          stoppedMtime: 1000,
        }),
      );
    });
    const snapBefore = getSessionWorkingSnapshot();
    expect(snapBefore.get("h1:s1")?.stoppedMtime).toBe(1000);
    expect(snapBefore.get("h1:s1")?.activityMtime).toBe(500);

    // Frame 2: same status, both mtimes OMITTED.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({ status: "idle" }),
      );
    });

    const snapAfter = getSessionWorkingSnapshot();
    // Pitfall-3 regression guard: stoppedMtime survives the omit-frame.
    expect(snapAfter.get("h1:s1")?.stoppedMtime).toBe(1000);
    expect(snapAfter.get("h1:s1")?.activityMtime).toBe(500);
  });

  // Test M — Axis H explicit-null reset (wire=null overwrites cache to null)
  it("Phase 62 Task 3 Test M: publish activity=1000, then publish activityMtime=null → cached activityMtime resets to null", () => {
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: 1000,
        }),
      );
    });
    expect(getSessionWorkingSnapshot().get("h1:s1")?.activityMtime).toBe(1000);

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          activityMtime: null,
        }),
      );
    });
    // Explicit null wire signal overwrites cache — distinct from omit
    // (undefined) which preserves cache. Same three-valued discipline as
    // Axis F (lastStopAt) per Phase 59 Plan 03.
    expect(getSessionWorkingSnapshot().get("h1:s1")?.activityMtime).toBe(null);
  });

  // Test N — Axis I explicit-null reset (wire=null overwrites cache to null)
  it("Phase 62 Task 3 Test N: publish stopped=1000, then publish stoppedMtime=null → cached stoppedMtime resets to null", () => {
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          stoppedMtime: 1000,
        }),
      );
    });
    expect(getSessionWorkingSnapshot().get("h1:s1")?.stoppedMtime).toBe(1000);

    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          stoppedMtime: null,
        }),
      );
    });
    expect(getSessionWorkingSnapshot().get("h1:s1")?.stoppedMtime).toBe(null);
  });
});

describe("session-working-store (Phase 62 Plan 04): Nelly oscillation + PermissionRequest-as-done end-to-end proof", () => {
  // Test O — the CORE test — Nelly 6-frame oscillation reproducer.
  it("Phase 62 Task 3 Test O: Nelly 6-frame turn with permission-request interleaved → isWorking sequence true→true→false→false→true→false", () => {
    // This is the CORE test. The phase exists to fix this exact case. It
    // proves BOTH the Nelly false-positive fix (the current Phase 59
    // predicate would say isWorking=true through frame 3 due to status
    // oscillation on unupgraded boxes) AND the "PermissionRequest counts as
    // stopped" design choice from CONTEXT.md §Philosophy (frame 4 stays
    // false because the permission request touches the stopped marker via
    // stopped-hook.sh — Plan 62-01 Task 2 established the shell script
    // event-agnosticism, Plan 62-02 established the settings.json merge
    // target including PermissionRequest, and this test proves the
    // end-to-end signal correctness through the store predicate).
    const { result, rerender } = renderHook(() =>
      useSessionIsWorking("h1:s1"),
    );

    // Frame 1: UserPromptSubmit fires (Ashley submitted a prompt) →
    // activity marker bumped to 1000; stopped marker not touched yet.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          activityMtime: 1000,
          stoppedMtime: null,
        }),
      );
    });
    rerender();
    expect(result.current).toBe(true); // activity-only observed → deserves attention

    // Frame 2: PreToolUse fires (agent began invoking a tool) → activity
    // marker bumped to 2000; stopped marker still not touched.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "shell",
          activityMtime: 2000,
          stoppedMtime: null,
        }),
      );
    });
    rerender();
    expect(result.current).toBe(true); // activity continues; tool call begun

    // Frame 3: Stop fires (turn ended cleanly) → stopped marker bumped to
    // 3000; activity marker preserved at 2000 by cache — the wire frame
    // omits activityMtime because no activity hook fired.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          stoppedMtime: 3000,
          // activityMtime omitted → cache-preserved at 2000 by Axis A's
          // `existing?.activityMtime ?? null`.
        }),
      );
    });
    rerender();
    // stopped (3000) > activity (2000) → false. The row's affordance has
    // flipped from "working" to "ready to click".
    expect(result.current).toBe(false);

    // Frame 4: PermissionRequest fires (agent blocked waiting on Ashley) →
    // stopped marker bumped to 4000 via stopped-hook.sh (per Plan 62-01/02:
    // PermissionRequest is routed to the stopped marker deliberately per
    // §Philosophy — "agent is waiting on you" is the same as "agent is
    // done" from the affordance's perspective).
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "waiting", // harness may emit "waiting" here
          stoppedMtime: 4000,
        }),
      );
    });
    rerender();
    // stopped (4000) > activity (2000) → false. Proves the shape
    // §Philosophy design choice: both mean the row deserves Ashley's
    // attention right now, both leave the affordance off. This is the
    // "PermissionRequest = done" end-to-end signal correctness proof.
    expect(result.current).toBe(false);

    // Frame 5: UserPromptSubmit fires (Ashley responded to the permission
    // request, next turn begins) → activity marker bumped to 5000.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "busy",
          activityMtime: 5000,
          // stoppedMtime omitted → cache-preserved at 4000.
        }),
      );
    });
    rerender();
    // activity (5000) > stopped (4000) → true. Flip back to working.
    expect(result.current).toBe(true);

    // Frame 6: Stop fires (turn ended cleanly) → stopped marker bumped to
    // 6000; activity marker preserved at 5000 by cache.
    act(() => {
      publishFleetStatusSessionState(
        "h1",
        makeState({
          status: "idle",
          stoppedMtime: 6000,
        }),
      );
    });
    rerender();
    // stopped (6000) > activity (5000) → false. Final idle.
    expect(result.current).toBe(false);

    // Full asserted sequence: true → true → false → false → true → false.
    // Grep marker: this test covers the "Nelly" oscillation false-positive
    // fix that motivated the phase.
  });
});
