// ─── identity-artifact-reader — two-step (identity file → role frontmatter → role folder) ─
//
// Phase 22 SRIC-01: verifies the helpers that unlock role-folder reads without
// changing the (identityKey, hostId) frontend contract.
//
// The History tab on IdentityModal used to root at ~/fleet/identities/<key>/history.md.
// Post the fleet role/identity migration those folders are empty — the actual
// data lives at ~/fleet/roles/<role>/history.md, and the role is discovered by
// reading `role:` from the identity file's YAML frontmatter.
//
// This test file covers:
//   Task 1 (tests 1-9):  extractRoleFromMarkdown, resolveRoleForIdentity,
//                         getLocalRolesRoot — the three helpers Wave-2 plans reuse.
//   Task 2 (tests 11/13/15): readIdentityHistory now does the two-step internally
//                             on both LOCAL and REMOTE branches; signatures unchanged;
//                             throws propagate.
//                             (Note: former tests 10/12/14/16 covered a companion
//                             reader that was removed in Phase 133 Plan 133-07;
//                             test numbers preserved for git-blame continuity.)
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
// Mock strategy for Task 2 (readIdentityHistory):
//   - Same execCommand mock, but with an implementation that inspects the
//     command string to route responses (identity-file read → frontmatter,
//     history read → payload). This mirrors the same pattern used in
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

  // Regression coverage for the
  // `fleet-status-orchestrator-coupling-with-spawn-request-scanning` e2e-test
  // incident: a hand-authored identity file with a bare `: ` (colon-space)
  // inside a plain YAML scalar in the `task:` value silently broke both the
  // role extraction AND the cosmetics extraction — identity showed up on the
  // frontend with no title, no colorHue, no avatar simultaneously, and there
  // was NO log line to point at the offending file. These tests lock in that
  // both extract functions now emit a WARN via systemLogger before returning
  // the fail-open value, so the failure is visible in the docker forensic
  // trail.
  // Post-tolerant-parse contract (2026-09-24 atlantis-zoho leak fix): a
  // malformed prose field (bare `: ` in a plain YAML scalar — the recurring
  // Pitfall 3 case) no longer collapses the WHOLE frontmatter to null. Fields
  // that parsed cleanly BEFORE the offending line survive. In this test
  // `role:` on line 1 is unaffected by the broken `task:` on line 2 — it
  // still resolves to "box-maintainer". The WARN still fires so the failure
  // remains visible in the docker forensic trail, but the identity-visibility
  // gate on the caller side can now close correctly against the recovered
  // role instead of falling open on `role=null`.
  it("test 5b: recovers role: when a later field has a YAML parse error (tolerant parse)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nrole: box-maintainer\ntask: broken Evidence: extra colon-space here\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("box-maintainer");
    expect(vi.mocked(systemLogger.warn)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(call[0]).toMatch(/tolerant recovery/i);
    const context = call[1] as {
      operation?: string;
      site?: string;
      snippet?: string;
      errorCount?: number;
      firstError?: string;
    };
    expect(context.operation).toBe("frontmatter_yaml_parse_failed");
    expect(context.site).toBe("extractRoleFromMarkdown");
    expect(context.errorCount).toBeGreaterThan(0);
    expect(typeof context.firstError).toBe("string");
    expect(context.snippet).toContain("role: box-maintainer");
    expect((context.snippet ?? "").length).toBeLessThanOrEqual(200);
  });
});

describe("extractCosmeticsFromFrontmatter (malformed-YAML logging — regression for fleet-status-orchestrator-coupling-with-spawn-request-scanning)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Post-tolerant-parse contract (2026-09-24 atlantis-zoho leak fix): fields
  // that parsed cleanly BEFORE the offending line survive into cosmetics.
  // Here `displayName` on line 2 is unaffected by the broken `task:` on
  // line 3 — cosmetics still carry {displayName:"Odin"}. WARN fires so ops
  // sees the broken file. The dropped `task:` field is expected — the
  // narrower rejects the nested-mapping shape the tolerant parser recovers
  // for the broken line, and any consumer inspecting `"task" in cosmetics`
  // gets the "not present" answer, matching the shape-file's
  // absent-⇒-omit invariant.
  it("test 5c: recovers cosmetics that parsed cleanly around a later YAML error (tolerant parse)", () => {
    const md =
      "---\nrole: box-maintainer\ndisplayName: Odin\ntask: bad Evidence: extra colon inside plain scalar\n---\n\n# body";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Odin");
    expect("task" in cos).toBe(false);
    expect(vi.mocked(systemLogger.warn)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(systemLogger.warn).mock.calls[0];
    expect(call[0]).toMatch(/tolerant recovery/i);
    const context = call[1] as {
      operation?: string;
      site?: string;
      snippet?: string;
      errorCount?: number;
      firstError?: string;
    };
    expect(context.operation).toBe("frontmatter_yaml_parse_failed");
    expect(context.site).toBe("extractCosmeticsFromFrontmatter");
    expect(context.errorCount).toBeGreaterThan(0);
    expect(typeof context.firstError).toBe("string");
    expect(context.snippet).toContain("role: box-maintainer");
    expect((context.snippet ?? "").length).toBeLessThanOrEqual(200);
  });

  // Regression coverage for the specific leak the tolerant parse closes: an
  // identity file's `task:` field can contain two `: ` sequences (e.g. a
  // prose sentence with a colon or a nested key-value note). js-yaml threw
  // on that shape → both extractCosmeticsFromFrontmatter and
  // extractRoleFromMarkdown collapsed → role=null → the caller in
  // identities.ts:459 skipped the readRoleCosmeticsMemoized fetch → both
  // sides of the visibility gate fell open (identity-side: no users list;
  // role-side: no role fetched) → the identity became visible to every user
  // regardless of the role's `users: [...]` gate. With the tolerant parse,
  // `role: some-role` on line 1 survives the broken `task:` on line 3,
  // extractRoleFromMarkdown returns "some-role", the caller fetches the role
  // file, and the role-side gate closes the unauthorized viewer out as
  // intended.
  it("test 5j: role: on line 1 survives a broken task: on line 3 (visibility-gate regression)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nrole: some-role\ndisplayName: Alpha\ntask: category: subcategory: another colon (cid: refs)\nusers:\n  - alice\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("some-role");
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Alpha");
    // The broken task: swallows the sibling users: list into its nested
    // mapping recovery, so top-level users is undefined. Documented here as
    // an accepted limitation — the caller closes the leak via the role-side
    // gate (readRoleCosmeticsMemoized(role).users), not via the identity-
    // side users list, once role is extractable.
    expect("users" in cos).toBe(false);
  });

  // Positive coverage for the users-side gate: when the users: list appears
  // BEFORE the offending field, it parses cleanly and the caller's
  // identity-side gate closes directly (no need to fall through to the
  // role-side fetch). Writers should prefer this order for defence in depth.
  it("test 5k: users: BEFORE a broken task: survives into cosmetics (identity-side gate stays authoritative)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nrole: some-role\nusers:\n  - alice\n  - bob\ntask: broken Evidence: extra colon\n---\n\n# body";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.users).toEqual(["alice", "bob"]);
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

  it("test 5f: coerces colorHue from a numeric string (WYSIWYG editors like MDXEditor's frontmatter dialog quote all values on round-trip)", () => {
    const md = "---\ntitle: Skynet\ncolorHue: '324'\navatar: box-maintainer.webp\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.colorHue).toBe(324);
    expect(out.title).toBe("Skynet");
    expect(out.avatar).toBe("box-maintainer.webp");
  });

  it("test 5g: drops a stringified colorHue outside the [0, 359] range", () => {
    const md = "---\ntitle: X\ncolorHue: '999'\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect("colorHue" in out).toBe(false);
    expect(out.title).toBe("X");
  });

  it("test 5h: drops a non-numeric colorHue string", () => {
    const md = "---\ncolorHue: teal\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect("colorHue" in out).toBe(false);
  });

  it("test 5i: coerces coordinator from stringified boolean (same WYSIWYG round-trip case)", () => {
    const md = "---\nrole: box-maintainer\ncoordinator: 'true'\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.coordinator).toBe(true);
  });

  it("test 5j: coerces coordinator: 'false' to boolean false", () => {
    const md = "---\nrole: box-maintainer\ncoordinator: 'false'\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.coordinator).toBe(false);
  });

  it("test 5k: drops coordinator with an arbitrary non-boolean-like string", () => {
    const md = "---\nrole: box-maintainer\ncoordinator: maybe\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect("coordinator" in out).toBe(false);
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
// Task 2 — readIdentityHistory two-step (tests 11 / 13 / 15)
// ──────────────────────────────────────────────────────────────────────
//
// Note: former tests 10 / 12 / 14 / 16 covered a companion reader and were
// removed in Phase 133 Plan 133-07 alongside the deletion of that reader.
// Test numbers preserved to keep git-blame / historical-reference continuity.

describe("readIdentityHistory — two-step", () => {
  // Router for the REMOTE-branch execCommand mock — inspects the command
  // string and returns the appropriate stubbed response. Order-agnostic so
  // the reader's internal call order can evolve without breaking tests.
  //
  // Contract:
  //   - `cat "$HOME/fleet/identities/<key>/<key>.md"` → identity file body
  //   - `cat "$HOME/fleet/roles/<role>/history.md"` → history body
  //
  // Tests assert on the command string via a captured spy so path substitution
  // is verified even when the response is a stub.
  function makeRouter(opts: {
    identityFile?: string;
    historyMd?: string;
  }): (conn: SSHClientType, cmd: string) => Promise<string> {
    return async (_conn, cmd) => {
      if (cmd.includes("fleet/identities/") && cmd.startsWith("cat ")) {
        return opts.identityFile ?? "";
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

  // LOCAL-branch fixture — writes both the identity file (with role: frontmatter)
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

      // Role folder with history
      const roleDir = path.join(rolesRoot, ROLE);
      await fs.mkdir(roleDir, { recursive: true });
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

    it("test 13: readIdentityHistory (LOCAL) reads from ROLES_HOST_DIR/<role>/history.md", async () => {
      const result = await readIdentityHistory(null, KEY);
      expect(result.markdown).toContain("- role entry one");
      expect(result.entries).toEqual(["- role entry one"]);
    });
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

  // Compile-time smoke check: signature stays (SSHClientType|null, string).
  // If a future edit widens the readIdentityHistory signature to accept a
  // third argument, tsc --noEmit (run separately in the verification step)
  // catches it; this runtime test just proves the call compiles + runs.
  it("test 16 (signature smoke): readIdentityHistory accepts (SSHClientType|null, string)", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      makeRouter({ identityFile: "---\nrole: box-maintainer\n---\n" }),
    );
    const conn = {} as SSHClientType;
    // Note: no third argument — proves the signature stays 2-ary.
    const historyPromise: Promise<{
      entries: string[];
      markdown: string;
    }> = readIdentityHistory(conn, "moxie");
    await historyPromise;
  });
});
