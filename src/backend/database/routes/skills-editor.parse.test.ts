import { describe, it, expect } from "vitest";
import { parseSkillListOutput } from "./skills-editor";

const rec = (name: string, fm: string): string => `\x1e${name}\n${fm}`;

describe("parseSkillListOutput", () => {
  it("lists name + description, ignoring stray output before the first record", () => {
    const out = "motd noise\n" + rec("build", 'name: build\ndescription: "Builds"\n');
    expect(parseSkillListOutput(out)).toEqual([{ name: "build", description: "Builds" }]);
  });

  it("flags user-invocable: false as userInvocable false (bool or string)", () => {
    const out =
      rec("campaign", "name: campaign\ndescription: Arc\nuser-invocable: false\n") +
      rec("quoted", 'name: quoted\nuser-invocable: "false"\n') +
      rec("open", "name: open\ndescription: Opens\nuser-invocable: true\n") +
      rec("plain", "name: plain\n");
    expect(parseSkillListOutput(out)).toEqual([
      { name: "campaign", description: "Arc", userInvocable: false },
      { name: "quoted", userInvocable: false },
      { name: "open", description: "Opens" },
      { name: "plain" },
    ]);
  });

  it("lists a skill with malformed frontmatter without flags", () => {
    expect(parseSkillListOutput(rec("bad", "description: [unclosed\n"))).toEqual([{ name: "bad" }]);
  });
});
