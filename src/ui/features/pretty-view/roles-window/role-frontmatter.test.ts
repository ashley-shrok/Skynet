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
    expect(cleanRoleDescription("x".repeat(500))).toHaveLength(ROLE_DESCRIPTION_MAX);
  });
});
