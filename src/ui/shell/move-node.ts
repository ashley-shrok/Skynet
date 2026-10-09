// ─── move-node.ts ─────────────────────────────────────────────────────────
// shape-app-pane-strip: AppShell reparents each tab's stable DOM node between
// the normal-view container and split panes. A plain appendChild move
// detaches the subtree first, which makes every <iframe> inside it reload
// from its src — an app pane snapped back to its start page and lost its
// history on every rearrange. Element.moveBefore (state-preserving atomic
// move) keeps iframes, focus and other live state intact.
//
// moveBefore only works for a node already connected to the same document as
// the target; the very first placement of a freshly-created tab node (still
// detached) and browsers without moveBefore use appendChild, i.e. today's
// behavior. A throw from moveBefore also falls back rather than leaving the
// node unplaced.

export type MoveNodeResult = "moved-in-place" | "appended";

type MoveCapableParent = HTMLElement & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

export function moveNodeInto(target: HTMLElement, moving: HTMLElement): MoveNodeResult {
  const parent = target as MoveCapableParent;
  if (
    typeof parent.moveBefore === "function" &&
    moving.isConnected &&
    target.isConnected &&
    moving.ownerDocument === target.ownerDocument
  ) {
    try {
      parent.moveBefore(moving, null);
      return "moved-in-place";
    } catch {
      // Fall through to appendChild.
    }
  }
  target.appendChild(moving);
  return "appended";
}
