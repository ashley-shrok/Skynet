/**
 * local-fleet-install.test.ts — Unit tests for the local-FS install helper.
 *
 * Uses a real temp directory (`os.tmpdir()` + `fs.mkdtemp`) as the test root
 * for the write-side, matching the pattern in local-fleet-scan.test.ts. The
 * whole point of these tests is atomic-write (temp file + rename) semantics
 * against the real POSIX filesystem — mocking fs would defeat that. For
 * error-injection tests (ENOENT / EACCES / EEXIST race) we use vi.spyOn to
 * force a specific fs call to reject.
 *
 * Env-override strategy:
 *   - HOME_HOST_DIR is set per-test to tmpRoot.
 *   - getLocalHomeRoot() then returns tmpRoot. So the user-home root (where
 *     ~/.local/bin, ~/.claude, ~/.config live) is tmpRoot — same shape as
 *     a real /host-home mount on production.
 *
 * Test coverage (per PLAN.md `<behavior>` § NT1 AW1 CM1 HS1 RB1 BR1 BE1):
 *   - NT1 never-throw on FS error (ENOENT on bundled read, EACCES on write,
 *     EEXIST race on rename)
 *   - AW1 atomic-write semantics (temp + rename, never direct writeFile onto
 *     final path)
 *   - CM1 chmod correctness (executable vs 0644, per computeInstallMode)
 *   - HS1 hash-skip parity (bytes-match → no writeFile, no rename, no mtime
 *     churn, itemsChanged stays 0)
 *   - RB1 /etc/ system-root row: euid gate — root writes, non-root skips
 *     with itemsFailed++
 *   - BR1 bootstrap covers host-parent + host-name (Steps 4 + 5) with
 *     content-diff idempotency; SKYNET_PUBLIC_URL missing → clean skip (no
 *     hadError); systemd steps (1-3) skip-with-warn when XDG_RUNTIME_DIR
 *     absent (documented environmental limitation, hadError NOT set)
 *   - BE1 bootstrap never-throw on FS error (host-parent or host-name
 *     write fails → hadError:true, no throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import type { CatalogEntry } from "./catalog.js";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

// A fresh tmpdir per test; env var swapped so getLocalHomeRoot points here.
// A SEPARATE `hostExecRoot` (SKYNET_HOME_MOUNT_SRC) stands in for the
// HOST-side home path — kept distinct from tmpRoot so tests that seed a
// host-side wrapper path in settings.json can't pass by accident.
let tmpRoot: string;
let hostExecRoot: string;
let originalHomeEnv: string | undefined;
let originalHostMountSrcEnv: string | undefined;
let originalSkynetUrlEnv: string | undefined;
let originalXdgEnv: string | undefined;

async function importFresh() {
  vi.resetModules();
  return await import("./local-fleet-install.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-fleet-install-test-"));
  // Distinct path — never accidentally equal to tmpRoot, so any test that
  // expects host-exec path but gets container path (or vice versa) fails
  // loudly instead of silently passing.
  hostExecRoot = "/nonexistent/host-home-test";
  originalHomeEnv = process.env.HOME_HOST_DIR;
  originalHostMountSrcEnv = process.env.SKYNET_HOME_MOUNT_SRC;
  originalSkynetUrlEnv = process.env.SKYNET_PUBLIC_URL;
  originalXdgEnv = process.env.XDG_RUNTIME_DIR;
  process.env.HOME_HOST_DIR = tmpRoot;
  process.env.SKYNET_HOME_MOUNT_SRC = hostExecRoot;
  // Default to no systemd — the test box likely has no user session.
  delete process.env.XDG_RUNTIME_DIR;
});

afterEach(async () => {
  if (originalHomeEnv === undefined) {
    delete process.env.HOME_HOST_DIR;
  } else {
    process.env.HOME_HOST_DIR = originalHomeEnv;
  }
  if (originalHostMountSrcEnv === undefined) {
    delete process.env.SKYNET_HOME_MOUNT_SRC;
  } else {
    process.env.SKYNET_HOME_MOUNT_SRC = originalHostMountSrcEnv;
  }
  if (originalSkynetUrlEnv === undefined) {
    delete process.env.SKYNET_PUBLIC_URL;
  } else {
    process.env.SKYNET_PUBLIC_URL = originalSkynetUrlEnv;
  }
  if (originalXdgEnv === undefined) {
    delete process.env.XDG_RUNTIME_DIR;
  } else {
    process.env.XDG_RUNTIME_DIR = originalXdgEnv;
  }
  try {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// Helper: build a single-row bundled catalog for the given entry
function catalogOf(entries: CatalogEntry[]): readonly CatalogEntry[] {
  return entries;
}

// Helper: a bundled reader that maps `bundledPath` → { bytes, mode }.
function makeBundledReader(
  map: Record<string, { bytes: Buffer; mode: number } | null>,
): (bundledPath: string) => Promise<{ bytes: Buffer; mode: number } | null> {
  return async (bundledPath: string) => map[bundledPath] ?? null;
}

const host = { id: "6", name: "t1000" };

// ---------------------------------------------------------------------------
// AW1 — atomic-write semantics
// ---------------------------------------------------------------------------

describe("AW1 — atomic-write semantics", () => {
  it("writes bytes to a tmp path, then renames onto the final install path (never direct writeFile)", async () => {
    const bundled = { bytes: Buffer.from("hello\n"), mode: 0o644 };
    const entry: CatalogEntry = {
      slug: "test-file",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const { installFleetSubstrateLocally } = await importFresh();

    // Spy on writeFile — track destinations so we can verify final path only
    // receives bytes via rename (from a tmp path), not a direct writeFile.
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    const result = await installFleetSubstrateLocally(
      host,
      catalogOf([entry]),
      { readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }) },
    );

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsChanged).toBe(1);
    expect(result.itemsFailed).toBe(0);

    // Final path expansion: ~/.claude/... → <tmpRoot>/.claude/...
    const finalPath = path.join(tmpRoot, ".claude/skills/foo/SKILL.md");

    // The final path must NEVER be the target of a direct writeFile.
    for (const call of writeFileSpy.mock.calls) {
      const target = String(call[0]);
      expect(target).not.toBe(finalPath);
    }

    // At least one rename call must land on the final path.
    const renameTargets = renameSpy.mock.calls.map((c) => String(c[1]));
    expect(renameTargets).toContain(finalPath);

    // And the file should exist on disk with the right bytes.
    const onDisk = await fs.readFile(finalPath);
    expect(onDisk.equals(bundled.bytes)).toBe(true);

    writeFileSpy.mockRestore();
    renameSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// CM1 — chmod correctness
// ---------------------------------------------------------------------------

describe("CM1 — chmod correctness (executable vs 0644)", () => {
  it("installs an executable (0o755) bundled file with executable bits set", async () => {
    const bundled = {
      bytes: Buffer.from("#!/bin/sh\necho hi\n"),
      mode: 0o100755, // fs.stat returns S_IFREG-ored mode
    };
    const entry: CatalogEntry = {
      slug: "exec-script",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/scripts/foo.sh",
      installPath: "~/.local/bin/foo",
      restartHook: null,
    };

    const { installFleetSubstrateLocally } = await importFresh();
    await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    const finalPath = path.join(tmpRoot, ".local/bin/foo");
    const stat = await fs.stat(finalPath);
    // Low 9 bits should equal 0o755 (computeInstallMode masks to 0o777).
    expect(stat.mode & 0o777).toBe(0o755);
  });

  it("installs a data (0o644) bundled file with 0o644 bits", async () => {
    const bundled = {
      bytes: Buffer.from("hello\n"),
      mode: 0o100644,
    };
    const entry: CatalogEntry = {
      slug: "data-file",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const { installFleetSubstrateLocally } = await importFresh();
    await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    const finalPath = path.join(tmpRoot, ".claude/skills/foo/SKILL.md");
    const stat = await fs.stat(finalPath);
    expect(stat.mode & 0o777).toBe(0o644);
  });
});

// ---------------------------------------------------------------------------
// HS1 — hash-skip parity
// ---------------------------------------------------------------------------

describe("HS1 — hash-skip parity (bytes-match → no writeFile, no rename, no mtime churn)", () => {
  it("skips silently when installed bytes already match bundled bytes", async () => {
    const bytes = Buffer.from("stable bytes\n");
    const bundled = { bytes, mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "stable",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    // Pre-plant the installed file so bytes match on first sweep.
    const finalPath = path.join(tmpRoot, ".claude/skills/foo/SKILL.md");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(finalPath, bytes);
    await fs.chmod(finalPath, 0o644);
    const statBefore = await fs.stat(finalPath);

    const { installFleetSubstrateLocally } = await importFresh();

    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsChanged).toBe(0);
    expect(result.itemsFailed).toBe(0);

    // No writeFile onto ANY path (temp or final) — the helper short-circuited.
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();

    // Mtime unchanged (no rewrite → no churn).
    const statAfter = await fs.stat(finalPath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

    writeFileSpy.mockRestore();
    renameSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// NT1 — never-throw on FS error
// ---------------------------------------------------------------------------

describe("NT1 — never-throw on FS error", () => {
  it("bundled read returns null (ENOENT-equivalent) → itemsFailed++, no throw", async () => {
    const entry: CatalogEntry = {
      slug: "missing",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/missing/SKILL.md",
      installPath: "~/.claude/skills/missing/SKILL.md",
      restartHook: null,
    };

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      // Reader returns null (simulates ENOENT / stat failure)
      readBundledBytes: makeBundledReader({}),
    });

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsChanged).toBe(0);
    expect(result.itemsFailed).toBe(1);
  });

  it("writeFile rejects with EACCES → itemsFailed++, no throw", async () => {
    const bundled = { bytes: Buffer.from("data\n"), mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "eacces",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    // Force writeFile to reject with EACCES.
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementationOnce(
      () => {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        return Promise.reject(err);
      },
    );

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsFailed).toBe(1);
    expect(result.itemsChanged).toBe(0);
    writeFileSpy.mockRestore();
  });

  it("rename rejects with EEXIST race → itemsFailed++, no throw", async () => {
    const bundled = { bytes: Buffer.from("data\n"), mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "eexist-race",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const renameSpy = vi.spyOn(fs, "rename").mockImplementationOnce(() => {
      const err = new Error("EEXIST: file exists") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      return Promise.reject(err);
    });

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsFailed).toBe(1);
    expect(result.itemsChanged).toBe(0);
    renameSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// RB1 — /etc/ system-root row behavior
// ---------------------------------------------------------------------------

describe("RB1 — /etc/ system-root row behavior (euid gate)", () => {
  it("non-root euid → skip-with-warn, itemsFailed++, no write attempted", async () => {
    // The twinkie row — runtime-source (bytes come from resolver map)
    const entry: CatalogEntry = {
      slug: "instance-policy-claude-md",
      sourceKind: "runtime",
      resolverKey: "instance-policy",
      installPath: "/etc/claude-code/CLAUDE.md",
      installMode: "system-root",
      restartHook: null,
    };
    const runtimeBytes = Buffer.from("# instance policy\n");
    const resolvedRuntimeBytes = new Map<string, Buffer | null>([
      ["instance-policy", runtimeBytes],
    ]);

    // Force geteuid to non-zero.
    const geteuidSpy = vi
      .spyOn(process, "geteuid")
      .mockReturnValue(1000);

    // Also spy on writeFile to prove NO write is attempted at any path
    // when the gate blocks.
    const writeFileSpy = vi.spyOn(fs, "writeFile");

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: async () => null, // never called for runtime rows
      resolvedRuntimeBytes,
    });

    expect(result.itemsChecked).toBe(1);
    expect(result.itemsChanged).toBe(0);
    expect(result.itemsFailed).toBe(1);

    // No write attempted anywhere (gate blocks before write).
    for (const call of writeFileSpy.mock.calls) {
      const target = String(call[0]);
      // A write to a completely unrelated tmp path is fine — we only assert
      // no attempt was made to write anywhere resembling the /etc/ target
      // or its neighborhood.
      expect(target.startsWith("/etc/claude-code")).toBe(false);
    }

    writeFileSpy.mockRestore();
    geteuidSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// RH1 — restart-hook fires after changed items with non-null restartHook
// ---------------------------------------------------------------------------

describe("RH1 — restart-hook fires after changed items", () => {
  it("changed file with restartHook → fireRestartHook invoked with unit name", async () => {
    const bundled = { bytes: Buffer.from("new content\n"), mode: 0o100755 };
    const entry: CatalogEntry = {
      slug: "agent-supervisor",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
      installPath: "~/.local/bin/agent-supervisor",
      restartHook: "agent-supervisor.service",
    };

    const fireRestartHookMock = vi.fn(async () => ({ ok: true as const }));

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
      fireRestartHook: fireRestartHookMock,
    });

    expect(result.itemsChanged).toBe(1);
    expect(result.itemsFailed).toBe(0);
    expect(fireRestartHookMock).toHaveBeenCalledTimes(1);
    expect(fireRestartHookMock).toHaveBeenCalledWith("agent-supervisor.service");
  });

  it("changed file with null restartHook → fireRestartHook NOT invoked", async () => {
    const bundled = { bytes: Buffer.from("data\n"), mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "no-hook",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const fireRestartHookMock = vi.fn(async () => ({ ok: true as const }));

    const { installFleetSubstrateLocally } = await importFresh();
    await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
      fireRestartHook: fireRestartHookMock,
    });

    expect(fireRestartHookMock).not.toHaveBeenCalled();
  });

  it("bytes-match skip → fireRestartHook NOT invoked (only on real change)", async () => {
    const bytes = Buffer.from("stable\n");
    const bundled = { bytes, mode: 0o100755 };
    const entry: CatalogEntry = {
      slug: "agent-supervisor",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
      installPath: "~/.local/bin/agent-supervisor",
      restartHook: "agent-supervisor.service",
    };

    // Pre-plant matching bytes so the item skips.
    const finalPath = path.join(tmpRoot, ".local/bin/agent-supervisor");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(finalPath, bytes);

    const fireRestartHookMock = vi.fn(async () => ({ ok: true as const }));

    const { installFleetSubstrateLocally } = await importFresh();
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
      fireRestartHook: fireRestartHookMock,
    });

    expect(result.itemsChanged).toBe(0);
    expect(fireRestartHookMock).not.toHaveBeenCalled();
  });

  it("restart-hook skipped (XDG_RUNTIME_DIR unset) → itemsFailed stays 0, warn logged", async () => {
    const bundled = { bytes: Buffer.from("bytes\n"), mode: 0o100755 };
    const entry: CatalogEntry = {
      slug: "agent-supervisor",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
      installPath: "~/.local/bin/agent-supervisor",
      restartHook: "agent-supervisor.service",
    };

    const fireRestartHookMock = vi.fn(async () => ({
      ok: false as const,
      skipped: true,
      errorMessage: "XDG_RUNTIME_DIR unset",
    }));

    const { installFleetSubstrateLocally } = await importFresh();
    const { systemLogger } = await import("../utils/logger.js");
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
      fireRestartHook: fireRestartHookMock,
    });

    expect(result.itemsChanged).toBe(1);
    expect(result.itemsFailed).toBe(0); // skip is not a failure
    const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
    const skipLog = warnCalls.find(
      (c) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "local_fleet_install_restart_skip",
    );
    expect(skipLog).toBeDefined();
  });

  it("restart-hook real failure → itemsFailed++, warn logged", async () => {
    const bundled = { bytes: Buffer.from("bytes\n"), mode: 0o100755 };
    const entry: CatalogEntry = {
      slug: "agent-supervisor",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
      installPath: "~/.local/bin/agent-supervisor",
      restartHook: "agent-supervisor.service",
    };

    const fireRestartHookMock = vi.fn(async () => ({
      ok: false as const,
      skipped: false,
      errorMessage: "unit not found",
    }));

    const { installFleetSubstrateLocally } = await importFresh();
    const { systemLogger } = await import("../utils/logger.js");
    const result = await installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
      fireRestartHook: fireRestartHookMock,
    });

    expect(result.itemsChanged).toBe(1); // bytes DID update
    expect(result.itemsFailed).toBe(1); // restart is a separate failure
    const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
    const errLog = warnCalls.find(
      (c) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "local_fleet_install_restart_error",
    );
    expect(errLog).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// BR1 — bootstrap covers host-parent + host-name
// ---------------------------------------------------------------------------

describe("BR1 — bootstrap covers host-parent + host-name writes", () => {
  it("SKYNET_PUBLIC_URL valid https:// URL → host-parent written, host-name written", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.hostParentOk).toBe(true);
    expect(result.hostNameOk).toBe(true);

    const parentPath = path.join(tmpRoot, "fleet/host/parent");
    const hostnamePath = path.join(tmpRoot, "fleet/host/name");
    expect((await fs.readFile(parentPath, "utf-8")).trim()).toBe(
      "https://skynet.example.com",
    );
    expect((await fs.readFile(hostnamePath, "utf-8")).trim()).toBe("t1000");
  });

  it("SKYNET_PUBLIC_URL missing → skip host-parent (no hadError), still writes host-name", async () => {
    delete process.env.SKYNET_PUBLIC_URL;
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.hostParentOk).toBe(false); // documented skip; not error
    expect(result.hostNameOk).toBe(true);

    const parentPath = path.join(tmpRoot, "fleet/host/parent");
    await expect(fs.access(parentPath)).rejects.toThrow();

    const hostnamePath = path.join(tmpRoot, "fleet/host/name");
    expect((await fs.readFile(hostnamePath, "utf-8")).trim()).toBe("t1000");
  });

  it("SKYNET_PUBLIC_URL malformed (no https://) → skip host-parent (no hadError)", async () => {
    process.env.SKYNET_PUBLIC_URL = "http://insecure.example";
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.hostParentOk).toBe(false);
  });

  it("idempotent: second call does not rewrite when contents match (no mtime churn on host-parent)", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    await bootstrapFleetSubstrateLocally(host);
    const parentPath = path.join(tmpRoot, "fleet/host/parent");
    const statFirst = await fs.stat(parentPath);

    // Second sweep — same content, must not rewrite.
    // Small sleep to make mtime granularity distinguishable would help but
    // is not needed: we spy on writeFile to catch any second write.
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    await bootstrapFleetSubstrateLocally(host);
    for (const call of writeFileSpy.mock.calls) {
      const target = String(call[0]);
      // A second temp write for host-parent would be a bug — assert none.
      expect(target.includes("fleet/host/parent")).toBe(false);
    }
    const statSecond = await fs.stat(parentPath);
    expect(statSecond.mtimeMs).toBe(statFirst.mtimeMs);
    writeFileSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// BR2 — bootstrap covers settings.json six-key patch + gsd-context-monitor
// cleanup (2026-09-20 fix — previously lumped under systemd_steps_deferred).
// Requires `jq` on the test runner (present in prod container per Dockerfile).
// ---------------------------------------------------------------------------

describe("BR2 — bootstrap patches settings.json + runs gsd-context-monitor cleanup", () => {
  it("settings.json absent → merge creates it with all six required keys, chown to home-root owner", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.settingsPatchOk).toBe(true);

    const settingsPath = path.join(tmpRoot, ".claude/settings.json");
    const parsed = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

    expect(parsed.skipDangerousModePermissionPrompt).toBe(true);
    expect(parsed.askUserQuestionTimeout).toBe("never");
    expect(parsed.permissions.deny).toContain("AskUserQuestion");
    expect(parsed.env.DISABLE_AUTOUPDATER).toBe("1");
    expect(parsed.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    // Hooks stored as LITERAL $HOME (bash-single-quote parity with SSH path).
    const upsCommands = parsed.hooks.UserPromptSubmit.flatMap(
      (g: { hooks?: Array<{ command?: string }> }) =>
        (g.hooks ?? []).map((h) => h.command),
    );
    expect(upsCommands).toContain("$HOME/.local/bin/task-field-check");
    // allow-all-tools PreToolUse hook — universal auto-allow. The entry
    // has NO matcher field (fires for every tool call). Verify the
    // command is present AND the entry group has no matcher key.
    const preToolUseGroups = parsed.hooks.PreToolUse as Array<{
      matcher?: string;
      hooks?: Array<{ command?: string }>;
    }>;
    const allowAllGroup = preToolUseGroups.find((g) =>
      (g.hooks ?? []).some((h) => h.command === "$HOME/.local/bin/allow-all-tools"),
    );
    expect(allowAllGroup).toBeDefined();
    expect(allowAllGroup?.matcher).toBeUndefined();
  });

  it("settings.json already has all seven keys → noop, no rewrite (mtime unchanged)", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    // First call — creates it.
    await bootstrapFleetSubstrateLocally(host);
    const settingsPath = path.join(tmpRoot, ".claude/settings.json");
    const statFirst = await fs.stat(settingsPath);

    // Second call — spy on writeFile; must NOT rewrite settings.json.
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const result = await bootstrapFleetSubstrateLocally(host);
    expect(result.settingsPatchOk).toBe(true);
    expect(result.hadError).toBe(false);
    for (const call of writeFileSpy.mock.calls) {
      expect(String(call[0]).includes("settings.json")).toBe(false);
    }
    const statSecond = await fs.stat(settingsPath);
    expect(statSecond.mtimeMs).toBe(statFirst.mtimeMs);
    writeFileSpy.mockRestore();
  });

  it("settings.json has 5 keys but missing task-field-check hook → merge adds it while preserving other UserPromptSubmit entries", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const claudeDir = path.join(tmpRoot, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    const seed = {
      permissions: { deny: ["AskUserQuestion"] },
      askUserQuestionTimeout: "never",
      env: {
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      },
      skipDangerousModePermissionPrompt: true,
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "/some/other/hook.sh" }] },
        ],
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(seed, null, 2),
    );

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.settingsPatchOk).toBe(true);

    const parsed = JSON.parse(
      await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8"),
    );
    const upsCommands = parsed.hooks.UserPromptSubmit.flatMap(
      (g: { hooks?: Array<{ command?: string }> }) =>
        (g.hooks ?? []).map((h) => h.command),
    );
    // Original hook preserved AND task-field-check appended.
    expect(upsCommands).toContain("/some/other/hook.sh");
    expect(upsCommands).toContain("$HOME/.local/bin/task-field-check");
  });

  it("settings.json has 6 keys but missing allow-all-tools hook → merge adds it while preserving other PreToolUse entries", async () => {
    // Mirror of the task-field-check test above, for the PreToolUse
    // allow-all-tools hook. Seeds a settings.json missing only the
    // allow-all-tools entry (all 6 previous keys correct AND a pre-existing
    // user-owned PreToolUse hook with its own matcher). Expects the merge
    // to append the allow-all-tools entry WITHOUT clobbering the existing
    // one — validation hooks the user has configured must survive.
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const claudeDir = path.join(tmpRoot, ".claude");
    await fs.mkdir(claudeDir, { recursive: true });
    const seed = {
      permissions: { deny: ["AskUserQuestion"] },
      askUserQuestionTimeout: "never",
      env: {
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      },
      skipDangerousModePermissionPrompt: true,
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "$HOME/.local/bin/task-field-check" },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [
              { type: "command", command: "/some/user/pre-tool-hook.js" },
            ],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(seed, null, 2),
    );

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.settingsPatchOk).toBe(true);

    const parsed = JSON.parse(
      await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8"),
    );
    const preCommands = parsed.hooks.PreToolUse.flatMap(
      (g: { hooks?: Array<{ command?: string }> }) =>
        (g.hooks ?? []).map((h) => h.command),
    );
    // Original user hook preserved AND allow-all-tools appended.
    expect(preCommands).toContain("/some/user/pre-tool-hook.js");
    expect(preCommands).toContain("$HOME/.local/bin/allow-all-tools");
    // The allow-all-tools entry has NO matcher field — universal auto-allow.
    const preGroups = parsed.hooks.PreToolUse as Array<{
      matcher?: string;
      hooks?: Array<{ command?: string }>;
    }>;
    const allowAllGroup = preGroups.find((g) =>
      (g.hooks ?? []).some((h) => h.command === "$HOME/.local/bin/allow-all-tools"),
    );
    expect(allowAllGroup).toBeDefined();
    expect(allowAllGroup?.matcher).toBeUndefined();
    // The pre-existing user hook keeps its matcher.
    const userGroup = preGroups.find((g) =>
      (g.hooks ?? []).some((h) => h.command === "/some/user/pre-tool-hook.js"),
    );
    expect(userGroup?.matcher).toBe("Write|Edit");
  });

  it("gsd-context-monitor cleanup: no matching hook + no hook file → clean noop, gsdContextMonitorCleanupOk:true", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);
    expect(result.gsdContextMonitorCleanupOk).toBe(true);
    expect(result.hadError).toBe(false);
    // Settings.json now exists (from step 2 merge) and has no PostToolUse.gsd-context-monitor entry.
    const parsed = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".claude/settings.json"), "utf-8"),
    );
    const posts = (parsed.hooks?.PostToolUse ?? []) as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    const anyGsd = posts.some((g) =>
      (g.hooks ?? []).some((h) => (h.command ?? "").includes("gsd-context-monitor")),
    );
    expect(anyGsd).toBe(false);
  });

  it("gsd-context-monitor cleanup: matching hook present in settings + hook file present → strip settings entry AND unlink hook file", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const claudeDir = path.join(tmpRoot, ".claude");
    const hooksDir = path.join(claudeDir, "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(
      path.join(hooksDir, "gsd-context-monitor.js"),
      "// legacy hook body\n",
    );
    // Seed settings.json with all 7 keys AND a lingering gsd-context-monitor
    // PostToolUse entry, so step 2 sees "already correct" and step 3 does the strip.
    const seed = {
      permissions: { deny: ["AskUserQuestion"] },
      askUserQuestionTimeout: "never",
      env: {
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      },
      skipDangerousModePermissionPrompt: true,
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "$HOME/.local/bin/task-field-check" },
            ],
          },
        ],
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "$HOME/.local/bin/allow-all-tools" },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "node /home/x/.claude/hooks/gsd-context-monitor.js",
              },
            ],
          },
        ],
      },
    };
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(seed, null, 2),
    );

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.gsdContextMonitorCleanupOk).toBe(true);

    // Hook file gone.
    await expect(
      fs.access(path.join(hooksDir, "gsd-context-monitor.js")),
    ).rejects.toThrow();
    // PostToolUse entry stripped from settings.
    const parsed = JSON.parse(
      await fs.readFile(path.join(claudeDir, "settings.json"), "utf-8"),
    );
    const posts = (parsed.hooks?.PostToolUse ?? []) as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    const anyGsd = posts.some((g) =>
      (g.hooks ?? []).some((h) => (h.command ?? "").includes("gsd-context-monitor")),
    );
    expect(anyGsd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BR3 — bootstrap Step 6: usage-reporter retirement.
// Parallel with SSH surface (run-bootstrap.ts Step 6, tests sl-1..sl-8).
// ---------------------------------------------------------------------------

describe("BR3 — bootstrap retires the usage-reporter statusLine wrap", () => {
  const RETIRED_BIN = [
    "usage-reporter",
    "usage-report",
    "claude-usage-collector",
    "install-usage-reporter",
  ];

  async function seedWrapped(opts: {
    wrapperCmd?: string;
    confBody?: string | null;
    extraSettings?: Record<string, unknown>;
  }) {
    const claudeDir = path.join(tmpRoot, ".claude");
    const usageDir = path.join(claudeDir, "usage");
    const binDir = path.join(tmpRoot, ".local/bin");
    await fs.mkdir(usageDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    for (const f of RETIRED_BIN) {
      await fs.writeFile(path.join(binDir, f), "#!/bin/sh\n");
    }
    await fs.writeFile(path.join(usageDir, "last-post-ts"), "1\n");
    if (opts.confBody !== null) {
      await fs.writeFile(
        path.join(usageDir, "usage-reporter.conf"),
        opts.confBody ?? "WRAPPED=''\n",
      );
    }
    await fs.writeFile(
      path.join(claudeDir, "settings.json"),
      JSON.stringify(
        {
          theme: "dark",
          ...opts.extraSettings,
          statusLine: {
            type: "command",
            command:
              opts.wrapperCmd ?? path.join(hostExecRoot, ".local/bin/usage-reporter"),
            padding: 0,
          },
        },
        null,
        2,
      ),
    );
    return { claudeDir, usageDir, binDir };
  }

  async function readSettings() {
    return JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".claude/settings.json"), "utf-8"),
    );
  }

  async function expectRetiredFilesGone(binDir: string, usageDir: string) {
    for (const f of RETIRED_BIN) {
      await expect(fs.access(path.join(binDir, f))).rejects.toThrow();
    }
    await expect(fs.access(usageDir)).rejects.toThrow();
  }

  it("fresh box (nothing wired) → usageReporterRetireOk:true, no statusLine added", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.usageReporterRetireOk).toBe(true);
    const parsed = await readSettings().catch(() => ({}));
    expect(parsed.statusLine).toBeUndefined();
  });

  it("wrapped with a real original → original restored, other keys kept, files removed", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { binDir, usageDir } = await seedWrapped({
      confBody: "WRAPPED='my-status --arg here'\n",
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.usageReporterRetireOk).toBe(true);
    expect(result.hadError).toBe(false);
    const parsed = await readSettings();
    expect(parsed.statusLine).toEqual({
      type: "command",
      command: "my-status --arg here",
      padding: 0,
    });
    expect(parsed.theme).toBe("dark");
    await expectRetiredFilesGone(binDir, usageDir);
  });

  it("spicy original with quotes/spaces/$ → restored verbatim", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const spicy = `my-status --arg "hi $USER's world" -x`;
    // Exactly what the old wire-up wrote: single-quoted, ' as '\''.
    const quoted = "'" + spicy.replace(/'/g, "'\\''") + "'";
    await seedWrapped({ confBody: `WRAPPED=${quoted}\n` });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    await bootstrapFleetSubstrateLocally(host);

    expect((await readSettings()).statusLine.command).toBe(spicy);
  });

  it("empty WRAPPED → statusLine dropped", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { binDir, usageDir } = await seedWrapped({ confBody: "WRAPPED=''\n" });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.usageReporterRetireOk).toBe(true);
    const parsed = await readSettings();
    expect(parsed.statusLine).toBeUndefined();
    expect(parsed.theme).toBe("dark");
    await expectRetiredFilesGone(binDir, usageDir);
  });

  it("missing conf → statusLine dropped", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    await seedWrapped({ confBody: null });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    await bootstrapFleetSubstrateLocally(host);

    expect((await readSettings()).statusLine).toBeUndefined();
  });

  it("original is itself a usage-reporter path (old /host-home mis-wire) → statusLine dropped", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    await seedWrapped({
      wrapperCmd: "/host-home/.local/bin/usage-reporter",
      confBody: "WRAPPED='/host-home/.local/bin/usage-reporter'\n",
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    await bootstrapFleetSubstrateLocally(host);

    expect((await readSettings()).statusLine).toBeUndefined();
  });

  it("statusLine that isn't the wrapper is left alone; leftovers still removed", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { binDir, usageDir } = await seedWrapped({
      wrapperCmd: "my-own-status",
      confBody: "WRAPPED='something-else'\n",
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.usageReporterRetireOk).toBe(true);
    expect((await readSettings()).statusLine.command).toBe("my-own-status");
    await expectRetiredFilesGone(binDir, usageDir);
  });

  it("idempotent: second call does not rewrite settings.json (mtime unchanged)", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    await seedWrapped({ confBody: "WRAPPED='my-status'\n" });
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    await bootstrapFleetSubstrateLocally(host);
    const settingsPath = path.join(tmpRoot, ".claude/settings.json");
    const statFirst = await fs.stat(settingsPath);

    const second = await bootstrapFleetSubstrateLocally(host);
    expect(second.usageReporterRetireOk).toBe(true);
    expect((await fs.stat(settingsPath)).mtimeMs).toBe(statFirst.mtimeMs);
  });
});

// ---------------------------------------------------------------------------
// BE1 — bootstrap never-throw
// ---------------------------------------------------------------------------

describe("BE1 — bootstrap never-throw on FS error", () => {
  it("writeFile rejects during host-name → hadError:true, no throw", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";

    const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(() => {
      const err = new Error("EACCES") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return Promise.reject(err);
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(true);
    expect(result.hostParentOk).toBe(false);
    expect(result.hostNameOk).toBe(false);

    writeFileSpy.mockRestore();
  });

  it("mkdir rejects with a non-EEXIST error → hadError:true, no throw", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";

    const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(() => {
      const err = new Error("EACCES") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return Promise.reject(err);
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(true);

    mkdirSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Structured logging convention
// ---------------------------------------------------------------------------

describe("Structured logging convention (operation: local_fleet_install_* / local_fleet_bootstrap_*)", () => {
  it("emits an info summary with operation:local_fleet_install_result", async () => {
    const bundled = { bytes: Buffer.from("ok\n"), mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "logtest",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const modUnderTest = await importFresh();
    const { systemLogger } = await import("../utils/logger.js");

    await modUnderTest.installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    const infoCalls = vi.mocked(systemLogger.info).mock.calls;
    const summary = infoCalls.find(
      (c) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "local_fleet_install_result",
    );
    expect(summary).toBeDefined();
  });

  it("emits a warn with operation:local_fleet_install_error on FS failure", async () => {
    const bundled = { bytes: Buffer.from("data\n"), mode: 0o100644 };
    const entry: CatalogEntry = {
      slug: "logfail",
      sourceKind: "bundled",
      bundledPath: "/app/fleet-substrate/skills/foo/SKILL.md",
      installPath: "~/.claude/skills/foo/SKILL.md",
      restartHook: null,
    };

    const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementationOnce(() => {
      const err = new Error("EACCES") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return Promise.reject(err);
    });

    const modUnderTest = await importFresh();
    const { systemLogger } = await import("../utils/logger.js");

    await modUnderTest.installFleetSubstrateLocally(host, catalogOf([entry]), {
      readBundledBytes: makeBundledReader({ [entry.bundledPath]: bundled }),
    });

    const warnCalls = vi.mocked(systemLogger.warn).mock.calls;
    const errLog = warnCalls.find(
      (c) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        typeof (c[1] as Record<string, unknown>).operation === "string" &&
        ((c[1] as Record<string, unknown>).operation as string).startsWith(
          "local_fleet_install_",
        ),
    );
    expect(errLog).toBeDefined();
    writeFileSpy.mockRestore();
  });
});
