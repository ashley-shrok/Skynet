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

import { describe, it, expect, vi, afterEach } from "vitest";

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
// The helper issues ONE execCommand call whose stdout is a stream of records:
//   <mtime>\t<absolute-path>\n<first-user-role-line>\n<RECORD-SEP>\n
// where <RECORD-SEP> is a distinctive delimiter chosen by the implementation.
//
// Tests declare the file set (path, mtime, first-user-role line) and the mock
// synthesizes the exact stdout the production shell script would emit. This
// couples the test to the OUTPUT CONTRACT of the shell script (not its exact
// wording) so the executor can refine the script without breaking these tests.
//
// The record format is documented as: for each JSONL candidate (in mtime-desc
// order), the shell emits three lines: `MTIME\tPATH`, then the first user-role
// line's raw bytes, then a fixed sentinel `---GSDR-32---` on its own line.
//
// If the shell finds no candidates, stdout is empty.

const RECORD_SEP = "---GSDR-32---";

type Candidate = { mtime: number; path: string; firstUserLine: string | null };

function synthesizeExecStdout(candidates: Candidate[]): string {
  // Emit in mtime-descending order — that's what `sort -rn` produces.
  const sorted = [...candidates].sort((a, b) => b.mtime - a.mtime);
  const parts: string[] = [];
  for (const c of sorted) {
    if (c.firstUserLine === null) {
      // No user-role line found in the head of this file — emit an empty
      // placeholder so the record structure stays consistent.
      parts.push(`${c.mtime}\t${c.path}\n\n${RECORD_SEP}`);
    } else {
      parts.push(`${c.mtime}\t${c.path}\n${c.firstUserLine}\n${RECORD_SEP}`);
    }
  }
  return parts.join("\n");
}

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

  it("accepts `\\r` immediately after identity (Windows-line-ending edge)", () => {
    const line = firstUserTurnLine("tanya", { delimiter: "\r" });
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
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1_000_000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/16da4efa-abc.jsonl",
          firstUserLine: firstUserTurnLine("tanya"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/16da4efa-abc.jsonl",
    );
  });

  it("CASE-H2: multi-match returns the mtime-latest path (D-03 tiebreak)", async () => {
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/old.jsonl",
          firstUserLine: firstUserTurnLine("tanya"),
        },
        {
          mtime: 2000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/newest.jsonl",
          firstUserLine: firstUserTurnLine("tanya"),
        },
        {
          mtime: 1500,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/middle.jsonl",
          firstUserLine: firstUserTurnLine("tanya"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/newest.jsonl",
    );
  });

  it("CASE-H3: no matches → returns null, no throw (D-05 fallback)", async () => {
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-nelly/a.jsonl",
          firstUserLine: firstUserTurnLine("nelly"),
        },
        {
          mtime: 900,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-throwaway/b.jsonl",
          firstUserLine: plainUserTurnLine("hello there"),
        },
        {
          mtime: 800,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-throwaway/c.jsonl",
          firstUserLine: plainUserTurnLine("another plain message"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H4a: file whose first user-role line matches → matches (throwaway assistant bootstrap tolerated)", async () => {
    // The shell script's `grep -m 1 '\"role\":\"user\"'` naturally SKIPS any leading
    // assistant/system lines and lands on the first user-role line. This test
    // verifies the helper matches when that first user-role line IS the /id turn.
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/e.jsonl",
          firstUserLine: firstUserTurnLine("tanya"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(
      "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/e.jsonl",
    );
  });

  it("CASE-H4b: file whose first user-role line is a plain user turn (no /id) → no match (D-04 throwaway excluded by construction)", async () => {
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-throwaway/f.jsonl",
          firstUserLine: plainUserTurnLine("just a normal message"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tanya");
    expect(result).toBe(null);
  });

  it("CASE-H5: later-in-file /id mention NOT matched — only the first user-role line is inspected (D-02)", async () => {
    // The shell script emits ONLY the first user-role line per file. Simulate
    // that by having the mock emit a plain user line as the first-user-line
    // for a file whose actual JSONL has a later /id turn — the helper cannot
    // see the later turn because it never leaves the shell.
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tanya/g.jsonl",
          firstUserLine: plainUserTurnLine("hello"),
        },
      ]),
    );
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

  it("CASE-H8: partial-name refusal end-to-end (D-01 delegation) — identity `tiffany` does not match a JSONL whose first user line is `<command-args>tiff<`", async () => {
    mockExecReturning(
      synthesizeExecStdout([
        {
          mtime: 1000,
          path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tiff/h.jsonl",
          firstUserLine: firstUserTurnLine("tiff"),
        },
      ]),
    );
    const result = await discoverIdentitySessionFile(fakeConn, "tiffany");
    expect(result).toBe(null);
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
    // The identity name — even though not used in a grep pattern (byte-pattern
    // match happens in JS) — must still be single-quote-wrapped when interpolated
    // into the shell script for defense-in-depth per T-32-01.
    // The exact interpolation site depends on the shell script's shape; the
    // load-bearing assertion is that if the identity name appears in the script
    // AT ALL, it is wrapped in single quotes.
    if (cmd.includes("tanya")) {
      expect(cmd).toMatch(/'tanya'/);
    }
  });
});
