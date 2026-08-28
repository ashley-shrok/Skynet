// TEMPORARY STUB — Phase 56 Plan 01 Task 1 TDD RED gate. Implementation lands
// in the immediately-following GREEN commit. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-01-PLAN.md
// This stub exists so `split-tree.test.ts` compiles (no phantom-import TS
// error) and every case fails on the "not implemented" assertions rather
// than on a missing module.

export type SplitDirection = "horizontal" | "vertical";
export type DropEdge = "left" | "right" | "top" | "bottom";
export type SplitNode =
  | { kind: "session"; tabId: string }
  | {
    kind: "split";
    direction: SplitDirection;
    children: [SplitNode, SplitNode];
  };
export type SplitPath = number[];

export function findLeaf(
  _root: SplitNode | null,
  _tabId: string,
): SplitPath | null {
  throw new Error("split-tree.findLeaf: not implemented (TDD RED stub)");
}

export function getNodeAt(
  _root: SplitNode | null,
  _path: SplitPath,
): SplitNode | null {
  throw new Error("split-tree.getNodeAt: not implemented (TDD RED stub)");
}

export function insertAtEdge(
  _root: SplitNode | null,
  _targetPath: SplitPath,
  _newLeaf: SplitNode,
  _edge: DropEdge,
): SplitNode {
  throw new Error("split-tree.insertAtEdge: not implemented (TDD RED stub)");
}

export function removeLeaf(
  _root: SplitNode | null,
  _tabId: string,
): SplitNode | null {
  throw new Error("split-tree.removeLeaf: not implemented (TDD RED stub)");
}

export function collectTabIds(_root: SplitNode | null): string[] {
  throw new Error("split-tree.collectTabIds: not implemented (TDD RED stub)");
}
