// ─── identity-artifact-reader — deleteIdentityBounty (quick 260729-g5r) ───
//
// Coverage for the new local-branch delete writer that Task 1 of the
// Delete-button quick task adds. Byte-shape mirror of the archive writer's
// test file (identity-artifact-reader.archive-bounty.test.ts) with the
// simpler rm -rf semantics (no JSON patch, no timeline, no status flip).
//
// The three cases target the invariants Ashley locked in PLAN.md § Semantics:
//   1. OPEN delete: seed bounties/<slug>/bounty.json, call deleteIdentityBounty
//      (null, key, slug); assert bounties/<slug>/ no longer exists AND
//      bounties/ itself remains (only the slug dir was removed).
//   2. ARCHIVED delete: seed bounties/archive/<slug>/bounty.json, call
//      deleteIdentityBounty(null, key, slug); assert bounties/archive/<slug>/
//      no longer exists AND bounties/archive/ itself remains.
//   3. INVALID SLUG: call deleteIdentityBounty(null, key, "../etc/passwd")
//      MUST reject with /invalid bounty slug/ WITHOUT touching disk. A
//      pre-seeded innocent slug dir in the same tmpdir must still exist
//      after the reject.
//
// The remote branch's shape is guaranteed structurally by mirroring the
// archive writer's python3 script byte-for-byte modulo the swapped
// shutil.rmtree semantics — no ssh2 mock here.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { deleteIdentityBounty } from "./identity-artifact-reader.js";

let tmpRoot: string;
const KEY = "tina";
const SLUG = "test-bounty";

const SEED = {
  id: "u",
  title: "t",
  premise: "p",
  status: "in_progress" as const,
  priority: "medium" as const,
  keywords: [] as string[],
  requested_by: null as string | null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  timeline: ["seed"] as string[],
  todos: [] as { text: string; done: boolean }[],
};

async function seedOpenBounty(): Promise<string> {
  const bountyDir = path.join(tmpRoot, KEY, "bounties", SLUG);
  await fs.mkdir(bountyDir, { recursive: true });
  const filePath = path.join(bountyDir, "bounty.json");
  await fs.writeFile(filePath, JSON.stringify(SEED, null, 2), "utf-8");
  return bountyDir;
}

async function seedArchivedBounty(): Promise<string> {
  const bountyDir = path.join(tmpRoot, KEY, "bounties", "archive", SLUG);
  await fs.mkdir(bountyDir, { recursive: true });
  const filePath = path.join(bountyDir, "bounty.json");
  await fs.writeFile(filePath, JSON.stringify(SEED, null, 2), "utf-8");
  return bountyDir;
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

/** List all files anywhere under a directory tree (relative paths). Reused
 *  from the archive-bounty test as a defensive assertion helper. */
async function listTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(cur: string, prefix: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(cur);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(cur, e);
      const rel = prefix ? path.join(prefix, e) : e;
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        await walk(full, rel);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(dir, "");
  return out;
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "g5r-identity-root-"));
  process.env.IDENTITIES_HOST_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.IDENTITIES_HOST_DIR;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("deleteIdentityBounty (local branch)", () => {
  it("open bounty: rm -rf bounties/<slug>/ leaves bounties/ dir intact", async () => {
    const bountyDir = await seedOpenBounty();
    const bountiesDir = path.join(tmpRoot, KEY, "bounties");

    // Pre-flight: bountyDir + bounty.json exist.
    expect(await exists(bountyDir)).toBe(true);
    expect(await exists(path.join(bountyDir, "bounty.json"))).toBe(true);

    await deleteIdentityBounty(null, KEY, SLUG);

    // Slug dir is gone.
    expect(await exists(bountyDir)).toBe(false);

    // Parent bounties/ dir remains (only the slug dir was removed).
    expect(await exists(bountiesDir)).toBe(true);

    // No leftover files anywhere under bounties/.
    const tree = await listTree(bountiesDir);
    expect(tree).toEqual([]);
  });

  it("archived bounty: rm -rf bounties/archive/<slug>/ leaves bounties/archive/ dir intact", async () => {
    const bountyDir = await seedArchivedBounty();
    const bountiesDir = path.join(tmpRoot, KEY, "bounties");
    const archiveDir = path.join(bountiesDir, "archive");

    // Pre-flight: archive/<slug>/ + bounty.json exist.
    expect(await exists(bountyDir)).toBe(true);
    expect(await exists(path.join(bountyDir, "bounty.json"))).toBe(true);

    await deleteIdentityBounty(null, KEY, SLUG);

    // Archived slug dir is gone.
    expect(await exists(bountyDir)).toBe(false);

    // Parent archive/ dir remains (only the slug dir was removed).
    expect(await exists(archiveDir)).toBe(true);

    // Parent bounties/ dir also remains.
    expect(await exists(bountiesDir)).toBe(true);

    // No leftover files anywhere under bounties/.
    const tree = await listTree(bountiesDir);
    expect(tree).toEqual([]);
  });

  it("invalid slug: rejects with /invalid bounty slug/ WITHOUT touching disk", async () => {
    // Pre-seed an innocent slug alongside — it MUST survive the failed call.
    const innocentSlug = "innocent";
    const innocentDir = path.join(
      tmpRoot,
      KEY,
      "bounties",
      innocentSlug,
    );
    await fs.mkdir(innocentDir, { recursive: true });
    await fs.writeFile(
      path.join(innocentDir, "bounty.json"),
      JSON.stringify(SEED, null, 2),
      "utf-8",
    );

    await expect(
      deleteIdentityBounty(null, KEY, "../etc/passwd"),
    ).rejects.toThrow(/invalid bounty slug/);

    // Innocent bounty is still there byte-for-byte.
    expect(await exists(innocentDir)).toBe(true);
    expect(await exists(path.join(innocentDir, "bounty.json"))).toBe(true);
  });
});
