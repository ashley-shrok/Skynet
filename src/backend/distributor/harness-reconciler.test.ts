/**
 * harness-reconciler.test.ts — Per-host gating, backoff, alerting and routing
 * for the harness reconciler, with fake channels and a controllable clock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { systemLogger } from "../utils/logger.js";
import {
  createHarnessReconciler,
  HARNESS_BACKOFF_BASE_MS,
  HARNESS_BACKOFF_CAP_MS,
  HARNESS_ATTEMPT_TIMEOUT_MS,
  type HarnessReconcilerDeps,
} from "./harness-reconciler.js";

const PIN = "2.1.286";
const hostA = { id: "1", name: "alpha" };
const hostB = { id: "2", name: "bravo" };
const local = { id: "6", name: "harbor" };

const line = (rest: string) => `HARNESS_RESULT ${rest}`;
const OK_NONE = line(`action=none wanted=${PIN} found=${PIN} detail=already on pin`);
const OK_INSTALLED = line(`action=installed wanted=${PIN} found=none pruned=2.1.100 detail=ok`);
const FAILED = line(`action=failed wanted=${PIN} found=none reason=low-disk detail=10KiB free`);

/** Drain queued microtasks + the async attempt chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeDeps(execOutputs: Array<string | null>) {
  let clock = 1_000_000;
  const exec = vi.fn(async () => (execOutputs.length > 1 ? execOutputs.shift()! : execOutputs[0]));
  const channel: SshChannel = { exec };
  const deps: HarnessReconcilerDeps & { advance(ms: number): void } = {
    acquireChannel: vi.fn(async () => channel),
    releaseChannel: vi.fn(),
    isLocalHost: (h) => h.id === local.id,
    runLocal: vi.fn(async () => OK_NONE),
    now: () => clock,
    pin: PIN,
    advance(ms: number) {
      clock += ms;
    },
  };
  return { deps, exec };
}

function harnessLogs(op: string) {
  const all = [
    ...vi.mocked(systemLogger.info).mock.calls,
    ...vi.mocked(systemLogger.warn).mock.calls,
  ];
  return all.filter((c) => (c[1] as { operation?: string } | undefined)?.operation === op);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("harness reconciler", () => {
  it("runs the reconcile once per host and then treats it as converged", async () => {
    const { deps, exec } = makeDeps([OK_INSTALLED]);
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain(`'${PIN}'`);
    expect(deps.releaseChannel).toHaveBeenCalledTimes(1);

    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);

    const results = harnessLogs("fleet_substrate_harness_result");
    expect(results).toHaveLength(1);
    expect(results[0][1]).toMatchObject({
      fleetHostId: "1",
      hostName: "alpha",
      action: "installed",
      wanted: PIN,
      found: "none",
      pruned: "2.1.100",
    });
  });

  it("does not double-fire while an attempt is in flight", async () => {
    let release!: (v: string) => void;
    const { deps } = makeDeps([OK_NONE]);
    const exec = vi.fn(() => new Promise<string>((res) => (release = res)));
    deps.acquireChannel = vi.fn(async () => ({ exec }));
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    await flush();
    r.queue(hostA);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
    release(OK_NONE);
    await flush();
  });

  it("keeps hosts independent", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    r.queue(hostB);
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially after failures, capped at an hour", async () => {
    const { deps, exec } = makeDeps([FAILED]);
    const r = createHarnessReconciler(deps);

    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);

    // Inside the first backoff window: no retry.
    deps.advance(HARNESS_BACKOFF_BASE_MS - 1);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);

    // Window elapsed: retry (2nd failure → 2× base).
    deps.advance(1);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);

    deps.advance(HARNESS_BACKOFF_BASE_MS * 2 - 1);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(2);
    deps.advance(1);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(3);

    const warns = harnessLogs("fleet_substrate_harness_result");
    const delays = warns.map((c) => (c[1] as { retryInMs: number }).retryInMs);
    expect(delays).toEqual([HARNESS_BACKOFF_BASE_MS, HARNESS_BACKOFF_BASE_MS * 2, HARNESS_BACKOFF_BASE_MS * 4]);

    // Drive many more failures: the delay never exceeds the cap.
    for (let i = 0; i < 10; i++) {
      deps.advance(HARNESS_BACKOFF_CAP_MS);
      r.queue(hostA);
      await flush();
    }
    const last = harnessLogs("fleet_substrate_harness_result").at(-1)![1] as { retryInMs: number };
    expect(last.retryInMs).toBe(HARNESS_BACKOFF_CAP_MS);
  });

  it("alerts once at the third consecutive failure and re-arms after success", async () => {
    const { deps } = makeDeps([FAILED, FAILED, FAILED, FAILED, OK_INSTALLED]);
    const r = createHarnessReconciler(deps);
    for (let i = 0; i < 5; i++) {
      r.queue(hostA);
      await flush();
      deps.advance(HARNESS_BACKOFF_CAP_MS);
    }
    const alerts = harnessLogs("fleet_substrate_harness_persistent_failure");
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({ fleetHostId: "1", consecutiveFailures: 3, reason: "low-disk" });
  });

  it("does not count an unreachable host as an attempt (no backoff)", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    let reachable = false;
    const channel: SshChannel = { exec };
    deps.acquireChannel = vi.fn(async () => (reachable ? channel : null));
    const r = createHarnessReconciler(deps);

    r.queue(hostA);
    await flush();
    expect(harnessLogs("fleet_substrate_harness_result")).toHaveLength(0);

    // Comes back on the very next tick — no backoff window to wait out.
    reachable = true;
    deps.advance(30_000);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("treats output with no result line as a failed attempt", async () => {
    const { deps } = makeDeps([null]);
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    await flush();
    const res = harnessLogs("fleet_substrate_harness_result");
    expect(res[0][1]).toMatchObject({ action: "failed", reason: "no-result" });
  });

  it("treats a thrown exec as a failed attempt and still releases the channel", async () => {
    const { deps } = makeDeps([OK_NONE]);
    deps.acquireChannel = vi.fn(async () => ({
      exec: vi.fn(async () => {
        throw new Error("channel torn down");
      }),
    }));
    const r = createHarnessReconciler(deps);
    expect(() => r.queue(hostA)).not.toThrow();
    await flush();
    expect(deps.releaseChannel).toHaveBeenCalledTimes(1);
    expect(harnessLogs("fleet_substrate_harness_result")[0][1]).toMatchObject({
      action: "failed",
      reason: "exception",
      detail: "channel torn down",
    });
  });

  it("passes the full attempt budget INTO the exec (the substrate channel's 5-min default would cut an install short)", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
    expect((exec.mock.calls[0] as unknown[])[2]).toEqual({ timeoutMs: HARNESS_ATTEMPT_TIMEOUT_MS });
    expect(HARNESS_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(5 * 60 * 1000);

    const custom = makeDeps([OK_NONE]);
    custom.deps.attemptTimeoutMs = 1234;
    createHarnessReconciler(custom.deps).queue(hostA);
    await flush();
    expect((custom.exec.mock.calls[0] as unknown[])[2]).toEqual({ timeoutMs: 1234 });
  });

  it("routes the co-located host through runLocal, never SSH", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    const r = createHarnessReconciler(deps);
    r.queue(local);
    await flush();
    expect(deps.runLocal).toHaveBeenCalledWith(PIN);
    expect(deps.acquireChannel).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("counts skipped (non-Linux) as converged — no retries", async () => {
    const { deps, exec } = makeDeps([
      line(`action=skipped wanted=${PIN} found=unknown reason=not-linux detail=Darwin`),
    ]);
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    await flush();
    deps.advance(HARNESS_BACKOFF_CAP_MS);
    r.queue(hostA);
    await flush();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("refuses to run with a non-exact pin", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    deps.pin = "latest";
    const r = createHarnessReconciler(deps);
    r.queue(hostA);
    r.queue(hostB);
    await flush();
    expect(exec).not.toHaveBeenCalled();
    expect(harnessLogs("fleet_substrate_harness_bad_pin")).toHaveLength(1);
  });

  it("abandons an attempt that never returns, logs a timeout and backs off", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps([OK_NONE]);
      const exec = vi.fn(() => new Promise<string>(() => {}));
      deps.acquireChannel = vi.fn(async () => ({ exec }));
      const r = createHarnessReconciler({ ...deps, attemptTimeoutMs: 5000 });
      r.queue(hostA);
      await flush();
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
      expect(harnessLogs("fleet_substrate_harness_result")[0][1]).toMatchObject({
        action: "failed",
        reason: "timeout",
      });
      expect(deps.releaseChannel).not.toHaveBeenCalled();
      // No longer stuck in flight: once the backoff passes it tries again.
      deps.advance(HARNESS_BACKOFF_BASE_MS);
      r.queue(hostA);
      await flush();
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is inert after stop()", async () => {
    const { deps, exec } = makeDeps([OK_NONE]);
    const r = createHarnessReconciler(deps);
    r.stop();
    r.queue(hostA);
    await flush();
    expect(exec).not.toHaveBeenCalled();
  });
});
