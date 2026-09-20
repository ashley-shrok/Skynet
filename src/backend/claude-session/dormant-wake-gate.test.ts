/**
 * dormant-wake-gate.test.ts — unit tests for the shared wake-gate primitive
 * extracted from claude-session-server.ts's Phase 56 Plan 01 send-while-
 * dormant branch. Companion integration coverage lives in dormant-poll.test.ts
 * (SWD-1..SWD-4) which exercises the WS caller's wire-up end-to-end, and in
 * agent-reset.test.ts which exercises the endpoint caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the FULL logger surface — same pattern as dormant-poll.test.ts:33-64.
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
  performDormantWakeGate,
  MARKER_FALLBACK_MS,
} from "./dormant-wake-gate.js";
import { sshLogger } from "../utils/logger.js";

const fakeConn = {} as unknown;

beforeEach(() => {
  vi.mocked(sshLogger.info).mockClear();
  vi.mocked(sshLogger.warn).mockClear();
});

function opsFromInfo(): string[] {
  return vi
    .mocked(sshLogger.info)
    .mock.calls.map(
      (c) => (c[1] as { operation?: string } | undefined)?.operation ?? "",
    )
    .filter((s) => s.length > 0);
}

function opsFromWarn(): string[] {
  return vi
    .mocked(sshLogger.warn)
    .mock.calls.map(
      (c) => (c[1] as { operation?: string } | undefined)?.operation ?? "",
    )
    .filter((s) => s.length > 0);
}

describe("performDormantWakeGate", () => {
  it("fresh marker: sentinel drop, poll until marker > triggerTs, setWakeTriggerTs invoked with triggerTs, marker_fresh log emitted", async () => {
    const triggerTs = 1_000_000;
    let nowCounter = triggerTs;
    const now = vi.fn(() => {
      const t = nowCounter;
      nowCounter += 100;
      return t;
    });
    const markerCommand = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Date(triggerTs + 10_000).toISOString());
    const execCalls: string[] = [];
    const exec = vi
      .fn()
      .mockImplementation((_c: unknown, cmd: string): Promise<string> => {
        execCalls.push(cmd);
        return Promise.resolve("");
      });
    const setWakeTriggerTs = vi.fn();

    const result = await performDormantWakeGate({
      sshConn: fakeConn,
      tmuxSession: "test-agent",
      hostId: 42,
      exec,
      markerCommand,
      setWakeTriggerTs,
      now,
      logOpPrefix: "pv_input",
      mqid: "mqid-1",
      pollIntervalMs: 0,
    });

    expect(setWakeTriggerTs).toHaveBeenCalledTimes(1);
    expect(setWakeTriggerTs).toHaveBeenCalledWith(triggerTs);
    expect(execCalls).toContain(
      `rm -f ~/fleet/identities/'test-agent'/.dormant`,
    );
    expect(markerCommand.mock.calls.length).toBe(3);
    expect(result.fellBack).toBe(false);
    expect(result.triggerTs).toBe(triggerTs);

    const infoOps = opsFromInfo();
    expect(infoOps).toContain("pv_input_dormant_send_start");
    expect(infoOps).toContain("pv_input_dormant_wait_marker");
    expect(infoOps).toContain("pv_input_dormant_marker_fresh");
    expect(infoOps).not.toContain("pv_input_dormant_marker_fallback");
  });

  it("fallback: marker never fresh, elapsed reaches MARKER_FALLBACK_MS → fellBack:true + marker_fallback log", async () => {
    const triggerTs = 2_000_000;
    let callCount = 0;
    const now = vi.fn(() => {
      const c = callCount++;
      if (c === 0) return triggerTs;
      if (c === 1) return triggerTs;
      return triggerTs + MARKER_FALLBACK_MS;
    });
    const markerCommand = vi.fn().mockResolvedValue(null);
    const exec = vi.fn().mockResolvedValue("");

    const result = await performDormantWakeGate({
      sshConn: fakeConn,
      tmuxSession: "test-agent",
      hostId: 42,
      exec,
      markerCommand,
      now,
      logOpPrefix: "pv_input",
      mqid: "mqid-2",
      pollIntervalMs: 0,
    });

    expect(result.fellBack).toBe(true);
    expect(opsFromInfo()).toContain("pv_input_dormant_marker_fallback");
  });

  it("sentinel drop failure: sentinel_drop_failed warn emitted, marker poll still runs, fresh-marker path still succeeds", async () => {
    const triggerTs = 3_000_000;
    let nowCounter = triggerTs;
    const now = vi.fn(() => {
      const t = nowCounter;
      nowCounter += 100;
      return t;
    });
    const markerCommand = vi
      .fn()
      .mockResolvedValueOnce(new Date(triggerTs + 5000).toISOString());
    const exec = vi.fn().mockRejectedValueOnce(new Error("ssh boom"));

    const result = await performDormantWakeGate({
      sshConn: fakeConn,
      tmuxSession: "test-agent",
      hostId: 42,
      exec,
      markerCommand,
      now,
      logOpPrefix: "pv_input",
      mqid: "mqid-3",
      pollIntervalMs: 0,
    });

    expect(opsFromWarn()).toContain("pv_input_dormant_sentinel_drop_failed");
    expect(markerCommand).toHaveBeenCalled();
    expect(result.fellBack).toBe(false);
  });

  it("setWakeTriggerTs omitted (agent-reset case): gate works, agent_reset prefix propagates through op tags", async () => {
    const triggerTs = 4_000_000;
    let nowCounter = triggerTs;
    const now = vi.fn(() => {
      const t = nowCounter;
      nowCounter += 100;
      return t;
    });
    const markerCommand = vi
      .fn()
      .mockResolvedValueOnce(new Date(triggerTs + 5000).toISOString());
    const exec = vi.fn().mockResolvedValue("");

    const result = await performDormantWakeGate({
      sshConn: fakeConn,
      tmuxSession: "test-agent",
      hostId: 42,
      exec,
      markerCommand,
      // setWakeTriggerTs intentionally omitted
      now,
      logOpPrefix: "agent_reset",
      mqid: "none",
      pollIntervalMs: 0,
    });

    expect(result.fellBack).toBe(false);
    const infoOps = opsFromInfo();
    expect(infoOps).toContain("agent_reset_dormant_send_start");
    expect(infoOps).toContain("agent_reset_dormant_marker_fresh");
    expect(infoOps).not.toContain("pv_input_dormant_send_start");
  });
});
