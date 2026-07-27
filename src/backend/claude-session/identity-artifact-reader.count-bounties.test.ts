// ─── identity-artifact-reader — readIdentityOnDeckBountyCount (quick 260727-tb1) ─
//
// RED-gate coverage for the new local-branch on-deck bounty counter that Task 1
// of the per-row bounty badge quick task adds. The remote branch is exercised
// end-to-end through the WS handler's per-target error-isolation test in
// claude-session-server.count-bounties.test.ts — mocking ssh2 here would just
// duplicate that surface without adding signal.
//
// Local branch is deterministic and fs-only, so we drive it with a real temp
// directory tree instead of a stub. The tree matches what the tina bind-mount
// looks like: identityHostDir/<key>/bounties/<slug>/bounty.json, with an
// archive/ directory that must be skipped.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

import { readIdentityOnDeckBountyCount } from "./identity-artifact-reader.js";

let tmpRoot: string;
const KEY = "tina";

async function writeBounty(
  slug: string,
  status: string,
  opts: { archived?: boolean; malformed?: boolean } = {},
): Promise<void> {
  const base = opts.archived
    ? path.join(tmpRoot, KEY, "bounties", "archive", slug)
    : path.join(tmpRoot, KEY, "bounties", slug);
  await fs.mkdir(base, { recursive: true });
  const contents = opts.malformed
    ? "{ not valid json"
    : JSON.stringify({ id: slug, status });
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

describe("readIdentityOnDeckBountyCount — local branch", () => {
  it("returns 0 when the bounties dir does not exist", async () => {
    const n = await readIdentityOnDeckBountyCount(null, KEY);
    expect(n).toBe(0);
  });

  it("counts on_deck bounties, skipping archived + non-on_deck + malformed", async () => {
    await writeBounty("bounty-a", "on_deck");
    await writeBounty("bounty-b", "on_deck");
    await writeBounty("bounty-c", "in_progress");
    await writeBounty("bounty-d", "done");
    await writeBounty("bounty-e", "on_deck", { malformed: true });
    // Archive contents must be ignored regardless of status.
    await writeBounty("archived-1", "on_deck", { archived: true });
    await writeBounty("archived-2", "on_deck", { archived: true });

    const n = await readIdentityOnDeckBountyCount(null, KEY);
    expect(n).toBe(2);
  });

  it("returns 0 when no bounties are on_deck", async () => {
    await writeBounty("only-one", "in_progress");
    const n = await readIdentityOnDeckBountyCount(null, KEY);
    expect(n).toBe(0);
  });

  it("swallows a single malformed bounty.json without failing the whole call", async () => {
    await writeBounty("good", "on_deck");
    await writeBounty("bad", "on_deck", { malformed: true });
    const n = await readIdentityOnDeckBountyCount(null, KEY);
    expect(n).toBe(1);
  });

  it("rejects an invalid identity key (defense against path traversal)", async () => {
    await expect(
      readIdentityOnDeckBountyCount(null, "../etc"),
    ).rejects.toThrow();
  });
});
