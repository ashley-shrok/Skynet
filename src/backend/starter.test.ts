/**
 * starter.test.ts
 *
 * Phase 39 Plan 04 — Coverage for the exported `maybeInstallStopHook`
 * helper wired into the fleet-status IIFE's acquireSshChannel path.
 *
 * The helper is intentionally extracted to module scope in starter.ts
 * (per plan-check WARNING 2) so this test can drive it directly with
 * mocked deps — no need to boot the whole IIFE.
 *
 * The starter.ts IIFE is guarded by `if (process.env.VITEST !== "true")`
 * so importing this module here does not trigger real backend init.
 *
 * Tests cover (per plan-04 §Task 2 behavior):
 *   1. install fires exactly once per host per lifecycle
 *   2. install fires again after lifecycle reset (Set.clear())
 *   3. install failure does not block helper return + failure logged
 *   4. install call passes the SshChannel adapter (has exec method)
 *   5. install-attempted Set is the only tracking state (per-lifecycle,
 *      not per-process)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeInstallStopHook, makeSemaphore } from "./starter.js";
import type { SshChannel } from "./fleet-status/ssh-poll-orchestrator.js";
import type { systemLogger as SystemLoggerType } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// Shared test fixtures — fresh per test via beforeEach
// ---------------------------------------------------------------------------

type InstallStopHookFn = (
  channel: SshChannel,
) => Promise<{ hookInstalled: boolean; settingsUpdated: boolean }>;

let installStopHookMock: ReturnType<typeof vi.fn>;
let loggerMock: typeof SystemLoggerType;
let set: Set<string>;
let channelAdapter: SshChannel;

function makeDeps() {
  return {
    installStopHook: installStopHookMock as unknown as InstallStopHookFn,
    systemLogger: loggerMock,
  };
}

beforeEach(() => {
  installStopHookMock = vi.fn().mockResolvedValue({
    hookInstalled: true,
    settingsUpdated: false,
  });
  loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  } as unknown as typeof SystemLoggerType;
  set = new Set<string>();
  channelAdapter = {
    exec: vi.fn().mockResolvedValue("ok"),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 39-04 — maybeInstallStopHook helper", () => {
  it("Test 1: fires installStopHook exactly once per host per lifecycle", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(1);
    expect(installStopHookMock).toHaveBeenCalledWith(channelAdapter);
  });

  it("Test 2: fires again after lifecycle reset (set.clear())", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    // Simulate onLastUnsubscriber cleanup
    set.clear();
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(2);
  });

  it("Test 3: install failure does not block helper return + failure logged with err.message", async () => {
    installStopHookMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"));
    // Helper is void-return — call must return synchronously without throw
    const result = maybeInstallStopHook(
      "host-a",
      channelAdapter,
      set,
      makeDeps(),
    );
    expect(result).toBeUndefined();
    // Yield to microtask queue so the .catch handler runs
    await new Promise((r) => setImmediate(r));
    // Assert loggerMock.warn saw the structured failure payload with
    // both operation + error surfaced (Plan 03 formatMessage contract)
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const warnCall = (loggerMock.warn as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_hook_install_failed",
      error: "boom",
      fleetHostId: "host-a",
    });
  });

  it("Test 4: passes the SshChannel adapter (interface has exec method)", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    const passedArg = (
      installStopHookMock as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(typeof passedArg.exec).toBe("function");
    // And it must be the same reference we passed in
    expect(passedArg).toBe(channelAdapter);
  });

  it("Test 5: install-attempted Set is the only tracking state — reset re-arms across multiple lifecycles", () => {
    // Lifecycle 1
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(1);
    // Lifecycle boundary 1→2
    set.clear();
    // Lifecycle 2
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(2);
    // Lifecycle boundary 2→3
    set.clear();
    // Lifecycle 3
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Bounty b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24 — self-limit SSH exec
// concurrency via per-channel counting semaphore. Tests exercise the
// primitive directly (module-scope export) — full end-to-end integration
// via the real ssh2 Client is out of scope per the bounty constraint that
// ssh-poll-orchestrator.ts stays byte-identical.
// ---------------------------------------------------------------------------
describe("Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle", () => {
  it("Test A: caps concurrent in-flight at ≤ limit under 20-parallel load (cap-at-8 proof)", async () => {
    const sem = makeSemaphore(8);
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 25));
          inFlight--;
          return "ok";
        }),
      ),
    );
    // Load-bearing cap-at-8 assertion — if this ever slips, Skynet can
    // exceed OpenSSH default MaxSessions=10 again.
    expect(maxInFlight).toBeLessThanOrEqual(8);
    // Sanity: the semaphore did NOT refuse everything — at least one
    // task actually ran concurrently.
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
    // Nothing dropped — all 20 tasks resolved.
    expect(results).toHaveLength(20);
    expect(results.every((r) => r === "ok")).toBe(true);
  });

  it("Test B: throws from fn() propagate unchanged (semaphore does NOT catch)", async () => {
    const sem = makeSemaphore(8);
    // The channel adapter's outer try/catch → null MUST remain the sole
    // null-conversion point. If the semaphore ever starts swallowing
    // errors, every existing .exec consumer sees changed semantics.
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("Test C: successful string round-trips unchanged (happy-path pass-through)", async () => {
    const sem = makeSemaphore(8);
    const result = await sem.run(async () => "hello world");
    expect(result).toBe("hello world");
  });

  it("Test D: two independent semaphores can each run up to their cap concurrently (per-channel isolation proof)", async () => {
    const semA = makeSemaphore(8);
    const semB = makeSemaphore(8);
    let inFlightA = 0;
    let inFlightB = 0;
    let maxA = 0;
    let maxB = 0;
    let maxCombined = 0;
    const recordCombined = () => {
      maxCombined = Math.max(maxCombined, inFlightA + inFlightB);
    };
    const taskA = () =>
      semA.run(async () => {
        inFlightA++;
        maxA = Math.max(maxA, inFlightA);
        recordCombined();
        await new Promise((r) => setTimeout(r, 25));
        inFlightA--;
        return "a";
      });
    const taskB = () =>
      semB.run(async () => {
        inFlightB++;
        maxB = Math.max(maxB, inFlightB);
        recordCombined();
        await new Promise((r) => setTimeout(r, 25));
        inFlightB--;
        return "b";
      });
    const results = await Promise.all([
      ...Array.from({ length: 10 }, taskA),
      ...Array.from({ length: 10 }, taskB),
    ]);
    expect(maxA).toBeLessThanOrEqual(8);
    expect(maxB).toBeLessThanOrEqual(8);
    // Load-bearing isolation proof — if the two semaphores shared state
    // (e.g. module-scope), combined would cap at 8. ≥ 9 proves they are
    // independent per-connection buckets.
    expect(maxCombined).toBeGreaterThanOrEqual(9);
    expect(results).toHaveLength(20);
  });

  it("Test E: FIFO queue drains fully — all queued tasks eventually run under a tight cap", async () => {
    // Cap of 2 forces heavy queueing: 10 tasks × 10ms serialized 5-deep
    // = ~50ms wall time. If the finally-drain misfires, tasks 3-10 hang
    // and the vitest 5s default timeout trips.
    const sem = makeSemaphore(2);
    const tokens = Array.from({ length: 10 }, (_, i) => i);
    const results = await Promise.all(
      tokens.map((tok) =>
        sem.run(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return tok;
        }),
      ),
    );
    expect(results).toHaveLength(10);
    expect(results.sort((a, b) => a - b)).toEqual(tokens);
  });
});
