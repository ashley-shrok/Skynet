import { describe, expect, it } from "vitest";
import { normalizeRoleDescription, readRoleDescriptionFromMarkdown } from "./role-description.js";

describe("readRoleDescriptionFromMarkdown", () => {
  it("returns the frontmatter description", () => {
    expect(
      readRoleDescriptionFromMarkdown("---\ndisplayName: X\ndescription: Keeps the box.\n---\n# x\n"),
    ).toBe("Keeps the box.");
  });

  it("returns '' when the key is absent — no fallback to ## Role", () => {
    expect(readRoleDescriptionFromMarkdown("---\ndisplayName: X\n---\n## Role\n\nText.\n")).toBe("");
    expect(readRoleDescriptionFromMarkdown("# x\n\n## Role\n\nText.\n")).toBe("");
  });

  it("returns '' for a non-string value", () => {
    expect(readRoleDescriptionFromMarkdown("---\ndescription: 42\n---\n")).toBe("");
    expect(readRoleDescriptionFromMarkdown("---\ndescription: [a, b]\n---\n")).toBe("");
  });

  it("collapses a multi-line value and handles CRLF and quoting", () => {
    expect(readRoleDescriptionFromMarkdown("---\r\ndescription: >\r\n  one\r\n  two\r\n---\r\n")).toBe(
      "one two",
    );
    expect(readRoleDescriptionFromMarkdown('---\ndescription: "a: b # c"\n---\n')).toBe("a: b # c");
  });

  it("still reads the description when another line has a YAML error", () => {
    expect(
      readRoleDescriptionFromMarkdown("---\ndescription: Fine.\ntitle: [unclosed\n---\n"),
    ).toBe("Fine.");
  });
});

describe("normalizeRoleDescription", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeRoleDescription("  a\n\n b\t c  ")).toBe("a b c");
  });
});
