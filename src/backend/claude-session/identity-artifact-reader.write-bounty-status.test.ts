// ─── identity-artifact-reader — writeIdentityBountyStatus (quick 260727-v0b) ─
//
// Coverage for the new local-branch bounty status writer that Task 1 of the
// inline status editor quick task adds. Byte-shape mirror of the priority
// writer at src/backend/claude-session/identity-artifact-reader.ts; the
// remote branch's shape is guaranteed structurally by mirroring the priority
// writer's python3 script byte-for-byte modulo the field name, so we don't
// spin up an ssh2 mock here.
//
// The three cases target the invariants Ashley called out explicitly:
//   1. Round-trip: status is persisted, updated_at gets a fresh ISO Z
//      stamp, and the timeline gains a "status set to <new> via identity
//      modal" line.
//   2. Guard: invalid status values reject with "invalid status" — the
//      handler's belt-and-braces on top of the WS-layer validation.
//   3. Folder-untouched: writing done/dropped does NOT create or rename
//      any sibling directory (bounties/archive is out of scope for this
//      quick — Ashley's separate concern). This is the load-bearing
//      guarantee for the resurrect flow.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import {
  writeIdentityBountyStatus,
  type BountyStatus,
} from "./identity-artifact-reader.js";

let tmpRoot: string;
const KEY = "tina";
const SLUG = "test-bounty";

const SEED_BOUNTY = {
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

async function seedBounty(): Promise<string> {
  const bountyDir = path.join(tmpRoot, KEY, "bounties", SLUG);
  await fs.mkdir(bountyDir, { recursive: true });
  const filePath = path.join(bountyDir, "bounty.json");
  await fs.writeFile(filePath, JSON.stringify(SEED_BOUNTY, null, 2), "utf-8");
  return filePath;
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "v0b-identity-root-"));
  process.env.IDENTITIES_HOST_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.IDENTITIES_HOST_DIR;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("writeIdentityBountyStatus (local branch)", () => {
  it("round-trips status + bumps updated_at + appends timeline line", async () => {
    const filePath = await seedBounty();
    await writeIdentityBountyStatus(null, KEY, SLUG, "pinned");

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      status: string;
      updated_at: string;
      timeline: string[];
    };

    expect(parsed.status).toBe("pinned");

    // updated_at must be freshened — not the seed value, and parseable as a date.
    expect(parsed.updated_at).not.toBe(SEED_BOUNTY.updated_at);
    expect(new Date(parsed.updated_at).getTime()).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(parsed.updated_at).getTime())).toBe(false);

    // Timeline: seed entry preserved + one new line appended.
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]).toBe("seed");
    expect(parsed.timeline[1]).toMatch(/status set to pinned via identity modal$/);
  });

  it("rejects an unknown status with 'invalid status'", async () => {
    await seedBounty();
    await expect(
      writeIdentityBountyStatus(
        null,
        KEY,
        SLUG,
        "bogus" as unknown as BountyStatus,
      ),
    ).rejects.toThrow(/invalid status/);
  });

  it("does not create or rename any sibling folder (folder untouched even for done)", async () => {
    await seedBounty();
    const bountiesDir = path.join(tmpRoot, KEY, "bounties");
    const before = (await fs.readdir(bountiesDir)).sort();

    await writeIdentityBountyStatus(null, KEY, SLUG, "done");

    const after = (await fs.readdir(bountiesDir)).sort();
    // No new sibling dir (e.g. "archive/"), no rename of "test-bounty".
    expect(after).toEqual(before);
    // And the bounty.json is still where we put it.
    const stillThere = await fs
      .stat(path.join(bountiesDir, SLUG, "bounty.json"))
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });
});
