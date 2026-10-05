import { describe, it, expect } from "vitest";
import { displayPath, parsePatch, toSplitRows } from "./parse-diff";
import { GIT_PATCH, PLAIN_UNIFIED } from "./fixtures";

describe("parsePatch — git format-patch", () => {
  const patch = parsePatch(GIT_PATCH);

  it("finds every file section and ignores mail headers + diffstat", () => {
    expect(patch.files.map(displayPath)).toEqual([
      "src/auth.ts",
      "docs/new.md",
      "old.txt → renamed.txt",
      "logo.png",
    ]);
    expect(patch.files.map((f) => f.status)).toEqual([
      "modified",
      "added",
      "renamed",
      "binary",
    ]);
  });

  it("counts additions and deletions per file and in total", () => {
    expect(patch.files[0].additions).toBe(2);
    expect(patch.files[0].deletions).toBe(1);
    expect(patch.files[1].additions).toBe(2);
    expect(patch.additions).toBe(4);
    expect(patch.deletions).toBe(1);
  });

  it("keeps a removed line that starts with '-- ' inside its hunk", () => {
    const del = patch.files[0].hunks[0].lines.find((l) => l.kind === "del");
    expect(del?.text).toBe("-- a leading-dashes line that was removed");
  });

  it("numbers lines from the hunk header and treats a stripped blank line as context", () => {
    const lines = patch.files[0].hunks[0].lines;
    expect(lines[0]).toMatchObject({ kind: "ctx", oldNo: 1, newNo: 1 });
    expect(lines[2]).toMatchObject({ kind: "add", oldNo: null, newNo: 2 });
    expect(lines.at(-1)).toMatchObject({ kind: "ctx", text: "", oldNo: 4, newNo: 5 });
  });

  it("records '\\ No newline at end of file' as a note", () => {
    const last = patch.files[1].hunks[0].lines.at(-1);
    expect(last).toMatchObject({ kind: "note", text: "No newline at end of file" });
  });
});

describe("parsePatch — plain diff -u", () => {
  it("splits files on ---/+++ pairs and strips timestamps", () => {
    const patch = parsePatch(PLAIN_UNIFIED);
    expect(patch.files.map(displayPath)).toEqual(["b.txt", "c.txt"]);
    expect(patch.files[1].hunks[0].lines).toEqual([
      { kind: "del", text: "x", oldNo: 3, newNo: null },
      { kind: "add", text: "y", oldNo: null, newNo: 3 },
    ]);
  });

  it("returns no files for text that isn't a diff", () => {
    expect(parsePatch("just some notes\n").files).toEqual([]);
  });
});

describe("toSplitRows", () => {
  it("pairs a removal run with the following addition run", () => {
    const hunk = parsePatch(GIT_PATCH).files[0].hunks[0];
    const rows = toSplitRows(hunk);
    expect(rows[0].left?.kind).toBe("ctx");
    expect(rows[0].right?.kind).toBe("ctx");
    expect(rows[1].left?.kind).toBe("del");
    expect(rows[1].right?.text).toBe("const b = 2;");
    expect(rows[2].left).toBeNull();
    expect(rows[2].right?.text).toBe("const c = 3;");
  });
});
