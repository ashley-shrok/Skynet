// Phase 56 Plan 01 Task 1 — vitest suite for split-tree.ts.
//
// Behaviour spec is the plan file's Task 1 `<behavior>` block; every test
// below cites its plan-item number. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-01-PLAN.md
//
// The tree data model is a recursive discriminated union — see split-tree.ts
// header for the full contract. Constant-ratio 50/50 is baked in (locked
// decision Ashley 2026-08-28: no draggable pane dividers → no ratio field).

import { describe, it, expect } from "vitest";
import {
  type SplitNode,
  type SplitDirection,
  type DropEdge,
  type DropZone,
  type SplitPath,
  findLeaf,
  getNodeAt,
  insertAtEdge,
  removeLeaf,
  collectTabIds,
  computeEdgeZone,
} from "./split-tree";
// Phase 57 Plan 01 deviation from PLAN.md: Test 13 was specified to import
// `computeNearestEdge` from `./split-tree`, but Phase 56 shipped
// `computeNearestEdge` in `src/ui/shell/SplitView.tsx` (not split-tree.ts).
// The regression guard's intent — "assert Phase 56's function is untouched" —
// is preserved by importing from its actual home. See 57-01-SUMMARY.md
// § Deviations for the rationale.
import { computeNearestEdge } from "@/shell/SplitView";

// Helpers used across cases -----------------------------------------------
const leaf = (id: string): SplitNode => ({ kind: "session", tabId: id });

const split = (
  direction: SplitDirection,
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: "split", direction, children: [a, b] });

/** Walk the tree and assert the "every split has exactly two non-null
 *  children" invariant. Also enforces the type-guard by shape (children.length
 *  === 2 and each child is a valid SplitNode). Returns nothing; throws (via
 *  Vitest expect) on violation. */
function assertInvariant(node: SplitNode | null): void {
  if (node === null) return;
  if (node.kind === "session") {
    expect(typeof node.tabId).toBe("string");
    return;
  }
  // split
  expect(node.kind).toBe("split");
  expect(node.direction === "horizontal" || node.direction === "vertical")
    .toBe(true);
  expect(Array.isArray(node.children)).toBe(true);
  expect(node.children.length).toBe(2);
  expect(node.children[0]).not.toBeNull();
  expect(node.children[1]).not.toBeNull();
  assertInvariant(node.children[0]);
  assertInvariant(node.children[1]);
}

describe("split-tree", () => {
  // Test 1: type shape --------------------------------------------------
  it("Test 1: SplitNode discriminated union has exactly two variants", () => {
    // Compile-time exhaustiveness — TS narrows on `kind`.
    const l: SplitNode = { kind: "session", tabId: "aqua" };
    const s: SplitNode = {
      kind: "split",
      direction: "vertical",
      children: [l, { kind: "session", tabId: "nelly" }],
    };
    // Runtime: exactly two shapes and no third.
    const kinds: Array<SplitNode["kind"]> = [l.kind, s.kind];
    expect(kinds.sort()).toEqual(["session", "split"]);
    // Root of a whole tree is `SplitNode | null` — null is valid.
    const emptyRoot: SplitNode | null = null;
    expect(emptyRoot).toBeNull();
  });

  // Test 2: findLeaf ----------------------------------------------------
  describe("Test 2: findLeaf", () => {
    it("returns null on null root", () => {
      expect(findLeaf(null, "x")).toBeNull();
    });

    it("returns [] when a root-leaf matches", () => {
      expect(findLeaf(leaf("x"), "x")).toEqual([]);
    });

    it("returns null when a root-leaf does not match", () => {
      expect(findLeaf(leaf("x"), "y")).toBeNull();
    });

    it("returns the path to a deep leaf", () => {
      // root = split-v(   split-h(aqua, nelly)  ,  split-v(zack, ivy)  )
      // 'z' lives at children[1].children[0] → path [1, 0]
      const root = split(
        "vertical",
        split("horizontal", leaf("aqua"), leaf("nelly")),
        split("vertical", leaf("zack"), leaf("ivy")),
      );
      expect(findLeaf(root, "zack")).toEqual([1, 0]);
      expect(findLeaf(root, "aqua")).toEqual([0, 0]);
      expect(findLeaf(root, "ivy")).toEqual([1, 1]);
      expect(findLeaf(root, "does-not-exist")).toBeNull();
    });
  });

  // Test 3: getNodeAt ---------------------------------------------------
  describe("Test 3: getNodeAt", () => {
    it("returns null for null root, any path", () => {
      expect(getNodeAt(null, [])).toBeNull();
      expect(getNodeAt(null, [0])).toBeNull();
    });

    it("returns the root when path is []", () => {
      const root = leaf("x");
      expect(getNodeAt(root, [])).toBe(root);
    });

    it("returns the addressed subtree", () => {
      const inner = split("horizontal", leaf("a"), leaf("b"));
      const root = split("vertical", leaf("c"), inner);
      expect(getNodeAt(root, [0])).toEqual(leaf("c"));
      expect(getNodeAt(root, [1])).toBe(inner);
      expect(getNodeAt(root, [1, 0])).toEqual(leaf("a"));
      expect(getNodeAt(root, [1, 1])).toEqual(leaf("b"));
    });

    it("returns null when the path steps into a leaf mid-descent", () => {
      const root = split("vertical", leaf("c"), leaf("d"));
      // path [0, 0] tries to descend into leaf 'c' — dead end.
      expect(getNodeAt(root, [0, 0])).toBeNull();
    });

    it("returns null for out-of-bounds indices", () => {
      const root = split("vertical", leaf("c"), leaf("d"));
      // Only 0 and 1 are valid at each split; 2 is out of bounds.
      expect(getNodeAt(root, [2])).toBeNull();
    });
  });

  // Test 4: insertAtEdge into an empty root -----------------------------
  it(
    "Test 4: insertAtEdge into an empty (null) root returns the new leaf verbatim",
    () => {
      const newLeaf = leaf("aqua");
      const out = insertAtEdge(null, [], newLeaf, "left");
      // Verbatim, not wrapped.
      expect(out).toBe(newLeaf);
      // Edge is ignored on empty-root because there's no cell to split.
      expect(insertAtEdge(null, [], newLeaf, "top")).toBe(newLeaf);
      expect(insertAtEdge(null, [], newLeaf, "right")).toBe(newLeaf);
      expect(insertAtEdge(null, [], newLeaf, "bottom")).toBe(newLeaf);
    },
  );

  // Test 5: insertAtEdge on an existing leaf — edge → direction mapping -
  it(
    "Test 5: insertAtEdge on an existing leaf splits per edge → direction map",
    () => {
      const existing = leaf("aqua");
      const nu = leaf("nelly");
      // 'left' → vertical divider, new leaf on LEFT.
      expect(insertAtEdge(existing, [], nu, "left")).toEqual({
        kind: "split",
        direction: "vertical",
        children: [nu, existing],
      });
      // 'right' → vertical divider, new leaf on RIGHT.
      expect(insertAtEdge(existing, [], nu, "right")).toEqual({
        kind: "split",
        direction: "vertical",
        children: [existing, nu],
      });
      // 'top' → horizontal divider, new leaf on TOP.
      expect(insertAtEdge(existing, [], nu, "top")).toEqual({
        kind: "split",
        direction: "horizontal",
        children: [nu, existing],
      });
      // 'bottom' → horizontal divider, new leaf on BOTTOM.
      expect(insertAtEdge(existing, [], nu, "bottom")).toEqual({
        kind: "split",
        direction: "horizontal",
        children: [existing, nu],
      });
    },
  );

  // Test 6: structural sharing ------------------------------------------
  it(
    "Test 6: insertAtEdge preserves non-touched subtrees by reference (Object.is)",
    () => {
      // Build a 2-deep tree:
      //   root = split-v(   siblingA=leaf('a')  ,  siblingB=split-h(leaf('b'), leaf('c'))  )
      const siblingA = leaf("a");
      const siblingB = split("horizontal", leaf("b"), leaf("c"));
      const root = split("vertical", siblingA, siblingB);

      // Insert at path [1, 0] (i.e. into leaf 'b' inside siblingB), 'left'
      // edge. siblingA MUST survive by reference (not on rewrite path).
      const nu = leaf("nu");
      const after = insertAtEdge(root, [1, 0], nu, "left");

      // Root MUST be freshly allocated (it's on the rewrite path).
      expect(Object.is(after, root)).toBe(false);
      // Root's kind is still split (post-condition).
      if (after.kind !== "split") {
        throw new Error("expected split at root");
      }
      // children[0] (siblingA) MUST be the same reference (structural sharing).
      expect(Object.is(after.children[0], siblingA)).toBe(true);
      // children[1] (siblingB) IS on the rewrite path, so freshly allocated.
      expect(Object.is(after.children[1], siblingB)).toBe(false);
      // Inside the rewritten siblingB, the untouched sister leaf 'c' at [1, 1]
      // MUST be the same reference as siblingB.children[1].
      const newB = after.children[1];
      if (newB.kind !== "split") throw new Error("expected split at [1]");
      expect(Object.is(newB.children[1], siblingB.children[1])).toBe(true);
      // Verify the new leaf actually landed as the LEFT half of a new inner
      // vertical split at [1, 0] (edge='left' → new-on-left, vertical).
      const inserted = newB.children[0];
      if (inserted.kind !== "split") {
        throw new Error("expected inner split at [1,0]");
      }
      expect(inserted.direction).toBe("vertical");
      expect(inserted.children[0]).toBe(nu);
      expect(inserted.children[1]).toEqual(leaf("b"));
      // Input tree was not mutated.
      assertInvariant(root);
    },
  );

  // Test 7: guard rails on insertAtEdge ---------------------------------
  it(
    "Test 7: insertAtEdge throws when newLeaf is not a session leaf or target is not a leaf",
    () => {
      const target = leaf("existing");
      // newLeaf is a split node → invalid.
      expect(() =>
        insertAtEdge(
          target,
          [],
          split("vertical", leaf("a"), leaf("b")),
          "left",
        )
      ).toThrow();

      // target path resolves to an internal split, not a leaf → invalid.
      const root = split("vertical", leaf("a"), leaf("b"));
      // path [] resolves to the split at root, not a leaf.
      expect(() => insertAtEdge(root, [], leaf("nu"), "left")).toThrow();

      // target path resolves to nowhere → invalid.
      expect(() => insertAtEdge(root, [2], leaf("nu"), "left")).toThrow();
    },
  );

  // Test 8: removeLeaf collapse rule ------------------------------------
  describe("Test 8: removeLeaf collapse rule", () => {
    it("removing the root leaf returns null", () => {
      expect(removeLeaf(leaf("x"), "x")).toBeNull();
    });

    it(
      "on a 2-way split, returns the OTHER child verbatim (surviving sibling promotes)",
      () => {
        const survivor = leaf("survives");
        const root = split("vertical", leaf("dies"), survivor);
        expect(removeLeaf(root, "dies")).toBe(survivor);
        // Direction of the collapsed parent is discarded — surviving leaf
        // replaces the parent split verbatim.
      },
    );

    it(
      "on a 3-deep tree, collapses two levels when the surviving branch is a single leaf",
      () => {
        // root = split-v(  leaf('outer')  ,  split-h(  split-v(target, sisterInner)  ,  sisterOuter  )  )
        // Remove 'target' at [1, 0, 0]:
        //   - split-v at [1, 0] loses one child → collapses to sisterInner
        //   - split-h at [1] now has [sisterInner, sisterOuter] → stays as split
        //   - root [1] slot is replaced by the new split-h → stays as split
        const sisterInner = leaf("sisterInner");
        const sisterOuter = leaf("sisterOuter");
        const target = leaf("target");
        const root = split(
          "vertical",
          leaf("outer"),
          split(
            "horizontal",
            split("vertical", target, sisterInner),
            sisterOuter,
          ),
        );
        const after = removeLeaf(root, "target");
        expect(after).toEqual(
          split(
            "vertical",
            leaf("outer"),
            split("horizontal", sisterInner, sisterOuter),
          ),
        );
        // Invariant holds throughout.
        assertInvariant(after);
      },
    );
  });

  // Test 9: removeLeaf no-op reference identity -------------------------
  it(
    "Test 9: removeLeaf on a non-existent tabId returns the input tree UNCHANGED by reference",
    () => {
      const inner = split("vertical", leaf("a"), leaf("b"));
      const root = split("horizontal", leaf("c"), inner);
      const before = root;
      const after = removeLeaf(root, "never-existed");
      // Reference identity: the tree is returned unchanged for a cheap no-op.
      expect(Object.is(before, after)).toBe(true);
      // Also invariant-clean.
      assertInvariant(after);
    },
  );

  // Test 10: invariant preservation under randomized ops ----------------
  it(
    "Test 10: 20-op randomized sequence preserves the tree invariant",
    () => {
      // Deterministic LCG — no `Math.random`, no new deps.
      let seed = 1;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const pick = <T,>(arr: readonly T[]): T =>
        arr[Math.floor(rand() * arr.length)];
      const edges: readonly DropEdge[] = ["left", "right", "top", "bottom"];

      let tree: SplitNode | null = leaf("t0");
      let nextId = 1;
      for (let op = 0; op < 20; op += 1) {
        assertInvariant(tree);
        const ids = collectTabIds(tree);
        // 60% insert, 40% remove (skewed insert so tree grows before shrinking).
        const doInsert = rand() < 0.6 || ids.length <= 1;
        if (doInsert) {
          // Insert at a randomly-chosen existing leaf.
          if (ids.length === 0) {
            tree = insertAtEdge(null, [], leaf(`t${nextId++}`), pick(edges));
            continue;
          }
          const targetId = pick(ids);
          const targetPath = findLeaf(tree, targetId);
          if (targetPath === null) {
            throw new Error(
              "invariant: collectTabIds returned a tabId that findLeaf can't locate",
            );
          }
          tree = insertAtEdge(
            tree,
            targetPath,
            leaf(`t${nextId++}`),
            pick(edges),
          );
        } else {
          // Remove a random existing leaf.
          const targetId = pick(ids);
          tree = removeLeaf(tree, targetId);
        }
      }
      assertInvariant(tree);
    },
  );

  // Test 11: collectTabIds traversal order ------------------------------
  it("Test 11: collectTabIds returns tabIds in left-to-right DFS order", () => {
    expect(collectTabIds(null)).toEqual([]);
    expect(collectTabIds(leaf("only"))).toEqual(["only"]);
    // root = split-v(   split-h(A, B)  ,  split-v(C, D)  )
    // Traversal: A, B, C, D.
    const root = split(
      "vertical",
      split("horizontal", leaf("A"), leaf("B")),
      split("vertical", leaf("C"), leaf("D")),
    );
    expect(collectTabIds(root)).toEqual(["A", "B", "C", "D"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 57 Plan 01 Task 1 — edge-zone hit-testing (`computeEdgeZone`).
//
// Behaviour spec is 57-01-PLAN.md Task 1 `<behavior>` (Tests 1-13). Ports the
// prototype's `pickZone` (~/.claude/roles/box-maintainer/bounties/
// bring-back-split-view/prototype.html:361-370) verbatim: EDGE = 0.28
// normalized threshold, tie-break priority top → bottom → left → right.
//
// All rects use `{left, right, top, bottom}` object literals (no jsdom / no
// DOM setup) — `computeEdgeZone` accepts the same widened rect shape as
// `computeNearestEdge`.
// ─────────────────────────────────────────────────────────────────────────────

describe("split-tree — Phase 57: edge-zone hit-testing", () => {
  // Shared 100×100 origin-anchored rect used by Tests 1-9 + 12 + 13. Mirrors
  // the Plan 56-03 fixture pattern in `src/ui/shell/SplitView.test.tsx:243-248`.
  const rect = {
    left: 0,
    right: 100,
    top: 0,
    bottom: 100,
  } as const;

  it("Test 1: dead-center returns 'center'", () => {
    // (50, 50) in a 100×100 origin-anchored rect. zx = zy = 0.5;
    // minDist = 0.5 > 0.28 → 'center'.
    expect(computeEdgeZone(rect, 50, 50)).toBe("center");
  });

  it("Test 2: left-edge midpoint returns 'left'", () => {
    // (5, 50): zx = 0.05, zy = 0.5. distLeft = 0.05 wins.
    expect(computeEdgeZone(rect, 5, 50)).toBe("left");
  });

  it("Test 3: right-edge midpoint returns 'right'", () => {
    // (95, 50): distRight = 0.05 wins.
    expect(computeEdgeZone(rect, 95, 50)).toBe("right");
  });

  it("Test 4: top-edge midpoint returns 'top'", () => {
    // (50, 5): distTop = 0.05 wins.
    expect(computeEdgeZone(rect, 50, 5)).toBe("top");
  });

  it("Test 5: bottom-edge midpoint returns 'bottom'", () => {
    // (50, 95): distBottom = 0.05 wins.
    expect(computeEdgeZone(rect, 50, 95)).toBe("bottom");
  });

  it("Test 6: just outside the edge zone (distLeft = 0.30 > 0.28) returns 'center'", () => {
    // (30, 50): zx = 0.30; distLeft = 0.30 > EDGE_ZONE_THRESHOLD (0.28) →
    // 'center'. Threshold check uses `minDist > EDGE` (strict >).
    expect(computeEdgeZone(rect, 30, 50)).toBe("center");
  });

  it("Test 7: exactly at the edge-zone threshold (distLeft = 0.28) returns 'left'", () => {
    // (28, 50): distLeft = 0.28; NOT > 0.28, so falls through to edge picking
    // → 'left'. This nails the strict-inequality boundary behaviour.
    expect(computeEdgeZone(rect, 28, 50)).toBe("left");
  });

  it("Test 8: corner-tie top-left picks 'top' (tie-break priority top → bottom → left → right)", () => {
    // (14, 14): distTop = distLeft = 0.14 (both candidates for minDist);
    // distBottom = distRight = 0.86. Tie-break priority (prototype :366-369
    // verbatim) picks 'top' first.
    expect(computeEdgeZone(rect, 14, 14)).toBe("top");
  });

  it("Test 9: corner-tie bottom-right picks 'bottom' (top ≠ minDist so bottom wins next)", () => {
    // (86, 86): distTop = distLeft = 0.86; distBottom = distRight = 0.14.
    // Tie-break: minDist !== distTop → check distBottom next → 'bottom' wins
    // over 'right' by priority.
    expect(computeEdgeZone(rect, 86, 86)).toBe("bottom");
  });

  it("Test 10: non-square rect (200×100) normalizes per-axis, cursor at (150, 50) → 'right'", () => {
    // {left:0, right:200, top:0, bottom:100}; (150, 50):
    // zx = 150/200 = 0.75, zy = 50/100 = 0.5.
    // distTop = 0.5, distBottom = 0.5, distLeft = 0.75, distRight = 0.25.
    // minDist = 0.25 <= 0.28 → 'right'. Proves per-axis normalization
    // (raw-pixel distance would have made distRight = 50 dominate distTop=50
    // ambiguously; normalizing to fractions of each axis makes right the
    // clear closest edge).
    const wide = { left: 0, right: 200, top: 0, bottom: 100 } as const;
    expect(computeEdgeZone(wide, 150, 50)).toBe("right");
  });

  it("Test 11: off-origin rect (x=100..200) subtracts rect.left correctly, (110, 50) → 'left'", () => {
    // {left:100, right:200, top:0, bottom:100}; cursor (110, 50):
    // zx = (110-100)/100 = 0.10, zy = 0.5.
    // distLeft = 0.10 <= 0.28 → 'left'.
    const off = { left: 100, right: 200, top: 0, bottom: 100 } as const;
    expect(computeEdgeZone(off, 110, 50)).toBe("left");
  });

  it("Test 12: defensive — cursor outside rect (x = -10) still resolves to nearest edge ('left'), no throw", () => {
    // (-10, 50): zx = -0.10 (negative — cursor is off the left edge of the
    // pane). Function does NOT clamp — the negative distLeft still yields
    // minDist < 0.28 and 'left' is the closest edge. Documented in the JSDoc
    // on `computeEdgeZone`. Prevents drop-preview from throwing when the
    // dragover cursor briefly leaves the pane boundary.
    expect(computeEdgeZone(rect, -10, 50)).toBe("left");
  });

  it("Test 13: regression guard — Phase 56's `computeNearestEdge` remains callable & unchanged", () => {
    // Sanity checks that the sister function shipped in Phase 56 Plan 03
    // (src/ui/shell/SplitView.tsx:44-69) still exports and returns its
    // documented tie-break. Phase 57 must not touch it. Import path is
    // `@/shell/SplitView` — see the deviation note at the top of this file
    // for why the plan's suggested `./split-tree` import wouldn't compile.
    expect(typeof computeNearestEdge).toBe("function");
    expect(computeNearestEdge(rect, 10, 50)).toBe("left");
  });
});

// Reference so TS doesn't drop the type imports (Test 1 asserts shape).
const _typeCheck: SplitPath = [];
void _typeCheck;
// Reference so TS keeps the DropZone type import alive (used implicitly by
// `computeEdgeZone`'s return type in the tests above, but not typed
// explicitly there — an explicit reference here documents the shape).
const _dropZoneCheck: DropZone = "center";
void _dropZoneCheck;
