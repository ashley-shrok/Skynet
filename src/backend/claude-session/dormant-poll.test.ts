/**
 * quick 260808-cd6 — dormancy overlay + wake button.
 * quick 260808-dmz — dormant-poll inactive-branch fix (Tests G-K).
 *
 * Unit tests for the dormant-poll tick logic and wake message handler
 * exported as test seams from claude-session-server.ts. Eleven tests
 * (A-F from patch #345, G-K new for patch #346):
 *
 *   Test A: identity-shape probe caches true → subsequent poll fires stat
 *           and emits {type:"dormant", dormant:true} when stat yields "yes".
 *   Test B: identity-shape probe caches false → subsequent polls skip dormant
 *           check entirely (execCommand NOT called for stat).
 *   Test C: emit-only-on-change — two consecutive polls returning "yes" emit
 *           ONE frame, not two.
 *   Test D: wake message with currentTmuxSession null → responds with
 *           {type:"wake_result", ok:false, error:...} and does NOT invoke execCommand.
 *   Test E: wake message happy path → invokes `rm -f` execCommand and responds
 *           {type:"wake_result", ok:true}.
 *   Test F: wake message with execCommand throw → responds
 *           {type:"wake_result", ok:false, error:message}.
 *
 *   Test G (NEW): inactive-branch dormancy probe — discoverClaudeSession returns
 *           inactive/not_claude + identity-shaped + .dormant present → seam emits
 *           ONE dormant:true frame and does NOT invoke teardown callback.
 *   Test H (NEW): dormant-poll sentinel-disappearance — starting from cached-
 *           dormant state, a poll tick where stat returns "no" emits dormant:false
 *           AND invokes the injected re-discovery callback exactly once.
 *   Test I (NEW): re-discovery yields active → seam invokes startActiveFlow callback
 *           with correct pid+sessionFile.
 *   Test J (NEW): re-discovery still inactive/not_claude → seam does NOT invoke
 *           startActiveFlow, does NOT invoke teardown, dormantLastEmitted set to false.
 *   Test K (NEW): wake handler stays reachable in dormant-poll state — reuses
 *           __applyWakeMessageForTests with isIdentityShapedCached:true + valid
 *           sshConn stub → returns {type:wake_result, ok:true}.
 *
 * Uses the __applyDormantPollTickForTests / __applyWakeMessageForTests /
 * __applyDormantPollWithRediscoveryForTests seams (same "function seam" pattern
 * as __applyRepollResultForTests in the repoll tests). No real WebSocket server
 * or SSH connection needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 56 Plan 01 — silence + capture sshLogger for the SWD-* tests below
// (they exercise __applyInputMessageForTests which logs at every send-while-
// dormant transition). Must mock the FULL logger surface because claude-
// session-server.ts transitively imports several named loggers via other
// backend modules (e.g. host-resolver's `logger` re-export). Same pattern as
// claude-session-server.optimistic-bubbles.integration.test.ts:61-92.
vi.mock("../utils/logger.js", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  });
  const systemLogger = makeLogger();
  return {
    sshLogger: makeLogger(),
    authLogger: makeLogger(),
    databaseLogger: makeLogger(),
    apiLogger: makeLogger(),
    systemLogger,
    fileLogger: makeLogger(),
    statsLogger: makeLogger(),
    tunnelLogger: makeLogger(),
    dashboardLogger: makeLogger(),
    guacLogger: makeLogger(),
    versionLogger: makeLogger(),
    logger: systemLogger,
    setGlobalLogLevel: vi.fn(),
    getGlobalLogLevel: vi.fn(() => "info"),
  };
});

import {
  __applyDormantPollTickForTests,
  type __DormantStateForTests,
  __applyWakeMessageForTests,
  __applyDormantPollWithRediscoveryForTests,
  __applyInputMessageForTests,
} from "./claude-session-server.js";
import { sshLogger } from "../utils/logger.js";

// Stub ssh2 Client — execCommand is injected so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh dormant state box (uncached, never emitted). */
function makeState(
  overrides: Partial<__DormantStateForTests> = {},
): __DormantStateForTests {
  return {
    isIdentityShapedCached: null,
    identityShapeProbeInFlight: false,
    dormantLastEmitted: null,
    ...overrides,
  };
}

/** Create a mock execCommand that dispatches by command substring. */
function makeExec(dispatch: Record<string, string | (() => Promise<string>)>) {
  return vi.fn().mockImplementation(
    (_conn: unknown, cmd: string): Promise<string> => {
      for (const [key, value] of Object.entries(dispatch)) {
        if (cmd.includes(key)) {
          return typeof value === "function" ? value() : Promise.resolve(value);
        }
      }
      return Promise.resolve("");
    },
  );
}

// ─── Test A ───────────────────────────────────────────────────────────────────

describe("Test A: identity-shape probe caches true → stat fires and emits dormant:true", () => {
  it("first tick probes identity shape (yes) → caches true; second tick stats → emits dormant:true", async () => {
    const state = makeState(); // null = not probed yet
    const wsSend = vi.fn();
    const exec = makeExec({
      "test -d": "yes\n",   // identity probe returns "yes"
      "stat ": "yes\n",     // dormant stat returns "yes" (dormant)
    });

    // Tick 1: probe fires (isIdentityShapedCached was null)
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "myagent", execCommand: exec, wsSend },
      state,
    );
    expect(state.isIdentityShapedCached).toBe(true);
    // Probe tick: no stat call yet (probe consumes this tick's budget)
    expect(exec).toHaveBeenCalledTimes(1);
    const probeCmd = exec.mock.calls[0][1] as string;
    expect(probeCmd).toContain("test -d ~/.claude/identities/'myagent'");
    expect(wsSend).not.toHaveBeenCalled(); // no emit on probe tick

    // Tick 2: stat fires (isIdentityShapedCached is now true)
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "myagent", execCommand: exec, wsSend },
      state,
    );
    expect(exec).toHaveBeenCalledTimes(2);
    const statCmd = exec.mock.calls[1][1] as string;
    expect(statCmd).toContain("stat ~/.claude/identities/'myagent'/.dormant");
    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    // Phase 56: wakingSince removed — frontend no longer needs to reconstruct
    // waking state (DormancyOverlay deleted in Plan 03).
    expect(emitted).toEqual({ type: "dormant", dormant: true });
    expect(emitted).not.toHaveProperty("wakingSince");
    expect(state.dormantLastEmitted).toBe(true);
  });
});

// ─── Test B ───────────────────────────────────────────────────────────────────

describe("Test B: identity-shape probe caches false → subsequent polls skip dormant check", () => {
  it("first tick probes (no) → caches false; second + third ticks call execCommand zero times", async () => {
    const state = makeState(); // null = not probed yet
    const wsSend = vi.fn();
    const exec = makeExec({
      "test -d": "no\n",   // identity probe returns "no" → not identity-shaped
    });

    // Tick 1: probe fires, caches false
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "randomsession", execCommand: exec, wsSend },
      state,
    );
    expect(state.isIdentityShapedCached).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(wsSend).not.toHaveBeenCalled();

    // Tick 2: skip (cached false)
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "randomsession", execCommand: exec, wsSend },
      state,
    );
    expect(exec).toHaveBeenCalledTimes(1); // no new calls
    expect(wsSend).not.toHaveBeenCalled();

    // Tick 3: still skip
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "randomsession", execCommand: exec, wsSend },
      state,
    );
    expect(exec).toHaveBeenCalledTimes(1); // still no new calls
    expect(wsSend).not.toHaveBeenCalled();
  });
});

// ─── Test C ───────────────────────────────────────────────────────────────────

describe("Test C: emit-only-on-change — two consecutive polls returning 'yes' emit ONE frame", () => {
  it("first stat tick emits dormant:true; second stat tick with same result is silent", async () => {
    // Start with isIdentityShapedCached=true so we skip the probe
    const state = makeState({ isIdentityShapedCached: true });
    const wsSend = vi.fn();
    const exec = makeExec({ "stat ": "yes\n" });

    // Tick 1: emits
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "myagent", execCommand: exec, wsSend },
      state,
    );
    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(state.dormantLastEmitted).toBe(true);

    // Tick 2: same result → no re-emit
    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "myagent", execCommand: exec, wsSend },
      state,
    );
    expect(wsSend).toHaveBeenCalledTimes(1); // still 1 — no second emit
  });
});

// ─── Test D ───────────────────────────────────────────────────────────────────

describe("Test D: wake message with currentTmuxSession null → wake_result error, no execCommand", () => {
  it("responds wake_result ok:false without calling execCommand", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn();

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: null,           // ← no active pane
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).not.toHaveBeenCalled();
    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    expect(emitted.type).toBe("wake_result");
    expect(emitted.ok).toBe(false);
    expect(typeof emitted.error).toBe("string");
  });
});

// ─── Test E ───────────────────────────────────────────────────────────────────

describe("Test E: wake message happy path → rm -f execCommand → wake_result ok:true", () => {
  it("invokes rm -f on the sentinel path and responds ok:true", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("");

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "myagent",
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const rmCmd = exec.mock.calls[0][1] as string;
    expect(rmCmd).toBe("rm -f ~/.claude/identities/'myagent'/.dormant");

    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    expect(emitted).toEqual({ type: "wake_result", ok: true });
  });
});

// ─── Test F ───────────────────────────────────────────────────────────────────

describe("Test F: wake message with execCommand throw → wake_result ok:false with error message", () => {
  it("catches execCommand error and responds ok:false with the error message string", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "myagent",
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    expect(emitted.type).toBe("wake_result");
    expect(emitted.ok).toBe(false);
    expect(emitted.error).toBe("SSH channel closed");
  });
});

// ─── Tests G-K: dormant-poll-inactive-branch behaviors (quick 260808-dmz) ─────
//
// These tests exercise __applyDormantPollWithRediscoveryForTests, the new seam
// for the sentinel-disappearance + re-discovery path added in patch #346.
// The seam signature:
//   deps: { connSnapshot, escapedName, execCommand, discoverSession, wsSend, startActiveFlow }
//   state: { dormantLastEmitted: () => boolean|null, setDormantLastEmitted: (v) => void }

// Helper: make a mutable dormantLastEmitted + wakeTriggerTs state pair.
// quick 260808-fgf: added initialWakeTriggerTs (default null = natural resume path).
function makeDormantState(initial: boolean | null = null, initialWakeTriggerTs: number | null = null) {
  let val: boolean | null = initial;
  let wts: number | null = initialWakeTriggerTs;
  return {
    dormantLastEmitted: () => val,
    setDormantLastEmitted: (v: boolean | null) => { val = v; },
    get current() { return val; },
    wakeTriggerTs: () => wts,
    setWakeTriggerTs: (v: number | null) => { wts = v; },
    get currentWts() { return wts; },
  };
}

// ─── Test G ───────────────────────────────────────────────────────────────────

describe("Test G: inactive-branch dormancy probe — stat=yes → emits dormant:true, no teardown", () => {
  it("emits ONE dormant:true frame; startActiveFlow NOT called; teardown NOT called", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n"); // stat returns yes → still dormant
    const discoverSession = vi.fn(); // should not be called when still dormant
    const state = makeDormantState(null); // first tick: lastEmitted null → will emit

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null), // unused: wakeTriggerTs null → natural-resume path
        now: () => 0,                                   // unused: wakeTriggerTs null → natural-resume path
      },
      state,
    );

    // stat was called once
    expect(exec).toHaveBeenCalledTimes(1);
    const statCmd = exec.mock.calls[0][1] as string;
    expect(statCmd).toContain("stat ~/.claude/identities/'tiffany'/.dormant");

    // Emitted dormant:true once
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    // Phase 56: wakingSince removed — frontend no longer needs to reconstruct
    // waking state (DormancyOverlay deleted in Plan 03).
    expect(frame).toEqual({ type: "dormant", dormant: true });
    expect(frame).not.toHaveProperty("wakingSince");
    expect(state.current).toBe(true);

    // discoverSession NOT invoked (sentinel still present)
    expect(discoverSession).not.toHaveBeenCalled();

    // startActiveFlow NOT invoked
    expect(startActiveFlow).not.toHaveBeenCalled();
  });
});

// ─── Test H ───────────────────────────────────────────────────────────────────

describe("Test H: dormant-poll sentinel-disappearance — stat=no → emits dormant:false + invokes discoverSession", () => {
  it("emits dormant:false and invokes discoverSession exactly once", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    // stat returns "no" → sentinel gone
    // discoverSession returns inactive/not_claude (sentinel removed but claude not yet back)
    const exec = vi.fn().mockResolvedValue("no\n");
    const discoverSession = vi.fn().mockResolvedValue({ status: "inactive", reason: "not_claude" });
    const state = makeDormantState(true); // cached as dormant:true from prior tick; wakeTriggerTs null = natural-resume

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null), // unused: wakeTriggerTs null → natural-resume path
        now: () => 0,                                   // unused: wakeTriggerTs null → natural-resume path
      },
      state,
    );

    // Emitted dormant:false
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "dormant", dormant: false });
    expect(state.current).toBe(false);

    // discoverSession invoked exactly once
    expect(discoverSession).toHaveBeenCalledTimes(1);
    expect(discoverSession.mock.calls[0][1]).toBe("tiffany");

    // startActiveFlow NOT invoked (still inactive)
    expect(startActiveFlow).not.toHaveBeenCalled();
  });
});

// ─── Test I ───────────────────────────────────────────────────────────────────

describe("Test I: dormant-poll re-discovery yields active → invokes startActiveFlow with correct args", () => {
  it("calls startActiveFlow(pid, sessionFile) when re-discovery returns active", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn().mockResolvedValue({
      status: "active",
      pid: 12345,
      sessionFile: "/home/x/.claude/projects/foo/bar.jsonl",
    });
    const state = makeDormantState(true); // starting from dormant:true; wakeTriggerTs null = natural-resume

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null), // unused: wakeTriggerTs null → natural-resume path
        now: () => 0,                                   // unused: wakeTriggerTs null → natural-resume path
      },
      state,
    );

    // dormant:false emitted first
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "dormant", dormant: false });

    // startActiveFlow called with correct args
    expect(startActiveFlow).toHaveBeenCalledTimes(1);
    expect(startActiveFlow).toHaveBeenCalledWith(12345, "/home/x/.claude/projects/foo/bar.jsonl");
  });
});

// ─── Test J ───────────────────────────────────────────────────────────────────

describe("Test J: dormant-poll re-discovery still inactive → no startActiveFlow, no teardown, dormantLastEmitted false", () => {
  it("keeps dormantLastEmitted false; startActiveFlow NOT called; exec called once (stat only)", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn().mockResolvedValue({ status: "inactive", reason: "not_claude" });
    // Start with dormantLastEmitted = false (already emitted dormant:false on a prior tick); wakeTriggerTs null = natural-resume
    const state = makeDormantState(false);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null), // unused: wakeTriggerTs null → natural-resume path
        now: () => 0,                                   // unused: wakeTriggerTs null → natural-resume path
      },
      state,
    );

    // stat was called once; discoverSession once
    expect(exec).toHaveBeenCalledTimes(1);
    expect(discoverSession).toHaveBeenCalledTimes(1);

    // No additional wsSend — dormantLastEmitted was already false
    expect(wsSend).not.toHaveBeenCalled();

    // startActiveFlow NOT called
    expect(startActiveFlow).not.toHaveBeenCalled();

    // State: dormantLastEmitted still false (ready for next tick)
    expect(state.current).toBe(false);
  });
});

// ─── Test K ───────────────────────────────────────────────────────────────────

describe("Test K: wake handler stays reachable in dormant-poll state (regression guard)", () => {
  it("__applyWakeMessageForTests returns ok:true when sshConn alive + isIdentityShapedCached true", async () => {
    // Simulates the state after the inactive→dormant transition:
    // - sshConn is the kept-alive connection (NOT null)
    // - currentTmuxSession is set (from the dormant branch's seed step)
    // - isIdentityShapedCached === true (from the dormant probe's identity check)
    // The dormant-poll MUST NOT stomp these values — if it does, this test catches it.
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("");

    await __applyWakeMessageForTests({
      sshConn: fakeConn,             // non-null — SSH kept alive in dormant branch
      currentTmuxSession: "tiffany", // set by inactive→dormant seed step
      isIdentityShapedCached: true,  // cached true from the dormant probe
      execCommand: exec,
      wsSend,
    });

    // rm -f was executed
    expect(exec).toHaveBeenCalledTimes(1);
    const rmCmd = exec.mock.calls[0][1] as string;
    expect(rmCmd).toBe("rm -f ~/.claude/identities/'tiffany'/.dormant");

    // wake_result ok:true
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "wake_result", ok: true });
  });
});

// ─── Tests L-O: marker-consumption behaviors (quick 260808-fgf) ──────────────
//
// These tests exercise __applyDormantPollWithRediscoveryForTests with the
// new Nelly .resume-complete freshness contract (wakeTriggerTs non-null).
// Tests L-O only fire the freshness path (user-initiated wake).
// Tests G-J (wakeTriggerTs null) cover the natural-resume path (unchanged).

// ─── Test L ───────────────────────────────────────────────────────────────────

describe("Test L: marker present + fresh → dismiss + rediscover + startActiveFlow", () => {
  it("markerCommand called once; wsSend dormant:false; discoverSession called; startActiveFlow called", async () => {
    const wakeTs = 1_000_000;
    const markerTs = wakeTs + 5_000;
    const markerBody = new Date(markerTs).toISOString();
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn().mockResolvedValue({ status: "active", pid: 999, sessionFile: "/x/y.jsonl" });
    const markerCommand = vi.fn().mockResolvedValue(markerBody);
    const state = makeDormantState(true, wakeTs);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand,
        now: () => wakeTs + 6_000,
      },
      state,
    );

    // markerCommand called exactly once
    expect(markerCommand).toHaveBeenCalledTimes(1);

    // dormant:false emitted once
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "dormant", dormant: false });

    // discoverSession called once
    expect(discoverSession).toHaveBeenCalledTimes(1);

    // startActiveFlow called with correct args (active discovery)
    expect(startActiveFlow).toHaveBeenCalledTimes(1);
    expect(startActiveFlow).toHaveBeenCalledWith(999, "/x/y.jsonl");
  });
});

// ─── Test M ───────────────────────────────────────────────────────────────────

describe("Test M: marker present + STALE (before wake_trigger_ts) → keep waiting", () => {
  it("markerCommand called once; wsSend NOT called; discoverSession NOT called; dormantLastEmitted unchanged", async () => {
    const wakeTs = 1_000_000;
    const staleMarkerTs = wakeTs - 5_000; // STALE: written before the wake
    const markerBody = new Date(staleMarkerTs).toISOString();
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn(); // must not be called
    const markerCommand = vi.fn().mockResolvedValue(markerBody);
    const state = makeDormantState(true, wakeTs);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand,
        now: () => wakeTs + 1_000, // well within fallback window
      },
      state,
    );

    // markerCommand called exactly once
    expect(markerCommand).toHaveBeenCalledTimes(1);

    // No emit — stale marker + within window
    expect(wsSend).not.toHaveBeenCalled();

    // discoverSession NOT called
    expect(discoverSession).not.toHaveBeenCalled();

    // startActiveFlow NOT called
    expect(startActiveFlow).not.toHaveBeenCalled();

    // dormantLastEmitted unchanged (still true)
    expect(state.current).toBe(true);
  });
});

// ─── Test N ───────────────────────────────────────────────────────────────────

describe("Test N: marker absent + 90s elapsed → fallback dismiss (mixed-fleet compat)", () => {
  it("markerCommand called once; wsSend dormant:false; discoverSession called; startActiveFlow NOT called (inactive)", async () => {
    const wakeTs = 1_000_000;
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn().mockResolvedValue({ status: "inactive", reason: "not_claude" });
    const markerCommand = vi.fn().mockResolvedValue(null); // absent
    const state = makeDormantState(true, wakeTs);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand,
        now: () => wakeTs + 91_000, // 91s elapsed → past MARKER_FALLBACK_MS (90000)
      },
      state,
    );

    // markerCommand called exactly once
    expect(markerCommand).toHaveBeenCalledTimes(1);

    // dormant:false emitted once (fallback dismiss)
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "dormant", dormant: false });

    // discoverSession called once
    expect(discoverSession).toHaveBeenCalledTimes(1);

    // startActiveFlow NOT called (still inactive)
    expect(startActiveFlow).not.toHaveBeenCalled();
  });
});

// ─── Test O ───────────────────────────────────────────────────────────────────

describe("Test O: marker absent + within 90s window → keep waiting", () => {
  it("markerCommand called once; wsSend NOT called; discoverSession NOT called; startActiveFlow NOT called", async () => {
    const wakeTs = 1_000_000;
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("no\n"); // sentinel gone
    const discoverSession = vi.fn(); // must not be called
    const markerCommand = vi.fn().mockResolvedValue(null); // absent
    const state = makeDormantState(true, wakeTs);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand,
        now: () => wakeTs + 30_000, // 30s elapsed — still within 90s window
      },
      state,
    );

    // markerCommand called exactly once
    expect(markerCommand).toHaveBeenCalledTimes(1);

    // No emit — marker absent + within window
    expect(wsSend).not.toHaveBeenCalled();

    // discoverSession NOT called
    expect(discoverSession).not.toHaveBeenCalled();

    // startActiveFlow NOT called
    expect(startActiveFlow).not.toHaveBeenCalled();
  });
});

// ─── Test P (Phase 56 update): dormant:true frame no longer carries wakingSince ──
//
// Phase 56 removed the DormancyOverlay entirely. The frontend no longer needs
// to reconstruct waking state, so the dormant:true frame no longer carries a
// `wakingSince` timestamp. Backend keeps wakeTriggerTs INTERNALLY (still
// written by the wake handler at claude-session-server.ts:5828 and by the new
// send-while-dormant path in __applyInputMessageForTests, still read by the
// marker-freshness gate at __applyDormantPollWithRediscoveryForTests L2604-
// 2626) — it just doesn't ship to the client any more.
//
// The prior Test P block (four `it` blocks that asserted `wakingSince` was
// carried on the wire) was deleted — its whole purpose was the wakingSince
// round-trip which no longer exists. Two guard-tests below flip the assertion
// to `.not.toHaveProperty('wakingSince')` — one for each seam that used to
// emit it — so a future accidental re-add of wakingSince fails loud.

describe("Test P (Phase 56): dormant:true frame does NOT carry wakingSince", () => {
  it("__applyDormantPollWithRediscoveryForTests: sentinel still present + user-initiated wake in flight → frame omits wakingSince", async () => {
    // Phase 56: wakingSince removed — frontend no longer needs to reconstruct
    // waking state (DormancyOverlay deleted in Plan 03).
    const wakeTs = 1_234_567;
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n"); // sentinel still present
    const discoverSession = vi.fn(); // not invoked while sentinel present
    const state = makeDormantState(null, wakeTs); // wakeTriggerTs set (user-wake in flight)

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => wakeTs + 1_000,
      },
      state,
    );

    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    // Frame shape: no wakingSince, even though wakeTriggerTs is set.
    expect(frame).toEqual({ type: "dormant", dormant: true });
    expect(frame).not.toHaveProperty("wakingSince");
    expect(state.current).toBe(true);
    // Seam does not touch these when sentinel still present.
    expect(discoverSession).not.toHaveBeenCalled();
    expect(startActiveFlow).not.toHaveBeenCalled();
  });

  it("__applyDormantPollTickForTests: sentinel stat=yes → frame omits wakingSince", async () => {
    // Phase 56: wakingSince removed — frontend no longer needs to reconstruct
    // waking state (DormancyOverlay deleted in Plan 03).
    const state = makeState({ isIdentityShapedCached: true });
    const wsSend = vi.fn();
    const exec = makeExec({ "stat ": "yes\n" });

    await __applyDormantPollTickForTests(
      { connSnapshot: fakeConn, escapedName: "myagent", execCommand: exec, wsSend },
      state,
    );

    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame).toEqual({ type: "dormant", dormant: true });
    expect(frame).not.toHaveProperty("wakingSince");
  });
});

// ─── Tests P-R: dormant-branch context-pct piggyback ─────────────────────────
//
// These cover the readJsonlPct + dormantSessionFile inject on the sentinel-
// still-present branch of __applyDormantPollWithRediscoveryForTests. The emit
// carries `dormant: true` so PrettyView's live-frame auto-dismiss (L1149)
// treats it as a rest-value refresh, not a supervisor-recovery signal.

describe("Test P: dormant sentinel present + session file resolved + pct read → emits context_pct with dormant:true", () => {
  it("emits {type:'context_pct', pct, dormant:true} on the same tick as the dormant frame", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n"); // stat returns yes → still dormant
    const discoverSession = vi.fn();
    const readJsonlPct = vi.fn().mockResolvedValue(42);
    const state = makeDormantState(null); // first tick

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
        readJsonlPct,
        dormantSessionFile: () => "/home/ubuntu/.claude/projects/-x/y.jsonl",
      },
      state,
    );

    // readJsonlPct was called with the connSnapshot + the resolved session file path
    expect(readJsonlPct).toHaveBeenCalledTimes(1);
    expect(readJsonlPct).toHaveBeenCalledWith(
      fakeConn,
      "/home/ubuntu/.claude/projects/-x/y.jsonl",
    );

    // Two wsSend calls: the dormant:true frame + the context_pct:dormant frame
    expect(wsSend).toHaveBeenCalledTimes(2);
    const dormantFrame = JSON.parse(wsSend.mock.calls[0][0]);
    // Phase 56: wakingSince removed — frontend no longer needs to reconstruct
    // waking state (DormancyOverlay deleted in Plan 03).
    expect(dormantFrame).toEqual({ type: "dormant", dormant: true });
    expect(dormantFrame).not.toHaveProperty("wakingSince");
    const pctFrame = JSON.parse(wsSend.mock.calls[1][0]);
    expect(pctFrame).toEqual({ type: "context_pct", pct: 42, dormant: true });

    // Poll behaviors unchanged
    expect(discoverSession).not.toHaveBeenCalled();
    expect(startActiveFlow).not.toHaveBeenCalled();
  });
});

describe("Test Q: dormant sentinel present + session file NOT YET resolved (getter returns null) → no context_pct emit", () => {
  it("silent skip on the pct path; dormant frame still emits normally", async () => {
    const wsSend = vi.fn();
    const startActiveFlow = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n");
    const readJsonlPct = vi.fn(); // should NOT be called
    const state = makeDormantState(null);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession: vi.fn(),
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
        readJsonlPct,
        dormantSessionFile: () => null, // discovery hasn't completed yet
      },
      state,
    );

    expect(readJsonlPct).not.toHaveBeenCalled();
    // Only the dormant:true frame emitted; no context_pct
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame.type).toBe("dormant");
  });
});

describe("Test R: dormant sentinel present + readJsonlPct returns null → no context_pct emit", () => {
  it("silent skip when JSONL has no assistant turn yet (helper returns null)", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n");
    const readJsonlPct = vi.fn().mockResolvedValue(null); // no usage block
    const state = makeDormantState(null);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession: vi.fn(),
        wsSend,
        startActiveFlow: vi.fn(),
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
        readJsonlPct,
        dormantSessionFile: () => "/some/file.jsonl",
      },
      state,
    );

    expect(readJsonlPct).toHaveBeenCalledTimes(1);
    // Only dormant:true; no context_pct
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame.type).toBe("dormant");
  });
});

describe("Test S: dormant sentinel present + readJsonlPct throws → silent skip, dormant frame still emits", () => {
  it("swallows the JSONL-read error; keeps polling", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n");
    const readJsonlPct = vi.fn().mockRejectedValue(new Error("ssh transient"));
    const state = makeDormantState(null);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession: vi.fn(),
        wsSend,
        startActiveFlow: vi.fn(),
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
        readJsonlPct,
        dormantSessionFile: () => "/some/file.jsonl",
      },
      state,
    );

    // Dormant frame still emitted despite the JSONL-read throw
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame.type).toBe("dormant");
    // No unhandled rejection surfaced (test would fail otherwise)
  });
});

describe("Test T: readJsonlPct + dormantSessionFile absent (older callers) → seam behavior unchanged", () => {
  it("no pct emit path invoked when the optional deps are omitted", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("yes\n");
    const state = makeDormantState(null);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession: vi.fn(),
        wsSend,
        startActiveFlow: vi.fn(),
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
        // readJsonlPct + dormantSessionFile intentionally omitted
      },
      state,
    );

    // Only dormant:true frame; behavior identical to Test G
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(wsSend.mock.calls[0][0]);
    expect(frame.type).toBe("dormant");
  });
});

// ─── Phase 56: send-while-dormant path (invisible wake trigger) ──────────────
//
// Test coverage for the new send-while-dormant branch inside
// __applyInputMessageForTests. When a WS `input` frame arrives at a pane whose
// dormantLastEmitted() returns true, the send-path drops the .dormant sentinel
// (byte-identical to __applyWakeMessageForTests at claude-session-server.ts:
// 2487), records wakeTriggerTs so the existing dormant-poll marker-freshness
// gate holds this pane's dormant:true frame in place while the wake completes,
// polls .resume-complete every 500ms until fresh (marker_ts > triggerTs) OR
// MARKER_FALLBACK_MS (90_000) elapses, then falls through to the normal split-
// send delivery unchanged.
//
// Four scenarios below:
//   SWD-1: marker fresh → sentinel dropped, wakeTriggerTs recorded, send-keys fires after marker becomes fresh
//   SWD-2: marker never appears → falls back at MARKER_FALLBACK_MS and still fires send-keys
//   SWD-3: two sends serialize in send order (sentinel drop idempotent under `-f`)
//   SWD-4: awake pane (dormantLastEmitted=false) → no dormant-branch runs, byte-identical to today

describe("Phase 56: send-while-dormant path (invisible wake trigger)", () => {
  beforeEach(() => {
    vi.mocked(sshLogger.info).mockClear();
    vi.mocked(sshLogger.warn).mockClear();
  });

  it("Test SWD-1: send while dormant with fresh marker → sentinel dropped, wakeTriggerTs recorded, tmux send-keys fires after marker becomes fresh", async () => {
    // Setup: dormantLastEmitted returns true. now() counter advances the
    // clock; markerCommand returns null on first two polls, fresh timestamp
    // on the third. Send is a normal split-send ("hello\r" with mqid).
    const triggerTs = 1_000_000;
    let nowCounter = triggerTs;
    const advanceMs = 500;
    const now = vi.fn(() => {
      const t = nowCounter;
      nowCounter += advanceMs;
      return t;
    });
    const markerCommand = vi.fn()
      .mockResolvedValueOnce(null)  // poll 1: no marker
      .mockResolvedValueOnce(null)  // poll 2: no marker
      // poll 3: fresh marker (timestamp strictly > triggerTs)
      .mockResolvedValueOnce(new Date(triggerTs + 10_000).toISOString());
    const execCalls: string[] = [];
    const execCommand = vi.fn().mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      execCalls.push(cmd);
      return Promise.resolve("");
    });
    let wakeTriggerTsRecorded: number | null = null;
    const setWakeTriggerTs = vi.fn((ts: number) => { wakeTriggerTsRecorded = ts; });

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "test-agent",
      currentHostId: 42,
      execCommand,
      data: "hello\r",
      messageQueueItemId: "mqid-1",
      dormantLastEmitted: () => true,
      setWakeTriggerTs,
      markerCommand,
      now,
    });

    // Sentinel drop fired with byte-identical command shape as
    // __applyWakeMessageForTests at claude-session-server.ts:2487.
    const sentinelDropIdx = execCalls.findIndex((c) => c.includes("rm -f ~/.claude/identities/'test-agent'/.dormant"));
    expect(sentinelDropIdx).toBeGreaterThanOrEqual(0);

    // wakeTriggerTs recorded exactly once with the numeric triggerTs.
    expect(setWakeTriggerTs).toHaveBeenCalledTimes(1);
    expect(setWakeTriggerTs).toHaveBeenCalledWith(triggerTs);
    expect(wakeTriggerTsRecorded).toBe(triggerTs);

    // markerCommand called at least twice (poll loop iterated until fresh).
    expect(markerCommand.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Split-send body + Enter fired after sentinel drop.
    const bodyIdx = execCalls.findIndex((c) => c.includes("tmux send-keys -l -t 'test-agent' 'hello'"));
    const enterIdx = execCalls.findIndex((c) => c.includes("tmux send-keys -t 'test-agent' Enter"));
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThanOrEqual(0);

    // Ordering: sentinel drop BEFORE body BEFORE Enter.
    expect(sentinelDropIdx).toBeLessThan(bodyIdx);
    expect(bodyIdx).toBeLessThan(enterIdx);
  });

  it("Test SWD-2: send while dormant with marker never appearing → falls back at MARKER_FALLBACK_MS and still fires send-keys", async () => {
    // Setup: dormantLastEmitted true; markerCommand always returns null;
    // now() jumps from triggerTs to triggerTs + MARKER_FALLBACK_MS after the
    // first poll → fallback branch fires. Assertion also verifies the
    // sshLogger.info fallback-log operation is emitted.
    const triggerTs = 2_000_000;
    const MARKER_FALLBACK_MS = 90_000; // mirrors MARKER_FALLBACK_MS at claude-session-server.ts:773
    // now() sequence: [triggerTs (record), triggerTs (check inside loop), triggerTs+FALLBACK (check → fallback), triggerTs+FALLBACK (elapsed log)]
    let callCount = 0;
    const now = vi.fn(() => {
      const c = callCount++;
      if (c === 0) return triggerTs; // recorded as triggerTs
      if (c === 1) return triggerTs; // first loop iteration elapsed-check → 0ms elapsed → still in window
      return triggerTs + MARKER_FALLBACK_MS; // subsequent → fallback fires + elapsedMs log
    });
    const markerCommand = vi.fn().mockResolvedValue(null);
    const execCalls: string[] = [];
    const execCommand = vi.fn().mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      execCalls.push(cmd);
      return Promise.resolve("");
    });

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "test-agent",
      currentHostId: 42,
      execCommand,
      data: "hello\r",
      messageQueueItemId: "mqid-2",
      dormantLastEmitted: () => true,
      setWakeTriggerTs: vi.fn(),
      markerCommand,
      now,
    });

    // Sentinel drop still fired (fallback path preserves the drop).
    expect(execCalls.some((c) => c.includes("rm -f ~/.claude/identities/'test-agent'/.dormant"))).toBe(true);

    // Send-keys still fired (body + Enter both present).
    expect(execCalls.some((c) => c.includes("tmux send-keys -l -t 'test-agent' 'hello'"))).toBe(true);
    expect(execCalls.some((c) => c.includes("tmux send-keys -t 'test-agent' Enter"))).toBe(true);

    // Assert sshLogger.info called with the fallback operation.
    const infoCalls = vi.mocked(sshLogger.info).mock.calls;
    const fallbackLog = infoCalls.find((call) => {
      const meta = call[1] as { operation?: string } | undefined;
      return meta?.operation === "pv_input_dormant_marker_fallback";
    });
    expect(fallbackLog).toBeDefined();
  });

  it("Test SWD-3: two sends into a dormant pane in rapid succession — both land in send order, sentinel drop idempotent", async () => {
    // Setup: dormantLastEmitted always true. Fire two __applyInputMessageForTests
    // calls in sequence. markerCommand always returns a fresh timestamp (well
    // in the future), so each send loops once through the poll, sees fresh,
    // and dispatches. execCommand records call order to verify send-order
    // preservation and idempotent-drop (-f swallows ENOENT on second call).
    const clockStart = 3_000_000;
    let clock = clockStart;
    const now = vi.fn(() => {
      const t = clock;
      clock += 500;
      return t;
    });
    // Fresh marker for every poll — always well above the current triggerTs.
    // Using now() at return time so the timestamp stays ahead of clock jumps.
    const markerCommand = vi.fn().mockImplementation(async () => {
      // A timestamp far in the future — guaranteed > any triggerTs.
      return new Date(clockStart + 10_000_000).toISOString();
    });
    const execCalls: string[] = [];
    const execCommand = vi.fn().mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      execCalls.push(cmd);
      return Promise.resolve("");
    });

    // First send
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "test-agent",
      currentHostId: 42,
      execCommand,
      data: "first\r",
      messageQueueItemId: "mqid-1",
      dormantLastEmitted: () => true,
      setWakeTriggerTs: vi.fn(),
      markerCommand,
      now,
    });

    // Second send
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "test-agent",
      currentHostId: 42,
      execCommand,
      data: "second\r",
      messageQueueItemId: "mqid-2",
      dormantLastEmitted: () => true,
      setWakeTriggerTs: vi.fn(),
      markerCommand,
      now,
    });

    // Sentinel drop fired at least twice (once per send — idempotent under -f).
    const sentinelDropCount = execCalls.filter((c) =>
      c.includes("rm -f ~/.claude/identities/'test-agent'/.dormant"),
    ).length;
    expect(sentinelDropCount).toBeGreaterThanOrEqual(2);

    // Ordering: first-body appears BEFORE second-body in the recorded call list.
    const firstBodyIdx = execCalls.findIndex((c) => c.includes("tmux send-keys -l -t 'test-agent' 'first'"));
    const secondBodyIdx = execCalls.findIndex((c) => c.includes("tmux send-keys -l -t 'test-agent' 'second'"));
    expect(firstBodyIdx).toBeGreaterThanOrEqual(0);
    expect(secondBodyIdx).toBeGreaterThanOrEqual(0);
    expect(firstBodyIdx).toBeLessThan(secondBodyIdx);

    // Sequence sanity: for each send, sentinel-drop BEFORE body BEFORE Enter.
    const firstSentinelIdx = execCalls.findIndex((c) => c.includes("rm -f ~/.claude/identities/'test-agent'/.dormant"));
    const firstEnterIdx = execCalls.findIndex((c) => c.includes("tmux send-keys -t 'test-agent' Enter"));
    expect(firstSentinelIdx).toBeLessThan(firstBodyIdx);
    expect(firstBodyIdx).toBeLessThan(firstEnterIdx);
  });

  it("Test SWD-4: send into an awake pane (dormantLastEmitted=false) — no sentinel drop, no marker poll, no wakeTriggerTs write, normal path unchanged", async () => {
    // Setup: dormantLastEmitted returns false. Send should follow the
    // pre-Phase-56 non-dormant-branch path byte-for-byte: normal split-send
    // WITHOUT sentinel drop, WITHOUT marker poll, WITHOUT wakeTriggerTs write.
    const execCalls: string[] = [];
    const execCommand = vi.fn().mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      execCalls.push(cmd);
      return Promise.resolve("");
    });
    const markerCommand = vi.fn();
    const setWakeTriggerTs = vi.fn();
    const now = vi.fn(() => 0);

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "test-agent",
      currentHostId: 42,
      execCommand,
      data: "hello\r",
      messageQueueItemId: "mqid-4",
      dormantLastEmitted: () => false, // awake
      setWakeTriggerTs,
      markerCommand,
      now,
    });

    // Sentinel drop was NEVER called (no rm -f on identities path).
    expect(execCalls.some((c) => c.includes("rm -f ~/.claude/identities/"))).toBe(false);

    // markerCommand was NEVER called (no marker polling).
    expect(markerCommand).not.toHaveBeenCalled();

    // setWakeTriggerTs was NEVER called (no wake-trigger recording).
    expect(setWakeTriggerTs).not.toHaveBeenCalled();

    // Normal split-send still fired (body + Enter both present) — byte-
    // identical to today's behavior for awake panes.
    expect(execCalls.some((c) => c.includes("tmux send-keys -l -t 'test-agent' 'hello'"))).toBe(true);
    expect(execCalls.some((c) => c.includes("tmux send-keys -t 'test-agent' Enter"))).toBe(true);
  });
});
