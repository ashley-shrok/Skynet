/**
 * Phase 80 Plan 80-03b: MXID handle-format DIVERGE (A1 lock) — unit tests for
 * composeMxidLocalpart + deriveMxidWithOrdinal pure helpers, plus Step 6
 * integration tests asserting that runRelayMintAndWrite consumes the derived
 * MXID when opts.poolPicked === true and falls back to the legacy shape when
 * opts.poolPicked is falsy/absent OR when composeMxidLocalpart throws
 * `mxid_name_not_pool_shape` (user edited a pool-picked name to a non-pool form).
 *
 * Coverage:
 *   composeMxidLocalpart (8 cases: a-h)
 *   deriveMxidWithOrdinal (6 cases: i-n)
 *   Step 6 integration (5 cases: o-s)
 *
 * Test scaffolding matches identity-birth-orchestrator.role-frontmatter.test.ts:
 * same vi.mock layout for external deps, same makeDeps/makeOpts helpers, same
 * collectEvents helper for BirthEvent capture.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { BirthEvent, BirthOptions, BirthDeps } from "./identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock external deps BEFORE importing the module under test
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
  // Phase 92 Plan 92-01 Task 2: per-identity-file.ts (transitively imported
  // by identity-birth-orchestrator's Step 8) requires IDENTITY_KEY_RE from
  // this module. H1 write⇔read parity lock — export the real regex value.
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
  composeMxidLocalpart,
  deriveMxidWithOrdinal,
  MXID_ORDINAL_MAX,
} from "./identity-birth-orchestrator.js";

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";

const mockConnectOneShot = connectOneShot as unknown as Mock;
const mockExecCommand = execCommand as unknown as Mock;
const mockIsLocalHostId = isLocalHostId as unknown as Mock;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
    writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined),
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
    matrixCountUsersMatching: vi.fn().mockResolvedValue({ ok: true, total: 0 }),
    buildRelayJsonBody: vi.fn().mockReturnValue(
      JSON.stringify({
        base: "http://mock.homeserver.local:8008/_matrix/client/v3",
        user_id: "@testkey:mock.homeserver.local",
        password: "mock-agent-password",
        token: "syt_mock_access_token_test",
        access_token: "syt_mock_access_token_test",
      }),
    ),
    // Phase 106 Plan 106-03 (D-05/D-06): wait-for-supervisor sensor. Default
    // returns a non-null jsonl path on the FIRST call so the wait-poll exits
    // immediately with success — the mxid-derivation tests care about Step 6
    // MXID composition, not the wait-block cadence.
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
    name: "willow",
    title: "Test Identity",
    path: "/workspace/willow",
    colorHue: 210,
    voice: "Joanna",
    avatarCandidateId: "cand-abc",
    role: "skynet-maintainer",
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

  mockIsLocalHostId.mockReturnValue(false);
  const mockConn = { end: vi.fn() };
  mockConnectOneShot.mockResolvedValue(mockConn);
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
// composeMxidLocalpart — 8 cases (a-h)
// ---------------------------------------------------------------------------

describe("composeMxidLocalpart", () => {
  // 2026-09-11 output flipped PascalCase → lowercase (Matrix spec + Synapse
  // M_INVALID_USERNAME require mxid localparts to be a-z, 0-9, or =_-./+).
  // The Phase 80 PascalCase design was rejected by Synapse at Step 6's
  // admin-mint PUT — every pool-picked birth got 400 back. See fix commit
  // <this-session> for rationale + follow-on tests below.
  it("(a) willow + skynet-maintainer → willow-skynet-maintainer", () => {
    expect(composeMxidLocalpart("willow", "skynet-maintainer")).toBe(
      "willow-skynet-maintainer",
    );
  });

  it("(b) aster + coordinator → aster-coordinator", () => {
    expect(composeMxidLocalpart("aster", "coordinator")).toBe("aster-coordinator");
  });

  it("(c) willow + foo-bar-baz → willow-foo-bar-baz (multi-segment role)", () => {
    expect(composeMxidLocalpart("willow", "foo-bar-baz")).toBe(
      "willow-foo-bar-baz",
    );
  });

  it("(d) willow + Skynet-Maintainer (uppercase in source role) → throws mxid_role_malformed", () => {
    expect(() => composeMxidLocalpart("willow", "Skynet-Maintainer")).toThrow(
      /mxid_role_malformed/,
    );
  });

  it("(e) willow + 2maintainer (role starts with digit) → throws mxid_role_malformed", () => {
    expect(() => composeMxidLocalpart("willow", "2maintainer")).toThrow(
      /mxid_role_malformed/,
    );
  });

  it("(f) willow + foo--bar (empty role segment) → throws mxid_role_malformed", () => {
    expect(() => composeMxidLocalpart("willow", "foo--bar")).toThrow(
      /mxid_role_malformed/,
    );
  });

  it("(g) willow-2 + skynet-maintainer (name with hyphen — not pool shape) → throws mxid_name_not_pool_shape", () => {
    expect(() => composeMxidLocalpart("willow-2", "skynet-maintainer")).toThrow(
      /mxid_name_not_pool_shape/,
    );
  });

  it("(h) 2willow + skynet-maintainer (name starts with digit) → throws mxid_name_not_pool_shape", () => {
    expect(() => composeMxidLocalpart("2willow", "skynet-maintainer")).toThrow(
      /mxid_name_not_pool_shape/,
    );
  });

  // Defensive lowercase on backend for clients bypassing the frontend's
  // NewSessionDialog toLowerCase() (curl, hand-rolled tool). Original test
  // pinned normalization to willow-skynet-maintainer (PascalCase); post
  // 2026-09-11 fix the output is lowercase throughout — Synapse-safe.
  it("(h2) Willow (PascalCase input) + skynet-maintainer → willow-skynet-maintainer (normalized, does NOT throw)", () => {
    expect(composeMxidLocalpart("Willow", "skynet-maintainer")).toBe(
      "willow-skynet-maintainer",
    );
  });

  it("(h3) WILLOW (all-caps input) + skynet-maintainer → willow-skynet-maintainer (normalized)", () => {
    expect(composeMxidLocalpart("WILLOW", "skynet-maintainer")).toBe(
      "willow-skynet-maintainer",
    );
  });

  it("(h4) WilloW (mixed-case) + coordinator → willow-coordinator (normalized)", () => {
    expect(composeMxidLocalpart("WilloW", "coordinator")).toBe(
      "willow-coordinator",
    );
  });
});

// ---------------------------------------------------------------------------
// deriveMxidWithOrdinal — 6 cases (i-n)
// ---------------------------------------------------------------------------

describe("deriveMxidWithOrdinal", () => {
  const SERVER = "matrix.example.com";
  const BASE = "willow-skynet-maintainer";

  it("(i) base handle free on first count → returns @<base>:server, countFn called exactly once", async () => {
    const countFn = vi.fn().mockResolvedValue({ ok: true, total: 0 });
    const result = await deriveMxidWithOrdinal(BASE, SERVER, countFn);
    expect(result).toBe(`@${BASE}:${SERVER}`);
    expect(countFn).toHaveBeenCalledTimes(1);
    expect(countFn).toHaveBeenNthCalledWith(1, `@${BASE}:${SERVER}`);
  });

  it("(j) base taken, -2 free → returns @<base>-2:server, countFn called exactly twice", async () => {
    const countFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({ ok: true, total: 0 });
    const result = await deriveMxidWithOrdinal(BASE, SERVER, countFn);
    expect(result).toBe(`@${BASE}-2:${SERVER}`);
    expect(countFn).toHaveBeenCalledTimes(2);
    expect(countFn).toHaveBeenNthCalledWith(1, `@${BASE}:${SERVER}`);
    expect(countFn).toHaveBeenNthCalledWith(2, `@${BASE}-2:${SERVER}`);
  });

  it("(k) base + -2 + -3 taken, -4 free → returns @<base>-4:server, countFn called four times", async () => {
    const countFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({ ok: true, total: 0 });
    const result = await deriveMxidWithOrdinal(BASE, SERVER, countFn);
    expect(result).toBe(`@${BASE}-4:${SERVER}`);
    expect(countFn).toHaveBeenCalledTimes(4);
    expect(countFn).toHaveBeenNthCalledWith(4, `@${BASE}-4:${SERVER}`);
  });

  it("(l) all ordinals up to MXID_ORDINAL_MAX busy → throws mxid_ordinal_exhausted, countFn called exactly MXID_ORDINAL_MAX times", async () => {
    const countFn = vi.fn().mockResolvedValue({ ok: true, total: 1 });
    await expect(
      deriveMxidWithOrdinal(BASE, SERVER, countFn),
    ).rejects.toThrow(/mxid_ordinal_exhausted/);
    expect(countFn).toHaveBeenCalledTimes(MXID_ORDINAL_MAX);
    expect(MXID_ORDINAL_MAX).toBe(100);
  });

  it("(m) countFn returns {ok:false,status:502,error:'admin_api_proxy_error'} on first call → throws admin_count_failed with error+status", async () => {
    const countFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });
    await expect(
      deriveMxidWithOrdinal(BASE, SERVER, countFn),
    ).rejects.toThrow(/admin_count_failed: admin_api_proxy_error \(502\)/);
    expect(countFn).toHaveBeenCalledTimes(1);
  });

  it("(n) base busy then error on ordinal iteration → throws admin_count_failed with sanitized error", async () => {
    const countFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        error: "admin_api_timeout",
      });
    await expect(
      deriveMxidWithOrdinal(BASE, SERVER, countFn),
    ).rejects.toThrow(/admin_count_failed: admin_api_timeout \(504\)/);
    expect(countFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Step 6 integration — 5 cases (o-s)
//
// These drive birthIdentity end-to-end with the full mock harness and assert
// that runRelayMintAndWrite's Step 6 consumes the derived MXID (or falls back
// per spec) when opts.poolPicked is set.
// ---------------------------------------------------------------------------

describe("Step 6 integration (runRelayMintAndWrite MXID derivation)", () => {
  it("(o) opts.poolPicked === true + happy path → matrixCreateOrUpdateUser called with @willow-skynet-maintainer:server (derived MXID, not @willow:server)", async () => {
    const mintMock = vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@willow-skynet-maintainer:mock.homeserver.local",
      password: "mock",
      status: 200,
    });
    const countMock = vi.fn().mockResolvedValue({ ok: true, total: 0 });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      matrixCountUsersMatching: countMock,
    });
    const opts = makeOpts({
      name: "willow",
      role: "skynet-maintainer",
      poolPicked: true,
    });

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mintMock).toHaveBeenCalled();
    const mxidArg = mintMock.mock.calls[0]?.[0] as string;
    expect(mxidArg).toBe("@willow-skynet-maintainer:mock.homeserver.local");
    expect(mxidArg).not.toBe("@willow:mock.homeserver.local");
    expect(countMock).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("(p) opts.poolPicked === true + base taken → matrixCreateOrUpdateUser called with @willow-skynet-maintainer-2:server (ordinal suffix)", async () => {
    const mintMock = vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@willow-skynet-maintainer-2:mock.homeserver.local",
      password: "mock",
      status: 200,
    });
    const countMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, total: 1 })
      .mockResolvedValueOnce({ ok: true, total: 0 });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      matrixCountUsersMatching: countMock,
    });
    const opts = makeOpts({
      name: "willow",
      role: "skynet-maintainer",
      poolPicked: true,
    });

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mintMock).toHaveBeenCalled();
    const mxidArg = mintMock.mock.calls[0]?.[0] as string;
    expect(mxidArg).toBe("@willow-skynet-maintainer-2:mock.homeserver.local");
    expect(countMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("(q) opts.poolPicked !== true (undefined) → legacy @willow:server MXID; matrixCountUsersMatching NOT called", async () => {
    const mintMock = vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@willow:mock.homeserver.local",
      password: "mock",
      status: 200,
    });
    const countMock = vi.fn().mockResolvedValue({ ok: true, total: 0 });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      matrixCountUsersMatching: countMock,
    });
    const opts = makeOpts({ name: "willow", role: "skynet-maintainer" });
    // NB: poolPicked intentionally not set (undefined)

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mintMock).toHaveBeenCalled();
    const mxidArg = mintMock.mock.calls[0]?.[0] as string;
    expect(mxidArg).toBe("@willow:mock.homeserver.local");
    expect(countMock).not.toHaveBeenCalled();
  }, 30_000);

  it("(r) opts.poolPicked === true + name='my-custom' (user-edited non-pool name) → silent fallback to @my-custom:server; matrixCountUsersMatching NOT called", async () => {
    const mintMock = vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@my-custom:mock.homeserver.local",
      password: "mock",
      status: 200,
    });
    const countMock = vi.fn().mockResolvedValue({ ok: true, total: 0 });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      matrixCountUsersMatching: countMock,
    });
    const opts = makeOpts({
      name: "my-custom",
      role: "skynet-maintainer",
      poolPicked: true,
    });

    const { emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    expect(mintMock).toHaveBeenCalled();
    const mxidArg = mintMock.mock.calls[0]?.[0] as string;
    expect(mxidArg).toBe("@my-custom:mock.homeserver.local");
    expect(countMock).not.toHaveBeenCalled();
  }, 30_000);

  it("(s) opts.poolPicked === true + admin count failure → Step 6 emits step:6:failed with sanitized admin_count_failed reason", async () => {
    const countMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });
    const mintMock = vi.fn().mockResolvedValue({
      ok: true,
      mxid: "@willow-skynet-maintainer:mock.homeserver.local",
      password: "mock",
      status: 200,
    });
    const deps = makeDeps({
      matrixCreateOrUpdateUser: mintMock,
      matrixCountUsersMatching: countMock,
    });
    const opts = makeOpts({
      name: "willow",
      role: "skynet-maintainer",
      poolPicked: true,
    });

    const { events, emit } = collectEvents();
    const birthPromise = birthIdentity(opts, emit, deps);
    await vi.runAllTimersAsync();
    await birthPromise;

    // Step 6 failure attribution — admin_count_failed surfaces via sanitizeError
    const step6Failed = events.find(
      (e) =>
        e.type === "step" &&
        (e as { n: number }).n === 6 &&
        (e as { phase: string }).phase === "failed",
    );
    expect(step6Failed).toBeDefined();
    const reason = (step6Failed as { reason?: string }).reason ?? "";
    expect(reason).toMatch(/admin_count_failed/);

    // mint MUST NOT have been called — derivation failed before mint
    expect(mintMock).not.toHaveBeenCalled();

    // ended event with ok:false + failedStep:6
    const endedEvent = events.find((e) => e.type === "ended");
    expect(endedEvent).toBeDefined();
    expect((endedEvent as { ok: boolean }).ok).toBe(false);
    expect((endedEvent as { failedStep?: number }).failedStep).toBe(6);
  }, 30_000);
});
