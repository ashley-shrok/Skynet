/**
 * claude-session-server.contextpct-dual-write.test.ts
 *
 * Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, Alice 2026-09-08 D-03
 * waiver) — behaviors 6-8 per 90-00-PLAN.md.
 *
 * Verifies the two `context_pct` WS emission sites in claude-session-server.ts
 * (dormant branch L3219 + primary contextPctTimer branch L7074) ALSO write
 * into the fleet-status shared map. Test 8 grep-verifies the WS emission is
 * PRESERVED (backwards compat during transition).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Silence loggers (same posture as dormant-poll.test.ts).
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

// Mock the contextpct-store BEFORE importing the code-under-test so
// setContextPct is a spy we can assert on.
vi.mock("../fleet-status/contextpct-store.js", () => ({
  setContextPct: vi.fn(),
  getContextPct: vi.fn(() => null),
  deleteContextPct: vi.fn(),
  __clearAllContextPctForTests: vi.fn(),
}));

import { __applyDormantPollWithRediscoveryForTests } from "./claude-session-server.js";
import { setContextPct } from "../fleet-status/contextpct-store.js";

const setContextPctMock = vi.mocked(setContextPct);

const fakeConn = {} as import("ssh2").Client;

/**
 * Minimal dormant-state box mirroring dormant-poll.test.ts helper.
 */
function makeDormantState(prev: boolean | null = true) {
  let cur = prev;
  let trig: number | null = null;
  return {
    dormantLastEmitted: () => cur,
    setDormantLastEmitted: (v: boolean | null) => {
      cur = v;
    },
    wakeTriggerTs: () => trig,
    setWakeTriggerTs: (v: number | null) => {
      trig = v;
    },
    get current(): boolean | null {
      return cur;
    },
  };
}

beforeEach(() => {
  setContextPctMock.mockClear();
});

describe("Phase 90 Wave 0 — dormant-branch context_pct dual-write (behavior 6)", () => {
  it(
    "Test 6: dormant branch — when the WS emits {type:'context_pct',pct,dormant:true}, setContextPct(hostId, escapedName, pct) is ALSO called with the same pct",
    async () => {
      const wsSend = vi.fn();
      const exec = vi
        .fn()
        // First call is the .dormant sentinel stat — return "yes" so we
        // enter the "sentinel present" branch that emits context_pct.
        .mockResolvedValue("yes\n");
      const readJsonlPct = vi.fn().mockResolvedValue(42);
      const dormantSessionFile = vi.fn(
        () => "/home/ubuntu/.claude/projects/x/session.jsonl",
      );

      await __applyDormantPollWithRediscoveryForTests(
        {
          connSnapshot: fakeConn,
          escapedName: "tiffany",
          hostId: 7, // Phase 90 Wave 0 — new dep for dual-write
          execCommand: exec,
          discoverSession: vi.fn(),
          wsSend,
          startActiveFlow: vi.fn(),
          markerCommand: vi.fn().mockResolvedValue(null),
          now: () => 0,
          readJsonlPct,
          dormantSessionFile,
        },
        makeDormantState(null), // first tick — lastEmitted null so dormant:true frame will emit too
      );

      // The dual-write MUST have happened with the same pct.
      expect(setContextPctMock).toHaveBeenCalledTimes(1);
      expect(setContextPctMock).toHaveBeenCalledWith(7, "tiffany", 42);

      // The WS `context_pct` emission is PRESERVED (Test 8 discipline).
      const contextPctSends = wsSend.mock.calls
        .map((c) => JSON.parse(c[0]))
        .filter((f) => f.type === "context_pct");
      expect(contextPctSends).toHaveLength(1);
      expect(contextPctSends[0]).toEqual({
        type: "context_pct",
        pct: 42,
        dormant: true,
      });
    },
  );

  it(
    "Test 6b (defensive): when hostId is undefined at the seam, dual-write is a silent skip (WS emission still fires)",
    async () => {
      const wsSend = vi.fn();
      const exec = vi.fn().mockResolvedValue("yes\n");
      const readJsonlPct = vi.fn().mockResolvedValue(55);
      const dormantSessionFile = vi.fn(
        () => "/home/ubuntu/.claude/projects/x/session.jsonl",
      );

      await __applyDormantPollWithRediscoveryForTests(
        {
          connSnapshot: fakeConn,
          escapedName: "tiffany",
          // hostId omitted → dual-write silently skipped
          execCommand: exec,
          discoverSession: vi.fn(),
          wsSend,
          startActiveFlow: vi.fn(),
          markerCommand: vi.fn().mockResolvedValue(null),
          now: () => 0,
          readJsonlPct,
          dormantSessionFile,
        },
        makeDormantState(null),
      );

      // Silent skip when hostId is absent.
      expect(setContextPctMock).not.toHaveBeenCalled();

      // WS emission STILL fires (backwards compat).
      const contextPctSends = wsSend.mock.calls
        .map((c) => JSON.parse(c[0]))
        .filter((f) => f.type === "context_pct");
      expect(contextPctSends).toHaveLength(1);
    },
  );
});

describe("Phase 90 Wave 0 — grep-verify WS emissions preserved (behavior 8)", () => {
  it(
    "Test 8: BOTH `context_pct` WS emission sites at L3219 (dormant, wsSend) + L7074 (primary timer, ws.send) are PRESERVED in the source",
    () => {
      // Locate claude-session-server.ts relative to this test file.
      const here = dirname(fileURLToPath(import.meta.url));
      const src = resolve(here, "./claude-session-server.ts");
      const body = readFileSync(src, "utf8");
      // Regex covers both invocation patterns — the dormant-branch call goes
      // through the injectable wsSend, the primary-timer call goes through the
      // live ws.send. Either MUST appear at least once each; the plan's
      // acceptance criterion requires >= 2 total across the file.
      const dormantMatches = body.match(
        /wsSend\(JSON\.stringify\(\{ type: "context_pct", pct, dormant: true \}\)\)/g,
      );
      const primaryMatches = body.match(
        /ws\.send\(JSON\.stringify\(\{ type: "context_pct", pct \}\)\)/g,
      );
      expect(dormantMatches?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(primaryMatches?.length ?? 0).toBeGreaterThanOrEqual(1);
      const totalContextPctSends = (dormantMatches?.length ?? 0) + (primaryMatches?.length ?? 0);
      expect(totalContextPctSends).toBeGreaterThanOrEqual(2);
    },
  );

  it(
    "Test 7 (grep-verify): the primary timer branch also dual-writes — the source contains a setContextPct(activeHostId, activeTmuxSession, pct) call adjacent to the ws.send emission",
    () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const src = resolve(here, "./claude-session-server.ts");
      const body = readFileSync(src, "utf8");
      // The primary-timer dual-write uses the pinned activeHostId +
      // activeTmuxSession identifiers.
      expect(body).toMatch(
        /setContextPct\(activeHostId, activeTmuxSession, pct\)/,
      );
      // AND the dormant-branch dual-write uses the injected hostId + escapedName.
      expect(body).toMatch(
        /setContextPct\(hostId, escapedName, pct\)/,
      );
      // Plan's acceptance criterion: total setContextPct( calls in the file
      // >= 2 (one per emission site).
      const allCalls = body.match(/setContextPct\(/g);
      expect(allCalls?.length ?? 0).toBeGreaterThanOrEqual(2);
    },
  );
});
