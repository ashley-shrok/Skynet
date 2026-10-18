import { describe, expect, it } from "vitest";
import { splitPatch } from "./git-patch";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+more",
  "diff --git a/gone.md b/gone.md",
  "deleted file mode 100644",
  "--- a/gone.md",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 90%",
  "rename from old name.txt",
  "rename to new name.txt",
  "diff --git a/fresh.txt b/fresh.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/fresh.txt",
  "@@ -0,0 +1,2 @@",
  "+--- not a header",
  "+two",
  "",
].join("\n");

describe("splitPatch", () => {
  const files = splitPatch(PATCH);

  it("finds one section per file", () => {
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "gone.md", "new name.txt", "fresh.txt"]);
  });

  it("counts added and removed lines inside the hunks only", () => {
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[1]).toMatchObject({ added: 0, removed: 1 });
    expect(files[3]).toMatchObject({ added: 2, removed: 0 });
  });

  it("names a rename's old path", () => {
    expect(files[2].oldPath).toBe("old name.txt");
  });

  it("keeps each section's own text", () => {
    expect(files[1].patch.startsWith("diff --git a/gone.md b/gone.md\n")).toBe(true);
    expect(files[1].patch).not.toContain("fresh.txt");
  });

  it("is empty for an empty patch", () => {
    expect(splitPatch("")).toEqual([]);
  });

  it("keeps a real leading b/ or a/ folder in a rename's paths", () => {
    const [f] = splitPatch(
      ["diff --git a/b/old.ts b/b/new.ts", "similarity index 100%", "rename from b/old.ts", "rename to b/new.ts", ""].join("\n"),
    );
    expect(f).toMatchObject({ path: "b/new.ts", oldPath: "b/old.ts" });
  });

  it("keeps trailing spaces in a name, dropping only git's tab", () => {
    const [f] = splitPatch(
      ["diff --git a/x  b/x ", "--- a/x \t", "+++ b/x \t", "@@ -1 +1 @@", "-a", "+b", ""].join("\n"),
    );
    expect(f.path).toBe("x ");
  });
});
