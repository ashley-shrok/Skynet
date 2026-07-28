// ─── identity-artifact-reader — readIdentityPinnedBountyCount (quick 260727-tb1) ─
//
// RED-gate coverage for the new local-branch pinned bounty counter that Task 1
// of the per-row bounty badge quick task adds. The remote branch is exercised
// end-to-end through the WS handler's per-target error-isolation test in
// claude-session-server.count-bounties.test.ts — mocking ssh2 here would just
// duplicate that surface without adding signal.
//
// Local branch is deterministic and fs-only, so we drive it with a real temp
// directory tree instead of a stub. The tree matches what the tina bind-mount
// looks like: identityHostDir/<key>/bounties/<slug>/bounty.json, with an
// archive/ directory that must be skipped.
//
// Patch #168 schema update: `pinned` is now an independent boolean field
// orthogonal to the lifecycle `status` field. Fixtures use `pinned:boolean`
// instead of `status:"pinned"`. The counter checks `parsed.pinned === true`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { readIdentityPinnedBountyCount } from "./identity-artifact-reader.js";

let tmpRoot: string;
const KEY = "tina";

async function writeBounty(
  slug: string,
  opts: {
    status?: string;
    pinned?: boolean;
    archived?: boolean;
    malformed?: boolean;
  } = {},
): Promise<void> {
  const base = opts.archived
    ? path.join(tmpRoot, KEY, "bounties", "archive", slug)
    : path.join(tmpRoot, KEY, "bounties", slug);
  await fs.mkdir(base, { recursive: true });
  const contents = opts.malformed
    ? "{ not valid json"
    : JSON.stringify({
        id: slug,
        status: opts.status ?? "in_progress",
        pinned: opts.pinned ?? false,
      });
  await fs.writeFile(path.join(base, "bounty.json"), contents, "utf-8");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tb1-identity-root-"));
  process.env.IDENTITIES_HOST_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.IDENTITIES_HOST_DIR;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("readIdentityPinnedBountyCount — local branch", () => {
  it("returns 0 when the bounties dir does not exist", async () => {
    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(0);
  });

  it("counts bounties with pinned:true, skipping archived + non-pinned + malformed", async () => {
    // pinned:true with various lifecycle statuses — all should count
    await writeBounty("bounty-a", { status: "in_progress", pinned: true });
    await writeBounty("bounty-b", { status: "in_progress", pinned: true });
    // not pinned — must NOT be counted
    await writeBounty("bounty-c", { status: "in_progress", pinned: false });
    await writeBounty("bounty-d", { status: "done", pinned: false });
    // malformed JSON — parse error swallowed, counted as "not pinned"
    await writeBounty("bounty-e", { malformed: true });
    // archived entries must be ignored regardless of pinned state
    await writeBounty("archived-1", { status: "in_progress", pinned: true, archived: true });
    await writeBounty("archived-2", { status: "in_progress", pinned: true, archived: true });

    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(2);
  });

  it("orthogonality: done-status bounty with pinned:true IS counted (pinned is independent of lifecycle)", async () => {
    // pinned is orthogonal to status — a done bounty can still be pinned
    await writeBounty("done-but-pinned", { status: "done", pinned: true });
    await writeBounty("in-progress-not-pinned", { status: "in_progress", pinned: false });

    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(1);
  });

  it("returns 0 when no bounties have pinned:true", async () => {
    await writeBounty("only-one", { status: "in_progress", pinned: false });
    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(0);
  });

  it("returns 0 when pinned field is absent (treated as not pinned)", async () => {
    // Bounty JSON with no `pinned` key — should NOT be counted
    const base = path.join(tmpRoot, KEY, "bounties", "no-pinned-field");
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(
      path.join(base, "bounty.json"),
      JSON.stringify({ id: "no-pinned-field", status: "in_progress" }),
      "utf-8",
    );
    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(0);
  });

  it("swallows a single malformed bounty.json without failing the whole call", async () => {
    await writeBounty("good", { status: "in_progress", pinned: true });
    await writeBounty("bad", { malformed: true });
    const n = await readIdentityPinnedBountyCount(null, KEY);
    expect(n).toBe(1);
  });

  it("rejects an invalid identity key (defense against path traversal)", async () => {
    await expect(
      readIdentityPinnedBountyCount(null, "../etc"),
    ).rejects.toThrow();
  });
});
