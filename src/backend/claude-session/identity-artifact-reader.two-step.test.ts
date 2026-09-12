// ─── identity-artifact-reader — two-step (identity file → role frontmatter → role folder) ─
//
// Phase 22 SRIC-01: verifies the new helpers that unlock role-folder reads without
// changing the (identityKey, hostId) frontend contract.
//
// The Bounties + History tabs on IdentityModal used to root at
// ~/fleet/identities/<key>/{bounties,history.md}. Post the fleet role/identity
// migration those folders are empty — the actual data lives at
// ~/fleet/roles/<role>/{bounties,history.md}, and the role is discovered by
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

// Mock the logger so the malformed-YAML tests can assert the WARN fires.
// The systemLogger reference in identity-artifact-reader flows through this
// mock; sshLogger stays covered too since we mock the whole module.
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

import { execCommand } from "../ssh/tmux-helper.js";
import { systemLogger } from "../utils/logger.js";
import {
  extractRoleFromMarkdown,
  extractCosmeticsFromFrontmatter,
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

  // Regression coverage for the bounty
  // `fleet-status-orchestrator-coupling-with-spawn-request-scanning` e2e-test
  // incident: a hand-authored identity file with a bare `: ` (colon-space)
  // inside a plain YAML scalar in the `task:` value silently broke both the
  // role extraction AND the cosmetics extraction — identity showed up on the
  // frontend with no title, no colorHue, no avatar simultaneously, and there
  // was NO log line to point at the offending file. These tests lock in that
  // both extract functions now emit a WARN via systemLogger before returning
  // the fail-open value, so the failure is visible in the docker forensic
  // trail.
  it("test 5b: logs a WARN and returns null when YAML fails to parse (bare `: ` inside plain scalar)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nrole: box-maintainer\ntask: broken Evidence: extra colon-space here\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBeNull();
    expect(vi.mocked(systemLogger.warn)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(call[0]).toMatch(/frontmatter yaml parse failed/i);
    const context = call[1] as { operation?: string; site?: string; snippet?: string; error?: string };
    expect(context.operation).toBe("frontmatter_yaml_parse_failed");
    expect(context.site).toBe("extractRoleFromMarkdown");
    expect(typeof context.error).toBe("string");
    expect(context.snippet).toContain("role: box-maintainer");
    expect((context.snippet ?? "").length).toBeLessThanOrEqual(200);
  });
});

describe("extractCosmeticsFromFrontmatter (malformed-YAML logging — regression for bounty fleet-status-orchestrator-coupling-with-spawn-request-scanning)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 5c: logs a WARN and returns {} when YAML fails to parse (bare `: ` inside plain scalar)", () => {
    const md =
      "---\nrole: box-maintainer\ndisplayName: Odin\ntask: bad Evidence: extra colon inside plain scalar\n---\n\n# body";
    expect(extractCosmeticsFromFrontmatter(md)).toEqual({});
    expect(vi.mocked(systemLogger.warn)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(call[0]).toMatch(/frontmatter yaml parse failed/i);
    const context = call[1] as { operation?: string; site?: string; snippet?: string; error?: string };
    expect(context.operation).toBe("frontmatter_yaml_parse_failed");
    expect(context.site).toBe("extractCosmeticsFromFrontmatter");
    expect(typeof context.error).toBe("string");
    expect(context.snippet).toContain("role: box-maintainer");
    expect((context.snippet ?? "").length).toBeLessThanOrEqual(200);
  });

  it("test 5d: does NOT log on well-formed frontmatter (log is scoped to parse failures)", () => {
    const md = "---\nrole: box-maintainer\ndisplayName: Odin\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.displayName).toBe("Odin");
    expect(vi.mocked(systemLogger.warn)).not.toHaveBeenCalled();
  });

  it("test 5e: does NOT log when frontmatter is absent (missing `---` delimiters — different path than parse-failure)", () => {
    const md = "# no frontmatter here\n";
    expect(extractCosmeticsFromFrontmatter(md)).toEqual({});
    expect(vi.mocked(systemLogger.warn)).not.toHaveBeenCalled();
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

  it("test 9: returns ROLES_HOST_DIR when set, else falls back to $HOME/fleet/roles", () => {
    process.env.ROLES_HOST_DIR = "/mnt/roles-bind-mount";
    expect(getLocalRolesRoot()).toBe("/mnt/roles-bind-mount");

    delete process.env.ROLES_HOST_DIR;
    expect(getLocalRolesRoot()).toBe(path.join(os.homedir(), "fleet", "roles"));
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
  //   - `cat "$HOME/fleet/identities/<key>/<key>.md"` → identity file body
  //   - `cd "$HOME/fleet/roles/<role>/bounties" ...` → bounties dir dump
  //   - `cd "$HOME/fleet/roles/<role>/bounties/archive" ...` → archive dump
  //   - `cat "$HOME/fleet/roles/<role>/history.md"` → history body
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
      if (cmd.includes("fleet/identities/") && cmd.startsWith("cat ")) {
        return opts.identityFile ?? "";
      }
      if (cmd.includes("fleet/roles/") && cmd.includes("/bounties/archive")) {
        return opts.bountiesArchive ?? "";
      }
      if (cmd.includes("fleet/roles/") && cmd.includes("/bounties")) {
        return opts.bountiesOpen ?? "";
      }
      if (cmd.includes("fleet/roles/") && cmd.includes("/history.md")) {
        return opts.historyMd ?? "";
      }
      return "";
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 10: readIdentityBounties (REMOTE) reads from $HOME/fleet/roles/<role>/bounties, not identity folder", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n";
    const bountyJson =
      '{"id":"bounty-a","title":"A","priority":"medium","status":"in_progress"}';
    const bountiesStdout = `===DIR:bounty-a===\n${bountyJson}`;
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes("fleet/identities/")) return identityMd;
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
        c.includes("fleet/roles/box-maintainer/bounties") &&
        c.includes('[ "$d" = "archive" ] && continue'),
    );
    expect(bountiesCmd).toBeDefined();
    expect(bountiesCmd).toContain("$HOME/fleet/roles/box-maintainer/bounties");
    expect(bountiesCmd).not.toContain("$HOME/fleet/identities/moxie/bounties");

    // Content flowed through the parser
    expect(result.bounties).toHaveLength(1);
    expect((result.bounties[0] as { slug: string }).slug).toBe("bounty-a");
  });

  it("test 11: readIdentityHistory (REMOTE) reads $HOME/fleet/roles/<role>/history.md, not identity folder", async () => {
    const identityMd = "---\nrole: box-maintainer\n---\n";
    const historyMd = "# History\n\n- entry one\n- entry two\n";
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes("fleet/identities/")) return identityMd;
        if (cmd.includes("/history.md")) return historyMd;
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readIdentityHistory(conn, "moxie");

    const historyCmd = capturedCommands.find((c) => c.includes("/history.md"));
    expect(historyCmd).toBeDefined();
    expect(historyCmd).toContain("$HOME/fleet/roles/box-maintainer/history.md");
    expect(historyCmd).not.toContain("$HOME/fleet/identities/moxie/history.md");
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
        if (cmd.includes("fleet/identities/")) return ""; // no frontmatter
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
        if (cmd.includes("fleet/identities/")) {
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
