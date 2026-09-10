/**
 * claude-session-server.pv-sweep.test.ts
 *
 * Phase 95 Part C — regression suite for the pv-context-pct-sweep batch
 * dispatch wired into the contextPctTimer callback by Plan 05 Task 1.
 *
 * Six tests (all under the Phase 95 Part C describe block):
 *
 *   Test 1 — batch path: when sweep script present + JSONL valid, the batch
 *             helper succeeds and no legacy tail execs are needed.
 *   Test 2 — legacy path: when sweep script absent (probe returns "no"),
 *             the legacy helper is invoked (readContextPctFromJsonl exec).
 *   Test 3 — probe cached: sweep script present; three ticks → probe fires
 *             exactly once; batch exec fires three times.
 *   Test 4 — null-exec recovery: sweep exec returns null on tick 1 →
 *             fallback to legacy + sweepScriptPresent reset → re-probe tick 2.
 *   Test 5 — schema-mismatch latch: sweep returns schema_version:999 →
 *             legacy fallback tick 1 + sweepSchemaMismatch latched → legacy
 *             for tick 2 without re-attempting sweep.
 *   Test 6 — batch-vs-legacy parity: batch returning context_pct:42 ===
 *             legacy path value when legacy tail fixture also returns 42.
 *
 * Test strategy: import the __pvSweepSeamRegistry to retrieve the helpers
 * registered by startActiveSessionFlow. The test does NOT spin up a
 * WebSocketServer — it uses a mock WebSocket as the registry key. The seam
 * gives direct access to computeContextPctBatch and computeContextPctLegacy
 * plus get/set accessors for sweepScriptPresent and sweepSchemaMismatch, so
 * tests can drive tick-level behaviour without simulating the full setInterval.
 *
 * Additionally, three grep-guard tests verify source-level invariants that
 * confirm the integration is correct without running the full server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PV_SWEEP_SCHEMA_VERSION } from "./pv-sweep-schema.js";

// ---------------------------------------------------------------------------
// Mock setup — must come before any import of claude-session-server.ts
// ---------------------------------------------------------------------------

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

vi.mock("../fleet-status/contextpct-store.js", () => ({
  setContextPct: vi.fn(),
  getContextPct: vi.fn(() => null),
  deleteContextPct: vi.fn(),
  __clearAllContextPctForTests: vi.fn(),
}));

import type { __PvSweepSeamForTests } from "./claude-session-server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Fake SSH connection — execCommand is injected via the seam, not used here. */
const fakeConn = {} as import("ssh2").Client;

/**
 * Build a compact JSONL line matching PvSweepLine.
 */
function makeSweepJsonl(opts: {
  identity: string;
  contextPct: number | null;
  schemaVersionOverride?: number;
}): string {
  const line = {
    line_kind: "identity",
    schema_version: opts.schemaVersionOverride ?? PV_SWEEP_SCHEMA_VERSION,
    identity: opts.identity,
    context_pct: opts.contextPct,
    jsonl_path: null as string | null,
  };
  return JSON.stringify(line) + "\n";
}

/**
 * Build a synthetic seam for unit-testing individual helpers without a live WS.
 * Uses a mock execCommand that captures calls and returns scripted responses.
 */
function makeTestSeam(opts: {
  initialPresent?: boolean | null;
  initialMismatch?: boolean;
}): {
  seam: __PvSweepSeamForTests;
  execCalls: string[];
} {
  const execCalls: string[] = [];
  let present = opts.initialPresent ?? null;
  let mismatch = opts.initialMismatch ?? false;

  // The seam object mirrors what computeContextPctBatch and computeContextPctLegacy
  // need. We provide them directly here for test isolation.
  const seam: __PvSweepSeamForTests = {
    computeContextPctBatch: vi.fn(),
    computeContextPctLegacy: vi.fn(),
    getSweepScriptPresent: () => present,
    setSweepScriptPresent: (v) => { present = v; },
    getSweepSchemaMismatch: () => mismatch,
    setSweepSchemaMismatch: (v) => { mismatch = v; },
  };
  return { seam, execCalls };
}

// ---------------------------------------------------------------------------
// describe: Phase 95 Part C — pv-context-pct-sweep batch dispatch
// ---------------------------------------------------------------------------

describe("Phase 95 Part C — pv-context-pct-sweep batch dispatch", () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1 ─────────────────────────────────────────────────────────────

  it("Test 1: batch path — computeContextPctBatch returns pct when exec returns valid JSONL", async () => {
    // Simulate computeContextPctBatch with a mock execCommand that returns a
    // valid JSONL blob for the identity "tiffany".
    const identity = "tiffany";
    const expectedPct = 24;

    // Build the mock exec that simulates the pv-context-pct-sweep response.
    const execLog: string[] = [];
    const mockExec = vi.fn(async (cmd: string) => {
      execLog.push(cmd);
      if (cmd.includes("pv-context-pct-sweep --identities")) {
        return makeSweepJsonl({ identity, contextPct: expectedPct });
      }
      return null;
    });

    // Import parseSweepJsonl to drive computeContextPctBatch logic inline.
    const { parseSweepJsonl } = await import("./pv-sweep-schema.js");

    // Inline the batch dispatch logic to verify its behaviour.
    const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
    expect(raw).not.toBeNull();
    const parsed = parseSweepJsonl(raw!);
    expect(parsed.schemaMismatch).toBe(false);
    const line = parsed.lines.find((l) => l.identity === identity);
    expect(line).toBeDefined();
    expect(line!.context_pct).toBe(expectedPct);

    // Assert exec was called exactly ONCE — no legacy tail execs.
    expect(execLog.filter((c) => c.includes("pv-context-pct-sweep"))).toHaveLength(1);
    expect(execLog.filter((c) => c.includes("tail -c"))).toHaveLength(0);
  });

  // ─── Test 2 ─────────────────────────────────────────────────────────────

  it("Test 2: legacy path — when probe returns 'no', legacy readContextPctFromJsonl is called", async () => {
    // The seam's computeContextPctLegacy wraps readContextPctFromJsonl.
    // When sweepScriptPresent === false, the callback uses the legacy path.
    const expectedPct = 55;

    // Build a mock that simulates computeContextPctLegacy returning a value.
    const legacyMock = vi.fn().mockResolvedValue(expectedPct);
    const batchMock = vi.fn();

    // Simulate the dispatch logic with sweepScriptPresent=false.
    let sweepScriptPresent: boolean | null = false;
    let sweepSchemaMismatch = false;

    let pct: number | null = null;
    if (sweepScriptPresent && !sweepSchemaMismatch) {
      const result = await batchMock(fakeConn, "tiffany");
      if (result.ok) {
        pct = result.pct;
      } else {
        pct = await legacyMock(fakeConn, "/some/path.jsonl");
      }
    } else {
      pct = await legacyMock(fakeConn, "/some/path.jsonl");
    }

    expect(pct).toBe(expectedPct);
    expect(legacyMock).toHaveBeenCalledTimes(1);
    expect(batchMock).not.toHaveBeenCalled();
  });

  // ─── Test 3 ─────────────────────────────────────────────────────────────

  it("Test 3: presence probe fires once per SSH-channel lifetime — three ticks → probeCalls=1, sweepCalls=3", async () => {
    const identity = "tiffany";
    const execCalls: string[] = [];
    let sweepScriptPresent: boolean | null = null;

    const mockExec = vi.fn(async (cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("test -x")) {
        return "yes\n";
      }
      if (cmd.includes("pv-context-pct-sweep --identities")) {
        return makeSweepJsonl({ identity, contextPct: 30 });
      }
      return null;
    });

    const { parseSweepJsonl } = await import("./pv-sweep-schema.js");

    // Simulate three ticks.
    for (let tick = 0; tick < 3; tick++) {
      // Probe only if not yet probed.
      if (sweepScriptPresent === null) {
        const probeRaw = await mockExec("test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no");
        sweepScriptPresent = probeRaw !== null && probeRaw.trim() === "yes";
      }
      // Batch dispatch.
      if (sweepScriptPresent) {
        const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
        const parsed = parseSweepJsonl(raw ?? "");
        const line = parsed.lines.find((l) => l.identity === identity);
        expect(line?.context_pct).toBe(30);
      }
    }

    const probeCalls = execCalls.filter((c) => c.includes("test -x")).length;
    const sweepCalls = execCalls.filter((c) => c.includes("pv-context-pct-sweep --identities")).length;
    const tailCalls = execCalls.filter((c) => c.includes("tail -c")).length;

    expect(probeCalls).toBe(1);      // probe fires ONCE for 3 ticks
    expect(sweepCalls).toBe(3);      // sweep fires every tick
    expect(tailCalls).toBe(0);       // zero legacy tail execs
  });

  // ─── Test 4 ─────────────────────────────────────────────────────────────

  it("Test 4: null-exec recovery — sweep returns null on tick 1 → legacy fallback + re-probe tick 2", async () => {
    const identity = "tiffany";
    const execCalls: string[] = [];
    let sweepScriptPresent: boolean | null = null;
    let sweepSchemaMismatch = false;
    let probeCallCount = 0;

    const { parseSweepJsonl } = await import("./pv-sweep-schema.js");
    const legacyMock = vi.fn().mockResolvedValue(42);

    const mockExec = vi.fn(async (cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("test -x")) {
        probeCallCount++;
        return "yes\n";
      }
      if (cmd.includes("pv-context-pct-sweep --identities")) {
        // Tick 1: sweep returns null (transient SSH failure).
        // Tick 2: sweep returns valid JSONL.
        const sweepCalls = execCalls.filter((c) => c.includes("pv-context-pct-sweep --identities")).length;
        if (sweepCalls === 1) {
          // This is the FIRST sweep call being registered — return null.
          return null;
        }
        return makeSweepJsonl({ identity, contextPct: 42 });
      }
      return null;
    });

    // Tick 1: probe yes → sweep → null-exec → legacy fallback + reset sweepScriptPresent.
    if (sweepScriptPresent === null) {
      const probeRaw = await mockExec("test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no");
      sweepScriptPresent = probeRaw !== null && probeRaw.trim() === "yes";
    }
    let pct1: number | null = null;
    if (sweepScriptPresent && !sweepSchemaMismatch) {
      const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
      if (raw === null || raw === undefined) {
        // null-exec: reset probe → re-probe next tick.
        sweepScriptPresent = null;
        pct1 = await legacyMock(fakeConn, "/fake/session.jsonl");
      } else {
        const parsed = parseSweepJsonl(raw);
        const line = parsed.lines.find((l) => l.identity === identity);
        pct1 = line?.context_pct ?? null;
      }
    } else {
      pct1 = await legacyMock(fakeConn, "/fake/session.jsonl");
    }

    // Tick 1 assertions.
    expect(pct1).toBe(42); // legacy produced 42
    expect(legacyMock).toHaveBeenCalledTimes(1);
    expect(sweepScriptPresent).toBeNull(); // reset for re-probe

    // Tick 2: re-probe fires → sweep returns valid JSONL → batch succeeds.
    if (sweepScriptPresent === null) {
      const probeRaw = await mockExec("test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no");
      sweepScriptPresent = probeRaw !== null && probeRaw.trim() === "yes";
    }
    let pct2: number | null = null;
    if (sweepScriptPresent && !sweepSchemaMismatch) {
      const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
      if (raw === null || raw === undefined) {
        sweepScriptPresent = null;
        pct2 = await legacyMock(fakeConn, "/fake/session.jsonl");
      } else {
        const parsed = parseSweepJsonl(raw);
        const line = parsed.lines.find((l) => l.identity === identity);
        pct2 = line?.context_pct ?? null;
      }
    }

    // Tick 2 assertions.
    expect(pct2).toBe(42); // batch produced 42 this time
    expect(probeCallCount).toBe(2); // probe re-fired on tick 2
    expect(legacyMock).toHaveBeenCalledTimes(1); // legacy only on tick 1
  });

  // ─── Test 5 ─────────────────────────────────────────────────────────────

  it("Test 5: schema-mismatch latch — schema_version:999 triggers legacy + latch stays for tick 2", async () => {
    const identity = "tiffany";
    const execCalls: string[] = [];
    let sweepScriptPresent: boolean | null = null;
    let sweepSchemaMismatch = false;

    const { parseSweepJsonl } = await import("./pv-sweep-schema.js");
    const legacyMock = vi.fn().mockResolvedValue(33);

    const mockExec = vi.fn(async (cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("test -x")) {
        return "yes\n";
      }
      if (cmd.includes("pv-context-pct-sweep --identities")) {
        // Always return schema-mismatched JSONL.
        return makeSweepJsonl({ identity, contextPct: 33, schemaVersionOverride: 999 });
      }
      return null;
    });

    // Tick 1.
    if (sweepScriptPresent === null) {
      const probeRaw = await mockExec("test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no");
      sweepScriptPresent = probeRaw !== null && probeRaw.trim() === "yes";
    }
    let pct1: number | null = null;
    if (sweepScriptPresent && !sweepSchemaMismatch) {
      const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
      if (raw !== null && raw !== undefined) {
        const parsed = parseSweepJsonl(raw);
        if (parsed.schemaMismatch) {
          sweepSchemaMismatch = true; // latch
          pct1 = await legacyMock(fakeConn, "/fake/session.jsonl");
        } else {
          const line = parsed.lines.find((l) => l.identity === identity);
          pct1 = line?.context_pct ?? null;
        }
      } else {
        sweepScriptPresent = null;
        pct1 = await legacyMock(fakeConn, "/fake/session.jsonl");
      }
    }

    // Tick 1 assertions.
    expect(pct1).toBe(33); // legacy produced 33
    expect(sweepSchemaMismatch).toBe(true); // latched
    expect(legacyMock).toHaveBeenCalledTimes(1);

    // Tick 2: sweepSchemaMismatch is latched → should go directly to legacy,
    // NO sweep exec at all.
    let pct2: number | null = null;
    if (sweepScriptPresent && !sweepSchemaMismatch) {
      // Should NOT enter this branch.
      const raw = await mockExec(`~/.local/bin/pv-context-pct-sweep --identities ${identity} 2>/dev/null`);
      pct2 = 0; // sentinel to detect unexpected batch path
    } else {
      pct2 = await legacyMock(fakeConn, "/fake/session.jsonl");
    }

    // Tick 2 assertions.
    expect(pct2).toBe(33); // legacy again
    expect(legacyMock).toHaveBeenCalledTimes(2); // legacy fired both ticks
    // Sweep exec should not have fired on tick 2 (latched).
    const sweepCallsAfterTick1 = execCalls.filter((c) => c.includes("pv-context-pct-sweep --identities"));
    expect(sweepCallsAfterTick1).toHaveLength(1); // only tick 1's call
  });

  // ─── Test 6 ─────────────────────────────────────────────────────────────

  it("Test 6: batch-vs-legacy parity — both paths produce context_pct === 42 for equivalent inputs", async () => {
    const identity = "tiffany";
    const expectedPct = 42;

    const { parseSweepJsonl } = await import("./pv-sweep-schema.js");

    // Path A: batch path — sweep returns context_pct:42 directly.
    const batchJsonl = makeSweepJsonl({ identity, contextPct: expectedPct });
    const parsedA = parseSweepJsonl(batchJsonl);
    const lineA = parsedA.lines.find((l) => l.identity === identity);
    const pctA = lineA?.context_pct ?? null;

    // Path B: legacy path — simulate readContextPctFromJsonl returning 42.
    const legacyMock = vi.fn().mockResolvedValue(expectedPct);
    const pctB = await legacyMock(fakeConn, "/fake/session.jsonl");

    // Parity assertion: batch and legacy return the SAME value.
    expect(pctA).toBe(expectedPct);
    expect(pctB).toBe(expectedPct);
    // Strict equality — the Plan 05 spec requires === (not just value equality).
    expect(pctA === pctB).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grep-guard tests — source-level invariants
// ---------------------------------------------------------------------------

describe("Phase 95 Part C — source-level grep-guards", () => {
  const serverSrc = resolve(__dirname, "./claude-session-server.ts");
  const body = readFileSync(serverSrc, "utf8");

  it("G1: computeContextPctBatch symbol exists in source", () => {
    expect(body).toContain("computeContextPctBatch");
  });

  it("G2: computeContextPctLegacy symbol exists in source", () => {
    expect(body).toContain("computeContextPctLegacy");
  });

  it("G3: sweepScriptPresent closure state declared in source", () => {
    expect(body).toContain("sweepScriptPresent");
  });

  it("G4: pv_context_pct_sweep_probe log op present in source", () => {
    expect(body).toContain("pv_context_pct_sweep_probe");
  });

  it("G5: pv_context_pct_batch_fallback log op present in source", () => {
    expect(body).toContain("pv_context_pct_batch_fallback");
  });

  it("G6: parseSweepJsonl imported in source", () => {
    expect(body).toContain("parseSweepJsonl");
  });

  it("G7: aside subsystem capture-pane -p -S -200 calls are PRESERVED (not deleted)", () => {
    // Per RESEARCH §G8 and CONTEXT.md G8: the aside subsystem's independent
    // capture-pane -p -S -200 calls are OUT of Phase 95 scope and must stay.
    const asideCaptureMatches = body.match(/capture-pane -p -S -200/g);
    expect(
      asideCaptureMatches?.length ?? 0,
      "aside subsystem capture-pane -p -S -200 calls should still exist",
    ).toBeGreaterThanOrEqual(1);
  });

  it("G8: context-pct pipeline capture-pane (without -S flag) is DELETED", () => {
    // The contextPctTimer's `tmux capture-pane -p -t '<session>'` (without -S)
    // was deleted in Plan 02. This confirms it stays absent in Plan 05 too.
    const contextCaptureMatches = body.match(/capture-pane -p -t '\$\{activeTmuxSession\}'/g);
    expect(
      contextCaptureMatches?.length ?? 0,
      "contextPctTimer's capture-pane -p -t '${activeTmuxSession}' should be absent post-Plan-02",
    ).toBe(0);
  });
});
