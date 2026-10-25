import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { WebSocket } from "ws";
import type { Client } from "ssh2";
import {
  WorkNarrationHub,
  parseNarrationOutput,
  stepsFromLine,
  starterText,
  buildNarrationCommand,
  buildNarrationInput,
  MIN_INTERVAL_MS,
  SETTLE_MS,
  AUTH_EXTRACT_PY,
  type NarrationRunner,
} from "./work-narration.js";

vi.mock("../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface FakeWs {
  readyState: number;
  sent: Array<{ type: string; short: string | null; long: string | null }>;
  send: (s: string) => void;
}
const fakeWs = (): FakeWs & WebSocket => {
  const ws: FakeWs = {
    readyState: 1,
    sent: [],
    send(s: string) {
      ws.sent.push(JSON.parse(s));
    },
  };
  return ws as FakeWs & WebSocket;
};
const conn = {} as Client;

let t0 = Date.parse("2026-10-25T10:00:00Z");
let seq = 0;
const ts = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
const prompt = (text: string, at: number) =>
  JSON.stringify({ type: "user", uuid: `u${++seq}`, timestamp: ts(at), message: { role: "user", content: text } });
const turnEnd = (at: number) =>
  JSON.stringify({ type: "system", subtype: "turn_duration", uuid: `e${++seq}`, timestamp: ts(at) });
const tool = (description: string, at: number) =>
  JSON.stringify({
    type: "assistant",
    uuid: `a${++seq}`,
    timestamp: ts(at),
    message: { role: "assistant", content: [{ type: "tool_use", id: `t${seq}`, name: "Bash", input: { command: "x", description } }] },
  });

describe("parseNarrationOutput", () => {
  it("reads both labelled lines", () => {
    expect(parseNarrationOutput("SHORT: Fixing the bug\nLONG: Found the cause, fixing it now, then tests")).toEqual({
      short: "Fixing the bug",
      long: "Found the cause, fixing it now, then tests",
    });
  });
  it("tolerates markdown bold and quotes, and fills a missing half", () => {
    expect(parseNarrationOutput('**SHORT:** "Running tests"')).toEqual({ short: "Running tests", long: "Running tests" });
  });
  it("strips trailing bold markers and holds lines to the agreed word counts", () => {
    const out = parseNarrationOutput(
      "SHORT: one two three four five six seven eight nine ten eleven**\nLONG: a b c d e f g h i j k l m n o p q r s t,",
    );
    expect(out!.short).toBe("one two three four five six seven eight nine");
    expect(out!.long.split(" ")).toHaveLength(17);
  });
  it("returns null for anything else", () => {
    expect(parseNarrationOutput("I cannot help with that")).toBeNull();
  });
});

describe("stepsFromLine / starterText", () => {
  it("summarises tool calls, helper hand-offs, text and failures", () => {
    expect(stepsFromLine(JSON.parse(tool("Run the tests", 0)))).toEqual(["Bash: Run the tests"]);
    expect(
      stepsFromLine({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Agent", input: { description: "Review code", prompt: "Look for bugs" } }, { type: "text", text: "On it." }] },
      }),
    ).toEqual(["Handed work to a helper: Review code — Look for bugs", "Said: On it."]);
    expect(
      stepsFromLine({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "3 tests failed" }] } }),
    ).toEqual(["That step failed: 3 tests failed"]);
    expect(stepsFromLine({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } })).toEqual([]);
  });
  it("strips harness reminders from the turn starter", () => {
    expect(
      starterText({ type: "user", message: { content: "Fix the bubbles <system-reminder>noise</system-reminder>" } }),
    ).toBe("Fix the bubbles");
  });
});

describe("buildNarrationCommand / buildNarrationInput", () => {
  it("runs Haiku with hooks, tools, thinking and CLAUDE.md off", () => {
    const cmd = buildNarrationCommand();
    for (const part of ["--model haiku", '--tools ""', "--no-session-persistence", "MAX_THINKING_TOKENS=0", "CLAUDE_CODE_DISABLE_CLAUDE_MDS=1", "disableAllHooks"]) {
      expect(cmd).toContain(part);
    }
    expect(cmd).toContain('--setting-sources ""');
    expect(cmd).toContain("-u CLAUDECODE");
    // Signs in the way the agent does — an API key or Bedrock is carried over, not stripped.
    expect(cmd).not.toContain("-u ANTHROPIC_API_KEY");
    expect(cmd).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(cmd).not.toContain("--bare");
  });
  it("lays out starter, previous line and steps", () => {
    const input = buildNarrationInput("Fix it", null, ["Bash: a", "Read: b"]);
    expect(input).toContain("What started this turn:\nFix it");
    expect(input).toContain("Previous status line: (none yet)");
    expect(input).toContain("- Bash: a\n- Read: b");
  });
});

describe("sign-in extraction (runs the real script)", () => {
  const run = (settings: unknown, claudeJson: unknown, shellEnv: Record<string, string> = {}) => {
    const home = mkdtempSync(join(tmpdir(), "narr-home-"));
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(settings));
      writeFileSync(join(home, ".claude.json"), JSON.stringify(claudeJson));
      // No tmux session given → the agent's process isn't looked up; this shell's env is the base.
      return execFileSync("python3", ["-c", AUTH_EXTRACT_PY, ""], {
        env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", ...shellEnv },
      }).toString();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };

  it("carries Bedrock sign-in and nothing else", () => {
    const out = run(
      {
        env: { CLAUDE_CODE_USE_BEDROCK: true, AWS_REGION: "us-east-1", DISABLE_AUTO_COMPACT: "1", "ANTHROPIC_\u00c9X": "1", "BAD;x": "1" },
        awsAuthRefresh: "aws sso login",
        enabledPlugins: { "x@y": true },
        remoteControlAtStartup: true,
      },
      {},
    );
    expect(out).toContain("export CLAUDE_CODE_USE_BEDROCK=1\n");
    expect(out).toContain("export AWS_REGION=us-east-1\n");
    expect(out).not.toMatch(/DISABLE_AUTO_COMPACT|BAD|\u00c9X|Plugins|remoteControl/);
    expect(out).toMatch(/NARR_SETTINGS='\{"awsAuthRefresh": "aws sso login", "disableAllHooks": true, "alwaysThinkingEnabled": false\}'/);
  });

  it("drops an API key the agent turned down, and unsets it from the shell", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const out = run({ env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-tok" } }, { customApiKeyResponses: { rejected: [key.slice(-20)] } }, { ANTHROPIC_API_KEY: key });
    expect(out).toContain("unset ANTHROPIC_API_KEY\n");
    expect(out).toContain("export CLAUDE_CODE_OAUTH_TOKEN=oauth-tok\n");
    expect(out).not.toContain(key);
  });

  it("keeps an API key the agent uses, quoting values safely", () => {
    const out = run({ env: { ANTHROPIC_API_KEY: "sk-'$(touch /tmp/x)" } }, {});
    expect(out).toContain(`export ANTHROPIC_API_KEY='sk-'"'"'$(touch /tmp/x)'`);
  });
});

describe("WorkNarrationHub", () => {
  let now: number;
  let runner: ReturnType<typeof vi.fn<NarrationRunner>>;
  let hub: WorkNarrationHub;
  const ctx = (key = "1::agent") => ({ key, hostId: 1, tmuxSession: key.split("::")[1], conn });

  beforeEach(() => {
    vi.useFakeTimers();
    now = t0 + 60_000;
    vi.setSystemTime(now);
    seq = 0;
    runner = vi.fn<NarrationRunner>(async () => "SHORT: Fixing it\nLONG: Found the cause, fixing it now");
    hub = new WorkNarrationHub(runner, () => Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
  };

  it("writes the first line once three steps exist and a tab is watching, after replay settles", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Fix the bubbles", 0));
    hub.observeLine(ws, ctx(), tool("a", 1));
    hub.observeLine(ws, ctx(), tool("b", 2));
    await settle();
    expect(runner).not.toHaveBeenCalled();
    hub.observeLine(ws, ctx(), tool("c", 3));
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    const input = runner.mock.calls[0][2].toString();
    expect(input).toContain("Fix the bubbles");
    expect(input).toContain("- Bash: c");
    expect(ws.sent.at(-1)).toEqual({ type: "work_narration", short: "Fixing it", long: "Found the cause, fixing it now" });
  });

  it("a busy agent's live lines can't hold off the first line forever", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    // A step every second, for 20 seconds — never a 1.5 s pause.
    for (let i = 1; i <= 20; i++) {
      hub.observeLine(ws, ctx(), tool(`s${i}`, i * 1000));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(runner).toHaveBeenCalled();
  });

  it("never calls while no tab is watching", async () => {
    const ws = fakeWs();
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    for (let i = 1; i <= 5; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 2);
    expect(runner).not.toHaveBeenCalled();
    hub.setWatching(ws, true);
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("paces later lines: new steps AND the minimum interval", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    // Nothing new — no call even after the interval.
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS + 1000);
    expect(runner).toHaveBeenCalledTimes(1);
    // New step arrives — call fires right away since the interval has passed.
    hub.observeLine(ws, ctx(), tool("s4", 100_000));
    await vi.advanceTimersByTimeAsync(10);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1][2].toString()).toContain("Previous status line: Found the cause, fixing it now");
    // Another step soon after waits for the interval.
    hub.observeLine(ws, ctx(), tool("s5", 101_000));
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 1000);
    expect(runner).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("a new prompt starts a fresh turn: clears the line and drops the previous one from the input", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("First job", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    await settle();
    hub.observeLine(ws, ctx(), prompt("Second job", 10));
    expect(ws.sent.at(-1)).toEqual({ type: "work_narration", short: null, long: null });
    for (let i = 11; i <= 13; i++) hub.observeLine(ws, ctx(), tool(`n${i}`, i));
    await settle();
    expect(runner).toHaveBeenCalledTimes(2);
    const input = runner.mock.calls[1][2].toString();
    expect(input).toContain("Second job");
    expect(input).toContain("Previous status line: (none yet)");
    expect(input).not.toContain("- Bash: s1");
  });

  it("discards a reply that lands after the turn changed", async () => {
    let release!: (v: string) => void;
    runner.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Old", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    await settle();
    hub.observeLine(ws, ctx(), prompt("New", 10));
    release("SHORT: Old work\nLONG: Old work line");
    await vi.advanceTimersByTimeAsync(10);
    expect(ws.sent.some((f) => f.short === "Old work")).toBe(false);
  });

  it("shares one narrator between tabs and ignores a later tab's history replay", async () => {
    const a = fakeWs();
    const b = fakeWs();
    hub.setWatching(a, true);
    const lines = [prompt("Go", 0), tool("s1", 1), tool("s2", 2), tool("s3", 3)];
    for (const l of lines) hub.observeLine(a, ctx(), l);
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    // Tab B replays the same file from line 1 and gets the existing line at once.
    hub.setWatching(b, true);
    for (const l of lines) hub.observeLine(b, ctx(), l);
    expect(b.sent[0]).toEqual({ type: "work_narration", short: "Fixing it", long: "Found the cause, fixing it now" });
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 2);
    expect(runner).toHaveBeenCalledTimes(1);
    // A live line seen by both tails counts once and reaches both tabs.
    const live = tool("s4", 200_000);
    hub.observeLine(a, ctx(), live);
    hub.observeLine(b, ctx(), live);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1][2].toString().match(/- Bash: s4/g)).toHaveLength(1);
    expect(a.sent.at(-1)).toEqual(b.sent.at(-1));
  });

  it("keeps lines written a millisecond out of order, including a turn's prompt", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Old job", 0));
    hub.observeLine(ws, ctx(), tool("caveat line", 1000));
    // The slash-command prompt lands 1 ms "earlier" than the line before it.
    hub.observeLine(ws, ctx(), prompt("/build new job", 999));
    hub.observeLine(ws, ctx(), tool("s1", 998));
    hub.observeLine(ws, ctx(), tool("s2", 1001));
    hub.observeLine(ws, ctx(), tool("s3", 1002));
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    const input = runner.mock.calls[0][2].toString();
    expect(input).toContain("/build new job");
    expect(input).toContain("- Bash: s1");
  });

  it("clears the line at the turn-end marker, so it is not resent when the next turn's indicator lights", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    await settle();
    expect(ws.sent.at(-1)!.short).toBe("Fixing it");
    hub.observeLine(ws, ctx(), turnEnd(10));
    expect(ws.sent.at(-1)).toEqual({ type: "work_narration", short: null, long: null });
    hub.setWatching(ws, false);
    const before = ws.sent.length;
    hub.setWatching(ws, true);
    expect(ws.sent.length).toBe(before);
    // Steps after the turn ended (no new prompt yet) never narrate.
    for (let i = 11; i <= 14; i++) hub.observeLine(ws, ctx(), tool(`late${i}`, i));
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS * 2);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("skips a queued call whose turn moved on before it started", async () => {
    let release!: (v: string) => void;
    runner.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    const a = fakeWs();
    const b = fakeWs();
    hub.setWatching(a, true);
    hub.setWatching(b, true);
    for (const [ws, key] of [[a, "1::one"], [b, "1::two"]] as const) {
      hub.observeLine(ws, ctx(key), prompt("Go", 0));
      for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(key), tool(`s${i}`, i));
    }
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    // Agent two's turn ends while its call waits behind agent one's.
    hub.observeLine(b, ctx("1::two"), turnEnd(10));
    release("SHORT: a\nLONG: a");
    await vi.advanceTimersByTimeAsync(10);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("runs at most one call per host at a time", async () => {
    const releases: Array<(v: string) => void> = [];
    runner.mockImplementation(() => new Promise<string>((r) => releases.push(r)));
    const a = fakeWs();
    const b = fakeWs();
    hub.setWatching(a, true);
    hub.setWatching(b, true);
    for (const [ws, key] of [[a, "1::one"], [b, "1::two"]] as const) {
      hub.observeLine(ws, ctx(key), prompt("Go", 0));
      for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(key), tool(`s${i}`, i));
    }
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    releases[0]("SHORT: a\nLONG: a");
    await vi.advanceTimersByTimeAsync(10);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("backs off a full interval after a failed call and keeps the old line", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    runner.mockRejectedValueOnce(new Error("boom"));
    await settle();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(ws.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS - 1000);
    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("drops the narrator when the last tab leaves", async () => {
    const ws = fakeWs();
    hub.setWatching(ws, true);
    hub.observeLine(ws, ctx(), prompt("Go", 0));
    for (let i = 1; i <= 3; i++) hub.observeLine(ws, ctx(), tool(`s${i}`, i));
    hub.forget(ws);
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(runner).not.toHaveBeenCalled();
  });
});
