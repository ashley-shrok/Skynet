/**
 * The conversation-search scan, run for real in a shell against a sample
 * transcript (shape-search-matches-conversation): the structural filter drops
 * lines that can never be a bubble BEFORE the per-file cap counts them, and the
 * query is matched in the escaped form transcripts store.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../db/index.js", () => ({ db: {} }));

const { __composeGrepCommandForTests: composeGrepCommand } = await import("./conversation-search.js");

const line = (o: unknown) => JSON.stringify(o);
const userText = (text: string) => line({ type: "user", message: { role: "user", content: text } });
const agentText = (text: string) =>
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "conv-search-scan-"));
  file = join(dir, "t.jsonl");
  const lines = [
    line({ type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "skill cheese" }] } }),
    line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "cheese.txt" }] } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "cheese?" }] } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/cheese" } }] } }),
    line({ type: "attachment", attachment: { type: "hook_additional_context", content: ["cheese"] } }),
    line({ type: "system", content: "cheese" }),
    userText("I want cheese"),
    agentText("Cheese it is — say \"cheese\""),
    line({ type: "queue-operation", operation: "enqueue", content: "more cheese please" }),
    line({ type: "attachment", attachment: { type: "queued_command", prompt: "cheese again" } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "mcp__relay__send", input: { to: "@ashley:x", body: "cheese ready" } }] } }),
  ];
  writeFileSync(file, lines.join("\n") + "\n");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function scan(query: string, maxCount: number): number[] {
  const out = execFileSync("sh", ["-c", composeGrepCommand(query, [file], maxCount)], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => Number(l.split("\t")[2]));
}

describe("conversation-search scan", () => {
  it("keeps only lines that can be bubbles, before the cap counts", () => {
    expect(scan("cheese", 10)).toEqual([7, 8, 9, 10, 11]);
  });

  it("the cap counts kept lines only — hidden lines near the top can't use it up", () => {
    expect(scan("cheese", 2)).toEqual([7, 8]);
  });

  it("matches a query with quote marks against the escaped form stored in the transcript", () => {
    expect(scan('"cheese"', 10)).toEqual([8]);
  });

  it("treats the query as a fixed string, case-insensitively", () => {
    expect(scan("CHEESE IT", 10)).toEqual([8]);
    expect(scan("che.se", 10)).toEqual([]);
  });
});
