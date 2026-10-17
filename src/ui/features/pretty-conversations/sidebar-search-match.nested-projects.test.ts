import { describe, it, expect } from "vitest";
import { searchProjectSections } from "./sidebar-search-match";

type Row = { id: string; label: string };
const sec = (slug: string, displayName: string, rows: Row[], parentKey: string | null = null) => ({
  slug,
  hostId: "1",
  displayName,
  rows,
  parentKey,
});
const sections = [
  sec("skynet", "SKYNET", [{ id: "s", label: "sky agent" }]),
  sec("design", "Design", [{ id: "d", label: "pixel" }], "1::skynet"),
  sec("ui", "UI", [], "1::design"),
  sec("ops", "Ops", [{ id: "o", label: "deployer" }], "1::skynet"),
  sec("other", "Other", [{ id: "x", label: "pixel too" }]),
];
const rowMatch = (q: string) => (r: Row) => r.label.toLowerCase().includes(q);
const run = (q: string) =>
  searchProjectSections(sections, rowMatch(q), q).map((s) => [s.slug, s.rows.map((r) => r.id)]);

describe("searchProjectSections", () => {
  it("empty query returns everything untouched", () => {
    expect(searchProjectSections(sections, () => false, "  ")).toHaveLength(5);
  });

  it("a project-name match reveals its subtree with all rows, and its ancestors as the path", () => {
    expect(run("design")).toEqual([
      ["skynet", []],
      ["design", ["d"]],
      ["ui", []],
    ]);
  });

  it("a parent name match reveals the whole subtree", () => {
    expect(run("skynet")).toEqual([
      ["skynet", ["s"]],
      ["design", ["d"]],
      ["ui", []],
      ["ops", ["o"]],
    ]);
  });

  it("a row match deep in the tree shows its project and the path to it", () => {
    expect(run("deploy")).toEqual([
      ["skynet", []],
      ["ops", ["o"]],
    ]);
  });

  it("row matches across separate subtrees", () => {
    expect(run("pixel")).toEqual([
      ["skynet", []],
      ["design", ["d"]],
      ["other", ["x"]],
    ]);
  });

  it("no match anywhere → nothing", () => {
    expect(run("nothing-here")).toEqual([]);
  });
});
