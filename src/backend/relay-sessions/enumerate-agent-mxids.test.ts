/**
 * enumerate-agent-mxids tests — Phase 89 fixup M-5 (2026-09-08).
 *
 * Covers:
 *   - Happy path: multiple hosts each returning multiple mxids → deduped
 *     aggregated list.
 *   - Single-host output parsing (empty lines, jq's "null" literal, trim).
 *   - Cross-host dedup.
 *   - Per-host failure isolation (SSH exec throws / returns null → skip
 *     that host, other hosts continue).
 *   - listHosts failure → { ok:false, reason:'list_hosts_failed' } without
 *     any SSH calls.
 *   - Empty host list → { ok:true, mxids:[] } without any SSH calls.
 *   - Remote command literal is exactly the expected jq one-liner.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import {
  enumerateAgentMxidsViaSSH,
  REMOTE_ENUMERATE_COMMAND,
  type EnumerateAgentMxidsDeps,
  type EnumerationHostRecord,
} from "./enumerate-agent-mxids.js";

const HOST_A: EnumerationHostRecord = { id: 1, name: "wilma" };
const HOST_B: EnumerationHostRecord = { id: 2, name: "betty" };
const HOST_C: EnumerationHostRecord = { id: 3, name: "pebbles" };

function makeDeps(overrides: Partial<EnumerateAgentMxidsDeps> = {}): EnumerateAgentMxidsDeps {
  return {
    listHosts: vi.fn(async () => []),
    runSshCommand: vi.fn(async () => ""),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("REMOTE_ENUMERATE_COMMAND", () => {
  it("locks the exact shell one-liner (regression guard for jq -r + err suppression)", () => {
    expect(REMOTE_ENUMERATE_COMMAND).toBe(
      "for f in ~/.claude/identities/*/relay.json; do jq -r .user_id \"$f\" 2>/dev/null; done",
    );
  });
});

describe("enumerateAgentMxidsViaSSH", () => {
  it("Test M-5: happy path — multi-host, multi-mxid, deduped across hosts", async () => {
    const deps = makeDeps({
      listHosts: vi.fn(async () => [HOST_A, HOST_B]),
      runSshCommand: vi.fn(async (host: EnumerationHostRecord) => {
        if (host.id === "1") {
          return "@alice-agent:server\n@bob-agent:server\n";
        }
        // Cross-host duplicate: @bob-agent also on host B. Should dedupe.
        return "@bob-agent:server\n@carol-agent:server\n";
      }),
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mxids.sort()).toEqual(
        ["@alice-agent:server", "@bob-agent:server", "@carol-agent:server"].sort(),
      );
    }
    expect(deps.runSshCommand).toHaveBeenCalledTimes(2);
    // Command literal delivered exactly per REMOTE_ENUMERATE_COMMAND.
    expect(vi.mocked(deps.runSshCommand).mock.calls[0][1]).toBe(
      REMOTE_ENUMERATE_COMMAND,
    );
  });

  it("Test M-5b: parses per-host output — empty lines, jq 'null' literal, trim whitespace all filtered", async () => {
    const deps = makeDeps({
      listHosts: vi.fn(async () => [HOST_A]),
      runSshCommand: vi.fn(async () => {
        return [
          "@real-agent-1:server",
          "", // empty line
          "  @padded-agent:server  ", // trimmed
          "null", // jq's null literal (missing user_id field)
          "@real-agent-2:server",
          "", // trailing empty
        ].join("\n");
      }),
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mxids.sort()).toEqual(
        ["@padded-agent:server", "@real-agent-1:server", "@real-agent-2:server"].sort(),
      );
    }
  });

  it("Test M-5c: per-host SSH exec throw does NOT abort other hosts", async () => {
    const deps = makeDeps({
      listHosts: vi.fn(async () => [HOST_A, HOST_B, HOST_C]),
      runSshCommand: vi.fn(async (host: EnumerationHostRecord) => {
        if (host.id === "2") throw new Error("SSH connection dropped");
        if (host.id === "1") return "@a1:s\n";
        return "@c1:s\n";
      }),
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Host B contributed nothing (failure), A and C contributed.
      expect(result.mxids.sort()).toEqual(["@a1:s", "@c1:s"].sort());
    }
  });

  it("Test M-5d: per-host SSH exec null (per SshChannel.exec contract) skipped, other hosts continue", async () => {
    const deps = makeDeps({
      listHosts: vi.fn(async () => [HOST_A, HOST_B]),
      runSshCommand: vi.fn(async (host: EnumerationHostRecord) => {
        if (host.id === "1") return null; // SSH failure
        return "@b1:s\n";
      }),
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mxids).toEqual(["@b1:s"]);
    }
  });

  it("Test M-5e: listHosts throw → { ok:false, reason:'list_hosts_failed' } without any SSH call", async () => {
    const runSshCommand = vi.fn();
    const deps = makeDeps({
      listHosts: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
      runSshCommand,
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("list_hosts_failed");
    }
    expect(runSshCommand).not.toHaveBeenCalled();
  });

  it("Test M-5f: empty host list → { ok:true, mxids:[] } without any SSH call", async () => {
    const runSshCommand = vi.fn();
    const deps = makeDeps({
      listHosts: vi.fn(async () => []),
      runSshCommand,
    });

    const result = await enumerateAgentMxidsViaSSH(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mxids).toEqual([]);
    }
    expect(runSshCommand).not.toHaveBeenCalled();
  });
});
