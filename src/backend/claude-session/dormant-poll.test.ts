/**
 * quick 260808-cd6 — dormancy overlay + wake button.
 *
 * Unit tests for the dormant-poll tick logic and wake message handler
 * exported as test seams from claude-session-server.ts. Six tests
 * (A-F) matching the bounty spec:
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
 * Uses the __applyDormantPollTickForTests / __applyWakeMessageForTests
 * seams (same "function seam" pattern as __applyRepollResultForTests in
 * the repoll tests). No real WebSocket server or SSH connection needed.
 */

import { describe, it, expect, vi } from "vitest";
import {
  __applyDormantPollTickForTests,
  type __DormantStateForTests,
  __applyWakeMessageForTests,
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
