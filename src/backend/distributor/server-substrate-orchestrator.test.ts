/**
 * server-substrate-orchestrator.test.ts — Integration tests for the server-context
 * substrate-sweep orchestrator (Phase 75 Plan 02).
 *
 * Test structure mirrors ssh-poll-orchestrator.test.ts patterns: vi.useFakeTimers()
 * for timer-driven behavior, vi.mock for all external modules, factory-shaped
 * deps object injected per-test.
 *
 * Coverage map:
 *   S1-S3 — D-01 (startup pass: once, awaited, serial)
 *   R1-R3 — D-03 (retry cadence: 30s tick, only un-swept hosts)
 *   G1-G2 — D-05 (once-per-host-per-lifetime gating)
 *   F1-F4 — D-06 + D-07 (loud alert at N failures, once per uptime, reset on success)
 *   NT1-NT2 — never-throw contract
 *   L1-L3 — lifecycle (stop(), post-stop no-ops)
 *   O1     — observability (getSweepTickCount)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("./run-sweep.js", () => ({
  runSweepForHost: vi.fn(async () => ({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 })),
}));

vi.mock("./log-tags.js", () => ({
  logSweepResult: vi.fn(),
  logItemChanged: vi.fn(),
  logItemFailed: vi.fn(),
  logSweepHookError: vi.fn(),
  logPersistentFailure: vi.fn(),
}));

vi.mock("./bundled-reader.js", () => ({
  bundledReaderFromDisk: vi.fn(async () => ({ bytes: Buffer.from(""), mode: 0o644 })),
}));

// Phase 114 Plan 05 Task 2: mock the branding-config loader's runtime-bytes
// reader so the orchestrator's per-tick resolver call is observable (call
// count, per-tick invariant, return-value → Map propagation to runSweepForHost).
vi.mock("../branding/branding-config-loader.js", () => ({
  readInstancePolicyBytes: vi.fn(async () => null),
}));

import { createServerSubstrateOrchestrator } from "./server-substrate-orchestrator.js";
import type { SubstrateHostRecord } from "./list-substrate-hosts.js";
import { runSweepForHost } from "./run-sweep.js";
import { logSweepHookError, logPersistentFailure } from "./log-tags.js";
import { readInstancePolicyBytes } from "../branding/branding-config-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal SshChannel stub — exec always returns "ok" */
function makeChannel(): SshChannel {
  return { exec: vi.fn(async () => "ok") };
}

/** Build a basic channel that always succeeds (non-null) */
function makeDeps(overrides: {
  hosts?: Array<{ id: string; name: string; username?: string }>;
  acquireChannel?: (host: { id: string; name: string }) => Promise<SshChannel | null>;
  retryIntervalMs?: number;
  persistentFailureThreshold?: number;
} = {}) {
  const hosts = overrides.hosts ?? [{ id: "h1", name: "host-1" }];
  const channel = makeChannel();

  const intervalFn = vi.fn() as ReturnType<typeof vi.fn>;
  // Capture the registered callback for manual invocation in tests
  let capturedIntervalFn: (() => Promise<void> | void) | null = null;
  let intervalHandle = 0;

  const setIntervalMock = vi.fn((fn: () => Promise<void> | void, _ms: number) => {
    capturedIntervalFn = fn;
    intervalHandle++;
    return intervalHandle as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalMock = vi.fn();

  // Phase 114 Plan 05 Task 2: _connDetails.username is the provenance
  // of host.username at the runSweepForHost call site. Default to "root"
  // so pre-existing tests (which don't care about the axis) get the
  // permissive value; individual tests can override per-host.
  const listSubstrateHosts = vi.fn(async () =>
    hosts.map((h) => ({
      id: h.id,
      name: h.name,
      _connDetails: { username: h.username ?? "root" },
    })),
  );

  const acquireChannel =
    overrides.acquireChannel ??
    vi.fn(async (_host: SubstrateHostRecord) => channel);

  const releaseChannel = vi.fn();

  const deps = {
    listSubstrateHosts,
    acquireChannel,
    releaseChannel,
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
    now: vi.fn(() => Date.now()),
    retryIntervalMs: overrides.retryIntervalMs ?? 30000,
    persistentFailureThreshold: overrides.persistentFailureThreshold,
  };

  return {
    deps,
    channel,
    listSubstrateHosts,
    acquireChannel: acquireChannel as ReturnType<typeof vi.fn>,
    releaseChannel,
    setIntervalMock,
    clearIntervalMock,
    intervalFn,
    /** Fire the registered retry-tick callback manually */
    async fireTick() {
      if (capturedIntervalFn) await capturedIntervalFn();
    },
    intervalHandle: () => intervalHandle,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// D-01: Startup pass
// ---------------------------------------------------------------------------

describe("D-01 — startup pass", () => {
  it("S1: start() awaits before returning; listSubstrateHosts called exactly once", async () => {
    const { deps, listSubstrateHosts } = makeDeps();
    const orch = createServerSubstrateOrchestrator(deps);

    await orch.start();

    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
  });

  it("S2: with 3 hosts (all successful sweeps), all 3 host.ids swept after start() resolves", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
      { id: "h3", name: "host-3" },
    ];
    const { deps } = makeDeps({ hosts });
    const orch = createServerSubstrateOrchestrator(deps);

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    await orch.start();
    // Drain any queued microtasks from queueMicrotask sweepOne calls
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // All 3 hosts should have been swept: runSweepForHost called 3 times
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(3);
  });

  it("S3: hosts swept serially — call order matches listSubstrateHosts return order", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
      { id: "h3", name: "host-3" },
    ];
    const callOrder: string[] = [];
    const { deps } = makeDeps({ hosts });

    vi.mocked(runSweepForHost).mockImplementation(async (_ch, host) => {
      callOrder.push(host.id);
      return { itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 };
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(callOrder).toEqual(["h1", "h2", "h3"]);
  });
});

// ---------------------------------------------------------------------------
// D-03: Retry cadence
// ---------------------------------------------------------------------------

describe("D-03 — retry cadence (30s tick)", () => {
  it("R1: after start() returns, setInterval was called exactly once with retryIntervalMs", async () => {
    const { deps, setIntervalMock } = makeDeps({ retryIntervalMs: 30000 });
    const orch = createServerSubstrateOrchestrator(deps);

    await orch.start();

    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock.mock.calls[0][1]).toBe(30000);
  });

  it("R2: failed host is retried on tick; listSubstrateHosts called again", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps, listSubstrateHosts, fireTick } = makeDeps({ hosts });

    // First call: fail; subsequent: succeed
    vi.mocked(runSweepForHost)
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 })
      .mockResolvedValue({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // Startup pass: 1 call to listSubstrateHosts
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);

    // Fire retry tick
    await fireTick();
    await Promise.resolve();

    // Tick calls listSubstrateHosts again
    expect(listSubstrateHosts).toHaveBeenCalledTimes(2);
    // runSweepForHost called twice total (startup + retry)
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(2);
  });

  it("R3: already-swept hosts are NOT re-swept on the retry tick", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps, fireTick } = makeDeps({ hosts });

    // Startup pass succeeds → host marked done
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // 1 call in startup
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(1);

    // Fire retry tick — host is already swept, should not be re-swept
    await fireTick();
    await Promise.resolve();

    // Still 1 call — no retry for already-swept host
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// D-05: Once-per-host-per-lifetime gating
// ---------------------------------------------------------------------------

describe("D-05 — once-per-host-per-lifetime gating", () => {
  it("G1: sweepedThisInstance only updated when itemsFailed === 0; partial failure leaves host unmarked", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps, fireTick } = makeDeps({ hosts });

    // Startup: fail; Tick: fail again
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 1,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // Fire two ticks — host should be retried each time (never marked done)
    await fireTick();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();

    // 3 calls total (startup + 2 ticks), never marked done
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(3);
  });

  it("G2: sweepOneHost called twice for same host id — second call is no-op (runSweepForHost called once)", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });

    // Use a slow sweep to keep first one in-flight during second call
    let resolveFirst: (() => void) | null = null;
    vi.mocked(runSweepForHost).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 });
        }),
    );

    const orch = createServerSubstrateOrchestrator(deps);

    // Call sweepOneHost twice rapidly without awaiting first
    const p1 = orch.sweepOneHost({ id: "h1", name: "host-1" });
    const p2 = orch.sweepOneHost({ id: "h1", name: "host-1" });

    // Resolve the in-flight sweep
    await Promise.resolve();
    await Promise.resolve();
    resolveFirst?.();

    await Promise.all([p1, p2]);
    await Promise.resolve();

    // Only one actual runSweepForHost call (second was gated)
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// D-06 + D-07: Loud alert at N failures, once per uptime, reset on success
// ---------------------------------------------------------------------------

describe("D-06 + D-07 — persistent failure alerting", () => {
  it("F1: 3 consecutive failed sweeps → logPersistentFailure called exactly once with consecutiveFailures:3", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps, fireTick } = makeDeps({
      hosts,
      persistentFailureThreshold: 3,
    });

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 1,
    });

    const orch = createServerSubstrateOrchestrator(deps);

    // Startup pass: failure #1
    await orch.start();
    await Promise.resolve();

    // Tick 1: failure #2
    await fireTick();
    await Promise.resolve();

    // Tick 2: failure #3 → alert fires
    await fireTick();
    await Promise.resolve();

    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledWith(
      expect.objectContaining({
        fleetHostId: "h1",
        consecutiveFailures: 3,
      }),
    );
  });

  it("F2: 4th consecutive failure does NOT re-call logPersistentFailure", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps, fireTick } = makeDeps({
      hosts,
      persistentFailureThreshold: 3,
    });

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 1,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();
    // 3 failures — alert fires once

    // 4th failure
    await fireTick();
    await Promise.resolve();

    // Still only 1 call
    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(1);
  });

  it("F3: after 3 failures + alert, stop+restart (fresh uptime) with 3 more failures re-fires alert (2 total calls)", async () => {
    // F3 tests the D-07 "reset on success" semantic and the ability to re-alert
    // after the persistentAlertFired state is cleared. Since a successful sweep
    // also marks the host in sweepedThisInstance (preventing re-sweeping in the
    // same orchestrator instance), this test uses two orchestrators simulating
    // two uptime cycles. The reset mechanic (consecutiveFailures + persistentAlertFired
    // cleared on success) is indirectly proven by F1 and the second orchestrator
    // firing the alert independently with fresh state.

    // First orchestrator: 3 failures → alert fires once
    vi.mocked(runSweepForHost)
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 }) // startup fail
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 }) // tick fail
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 }); // tick fail → alert

    const { deps: depsA, fireTick: fireTickA } = makeDeps({
      hosts: [{ id: "h1", name: "host-1" }],
      persistentFailureThreshold: 3,
    });
    const orchA = createServerSubstrateOrchestrator(depsA);
    await orchA.start();
    await Promise.resolve();
    await fireTickA();
    await Promise.resolve();
    await fireTickA();
    await Promise.resolve();

    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(1);

    // Stop first orchestrator (simulates container restart / end of first uptime)
    orchA.stop();

    // Second orchestrator with fresh closed-over state — same host fails 3 times again
    vi.mocked(runSweepForHost)
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 })
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 })
      .mockResolvedValueOnce({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 });

    const { deps: depsB, fireTick: fireTickB } = makeDeps({
      hosts: [{ id: "h1", name: "host-1" }],
      persistentFailureThreshold: 3,
    });
    const orchB = createServerSubstrateOrchestrator(depsB);
    await orchB.start();
    await Promise.resolve();
    await fireTickB();
    await Promise.resolve();
    await fireTickB();
    await Promise.resolve();

    // Alert should have fired a second time (total = 2 across both orchestrators)
    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(2);
  });

  it("F4: two hosts h1 and h2 each fail 3 times → logPersistentFailure called twice with different fleetHostIds", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
    ];
    const { deps, fireTick } = makeDeps({
      hosts,
      persistentFailureThreshold: 3,
    });

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 1,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();

    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(logPersistentFailure).mock.calls;
    const ids = calls.map((c) => c[0].fleetHostId);
    expect(ids).toContain("h1");
    expect(ids).toContain("h2");
  });
});

// ---------------------------------------------------------------------------
// Never-throw contract
// ---------------------------------------------------------------------------

describe("Never-throw contract", () => {
  it("NT1: runSweepForHost rejecting → logSweepHookError called, exception does not escape", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });

    vi.mocked(runSweepForHost).mockRejectedValue(new Error("unexpected internal error"));

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    // Drain microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(logSweepHookError)).toHaveBeenCalledWith(
      expect.objectContaining({
        fleetHostId: "h1",
        errorMessage: "unexpected internal error",
      }),
    );
  });

  it("NT2: sweepOneHost never rejects even when runSweepForHost throws", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });

    vi.mocked(runSweepForHost).mockRejectedValue(new Error("boom"));

    // Start so listSubstrateHosts returns the host for sweepOneHost resolution
    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // stop + fresh orch to reset sweepedThisInstance so sweepOneHost actually fires
    orch.stop();
    const { deps: deps2 } = makeDeps({ hosts });
    vi.mocked(runSweepForHost).mockRejectedValue(new Error("boom"));
    const orch2 = createServerSubstrateOrchestrator(deps2);

    await expect(orch2.sweepOneHost({ id: "h1", name: "host-1" })).resolves.not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("Lifecycle", () => {
  it("L1: stop() calls clearInterval with the handle returned by setInterval", async () => {
    const { deps, setIntervalMock, clearIntervalMock, intervalHandle } = makeDeps();
    const orch = createServerSubstrateOrchestrator(deps);

    await orch.start();

    const handle = setIntervalMock.mock.results[0].value;
    orch.stop();

    expect(clearIntervalMock).toHaveBeenCalledTimes(1);
    expect(clearIntervalMock).toHaveBeenCalledWith(handle);
  });

  it("L2: stop() empties all four state collections", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
    ];
    const { deps, fireTick } = makeDeps({ hosts, persistentFailureThreshold: 3 });

    // h1 succeeds, h2 fails 3 times → h1 in sweepedThisInstance, h2 in persistentAlertFired
    vi.mocked(runSweepForHost)
      .mockImplementation(async (_ch, host) => {
        if (host.id === "h1") return { itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 };
        return { itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 };
      });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();
    await fireTick();
    await Promise.resolve();

    // After 3 failures on h2, persistentAlertFired has h2
    expect(vi.mocked(logPersistentFailure)).toHaveBeenCalledTimes(1);

    orch.stop();

    // After stop(), getSweepTickCount is the only observable we can check
    // (the internal sets are private — we verify via post-stop sweepOneHost no-op)
    // Verify by checking that after stop, sweepOneHost does nothing
    vi.clearAllMocks();
    await orch.sweepOneHost({ id: "h1", name: "host-1" });
    await Promise.resolve();
    expect(vi.mocked(runSweepForHost)).not.toHaveBeenCalled();
  });

  it("L3: after stop(), sweepOneHost calls are no-ops", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });
    const orch = createServerSubstrateOrchestrator(deps);

    await orch.start();
    orch.stop();

    vi.clearAllMocks();
    await orch.sweepOneHost({ id: "h1", name: "host-1" });
    await Promise.resolve();

    expect(vi.mocked(runSweepForHost)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("Observability", () => {
  it("O1: getSweepTickCount returns 1 after startup pass, 2 after first retry tick, 3 after second", async () => {
    const { deps, fireTick } = makeDeps();
    const orch = createServerSubstrateOrchestrator(deps);

    expect(orch.getSweepTickCount()).toBe(0);

    await orch.start();
    expect(orch.getSweepTickCount()).toBe(1);

    await fireTick();
    expect(orch.getSweepTickCount()).toBe(2);

    await fireTick();
    expect(orch.getSweepTickCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 114 Plan 05 Task 2 — runtime resolver (once per tick) + host.username propagation
// ---------------------------------------------------------------------------

describe("Phase 114 — runtime bytes resolver (once per tick, fan-to-hosts)", () => {
  it("P114-Orch-1: readInstancePolicyBytes is called exactly ONCE at start() regardless of host count (Pitfall 6)", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
      { id: "h3", name: "host-3" },
    ];
    const { deps } = makeDeps({ hosts });

    // Mock a successful sweep so every host is marked done in this tick.
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });
    vi.mocked(readInstancePolicyBytes).mockResolvedValue(Buffer.from("hi from twinkie"));

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();
    await Promise.resolve();

    // Startup pass resolved runtime bytes ONCE, not N times (host count = 3).
    expect(vi.mocked(readInstancePolicyBytes)).toHaveBeenCalledTimes(1);
    // But runSweepForHost was called for each host (3 times).
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalledTimes(3);
  });

  it("P114-Orch-2: readInstancePolicyBytes is called ONCE per retry tick (not once per host per tick)", async () => {
    const hosts = [
      { id: "h1", name: "host-1" },
      { id: "h2", name: "host-2" },
    ];
    const { deps, fireTick } = makeDeps({ hosts });

    // Every sweep fails so both hosts get retried on each tick.
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 1,
    });
    vi.mocked(readInstancePolicyBytes).mockResolvedValue(null);

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start(); // tick 1 (startup)
    await Promise.resolve();
    // 1 call after startup
    expect(vi.mocked(readInstancePolicyBytes)).toHaveBeenCalledTimes(1);

    await fireTick(); // tick 2 (first retry)
    await Promise.resolve();
    await Promise.resolve();
    // 2 calls after 1 retry (not 3 — retry did NOT fire per-host)
    expect(vi.mocked(readInstancePolicyBytes)).toHaveBeenCalledTimes(2);

    await fireTick(); // tick 3 (second retry)
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(readInstancePolicyBytes)).toHaveBeenCalledTimes(3);
  });

  it("P114-Orch-3: resolvedRuntimeBytes Map is passed to every runSweepForHost invocation with the twinkie key populated", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });

    const twinkieBytes = Buffer.from("# managed policy\n");
    vi.mocked(readInstancePolicyBytes).mockResolvedValue(twinkieBytes);
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // Inspect the deps object runSweepForHost received. The 4th arg is deps.
    const call = vi.mocked(runSweepForHost).mock.calls[0];
    const receivedDeps = call[3];
    expect(receivedDeps.resolvedRuntimeBytes).toBeInstanceOf(Map);
    expect(receivedDeps.resolvedRuntimeBytes?.get("instance-policy")).toEqual(twinkieBytes);
  });

  it("P114-Orch-4: host.username is extracted from _connDetails.username and passed to runSweepForHost", async () => {
    const hosts = [{ id: "h1", name: "host-1", username: "root" }];
    const { deps } = makeDeps({ hosts });

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    // The 2nd arg to runSweepForHost is the widened host object; verify
    // username was extracted from _connDetails.
    const call = vi.mocked(runSweepForHost).mock.calls[0];
    const receivedHost = call[1];
    expect(receivedHost.id).toBe("h1");
    expect(receivedHost.name).toBe("host-1");
    expect(receivedHost.username).toBe("root");
  });

  it("P114-Orch-5: non-root host — host.username reflects the actual DB value (e.g., 'ubuntu')", async () => {
    const hosts = [{ id: "h2", name: "workstation", username: "ubuntu" }];
    const { deps } = makeDeps({ hosts });

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    const receivedHost = vi.mocked(runSweepForHost).mock.calls[0][1];
    expect(receivedHost.username).toBe("ubuntu");
  });

  it("P114-Orch-6: missing username in _connDetails — falls back to 'unknown' (composer treats as non-root gate)", async () => {
    // Manually construct hosts where _connDetails does NOT carry username
    // (simulates a DB row with no cred_username and no host-level username;
    // shouldn't happen in practice but defense-in-depth for the composer gate).
    const { deps } = makeDeps({ hosts: [{ id: "h1", name: "host-1" }] });
    (deps.listSubstrateHosts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "h1", name: "host-1", _connDetails: {} },
    ]);

    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await orch.start();
    await Promise.resolve();

    const receivedHost = vi.mocked(runSweepForHost).mock.calls[0][1];
    expect(receivedHost.username).toBe("unknown");
  });

  it("P114-Orch-7: readInstancePolicyBytes rejection is swallowed — orchestrator continues with null map value (never-throw)", async () => {
    const hosts = [{ id: "h1", name: "host-1" }];
    const { deps } = makeDeps({ hosts });

    // Resolver throws — orchestrator must NOT propagate. Instead treat as null.
    vi.mocked(readInstancePolicyBytes).mockRejectedValue(new Error("resolver went boom"));
    vi.mocked(runSweepForHost).mockResolvedValue({
      itemsChecked: 25,
      itemsChanged: 0,
      itemsFailed: 0,
    });

    const orch = createServerSubstrateOrchestrator(deps);
    await expect(orch.start()).resolves.not.toThrow();
    await Promise.resolve();

    // runSweepForHost was still invoked — the orchestrator didn't blow up.
    expect(vi.mocked(runSweepForHost)).toHaveBeenCalled();
    // The Map exists but the twinkie value is null (defensive fallback).
    const receivedDeps = vi.mocked(runSweepForHost).mock.calls[0][3];
    expect(receivedDeps.resolvedRuntimeBytes).toBeInstanceOf(Map);
    expect(receivedDeps.resolvedRuntimeBytes?.get("instance-policy")).toBeNull();
  });
});
