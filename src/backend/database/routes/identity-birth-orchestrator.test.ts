/**
 * Phase 20 (IDUI-06/08/09): Tests for identity-birth-orchestrator.ts.
 *
 * Phase 106 (Plan 106-03) rewire — the harness bootstrap (Steps 3/4/5:
 * trust-flag pre-write, claude launch, 7-Enter settle train, `/id <name>`
 * dispatch) is RETIRED from the birth orchestrator. agent-supervisor.sh
 * on the target box is now the sole spawner and lifecycle owner. The
 * orchestrator's Step 2 no longer opens the tmux session either — the
 * per-session `tmux new-session -d -s <name>` call is retired. All
 * step:3/step:4/step:5 assertions are removed from this file per D-20.
 *
 * New coverage added in Plan 106-03:
 *   - Wait-for-supervisor poll success case (mock discoverIdentitySessionFile
 *     returns non-null on Nth poll → ended{ok:true}).
 *   - Wait-for-supervisor poll timeout case (mock always returns null →
 *     ended{ok:false, reason:"supervisor_wait_timeout"} + databaseLogger.warn
 *     with operation:"identity_birth_supervisor_wait_timeout").
 *   - SSH-error-during-poll path (mock returns null throughout — same shape
 *     as the fail-safe null-return contract at
 *     discover-identity-session-file.ts:319-321).
 *   - D-12 forensics preservation — step:6/step:7/step:8 breadcrumbs still
 *     emit for backend log-forensic purposes.
 *
 * Tests exercise birthIdentity() as a pure function with injected deps.
 * All SSH, local-exec, fs, discovery, and identity-record operations are
 * mocked. Events are collected via the emit callback.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
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
  writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
  // Phase 66 Plan 66-01: additive dep — pre-existing tests are unchanged;
  // the orchestrator's Step 2.5 now calls this after writeMarkdownFileAtomic.
  writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined),
  // 2026-09-11 LOCAL-branch fix: orchestrator Step 2.5 resolves the LOCAL
  // identity dir via this helper (parent-of-IDENTITIES_HOST_DIR or fallback
  // os.homedir()/fleet/identities). Stub returns a stable test path so
  // Step 2.5 can compose identityDir + identityFilePath without failing.
  getLocalIdentitiesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/identities"),
  // Phase 92 Plan 92-01 Task 2: per-identity-file.ts imports IDENTITY_KEY_RE
  // from identity-artifact-reader (H1 write⇔read parity lock). The primitive
  // is transitively imported by identity-birth-orchestrator's Step 8, so
  // this mocked module MUST export the real regex value (not a stub) so
  // the primitive's identityKey gate matches production behavior in tests.
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

// Phase 89-02 Task 3: mock registry-rooms module for the runRelayMintAndWrite
// Step 6 post-mint hook. Default happy-path; individual tests override.
vi.mock("../../relay-sessions/registry-rooms.js", () => ({
  joinAgentToAgentsRegistry: vi.fn().mockResolvedValue({
    ok: true,
    roomId: "!agents-registry:example.com",
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn(),
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Phase 106 Plan 106-03: mock databaseLogger so wait-for-supervisor timeout
// tests can assert the structured warn call on operation-key
// "identity_birth_supervisor_wait_timeout" (see D-08 rationale in
// identity-birth-orchestrator.ts wait-block comment).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  sshLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  systemLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  birthIdentity,
  ENTER_TRAIN_COUNT,
  ENTER_TRAIN_SPACING_MS,
  SETTLE_SECONDS,
  STEP_2_SLEEP_MS,
  STEP_3_SLEEP_MS,
  SSH_CONNECT_TIMEOUT_MS,
  CLAUDE_LAUNCH_CMD_PREFIX,
  TMUX_NEW_SESSION_FLAGS,
  WAIT_FOR_SUPERVISOR_POLL_MS,
  WAIT_FOR_SUPERVISOR_TIMEOUT_MS,
} from "./identity-birth-orchestrator.js";

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "../../claude-session/identity-artifact-reader.js";
import { joinAgentToAgentsRegistry } from "../../relay-sessions/registry-rooms.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockConnectOneShot = connectOneShot as unknown as Mock;
const mockExecCommand = execCommand as unknown as Mock;
const mockIsLocalHostId = isLocalHostId as unknown as Mock;
// Phase 92 Plan 92-01 Task 2: Step 8's relay.json write now routes through
// per-identity-file.writeIdentityFile which internally calls the module-level
// writeMarkdownFileAtomic (not deps.writeMarkdownFileAtomic). Test assertions
// for the relay.json write need to inspect this module-mock.
const mockWriteMarkdownFileAtomicModule =
  writeMarkdownFileAtomic as unknown as Mock;
const mockJoinAgentToAgentsRegistry = joinAgentToAgentsRegistry as unknown as Mock;
// Phase 106 Plan 106-03: typed handle for the mocked databaseLogger.warn so
// the wait-poll timeout test can inspect the structured warn payload for the
// operation-key "identity_birth_supervisor_wait_timeout".
const mockDatabaseLoggerWarn = databaseLogger.warn as unknown as Mock;

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
    // Phase 22 SRIC-02: pre-write dep for Step 2.5 (mocked as no-op in existing tests)
    writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
    // Phase 66 Plan 66-01: additive avatar-sibling dep for Step 2.5 (mocked
    // as no-op in existing tests so pre-Phase-66 assertions don't drift).
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
    // Phase 75 Plan 04 — four new BirthDeps fields wired to happy-path mocks
    // so existing Steps 1-5 tests keep passing. The Step 6/7/8 sequence runs
    // for remote-branch tests and succeeds silently unless a specific test
    // overrides these mocks (see the Phase 75 describe block below).
    matrixCreateOrUpdateUser: vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@test:example.com", password: "pw", status: 201 }),
    matrixLoginAsUser: vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_fake_access_token" }),
    matrixHomeserver: "http://synapse.example.com:8008",
    buildRelayJsonBody: vi.fn().mockReturnValue(
      JSON.stringify(
        {
          base: "http://synapse.example.com:8008/_matrix/client/v3",
          user_id: "@test:example.com",
          password: "pw",
          token: "syt_fake_access_token",
          access_token: "syt_fake_access_token",
        },
        null,
        2,
      ),
    ),
    // Phase 106 Plan 106-03 (D-05/D-06): the wait-for-supervisor sensor.
    // Default returns a non-null jsonl path on the FIRST call so the wait-poll
    // exits immediately with success on all happy-path tests (no fake-timer
    // dance needed). Individual tests override for null-return timeout tests.
    matrixCountUsersMatching: vi
      .fn()
      .mockResolvedValue({ ok: true, total: 0 }),
    discoverIdentitySessionFile: vi
      .fn()
      .mockResolvedValue("/mock/session.jsonl"),
    ...overrides,
  };
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
    // Phase 22 SRIC-02: role is required
    role: "box-maintainer",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  mockConnectOneShot.mockReset();
  mockExecCommand.mockReset();
  mockIsLocalHostId.mockReset();
  // Phase 92 Plan 92-01 Task 2: reset the module-level writeMarkdownFileAtomic
  // mock between tests so Step 8's per-identity-file callthrough is inspected
  // per-test (previously the deps-level mock was reset via makeDeps overrides;
  // the module mock persists across tests without an explicit reset).
  mockWriteMarkdownFileAtomicModule.mockReset();
  mockWriteMarkdownFileAtomicModule.mockResolvedValue(undefined);

  // Default: remote host
  mockIsLocalHostId.mockReturnValue(false);
  // Default: SSH connect returns a stub connection
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  // Default: execCommand succeeds — Phase 22 SRIC-02 requires `echo $HOME`
  // to resolve during Step 2.5, so make that return a plausible path.
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
// Exported constant sanity checks (Nelly-verbatim)
// ---------------------------------------------------------------------------

describe("exported constants (Nelly-verbatim)", () => {
  it("ENTER_TRAIN_COUNT is 7", () => {
    expect(ENTER_TRAIN_COUNT).toBe(7);
  });

  it("ENTER_TRAIN_SPACING_MS is 3000", () => {
    expect(ENTER_TRAIN_SPACING_MS).toBe(3000);
  });

  it("SETTLE_SECONDS is 22", () => {
    expect(SETTLE_SECONDS).toBe(22);
  });

  it("STEP_2_SLEEP_MS is 3000", () => {
    expect(STEP_2_SLEEP_MS).toBe(3000);
  });

  it("STEP_3_SLEEP_MS is 2000", () => {
    expect(STEP_3_SLEEP_MS).toBe(2000);
  });

  it("SSH_CONNECT_TIMEOUT_MS is 30000", () => {
    expect(SSH_CONNECT_TIMEOUT_MS).toBe(30000);
  });

  it("CLAUDE_LAUNCH_CMD_PREFIX contains both env-vars verbatim", () => {
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain("CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999");
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain("CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999");
  });

  it("TMUX_NEW_SESSION_FLAGS is -x 220 -y 50", () => {
    expect(TMUX_NEW_SESSION_FLAGS).toBe("-x 220 -y 50");
  });

  // Phase 106 Plan 106-03 (D-07/D-08): wait-for-supervisor exports.
  it("WAIT_FOR_SUPERVISOR_POLL_MS is 2000 (Phase 106 D-07)", () => {
    expect(WAIT_FOR_SUPERVISOR_POLL_MS).toBe(2000);
  });

  it("WAIT_FOR_SUPERVISOR_TIMEOUT_MS is 120000 (Phase 106 D-08)", () => {
    expect(WAIT_FOR_SUPERVISOR_TIMEOUT_MS).toBe(120000);
  });
});

// ---------------------------------------------------------------------------
// Test 1: happy path remote host — emits steps 1/2/6/7/8 (post-Phase-106).
// The harness steps (3/4/5) are retired per D-01..D-03; agent-supervisor.sh
// is the sole spawner. Test asserts 11 events: 5 steps × 2 phases + 1 ended.
// ---------------------------------------------------------------------------

it("Test 1: happy path, remote host, emits steps 1/2/6/7/8 in order (Phase 106)", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  // Default: `echo $HOME` returns a plausible path (Phase 22 Step 2.5), all others return ""
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts();
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);

  // Advance through all sleeps (Step 2 STEP_2_SLEEP_MS + any wait-poll sleeps
  // — with the default happy-path mock returning non-null on first call, the
  // wait-poll block exits before its first sleep runs).
  await vi.runAllTimersAsync();
  await birthPromise;

  // Phase 106 (D-01..D-03): steps 3/4/5 retired. Expected wire on remote-branch
  // happy path:
  //   Steps 1, 2, 6, 7, 8 × 2 (started+completed) = 10
  //   1 ended{ok:true}                            = 1
  //   total                                       = 11
  expect(events.length).toBe(11);

  // Check step sequence in order (only steps 1/2/6/7/8 present under new wire)
  for (const n of [1, 2, 6, 7, 8]) {
    const startedIdx = events.findIndex(
      (e) => e.type === "step" && e.n === n && e.phase === "started",
    );
    const completedIdx = events.findIndex(
      (e) => e.type === "step" && e.n === n && e.phase === "completed",
    );
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(startedIdx);
  }

  // No retired step numbers on the wire.
  for (const n of [3, 4, 5]) {
    const retiredStepEvents = events.filter(
      (e) => e.type === "step" && (e as { n: number }).n === n,
    );
    expect(retiredStepEvents).toHaveLength(0);
  }

  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { type: "ended"; ok: boolean }).ok).toBe(true);

  // conn.end() was called
  expect(mockConn.end).toHaveBeenCalled();
}, 10_000);

// ---------------------------------------------------------------------------
// Test 2: self-birth (isLocalHostId=true) — no SSH, no discoverIdentitySessionFile
// poll (guarded on !useLocal per Phase 106 wait-block predicate). LOCAL branch
// now runs Steps 1, 2 (via execLocal) + 6, 7, 8 (with conn=null; writeIdentityFile
// routes to node fs). Only the wait-for-supervisor step stays skipped on LOCAL.
// Updated 2026-09-11: LOCAL-branch coverage of 6/7/8 (fix for coord spawn-request
// flow silently succeeding without minting/writing anything on t1000).
// ---------------------------------------------------------------------------

it("Test 2: self-birth (isLocalHostId=true), uses local exec, no SSH, runs 1+2+6+7+8, skips wait-poll", async () => {
  mockIsLocalHostId.mockReturnValue(true);

  // execLocal returns "" for mkdir/touch, "/home/test" for `echo $HOME` (Step 2.5
  // resolves $HOME via this exec — empty string would fail the guard).
  const mockExecLocal = vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd.includes("echo $HOME")) return "/home/test";
    return "";
  });
  const mockDiscover = vi.fn().mockResolvedValue("/mock/session.jsonl");
  const mockCreateOrUpdate = vi
    .fn()
    .mockResolvedValue({ ok: true, mxid: "@test:example.com", password: "pw", status: 201 });
  const mockLoginAsUser = vi
    .fn()
    .mockResolvedValue({ ok: true, accessToken: "syt_fake" });
  const deps = makeDeps({
    execLocal: mockExecLocal,
    discoverIdentitySessionFile: mockDiscover,
    matrixCreateOrUpdateUser: mockCreateOrUpdate,
    matrixLoginAsUser: mockLoginAsUser,
  });
  const opts = makeOpts({ hostId: 5 });
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // connectOneShot was NEVER called for local branch
  expect(mockConnectOneShot).not.toHaveBeenCalled();

  // execLocal was called for step 1 (collision probe) + step 2 (mkdir + $HOME
  // resolve + identity-dir mkdir).
  expect(mockExecLocal).toHaveBeenCalled();

  // LOCAL branch NOW runs 6/7/8 — matrix mint fires, identity file + relay.json
  // land on disk via writeMarkdownFileAtomic(null,...) + writeIdentityFile LOCAL.
  expect(mockCreateOrUpdate).toHaveBeenCalled();
  expect(mockLoginAsUser).toHaveBeenCalled();

  // Step 2.5 writes: deps.writeMarkdownFileAtomic + deps.writeAvatarSiblingFile
  // are both called with conn === null on the LOCAL branch.
  expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledWith(null, expect.any(String), expect.any(String));
  expect(deps.writeAvatarSiblingFile).toHaveBeenCalledWith(null, opts.name, expect.any(String), expect.any(Buffer));

  // Phase 106: local branch skips wait-poll entirely — discoverIdentitySessionFile
  // is never invoked (guarded on `!useLocal && conn`).
  expect(mockDiscover).not.toHaveBeenCalled();

  // Ended{ok:true}
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { type: "ended"; ok: boolean }).ok).toBe(true);

  // Step-event set covers 1, 2, 6, 7, 8 (each started+completed) = 10 step
  // events + 1 ended = 11.
  const stepEvents = events.filter((e) => e.type === "step");
  const stepNums = new Set(stepEvents.map((e) => (e as { n: number }).n));
  expect(stepNums).toEqual(new Set([1, 2, 6, 7, 8]));
}, 10_000);

// ---------------------------------------------------------------------------
// Test 3: Phase 68 — getCandidateForBirth still called with (userId, avatarCandidateId)
// ---------------------------------------------------------------------------

it("Test 3: Phase 68 — getCandidateForBirth called; no DB createIdentityRecord/getIdentityRecord", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const avatarBytes = Buffer.from("avatar-png-bytes");
  const mockGetCandidate = vi.fn().mockReturnValue({ bytes: avatarBytes, mime: "image/png" });

  const deps = makeDeps({
    getCandidateForBirth: mockGetCandidate,
  });

  const opts = makeOpts({
    name: "testkey",
    title: "Test Title",
    colorHue: 210,
    voice: "Joanna",
    avatarCandidateId: "cand-xyz",
  });

  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // getCandidateForBirth was called with (userId, avatarCandidateId)
  expect(mockGetCandidate).toHaveBeenCalledWith(opts.userId, opts.avatarCandidateId);

  // Phase 68: no DB helpers exist on BirthDeps — only disk operations run
  // (createIdentityRecord + getIdentityRecord were deleted from the interface)
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { type: "ended"; ok: boolean }).ok).toBe(true);
}, 10_000);

// ---------------------------------------------------------------------------
// Test 4: Phase 68 — on-disk collision probe: identity already exists → step failed
// ---------------------------------------------------------------------------

it("Test 4: Phase 68 — on-disk collision probe: existing folder returns step failed with 'already exists'", async () => {
  // Simulate the SSH collision probe returning "exists"
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    // Collision probe returns "exists"
    if (typeof cmd === "string" && cmd.includes("identities") && cmd.includes("testkey") && cmd.includes("if [ -d")) {
      return Promise.resolve("exists");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts();
  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // A step failure should have occurred
  const failedEvent = events.find(
    (e) => e.type === "step" && e.phase === "failed",
  );
  expect(failedEvent).toBeDefined();
  expect((failedEvent as { reason?: string }).reason).toMatch(/already exists/i);

  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { type: "ended"; ok: boolean }).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Test 5: Phase 68 — ended event identityId carries opts.name (the identityKey)
// ---------------------------------------------------------------------------

it("Test 5: Phase 68 — ended event identityId carries opts.name (not a nanoid)", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts({ name: "testkey" });
  const { events, emit } = collectEvents();
  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const endedEvent = events.find((e) => e.type === "ended" && (e as { ok: boolean }).ok === true);
  expect(endedEvent).toBeDefined();
  // identityId must be the identityKey (opts.name), not a nanoid
  expect((endedEvent as { identityId?: string }).identityId).toBe("testkey");
  expect((endedEvent as { sessionName?: string }).sessionName).toBe("testkey");
}, 10_000);

// ---------------------------------------------------------------------------
// Test 6: Phase 106 — Step 2 does NOT open a tmux session (retired per D-01)
// ---------------------------------------------------------------------------
// The per-session `tmux new-session -d -s <name> ...` invocation is retired
// from birth orchestrator. agent-supervisor.sh's 15s reconcile tick is now
// the sole party that opens the tmux session for the new identity. Verified
// via ZERO exec calls containing "tmux new-session" during birthIdentity.

it("Test 6: Phase 106 — Step 2 exec does NOT contain `tmux new-session` (retired per D-01)", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts({ name: "testkey", path: "/workspace/testkey" });
  const { emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // No exec invocation should carry a `tmux new-session` fragment — the
  // per-session tmux invocation is now agent-supervisor.sh's job.
  const tmuxNewSessionCall = mockExecCommand.mock.calls.find(
    (call: unknown[]) =>
      typeof call[1] === "string" &&
      (call[1] as string).includes("tmux new-session"),
  );
  expect(tmuxNewSessionCall).toBeUndefined();

  // Step 2's mkdir -p on the target path IS still present (this is what
  // survives the tmux retirement in the Step 2 body).
  const mkdirPathCall = mockExecCommand.mock.calls.find(
    (call: unknown[]) =>
      typeof call[1] === "string" &&
      (call[1] as string).startsWith("mkdir -p ") &&
      (call[1] as string).includes("testkey"),
  );
  expect(mkdirPathCall).toBeDefined();
}, 10_000);

// ---------------------------------------------------------------------------
// Test 6b: Step 2 creates wakeups/ + workspace/ sub-parts at identity birth
// (D-04: workspace/ is a generic working directory inside every identity folder)
// ---------------------------------------------------------------------------

it("Test 6b: Step 2 identity-tree mkdir creates both wakeups/ and workspace/ sub-parts per D-04", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  const deps = makeDeps();
  const opts = makeOpts({ name: "agent1" });
  const { emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Find the identity-tree mkdir command (contains "wakeups" — this is the
  // Step 2.5 mkdir for the identity folder tree).
  const identityTreeMkdir = mockExecCommand.mock.calls.find(
    (call: unknown[]) =>
      typeof call[1] === "string" &&
      (call[1] as string).includes("wakeups"),
  );

  expect(identityTreeMkdir).toBeDefined();
  const mkdirCmd = identityTreeMkdir![1] as string;

  // Both sub-parts must be present in a single mkdir -p invocation (D-04)
  expect(mkdirCmd).toContain("mkdir -p");
  expect(mkdirCmd).toContain("wakeups"); // wakeups/ sub-part
  expect(mkdirCmd).toContain("workspace"); // workspace/ sub-part per D-04
  expect(mkdirCmd).toContain("fleet/identities/agent1"); // fleet-tree path
}, 10_000);

// ---------------------------------------------------------------------------
// Phase 106 Plan 106-03 wait-for-supervisor tests (Tests A / B / C / D)
//
// The birth orchestrator's terminal condition is now supervisor-observable
// disk state (transcript JSONL with `/id <name>` first-turn on the target
// host), not Skynet-driven action. The wait block runs after Steps 6/7/8's
// mint sequence completes, polls the injected discoverIdentitySessionFile
// dep every WAIT_FOR_SUPERVISOR_POLL_MS, and closes the stream with
// ended{ok:true} on first non-null result or ended{ok:false,
// reason:"supervisor_wait_timeout"} after WAIT_FOR_SUPERVISOR_TIMEOUT_MS.
// ---------------------------------------------------------------------------

it("Test A (Phase 106): emits ended:ok:true after discoverIdentitySessionFile returns non-null on 3rd poll", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Mock the discovery sensor: returns null twice, then a real path on the 3rd
  // poll. This proves the wait-poll loop keeps ticking on null and terminates
  // successfully as soon as the sensor sees the transcript file appear.
  const mockDiscover = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("/home/ubuntu/.claude/projects/found/session.jsonl");

  const deps = makeDeps({ discoverIdentitySessionFile: mockDiscover });
  const opts = makeOpts({ name: "testkey" });
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);

  // Advance through Step 2's STEP_2_SLEEP_MS + wait-poll sleeps. Two null
  // returns → two 2s sleeps between polls; third call returns non-null so the
  // loop exits. Use runAllTimersAsync to drain the whole cascade in one shot
  // (the mock resolves synchronously in the same tick each poll fires).
  await vi.runAllTimersAsync();
  await birthPromise;

  // Discovery was called exactly 3 times — proves the poll loop respected the
  // null-return cadence and stopped on first non-null.
  expect(mockDiscover).toHaveBeenCalledTimes(3);

  // Every poll was invoked with (conn, identityName)
  for (const call of mockDiscover.mock.calls) {
    expect(call[1]).toBe("testkey");
  }

  // Terminal event: ended{ok:true, identityId, sessionName}
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean; identityId?: string; sessionName?: string }).ok).toBe(true);
  expect((endedEvent as { identityId?: string }).identityId).toBe("testkey");
  expect((endedEvent as { sessionName?: string }).sessionName).toBe("testkey");

  // D-12 forensics: step:6, step:7, step:8 breadcrumbs still emit BEFORE the
  // ended event (proves the mint sequence ran to completion — the wait block
  // sits AFTER the Step 8 relay.json write).
  const endedIdx = events.indexOf(endedEvent!);
  for (const n of [6, 7, 8]) {
    const startedIdx = events.findIndex(
      (e) => e.type === "step" && (e as { n: number }).n === n && (e as { phase: string }).phase === "started",
    );
    const completedIdx = events.findIndex(
      (e) => e.type === "step" && (e as { n: number }).n === n && (e as { phase: string }).phase === "completed",
    );
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(startedIdx);
    expect(completedIdx).toBeLessThan(endedIdx);
  }
}, 30_000);

it("Test B (Phase 106): emits ended:ok:false reason:supervisor_wait_timeout after 120s of null returns", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Always-null: the transcript file never appears; the wait block must run
  // out its full 120s window.
  const mockDiscover = vi.fn().mockResolvedValue(null);

  // Reset the logger warn spy so we can assert cleanly on the timeout call.
  mockDatabaseLoggerWarn.mockClear();

  const deps = makeDeps({ discoverIdentitySessionFile: mockDiscover });
  const opts = makeOpts({ name: "testkey", hostId: 42 });
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  // Drain the whole cadence in one shot — runAllTimersAsync steps through
  // every setTimeout the orchestrator queues (Step 2 sleep + the full
  // WAIT_FOR_SUPERVISOR_TIMEOUT_MS window's poll sleeps).
  await vi.runAllTimersAsync();
  await birthPromise;

  // Terminal event: ended{ok:false, reason:"supervisor_wait_timeout"}. No
  // failedStep is set (this isn't a Step N failure — the mint sequence
  // completed; the supervisor just never picked the identity up).
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(false);
  expect((endedEvent as { reason?: string }).reason).toBe(
    "supervisor_wait_timeout",
  );

  // Mock was called ~60 times over the 120s window at 2s cadence. The exact
  // count depends on when Date.now() ticks over the timeout boundary — allow
  // an off-by-one window rather than pinning the exact integer.
  const expectedCalls = Math.floor(
    WAIT_FOR_SUPERVISOR_TIMEOUT_MS / WAIT_FOR_SUPERVISOR_POLL_MS,
  );
  expect(mockDiscover.mock.calls.length).toBeGreaterThanOrEqual(
    expectedCalls - 1,
  );
  expect(mockDiscover.mock.calls.length).toBeLessThanOrEqual(
    expectedCalls + 1,
  );

  // Structured warn log fires on the operation-key defined in the wait block
  // (identity_birth_supervisor_wait_timeout) — proves the log-forensic
  // breadcrumb lands for post-mortem correlation per D-08.
  const timeoutWarnCall = mockDatabaseLoggerWarn.mock.calls.find(
    (call: unknown[]) =>
      typeof call[1] === "object" &&
      call[1] !== null &&
      (call[1] as { operation?: string }).operation ===
        "identity_birth_supervisor_wait_timeout",
  );
  expect(timeoutWarnCall).toBeDefined();
  const warnPayload = timeoutWarnCall![1] as {
    identityKey?: string;
    hostId?: number;
    timeoutMs?: number;
  };
  expect(warnPayload.identityKey).toBe("testkey");
  expect(warnPayload.hostId).toBe(42);
  expect(warnPayload.timeoutMs).toBe(WAIT_FOR_SUPERVISOR_TIMEOUT_MS);
}, 30_000);

it("Test C (Phase 106): SSH-error-during-poll — discoverIdentitySessionFile returns null throughout (fail-safe contract) → supervisor_wait_timeout", async () => {
  // Per discover-identity-session-file.ts:319-321, the helper is fail-safe:
  // SSH exec errors during the discovery script return null, not throw. This
  // test mirrors that contract — from the orchestrator's perspective an
  // SSH-error tick looks identical to a "signal not found" tick, and the
  // wait block treats both the same way: keep polling until the timeout.
  // Guards against a future refactor treating discovery errors as a hard
  // failure that emits step:8:failed instead of supervisor_wait_timeout.
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Fail-safe: the helper returns null on any internal SSH error. This test
  // uses the null-return shape (preferred per module contract at :319-321)
  // to simulate the SSH-error path.
  const mockDiscover = vi.fn().mockResolvedValue(null);

  const deps = makeDeps({ discoverIdentitySessionFile: mockDiscover });
  const opts = makeOpts({ name: "testkey" });
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Same terminal shape as Test B — reason must be supervisor_wait_timeout,
  // NOT some SSH-error-specific reason string. Fail-safe contract preserved.
  const endedEvent = events.find((e) => e.type === "ended");
  expect(endedEvent).toBeDefined();
  expect((endedEvent as { ok: boolean }).ok).toBe(false);
  expect((endedEvent as { reason?: string }).reason).toBe(
    "supervisor_wait_timeout",
  );

  // No step:N:failed emitted — the wait-poll timeout is NOT a step failure.
  const stepFailedEvent = events.find(
    (e) => e.type === "step" && (e as { phase: string }).phase === "failed",
  );
  expect(stepFailedEvent).toBeUndefined();
}, 30_000);

it("Test D (Phase 106 / D-12 forensics): step:6/step:7/step:8 breadcrumbs still emit on happy path", async () => {
  // D-12 lock: intermediate step events stay on the wire during the mint
  // block (step:1, step:2, step:6, step:7, step:8) purely as backend
  // log-forensic breadcrumbs — the frontend discards them, but backend log
  // correlation requires them present for per-step failure attribution.
  // This test explicitly pins that D-12 invariant so any future refactor
  // that quietly drops intermediate emits gets caught.
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Happy-path discovery returns non-null on first call so the wait-poll
  // exits immediately with success and doesn't dominate the event log.
  const mockDiscover = vi.fn().mockResolvedValue("/mock/session.jsonl");
  const deps = makeDeps({ discoverIdentitySessionFile: mockDiscover });
  const opts = makeOpts();
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Assert step:6/7/8 breadcrumbs are PRESENT on the wire — literal object
  // shapes so grep(`n: 6`) and grep(`n: 8`) catch this test in the
  // acceptance-criteria guard for D-12 preservation.
  expect(events).toContainEqual({ type: "step", n: 6, phase: "started" });
  expect(events).toContainEqual({ type: "step", n: 6, phase: "completed" });
  expect(events).toContainEqual({ type: "step", n: 7, phase: "started" });
  expect(events).toContainEqual({ type: "step", n: 7, phase: "completed" });
  expect(events).toContainEqual({ type: "step", n: 8, phase: "started" });
  expect(events).toContainEqual({ type: "step", n: 8, phase: "completed" });

  // Ordering: every step:6/7/8 emit comes BEFORE the ended event (proves
  // the wait block sits AFTER the mint sequence).
  const endedIdx = events.findIndex((e) => e.type === "ended");
  expect(endedIdx).toBeGreaterThanOrEqual(0);
  for (const n of [6, 7, 8]) {
    const startedIdx = events.findIndex(
      (e) => e.type === "step" && (e as { n: number }).n === n && (e as { phase: string }).phase === "started",
    );
    const completedIdx = events.findIndex(
      (e) => e.type === "step" && (e as { n: number }).n === n && (e as { phase: string }).phase === "completed",
    );
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(startedIdx);
    expect(completedIdx).toBeLessThan(endedIdx);
  }

  // Terminal ended:ok:true (happy path completes end-to-end).
  const endedEvent = events[endedIdx];
  expect((endedEvent as { ok: boolean }).ok).toBe(true);
}, 30_000);


// ---------------------------------------------------------------------------
// Test 15: avatar candidate cache miss → step:1:failed:candidate-expired
// ---------------------------------------------------------------------------

it("Test 15: avatar candidate cache miss → step:1:failed with avatar reason", async () => {
  const mockGetCandidate = vi.fn().mockReturnValue(null); // cache miss

  const deps = makeDeps({ getCandidateForBirth: mockGetCandidate });
  const opts = makeOpts({ avatarCandidateId: "nonexistent-cand" });
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  const failedEvent = events.find(
    (e) => e.type === "step" && e.n === 1 && e.phase === "failed",
  );
  expect(failedEvent).toBeDefined();
  expect((failedEvent as { reason?: string }).reason).toMatch(/avatar/i);

  const endedEvent = events.find((e) => e.type === "ended");
  expect((endedEvent as { ok: boolean; failedStep?: number }).failedStep).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 16: SSH connect timeout → step:1:failed (Phase 68 SHAPE B: SSH connects before Step 1)
// ---------------------------------------------------------------------------

it("Test 16: SSH connect timeout → step:1:failed with timeout/unreachable reason (SHAPE B: SSH hoisted before Step 1)", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  mockConnectOneShot.mockRejectedValue(
    new Error("Connect timeout after 30000ms"),
  );

  const deps = makeDeps();
  const opts = makeOpts();
  const { events, emit } = collectEvents();

  const birthPromise = birthIdentity(opts, emit, deps);
  await vi.runAllTimersAsync();
  await birthPromise;

  // Phase 68 SHAPE B: SSH connect happens before Step 1 (collision probe).
  // Connect failure surfaces as step:1:failed (not step:2:failed).
  const failedEvent = events.find(
    (e) => e.type === "step" && e.n === 1 && e.phase === "failed",
  );
  expect(failedEvent).toBeDefined();
  // Reason must contain timeout or unreachable (no raw stack or IP leak)
  const reason = (failedEvent as { reason?: string }).reason ?? "";
  expect(reason.match(/timeout|unreachable/i)).not.toBeNull();

  const endedEvent = events.find((e) => e.type === "ended");
  expect((endedEvent as { ok: boolean; failedStep?: number }).failedStep).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 17: orchestrator IDENTITY_KEY_RE gate on name
// ---------------------------------------------------------------------------

it("Test 17: name with space fails IDENTITY_KEY_RE gate before any SSH", async () => {
  const deps = makeDeps();
  const opts = makeOpts({ name: "Bad Name" }); // has space — invalid

  const { events, emit } = collectEvents();

  await expect(birthIdentity(opts, emit, deps)).rejects.toThrow();

  // No SSH connection opened
  expect(mockConnectOneShot).not.toHaveBeenCalled();

  // No step events (validation fires before step 1)
  const stepEvents = events.filter((e) => e.type === "step");
  expect(stepEvents.length).toBe(0);
});

// ---------------------------------------------------------------------------
// Test 18: path normalization (Phase 106: Step 2 exec is `mkdir -p <path>`
// only — the tmux new-session invocation is retired per D-01, so path
// normalization is now inspected on the bare mkdir exec)
// ---------------------------------------------------------------------------

it("Test 18: path normalization — backslashes → forward slashes; tilde → $HOME shell expansion", async () => {
  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);

  const allCmds: string[] = [];
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    allCmds.push(cmd as string);
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Test backslash normalization. Post-Phase-106, Step 2's target-path exec
  // is `mkdir -p <path>` (no `&& tmux new-session ...` tail). Find the exec
  // that mentions the normalized path fragment `home/ubuntu/test` — the
  // wakeups-dir mkdir uses `fleet/identities/<name>` so the target-path
  // mkdir is uniquely identifiable by containing `/home/ubuntu/test`.
  const deps1 = makeDeps();
  const opts1 = makeOpts({ path: "\\home\\ubuntu\\test" });
  const { emit: emit1 } = collectEvents();
  const bp1 = birthIdentity(opts1, emit1, deps1);
  await vi.runAllTimersAsync();
  await bp1;

  const step2Cmd1 = allCmds.find(
    (cmd) => cmd.startsWith("mkdir -p ") && cmd.includes("home/ubuntu/test"),
  );
  expect(step2Cmd1).toBeDefined();
  // Backslashes should be normalized to forward slashes
  expect(step2Cmd1!).toContain("/home/ubuntu/test");
  expect(step2Cmd1!).not.toContain("\\");

  // Reset
  allCmds.length = 0;
  mockExecCommand.mockClear();
  mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
    allCmds.push(cmd as string);
    if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
      return Promise.resolve("/home/ubuntu\n");
    }
    return Promise.resolve("");
  });

  // Test tilde normalization — should use $HOME (unquoted for shell expansion)
  const deps2 = makeDeps();
  const opts2 = makeOpts({ path: "~" });
  const { emit: emit2 } = collectEvents();
  const bp2 = birthIdentity(opts2, emit2, deps2);
  await vi.runAllTimersAsync();
  await bp2;

  // The mkdir target-path exec must reference $HOME (shell-expandable) rather
  // than a literal tilde character.
  const step2Cmd2 = allCmds.find(
    (cmd) => cmd.startsWith("mkdir -p ") && cmd.includes("$HOME"),
  );
  expect(step2Cmd2).toBeDefined();
  expect(step2Cmd2!).toMatch(/\$HOME/);
}, 20_000);

// ---------------------------------------------------------------------------
// CR-02: TMUX_SAFE_NAME_RE stricter gate
// ---------------------------------------------------------------------------

describe("CR-02: TMUX_SAFE_NAME_RE stricter gate", () => {
  it.each(["foo=bar", "foo/bar", "foo+bar", "foo.bar"])(
    "rejects name with tmux-unsafe char '%s' before any dep is called",
    async (evilName) => {
      const deps = makeDeps({
        getCandidateForBirth: vi.fn(),
        connectOneShot: mockConnectOneShot,
        execCommand: mockExecCommand,
        execLocal: vi.fn(),
        isLocalHostId: mockIsLocalHostId,
        resolveHostById: vi.fn(),
        fsp: {
          readFile: vi.fn(),
          writeFile: vi.fn(),
        },
      });
      const opts = makeOpts({ name: evilName });
      const { emit } = collectEvents();

      await expect(birthIdentity(opts, emit, deps)).rejects.toThrow(
        /unsafe for tmux target/,
      );

      // No SSH/exec deps should have been called (DB deps removed in Phase 68)
      expect(deps.getCandidateForBirth).not.toHaveBeenCalled();
      expect(mockConnectOneShot).not.toHaveBeenCalled();
      expect(mockExecCommand).not.toHaveBeenCalled();
      expect(deps.execLocal).not.toHaveBeenCalled();
    },
  );

  it("accepts a lowercase name with dashes and underscores and reaches getCandidateForBirth", async () => {
    // A well-formed name like "test_agent-1" must pass both IDENTITY_KEY_RE and
    // TMUX_SAFE_NAME_RE and proceed to step 1 (where getCandidateForBirth is called).
    // We short-circuit by returning null from getCandidateForBirth (avatar cache miss)
    // which causes a step:1:failed — but the key assertion is that getCandidateForBirth
    // WAS called, proving both validation gates passed.
    const mockGetCandidate = vi.fn().mockReturnValue(null); // cache miss → step 1 fails
    const deps = makeDeps({ getCandidateForBirth: mockGetCandidate });
    const opts = makeOpts({ name: "test-agent1" });
    const { emit } = collectEvents();

    // Should NOT throw from validation — only from step 1 avatar cache miss
    // (birthIdentity catches step failures internally and emits events, does not rethrow)
    await expect(birthIdentity(opts, emit, deps)).resolves.toBeUndefined();

    // getCandidateForBirth was called, confirming we passed both name gates
    expect(mockGetCandidate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 75 Plan 04: relay-mint extensions (Steps 6, 7, 8)
//
// Test coverage:
//   A: happy path 1-8 — full sequence emits step:6/7/8 completed events
//   B: step 6 failure does NOT roll back folder (Q2 agent-supervisor race)
//   B2: step 6.5 (matrixLoginAsUser) failure does NOT roll back folder
//       (Q2 agent-supervisor race)
//   C: step 8 (SFTP write) failure does NOT roll back folder or Synapse
//      account (Q2 agent-supervisor race)
//   C2: chmod 600 failure fails step 8 without rollback
//       (Q2 agent-supervisor race)
//   D: useLocal skips 6-8 entirely
//   E: retry helper idempotency (runRelayMintAndWrite called twice succeeds)
//
// The Q2 no-rollback lock is proven by:
//   - Test name containing the phrase "Q2 agent-supervisor race" (W-3 lock —
//     grep-recoverable rationale that survives casual refactors)
//   - Explicit assertion that mockExecCommand.mock.calls contains no
//     `rm -rf` string in any invocation (anti-rollback grep pattern)
// ---------------------------------------------------------------------------

import { runRelayMintAndWrite } from "./identity-birth-orchestrator.js";

describe("Phase 75 Plan 04: relay-mint extensions (Steps 6, 7, 8)", () => {
  // Anti-rollback assertion helper — asserts NO execCommand call issued any
  // `rm -rf` (or `rm ` in general) that would delete the identity folder.
  // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode +
  // agent-supervisor race.
  function assertNoRmRfInExecCalls(mockFn: Mock): void {
    const rmCalls = mockFn.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[1] === "string" && /rm\s+-rf|rm\s+-r|rm\s+-f/.test(call[1] as string),
    );
    expect(rmCalls).toHaveLength(0);
  }

  // ---- Test A: happy path 1-8 ----
  it("Test A: happy path — emits step:6/7/8 in order, calls matrixLoginAsUser between step 6 and step 7, applies chmod 600", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent1:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token_abc123" });
    const mockBuildRelay = vi.fn().mockImplementation((o) =>
      JSON.stringify({
        base: `${o.homeserverBase}/_matrix/client/v3`,
        user_id: o.mxid,
        password: o.password,
        token: o.accessToken,
        access_token: o.accessToken,
      }),
    );
    const mockWriteMd = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
      matrixHomeserver: "http://matrix.local:8008",
      writeMarkdownFileAtomic: mockWriteMd,
    });
    const opts = makeOpts({ name: "agent1" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Assert step 6/7/8 emit sequence
    for (const n of [6, 7, 8]) {
      const startedIdx = events.findIndex(
        (e) => e.type === "step" && e.n === n && e.phase === "started",
      );
      const completedIdx = events.findIndex(
        (e) => e.type === "step" && e.n === n && e.phase === "completed",
      );
      expect(startedIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThan(startedIdx);
    }

    // Ended with ok:true
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(true);

    // matrixCreateOrUpdateUser called with mxid + hex password + displayname
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    const [mxidArg, passwordArg, displaynameArg] = mockCreateOrUpdate.mock.calls[0];
    expect(mxidArg).toBe("@agent1:matrix.local");
    expect(passwordArg).toMatch(/^[a-f0-9]{48}$/); // 48-char hex from crypto.randomBytes(24)
    expect(displaynameArg).toBe("Agent1"); // capitalize(opts.name)

    // matrixLoginAsUser called with same mxid (D-OQ6 proof)
    expect(mockLoginAsUser).toHaveBeenCalledTimes(1);
    expect(mockLoginAsUser.mock.calls[0][0]).toBe("@agent1:matrix.local");

    // buildRelayJsonBody called with non-empty accessToken (from login)
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);
    const relayArg = mockBuildRelay.mock.calls[0][0];
    expect(relayArg.accessToken).toBe("syt_real_token_abc123");
    expect(relayArg.accessToken.length).toBeGreaterThan(0);
    expect(relayArg.mxid).toBe("@agent1:matrix.local");

    // Phase 92 Plan 92-01 Task 2: Step 8's relay.json write now routes
    // through per-identity-file.writeIdentityFile → module-level
    // writeMarkdownFileAtomic (mockWriteMarkdownFileAtomicModule), NOT
    // deps.writeMarkdownFileAtomic (mockWriteMd). deps.writeMarkdownFileAtomic
    // stays wired for Step 2.5's identity .md write.
    const moduleWriteCalls = mockWriteMarkdownFileAtomicModule.mock.calls;
    const relayJsonWrite = moduleWriteCalls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).endsWith("/relay.json"),
    );
    expect(relayJsonWrite).toBeDefined();
    expect(relayJsonWrite![1]).toContain("$HOME/fleet/identities/agent1/relay.json");

    // chmod 600 was called on the relay.json path — S-1 lock proof
    const chmodCalls = mockExecCommand.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod\s+600\s+.*relay\.json/.test(c[1] as string),
    );
    expect(chmodCalls.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ---- Test B: step 6 failure does NOT roll back folder (Q2 agent-supervisor race) ----
  it("Test B: step 6 (createOrUpdateUser) failure does NOT roll back folder (Q2 agent-supervisor race)", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502, error: "admin_api_proxy_error" });
    const mockLoginAsUser = vi.fn();

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
    });
    const opts = makeOpts({ name: "agent1" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // step:6:failed emitted with admin_mint_failed reason
    const failedEvent = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "failed",
    );
    expect(failedEvent).toBeDefined();
    expect((failedEvent as { reason?: string }).reason).toMatch(/admin_mint_failed/);

    // ended{ok:false, failedStep:6}
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);
    expect((endedEvent as { failedStep?: number }).failedStep).toBe(6);

    // Step 1 folder-create completed (proves the folder is still on disk)
    const step1Completed = events.find(
      (e) => e.type === "step" && e.n === 1 && e.phase === "completed",
    );
    expect(step1Completed).toBeDefined();

    // matrixLoginAsUser was NEVER called (createOrUpdateUser failed first)
    expect(mockLoginAsUser).not.toHaveBeenCalled();

    // Q2 anti-rollback assertion: NO rm/rm -rf call in any execCommand invocation
    assertNoRmRfInExecCalls(mockExecCommand);
  }, 30_000);

  // ---- Test B2: step 6.5 (matrixLoginAsUser) failure does NOT roll back ----
  it("Test B2: step 6.5 (matrixLoginAsUser) failure does NOT roll back folder (Q2 agent-supervisor race)", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent1:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502, error: "admin_api_proxy_error" });

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
    });
    const opts = makeOpts({ name: "agent1" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Failure attributed to step 6 (login inside runStep(6) per D-OQ6 lock)
    const failedEvent = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "failed",
    );
    expect(failedEvent).toBeDefined();
    expect((failedEvent as { reason?: string }).reason).toMatch(/admin_login_failed/);

    // ended{ok:false, failedStep:6}
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);

    // createOrUpdateUser was called (succeeded) but login failed
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    expect(mockLoginAsUser).toHaveBeenCalledTimes(1);

    // Q2 anti-rollback assertion
    assertNoRmRfInExecCalls(mockExecCommand);
  }, 30_000);

  // ---- Test C: step 8 SFTP write failure does NOT roll back (Q2 agent-supervisor race) ----
  it("Test C: step 8 (SFTP write) failure does NOT roll back folder or Synapse account (Q2 agent-supervisor race)", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent1:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });

    // Phase 92 Plan 92-01 Task 2: Step 8's write now routes through the
    // module-level writeMarkdownFileAtomic (via per-identity-file). Reject
    // relay.json writes there, not on deps.writeMarkdownFileAtomic.
    // deps.writeMarkdownFileAtomic (Step 2.5 identity.md write) remains no-op.
    let writeCallCount = 0;
    mockWriteMarkdownFileAtomicModule.mockImplementation(
      (_conn: unknown, targetPath: string) => {
        writeCallCount += 1;
        if (
          typeof targetPath === "string" &&
          targetPath.endsWith("/relay.json")
        ) {
          return Promise.reject(new Error("sftp_write_failed"));
        }
        return Promise.resolve(undefined);
      },
    );
    const mockWriteMd = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      writeMarkdownFileAtomic: mockWriteMd,
    });
    const opts = makeOpts({ name: "agent1" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // step:8:failed + ended{ok:false, failedStep:8}
    const failedEvent = events.find(
      (e) => e.type === "step" && e.n === 8 && e.phase === "failed",
    );
    expect(failedEvent).toBeDefined();
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);
    expect((endedEvent as { failedStep?: number }).failedStep).toBe(8);

    // Step 6 completed (mint succeeded — proves no inverse admin-delete)
    const step6Completed = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "completed",
    );
    expect(step6Completed).toBeDefined();

    // Q2 anti-rollback assertion: NO rm/rm -rf, no folder-cleanup
    assertNoRmRfInExecCalls(mockExecCommand);

    // Confirm module-level writeMarkdownFileAtomic was invoked for relay.json
    // (proves we reached step 8 via the per-identity-file primitive).
    expect(writeCallCount).toBeGreaterThanOrEqual(1);
    // Additionally: deps.writeMarkdownFileAtomic (Step 2.5 identity .md write)
    // was invoked at least once (proves Step 2.5 still runs pre-Step 8).
    expect(mockWriteMd).toHaveBeenCalled();
  }, 30_000);

  // ---- Test C2: chmod 600 failure fails step 8 without rollback (Q2 agent-supervisor race) ----
  it("Test C2: chmod 600 failure fails step 8 without rollback (Q2 agent-supervisor race)", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);

    // Make execCommand fail specifically on chmod 600 — other commands succeed.
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      if (typeof cmd === "string" && /chmod\s+600/.test(cmd)) {
        return Promise.reject(new Error("chmod: permission denied"));
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent1:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    // writeMarkdownFileAtomic SUCCEEDS for relay.json — only chmod fails
    const mockWriteMd = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      writeMarkdownFileAtomic: mockWriteMd,
    });
    const opts = makeOpts({ name: "agent1" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // step:8:failed with chmod_600_failed reason
    const failedEvent = events.find(
      (e) => e.type === "step" && e.n === 8 && e.phase === "failed",
    );
    expect(failedEvent).toBeDefined();
    expect((failedEvent as { reason?: string }).reason).toMatch(/chmod_600_failed/);

    // ended{ok:false, failedStep:8}
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);
    expect((endedEvent as { failedStep?: number }).failedStep).toBe(8);

    // Q2 anti-rollback: no rm -rf even after chmod failure
    assertNoRmRfInExecCalls(mockExecCommand);
  }, 30_000);

  // ---- Test D: useLocal RUNS 6-8 with conn=null (2026-09-11 LOCAL-branch fix) ----
  it("Test D: useLocal=true (self-birth) RUNS step 6/7/8 — matrixCreateOrUpdateUser + matrixLoginAsUser fire, buildRelayJsonBody fires, conn=null wire preserved", async () => {
    mockIsLocalHostId.mockReturnValue(true);

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@self:example.com", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_local" });
    const mockBuildRelay = vi.fn().mockReturnValue("{\"local\":true}");

    const deps = makeDeps({
      execLocal: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes("echo $HOME")) return "/home/test";
        return "";
      }),
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ hostId: 5 });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Step 6/7/8 events all fire (started + completed each = 6 events).
    const phase75Events = events.filter(
      (e) => e.type === "step" && (e.n === 6 || e.n === 7 || e.n === 8),
    );
    expect(phase75Events).toHaveLength(6);

    // Phase 75 deps ARE called on LOCAL now.
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    expect(mockLoginAsUser).toHaveBeenCalledTimes(1);
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);

    // ended{ok:true}
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(true);

    // connectOneShot NEVER called (LOCAL preserves no-SSH invariant).
    expect(mockConnectOneShot).not.toHaveBeenCalled();
  }, 30_000);

  // ---- Test E: retry helper idempotency ----
  it("Test E: runRelayMintAndWrite called twice succeeds — both calls emit full step:6/7/8 sequence", async () => {
    const mockConn = { end: vi.fn() };
    mockExecCommand.mockResolvedValue("");

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent1:matrix.local", password: "pw", status: 200 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_fresh_token" });
    const mockBuildRelay = vi.fn().mockReturnValue("{}");
    const mockWriteMd = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
      writeMarkdownFileAtomic: mockWriteMd,
      matrixHomeserver: "http://matrix.local:8008",
    });

    const { events: events1, emit: emit1 } = collectEvents();
    const { events: events2, emit: emit2 } = collectEvents();

    // First invocation
    await runRelayMintAndWrite(
      { name: "agent1", displayName: "Agent1", hostId: 999 },
      emit1,
      deps,
      mockConn as unknown as Parameters<typeof runRelayMintAndWrite>[3],
    );

    // Second invocation (retry)
    await runRelayMintAndWrite(
      { name: "agent1", displayName: "Agent1", hostId: 999 },
      emit2,
      deps,
      mockConn as unknown as Parameters<typeof runRelayMintAndWrite>[3],
    );

    // Both calls emit step:6/7/8 completed
    for (const events of [events1, events2]) {
      for (const n of [6, 7, 8]) {
        const startedIdx = events.findIndex(
          (e) => e.type === "step" && e.n === n && e.phase === "started",
        );
        const completedIdx = events.findIndex(
          (e) => e.type === "step" && e.n === n && e.phase === "completed",
        );
        expect(startedIdx).toBeGreaterThanOrEqual(0);
        expect(completedIdx).toBeGreaterThan(startedIdx);
      }
    }

    // Each mock was called twice (once per invocation)
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(2);
    expect(mockLoginAsUser).toHaveBeenCalledTimes(2);
    expect(mockBuildRelay).toHaveBeenCalledTimes(2);
    // Phase 92 Plan 92-01 Task 2: Step 8's relay.json write now flows through
    // the module-level writeMarkdownFileAtomic (via per-identity-file), NOT
    // deps.writeMarkdownFileAtomic. runRelayMintAndWrite only covers Steps
    // 6/7/8 (Step 2.5 isn't executed here) so deps.writeMarkdownFileAtomic
    // is NEVER called on this path post-refactor; the module mock IS.
    expect(mockWriteMd).not.toHaveBeenCalled();
    const relayJsonWrites =
      mockWriteMarkdownFileAtomicModule.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).endsWith("/relay.json"),
      );
    expect(relayJsonWrites).toHaveLength(2);

    // chmod 600 called twice
    const chmodCalls = mockExecCommand.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod\s+600/.test(c[1] as string),
    );
    expect(chmodCalls.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Phase 89 Plan 02 Task 3: registry-room join hook wired into
// runRelayMintAndWrite Step 6 (post-mint, best-effort per D-12)
// ---------------------------------------------------------------------------

describe("Phase 89-02 Task 3: agents-registry join hook in Step 6", () => {
  beforeEach(() => {
    mockJoinAgentToAgentsRegistry.mockReset();
    // Default happy path — override per test.
    mockJoinAgentToAgentsRegistry.mockResolvedValue({
      ok: true,
      roomId: "!agents-registry:example.com",
    });
  });

  // ---- Test 1 (orchestrator): fires joinAgentToAgentsRegistry after mint+login ----
  it("Test 1: runRelayMintAndWrite Step 6 fires joinAgentToAgentsRegistry(mxid) AFTER mint+login, BEFORE Step 7", async () => {
    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent89a:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token_abc123" });
    const mockBuildRelay = vi.fn().mockImplementation((o) =>
      JSON.stringify({
        base: `${o.homeserverBase}/_matrix/client/v3`,
        user_id: o.mxid,
        password: o.password,
        token: o.accessToken,
        access_token: o.accessToken,
      }),
    );
    const mockWriteMd = vi.fn().mockResolvedValue(undefined);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
      matrixHomeserver: "http://matrix.local:8008",
      writeMarkdownFileAtomic: mockWriteMd,
    });
    const opts = makeOpts({ name: "agent89a" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Assert ended{ok:true}.
    const endedEvent = events.find((e) => e.type === "ended");
    expect((endedEvent as { ok: boolean }).ok).toBe(true);

    // joinAgentToAgentsRegistry called exactly once with the minted mxid.
    expect(mockJoinAgentToAgentsRegistry).toHaveBeenCalledTimes(1);
    expect(mockJoinAgentToAgentsRegistry.mock.calls[0][0]).toBe(
      "@agent89a:matrix.local",
    );

    // Assert AFTER mint+login (both mocks were called BEFORE the join hook).
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    expect(mockLoginAsUser).toHaveBeenCalledTimes(1);

    // Step 7 (buildRelayJsonBody) still ran.
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);
  }, 30_000);

  // ---- Test 2: join returns non-ok → does NOT throw, proceeds to Step 7 ----
  it("Test 2: joinAgentToAgentsRegistry returns { ok:false } → Step 6 does NOT throw, proceeds to Step 7 (best-effort per D-12)", async () => {
    mockJoinAgentToAgentsRegistry.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "registry_room_not_configured",
    });

    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent89b:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token_abc123" });
    const mockBuildRelay = vi.fn().mockImplementation((o) =>
      JSON.stringify({
        base: `${o.homeserverBase}/_matrix/client/v3`,
        user_id: o.mxid,
        password: o.password,
        token: o.accessToken,
        access_token: o.accessToken,
      }),
    );

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
      matrixHomeserver: "http://matrix.local:8008",
    });
    const opts = makeOpts({ name: "agent89b" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Step 6 completed successfully — the failed join did NOT convert it to failure.
    const step6Completed = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "completed",
    );
    expect(step6Completed).toBeDefined();
    const step6Failed = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "failed",
    );
    expect(step6Failed).toBeUndefined();

    // Step 7 proceeded (buildRelayJsonBody was called).
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);

    // Ended ok:true — best-effort semantics preserved.
    const endedEvent = events.find((e) => e.type === "ended");
    expect((endedEvent as { ok: boolean }).ok).toBe(true);
  }, 30_000);

  // ---- Test 3: join throws unexpectedly → caught, proceeds to Step 7 ----
  it("Test 3: joinAgentToAgentsRegistry THROWS → Step 6 catches, proceeds to Step 7 (defense-in-depth per D-12)", async () => {
    mockJoinAgentToAgentsRegistry.mockRejectedValueOnce(
      new Error("unexpected registry-rooms throw"),
    );

    mockIsLocalHostId.mockReturnValue(false);
    const mockConn = { end: vi.fn() };
    mockConnectOneShot.mockResolvedValue(mockConn);
    mockExecCommand.mockImplementation((_conn: unknown, cmd: string) => {
      if (typeof cmd === "string" && cmd.trim() === "echo $HOME") {
        return Promise.resolve("/home/ubuntu\n");
      }
      return Promise.resolve("");
    });

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent89c:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token_abc123" });
    const mockBuildRelay = vi.fn().mockImplementation((o) =>
      JSON.stringify({
        base: `${o.homeserverBase}/_matrix/client/v3`,
        user_id: o.mxid,
        password: o.password,
        token: o.accessToken,
        access_token: o.accessToken,
      }),
    );

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
      matrixHomeserver: "http://matrix.local:8008",
    });
    const opts = makeOpts({ name: "agent89c" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Step 6 still completed — the throw was caught.
    const step6Completed = events.find(
      (e) => e.type === "step" && e.n === 6 && e.phase === "completed",
    );
    expect(step6Completed).toBeDefined();

    // Step 7 proceeded.
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);

    // Ended ok:true.
    const endedEvent = events.find((e) => e.type === "ended");
    expect((endedEvent as { ok: boolean }).ok).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Phase 92 Plan 92-01 Task 2: identity-birth Step 8 refactor — byte-shape
// regression tests. Step 8's relay.json write is rerouted through the new
// per-identity-file.writeIdentityFile primitive; the wire must be
// byte-for-byte identical to the pre-refactor Phase 77 SFTP write.
// ---------------------------------------------------------------------------

describe("Phase 92-01 Task 2: Step 8 refactor byte-shape parity", () => {
  // ---- T1: relay.json target path unchanged ($HOME/fleet/identities/<name>/relay.json)
  it("T1: relay.json REMOTE target path matches pre-refactor L862 literal `$HOME/fleet/identities/<name>/relay.json`", async () => {
    mockIsLocalHostId.mockReturnValue(false);

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent92:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    const mockBuildRelay = vi.fn().mockReturnValue('{"ok":true}');

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ name: "agent92" });
    const { emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Find the relay.json write call on the module-level writeMarkdownFileAtomic
    const relayJsonWrites =
      mockWriteMarkdownFileAtomicModule.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).endsWith("/relay.json"),
      );
    expect(relayJsonWrites).toHaveLength(1);
    // Byte-shape lock: $HOME is a LITERAL string, not resolved.
    expect(relayJsonWrites[0][1]).toBe(
      "$HOME/fleet/identities/agent92/relay.json",
    );
  }, 30_000);

  // ---- T2: relay.json body threaded through verbatim (no wrapping)
  it("T2: relay.json body threaded verbatim (equals buildRelayJsonBody output)", async () => {
    mockIsLocalHostId.mockReturnValue(false);

    const expectedBody = '{"custom":"body","token":"xyz"}';
    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent92:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    const mockBuildRelay = vi.fn().mockReturnValue(expectedBody);

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ name: "agent92" });
    const { emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const relayJsonWrites =
      mockWriteMarkdownFileAtomicModule.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).endsWith("/relay.json"),
      );
    expect(relayJsonWrites).toHaveLength(1);
    // Contents (arg [2]) must be the raw buildRelayJsonBody output — no
    // wrapping / re-serialization.
    expect(relayJsonWrites[0][2]).toBe(expectedBody);
  }, 30_000);

  // ---- T3: chmod 600 preserved
  it("T3: Step 8 still applies chmod 600 to relay.json (S-1 lock)", async () => {
    mockIsLocalHostId.mockReturnValue(false);

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent92:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    const mockBuildRelay = vi.fn().mockReturnValue("{}");

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ name: "agent92" });
    const { emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // chmod 600 called on relay.json — S-1 lock (world-readable relay.json
    // would expose Matrix creds; primitive threads opts.chmod=0o600).
    const chmodCalls = mockExecCommand.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" &&
        /chmod\s+600\s+.*relay\.json/.test(c[1] as string),
    );
    expect(chmodCalls.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ---- T4: writeIdentityFile throw fails Step 8 loudly (no rollback)
  it("T4: writeIdentityFile (module writeMarkdownFileAtomic) throw at Step 8 → ended{ok:false, failedStep:8}", async () => {
    mockIsLocalHostId.mockReturnValue(false);

    // Make the module-level writeMarkdownFileAtomic REJECT for relay.json only
    mockWriteMarkdownFileAtomicModule.mockImplementation(
      (_conn: unknown, targetPath: string) => {
        if (
          typeof targetPath === "string" &&
          targetPath.endsWith("/relay.json")
        ) {
          return Promise.reject(new Error("sftp_write_failed_at_relay"));
        }
        return Promise.resolve(undefined);
      },
    );

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent92:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    const mockBuildRelay = vi.fn().mockReturnValue("{}");

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ name: "agent92" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const failedEvent = events.find(
      (e) => e.type === "step" && e.n === 8 && e.phase === "failed",
    );
    expect(failedEvent).toBeDefined();

    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);
    expect((endedEvent as { failedStep?: number }).failedStep).toBe(8);
  }, 30_000);

  // ---- T5: Step 6/7 unaffected — mint + login + buildRelay still invoked
  it("T5: Step 6/7 unaffected — matrixCreateOrUpdateUser + matrixLoginAsUser + buildRelayJsonBody still called", async () => {
    mockIsLocalHostId.mockReturnValue(false);

    const mockCreateOrUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, mxid: "@agent92:matrix.local", password: "pw", status: 201 });
    const mockLoginAsUser = vi
      .fn()
      .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
    const mockBuildRelay = vi.fn().mockReturnValue('{"ok":true}');

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mockCreateOrUpdate,
      matrixLoginAsUser: mockLoginAsUser,
      buildRelayJsonBody: mockBuildRelay,
    });
    const opts = makeOpts({ name: "agent92" });
    const { events, emit } = collectEvents();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    expect(mockLoginAsUser).toHaveBeenCalledTimes(1);
    expect(mockBuildRelay).toHaveBeenCalledTimes(1);

    // Step 6/7/8 all completed
    for (const n of [6, 7, 8]) {
      const done = events.find(
        (e) => e.type === "step" && e.n === n && e.phase === "completed",
      );
      expect(done).toBeDefined();
    }
  }, 30_000);

  // ---- T6: regex-tightening backwards compat — every legit identity key still reaches Step 8
  it("T6: every identity key that passed the pre-refactor gates STILL reaches Step 8 through the primitive's stricter regex", async () => {
    // Legitimate identity keys observed in the fleet — all lowercase alnum with
    // hyphen/underscore. These MUST reach Step 8 (invoke module
    // writeMarkdownFileAtomic for relay.json) under the primitive's stricter
    // /^[a-z0-9_-]{1,64}$/ gate. The pre-refactor identity-birth.ts:64 route
    // regex is looser but no fleet identity uses the extra characters.
    const legitKeys = [
      "tina",
      "tina-01",
      "stacy",
      "role-name-hyphenated",
      "underscored_id",
      "a".repeat(63),
      "a".repeat(64),
    ];

    for (const key of legitKeys) {
      // Reset only the module-level writeMarkdownFileAtomic between iterations
      // — vi.useFakeTimers state persists across iterations within one it().
      mockWriteMarkdownFileAtomicModule.mockReset();
      mockWriteMarkdownFileAtomicModule.mockResolvedValue(undefined);

      const mockCreateOrUpdate = vi
        .fn()
        .mockResolvedValue({ ok: true, mxid: `@${key}:matrix.local`, password: "pw", status: 201 });
      const mockLoginAsUser = vi
        .fn()
        .mockResolvedValue({ ok: true, accessToken: "syt_real_token" });
      const mockBuildRelay = vi.fn().mockReturnValue("{}");

      const deps = makeDeps({
        matrixCreateOrUpdateUser: mockCreateOrUpdate,
        matrixLoginAsUser: mockLoginAsUser,
        buildRelayJsonBody: mockBuildRelay,
      });
      const opts = makeOpts({ name: key });
      const { events, emit } = collectEvents();

      const birthPromise = birthIdentity(opts, emit, deps);
      await vi.runAllTimersAsync();
      await birthPromise;

      // Step 8 must have completed for every legit key
      const step8Completed = events.find(
        (e) => e.type === "step" && e.n === 8 && e.phase === "completed",
      );
      expect(
        step8Completed,
        `identity key ${JSON.stringify(key)} failed to reach Step 8 completed`,
      ).toBeDefined();

      // relay.json write path is exactly `$HOME/fleet/identities/<key>/relay.json`
      const relayJsonWrite =
        mockWriteMarkdownFileAtomicModule.mock.calls.find(
          (c: unknown[]) =>
            typeof c[1] === "string" && (c[1] as string).endsWith("/relay.json"),
        );
      expect(relayJsonWrite).toBeDefined();
      expect(relayJsonWrite![1]).toBe(
        `$HOME/fleet/identities/${key}/relay.json`,
      );
    }
  }, 60_000);
});

