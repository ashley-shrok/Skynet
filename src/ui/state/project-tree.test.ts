import { describe, it, expect, vi } from "vitest";
import {
  ancestorKeys,
  descendantKeys,
  orderProjectsAsTree,
  resolveEffectiveParents,
} from "./project-tree";

const p = (slug: string, parent: string | null = null, hostId = "1", displayName = slug) => ({
  slug,
  parent,
  hostId,
  displayName,
});

describe("resolveEffectiveParents", () => {
  it("resolves parents on the same host; none or missing → top level", () => {
    const m = resolveEffectiveParents([
      p("a"),
      p("b", "a"),
      p("c", "gone"),
      p("d", "a", "2"), // parent named on host 2, but "a" lives on host 1
    ]);
    expect(m.get("1::a")).toBeNull();
    expect(m.get("1::b")).toBe("1::a");
    expect(m.get("1::c")).toBeNull();
    expect(m.get("2::d")).toBeNull();
  });

  it("puts every project in a loop at top level, keeping projects that hang off it nested", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = resolveEffectiveParents([
      p("a", "b"),
      p("b", "a"),
      p("child", "a"),
      p("self", "self"),
    ]);
    expect(m.get("1::a")).toBeNull();
    expect(m.get("1::b")).toBeNull();
    expect(m.get("1::child")).toBe("1::a");
    expect(m.get("1::self")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("handles a longer loop entered from a tail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = resolveEffectiveParents([
      p("tail", "x"),
      p("x", "y"),
      p("y", "z"),
      p("z", "x"),
    ]);
    expect(m.get("1::x")).toBeNull();
    expect(m.get("1::y")).toBeNull();
    expect(m.get("1::z")).toBeNull();
    expect(m.get("1::tail")).toBe("1::x");
    warn.mockRestore();
  });
});

describe("tree walks", () => {
  const m = resolveEffectiveParents([p("a"), p("b", "a"), p("c", "b"), p("d", "a"), p("e")]);

  it("descendantKeys returns everything beneath, not the node itself", () => {
    expect([...descendantKeys("1::a", m)].sort()).toEqual(["1::b", "1::c", "1::d"]);
    expect(descendantKeys("1::e", m).size).toBe(0);
  });

  it("ancestorKeys returns nearest first", () => {
    expect(ancestorKeys("1::c", m)).toEqual(["1::b", "1::a"]);
    expect(ancestorKeys("1::a", m)).toEqual([]);
  });

  it("orderProjectsAsTree lists parents before children, siblings alphabetical, with depth", () => {
    const out = orderProjectsAsTree([
      p("z-top", null, "1", "Zed"),
      p("kid2", "a-top", "1", "Beta"),
      p("a-top", null, "1", "Alpha"),
      p("kid1", "a-top", "1", "alpha kid"),
      p("grand", "kid2", "1", "Grand"),
    ]);
    expect(out.map((o) => [o.project.slug, o.depth])).toEqual([
      ["a-top", 0],
      ["kid1", 1],
      ["kid2", 1],
      ["grand", 2],
      ["z-top", 0],
    ]);
  });
});
