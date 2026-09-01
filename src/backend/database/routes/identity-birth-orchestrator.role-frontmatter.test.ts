/**
 * Phase 22 (SRIC-02) Plan 22-02 Task 3: Tests for the role: frontmatter
 * pre-write branch (Step 2.5) in identity-birth-orchestrator.
 *
 * REVISION 2026-08-04 (Ashley, during Task 2 checkpoint): B4b(a) resolution
 * is APPROVED but the relay-register work is SHIFTED OUT of Skynet's birth
 * orchestrator and into the fresh agent's own first-wake flow. Step 2.5
 * now writes ONLY:
 *   (a) ~/.claude/identities/<name>/<name>.md with role: frontmatter + a
 *       SEED COMMENT instructing the wake-up agent to register a relay
 *       account on first wake and remove the comment when done.
 *   (b) ~/.claude/identities/<name>/wakeups/ empty directory
 *   (c) ~/.claude/identities/<name>/handoff.md empty file
 *
 * The seed comment must:
 *   - NOT say "Skynet" (agents don't know what that is)
 *   - NOT reference id-skill section numbers (§2, §3) or the id-skill path
 *   - Speak in plain terms about registering a Matrix relay account on wake
 *
 * Test coverage (11-19):
 *   11: opts.role missing OR fails ROLE_NAME_PATTERN → step:2:failed
 *   12: writeMarkdownFileAtomic called with correct target path + role:
 *       frontmatter + seed comment; NEVER contains "Skynet"; NEVER contains
 *       §2/§3/"id skill" references.
 *   13: mkdir wakeups + touch handoff.md exec commands fire during Step 2.5
 *   14: No new SSE event types — Step 2.5 runs silently inside Step 2's
 *       completion path (no step 2.5 or step 3+ before Step 3's original slot)
 *   15: Step 5's /id <name> send-keys still fires unchanged (id skill sees
 *       existing file, takes load-existing branch on box side)
 *   17: Identity file body includes the required minimal template:
 *       ---\nrole: <role>\n---\n\n<!-- seed comment -->\n\n# <name>\n
 *   18/19: (Route-level tests handled in identity-birth.test.ts)
 *   CALL ORDER integration: createIdentityRecord → tmux new-session →
 *       writeMarkdownFileAtomic → mkdir/touch → hasTrustDialogAccepted →
 *       Enter train → /id <name> send-keys
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import yaml from "js-yaml";
import type { BirthEvent, BirthOptions, BirthDeps } from "./identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock all external deps BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  writeMarkdownFileAtomic: vi.fn(),
  writeAvatarSiblingFile: vi.fn(),
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  },
  AVATAR_EXT_VALUES: ["webp", "png", "jpg", "gif", "svg"] as const,
  IDMEDIT_MAX_AVATAR_BYTES: 5_000_000,
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import {
  birthIdentity,
  ROLE_NAME_PATTERN,
} from "./identity-birth-orchestrator.js";

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";

const mockConnectOneShot = connectOneShot as unknown as Mock;
const mockExecCommand = execCommand as unknown as Mock;
const mockIsLocalHostId = isLocalHostId as unknown as Mock;

function collectEvents(): { events: BirthEvent[]; emit: (e: BirthEvent) => void } {
  const events: BirthEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function makeDeps(overrides: Partial<BirthDeps> = {}): BirthDeps {
  const mockExecLocal = vi.fn().mockResolvedValue("");

  return {
    connectOneShot: mockConnectOneShot,
    execCommand: mockExecCommand,
    isLocalHostId: mockIsLocalHostId,
    execLocal: mockExecLocal,
    writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
    // Phase 66 Plan 66-01: additive dep — pre-existing tests should not
    // notice this exists (default no-op), Tests 20-24 override it explicitly.
    writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined),
    createIdentityRecord: vi.fn().mockResolvedValue({
      id: "created-id-123",
      identityKey: "testkey",
      colorHue: 210,
      voice: "Elena.wav",
      avatarEtag: "abc123",
    }),
    getIdentityRecord: vi.fn().mockResolvedValue({
      id: "created-id-123",
      identityKey: "testkey",
      colorHue: 210,
      voice: "Elena.wav",
      avatarEtag: "abc123",
    }),
    getCandidateForBirth: vi.fn().mockReturnValue({
      bytes: Buffer.from("fakepng"),
      mime: "image/png",
    }),
    resolveHostById: vi.fn().mockResolvedValue({
      ip: "100.1.2.3",
      port: 22,
      sshPort: 22,
      username: "ubuntu",
      authType: "key",
      key: "fake-key",
    }),
    fsp: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
    ...overrides,
  } as BirthDeps;
}

function makeOpts(overrides: Partial<BirthOptions> = {}): BirthOptions {
  return {
    userId: 1,
    hostId: 7,
    name: "testkey",
    title: "Test Identity",
    path: "/workspace/testkey",
    colorHue: 210,
    voice: "Elena.wav",
    avatarCandidateId: "cand-abc",
    role: "box-maintainer",
    ...overrides,
  } as BirthOptions;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  mockConnectOneShot.mockReset();
  mockExecCommand.mockReset();
  mockIsLocalHostId.mockReset();

  // Default: remote host (Step 2.5 always runs remote-only per plan; local branch
  // has no analogous need since the identity file is being pre-written on the
  // target host — self-birth writes to localhost via the same SSH plumbing).
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  // Default: execCommand returns $HOME for the `echo $HOME` call, empty otherwise
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Exported constant sanity checks
// ---------------------------------------------------------------------------

describe("ROLE_NAME_PATTERN", () => {
  it("accepts kebab-case-lowercase", () => {
    expect(ROLE_NAME_PATTERN.test("box-maintainer")).toBe(true);
    expect(ROLE_NAME_PATTERN.test("tina")).toBe(true);
    expect(ROLE_NAME_PATTERN.test("box2")).toBe(true);
  });

  it("rejects uppercase, spaces, dots, underscores, slashes", () => {
    expect(ROLE_NAME_PATTERN.test("Box-Maintainer")).toBe(false);
    expect(ROLE_NAME_PATTERN.test("box maintainer")).toBe(false);
    expect(ROLE_NAME_PATTERN.test("box.maintainer")).toBe(false);
    expect(ROLE_NAME_PATTERN.test("box_maintainer")).toBe(false);
    expect(ROLE_NAME_PATTERN.test("box/maintainer")).toBe(false);
    expect(ROLE_NAME_PATTERN.test("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 11: opts.role missing OR invalid → step:2:failed
// ---------------------------------------------------------------------------

it("Test 11a: missing opts.role → step failure emitted, no writeMarkdownFileAtomic call", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  // Force role to undefined via cast
  const opts = makeOpts({ role: undefined as unknown as string });

  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(false);
  expect(writeAtomic).not.toHaveBeenCalled();
}, 30_000);

it("Test 11b: opts.role fails ROLE_NAME_PATTERN → step failure, no writeMarkdownFileAtomic", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({ role: "Box_Maintainer" }); // uppercase + underscore → invalid

  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(false);
  expect(writeAtomic).not.toHaveBeenCalled();
}, 30_000);

// ---------------------------------------------------------------------------
// Test 12: writeMarkdownFileAtomic called with correct path + frontmatter + SEED COMMENT
// ---------------------------------------------------------------------------

it("Test 12: writeMarkdownFileAtomic invoked with target path + role: frontmatter + seed comment (no 'Skynet', no §2/§3 refs)", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAtomic).toHaveBeenCalled();
  const [, targetPath, contents] = writeAtomic.mock.calls[0] as [unknown, string, string];

  // Target path: ~/.claude/identities/<name>/<name>.md
  expect(targetPath).toBe("/home/ubuntu/.claude/identities/testkey/testkey.md");

  // Body starts with a frontmatter block whose FIRST key is role: <role>
  // (Phase 66 Plan 66-01 grew this to also emit displayName/title/colorHue/
  //  voice/avatar keys after role, so the assertion no longer checks that
  //  role is followed immediately by ---; it checks that role is the
  //  first key inside the frontmatter block — the post-Phase-A byte-shape-
  //  parity invariant.)
  expect(contents).toMatch(/^---\r?\nrole: box-maintainer\r?\n/);

  // Seed comment assertions — required exact phrases per Ashley's constraints:
  expect(contents).toContain("This identity has no relay account yet");
  expect(contents).toContain("On first wake");
  expect(contents).toContain("register a Matrix relay account");
  expect(contents).toContain("remove this comment");

  // Style constraints — MUST NOT reference internal fleet names or skill sections:
  expect(contents.toLowerCase()).not.toContain("skynet");
  expect(contents).not.toContain("§2");
  expect(contents).not.toContain("§3");
  expect(contents.toLowerCase()).not.toContain("id skill");
  expect(contents.toLowerCase()).not.toContain("id-skill");
}, 30_000);

// ---------------------------------------------------------------------------
// Test 13: mkdir wakeups + touch handoff.md exec commands fire in Step 2.5
// ---------------------------------------------------------------------------

it("Test 13: Step 2.5 execs mkdir wakeups + touch handoff.md via execCommand", async () => {
  const allCmds: string[] = [];
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    allCmds.push(cmd as string);
    if ((cmd as string).trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // mkdir wakeups folder
  const mkdirCmd = allCmds.find(
    (c) =>
      c.includes("mkdir -p") &&
      c.includes(".claude/identities/testkey/wakeups"),
  );
  expect(mkdirCmd).toBeDefined();

  // touch handoff.md
  const touchCmd = allCmds.find(
    (c) =>
      c.includes("touch") &&
      c.includes(".claude/identities/testkey/handoff.md"),
  );
  expect(touchCmd).toBeDefined();
}, 30_000);

// ---------------------------------------------------------------------------
// Test 14: no new SSE event types — Step 2.5 is silent inside Step 2's flow
// ---------------------------------------------------------------------------

it("Test 14: no new SSE event types — Step 2.5 emits nothing extra beyond the existing step:1..5", async () => {
  const deps = makeDeps();
  const opts = makeOpts();
  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Only step:1..5 + ended; no extra "step 2.5" or otherwise-numbered events
  const stepEvents = events.filter((e) => e.type === "step");
  for (const e of stepEvents) {
    expect([1, 2, 3, 4, 5]).toContain(e.n);
  }
  // 5 steps × 2 phases (started+completed) = 10 step events + 1 ended = 11 events
  expect(events.length).toBe(11);
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(true);
}, 30_000);

// ---------------------------------------------------------------------------
// Test 15: Step 5's /id <name> send-keys still fires unchanged
// ---------------------------------------------------------------------------

it("Test 15: Step 5's /id <name> send-keys still fires (unchanged; id skill will take load-existing branch)", async () => {
  const allCmds: string[] = [];
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    allCmds.push(cmd as string);
    if ((cmd as string).trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const idCmd = allCmds.find(
    (c) => c.includes("send-keys") && c.includes("/id testkey"),
  );
  expect(idCmd).toBeDefined();
}, 30_000);

// ---------------------------------------------------------------------------
// Test 17: identity file body includes the required minimal template shape
// ---------------------------------------------------------------------------

it("Test 17: identity file body has ---\\nrole: <role>\\n---, seed comment, and # <name> heading", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAtomic).toHaveBeenCalled();
  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];

  // frontmatter present at start with role as the FIRST key (Phase 66 Plan
  // 66-01: displayName/title/colorHue/voice/avatar now follow role inside
  // the frontmatter block; the role-first ordering is the invariant that
  // preserves post-Phase-A byte-shape parity)
  expect(contents.startsWith("---\nrole: box-maintainer\n")).toBe(true);
  // frontmatter block is closed by --- somewhere later in the body
  expect(contents).toMatch(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  // heading present
  expect(contents).toMatch(/#\s+testkey/i);
  // seed comment present (HTML comment style)
  expect(contents).toMatch(/<!--[\s\S]*first wake[\s\S]*-->/i);
}, 30_000);

// ---------------------------------------------------------------------------
// CALL ORDER integration test (Test 16 in original spec, minus relay register):
//   createIdentityRecord (Step 1)
//   → tmux new-session exec (Step 2)
//   → writeMarkdownFileAtomic (Step 2.5 pre-write)
//   → mkdir + touch execs (Step 2.5)
//   → hasTrustDialogAccepted write exec (Step 3)
//   → tmux send-keys Enter train (Step 4)
//   → /id name send-keys (Step 5)
// ---------------------------------------------------------------------------

it("Test 16: call ordering — createIdentityRecord → tmux new-session → writeMarkdownFileAtomic → mkdir/touch → hasTrustDialogAccepted → Enter train → /id name", async () => {
  const executionLog: string[] = [];

  const mockCreateIdentity = vi.fn().mockImplementation(async () => {
    executionLog.push("createIdentityRecord");
    return {
      id: "created-id-123",
      identityKey: "testkey",
      colorHue: 210,
      voice: "Elena.wav",
      avatarEtag: "abc123",
    };
  });

  const mockGetIdentity = vi.fn().mockImplementation(async () => ({
    id: "created-id-123",
    identityKey: "testkey",
    colorHue: 210,
    voice: "Elena.wav",
    avatarEtag: "abc123",
  }));

  const writeAtomic = vi.fn().mockImplementation(async () => {
    executionLog.push("writeMarkdownFileAtomic");
  });

  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    const s = String(cmd);
    if (s.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    if (s.includes("mkdir") && s.includes("tmux new-session")) {
      executionLog.push("tmux-new-session");
    } else if (s.includes("mkdir -p") && s.includes("wakeups")) {
      // Implementations may combine mkdir+touch into one exec — record both
      // in that case so the ordering assertions still work.
      executionLog.push("mkdir-wakeups");
      if (s.includes("touch") && s.includes("handoff.md")) {
        executionLog.push("touch-handoff");
      }
    } else if (s.includes("touch") && s.includes("handoff.md")) {
      executionLog.push("touch-handoff");
    } else if (s.includes("hasTrustDialogAccepted")) {
      executionLog.push("trust-flag");
    } else if (s.includes("dangerously-skip-permissions")) {
      executionLog.push("claude-launch");
    } else if (s.includes("send-keys") && s.includes("/id testkey")) {
      executionLog.push("id-name-sendkeys");
    } else if (s.includes("send-keys") && s.endsWith(" Enter")) {
      executionLog.push("enter");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps({
    createIdentityRecord: mockCreateIdentity,
    getIdentityRecord: mockGetIdentity,
    writeMarkdownFileAtomic: writeAtomic,
  });

  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });
  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Verify the ordering
  const idx = (name: string) => executionLog.indexOf(name);

  const createIdx = idx("createIdentityRecord");
  const tmuxIdx = idx("tmux-new-session");
  const writeIdx = idx("writeMarkdownFileAtomic");
  const mkdirIdx = idx("mkdir-wakeups");
  const touchIdx = idx("touch-handoff");
  const trustIdx = idx("trust-flag");
  const idIdx = idx("id-name-sendkeys");

  expect(createIdx).toBeGreaterThanOrEqual(0);
  expect(tmuxIdx).toBeGreaterThan(createIdx);
  // writeMarkdownFileAtomic must be AFTER tmux new-session
  expect(writeIdx).toBeGreaterThan(tmuxIdx);
  // mkdir + touch also part of Step 2.5 — both must be after tmux new-session
  expect(mkdirIdx).toBeGreaterThan(tmuxIdx);
  expect(touchIdx).toBeGreaterThan(tmuxIdx);
  // Step 3 (trust-flag) must be after Step 2.5's writes
  expect(trustIdx).toBeGreaterThan(writeIdx);
  expect(trustIdx).toBeGreaterThan(mkdirIdx);
  expect(trustIdx).toBeGreaterThan(touchIdx);
  // Step 5 (/id name) must be last
  expect(idIdx).toBeGreaterThan(trustIdx);
}, 30_000);

// ---------------------------------------------------------------------------
// Test: writeMarkdownFileAtomic failure → step 2 failed, later steps skipped
// ---------------------------------------------------------------------------

it("Test: writeMarkdownFileAtomic throws → step:2:failed, later steps skipped", async () => {
  const writeAtomic = vi.fn().mockRejectedValue(new Error("SFTP failed"));
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts();

  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const failed = events.find(
    (e) => e.type === "step" && e.n === 2 && e.phase === "failed",
  );
  expect(failed).toBeDefined();

  const endedEvent = events.find((e) => e.type === "ended");
  expect((endedEvent as { ok: boolean; failedStep?: number }).failedStep).toBe(2);

  // No Step 3, 4, 5 events emitted after failure
  const step3Started = events.find(
    (e) => e.type === "step" && e.n === 3 && e.phase === "started",
  );
  expect(step3Started).toBeUndefined();
}, 30_000);

// ---------------------------------------------------------------------------
// Phase 66 Plan 66-01 Track 1 — full-cosmetics frontmatter + avatar sibling
// ---------------------------------------------------------------------------
//
// The Step 2.5 identity file body grows from the role-only stub into a full
// cosmetics-carrying frontmatter block so a Skynet-created identity is
// byte-shape-indistinguishable from a Nelly-migrated (Phase A) identity.
//
// Absent-⇒-omit invariant (CONTEXT.md Track 1): fields whose birth-opts
// value is null OR empty-string are NEVER emitted as YAML null / empty —
// they are literally not present as keys in the emitted frontmatter.

it("Test 20: full cosmetics present → frontmatter emits role/displayName/title/colorHue/voice/avatar in canonical order", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const writeAvatar = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({
    writeMarkdownFileAtomic: writeAtomic,
    writeAvatarSiblingFile: writeAvatar,
  });
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    title: "Test Identity",
    colorHue: 210,
    voice: "Elena.wav",
  });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAtomic).toHaveBeenCalled();
  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];

  // Extract frontmatter block via the same regex extractRoleFromMarkdown uses
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  const parsed = yaml.load(match![1]) as Record<string, unknown>;

  // All six keys present with correct values (displayName = capitalize(name))
  expect(parsed.role).toBe("box-maintainer");
  expect(parsed.displayName).toBe("Testkey");
  expect(parsed.title).toBe("Test Identity");
  expect(parsed.colorHue).toBe(210);
  expect(parsed.voice).toBe("Elena.wav");
  expect(parsed.avatar).toBe("testkey.png"); // default candidate mime = image/png

  // Canonical ordering — role must be first (post-Phase-A byte-shape parity)
  const keys = Object.keys(parsed);
  expect(keys).toEqual([
    "role",
    "displayName",
    "title",
    "colorHue",
    "voice",
    "avatar",
  ]);

  // Body shape: frontmatter, seed comment, H1 heading — same envelope as
  // Test 17 but now with the extra cosmetic keys.
  expect(contents.startsWith("---\n")).toBe(true);
  expect(contents).toMatch(/---\r?\n\r?\n<!--/); // frontmatter closes, blank line, seed comment
  expect(contents).toMatch(/#\s+testkey/i);
}, 30_000);

it("Test 21: absent-⇒-omit — empty title + null colorHue + null voice → those keys NOT present in frontmatter", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const writeAvatar = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({
    writeMarkdownFileAtomic: writeAtomic,
    writeAvatarSiblingFile: writeAvatar,
  });
  // NOTE: the HTTP route currently 400s on empty title (identity-birth.ts
  // L190), but the orchestrator's Step 2.5 must still respect absent-⇒-omit
  // as a data-integrity invariant for any future caller that bypasses the
  // route validator (e.g. a CLI ingest or a fleet self-birth path). Route
  // validation and orchestrator validation are independent layers.
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    title: "",           // empty string → OMIT
    colorHue: null,      // null → OMIT
    voice: null,         // null → OMIT
  });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAtomic).toHaveBeenCalled();
  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  const parsed = yaml.load(match![1]) as Record<string, unknown>;

  const keys = Object.keys(parsed);
  // Only role + displayName + avatar (avatar always emitted when bytes present)
  expect(keys).toEqual(["role", "displayName", "avatar"]);
  // Explicit absence checks — no YAML null, no empty string surviving
  expect("title" in parsed).toBe(false);
  expect("colorHue" in parsed).toBe(false);
  expect("voice" in parsed).toBe(false);
}, 30_000);

it("Test 22: writeAvatarSiblingFile invoked exactly once with (conn, name, 'png', candidate.bytes) — ext derived from image/png via MIME_TO_AVATAR_EXT", async () => {
  const writeAvatar = vi.fn().mockResolvedValue(undefined);
  const bytes = Buffer.from("fakepng");
  const deps = makeDeps({
    writeAvatarSiblingFile: writeAvatar,
    getCandidateForBirth: vi.fn().mockReturnValue({
      bytes,
      mime: "image/png",
    }),
  });
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAvatar).toHaveBeenCalledTimes(1);
  const call = writeAvatar.mock.calls[0];
  // (conn, identityKey, ext, bytes)
  expect(call[0]).toBeDefined(); // the mock conn from beforeEach
  expect(call[1]).toBe("testkey");
  expect(call[2]).toBe("png");
  expect(Buffer.isBuffer(call[3])).toBe(true);
  expect((call[3] as Buffer).equals(bytes)).toBe(true);
}, 30_000);

it("Test 23: mime → ext derivation covers webp + jpeg (jpg)", async () => {
  // Sub-case A: image/webp → ext "webp"
  {
    const writeAvatar = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeAvatarSiblingFile: writeAvatar,
      getCandidateForBirth: vi.fn().mockReturnValue({
        bytes: Buffer.from("fakewebp"),
        mime: "image/webp",
      }),
    });
    const opts = makeOpts({ name: "testkey", role: "box-maintainer" });
    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;
    expect(writeAvatar).toHaveBeenCalledTimes(1);
    expect(writeAvatar.mock.calls[0][2]).toBe("webp");
  }

  // Sub-case B: image/jpeg → ext "jpg" (fleet Phase A convention — not "jpeg")
  {
    const writeAvatar = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeAvatarSiblingFile: writeAvatar,
      getCandidateForBirth: vi.fn().mockReturnValue({
        bytes: Buffer.from("fakejpeg"),
        mime: "image/jpeg",
      }),
    });
    const opts = makeOpts({ name: "testkey", role: "box-maintainer" });
    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;
    expect(writeAvatar).toHaveBeenCalledTimes(1);
    expect(writeAvatar.mock.calls[0][2]).toBe("jpg");
  }
}, 30_000);

// Test 24a + 24b (W10 split): avatar write failure surfaces as step:2:failed
// AND the mkdir+touch + writeMarkdownFileAtomic already fired before it — the
// "graceful partial recovery" pin. The partial identity folder is left
// containing <key>.md + wakeups/ + handoff.md even though avatar write failed;
// re-birth is the recovery path (not a rollback we build).

it("Test 24a: writeAvatarSiblingFile throws → step:2:failed, Steps 3/4/5 never fired", async () => {
  const writeAvatar = vi.fn().mockRejectedValue(new Error("SFTP write failed"));
  const deps = makeDeps({ writeAvatarSiblingFile: writeAvatar });
  const opts = makeOpts();

  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const failed = events.find(
    (e) => e.type === "step" && e.n === 2 && e.phase === "failed",
  );
  expect(failed).toBeDefined();

  const endedEvent = events.find((e) => e.type === "ended");
  expect((endedEvent as { ok: boolean; failedStep?: number }).ok).toBe(false);
  expect((endedEvent as { ok: boolean; failedStep?: number }).failedStep).toBe(2);

  // No Steps 3/4/5 after failure
  const step3Started = events.find(
    (e) => e.type === "step" && e.n === 3 && e.phase === "started",
  );
  expect(step3Started).toBeUndefined();
}, 30_000);

it("Test 24b: mkdir+touch fired ONCE + writeMarkdownFileAtomic fired ONCE before the avatar-write throw (partial identity folder preserved)", async () => {
  const callOrder: string[] = [];

  const writeAtomic = vi.fn().mockImplementation(async () => {
    callOrder.push("writeMarkdownFileAtomic");
  });
  const writeAvatar = vi.fn().mockImplementation(async () => {
    callOrder.push("writeAvatarSiblingFile");
    throw new Error("SFTP write failed");
  });

  // Track execCommand invocations that are the Step 2.5 mkdir+touch exec
  // (both are combined into a single `mkdir -p ... && touch ...` per the
  // existing orchestrator body at L484-486).
  let mkdirTouchCount = 0;
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    const s = String(cmd);
    if (s.trim() === "echo $HOME") return Promise.resolve("/home/ubuntu\n");
    if (
      s.includes("mkdir -p") &&
      s.includes("wakeups") &&
      s.includes("touch") &&
      s.includes("handoff.md")
    ) {
      mkdirTouchCount += 1;
      callOrder.push("mkdir+touch");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps({
    writeMarkdownFileAtomic: writeAtomic,
    writeAvatarSiblingFile: writeAvatar,
  });
  const opts = makeOpts();

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Positive ordering: mkdir+touch ran EXACTLY ONCE, then writeMarkdownFileAtomic,
  // then writeAvatarSiblingFile (which threw and aborted the step).
  expect(mkdirTouchCount).toBe(1);
  expect(writeAtomic).toHaveBeenCalledTimes(1);
  expect(writeAvatar).toHaveBeenCalledTimes(1);

  // Call-order array ends with exactly these three, in this order:
  const tail = callOrder.slice(-3);
  expect(tail).toEqual([
    "mkdir+touch",
    "writeMarkdownFileAtomic",
    "writeAvatarSiblingFile",
  ]);
}, 30_000);
