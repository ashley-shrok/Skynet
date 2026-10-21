import { describe, it, expect } from "vitest";
import { parseSeen, resolveUnseen, markSeen } from "./whats-new-state.js";

const n = (id: string) => ({ id, text: `note ${id}` });

describe("parseSeen", () => {
  it("null / missing → null (not yet counted)", () => {
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen(undefined)).toBeNull();
  });
  it("empty list is a real record, distinct from null", () => {
    expect(parseSeen("[]")).toEqual([]);
  });
  it("corrupt or non-array JSON → null", () => {
    expect(parseSeen("{oops")).toBeNull();
    expect(parseSeen('{"a":1}')).toBeNull();
  });
  it("drops non-string entries", () => {
    expect(parseSeen('["a",1,null,"b"]')).toEqual(["a", "b"]);
  });
});

describe("resolveUnseen", () => {
  it("no record: shows nothing and counts every current note as seen", () => {
    const r = resolveUnseen(null, [n("a"), n("b")]);
    expect(r.unseen).toEqual([]);
    expect(JSON.parse(r.initialSeen!)).toEqual(["a", "b"]);
  });
  it("no record and no notes: records an empty list", () => {
    expect(resolveUnseen(null, []).initialSeen).toBe("[]");
  });
  it("returns unseen notes newest first, without writing", () => {
    const r = resolveUnseen('["a"]', [n("a"), n("b"), n("c")]);
    expect(r.unseen.map((x) => x.id)).toEqual(["c", "b"]);
    expect(r.initialSeen).toBeNull();
  });
  it("a note that lands later but sits earlier in the list is still shown", () => {
    const r = resolveUnseen('["a","c"]', [n("a"), n("b"), n("c")]);
    expect(r.unseen.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("markSeen", () => {
  it("adds known ids and ignores unknown ones", () => {
    expect(JSON.parse(markSeen('["a"]', ["b", "zzz"], [n("a"), n("b")])!)).toEqual(["a", "b"]);
  });
  it("returns null when nothing changes", () => {
    expect(markSeen('["a"]', ["a", "zzz"], [n("a")])).toBeNull();
  });
  it("dedupes repeated ids in one call", () => {
    expect(JSON.parse(markSeen("[]", ["a", "a"], [n("a")])!)).toEqual(["a"]);
  });
  it("keeps ids no longer in this build (rollback safety)", () => {
    expect(JSON.parse(markSeen('["gone"]', ["a"], [n("a")])!)).toEqual(["gone", "a"]);
  });
  it("no record: counts every current note rather than leaving older ones unseen", () => {
    expect(JSON.parse(markSeen(null, ["b"], [n("a"), n("b")])!)).toEqual(["a", "b"]);
  });
});
