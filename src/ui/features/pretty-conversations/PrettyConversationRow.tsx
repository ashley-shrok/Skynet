// ─── PrettyConversationRow ───────────────────────────────────────────────────
// Phase 13 Plan 01 (Ashley 2026-07-23 lift-from-mock v4): the row renders the
// mock's semantic markup with class-toggle state variants. Every visual
// definition (base body, avatar disc, ambient recession, selected treatment,
// hover, RDP, ready-dot) lives in pretty-conversations.css. This component
// keeps only the surviving JS-only concerns:
//
//   - Swipe reveal state machine (mobile) — the swipe transform is dynamic
//     per-frame and can't be expressed in pure CSS; it stays as an inline
//     transform on the row body.
//   - Ready-dot conditional render (`inActiveSet && isWorking === false`) —
//     JS-gated so the DOM never contains a ready-dot span when isWorking is
//     null or true (preserves the test expectations for Tests 15/16/17). The
//     CSS `.pv-row.active-set:not(.working) .pv-ready-dot { display: block }`
//     provides a secondary gate for the visibility invariant.
//   - Avatar image src selection (identity.avatarUrl vs initial letter vs
//     tabIcon fallback).
//   - Click / keyboard / touch handlers, aria-labels, `--pv-hue` custom
//     property emission for hue-bearing rows.
//
// State variants are className toggles composed via `cn`:
//   className={cn('pv-row', variantClass, selected && 'selected',
//     inActiveSet && 'active-set', isWorking === true && 'working',
//     pinned && 'pinned', isAmbient && 'ambient', isRdp && 'rdp')}
//
// The ONE inline style on `.pv-row` is `{'--pv-hue': hue}` for hue-bearing
// rows. Mobile also spreads `transform: translateX(...)` for the swipe (the
// documented exception — dynamic dx can't be CSS-only).
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
//
// Identity carry-through mirrors ConversationRow.tsx lines 41-47 verbatim so
// identity-tinted rows keep the same "which session is this" reading after
// the sidebar is retired.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { Server } from "lucide-react";

import { tabIcon } from "@/shell/tabUtils";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
import { useBountyCount } from "@/state/bounty-counts-store";
import { cn } from "@/lib/utils";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";

import { PinAction } from "./PinAction";
import { DeactivateAction } from "./DeactivateAction";
import { HideAction } from "./HideAction";
import { PrettyBountyCountBadge } from "./PrettyBountyCountBadge";
import {
  PrettyConversationContextMenu,
  type PrettyContextMenuItem,
} from "./PrettyConversationContextMenu";
import {
  PC_SWIPE_ANGLE_TOLERANCE,
  PC_SWIPE_REVEAL,
  PC_SWIPE_THRESHOLD,
} from "./tokens";

// ─── Prop shape ──────────────────────────────────────────────────────────────
// `variant` drives the density class (`pv-row--mobile` vs `pv-row--desktop`)
// AND the swipe wiring gate (mobile-only).
//
// `forceClosed` is the panel's coordination hook — the panel drives a
// "currently swiped-open row id" and passes forceClosed={true} to every OTHER
// row so opening one snaps the others shut.
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
  onSwipeOpenChange,
  forceClosed,
  isWorking = null,
  isRecycling = false,
  inActiveSet = false,
  subtitleMode = "hostname",
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  // quick-260731-tgg: whether this row is currently in Ashley's hidden set.
  // Drives the mobile swipe strip placement (hidden rows show Show instead of
  // Pin+Hide) and the context menu Hide/Show label.
  hidden?: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  // quick-260727-gm3: fired when Ashley clicks the red-tinted X inside
  // .pv-meta (desktop) OR the swipe strip (mobile). MUST be provided by
  // the panel whenever inActiveSet === true && !isRdp — otherwise the
  // click is a no-op at the row level (the button still renders + fires
  // its own click, but forwards to a missing callback). See
  // PrettyConversationsPanel.handleRowDeactivate for the store-mutation
  // + tab-close composition.
  onDeactivate?: () => void;
  // quick-260731-tgg: fired when Ashley clicks Hide (EyeOff) or Show (Eye).
  // When provided, the Hide/Show item appears in the context menu between
  // Pin/Unpin and Deactivate. Mobile swipe strip: ambient rows show HideAction,
  // hidden rows show HideAction(Eye). RDP rows never receive this prop.
  onToggleHide?: () => void;
  onSwipeOpenChange?: (open: boolean) => void;
  forceClosed?: boolean;
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

  // Quick 260727-tb1: per-row pinned bounty count for the .pv-meta badge.
  // useBountyCount(null, ...) short-circuits to undefined, so non-identity
  // rows carry no subscription cost. Host.id is a string in the fork's
  // ui-types; we convert with parseInt (same shape AppShell uses at
  // openTab hostId derivation). Result is undefined until the panel's
  // poller lands a refresh; the badge component renders null for
  // undefined AND 0 (Key design decision #7).
  const rowHostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
  const pinnedCount = useBountyCount(
    identity?.identityKey ?? null,
    Number.isFinite(rowHostIdNum) ? rowHostIdNum : null,
  );

  // Patch #137 / Phase 13: ambient recession applies to non-RDP rows NOT in
  // Ashley's active-set. The `.ambient` class on the row triggers the CSS
  // recession block; RDP rows are exempt regardless of inActiveSet.
  const isAmbient = !isRdp && !inActiveSet;

  const isMobile = variant === "mobile";
  const variantClass = isMobile ? "pv-row--mobile" : "pv-row--desktop";

  // ─── Mobile swipe state machine ────────────────────────────────────────────
  // Wire only on mobile variant AND non-RDP rows. Desktop variant + RDP rows
  // get zero touch listeners at the render tree level.
  const [swipedOpen, setSwipedOpen] = useState(false);
  const [dxLive, setDxLive] = useState<number | null>(null); // null = not
  //                                                             actively
  //                                                             swiping
  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);
  const baseDxRef = useRef<number>(0);

  // forceClosed prop wins over local state — the panel uses it to close
  // sibling rows when a new one opens.
  const effectiveOpen = forceClosed === true ? false : swipedOpen;

  const emitSwipeOpenChange = useCallback(
    (open: boolean) => {
      if (onSwipeOpenChange) onSwipeOpenChange(open);
    },
    [onSwipeOpenChange],
  );

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (isRdp) return;
      if (!isMobile) return;
      const t = e.touches[0];
      if (!t) return;
      startXRef.current = t.clientX;
      startYRef.current = t.clientY;
      baseDxRef.current = effectiveOpen ? -PC_SWIPE_REVEAL : 0;
      activeRef.current = true;
      // Do not preventDefault — passive-friendly. Native vertical scroll wins
      // for a vertical drag; we only track horizontal.
    },
    [isRdp, isMobile, effectiveOpen],
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      if (isRdp) return;
      if (!isMobile) return;
      if (!activeRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = Math.abs(t.clientY - startYRef.current);
      if (dy > PC_SWIPE_ANGLE_TOLERANCE) {
        // Vertical gesture — yield to browser scroll and abort the swipe.
        activeRef.current = false;
        setDxLive(null);
        return;
      }
      const raw = t.clientX - startXRef.current;
      const clamped = Math.max(
        -PC_SWIPE_REVEAL,
        Math.min(0, baseDxRef.current + raw),
      );
      setDxLive(clamped);
    },
    [isRdp, isMobile],
  );

  const onTouchEnd = useCallback(() => {
    if (isRdp) return;
    if (!isMobile) return;
    if (!activeRef.current) {
      // Vertical bail-out already reset; nothing to commit.
      setDxLive(null);
      return;
    }
    activeRef.current = false;
    const finalDx = dxLive ?? baseDxRef.current;
    const shouldOpen = finalDx < -PC_SWIPE_THRESHOLD;
    setDxLive(null);
    if (shouldOpen !== swipedOpen) {
      setSwipedOpen(shouldOpen);
      emitSwipeOpenChange(shouldOpen);
    }
  }, [isRdp, isMobile, dxLive, swipedOpen, emitSwipeOpenChange]);

  // ─── Row-body click ────────────────────────────────────────────────────────
  // Mobile: if the row is swiped-open, a click on the body closes it INSTEAD
  // of firing onSelect. Desktop: click always fires onSelect (no swipe state
  // to interfere).
  const onBodyClick = useCallback(() => {
    if (isMobile && effectiveOpen) {
      setSwipedOpen(false);
      emitSwipeOpenChange(false);
      return;
    }
    onSelect();
  }, [isMobile, effectiveOpen, onSelect, emitSwipeOpenChange]);

  const onBodyKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onBodyClick();
      }
    },
    [onBodyClick],
  );

  // ─── Pin click (both variants) ─────────────────────────────────────────────
  // stopPropagation lives HERE (not inside PinAction) so the row's onClick
  // does not fire.
  const onPinClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onTogglePin();
    },
    [onTogglePin],
  );

  // quick-260727-gm3: deactivate click (both variants). Same stopPropagation
  // discipline as onPinClick — the row's click handler must not fire when
  // the X is pressed. Forwards to the panel's handler (which pairs
  // removeFromActiveSet + closeTab) if provided; otherwise silent no-op.
  const onDeactivateClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (onDeactivate) onDeactivate();
    },
    [onDeactivate],
  );

  // quick-260731-tgg: hide/show click. Same stopPropagation discipline.
  const onHideClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onToggleHide?.();
    },
    [onToggleHide],
  );

  // Right-click context menu state for desktop non-RDP rows. Coords are
  // cursor position at contextmenu time; null = menu closed.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const onRowContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // Same eligibility rule as the (now-hidden) desktop icons: RDP rows
      // have no actions, so no menu. Non-active-set rows only have Pin
      // (Deactivate is filtered out below by the items[] predicate).
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  // ─── Class composition ────────────────────────────────────────────────────
  // Every state variant is a CSS class toggle; the CSS file (pretty-
  // conversations.css) handles all visual response. `isAmbient` is derived
  // from `!isRdp && !inActiveSet` — same logic as pre-Phase-13, moved from
  // JS-computed style branches to a CSS class.
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
  );

  // ─── Hue custom property + mobile swipe transform ─────────────────────────
  // The ONLY inline style on `.pv-row` is `--pv-hue: {hue}` for hue-bearing
  // rows, plus (on mobile) the swipe transform (dynamic per-frame; can't be
  // CSS-only). CSS reads `--pv-hue` in every `hsla(var(--pv-hue), ...)`
  // expression. When hue is null, the CSS fallback (`--pv-hue: 216` on
  // `.pv-row`) applies but the .ambient / .rdp branches use non-hue
  // backgrounds so no visual leak.
  const activeDrag = dxLive !== null;
  const targetDx = activeDrag
    ? dxLive
    : effectiveOpen
      ? -PC_SWIPE_REVEAL
      : 0;
  const bodyStyle: CSSProperties = (() => {
    const style: Record<string, string | number> = {};
    if (hue !== null) {
      style["--pv-hue"] = hue;
    }
    if (isMobile) {
      style.transform = `translateX(${targetDx}px)`;
      style.transition = activeDrag ? "none" : "transform 180ms ease";
    }
    return style as CSSProperties;
  })();

  // ─── Render tree ───────────────────────────────────────────────────────────
  // Outer wrapper is `relative` (positions the mobile swipe strip) and
  // `overflow-hidden` on mobile so the row-body transform doesn't paint over
  // sibling rows.
  const wrapperClass = isMobile
    ? "relative overflow-hidden"
    : "relative";

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
      data-swiped-open={isMobile && effectiveOpen ? "true" : undefined}
    >
      {/* Mobile swipe-reveal strip. Absolutely positioned behind the row body
          so the row-body transform reveals it. Only rendered for mobile
          variant AND non-RDP rows (T-Test-34: RDP rows can't be pinned).
          quick-260727-gm3: strip widened to 132px (tokens.ts) and now hosts
          BOTH PinAction AND DeactivateAction side-by-side when the row is
          in the active-set. Order: PinAction FIRST (left), DeactivateAction
          SECOND (right) — matches Ashley's preview: pin on left, X on right
          when the strip is revealed from the right edge. Ambient (non-
          active-set) mobile rows expose only PinAction (no deactivate). */}
      {/* Mobile swipe-reveal strip — design-locked placement rules (quick-260731-tgg):
          HIDDEN rows (inside expanded Hidden section):
            [HideAction(Eye)]  — Show affordance only. No Pin, no Deactivate
            (hidden rows are excluded from active-set and pinned by the store filter).
          ACTIVE-SET rows (non-RDP, non-hidden):
            [PinAction, DeactivateAction]  — unchanged; to hide, long-press → menu.
          AMBIENT rows (non-active-set, non-RDP, non-hidden):
            [PinAction, HideAction(EyeOff)]  — no Deactivate (ambient can't deactivate). */}
      {isMobile && !isRdp && (
        <div
          className="absolute top-0 right-0 bottom-0 flex items-center justify-center gap-3 z-0"
          style={{ width: `${PC_SWIPE_REVEAL}px` }}
          aria-hidden={!effectiveOpen}
        >
          {hidden ? (
            // Hidden row swipe strip: Show-only (Eye)
            <HideAction
              hue={hue}
              size="mobile"
              hidden={true}
              onClick={onHideClick}
              data-testid="hide-action-show"
            />
          ) : (
            <>
              <PinAction
                hue={hue}
                pinned={pinned}
                size="mobile"
                onClick={onPinClick}
              />
              {inActiveSet ? (
                // Active-set: show Deactivate (design lock — no HideAction on swipe for active-set rows)
                <DeactivateAction
                  hue={hue}
                  size="mobile"
                  onClick={onDeactivateClick}
                />
              ) : (
                // Ambient: show HideAction (EyeOff) when onToggleHide is provided
                onToggleHide && (
                  <HideAction
                    hue={hue}
                    size="mobile"
                    hidden={false}
                    onClick={onHideClick}
                    data-testid="hide-action-hide"
                  />
                )
              )}
            </>
          )}
        </div>
      )}

      {/* Row body — the CSS file (pretty-conversations.css) handles all
          layout, background, border, shadow, hover, and state variants via
          the composed className. The only inline style is `--pv-hue` (for
          hue-bearing rows) + the mobile swipe transform. */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onBodyClick}
        onKeyDown={onBodyKeyDown}
        onContextMenu={!isMobile && !isRdp ? onRowContextMenu : undefined}
        onTouchStart={isMobile && !isRdp ? onTouchStart : undefined}
        onTouchMove={isMobile && !isRdp ? onTouchMove : undefined}
        onTouchEnd={isMobile && !isRdp ? onTouchEnd : undefined}
        onTouchCancel={isMobile && !isRdp ? onTouchEnd : undefined}
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
          <span className="pv-label">{row.label}</span>
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
        <div className="pv-meta">
          {/* Quick 260727-tb1: per-row pinned bounty count badge. Renders
              INSIDE .pv-meta immediately BEFORE the ready-dot (final left-
              to-right order: [deactivate] [pin] [bounty-badge] [ready-dot]).
              The badge component itself returns null when count is
              undefined (pre-fetch) or 0 (absence is the correct signal),
              so nothing else guards visibility here — non-identity rows
              short-circuit inside useBountyCount above. Coexists with the
              ready-dot: a row that is BOTH in-active-set-and-idle AND has
              pinned bounties shows BOTH indicators side by side per
              spec verification #4. Hue tinting inherits from .pv-row's
              --pv-hue via the .pv-bounty-badge CSS rule. */}
          <PrettyBountyCountBadge count={pinnedCount} />

          {/* Ready-dot — signals "engaged AND agent idle, ready for
              Ashley's next input." Rendered iff inActiveSet &&
              isWorking === false && !isRecycling. JS gate is strictly
              narrower than the CSS
              `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot
              { display: block }` rule (JS excludes null and true; CSS only
              excludes working + recycling) — the JS gate is the source of
              truth and the CSS gate is a defense-in-depth visibility
              invariant.

              The `!isRecycling` conjunct (quick-260730-qbl) suppresses the
              dot whenever the row's pretty-view surface is currently
              showing SessionHoldingOverlay (patch #74). The CSS gate at
              pretty-conversations.css line 463 has been extended in
              parallel to `:not(.recycling)` for defense-in-depth.

              Hue-cream fill + hue outer glow all handled by CSS via
              `.pv-ready-dot` selector; the neutral fallback for hue-null
              rows is handled by the `--pv-hue: 216` fallback on `.pv-row`
              (RDP rows never carry the `.active-set:not(.working)`
              combination in practice — the panel passes isWorking={null}
              for RDP rows because sessionWorkingKey resolves against a
              null tmux session). */}
          {inActiveSet && isWorking === false && !isRecycling && (
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
          renders for any non-RDP row (always available); Deactivate only
          when inActiveSet. RDP rows never open the menu (onRowContextMenu
          is not wired when isRdp), so items[] can safely assume non-RDP. */}
      {ctxMenu !== null && !isRdp && (
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
            // Only rendered when onToggleHide is provided (RDP rows never get it —
            // onRowContextMenu is not wired for isRdp, so items[] already assumes non-RDP;
            // the belt-and-suspenders onToggleHide check below handles RDP safety).
            if (onToggleHide) {
              items.push({
                label: hidden ? "Unhide" : "Hide",
                onClick: onToggleHide,
              });
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
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
