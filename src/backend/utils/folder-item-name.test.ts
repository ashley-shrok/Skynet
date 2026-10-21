import { describe, expect, it } from "vitest";
import { frontmatterName, nameMismatchesFolder, withFrontmatterName } from "./folder-item-name.js";

describe("folder-item-name", () => {
  it("reads name: plain, quoted, commented, CRLF", () => {
    expect(frontmatterName("---\nname: build\n---\n")).toBe("build");
    expect(frontmatterName("---\nname: \"build\"\n---\n")).toBe("build");
    expect(frontmatterName("---\nname: 'build'\n---\n")).toBe("build");
    expect(frontmatterName("---\nname: build  # the skill\n---\n")).toBe("build");
    expect(frontmatterName("---\r\nname: build\r\n---\r\n")).toBe("build");
  });

  it("null without frontmatter, without a name key, or with name: only in the body", () => {
    expect(frontmatterName("# title\n")).toBeNull();
    expect(frontmatterName("---\ndescription: x\n---\n")).toBeNull();
    expect(frontmatterName("---\ndescription: x\n---\nname: body\n")).toBeNull();
    expect(frontmatterName("---\nname: unterminated\n")).toBeNull();
  });

  it("rewrites only the name line, byte-for-byte otherwise", () => {
    const src = "---\r\nname: \"build\"\r\ndescription: a: b\r\n---\r\n\r\n# Build\r\n";
    expect(withFrontmatterName(src, "ship")).toBe(
      "---\r\nname: ship\r\ndescription: a: b\r\n---\r\n\r\n# Build\r\n",
    );
    const noName = "---\ndescription: x\n---\n";
    expect(withFrontmatterName(noName, "ship")).toBe(noName);
  });

  it("mismatch only when a name is present and differs", () => {
    expect(nameMismatchesFolder("---\nname: a\n---\n", "a")).toBe(false);
    expect(nameMismatchesFolder("---\nname: b\n---\n", "a")).toBe(true);
    expect(nameMismatchesFolder("no frontmatter", "a")).toBe(false);
  });
});
