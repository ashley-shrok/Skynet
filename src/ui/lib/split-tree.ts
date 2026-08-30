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

/** Phase 57 Plan 01 — the widened return type of `computeEdgeZone`. Adds
 *  `"center"` to the four `DropEdge` values so callers can distinguish the
 *  pane's inner dead-zone rectangle (where no drop should register) from a
 *  real edge pick. `DropEdge` itself is UNCHANGED — Phase 56 consumers
 *  (`insertAtEdge`, `buildSplitForEdge`, the AppShell drop handlers) still
 *  operate on the four-value edge type; Plan 57-02's `Pane` short-circuits
 *  before calling `insertAtEdge` when `DropZone === "center"`.
 *
 *  Rationale (per .planning/phases/57-drop-preview-overlay-edge-zone-hit-
 *  testing-replace-placehold/57-CONTEXT.md §In-scope item 1 + shape file
 *  quote): "the center dead zone exists so there is one path to closing a
 *  session — closing is Phase 58's drag-badge-to-list". Center-drop must do
 *  NOTHING — no replace, no swap, no no-op-with-visual-feedback — so it
 *  cannot be a fifth `DropEdge` value that flows into `insertAtEdge`. */
export type DropZone = DropEdge | "center";

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

// ─── computeEdgeZone (Phase 57 Plan 01) ────────────────────────────────────

/** Normalized-distance threshold for the edge-zone band. Cursor is in an
 *  edge zone when its minimum per-axis normalized distance to any of the
 *  four rect edges is `<= EDGE_ZONE_THRESHOLD`; otherwise it is in the
 *  `"center"` dead-zone.
 *
 *  Value 0.28 matches the reference prototype
 *  (`~/.claude/roles/box-maintainer/bounties/bring-back-split-view/
 *  prototype.html:362` — `const EDGE = 0.28`). A ~28% inner band per axis
 *  gives roughly a 44% × 44% center dead-zone rectangle (100% - 2×28%),
 *  Ashley-validated live in the reference. NOT exported: the threshold is
 *  a locked design decision; if a future phase needs to tune it, they
 *  modify this constant in-place rather than parameterizing callers. */
const EDGE_ZONE_THRESHOLD = 0.28;

/** Phase 57 Plan 01: 5-zone hit-tester for the drop-preview overlay.
 *
 *  Divides a rect into 5 zones by cursor position:
 *    - Four edge zones (left / right / top / bottom): the outer band along
 *      each axis, ~28% of the rect's normalized dimension.
 *    - Center dead zone: the inner ~44% × 44% rectangle where drop must NOT
 *      register (Plan 57-02's `Pane` short-circuits before calling any
 *      tree op). See `.planning/phases/57-drop-preview-overlay-edge-zone-
 *      hit-testing-replace-placehold/57-CONTEXT.md` §In-scope item 1 for
 *      the contract.
 *
 *  Ports `pickZone` at `~/.claude/roles/box-maintainer/bounties/
 *  bring-back-split-view/prototype.html:361-370` verbatim (Ashley-validated
 *  live in the reference). Algorithm:
 *    1. Normalize cursor to [0..1] per axis: `zx = (x - left) / width`.
 *    2. Compute four normalized edge-distances (`distTop = zy`, `distBottom
 *       = 1 - zy`, `distLeft = zx`, `distRight = 1 - zx`).
 *    3. `minDist = Math.min(all four)`.
 *    4. If `minDist > EDGE_ZONE_THRESHOLD`, return `"center"`.
 *    5. Otherwise, first-match-wins tie-break priority `top → bottom → left
 *       → right` (mirrors prototype's if-chain at :366-369 verbatim).
 *
 *  Corner-tie behaviour: cursor at the diagonally-symmetric point (e.g.
 *  (14, 14) in a 100×100 rect where `distTop === distLeft`) resolves
 *  deterministically to `"top"` by the tie-break priority — never
 *  oscillates between two candidates as the cursor sits still.
 *
 *  Defensive property (Test 12): cursor coordinates OUTSIDE the rect (e.g.
 *  negative `x`, or `x > right`) do NOT throw and do NOT get clamped —
 *  the normalized distance goes negative, but the "nearest edge" argument
 *  still holds and the function returns a defined `DropEdge` value. This
 *  matters because `dragover` events can briefly fire with the cursor at
 *  a pane boundary where `getBoundingClientRect()` and the event's
 *  clientX/Y sit on opposite sides of the pixel boundary.
 *
 *  Pure function — no React, no DOM, no side effects. Callable from
 *  Vitest with plain object literals; callable from Pane with a live
 *  `getBoundingClientRect()`. Signature deliberately mirrors
 *  `computeNearestEdge` in `src/ui/shell/SplitView.tsx:44-69` so the two
 *  are drop-in interchangeable at the Pane callsite.
 *
 *  Exported for Plan 57-02 (dragover-time zone computation + drop-time
 *  center-dead-zone short-circuit) and for direct unit coverage. */
export function computeEdgeZone(
  rect: DOMRect | { left: number; right: number; top: number; bottom: number },
  clientX: number,
  clientY: number,
): DropZone {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const zx = (clientX - rect.left) / width;
  const zy = (clientY - rect.top) / height;
  const distTop = zy;
  const distBottom = 1 - zy;
  const distLeft = zx;
  const distRight = 1 - zx;
  const minDist = Math.min(distTop, distBottom, distLeft, distRight);
  if (minDist > EDGE_ZONE_THRESHOLD) return "center";
  // First-match-wins tie-break priority (matches prototype.html:366-369).
  if (minDist === distTop) return "top";
  if (minDist === distBottom) return "bottom";
  if (minDist === distLeft) return "left";
  return "right";
}

// ─── replaceLeaf (Phase 64 Plan 01) ────────────────────────────────────────

/** Phase 64 Plan 01: pure immutable tree op backing "drop a conversation-list
 *  row payload onto the CENTER of an already-open session's body". The dragged
 *  session takes the target cell in place; the target session drops out of the
 *  grid entirely (still exists in the conv list — just no longer in a slot).
 *
 *  See `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` § In-scope
 *  item 1 for the semantic contract; § Edge cases items 1-4 for the four
 *  branches implemented here.
 *
 *  Four branches:
 *    1. `root === null` → return null verbatim (nothing to replace).
 *    2. `targetTabId === replacementTabId` → return `root` by reference identity
 *       (Object.is holds). Cheap same-id no-op, NO console.warn.
 *    3. `targetTabId` not found in the tree → emit ONE defensive `console.warn`
 *       and return `root` by reference identity. The Plan 64-02 AppShell
 *       handler's guard makes this unreachable in practice; the warn helps
 *       debuggability if the invariant ever breaks.
 *    4. Mainline: if `replacementTabId` is ALREADY in the tree elsewhere,
 *       `removeLeaf` evicts it first (collapsing its parent split via the
 *       existing invariant-preserving rule). The path to `targetTabId` is
 *       then re-discovered post-removal (an ancestor may have collapsed),
 *       and the target leaf is replaced with a fresh `{kind:"session",
 *       tabId: replacementTabId}` leaf via the private `replaceAt` helper.
 *
 *  Purity: no in-place mutation of any input SplitNode; every ancestor on the
 *  rewrite path is freshly allocated per `replaceAt`'s documented contract at
 *  :213-240; every subtree NOT on the rewrite path is shared by reference.
 *
 *  Logging: NO `console.info` from this helper body — structured
 *  `[pv-split-drop]` logging is Plan 64-02's job at the AppShell handler
 *  layer. Only defensive `console.warn` on missing target (branch 3). */
export function replaceLeaf(
  root: SplitNode | null,
  targetTabId: string,
  replacementTabId: string,
): SplitNode | null {
  // Branch 1: null tree — nothing to replace.
  if (root === null) return root;
  // Branch 2: same-id no-op — reference-identity return, no warn.
  if (targetTabId === replacementTabId) return root;
  // Branch 3: target not found — defensive warn + reference-identity return.
  const targetPath = findLeaf(root, targetTabId);
  if (targetPath === null) {
    console.warn(
      `[split-tree] replaceLeaf: target not found targetTabId=${targetTabId}`,
    );
    return root;
  }
  // Branch 4 (mainline): evict any pre-existing replacementTabId, then
  // rediscover the target path (an ancestor may have collapsed) and swap the
  // target leaf.
  const withoutReplacement = removeLeaf(root, replacementTabId);
  // Degenerate case: single-leaf root where replacement WAS that leaf and the
  // target was ALSO that leaf's parent context — removeLeaf can return null.
  // Guard prevents crashing on rediscovery.
  if (withoutReplacement === null) {
    return { kind: "session", tabId: replacementTabId };
  }
  const freshTargetPath = findLeaf(withoutReplacement, targetTabId);
  // Defensive: if the target became collateral in the collapse (should not
  // happen for distinct tabIds, but preserves the surviving cells over
  // throwing), return the post-removal tree.
  if (freshTargetPath === null) return withoutReplacement;
  return replaceAt(withoutReplacement, freshTargetPath, {
    kind: "session",
    tabId: replacementTabId,
  });
}

// ─── swapLeaves (Phase 64 Plan 01) ─────────────────────────────────────────

/** Phase 64 Plan 01: pure immutable tree op backing "drop an already-open
 *  session's identity badge onto the CENTER of another already-open session".
 *  The two sessions trade slots; both remain live in the grid. Pure
 *  leaf-content-only mutation — every internal split node (direction +
 *  structural shape) is preserved by construction because we never touch
 *  splits, only leaf contents at two paths.
 *
 *  See `.planning/phases/64-multi-view-center-drop/64-CONTEXT.md` § In-scope
 *  item 1 + § Edge cases item 7 (deep-tree swap preserves inner directions).
 *
 *  Three branches:
 *    1. `root === null` → return null verbatim (nothing to swap).
 *    2. `tabIdA === tabIdB` → return `root` by reference identity (Object.is
 *       holds). Cheap same-id no-op, NO console.warn.
 *    3. Either `tabIdA` or `tabIdB` not found in the tree → emit ONE
 *       defensive `console.warn` naming the missing tabId, and return `root`
 *       by reference identity. If BOTH are missing, `tabIdA` is named (the
 *       first-encountered miss). The Plan 64-02 handler's guard makes this
 *       unreachable in practice; the warn helps debuggability.
 *    4. Mainline: `replaceAt` applied twice — first swaps `pathA`'s leaf to
 *       `tabIdB`, then swaps `pathB`'s leaf to `tabIdA`. Order does not
 *       matter because leaves are terminal (a leaf cannot be an ancestor of
 *       another leaf), so `pathA` and `pathB` are guaranteed disjoint.
 *
 *  Purity: no in-place mutation; every ancestor on either rewrite path is
 *  freshly allocated per `replaceAt`'s contract.
 *
 *  Logging: NO `console.info` from this helper body — structured
 *  `[pv-split-drop]` logging belongs to Plan 64-02's AppShell handler layer.
 *  Only defensive `console.warn` on missing leaves (branch 3). */
export function swapLeaves(
  root: SplitNode | null,
  tabIdA: string,
  tabIdB: string,
): SplitNode | null {
  // Branch 1: null tree — nothing to swap.
  if (root === null) return root;
  // Branch 2: same-id no-op — reference-identity return, no warn.
  if (tabIdA === tabIdB) return root;
  // Branch 3: missing leaf — defensive warn + reference-identity return.
  const pathA = findLeaf(root, tabIdA);
  const pathB = findLeaf(root, tabIdB);
  if (pathA === null || pathB === null) {
    const missing = pathA === null ? tabIdA : tabIdB;
    console.warn(`[split-tree] swapLeaves: leaf not found tabId=${missing}`);
    return root;
  }
  // Branch 4 (mainline): two-step leaf-content-only swap. Order-independent
  // because leaves are terminal — pathA and pathB describe disjoint locations
  // and neither call restructures the tree.
  const step1 = replaceAt(root, pathA, { kind: "session", tabId: tabIdB });
  const step2 = replaceAt(step1, pathB, { kind: "session", tabId: tabIdA });
  return step2;
}
