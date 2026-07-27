// ─── identity-artifact-reader — archiveIdentityBounty (quick 260727-wd0) ───
//
// Coverage for the new local-branch archive writer that Task 1 of the
// Archive-button quick task adds. Byte-shape mirror of the status writer's
// test file (identity-artifact-reader.write-bounty-status.test.ts) with the
// added mv + terminal-preservation semantics.
//
// The three cases target the invariants Ashley locked in PLAN.md § Semantics:
//   1. LIVE-status flip + move: an in_progress bounty flips to done, gets a
//      freshened updated_at, gains a "flipped from in_progress to done"
//      timeline entry, and the folder is moved from bounties/<slug>/ to
//      bounties/archive/<slug>/. bounties/archive/ is CREATED on demand
//      (mkdir -p) — this covers Nelly's 4 fresh-mkdir-case identities.
//   2. TERMINAL-status preserve + move: a dropped bounty stays dropped (NOT
//      clobbered to done), gets a "status dropped preserved" timeline entry,
//      folder moved.
//   3. Unparseable bounty.json fails loud + leaves state alone: the writer
//      throws a clear `please repair before archiving` error BEFORE any
//      mutation is attempted. The bounty.json remains byte-for-byte
//      identical, bounties/archive/ is NOT created, no .tmp files leak.
//
// The remote branch's shape is guaranteed structurally by mirroring the
// v0b status writer's python3 script byte-for-byte modulo the added
// mkdir+rename tail — no ssh2 mock here.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { archiveIdentityBounty } from "./identity-artifact-reader.js";

let tmpRoot: string;
const KEY = "tina";
const SLUG = "test-bounty";

const SEED_LIVE = {
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

const SEED_TERMINAL = {
  ...SEED_LIVE,
  status: "dropped" as const,
};

async function seedBounty(seed: typeof SEED_LIVE): Promise<string> {
  const bountyDir = path.join(tmpRoot, KEY, "bounties", SLUG);
  await fs.mkdir(bountyDir, { recursive: true });
  const filePath = path.join(bountyDir, "bounty.json");
  await fs.writeFile(filePath, JSON.stringify(seed, null, 2), "utf-8");
  return bountyDir;
}

/** List all files anywhere under a directory tree (relative paths). Used to
 *  assert no leftover .tmp files anywhere under bounties/. */
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wd0-identity-root-"));
  process.env.IDENTITIES_HOST_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.IDENTITIES_HOST_DIR;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("archiveIdentityBounty (local branch)", () => {
  it("live-status: flips to done + bumps updated_at + appends 'flipped from' timeline + moves folder + creates archive/ on demand", async () => {
    const bountyDir = await seedBounty(SEED_LIVE);
    const bountiesDir = path.join(tmpRoot, KEY, "bounties");
    const archiveDir = path.join(bountiesDir, "archive");
    const archiveDest = path.join(archiveDir, SLUG);

    // Pre-flight: archive/ does NOT exist (fresh-mkdir case per Nelly's audit).
    const archiveExistedBefore = await fs
      .stat(archiveDir)
      .then(() => true)
      .catch(() => false);
    expect(archiveExistedBefore).toBe(false);

    await archiveIdentityBounty(null, KEY, SLUG);

    // Source dir no longer exists (mv succeeded).
    const sourceStillThere = await fs
      .stat(bountyDir)
      .then(() => true)
      .catch(() => false);
    expect(sourceStillThere).toBe(false);

    // Dest exists at bounties/archive/<SLUG>/bounty.json.
    const movedFilePath = path.join(archiveDest, "bounty.json");
    const movedRaw = await fs.readFile(movedFilePath, "utf-8");
    const parsed = JSON.parse(movedRaw) as {
      status: string;
      updated_at: string;
      timeline: string[];
    };

    expect(parsed.status).toBe("done");

    // updated_at must be freshened — not the seed value, and parseable as a date.
    expect(parsed.updated_at).not.toBe(SEED_LIVE.updated_at);
    expect(new Date(parsed.updated_at).getTime()).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(parsed.updated_at).getTime())).toBe(false);

    // Timeline: seed entry preserved + one new "flipped from ... to done" line.
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]).toBe("seed");
    expect(parsed.timeline[1]).toMatch(
      /archived via identity modal \(status flipped from in_progress to done\)$/,
    );

    // No leftover .tmp files anywhere under bounties/.
    const tree = await listTree(bountiesDir);
    const tmpFiles = tree.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });

  it("terminal-status (dropped): PRESERVES status (not clobbered to done) + appends 'preserved' timeline + moves folder", async () => {
    await seedBounty(SEED_TERMINAL);
    const bountiesDir = path.join(tmpRoot, KEY, "bounties");
    const archiveDest = path.join(bountiesDir, "archive", SLUG);

    await archiveIdentityBounty(null, KEY, SLUG);

    const movedFilePath = path.join(archiveDest, "bounty.json");
    const movedRaw = await fs.readFile(movedFilePath, "utf-8");
    const parsed = JSON.parse(movedRaw) as {
      status: string;
      updated_at: string;
      timeline: string[];
    };

    // Status is PRESERVED — must NOT be clobbered to "done".
    expect(parsed.status).toBe("dropped");

    // updated_at still freshened even for terminal-status archive.
    expect(parsed.updated_at).not.toBe(SEED_TERMINAL.updated_at);
    expect(Number.isNaN(new Date(parsed.updated_at).getTime())).toBe(false);

    // Timeline tail is the "preserved" variant, not the "flipped from" variant.
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]).toBe("seed");
    expect(parsed.timeline[1]).toMatch(
      /archived via identity modal \(status dropped preserved\)$/,
    );
  });

  it("unparseable bounty.json: fails loud with 'please repair before archiving' + leaves disk state byte-for-byte identical", async () => {
    const bountyDir = path.join(tmpRoot, KEY, "bounties", SLUG);
    await fs.mkdir(bountyDir, { recursive: true });
    const filePath = path.join(bountyDir, "bounty.json");
    const garbage = "{{{not json";
    await fs.writeFile(filePath, garbage, "utf-8");

    const bountiesDir = path.join(tmpRoot, KEY, "bounties");
    const archiveDir = path.join(bountiesDir, "archive");
    // Pre-flight: archive/ does NOT exist.
    const archiveExistedBefore = await fs
      .stat(archiveDir)
      .then(() => true)
      .catch(() => false);
    expect(archiveExistedBefore).toBe(false);

    await expect(
      archiveIdentityBounty(null, KEY, SLUG),
    ).rejects.toThrow(/please repair before archiving/);

    // Bounty.json still exists at the ORIGINAL path with the SAME garbage bytes.
    const afterRaw = await fs.readFile(filePath, "utf-8");
    expect(afterRaw).toBe(garbage);

    // archive/ was NEVER created — the failure is pre-mkdir per the writer's
    // sequencing (parse fails before any mutation).
    const archiveExistedAfter = await fs
      .stat(archiveDir)
      .then(() => true)
      .catch(() => false);
    expect(archiveExistedAfter).toBe(false);

    // No .tmp files leaked anywhere under bounties/.
    const tree = await listTree(bountiesDir);
    const tmpFiles = tree.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });
});
