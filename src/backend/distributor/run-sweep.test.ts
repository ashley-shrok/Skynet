/**
 * run-sweep.test.ts — Tests for the runSweepForHost composer.
 *
 * Verifies that the composer:
 *   - Iterates the catalog sequentially (no Promise.all)
 *   - Byte-compares each item via the pure decision layer
 *   - Pushes on mismatch, fires restart hook on push of a hook-bearing entry
 *   - Contains per-item failures (never rejects)
 *   - Emits exactly one logSweepResult per sweep + per-item logs on non-current
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { CatalogEntry } from "./catalog.js";
import { FLEET_SUBSTRATE_CATALOG } from "./catalog.js";
import type { SweepDeps } from "./run-sweep.js";
import { runSweepForHost } from "./run-sweep.js";

// Spy on log-tag emissions
vi.mock("./log-tags.js", () => ({
  logSweepResult: vi.fn(),
  logItemChanged: vi.fn(),
  logItemFailed: vi.fn(),
  logSweepHookError: vi.fn(),
}));

// Mock runBootstrapForHost so sweep tests don't need to handle bootstrap
// channel commands. The bootstrap is tested in run-bootstrap.test.ts.
vi.mock("./run-bootstrap.js", () => ({
  runBootstrapForHost: vi.fn(async () => ({
    alreadyEnabled: true,
    bootstrapRan: false,
    daemonReloadRan: true,
    settingsPatchOk: true,
    hadError: false,
  })),
}));

import {
  logSweepResult,
  logItemChanged,
  logItemFailed,
} from "./log-tags.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOST = { id: "h1", name: "wilma" };

function b64Ok(bytes: Buffer): string {
  return `${bytes.toString("base64")}__READ_OK__`;
}

function makeChannelSequenced(
  handler: (cmd: string, callIndex: number) => string | null,
): { channel: SshChannel; exec: ReturnType<typeof vi.fn> } {
  let idx = 0;
  const exec = vi.fn(async (cmd: string) => handler(cmd, idx++));
  return { channel: { exec }, exec };
}

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: "test-item",
    bundledPath: "/app/fleet-substrate/skills/test/SKILL.md",
    installPath: "~/.claude/skills/test/SKILL.md",
    restartHook: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSweepForHost", () => {
  it("Test 1: all-match sweep on full 20-entry catalog — 0 changes, 0 failures, 0 writes", async () => {
    const bundledBytes = Buffer.from("matching-bundle-content");
    // For every catalog entry, read returns __READ_OK__ with the same bytes
    // as the bundled reader. The decision layer skips them all.
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(bundledBytes);
      // No writes / restarts expected; any other call is unexpected
      throw new Error(`unexpected exec: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundledBytes, mode: 0o644 })),
    };

    await runSweepForHost(channel, HOST, FLEET_SUBSTRATE_CATALOG, deps);

    expect(logSweepResult).toHaveBeenCalledTimes(1);
    const call = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.itemsChecked).toBe(20);
    expect(call.itemsChanged).toBe(0);
    expect(call.itemsFailed).toBe(0);
    expect(logItemChanged).not.toHaveBeenCalled();
    expect(logItemFailed).not.toHaveBeenCalled();
    // No write/restart execs
    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    const restartCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("systemctl --user restart"),
    );
    expect(writeCalls).toHaveLength(0);
    expect(restartCalls).toHaveLength(0);
  });

  it("Test 2: agent-supervisor binary mismatch only — 1 push + 1 restart, logItemChanged with restartHookFired", async () => {
    const bundled = Buffer.from("bundled-agent-supervisor-v2");
    const installedMatching = Buffer.from("matching-bytes");
    const installedStale = Buffer.from("bundled-agent-supervisor-v1");
    // For agent-supervisor BINARY only: read returns installedStale (mismatch).
    // For all others (including the .service unit): read returns bundled bytes (match).
    // Bundled reader returns the new bundled bytes for the binary only, and
    // installedMatching for everything else (so the byte-compare skips them).
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) {
        // Match only the binary install path, not the .service unit path
        if (cmd.includes("local/bin/agent-supervisor")) return b64Ok(installedStale);
        return b64Ok(installedMatching);
      }
      if (cmd.includes("base64 -d")) return "__WRITE_OK__";
      if (cmd.includes("systemctl --user restart")) return "__RESTART_OK__";
      throw new Error(`unexpected exec: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async (path: string) => {
        if (path.includes("scripts/agent-supervisor.sh")) return { bytes: bundled, mode: 0o755 };
        return { bytes: installedMatching, mode: 0o644 };
      }),
    };

    await runSweepForHost(channel, HOST, FLEET_SUBSTRATE_CATALOG, deps);

    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    const restartCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("systemctl --user restart"),
    );
    expect(writeCalls).toHaveLength(1);
    expect(restartCalls).toHaveLength(1);
    expect(restartCalls[0][0]).toContain("agent-supervisor.service");

    expect(logItemChanged).toHaveBeenCalledTimes(1);
    const changedPayload = (logItemChanged as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(changedPayload.entrySlug).toBe("agent-supervisor");
    expect(changedPayload.restartHookFired).toBe("agent-supervisor.service");

    expect(logSweepResult).toHaveBeenCalledTimes(1);
    const summary = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(summary.itemsChanged).toBe(1);
    expect(summary.itemsFailed).toBe(0);
  });

  it("Test 3: installed-missing on 3 items (no restart hooks) — 3 writes with changeKind installed-new", async () => {
    const bundled = Buffer.from("bundled-content");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "a", installPath: "~/a" }),
      catalogEntry({ slug: "b", installPath: "~/b" }),
      catalogEntry({ slug: "c", installPath: "~/c" }),
    ];
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return "__READ_ENOENT__";
      if (cmd.includes("base64 -d")) return "__WRITE_OK__";
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    expect(writeCalls).toHaveLength(3);
    expect(logItemChanged).toHaveBeenCalledTimes(3);
    for (const call of (logItemChanged as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0].changeKind).toBe("installed-new");
    }
    const summary = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(summary.itemsChanged).toBe(3);
    expect(summary.itemsFailed).toBe(0);
  });

  it("Test 4: transport error on 2 items — fail-closed, no writes for those 2", async () => {
    const bundled = Buffer.from("bundled");
    const matching = Buffer.from("matching");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "a", installPath: "~/a" }),
      catalogEntry({ slug: "b", installPath: "~/b" }),
      catalogEntry({ slug: "c", installPath: "~/c" }),
    ];
    let readIdx = 0;
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) {
        readIdx++;
        // Items a and b return null (transport) on every attempt including
        // all retries. retryOnTransport retries up to 3 times, so items a
        // and b exhaust their retry budget across reads 1-6 (2 items × 3
        // tries). Item c's single read lands at idx=7 and returns matching.
        if (readIdx <= 6) return null;
        return b64Ok(matching);
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async (path: string) => {
        if (path === catalog[2].bundledPath) return { bytes: matching, mode: 0o644 };
        return { bytes: bundled, mode: 0o644 };
      }),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    expect(writeCalls).toHaveLength(0);
    expect(logItemFailed).toHaveBeenCalledTimes(2);
    for (const call of (logItemFailed as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0].stage).toBe("read-installed");
    }
    const summary = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(summary.itemsFailed).toBe(2);
  });

  it("Test 5: write failure — logItemFailed(stage:write), NO restart exec fires", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({
        slug: "agent-supervisor",
        installPath: "~/.local/bin/agent-supervisor",
        restartHook: "agent-supervisor.service",
      }),
    ];
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) return "__WRITE_FAIL__";
      if (cmd.includes("systemctl --user restart"))
        throw new Error("restart should NOT be called after write failure");
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o755 })),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    expect(logItemFailed).toHaveBeenCalledTimes(1);
    const failCall = (logItemFailed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(failCall.stage).toBe("write");
    // Zero restart calls
    const restartCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("systemctl --user restart"),
    );
    expect(restartCalls).toHaveLength(0);
    // logItemChanged NOT called because bytes did not update
    expect(logItemChanged).not.toHaveBeenCalled();
    const summary = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(summary.itemsFailed).toBe(1);
    expect(summary.itemsChanged).toBe(0);
  });

  it("Test 6: restart failure — logItemChanged fires (bytes DID update) AND logItemFailed(stage:restart)", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({
        slug: "agent-supervisor",
        installPath: "~/.local/bin/agent-supervisor",
        restartHook: "agent-supervisor.service",
      }),
    ];
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) return "__WRITE_OK__";
      if (cmd.includes("systemctl --user restart")) return "__RESTART_FAIL__";
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o755 })),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    expect(logItemChanged).toHaveBeenCalledTimes(1);
    const changedPayload = (logItemChanged as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(changedPayload.restartHookFired).toBe("agent-supervisor.service");
    expect(logItemFailed).toHaveBeenCalledTimes(1);
    const failCall = (logItemFailed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(failCall.stage).toBe("restart");
    expect(failCall.entrySlug).toBe("agent-supervisor");
    const summary = (logSweepResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(summary.itemsChanged).toBe(1);
    expect(summary.itemsFailed).toBe(1);
  });

  it("Test 7: fire-and-forget — a helper throws synchronously, runSweepForHost still resolves", async () => {
    const bundled = Buffer.from("bundled");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "throwing", installPath: "~/throw" }),
    ];
    const throwingChannel: SshChannel = {
      exec: async () => {
        throw new Error("boom");
      },
    };
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    await expect(
      runSweepForHost(throwingChannel, HOST, catalog, deps),
    ).resolves.toEqual({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 });

    // ssh-push's readInstalledBytes catches the throw and returns
    // { readOk: false, reason: "transport" }. That surfaces as
    // logItemFailed(stage: "read-installed").
    expect(logItemFailed).toHaveBeenCalledTimes(1);
  });

  it("Test 8: bundled-read failure — decision returns skip(bundled-read-failed), logItemFailed(stage:read-bundled)", async () => {
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "missing-bundled", installPath: "~/x" }),
    ];
    const { channel, exec } = makeChannelSequenced(() => {
      // Should NEVER be called because bundled-read fails FIRST
      // (or if it is called, no write/restart should follow).
      return "__READ_ENOENT__";
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => null), // bundled read fails
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    expect(logItemFailed).toHaveBeenCalledTimes(1);
    expect((logItemFailed as ReturnType<typeof vi.fn>).mock.calls[0][0].stage).toBe(
      "read-bundled",
    );
    // No write or restart exec calls
    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    const restartCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("systemctl --user restart"),
    );
    expect(writeCalls).toHaveLength(0);
    expect(restartCalls).toHaveLength(0);
  });

  it("Test 9: mode-mirror invariant — chmod argument is the octal string of the bundled mode", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({
        slug: "exec-bit",
        installPath: "~/exec",
        bundledPath: "/app/exec-bit",
      }),
      catalogEntry({
        slug: "no-exec",
        installPath: "~/plain",
        bundledPath: "/app/no-exec",
      }),
    ];
    const { channel, exec } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) return "__WRITE_OK__";
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async (path: string) => {
        if (path === "/app/exec-bit") return { bytes: bundled, mode: 0o755 };
        return { bytes: bundled, mode: 0o644 };
      }),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    const writeCalls = exec.mock.calls.filter((c) =>
      (c[0] as string).includes("base64 -d"),
    );
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0][0] as string).toContain("chmod 755");
    expect(writeCalls[1][0] as string).toContain("chmod 644");
  });

  it("Test 10: sequential per-item iteration — no Promise.all parallelism; catalog order preserved", async () => {
    const bundled = Buffer.from("bundled");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "s1", installPath: "~/1", bundledPath: "/app/1" }),
      catalogEntry({ slug: "s2", installPath: "~/2", bundledPath: "/app/2" }),
      catalogEntry({ slug: "s3", installPath: "~/3", bundledPath: "/app/3" }),
    ];
    const readOrder: string[] = [];
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) {
        // Capture which install path is being read in order. Phase-72 BLOCKER
        // fix (tilde preservation): install paths are now emitted with an
        // unquoted `~/` prefix followed by the remainder single-quoted, so
        // for `~/1` the command contains `base64 -w0 ~/'1'`. Match both the
        // tilde form and the (unlikely) fully-quoted form for robustness.
        const tildeMatch = /base64 -w0 ~\/'([^']*)'/.exec(cmd);
        if (tildeMatch) {
          readOrder.push("~/" + tildeMatch[1]);
        } else {
          const quotedMatch = /base64 -w0 '([^']+)'/.exec(cmd);
          if (quotedMatch) readOrder.push(quotedMatch[1]);
        }
        return b64Ok(bundled);
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    await runSweepForHost(channel, HOST, catalog, deps);

    expect(readOrder).toEqual(["~/1", "~/2", "~/3"]);
  });

  // ------------------------------------------------------------------
  // Retry-on-transport tests (substrate-sweep-no-retry bounty fix).
  // ------------------------------------------------------------------

  it("Test 12: transient read transport error recovers on retry — no logItemFailed", async () => {
    const bundled = Buffer.from("bundled");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "flaky-read", installPath: "~/x" }),
    ];
    let readIdx = 0;
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) {
        readIdx++;
        // First read transports (null). Second read succeeds with matching bytes.
        if (readIdx === 1) return null;
        return b64Ok(bundled);
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    const result = await runSweepForHost(channel, HOST, catalog, deps);

    expect(result).toEqual({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 });
    expect(logItemFailed).not.toHaveBeenCalled();
  });

  it("Test 13: transient write channel-null recovers on retry — writes succeed, no logItemFailed", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "flaky-write", installPath: "~/x" }),
    ];
    let writeIdx = 0;
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) {
        writeIdx++;
        // First write returns null (channel died mid-write). Second succeeds.
        if (writeIdx === 1) return null;
        return "__WRITE_OK__";
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    const result = await runSweepForHost(channel, HOST, catalog, deps);

    expect(result).toEqual({ itemsChecked: 1, itemsChanged: 1, itemsFailed: 0 });
    expect(logItemFailed).not.toHaveBeenCalled();
  });

  it("Test 14: retry budget exhausted — 3 consecutive null writes still fails", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "dead-write", installPath: "~/x" }),
    ];
    let writeIdx = 0;
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) {
        writeIdx++;
        return null; // channel dies on every attempt
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    const result = await runSweepForHost(channel, HOST, catalog, deps);

    expect(result).toEqual({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 });
    expect(writeIdx).toBe(3); // 3 tries consumed
    expect(logItemFailed).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "write", errorMessage: "channel returned null" }),
    );
  });

  it("Test 15: structural write failure (__WRITE_FAIL__) does NOT retry", async () => {
    const bundled = Buffer.from("bundled");
    const stale = Buffer.from("stale");
    const catalog: CatalogEntry[] = [
      catalogEntry({ slug: "real-fail-write", installPath: "~/x" }),
    ];
    let writeIdx = 0;
    const { channel } = makeChannelSequenced((cmd) => {
      if (cmd.includes("base64 -w0")) return b64Ok(stale);
      if (cmd.includes("base64 -d")) {
        writeIdx++;
        return "__WRITE_FAIL__"; // real remote-side failure, not transient
      }
      throw new Error(`unexpected: ${cmd}`);
    });
    const deps: SweepDeps = {
      readBundledBytes: vi.fn(async () => ({ bytes: bundled, mode: 0o644 })),
    };

    const result = await runSweepForHost(channel, HOST, catalog, deps);

    expect(result).toEqual({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 1 });
    expect(writeIdx).toBe(1); // exactly ONE attempt, no retry
    expect(logItemFailed).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "write" }),
    );
  });
});
