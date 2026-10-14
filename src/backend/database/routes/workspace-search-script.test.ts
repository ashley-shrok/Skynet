// @vitest-environment node
/**
 * Runs the real /workspace/search shell script against a temp $HOME and
 * parses its output — the script ↔ parser contract end to end without SSH.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SearchScriptError,
  buildSearchScript,
  parseSearchOutput,
  parseSearchQuery,
} from "./workspace-search-script.js";
import type { TargetSpec } from "./workspace-routes.js";

const alice: TargetSpec = { kind: "identity", identityKey: "alice" };
let home: string;
let ws: string;
/** Dir holding a fake `timeout` that runs the command, then reports "stopped". */
let fakeTimeoutBin: string;
let noTimeoutBin: string;

function touch(rel: string, content = ""): void {
  const p = path.join(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function run(script: string, extraPath = "", replacePath = false): string {
  const r = spawnSync("/bin/sh", ["-c", script], {
    encoding: "utf-8",
    env: { PATH: replacePath ? extraPath : `${extraPath}${process.env.PATH ?? ""}`, HOME: home },
  });
  return r.stdout;
}

function search(target: TargetSpec, start: string, query: string, hidden: string | null = null) {
  return parseSearchOutput(run(buildSearchScript(target, start, parseSearchQuery(query)!, hidden)));
}

function paths(target: TargetSpec, start: string, query: string, hidden: string | null = null): string[] {
  return search(target, start, query, hidden).matches.map((m) => m.path).sort();
}

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-search-")));
  ws = path.join(home, "fleet/identities/alice/workspace");
  touch("docs/notes/Close-Plan-v2.md", "hello");
  touch("docs/plan.md");
  touch("Plans/readme.txt");
  touch(".state/plan-cache.json");
  touch("node_modules/plan/plan.js");
  touch("app/.venv/lib/plan.py");
  touch("app/venv/plan.py");
  touch("app/.git/plan-head");
  touch("weird/a*b?[c].txt");
  touch("weird/a-b.txt");
  touch("quote's plan.md");
  touch("Ünïcode plan.md");
  touch("-/dash-plan.md");
  touch("notes/venv");
  touch("notes/.git");
  fs.symlinkSync(home, path.join(ws, "escape-link"));
  fs.mkdirSync(path.join(home, "fleet/roles/ops"), { recursive: true });
  fs.writeFileSync(path.join(home, "fleet/roles/ops/ops.md"), "");
  fs.mkdirSync(path.join(home, "fleet/roles/ops/sub"), { recursive: true });
  fs.writeFileSync(path.join(home, "fleet/roles/ops/sub/ops.md"), "");
  fs.symlinkSync(".", path.join(home, "fleet/roles/ops/self"));
  fs.mkdirSync(path.join(home, "fleet/projects/p1/sub"), { recursive: true });
  fs.writeFileSync(path.join(home, "fleet/projects/p1/sub/plan-p.md"), "");

  fakeTimeoutBin = path.join(home, "bin");
  fs.mkdirSync(fakeTimeoutBin);
  fs.writeFileSync(path.join(fakeTimeoutBin, "timeout"), '#!/bin/sh\nshift\n"$@"\nexit 124\n', { mode: 0o755 });

  // A PATH with find but no timeout.
  noTimeoutBin = path.join(home, "bin-no-timeout");
  fs.mkdirSync(noTimeoutBin);
  for (const tool of ["find", "nice"]) {
    const real = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf-8" }).stdout.trim();
    fs.symlinkSync(real, path.join(noTimeoutBin, tool));
  }
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("parseSearchQuery", () => {
  it("splits on whitespace and drops empties", () => {
    expect(parseSearchQuery("  plan   close ")).toEqual(["plan", "close"]);
  });
  it("rejects empty, non-string, NUL, too long", () => {
    expect(parseSearchQuery("   ")).toBeNull();
    expect(parseSearchQuery(5)).toBeNull();
    expect(parseSearchQuery("a\0b")).toBeNull();
    expect(parseSearchQuery("x".repeat(201))).toBeNull();
    expect(parseSearchQuery("x".repeat(200))).toEqual(["x".repeat(200)]);
    expect(parseSearchQuery("a b c d e f g h i j")).toHaveLength(10);
  });
});

describe("search script", () => {
  it("matches every word, any order, ignoring case, across subfolders", () => {
    expect(paths(alice, "", "plan CLOSE")).toEqual(["docs/notes/Close-Plan-v2.md"]);
  });

  it("matches folders as single results, without pulling in their contents", () => {
    const r = search(alice, "", "plans");
    expect(r.matches).toEqual([
      expect.objectContaining({ name: "Plans", type: "directory", size: null, path: "Plans" }),
    ]);
  });

  it("includes dot-folders and dot-files", () => {
    expect(paths(alice, "", "cache")).toEqual([".state/plan-cache.json"]);
  });

  it("still finds files that share a skipped folder's name", () => {
    expect(paths(alice, "notes", "venv")).toEqual(["venv"]);
    expect(paths(alice, "notes", ".git")).toEqual([".git"]);
  });

  it("searches from a folder named like a cd option", () => {
    expect(paths(alice, "-", "plan")).toEqual(["dash-plan.md"]);
  });

  it("skips the hidden root file when starting at the root, however the root is reached", () => {
    const role: TargetSpec = { kind: "role", roleSlug: "ops" };
    expect(paths(role, "", "ops", "ops.md")).toEqual(["sub/ops.md"]);
    expect(paths(role, "", "OPS", "OPS.MD")).toEqual(["sub/ops.md"]);
    expect(paths(role, ".", "ops", "ops.md")).toEqual(["sub/ops.md"]);
    expect(paths(role, "self", "ops", "ops.md")).toEqual(["sub/ops.md"]);
    // A same-named file deeper down is not the hidden one.
    expect(paths(role, "sub", "ops", "ops.md")).toEqual(["ops.md"]);
  });

  it("refuses to search unbounded on a host without a time limit tool", () => {
    const out = run(buildSearchScript(alice, "", ["plan"], null), noTimeoutBin, true);
    expect(() => parseSearchOutput(out)).toThrow("search_unsupported");
  });

  it("skips package, environment and git-internal folders entirely", () => {
    const all = paths(alice, "", "plan");
    expect(all.some((p) => p.includes("node_modules"))).toBe(false);
    expect(all.some((p) => p.includes(".venv") || p.includes("venv/") || p.includes(".git"))).toBe(false);
    expect(paths(alice, "", "node_modules")).toEqual([]);
  });

  it("searches from the start folder down, paths relative to it", () => {
    expect(paths(alice, "docs", "plan")).toEqual(["notes/Close-Plan-v2.md", "plan.md"]);
  });

  it("treats glob characters and quotes literally", () => {
    expect(paths(alice, "", "a*b?[c]")).toEqual(["weird/a*b?[c].txt"]);
    expect(paths(alice, "", "a*b")).toEqual(["weird/a*b?[c].txt"]);
    expect(paths(alice, "", "quote's")).toEqual(["quote's plan.md"]);
  });

  it("handles non-ASCII names", () => {
    expect(paths(alice, "", "ünïcode")).toEqual(["Ünïcode plan.md"]);
  });

  it("reports size and modified time", () => {
    const [m] = search(alice, "", "Close-Plan").matches;
    expect(m).toMatchObject({ type: "file", size: 5 });
    expect(Math.abs(m.mtimeMs - fs.statSync(path.join(ws, "docs/notes/Close-Plan-v2.md")).mtimeMs)).toBeLessThan(1000);
  });

  it("never follows symlinks out of the target", () => {
    expect(paths(alice, "", "ops")).toEqual([]);
    const link = search(alice, "", "escape-link").matches;
    expect(link).toEqual([expect.objectContaining({ type: "symlink", path: "escape-link" })]);
  });

  it("refuses a start folder that resolves outside the target", () => {
    expect(() => search(alice, "escape-link", "plan")).toThrow(SearchScriptError);
    expect(() => search(alice, "escape-link", "plan")).toThrow("path_traversal");
  });

  it("reports not_found for a missing start folder or target", () => {
    expect(() => search(alice, "nope", "plan")).toThrow("not_found");
    expect(() => search({ kind: "identity", identityKey: "bob" }, "", "plan")).toThrow("not_found");
  });

  it("covers role and project targets", () => {
    expect(paths({ kind: "role", roleSlug: "ops" }, "", "ops")).toEqual(["ops.md", "sub/ops.md"]);
    expect(paths({ kind: "project", projectSlug: "p1" }, "", "plan")).toEqual(["sub/plan-p.md"]);
  });

  it("flags timedOut when the time limit stopped find", () => {
    const out = run(buildSearchScript(alice, "", ["plan"], null), `${fakeTimeoutBin}:`);
    const r = parseSearchOutput(out);
    expect(r.timedOut).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(search(alice, "", "plan").timedOut).toBe(false);
  });
});

describe("parseSearchOutput", () => {
  it("drops a cut-off final record and tolerates a missing trailer", () => {
    const out = "\x1eR\x1ff\x1f1\x1f2.5\x1fa/b.txt\0d\x1f4096\x1f3\x1fpart";
    expect(parseSearchOutput(out)).toEqual({
      matches: [{ name: "b.txt", type: "file", size: 1, mtimeMs: 2500, path: "a/b.txt" }],
      timedOut: false,
    });
  });

  it("throws search_failed on garbage", () => {
    expect(() => parseSearchOutput("")).toThrow("search_failed");
    expect(() => parseSearchOutput("bash: oops")).toThrow("search_failed");
  });
});
