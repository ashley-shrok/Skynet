import { describe, expect, it } from "vitest";
import { agentFromMarkdown, parseBatchOutput, withUsersBlock } from "./sharing-host.js";
import { bornInProjectUsers } from "./born-in-project.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("parseBatchOutput", () => {
  it("reads each item's frontmatter, skipping bad names and keeping the first", () => {
    const out = [
      "===ITEM:scout===",
      b64("---\nusers:\n  - ana\n---\n"),
      "===ITEM:Bad Name===",
      b64("x"),
      "===ITEM:empty===",
      "",
      "===ITEM:scout===",
      b64("second"),
    ].join("\n");
    const map = parseBatchOutput(out, /^[a-z0-9_-]{1,64}$/);
    expect([...map.keys()]).toEqual(["scout", "empty"]);
    expect(map.get("scout")).toContain("- ana");
    expect(map.get("empty")).toBe("");
  });
});

describe("agentFromMarkdown", () => {
  it("reads roles, project, list and label", () => {
    const a = agentFromMarkdown(
      "scout",
      "---\nroles: [painter, other]\ndisplayName: Scout\nproject: garden\nusers: [ana, bo]\n---\nbody",
    );
    expect(a).toEqual({ name: "scout", label: "Scout", roles: ["painter", "other"], project: "garden", users: ["ana", "bo"] });
  });

  it("an empty list reads as never limited", () => {
    expect(agentFromMarkdown("x", "---\nusers: []\n---\n").users).toBeNull();
  });
});

describe("withUsersBlock", () => {
  it("replaces the users list keeping everything else", () => {
    const md = "---\ndisplayName: Wall\nusers:\n  - ana\nparent: top\n---\nBody\n";
    expect(withUsersBlock(md, ["ana", "bo"])).toBe("---\ndisplayName: Wall\nusers:\n  - ana\n  - bo\nparent: top\n---\nBody\n");
  });

  it("refuses frontmatter that never closes, drops a BOM, keeps a final newline", () => {
    expect(() => withUsersBlock("---\ndisplayName: x\nbody", ["ana"])).toThrow(/not closed/);
    expect(withUsersBlock("\uFEFF---\ndisplayName: x\n---\nBody", ["ana"])).toBe("---\ndisplayName: x\nusers:\n  - ana\n---\nBody\n");
  });

  it("gives a file with no frontmatter one", () => {
    expect(withUsersBlock("Body\n", ["ana"])).toBe("---\nusers:\n  - ana\n---\nBody\n");
  });
});

describe("bornInProjectUsers", () => {
  const projects = [
    { slug: "garden", parent: null, users: ["ana", "bo", "cy"] },
    { slug: "prints", parent: "garden", users: ["ana", "bo"] },
    { slug: "open", parent: null, users: null },
  ];

  it("is the creator plus everyone who can see the project", () => {
    expect(bornInProjectUsers(projects, "prints", "bo")).toEqual(["bo", "ana"]);
    expect(bornInProjectUsers(projects, "garden", "cy")).toEqual(["cy", "ana", "bo"]);
  });

  it("is everyone for a project nobody limited, null for one that isn't there", () => {
    expect(bornInProjectUsers(projects, "open", "ana")).toBe("everyone");
    expect(bornInProjectUsers(projects, "missing", "ana")).toBeNull();
  });
});
