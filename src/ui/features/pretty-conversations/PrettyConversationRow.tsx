// ─── PrettyConversationRow ───────────────────────────────────────────────────
// Phase 13 Plan 01 (Ashley 2026-07-23 lift-from-mock v4): the row renders the
// mock's semantic markup with class-toggle state variants. Every visual
// definition (base body, avatar disc, ambient recession, selected treatment,
// hover, RDP, ready-dot) lives in pretty-conversations.css. This component
// keeps only the surviving JS-only concerns:
//
//   - Ready-dot conditional render
//     (`inActiveSet && isWorking === false && !isRecycling && !hasQueuePending`)
//     — JS-gated so the DOM never contains a ready-dot span when isWorking is
//     null or true (preserves the test expectations for Tests 15/16/17), when
//     the SessionHoldingOverlay is up (quick-260730-qbl), OR when the row's
//     ComposeBox has an armed idle-send queue (quick-260802-w9e — closes the
//     pinned bounty `hide-idle-dot-when-queued-message-waiting-to-send`).
//     The CSS `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot
//     { display: block }` provides a secondary gate for the isWorking +
//     isRecycling axes only; the queue-pending gate lives ONLY in JS
//     because it isn't surfaced as a row className.
//   - Avatar image src selection (identity.avatarUrl vs initial letter vs
//     tabIcon fallback).
//   - Click / keyboard / touch handlers, aria-labels, `--pv-hue` custom
//     property emission for hue-bearing rows.
//   - Mobile long-press → context menu (quick-260802-pq2): a 500ms touch
//     hold with <10px movement opens the SAME PrettyConversationContextMenu
//     desktop right-click uses, at the touch coordinates. Replaces the
//     retired swipe-to-reveal action strip (which had a bleed-through class
//     of bug through translucent ambient/hidden row backgrounds — bounty
//     `swipe-actions-visible-through-translucent-rows`). Nothing painted
//     behind rows = no bleed-through, ever.
//
// State variants are className toggles composed via `cn`:
//   className={cn('pv-row', variantClass, selected && 'selected',
//     inActiveSet && 'active-set', isWorking === true && 'working',
//     pinned && 'pinned', isAmbient && 'ambient', isRdp && 'rdp')}
//
// The ONE inline style on `.pv-row` is `{'--pv-hue': hue}` for hue-bearing
// rows. Post-pq2 mobile has no transform (no swipe machinery) — the row body
// is a static CSS-rendered card in both variants.
//
// Retired vs pre-Phase-13:
//   - All JS-computed CSSProperties for base body / avatar / ambient /
//     selected / hover overlays (~250 lines) — now in
//     pretty-conversations.css as class-toggled selectors.
//   - `useState(hover)` + onMouseEnter/onMouseLeave handlers — CSS `:hover`
//     handles hover natively.
//   - `PC_ROW_MIN_H_MOBILE/DESKTOP` tokens — CSS variants (`.pv-row--mobile`
//     vs `.pv-row--desktop`) handle density.
//   - Tailwind layout scaffolding (`flex-1 min-w-0 flex flex-col gap-0.5`,
//     `shrink-0 flex items-center gap-1.5`, `rounded-full`, `w-12 h-12` /
//     `w-10 h-10`, `px-4 py-3` / `px-3 py-2.5`, `gap-3` / `gap-2.5`) on the
//     row/avatar/body/meta divs — CSS handles layout via `display: flex`,
//     `flex: 1`, `padding`, etc.
//   - quick-260802-pq2: swipe state machine (swipedOpen / dxLive / start refs /
//     onTouchStart / onTouchMove / onTouchEnd), swipe-reveal strip JSX,
//     PinAction / DeactivateAction / HideAction imports (only rendered inside
//     the retired strip), PC_SWIPE_* tokens, forceClosed / onSwipeOpenChange
//     props, data-swiped-open attribute.
//
// Identity carry-through mirrors ConversationRow.tsx lines 41-47 verbatim so
// identity-tinted rows keep the same "which session is this" reading after
// the sidebar is retired.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { Pin, Server } from "lucide-react";

import { tabIcon } from "@/shell/tabUtils";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
import { useBountyCounts } from "@/state/bounty-counts-store";
import { cn } from "@/lib/utils";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import { specForTab, encodeWorkspaceSpec } from "@/lib/tab-url";

import { PrettyBountyCountBadge } from "./PrettyBountyCountBadge";
import {
  PrettyConversationContextMenu,
  type PrettyContextMenuItem,
} from "./PrettyConversationContextMenu";

// ─── Context-menu singleton (quick-260809-94y) ───────────────────────────────
// Only one row's context menu may be open at a time across the list. The
// module-scoped `currentClose` ref tracks the most recently opened row's
// close-fn. Both open sites (desktop right-click + mobile long-press timer)
// call `notifyMenuOpened(closeSelf)` BEFORE `setCtxMenu({...})`. The wrapped
// `onClose` prop on `<PrettyConversationContextMenu>` calls `notifyMenuClosed`
// so the singleton is cleared when the menu closes normally. Unmount cleanup
// also calls `notifyMenuClosed` (idempotent — safe if menu is already closed).
//
// Re-entry guard: `currentClose` is nulled BEFORE calling `prev()` so that
// `prev`'s own `onClose` wrapper (which calls `notifyMenuClosed(prev)`) finds
// `currentClose === null` and no-ops, preventing a clobber of the newly
// registered `closeFn`.
let currentClose: (() => void) | null = null;

export function notifyMenuOpened(closeFn: () => void): void {
  if (currentClose && currentClose !== closeFn) {
    const prev = currentClose;
    currentClose = null; // prevent re-entry: prev's onClose should not re-register
    prev();
  }
  currentClose = closeFn;
}

export function notifyMenuClosed(closeFn: () => void): void {
  if (currentClose === closeFn) currentClose = null;
}

// ─── Prop shape ──────────────────────────────────────────────────────────────
// `variant` drives the density class (`pv-row--mobile` vs `pv-row--desktop`)
// AND the long-press wiring gate (mobile-only). Desktop rows never arm the
// long-press timer.
//
// quick-260802-pq2: the swipe machinery (forceClosed / onSwipeOpenChange
// props, PC_SWIPE_* tokens, swipedOpen state, transform emission,
// reveal-strip JSX) was fully removed. The mobile row exposes the same
// context menu desktop right-click uses via a 500ms long-press touch hold.
export function PrettyConversationRow({
  row,
  selected,
  pinned,
  hidden = false,
  variant,
  onSelect,
  onTogglePin,
  onDeactivate,
  onToggleHide,
  onClone,
  isWorking = null,
  isRecycling = false,
  hasQueuePending = false,
  inActiveSet = false,
  subtitleMode = "hostname",
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  // quick-260731-tgg: whether this row is currently in Ashley's hidden set.
  // Drives the context menu Hide/Show label. (Pre-pq2 also drove the swipe
  // strip placement; strip is gone.)
  hidden?: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  // quick-260727-gm3: fired when Ashley clicks the red-tinted Deactivate
  // menu item (desktop right-click OR mobile long-press). MUST be provided by
  // the panel whenever inActiveSet === true — otherwise the menu item is
  // filtered out at items[] build time. See
  // PrettyConversationsPanel.handleRowDeactivate for the store-mutation +
  // tab-close composition. As of quick-260804-uo4, RDP rows also receive this
  // prop (RDP context menu is now enabled).
  onDeactivate?: () => void;
  // quick-260731-tgg: fired when Ashley clicks Hide (EyeOff) or Show (Eye).
  // When provided, the Hide/Show item appears in the context menu between
  // Pin/Unpin and Deactivate. RDP rows never receive this prop.
  onToggleHide?: () => void;
  // Phase 22 (SRIC-03): fired when Ashley clicks the Clone context menu
  // item. Provided by PrettyConversationsPanel when the row has an identity
  // AND row.host !== null. Undefined otherwise (RDP rows never get it —
  // onRowContextMenu is not wired for isRdp). See
  // PrettyConversationsPanel.handleRowClone for the source-identity + hostId
  // capture that opens CloneAgentDialog.
  onClone?: () => void;
  // Patch #137: WS-published working state for the row's (host, tmux)
  // pair. `true` = agent busy, `false` = idle, `null` = unknown
  // (backend hasn't published yet). Only `false` allows the ready-dot
  // to render; `null` and `true` both suppress. Panel resolves via
  // useSessionWorking(sessionWorkingKey(row)).
  isWorking?: boolean | null;
  // quick-260730-qbl: true when the row's pretty-view surface is currently
  // rendering SessionHoldingOverlay (patch #74). Suppresses the ready-dot
  // regardless of other conditions — a row whose pane is showing the
  // "session recycling…" overlay is NOT ready for Ashley's next
  // instruction, so showing the ready-dot would be a false-positive
  // signal. Panel resolves via useSessionRecycling(sessionWorkingKey(row))
  // — both stores are keyed identically (`${hostId}:${tmuxSession ?? ""}`).
  isRecycling?: boolean;
  // quick-260802-w9e: true when this row's ComposeBox has at least one
  // message armed to auto-send on the next agent-idle window (Vehicle C v2
  // per-source FIFO at ComposeBox.tsx:358). Suppresses the ready-dot as the
  // fourth predicate gate — if a queued message is armed to auto-send the
  // moment the agent goes idle, the agent is effectively already spoken-for
  // and NOT ready for Ashley's next instruction (which IS the meaning of
  // the dot). Panel resolves via useSessionQueuePending(sessionWorkingKey(row))
  // — all three stores (working / recycling / queue-pending) share the
  // exact same `${hostId}:${tmuxSession ?? ""}` key shape.
  hasQueuePending?: boolean;
  // Patch #137: whether this row is in Ashley's active-set (any
  // session she has selectConversation-ed in this browser-tab
  // session). Rows in the set keep the full-bubble treatment; rows
  // out of the set recede to the ambient values (per prototype v4).
  // RDP rows are exempt from ambient recession regardless of this flag.
  inActiveSet?: boolean;
  // quick-260727-f9v: sublabel render mode.
  //   "hostname"      → default; sublabel renders hostname + Server icon
  //                     (verbatim pre-f9v behavior, backward-compatible).
  //   "identityTitle" → sublabel renders identity.title (falling back to
  //                     identity.displayName when title is null), and the
  //                     Server icon is DROPPED (the per-host divider chip
  //                     rendered by the panel above the group already
  //                     carries the Server glyph, so duplicating it here
  //                     would be noisy). If no identity resolves, the
  //                     row falls back verbatim to "hostname" mode as a
  //                     terminal safety net — see the render block below
  //                     and Tina's patch #149 lesson in the plan.
  //
  // RDP render site omits the prop → default "hostname" (RDP rows don't
  // resolve identities). Pinned + grouped + active-set render sites all
  // pass "identityTitle" (patch #184 for pinned, quick-260727-f9v for
  // grouped, patch #195 for active-set — closes the last scope gap).
  subtitleMode?: "hostname" | "identityTitle";
}) {
  // ─── Identity resolution ───────────────────────────────────────────────────
  // Same shape as ConversationRow.tsx lines 41-47 (production baseline).
  const { byKey: identitiesByKey } = useIdentities();
  const key = sessionMatchKey(row.targetTmuxSession);
  const identity = key ? (identitiesByKey.get(key) ?? null) : null;
  const hue: number | null = identity?.colorHue ?? null;
  const isRdp = row.rdpHostRow === true;

  // Phase 26 Plan 03: per-row bounty counts pair for the .pv-meta badge.
  // useBountyCounts(null, ...) short-circuits to undefined (identityKey null
  // means no identity resolved — no subscription cost for non-identity rows).
  // Host.id is a string in the fork's ui-types; we convert with parseInt
  // (same shape AppShell uses at openTab hostId derivation). Result is
  // undefined until the panel's poller lands a refresh; the badge component
  // renders null for undefined pair OR both-zero (Key design decision #7).
  // The pair is always published atomically — both halves land together.
  const rowHostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
  const bountyCounts = useBountyCounts(
    identity?.identityKey ?? null,
    Number.isFinite(rowHostIdNum) ? rowHostIdNum : null,
  );

  // Patch #137 / Phase 13: ambient recession applies to non-RDP rows NOT in
  // Ashley's active-set. The `.ambient` class on the row triggers the CSS
  // recession block; RDP rows are exempt regardless of inActiveSet.
  const isAmbient = !isRdp && !inActiveSet;

  const isMobile = variant === "mobile";
  const variantClass = isMobile ? "pv-row--mobile" : "pv-row--desktop";

  // ─── Context menu state (desktop right-click AND mobile long-press) ───────
  // Coords are the pointer position at open time; null = menu closed. Shared
  // state between the two entry points so both flow through the SAME
  // PrettyConversationContextMenu portal render (single items[] builder
  // below).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const closeSelf = useCallback(() => setCtxMenu(null), []);
  const onRowContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // quick-260804-uo4: RDP rows now open the context menu — the row-level
      // isRdp guard on this handler was dropped. Non-active-set rows only have
      // Pin + Open-in-new-window (Deactivate is filtered out below by the
      // items[] predicate).
      e.preventDefault();
      e.stopPropagation();
      notifyMenuOpened(closeSelf);
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [closeSelf],
  );

  // ─── Mobile long-press → context menu (quick-260802-pq2) ──────────────────
  // Wire only on mobile variant (mobile-only). Desktop variant rows get zero
  // touch listeners at the render tree level (see JSX prop wiring below —
  // the four onTouch* props are `undefined` for desktop). As of
  // quick-260804-uo4, RDP rows also receive mobile touch handlers so
  // long-press opens the same context menu on RDP rows.
  //
  // Contract:
  //   - touchStart arms a 500ms timer capturing (clientX, clientY).
  //   - If touchEnd fires before 500ms → no menu, no side effects, standard
  //     click path continues (short-tap → onSelect via onBodyClick).
  //   - touchMove checks Math.hypot(dx, dy) against 10px. Exceed → cancel the
  //     pending timer (movement wins → vertical scroll takes over).
  //   - If the 500ms timer fires without cancellation:
  //       * setCtxMenu({ x: startClientX, y: startClientY })
  //       * navigator.vibrate?.(10) (feature-checked — must NOT throw when
  //         the API is missing, e.g. iOS Safari; delete-then-restore pattern
  //         in TL5 tests locks this contract).
  //       * suppressNextClickRef ← true so the synthesized click that follows
  //         the long-press does NOT also fire onSelect on the row body.
  //   - useEffect cleanup on unmount clears any pending timer to avoid a
  //     late setState / setCtxMenu on an unmounted component.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // ─── Mobile swipe-to-act state machine (quick-260808-fkg) ─────────────────
  // Adds a horizontal swipe-to-ACT gesture layer alongside the long-press →
  // context-menu layer above. Both machines share the SAME onTouchStart/Move/
  // End/Cancel handlers on the row body (see JSX prop wiring below) — they
  // coexist by cancelling each other on their own movement gates.
  //
  // Retirement history: the earlier swipe-to-REVEAL machinery (retired in
  // quick-260802-pq2) rendered PinAction / DeactivateAction / HideAction
  // inside a strip painted BEHIND the translucent row body. Ambient / hidden
  // rows have low-alpha backgrounds, so the strip's action glyphs bled
  // visually through the row surface (bounty
  // `swipe-actions-visible-through-translucent-rows`). This machine takes a
  // different shape entirely: swipe-to-ACT, not swipe-to-reveal. When the
  // threshold is crossed, the composite fires IMMEDIATELY and the row snaps
  // back — nothing is ever painted behind the row, no persistent action strip
  // exists, and no PinAction/DeactivateAction imports are re-added here.
  //
  // Six locked design decisions:
  //
  //   1. THRESHOLD: Math.max(90, rowWidth * 0.35). 35% of the row width for
  //      typical mobile column widths (~360-420px → ~126-147px), floored at
  //      90px so unusually narrow rows still require a real deliberate drag.
  //      rowWidth is measured once per gesture via
  //      body.getBoundingClientRect().width inside touchStart (width does not
  //      change mid-drag). Constants inlined per the tokens.ts naming rule
  //      (single call site → no PC_SWIPE_* token).
  //
  //   2. VERTICAL-vs-HORIZONTAL DISAMBIGUATION: on the FIRST touchmove that
  //      exceeds the 8px |dx| gate, evaluate |dx| >= 8 && |dx| > |dy|. If
  //      both true → arm the swipe (armedRef = true) AND clear the long-
  //      press timer so the two paths don't double-fire. If NOT both true →
  //      set disarmedRef = true and NEVER arm the swipe for the rest of this
  //      touch sequence (vertical scroll wins forever for this touch). If
  //      already armed OR already disarmed on subsequent touchmoves, skip the
  //      gate.
  //
  //   3. VISUAL FEEDBACK DURING DRAG: while armed, translate the row body via
  //      transform: translateX(dx * 0.6) capped at ±rowWidth. The 0.6 factor
  //      matches iOS native swipe-to-delete's viscous / resistive feel. At-or-
  //      past threshold, add a `swipe-past-threshold-right` OR `swipe-past-
  //      threshold-left` class to the row body — CSS paints a hue-tinted glow
  //      (right) or muted-cream glow (left) via box-shadow INSET, INSIDE the
  //      row body. NO element painted behind the row. NO persistent strip.
  //
  //   4. CANCELLATION UX: on touchEnd, if |dx| < threshold OR swipe was never
  //      armed, snap back with `transition: transform 180ms cubic-bezier
  //      (.2,.9,.3,1)` applied inline (only during snap-back — not during
  //      drag, which would fight the raw translate). isSnappingRef guards
  //      new touchStart from arming during the 200ms snap-back window. Same
  //      180ms transition applies AFTER a threshold-cross fires — snap-back +
  //      composite fire in the same touchEnd branch.
  //
  //   5. IDEMPOTENCY: after threshold-cross, check wouldChangeState:
  //        - swipe-right (dx > 0): !pinned || !inActiveSet
  //        - swipe-left  (dx < 0): pinned  ||  inActiveSet
  //      If FALSE → snap back silently, fire NO callbacks, NO vibrate.
  //      If TRUE → fire the composite AND navigator.vibrate?.(10) (same
  //      feature-check pattern as the long-press above) AND snap back.
  //
  //   6. TAP-vs-SWIPE DISAMBIGUATION: touchEnd where armedRef stayed false
  //      leaves the existing tap path 100% intact — onClick continues to
  //      fire onSelect via onBodyClick. When the swipe DID arm and fire a
  //      composite, the trailing synthesized click (real browsers; jsdom
  //      does not synthesize) is suppressed via the SHARED
  //      suppressNextClickRef the long-press already uses.
  //
  // Composite action semantics:
  //   - Swipe-RIGHT = "make it pinned AND active":
  //       if (!pinned)      props.onTogglePin();
  //       if (!inActiveSet) props.onSelect();
  //     Order: onTogglePin FIRST so pinned state lands before onSelect
  //     triggers any re-render that would depend on it.
  //   - Swipe-LEFT = "remove pin AND deactivate":
  //       if (pinned)      props.onTogglePin();
  //       if (inActiveSet) props.onDeactivate?.();
  //     Optional-chained onDeactivate mirrors the menu-side pattern where
  //     the Deactivate menuitem is filtered out when onDeactivate is
  //     undefined (RDP had this shape pre-uo4).
  //
  // RDP EXEMPTION: every swipe touch handler early-returns if isRdp === true.
  // Mirrors the panel-level rdpNoopTogglePin exemption at
  // PrettyConversationsPanel.tsx:1050. RDP rows still get the long-press →
  // context menu path (per quick-260804-uo4).
  //
  // NON-RDP MOBILE-ONLY GATE: the swipe handlers early-return on !isMobile
  // (same gate the long-press already uses).
  const swipeStartRef = useRef<{ x: number; y: number; rowWidth: number } | null>(
    null,
  );
  const armedRef = useRef<boolean>(false);
  const disarmedRef = useRef<boolean>(false);
  const isSnappingRef = useRef<boolean>(false);
  const snapTimerRef = useRef<number | null>(null);
  const [dxLive, setDxLive] = useState<number | null>(null);

  const clearSnapTimer = useCallback(() => {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = null;
    }
  }, []);

  const resetSwipeGesture = useCallback(() => {
    swipeStartRef.current = null;
    armedRef.current = false;
    disarmedRef.current = false;
    setDxLive(null);
  }, []);

  const beginSnapBack = useCallback(() => {
    // Enter the 200ms snap-back window: keep dxLive at 0 with the transition
    // applied so the row springs back to origin. New touchStart during this
    // window is gated via isSnappingRef so a rapid double-swipe cannot re-
    // arm the machine mid-snap.
    isSnappingRef.current = true;
    setDxLive(0);
    clearSnapTimer();
    snapTimerRef.current = window.setTimeout(() => {
      isSnappingRef.current = false;
      snapTimerRef.current = null;
      setDxLive(null);
    }, 200);
  }, [clearSnapTimer]);

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (!isMobile) return;
      const t = e.touches[0];
      if (!t) return;
      const x = t.clientX;
      const y = t.clientY;

      // ── long-press arm ────────────────────────────────────────────────
      longPressStartRef.current = { x, y };
      // Clear any stale timer (defensive — should be null already after prior
      // touchEnd/Cancel; belt-and-suspenders).
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        notifyMenuOpened(closeSelf);
        setCtxMenu({ x, y });
        // Feature-checked haptic — many browsers (esp. iOS Safari) do NOT
        // implement navigator.vibrate. `?.` guards the call.
        navigator.vibrate?.(10);
        suppressNextClickRef.current = true;
        longPressTimerRef.current = null;
      }, 500);

      // ── swipe arm ─────────────────────────────────────────────────────
      // RDP rows: no swipe machinery (long-press path above still fires).
      if (isRdp) return;
      // Guard against arming during the snap-back window.
      if (isSnappingRef.current) return;
      const rowWidth = (e.currentTarget as HTMLDivElement)
        .getBoundingClientRect()
        .width;
      swipeStartRef.current = { x, y, rowWidth };
      armedRef.current = false;
      disarmedRef.current = false;
    },
    [isMobile, isRdp, clearLongPressTimer, closeSelf],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (!isMobile) return;
      const t = e.touches[0];
      if (!t) return;

      // ── long-press movement cancellation ──────────────────────────────
      if (longPressTimerRef.current !== null && longPressStartRef.current !== null) {
        const lpDx = t.clientX - longPressStartRef.current.x;
        const lpDy = t.clientY - longPressStartRef.current.y;
        if (Math.hypot(lpDx, lpDy) > 10) {
          // Movement wins over long-press — cancel the pending timer so
          // vertical scroll / swipe fling can proceed uninterrupted.
          clearLongPressTimer();
          longPressStartRef.current = null;
        }
      }

      // ── swipe machine ─────────────────────────────────────────────────
      if (isRdp) return;
      if (swipeStartRef.current === null) return;
      const dx = t.clientX - swipeStartRef.current.x;
      const dy = t.clientY - swipeStartRef.current.y;

      // Disarmed for this touch sequence → vertical scroll wins forever.
      if (disarmedRef.current) return;

      if (!armedRef.current) {
        // Vertical-vs-horizontal disambiguation gate. Wait until we have at
        // least 8px of movement on either axis before deciding.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)) {
          // Arm the swipe. Clear the long-press timer so the two paths
          // don't both fire on this touch sequence.
          armedRef.current = true;
          clearLongPressTimer();
          longPressStartRef.current = null;
        } else {
          // Vertical wins — disarm the swipe for the rest of this touch.
          disarmedRef.current = true;
          return;
        }
      }

      // Armed → translate the row (viscous 0.6 factor, capped at ±rowWidth).
      const rowWidth = swipeStartRef.current.rowWidth;
      const cap = rowWidth > 0 ? rowWidth : Number.POSITIVE_INFINITY;
      const dragged = Math.max(-cap, Math.min(cap, dx * 0.6));
      setDxLive(dragged);
    },
    [isMobile, isRdp, clearLongPressTimer],
  );

  const onTouchEnd = useCallback(() => {
    if (!isMobile) return;
    // ── long-press drain ────────────────────────────────────────────────
    // Clear any pending timer (early touchEnd → no menu).
    clearLongPressTimer();
    longPressStartRef.current = null;
    // Deliberately DO NOT touch suppressNextClickRef here — the following
    // click event needs to read it to suppress the trailing tap after a
    // successful long-press.

    // ── swipe drain ─────────────────────────────────────────────────────
    if (isRdp) {
      resetSwipeGesture();
      return;
    }
    const start = swipeStartRef.current;
    if (start === null) {
      resetSwipeGesture();
      return;
    }
    if (!armedRef.current) {
      // Never armed → nothing to fire, nothing to snap. Tap path handles it.
      resetSwipeGesture();
      return;
    }

    // Use the last translated dx (dxLive / 0.6) as the "user-visible"
    // horizontal offset. Compare against the same threshold shape as the
    // arming gate: max(90, rowWidth * 0.35). Threshold is measured against
    // the RAW pointer dx (dxLive is already scaled by 0.6, so undo the
    // scale) so users don't need to drag ~1.67× further than the visual
    // affordance suggests.
    const rowWidth = start.rowWidth;
    const threshold = Math.max(90, rowWidth * 0.35);
    const scaled = dxLive ?? 0;
    const rawDx = scaled / 0.6;

    if (Math.abs(rawDx) < threshold) {
      // Below threshold → snap back only.
      swipeStartRef.current = null;
      armedRef.current = false;
      disarmedRef.current = false;
      beginSnapBack();
      return;
    }

    // Past threshold → evaluate wouldChangeState per direction.
    const isRight = rawDx > 0;
    const wouldChange = isRight
      ? (!pinned || !inActiveSet)
      : (pinned || inActiveSet);

    swipeStartRef.current = null;
    armedRef.current = false;
    disarmedRef.current = false;

    if (!wouldChange) {
      // Silent no-op — snap back with no callbacks + no vibrate. Bounce
      // would falsely imply action fired.
      beginSnapBack();
      return;
    }

    // Fire the composite. Order: onTogglePin FIRST so pinned state lands
    // before onSelect / onDeactivate trigger any re-render that depends on
    // it (matches menu-side flow).
    if (isRight) {
      if (!pinned) onTogglePin();
      if (!inActiveSet) onSelect();
    } else {
      if (pinned) onTogglePin();
      if (inActiveSet) onDeactivate?.();
    }
    // Feature-checked haptic (same pattern as long-press).
    navigator.vibrate?.(10);
    // Suppress the trailing synthesized click so the composite doesn't
    // also fire onSelect via the tap path (jsdom doesn't synthesize; this
    // matters in real browsers).
    suppressNextClickRef.current = true;
    beginSnapBack();
  }, [
    isMobile,
    isRdp,
    clearLongPressTimer,
    resetSwipeGesture,
    beginSnapBack,
    dxLive,
    pinned,
    inActiveSet,
    onTogglePin,
    onSelect,
    onDeactivate,
  ]);

  // Cleanup on unmount so a pending timer doesn't fire against an unmounted
  // component (setState on unmounted → React warning + potential dangling
  // navigator.vibrate call). quick-260808-fkg extends the cleanup to also
  // drain the swipe snap-back timer. quick-260809-94y extends the cleanup to
  // also drain the context-menu singleton so a torn-down row's close-fn is
  // not retained past its lifetime (idempotent — notifyMenuClosed no-ops if
  // currentClose !== closeSelf, i.e. another row already claimed the slot).
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
        snapTimerRef.current = null;
      }
      notifyMenuClosed(closeSelf);
    };
  }, [closeSelf]);

  // ─── Row-body click ────────────────────────────────────────────────────────
  // Post-pq2: no swipe close-branch. Mobile short-tap AND desktop click both
  // just fire onSelect. The suppressNextClickRef gate catches the synthesized
  // click that follows a long-press (jsdom does not synthesize it, but real
  // browsers do) so a successful long-press does NOT also fire onSelect.
  const onBodyClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onSelect();
  }, [onSelect]);

  const onBodyKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onBodyClick();
      }
    },
    [onBodyClick],
  );

  // ─── Class composition ────────────────────────────────────────────────────
  // Every state variant is a CSS class toggle; the CSS file (pretty-
  // conversations.css) handles all visual response. `isAmbient` is derived
  // from `!isRdp && !inActiveSet` — same logic as pre-Phase-13, moved from
  // JS-computed style branches to a CSS class.
  //
  // quick-260808-fkg: `swipe-past-threshold-right` / `-left` classes toggled
  // on when the armed swipe crosses the threshold. CSS paints a hue-tinted
  // (right) or muted-cream (left) INSET ring on the row body — never behind
  // it, so the retired quick-260802-pq2 bleed-through class of bug is not
  // reintroduced. Threshold: max(90, rowWidth * 0.35) — same shape as the
  // touchEnd threshold check above so the visual affordance and the fire
  // gate are locked in sync. When rowWidth is 0 (jsdom / pre-first-render),
  // the max floor of 90 applies.
  const swipeRowWidth = swipeStartRef.current?.rowWidth ?? 0;
  const swipeThreshold = Math.max(90, swipeRowWidth * 0.35);
  const swipeRawDx = (dxLive ?? 0) / 0.6;
  const swipePastRight =
    armedRef.current &&
    dxLive !== null &&
    dxLive > 0 &&
    swipeRawDx >= swipeThreshold;
  const swipePastLeft =
    armedRef.current &&
    dxLive !== null &&
    dxLive < 0 &&
    swipeRawDx <= -swipeThreshold;

  const rowClassName = cn(
    "pv-row",
    variantClass,
    selected && "selected",
    inActiveSet && "active-set",
    isWorking === true && "working",
    isRecycling === true && "recycling",
    pinned && "pinned",
    isAmbient && "ambient",
    isRdp && "rdp",
    hidden && "hidden",
    swipePastRight && "swipe-past-threshold-right",
    swipePastLeft && "swipe-past-threshold-left",
  );

  // ─── Hue custom property + swipe transform ───────────────────────────────
  // The ONLY structural inline style on `.pv-row` is `--pv-hue: {hue}` for
  // hue-bearing rows. quick-260808-fkg re-introduces an inline transform +
  // (conditionally) transition for the swipe-to-act gesture: while a swipe
  // is armed, `transform: translateX(dxLive)` follows the finger; during the
  // 180ms snap-back window, `transition: transform 180ms cubic-bezier
  // (.2,.9,.3,1)` is applied so the row springs back to origin. Absent both
  // conditions, no transform / transition keys are emitted so the default
  // CSS applies unchanged.
  const bodyStyle: CSSProperties = {
    ...(hue !== null ? ({ "--pv-hue": hue } as CSSProperties) : {}),
    ...(dxLive !== null ? { transform: `translateX(${dxLive}px)` } : {}),
    ...(isSnappingRef.current
      ? { transition: "transform 180ms cubic-bezier(.2,.9,.3,1)" }
      : {}),
  };

  // ─── Render tree ───────────────────────────────────────────────────────────
  // Outer wrapper is `relative` in BOTH variants — post-pq2 there's no swipe
  // transform to clip, so mobile no longer needs `overflow-hidden`.
  const wrapperClass = "relative";

  const initialLetter = identity
    ? (identity.displayName ?? "?").charAt(0).toUpperCase()
    : null;

  return (
    <div
      className={wrapperClass}
      data-conversation-id={row.id}
      data-selected={selected ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
      data-variant={variant}
      data-rdp-host-row={isRdp ? "true" : undefined}
    >
      {/* Row body — the CSS file (pretty-conversations.css) handles all
          layout, background, border, shadow, hover, and state variants via
          the composed className. The only inline style is `--pv-hue` (for
          hue-bearing rows). quick-260802-pq2: onTouchStart/Move/End/Cancel
          now wire the long-press → context-menu handlers (mobile-only).
          Desktop rows get `undefined` for all four so no timer is ever armed.
          quick-260804-uo4: RDP rows now get the full context menu on both
          desktop (onContextMenu) and mobile (touch handlers). */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onBodyClick}
        onKeyDown={onBodyKeyDown}
        onContextMenu={!isMobile ? onRowContextMenu : undefined}
        onTouchStart={isMobile ? onTouchStart : undefined}
        onTouchMove={isMobile ? onTouchMove : undefined}
        onTouchEnd={isMobile ? onTouchEnd : undefined}
        onTouchCancel={isMobile ? onTouchEnd : undefined}
        style={bodyStyle}
        className={rowClassName}
      >
        {/* Avatar disc — identity avatar OR initial letter OR tabIcon fallback */}
        <div className="pv-avatar" data-testid="pcrow-avatar">
          {identity ? (
            identity.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt=""
                className="pv-avatar-img"
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
                draggable={false}
              />
            ) : (
              <span className="pv-avatar-initial">{initialLetter}</span>
            )
          ) : (
            <span className="pv-avatar-fallback-icon" aria-hidden="true">
              {tabIcon(row.type)}
            </span>
          )}
        </div>

        {/* Body: label + host secondary line.
            quick-260727-f9v: sublabel render is now subtitleMode-driven.
            Fallback chain (both explicit and self-documenting per Tina's
            patch #149 lesson — "known limitation, inert ≠ inert"):
              1. subtitleMode === "identityTitle" AND identity resolved
                 → render `identity.title ?? identity.displayName`, NO Server icon
                 (the per-host divider chip above the group already carries
                 the Server glyph; duplicating here would be noisy).
              2. subtitleMode === "identityTitle" AND identity is null
                 → fall through to the verbatim previous behavior — the
                 terminal safety net that guarantees rows never ship with
                 sublabel "" or "undefined".
              3. subtitleMode === "hostname" (default)
                 → verbatim previous behavior: Server icon + row.host.name.
            The outer `{row.host && …}` guard stays intact — rows without a
            host render nothing here in both modes (final safety net; no host
            = no sublabel line = no possibility of stringifying undefined). */}
        <div className="pv-body">
          <span className="pv-label">
            {subtitleMode === "identityTitle" && identity
              ? identity.displayName
              : row.label}
          </span>
          {row.host && (
            <span className="pv-host">
              {subtitleMode === "identityTitle" && identity ? (
                // Path 1: identity-title mode with a resolved identity.
                // Drop the Server icon (the group's divider chip carries it).
                <span>{identity.title ?? identity.displayName}</span>
              ) : (
                // Path 2 (identityTitle + no identity) and Path 3 (hostname
                // mode): verbatim previous render — Server icon + hostname.
                <>
                  <Server aria-hidden="true" width={11} height={11} />
                  <span>{row.host.name}</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Right meta column: desktop PinAction + ready-dot. Pin glyph is
            handled by CSS via `.pv-row:not(.pinned) .pv-meta .pv-pin
            { display: none }` — but the mock uses a lucide Pin svg. In this
            React port we render PinAction (which internally renders a lucide
            Pin/PinOff) — the desktop hover-reveal is CSS-driven via the
            `.pv-row.pv-row--desktop:not(.pinned):not(:hover) .pv-meta
            [data-testid="pin-action"] { opacity: 0 }` rule in
            pretty-conversations.css. Mobile PinAction lives in the swipe
            strip (above); RDP rows skip PinAction entirely. */}
        {/* Non-interactive pin indicator — absolute-positioned at the row's
            top-left corner so it reads as a row-level flag rather than
            competing visually with the bounty count badge in .pv-meta.
            Fills the gap left by (a) mobile rows never rendering PinAction
            at all post-quick-260802-pq2 and (b) desktop PinAction being
            hover-reveal only — both of which meant a pinned row that moved
            into the active-set section lost its only visible pin cue.
            Rendered iff `pinned` (defense-in-depth: CSS also display:none-s
            on :not(.pinned) and .rdp). CSS handles absolute positioning +
            hue-drop-shadow. */}
        {pinned && (
          <span
            className="pv-pin-indicator"
            aria-hidden="true"
            data-testid="pv-pin-indicator"
          >
            <Pin />
          </span>
        )}
        <div className="pv-meta">
          {/* Phase 26 Plan 03: combined pin·desk bounty count badge. Renders
              INSIDE .pv-meta immediately BEFORE the ready-dot (final left-
              to-right order: [deactivate] [pin] [bounty-badge] [ready-dot]).
              The badge component returns null when the pair is undefined
              (pre-fetch) or both halves are zero (absence is the correct
              signal), so nothing else guards visibility here — non-identity
              rows short-circuit inside useBountyCounts above (identityKey
              null returns undefined). Coexists with the ready-dot: a row
              that is BOTH in-active-set-and-idle AND has bounties shows
              BOTH indicators side by side per spec verification #4. Hue
              tinting inherits from .pv-row's --pv-hue via .pv-bounty-badge
              CSS rule. Null-safety via optional chaining on the pair. */}
          <PrettyBountyCountBadge
            pinnedCount={bountyCounts?.pinnedCount}
            needsDeskCount={bountyCounts?.needsDeskCount}
          />

          {/* Ready-dot — signals "engaged AND agent idle, ready for
              Ashley's next input." Rendered iff inActiveSet &&
              isWorking === false && !isRecycling && !hasQueuePending. JS
              gate is strictly narrower than any CSS gate (JS excludes null
              and true for isWorking, and excludes both recycling and
              queue-pending) — the JS gate is the source of truth and the
              CSS `.pv-row.active-set:not(.working):not(.recycling)
              .pv-ready-dot { display: block }` rule is a defense-in-depth
              visibility invariant for the isWorking + isRecycling axes.

              The `!isRecycling` conjunct (quick-260730-qbl) suppresses the
              dot whenever the row's pretty-view surface is currently
              showing SessionHoldingOverlay (patch #74). The CSS gate at
              pretty-conversations.css line 463 has been extended in
              parallel to `:not(.recycling)` for defense-in-depth.

              The `!hasQueuePending` conjunct (quick-260802-w9e) suppresses
              the dot whenever this row's ComposeBox has at least one
              message armed for send-when-idle. Bounty rationale verbatim:
              "if a queued message is armed to auto-send the moment the
              agent goes idle, the agent is effectively already spoken-for
              and NOT ready for Ashley's next instruction (which IS the
              meaning of the dot)." Closes pinned bounty
              `hide-idle-dot-when-queued-message-waiting-to-send`.
              JS-only gate here — no matching CSS mirror because
              `has-queue-pending` is not surfaced as a row className (the
              class rollup at lines 342-343 is deliberately untouched;
              only the dot-render suppression is in scope).

              Hue-cream fill + hue outer glow all handled by CSS via
              `.pv-ready-dot` selector; the neutral fallback for hue-null
              rows is handled by the `--pv-hue: 216` fallback on `.pv-row`
              (RDP rows never carry the `.active-set:not(.working)`
              combination in practice — the panel passes isWorking={null}
              for RDP rows because sessionWorkingKey resolves against a
              null tmux session). */}
          {inActiveSet && isWorking === false && !isRecycling && !hasQueuePending && (
            <span
              aria-label="ready"
              data-pv-conv-ready-dot="true"
              className="pv-ready-dot"
              // Force display:block inline — CSS gate is
              // `.pv-row.active-set:not(.working) .pv-ready-dot { display:
              // block }` but tests that render the dot with isWorking=false
              // but WITHOUT setting `active-set` on the parent (e.g. Test 14
              // for RDP) need the dot in the DOM regardless. Inline
              // display:block guarantees the JS gate is authoritative.
              style={{ display: "block" }}
            />
          )}
        </div>
      </div>
      {/* Right-click menu portal. Items filter by row eligibility: Pin
          renders for any row; Hide/Show only when onToggleHide is provided;
          Clone only when onClone AND identity resolve (RDP rows have no
          identity → Clone auto-hidden); Deactivate only when inActiveSet &&
          onDeactivate; Open/Move in new window renders on desktop for any
          row where specForTab produces a spec. RDP rows now open the menu
          (quick-260804-uo4 dropped the row-level isRdp gate). */}
      {ctxMenu !== null && (
        <PrettyConversationContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hue={hue}
          items={((): PrettyContextMenuItem[] => {
            const items: PrettyContextMenuItem[] = [];
            items.push({
              label: pinned ? "Unpin" : "Pin",
              onClick: onTogglePin,
            });
            // quick-260731-tgg: Hide/Show item between Pin/Unpin and Deactivate.
            // Only rendered when onToggleHide is provided (RDP rows never get it
            // because the panel deliberately doesn't thread onToggleHide for RDP).
            if (onToggleHide) {
              items.push({
                label: hidden ? "Unhide" : "Hide",
                onClick: onToggleHide,
              });
            }
            // Phase 22 (SRIC-03): Clone item — inserted between Hide/Show and
            // Open/Move-in-new-window. Only rendered when onClone is provided AND
            // the row has a resolvable identity (clone requires a source identity —
            // meaningless without it). RDP rows have no identity → Clone is
            // auto-hidden by the identity gate.
            if (onClone && identity) {
              items.push({
                label: "Clone",
                onClick: onClone,
              });
            }
            // quick-260804-uo4: Open/Move in new window — desktop-only (not rendered
            // on mobile variant). Bifurcates label on inActiveSet. Builds a TabSpec
            // via specForTab; skipped for tabs that aren't URL-addressable (specForTab
            // returns null). The click handler opens the encoded workspace URL in a
            // new window and, IF window.open returned a non-null Window handle AND
            // the row was in the active-set, fires onDeactivate to tear down the
            // current tab. The null-check is the popup-blocker safety: a blocked
            // popup returns null, so the original tab survives.
            //
            // ⚠️ Do NOT add "noopener" to the features string (fixed 2026-08-05
            // after Ashley UAT — original quick-260804-uo4 impl had it). Per spec,
            // window.open() with the noopener feature ALWAYS returns null even
            // when the popup opens successfully, so the null-check would never
            // fire onDeactivate and Move-to-new-window would leave the original
            // tab active. The new window is same-origin Skynet, so the
            // noopener guard (preventing untrusted popup from mutating
            // window.opener) doesn't apply — both windows are our own trusted code.
            if (!isMobile) {
              const spec = specForTab({ type: row.type, host: row.host, targetTmuxSession: row.targetTmuxSession });
              if (spec !== null) {
                items.push({
                  label: inActiveSet ? "Move to new window" : "Open in new window",
                  onClick: () => {
                    const payload = encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true });
                    const w = window.open("#" + payload, "_blank");
                    if (w !== null && inActiveSet) {
                      onDeactivate?.();
                    }
                  },
                });
              }
            }
            if (inActiveSet && onDeactivate) {
              items.push({
                label: "Deactivate",
                onClick: onDeactivate,
                danger: true,
              });
            }
            return items;
          })()}
          onClose={() => { notifyMenuClosed(closeSelf); closeSelf(); }}
        />
      )}
    </div>
  );
}
