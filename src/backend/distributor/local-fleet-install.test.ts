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
 *   - IDENTITIES_HOST_DIR is set per-test to `${tmpRoot}/identities`.
 *   - getLocalIdentitiesRoot() then returns `${tmpRoot}/identities`.
 *   - path.dirname(...) → tmpRoot. So the fleet root (where ~/.local/bin,
 *     ~/.claude, ~/.config live) is tmpRoot.
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
 *   - BR1 bootstrap covers skynet-parent + skynet-hostname (Steps 4 + 5) with
 *     content-diff idempotency; SKYNET_PUBLIC_URL missing → clean skip (no
 *     hadError); systemd steps (1-3) skip-with-warn when XDG_RUNTIME_DIR
 *     absent (documented environmental limitation, hadError NOT set)
 *   - BE1 bootstrap never-throw on FS error (skynet-parent or skynet-hostname
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

// A fresh tmpdir per test; env var swapped so getLocalIdentitiesRoot points here.
let tmpRoot: string;
let originalIdentitiesEnv: string | undefined;
let originalSkynetUrlEnv: string | undefined;
let originalXdgEnv: string | undefined;

async function importFresh() {
  vi.resetModules();
  return await import("./local-fleet-install.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-fleet-install-test-"));
  originalIdentitiesEnv = process.env.IDENTITIES_HOST_DIR;
  originalSkynetUrlEnv = process.env.SKYNET_PUBLIC_URL;
  originalXdgEnv = process.env.XDG_RUNTIME_DIR;
  process.env.IDENTITIES_HOST_DIR = path.join(tmpRoot, "identities");
  // Default to no systemd — the test box likely has no user session.
  delete process.env.XDG_RUNTIME_DIR;
});

afterEach(async () => {
  if (originalIdentitiesEnv === undefined) {
    delete process.env.IDENTITIES_HOST_DIR;
  } else {
    process.env.IDENTITIES_HOST_DIR = originalIdentitiesEnv;
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
// BR1 — bootstrap covers skynet-parent + skynet-hostname
// ---------------------------------------------------------------------------

describe("BR1 — bootstrap covers skynet-parent + skynet-hostname writes", () => {
  it("SKYNET_PUBLIC_URL valid https:// URL → skynet-parent written, skynet-hostname written", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.skynetParentOk).toBe(true);
    expect(result.skynetHostnameOk).toBe(true);

    const parentPath = path.join(tmpRoot, ".claude/skynet-parent");
    const hostnamePath = path.join(tmpRoot, ".claude/skynet-hostname");
    expect((await fs.readFile(parentPath, "utf-8")).trim()).toBe(
      "https://skynet.example.com",
    );
    expect((await fs.readFile(hostnamePath, "utf-8")).trim()).toBe("t1000");
  });

  it("SKYNET_PUBLIC_URL missing → skip skynet-parent (no hadError), still writes skynet-hostname", async () => {
    delete process.env.SKYNET_PUBLIC_URL;
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.skynetParentOk).toBe(false); // documented skip; not error
    expect(result.skynetHostnameOk).toBe(true);

    const parentPath = path.join(tmpRoot, ".claude/skynet-parent");
    await expect(fs.access(parentPath)).rejects.toThrow();

    const hostnamePath = path.join(tmpRoot, ".claude/skynet-hostname");
    expect((await fs.readFile(hostnamePath, "utf-8")).trim()).toBe("t1000");
  });

  it("SKYNET_PUBLIC_URL malformed (no https://) → skip skynet-parent (no hadError)", async () => {
    process.env.SKYNET_PUBLIC_URL = "http://insecure.example";
    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(false);
    expect(result.skynetParentOk).toBe(false);
  });

  it("idempotent: second call does not rewrite when contents match (no mtime churn on skynet-parent)", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";
    const { bootstrapFleetSubstrateLocally } = await importFresh();

    await bootstrapFleetSubstrateLocally(host);
    const parentPath = path.join(tmpRoot, ".claude/skynet-parent");
    const statFirst = await fs.stat(parentPath);

    // Second sweep — same content, must not rewrite.
    // Small sleep to make mtime granularity distinguishable would help but
    // is not needed: we spy on writeFile to catch any second write.
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    await bootstrapFleetSubstrateLocally(host);
    for (const call of writeFileSpy.mock.calls) {
      const target = String(call[0]);
      // A second temp write for skynet-parent would be a bug — assert none.
      expect(target.includes("skynet-parent")).toBe(false);
    }
    const statSecond = await fs.stat(parentPath);
    expect(statSecond.mtimeMs).toBe(statFirst.mtimeMs);
    writeFileSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// BE1 — bootstrap never-throw
// ---------------------------------------------------------------------------

describe("BE1 — bootstrap never-throw on FS error", () => {
  it("writeFile rejects during skynet-hostname → hadError:true, no throw", async () => {
    process.env.SKYNET_PUBLIC_URL = "https://skynet.example.com";

    const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(() => {
      const err = new Error("EACCES") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return Promise.reject(err);
    });

    const { bootstrapFleetSubstrateLocally } = await importFresh();
    const result = await bootstrapFleetSubstrateLocally(host);

    expect(result.hadError).toBe(true);
    expect(result.skynetParentOk).toBe(false);
    expect(result.skynetHostnameOk).toBe(false);

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
