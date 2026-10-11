// ─── identity-artifact-reader — two-step (identity file → role frontmatter → role folder) ─
//
// Phase 22 SRIC-01: verifies the helpers that unlock role-folder reads without
// changing the (identityKey, hostId) frontend contract.
//
// Role assignment lives in the `roles:` key of the identity file's YAML
// frontmatter; role-scoped artifacts live at ~/fleet/roles/<role>/.
//
// This test file covers:
//   Task 1 (tests 1-9):  extractRoleFromMarkdown, resolveRoleForIdentity,
//                         getLocalRolesRoot — the three helpers Wave-2 plans reuse.
//   (Former Task 2 tests 10-16 covered history / companion readers that have
//   since been removed; numbering preserved for git-blame continuity.)
//
// Test framework: vitest (matches every sibling test file in
// src/backend/claude-session/*.test.ts).
//
// Mock strategy for Task 1 (helpers):
//   - Mock ../ssh/tmux-helper.js execCommand so we can stub readIdentityFile's
//     REMOTE `cat` response (tests 6-8) without a real ssh2 exec channel.
//   - Use os.homedir + ROLES_HOST_DIR env var for
//     LOCAL-branch fixtures (test 9).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
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
  extractRolesFromMarkdown,
  extractCosmeticsFromFrontmatter,
  repairFrontmatterTaskLine,
  resolveRoleForIdentity,
  resolveRolesForIdentity,
  flowRolesInYamlDump,
  getLocalRolesRoot,
} from "./identity-artifact-reader.js";

// Shared conformance cases for every `roles:` reader (Python reference, shell
// copies, and this TS reader). Read at test time so the JSON stays the single
// source of truth.
const CASES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../substrate/scripts/tests/fixtures/roles-frontmatter-cases.json",
);
const ROLES_CASES = JSON.parse(fs.readFileSync(CASES_PATH, "utf-8")) as Array<{
  name: string;
  md: string;
  roles: string[];
}>;

describe("extractRolesFromMarkdown — roles-frontmatter-cases.json conformance", () => {
  it("loads the shared case file", () => {
    expect(ROLES_CASES.length).toBeGreaterThan(0);
  });
  it.each(ROLES_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(extractRolesFromMarkdown(c.md)).toEqual(c.roles);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Task 1 — Helper tests (tests 1-9)
// ──────────────────────────────────────────────────────────────────────

describe("extractRoleFromMarkdown", () => {
  it("test 1: returns role name for typical frontmatter block", () => {
    const md = "---\nroles: box-maintainer\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("box-maintainer");
  });

  it("multi-role: a role list yields null (no single role to inherit a look from)", () => {
    expect(
      extractRoleFromMarkdown("---\nroles: [box-maintainer, sky-uat]\n---\n"),
    ).toBeNull();
    expect(
      extractRoleFromMarkdown("---\nroles:\n  - sky-uat\n  - box-maintainer\n---\n"),
    ).toBeNull();
    expect(extractRoleFromMarkdown("---\nroles: a, b\n---\n")).toBeNull();
  });

  it("single-item list and bare scalar both yield that role", () => {
    expect(extractRoleFromMarkdown("---\nroles: [box-maintainer]\n---\n")).toBe(
      "box-maintainer",
    );
    expect(extractRoleFromMarkdown("---\nroles: [b, b]\n---\n")).toBe("b");
  });

  it("singular `role:` key yields no roles (it is no longer read)", () => {
    const md = "---\nrole: box-maintainer\ndisplayName: X\n---\n";
    expect(extractRolesFromMarkdown(md)).toEqual([]);
    expect(extractRoleFromMarkdown(md)).toBeNull();
    expect(extractRolesFromMarkdown("---\nrole: [a, b]\n---\n")).toEqual([]);
  });

  it("numeric / boolean-looking slugs stay strings (no YAML coercion)", () => {
    expect(extractRolesFromMarkdown("---\nroles: [007, true]\n---\n")).toEqual([
      "007",
      "true",
    ]);
  });

  it("extractRolesFromMarkdown: scalar, flow and block shapes all list every role", () => {
    expect(extractRolesFromMarkdown("---\nroles: box-maintainer\n---\n")).toEqual([
      "box-maintainer",
    ]);
    expect(
      extractRolesFromMarkdown("---\nroles: [box-maintainer, sky-uat]\n---\n"),
    ).toEqual(["box-maintainer", "sky-uat"]);
    expect(
      extractRolesFromMarkdown("---\nroles:\n  - sky-uat\n  - box-maintainer\n---\n"),
    ).toEqual(["sky-uat", "box-maintainer"]);
    expect(extractRolesFromMarkdown("---\ntitle: x\n---\n")).toEqual([]);
    expect(extractRolesFromMarkdown("# no frontmatter")).toEqual([]);
  });

  it("test 2: returns null when frontmatter delimiters are missing", () => {
    const md = "# no frontmatter here\n\nroles: box-maintainer\n";
    expect(extractRoleFromMarkdown(md)).toBeNull();
  });

  it("test 3: returns null when frontmatter exists but has no roles: key", () => {
    const md = "---\ntitle: something\nauthor: someone\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBeNull();
  });

  it("test 4: returns null when roles: value is empty or not a valid slug", () => {
    const emptyRole = "---\nroles: \n---\n\n# body";
    expect(extractRoleFromMarkdown(emptyRole)).toBeNull();
    const badRole = "---\nroles: Bad Name\n---\n\n# body";
    expect(extractRoleFromMarkdown(badRole)).toBeNull();
    const mapRole = "---\nroles:\n  a: b\n---\n\n# body";
    expect(extractRoleFromMarkdown(mapRole)).toBeNull();
  });

  it("test 5: handles CRLF line endings in frontmatter delimiters", () => {
    const md = "---\r\nroles: box-maintainer\r\n---\r\n\r\n# body";
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
  it("test 5b: reads roles: even when a later field is broken YAML", () => {
    // The reader is a line scanner (not a YAML parse), so a bad `task:` with an
    // unquoted `: ` can't hide the role and open the visibility gate.
    const md =
      "---\nroles: box-maintainer\ntask: broken Evidence: extra colon-space here\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("box-maintainer");
  });
});

describe("extractCosmeticsFromFrontmatter (malformed-YAML logging — regression for fleet-status-orchestrator-coupling-with-spawn-request-scanning)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Post-tolerant-parse contract (2026-09-24 atlantis-zoho leak fix): fields
  // that parsed cleanly BEFORE the offending line survive into cosmetics.
  // Here `displayName` on line 2 is unaffected by the broken `voice:` on
  // line 3 (an unclosed flow sequence — not repairable the way an unquoted
  // `task:` is). WARN fires so ops sees the broken file; the mis-shaped
  // field is dropped by its narrower.
  it("test 5c: recovers cosmetics that parsed cleanly around a later YAML error (tolerant parse)", () => {
    const md =
      "---\nroles: box-maintainer\ndisplayName: Odin\nvoice: [unclosed\n---\n\n# body";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Odin");
    expect("voice" in cos).toBe(false);
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
    expect(context.snippet).toContain("roles: box-maintainer");
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
  // `roles: some-role` on line 1 survives the broken `task:` on line 3,
  // extractRoleFromMarkdown returns "some-role", the caller fetches the role
  // file, and the role-side gate closes the unauthorized viewer out as
  // intended.
  it("test 5j: roles: on line 1 survives a broken task: on line 3 (visibility-gate regression)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nroles: some-role\ndisplayName: Alpha\ntask: category: subcategory: another colon (cid: refs)\nusers:\n  - alice\n---\n\n# body";
    expect(extractRoleFromMarkdown(md)).toBe("some-role");
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.displayName).toBe("Alpha");
    // repairFrontmatterTaskLine quotes the unquoted task, so the sibling
    // users: list is no longer swallowed into a nested mapping.
    expect(cos.task).toBe("category: subcategory: another colon (cid: refs)");
    expect(cos.users).toEqual(["alice"]);
  });

  it("test 5l: an unquoted task containing ': ' is recovered verbatim, and keys after it survive", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nroles: some-role\ndisplayName: Beta\ntask: Widget 2 — new job platform in Atlas: setup plan\nusers:\n  - alice\nproject: widget-two\n---\n\n# body";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.task).toBe("Widget 2 — new job platform in Atlas: setup plan");
    expect(cos.users).toEqual(["alice"]);
    expect(cos.project).toBe("widget-two");
    expect(vi.mocked(systemLogger.warn)).not.toHaveBeenCalled();
  });

  it("test 5m: repairFrontmatterTaskLine leaves valid, quoted and unrepairable frontmatter unchanged", () => {
    const ok = "roles: a\ntask: plain text";
    expect(repairFrontmatterTaskLine(ok)).toBe(ok);
    const quoted = 'roles: a\ntask: "x: y"';
    expect(repairFrontmatterTaskLine(quoted)).toBe(quoted);
    const unrepairable = "roles: a\ntask: x: y\nvoice: [unclosed";
    expect(repairFrontmatterTaskLine(unrepairable)).toBe(unrepairable);
    expect(repairFrontmatterTaskLine("task: a: b\r\nroles: x")).toBe('task: "a: b"\r\nroles: x');
  });

  // Positive coverage for the users-side gate: when the users: list appears
  // BEFORE the offending field, it parses cleanly and the caller's
  // identity-side gate closes directly (no need to fall through to the
  // role-side fetch). Writers should prefer this order for defence in depth.
  it("test 5k: users: BEFORE a broken task: survives into cosmetics (identity-side gate stays authoritative)", () => {
    vi.mocked(systemLogger.warn).mockClear();
    const md =
      "---\nroles: some-role\nusers:\n  - alice\n  - bob\ntask: broken Evidence: extra colon\n---\n\n# body";
    const cos = extractCosmeticsFromFrontmatter(md);
    expect(cos.users).toEqual(["alice", "bob"]);
  });

  it("test 5d: does NOT log on well-formed frontmatter (log is scoped to parse failures)", () => {
    const md = "---\nroles: box-maintainer\ndisplayName: Odin\n---\n\n# body";
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
    const md = "---\nroles: box-maintainer\ncoordinator: 'true'\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.coordinator).toBe(true);
  });

  it("test 5j: coerces coordinator: 'false' to boolean false", () => {
    const md = "---\nroles: box-maintainer\ncoordinator: 'false'\n---\n\n# body";
    const out = extractCosmeticsFromFrontmatter(md);
    expect(out.coordinator).toBe(false);
  });

  it("test 5k: drops coordinator with an arbitrary non-boolean-like string", () => {
    const md = "---\nroles: box-maintainer\ncoordinator: maybe\n---\n\n# body";
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
    await expect(resolveRoleForIdentity(conn, "moxie")).rejects.toThrow(/no roles/);
  });

  it("test 7: throws when the only role is unsafe (dropped by the slug gate)", async () => {
    // Path traversal / uppercase never survive extractRolesFromMarkdown's
    // slug gate, so the identity resolves to no roles → throw.
    const evilFrontmatter = "---\nroles: ../etc/passwd\n---\n\n# body";
    (execCommand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(evilFrontmatter);
    const conn = {} as SSHClientType;
    await expect(resolveRoleForIdentity(conn, "moxie")).rejects.toThrow(
      /no roles/,
    );
  });

  it("test 7b: throws a multi-role error for an identity with several roles", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "---\nroles: [box-maintainer, sky-uat]\n---\n",
    );
    await expect(resolveRoleForIdentity({} as SSHClientType, "tina")).rejects.toThrow(
      /multiple roles/,
    );
  });

  it("test 7c: throws for a singular `role:` key (not read)", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "---\nrole: box-maintainer\n---\n",
    );
    await expect(resolveRoleForIdentity({} as SSHClientType, "tina")).rejects.toThrow(
      /no roles/,
    );
  });

  it("test 8: returns role string on happy path", async () => {
    const goodFrontmatter = "---\nroles: box-maintainer\n---\n\n# body";
    (execCommand as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(goodFrontmatter);
    const conn = {} as SSHClientType;
    const role = await resolveRoleForIdentity(conn, "tina");
    expect(role).toBe("box-maintainer");
  });
});

describe("resolveRolesForIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every role of a multi-role identity, in file order", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "---\nroles:\n  - sky-uat\n  - box-maintainer\n---\n",
    );
    await expect(resolveRolesForIdentity({} as SSHClientType, "tina")).resolves.toEqual([
      "sky-uat",
      "box-maintainer",
    ]);
  });

  it("throws when the identity has no roles", async () => {
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "---\ntitle: x\n---\n",
    );
    await expect(resolveRolesForIdentity({} as SSHClientType, "tina")).rejects.toThrow(
      /no roles/,
    );
  });
});

describe("flowRolesInYamlDump", () => {
  it("rewrites a js-yaml block list of slugs to the flow form", () => {
    expect(flowRolesInYamlDump("roles:\n  - a\n  - b-c\nx: 1\n")).toBe(
      "roles: [a, b-c]\nx: 1\n",
    );
    expect(flowRolesInYamlDump("x: 1\nroles:\n  - a\n")).toBe("x: 1\nroles: [a]\n");
  });

  it("leaves scalars, quoted items and other keys' lists alone", () => {
    expect(flowRolesInYamlDump("roles: a\n")).toBe("roles: a\n");
    expect(flowRolesInYamlDump("roles:\n  - '007'\n")).toBe("roles:\n  - '007'\n");
    expect(flowRolesInYamlDump("users:\n  - a\n")).toBe("users:\n  - a\n");
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
