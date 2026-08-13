/**
 * Phase 34 plan 02 — vitest coverage for `fetchSkillCatalog`.
 *
 * Test posture: this file mocks the three SSH primitives (`connectOneShot`,
 * `execCommand`, `resolveHostById`) via `vi.mock` at module scope, so we
 * exercise the SUT (`fetchSkillCatalog`) as a pure integration of its own
 * logic (parse, filter, fail-open, cleanup) without spinning up a real ssh2
 * server. This mirrors the DI style used in `voice.test.ts` (`vi.stubGlobal`
 * for `fetch`) — same rationale: fast, deterministic, and every failure
 * branch exposed via mock return-value shaping.
 *
 * Two describe blocks:
 *   1. "fetchSkillCatalog — happy path": 6 cases proving the parse rules
 *      (kebab-case filter, whitespace trim, CRLF tolerance, timeout
 *      constants, custom timeout passthrough) and the base happy path.
 *   2. "fetchSkillCatalog — fail-open branches": 6+ cases proving every
 *      documented failure branch resolves to `new Set()` WITHOUT throwing:
 *      no-host, connectOneShot reject, execCommand reject, empty stdout
 *      (technically not a failure — no error, just empty), and the
 *      Promise.race timeout branch (uses vi.useFakeTimers scoped to that
 *      test).
 *
 * Every fail-open test asserts `.resolves.toEqual(new Set())` — that
 * assertion shape would fail loudly if the function ever threw instead
 * of resolving.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The three vi.mock calls MUST come before the SUT import. Vitest hoists
// them automatically but keeping them syntactically at the top makes the
// intent explicit — see voice.test.ts and slashCommandTransform.test.ts
// for the same pattern.
vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../ssh/tmux-helper.js", () => ({ execCommand: vi.fn() }));
vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));

// Silence the sshLogger during tests — the SUT emits info/warn on every
// invocation and we don't want the console spam in CI output. Mock ALL
// levels the SUT touches (info, warn) as no-ops.
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  fetchSkillCatalog,
  DEFAULT_SKILL_CATALOG_TIMEOUT_MS,
} from "./skill-catalog.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Minimal ssh2.Client stub — the SUT only calls `.end()` on it, so that's
 * all we need. Returned as `unknown as Client` because the ssh2 type has
 * ~40 other members we're not exercising.
 */
function makeMockConn(): import("ssh2").Client {
  return { end: vi.fn() } as unknown as import("ssh2").Client;
}

/**
 * A representative "valid host" object shaped like SSHHost — resolveHostById
 * returns something in this shape (with credential fields resolved). Only
 * the fields connectOneShot reads matter for these tests.
 */
const VALID_HOST = {
  id: 1,
  ip: "1.2.3.4",
  username: "ubuntu",
  authType: "key",
  key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
  sshPort: 22,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// Happy path
// ===========================================================================

describe("fetchSkillCatalog — happy path", () => {
  it("returns Set of skill names from ls -1 output on the target box", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue(
      "gsd\ngsd-quick\nexplain\nbounty\nqueue",
    );

    const result = await fetchSkillCatalog(1, "user-1");

    expect(result).toEqual(
      new Set(["gsd", "gsd-quick", "explain", "bounty", "queue"]),
    );
    // Cleanup — finally block ran, closed the conn exactly once.
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("filters out non-kebab-case entries (drops CAPS, .hidden, spaces, UPPER-CASE)", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue(
      "gsd\nCAPS\n.hidden\nhas space\nvalid-name\nUPPER-CASE\n",
    );

    const result = await fetchSkillCatalog(1, "user-1");

    // Only "gsd" and "valid-name" match /^[a-z0-9-]+$/.
    expect(result).toEqual(new Set(["gsd", "valid-name"]));
  });

  it("trims trailing/leading whitespace per line", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue("  gsd  \n\n  bounty\n  ");

    const result = await fetchSkillCatalog(1, "user-1");

    expect(result).toEqual(new Set(["gsd", "bounty"]));
  });

  it("tolerates CRLF line endings", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue("gsd\r\nbounty\r\n");

    const result = await fetchSkillCatalog(1, "user-1");

    expect(result).toEqual(new Set(["gsd", "bounty"]));
  });

  it("uses DEFAULT_SKILL_CATALOG_TIMEOUT_MS (10000) when no third arg is passed", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue("gsd");

    await fetchSkillCatalog(1, "user-1");

    // The constant is 10_000 (see skill-catalog.ts). connectOneShot receives
    // it as its second arg — that's the connect+readyTimeout budget.
    expect(DEFAULT_SKILL_CATALOG_TIMEOUT_MS).toBe(10000);
    expect(vi.mocked(connectOneShot).mock.calls[0]?.[1]).toBe(
      DEFAULT_SKILL_CATALOG_TIMEOUT_MS,
    );
  });

  it("passes through a custom timeoutMs to connectOneShot", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue("gsd");

    await fetchSkillCatalog(1, "user-1", 5000);

    expect(vi.mocked(connectOneShot).mock.calls[0]?.[1]).toBe(5000);
  });
});

// ===========================================================================
// Fail-open branches — every failure resolves to an empty Set, never throws
// ===========================================================================

describe("fetchSkillCatalog — fail-open branches (never throws, always resolves)", () => {
  it("resolveHostById returns null → resolves to empty Set, does NOT call connectOneShot", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null);

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );

    // Short-circuit — no SSH attempt on missing/unauthorized host.
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("connectOneShot rejects → resolves to empty Set, does NOT call execCommand", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockRejectedValue(new Error("connect refused"));

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );

    // Exec was never reached because connect failed first.
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("execCommand rejects → resolves to empty Set AND conn.end() still called (finally cleanup ran)", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockRejectedValue(new Error("exit code 2"));

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );

    // Invariant #2: connection ALWAYS closed in finally, even when exec threw.
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("empty stdout → resolves to empty Set (clean happy path, not a failure)", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    vi.mocked(execCommand).mockResolvedValue("");

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );

    // conn.end() still called on the happy-empty path.
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("output with ONLY non-kebab-case entries → resolves to empty Set (parse-filter drops everything)", async () => {
    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    // All entries fail the /^[a-z0-9-]+$/ filter.
    vi.mocked(execCommand).mockResolvedValue(
      ".git\nREADME.md\nFoo\nhas space\n",
    );

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );
  });

  it("Promise.race timeout branch fires → resolves to empty Set AND conn.end() called (finally ran)", async () => {
    vi.useFakeTimers();

    const conn = makeMockConn();
    vi.mocked(resolveHostById).mockResolvedValue(VALID_HOST as never);
    vi.mocked(connectOneShot).mockResolvedValue(conn);
    // execCommand returns a promise that never resolves — the outer
    // Promise.race setTimeout is the only way this test can complete.
    vi.mocked(execCommand).mockImplementation(
      () => new Promise<string>(() => {}),
    );

    const p = fetchSkillCatalog(1, "user-1", 100);

    // Advance fake timers past the 100ms deadline. This fires the
    // setTimeout callback, which rejects the race with
    // "skill-catalog fetch timeout" — the outer try/catch swallows that
    // into a fail-open empty Set.
    await vi.advanceTimersByTimeAsync(100);

    await expect(p).resolves.toEqual(new Set<string>());
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("resolveHostById itself throws (DB fault) → resolves to empty Set (invariant #1: NEVER throws)", async () => {
    // resolveHostById does not normally throw (it returns null on missing
    // host), but a DB fault or credential-manager blow-up could surface
    // as a throw. The plan's non-negotiable invariant #1 says the SUT
    // NEVER throws to the caller — including for the pre-SSH resolve step.
    vi.mocked(resolveHostById).mockRejectedValue(new Error("db unavailable"));

    await expect(fetchSkillCatalog(1, "user-1")).resolves.toEqual(
      new Set<string>(),
    );

    // conn was never opened, so nothing to close (guard: no conn.end()
    // call because we never got past the resolve step).
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
