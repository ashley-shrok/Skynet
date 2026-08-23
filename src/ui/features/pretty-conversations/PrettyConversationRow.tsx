// ─── PrettyConversationRow ───────────────────────────────────────────────────
// Phase 48 Plan 05 (v14 locked shape, Ashley 2026-08-19) — biggest surface
// change since Phase 41 Plan 01. Retired vs pre-Phase-48:
//   * `.pv-meta` right column — element removed from the row entirely; the
//     right-column grid slot is gone. Bounty badge relocated to avatar corners
//     (Pin bottom-left, Monitor bottom-right); ready-dot deleted outright.
//   * The pre-Phase-48 ready-dot span (with its inline display-block hack)
//     plus the 4-input `isWorking-false + !isRecycling + !hasQueuePending`
//     JSX render gate — the "come look" cue is now INVERTED: idle rows have
//     NOTHING; working rows get a slow dashed spinner ring painted on
//     `.pv-avatar::before` (CSS only; no JSX element for the spinner).
//   * `.pv-host` Server-icon rendering — hostname migrates to the title line
//     wrapped in parens (`identityName (hostname)`); the subtitle line becomes
//     the aiTitle text (or an italic ellipsis placeholder when aiTitle is null).
//   * `subtitleMode` prop-driven sublabel branching — the prop is still
//     ACCEPTED on the interface for backward compat with the 5 panel render
//     sites (search-flat, pinned, middle, RDP, hidden), but its value has no
//     runtime effect: the subtitle is always the aiTitle string (or the
//     placeholder ellipsis when null). Kept in the interface so a plan-scope
//     grep-and-remove pass across all 5 render sites is a follow-up concern.
// New in Phase 48 Plan 05:
//   * Title-line hostname suffix: `<span className="pv-hostname-suffix">
//     ({row.host.name})</span>` — parens same font-size as identity name,
//     alpha 0.85 (CSS-owned).
//   * Subtitle line: `<span className="pv-ai-title">{aiTitle}</span>` when
//     aiTitle is truthy; `<span className="pv-ai-title pv-ai-title--placeholder">
//     …</span>` when aiTitle is null. Muted italic ellipsis anchors row height
//     regardless of ai-title presence.
//   * `.pv-avatar` gets Pin (bottom-left) + Monitor (bottom-right) badge
//     corners via VERBATIM JSX duplication of PrettyBountyCountBadge.tsx's
//     two-wrap shape (chosen over the component-call route so each wrap can be
//     absolute-positioned independently). PrettyBountyCountBadge.tsx itself is
//     UNTOUCHED per 48-CONTEXT.md § Badge relocation V12 style reuse.
//   * `showSpinnerOn` JS-computed boolean (Ashley 2026-08-20 post-UAT
//     tightening of 2026-08-19 verbatim): the spinner mirrors the ready-dot
//     scope — it is a SCOPED-TO-ACTIVE-SET signal, ON when the row is in
//     the active set AND the agent is doing something (working, recycling,
//     or has a queued send pending). Ambient (not-in-active-set) rows never
//     spin, regardless of their working state. Concretely:
//     `showSpinnerOn = inActiveSet && (isWorking === true || isRecycling
//       || hasQueuePending)` — the SAME 4 inputs the pre-Phase-48 ready-dot
//     gate used, with `inActiveSet` preserved as the outer scope and the
//     inner three predicates flipped to their positive-work polarity. The
//     ready-dot lit for `inActiveSet && idle`; the spinner lights for
//     `inActiveSet && !idle` — same universe, mutually exclusive triggers,
//     ambient rows silent for both. Emitted as the `spinner-on` className
//     on `.pv-row` (see className composition below). CSS keys off
//     `.pv-row.spinner-on .pv-avatar::before` — single class match; all 4
//     inputs live in JS, CSS is the paint layer only.
//
// Phase 13 Plan 01 (Ashley 2026-07-23 lift-from-mock v4) — as amended by
// Phase 41 Plan 01 (Ashley 2026-08-14 ambient-retirement): the row renders the
// mock's semantic markup with class-toggle state variants. Every visual
// definition (base body, avatar disc, selected treatment, hover, RDP,
// spinner ring) lives in pretty-conversations.css.
//
// Phase 41 Plan 01 retired the ambient-recession visual entirely: this
// component no longer derives the pre-Phase-41 amb-recession flag and no
// longer toggles the recession className. The related CSS block is deleted;
// every row carries the same visual weight regardless of active-set membership.
// The `inActiveSet` prop is PRESERVED — it still drives the deactivate-
// action visibility gate (`.active-set` classname toggle at L873 below)
// and the swipe machinery. Only the ambient VISUAL axis retired.
//
// This component keeps only the surviving JS-only concerns:
//
//   - Working-spinner active-set-scoped gate (Ashley 2026-08-20 UAT):
//     JS computes `showSpinnerOn = inActiveSet && (isWorking === true ||
//     isRecycling || hasQueuePending)` — the pre-Phase-48 ready-dot 4-input
//     universe scoped to the active set, with the three "doing-work"
//     predicates in their positive polarity. Ready-dot on active-set-idle,
//     spinner on active-set-not-idle, both silent on ambient rows. Emitted
//     as the `spinner-on` className on `.pv-row`; CSS at `.pv-row.spinner-on
//     .pv-avatar::before` paints the slow dashed spinner ring. All 4 inputs
//     live in JS; CSS is the paint layer only.
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
//     pinned && 'pinned', isRdp && 'rdp')}
// (Phase 41 Plan 01 dropped the retired amb-recession className toggle.)
//
// The ONE inline style on `.pv-row` is `{'--pv-hue': hue}` for hue-bearing
// rows. Post-pq2 mobile has no transform (no swipe machinery) — the row body
// is a static CSS-rendered card in both variants.
//
// Retired vs pre-Phase-13:
//   - All JS-computed CSSProperties for base body / avatar / selected /
//     hover overlays (~250 lines) — now in pretty-conversations.css as
//     class-toggled selectors. (Ambient overlays formerly in this list
//     were retired entirely in Phase 41 Plan 01.)
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
import { Pin, Monitor } from "lucide-react";

import { tabIcon } from "@/shell/tabUtils";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
import { useBountyCounts } from "@/state/bounty-counts-store";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import { cn } from "@/lib/utils";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import { specForTab, encodeWorkspaceSpec } from "@/lib/tab-url";

// Phase 48 Plan 05: PrettyBountyCountBadge is no longer instantiated by this
// component (badge wraps now render as inline JSX inside `.pv-avatar` to
// enable independent absolute-corner positioning — see the avatar render
// block below). PrettyBountyCountBadge.tsx itself is UNTOUCHED verbatim per
// 48-CONTEXT.md § Badge relocation V12 style reuse; it remains available for
// any future consumer that wants the pre-Phase-48 flex-row layout of the two
// wraps as a single component call.
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
  onKill,
  isWorking = null,
  isRecycling = false,
  hasQueuePending = false,
  inActiveSet = false,
  subtitleMode = "hostname",
  aiTitle = null,
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
  /**
   * quick-260810-n3a: Fired when Ashley clicks the red Kill menu item.
   * Provided by the panel only when !isRdp && !identity && row.targetTmuxSession.
   * The panel wraps the actual kill in a window.confirm — this callback fires
   * ONLY on confirm=true. See PrettyConversationsPanel.handleRowKill.
   */
  onKill?: () => void;
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
  // signal. Phase 53 Plan 03: Panel resolves via useSessionIsRecycling
  // (working-store Axis E, backend-authoritative) — keyed identically
  // to useSessionIsWorking: `${hostId}:${tmuxSession ?? ""}`.
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
  // Phase 47 Plan 04 — the identity's freshest ai-title sourced from the
  // working-store's aiTitle axis (Plan 47-03 LAST-WINS chokepoint). Null
  // when no ai-title has been published yet, or when this row has no
  // working-store key (RDP rows via sessionKey === null → hook short-
  // circuits). Panel resolves via useSessionAiTitle(sessionWorkingKey(row))
  // — keyed identically to the isWorking / isRecycling / hasQueuePending
  // stores. Consumed in Plan 47-05 as the row's subtitle content; NOT yet
  // rendered by this component's tree — the prop is accepted here so the
  // type surface is stable before Plan 47-05 wires the visual. Default
  // null so tests constructing the row without the prop keep working.
  aiTitle?: string | null;
  // Patch #137 (updated Phase 41 Plan 01): whether this row is in Ashley's
  // active-set (any session she has selectConversation-ed in this browser-tab
  // session). Phase 41 retired the ambient-recession visual entirely, so this
  // flag no longer controls "full-bubble vs recessed" appearance — every row
  // carries the same visual weight. The flag SURVIVES because it still gates:
  //   1. The `.active-set` className toggle at L873, which drives the
  //      deactivate-action hover-reveal CSS at pretty-conversations.css:978/994.
  //   2. The swipe machinery composite logic (swipe-right vs swipe-left routing).
  //   3. Context-menu item gating (Deactivate item + Move-vs-Open new-window).
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

  // Phase 26 Plan 03 / Phase 48 Plan 05: per-row bounty counts pair feeding
  // the two avatar-corner badge wraps (Pin bottom-left, Monitor bottom-right).
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

  // Phase 41 Plan 01 (Ashley 2026-08-14): the pre-Phase-41 amb-recession
  // derivation (`!isRdp && !inActiveSet`) and its className toggle were
  // retired here. The related CSS block is deleted; every row carries the
  // same visual weight. `isRdp` and `inActiveSet` survive as separate flags
  // for their other consumers (deactivate-action gating, swipe machinery,
  // context-menu item wiring — see the className composition below).

  const isMobile = variant === "mobile";
  const variantClass = isMobile ? "pv-row--mobile" : "pv-row--desktop";

  // quick-260821-suv: iPad reports `window.innerWidth >= 768` in every
  // orientation (10.9" landscape = 1180px, Pro 12.9" = 1024×1366, Mini
  // portrait = 768 exactly — the `<` comparison in useIsMobile fails), so
  // `variant` resolves to `"desktop"` and the width-only `isMobile` gate
  // below misses touchscreen tablets entirely. `useIsTouchDevice()` reads
  // `(pointer: coarse) and (hover: none)` via matchMedia — the reliable
  // touchscreen signal (narrow desktop windows and hybrid laptops in
  // trackpad mode both report `pointer: fine`). `acceptsTouch` is the OR
  // of the two gates: mobile-width devices AND coarse-pointer devices both
  // wire the four `onTouch*` handlers. Variant-driven STYLING branches
  // (`pv-row--mobile` vs `pv-row--desktop`) intentionally stay width-based
  // — iPad still renders the desktop layout; only INPUT wiring extends.
  const isTouchDevice = useIsTouchDevice();
  const acceptsTouch = isMobile || isTouchDevice;

  // quick-260821-suv: DEV-only mount-time breadcrumb so Ashley can confirm on
  // iPad that the coarse-pointer path opened up (the "wide-viewport
  // touchscreen just wired its touch handlers via the OR gate" signal).
  // Empty deps array → fires exactly once per row mount; never re-fires on
  // state changes. Skipped in prod bundles via import.meta.env.DEV.
  useEffect(() => {
    if (import.meta.env.DEV && isTouchDevice && !isMobile) {
      console.info("[pv-row] touch handlers wired via coarse-pointer gate", {
        conversationId: row.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — mount-only breadcrumb, snapshot at first render is the diagnostic
  }, []);

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
      // quick-260821-suv: widened from `!isMobile` to `!acceptsTouch` so
      // coarse-pointer touchscreens (iPad) exercise the same handler body.
      // The JSX gate widening above only decides whether the handler is
      // WIRED; the handler body itself must widen its own guard for the
      // long-press timer and swipe machinery to actually arm.
      if (!acceptsTouch) return;
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
    [acceptsTouch, isRdp, clearLongPressTimer, closeSelf],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      // quick-260821-suv: widened from `!isMobile` to `!acceptsTouch` — see
      // onTouchStart above for the rationale (iPad wire).
      if (!acceptsTouch) return;
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
    [acceptsTouch, isRdp, clearLongPressTimer],
  );

  const onTouchEnd = useCallback(() => {
    // quick-260821-suv: widened from `!isMobile` to `!acceptsTouch` — see
    // onTouchStart above for the rationale (iPad wire).
    if (!acceptsTouch) return;
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
    acceptsTouch,
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

  // ─── Desktop mouse-drag swipe (quick-260812-uxk) ─────────────────────────
  // Desktop-native equivalent of the mobile touch swipe machine above. Adds
  // parallel onMouseDown / onMouseMove / onMouseUp / onMouseLeave handlers on
  // the row body that share the SAME internal refs the touch handlers use:
  //   swipeStartRef, armedRef, disarmedRef, isSnappingRef, snapTimerRef,
  //   dxLive, resetSwipeGesture, beginSnapBack, clearSnapTimer,
  //   suppressNextClickRef.
  // NO new refs are introduced.
  //
  // Desktop-only + !isRdp gate: wiring is gated on `variant === "desktop" &&
  // !isRdp` at the JSX level (four props are `undefined` for mobile rows and
  // desktop-RDP rows). Defense-in-depth: each handler also early-returns if
  // `variant !== "desktop"` or `isRdp`.
  //
  // NO long-press-on-mouse path: desktop right-click already opens the context
  // menu via the existing `onContextMenu` → `onRowContextMenu` handler. Mouse
  // drag swipe is the single new desktop gesture.
  //
  // Text-selection suppression is CSS-side via `user-select: none` on
  // `.pv-row--desktop` in pretty-conversations.css — cleaner than calling
  // preventDefault on every mousedown (which would suppress right-click
  // context menus and other legitimate browser behaviors).
  //
  // onMouseLeave mid-drag = touchcancel-equivalent: snap back WITHOUT firing
  // the composite (leaving the row while dragging is an explicit cancel
  // signal). suppressNextClickRef is NOT set on leave — the cursor has left
  // the row so no trailing click naturally follows.
  //
  // The mouse handlers do NOT call preventDefault() — text-selection
  // suppression is CSS-side (see above), and preventing default on mousedown
  // would break focus, right-click, and other legitimate browser behaviors.
  const onMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (variant !== "desktop") return;
      if (isRdp) return;
      if (isSnappingRef.current) return;
      const rowWidth = (e.currentTarget as HTMLDivElement)
        .getBoundingClientRect()
        .width;
      swipeStartRef.current = { x: e.clientX, y: e.clientY, rowWidth };
      armedRef.current = false;
      disarmedRef.current = false;
    },
    [variant, isRdp],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (variant !== "desktop") return;
      if (isRdp) return;
      if (swipeStartRef.current === null) return;

      const dx = e.clientX - swipeStartRef.current.x;
      const dy = e.clientY - swipeStartRef.current.y;

      // Disarmed for this gesture sequence → return (vertical won).
      if (disarmedRef.current) return;

      if (!armedRef.current) {
        // Vertical-vs-horizontal disambiguation: wait for at least 8px.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)) {
          armedRef.current = true;
        } else {
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
    [variant, isRdp],
  );

  const onMouseUp = useCallback(() => {
    if (variant !== "desktop") return;
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
      // Never armed → tap path intact (click fires normally via onBodyClick).
      resetSwipeGesture();
      return;
    }

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
    const wouldChange = isRight ? !pinned || !inActiveSet : pinned || inActiveSet;

    swipeStartRef.current = null;
    armedRef.current = false;
    disarmedRef.current = false;

    if (!wouldChange) {
      // Silent no-op — snap back with no callbacks + no vibrate.
      beginSnapBack();
      return;
    }

    // Fire the composite. Order: onTogglePin FIRST (same order as touch path).
    if (isRight) {
      if (!pinned) onTogglePin();
      if (!inActiveSet) onSelect();
    } else {
      if (pinned) onTogglePin();
      if (inActiveSet) onDeactivate?.();
    }
    // Feature-checked haptic (same pattern as touch path — no-op on desktop
    // without haptics and in jsdom).
    navigator.vibrate?.(10);
    // Suppress the trailing browser click so the composite doesn't also fire
    // onSelect via the tap path.
    suppressNextClickRef.current = true;
    beginSnapBack();
  }, [
    variant,
    isRdp,
    resetSwipeGesture,
    beginSnapBack,
    dxLive,
    pinned,
    inActiveSet,
    onTogglePin,
    onSelect,
    onDeactivate,
  ]);

  const onMouseLeave = useCallback(() => {
    if (variant !== "desktop") return;
    if (isRdp) return;
    if (swipeStartRef.current === null) return;
    // onMouseLeave mid-drag = touchcancel-equivalent: cancel the gesture
    // without firing the composite. suppressNextClickRef is NOT set here —
    // leaving the row means no trailing click naturally follows.
    if (armedRef.current) {
      beginSnapBack();
    } else {
      resetSwipeGesture();
    }
    swipeStartRef.current = null;
    armedRef.current = false;
    disarmedRef.current = false;
  }, [variant, isRdp, beginSnapBack, resetSwipeGesture]);

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
  // conversations.css) handles all visual response. Phase 41 Plan 01 retired
  // the amb-recession className toggle — the corresponding CSS block is
  // deleted so the row no longer emits that class.
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

  // Working-spinner active-set-scoped gate (Ashley 2026-08-20 UAT tightening
  // of the 2026-08-19 verbatim rule). Ashley on the first-look UAT of the
  // full-inversion shape: the ambient rows all lit up because the outer
  // `inActiveSet` was included in the inversion, which reads as "idle rows
  // have spinners." The intended shape is a SCOPED mirror of the ready-dot,
  // not a full universe inversion: the ready-dot lights on
  // `inActiveSet && idle`, the spinner lights on `inActiveSet && !idle`, and
  // ambient rows are silent for both. Same 4 inputs, same JS-store source,
  // `inActiveSet` preserved as the outer scope, the three inner predicates
  // flipped to positive-work polarity:
  //
  //   showSpinnerOn = inActiveSet
  //                && (isWorking === true || isRecycling || hasQueuePending)
  //
  // Emitted as the `spinner-on` className on `.pv-row`; CSS matches on that
  // single class alone at `.pv-row.spinner-on .pv-avatar::before` — no
  // CSS-side narrowing to `:is(.working, .recycling)`, no `.active-set`
  // scoping. All 4 inputs live in JS; CSS is the paint layer only. Tests
  // P47-14 (`inActiveSet + hasQueuePending → spinner ON` — queue-pending is
  // a first-class input, not a bystander) and P47-15 (`!inActiveSet +
  // isWorking=true → spinner OFF` — ambient rows never spin) lock the
  // full 4-input scoped boolean against regression to either a CSS-only
  // 2-input `.pv-row:is(.working, .recycling)` shape (which would drop
  // `hasQueuePending` and `.active-set` scoping) or the pre-UAT full
  // inversion (which would light every ambient idle row).
  const showSpinnerOn =
    inActiveSet && (isWorking === true || isRecycling || hasQueuePending);

  const rowClassName = cn(
    "pv-row",
    variantClass,
    selected && "selected",
    inActiveSet && "active-set",
    isWorking === true && "working",
    showSpinnerOn && "spinner-on",
    isRecycling === true && "recycling",
    pinned && "pinned",
    // Phase 41 Plan 01: amb-recession className toggle retired.
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
        // quick-260821-suv: the four `onTouch*` gates were widened from
        // `isMobile ? h : undefined` to `acceptsTouch ? h : undefined`
        // where `acceptsTouch = isMobile || isTouchDevice`. iPad reports
        // `window.innerWidth >= 768` in every orientation, so the
        // width-only `isMobile` gate missed touchscreen tablets and
        // both long-press → context menu AND swipe-to-act were dead on
        // iPad. `useIsTouchDevice()` reads
        // `(pointer: coarse) and (hover: none)` via matchMedia to close
        // the gap. Variant-driven STYLING branches
        // (`pv-row--mobile` vs `pv-row--desktop`) intentionally stay
        // width-based — iPad still renders the desktop layout; only
        // input wiring extends. `onTouchCancel` reuses `onTouchEnd`
        // (pre-existing intentional wiring, unchanged).
        onTouchStart={acceptsTouch ? onTouchStart : undefined}
        onTouchMove={acceptsTouch ? onTouchMove : undefined}
        onTouchEnd={acceptsTouch ? onTouchEnd : undefined}
        onTouchCancel={acceptsTouch ? onTouchEnd : undefined}
        onMouseDown={variant === "desktop" && !isRdp ? onMouseDown : undefined}
        onMouseMove={variant === "desktop" && !isRdp ? onMouseMove : undefined}
        onMouseUp={variant === "desktop" && !isRdp ? onMouseUp : undefined}
        onMouseLeave={variant === "desktop" && !isRdp ? onMouseLeave : undefined}
        style={bodyStyle}
        className={rowClassName}
      >
        {/* Avatar disc — identity avatar OR initial letter OR tabIcon fallback.
            Phase 48 Plan 05: `.pv-avatar` is now the positioning host for the
            Pin + Monitor bounty-count badges (relocated from the retired
            retired right-column meta wrapper to absolute corners of the avatar — Pin
            bottom-left, Monitor bottom-right). The V12 notification-badge
            style (patch #468) is reused VERBATIM per 48-CONTEXT.md § Badge
            relocation V12 style reuse: PrettyBountyCountBadge.tsx is UNTOUCHED
            and its `.pv-bounty-badge-wrap` / `.pv-bounty-badge-icon` /
            `.pv-bounty-badge-num` class values + child structure are preserved
            verbatim. However, the component's outer `.pv-bounty-badge` flex
            container groups the two wraps in a single row — inconvenient for
            absolute-positioning them independently at avatar corners — so
            here we DUPLICATE the wrap JSX inline (Pin + count-pill; Monitor +
            count-pill) so each wrap can be a direct child of `.pv-avatar` and
            CSS at `.pv-avatar .pv-bounty-badge-wrap[data-testid=...] {
            position: absolute; bottom: -4px; left|right: -8px; }` can pin
            each corner independently. Keep the two shapes in sync manually
            with PrettyBountyCountBadge.tsx (~L44-68). Alternative refactor
            (extract sub-component) rejected for Phase 48 scope — the badge
            component is verbatim-locked per patch #468 preservation contract.
            Zero-count branches match PrettyBountyCountBadge.tsx exactly:
            each wrap renders iff its count > 0; the unfetched-pair case
            (both undefined) also renders no wraps, matching the badge
            component's null-return contract. */}
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
          {/* Phase 48 Plan 05 — Pin count badge (bottom-left of avatar).
              Renders iff pinnedCount > 0 (unfetched pair OR zero count → no
              wrap). Verbatim JSX shape from PrettyBountyCountBadge.tsx L50-58. */}
          {bountyCounts?.pinnedCount !== undefined &&
            bountyCounts.pinnedCount > 0 && (
              <span
                className="pv-bounty-badge-wrap"
                data-testid="pv-bounty-badge-pinned"
              >
                <Pin className="pv-bounty-badge-icon" aria-hidden="true" />
                <span className="pv-bounty-badge-num">
                  {bountyCounts.pinnedCount}
                </span>
              </span>
            )}
          {/* Phase 48 Plan 05 — Monitor count badge (bottom-right of avatar).
              Renders iff needsDeskCount > 0. Verbatim JSX shape from
              PrettyBountyCountBadge.tsx L59-67. */}
          {bountyCounts?.needsDeskCount !== undefined &&
            bountyCounts.needsDeskCount > 0 && (
              <span
                className="pv-bounty-badge-wrap"
                data-testid="pv-bounty-badge-needs-desk"
              >
                <Monitor className="pv-bounty-badge-icon" aria-hidden="true" />
                <span className="pv-bounty-badge-num">
                  {bountyCounts.needsDeskCount}
                </span>
              </span>
            )}
        </div>

        {/* Body: title line + subtitle line.
            Phase 48 Plan 05 (Ashley 2026-08-19) established the shape:
              Title line — identity displayName (or row.label as safety-net
              fallback) followed by a parenthetical suffix. Subtitle line —
              aiTitle (or `…` placeholder). Server icon dropped.

            inline-260823-conv-title-suffix (Ashley 2026-08-23):
              The parenthetical PREFERS `identity.title` over `row.host.name`.
              Ashley verbatim: "all the identities are showing the host that
              they live on next to their name instead of their title ... I
              understand like maybe the host name is a fallback or something
              but like right now it's like a hundred percent of the identities
              are showing the name of the host instead of their title and I
              don't really care what host they're on that doesn't help me".
              Resolution order:
                1. identity?.title (non-empty string) — the meaningful label
                2. row.host?.name — fallback for identities without a title,
                   or non-identity rows (unresolved sessions)
                3. absent — no parens at all (extreme edge case)
              `||` (not `??`) so empty-string title falls through to hostname.
              The CSS class name `pv-hostname-suffix` is kept for backward
              compat — it now styles a title OR hostname parenthetical. */}
        <div className="pv-body">
          <span className="pv-label">
            {identity ? identity.displayName : row.label}
            {(identity?.title || row.host?.name) && (
              <span className="pv-hostname-suffix">
                {" "}
                ({identity?.title || row.host?.name})
              </span>
            )}
          </span>
          {aiTitle !== null ? (
            <span className="pv-ai-title">{aiTitle}</span>
          ) : (
            <span className="pv-ai-title pv-ai-title--placeholder">…</span>
          )}
        </div>

        {/* Non-interactive pin indicator — absolute-positioned at the row's
            top-left corner so it reads as a row-level flag. Preserved from
            pre-Phase-48; the right-column meta wrapper retirement does NOT
            affect this element. Rendered iff `pinned`. */}
        {pinned && (
          <span
            className="pv-pin-indicator"
            aria-hidden="true"
            data-testid="pv-pin-indicator"
          >
            <Pin />
          </span>
        )}
        {/* Phase 48 Plan 05 — the right-column meta wrapper RETIRED entirely.
            Retired symbols and their replacements:
              - PrettyBountyCountBadge invocation → replaced by direct-JSX
                duplication of the two wraps inside `.pv-avatar` above.
              - The pre-Phase-48 ready-dot span (with its inline display-block
                hack) plus the 4-input `isWorkingFalse + notRecycling +
                noQueuePending` JSX render gate → replaced by the CSS-painted
                spinner ring on `.pv-avatar::before` (see pretty-conversations
                .css). The same 4 inputs now drive the active-set-scoped
                `showSpinnerOn` className computed at the rowClassName
                composition above (Ashley 2026-08-20 UAT tightening: the
                ready-dot's `inActiveSet` scope is PRESERVED so ambient rows
                never spin; only the three inner "doing-work" predicates
                flip to positive polarity). */}
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
                  // Label unified 2026-08-18 (Ashley): always "Open in new
                  // window" regardless of active-set membership. The
                  // deactivate side-effect on success still fires when
                  // inActiveSet — behavior unchanged, only the label.
                  label: "Open in new window",
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
            // Deactivate menu item removed 2026-08-17 (Ashley). The swipe-LEFT
            // gesture on mobile remains the sole UI trigger for deactivate;
            // panel-level handleRowDeactivate composition (removeFromActiveSet
            // + onDeactivateRow) is untouched. The `onDeactivate` prop still
            // threads through so swipe-LEFT can call it.
            // quick-260810-n3a: Kill — hard-terminates the underlying tmux
            // session on the host via POST /host/:hostId/session/kill.
            // Gated: onKill provided AND !isRdp AND no identity resolved
            // AND row.targetTmuxSession is non-null. Identity rows have
            // real /id save state and must not be nuked from a context
            // menu (intentional scope fence). Rendered last in the menu —
            // destructive-most at the bottom per bounty spec.
            if (
              onKill &&
              !isRdp &&
              !identity &&
              row.targetTmuxSession !== null &&
              row.targetTmuxSession !== undefined
            ) {
              items.push({
                label: "Kill",
                onClick: onKill,
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
