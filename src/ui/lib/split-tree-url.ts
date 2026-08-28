// TEMPORARY STUB — Phase 56 Plan 01 Task 2 TDD RED gate. Implementation lands
// in the immediately-following GREEN commit. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-01-PLAN.md

import type { TabSpec } from "./tab-url";
import type { SplitNode } from "./split-tree";

export function encodeSplitTreeToUrl(
  _root: SplitNode | null,
  _sessionAddress: (tabId: string) => TabSpec | null,
): string {
  throw new Error(
    "split-tree-url.encodeSplitTreeToUrl: not implemented (TDD RED stub)",
  );
}

export function decodeSplitTreeFromUrl(
  _str: string,
  _resolver: (spec: TabSpec) => string | null,
): SplitNode | null {
  throw new Error(
    "split-tree-url.decodeSplitTreeFromUrl: not implemented (TDD RED stub)",
  );
}
