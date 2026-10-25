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

import { execFile } from "node:child_process";
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
  toHostPerspectivePath,
} from "./discover-identity-session-file.js";
import { agentHistoryFolderName, findAgentHistoryFiles } from "./agent-history-file.js";

// Stub ssh2 Client — execCommand is mocked at module level so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// ── Fixture builders ────────────────────────────────────────────────────────

/**
 * Build a JSONL line matching the empirical Claude Code first-user-turn shape
 * for `/id <identityName>`, as observed at
 * `~/.claude/projects/-home-ubuntu-skynet-tanya/*.jsonl`.
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

// ── REMOTE branch: the real lookup script, run by a real bash ──────────────
//
// execCommand is routed to `bash -c` with HOME pointed at a temp dir, so these
// cases exercise the actual shell the host runs — folder naming, mtime order,
// the head-of-file read — not a stub of its output.

function runInBash(home: string) {
  vi.mocked(execCommand).mockImplementation(
    (_conn: import("ssh2").Client, cmd: string): Promise<string> =>
      new Promise((resolve, reject) => {
        execFile(
          "bash",
          ["-c", cmd],
          { env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" } },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
      }),
  );
}

describe("discoverIdentitySessionFile — agent's own history folder (REMOTE)", () => {
  let home: string;

  beforeEach(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-history-"));
    runInBash(home);
  });

  afterEach(async () => {
    vi.mocked(execCommand).mockReset();
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
  });

  /** The folder Claude Code would create for `<home>/fleet/identities/<name>/workspace`. */
  function folderFor(name: string): string {
    const launch = `${home}/fleet/identities/${name}/workspace`;
    return path.join(home, ".claude", "projects", launch.replace(/[^a-zA-Z0-9]/g, "-"));
  }

  async function seedIn(dir: string, file: string, lines: string[], mtime: number): Promise<string> {
    await fsp.mkdir(dir, { recursive: true });
    const full = path.join(dir, file);
    await fsp.writeFile(full, lines.join("\n") + "\n", "utf8");
    await fsp.utimes(full, mtime, mtime);
    return full;
  }

  const harnessPreamble = [
    '{"type":"mode","mode":"normal","sessionId":"s"}',
    '{"type":"queue-operation","operation":"enqueue","content":"/id tanya"}',
    '{"type":"file-history-snapshot","messageId":"m","snapshot":{}}',
  ];

  it("finds the agent's file, skipping harness records that precede the /id turn", async () => {
    const f = await seedIn(folderFor("tanya"), "a.jsonl", [...harnessPreamble, firstUserTurnLine("tanya")], 1000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(f);
  });

  it("newest /id file wins when the folder holds several", async () => {
    await seedIn(folderFor("tanya"), "old.jsonl", [firstUserTurnLine("tanya")], 1000);
    const newest = await seedIn(folderFor("tanya"), "new.jsonl", [firstUserTurnLine("tanya")], 3000);
    await seedIn(folderFor("tanya"), "mid.jsonl", [firstUserTurnLine("tanya")], 2000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(newest);
  });

  it("a newer bare session in the agent's folder (no /id first turn) is never picked", async () => {
    const owned = await seedIn(folderFor("tanya"), "owned.jsonl", [firstUserTurnLine("tanya")], 1000);
    await seedIn(folderFor("tanya"), "bare.jsonl", [plainUserTurnLine("reply with just: ok")], 5000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(owned);
  });

  it("files outside the agent's own folder are never considered, even if they start with its /id", async () => {
    await seedIn(path.join(home, ".claude", "projects", "-home-ubuntu-skynet-tanya"), "x.jsonl", [firstUserTurnLine("tanya")], 9000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(null);
  });

  it("partial-name refusal: tiffany's lookup never reads tiff's folder, and a tiff /id in tiffany's folder doesn't match", async () => {
    await seedIn(folderFor("tiff"), "t.jsonl", [firstUserTurnLine("tiff")], 1000);
    await seedIn(folderFor("tiffany"), "u.jsonl", [firstUserTurnLine("tiff")], 1000);
    expect(await discoverIdentitySessionFile(fakeConn, "tiffany")).toBe(null);
  });

  it("only the first user turn counts — a later /id mention doesn't claim the file", async () => {
    await seedIn(folderFor("tanya"), "a.jsonl", [plainUserTurnLine("hi"), firstUserTurnLine("tanya")], 1000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(null);
  });

  it("tool_result user lines carrying the /id byte-pattern are refused", async () => {
    await seedIn(folderFor("tanya"), "a.jsonl", [toolResultUserTurnLine()], 1000);
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(null);
  });

  it("no folder yet (newborn) → null", async () => {
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(null);
  });

  it("SSH throw → null, no throw propagates", async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error("channel closed"));
    expect(await discoverIdentitySessionFile(fakeConn, "tanya")).toBe(null);
  });

  it("unsafe names never reach the shell", async () => {
    expect(await discoverIdentitySessionFile(fakeConn, "x'; rm -rf / #")).toBe(null);
    expect(vi.mocked(execCommand)).not.toHaveBeenCalled();
  });

  it("batched lookup answers every name in one exec, null for agents with no history", async () => {
    const a = await seedIn(folderFor("tanya"), "a.jsonl", [firstUserTurnLine("tanya")], 1000);
    const b = await seedIn(folderFor("nelly"), "b.jsonl", [firstUserTurnLine("nelly")], 1000);
    const got = await findAgentHistoryFiles(fakeConn, ["tanya", "nelly", "ghost"]);
    expect(Object.fromEntries(got)).toEqual({ tanya: a, nelly: b, ghost: null });
    expect(vi.mocked(execCommand)).toHaveBeenCalledTimes(1);
  });

  it("batched lookup throws on transport failure (callers tell 'not found' from 'couldn't look')", async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error("channel closed"));
    await expect(findAgentHistoryFiles(fakeConn, ["tanya"])).rejects.toThrow();
  });
});

describe("agentHistoryFolderName", () => {
  it("follows Claude Code's rule — every non-alphanumeric becomes '-'", () => {
    expect(agentHistoryFolderName("/home/ubuntu", "piano-box-maintainer-5")).toBe(
      "-home-ubuntu-fleet-identities-piano-box-maintainer-5-workspace",
    );
    expect(agentHistoryFolderName("/home/a.b/", "x_y")).toBe("-home-a-b-fleet-identities-x-y-workspace");
  });
});

describe("discoverIdentitySessionFile — LOCAL branch (conn === null)", () => {
  let tmpRoot: string;
  let projectsRoot: string;
  const prevEnv = process.env.HOME_HOST_DIR;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "disco-local-"));
    projectsRoot = path.join(tmpRoot, ".claude", "projects");
    await fsp.mkdir(projectsRoot, { recursive: true });
    process.env.HOME_HOST_DIR = tmpRoot;
    // The folder name comes from the HOST home; pin it so the seeded
    // `-home-ubuntu-…` folders match on any runner.
    vi.spyOn(os, "homedir").mockReturnValue("/home/ubuntu");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

// ── toHostPerspectivePath ───────────────────────────────────────────────────
// Regression coverage for the bind-mount path translator that fixes the
// load-more button hiding on identity panes whose session file was resolved
// via the LOCAL discovery branch (see toHostPerspectivePath JSDoc for the
// full failure mode: container-perspective path → SSH exec → No such file
// → totalLines: 0 → hasOlderMessages gate short-circuits false → button
// never mounts).
describe("toHostPerspectivePath", () => {
  const prevHomeHostDir = process.env.HOME_HOST_DIR;
  const prevMountSrc = process.env.SKYNET_HOME_MOUNT_SRC;

  afterEach(() => {
    if (prevHomeHostDir === undefined) delete process.env.HOME_HOST_DIR;
    else process.env.HOME_HOST_DIR = prevHomeHostDir;
    if (prevMountSrc === undefined) delete process.env.SKYNET_HOME_MOUNT_SRC;
    else process.env.SKYNET_HOME_MOUNT_SRC = prevMountSrc;
  });

  it("translates container-perspective path under HOME_HOST_DIR to host-perspective path under SKYNET_HOME_MOUNT_SRC", () => {
    process.env.HOME_HOST_DIR = "/host-home";
    process.env.SKYNET_HOME_MOUNT_SRC = "/home/ubuntu";
    expect(
      toHostPerspectivePath(
        "/host-home/.claude/projects/-slug/uuid.jsonl",
      ),
    ).toBe("/home/ubuntu/.claude/projects/-slug/uuid.jsonl");
  });

  it("returns input unchanged when HOME_HOST_DIR is unset (native-dev run)", () => {
    delete process.env.HOME_HOST_DIR;
    process.env.SKYNET_HOME_MOUNT_SRC = "/home/ubuntu";
    expect(
      toHostPerspectivePath("/home/dev/.claude/projects/slug/uuid.jsonl"),
    ).toBe("/home/dev/.claude/projects/slug/uuid.jsonl");
  });

  it("returns input unchanged when SKYNET_HOME_MOUNT_SRC is unset (partial-env native run)", () => {
    process.env.HOME_HOST_DIR = "/host-home";
    delete process.env.SKYNET_HOME_MOUNT_SRC;
    expect(
      toHostPerspectivePath("/host-home/.claude/projects/slug/uuid.jsonl"),
    ).toBe("/host-home/.claude/projects/slug/uuid.jsonl");
  });

  it("returns input unchanged for paths outside the bind-mount prefix (defensive)", () => {
    process.env.HOME_HOST_DIR = "/host-home";
    process.env.SKYNET_HOME_MOUNT_SRC = "/home/ubuntu";
    expect(toHostPerspectivePath("/etc/hosts")).toBe("/etc/hosts");
  });

  it("does not treat a path that only shares a prefix segment as under the mount (e.g. /host-home-other/x)", () => {
    process.env.HOME_HOST_DIR = "/host-home";
    process.env.SKYNET_HOME_MOUNT_SRC = "/home/ubuntu";
    // Guard against a naive `p.startsWith(containerHome)` — must require the
    // trailing slash (or exact match) so `/host-home-other/x` isn't rewritten
    // to `/home/ubuntu-other/x`.
    expect(toHostPerspectivePath("/host-home-other/x")).toBe(
      "/host-home-other/x",
    );
  });

  it("handles the exact-match edge case (path === HOME_HOST_DIR)", () => {
    process.env.HOME_HOST_DIR = "/host-home";
    process.env.SKYNET_HOME_MOUNT_SRC = "/home/ubuntu";
    expect(toHostPerspectivePath("/host-home")).toBe("/home/ubuntu");
  });
});
