import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Phase 98 plan 05 — voice-migration unit tests.
 *
 * Covers the startup one-shot per D-Per-identity-voice-binding hard reset
 * + D-Claude's-discretion (startup one-shot idempotent) from 98-CONTEXT.md.
 *
 * Locked behavior (from 98-05-PLAN.md § Task 1 <behavior>):
 *   1. File with `voice: Elena.wav` → line removed.
 *   2. File with `voice: Joanna` (Polly ID) → untouched.
 *   3. File with `voice: SomeCustom` → untouched (neither old-regex nor Polly).
 *   4. File with no `voice:` line → untouched.
 *   5. File with quoted `voice: "Elena.wav"` → line removed (quote-strip is
 *      LOAD-BEARING — plan-review lock).
 *   6. Missing root directory → walkAndMigrate returns {scanned:0, changed:0}.
 *   7. Idempotency: second call after first pass → all files skip, changed=0.
 *   8. Simulated fs error mid-write → ensureVoiceValuesMigrated does NOT throw.
 *   9. Log assertion: success emits one info with operation:"voice_migration_complete";
 *      unhandled error emits one warn with operation:"voice_migration_startup_error".
 *
 * Strategy: mock `node:fs/promises` with an in-memory tree so tests are
 * self-contained (no real disk I/O). Mock `getLocalIdentitiesRoot` +
 * `getLocalRolesRoot` to return known-string paths that key into the
 * in-memory tree.
 */

// ---------------------------------------------------------------------------
// In-memory fs — a Map<absPath, string> for files, plus a directory-set.
// Backed by vi.hoisted so it survives the pre-import hoisting order.
// ---------------------------------------------------------------------------

const { fakeFs } = vi.hoisted(() => {
  interface FakeFs {
    files: Map<string, string>;
    dirs: Set<string>;
    writeFailPath: string | null; // if set, writeFile of this path rejects
  }
  const state: FakeFs = {
    files: new Map(),
    dirs: new Set(),
    writeFailPath: null,
  };
  return { fakeFs: state };
});

vi.mock("node:fs/promises", () => {
  function ensureDir(p: string): void {
    fakeFs.dirs.add(p);
  }

  return {
    default: {},
    readdir: vi.fn(async (root: string, opts?: { withFileTypes?: boolean }) => {
      if (!fakeFs.dirs.has(root)) {
        const err = new Error(`ENOENT: no such directory, ${root}`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      // Walk our fake tree for immediate children (files + dirs) of `root`.
      const seen = new Set<string>();
      const results: Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }> = [];
      for (const d of fakeFs.dirs) {
        if (d === root) continue;
        if (d.startsWith(root + "/")) {
          const remainder = d.slice(root.length + 1);
          const first = remainder.split("/")[0];
          if (seen.has(first)) continue;
          seen.add(first);
          results.push({
            name: first,
            isDirectory: () => true,
            isFile: () => false,
          });
        }
      }
      for (const f of fakeFs.files.keys()) {
        if (f.startsWith(root + "/")) {
          const remainder = f.slice(root.length + 1);
          if (!remainder.includes("/")) {
            if (seen.has(remainder)) continue;
            seen.add(remainder);
            results.push({
              name: remainder,
              isDirectory: () => false,
              isFile: () => true,
            });
          }
        }
      }
      if (opts?.withFileTypes) return results;
      return results.map((r) => r.name);
    }),
    stat: vi.fn(async (p: string) => {
      if (fakeFs.files.has(p)) {
        return { isFile: () => true, isDirectory: () => false };
      }
      if (fakeFs.dirs.has(p)) {
        return { isFile: () => false, isDirectory: () => true };
      }
      const err = new Error(`ENOENT: no such file, ${p}`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }),
    readFile: vi.fn(async (p: string, _enc?: string) => {
      const content = fakeFs.files.get(p);
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file, ${p}`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return content;
    }),
    writeFile: vi.fn(async (p: string, contents: string, _enc?: string) => {
      if (fakeFs.writeFailPath !== null && p.startsWith(fakeFs.writeFailPath)) {
        throw new Error("EIO: simulated write failure");
      }
      // Auto-create parent dir set membership so subsequent readdir works.
      const parent = p.split("/").slice(0, -1).join("/");
      if (parent) ensureDir(parent);
      fakeFs.files.set(p, contents);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const c = fakeFs.files.get(from);
      if (c === undefined) {
        const err = new Error(`ENOENT: no such file, ${from}`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      fakeFs.files.delete(from);
      fakeFs.files.set(to, c);
    }),
    unlink: vi.fn(async (p: string) => {
      fakeFs.files.delete(p);
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock the roots resolver — return well-known paths our fake tree keys on.
// ---------------------------------------------------------------------------

const FAKE_ID_ROOT = "/fake/identities";
const FAKE_ROLE_ROOT = "/fake/roles";

vi.mock("../claude-session/identity-artifact-reader.js", () => ({
  getLocalIdentitiesRoot: vi.fn(() => FAKE_ID_ROOT),
  getLocalRolesRoot: vi.fn(() => FAKE_ROLE_ROOT),
}));

// ---------------------------------------------------------------------------
// Spy on databaseLogger.info + databaseLogger.warn (used inside the module).
// ---------------------------------------------------------------------------

const { infoSpy, warnSpy } = vi.hoisted(() => ({
  infoSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the module UNDER TEST after all mocks are in place.
// ---------------------------------------------------------------------------

import { ensureVoiceValuesMigrated } from "./voice-migration.js";

// ---------------------------------------------------------------------------
// Test-lifecycle helpers
// ---------------------------------------------------------------------------

function resetFakeFs(): void {
  fakeFs.files.clear();
  fakeFs.dirs.clear();
  fakeFs.writeFailPath = null;
}

/** Seed a directory into the fake tree. */
function mkdir(p: string): void {
  fakeFs.dirs.add(p);
}

/** Seed a file into the fake tree (auto-mkdirs the parent). */
function writeSeedFile(p: string, contents: string): void {
  const parent = p.split("/").slice(0, -1).join("/");
  if (parent) mkdir(parent);
  fakeFs.files.set(p, contents);
}

beforeEach(() => {
  resetFakeFs();
  infoSpy.mockClear();
  warnSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Behavior tests
// ---------------------------------------------------------------------------

describe("ensureVoiceValuesMigrated — end-to-end behavior across both roots", () => {
  it("Case 1: file with `voice: Elena.wav` has the voice line removed", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/alice.md`,
      "---\nname: alice\nvoice: Elena.wav\nrole: friend\n---\nBody text.\n",
    );

    await ensureVoiceValuesMigrated();

    const after = fakeFs.files.get(`${FAKE_ID_ROOT}/alice/alice.md`);
    expect(after).toBeDefined();
    expect(after!).not.toMatch(/^voice:/m);
    expect(after!).toMatch(/name: alice/);
    expect(after!).toMatch(/role: friend/);
  });

  it("Case 2: file with `voice: Joanna` (Polly ID) is left untouched", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    const orig = "---\nname: bob\nvoice: Joanna\n---\nHi.\n";
    writeSeedFile(`${FAKE_ID_ROOT}/bob/bob.md`, orig);

    await ensureVoiceValuesMigrated();

    expect(fakeFs.files.get(`${FAKE_ID_ROOT}/bob/bob.md`)).toBe(orig);
  });

  it("Case 3: file with `voice: SomeCustom` (neither old-regex nor Polly) is left untouched", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    const orig = "---\nname: carol\nvoice: SomeCustom\n---\nCarol body.\n";
    writeSeedFile(`${FAKE_ID_ROOT}/carol/carol.md`, orig);

    await ensureVoiceValuesMigrated();

    expect(fakeFs.files.get(`${FAKE_ID_ROOT}/carol/carol.md`)).toBe(orig);
  });

  it("Case 4: file with no `voice:` line is left untouched", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    const orig = "---\nname: dave\nrole: friend\n---\nDave body.\n";
    writeSeedFile(`${FAKE_ID_ROOT}/dave/dave.md`, orig);

    await ensureVoiceValuesMigrated();

    expect(fakeFs.files.get(`${FAKE_ID_ROOT}/dave/dave.md`)).toBe(orig);
  });

  it("Case 5 (LOAD-BEARING): file with quoted `voice: \"Elena.wav\"` has the line removed (quote-strip works)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/erin/erin.md`,
      '---\nname: erin\nvoice: "Elena.wav"\n---\nErin body.\n',
    );

    await ensureVoiceValuesMigrated();

    const after = fakeFs.files.get(`${FAKE_ID_ROOT}/erin/erin.md`);
    expect(after).toBeDefined();
    expect(after!).not.toMatch(/^voice:/m);
    expect(after!).toMatch(/name: erin/);
  });

  it("Case 5b: single-quoted `voice: 'Elena.wav'` is also stripped and removed", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/fran/fran.md`,
      "---\nname: fran\nvoice: 'Elena.wav'\n---\nBody.\n",
    );

    await ensureVoiceValuesMigrated();

    const after = fakeFs.files.get(`${FAKE_ID_ROOT}/fran/fran.md`);
    expect(after).toBeDefined();
    expect(after!).not.toMatch(/^voice:/m);
  });

  it("Case 6: both root directories missing → walkAndMigrate is graceful (no throw, single info log)", async () => {
    // Do NOT mkdir either root — they don't exist.
    await expect(ensureVoiceValuesMigrated()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    const infoCall = infoSpy.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "voice_migration_complete",
    );
    expect(infoCall).toBeDefined();
    const meta = infoCall![1] as {
      identitiesScanned: number;
      identitiesChanged: number;
      rolesScanned: number;
      rolesChanged: number;
    };
    expect(meta.identitiesScanned).toBe(0);
    expect(meta.identitiesChanged).toBe(0);
    expect(meta.rolesScanned).toBe(0);
    expect(meta.rolesChanged).toBe(0);
  });

  it("Case 7: second call after first pass — all files skip, changed=0 (idempotent)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/alice.md`,
      "---\nname: alice\nvoice: Elena.wav\n---\nBody.\n",
    );

    await ensureVoiceValuesMigrated();
    // Confirm first call did the migration
    const afterFirst = fakeFs.files.get(`${FAKE_ID_ROOT}/alice/alice.md`);
    expect(afterFirst!).not.toMatch(/^voice:/m);

    // Reset log spies to isolate the second-call assertion
    infoSpy.mockClear();
    warnSpy.mockClear();

    await ensureVoiceValuesMigrated();
    const infoCall = infoSpy.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "voice_migration_complete",
    );
    expect(infoCall).toBeDefined();
    const meta = infoCall![1] as {
      identitiesScanned: number;
      identitiesChanged: number;
      rolesScanned: number;
      rolesChanged: number;
    };
    expect(meta.identitiesChanged).toBe(0);
    expect(meta.rolesChanged).toBe(0);
  });

  it("Case 8: simulated fs error mid-write → ensureVoiceValuesMigrated resolves undefined (does NOT throw)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/alice.md`,
      "---\nname: alice\nvoice: Elena.wav\n---\nBody.\n",
    );
    // Force writeFile to reject for the identity write path
    fakeFs.writeFailPath = `${FAKE_ID_ROOT}/alice`;

    await expect(ensureVoiceValuesMigrated()).resolves.toBeUndefined();
  });

  it("Case 9: on success emits an info with operation:'voice_migration_complete'", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/alice.md`,
      "---\nname: alice\nvoice: Elena.wav\n---\nBody.\n",
    );

    await ensureVoiceValuesMigrated();

    const found = infoSpy.mock.calls.some(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "voice_migration_complete",
    );
    expect(found).toBe(true);
  });

  it("Case 9b: walks BOTH identity + role trees (per Phase 86 cosmetics-on-roles)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/alice.md`,
      "---\nname: alice\nvoice: Elena.wav\n---\nBody.\n",
    );
    writeSeedFile(
      `${FAKE_ROLE_ROOT}/friend/friend.md`,
      "---\nname: friend\nvoice: Aria.wav\n---\nRole body.\n",
    );

    await ensureVoiceValuesMigrated();

    const aliceAfter = fakeFs.files.get(`${FAKE_ID_ROOT}/alice/alice.md`);
    const friendAfter = fakeFs.files.get(`${FAKE_ROLE_ROOT}/friend/friend.md`);
    expect(aliceAfter!).not.toMatch(/^voice:/m);
    expect(friendAfter!).not.toMatch(/^voice:/m);

    const infoCall = infoSpy.mock.calls.find(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation === "voice_migration_complete",
    );
    expect(infoCall).toBeDefined();
    const meta = infoCall![1] as {
      identitiesScanned: number;
      identitiesChanged: number;
      rolesScanned: number;
      rolesChanged: number;
    };
    expect(meta.identitiesChanged).toBeGreaterThanOrEqual(1);
    expect(meta.rolesChanged).toBeGreaterThanOrEqual(1);
  });

  it("Case 9c: missing per-identity .md file is skipped (does not throw)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    // Directory `alice/` exists but no `alice/alice.md` file
    mkdir(`${FAKE_ID_ROOT}/alice`);

    await expect(ensureVoiceValuesMigrated()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("Case 9d: skips subdirs with no matching `<name>/<name>.md` (mismatched names ignored)", async () => {
    mkdir(FAKE_ID_ROOT);
    mkdir(FAKE_ROLE_ROOT);
    // A subdirectory with a differently-named file — skipped per contract.
    writeSeedFile(
      `${FAKE_ID_ROOT}/alice/other.md`,
      "---\nvoice: Elena.wav\n---\n",
    );

    await ensureVoiceValuesMigrated();

    // File must be untouched
    const other = fakeFs.files.get(`${FAKE_ID_ROOT}/alice/other.md`);
    expect(other).toContain("voice: Elena.wav");
  });
});
