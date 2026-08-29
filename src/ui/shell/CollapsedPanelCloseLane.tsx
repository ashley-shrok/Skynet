// ─── CollapsedPanelCloseLane.tsx ────────────────────────────────────────────
// Quick task 260829-ih3 — proxy close-target lane that stands in for the
// PrettyConversationsPanel during a badge drag when the sidebar is closed
// on desktop. Implements the surface described in
// `.planning/shapes/shape-drop-lane-close-in-split-view.md`.
//
// Grammar & philosophy (Ashley, 2026-08-29):
//   - Coral is reserved for "you are hovering a valid drop target right now."
//     The lane appears NEUTRAL (bg pv-base, right-edge quiet-strong border)
//     at rest and only switches to coral when the cursor enters it during a
//     badge drag. A baseline-coral lane would mislead the eye into thinking
//     the drag was already at its destination — this rule is enforced by
//     Test B (neutral baseline) and Test C (coral only on badge dragover) in
//     the colocated test file.
//   - The lane is a PROXY for the panel, not a peek of it. It has a single
//     purpose: drop a badge here to close its tab. It never accepts row
//     drags (Test D asserts row drags never activate hover).
//
// Palette values (byte-for-byte match with SplitView.tsx:463-464 and
// AppShell.tsx:2482-2483):
//   - hover fill:   rgba(255, 184, 150, 0.22)
//   - hover border: rgba(255, 184, 150, 0.60)
//   - baseline:     var(--color-pv-base) + var(--color-pv-border-quiet-strong)
//
// Native DOM drag listeners — NOT React synthetic (patch #514 lesson).
// React portal boundaries + synthetic drag events don't co-bubble reliably;
// SplitView.tsx:258-395 is the canonical shape mirrored here. Listeners are
// attached in a useEffect on a ref to the outer wrapper; the effect's deps
// list `[openTabIds, onCloseTab]` reattaches when either changes so the
// closure over the drop handler sees fresh values. `draggedBadgeTabId` is
// intentionally NOT in the deps — the handler body doesn't read it; the
// parent mount gate handles show/hide by unmounting on null.
//
// The `isolation: isolate` on the outer wrapper is load-bearing (mirrors the
// quick-260829-fh3 fix at SplitView.tsx:417). It sandboxes the coral hover
// state's z-index budget so it can't escape past the AppShell layer gates
// — same rationale that put `isolate` on the SplitView Pane wrapper.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface CollapsedPanelCloseLaneProps {
  /**
   * The tabId currently being dragged as an identity badge. `null` means no
   * badge drag is in progress — the lane renders nothing in that case.
   *
   * Sourced from the `useDraggedBadgeTabId` hook exported below, which
   * listens to window `dragstart` / `dragend` and extracts the tabId from
   * the badge MIME payload.
   */
  draggedBadgeTabId: string | null;
  /**
   * The set of currently-open tabIds. Used as the security-guard source for
   * the drop ladder — a badge payload whose tabId is NOT in this set is
   * silently dropped (T-260829-ih3-01 mitigation; mirrors
   * PrettyConversationsPanel.tsx:1403).
   */
  openTabIds: string[];
  /**
   * Close callback fired on a successful drop. Wired at the AppShell mount
   * site to `closeTab` — the same routine wired for
   * PrettyConversationsPanel's `onCloseSession` at AppShell.tsx:1913.
   */
  onCloseTab: (tabId: string) => void;
}

/**
 * `CollapsedPanelCloseLane` — a ~115px vertical lane pinned to the left edge
 * of its containing block. Renders `null` outside a badge drag.
 *
 * The parent AppShell handles the mount gate (`!isMobile && !isMobileListScreen
 * && !sidebarOpen`); this component's own gate is `draggedBadgeTabId === null`.
 */
/**
 * `shouldMountCloseLane` — pure predicate for the AppShell mount gate.
 * Extracted from AppShell so the gate is unit-testable without mounting
 * the full AppShell (quick-260829-ih3 code-review finding #3).
 *
 * The lane MUST NOT render when ANY of the following is true:
 *   - viewport is mobile (`isMobile`) — split view doesn't exist on mobile
 *   - user is on the mobile list screen (`isMobileListScreen`) — sidebar
 *     occupies the whole viewport, no split, no lane
 *   - conv-list panel is already open (`sidebarOpen`) — actual panel is
 *     already the drop target; no proxy needed
 */
export function shouldMountCloseLane(args: {
  isMobile: boolean;
  isMobileListScreen: boolean;
  sidebarOpen: boolean;
}): boolean {
  return !args.isMobile && !args.isMobileListScreen && !args.sidebarOpen;
}

export default function CollapsedPanelCloseLane({
  draggedBadgeTabId,
  openTabIds,
  onCloseTab,
}: CollapsedPanelCloseLaneProps): JSX.Element | null {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);

  // quick-260829-ih3 code-review finding #1 (listener churn): the effect
  // that attaches native drag listeners MUST NOT re-run on every AppShell
  // render — that would tear down + re-attach all four listeners between
  // any two frames, wasting work AND opening a tiny window where an
  // in-flight dragover/drop could be missed. Route props through refs so
  // handlers read the LATEST values without the main effect depending on
  // prop identities. The main drag-listener effect can then use `[]` deps
  // and attach exactly once on mount / detach once on unmount.
  //
  // Same closure-freshness guarantee as re-running the effect on every
  // render, but achieved via ref-read inside the stable handler rather
  // than by tearing the handler down.
  const openTabIdsRef = useRef(openTabIds);
  const onCloseTabRef = useRef(onCloseTab);
  useEffect(() => {
    openTabIdsRef.current = openTabIds;
  }, [openTabIds]);
  useEffect(() => {
    onCloseTabRef.current = onCloseTab;
  }, [onCloseTab]);

  useEffect(() => {
    const el = outerRef.current;
    if (el === null) return;

    const onDragOver = (e: DragEvent) => {
      // Type-gate FIRST — only badge drags get the drop-target treatment.
      // Row drags (text/plain only) and OS file drags fall through without
      // preventDefault so the browser's default not-a-drop-target semantic
      // is preserved (T-260829-ih3-04). Test D asserts this path.
      if (!e.dataTransfer?.types.includes("application/x-skynet-badge")) return;
      e.preventDefault();
      // Prevent AppShell's outer container onDragOver (at :2293) from also
      // handling — same defense pattern as SplitView.tsx:264. The lane owns
      // this cursor position; nothing else should react to it.
      e.stopPropagation();
      setHover(true);
    };

    const onDragLeave = (e: DragEvent) => {
      // Type-gate FIRST (mirror SplitView.tsx:292). Unrelated dragleaves
      // (row drags, OS file drags) never clear hover state — they never
      // set it in the first place per the dragover gate above.
      if (!e.dataTransfer?.types.includes("application/x-skynet-badge")) return;
      const rect = el.getBoundingClientRect();
      // Bounding-rect stateless guard (mirror SplitView.tsx:301-305). Robust
      // against child-boundary crossings — a dragleave fired when the cursor
      // crosses onto the `X` glyph child MUST NOT clear hover state. jsdom's
      // DragEvent init drops clientX/Y, so tests must dispatch via
      // Object.defineProperty (see the test file's dispatchNativeDragLeaveAt).
      const stillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (stillInside) return;
      setHover(false);
    };

    const onDrop = (e: DragEvent) => {
      // Clear hover FIRST (mirror SplitView.tsx:323-324 + PrettyConversationsPanel
      // .tsx:1373 defensive-clear). Idempotent — even a non-badge drop that
      // somehow reached this handler still clears state.
      setHover(false);
      // Step 1: read the discriminator MIME. Empty string = not a badge drop.
      const raw = e.dataTransfer?.getData("application/x-skynet-badge") ?? "";
      if (raw === "") return;
      // Step 2: parse JSON safely (T-260829-ih3-02 mitigation).
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      // Step 3: extract + validate tabId shape.
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof (parsed as { tabId?: unknown }).tabId !== "string" ||
        (parsed as { tabId: string }).tabId === ""
      ) {
        return;
      }
      const tabId = (parsed as { tabId: string }).tabId;
      // Step 4: validate against openTabIds (T-260829-ih3-01 mitigation).
      // Silent drop on miss — mirrors PrettyConversationsPanel.tsx:1403.
      // Ref-read so the check sees the LATEST openTabIds even though the
      // main effect deps are `[]` (quick-260829-ih3 code-review finding #1).
      if (!openTabIdsRef.current.includes(tabId)) return;
      // Step 5: signal the drop is handled — prevents default browser
      // behavior AND prevents AppShell outer container from also handling.
      e.preventDefault();
      e.stopPropagation();
      // Step 6: structured log (T-260829-ih3-03 mitigation). Single explicit-
      // field extraction — no JSON.stringify(event). Emitted ONLY on the
      // successful-close branch (after openTabIds validation) — matches
      // PrettyConversationsPanel.tsx:1409 discipline exactly.
      // eslint-disable-next-line no-console
      console.info(`[collapsed-lane-drop] close tabId=${tabId}`);
      // Step 7: fire the callback. Ref-read so the call reaches the LATEST
      // onCloseTab even though the main effect deps are `[]`.
      onCloseTabRef.current(tabId);
    };

    // Window-level dragend cleanup — Escape cancels a drag WITHOUT moving
    // the cursor, so no dragleave fires; dragend on the source (IdentityBadge)
    // is the only reliable signal. Window-level attach because dragend fires
    // on the SOURCE element (IdentityBadge), not on this lane. Idempotent —
    // setState(false) on already-false is a no-op. Mirrors SplitView.tsx:378-381
    // + PrettyConversationsPanel.tsx:1311-1322.
    const onDragEnd = () => {
      setHover(false);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Own gate: nothing to render outside a badge drag. The parent AppShell
  // mount gate handles the isMobile/isMobileListScreen/sidebarOpen exclusion;
  // this internal gate handles the "no drag in progress" case.
  if (draggedBadgeTabId === null) return null;

  // Baseline (hover=false) → NEUTRAL palette matching the panel it stands in
  // for. Hover (dragover of the badge MIME) → coral, matching every other
  // drop target's hover semantic in the app. See file header for the grammar
  // rule that prohibits baseline-coral.
  const style: React.CSSProperties = hover
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 115,
        zIndex: 30,
        // Stacking-context sandbox — see file header + isolation-context
        // discussion. Mirrors the quick-260829-fh3 pattern at
        // SplitView.tsx:417.
        isolation: "isolate",
        // Coral hover palette — byte-for-byte match with SplitView.tsx:463-464.
        background: "rgba(255, 184, 150, 0.22)",
        border: "2px solid rgba(255, 184, 150, 0.60)",
        transition: "transform 150ms ease",
        transform: "translateX(0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-pv-fg)",
      }
    : {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 115,
        zIndex: 30,
        isolation: "isolate",
        // Neutral baseline — the chrome the panel would have occupied.
        background: "var(--color-pv-base)",
        borderRight: "1px solid var(--color-pv-border-quiet-strong)",
        transition: "transform 150ms ease",
        transform: "translateX(0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-pv-fg)",
      };

  return (
    <div
      ref={outerRef}
      data-testid="collapsed-panel-close-lane"
      data-hover={hover ? "true" : "false"}
      style={style}
      aria-label="Drop badge here to close the session"
    >
      <X size={28} aria-hidden="true" />
    </div>
  );
}

/**
 * `useDraggedBadgeTabId` — window-scoped hook that returns the tabId of the
 * currently-in-flight identity badge drag, or `null` if none is in flight.
 *
 * Reads the badge payload IdentityBadge writes at dragstart:
 *   dataTransfer.setData("application/x-skynet-badge", JSON.stringify({tabId}))
 * (see src/ui/features/terminal/IdentityBadge.tsx:163-167).
 *
 * Row drags (which write only text/plain, NOT the badge MIME) MUST NOT
 * setState — Test J.2 asserts this. The whole point of the hook is to
 * signal "a badge is being dragged", not "any drag is happening."
 */
export function useDraggedBadgeTabId(): string | null {
  const [tabId, setTabId] = useState<string | null>(null);

  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      // Type-gate: only badge drags update state. Row drags and OS file
      // drags MUST leave the hook returning null.
      if (!e.dataTransfer?.types.includes("application/x-skynet-badge")) return;
      const raw = e.dataTransfer.getData("application/x-skynet-badge") ?? "";
      if (raw === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof (parsed as { tabId?: unknown }).tabId !== "string" ||
        (parsed as { tabId: string }).tabId === ""
      ) {
        return;
      }
      setTabId((parsed as { tabId: string }).tabId);
    };

    const onDragEnd = () => {
      // Unconditional clear — dragend fires whether the drag ended via drop,
      // drop-elsewhere, or Escape-cancel. Idempotent.
      setTabId(null);
    };

    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  return tabId;
}
