// ─── split-tree.ts ─────────────────────────────────────────────────────────
// Phase 56 Plan 01 — recursive split-tree data model + pure immutable helpers.
//
// This module is the foundation for Phase 56 (visual session management,
// foundation-phase scope items 1 + 5 in the phase CONTEXT.md). It replaces
// the retired `paneTabIds: (string | null)[]` fixed-grid data model that
// used to live inside `SplitView.tsx`.
//
// LOCKED DECISION — Ashley 2026-08-28: no draggable pane dividers.
//   Constant-ratio 50/50 is a rendering choice made downstream. The tree
//   node carries NO ratio / size / weight / percent field. Every cell holds
//   the same shape of thing (a session), so a window-manager knob would
//   over-engineer the affordance.
//
// INVARIANT (enforced by helpers, walked by tests):
//   Every `{kind: 'split'}` node has EXACTLY two non-null `SplitNode`
//   children. There is never a single-child split, never a null child,
//   never an array of length != 2. `removeLeaf` collapses any parent that
//   would violate this into its surviving child.
//
// EDGE → DIRECTION MAPPING (documented here so Plan 56-02's renderer imports
//   the same mental model):
//     - `left`   → direction: 'vertical'   (side-by-side; vertical divider).
//                  New leaf goes on the LEFT (index 0).
//     - `right`  → direction: 'vertical'   (side-by-side; vertical divider).
//                  New leaf goes on the RIGHT (index 1).
//     - `top`    → direction: 'horizontal' (stacked; horizontal divider).
//                  New leaf goes on the TOP (index 0).
//     - `bottom` → direction: 'horizontal' (stacked; horizontal divider).
//                  New leaf goes on the BOTTOM (index 1).
//   Convention: `direction` is the axis of the divider, matching the HTML/CSS
//   `<hr>` convention where a "horizontal rule" is a left-to-right line.
//
// CONSUMERS (out of scope for this module — none of these are imported here):
//   - Plan 56-02: `src/ui/shell/SplitView.tsx` refactor consumes SplitNode +
//     insertAtEdge for the recursive renderer, and `src/ui/AppShell.tsx`
//     wires URL-restore + URL-sync through split-tree-url.ts (Task 2).
//   - Plan 56-03: row-drop-splits-cell in `PrettyConversationRow.tsx` calls
//     insertAtEdge on drop.
//
// NO REACT / DOM / BACKEND IMPORTS. This module compiles and tests in any
// TS environment. Also NO dependency on `src/types/ui-types.ts` — the tree
// references `tabId: string`, not the `Tab` type, so the two data models
// decouple cleanly.

/** Divider axis. 'horizontal' = horizontal divider = top pane stacked over
 *  bottom pane. 'vertical' = vertical divider = left pane beside right pane.
 *  Matches HTML/CSS convention where "horizontal rule" is a left-to-right
 *  line. */
export type SplitDirection = "horizontal" | "vertical";

/** The cell edge a drop landed nearest to. Consumed by `insertAtEdge`. See
 *  the module-level edge → direction mapping. */
export type DropEdge = "left" | "right" | "top" | "bottom";

/** The tree. Root of a whole tree is `SplitNode | null` (null = empty
 *  layout, no session shown). */
export type SplitNode =
  | { kind: "session"; tabId: string }
  | {
    kind: "split";
    direction: SplitDirection;
    children: [SplitNode, SplitNode];
  };

/** Sequence of `0 | 1` indices from root. Empty array = root. Number typing
 *  is deliberate over a literal-union so callers can build paths by
 *  iteration; helpers guard against out-of-bounds values. */
export type SplitPath = number[];

// ─── findLeaf ──────────────────────────────────────────────────────────────

/** DFS. Returns the path to the leaf whose tabId matches, or null if not
 *  found. `[]` = root leaf match. Called by consumers to locate the target
 *  cell for a drop. */
export function findLeaf(
  root: SplitNode | null,
  tabId: string,
): SplitPath | null {
  if (root === null) return null;
  if (root.kind === "session") {
    return root.tabId === tabId ? [] : null;
  }
  // split — search children in order.
  for (let i = 0; i < 2; i += 1) {
    const sub = findLeaf(root.children[i], tabId);
    if (sub !== null) return [i, ...sub];
  }
  return null;
}

// ─── getNodeAt ─────────────────────────────────────────────────────────────

/** Walks the path, returning null on any dead-end (leaf mid-path, index
 *  out-of-bounds, null root). Empty path returns root. */
export function getNodeAt(
  root: SplitNode | null,
  path: SplitPath,
): SplitNode | null {
  if (root === null) return null;
  let node: SplitNode = root;
  for (const idx of path) {
    if (node.kind === "session") return null; // stepped into a leaf
    if (idx !== 0 && idx !== 1) return null; // out-of-bounds
    node = node.children[idx];
  }
  return node;
}

// ─── insertAtEdge ──────────────────────────────────────────────────────────

/** Immutable insertion. Returns a new tree; every node on the rewrite path
 *  is freshly allocated; every subtree NOT on the rewrite path is shared
 *  by reference (Object.is holds).
 *
 *  Behaviour:
 *   - `root === null` → returns `newLeaf` verbatim (edge ignored). First
 *     drop into an empty layout just plants the seed.
 *   - Otherwise walks to `targetPath`, which MUST resolve to a session leaf
 *     (throws if it resolves to a split node or nowhere).
 *   - Replaces the target leaf with a new split whose direction + child
 *     order is dictated by `edge` per the module-level mapping.
 *
 *  `newLeaf` MUST be a session leaf (kind: 'session'); throws otherwise.
 *  Callers wanting to insert a subtree should assemble the split themselves
 *  and walk the parent path — this helper is deliberately narrow. */
export function insertAtEdge(
  root: SplitNode | null,
  targetPath: SplitPath,
  newLeaf: SplitNode,
  edge: DropEdge,
): SplitNode {
  if (newLeaf.kind !== "session") {
    throw new Error(
      "split-tree.insertAtEdge: newLeaf must be a session leaf, got split",
    );
  }
  if (root === null) {
    // First drop into empty layout — edge is irrelevant, no cell to split.
    return newLeaf;
  }
  // Walk to the target, validating each step.
  const targetNode = getNodeAt(root, targetPath);
  if (targetNode === null) {
    throw new Error(
      "split-tree.insertAtEdge: target path does not resolve to any node",
    );
  }
  if (targetNode.kind !== "session") {
    throw new Error(
      "split-tree.insertAtEdge: target path resolves to internal split, not a leaf",
    );
  }
  const replacement = buildSplitForEdge(targetNode, newLeaf, edge);
  return replaceAt(root, targetPath, replacement);
}

function buildSplitForEdge(
  existing: SplitNode,
  nu: SplitNode,
  edge: DropEdge,
): SplitNode {
  switch (edge) {
    case "left":
      // vertical divider (side-by-side); new leaf on LEFT.
      return {
        kind: "split",
        direction: "vertical",
        children: [nu, existing],
      };
    case "right":
      return {
        kind: "split",
        direction: "vertical",
        children: [existing, nu],
      };
    case "top":
      // horizontal divider (stacked); new leaf on TOP.
      return {
        kind: "split",
        direction: "horizontal",
        children: [nu, existing],
      };
    case "bottom":
      return {
        kind: "split",
        direction: "horizontal",
        children: [existing, nu],
      };
  }
}

/** Return a new tree in which the node at `path` is replaced by
 *  `replacement`. Every ancestor on the path is freshly allocated; every
 *  sibling subtree is shared by reference. Assumes `path` is valid (caller
 *  has already walked with getNodeAt). */
function replaceAt(
  root: SplitNode,
  path: SplitPath,
  replacement: SplitNode,
): SplitNode {
  if (path.length === 0) return replacement;
  if (root.kind === "session") {
    throw new Error(
      "split-tree.replaceAt: path descends past a leaf (invariant violated)",
    );
  }
  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) {
    throw new Error(
      "split-tree.replaceAt: path index out of bounds (must be 0 or 1)",
    );
  }
  const currentChild = root.children[head];
  const newChild = replaceAt(currentChild, rest, replacement);
  const newChildren: [SplitNode, SplitNode] = head === 0
    ? [newChild, root.children[1]]
    : [root.children[0], newChild];
  return {
    kind: "split",
    direction: root.direction,
    children: newChildren,
  };
}

// ─── removeLeaf ────────────────────────────────────────────────────────────

/** Walks the tree; if the leaf is not found, returns the input by
 *  reference (cheap no-op — Object.is on input and output holds true).
 *  If found, walks back up the path collapsing any single-child split
 *  into the surviving child (the invariant-preserving rule). If the
 *  removed leaf was the root, returns null. */
export function removeLeaf(
  root: SplitNode | null,
  tabId: string,
): SplitNode | null {
  if (root === null) return null;
  const path = findLeaf(root, tabId);
  if (path === null) return root; // reference-identity no-op
  return removeAt(root, path);
}

/** Remove the node at `path` and collapse the resulting one-child split
 *  by promoting the surviving sibling into the parent's slot. Every
 *  ancestor is freshly allocated. */
function removeAt(root: SplitNode, path: SplitPath): SplitNode | null {
  if (path.length === 0) return null; // removed the root
  if (root.kind === "session") {
    throw new Error(
      "split-tree.removeAt: path descends past a leaf (invariant violated)",
    );
  }
  const [head, ...rest] = path;
  if (head !== 0 && head !== 1) {
    throw new Error(
      "split-tree.removeAt: path index out of bounds (must be 0 or 1)",
    );
  }
  if (rest.length === 0) {
    // The direct child at `head` is the target. Collapse — return the
    // surviving sibling verbatim. This is the one-child-split → sibling
    // promotion rule.
    return root.children[head === 0 ? 1 : 0];
  }
  const currentChild = root.children[head];
  const newChild = removeAt(currentChild, rest);
  if (newChild === null) {
    // Only path.length === 0 returns null from removeAt. Reaching here
    // means a future refactor loosened that invariant — throw loudly
    // rather than silently discard the sibling subtree (the previous
    // belt-and-braces "return the surviving sibling" was silent data
    // loss when the invariant broke, caught in Phase 56 code review).
    throw new Error(
      "split-tree.removeAt: unreachable — subtree returned null mid-path (invariant violated)",
    );
  }
  const newChildren: [SplitNode, SplitNode] = head === 0
    ? [newChild, root.children[1]]
    : [root.children[0], newChild];
  return {
    kind: "split",
    direction: root.direction,
    children: newChildren,
  };
}

// ─── collectTabIds ─────────────────────────────────────────────────────────

/** Left-to-right DFS traversal collecting every leaf's tabId. Used by
 *  consumers (AppShell URL-sync in Plan 56-02) to reconcile the tree
 *  against the tabs array — orphaned leaves whose tab was closed elsewhere
 *  can be identified by set-difference. */
export function collectTabIds(root: SplitNode | null): string[] {
  if (root === null) return [];
  if (root.kind === "session") return [root.tabId];
  return [
    ...collectTabIds(root.children[0]),
    ...collectTabIds(root.children[1]),
  ];
}
