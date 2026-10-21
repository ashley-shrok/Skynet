/**
 * role-skills-migration.test.ts — one scenario table, run against BOTH
 * implementations of the runbook → role-skill conversion:
 *   - "python": ROLE_SKILLS_MIGRATION_CMD (the exact command the SSH bootstrap
 *     sends) executed under a real `sh` with HOME pointed at a temp dir.
 *   - "ts": migrateRoleSkillsUnder(tmpHome) (the local-host bootstrap port).
 * Every test runs against a temp HOME only — never the real ~/fleet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { execFileSync } from "child_process";
import {
  ROLE_SKILLS_MIGRATION_CMD,
  parseRoleSkillsMigrationOutput,
  migrateRoleSkillsUnder,
  ensureRoleSkillFrontmatter,
  type RoleSkillsMigrationCounts,
} from "./role-skills-migration.js";

type Impl = "python" | "ts";

async function runImpl(impl: Impl, home: string): Promise<RoleSkillsMigrationCounts> {
  if (impl === "ts") return migrateRoleSkillsUnder(home);
  const out = execFileSync("sh", ["-c", ROLE_SKILLS_MIGRATION_CMD], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf-8",
  });
  const counts = parseRoleSkillsMigrationOutput(out);
  if (!counts) throw new Error(`unparseable script output: ${out}`);
  return counts;
}

/** Map of relative path → file text, or `-> target` for a symlink, or `/` for a dir. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(rel: string) {
    const abs = path.join(root, rel);
    for (const n of (await fs.readdir(abs)).sort()) {
      const r = rel ? `${rel}/${n}` : n;
      const st = await fs.lstat(path.join(root, r));
      if (st.isSymbolicLink()) out[r] = `-> ${await fs.readlink(path.join(root, r))}`;
      else if (st.isDirectory()) {
        out[r] = "/";
        await walk(r);
      } else out[r] = await fs.readFile(path.join(root, r), "utf-8");
    }
  }
  await walk("");
  return out;
}

async function put(root: string, rel: string, text: string) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
}

const RB = "fleet/roles/keeper/runbooks";
const SK = "fleet/roles/keeper/skills";
const FW = "fleet/identities/alpha/file-watch";

async function seed(home: string) {
  // runbook.md main, a companion script, and a watcher baseline.
  await put(home, `${RB}/deploy/runbook.md`, "# Deploy\nsteps\n");
  await put(home, `${RB}/deploy/run.sh`, "echo hi\n");
  await put(home, `${FW}/last-snapshot.runbook.keeper.deploy`, "# Deploy\nsteps\n");
  // <slug>.md main with frontmatter naming something else.
  await put(home, `${RB}/ship/ship.md`, "---\nname: Shipping\ndescription: Ship it.\n---\nbody\n");
  // Frontmatter without a name line.
  await put(home, `${RB}/audit/runbook.md`, "---\ndescription: \"Audit.\"\n---\nbody\n");
  // Loose file with no folder.
  await put(home, `${RB}/music.md`, "# Music\n");
  // Folder with no main, plus a loose main beside it.
  await put(home, `${RB}/archive/zip.ps1`, "zip\n");
  await put(home, `${RB}/archive.md`, "# Archive\n");
  // Folder with nothing that looks like a main.
  await put(home, `${RB}/tools/build.py`, "print(1)\n");
  // Role with no runbooks at all.
  await fs.mkdir(path.join(home, "fleet/roles/plain"), { recursive: true });
  await put(home, "fleet/roles/plain/plain.md", "role\n");
  // Conflict: skills/<slug> already exists for another role's runbook.
  await put(home, "fleet/roles/other/runbooks/dup/runbook.md", "old\n");
  await put(home, "fleet/roles/other/skills/dup/SKILL.md", "---\nname: dup\n---\n");
  // Specs naming runbook locations.
  await put(
    home,
    "fleet/identities/alpha/wakeups/daily/wakeup.json",
    JSON.stringify({
      name: "daily",
      instruction:
        "Follow ~/fleet/roles/keeper/runbooks/deploy/runbook.md then run " +
        "~/fleet/roles/keeper/runbooks/deploy/run.sh. Also /home/u/fleet/roles/keeper/runbooks/ship/ship.md, " +
        "~/fleet/roles/keeper/runbooks/music.md, ~/fleet/roles/keeper/runbooks/deploy and " +
        "~/fleet/roles/keeper/runbooks/deploy-old/runbook.md and ~/fleet/roles/keeper/runbooks/. " +
        "End: ~/fleet/roles/keeper/runbooks/deploy/runbook.md. And ~/fleet/roles/keeper/runbooks/deploy.mdx",
    }),
  );
  await put(
    home,
    `${FW}/last-snapshot.wakeup.daily`,
    JSON.stringify({ name: "daily", instruction: "Follow ~/fleet/roles/keeper/runbooks/deploy/runbook.md" }),
  );
  await put(
    home,
    "fleet/identities/alpha/wakeups/flat.json",
    JSON.stringify({ instruction: "see ~/fleet/roles/keeper/runbooks/archive.md" }),
  );
  await put(
    home,
    "fleet/scheduled-agents/nightly/scheduled-agent.json",
    JSON.stringify({ prompt: "Run ~/fleet/roles/keeper/runbooks/audit/runbook.md" }, null, 2),
  );
  await put(
    home,
    "fleet/scheduled-agents/untouched/scheduled-agent.json",
    JSON.stringify({ prompt: "Read ~/fleet/roles/other/runbooks/dup/runbook.md" }),
  );
}

describe.each<Impl>(["python", "ts"])("role-skills migration (%s)", (impl) => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "role-skills-mig-"));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("converts every runbook shape, forwards old paths, repoints specs", async () => {
    await seed(home);
    const counts = await runImpl(impl, home);
    expect(counts).toMatchObject({
      converted: 6,
      skillsDirsCreated: 2, // keeper + plain (other already had one)
      conflicts: 1,
      errorCount: 0,
      deferred: 0,
      specsRepointed: 3,
    });
    // runbook baseline + wake-up baseline
    expect(counts.baselinesUpdated).toBe(2);
    const s = await snapshot(home);

    expect(s[`${SK}/deploy/SKILL.md`]).toBe("---\nname: deploy\n---\n\n# Deploy\nsteps\n");
    expect(s[`${SK}/deploy/run.sh`]).toBe("echo hi\n");
    expect(s[`${SK}/deploy/runbook.md`]).toBe("-> SKILL.md");
    expect(s[`${RB}/deploy`]).toBe("-> ../skills/deploy");
    expect(s[`${FW}/last-snapshot.runbook.keeper.deploy`]).toBe(s[`${SK}/deploy/SKILL.md`]);

    expect(s[`${SK}/ship/SKILL.md`]).toBe("---\nname: ship\ndescription: Ship it.\n---\nbody\n");
    expect(s[`${SK}/ship/ship.md`]).toBe("-> SKILL.md");

    expect(s[`${SK}/audit/SKILL.md`]).toBe("---\nname: audit\ndescription: \"Audit.\"\n---\nbody\n");

    expect(s[`${SK}/music/SKILL.md`]).toBe("---\nname: music\n---\n\n# Music\n");
    expect(s[`${RB}/music.md`]).toBe("-> ../skills/music/SKILL.md");

    expect(s[`${SK}/archive/SKILL.md`]).toBe("---\nname: archive\n---\n\n# Archive\n");
    expect(s[`${SK}/archive/zip.ps1`]).toBe("zip\n");
    expect(s[`${RB}/archive.md`]).toBe("-> archive/SKILL.md");
    expect(s[`${RB}/archive`]).toBe("-> ../skills/archive");

    expect(s[`${SK}/tools/SKILL.md`]).toBe("---\nname: tools\n---\n");
    expect(s[`${SK}/tools/build.py`]).toBe("print(1)\n");

    expect(s["fleet/roles/plain/skills"]).toBe("/");
    // Conflict left alone.
    expect(s["fleet/roles/other/runbooks/dup/runbook.md"]).toBe("old\n");
    expect(counts.conflictPaths[0]).toMatch(/fleet\/roles\/other\/skills\/dup$/);

    // Old paths still resolve to the new content.
    expect(await fs.readFile(path.join(home, `${RB}/deploy/runbook.md`), "utf-8")).toBe(
      s[`${SK}/deploy/SKILL.md`],
    );
    expect(await fs.readFile(path.join(home, `${RB}/archive.md`), "utf-8")).toBe(s[`${SK}/archive/SKILL.md`]);
    expect(await fs.readFile(path.join(home, `${RB}/music.md`), "utf-8")).toBe(s[`${SK}/music/SKILL.md`]);

    const daily = JSON.parse(s["fleet/identities/alpha/wakeups/daily/wakeup.json"]);
    expect(daily.instruction).toBe(
      "Follow ~/fleet/roles/keeper/skills/deploy/SKILL.md then run " +
        "~/fleet/roles/keeper/skills/deploy/run.sh. Also /home/u/fleet/roles/keeper/skills/ship/SKILL.md, " +
        "~/fleet/roles/keeper/skills/music/SKILL.md, ~/fleet/roles/keeper/skills/deploy and " +
        "~/fleet/roles/keeper/runbooks/deploy-old/runbook.md and ~/fleet/roles/keeper/runbooks/. " +
        "End: ~/fleet/roles/keeper/skills/deploy/SKILL.md. And ~/fleet/roles/keeper/runbooks/deploy.mdx",
    );
    expect(JSON.parse(s[`${FW}/last-snapshot.wakeup.daily`]).instruction).toBe(
      "Follow ~/fleet/roles/keeper/skills/deploy/SKILL.md",
    );
    expect(JSON.parse(s["fleet/identities/alpha/wakeups/flat.json"]).instruction).toBe(
      "see ~/fleet/roles/keeper/skills/archive/SKILL.md",
    );
    // Formatting of the rest of the file is untouched.
    expect(s["fleet/scheduled-agents/nightly/scheduled-agent.json"]).toBe(
      JSON.stringify({ prompt: "Run ~/fleet/roles/keeper/skills/audit/SKILL.md" }, null, 2),
    );
    // The conflicted runbook was not converted, so its references stay.
    expect(s["fleet/scheduled-agents/untouched/scheduled-agent.json"]).toContain("runbooks/dup/runbook.md");
  });

  it("is a quiet no-op on the second run", async () => {
    await seed(home);
    await runImpl(impl, home);
    const before = await snapshot(home);
    const counts = await runImpl(impl, home);
    expect(counts).toMatchObject({
      converted: 0,
      skillsDirsCreated: 0,
      baselinesUpdated: 0,
      specsRepointed: 0,
      errorCount: 0,
      deferred: 0,
      conflicts: 1, // the standing conflict is reported again
    });
    expect(await snapshot(home)).toEqual(before);
  });

  it("does nothing on a box with no fleet", async () => {
    const counts = await runImpl(impl, home);
    expect(counts).toMatchObject({ converted: 0, errorCount: 0, skillsDirsCreated: 0 });
  });

  it("a folder with both SKILL.md and an old main file is a conflict, left untouched", async () => {
    await put(home, `${RB}/b/SKILL.md`, "---\nname: b\ndescription: existing\n---\n");
    await put(home, `${RB}/b/runbook.md`, "# b runbook\n");
    const counts = await runImpl(impl, home);
    expect(counts.converted).toBe(0);
    expect(counts.conflicts).toBe(1);
    expect(await fs.readFile(path.join(home, `${RB}/b/SKILL.md`), "utf-8")).toBe(
      "---\nname: b\ndescription: existing\n---\n",
    );
  });

  it("a folder whose only main is SKILL.md keeps its description", async () => {
    await put(home, `${RB}/b/SKILL.md`, "---\ndescription: existing\n---\n");
    const counts = await runImpl(impl, home);
    expect(counts.converted).toBe(1);
    expect(await fs.readFile(path.join(home, `${SK}/b/SKILL.md`), "utf-8")).toBe(
      "---\nname: b\ndescription: existing\n---\n",
    );
  });

  it("writes the role-skill watcher baseline alongside the old one", async () => {
    await put(home, `${RB}/deploy/runbook.md`, "# D\n");
    await put(home, `${FW}/last-snapshot.runbook.keeper.deploy`, "# D\n");
    await runImpl(impl, home);
    const expected = "---\nname: deploy\n---\n\n# D\n";
    expect(await fs.readFile(path.join(home, `${FW}/last-snapshot.role-skill.keeper.deploy`), "utf-8")).toBe(expected);
    expect(await fs.readFile(path.join(home, `${FW}/last-snapshot.runbook.keeper.deploy`), "utf-8")).toBe(expected);
  });

  it("after a rename, old paths repoint to the new name", async () => {
    await put(home, `${RB}/c.md`, "# C\n");
    await put(home, `${RB}/e/runbook.md`, "# E\n");
    await runImpl(impl, home);
    // What the app's rename does: move the folder, retarget the links.
    await fs.rename(path.join(home, `${SK}/c`), path.join(home, `${SK}/d`));
    await fs.unlink(path.join(home, `${RB}/c.md`));
    await fs.symlink("../skills/d/SKILL.md", path.join(home, `${RB}/c.md`));
    await fs.rename(path.join(home, `${SK}/e`), path.join(home, `${SK}/f`));
    await fs.unlink(path.join(home, `${RB}/e`));
    await fs.symlink("../skills/f", path.join(home, `${RB}/e`));
    await put(
      home,
      "fleet/identities/alpha/wakeups/w/wakeup.json",
      JSON.stringify({
        instruction:
          "~/fleet/roles/keeper/runbooks/c.md and ~/fleet/roles/keeper/runbooks/e/runbook.md and ~/fleet/roles/keeper/runbooks/e/x.py",
      }),
    );
    await runImpl(impl, home);
    expect(
      JSON.parse(await fs.readFile(path.join(home, "fleet/identities/alpha/wakeups/w/wakeup.json"), "utf-8")).instruction,
    ).toBe(
      "~/fleet/roles/keeper/skills/d/SKILL.md and ~/fleet/roles/keeper/skills/f/SKILL.md and ~/fleet/roles/keeper/skills/f/x.py",
    );
  });

  it("a loose <slug>.md beside a folder with its own main stays put, quietly, and isn't repointed as the main", async () => {
    await put(home, `${RB}/g/runbook.md`, "# G\n");
    await put(home, `${RB}/g/g.md`, "# companion\n");
    await put(home, `${RB}/g.md`, "# separate\n");
    await runImpl(impl, home);
    await put(
      home,
      "fleet/identities/alpha/wakeups/w/wakeup.json",
      JSON.stringify({
        instruction: "~/fleet/roles/keeper/runbooks/g.md ~/fleet/roles/keeper/runbooks/g/g.md ~/fleet/roles/keeper/runbooks/g/runbook.md",
      }),
    );
    for (let i = 0; i < 2; i++) {
      const counts = await runImpl(impl, home);
      expect(counts).toMatchObject({ conflicts: 0, errorCount: 0, converted: 0 });
    }
    expect(await fs.readFile(path.join(home, `${RB}/g.md`), "utf-8")).toBe("# separate\n");
    expect(
      JSON.parse(await fs.readFile(path.join(home, "fleet/identities/alpha/wakeups/w/wakeup.json"), "utf-8")).instruction,
    ).toBe("~/fleet/roles/keeper/runbooks/g.md ~/fleet/roles/keeper/skills/g/g.md ~/fleet/roles/keeper/skills/g/SKILL.md");
  });

  it("finishes a folder move a crash left half-done", async () => {
    await put(home, `${SK}/h/SKILL.md`, "---\nname: h\n---\n");
    await fs.mkdir(path.join(home, RB), { recursive: true });
    await fs.symlink("../skills/h", path.join(home, `${RB}/.h.rs-pending`));
    const counts = await runImpl(impl, home);
    expect(counts.errorCount).toBe(0);
    expect(await fs.readlink(path.join(home, `${RB}/h`))).toBe("../skills/h");
    expect(await fs.readdir(path.join(home, RB))).toEqual(["h"]);
  });

  it("leaves a spec alone when the rewrite would break its JSON", async () => {
    await put(home, `${RB}/deploy/runbook.md`, "# D\n");
    // A path inside a JSON string can't break it; simulate a non-JSON spec
    // instead, which is rewritten as plain bytes.
    await put(home, "fleet/identities/alpha/wakeups/notes.json", "not json ~/fleet/roles/keeper/runbooks/deploy/runbook.md");
    const counts = await runImpl(impl, home);
    expect(counts.errorCount).toBe(0);
    expect(await fs.readFile(path.join(home, "fleet/identities/alpha/wakeups/notes.json"), "utf-8")).toBe(
      "not json ~/fleet/roles/keeper/skills/deploy/SKILL.md",
    );
  });
});

describe("both implementations agree", () => {
  it("produce identical trees and counts from the same seed", async () => {
    const a = await fs.mkdtemp(path.join(os.tmpdir(), "role-skills-a-"));
    const b = await fs.mkdtemp(path.join(os.tmpdir(), "role-skills-b-"));
    try {
      await seed(a);
      await seed(b);
      const ca = await runImpl("python", a);
      const cb = await runImpl("ts", b);
      expect({ ...cb, conflictPaths: cb.conflictPaths.map((p) => p.slice(b.length)) }).toEqual({
        ...ca,
        conflictPaths: ca.conflictPaths.map((p) => p.slice(a.length)),
      });
      expect(await snapshot(b)).toEqual(await snapshot(a));
    } finally {
      await fs.rm(a, { recursive: true, force: true });
      await fs.rm(b, { recursive: true, force: true });
    }
  });
});

describe("ensureRoleSkillFrontmatter", () => {
  const f = (s: string, slug = "x") => ensureRoleSkillFrontmatter(Buffer.from(s, "utf-8"), slug).toString("utf-8");
  it("prepends a block when there is none", () => {
    expect(f("# T\n")).toBe("---\nname: x\n---\n\n# T\n");
  });
  it("keeps a matching quoted name", () => {
    expect(f("---\nname: \"x\"\n---\n")).toBe("---\nname: \"x\"\n---\n");
  });
  it("corrects a different name and keeps CRLF", () => {
    expect(f("---\r\nname: Y\r\ndescription: d\r\n---\r\n")).toBe("---\r\nname: x\r\ndescription: d\r\n---\r\n");
  });
  it("keeps a byte-order mark in front", () => {
    expect(f("﻿---\ndescription: d\n---\n")).toBe("﻿---\nname: x\ndescription: d\n---\n");
  });
  it("treats an unterminated block as no frontmatter", () => {
    expect(f("---\nname: x\n")).toBe("---\nname: x\n---\n\n---\nname: x\n");
  });
});
