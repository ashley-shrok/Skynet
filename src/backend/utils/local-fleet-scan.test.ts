/**
 * local-fleet-scan.test.ts — Unit tests for scanLocalFleetFolder +
 * readLocalFleetCompanionRef.
 *
 * Uses a real temp directory (via `os.tmpdir()` + `fs.mkdtemp`) rather than a
 * fs-module mock. Rationale:
 *   - The module's whole point is atomic-mv + read + unlink cycle in the real
 *     POSIX filesystem. Mocking fs would defeat the point of testing atomicity
 *     against real ENOENT-on-second-rename semantics.
 *   - `IDENTITIES_HOST_DIR` env var is set per-test to point at the tmp dir's
 *     `identities` subfolder, so `getLocalIdentitiesRoot()` resolves to it and
 *     `path.dirname(...)` gives the tmp dir as the fleet root.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";

vi.mock("./logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

// Note: local-fleet-scan.ts imports getLocalIdentitiesRoot from
// identity-artifact-reader.ts. That module has side-effect imports (ssh2,
// js-yaml). Rather than mock the transitive graph, we just set
// IDENTITIES_HOST_DIR and let the real getLocalIdentitiesRoot resolve. The
// LOCAL_HOST_IDS parse-at-load logic in that module is a no-op for scans.

// A fresh tmpdir per test; env var swapped so getLocalIdentitiesRoot points here.
let tmpRoot: string;
let fleetRoot: string;
let originalEnv: string | undefined;

async function importFresh() {
  // Re-import module fresh so any module-level state uses the current env.
  // Not strictly required for local-fleet-scan (all env reads are per-call
  // through getLocalIdentitiesRoot), but keeps the pattern robust.
  vi.resetModules();
  return await import("./local-fleet-scan.js");
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-fleet-scan-test-"));
  // getLocalIdentitiesRoot() will return `${tmpRoot}/identities`.
  // path.dirname(...) → tmpRoot. So the fleet root is tmpRoot.
  fleetRoot = tmpRoot;
  originalEnv = process.env.IDENTITIES_HOST_DIR;
  process.env.IDENTITIES_HOST_DIR = path.join(tmpRoot, "identities");
});

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.IDENTITIES_HOST_DIR;
  } else {
    process.env.IDENTITIES_HOST_DIR = originalEnv;
  }
  // Best-effort cleanup.
  try {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// scanLocalFleetFolder — folder/basename handling
// ---------------------------------------------------------------------------

describe("scanLocalFleetFolder — folder handling", () => {
  it("returns [] when the folder does not exist (ENOENT is a non-error)", async () => {
    const { scanLocalFleetFolder } = await importFresh();
    const results = await scanLocalFleetFolder("spawn-requests");
    expect(results).toEqual([]);
  });

  it("returns [] when the folder exists but is empty", async () => {
    await fs.mkdir(path.join(fleetRoot, "spawn-requests"), { recursive: true });
    const { scanLocalFleetFolder } = await importFresh();
    const results = await scanLocalFleetFolder("spawn-requests");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanLocalFleetFolder — basename filtering
// ---------------------------------------------------------------------------

describe("scanLocalFleetFolder — basename filtering", () => {
  it("claims only .json files whose basename is exactly 36 chars", async () => {
    const dir = path.join(fleetRoot, "spawn-requests");
    await fs.mkdir(dir, { recursive: true });
    // 36-char UUID basename → claimed.
    const goodUuid = "aaaaaaaa-1111-2222-3333-444444444444";
    await fs.writeFile(path.join(dir, `${goodUuid}.json`), '{"role":"r","task":null,"requested_at":"2026-09-18T00:00:00Z"}');
    // Not .json → ignored.
    await fs.writeFile(path.join(dir, `${goodUuid}.tmp`), "should not be claimed");
    // .success.json / .failure.json → basename is 44 / 44 chars → filtered.
    await fs.writeFile(path.join(dir, `${goodUuid}.success.json`), "{}");
    await fs.writeFile(path.join(dir, `${goodUuid}.failure.json`), "{}");
    // Ref companion — basename is 44 chars (uuid + .ref) → filtered.
    await fs.writeFile(path.join(dir, `${goodUuid}.ref.png`), "png bytes");
    // Short 5-char basename → filtered.
    await fs.writeFile(path.join(dir, `short.json`), "{}");

    const { scanLocalFleetFolder } = await importFresh();
    const results = await scanLocalFleetFolder("spawn-requests");
    expect(results.length).toBe(1);
    expect(results[0].filename).toBe(`${goodUuid}.json`);
    expect(results[0].contents).toContain('"role":"r"');
  });

  it("ignores files whose 36-char basename is not a UUID shape (parser downstream will reject)", async () => {
    // scanLocalFleetFolder's job is byte-for-byte with the shell — it only
    // checks BYTE LENGTH (${#base} -eq 36), not the strict UUID pattern.
    // Downstream parseImageGenRequestBatch / parseSpawnRequestBatch runs
    // the UUID_RE gate. So 36 hyphens IS claimed here but skipped by the
    // parser. This test locks in the shell-parity contract.
    const dir = path.join(fleetRoot, "spawn-requests");
    await fs.mkdir(dir, { recursive: true });
    const notUuid = "------------------------------------"; // 36 hyphens
    await fs.writeFile(path.join(dir, `${notUuid}.json`), "{}");
    const { scanLocalFleetFolder } = await importFresh();
    const results = await scanLocalFleetFolder("spawn-requests");
    expect(results.length).toBe(1);
    expect(results[0].filename).toBe(`${notUuid}.json`);
  });
});

// ---------------------------------------------------------------------------
// scanLocalFleetFolder — atomic-claim contract
// ---------------------------------------------------------------------------

describe("scanLocalFleetFolder — atomic-claim contract", () => {
  it("deletes the tmp file after read; original filename does NOT re-appear on second scan", async () => {
    const dir = path.join(fleetRoot, "image-gen-requests");
    await fs.mkdir(dir, { recursive: true });
    const uuid = "aaaaaaaa-1111-2222-3333-444444444444";
    await fs.writeFile(path.join(dir, `${uuid}.json`), '{"prompt":"a","requested_at":"2026-09-18T00:00:00Z"}');

    const { scanLocalFleetFolder } = await importFresh();
    const first = await scanLocalFleetFolder("image-gen-requests");
    expect(first.length).toBe(1);
    // Second scan should see no files — first scan claimed + deleted.
    const second = await scanLocalFleetFolder("image-gen-requests");
    expect(second).toEqual([]);
    // And no tmp files leftover.
    const entries = await fs.readdir(dir);
    expect(entries).toEqual([]);
  });

  it("concurrent scans of the same folder each claim disjoint files (no double-claim)", async () => {
    // Node-level "concurrency" doesn't test kernel-level atomicity, but it DOES
    // prove the scan logic itself doesn't double-yield a file — the fs.rename
    // that loses returns ENOENT and the loser skips. Two invocations racing
    // to claim 10 files should yield 10 total across both, with no overlap.
    const dir = path.join(fleetRoot, "spawn-requests");
    await fs.mkdir(dir, { recursive: true });
    const uuids = Array.from({ length: 10 }, (_, i) =>
      `${String(i).padStart(8, "0")}-1111-2222-3333-444444444444`,
    );
    for (const u of uuids) {
      await fs.writeFile(path.join(dir, `${u}.json`), `{"n":${uuids.indexOf(u)}}`);
    }

    const { scanLocalFleetFolder } = await importFresh();
    const [a, b] = await Promise.all([
      scanLocalFleetFolder("spawn-requests"),
      scanLocalFleetFolder("spawn-requests"),
    ]);
    const allFilenames = [...a.map((r) => r.filename), ...b.map((r) => r.filename)];
    // Union covers all 10 originals.
    expect(new Set(allFilenames).size).toBe(10);
    // No duplicates — each file claimed exactly once.
    expect(allFilenames.length).toBe(10);
    // And no tmp files leftover after both scans complete.
    const entries = await fs.readdir(dir);
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readLocalFleetCompanionRef
// ---------------------------------------------------------------------------

describe("readLocalFleetCompanionRef", () => {
  const uuid = "aaaaaaaa-1111-2222-3333-444444444444";
  const refFilename = `${uuid}.ref.png`;
  const MAX = 20 * 1024 * 1024;

  it("happy path: reads the companion file's bytes when uuid matches and size <= max", async () => {
    const dir = path.join(fleetRoot, "image-gen-requests");
    await fs.mkdir(dir, { recursive: true });
    const bytes = Buffer.from("fake-png-data");
    await fs.writeFile(path.join(dir, refFilename), bytes);
    const { readLocalFleetCompanionRef } = await importFresh();
    const result = await readLocalFleetCompanionRef("image-gen-requests", refFilename, MAX, uuid);
    expect(result).not.toBeNull();
    expect(result!.equals(bytes)).toBe(true);
  });

  it("returns null when the ref file is missing", async () => {
    const dir = path.join(fleetRoot, "image-gen-requests");
    await fs.mkdir(dir, { recursive: true });
    const { readLocalFleetCompanionRef } = await importFresh();
    const result = await readLocalFleetCompanionRef("image-gen-requests", refFilename, MAX, uuid);
    expect(result).toBeNull();
  });

  it("returns null when the ref file exceeds maxBytes", async () => {
    const dir = path.join(fleetRoot, "image-gen-requests");
    await fs.mkdir(dir, { recursive: true });
    // Small cap; write a 100-byte file.
    const bytes = Buffer.alloc(100, 0x42);
    await fs.writeFile(path.join(dir, refFilename), bytes);
    const { readLocalFleetCompanionRef } = await importFresh();
    const result = await readLocalFleetCompanionRef("image-gen-requests", refFilename, 50, uuid);
    expect(result).toBeNull();
  });

  it("returns null when the ref filename uuid does not match the request uuid (cross-request guard)", async () => {
    const dir = path.join(fleetRoot, "image-gen-requests");
    await fs.mkdir(dir, { recursive: true });
    // Write the ref under the FOREIGN uuid's name so the file exists on disk.
    const foreignUuid = "bbbbbbbb-9999-8888-7777-666666666666";
    const foreignRefFilename = `${foreignUuid}.ref.png`;
    await fs.writeFile(path.join(dir, foreignRefFilename), Buffer.from("stolen bytes"));
    const { readLocalFleetCompanionRef } = await importFresh();
    // requestUuid is `uuid` (ours), refFilename is `foreignRefFilename` (theirs)
    // → guard rejects BEFORE reading, returns null.
    const result = await readLocalFleetCompanionRef("image-gen-requests", foreignRefFilename, MAX, uuid);
    expect(result).toBeNull();
  });
});
