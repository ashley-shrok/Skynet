// ─── identity-artifact-reader — two-step (identity file → role frontmatter → role folder) ─
//
// Phase 22 SRIC-01: verifies the new helpers that unlock role-folder reads without
// changing the (identityKey, hostId) frontend contract.
//
// The Bounties + History tabs on IdentityModal used to root at
// ~/.claude/identities/<key>/{bounties,history.md}. Post the fleet role/identity
// migration those folders are empty — the actual data lives at
// ~/.claude/roles/<role>/{bounties,history.md}, and the role is discovered by
// reading `role:` from the identity file's YAML frontmatter.
//
// This test file covers:
//   Task 1 (tests 1-9):  extractRoleFromMarkdown, resolveRoleForIdentity,
//                         getLocalRolesRoot — the three helpers Wave-2 plans reuse.
//   Task 2 (tests 10-16): readIdentityBounties + readIdentityHistory now do the
//                         two-step internally on both LOCAL and REMOTE branches;
//                         signatures unchanged; throws propagate.
//
// Test framework: vitest (matches every sibling test file in
// src/backend/claude-session/*.test.ts).
//
// Mock strategy for Task 1 (helpers):
//   - Mock ../ssh/tmux-helper.js execCommand so we can stub readIdentityFile's
//     REMOTE `cat` response (tests 6-8) without a real ssh2 exec channel.
//   - Use fs + os.tmpdir + IDENTITIES_HOST_DIR / ROLES_HOST_DIR env vars for
//     LOCAL-branch fixtures (test 9).
//
// Mock strategy for Task 2 (readIdentityBounties / readIdentityHistory):
//   - Same execCommand mock, but with an implementation that inspects the
//     command string to route responses (identity-file read → frontmatter,
//     bounties/history read → payload). This mirrors the same pattern used in
//     identity-artifact-reader.remote-writes.test.ts but with a smarter router.
//   - For LOCAL branch, temp filesystem fixtures at IDENTITIES_HOST_DIR +
//     ROLES_HOST_DIR let the real fs paths flow through.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";

// Mock tmux-helper.execCommand BEFORE importing the module under test so the
// mock is bound to the module graph when identity-artifact-reader evaluates.
// The mock's default resolved value is overridden per-test via
// (execCommand as vi.Mock).mockResolvedValueOnce / mockImplementation.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  extractRoleFromMarkdown,
  resolveRoleForIdentity,
  getLocalRolesRoot,
  readIdentityBounties,
  readIdentityHistory,
} from "./identity-artifact-reader.js";

// ──────────────────────────────────────────────────────────────────────
// Task 1 — Helper tests (tests 1-9)
// ──────────────────────────────────────────────────────────────────────

describe("extractRoleFromMarkdown", () => {
  it("test 1: returns role name for typical frontmatter block", () => {
    const md = "---\nrole: box-maintainer\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("box-maintainer");
  });

  it("test 2: returns null when frontmatter delimiters are missing", () => {
    const md = "# no frontmatter here\n\nrole: box-maintainer\n";
    expect(extractRoleFromMarkdown(md)).toBeNull();
  });

  it("test 3: returns null when frontmatter exists but has no role: key", () => {
    const md = "---\ntitle: something\nauthor: someone\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBeNull();
  });

  it("test 4: returns null when role: value is empty or non-string", () => {
    // role with empty string value
    const emptyRole = "---\nrole: \n---\n\n# body";
    expect(extractRoleFromMarkdown(emptyRole)).toBeNull();
    // role with numeric value (non-string type)
    const numRole = "---\nrole: 42\n---\n\n# body";
    expect(extractRoleFromMarkdown(numRole)).toBeNull();
  });

  it("test 5: handles CRLF line endings in frontmatter delimiters", () => {
    const md = "---\r\nrole: box-maintainer\r\n---\r\n\r\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("box-maintainer");
  });
});

describe("resolveRoleForIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 6: throws Error including identityKey when identity file is empty", async () => {
    // mockResolvedValue (not Once) — the test does two rejects.toThrow assertions
    // against the SAME behavior, each of which invokes the resolver. Both invocations
    // must hit the "empty identity file" stub, not just the first.
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("");
    const conn = {} as SSHClientType; // remote branch; execCommand mock intercepts
    await expect(resolveRoleForIdentity(conn, "moxie")).rejects.toThrow(/moxie/);
    await expect(resolveRoleForIdentity(conn, "moxie")).rejects.toThrow(/no role/);
  });

  it("test 7: throws Error when extracted role fails IDENTITY_KEY_RE gate", async () => {
    // Frontmatter parses fine but role contains characters IDENTITY_KEY_RE
    // (^[a-z0-9_-]{1,64}$) rejects — e.g. path traversal or uppercase.
    const evilFrontmatter = "---\nrole: ../etc/passwd\n---\n\n# body";
    (execCommand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(evilFrontmatter);
    const conn = {} as SSHClientType;
    await expect(resolveRoleForIdentity(conn, "moxie")).rejects.toThrow(
      /IDENTITY_KEY_RE|fails/,
    );
  });

  it("test 8: returns role string on happy path", async () => {
    const goodFrontmatter = "---\nrole: box-maintainer\n---\n\n# body";
    (execCommand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(goodFrontmatter);
    const conn = {} as SSHClientType;
    const role = await resolveRoleForIdentity(conn, "tina");
    expect(role).toBe("box-maintainer");
  });
});

describe("getLocalRolesRoot", () => {
  const savedEnv = process.env.ROLES_HOST_DIR;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ROLES_HOST_DIR;
    else process.env.ROLES_HOST_DIR = savedEnv;
  });

  it("test 9: returns ROLES_HOST_DIR when set, else falls back to $HOME/.claude/roles", () => {
    process.env.ROLES_HOST_DIR = "/mnt/roles-bind-mount";
    expect(getLocalRolesRoot()).toBe("/mnt/roles-bind-mount");

    delete process.env.ROLES_HOST_DIR;
    expect(getLocalRolesRoot()).toBe(path.join(os.homedir(), ".claude", "roles"));
  });
});

// ──────────────────────────────────────────────────────────────────────
// Task 2 — readIdentityBounties + readIdentityHistory two-step (tests 10-16)
// ──────────────────────────────────────────────────────────────────────

describe("readIdentityBounties + readIdentityHistory — two-step", () => {
  // Router for the REMOTE-branch execCommand mock — inspects the command
  // string and returns the appropriate stubbed response. Order-agnostic so
  // the reader's internal call order can evolve without breaking tests.
  //
  // Contract:
  //   - `cat "$HOME/.claude/identities/<key>/<key>.md"` → identity file body
  //   - `cd "$HOME/.claude/roles/<role>/bounties" ...` → bounties dir dump
  //   - `cd "$HOME/.claude/roles/<role>/bounties/archive" ...` → archive dump
  //   - `cat "$HOME/.claude/roles/<role>/history.md"` → history body
  //
  // Tests assert on the command string via a captured spy so path substitution
  // is verified even when the response is a stub.
  function makeRouter(opts: {
    identityFile?: string;
    bountiesOpen?: string;
    bountiesArchive?: string;
    historyMd?: string;
  }): (conn: SSHClientType, cmd: string) => Promise<string> {
    return async (_conn, cmd) => {
      if (cmd.includes(".claude/identities/") && cmd.startsWith("cat ")) {
        return opts.identityFile ?? "";
      }
      if (cmd.includes(".claude/roles/") && cmd.includes("/bounties/archive")) {
        return opts.bountiesArchive ?? "";
      }
      if (cmd.includes(".claude/roles/") && cmd.includes("/bounties")) {
        return opts.bountiesOpen ?? "";
      }
      if (cmd.includes(".claude/roles/") && cmd.includes("/history.md")) {
        return opts.historyMd ?? "";
      }
      return "";
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 10: readIdentityBounties (REMOTE) reads from $HOME/.claude/roles/<role>/bounties, not identity folder", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n";
    const bountyJson =
      '{"id":"bounty-a","title":"A","priority":"medium","status":"in_progress"}';
    const bountiesStdout = `===DIR:bounty-a===\n${bountyJson}`;
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes(".claude/identities/")) return identityMd;
        if (cmd.includes("/bounties/archive")) return "";
        if (cmd.includes("/bounties")) return bountiesStdout;
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readIdentityBounties(conn, "moxie");

    // Path substitution: role folder is queried, identity folder for bounties is NOT.
    // Filter by the openCmd-only sentinel `[ "$d" = "archive" ] && continue`
    // (matches the pattern used in include-archived.test.ts) — the archiveCmd
    // omits this guard since it enumerates INSIDE the archive folder.
    const bountiesCmd = capturedCommands.find(
      (c) =>
        c.includes(".claude/roles/box-maintainer/bounties") &&
        c.includes('[ "$d" = "archive" ] && continue'),
    );
    expect(bountiesCmd).toBeDefined();
    expect(bountiesCmd).toContain("$HOME/.claude/roles/box-maintainer/bounties");
    expect(bountiesCmd).not.toContain("$HOME/.claude/identities/moxie/bounties");

    // Content flowed through the parser
    expect(result.bounties).toHaveLength(1);
    expect((result.bounties[0] as { slug: string }).slug).toBe("bounty-a");
  });

  it("test 11: readIdentityHistory (REMOTE) reads $HOME/.claude/roles/<role>/history.md, not identity folder", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n";
    const historyMd = "# History\n\n- entry one\n- entry two\n";
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes(".claude/identities/")) return identityMd;
        if (cmd.includes("/history.md")) return historyMd;
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readIdentityHistory(conn, "moxie");

    const historyCmd = capturedCommands.find((c) => c.includes("/history.md"));
    expect(historyCmd).toBeDefined();
    expect(historyCmd).toContain("$HOME/.claude/roles/box-maintainer/history.md");
    expect(historyCmd).not.toContain("$HOME/.claude/identities/moxie/history.md");
    expect(result.markdown).toBe(historyMd);
    // history entries: strip #-headings + blank lines, reverse (mirrors existing behavior)
    expect(result.entries).toEqual(["- entry two", "- entry one"]);
  });

  // LOCAL-branch fixtures — write both identity file (with role: frontmatter)
  // and the role folder into two separate temp roots pointed at by
  // IDENTITIES_HOST_DIR and ROLES_HOST_DIR env vars.
  describe("LOCAL branch (conn=null) — reads from role folder", () => {
    let identitiesRoot: string;
    let rolesRoot: string;
    const KEY = "moxie";
    const ROLE = "box-maintainer";

    beforeEach(async () => {
      identitiesRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "22-01-identities-"),
      );
      rolesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "22-01-roles-"));
      process.env.IDENTITIES_HOST_DIR = identitiesRoot;
      process.env.ROLES_HOST_DIR = rolesRoot;

      // Identity file with role: frontmatter (drives the two-step)
      const identityDir = path.join(identitiesRoot, KEY);
      await fs.mkdir(identityDir, { recursive: true });
      await fs.writeFile(
        path.join(identityDir, `${KEY}.md`),
        `---\nrole: ${ROLE}\n---\n\n# ${KEY}\n`,
        "utf-8",
      );

      // Role folder with bounties + history
      const roleDir = path.join(rolesRoot, ROLE);
      const bountiesDir = path.join(roleDir, "bounties");
      await fs.mkdir(bountiesDir, { recursive: true });
      const bountyDir = path.join(bountiesDir, "bounty-a");
      await fs.mkdir(bountyDir, { recursive: true });
      await fs.writeFile(
        path.join(bountyDir, "bounty.json"),
        JSON.stringify({ id: "bounty-a", title: "A", status: "in_progress" }),
        "utf-8",
      );
      await fs.writeFile(
        path.join(roleDir, "history.md"),
        "# History\n\n- role entry one\n",
        "utf-8",
      );
    });

    afterEach(async () => {
      delete process.env.IDENTITIES_HOST_DIR;
      delete process.env.ROLES_HOST_DIR;
      await fs.rm(identitiesRoot, { recursive: true, force: true });
      await fs.rm(rolesRoot, { recursive: true, force: true });
    });

    it("test 12: readIdentityBounties (LOCAL) reads from ROLES_HOST_DIR/<role>/bounties", async () => {
      const result = await readIdentityBounties(null, KEY);
      expect(result.bounties).toHaveLength(1);
      expect((result.bounties[0] as { slug: string }).slug).toBe("bounty-a");
      // archive dir doesn't exist on disk → gracefully empty
      expect(result.archivedBounties).toEqual([]);
    });

    it("test 13: readIdentityHistory (LOCAL) reads from ROLES_HOST_DIR/<role>/history.md", async () => {
      const result = await readIdentityHistory(null, KEY);
      expect(result.markdown).toContain("- role entry one");
      expect(result.entries).toEqual(["- role entry one"]);
    });
  });

  it("test 14: readIdentityBounties propagates the throw from resolveRoleForIdentity when identity file is empty", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/")) return ""; // no frontmatter
        return "";
      },
    );
    const conn = {} as SSHClientType;
    await expect(readIdentityBounties(conn, "moxie")).rejects.toThrow(
      /no role|moxie/,
    );
  });

  it("test 15: readIdentityHistory propagates the throw when identity file has no role frontmatter", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/")) {
          return "# just a heading, no frontmatter\n";
        }
        return "";
      },
    );
    const conn = {} as SSHClientType;
    await expect(readIdentityHistory(conn, "moxie")).rejects.toThrow(
      /no role|moxie/,
    );
  });

  it("test 16: signatures unchanged — accepts (SSHClientType|null, string)", async () => {
    // Compile-time smoke check: this test simply demonstrates the function
    // types still accept the pre-Phase-22 (conn, identityKey) tuple. If a
    // future edit widens the signature to (conn, identityKey, role), tsc
    // --noEmit (run separately in the verification step) catches it; this
    // runtime test just proves the call compiles + runs.
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      makeRouter({ identityFile: "---\nrole: box-maintainer\n---\n" }),
    );
    const conn = {} as SSHClientType;
    // Note: no third argument — proves the signature stays 2-ary.
    const bountiesPromise: Promise<{
      bounties: unknown[];
      archivedBounties: unknown[];
    }> = readIdentityBounties(conn, "moxie");
    const historyPromise: Promise<{
      entries: string[];
      markdown: string;
    }> = readIdentityHistory(conn, "moxie");
    await Promise.all([bountiesPromise, historyPromise]);
  });
});
