/**
 * image-gen-requests/scan-orchestrator.test.ts — Unit tests for the always-on
 * image-gen-request scanner.
 *
 * Mirrors spawn-requests/scan-orchestrator.test.ts with the following Phase 116
 * additions:
 *   S1-S3 — start() semantics (default interval, per-host acquire, override).
 *   T1-T2 — tick cadence (interval fires; getScanTickCount).
 *   E1-E3 — enqueue behavior (one item, empty, multi-host).
 *   G1    — per-host in-flight guard skips busy host, other hosts proceed.
 *   F1-F2 — never-throw contract (acquireChannel null; listSubstrateHosts throw).
 *   L1    — stop() clears interval + post-stop no-op.
 *
 *   R1    — Phase 116 delta: companion-fetch happens for items with body.ref.
 *   R2    — Phase 116 delta: companion-fetch failure sets malformedReason.
 *   R3    — Phase 116 delta: no companion fetch when body.ref absent (only
 *           the scan exec fires, no second cat|base64).
 *
 *   P1    — Phase 116 delta: parseImageGenRequestBatch handles malformed body
 *           by emitting a PendingImageGen with malformedReason set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PendingImageGen } from "./types.js";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createImageGenScanOrchestrator,
  parseImageGenRequestBatch,
  scanImageGenRequests,
  IMAGE_GEN_SCAN_CMD,
  type ImageGenScanHostRecord,
  type SshChannel,
} from "./scan-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * makeChannel — the exec mock returns "" by default (empty scan). Individual
 * tests override with mockResolvedValueOnce / mockImplementation.
 */
function makeChannel(): SshChannel {
  return { exec: vi.fn(async () => "") };
}

function buildValidRequest(uuid: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    prompt: "a cat",
    requested_at: "2026-09-18T00:00:00Z",
    ...extra,
  });
}

/**
 * makeScanStdout builds the tab-separated scan-exec output for a set of
 * (uuid, body) rows.
 */
function makeScanStdout(rows: Array<{ uuid: string; body: string }>): string {
  return rows.map((r) => `${r.uuid}.json\t${r.body}`).join("\n") + "\n";
}

function makeDeps(overrides: {
  hosts?: ImageGenScanHostRecord[];
  acquireChannel?: (host: ImageGenScanHostRecord) => Promise<SshChannel | null>;
  scanIntervalMs?: number;
} = {}) {
  const hosts =
    overrides.hosts ??
    ([{ id: "1", name: "host-1", _connDetails: {} }] as ImageGenScanHostRecord[]);
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
    vi.fn(async (_host: ImageGenScanHostRecord) => channel);
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

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// S — start() semantics
// ---------------------------------------------------------------------------

describe("start() semantics", () => {
  it("S1: start() calls listSubstrateHosts exactly once and installs interval at default 10s", async () => {
    const { deps, listSubstrateHosts, setIntervalMock } = makeDeps();
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock.mock.calls[0][1]).toBe(10000);
  });

  it("S2: start() acquires a channel per returned host + calls scanImageGenRequests per host", async () => {
    const hosts: ImageGenScanHostRecord[] = [
      { id: "1", name: "host-1", _connDetails: {} },
      { id: "2", name: "host-2", _connDetails: {} },
      { id: "3", name: "host-3", _connDetails: {} },
    ];
    const { deps, acquireChannel } = makeDeps({ hosts });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(3);
  });

  it("S3: scanIntervalMs override propagates to setInterval", async () => {
    const { deps, setIntervalMock } = makeDeps({ scanIntervalMs: 5000 });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    expect(setIntervalMock.mock.calls[0][1]).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// T — tick cadence
// ---------------------------------------------------------------------------

describe("tick cadence", () => {
  it("T1: interval tick re-fires scanAllHosts — listSubstrateHosts called on every tick", async () => {
    const { deps, listSubstrateHosts, fireTick } = makeDeps();
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(2);
    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(3);
  });

  it("T2: getScanTickCount increments per scan (initial pass = 1, each tick += 1)", async () => {
    const { deps, fireTick } = makeDeps();
    const orch = createImageGenScanOrchestrator(deps);
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
  it("E1: enqueue called for every PendingImageGen returned by scanImageGenRequests", async () => {
    const uuidA = "aaaaaaaa-1111-2222-3333-444444444444";
    const uuidB = "bbbbbbbb-1111-2222-3333-444444444444";
    const stdout = makeScanStdout([
      { uuid: uuidA, body: buildValidRequest(uuidA) },
      { uuid: uuidB, body: buildValidRequest(uuidB) },
    ]);
    const channel = { exec: vi.fn(async () => stdout) } as unknown as SshChannel;

    const { deps, enqueueDep } = makeDeps({
      acquireChannel: vi.fn(async () => channel),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();

    expect(enqueueDep).toHaveBeenCalledTimes(2);
    // Enqueue receives PendingImageGen items in the same order as parsed.
    expect(vi.mocked(enqueueDep).mock.calls[0][0].uuid).toBe(uuidA);
    expect(vi.mocked(enqueueDep).mock.calls[1][0].uuid).toBe(uuidB);
  });

  it("E2: empty scan → no enqueue call", async () => {
    const { deps, enqueueDep } = makeDeps();
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
  });

  it("E3: multi-host — each host's batch enqueues independently", async () => {
    const uuidA = "aaaaaaaa-1111-2222-3333-444444444444";
    const uuidB = "bbbbbbbb-1111-2222-3333-444444444444";
    const uuidC = "cccccccc-1111-2222-3333-444444444444";

    const hosts: ImageGenScanHostRecord[] = [
      { id: "1", name: "host-1", _connDetails: {} },
      { id: "2", name: "host-2", _connDetails: {} },
    ];
    const chan1 = {
      exec: vi.fn(async () => makeScanStdout([{ uuid: uuidA, body: buildValidRequest(uuidA) }])),
    } as unknown as SshChannel;
    const chan2 = {
      exec: vi.fn(async () =>
        makeScanStdout([
          { uuid: uuidB, body: buildValidRequest(uuidB) },
          { uuid: uuidC, body: buildValidRequest(uuidC) },
        ]),
      ),
    } as unknown as SshChannel;

    const { deps, enqueueDep } = makeDeps({
      hosts,
      acquireChannel: vi.fn(async (h: ImageGenScanHostRecord) => (h.id === "1" ? chan1 : chan2)),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(enqueueDep).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// G — per-host in-flight guard (wilma pattern)
// ---------------------------------------------------------------------------

describe("per-host in-flight guard", () => {
  it("G1: slow host is skipped on next tick while fast host proceeds", async () => {
    const hosts: ImageGenScanHostRecord[] = [
      { id: "1", name: "slow", _connDetails: {} },
      { id: "2", name: "fast", _connDetails: {} },
    ];

    // Slow host's exec never resolves during the test window.
    let releaseSlow: () => void = () => {};
    const slowPromise = new Promise<string>((resolve) => {
      releaseSlow = () => resolve("");
    });
    const slowChan = { exec: vi.fn(async () => slowPromise) } as unknown as SshChannel;
    const fastChan = { exec: vi.fn(async () => "") } as unknown as SshChannel;

    const { deps, acquireChannel, fireTick } = makeDeps({
      hosts,
      acquireChannel: vi.fn(async (h: ImageGenScanHostRecord) => (h.id === "1" ? slowChan : fastChan)),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(2);

    // Second tick: slow host still in-flight → skip; fast host re-acquires.
    await fireTick();
    await flush();
    expect(acquireChannel).toHaveBeenCalledTimes(3);

    releaseSlow();
    await slowPromise;
  });
});

// ---------------------------------------------------------------------------
// F — never-throw contract
// ---------------------------------------------------------------------------

describe("never-throw contract", () => {
  it("F1: acquireChannel returning null → no throw, no enqueue, releaseChannel not called", async () => {
    const { deps, enqueueDep, releaseChannel } = makeDeps({
      acquireChannel: vi.fn(async () => null),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await expect(orch.start()).resolves.toBeUndefined();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
    expect(releaseChannel).not.toHaveBeenCalled();
  });

  it("F2: listSubstrateHosts throwing → start still resolves, no enqueue", async () => {
    const { deps, enqueueDep } = makeDeps();
    deps.listSubstrateHosts.mockRejectedValueOnce(new Error("db down"));
    const orch = createImageGenScanOrchestrator(deps);
    await expect(orch.start()).resolves.toBeUndefined();
    await flush();
    expect(enqueueDep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// L — lifecycle
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("L1: stop() clears the interval + post-stop scanAllHosts is a no-op", async () => {
    const { deps, clearIntervalMock, listSubstrateHosts, fireTick } = makeDeps();
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
    orch.stop();
    expect(clearIntervalMock).toHaveBeenCalledTimes(1);
    await fireTick();
    expect(listSubstrateHosts).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R — companion-ref fetch (Phase 116 delta)
// ---------------------------------------------------------------------------

describe("companion-ref fetch", () => {
  it("R1: item with body.ref → second channel.exec runs cat|base64 → refImage populated", async () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    const refFilename = `${uuid}.ref.png`;
    const fakePngBytes = Buffer.from("fake-png-content");
    const base64Encoded = fakePngBytes.toString("base64");

    const scanStdout = makeScanStdout([
      { uuid, body: buildValidRequest(uuid, { ref: refFilename }) },
    ]);

    // First exec call → scan stdout; second exec call → base64 companion bytes.
    const exec = vi.fn()
      .mockResolvedValueOnce(scanStdout)
      .mockResolvedValueOnce(base64Encoded + "\n");
    const channel = { exec } as unknown as SshChannel;

    const { deps, enqueueDep } = makeDeps({
      acquireChannel: vi.fn(async () => channel),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();

    expect(exec).toHaveBeenCalledTimes(2);
    // First call is the scan command.
    expect(exec.mock.calls[0][0]).toBe(IMAGE_GEN_SCAN_CMD);
    // Second call is the companion cat, path includes the ref filename.
    expect(exec.mock.calls[1][0]).toContain(refFilename);
    expect(exec.mock.calls[1][0]).toContain("base64");

    expect(enqueueDep).toHaveBeenCalledTimes(1);
    const enqueued: PendingImageGen = vi.mocked(enqueueDep).mock.calls[0][0];
    expect(enqueued.refImage).toBeInstanceOf(Buffer);
    expect(enqueued.refImage!.toString("utf-8")).toBe("fake-png-content");
    expect(enqueued.malformedReason).toBeUndefined();
  });

  it("R2: companion-fetch returns null → malformedReason set with 'ref companion missing' text", async () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    const refFilename = `${uuid}.ref.png`;
    const scanStdout = makeScanStdout([
      { uuid, body: buildValidRequest(uuid, { ref: refFilename }) },
    ]);

    const exec = vi.fn()
      .mockResolvedValueOnce(scanStdout)
      .mockResolvedValueOnce(null); // SSH error on the cat
    const channel = { exec } as unknown as SshChannel;

    const { deps, enqueueDep } = makeDeps({
      acquireChannel: vi.fn(async () => channel),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();

    expect(enqueueDep).toHaveBeenCalledTimes(1);
    const enqueued: PendingImageGen = vi.mocked(enqueueDep).mock.calls[0][0];
    expect(enqueued.malformedReason).toBeDefined();
    expect(enqueued.malformedReason).toContain("ref companion missing");
    expect(enqueued.refImage).toBeUndefined();
  });

  it("R3: no companion fetch when body.ref absent → channel.exec called exactly once", async () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    const scanStdout = makeScanStdout([
      { uuid, body: buildValidRequest(uuid) },
    ]);
    const exec = vi.fn().mockResolvedValue(scanStdout);
    const channel = { exec } as unknown as SshChannel;

    const { deps } = makeDeps({
      acquireChannel: vi.fn(async () => channel),
    });
    const orch = createImageGenScanOrchestrator(deps);
    await orch.start();
    await flush();

    // Only the scan exec — no follow-up cat.
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// P — parseImageGenRequestBatch (Phase 116 malformed-enqueue delta)
// ---------------------------------------------------------------------------

describe("parseImageGenRequestBatch", () => {
  it("P1: malformed body → emits PendingImageGen with malformedReason set", () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    // Missing required 'prompt' field.
    const stdout = `${uuid}.json\t${JSON.stringify({ requested_at: "2026-09-18T00:00:00Z" })}\n`;

    const results = parseImageGenRequestBatch(stdout, "42");
    expect(results.length).toBe(1);
    expect(results[0].uuid).toBe(uuid);
    expect(results[0].malformedReason).toBeDefined();
    expect(results[0].malformedReason).toMatch(/prompt/i);
  });

  it("P2: valid body → emits PendingImageGen with parsed body, no malformedReason", () => {
    const uuid = "abcdef01-2345-6789-abcd-ef0123456789";
    const stdout = `${uuid}.json\t${buildValidRequest(uuid)}\n`;
    const results = parseImageGenRequestBatch(stdout, "42");
    expect(results.length).toBe(1);
    expect(results[0].malformedReason).toBeUndefined();
    expect(results[0].body.prompt).toBe("a cat");
  });

  it("P3: filename failing UUID_RE is skipped (no enqueue for .success.json / short names)", () => {
    // Deliberately-short base name — 5 chars, not 36.
    const stdout = "short.json\t{}\n";
    const results = parseImageGenRequestBatch(stdout, "42");
    expect(results.length).toBe(0);
  });

  it("P4: empty stdout → empty array", () => {
    expect(parseImageGenRequestBatch("", "42")).toEqual([]);
    expect(parseImageGenRequestBatch("   \n", "42")).toEqual([]);
  });

  it("P5: pathological 36-char basenames failing strict UUID_RE are skipped (defense-in-depth against a hostile caller writing files by hand)", () => {
    // 36 hyphens — old loose regex `/^[0-9a-f-]{36}$/i` accepted this;
    // canonical `uuidgen` output never produces it.
    const allHyphens = "------------------------------------";
    // 35 hex chars split across 4 dashed groups reaching 36 chars total
    // (last group is 11 chars, not 12).
    const wrongGroupLen = "abcdefff-abcd-abcd-abcd-abcdefabcde".padEnd(36, "-");
    // 36 hex chars with no dashes at all (loose form accepted; strict rejects).
    const noDashes = "abcdef0123456789abcdef0123456789abcd";

    const stdout =
      `${allHyphens}.json\t${JSON.stringify({ prompt: "x", requested_at: "2026-09-18T00:00:00Z" })}\n` +
      `${wrongGroupLen}.json\t${JSON.stringify({ prompt: "x", requested_at: "2026-09-18T00:00:00Z" })}\n` +
      `${noDashes}.json\t${JSON.stringify({ prompt: "x", requested_at: "2026-09-18T00:00:00Z" })}\n`;

    const results = parseImageGenRequestBatch(stdout, "42");
    expect(results).toEqual([]);
  });

  it("P6: canonical 8-4-4-4-12 dashed UUID is still accepted", () => {
    const canonical = "abcdef01-2345-6789-abcd-ef0123456789";
    const stdout = `${canonical}.json\t${buildValidRequest(canonical)}\n`;
    const results = parseImageGenRequestBatch(stdout, "42");
    expect(results.length).toBe(1);
    expect(results[0].uuid).toBe(canonical);
  });
});

// ---------------------------------------------------------------------------
// scanImageGenRequests direct — sanity for the null-exec fail-open path
// ---------------------------------------------------------------------------

describe("scanImageGenRequests fail-open", () => {
  it("SC1: exec returns null (SSH error) → returns [] without throwing", async () => {
    const channel = { exec: vi.fn(async () => null) } as unknown as SshChannel;
    const results = await scanImageGenRequests({ id: "1", name: "h1" }, channel);
    expect(results).toEqual([]);
  });

  it("SC2: exec returns empty stdout → returns [] (missing folder is not an error)", async () => {
    const channel = { exec: vi.fn(async () => "") } as unknown as SshChannel;
    const results = await scanImageGenRequests({ id: "1", name: "h1" }, channel);
    expect(results).toEqual([]);
  });
});
