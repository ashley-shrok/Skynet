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

import { describe, it, expect, vi } from "vitest";
import {
  __applyDormantPollTickForTests,
  type __DormantStateForTests,
  __applyWakeMessageForTests,
  __applyDormantPollWithRediscoveryForTests,
} from "./claude-session-server.js";

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
    expect(emitted).toEqual({ type: "dormant", dormant: true });
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

// Helper: make a mutable dormantLastEmitted state pair.
function makeDormantState(initial: boolean | null = null) {
  let val: boolean | null = initial;
  return {
    dormantLastEmitted: () => val,
    setDormantLastEmitted: (v: boolean | null) => { val = v; },
    get current() { return val; },
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
    expect(frame).toEqual({ type: "dormant", dormant: true });
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
    const state = makeDormantState(true); // cached as dormant:true from prior tick

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
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
    const state = makeDormantState(true); // starting from dormant:true

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
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
    // Start with dormantLastEmitted = false (already emitted dormant:false on a prior tick)
    const state = makeDormantState(false);

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tiffany",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
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
