// ─── PrettyConversationRow ───────────────────────────────────────────────────
// The chunky Telegram-style row that IS the visual language of Phase 10.
// Every visual decision Ashley signed off on 2026-07-22 lives inside this
// component:
//
//   1. 48px (mobile) / 40px (desktop) identity-hue avatar disc with hue-ring
//   2. primary label + host-name secondary line (Server-icon glyph + name),
//      NO identity chip — session name IS identity name (Ashley: "the
//      label carries the identity presence")
//   3. Selected-row treatment VERBATIM from ChatMessage.tsx assistant branch
//      (linear-gradient bg + hue border + inset+outer hue glow), adapted for
//      row geometry
//   4. Same component drives both viewports via a `variant` prop:
//        - variant="mobile"  → 72px chunky row, swipe-left past 40px reveals a
//                             48x48 PinAction in an 88px right-anchored strip;
//                             tap on swiped-open row closes it (does not select)
//        - variant="desktop" → 62px row, hover-reveal 24x24 PinAction in the
//                             right meta column; always visible for pinned rows
//   5. RDP rows (row.rdpHostRow === true) skip swipe wiring AND skip PinAction
//      in both variants (T-Test-34 preserved)
//   6. Rows with no identity fall back to a neutral tab-icon avatar (no hue)
//      via the existing sessionMatchKey + useIdentities carry-through
//
// Identity carry-through mirrors ConversationRow.tsx lines 41-47 verbatim so
// identity-tinted rows keep the same "which session is this" reading after
// the sidebar is retired in Wave 3.
//
// Class strings for the selected background/border/shadow interpolate the
// runtime hue inline (Tailwind arbitrary-value bracket) instead of creating
// a new CSS custom property (Ashley naming rule: prefer inline hsla for
// values used at a single call site).
//
// No identity-chip import, no chip render.
// No `animate-spin` or any motion on the pin action (Phase 10 non-negotiable).
// No new npm deps — everything imports from lucide-react + react-i18next + the
// existing session-hue + identities stores.

import {
  useCallback,
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
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";

import { PinAction } from "./PinAction";
import {
  PC_SWIPE_ANGLE_TOLERANCE,
  PC_SWIPE_REVEAL,
  PC_SWIPE_THRESHOLD,
} from "./tokens";

// ─── Prop shape ──────────────────────────────────────────────────────────────
// `variant` is the deliberate deviation from ConversationRow.tsx. Everything
// else is a straight rename of the same prop set.
//
// `forceClosed` is Wave 2's coordination hook — the panel drives a
// "currently swiped-open row id" and passes forceClosed={true} to every OTHER
// row so opening one snaps the others shut. Absent / false = row manages its
// own swipe state locally.
export function PrettyConversationRow({
  row,
  selected,
  pinned,
  variant,
  onSelect,
  onTogglePin,
  onSwipeOpenChange,
  forceClosed,
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  onSwipeOpenChange?: (open: boolean) => void;
  forceClosed?: boolean;
}) {
  // ─── Identity resolution ───────────────────────────────────────────────────
  // Same shape as ConversationRow.tsx lines 41-47 (production baseline).
  const { byKey: identitiesByKey } = useIdentities();
  const key = sessionMatchKey(row.targetTmuxSession);
  const identity = key ? (identitiesByKey.get(key) ?? null) : null;
  const hue: number | null = identity?.colorHue ?? null;
  const isRdp = row.rdpHostRow === true;

  // ─── Variant-derived dimensions ────────────────────────────────────────────
  const isMobile = variant === "mobile";
  const rowMinH = isMobile ? "min-h-[72px]" : "min-h-[62px]";
  const rowPadding = isMobile ? "px-4 py-3" : "px-3 py-2.5";
  const rowGap = isMobile ? "gap-3" : "gap-2.5";
  const avatarSize = isMobile ? "w-12 h-12" : "w-10 h-10";
  const avatarInnerIconSize = isMobile ? "w-5 h-5" : "w-[18px] h-[18px]";
  const avatarInitialTextSize = isMobile ? "text-[18px]" : "text-[15px]";
  const labelTextSize = isMobile ? "text-[15.5px]" : "text-[13.5px]";
  const hostTextSize = isMobile ? "text-[12.5px]" : "text-[11.5px]";
  const hostIconSize = isMobile ? "w-3 h-3" : "w-[11px] h-[11px]";
  const pinGlyphSize = isMobile ? "w-3.5 h-3.5" : "w-3 h-3";
  const line1Gap = isMobile ? "gap-2" : "gap-1.5";
  const line2Gap = isMobile ? "gap-2" : "gap-1.5";

  // ─── Avatar style (radial hue-gradient + hue-ring) ─────────────────────────
  // Verbatim from prototype.html lines 246-274 (mobile) and desktop.html
  // lines 279-306 (desktop), inlined as CSS-in-JS so runtime hue interpolates.
  const avatarRing = isMobile ? "2px" : "1.5px";
  const avatarStyle: CSSProperties =
    hue == null
      ? {
          background:
            "linear-gradient(160deg, rgba(45,55,80,0.9), rgba(28,35,55,0.9))",
          boxShadow: `0 0 0 ${avatarRing} rgba(120,140,180,0.35), 0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)`,
        }
      : {
          background: `radial-gradient(circle at 30% 25%, hsla(${hue}, 80%, 62%, 1) 0%, hsla(${hue}, 65%, 40%, 1) 60%, hsla(${hue}, 55%, 28%, 1) 100%)`,
          boxShadow: `0 0 0 ${avatarRing} hsla(${hue}, 70%, 55%, 0.45), 0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)`,
          textShadow: "0 1px 1px rgba(0,0,0,0.4)",
        };

  // ─── Selected-row treatment ────────────────────────────────────────────────
  // ChatMessage.tsx assistant-bubble (lines 118-129) VERBATIM, adapted for row
  // geometry — reduced alpha per prototype.html lines 231-239. Runtime hue
  // interpolated inline; no new CSS custom property.
  const selectedStyle: CSSProperties = (() => {
    if (!selected) return {};
    if (hue == null) {
      return {
        background:
          "linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))",
        borderColor: "rgba(120,140,180,0.32)",
        boxShadow:
          "inset 0 1px 0 rgba(255,220,170,0.10), inset 0 0 0 0.5px rgba(120,140,180,0.16), 0 0 24px rgba(120,140,180,0.08)",
      };
    }
    return {
      background: `linear-gradient(160deg, hsla(${hue}, 50%, 38%, 0.30), hsla(${hue}, 45%, 24%, 0.35))`,
      borderColor: `hsla(${hue}, 65%, 55%, 0.32)`,
      boxShadow: `inset 0 1px 0 rgba(255,220,170,0.10), inset 0 0 0 0.5px hsla(${hue}, 70%, 55%, 0.16), 0 0 24px hsla(${hue}, 70%, 52%, 0.08)`,
    };
  })();

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

  // forceClosed prop wins over local state — Wave 2's panel uses it to close
  // sibling rows when a new one opens. Effect-free: read straight into the
  // effective boolean used for data-* and transform.
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
  // of firing onSelect (prototype.html lines 509-518 tap-body semantic).
  // Desktop: click always fires onSelect (no swipe state to interfere).
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

  // ─── Render tree ───────────────────────────────────────────────────────────
  // Outer wrapper is `relative` (positions the mobile swipe strip) and
  // `overflow-hidden` on mobile so the row-body transform doesn't paint over
  // sibling rows. Wave 2's panel provides overall scroll clipping.
  const wrapperClass = isMobile
    ? "relative overflow-hidden"
    : "relative group/pcrow";

  // Compute the transform: during an active drag, use dxLive; otherwise snap
  // to open (-88) or closed (0). CSS transition happens via inline style
  // easing when NOT actively dragging.
  const activeDrag = dxLive !== null;
  const targetDx = activeDrag
    ? dxLive
    : effectiveOpen
      ? -PC_SWIPE_REVEAL
      : 0;
  const bodyTransformStyle: CSSProperties = isMobile
    ? {
        transform: `translateX(${targetDx}px)`,
        transition: activeDrag ? "none" : "transform 180ms ease",
      }
    : {};

  // Merge selected style with any transform style for the body.
  const bodyStyle: CSSProperties = {
    ...selectedStyle,
    ...bodyTransformStyle,
  };

  const bodyBaseClass =
    `${rowMinH} ${rowPadding} flex items-center ${rowGap} ` +
    "border border-transparent " +
    (selected ? "" : isMobile ? "active:bg-white/[0.03]" : "hover:bg-white/[0.03] ") +
    "cursor-pointer select-none " +
    "relative z-10";

  // Desktop pin-column visibility (hover-reveal for unpinned, always for
  // pinned). RDP rows skip this column entirely.
  const desktopPinVisibilityClass = pinned
    ? "opacity-100"
    : "opacity-0 group-hover/pcrow:opacity-100 focus-visible:opacity-100";

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
          variant AND non-RDP rows (T-Test-34: RDP rows can't be pinned). */}
      {isMobile && !isRdp && (
        <div
          className="absolute top-0 right-0 bottom-0 flex items-center justify-center z-0"
          style={{ width: `${PC_SWIPE_REVEAL}px` }}
          aria-hidden={!effectiveOpen}
        >
          <PinAction
            hue={hue}
            pinned={pinned}
            size="mobile"
            onClick={onPinClick}
          />
        </div>
      )}

      {/* Row body. On mobile this is what gets translated by the swipe. */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onBodyClick}
        onKeyDown={onBodyKeyDown}
        onTouchStart={isMobile && !isRdp ? onTouchStart : undefined}
        onTouchMove={isMobile && !isRdp ? onTouchMove : undefined}
        onTouchEnd={isMobile && !isRdp ? onTouchEnd : undefined}
        onTouchCancel={isMobile && !isRdp ? onTouchEnd : undefined}
        style={bodyStyle}
        className={bodyBaseClass}
      >
        {/* Avatar disc — identity avatar OR initial letter OR tabIcon fallback */}
        <div
          data-testid="pcrow-avatar"
          className={`shrink-0 ${avatarSize} rounded-full flex items-center justify-center overflow-hidden`}
          style={avatarStyle}
        >
          {identity ? (
            identity.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt=""
                className={`${avatarSize} object-cover rounded-full`}
                draggable={false}
              />
            ) : (
              <span
                className={`${avatarInitialTextSize} font-semibold text-white/95 leading-none tracking-tight`}
              >
                {(identity.displayName ?? "?").charAt(0).toUpperCase()}
              </span>
            )
          ) : (
            <span
              className={`${avatarInnerIconSize} inline-flex items-center justify-center text-muted-foreground`}
            >
              {tabIcon(row.type)}
            </span>
          )}
        </div>

        {/* Body column: label + host secondary line */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className={`flex items-center ${line1Gap} min-w-0`}>
            <span
              className={`${labelTextSize} font-medium truncate leading-tight ` +
                (selected
                  ? "text-[#fbf5e8]"
                  : hue == null
                    ? "text-foreground"
                    : "text-foreground")}
              style={{ letterSpacing: "-0.005em" }}
            >
              {row.label}
            </span>
          </div>
          {row.host && (
            <div className={`flex items-center ${line2Gap} min-w-0`}>
              <Server
                className={`${hostIconSize} text-muted-foreground/60 shrink-0`}
              />
              <span
                className={`${hostTextSize} text-muted-foreground/60 truncate leading-tight`}
              >
                {row.host.name}
              </span>
            </div>
          )}
        </div>

        {/* Right meta column */}
        <div className="shrink-0 flex items-center gap-1.5">
          {/* Pin glyph indicator (both variants, when pinned) */}
          {pinned && (
            <Pin
              className={`${pinGlyphSize} ${hue == null ? "text-muted-foreground/60" : ""}`}
              style={
                hue == null
                  ? undefined
                  : { color: `hsla(${hue}, 70%, 60%, 0.85)` }
              }
              aria-hidden="true"
            />
          )}

          {/* Desktop hover-reveal PinAction. Not rendered for mobile (which
              uses the swipe strip) or RDP rows (T-Test-34). */}
          {!isMobile && !isRdp && (
            <div className={desktopPinVisibilityClass}>
              <PinAction
                hue={hue}
                pinned={pinned}
                size="desktop"
                onClick={onPinClick}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
