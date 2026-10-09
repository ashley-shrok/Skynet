import { describe, it, expect } from "vitest";
import { planMerge, planIsNoop } from "./merge.js";

describe("planMerge", () => {
  it("restores every master file when the folder is missing (never a removal)", () => {
    const plan = planMerge({ a: "1", b: "2" }, { a: "1", b: "2" }, null, true);
    expect(plan.hostWrites).toEqual(["a", "b"]);
    expect(plan.masterDeletes).toEqual([]);
  });

  it("first contact: master wins, no conflicts, even on an admin host", () => {
    const plan = planMerge(null, { a: "1" }, { a: "X", local: "9" }, true);
    expect(plan.hostWrites).toEqual(["a"]);
    expect(plan.hostDeletes).toEqual(["local"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.masterWrites).toEqual([]);
  });

  it("is a no-op when host matches master", () => {
    expect(planIsNoop(planMerge({ a: "1" }, { a: "1" }, { a: "1" }, false))).toBe(true);
  });

  it("host unchanged since base takes the master's new version / deletion", () => {
    const plan = planMerge({ a: "1", b: "2" }, { a: "1b" }, { a: "1", b: "2" }, false);
    expect(plan.hostWrites).toEqual(["a"]);
    expect(plan.hostDeletes).toEqual(["b"]);
  });

  it("admin host change flows back to the master (edit, add, delete)", () => {
    const plan = planMerge(
      { a: "1", gone: "3" },
      { a: "1", gone: "3" },
      { a: "1x", added: "4" },
      true,
    );
    expect(plan.masterWrites).toEqual(["a", "added"]);
    expect(plan.masterDeletes).toEqual(["gone"]);
    expect(plan.nextMaster).toEqual({ a: "1x", added: "4" });
    expect(plan.hostWrites).toEqual([]);
  });

  it("non-admin host change is put back", () => {
    const plan = planMerge({ a: "1" }, { a: "1" }, { a: "1x", added: "4" }, false);
    expect(plan.hostWrites).toEqual(["a"]);
    expect(plan.hostDeletes).toEqual(["added"]);
    expect(plan.masterWrites).toEqual([]);
  });

  it("both changed on an admin host: master wins, host version set aside", () => {
    const plan = planMerge({ a: "1" }, { a: "M" }, { a: "H" }, true);
    expect(plan.conflicts).toEqual(["a"]);
    expect(plan.hostWrites).toEqual(["a"]);
    expect(plan.masterWrites).toEqual([]);
  });

  it("both changed, host deleted: master restored without a conflict copy", () => {
    const plan = planMerge({ a: "1" }, { a: "M" }, {}, true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostWrites).toEqual(["a"]);
  });

  it("both changed on a non-admin host: put back, no conflict copy", () => {
    const plan = planMerge({ a: "1" }, { a: "M" }, { a: "H" }, false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostWrites).toEqual(["a"]);
  });
});
