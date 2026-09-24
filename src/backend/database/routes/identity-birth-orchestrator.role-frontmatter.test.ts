/**
 * Pure-function tests for the identity-file body builder + role name pattern.
 *
 * Post-2026-09-24 mint-first atomic-birth reshape: the orchestration-level
 * tests that used to live here (Step 2.5 identity file / avatar sibling
 * write sequences, writeMarkdownFileAtomic call assertions, avatar sibling
 * behavior) tested a code path that no longer exists — the identity file
 * body is now embedded in the peer-commit script as a base64 blob, no
 * writeMarkdownFileAtomic dep, no avatar sibling path. The remaining
 * invariants worth pinning are:
 *
 *   - buildIdentityFileBody frontmatter shape (role-first ordering,
 *     absent-⇒-omit for title/colorHue/voice/avatar, task field emission
 *     per Phase 80 Plan 80-03, bodyContent "## Do this first" block per
 *     Phase 127 follow-up).
 *   - ROLE_NAME_PATTERN accepts valid role slugs + rejects invalid ones.
 *
 * Both are pure functions with no orchestrator dependency.
 */

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  buildIdentityFileBody,
  ROLE_NAME_PATTERN,
  type BirthOptions,
} from "./identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<BirthOptions> = {}): BirthOptions {
  return {
    userId: "user-1",
    hostId: 7,
    name: "testkey",
    title: "",
    path: "/workspace/testkey",
    colorHue: null,
    voice: null,
    role: "box-maintainer",
    ...overrides,
  } as BirthOptions;
}

function extractFrontmatter(body: string): Record<string, unknown> {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  return yaml.load(match![1]) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// buildIdentityFileBody — frontmatter shape
// ---------------------------------------------------------------------------

it("full cosmetics present → frontmatter emits role/displayName/title/colorHue/voice in canonical order (no avatar in reshape)", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      title: "Test Identity",
      colorHue: 210,
      voice: "Joanna",
    }),
    "Testkey",
    "", // avatarFilename empty — reshape drops avatar entirely
  );

  const parsed = extractFrontmatter(body);
  const keys = Object.keys(parsed);

  // Canonical ordering — role must be first (post-Phase-A byte-shape parity)
  expect(keys).toEqual(["role", "displayName", "title", "colorHue", "voice"]);
  expect(parsed.role).toBe("box-maintainer");
  expect(parsed.displayName).toBe("Testkey");
  expect(parsed.title).toBe("Test Identity");
  // colorHue standardizes on MDXEditor's quoted-string form
  expect(parsed.colorHue).toBe("210");
  expect(parsed.voice).toBe("Joanna");
  expect("avatar" in parsed).toBe(false);

  expect(body.startsWith("---\n")).toBe(true);
  expect(body).toMatch(/---\r?\n\r?\n#\s+testkey/i);
});

it("absent-⇒-omit — empty title + null colorHue + null voice → those keys NOT present", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      title: "",
      colorHue: null,
      voice: null,
    }),
    "Testkey",
    "",
  );

  const parsed = extractFrontmatter(body);
  expect(Object.keys(parsed)).toEqual(["role", "displayName"]);
  expect("title" in parsed).toBe(false);
  expect("colorHue" in parsed).toBe(false);
  expect("voice" in parsed).toBe(false);
  expect("avatar" in parsed).toBe(false);
});

it("avatarFilename non-empty → avatar: key preserved (backward compat with legacy uploads via SSE frontend)", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer" }),
    "Testkey",
    "testkey.png",
  );

  const parsed = extractFrontmatter(body);
  expect(parsed.avatar).toBe("testkey.png");
});

// ---------------------------------------------------------------------------
// Phase 80 Plan 80-03 — task field
// ---------------------------------------------------------------------------

it("opts.task present + non-empty → frontmatter contains task field with exact value", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", task: "fix pool gate" }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect(parsed.task).toBe("fix pool gate");
});

it("opts.task empty string → NO task key (absent-⇒-omit)", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", task: "" }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect("task" in parsed).toBe(false);
});

it("opts.task whitespace-only → NO task key (absent-⇒-omit)", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", task: "   " }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect("task" in parsed).toBe(false);
});

it("opts.task undefined → NO task key (backward-compat with pre-Phase-80 callers)", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", task: undefined }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect("task" in parsed).toBe(false);
});

it("opts.task containing colon → yaml.dump quotes correctly + round-trip preserves value (T-80-03-01 mitigation)", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      task: "fix the pool: shape gate",
    }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect(parsed.task).toBe("fix the pool: shape gate");
});

// ---------------------------------------------------------------------------
// Phase 127 follow-up — bodyContent "## Do this first" block
// ---------------------------------------------------------------------------

it("opts.bodyContent present + non-empty → body contains ## Do this first block after # <name>", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      bodyContent: "Run the smoke test and report back.",
    }),
    "Testkey",
    "",
  );
  expect(body).toContain("## Do this first");
  expect(body).toContain("Run the smoke test and report back.");
  // Order: # heading THEN ## Do this first
  const headingIdx = body.indexOf("# testkey");
  const doThisFirstIdx = body.indexOf("## Do this first");
  expect(headingIdx).toBeGreaterThan(-1);
  expect(doThisFirstIdx).toBeGreaterThan(headingIdx);
});

it("opts.bodyContent empty string → NO Do this first block", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", bodyContent: "" }),
    "Testkey",
    "",
  );
  expect(body).not.toContain("## Do this first");
});

it("opts.bodyContent whitespace-only → NO Do this first block", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer", bodyContent: "   " }),
    "Testkey",
    "",
  );
  expect(body).not.toContain("## Do this first");
});

it("opts.bodyContent undefined → NO Do this first block", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      bodyContent: undefined,
    }),
    "Testkey",
    "",
  );
  expect(body).not.toContain("## Do this first");
});

// ---------------------------------------------------------------------------
// Phase 129 — creatorUsername auto-tag
// ---------------------------------------------------------------------------

it("creatorUsername absent → NO users: key emitted", () => {
  const body = buildIdentityFileBody(
    makeOpts({ name: "testkey", role: "box-maintainer" }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect("users" in parsed).toBe(false);
});

it("creatorUsername empty-string → NO users: key emitted", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      creatorUsername: "",
    }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect("users" in parsed).toBe(false);
});

it("creatorUsername non-empty → users: [creatorUsername] emitted with case preserved", () => {
  const body = buildIdentityFileBody(
    makeOpts({
      name: "testkey",
      role: "box-maintainer",
      creatorUsername: "Alice",
    }),
    "Testkey",
    "",
  );
  const parsed = extractFrontmatter(body);
  expect(parsed.users).toEqual(["Alice"]);
});

// ---------------------------------------------------------------------------
// ROLE_NAME_PATTERN — pure regex
// ---------------------------------------------------------------------------

describe("ROLE_NAME_PATTERN", () => {
  it("accepts kebab-case single-segment", () => {
    expect(ROLE_NAME_PATTERN.test("box-maintainer")).toBe(true);
  });
  it("accepts kebab-case multi-segment", () => {
    expect(ROLE_NAME_PATTERN.test("hecate-maintainer")).toBe(true);
  });
  it("rejects uppercase", () => {
    expect(ROLE_NAME_PATTERN.test("Box-Maintainer")).toBe(false);
  });
  it("rejects underscore", () => {
    expect(ROLE_NAME_PATTERN.test("box_maintainer")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(ROLE_NAME_PATTERN.test("")).toBe(false);
  });
  it("rejects whitespace", () => {
    expect(ROLE_NAME_PATTERN.test("box maintainer")).toBe(false);
  });
});
