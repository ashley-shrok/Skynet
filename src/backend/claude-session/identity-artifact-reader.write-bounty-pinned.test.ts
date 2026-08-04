// ─── identity-artifact-reader — writeIdentityBountyPinned (quick 260728-sqk) ─
//
// Coverage for the new local-branch bounty pinned writer that Task 1 of the
// paired pin-toggle-ui + identity-modal-sort quick task adds. Byte-shape
// mirror of writeIdentityBountyStatus at src/backend/claude-session/
// identity-artifact-reader.ts §8. The remote branch's shape is guaranteed
// structurally by mirroring the status writer's python3 script byte-for-byte
// modulo the field name, so we don't spin up an ssh2 mock here; the slug
// validation on the remote branch IS exercised by a plain object surrogate
// (Test E), which trips the pre-python3 IDENTITY_SLUG_RE guard before any
// SSH call is attempted.
//
// Patch #172 context: `pinned` is an independent boolean field (fleet
// migration #168 by Nelly, 2026-07-28). Toggling pinned is orthogonal to
// the lifecycle `status` — the writer flips the boolean, bumps updated_at,
// and appends a timeline line. Folder is untouched (no rename, no archive
// dir created) same as the status writer — mirrors the resurrect-safe
// pattern.
//
// Test matrix:
//   A. Local round-trip pinned=true — seed pinned:false, flip to true,
//      confirm parsed.pinned + updated_at bump + timeline append.
//   B. Local round-trip pinned=false — seed pinned:true, flip to false,
//      confirm parsed.pinned + updated_at bump + timeline append.
//   C. Non-boolean pinned value rejected with "invalid pinned".
//   D. Folder untouched — flip pinned, verify sibling directory listing
//      under <root>/<KEY>/bounties/ is unchanged (no rename, no archive
//      dir created).
//   E. Invalid slug on remote branch — call with bountySlug: "../evil"
//      on the remote surrogate → rejects with /invalid bounty slug/.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { writeIdentityBountyPinned } from "./identity-artifact-reader.js";

// Phase 22 SRIC-01: bounties live at ~/.claude/roles/<role>/bounties/ post
// fleet migration; writeIdentityBountyPinned now does the two-step. Fixtures
// set up BOTH the identity file (with role: frontmatter) AND the role folder.
let identitiesRoot: string;
let rolesRoot: string;
const KEY = "tina";
const ROLE = "box-maintainer";
const SLUG = "test-bounty";

const SEED_BOUNTY = {
  id: "u",
  title: "t",
  premise: "p",
  status: "in_progress" as const,
  priority: "medium" as const,
  pinned: false,
  keywords: [] as string[],
  requested_by: null as string | null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  timeline: ["seed"] as string[],
  todos: [] as { text: string; done: boolean }[],
};

async function seedBounty(overrides: Partial<typeof SEED_BOUNTY> = {}): Promise<string> {
  const bountyDir = path.join(rolesRoot, ROLE, "bounties", SLUG);
  await fs.mkdir(bountyDir, { recursive: true });
  const filePath = path.join(bountyDir, "bounty.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({ ...SEED_BOUNTY, ...overrides }, null, 2),
    "utf-8",
  );
  return filePath;
}

beforeEach(async () => {
  identitiesRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqk-identities-root-"),
  );
  rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sqk-roles-root-"));
  process.env.IDENTITIES_HOST_DIR = identitiesRoot;
  process.env.ROLES_HOST_DIR = rolesRoot;

  // Phase 22 SRIC-01: identity file with role: frontmatter is required —
  // resolveRoleForIdentity throws (no fallback) when frontmatter is missing.
  const identityDir = path.join(identitiesRoot, KEY);
  await fs.mkdir(identityDir, { recursive: true });
  await fs.writeFile(
    path.join(identityDir, `${KEY}.md`),
    `---\nrole: ${ROLE}\n---\n\n# ${KEY}\n`,
    "utf-8",
  );
});

afterEach(async () => {
  delete process.env.IDENTITIES_HOST_DIR;
  delete process.env.ROLES_HOST_DIR;
  await fs.rm(identitiesRoot, { recursive: true, force: true });
  await fs.rm(rolesRoot, { recursive: true, force: true });
});

describe("writeIdentityBountyPinned (local branch)", () => {
  it("round-trips pinned=true + bumps updated_at + appends timeline line", async () => {
    const filePath = await seedBounty({ pinned: false });
    await writeIdentityBountyPinned(null, KEY, SLUG, true);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      pinned: boolean;
      updated_at: string;
      timeline: string[];
    };

    expect(parsed.pinned).toBe(true);

    // updated_at must be freshened — not the seed value, and parseable as a date.
    expect(parsed.updated_at).not.toBe(SEED_BOUNTY.updated_at);
    expect(new Date(parsed.updated_at).getTime()).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(parsed.updated_at).getTime())).toBe(false);

    // Timeline: seed entry preserved + one new line appended.
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]).toBe("seed");
    expect(parsed.timeline[1]).toMatch(/pinned set to true via identity modal$/);
  });

  it("round-trips pinned=false + bumps updated_at + appends timeline line", async () => {
    const filePath = await seedBounty({ pinned: true });
    await writeIdentityBountyPinned(null, KEY, SLUG, false);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      pinned: boolean;
      updated_at: string;
      timeline: string[];
    };

    expect(parsed.pinned).toBe(false);
    expect(parsed.updated_at).not.toBe(SEED_BOUNTY.updated_at);
    expect(Number.isNaN(new Date(parsed.updated_at).getTime())).toBe(false);
    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline[0]).toBe("seed");
    expect(parsed.timeline[1]).toMatch(/pinned set to false via identity modal$/);
  });

  it("rejects a non-boolean pinned value with 'invalid pinned'", async () => {
    await seedBounty();
    await expect(
      writeIdentityBountyPinned(
        null,
        KEY,
        SLUG,
        "true" as unknown as boolean,
      ),
    ).rejects.toThrow(/invalid pinned/);
  });

  it("does not create or rename any sibling folder (folder untouched)", async () => {
    await seedBounty({ pinned: false });
    const bountiesDir = path.join(rolesRoot, ROLE, "bounties");
    const before = (await fs.readdir(bountiesDir)).sort();

    await writeIdentityBountyPinned(null, KEY, SLUG, true);

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

  it("rejects invalid slug on the remote branch before any SSH call", async () => {
    // Any truthy non-null object satisfies the "conn !== null" branch
    // predicate. The IDENTITY_SLUG_RE check runs BEFORE any conn method is
    // invoked, so a plain object surrogate is sufficient to exercise the
    // pre-remote-branch validation without spinning up an ssh2 mock.
    const fakeConn = {} as unknown as Parameters<typeof writeIdentityBountyPinned>[0];
    await expect(
      writeIdentityBountyPinned(fakeConn, KEY, "../evil", true),
    ).rejects.toThrow(/invalid bounty slug/);
  });
});
