/**
 * Phase 22 (SRIC-02) Plan 22-02 Task 3: Tests for the role: frontmatter
 * pre-write branch (Step 2.5) in identity-birth-orchestrator.
 *
 * REVISION 2026-08-04 (Alice, during Task 2 checkpoint): B4b(a) resolution
 * is APPROVED but the relay-register work is SHIFTED OUT of Skynet's birth
 * orchestrator and into the fresh agent's own first-wake flow. Step 2.5
 * now writes ONLY:
 *   (a) ~/fleet/identities/<name>/<name>.md with role: frontmatter + a
 *       SEED COMMENT instructing the wake-up agent to register a relay
 *       account on first wake and remove the comment when done.
 *   (b) ~/fleet/identities/<name>/wakeups/ empty directory
 *   (c) ~/fleet/identities/<name>/handoff.md empty file
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
  // Phase 92 Plan 92-01 Task 2: per-identity-file.ts imports IDENTITY_KEY_RE
  // from identity-artifact-reader (H1 write⇔read parity lock). The primitive
  // is transitively imported by identity-birth-orchestrator's Step 8, so
  // this mocked module MUST export the real regex value (not a stub).
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
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
    // Phase 68 Plan 03: createIdentityRecord + getIdentityRecord removed from
    // BirthDeps — no DB record is created; disk folder + frontmatter + avatar
    // sibling ARE the identity's identity.
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
    // Phase 77 matrix admin foundation deps (Plan 04) — successful-stub defaults
    // so pre-existing tests reach steps 3-5 without hitting Step 6 fail-early.
    // The route handler enforces "creds must exist" via 503; orchestrator-layer
    // tests just need the deps to be callable and return {ok:true}.
    matrixHomeserver: "http://mock.homeserver.local:8008",
    matrixServerName: null,
    // 2026-09-11: fallback branch — relay.json base equals homeserverBase
    // when hostSideBase column is null (single-URL fleets).
    relayJsonHomeserverBase: "http://mock.homeserver.local:8008",
    matrixCreateOrUpdateUser: vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@testkey:mock.homeserver.local",
      password: "mock-agent-password",
      status: 200,
    }),
    matrixLoginAsUser: vi.fn().mockResolvedValue({
      ok: true,
      accessToken: "syt_mock_access_token_test",
      status: 200,
    }),
    buildRelayJsonBody: vi.fn().mockReturnValue({
      base: "http://mock.homeserver.local:8008/_matrix/client/v3",
      user_id: "@testkey:mock.homeserver.local",
      password: "mock-agent-password",
      token: "syt_mock_access_token_test",
      access_token: "syt_mock_access_token_test",
    }),
    // Phase 106 Plan 106-03 (D-05/D-06): wait-for-supervisor sensor. Default
    // returns a non-null jsonl path on the FIRST call so the wait-poll exits
    // immediately with success — the frontmatter tests care about the Step
    // 2.5 identity-file body, not the wait-block cadence.
    discoverIdentitySessionFile: vi
      .fn()
      .mockResolvedValue("/mock/session.jsonl"),
    ...overrides,
  } as BirthDeps;
}

function makeOpts(overrides: Partial<BirthOptions> = {}): BirthOptions {
  return {
    userId: "user-1",
    hostId: 7,
    name: "testkey",
    title: "Test Identity",
    path: "/workspace/testkey",
    colorHue: 210,
    voice: "Joanna",
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

  // Target path: ~/fleet/identities/<name>/<name>.md
  expect(targetPath).toBe("/home/ubuntu/fleet/identities/testkey/testkey.md");

  // Body starts with a frontmatter block whose FIRST key is role: <role>
  // (Phase 66 Plan 66-01 grew this to also emit displayName/title/colorHue/
  //  voice/avatar keys after role, so the assertion no longer checks that
  //  role is followed immediately by ---; it checks that role is the
  //  first key inside the frontmatter block — the post-Phase-A byte-shape-
  //  parity invariant.)
  expect(contents).toMatch(/^---\r?\nrole: box-maintainer\r?\n/);

  // Seed comment REMOVED (REVISION 2026-09-12 Alice): birth flow mints
  // Matrix account server-side (Steps 6-8) before first wake, so the stale
  // "register a Matrix relay account" instruction is no longer emitted.
  expect(contents).not.toContain("This identity has no relay account yet");
  expect(contents).not.toContain("register a Matrix relay account");

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
      c.includes("fleet/identities/testkey/wakeups"),
  );
  expect(mkdirCmd).toBeDefined();

  // touch handoff.md
  const touchCmd = allCmds.find(
    (c) =>
      c.includes("touch") &&
      c.includes("fleet/identities/testkey/handoff.md"),
  );
  expect(touchCmd).toBeDefined();
}, 30_000);

// ---------------------------------------------------------------------------
// Test 14: SSE event types — Phase 106 wire (steps 1/2 + steps 6/7/8; harness
// steps 3/4/5 retired per D-01..D-03).
// ---------------------------------------------------------------------------

it("Test 14: SSE event types — only steps 1/2/6/7/8 on the wire (Phase 106)", async () => {
  const deps = makeDeps();
  const opts = makeOpts();
  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Phase 106 (D-01..D-03): the harness bootstrap steps (3/4/5) are retired
  // from birth — agent-supervisor.sh handles that lifecycle on its 15s tick.
  // Only steps 1, 2, 6, 7, 8 remain on the wire; step:6/7/8 stay for D-12
  // log-forensic breadcrumb parity.
  const stepEvents = events.filter((e) => e.type === "step");
  for (const e of stepEvents) {
    expect([1, 2, 6, 7, 8]).toContain(e.n);
  }
  // 5 steps × 2 phases (started+completed) = 10 step events + 1 ended = 11 events
  expect(events.length).toBe(11);
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(true);
}, 30_000);

// ---------------------------------------------------------------------------
// Test 15: RETIRED (Phase 106 D-02) — Step 5's `/id <name>` send-keys is no
// longer dispatched by the birth orchestrator. The identity's tmux session
// (and the `/id <name>` first-turn) is handled by agent-supervisor.sh on
// its 15s reconcile tick once Skynet has written the identity folder tree.
// ---------------------------------------------------------------------------

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
  // seed comment REMOVED (REVISION 2026-09-12 Alice): birth mints server-side.
  expect(contents).not.toMatch(/<!--[\s\S]*first wake[\s\S]*-->/i);
}, 30_000);

// ---------------------------------------------------------------------------
// CALL ORDER integration test (Test 16 — Phase 106 rewrite):
//   Phase 106 shape:
//     Step 1: on-disk collision probe (SSH exec)
//     Step 2: mkdir -p <path> on target host (NO tmux new-session — retired D-01)
//     Step 2.5: mkdir wakeups + touch handoff.md; then writeMarkdownFileAtomic
//               of identity .md; then writeAvatarSiblingFile
//     Steps 6/7/8: Matrix admin mint + relay.json write (unchanged from Phase 75)
//     Wait for supervisor: discoverIdentitySessionFile poll (new in Phase 106)
//
//   Retired: Step 3 trust-flag write, Step 4 Enter train, Step 5 /id name
//   send-keys — agent-supervisor.sh handles all of that.
// ---------------------------------------------------------------------------

it("Test 16: call ordering (Phase 106) — path-mkdir → wakeups-mkdir + touch handoff → writeMarkdownFileAtomic; no tmux new-session, no trust-flag, no /id send-keys", async () => {
  const executionLog: string[] = [];

  const writeAtomic = vi.fn().mockImplementation(async () => {
    executionLog.push("writeMarkdownFileAtomic");
  });

  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    const s = String(cmd);
    if (s.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    // Retired paths — kept as bookkeeping so a regression that resurrects
    // them gets flagged by the "must not be present" assertions below.
    if (s.includes("tmux new-session")) {
      executionLog.push("tmux-new-session");
    } else if (s.includes("hasTrustDialogAccepted")) {
      executionLog.push("trust-flag");
    } else if (s.includes("dangerously-skip-permissions")) {
      executionLog.push("claude-launch");
    } else if (s.includes("send-keys") && s.includes("/id testkey")) {
      executionLog.push("id-name-sendkeys");
    }

    // Live paths under Phase 106.
    if (s.startsWith("mkdir -p ") && !s.includes("wakeups")) {
      // Step 2's bare mkdir -p on the target path (was combined with tmux
      // before Phase 106 D-01).
      executionLog.push("path-mkdir");
    } else if (s.includes("mkdir -p") && s.includes("wakeups")) {
      // Step 2.5's identity-tree mkdir (wakeups + workspace + touch handoff
      // combined in a single exec).
      executionLog.push("wakeups-mkdir");
      if (s.includes("touch") && s.includes("handoff.md")) {
        executionLog.push("touch-handoff");
      }
    } else if (s.includes("touch") && s.includes("handoff.md")) {
      executionLog.push("touch-handoff");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps({
    writeMarkdownFileAtomic: writeAtomic,
  });

  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });
  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const idx = (name: string) => executionLog.indexOf(name);

  const pathMkdirIdx = idx("path-mkdir");
  const wakeupsIdx = idx("wakeups-mkdir");
  const touchIdx = idx("touch-handoff");
  const writeIdx = idx("writeMarkdownFileAtomic");

  // Step 2's bare mkdir must fire (target path creation, sole survivor of
  // the tmux retirement).
  expect(pathMkdirIdx).toBeGreaterThanOrEqual(0);
  // Step 2.5's wakeups mkdir + touch handoff fire after the bare mkdir.
  expect(wakeupsIdx).toBeGreaterThan(pathMkdirIdx);
  expect(touchIdx).toBeGreaterThan(pathMkdirIdx);
  // writeMarkdownFileAtomic (Step 2.5) fires after the wakeups mkdir + touch.
  expect(writeIdx).toBeGreaterThan(wakeupsIdx);
  expect(writeIdx).toBeGreaterThan(touchIdx);

  // Phase 106 retired paths: NONE of these should have fired.
  expect(idx("tmux-new-session")).toBe(-1);
  expect(idx("trust-flag")).toBe(-1);
  expect(idx("claude-launch")).toBe(-1);
  expect(idx("id-name-sendkeys")).toBe(-1);
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

  // Phase 106: no Step 6/7/8 events emitted after Step 2 failure (harness
  // steps 3/4/5 are retired per D-01..D-03, so this assertion now guards
  // the mint sequence being skipped on Step 2 failure).
  const step6Started = events.find(
    (e) => e.type === "step" && (e as { n: number }).n === 6 && (e as { phase: string }).phase === "started",
  );
  expect(step6Started).toBeUndefined();
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
    voice: "Joanna",
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
  expect(parsed.voice).toBe("Joanna");
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

  // Body shape: frontmatter, H1 heading — same envelope as Test 17 (seed
  // comment removed 2026-09-12 per Alice) but with the extra cosmetic keys.
  expect(contents.startsWith("---\n")).toBe(true);
  expect(contents).toMatch(/---\r?\n\r?\n#\s+testkey/i); // frontmatter closes, blank line, H1
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

it("Test 24a: writeAvatarSiblingFile throws → step:2:failed, mint sequence (6/7/8) never fired", async () => {
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

  // Phase 106: harness steps 3/4/5 are retired. The relevant "later steps
  // don't fire on Step 2 failure" guard now targets the mint sequence
  // (Steps 6/7/8) — those must not start when Step 2 threw.
  const step6Started = events.find(
    (e) => e.type === "step" && (e as { n: number }).n === 6 && (e as { phase: string }).phase === "started",
  );
  expect(step6Started).toBeUndefined();
}, 30_000);

// ---------------------------------------------------------------------------
// Phase 80 Plan 80-03 — task field frontmatter emission
// ---------------------------------------------------------------------------
//
// buildIdentityFileBody must emit `task: <value>` in the frontmatter after
// the `avatar` key when opts.task is a non-empty (after-trim) string. Absent,
// null, empty, or whitespace-only → task key omitted (absent-⇒-omit).
// Task strings containing YAML metacharacters (colons, quotes) must be
// correctly quoted by yaml.dump — round-trip via yaml.load must yield the
// exact input string (T-80-03-01 mitigation).

it("Test T-80-03-a: opts.task present + non-empty → frontmatter contains task after avatar; round-trip preserves value", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    task: "build the pool-pick endpoint" as unknown as never,
  } as unknown as Partial<BirthOptions>);

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  expect(writeAtomic).toHaveBeenCalled();
  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  const parsed = yaml.load(match![1]) as Record<string, unknown>;

  expect(parsed.task).toBe("build the pool-pick endpoint");

  // Ordering: task must come AFTER avatar (avatar always emitted here since candidate has bytes).
  const keys = Object.keys(parsed);
  const avatarIdx = keys.indexOf("avatar");
  const taskIdx = keys.indexOf("task");
  expect(avatarIdx).toBeGreaterThanOrEqual(0);
  expect(taskIdx).toBeGreaterThan(avatarIdx);
}, 30_000);

it("Test T-80-03-b: opts.task = '' (empty string) → NO task: key in frontmatter", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    task: "" as unknown as never,
  } as unknown as Partial<BirthOptions>);

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const parsed = yaml.load(match![1]) as Record<string, unknown>;
  expect("task" in parsed).toBe(false);
}, 30_000);

it("Test T-80-03-c: opts.task = '   ' (whitespace-only) → NO task: key in frontmatter (absent-⇒-omit)", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    task: "   " as unknown as never,
  } as unknown as Partial<BirthOptions>);

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const parsed = yaml.load(match![1]) as Record<string, unknown>;
  expect("task" in parsed).toBe(false);
}, 30_000);

it("Test T-80-03-d: opts.task undefined → NO task: key in frontmatter (backward-compat with pre-Phase-80 callers)", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({ name: "testkey", role: "box-maintainer" });

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const parsed = yaml.load(match![1]) as Record<string, unknown>;
  expect("task" in parsed).toBe(false);
}, 30_000);

it("Test T-80-03-e: task containing colon 'fix the pool: shape gate' → yaml.dump quotes correctly; round-trip preserves exact string (T-80-03-01 mitigation)", async () => {
  const writeAtomic = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({ writeMarkdownFileAtomic: writeAtomic });
  const opts = makeOpts({
    name: "testkey",
    role: "box-maintainer",
    task: "fix the pool: shape gate" as unknown as never,
  } as unknown as Partial<BirthOptions>);

  const { emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const parsed = yaml.load(match![1]) as Record<string, unknown>;
  // Round-trip via yaml.load must yield the exact input (yaml.dump's
  // forceQuotes:false auto-quotes strings containing YAML metacharacters
  // per T-66-01-04 precedent).
  expect(parsed.task).toBe("fix the pool: shape gate");
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

// ---------------------------------------------------------------------------
// Phase 86 Plan 86-04 (D-CTX-86-inherit) — absent-avatar branch coverage
// ---------------------------------------------------------------------------
//
// When opts.avatarCandidateId === "" (route handler's parsedAvatarCandidateId
// empty-string sentinel — see identity-birth.ts), the orchestrator MUST:
//   1. Skip the candidate cache lookup at Step 1 (no throw on empty).
//   2. Write the identity file at Step 2.5 WITHOUT an `avatar:` frontmatter key
//      (buildIdentityFileBody absent-⇒-omit branch).
//   3. NOT invoke writeAvatarSiblingFile (no bytes to write).
// The role's avatar file is served via Plan 86-01's GET /:key/avatar
// role-folder fallback branch; that resolution lives in identities.ts and
// is exercised by identities.get-disk.test.ts, so these tests focus purely
// on the orchestrator-side avatar-write skip + frontmatter emission.

it(
  "Test T-86-04-orch-a: opts.avatarCandidateId='' → NO getCandidateForBirth call, NO writeAvatarSiblingFile call, NO 'avatar:' key in frontmatter",
  async () => {
    const getCandidate = vi.fn().mockImplementation(() => {
      throw new Error("getCandidateForBirth SHOULD NOT be called on absent-avatar path");
    });
    const writeAvatar = vi.fn().mockResolvedValue(undefined);
    const writeAtomic = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      getCandidateForBirth: getCandidate,
      writeAvatarSiblingFile: writeAvatar,
      writeMarkdownFileAtomic: writeAtomic,
    });
    const opts = makeOpts({
      name: "willow",
      role: "box-maintainer",
      avatarCandidateId: "",
    });

    const { events, emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Step 1 completed without invoking the candidate cache
    expect(getCandidate).not.toHaveBeenCalled();
    const step1Done = events.find(
      (e) => e.type === "step" && e.n === 1 && e.phase === "completed",
    );
    expect(step1Done).toBeDefined();

    // Step 2.5 wrote the identity file … (writeAtomic is invoked BOTH at
    // Step 2.5 for the .md AND at Step 8 for relay.json — the first call
    // is always the identity file per Test 16 call-ordering).
    expect(writeAtomic).toHaveBeenCalled();
    const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as Record<string, unknown>;
    // … but with NO avatar: key (absent-⇒-omit invariant).
    expect("avatar" in parsed).toBe(false);
    // Role + displayName still present (unaffected by cosmetic strip).
    expect(parsed.role).toBe("box-maintainer");
    expect(parsed.displayName).toBe("Willow");

    // …and Step 2.5 did NOT invoke writeAvatarSiblingFile (nothing to write).
    expect(writeAvatar).not.toHaveBeenCalled();
  },
  30_000,
);

it(
  "Test T-86-04-orch-b: opts.avatarCandidateId!='' (explicit candidate) still writes avatar sibling + emits 'avatar:' key (regression guard for the explicit-avatar path)",
  async () => {
    // Guards against accidental behaviour change on the pre-Plan-86-04 path
    // when the client DOES send a candidate. The candidate lookup, sibling
    // write, and `avatar: <name>.<ext>` frontmatter emission must all
    // continue to fire.
    const writeAvatar = vi.fn().mockResolvedValue(undefined);
    const writeAtomic = vi.fn().mockResolvedValue(undefined);
    const bytes = Buffer.from("fakepng");
    const deps = makeDeps({
      writeAvatarSiblingFile: writeAvatar,
      writeMarkdownFileAtomic: writeAtomic,
      getCandidateForBirth: vi.fn().mockReturnValue({
        bytes,
        mime: "image/png",
      }),
    });
    const opts = makeOpts({
      name: "willow",
      role: "box-maintainer",
      avatarCandidateId: "cand-legacy",
    });

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(writeAvatar).toHaveBeenCalledTimes(1);
    expect(writeAvatar.mock.calls[0][1]).toBe("willow");
    expect(writeAvatar.mock.calls[0][2]).toBe("png");

    // writeAtomic fires at Step 2.5 (identity .md) AND Step 8 (relay.json)
    // — read the FIRST call for the identity frontmatter body.
    expect(writeAtomic).toHaveBeenCalled();
    const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as Record<string, unknown>;
    expect(parsed.avatar).toBe("willow.png");
  },
  30_000,
);

it(
  "Test T-86-04-orch-c: opts.avatarCandidateId='' + opts.title='' (full cosmetic-inherit shape) → frontmatter has role + displayName only (no title/colorHue/voice/avatar)",
  async () => {
    // The end-to-end shape of a Phase-86 cosmetic-inherit birth: absent
    // title, absent avatar. colorHue null and voice null are already covered
    // by Test 21; this test pins the combined-absence shape landing.
    const writeAtomic = vi.fn().mockResolvedValue(undefined);
    const writeAvatar = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      writeMarkdownFileAtomic: writeAtomic,
      writeAvatarSiblingFile: writeAvatar,
    });
    const opts = makeOpts({
      name: "willow",
      role: "box-maintainer",
      title: "",
      colorHue: null,
      voice: null,
      avatarCandidateId: "",
    });

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // writeAtomic invoked at Step 2.5 for the identity file AND Step 8 for
    // relay.json; first call is always the identity file per Test 16.
    expect(writeAtomic).toHaveBeenCalled();
    const [, , contents] = writeAtomic.mock.calls[0] as [unknown, string, string];
    const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as Record<string, unknown>;

    // Only role + displayName present — all four cosmetics inherit from role.
    expect(parsed.role).toBe("box-maintainer");
    expect(parsed.displayName).toBe("Willow");
    expect("title" in parsed).toBe(false);
    expect("colorHue" in parsed).toBe(false);
    expect("voice" in parsed).toBe(false);
    expect("avatar" in parsed).toBe(false);

    // And no sibling file written.
    expect(writeAvatar).not.toHaveBeenCalled();
  },
  30_000,
);
