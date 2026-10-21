import { describe, it, expect } from "vitest";
import {
  formatProjectPath,
  orderProjectsAsTree,
  projectPathFromOptions,
} from "./scheduled-agents-projects";

const P = (slug: string, displayName: string, parent: string | null = null) => ({ slug, displayName, parent });

describe("scheduled-agents project helpers", () => {
  it("orders top-level projects by name, each followed by its sub-projects", () => {
    const out = orderProjectsAsTree([
      P("skynet", "SKYNET"),
      P("later-later", "later-later", "later"),
      P("later", "later", "skynet"),
      P("aither", "Aither"),
      P("on-watch", "on-watch", "skynet"),
    ]);
    expect(out.map((o) => [o.slug, o.depth])).toEqual([
      ["aither", 0],
      ["skynet", 0],
      ["later", 1],
      ["later-later", 2],
      ["on-watch", 1],
    ]);
  });

  it("a project whose parent is gone shows at top level; a parent loop still lists everyone once", () => {
    expect(orderProjectsAsTree([P("a", "A", "gone")])).toEqual([{ slug: "a", displayName: "A", depth: 0 }]);
    const loop = orderProjectsAsTree([P("a", "A", "b"), P("b", "B", "a")]);
    expect(loop.map((o) => o.slug).sort()).toEqual(["a", "b"]);
  });

  it("builds the top-down path and joins it for the row", () => {
    const projects = [P("skynet", "SKYNET"), P("later", "later", "skynet")];
    expect(projectPathFromOptions("later", projects)).toEqual(["SKYNET", "later"]);
    expect(projectPathFromOptions("gone", projects)).toBeNull();
    expect(formatProjectPath(["SKYNET", "later"])).toBe("SKYNET › later");
  });
});
