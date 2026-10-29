/**
 * project-visibility-gate.test.ts — Phase 130 unit tests for
 * isProjectVisibleToUser.
 *
 * Mirrors identity-visibility-gate.test.ts test structure — same D-3 fallback
 * discipline, same null-caller-bypass semantics, same case-sensitive comparison
 * discipline. Differs in that projects have NO role-parent intersection, so the
 * gate is one-sided (only the project's own users list).
 */

import { describe, it, expect } from "vitest";
import {
  isProjectVisibleToUser,
  filterVisibleProjectTree,
  redactHiddenParents,
  effectiveProjectAudience,
  audienceWidens,
} from "./project-visibility-gate.js";

describe("isProjectVisibleToUser — null caller (gate disabled)", () => {
  it("returns true when callerUsername is null regardless of projectUsers shape", () => {
    expect(isProjectVisibleToUser(null, null)).toBe(true);
    expect(isProjectVisibleToUser([], null)).toBe(true);
    expect(isProjectVisibleToUser(["alice"], null)).toBe(true);
    // Even a totally arbitrary list: null caller ALWAYS passes.
    expect(isProjectVisibleToUser(["someone-else"], null)).toBe(true);
  });
});

describe("isProjectVisibleToUser — D-3 fallback (empty/absent list = falls open)", () => {
  it("null users list → falls open for any caller", () => {
    expect(isProjectVisibleToUser(null, "alice")).toBe(true);
    expect(isProjectVisibleToUser(null, "riley")).toBe(true);
  });

  it("empty users list → falls open for any caller", () => {
    expect(isProjectVisibleToUser([], "alice")).toBe(true);
    expect(isProjectVisibleToUser([], "riley")).toBe(true);
  });
});

describe("isProjectVisibleToUser — membership check", () => {
  it("caller in list → true", () => {
    expect(isProjectVisibleToUser(["alice"], "alice")).toBe(true);
    expect(isProjectVisibleToUser(["alice", "riley"], "riley")).toBe(true);
    expect(
      isProjectVisibleToUser(["a", "b", "c", "alice", "d"], "alice"),
    ).toBe(true);
  });

  it("caller NOT in list → false", () => {
    expect(isProjectVisibleToUser(["alice"], "riley")).toBe(false);
    expect(isProjectVisibleToUser(["a", "b"], "riley")).toBe(false);
  });
});

describe("isProjectVisibleToUser — case sensitivity (Pitfall 7)", () => {
  it("comparison is case-sensitive — 'Alice' does NOT match 'alice'", () => {
    // Matches DB users.username storage discipline: case is stored as-typed
    // at register; no normalization layer downstream.
    expect(isProjectVisibleToUser(["Alice"], "alice")).toBe(false);
    expect(isProjectVisibleToUser(["alice"], "Alice")).toBe(false);
    expect(isProjectVisibleToUser(["ALICE"], "alice")).toBe(false);
  });

  it("exact case match → true", () => {
    expect(isProjectVisibleToUser(["Alice"], "Alice")).toBe(true);
    expect(isProjectVisibleToUser(["alice"], "alice")).toBe(true);
  });
});

describe("filterVisibleProjectTree — nested projects", () => {
  const p = (slug: string, parent: string | null, users: string[] | null) => ({
    slug,
    parent,
    users,
  });

  it("null caller → everything visible", () => {
    const list = [p("a", null, ["riley"]), p("b", "a", ["riley"])];
    expect(filterVisibleProjectTree(list, null)).toEqual(list);
  });

  it("hidden parent hides child and grandchild even when they'd pass alone", () => {
    const list = [
      p("a", null, ["riley"]),
      p("b", "a", null),
      p("c", "b", ["alice"]),
    ];
    expect(filterVisibleProjectTree(list, "alice")).toEqual([]);
  });

  it("a sub-project can narrow, never widen", () => {
    const list = [p("a", null, null), p("b", "a", ["riley"]), p("c", "b", null)];
    expect(filterVisibleProjectTree(list, "alice").map((x) => x.slug)).toEqual([
      "a",
    ]);
  });

  it("missing parent → child judged on its own gate (top level)", () => {
    const list = [p("b", "gone", null), p("c", "gone", ["riley"])];
    expect(filterVisibleProjectTree(list, "alice").map((x) => x.slug)).toEqual([
      "b",
    ]);
  });

  it("cycle terminates; loop members are judged as top level, as the sidebar draws them", () => {
    const visibleLoop = [p("x", "y", null), p("y", "x", null)];
    expect(filterVisibleProjectTree(visibleLoop, "alice")).toEqual(visibleLoop);

    // y is hidden but sits on the loop with x: x (drawn at top level) stays
    // visible, and z hanging off x stays too. Only y itself hides.
    const hiddenLoop = [p("x", "y", null), p("y", "x", ["riley"]), p("z", "x", null)];
    expect(filterVisibleProjectTree(hiddenLoop, "alice").map((n) => n.slug)).toEqual([
      "x",
      "z",
    ]);

    // A hidden project hanging off a loop still hides its own children.
    const hiddenAbove = [p("x", "y", null), p("y", "x", null), p("h", "x", ["riley"]), p("k", "h", null)];
    expect(filterVisibleProjectTree(hiddenAbove, "alice").map((n) => n.slug)).toEqual([
      "x",
      "y",
    ]);
  });

  it("self-parent and absent parent field are treated as top level", () => {
    const list = [
      { slug: "s", parent: "s", users: null },
      { slug: "t", users: null },
    ];
    expect(filterVisibleProjectTree(list, "alice")).toEqual(list);
  });

  it("preserves input order and element identity", () => {
    const list = [p("b", null, null), p("a", "b", null)];
    const out = filterVisibleProjectTree(list, "alice");
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toBe(list[1]);
  });
});

describe("redactHiddenParents", () => {
  it("blanks a parent that exists but is hidden; keeps visible and genuinely missing parents", () => {
    const all = [
      { slug: "x", parent: "y", users: null },
      { slug: "y", parent: "x", users: ["riley"] },
      { slug: "kid", parent: "x", users: null },
      { slug: "orphan", parent: "gone", users: null },
    ];
    const visible = filterVisibleProjectTree(all, "alice");
    expect(redactHiddenParents(all, visible).map((p) => [p.slug, p.parent])).toEqual([
      ["x", null],
      ["kid", "x"],
      ["orphan", "gone"],
    ]);
  });
});

describe("effectiveProjectAudience / audienceWidens", () => {
  const list = [
    { slug: "p", users: ["alice", "bob"], parent: null },
    { slug: "q", users: ["bob", "carol"], parent: "p" },
    { slug: "c", users: null, parent: "q" },
    { slug: "open", users: null, parent: null },
    { slug: "a", users: ["alice"], parent: "b" },
    { slug: "b", users: ["bob"], parent: "a" },
    { slug: "hang", users: null, parent: "a" },
  ];
  it("intersects every list up the chain; null when nothing restricts", () => {
    expect(effectiveProjectAudience(list, "c")).toEqual(["bob"]);
    expect(effectiveProjectAudience(list, "open")).toBeNull();
  });
  it("judges a hypothetical parent", () => {
    expect(effectiveProjectAudience(list, "c", null)).toBeNull();
    expect(effectiveProjectAudience(list, "c", "p")).toEqual(["alice", "bob"]);
  });
  it("cuts loops the way the visibility gate does", () => {
    // a is on the loop → only its own list; hang stops at a.
    expect(effectiveProjectAudience(list, "a")).toEqual(["alice"]);
    expect(effectiveProjectAudience(list, "hang")).toEqual(["alice"]);
    const visibleToBob = filterVisibleProjectTree(list, "bob").map((p) => p.slug);
    expect(visibleToBob.includes("hang")).toBe(false);
  });
  it("audienceWidens", () => {
    expect(audienceWidens(null, ["a"])).toBe(false);
    expect(audienceWidens(["a"], null)).toBe(true);
    expect(audienceWidens(["a"], ["a", "b"])).toBe(true);
    expect(audienceWidens(["a", "b"], ["a"])).toBe(false);
  });
});
