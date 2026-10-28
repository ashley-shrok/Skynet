import { describe, it, expect } from "vitest";
import { rankSkills } from "./skill-match";

const SKILLS = [
  { name: "explain", description: "Describe a thing conceptually" },
  { name: "id", description: "Load a named agent." },
  { name: "idea" },
  { name: "light-review", description: "Unbiased sub-agent code review" },
  { name: "recap", description: "Gives a concise recap of the session." },
];

const names = (q: string) => rankSkills(SKILLS, q).map((s) => s.name);

describe("rankSkills", () => {
  it("empty query keeps everything in order", () => {
    expect(names("")).toEqual(["explain", "id", "idea", "light-review", "recap"]);
    expect(names("   ")).toHaveLength(5);
  });

  it("exact name, then name prefix, then name contains, then description", () => {
    expect(names("id")).toEqual(["id", "idea"]);
    expect(names("re")).toEqual(["recap", "light-review"]);
    expect(names("agent")).toEqual(["id", "light-review"]);
  });

  it("an exact name beats a prefix match even when it sorts later", () => {
    const list = [{ name: "ab-c" }, { name: "ab" }];
    expect(rankSkills(list, "ab").map((s) => s.name)).toEqual(["ab", "ab-c"]);
  });

  it("several words must all appear (name or description)", () => {
    expect(names("code review")).toEqual(["light-review"]);
    expect(names("recap session")).toEqual(["recap"]);
    expect(names("recap nope")).toEqual([]);
  });

  it("case is ignored", () => {
    expect(names("REC")).toEqual(["recap"]);
  });
});
