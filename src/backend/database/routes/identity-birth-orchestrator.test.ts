/**
 * identity-birth-orchestrator tests — post-2026-09-24 mint-first atomic-birth
 * reshape. The pre-reshape tests exercised a fragmented Step 1 (SSH role +
 * avatar + collision probes) + Step 2 (SSH mkdir + writeMarkdownFileAtomic
 * + writeAvatarSiblingFile) + Step 6/7/8 (Matrix mint + relay.json build +
 * SFTP write + chmod) sequence. That flow is retired: MXID derivation
 * moved to Step 1 (no SSH), Step 2 is a wire-compat placeholder, Steps 6/7
 * remain Skynet-local, and Step 8 executes ONE atomic peer-commit bash
 * script in a single SSH exec. Rollback is via a new matrixDeactivateUser
 * BirthDep.
 *
 * Coverage in this file:
 *   - Nelly-verbatim exported constants (unchanged)
 *   - Mint-first ordering (matrixCreateOrUpdateUser called before any SSH
 *     exec; SSH connect only fires at Step 8)
 *   - Peer-commit script contract (role, identityFolderName, base64 blobs
 *     for identity file body + relay.json body, "birth_committed" sentinel)
 *   - Rollback fires on Step 8 failure (matrixDeactivateUser called with
 *     the derived MXID); rollback does NOT fire on Step 8 success
 *   - Rollback semantics for Step 6/Step 7 failures (mint failure = no
 *     rollback needed; login-as-user failure DOES roll back since mint
 *     succeeded)
 *   - Wire-compat: emits step 1/2/6/7/8 events in order for wire-compat
 *     with the frontend BirthProgress checklist
 *   - Wait-for-supervisor unchanged (poll cadence, timeout, client abort)
 *   - Local branch (isLocalHostId=true) — peer script runs via execLocal
 *   - Custom opts.path pre-created after commit (best-effort)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type {
  BirthEvent,
  BirthOptions,
  BirthDeps,
} from "./identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock external modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  stringifyColorHueForYaml: (obj: Record<string, unknown>) =>
    typeof obj.colorHue === "number"
      ? { ...obj, colorHue: String(obj.colorHue) }
      : obj,
  isLocalHostId: vi.fn(),
  getLocalIdentitiesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/identities"),
  getLocalRolesRoot: vi.fn().mockReturnValue("/tmp/test-fleet/roles"),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  MIME_TO_AVATAR_EXT: {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
  },
  AVATAR_EXT_VALUES: ["webp", "png", "jpg"] as const,
  IDMEDIT_MAX_AVATAR_BYTES: 5_000_000,
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("../../relay-sessions/registry-rooms.js", () => ({
  joinAgentToAgentsRegistry: vi
    .fn()
    .mockResolvedValue({ ok: true, roomId: "!agents-registry:example.com" }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn().mockResolvedValue(undefined),
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sshLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  systemLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockConnectOneShot = connectOneShot as unknown as Mock;
const mockExecCommand = execCommand as unknown as Mock;
const mockIsLocalHostId = isLocalHostId as unknown as Mock;
const mockDatabaseLoggerWarn = databaseLogger.warn as unknown as Mock;

function collectEvents(): {
  events: BirthEvent[];
  emit: (e: BirthEvent) => void;
} {
  const events: BirthEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function makeDeps(overrides: Partial<BirthDeps> = {}): BirthDeps {
  return {
    connectOneShot: mockConnectOneShot,
    execCommand: mockExecCommand,
    isLocalHostId: mockIsLocalHostId,
    execLocal: vi.fn().mockResolvedValue("birth_committed"),
    resolveHostById: vi.fn().mockResolvedValue({
      ip: "100.1.2.3",
      port: 22,
      sshPort: 22,
      username: "ubuntu",
      authType: "key",
      key: "fake-key",
    }),
    matrixCreateOrUpdateUser: vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@testkey:example.com",
      password: "pw",
      status: 201,
    }),
    matrixLoginAsUser: vi.fn().mockResolvedValue({
      ok: true,
      accessToken: "syt_fake_access_token",
    }),
    matrixDeactivateUser: vi.fn().mockResolvedValue({ ok: true }),
    matrixHomeserver: "http://synapse.example.com:8008",
    matrixServerName: null,
    relayJsonHomeserverBase: "http://synapse.example.com:8008",
    buildRelayJsonBody: vi.fn().mockReturnValue(
      JSON.stringify({
        base: "http://synapse.example.com:8008/_matrix/client/v3",
        user_id: "@testkey:example.com",
        password: "pw",
        token: "syt_fake_access_token",
        access_token: "syt_fake_access_token",
      }),
    ),
    matrixCountUsersMatching: vi
      .fn()
      .mockResolvedValue({ ok: true, total: 0 }),
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
    path: "~/",
    colorHue: 210,
    voice: "Joanna",
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
  mockDatabaseLoggerWarn.mockReset();

  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
  // Default execCommand: the peer commit script returns "birth_committed" on
  // success. Individual tests override to simulate failures.
  mockExecCommand.mockResolvedValue("birth_committed");
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Exported constants (Nelly-verbatim)
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
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain(
      "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999",
    );
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain(
      "CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999",
    );
  });
  it("TMUX_NEW_SESSION_FLAGS is -x 220 -y 50", () => {
    expect(TMUX_NEW_SESSION_FLAGS).toBe("-x 220 -y 50");
  });
  it("WAIT_FOR_SUPERVISOR_POLL_MS is 2000", () => {
    expect(WAIT_FOR_SUPERVISOR_POLL_MS).toBe(2000);
  });
  it("WAIT_FOR_SUPERVISOR_TIMEOUT_MS is 300000", () => {
    expect(WAIT_FOR_SUPERVISOR_TIMEOUT_MS).toBe(300000);
  });
});

// ---------------------------------------------------------------------------
// Mint-first ordering + wire-compat step events
// ---------------------------------------------------------------------------

describe("mint-first atomic-birth flow", () => {
  it("happy path emits step 1/2/6/7/8 events in order + ended:ok:true", async () => {
    const { events, emit } = collectEvents();
    const deps = makeDeps();
    const opts = makeOpts();

    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const stepStarts = events
      .filter((e) => e.type === "step" && e.phase === "started")
      .map((e) => (e as { n: number }).n);
    expect(stepStarts).toEqual([1, 2, 6, 7, 8]);

    const stepCompletes = events
      .filter((e) => e.type === "step" && e.phase === "completed")
      .map((e) => (e as { n: number }).n);
    expect(stepCompletes).toEqual([1, 2, 6, 7, 8]);

    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ type: "ended", ok: true }),
    );
  });

  it("Matrix mint fires BEFORE SSH connect (mint-first invariant)", async () => {
    const { emit } = collectEvents();
    const orderLog: string[] = [];

    const deps = makeDeps({
      matrixCreateOrUpdateUser: vi.fn().mockImplementation(async () => {
        orderLog.push("mint");
        return {
          ok: true,
          mxid: "@testkey:example.com",
          password: "pw",
          status: 201,
        };
      }),
      connectOneShot: vi.fn().mockImplementation(async () => {
        orderLog.push("ssh_connect");
        return { end: vi.fn() };
      }),
    });

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(orderLog[0]).toBe("mint");
    expect(orderLog[1]).toBe("ssh_connect");
  });

  it("execCommand called exactly ONCE (the atomic peer-commit script)", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Just the peer-commit script (opts.path is "~/" → normalizes to $HOME,
    // best-effort mkdir is skipped).
    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  it("custom opts.path triggers best-effort mkdir AFTER peer commit", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(
      makeOpts({ path: "~/pdf-inspector" }),
      emit,
      deps,
    );
    await vi.runAllTimersAsync();
    await birthPromise;

    // Peer script exec + custom-path mkdir exec = 2 total
    expect(mockExecCommand).toHaveBeenCalledTimes(2);
    const secondCall = mockExecCommand.mock.calls[1][1] as string;
    expect(secondCall).toContain("mkdir -p");
    expect(secondCall).toContain("$HOME/pdf-inspector");
  });
});

// ---------------------------------------------------------------------------
// Peer-commit script content contract
// ---------------------------------------------------------------------------

describe("peer-commit script content", () => {
  it("contains role name and identity folder key", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(
      makeOpts({ name: "willow", role: "hecate-maintainer", poolPicked: true }),
      emit,
      deps,
    );
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = mockExecCommand.mock.calls[0][1] as string;
    expect(script).toContain('ROLE="hecate-maintainer"');
    // poolPicked=true derives identityFolderName = <name>-<role>
    expect(script).toMatch(/KEY="willow-hecate-maintainer"/);
  });

  it("contains base64 identity file body decoded to expected frontmatter", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = mockExecCommand.mock.calls[0][1] as string;
    // Extract the identity-file base64 blob after `printf '%s' '<blob>'`
    // preceding writing "$STAGING/$KEY.md"
    const idFileMatch = script.match(
      /printf '%s' '([^']+)' \| base64 -d > "\$STAGING\/\$KEY\.md"/,
    );
    expect(idFileMatch).not.toBeNull();
    const decoded = Buffer.from(idFileMatch![1], "base64").toString("utf-8");
    expect(decoded).toContain("role: box-maintainer");
    expect(decoded).toContain("displayName: Testkey");
    // # heading at the tail
    expect(decoded).toMatch(/#\s+testkey/i);
  });

  it("contains base64 relay.json body decoded to Matrix creds JSON", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = mockExecCommand.mock.calls[0][1] as string;
    const relayMatch = script.match(
      /printf '%s' '([^']+)' \| base64 -d > "\$STAGING\/relay\.json"/,
    );
    expect(relayMatch).not.toBeNull();
    const decoded = Buffer.from(relayMatch![1], "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    expect(parsed.user_id).toBe("@testkey:example.com");
    expect(parsed.access_token).toBe("syt_fake_access_token");
  });

  it("chmods relay.json to 600 (T-75-18 S-1 lock)", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = mockExecCommand.mock.calls[0][1] as string;
    expect(script).toContain('chmod 600 "$STAGING/relay.json"');
  });

  it("commits via atomic mv rename into $FLEET_ROOT/identities/$KEY", async () => {
    const { emit } = collectEvents();
    const deps = makeDeps();

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = mockExecCommand.mock.calls[0][1] as string;
    expect(script).toContain(
      'mv "$STAGING" "$FLEET_ROOT/identities/$KEY"',
    );
  });
});

// ---------------------------------------------------------------------------
// Rollback semantics — matrixDeactivateUser
// ---------------------------------------------------------------------------

describe("rollback on failure", () => {
  it("Step 8 peer-commit failure → matrixDeactivateUser called with derived MXID", async () => {
    const { emit } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    mockExecCommand.mockRejectedValue(new Error("peer_commit_mv_failed"));

    const deps = makeDeps({ matrixDeactivateUser: deactivateMock });
    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(deactivateMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).toHaveBeenCalledWith("@testkey:synapse.example.com");
  });

  it("Step 8 peer-commit SUCCESS → matrixDeactivateUser NOT called", async () => {
    const { emit } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({ matrixDeactivateUser: deactivateMock });

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(deactivateMock).not.toHaveBeenCalled();
  });

  it("Step 6 mint failure → NO rollback (nothing was minted)", async () => {
    const { emit, events } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, error: "synapse_500" }),
      matrixDeactivateUser: deactivateMock,
    });

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(deactivateMock).not.toHaveBeenCalled();
    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ ok: false, failedStep: 6 }),
    );
  });

  it("Step 6 login-as-user failure AFTER mint → rollback DOES fire", async () => {
    const { emit } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({
      matrixLoginAsUser: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, error: "login_500" }),
      matrixDeactivateUser: deactivateMock,
    });

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(deactivateMock).toHaveBeenCalledTimes(1);
    expect(deactivateMock).toHaveBeenCalledWith("@testkey:synapse.example.com");
  });

  it("matrixDeactivateUser failure is warn-logged but does NOT raise", async () => {
    const { emit, events } = collectEvents();
    const deactivateMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, error: "deact_500" });
    mockExecCommand.mockRejectedValue(new Error("peer_commit_mv_failed"));

    const deps = makeDeps({ matrixDeactivateUser: deactivateMock });
    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(deactivateMock).toHaveBeenCalled();
    // Warn logged
    const warnCalls = mockDatabaseLoggerWarn.mock.calls;
    const rollbackWarn = warnCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("rollback deactivate failed"),
    );
    expect(rollbackWarn).toBeDefined();
    // Birth still ended with step:8:failed (not with an uncaught throw)
    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ ok: false, failedStep: 8 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Role validation + SSH connect failure
// ---------------------------------------------------------------------------

describe("failure surfaces", () => {
  it("invalid role name → step:1:failed, no mint, no SSH connect", async () => {
    const { emit, events } = collectEvents();
    const mintMock = vi.fn();
    const connectMock = vi.fn();

    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      connectOneShot: connectMock,
    });

    const birthPromise = birthIdentity(
      makeOpts({ role: "Invalid_Role" }),
      emit,
      deps,
    );
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mintMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ ok: false, failedStep: 1 }),
    );
  });

  it("SSH connect failure at Step 8 → step:8:failed with 'Host unreachable' + rollback fires", async () => {
    const { emit, events } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    mockConnectOneShot.mockRejectedValue(new Error("ECONNREFUSED"));

    const deps = makeDeps({ matrixDeactivateUser: deactivateMock });
    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const step8Failed = events.find(
      (e) => e.type === "step" && e.n === 8 && e.phase === "failed",
    );
    expect(step8Failed).toEqual(
      expect.objectContaining({ reason: "Host unreachable" }),
    );
    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ ok: false, failedStep: 8 }),
    );
    // Rollback fires because we minted before Step 8
    expect(deactivateMock).toHaveBeenCalledTimes(1);
  });

  it("supervisor wait timeout → ended:ok:false with supervisor_wait_timeout reason (NO rollback — Q2 lock preserved)", async () => {
    const { emit, events } = collectEvents();
    const deactivateMock = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({
      discoverIdentitySessionFile: vi.fn().mockResolvedValue(null),
      matrixDeactivateUser: deactivateMock,
    });

    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    // Advance past the wait timeout
    await vi.advanceTimersByTimeAsync(WAIT_FOR_SUPERVISOR_TIMEOUT_MS + 1000);
    await birthPromise;

    const ended = events.find((e) => e.type === "ended");
    expect(ended).toEqual(
      expect.objectContaining({ ok: false, reason: "supervisor_wait_timeout" }),
    );
    // Q2 no-rollback: birth already committed to peer disk atomically;
    // supervisor may still pick it up. Do NOT deactivate on timeout.
    expect(deactivateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Local branch (self-birth)
// ---------------------------------------------------------------------------

describe("local branch (isLocalHostId=true)", () => {
  it("uses execLocal instead of execCommand and NEVER opens SSH", async () => {
    const { emit } = collectEvents();
    mockIsLocalHostId.mockReturnValue(true);
    const execLocalMock = vi.fn().mockResolvedValue("birth_committed");

    const deps = makeDeps({ execLocal: execLocalMock });
    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(execLocalMock).toHaveBeenCalled();
    expect(mockConnectOneShot).not.toHaveBeenCalled();
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it("peer script uses absolute fleet-root path (bind-mount parent), NOT $HOME", async () => {
    const { emit } = collectEvents();
    mockIsLocalHostId.mockReturnValue(true);
    const execLocalMock = vi.fn().mockResolvedValue("birth_committed");

    const deps = makeDeps({ execLocal: execLocalMock });
    const birthPromise = birthIdentity(makeOpts(), emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    const script = execLocalMock.mock.calls[0][0] as string;
    // getLocalIdentitiesRoot() mock returns "/tmp/test-fleet/identities" →
    // parent is "/tmp/test-fleet". FLEET_ROOT substitutes absolute path
    // rather than "$HOME/fleet".
    expect(script).toContain('FLEET_ROOT="/tmp/test-fleet"');
    expect(script).not.toContain('FLEET_ROOT="$HOME/fleet"');
  });
});
