// ─── identity-artifact-reader — readIdentityBountyCounts (quick 260727-tb1 / Phase 26) ─
//
// Phase 26 widening: readIdentityBountyCounts returns {pinnedCount, needsDeskCount}
// from a SINGLE fs walk — no second readdir pass. Tests A-I below assert the
// complete new behaviour including orthogonality (a bounty can be pinned AND
// needs_desk simultaneously) and the single-walk invariant (fs.readdir is called
// exactly once for the bounties dir per function call).
//
// Local branch is deterministic and fs-only, so we drive it with a real temp
// directory tree instead of a stub.
//
// Phase 22 SRIC-01: bounties live at ~/.claude/roles/<role>/bounties/ (rooted
// at ROLES_HOST_DIR) — the counter now does the two-step (identity file →
// role: frontmatter → role folder) so fixtures set up BOTH the identity file
// (with role: frontmatter) AND the role folder tree. Layout mirrors the fleet
// on-disk shape post-migration.
//
// Patch #168 schema update: `pinned` is now an independent boolean field
// orthogonal to the lifecycle `status` field. Fixtures use `pinned:boolean`
// instead of `status:"pinned"`. The counter checks `parsed.pinned === true`.
//
// Phase 26: `needs_desk` is an independent boolean field (added 2026-08-06,
// same optional-boolean-absent-means-false shape as `pinned`).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { readIdentityBountyCounts } from "./identity-artifact-reader.js";

let identitiesRoot: string;
let rolesRoot: string;
const KEY = "tina";
const ROLE = "box-maintainer";

async function writeBounty(
  slug: string,
  opts: {
    status?: string;
    pinned?: boolean;
    needs_desk?: boolean;
    archived?: boolean;
    malformed?: boolean;
  } = {},
): Promise<void> {
  const base = opts.archived
    ? path.join(rolesRoot, ROLE, "bounties", "archive", slug)
    : path.join(rolesRoot, ROLE, "bounties", slug);
  await fs.mkdir(base, { recursive: true });
  const contents = opts.malformed
    ? "{ not valid json"
    : JSON.stringify({
        id: slug,
        status: opts.status ?? "in_progress",
        pinned: opts.pinned ?? false,
        ...(opts.needs_desk !== undefined ? { needs_desk: opts.needs_desk } : {}),
      });
  await fs.writeFile(path.join(base, "bounty.json"), contents, "utf-8");
}

beforeEach(async () => {
  identitiesRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "tb1-identities-root-"),
  );
  rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tb1-roles-root-"));
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
  vi.restoreAllMocks();
});

describe("readIdentityBountyCounts — local branch", () => {
  // Test B: was "returns 0 when the bounties dir does not exist"
  it("returns {pinnedCount:0, needsDeskCount:0} when the bounties dir does not exist", async () => {
    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 0, needsDeskCount: 0 });
  });

  // Test A: was "counts bounties with pinned:true, skipping archived + non-pinned + malformed"
  it("counts bounties with pinned:true and needs_desk:true independently, skipping archived + malformed", async () => {
    // bounty-a: pinned:true, needs_desk:false  → pinnedCount+1
    await writeBounty("bounty-a", { pinned: true, needs_desk: false });
    // bounty-b: pinned:true, needs_desk:true   → pinnedCount+1, needsDeskCount+1
    await writeBounty("bounty-b", { pinned: true, needs_desk: true });
    // bounty-c: pinned:false, needs_desk:true  → needsDeskCount+1
    await writeBounty("bounty-c", { pinned: false, needs_desk: true });
    // bounty-d: pinned:false, needs_desk:false → neither
    await writeBounty("bounty-d", { pinned: false, needs_desk: false });
    // bounty-e: malformed JSON — parse error swallowed, counted in neither
    await writeBounty("bounty-e", { malformed: true });
    // archived entries skipped regardless of flags
    await writeBounty("archived-1", { pinned: true, needs_desk: true, archived: true });
    await writeBounty("archived-2", { pinned: true, archived: true });

    const counts = await readIdentityBountyCounts(null, KEY);
    // pinned: bounty-a + bounty-b = 2; needs_desk: bounty-b + bounty-c = 2
    expect(counts).toEqual({ pinnedCount: 2, needsDeskCount: 2 });
  });

  // Test C: was "returns 0 when no bounties have pinned:true"
  it("returns {pinnedCount:0, needsDeskCount:0} when bounty has pinned:false and needs_desk:false", async () => {
    await writeBounty("only-one", { status: "in_progress", pinned: false, needs_desk: false });
    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 0, needsDeskCount: 0 });
  });

  // Test D: was "returns 0 when pinned field is absent"
  it("returns {pinnedCount:0, needsDeskCount:0} when neither pinned nor needs_desk field is present", async () => {
    // Bounty JSON with no `pinned` or `needs_desk` keys — should count as 0 each.
    const base = path.join(rolesRoot, ROLE, "bounties", "no-pinned-field");
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(
      path.join(base, "bounty.json"),
      JSON.stringify({ id: "no-pinned-field", status: "in_progress" }),
      "utf-8",
    );
    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 0, needsDeskCount: 0 });
  });

  // Test E: was "swallows malformed"
  it("swallows a single malformed bounty.json without failing the whole call", async () => {
    await writeBounty("good", { status: "in_progress", pinned: true });
    await writeBounty("bad", { malformed: true });
    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 1, needsDeskCount: 0 });
  });

  // Test F: was orthogonality with status:"done"
  it("orthogonality: lifecycle status is irrelevant — done+pinned and in_progress+needs_desk are counted independently", async () => {
    // done + pinned:true + needs_desk:false → pinnedCount+1
    await writeBounty("done-but-pinned", { status: "done", pinned: true, needs_desk: false });
    // in_progress + pinned:false + needs_desk:true → needsDeskCount+1
    await writeBounty("in-progress-needs-desk", { status: "in_progress", pinned: false, needs_desk: true });

    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 1, needsDeskCount: 1 });
  });

  // Test G NEW: orthogonality — a bounty with pinned:true AND needs_desk:true counts in BOTH totals on ONE fs pass
  it("orthogonality — a bounty with pinned:true AND needs_desk:true counts in BOTH totals on one fs pass", async () => {
    await writeBounty("both-flags", { pinned: true, needs_desk: true });
    const counts = await readIdentityBountyCounts(null, KEY);
    expect(counts).toEqual({ pinnedCount: 1, needsDeskCount: 1 });
  });

  // Test H: was "rejects an invalid identity key"
  it("rejects an invalid identity key (defense against path traversal)", async () => {
    await expect(
      readIdentityBountyCounts(null, "../etc"),
    ).rejects.toThrow();
  });

  // Test I NEW: single-walk invariant — fs.readdir is called exactly once for the bounties dir
  it("single-walk invariant on LOCAL branch — fs.readdir is called exactly once for the bounties dir", async () => {
    // Spy on fs.readdir BEFORE writing bounties to capture all calls.
    const readdirSpy = vi.spyOn(fs, "readdir");

    await writeBounty("alpha", { pinned: true, needs_desk: false });
    await writeBounty("beta", { pinned: false, needs_desk: true });

    // Reset spy after setup writes (they also call readdir indirectly via mkdir)
    // — the spy was just collecting calls during writeBounty setup; clear now.
    readdirSpy.mockClear();

    await readIdentityBountyCounts(null, KEY);

    // Filter to only the bounties-dir readdir calls (excludes any readdir
    // resolveRoleForIdentity makes for the identity file directory).
    const bounciesCalls = readdirSpy.mock.calls.filter((args) =>
      String(args[0]).includes("/bounties"),
    );
    expect(bounciesCalls).toHaveLength(1);
  });
});
