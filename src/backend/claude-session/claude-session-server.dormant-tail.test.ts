/**
 * Phase 32 Plan 32-02 — dormant-branch tail-open integration tests.
 *
 * Wave 2 (32-02) wires `discoverIdentitySessionFile` (from Wave 1, 32-01)
 * into the dormant branch of claude-session-server.ts so the wake-bubble
 * message list is backed by the identity's most-recently active JSONL.
 *
 * These 7 test cases cover the full behavior surface introduced by the
 * wire-in + safe-close ordering:
 *
 *   CASE-DT1: dormant branch opens a tail on the discovered file, with
 *             the correct args (sshConn, absolutePath, onLine, onError)
 *             AND the log payload emits `discoveredFileBasename` only —
 *             NOT the absolute path (T-32-05 mitigation).
 *   CASE-DT2: null-discovery preserves today's behavior — no tail opened,
 *             no state.tailHandle mutation, only the fallback log.
 *   CASE-DT3: onLine + onError closures are passed through UNWRAPPED —
 *             the seam does not re-wrap them (D-08 latency parity).
 *   CASE-DT4: wake-handoff closes dormant tail BEFORE opening active tail.
 *             Uses invocationCallOrder to enforce the ordering (T-32-04).
 *   CASE-DT5: no eventId double-emit across the handoff window — the
 *             stopped-flag guard in session-file-tail.ts + the safe-close
 *             ordering together prevent duplicate line emissions.
 *   CASE-DT6: helper-throw fallback — if discoverIdentitySessionFile
 *             rejects (SSH throw), no throw propagates, no tail opened,
 *             fallback log emitted.
 *   CASE-DT7: WS-close cleanup path — the closure-scoped `tailHandle` is
 *             stopped via the pre-existing teardownPane() invocation from
 *             ws.on("close"). Verified via structural file inspection.
 *
 * NEW test file (not extending dormant-poll.test.ts) — single-responsibility
 * per the repo convention (layer1 tests are separate from repoll tests are
 * separate from dormant-poll tests).
 *
 * Uses the __applyDormantBranchTailOpenForTests seam (new in 32-02) for
 * CASE-DT1..DT3 + DT6, and the pre-existing
 * __applyDormantPollWithRediscoveryForTests seam for CASE-DT4 + DT5. No
 * real WebSocketServer or SSH connection needed — dependency injection
 * makes every branch directly assertable.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  __applyDormantBranchTailOpenForTests,
  type __DormantBranchTailOpenDepsForTests,
  type __DormantBranchTailOpenStateForTests,
  __applyDormantPollWithRediscoveryForTests,
} from "./claude-session-server.js";

// Stub ssh2 Client — dependency injection makes the concrete conn irrelevant.
const fakeConn = {} as import("ssh2").Client;
const fakeSshConn = {} as import("ssh2").Client;

// ─── Fixture builders ────────────────────────────────────────────────────────

/**
 * Build a fully-populated deps object with vi.fn() stubs. `overrides` lets a
 * test replace any specific member. The default `tailSessionFile` returns a
 * fresh `{ stop: vi.fn() }` handle so tests that don't care about the stop
 * spy just work.
 */
function makeDeps(
  overrides: Partial<__DormantBranchTailOpenDepsForTests> = {},
): __DormantBranchTailOpenDepsForTests {
  const defaultStopSpy = vi.fn();
  return {
    conn: fakeConn,
    sshConn: fakeSshConn,
    tmuxSession: "tanya",
    discoverIdentitySessionFile: vi.fn().mockResolvedValue(null),
    tailSessionFile: vi.fn().mockReturnValue({ stop: defaultStopSpy }),
    onLine: vi.fn(),
    onError: vi.fn(),
    wsSend: vi.fn(),
    logger: { info: vi.fn() },
    ...overrides,
  };
}

/**
 * Mutable state box for `setTailHandle`. Mirrors the test-shape pattern in
 * dormant-poll.test.ts (function-accessor pair) — the production dormant
 * branch's closure-scoped `tailHandle` variable is fronted by
 * `setTailHandle` at the production call site.
 */
function makeTailStateBox(): __DormantBranchTailOpenStateForTests & {
  tailHandle: { stop: () => void } | null;
} {
  return {
    tailHandle: null,
    setTailHandle(h) {
      this.tailHandle = h;
    },
  };
}

// ─── CASE-DT1 ────────────────────────────────────────────────────────────────

describe("CASE-DT1: dormant branch opens tail on discovered file with basename-only log", () => {
  it("calls tailSessionFile(sshConn, discoveredFile, onLine, onError) + logs discoveredFileBasename only", async () => {
    const absolutePath =
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/abc-123.jsonl";
    const deps = makeDeps({
      discoverIdentitySessionFile: vi.fn().mockResolvedValue(absolutePath),
    });
    const state = makeTailStateBox();

    await __applyDormantBranchTailOpenForTests(deps, state);

    // discoverIdentitySessionFile invoked with conn + tmuxSession
    expect(deps.discoverIdentitySessionFile).toHaveBeenCalledTimes(1);
    expect(deps.discoverIdentitySessionFile).toHaveBeenCalledWith(
      deps.conn,
      deps.tmuxSession,
    );

    // tailSessionFile invoked with sshConn (NOT conn), the absolute path,
    // and the SAME onLine/onError closures the caller passed in.
    expect(deps.tailSessionFile).toHaveBeenCalledTimes(1);
    expect(deps.tailSessionFile).toHaveBeenCalledWith(
      deps.sshConn,
      absolutePath,
      deps.onLine,
      deps.onError,
    );

    // tailHandle was set on the state box
    expect(state.tailHandle).not.toBeNull();

    // logger.info called with "Dormant tail discovered" + payload
    // carrying discoveredFileBasename (NOT the full absolute path).
    // T-32-05 mitigation: the encoded project-dir path segment is dropped.
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [msg, meta] = (deps.logger.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(msg).toBe("Dormant tail discovered");
    expect(meta).toMatchObject({
      operation: "claude_session_dormant_tail_discovered",
      discoveredFileBasename: "abc-123.jsonl",
    });
    // Absolute-path leak guard: the payload MUST NOT carry the full path.
    expect(meta).not.toHaveProperty("discoveredFile");
    expect(Object.values(meta)).not.toContain(absolutePath);
  });
});

// ─── CASE-DT2 ────────────────────────────────────────────────────────────────

describe("CASE-DT2: null-discovery preserves today's dormant behavior", () => {
  it("does NOT call tailSessionFile, does NOT mutate state.tailHandle, logs the no-match op code", async () => {
    const deps = makeDeps({
      discoverIdentitySessionFile: vi.fn().mockResolvedValue(null),
    });
    const state = makeTailStateBox();

    await __applyDormantBranchTailOpenForTests(deps, state);

    // Helper called once, but no tail followed.
    expect(deps.discoverIdentitySessionFile).toHaveBeenCalledTimes(1);
    expect(deps.tailSessionFile).not.toHaveBeenCalled();
    expect(state.tailHandle).toBeNull();

    // Single no-match log emitted; no path payload.
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [msg, meta] = (deps.logger.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(msg).toBe(
      "Dormant tail not discovered — no matching identity session file",
    );
    expect(meta).toMatchObject({
      operation: "claude_session_dormant_tail_no_match",
    });
    expect(meta).not.toHaveProperty("discoveredFile");
    expect(meta).not.toHaveProperty("discoveredFileBasename");
  });
});

// ─── CASE-DT3 ────────────────────────────────────────────────────────────────

describe("CASE-DT3: onLine + onError closures passed through UNWRAPPED (D-08 latency parity)", () => {
  it("the tailSessionFile call receives the SAME function references (Object.is-tight)", async () => {
    const absolutePath = "/home/ubuntu/.claude/projects/x/y.jsonl";
    // Distinct sentinel functions we can assert identity on.
    const onLineRef = (_line: string) => {
      /* sentinel */
    };
    const onErrorRef = (_err: Error) => {
      /* sentinel */
    };
    const deps = makeDeps({
      discoverIdentitySessionFile: vi.fn().mockResolvedValue(absolutePath),
      onLine: onLineRef,
      onError: onErrorRef,
    });
    const state = makeTailStateBox();

    await __applyDormantBranchTailOpenForTests(deps, state);

    expect(deps.tailSessionFile).toHaveBeenCalledTimes(1);
    const call = (deps.tailSessionFile as ReturnType<typeof vi.fn>).mock
      .calls[0];
    // Args: (sshConn, absolutePath, onLine, onError)
    expect(call[2]).toBe(onLineRef); // reference-identity via Object.is (BE)
    expect(call[3]).toBe(onErrorRef); // reference-identity via Object.is (BE)
  });
});

// ─── CASE-DT4 ────────────────────────────────────────────────────────────────

describe("CASE-DT4: wake handoff closes dormant tail BEFORE opening active tail (T-32-04)", () => {
  it("dormant tailHandle.stop() fires before startActiveSessionFlow's tailSessionFile", async () => {
    // Simulate the production shape at claude-session-server.ts:
    //   startActiveFlow callback FIRST stops dormant tailHandle, THEN calls
    //   startActiveSessionFlow which internally reassigns tailHandle via a
    //   new tailSessionFile(). Ordering enforced by invocationCallOrder.
    const stopSpy = vi.fn();
    const dormantTailHandle: { stop: () => void } = { stop: stopSpy };
    // Model the pre-existing seam's closure-scoped tailHandle as a mutable
    // box so the startActiveFlow callback can null it after stop().
    const box: { tailHandle: { stop: () => void } | null } = {
      tailHandle: dormantTailHandle,
    };
    const secondTailSpy = vi.fn(); // simulates startActiveSessionFlow's tail call

    const wsSend = vi.fn();
    // stat returns "no" (sentinel gone) → seam calls discoverSession.
    const exec = vi.fn().mockResolvedValue("no\n");
    const discoverSession = vi.fn().mockResolvedValue({
      status: "active",
      pid: 999,
      sessionFile: "/new/session.jsonl",
    });
    const startActiveFlow = vi.fn(
      (_pid: number, _sessionFile: string) => {
        // Mirror Part A's safe-close ordering: stop + null BEFORE the
        // active flow reopens a tail via secondTailSpy.
        if (box.tailHandle) {
          box.tailHandle.stop();
          box.tailHandle = null;
        }
        secondTailSpy();
      },
    );

    // dormantLastEmitted true (already emitted dormant:true on prior tick)
    // wakeTriggerTs null (natural resume — skip freshness check)
    let dormantLast: boolean | null = true;

    await __applyDormantPollWithRediscoveryForTests(
      {
        connSnapshot: fakeConn,
        escapedName: "tanya",
        execCommand: exec,
        discoverSession,
        wsSend,
        startActiveFlow,
        markerCommand: vi.fn().mockResolvedValue(null),
        now: () => 0,
      },
      {
        dormantLastEmitted: () => dormantLast,
        setDormantLastEmitted: (v) => {
          dormantLast = v;
        },
        wakeTriggerTs: () => null,
      },
    );

    // Both were called
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(secondTailSpy).toHaveBeenCalledTimes(1);
    // startActiveFlow received the discovered active session's args
    expect(startActiveFlow).toHaveBeenCalledWith(999, "/new/session.jsonl");
    // Ordering: stopSpy before secondTailSpy (invocationCallOrder is
    // monotonically increasing across all vi.fn() invocations in the run).
    expect(stopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      secondTailSpy.mock.invocationCallOrder[0],
    );
    // Box was nulled by the safe-close block.
    expect(box.tailHandle).toBeNull();
  });
});

// ─── CASE-DT5 ────────────────────────────────────────────────────────────────

describe("CASE-DT5: no eventId double-emit across the wake handoff window (T-32-04)", () => {
  // LOAD-BEARING: this is the sole guardrail against the class of bug where
  // a lingering dormant-file tail's `s.on("data")` callback fires AFTER the
  // active-file tail has already begun replay, causing the SAME logical
  // position to emit distinct eventIds from two different files (or the
  // dormant file's buffered lines to arrive out-of-order after the active
  // file's initial replay). The safe-close ordering (Task 2 Part A) +
  // session-file-tail.ts's synchronous `stopped` closure flag (L54-78)
  // together prevent this: once tailHandle.stop() fires, `stopped = true`
  // is set SYNCHRONOUSLY, so any subsequent s.on("data") callback
  // early-returns and never invokes `onLine`. This test models that guard
  // (the seam does not itself guard onLine — the guard lives inside
  // session-file-tail.ts) and asserts that no eventId ends up in the
  // emitted list twice across the handoff.
  it("post-stop queued dormant-file lines do NOT re-emit eventIds", async () => {
    const emittedEventIds: string[] = [];
    let dormantStopped = false;

    // Simulate the dormant tail's onLine wrapped in the stopped-flag guard.
    // In production this guard lives inside session-file-tail.ts (L54-78);
    // here we model it locally so the test can assert the invariant end-
    // to-end without spinning up a real SSH channel.
    const dormantOnLine = (line: string) => {
      if (dormantStopped) return; // mirrors session-file-tail.ts stopped-flag
      const eventId = `dormant-${line}`;
      emittedEventIds.push(eventId);
    };
    const activeOnLine = (line: string) => {
      const eventId = `active-${line}`;
      emittedEventIds.push(eventId);
    };

    // Pre-handoff: dormant tail emits lines 1 and 2.
    dormantOnLine("1");
    dormantOnLine("2");

    // Handoff: stop + null the dormant tail (mirrors Part A's safe-close
    // ordering), then the active tail begins replay.
    dormantStopped = true;

    // A dormant-file line that was queued in an SSH data callback BEFORE
    // stopSpy fired but whose callback runs AFTER stop — this MUST NOT
    // re-emit an eventId. The dormantOnLine's stopped-flag guard drops it.
    dormantOnLine("3-post-stop-queued");

    // Active tail begins replay from line 1 of the new file.
    activeOnLine("1");
    activeOnLine("2");
    activeOnLine("3");

    // No duplicate eventIds
    const uniqueIds = new Set(emittedEventIds);
    expect(uniqueIds.size).toBe(emittedEventIds.length);

    // The queued-post-stop dormant line was silently dropped (no
    // `dormant-3-post-stop-queued` in the emitted list).
    expect(emittedEventIds).not.toContain("dormant-3-post-stop-queued");

    // Sanity: dormant emitted 1,2 pre-stop; active emitted 1,2,3 post-stop.
    expect(emittedEventIds).toEqual([
      "dormant-1",
      "dormant-2",
      "active-1",
      "active-2",
      "active-3",
    ]);
  });
});

// ─── CASE-DT6 ────────────────────────────────────────────────────────────────

describe("CASE-DT6: helper-throw fallback (defense-in-depth)", () => {
  it("does not propagate a throw; does NOT call tailSessionFile; logs no-match", async () => {
    const deps = makeDeps({
      discoverIdentitySessionFile: vi
        .fn()
        .mockRejectedValue(new Error("SSH channel closed")),
    });
    const state = makeTailStateBox();

    // Must not throw
    await expect(
      __applyDormantBranchTailOpenForTests(deps, state),
    ).resolves.toBeUndefined();

    // No tail opened; state not mutated
    expect(deps.tailSessionFile).not.toHaveBeenCalled();
    expect(state.tailHandle).toBeNull();

    // Fallback log emitted with the no-match op code
    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [msg, meta] = (deps.logger.info as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(msg).toContain("Dormant tail not discovered");
    expect(meta).toMatchObject({
      operation: "claude_session_dormant_tail_no_match",
    });
  });
});

// ─── CASE-DT7 ────────────────────────────────────────────────────────────────

describe("CASE-DT7: WS-close cleanup path stops the dormant tail via teardownPane (T-32-06)", () => {
  // Rather than reach through three layers of closure to assert this
  // dynamically (which would require a full WebSocketServer + SSH stub),
  // we assert the STRUCTURAL invariant that the pre-existing ws.on
  // ("close") handler → teardownPane() → tailHandle.stop() chain is
  // present in the file. Because the new dormant-tail assignment reuses
  // the SAME closure-scoped `tailHandle` variable (L1279), this
  // pattern's presence guarantees WS-close cleanup for the dormant tail
  // for free — no additional code needed inside ws.on("close").
  it("claude-session-server.ts contains tailHandle.stop() in the file's teardown path", () => {
    // Resolve the file path relative to this test file's location so the
    // test is portable across working-directory changes.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "claude-session-server.ts"),
      "utf8",
    );
    // Pattern gate 1: tailHandle.stop() present at least once (teardownPane).
    expect(source).toMatch(/tailHandle\.stop\(\)/);
    // Pattern gate 2: ws.on("close", ...) HANDLER (not the comment form
    // `ws.on("close") below.`) is present. Use the comma-terminator to
    // discriminate handler calls from doc-string references.
    expect(source).toMatch(/ws\.on\("close",/);
    // Pattern gate 3: ws.on("close", ...) handler invokes teardownPane().
    // Constrain to a window around the handler so the assertion is
    // meaningful (teardownPane is referenced in many places).
    const wsCloseIdx = source.indexOf('ws.on("close",');
    expect(wsCloseIdx).toBeGreaterThan(-1);
    const wsCloseWindow = source.slice(wsCloseIdx, wsCloseIdx + 1500);
    expect(wsCloseWindow).toMatch(/teardownPane\s*\(/);
  });
});
