// Coverage for the windowed open: snapshot + newest-first read that stops at
// the target, in-order replay with correct line numbers, live follow from
// just past the snapshot, the whole-history background-work search, and the
// full-read fallback.

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { Client } from "ssh2";
import {
  tailSessionFileWindowed,
  searchBackgroundWorkHistory,
  visibleItemKey,
  type WindowStats,
} from "./session-file-window.js";
import { __openBackgroundWorkIdsForTests as openBackgroundWorkIds } from "./claude-session-server.js";

const TS = "2026-10-27T00:00:00Z";
const user = (id: string, text = id) =>
  JSON.stringify({ type: "user", uuid: id, timestamp: TS, message: { role: "user", content: text } });
const reply = (id: string) =>
  JSON.stringify({ type: "assistant", uuid: id, timestamp: TS, message: { role: "assistant", content: [{ type: "text", text: id }] } });
const toolUse = (id: string) =>
  JSON.stringify({ type: "assistant", uuid: id, timestamp: TS, message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${id}`, name: "Bash", input: { command: "ls" } }] } });

type Stream = EventEmitter & {
  stderr: EventEmitter;
  close: ReturnType<typeof vi.fn>;
  signal: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function makeStream(): Stream {
  const s = new EventEmitter() as Stream;
  s.stderr = new EventEmitter();
  s.close = vi.fn(() => s.emit("close", null));
  s.signal = vi.fn();
  s.end = vi.fn();
  return s;
}

/**
 * Fake host holding one file. Answers the snapshot/backwards command by
 * streaming `wc -l` then the lines newest-first in small chunks (recording
 * how many it got to send before being hung up), the tail command by
 * recording it, and grep commands via `grepFn`.
 */
function makeHost(lines: string[], opts: { noTac?: boolean; missing?: boolean; cutAfter?: number; grepFn?: (cmd: string) => string } = {}) {
  const execs: string[] = [];
  let backwardsSent = 0;
  const tailStreams: Stream[] = [];
  let backwardsStream: Stream | null = null;
  const exec = vi.fn((cmd: string, cb: (err: Error | null, s: Stream) => void) => {
    execs.push(cmd);
    const s = makeStream();
    cb(null, s);
    if (cmd.includes("| tac")) {
      backwardsStream = s;
      setImmediate(async () => {
        if (opts.missing) {
          s.stderr.emit("data", Buffer.from("No such file"));
          s.emit("close", 3);
          return;
        }
        s.emit("data", Buffer.from(`${lines.length}\n`));
        if (opts.noTac) {
          s.emit("close", 4);
          return;
        }
        // Like Tailscale SSH: TERM ends the command and the server closes
        // the channel; a client-side close also stops it.
        let closed = false;
        let termed = false;
        s.close = vi.fn(() => { closed = true; });
        s.signal = vi.fn((name: string) => { if (name === "TERM") termed = true; });
        for (let i = lines.length - 1; i >= 0 && !closed && !termed; i--) {
          if (opts.cutAfter !== undefined && backwardsSent >= opts.cutAfter) {
            s.emit("close", undefined);
            return;
          }
          backwardsSent++;
          s.emit("data", Buffer.from(lines[i] + "\n"));
          await new Promise((r) => setImmediate(r));
        }
        if (!closed) s.emit("close", termed ? null : 0);
      });
    } else if (cmd.includes("tail -F")) {
      tailStreams.push(s);
    } else if (cmd.includes("grep")) {
      setImmediate(() => {
        s.emit("data", Buffer.from(opts.grepFn?.(cmd) ?? ""));
        s.emit("close", 0);
      });
    }
  });
  return {
    conn: { exec } as unknown as Client,
    execs,
    tailStreams,
    get backwardsSent() { return backwardsSent; },
    get backwardsStream() { return backwardsStream; },
  };
}

function open(host: ReturnType<typeof makeHost>, target: number, extra: Partial<Parameters<typeof tailSessionFileWindowed>[4]> = {}) {
  const events: string[] = [];
  let done: WindowStats | null = null;
  let startLine = -1;
  const handle = tailSessionFileWindowed(
    host.conn,
    "/home/u/.claude/projects/x/sess.jsonl",
    (line) => events.push(line),
    (err) => events.push(`ERR ${err.message}`),
    {
      targetItems: target,
      onWindowStart: (s) => { startLine = s; events.push(`START ${s}`); },
      onWindowDone: (st) => { done = st; events.push("DONE"); },
      ...extra,
    },
  );
  return { handle, events, get done() { return done; }, get startLine() { return startLine; } };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("tailSessionFileWindowed", () => {
  it("stops reading once the target items are found and replays the window in order", async () => {
    // 40 messages, each followed by two tool lines — 120 lines total.
    const lines: string[] = [];
    for (let i = 1; i <= 40; i++) lines.push(user(`m${i}`), toolUse(`t${i}a`), toolUse(`t${i}b`));
    const host = makeHost(lines);
    const o = open(host, 5);
    await settle();
    // Newest five messages are m36..m40, starting at line (36-1)*3+1 = 106.
    expect(o.startLine).toBe(106);
    const replayed = o.events.slice(o.events.indexOf("START 106") + 1, o.events.indexOf("DONE"));
    expect(replayed).toEqual(lines.slice(105));
    // Hung up after the 15th line from the end — never read the rest. The
    // hang-up is a TERM, not a mid-stream close (which drops the whole
    // connection on Tailscale SSH).
    expect(host.backwardsSent).toBe(15);
    expect(host.backwardsStream?.signal).toHaveBeenCalledWith("TERM");
    expect(host.backwardsStream?.close).not.toHaveBeenCalled();
    expect(o.done).toMatchObject({ totalLines: 120, startLine: 106, windowLines: 15, items: 5, fallback: null });
    // Live follow starts just past the snapshot.
    expect(host.execs.some((c) => c.includes("tail -F -n +121 "))).toBe(true);
  });

  it("replays the whole file when it holds fewer items than the target", async () => {
    const lines = [user("a"), reply("b"), toolUse("c")];
    const host = makeHost(lines);
    const o = open(host, 25);
    await settle();
    expect(o.startLine).toBe(1);
    expect(o.events).toEqual(["START 1", ...lines, "DONE"]);
    expect(host.execs.some((c) => c.includes("tail -F -n +4 "))).toBe(true);
  });

  it("handles an empty file", async () => {
    const host = makeHost([]);
    const o = open(host, 25);
    await settle();
    expect(o.events).toEqual(["START 1", "DONE"]);
    expect(host.execs.some((c) => c.includes("tail -F -n +1 "))).toBe(true);
  });

  it("feeds whole-history lines from before the window, in file order", async () => {
    const lines = [user("old1"), toolUse("bg"), user("old2"), user("new1"), user("new2")];
    const host = makeHost(lines);
    // The search covers the whole file; matches inside the window are dropped.
    const loadHistory = vi.fn(async (): Promise<Array<[number, string]>> => [[2, lines[1]!], [5, lines[4]!]]);
    const o = open(host, 2, { loadHistory, onHistoryLine: (l) => o.events.push(`HIST ${l}`) });
    await settle();
    expect(o.events).toEqual([`HIST ${lines[1]}`, "START 4", lines[3], lines[4], "DONE"]);
  });

  it("falls back to the full read when the host has no tac, marking done after the snapshot", async () => {
    const lines = [user("a"), user("b"), user("c")];
    const host = makeHost(lines, { noTac: true });
    const o = open(host, 25);
    await settle();
    expect(host.execs.some((c) => c.includes("tail -F -n +1 "))).toBe(true);
    expect(o.events).toEqual(["START 1"]);
    const tail = host.tailStreams[0]!;
    tail.emit("data", Buffer.from(lines[0] + "\n" + lines[1] + "\n"));
    expect(o.done).toBeNull();
    tail.emit("data", Buffer.from(lines[2] + "\n"));
    expect(o.events).toEqual(["START 1", ...lines, "DONE"]);
    expect(o.done).toMatchObject({ fallback: "no tac on host", totalLines: 3, windowLines: 3 });
    expect(o.done!.windowBytes).toBe(lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0));
  });

  it("falls back immediately-done when the snapshot can't be taken", async () => {
    const host = makeHost([], { missing: true });
    const o = open(host, 25);
    await settle();
    expect(o.events).toEqual(["START 1", "DONE"]);
    expect(host.execs.some((c) => c.includes("tail -F -n +1 "))).toBe(true);
  });

  it("falls back to the full read when the backwards read is cut short", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => user(`u${i}`));
    const host = makeHost(lines, { cutAfter: 3 });
    const o = open(host, 25);
    await settle();
    // No short window was replayed: the fallback starts from line 1.
    expect(o.events).toEqual(["START 1"]);
    expect(host.execs.some((c) => c.includes("tail -F -n +1 "))).toBe(true);
  });

  it("falls back when the host goes silent mid-read", async () => {
    vi.useFakeTimers();
    try {
      const execs: string[] = [];
      const conn = {
        exec: (cmd: string, cb: (err: Error | null, s: Stream) => void) => {
          execs.push(cmd);
          cb(null, makeStream()); // never sends, never closes
        },
      } as unknown as Client;
      const events: string[] = [];
      tailSessionFileWindowed(conn, "/x/s.jsonl", () => {}, () => {}, {
        targetItems: 25,
        onWindowStart: (n) => events.push(`START ${n}`),
        onWindowDone: (st) => events.push(`DONE ${st.fallback}`),
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(events[0]).toBe("START 1");
      expect(events[1]).toMatch(/^DONE stalled/);
      expect(execs.some((c) => c.includes("tail -F -n +1 "))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps replaying the window past a line whose handler throws", async () => {
    const lines = [user("a"), user("b"), user("c")];
    const host = makeHost(lines);
    const seen: string[] = [];
    const errors: string[] = [];
    tailSessionFileWindowed(
      host.conn,
      "/x/s.jsonl",
      (line) => {
        if (line === lines[1]) throw new Error("boom");
        seen.push(line);
      },
      (e) => errors.push(e.message),
      { targetItems: 25, onWindowStart: () => {}, onWindowDone: () => {} },
    );
    await settle();
    expect(seen).toEqual([lines[0], lines[2]]);
    expect(errors).toEqual(["boom"]);
  });

  it("runs the backwards read under the given exec limiter and frees it when stopped while queued", async () => {
    const lines = [user("a")];
    const host = makeHost(lines);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let settledInside = false;
    const runExec = async <T,>(fn: () => Promise<T>): Promise<T> => {
      await gate;
      const v = await fn();
      settledInside = true;
      return v;
    };
    const o = open(host, 25, { runExec });
    o.handle.stop();
    release();
    await settle();
    expect(settledInside).toBe(true);
    expect(host.execs).toEqual([]);
  });

  it("stop() during the backwards read opens no live tail", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => toolUse(`x${i}`));
    const host = makeHost(lines);
    const o = open(host, 25);
    o.handle.stop();
    await settle();
    expect(host.execs.some((c) => c.includes("tail -F"))).toBe(false);
    expect(o.events).toEqual([]);
  });
});

describe("visibleItemKey", () => {
  it("counts messages and skips tool activity", () => {
    expect(visibleItemKey(user("u1"))).toBe("u1");
    expect(visibleItemKey(reply("a1"))).toBe("a1");
    expect(visibleItemKey(toolUse("t1"))).toBeNull();
  });
});

describe("background-work history search", () => {
  const bgAgent = JSON.stringify({ type: "assistant", uuid: "a", timestamp: TS, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_bg1", name: "Agent", input: { run_in_background: true, subagent_type: "x", description: "d" } }] } });
  const bgShell = JSON.stringify({ type: "assistant", uuid: "b", timestamp: TS, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_sh1", name: "Bash", input: { run_in_background: true, command: "sleep 9" } }] } });
  const done = JSON.stringify({ type: "user", uuid: "c", timestamp: TS, message: { role: "user", content: "<task-notification>\n<tool-use-id>toolu_sh1</tool-use-id>\n<status>completed</status>\n</task-notification>" } });

  it("leaves open only work with no terminal record", () => {
    expect(openBackgroundWorkIds([bgAgent, bgShell, done])).toEqual(["toolu_bg1"]);
  });

  it("also asks for results of agents whose background-ness isn't settled yet", () => {
    const syncAgent = JSON.stringify({ type: "assistant", uuid: "s", timestamp: TS, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_sync1", name: "Agent", input: { subagent_type: "x", description: "d" } }] } });
    expect(openBackgroundWorkIds([syncAgent]).sort()).toEqual(["toolu_sync1"]);
  });

  it("greps the host before the window, then looks up results for still-open work", async () => {
    const agentResult = JSON.stringify({ type: "user", uuid: "r", timestamp: TS, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_bg1", content: "x" }] } });
    const host = makeHost([], {
      grepFn: (cmd) =>
        cmd.includes("grep -n -E")
          ? `3:${bgAgent}\n9:${bgShell}\n12:${done}\n`
          : `20:${agentResult}\n`,
    });
    const out = await searchBackgroundWorkHistory(host.conn, "/f.jsonl", openBackgroundWorkIds);
    expect(out).toEqual([[3, bgAgent], [9, bgShell], [12, done], [20, agentResult]]);
    const greps = host.execs.filter((c) => c.includes("grep"));
    expect(greps).toHaveLength(2);
    expect(greps[0]).toContain("'/f.jsonl'");
    expect(greps[1]).toContain(`'"tool_use_id":"toolu_bg1"'`);
    // The completed shell's result isn't looked up.
    expect(greps[1]).not.toContain("toolu_sh1");
  });

  it("skips the second pass when nothing is left open", async () => {
    const host = makeHost([], { grepFn: () => `9:${bgShell}\n12:${done}\n` });
    expect(await searchBackgroundWorkHistory(host.conn, "/f.jsonl", openBackgroundWorkIds)).toEqual([[9, bgShell], [12, done]]);
    expect(host.execs.filter((c) => c.includes("grep"))).toHaveLength(1);
  });

  it("its patterns match real record shapes and not prose that mentions them", async () => {
    const { execSync } = await import("child_process");
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const dir = mkdtempSync(join(tmpdir(), "bgwork-"));
    const f = join(dir, "s.jsonl");
    const launchAck = JSON.stringify({ type: "user", uuid: "l", timestamp: TS, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_sh1", content: "started" }] }, toolUseResult: { stdout: "{x}", backgroundTaskId: "b1" } });
    const pasted = JSON.stringify({ type: "user", uuid: "p", timestamp: TS, message: { role: "user", content: '<pasted_content id="ab12">\n<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification></pasted_content>' } });
    const prose = JSON.stringify({ type: "user", uuid: "q", timestamp: TS, message: { role: "user", content: 'the "run_in_background":true flag and <task-notification> tags, "isAsync":true' } });
    const apiBlob = JSON.stringify({ type: "api-request-blob", body: { content: "<task-notification>x" }, toolUseResult: { isAsync: true } });
    writeFileSync(f, [bgAgent, bgShell, launchAck, done, pasted, prose, apiBlob, toolUse("plain")].join("\n") + "\n");
    const realConn = {
      exec: (cmd: string, cb: (err: Error | null, s: Stream) => void) => {
        const s = makeStream();
        cb(null, s);
        setImmediate(() => {
          s.emit("data", execSync(cmd, { shell: "/bin/sh" }));
          s.emit("close", 0);
        });
      },
    } as unknown as Client;
    const out = await searchBackgroundWorkHistory(realConn, f, () => []);
    expect(out.map(([n]) => n)).toEqual([1, 2, 3, 4, 5]);
  });
});
