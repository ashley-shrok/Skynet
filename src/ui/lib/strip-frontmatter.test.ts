import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "./strip-frontmatter.js";

describe("stripFrontmatter", () => {
  it("strips a leading YAML frontmatter block", () => {
    const input = "---\nrole: box-maintainer\ndisplayName: Rowan\n---\n# Rowan\n\nbody";
    expect(stripFrontmatter(input)).toBe("# Rowan\n\nbody");
  });

  it("strips CRLF-terminated frontmatter blocks", () => {
    const input = "---\r\nrole: box-maintainer\r\n---\r\n# Rowan";
    expect(stripFrontmatter(input)).toBe("# Rowan");
  });

  it("returns the string unchanged when no frontmatter is present", () => {
    const input = "# Just a heading\n\nbody paragraph";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("leaves mid-file thematic breaks alone", () => {
    // Only the LEADING block matches; a `---` used as a horizontal rule
    // inside the body must survive.
    const input = "# Title\n\nfirst section\n\n---\n\nsecond section";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("handles an empty frontmatter block", () => {
    const input = "---\n\n---\n# Body";
    expect(stripFrontmatter(input)).toBe("# Body");
  });

  it("handles a file that is ONLY frontmatter (no body)", () => {
    const input = "---\nkey: value\n---\n";
    expect(stripFrontmatter(input)).toBe("");
  });

  it("does not strip a block that isn't at the very start", () => {
    // Leading blank line means the block isn't the anchor of the doc,
    // so ReactMarkdown wouldn't render it as `---`-frontmatter garbage
    // anyway. Leaving it alone matches the leading-only regex.
    const input = "\n---\nrole: x\n---\n# Body";
    expect(stripFrontmatter(input)).toBe(input);
  });
});
