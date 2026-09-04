// ─── identity-artifact-reader — role-scope wakeup read/write (Phase 72 Plan 01) ─
//
// Phase 72 Plan 01 Task 1 tests for the four new role-scope writers +
// role-scope reader. Mirrors the identity-artifact-reader.role-file.test.ts
// harness — two-step fixture (identity file with role frontmatter + role
// folder), LOCAL branch via tmp-dir + env-var override, REMOTE branch via
// mocked execCommand.
//
// Coverage:
//   (a) readRoleWakeups LOCAL — real tmp-dir fixture, two wakeup JSONs
//   (b) readRoleWakeups LOCAL — missing role wakeups dir → {wakeups: []}
//   (c) readRoleWakeups throws when identity file lacks role frontmatter
//   (d) readRoleWakeups REMOTE — mocked delimiter stdout
//   (e) writeRoleWakeupUpdate LOCAL — patch enabled=false
//   (f) writeRoleWakeupCreate LOCAL — creates new file with kebab slug
//   (g) writeRoleWakeupCreate LOCAL — throws on clobber
//   (h) writeRoleWakeupDelete LOCAL — deletes file (fs.access → ENOENT after)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";

// Mock tmux-helper.execCommand BEFORE importing the module under test so the
// mock is bound to the module graph when identity-artifact-reader evaluates.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  readRoleWakeups,
  writeRoleWakeupUpdate,
  writeRoleWakeupCreate,
  writeRoleWakeupDelete,
} from "./identity-artifact-reader.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// LOCAL-branch fixture — real tmp dirs + env-var override
// ──────────────────────────────────────────────────────────────────────

describe("readRoleWakeups — LOCAL branch (conn=null)", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-identities-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    // Identity file with role frontmatter drives the two-step
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

  it("(a) reads two wakeup JSONs from ~/.claude/roles/<role>/wakeups/", async () => {
    const wakeupsDir = path.join(rolesRoot, ROLE, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "morning-standup.json"),
      JSON.stringify(
        {
          name: "morning-standup",
          enabled: true,
          schedule: { type: "daily", at: "09:00" },
          instruction: "Post standup summary",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(wakeupsDir, "hourly-poll.json"),
      JSON.stringify(
        {
          name: "hourly-poll",
          enabled: false,
          schedule: { type: "interval", every: "1h" },
          instruction: "Check fleet status",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const result = await readRoleWakeups(null, KEY);
    expect(result.wakeups).toHaveLength(2);
    const slugs = result.wakeups.map((w) => w.slug).sort();
    expect(slugs).toEqual(["hourly-poll", "morning-standup"]);

    const standup = result.wakeups.find((w) => w.slug === "morning-standup")!;
    expect(standup.enabled).toBe(true);
    expect(standup.instruction).toBe("Post standup summary");
    expect(standup.scheduleHuman).toContain("09:00");
  });

  it("(b) returns {wakeups: []} when role wakeups folder is missing on disk", async () => {
    // rolesRoot exists but no <role>/wakeups folder within it
    const result = await readRoleWakeups(null, KEY);
    expect(result.wakeups).toEqual([]);
  });
});

describe("readRoleWakeups — throws when identity has no role frontmatter", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "no-role-key";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-noroleid-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-noroleroles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    // Identity file has NO role frontmatter — two-step must throw
    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `# ${KEY}\n\nNo frontmatter here.\n`,
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("(c) throws (via resolveRoleForIdentity) when identity file has no role: frontmatter", async () => {
    await expect(readRoleWakeups(null, KEY)).rejects.toThrow(/no role|no-role-key/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// REMOTE-branch tests — mocked execCommand
// ──────────────────────────────────────────────────────────────────────

describe("readRoleWakeups — REMOTE branch", () => {
  it("(d) parses delimiter-formatted stdout from `cd .../wakeups && for f in *.json; do echo ===FILE:$f===; cat $f; done`", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n\n# tina\n";
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes(".claude/identities/") && cmd.startsWith("cat ")) {
          return identityMd;
        }
        if (cmd.includes(".claude/roles/box-maintainer/wakeups")) {
          // Simulate the delimiter one-liner output for two wakeup files.
          return (
            `===FILE:morning-standup.json===\n` +
            `{"name":"morning-standup","enabled":true,"schedule":{"type":"daily","at":"09:00"},"instruction":"Post standup summary"}\n` +
            `===FILE:hourly-poll.json===\n` +
            `{"name":"hourly-poll","enabled":false,"schedule":{"type":"interval","every":"1h"},"instruction":"Check fleet status"}\n`
          );
        }
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readRoleWakeups(conn, "tina");

    // Two-step: identity file read happened first
    const identityCmd = capturedCommands.find((c) =>
      c.includes(".claude/identities/tina/tina.md"),
    );
    expect(identityCmd).toBeDefined();

    // Role folder queried with proper path
    const roleCmd = capturedCommands.find((c) =>
      c.includes(".claude/roles/box-maintainer/wakeups"),
    );
    expect(roleCmd).toBeDefined();

    // Both wakeups parsed
    expect(result.wakeups).toHaveLength(2);
    const slugs = result.wakeups.map((w) => w.slug).sort();
    expect(slugs).toEqual(["hourly-poll", "morning-standup"]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// writeRoleWakeupUpdate — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleWakeupUpdate — LOCAL branch", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-upd-id-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-upd-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `---\nrole: ${ROLE}\n---\n`,
      "utf-8",
    );

    // Seed a wakeup file to patch
    const wakeupsDir = path.join(rolesRoot, ROLE, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "poll.json"),
      JSON.stringify(
        {
          name: "poll",
          enabled: true,
          schedule: { type: "interval", every: "30m" },
          instruction: "Poll fleet",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("(e) patches enabled=false and preserves other fields", async () => {
    await writeRoleWakeupUpdate(null, KEY, "poll", { enabled: false });

    const filePath = path.join(rolesRoot, ROLE, "wakeups", "poll.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.enabled).toBe(false);
    // Other fields preserved
    expect(parsed.name).toBe("poll");
    expect(parsed.instruction).toBe("Poll fleet");
    expect(parsed.schedule).toEqual({ type: "interval", every: "30m" });
  });
});

// ──────────────────────────────────────────────────────────────────────
// writeRoleWakeupCreate — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleWakeupCreate — LOCAL branch", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-cre-id-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-cre-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `---\nrole: ${ROLE}\n---\n`,
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("(f) creates new file with slug derived from name via kebab-case", async () => {
    const result = await writeRoleWakeupCreate(null, KEY, {
      name: "Morning Standup!",
      enabled: true,
      schedule: { type: "daily", at: "09:00" },
      instruction: "Post standup summary",
    });

    // Slug derived: "morning-standup"
    const filePath = path.join(rolesRoot, ROLE, "wakeups", "morning-standup.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("Morning Standup!");
    expect(parsed.enabled).toBe(true);
    expect(parsed.schedule).toEqual({ type: "daily", at: "09:00" });
    expect(parsed.instruction).toBe("Post standup summary");

    // Returns fresh {wakeups} list
    expect(result.wakeups).toHaveLength(1);
    expect(result.wakeups[0].slug).toBe("morning-standup");
  });

  it("(g) throws when a wakeup with the same name already exists", async () => {
    // Pre-seed the file
    const wakeupsDir = path.join(rolesRoot, ROLE, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "morning-standup.json"),
      JSON.stringify(
        { name: "morning-standup", enabled: true, schedule: { type: "daily", at: "09:00" }, instruction: "existing" },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    await expect(
      writeRoleWakeupCreate(null, KEY, {
        name: "morning-standup",
        enabled: true,
        schedule: { type: "daily", at: "10:00" },
        instruction: "new",
      }),
    ).rejects.toThrow(/already exists/);

    // Existing file NOT clobbered
    const raw = await fs.readFile(
      path.join(wakeupsDir, "morning-standup.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.instruction).toBe("existing");
  });

  it("throws when name normalizes to empty slug (e.g. '!!!')", async () => {
    await expect(
      writeRoleWakeupCreate(null, KEY, {
        name: "!!!",
        enabled: true,
        schedule: { type: "daily", at: "09:00" },
        instruction: "junk",
      }),
    ).rejects.toThrow(/normalizes to empty|invalid slug/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// writeRoleWakeupDelete — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("writeRoleWakeupDelete — LOCAL branch", () => {
  let identitiesRoot: string;
  let rolesRoot: string;
  const KEY = "tina";
  const ROLE = "box-maintainer";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-del-id-"));
    rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-del-roles-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    process.env.ROLES_HOST_DIR = rolesRoot;

    const identityDir = path.join(identitiesRoot, KEY);
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      path.join(identityDir, `${KEY}.md`),
      `---\nrole: ${ROLE}\n---\n`,
      "utf-8",
    );

    // Seed one wakeup file so we can delete it
    const wakeupsDir = path.join(rolesRoot, ROLE, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "doomed.json"),
      JSON.stringify(
        { name: "doomed", enabled: true, schedule: { type: "daily", at: "09:00" }, instruction: "" },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    delete process.env.ROLES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
    await fs.rm(rolesRoot, { recursive: true, force: true });
  });

  it("(h) deletes file and post-fs.access resolves to ENOENT", async () => {
    const filePath = path.join(rolesRoot, ROLE, "wakeups", "doomed.json");
    // Pre-delete: file exists
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    const result = await writeRoleWakeupDelete(null, KEY, "doomed");

    // Post-delete: file absent → fs.access throws ENOENT
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });

    // Returned refreshed list is empty
    expect(result.wakeups).toEqual([]);
  });

  it("idempotent — swallows ENOENT on missing file", async () => {
    // Delete once
    await writeRoleWakeupDelete(null, KEY, "doomed");
    // Delete again — should NOT throw
    await expect(writeRoleWakeupDelete(null, KEY, "doomed")).resolves.toBeDefined();
  });

  it("invalid slug throws before any I/O", async () => {
    await expect(writeRoleWakeupDelete(null, KEY, "not/a/valid slug")).rejects.toThrow(
      /invalid wakeup slug/,
    );
  });
});
