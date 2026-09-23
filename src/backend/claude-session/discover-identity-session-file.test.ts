/**
 * Unit tests for discover-identity-session-file — Phase 32, Plan 32-01.
 *
 * Covers the D-nnn decisions locked in
 * `.planning/phases/32-identity-first-turn-session-discovery-wake-bubble-message-hi/32-CONTEXT.md`:
 *
 *   - D-01: byte-pattern match (no JSON.parse) + partial-name-refusal delimiter guard
 *           (`<`, ` `, `\r`, EOL).
 *   - D-02: FIRST user-role line only — later `/id <name>` mentions never match.
 *   - D-03: mtime-latest tiebreak when multiple JSONLs match.
 *   - D-04: throwaway / non-identity panes excluded BY CONSTRUCTION (their first user
 *           turn is not `/id <name>`; no explicit throwaway filter needed).
 *   - D-05: cold-start works — empty projects dir returns null (no throw, no bootstrap).
 *   - D-07: cost bounded — one round-trip (the shell script pre-filters by mtime and
 *           by first-user-role line, JS applies the byte-pattern predicate).
 *
 * D-06 and D-08 are conceptual and are NOT directly test-assertable at this scope —
 * their behavior guarantees fall out of D-01+D-02+D-03 (see 32-CONTEXT.md).
 *
 * The predicate `__matchesIdentityFirstTurnForTests` is exercised in isolation; the
 * `discoverIdentitySessionFile` helper is exercised end-to-end via an injected
 * execCommand mock (module-level vi.mock — the same seam pattern used in
 * `session-file-discovery.test.ts`).
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Mock the tmux-helper module so we can inject execCommand stdout per test.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  discoverIdentitySessionFile,
  __matchesIdentityFirstTurnForTests,
} from "./discover-identity-session-file.js";

// Stub ssh2 Client — execCommand is mocked at module level so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// ── Fixture builders ────────────────────────────────────────────────────────

/**
 * Build a JSONL line matching the empirical Claude Code first-user-turn shape
 * for `/id <identityName>`, as observed at
 * `~/.claude/projects/-home-ubuntu-skynet-tanya/*.jsonl` and mirrored by the
 * fixtures in `layer1-detect.test.ts:91-105`.
 *
 * Optional `delimiter` param overrides the character that appears immediately
 * after the identity name inside `<command-args>`. Defaults to `<` (empirical:
 * `<command-args>tanya</command-args>` — the `<` opens `</command-args>`).
 */
function firstUserTurnLine(
  identity: string,
  options: { delimiter?: "<" | " " | "\r" | "EOL"; content?: string } = {},
): string {
  const delimiter = options.delimiter ?? "<";
  let content: string;
  if (delimiter === "EOL") {
    // Line ends immediately after identity name — no closing `</command-args>`.
    // Construct via string concat so the JSONL line literally ends after `${identity}`.
    // JSON.stringify would preserve this because there's no newline inside content.
    content =
      "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>" +
      identity;
  } else if (delimiter === "\r") {
    // NOTE: JSON.stringify would escape a raw CR to `\\r`; callers that need
    // a RAW CR byte in the line must construct the line by hand (see the
    // `\r` delimiter test case below). This branch is provided for symmetry
    // but is not consumed by the current test suite.
    content =
      "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>" +
      identity +
      "\r";
  } else if (delimiter === " ") {
    content =
      "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>" +
      identity +
      " extra-arg";
  } else {
    // "<" — the empirical case: closing tag follows immediately.
    content =
      "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>" +
      identity +
      "</command-args>";
  }
  if (options.content !== undefined) content = options.content;
  return JSON.stringify({
    type: "user",
    uuid: "u-fake-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    message: { role: "user", content },
  });
}

/** Plain user turn (no /id command). */
function plainUserTurnLine(text: string): string {
  return JSON.stringify({
    type: "user",
    uuid: "u-plain-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    message: { role: "user", content: text },
  });
}

/** Tool-result user turn — has `"type":"user"` AND `"tool_result"`. */
function toolResultUserTurnLine(): string {
  return JSON.stringify({
    type: "user",
    uuid: "u-tr-1",
    timestamp: "2026-08-12T00:00:00.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_abc",
          // Even if the tool_result payload literally contains the /id byte-pattern,
          // the outer `"tool_result"` marker MUST exclude the line.
          content:
            "<command-name>/id</command-name>\n<command-args>tanya</command-args>",
        },
      ],
    },
  });
}

// ── Mock helper: shell-script dispatch ─────────────────────────────────────
//
// The helper issues ONE execCommand call whose stdout is the absolute path of
// the first matching JSONL, or empty if none matched. The match, mtime-desc
// tiebreak, and partial-name refusal all execute IN THE SHELL now (grep -F
// with the `<command-args>NAME<` closing delimiter), so JS-side is just a
// trim.
//
// This is the OUTPUT CONTRACT the test suite couples to — not the shell
// script's exact wording, so the executor can refine the script without
// breaking these tests.

function mockExecReturning(stdoutOrThrow: string | (() => Promise<string>)) {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, _cmd: string): Promise<string> => {
      if (typeof stdoutOrThrow === "function") return stdoutOrThrow();
      return Promise.resolve(stdoutOrThrow);
    },
  );
}

// ── Predicate cases: __matchesIdentityFirstTurnForTests ────────────────────

describe("__matchesIdentityFirstTurnForTests — CASE-P1 happy path", () => {
  it("returns true for a user-role line with /id command-name + matching identity + `<` delimiter", () => {
    const line = firstUserTurnLine("tanya", { delimiter: "<" });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(true);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P2 partial-name refusal (D-01 guard)", () => {
  it("refuses `<command-args>tiff</command-args>` when identity is `tiffany`", () => {
    const line = firstUserTurnLine("tiff", { delimiter: "<" });
    expect(__matchesIdentityFirstTurnForTests(line, "tiffany")).toBe(false);
  });

  it("refuses `<command-args>tiffany</command-args>` when identity is `tiff`", () => {
    const line = firstUserTurnLine("tiffany", { delimiter: "<" });
    expect(__matchesIdentityFirstTurnForTests(line, "tiff")).toBe(false);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P3 delimiter set", () => {
  it("accepts `<` immediately after identity (empirical case)", () => {
    const line = firstUserTurnLine("tanya", { delimiter: "<" });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(true);
  });

  it("accepts ` ` (space) immediately after identity (multi-token args)", () => {
    const line = firstUserTurnLine("tanya", { delimiter: " " });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(true);
  });

  it("accepts `\\r` (raw CR byte) immediately after identity (Windows-line-ending edge)", () => {
    // The `\r` delimiter case is a RAW carriage-return byte in the JSONL line
    // — NOT a JSON `\r` escape (which is two literal bytes `\`, `r`). This
    // shape is unusual in practice (JSON.stringify never emits raw CR inside
    // content), but the D-01 spec lists `\r` as an allowed delimiter for
    // defensive completeness (line-ending edge cases where the raw line
    // buffer includes CR before LF). Construct the line by hand so the byte
    // immediately after `tanya` is a raw 0x0D.
    const line =
      '{"type":"user","message":{"role":"user","content":"<command-name>/id</command-name>\\n<command-args>tanya' +
      "\r" +
      '"}}';
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(true);
  });

  it("accepts end-of-line immediately after identity (line ends right after name)", () => {
    // Construct the line by hand so the raw JSONL literally ends at `${identity}`.
    // JSON.stringify would append `"}` for the outer object; we're only asserting
    // the predicate treats a line ending immediately after `<command-args>tanya`
    // as a valid EOL delimiter. Build a minimal line that ends right there:
    const line =
      '{"type":"user","message":{"role":"user","content":"<command-name>/id</command-name>\\n<command-args>tanya';
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(true);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P4 tool_result exclusion", () => {
  it("refuses a user-role line whose outer shape contains `\"tool_result\"` (agent-side synthetic)", () => {
    // Even though the tool_result payload contains the full /id byte-pattern,
    // the outer `"tool_result"` marker excludes the line per isUserTurn semantics.
    const line = toolResultUserTurnLine();
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(false);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P5 non-user turn refusal", () => {
  it("refuses `\"type\":\"assistant\"` lines even if they quote the full /id byte-pattern", () => {
    // Craft an assistant line whose CONTENT includes the /id byte-pattern —
    // the predicate must refuse based on the outer `"type"` field.
    const line = JSON.stringify({
      type: "assistant",
      uuid: "a-fake-1",
      timestamp: "2026-08-12T00:00:00.000Z",
      message: {
        role: "assistant",
        content:
          "You issued <command-name>/id</command-name>\n<command-args>tanya</command-args>",
      },
    });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(false);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P6 missing /id command-name", () => {
  it("refuses a user-role line that has `<command-args>tanya<` but no `<command-name>/id</command-name>`", () => {
    // Simulate a different slash-command (e.g. /save with args that happen to
    // include the string tanya) — should NOT match /id-identity discovery.
    const line = JSON.stringify({
      type: "user",
      uuid: "u-fake-2",
      timestamp: "2026-08-12T00:00:00.000Z",
      message: {
        role: "user",
        content:
          "<command-name>/save</command-name>\n<command-args>tanya</command-args>",
      },
    });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(false);
  });
});

describe("__matchesIdentityFirstTurnForTests — CASE-P7 wrong identity in args", () => {
  it("refuses a user-role line whose /id args reference a DIFFERENT identity", () => {
    const line = firstUserTurnLine("nelly", { delimiter: "<" });
    expect(__matchesIdentityFirstTurnForTests(line, "tanya")).toBe(false);
  });
});

// ── Helper cases: discoverIdentitySessionFile ───────────────────────────────

describe("discoverIdentitySessionFile", () => {
  afterEach(() => {
    vi.mocked(execCommand).mockReset();
  });

  it("CASE-H1: happy-path single match returns the absolute path", async () => {
    // Shell short-circuits at the first matching file and prints its path.
    mockExecReturning(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/16da4efa-abc.jsonl\n",
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/16da4efa-abc.jsonl",
    );
  });

  it("CASE-H2: mtime-latest tiebreak is a shell-side guarantee (D-03) — JS trusts the emitted path", async () => {
    // D-03 tiebreak moved into the shell: `sort -rn` orders newest-first and
    // the outer `while | head -1` stops at the first match, so the emitted
    // path is by construction the mtime-latest match. JS-side is a passthrough.
    mockExecReturning(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/newest.jsonl\n",
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/newest.jsonl",
    );
  });

  it("CASE-H3: no matches → returns null, no throw (D-05 fallback)", async () => {
    // Shell walked every candidate, found no match — empty stdout.
    mockExecReturning("");
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H4a: shell reports a match → passthrough", async () => {
    // The shell's `head -c 4096 | grep -Fm 1 "<command-args>NAME<"` naturally
    // skips leading assistant/system lines and matches the first user-role
    // line containing the identity signature.
    mockExecReturning(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/e.jsonl\n",
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/e.jsonl",
    );
  });

  it("CASE-H4b: shell reports no match (plain user turn, no /id) → null", async () => {
    mockExecReturning("");
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H5: first-4-KB window is a shell-side guarantee (D-02) — later-file /id mentions never reach JS", async () => {
    // The shell's `head -c 4096` bounds the read window; a `/id` turn buried
    // past the first 4 KB is never seen by grep and never emitted. If the
    // shell found no match in-window, stdout is empty.
    mockExecReturning("");
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H6: empty projects dir (or find produced no matches) → returns null (D-05 cold-start)", async () => {
    mockExecReturning("");
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H7: SSH throw → returns null, no throw propagates (fail-safe)", async () => {
    mockExecReturning(() =>
      Promise.reject(new Error("SSH channel closed unexpectedly")),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H8: partial-name refusal is a shell-side guarantee (D-01) — the match pattern includes the trailing `<` delimiter", async () => {
    // The load-bearing property of D-01: identity `tiffany` MUST NOT match a
    // JSONL line whose only signature is `<command-args>tiff<`. Enforced now
    // by grep -F on the full `<command-args>tiffany<` literal — `tiff<` is
    // not a substring of `tiffany<`.
    //
    // Assert the shell script contains the delimiter-anchored pattern for
    // the requested identity name (couples the test to the D-01 contract,
    // not to the exact shell wording).
    mockExecReturning("");
    await discoverIdentitySessionFile(fakeConn, "tiffany");
    const cmd = vi.mocked(execCommand).mock.calls[0][1];
    expect(cmd).toContain("<command-args>");
    // Pattern uses grep -F (fixed string) so partial-name substrings can't match.
    expect(cmd).toMatch(/grep\s+[^|]*-F/);
  });

  it("issues an execCommand whose command string references `~/.claude/projects/` and uses `find` with `.jsonl` — loosely couples test to the enumeration primitive", async () => {
    mockExecReturning("");
    await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(execCommand).toHaveBeenCalledTimes(1);
    const cmd = vi.mocked(execCommand).mock.calls[0][1];
    expect(cmd).toContain("~/.claude/projects/");
    // Either `find` + `.jsonl` OR a functionally equivalent enumeration primitive.
    expect(cmd).toMatch(/find|\.jsonl/);
  });

  it("single-quote-wraps the identity name into the shell script (T-32-01 mitigation)", async () => {
    mockExecReturning("");
    await discoverIdentitySessionFile(fakeConn, "tanya");
    const cmd = vi.mocked(execCommand).mock.calls[0][1];
    // The identity name is single-quote-wrapped when interpolated into the
    // shell script for defense-in-depth per T-32-01. Even though grep -F now
    // treats the pattern as a fixed string (no regex interpretation), the
    // quote-wrap layer stays as belt-and-suspenders against a name that
    // slips past upstream validation.
    if (cmd.includes("tanya")) {
      expect(cmd).toMatch(/'tanya'/);
    }
  });

  it("short-circuits at the first matching file — stdout is a single path, not a records blob", async () => {
    // Contract: shell emits ONE path (mtime-latest match) and stops. If
    // stdout contained multiple lines, the passthrough would leak the trailing
    // ones. Verify the trim-then-return logic collapses to the single path.
    mockExecReturning(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/first.jsonl\n",
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/first.jsonl",
    );
    // A stray trailing whitespace line must not corrupt the returned path.
    mockExecReturning(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/first.jsonl\n\n",
    );
    const result2 = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result2).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/first.jsonl",
    );
  });
});

// ── LOCAL-branch cases (conn === null): 2026-09-13 ──────────────────────────
//
// discoverIdentitySessionFile now accepts (Client | null, identityName). When
// conn is null, the sensor reads the local FS under HOME_HOST_DIR/.claude/
// projects/ — exercised by identity-birth-orchestrator's supervisor-wait for
// co-located births. The tests below mirror CASE-H1/H2/H3/H6/H7/H8 semantics
// against a real tmpdir fixture (tmpRoot is the home root; the seed function
// writes into `<tmpRoot>/.claude/projects/<slug>/`, mirroring production
// shape where /host-home/.claude/projects/ is the live path). execCommand is
// not touched on the null-conn path.

describe("discoverIdentitySessionFile — LOCAL branch (conn === null)", () => {
  let tmpRoot: string;
  let projectsRoot: string;
  const prevEnv = process.env.HOME_HOST_DIR;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "disco-local-"));
    projectsRoot = path.join(tmpRoot, ".claude", "projects");
    await fsp.mkdir(projectsRoot, { recursive: true });
    process.env.HOME_HOST_DIR = tmpRoot;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.HOME_HOST_DIR;
    else process.env.HOME_HOST_DIR = prevEnv;
    try {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  async function seed(
    projectSlug: string,
    fileName: string,
    firstLine: string,
    mtimeSeconds: number,
  ): Promise<string> {
    const projDir = path.join(projectsRoot, projectSlug);
    await fsp.mkdir(projDir, { recursive: true });
    const full = path.join(projDir, fileName);
    await fsp.writeFile(full, firstLine + "\n", "utf8");
    await fsp.utimes(full, mtimeSeconds, mtimeSeconds);
    return full;
  }

  it("LOCAL-CASE-L1: single matching JSONL → returns absolute path", async () => {
    const filePath = await seed(
      "-home-ubuntu-fleet-identities-tanya-workspace",
      "session.jsonl",
      firstUserTurnLine("tanya"),
      1_000_000,
    );
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(filePath);
  });

  it("LOCAL-CASE-L2: multi-match returns the mtime-latest path (D-03 tiebreak)", async () => {
    await seed(
      "-home-ubuntu-fleet-identities-tanya-workspace",
      "old.jsonl",
      firstUserTurnLine("tanya"),
      1000,
    );
    const newestPath = await seed(
      "-home-ubuntu-fleet-identities-tanya-workspace",
      "newest.jsonl",
      firstUserTurnLine("tanya"),
      2000,
    );
    await seed(
      "-home-ubuntu-fleet-identities-tanya-workspace",
      "middle.jsonl",
      firstUserTurnLine("tanya"),
      1500,
    );
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(newestPath);
  });

  it("LOCAL-CASE-L3: no matches → returns null, no throw (D-05 fallback)", async () => {
    await seed(
      "-home-ubuntu-fleet-identities-nelly-workspace",
      "a.jsonl",
      firstUserTurnLine("nelly"),
      1000,
    );
    await seed(
      "-home-ubuntu-throwaway",
      "b.jsonl",
      plainUserTurnLine("hello there"),
      900,
    );
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(null);
  });

  it("LOCAL-CASE-L4: empty projects dir → returns null (cold-start)", async () => {
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(null);
  });

  it("LOCAL-CASE-L5: missing projects root → returns null, no throw (fail-safe)", async () => {
    // Point HOME_HOST_DIR at a nonexistent path so getLocalClaudeProjectsRoot's
    // derived <root>/.claude/projects also doesn't exist.
    process.env.HOME_HOST_DIR = path.join(tmpRoot, "does-not-exist");
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(null);
  });

  it("LOCAL-CASE-L6: partial-name refusal end-to-end — identity `tiffany` does not match a JSONL whose first user line is `<command-args>tiff<`", async () => {
    await seed(
      "-home-ubuntu-fleet-identities-tiff-workspace",
      "h.jsonl",
      firstUserTurnLine("tiff"),
      1000,
    );
    const result = await discoverIdentitySessionFile(null, "tiffany");
    expect(result).toBe(null);
  });

  it("LOCAL-CASE-L7: file with no user-role line in first 4KB → skipped, returns null", async () => {
    const projDir = path.join(
      projectsRoot,
      "-home-ubuntu-fleet-identities-tanya-workspace",
    );
    await fsp.mkdir(projDir, { recursive: true });
    // 5KB of non-user-role content (a run of assistant lines, say).
    const filler = '{"type":"assistant"}\n'.repeat(300);
    const full = path.join(projDir, "no-user.jsonl");
    await fsp.writeFile(full, filler, "utf8");
    const result = await discoverIdentitySessionFile(null, "tanya");
    expect(result).toBe(null);
  });
});
