/**
 * The cancelled-message check, run for real in a shell against sample
 * transcripts (fix-search-hides-cancelled): the remote pass collects what the
 * conversation's cancel tracker needs, and the tracker decides. Run under
 * every awk a fleet box might have.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancelledFromPassOutput, composeCancelPassCommand } from "./conversation-search-cancels.js";

const user = (uuid: string, parentUuid: string | null, text: string) =>
  JSON.stringify({ parentUuid, isSidechain: false, type: "user", message: { role: "user", content: text }, uuid });
const agent = (uuid: string, parentUuid: string | null, text: string) =>
  JSON.stringify({
    parentUuid,
    isSidechain: false,
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    uuid,
  });
const attachment = (uuid: string, parentUuid: string) =>
  JSON.stringify({ parentUuid, isSidechain: false, type: "attachment", attachment: { type: "hook_additional_context", content: ["x"] }, uuid });
const enqueue = (text: string) => JSON.stringify({ type: "queue-operation", operation: "enqueue", content: text });

let dir: string;
let variants: Array<{ name: string; pathDir: string }> = [];
const files = new Map<string, string>();

function transcript(name: string, lines: string[]): void {
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, lines.join("\n") + "\n");
  files.set(name, path);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "conv-search-cancels-"));
  // Line numbers in comments.
  transcript("cancelled", [
    agent("a0", null, "hello"), //                     1
    user("u1", "a0", "cheese please"), //              2  withdrawn
    attachment("x1", "u1"), //                         3  (a rewind leaves attachments)
    user("u2", "a0", "crackers please"), //            4
    agent("a1", "u2", "crackers coming"), //           5
  ]);
  transcript("answered", [
    agent("a0", null, "hello"),
    user("u1", "a0", "cheese please"),
    attachment("x1", "u1"),
    agent("a1", "x1", "cheese coming"),
    user("u2", "a1", "thanks"),
  ]);
  transcript("stopped", [
    agent("a0", null, "hello"),
    user("u1", "a0", "cheese please"),
    user("m1", "u1", "[Request interrupted by user]"),
    user("u2", "m1", "never mind"),
  ]);
  transcript("latest", [agent("a0", null, "hello"), user("u1", "a0", "cheese please")]);
  transcript("twice", [
    agent("a0", null, "hello"),
    user("u1", "a0", "cheese 1"), //                   2  withdrawn
    user("u2", "a0", "cheese 2"), //                   3  withdrawn
    user("u3", "a0", "cheese 3"), //                   4  kept
    agent("a1", "u3", "ok"),
  ]);
  transcript("revived", [
    agent("a0", null, "hello"),
    user("u1", "a0", "cheese please"),
    agent("a1", "u1", "No response requested."),
    user("u2", "a1", "next"),
  ]);
  transcript("rewound", [
    agent("a0", null, "hello"),
    user("u1", "a0", "cheese please"), //              2  answered, later branched past
    agent("a1", "u1", "cheese coming"),
    user("u2", "a0", "start over"),
  ]);
  transcript("queued", [agent("a0", null, "hello"), enqueue("cheese queued"), user("u1", "a0", "cheese queued")]);
  variants = awkVariants();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Every awk a box might have, each put first on PATH in turn. */
function awkVariants(): Array<{ name: string; pathDir: string }> {
  const out: Array<{ name: string; pathDir: string }> = [];
  for (const [name, bin, args] of [
    ["mawk", "/usr/bin/mawk", null],
    ["gawk", "/usr/bin/gawk", null],
    ["busybox", "/usr/bin/busybox", "awk"],
  ] as const) {
    if (!existsSync(bin)) continue;
    const pathDir = join(dir, `bin-${name}`);
    mkdirSync(pathDir, { recursive: true });
    const shim = join(pathDir, "awk");
    if (args === null) symlinkSync(bin, shim);
    else writeFileSync(shim, `#!/bin/sh\nexec ${bin} ${args} "$@"\n`, { mode: 0o755 });
    out.push({ name, pathDir });
  }
  return out;
}

function cancelled(asked: Record<string, number[]>, pathDir?: string): string[] {
  const targets = new Map(Object.entries(asked).map(([name, lines]) => [files.get(name)!, lines]));
  const out = execFileSync("sh", ["-c", composeCancelPassCommand(targets)], {
    encoding: "utf8",
    env: pathDir ? { ...process.env, PATH: `${pathDir}:${process.env.PATH}` } : process.env,
  });
  const byPath = new Map([...files].map(([name, path]) => [path, name]));
  return [...cancelledFromPassOutput(out)]
    .map((key) => {
      const [path, line] = key.split("\t");
      return `${byPath.get(path)}:${line}`;
    })
    .sort();
}

describe("conversation-search cancel pass", () => {
  it("collects nothing when asked about nothing", () => {
    expect(cancelled({})).toEqual([]);
  });

  it.each(["default", "mawk", "gawk", "busybox"])("decides like the conversation does (%s awk)", (name) => {
    let pathDir: string | undefined;
    if (name !== "default") {
      const v = variants.find((a) => a.name === name);
      if (!v) return; // not installed here
      pathDir = v.pathDir;
    }
    expect(
      cancelled(
        {
          cancelled: [2],
          answered: [2],
          stopped: [2],
          latest: [2],
          twice: [2, 3, 4],
          revived: [2],
          rewound: [2],
          queued: [3],
        },
        pathDir,
      ),
    ).toEqual(["cancelled:2", "twice:2", "twice:3"]);
  });

  it("a withdrawn message asked about alone is still found", () => {
    expect(cancelled({ cancelled: [2] })).toEqual(["cancelled:2"]);
    expect(cancelled({ twice: [3] })).toEqual(["twice:3"]);
  });

  it("sends lines other than the user's as just their kind and ids", () => {
    const out = execFileSync(
      "sh",
      ["-c", composeCancelPassCommand(new Map([[files.get("answered")!, [2]]]))],
      { encoding: "utf8" },
    );
    const sent = out.trim().split("\n").map((l) => l.split("\t")[3]);
    expect(sent).toEqual([
      user("u1", "a0", "cheese please"),
      JSON.stringify({ type: "attachment", uuid: "x1", parentUuid: "u1" }),
      JSON.stringify({ type: "other", uuid: "a1", parentUuid: "x1" }),
    ]);
  });

  it("stops reading a transcript once every asked-about message is settled", () => {
    const long = [agent("a0", null, "hello"), user("u1", "a0", "cheese"), user("u2", "a0", "again")];
    for (let i = 0; i < 5000; i++) long.push(agent(`z${i}`, i === 0 ? "u2" : `z${i - 1}`, "filler"));
    transcript("long", long);
    const out = execFileSync(
      "sh",
      ["-c", composeCancelPassCommand(new Map([[files.get("long")!, [2]]]))],
      { encoding: "utf8" },
    );
    expect(out.trim().split("\n")).toHaveLength(2); // the message and its branch-mate
    expect(cancelledFromPassOutput(out).size).toBe(1);
  });

  it("paths with spaces and quotes are arguments, never shell syntax", () => {
    const odd = join(dir, "it's a \"file\".jsonl");
    writeFileSync(odd, [agent("a0", null, "hi"), user("u1", "a0", "cheese"), user("u2", "a0", "again")].join("\n") + "\n");
    const out = execFileSync("sh", ["-c", composeCancelPassCommand(new Map([[odd, [2]]]))], { encoding: "utf8" });
    expect([...cancelledFromPassOutput(out)]).toEqual([`${odd}\t2`]);
  });
});
