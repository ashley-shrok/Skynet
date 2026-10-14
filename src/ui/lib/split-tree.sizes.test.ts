// Rows and sizes (2026-10-14): even sizing across same-direction chains,
// per-row custom sizes, and reset-only-what-changed on tree edits.
import { describe, it, expect } from "vitest";
import {
  type SplitNode,
  insertAtEdge,
  removeLeaf,
  rowMembers,
  rowFractions,
  setRowFractions,
  clearRowAt,
  findLeaf,
  findLargestLeafPath,
  getNodeAt,
  replaceLeaf,
  swapLeaves,
} from "./split-tree";
import { encodeSplitTreeToUrl, decodeSplitTreeFromUrl } from "./split-tree-url";
import type { TabSpec } from "./tab-url";

const leaf = (tabId: string): SplitNode => ({ kind: "session", tabId });
type Split = SplitNode & { kind: "split" };
const asSplit = (n: SplitNode | null): Split => {
  if (n === null || n.kind !== "split") throw new Error("not a split");
  return n;
};

/** Build a row by dropping each next pane on the right of the last one. */
function rowOf(ids: string[]): SplitNode {
  let t: SplitNode | null = null;
  for (const id of ids) {
    const last = t === null ? [] : findLeaf(t, ids[ids.indexOf(id) - 1])!;
    t = insertAtEdge(t, last, leaf(id), "right");
  }
  return t!;
}

const close = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
};

describe("even sizing", () => {
  it("three panes side by side are thirds, not half/quarter/quarter", () => {
    const t = asSplit(rowOf(["a", "b", "c"]));
    expect(rowMembers(t).map((m) => (m.node as { tabId: string }).tabId)).toEqual(["a", "b", "c"]);
    close(rowFractions(t), [1 / 3, 1 / 3, 1 / 3]);
  });

  it("a column inside a row counts as one member", () => {
    let t: SplitNode = rowOf(["a", "b", "c"]);
    t = insertAtEdge(t, findLeaf(t, "b")!, leaf("b2"), "bottom");
    const row = asSplit(t);
    expect(rowMembers(row)).toHaveLength(3);
    close(rowFractions(row), [1 / 3, 1 / 3, 1 / 3]);
    const col = asSplit(getNodeAt(t, findLeaf(t, "b")!.slice(0, -1)));
    close(rowFractions(col), [0.5, 0.5]);
  });

  it("closing a pane leaves the rest even", () => {
    const t = asSplit(removeLeaf(rowOf(["a", "b", "c", "d"]), "b"));
    close(rowFractions(t), [1 / 3, 1 / 3, 1 / 3]);
  });
});

describe("custom sizes", () => {
  it("setRowFractions sets member shares and round-trips", () => {
    const t = asSplit(setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25]));
    close(rowFractions(t), [0.5, 0.25, 0.25]);
  });

  it("rejects wrong member count or non-row-root path", () => {
    const t = rowOf(["a", "b", "c"]);
    expect(setRowFractions(t, [], [0.5, 0.5])).toBe(t);
    const inner = findLeaf(t, "c")!.slice(0, -1);
    expect(inner.length).toBeGreaterThan(0);
    expect(setRowFractions(t, inner, [0.5, 0.5])).toBe(t);
  });

  it("clearRowAt from any split in the chain evens the whole row", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.6, 0.2, 0.2])!;
    const inner = findLeaf(sized, "c")!.slice(0, -1);
    close(rowFractions(asSplit(clearRowAt(sized, inner))), [1 / 3, 1 / 3, 1 / 3]);
  });

  it("adding a pane to a sized row resets that row to even", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25])!;
    const t = insertAtEdge(sized, findLeaf(sized, "c")!, leaf("d"), "right");
    close(rowFractions(asSplit(t)), [0.25, 0.25, 0.25, 0.25]);
  });

  it("splitting a pane the other way keeps the surrounding row's sizes", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25])!;
    const t = insertAtEdge(sized, findLeaf(sized, "b")!, leaf("b2"), "bottom");
    close(rowFractions(asSplit(t)), [0.5, 0.25, 0.25]);
  });

  it("closing a pane resets only the row it left", () => {
    // Row a | col(b over b2) | c, outer row sized, inner column sized.
    let t: SplitNode = rowOf(["a", "b", "c"]);
    t = insertAtEdge(t, findLeaf(t, "b")!, leaf("b2"), "bottom");
    t = insertAtEdge(t, findLeaf(t, "b2")!, leaf("b3"), "bottom");
    t = setRowFractions(t, [], [0.5, 0.25, 0.25])!;
    const colPath = findLeaf(t, "b")!.slice(0, -1);
    t = setRowFractions(t, colPath, [0.6, 0.2, 0.2])!;
    // Closing b3 changes the column, not the outer row.
    const after = removeLeaf(t, "b3")!;
    close(rowFractions(asSplit(after)), [0.5, 0.25, 0.25]);
    const col = asSplit(getNodeAt(after, findLeaf(after, "b")!.slice(0, -1)));
    close(rowFractions(col), [0.5, 0.5]);
    // Closing c changes the outer row, not the column.
    const after2 = removeLeaf(t, "c")!;
    close(rowFractions(asSplit(after2)), [0.5, 0.5]);
    const col2 = asSplit(getNodeAt(after2, findLeaf(after2, "b")!.slice(0, -1)));
    close(rowFractions(col2), [0.6, 0.2, 0.2]);
  });

  it("a collapse that merges a column back into its row resets the merged row", () => {
    // a | (b over (c | d)) — closing b merges c|d into the outer row.
    let t: SplitNode = rowOf(["a", "b"]);
    t = insertAtEdge(t, findLeaf(t, "b")!, leaf("c"), "bottom");
    t = insertAtEdge(t, findLeaf(t, "c")!, leaf("d"), "right");
    t = setRowFractions(t, [], [0.7, 0.3])!;
    const inner = findLeaf(t, "c")!.slice(0, -1);
    t = setRowFractions(t, inner, [0.8, 0.2])!;
    const after = asSplit(removeLeaf(t, "b"));
    expect(rowMembers(after)).toHaveLength(3);
    close(rowFractions(after), [1 / 3, 1 / 3, 1 / 3]);
  });

  it("a column collapsing to a single pane keeps the surrounding row's sizes", () => {
    let t: SplitNode = rowOf(["a", "b", "c"]);
    t = insertAtEdge(t, findLeaf(t, "b")!, leaf("b2"), "bottom");
    t = setRowFractions(t, [], [0.5, 0.25, 0.25])!;
    close(rowFractions(asSplit(removeLeaf(t, "b2"))), [0.5, 0.25, 0.25]);
  });

  it("moving a pane between rows resets both rows", () => {
    // a | col(b over c) — move a pane from the column to the row's right.
    let t: SplitNode = rowOf(["a", "b", "x"]);
    t = insertAtEdge(t, findLeaf(t, "b")!, leaf("c"), "bottom");
    t = insertAtEdge(t, findLeaf(t, "c")!, leaf("e"), "bottom");
    t = setRowFractions(t, [], [0.5, 0.3, 0.2])!;
    t = setRowFractions(t, findLeaf(t, "b")!.slice(0, -1), [0.6, 0.2, 0.2])!;
    // move e: remove then insert right of x
    let moved = removeLeaf(t, "e")!;
    moved = insertAtEdge(moved, findLeaf(moved, "x")!, leaf("e"), "right");
    close(rowFractions(asSplit(moved)), [0.25, 0.25, 0.25, 0.25]);
    const col = asSplit(getNodeAt(moved, findLeaf(moved, "b")!.slice(0, -1)));
    close(rowFractions(col), [0.5, 0.5]);
  });

  it("swap and replace keep sizes", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25])!;
    close(rowFractions(asSplit(swapLeaves(sized, "a", "c"))), [0.5, 0.25, 0.25]);
    close(rowFractions(asSplit(replaceLeaf(sized, "a", "z"))), [0.5, 0.25, 0.25]);
  });

  it("findLargestLeafPath follows custom sizes", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.2, 0.2, 0.6])!;
    expect(getNodeAt(sized, findLargestLeafPath(sized)!)).toEqual(leaf("c"));
    // Even thirds tie → first in DFS order.
    const even = rowOf(["a", "b", "c"]);
    expect(getNodeAt(even, findLargestLeafPath(even)!)).toEqual(leaf("a"));
  });
});

describe("URL round-trip with sizes", () => {
  const specFor = (id: string): TabSpec => ({ protocol: "tmux", host: "h", session: id });
  const resolver = (spec: TabSpec) =>
    spec.protocol === "tmux" ? spec.session ?? null : null;

  it("custom sizes survive encode/decode", () => {
    const sized = setRowFractions(rowOf(["a", "b", "c"]), [], [0.5, 0.25, 0.25])!;
    const url = encodeSplitTreeToUrl(sized, specFor);
    const back = decodeSplitTreeFromUrl(url, resolver);
    close(rowFractions(asSplit(back)), [0.5, 0.25, 0.25]);
  });

  it("even rows encode without sizes; old size-less URLs decode even", () => {
    const url = encodeSplitTreeToUrl(rowOf(["a", "b", "c"]), specFor);
    expect(url).toMatch(/t=v\(0,v\(1,2\)\)$/);
    close(rowFractions(asSplit(decodeSplitTreeFromUrl(url, resolver))), [1 / 3, 1 / 3, 1 / 3]);
  });

  it("rejects malformed ratios", () => {
    const base = encodeSplitTreeToUrl(rowOf(["a", "b"]), specFor).replace(/&t=.*/, "");
    for (const t of ["v0(0,1)", "v10000(0,1)", "v0500(0,1)"]) {
      expect(decodeSplitTreeFromUrl(`${base}&t=${t}`, resolver)).toBeNull();
    }
    expect(decodeSplitTreeFromUrl(`${base}&t=v2500(0,1)`, resolver)).not.toBeNull();
  });
});
