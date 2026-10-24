// role-frontmatter — the per-field merge every roles-window save goes through.

import { describe, it, expect } from "vitest";
import {
  cleanRoleDescription,
  mergeRoleFrontmatter,
  readRoleFrontmatterValue,
  ROLE_DESCRIPTION_MAX,
} from "./role-frontmatter";

const FILE = [
  "---",
  "displayName: Box Maintainer",
  "owner: ashley",
  "colorHue: '190'",
  "tags: [ops, infra]",
  "---",
  "",
  "# Box Maintainer",
  "",
  "Keeps the box healthy.",
  "",
].join("\n");

describe("mergeRoleFrontmatter", () => {
  it("keeps unknown keys, their order and the body; updates owned keys in place", () => {
    const out = mergeRoleFrontmatter(FILE, { colorHue: 42 });
    expect(out).toBe(
      [
        "---",
        "displayName: Box Maintainer",
        "owner: ashley",
        "colorHue: '42'",
        "tags: [ops, infra]",
        "---",
        "",
        "# Box Maintainer",
        "",
        "Keeps the box healthy.",
        "",
      ].join("\n"),
    );
  });

  it("appends a new owned key after the existing ones", () => {
    const out = mergeRoleFrontmatter(FILE, { voice: "Danielle" });
    const fm = out.split("---")[1].trim().split("\n");
    expect(fm).toEqual([
      "displayName: Box Maintainer",
      "owner: ashley",
      "colorHue: '190'",
      "tags: [ops, infra]",
      "voice: Danielle",
    ]);
    expect(out.endsWith("# Box Maintainer\n\nKeeps the box healthy.\n")).toBe(true);
  });

  it("quotes values with spaces or YAML punctuation, and numbers as strings", () => {
    const out = mergeRoleFrontmatter(FILE, { description: "Plans meals: weekly" });
    expect(out).toContain('description: "Plans meals: weekly"');
    expect(mergeRoleFrontmatter("", { colorHue: 7 })).toContain("colorHue: '7'");
    expect(mergeRoleFrontmatter("", { voice: "Danielle" })).toContain("voice: Danielle\n");
    expect(mergeRoleFrontmatter("", { avatar: "box-maintainer.webp" })).toContain(
      'avatar: "box-maintainer.webp"',
    );
  });

  it("ignores empty-string patch values (the key is left as it was)", () => {
    expect(mergeRoleFrontmatter(FILE, { displayName: "" })).toBe(FILE);
  });

  it("clears keys named in clearedKeys, owned or not", () => {
    const withDesc = mergeRoleFrontmatter(FILE, { description: "Short" });
    expect(withDesc).toContain("description: Short");
    const cleared = mergeRoleFrontmatter(withDesc, {}, new Set(["description", "owner"]));
    expect(cleared).not.toContain("description:");
    expect(cleared).not.toContain("owner:");
    expect(cleared).toContain("displayName: Box Maintainer");
  });

  it("adds a frontmatter block to a file without one, keeping the body", () => {
    const out = mergeRoleFrontmatter("# Plain\n\nBody.\n", { description: "Hi" });
    expect(out).toBe("---\ndescription: Hi\n---\n# Plain\n\nBody.\n");
  });
});

describe("readRoleFrontmatterValue", () => {
  it("reads plain, double-quoted and single-quoted scalars", () => {
    const md = [
      "---",
      "a: plain value",
      'b: "Plans meals: weekly"',
      "c: 'it''s fine'",
      "colorHue: '190'",
      "---",
      "body",
    ].join("\n");
    expect(readRoleFrontmatterValue(md, "a")).toBe("plain value");
    expect(readRoleFrontmatterValue(md, "b")).toBe("Plans meals: weekly");
    expect(readRoleFrontmatterValue(md, "c")).toBe("it's fine");
    expect(readRoleFrontmatterValue(md, "colorHue")).toBe("190");
  });

  it("returns '' for a missing key or a file without frontmatter", () => {
    expect(readRoleFrontmatterValue(FILE, "description")).toBe("");
    expect(readRoleFrontmatterValue("# no frontmatter", "description")).toBe("");
  });

  it("round-trips what mergeRoleFrontmatter wrote", () => {
    const text = 'Says "hi" — and #tags: too';
    const out = mergeRoleFrontmatter(FILE, { description: text });
    expect(readRoleFrontmatterValue(out, "description")).toBe(text);
  });
});

describe("cleanRoleDescription", () => {
  it("collapses whitespace to one line and caps the length", () => {
    expect(cleanRoleDescription("  one\n two\t three  ")).toBe("one two three");
    // Collapses whitespace only — a long stored description is never cut.
    expect(cleanRoleDescription("x".repeat(500))).toHaveLength(500);
    expect(ROLE_DESCRIPTION_MAX).toBe(160);
  });
});

describe("multi-line values and YAML edge cases", () => {
  const BLOCK = [
    "---",
    "displayName: Box",
    "description: >-",
    "  Keeps the box",
    "  healthy and fed.",
    "users:",
    "  - ashley",
    "  - zoey",
    "colorHue: '20'",
    "---",
    "",
    "body",
    "",
  ].join("\n");

  it("reads a folded block scalar as one line", () => {
    expect(readRoleFrontmatterValue(BLOCK, "description")).toBe("Keeps the box healthy and fed.");
  });

  it("reads a literal block scalar as one line too", () => {
    const md = "---\ndescription: |\n  line one\n  line two\n---\n";
    expect(readRoleFrontmatterValue(md, "description")).toBe("line one line two");
  });

  it("reads a plain value that continues on an indented line", () => {
    const md = "---\ndescription: starts here\n  and goes on\n---\n";
    expect(readRoleFrontmatterValue(md, "description")).toBe("starts here and goes on");
  });

  it("replacing a block-scalar key takes its continuation lines with it; a list under another key stays", () => {
    const out = mergeRoleFrontmatter(BLOCK, { description: "One line now" });
    expect(out).toBe(
      [
        "---",
        "displayName: Box",
        'description: "One line now"',
        "users:",
        "  - ashley",
        "  - zoey",
        "colorHue: '20'",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );
  });

  it("clearing a block-scalar key removes its continuation lines", () => {
    const out = mergeRoleFrontmatter(BLOCK, {}, new Set(["description"]));
    expect(out).not.toContain("Keeps the box");
    expect(out).toContain("  - zoey");
  });

  it("keeps an unindented list under its key", () => {
    const md = "---\nusers:\n- ashley\ncolorHue: '1'\n---\n";
    expect(mergeRoleFrontmatter(md, { colorHue: 2 })).toBe("---\nusers:\n- ashley\ncolorHue: '2'\n---\n");
  });

  it("quotes words YAML would read as booleans, nulls or numbers", () => {
    for (const word of ["yes", "No", "true", "null", "~", "123", "1.5", "on"]) {
      const out = mergeRoleFrontmatter("---\n---\n", { description: word });
      expect(out).toBe(`---\ndescription: ${JSON.stringify(word)}\n---\n`);
      expect(readRoleFrontmatterValue(out, "description")).toBe(word);
    }
  });

  it("an empty frontmatter block is merged into, not stacked on", () => {
    expect(mergeRoleFrontmatter("---\n---\nbody\n", { voice: "Danielle" })).toBe("---\nvoice: Danielle\n---\nbody\n");
  });

  it("keeps a byte-order mark and reads past spaced fences", () => {
    const md = "\uFEFF--- \ndisplayName: X\n---\nbody\n";
    expect(mergeRoleFrontmatter(md, { colorHue: 120 })).toBe("\uFEFF---\ndisplayName: X\ncolorHue: '120'\n---\nbody\n");
    expect(readRoleFrontmatterValue(md, "displayName")).toBe("X");
  });
});
