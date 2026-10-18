import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InterruptCancelTracker,
  isInterruptMarker,
  isPromptStart,
} from "./interrupt-cancel-tracker.js";

// Fixtures are real Claude Code transcripts from the 2026-10-16/18 proving
// runs, stripped to structural fields (uuid / parentUuid / type / content).
const FIXTURES = join(__dirname, "__fixtures__", "interrupt");

function load(name: string): Record<string, unknown>[] {
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function promptText(obj: Record<string, unknown>): string {
  const c = (obj.message as { content?: unknown } | undefined)?.content;
  return typeof c === "string" ? c : "";
}

/** Replay a transcript; return the prompt texts the tracker hid / unhid. */
function replay(
  entries: Record<string, unknown>[],
  liveCancel?: { textPrefix: string; beforeIndex: number },
) {
  const tracker = new InterruptCancelTracker();
  const byUuid = new Map<string, string>();
  const hidden: string[] = [];
  const unhidden: string[] = [];
  entries.forEach((obj, i) => {
    if (liveCancel && i === liveCancel.beforeIndex) {
      const target = [...byUuid.entries()].find(([, t]) => t.startsWith(liveCancel.textPrefix));
      expect(target).toBeDefined();
      expect(tracker.markCancelledLive(target![0])).toBe(true);
      hidden.push(target![1]);
    }
    if (typeof obj.uuid === "string") byUuid.set(obj.uuid, promptText(obj));
    const ch = tracker.observe(obj, promptText(obj) || null);
    ch.hide.forEach((u) => hidden.push(byUuid.get(u) ?? u));
    ch.unhide.forEach((u) => unhidden.push(byUuid.get(u) ?? u));
  });
  return { tracker, hidden, unhidden };
}

describe("isPromptStart / isInterruptMarker", () => {
  it("classifies prompts, tool results and both marker variants", () => {
    expect(isPromptStart({ type: "user", message: { content: "hi" } })).toBe(true);
    expect(isPromptStart({ type: "user", isMeta: true, message: { content: "x" } })).toBe(false);
    expect(
      isPromptStart({ type: "user", message: { content: [{ type: "tool_result", content: "" }] } }),
    ).toBe(false);
    const plain = { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } };
    const tool = { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } };
    expect(isInterruptMarker(plain)).toBe(true);
    expect(isInterruptMarker(tool)).toBe(true);
    expect(isPromptStart(plain)).toBe(false);
    expect(isPromptStart({ type: "assistant", message: { content: "x" } })).toBe(false);
  });
});

describe("InterruptCancelTracker — sibling dead ends on real transcripts", () => {
  it("hides exactly the five cancelled prompts of the Opus scenario run", () => {
    const { hidden, unhidden } = replay(load("opus-scenarios.jsonl"));
    expect(hidden.map((t) => t.slice(0, 20))).toEqual([
      "CANCEL-ME-1: write a",
      "CANCEL-ME-2 line one",
      "Think very carefully",
      "CANCEL-ME-3: write a",
      "CANCEL-ME-4: write a",
    ]);
    expect(unhidden).toEqual([]);
  });

  it("hides the rewound Haiku edge prompts but not the first message of a session", () => {
    const { hidden } = replay(load("haiku-edges.jsonl"));
    expect(hidden.map((t) => t.slice(0, 8))).toEqual(["edge-0.8", "edge-1.2"]);
  });

  it("a fresh viewer of a revived transcript hides nothing (abrupt kill + resume)", () => {
    const { hidden } = replay(load("resume-after-abrupt-kill.jsonl"));
    expect(hidden).toEqual([]);
  });
});

describe("InterruptCancelTracker — revive after restart", () => {
  function indexAfterCancelledPrompt(entries: Record<string, unknown>[], prefix: string): number {
    const start = entries.findIndex((e) => promptText(e).startsWith(prefix));
    // first entry after the prompt that is neither its attachment nor uuid-less bookkeeping
    let i = start + 1;
    while (
      i < entries.length &&
      (entries[i].type === "attachment" || typeof entries[i].uuid !== "string")
    ) {
      i++;
    }
    return i;
  }

  it("unhides when resume writes a synthetic reply to the cancelled prompt", () => {
    const entries = load("resume-after-abrupt-kill.jsonl");
    const at = indexAfterCancelledPrompt(entries, "GAP-CANCEL");
    const { unhidden } = replay(entries, { textPrefix: "GAP-CANCEL", beforeIndex: at });
    expect(unhidden.map((t) => t.slice(0, 10))).toEqual(["GAP-CANCEL"]);
  });

  it("unhides when the next prompt after a clean-exit resume hangs off the cancelled one", () => {
    const entries = load("resume-after-clean-exit.jsonl");
    const at = indexAfterCancelledPrompt(entries, "EXIT-CANCEL");
    const { unhidden } = replay(entries, { textPrefix: "EXIT-CANCEL", beforeIndex: at });
    expect(unhidden.map((t) => t.slice(0, 11))).toEqual(["EXIT-CANCEL"]);
  });
});

describe("InterruptCancelTracker.decide", () => {
  const prompt = (uuid: string, parentUuid: string | null, text = "hello") => ({
    type: "user",
    uuid,
    parentUuid,
    message: { content: text },
  });
  const child = (type: string, uuid: string, parentUuid: string, text = "") => ({
    type,
    uuid,
    parentUuid,
    message: { content: [{ type: "text", text }] },
  });

  it("cancelled: latest prompt has nothing from the agent and no marker followed", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.observe({ type: "attachment", uuid: "a1", parentUuid: "p1" }, null);
    const snap = t.snapshot();
    const v = t.decide(snap);
    expect(v.verdict).toBe("cancelled");
    if (v.verdict === "cancelled") {
      expect(v.prompt.uuid).toBe("p1");
      expect(v.prompt.visibleText).toBe("hello");
    }
  });

  it("stopped: a marker landed after the snapshot", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.observe(child("assistant", "x1", "p1", "partial"), null);
    const snap = t.snapshot();
    t.observe(child("user", "m1", "x1", "[Request interrupted by user]"), null);
    expect(t.decide(snap)).toEqual({ verdict: "stopped" });
  });

  it("none: the agent had already answered (idle press)", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.observe(child("assistant", "x1", "p1", "done"), null);
    expect(t.decide(t.snapshot())).toEqual({ verdict: "none", reason: "agent_output" });
  });

  it("none: a second press after a cancel never re-cancels", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    expect(t.markCancelledLive("p1")).toBe(true);
    expect(t.decide(t.snapshot())).toEqual({ verdict: "none", reason: "already_cancelled" });
    expect(t.markCancelledLive("p1")).toBe(false);
  });

  it("none: an API error under the prompt means the harness already had it", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.observe({ type: "system", subtype: "api_error", uuid: "s1", parentUuid: "p1" }, null);
    expect(t.decide(t.snapshot())).toEqual({ verdict: "none", reason: "agent_output" });
  });

  it("none: nothing to act on before any prompt", () => {
    const t = new InterruptCancelTracker();
    expect(t.decide(t.snapshot())).toEqual({ verdict: "none", reason: "no_prompt" });
  });

  it("a live cancel is confirmed silently by the next sibling prompt (no duplicate hide)", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.markCancelledLive("p1");
    const ch = t.observe(prompt("p2", "root"), "again");
    expect(ch).toEqual({ hide: [], unhide: [] });
  });

  it("a stopped prompt is never treated as cancelled by a later prompt", () => {
    const t = new InterruptCancelTracker();
    t.observe(prompt("p1", "root"), "hello");
    t.observe(child("user", "m1", "p1", "[Request interrupted by user]"), null);
    const ch = t.observe(prompt("p2", "root"), "next");
    expect(ch.hide).toEqual([]);
  });
});
