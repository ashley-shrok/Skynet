/**
 * scan-orchestrator.test.ts — Unit tests for the always-on spawn-request scanner.
 *
 * Coverage:
 *   S1-S3 — start() runs an initial pass + installs the interval; listSubstrateHosts
 *           called exactly once at start; per-host acquireChannel + scanSpawnRequests
 *           called for each returned host.
 *   T1-T2 — interval tick re-fires scanAllHosts; getScanTickCount reflects both
 *           the initial pass and every subsequent tick.
 *   E1-E3 — enqueue is called for every PendingBirth returned by scanSpawnRequests;
 *           empty batch → no enqueue; multiple hosts → per-host results all enqueue.
 *   G1-G2 — per-host in-flight guard skips a host whose prior scan is still awaiting,
 *           without blocking other hosts on the same tick.
 *   F1-F2 — never-throw contract: acquireChannel returning null does not throw
 *           and does not enqueue; listSubstrateHosts throwing does not throw upward.
 *   L1-L2 — stop() clears the interval; post-stop scanAllHosts is a no-op.
 *
 * Pattern mirrors server-substrate-orchestrator.test.ts (Phase 75 Plan 02).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { PendingBirth } from "./types.js";
import type { SpawnScanHostRecord } from "./scan-orchestrator.js";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../fleet-status/ssh-poll-orchestrator.js", () => ({
  scanSpawnRequests: vi.fn(async () => []),
  // parseSpawnRequestBatch used by the LOCAL bypass to feed tab-separated
  // stdout back into the standard parser. Default returns [] so tests that
  // don't opt into local-mode see the pre-fix baseline.
  parseSpawnRequestBatch: vi.fn(() => []),
}));

vi.mock("./queue.js", () => ({
  enqueue: vi.fn(),
}));

// Partial-mock identity-artifact-reader so we control isLocalHostId per test.
// Default = false (matches "not local host" — existing SSH-branch tests keep
// working without change).
vi.mock("../claude-session/identity-artifact-reader.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../claude-session/identity-artifact-reader.js")>();
  return {
    ...actual,
    isLocalHostId: vi.fn().mockReturnValue(false),
  };
});

// Mock the local-fleet-scan helper — LOCAL bypass path calls this. SSH-branch
// tests never trigger it; a default no-op keeps the pre-fix baseline.
vi.mock("../utils/local-fleet-scan.js", () => ({
  scanLocalFleetFolder: vi.fn(async () => []),
}));

import { createSpawnScanOrchestrator } from "./scan-orchestrator.js";
import {
  scanSpawnRequests,
  parseSpawnRequestBatch,
} from "../fleet-status/ssh-poll-orchestrator.js";
import { enqueue } from "./queue.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import { scanLocalFleetFolder } from "../utils/local-fleet-scan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(): SshChannel {
  return { exec: vi.fn(async () => "") };
}

function makePendingBirth(uuid: string, hostId: string): PendingBirth {
  return {
    hostId,
    hostIdNum: parseInt(hostId, 10) || 1,
    uuid,
    // quick-260923-9x1: PendingBirth shape uses `roles: string[]` + `prompt`
    // (D-13 bridge — the single `role:` field this fixture used was a bug
    // that TS never caught because Partial-shape helpers weren't in play).
    // `userId` removed — the field no longer exists on PendingBirth; the
    // response-write path uses hostConnDetails (unused by these tests, which
    // only assert that `enqueue` was called with the item).
    roles: ["test-role"],
    prompt: "",
    task: null,
    requested_at: "2026-09-12T00:00:00Z",
  };
}

function makeDeps(overrides: {
  hosts?: SpawnScanHostRecord[];
  acquireChannel?: (host: SpawnScanHostRecord) => Promise<SshChannel | null>;
  scanIntervalMs?: number;
} = {}) {
  const hosts =
    overrides.hosts ??
    ([{ id: "1", name: "host-1", _connDetails: {} }] as SpawnScanHostRecord[]);
  const channel = makeChannel();

  let capturedIntervalFn: (() => Promise<void> | void) | null = null;
  let intervalHandle = 0;

  const setIntervalMock = vi.fn((fn: () => Promise<void> | void, _ms: number) => {
    capturedIntervalFn = fn;
    intervalHandle++;
    return intervalHandle as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalMock = vi.fn();

  const listSubstrateHosts = vi.fn(async () => hosts);
  const acquireChannel =
    overrides.acquireChannel ??
    vi.fn(async (_host: SpawnScanHostRecord) => channel);
  const releaseChannel = vi.fn();
  const enqueueDep = vi.fn();

  const deps = {
    listSubstrateHosts,
    acquireChannel,
    releaseChannel,
    enqueue: enqueueDep,
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
    now: vi.fn(() => Date.now()),
    scanIntervalMs: overrides.scanIntervalMs,
  };

  return {
    deps,
    channel,
    listSubstrateHosts,
    acquireChannel: acquireChannel as ReturnType<typeof vi.fn>,
    releaseChannel,
    enqueueDep,
    setIntervalMock,
    clearIntervalMock,
    async fireTick() {
      if (capturedIntervalFn) await capturedIntervalFn();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scanSpawnRequests).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fire-and-forget per-host scans mean `start()` and `fireTick()` return
 * before the individual scanOneHost promises settle. Tests that assert on
 * mock-call counts (acquireChannel, scanSpawnRequests, enqueue) need to
 * drain the microtask queue first. Real setInterval doesn't await either,
 * so this mirrors production behavior.
 *
 * A handful of `Promise.resolve()` flushes covers scanOneHost's three
 * chained awaits (acquireChannel → scanSpawnRequests → releaseChannel).
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// S — start() semantics
// ---------------------------------------------------------------------------

describe("start() semantics", () => {
  it("S1: start() calls listSubstrateHosts exactly once and installs the interval", async () => {
    const { deps, listSubstrateHosts, setIntervalMock } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock.mock.calls[0][1]).toBe(10000); // default 10s
  });

  it("S2: start() acquires a channel per returned host and calls scanSpawnRequests per host", async () => {
    const hosts: SpawnScanHostRecord[] = [
      { id: "1", name: "host-1", _connDetails: {} },
      { id: "2", name: "host-2", _connDetails: {} },
      { id: "3", name: "host-3", _connDetails: {} },
    ];
    const { deps, acquireChannel } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);

    await orch.start();
    await flush();

    expect(acquireChannel).toHaveBeenCalledTimes(3);
    expect(vi.mocked(scanSpawnRequests)).toHaveBeenCalledTimes(3);
  });

  it("S3: scanIntervalMs override propagates to setInterval", async () => {
    const { deps, setIntervalMock } = makeDeps({ scanIntervalMs: 5000 });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    expect(setIntervalMock.mock.calls[0][1]).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// T — tick cadence
// ---------------------------------------------------------------------------

describe("tick cadence", () => {
  it("T1: interval tick fires scanAllHosts — listSubstrateHosts called on every tick", async () => {
    const { deps, listSubstrateHosts, fireTick } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);

    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(2);

    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(3);
  });

  it("T2: getScanTickCount increments on every scan (initial pass = 1, each tick += 1)", async () => {
    const { deps, fireTick } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    expect(orch.getScanTickCount()).toBe(1);

    await fireTick();
    expect(orch.getScanTickCount()).toBe(2);

    await fireTick();
    expect(orch.getScanTickCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// E — enqueue behavior
// ---------------------------------------------------------------------------

describe("enqueue behavior", () => {
  it("E1: enqueue called for every PendingBirth returned by scanSpawnRequests", async () => {
    const claimed = [
      makePendingBirth("uuid-a", "1"),
      makePendingBirth("uuid-b", "1"),
    ];
    vi.mocked(scanSpawnRequests).mockResolvedValueOnce(claimed);

    const { deps, enqueueDep } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();

    expect(enqueueDep).toHaveBeenCalledTimes(2);
    expect(enqueueDep).toHaveBeenNthCalledWith(1, claimed[0]);
    expect(enqueueDep).toHaveBeenNthCalledWith(2, claimed[1]);
  });

  it("E2: empty batch from scanSpawnRequests → no enqueue call", async () => {
    vi.mocked(scanSpawnRequests).mockResolvedValue([]);
    const { deps, enqueueDep } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
  });

  it("E3: multi-host — each host's batch enqueues independently", async () => {
    const hosts: SpawnScanHostRecord[] = [
      { id: "1", name: "host-1", _connDetails: {} },
      { id: "2", name: "host-2", _connDetails: {} },
    ];
    vi.mocked(scanSpawnRequests)
      .mockResolvedValueOnce([makePendingBirth("uuid-a", "1")])
      .mockResolvedValueOnce([
        makePendingBirth("uuid-b", "2"),
        makePendingBirth("uuid-c", "2"),
      ]);

    const { deps, enqueueDep } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();

    expect(enqueueDep).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// G — per-host in-flight guard (quick-260820-tm0 wilma pattern)
// ---------------------------------------------------------------------------

describe("per-host in-flight guard", () => {
  it("G1: a host whose scan is still awaiting is skipped on the next tick, but other hosts proceed", async () => {
    const hosts: SpawnScanHostRecord[] = [
      { id: "1", name: "slow", _connDetails: {} },
      { id: "2", name: "fast", _connDetails: {} },
    ];

    // Slow host: never resolves during the test window
    let releaseSlowChannel: () => void = () => {};
    const slowPromise = new Promise<[]>((resolve) => {
      releaseSlowChannel = () => resolve([]);
    });
    vi.mocked(scanSpawnRequests).mockImplementation(async (host) => {
      if (host.id === "1") return slowPromise;
      return [];
    });

    const { deps, acquireChannel, fireTick } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    // After initial pass, both hosts had a scan started; host 1 is still awaiting
    expect(acquireChannel).toHaveBeenCalledTimes(2);

    // Second tick: host 1 in-flight guard skips; host 2 proceeds (new acquire)
    await fireTick();
    await flush();
    // Total acquire calls: 2 (initial) + 1 (host 2 on second tick) = 3
    expect(acquireChannel).toHaveBeenCalledTimes(3);

    // Release slow host so test cleanup doesn't leak
    releaseSlowChannel();
    await slowPromise;
  });

  it("G2: in-flight guard releases after scanOneHost resolves — next tick re-scans", async () => {
    const hosts: SpawnScanHostRecord[] = [
      { id: "1", name: "host-1", _connDetails: {} },
    ];

    vi.mocked(scanSpawnRequests).mockResolvedValue([]);
    const { deps, acquireChannel, fireTick } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(1);

    // Second tick: guard was released after first scan resolved
    await fireTick();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(2);

    await fireTick();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// F — never-throw contract
// ---------------------------------------------------------------------------

describe("never-throw contract", () => {
  it("F1: acquireChannel returning null → no throw, no enqueue, releaseChannel not called for null channel", async () => {
    const { deps, enqueueDep, releaseChannel } = makeDeps({
      acquireChannel: vi.fn(async () => null),
    });
    const orch = createSpawnScanOrchestrator(deps);
    await expect(orch.start()).resolves.toBeUndefined();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
    expect(releaseChannel).not.toHaveBeenCalled();
  });

  it("F2: listSubstrateHosts throwing → start() still resolves, no enqueue", async () => {
    const { deps, enqueueDep } = makeDeps();
    deps.listSubstrateHosts.mockRejectedValueOnce(new Error("db down"));
    const orch = createSpawnScanOrchestrator(deps);
    await expect(orch.start()).resolves.toBeUndefined();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// L — lifecycle
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("L1: stop() clears the interval and future ticks after stop are no-ops", async () => {
    const { deps, clearIntervalMock, listSubstrateHosts, fireTick } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);

    orch.stop();
    expect(clearIntervalMock).toHaveBeenCalledTimes(1);

    // Even if a lingering interval callback somehow fires post-stop, it must
    // not re-enter scanAllHosts. The `stopped` flag guards this.
    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
  });

  it("L2: releaseChannel called after successful scan (symmetry with substrate + fleet-status)", async () => {
    const { deps, releaseChannel } = makeDeps();
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(releaseChannel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// LB — LOCAL-host bypass (scan the container-side bind-mount, skip SSH)
//
// When the host record's numeric id is in IDENTITIES_LOCAL_HOST_IDS (i.e. the
// container's own host), scanOneHost must skip acquireChannel entirely and
// read via the local-fleet-scan helper instead. This closes the SSH-to-self
// hang bug where the per-host in-flight guard stays held forever.
// ---------------------------------------------------------------------------

describe("LOCAL-host bypass", () => {
  const isLocalHostIdMock = isLocalHostId as unknown as ReturnType<typeof vi.fn>;
  const scanLocalMock = scanLocalFleetFolder as unknown as ReturnType<typeof vi.fn>;
  const parseSpawnMock = parseSpawnRequestBatch as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isLocalHostIdMock.mockReturnValue(false);
    scanLocalMock.mockReset().mockResolvedValue([]);
    parseSpawnMock.mockReset().mockReturnValue([]);
  });

  it("LB1: local-host branch calls scanLocalFleetFolder and NOT acquireChannel/releaseChannel/scanSpawnRequests", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 6);
    const hosts: SpawnScanHostRecord[] = [
      { id: "6", name: "skynet-local", _connDetails: {} },
    ];
    const { deps, acquireChannel, releaseChannel } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(scanLocalMock).toHaveBeenCalledWith("spawn-requests");
    expect(acquireChannel).not.toHaveBeenCalled();
    expect(releaseChannel).not.toHaveBeenCalled();
    expect(vi.mocked(scanSpawnRequests)).not.toHaveBeenCalled();
  });

  it("LB2: empty local scan → no enqueue and no parseSpawnRequestBatch call", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 6);
    scanLocalMock.mockResolvedValue([]);
    const hosts: SpawnScanHostRecord[] = [
      { id: "6", name: "skynet-local", _connDetails: {} },
    ];
    const { deps, enqueueDep } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
    expect(parseSpawnMock).not.toHaveBeenCalled();
  });

  it("LB3: local scan yields items → each enqueued (via parseSpawnRequestBatch on the reconstructed tab-separated stdout)", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 6);
    const uuidA = "aaaaaaaa-1111-2222-3333-444444444444";
    const uuidB = "bbbbbbbb-1111-2222-3333-444444444444";
    scanLocalMock.mockResolvedValue([
      { filename: `${uuidA}.json`, contents: '{"role":"r","task":null,"requested_at":"2026-09-18T00:00:00Z"}' },
      { filename: `${uuidB}.json`, contents: '{"role":"r2","task":null,"requested_at":"2026-09-18T00:00:00Z"}' },
    ]);
    const claimed: PendingBirth[] = [
      makePendingBirth(uuidA, "6"),
      makePendingBirth(uuidB, "6"),
    ];
    parseSpawnMock.mockReturnValue(claimed);
    const hosts: SpawnScanHostRecord[] = [
      { id: "6", name: "skynet-local", _connDetails: {} },
    ];
    const { deps, enqueueDep } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();

    // parseSpawnRequestBatch received the tab-separated shape with both items.
    expect(parseSpawnMock).toHaveBeenCalledTimes(1);
    const [stdoutArg, hostIdArg] = parseSpawnMock.mock.calls[0];
    expect(hostIdArg).toBe("6");
    expect(stdoutArg).toContain(`${uuidA}.json\t`);
    expect(stdoutArg).toContain(`${uuidB}.json\t`);

    expect(enqueueDep).toHaveBeenCalledTimes(2);
    expect(enqueueDep).toHaveBeenNthCalledWith(1, claimed[0]);
    expect(enqueueDep).toHaveBeenNthCalledWith(2, claimed[1]);
  });

  it("LB4: mixed fleet — local host uses local helper, remote host still uses SSH scanSpawnRequests", async () => {
    isLocalHostIdMock.mockImplementation((n: number) => n === 6);
    const uuid = "aaaaaaaa-1111-2222-3333-444444444444";
    scanLocalMock.mockResolvedValue([
      { filename: `${uuid}.json`, contents: '{"role":"r","task":null,"requested_at":"2026-09-18T00:00:00Z"}' },
    ]);
    parseSpawnMock.mockReturnValue([makePendingBirth(uuid, "6")]);

    const hosts: SpawnScanHostRecord[] = [
      { id: "6", name: "skynet-local", _connDetails: {} },
      { id: "7", name: "remote", _connDetails: {} },
    ];
    // Remote host's scanSpawnRequests returns one distinct item.
    vi.mocked(scanSpawnRequests).mockResolvedValue([makePendingBirth("remote-uuid", "7")]);
    const { deps, acquireChannel, enqueueDep } = makeDeps({ hosts });
    const orch = createSpawnScanOrchestrator(deps);
    await orch.start();
    await flush();

    // Local: scanLocal called once, acquireChannel NOT called for host 6.
    expect(scanLocalMock).toHaveBeenCalledTimes(1);
    // Remote: acquireChannel called exactly once (host 7).
    expect(acquireChannel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(acquireChannel).mock.calls[0][0].id).toBe("7");
    // Both hosts' items enqueued.
    expect(enqueueDep).toHaveBeenCalledTimes(2);
  });
});
