// ─── PrettyConversationRow ───────────────────────────────────────────────────
// The chunky Telegram-style row that IS the visual language of Phase 10.
// Every visual decision Ashley signed off on 2026-07-22 lives inside this
// component. Patch #136 (2026-07-23) rebased the visual layer onto Ashley's
// locked "Full + Normal" prototype v2 (Ashley approval 2026-07-23) — the
// prettyview bubble+badge language now applies to EVERY row (not only
// selected), and the avatar disc is derived from IdentityBadge.tsx's lg
// linear-gradient badge (previously radial-gradient):
//
//   1. 48px (mobile) / 40px (desktop) identity-hue avatar disc — linear-
//      gradient + hue border + IdentityBadge-derived multi-stop shadow
//      (adapted from IdentityBadge.tsx:58-62 & :76). Radial-gradient removed.
//   2. primary label + host-name secondary line (Server-icon glyph + name),
//      NO identity chip — session name IS identity name (Ashley: "the
//      label carries the identity presence")
//   3. Full pretty-view bubble treatment on EVERY non-RDP row with hue != null
//      (0.55/0.60 gradient, 0.32 hue border, full multi-stop shadow). Hover
//      lifts the row + strengthens the hue glow; selected uses the strongest
//      treatment (0.55 hue border, 1px hue ring, 56px glow).
//   4. Same component drives both viewports via a `variant` prop:
//        - variant="mobile"  → 72px chunky row, swipe-left past 40px reveals a
//                             48x48 PinAction in an 88px right-anchored strip;
//                             tap on swiped-open row closes it (does not select)
//        - variant="desktop" → 62px row, hover-reveal 24x24 PinAction in the
//                             right meta column; always visible for pinned rows
//   5. RDP rows (row.rdpHostRow === true) skip swipe wiring AND skip PinAction
//      in both variants (T-Test-34 preserved) — body + avatar use the neutral
//      (60,65,80 / 30,33,44) glass treatment instead of the hue treatment
//   6. Rows with no identity fall back to the cool-slate neutral bubble
//      (45,55,80 / 28,35,55 at full alpha) — still gets a tabIcon avatar
//      via the existing sessionMatchKey + useIdentities carry-through
//   7. `isWip` prop (patch #136 render slot; patch #137 wires the store):
//      when true, renders a bare-glyph pulse dot as the LAST child in the
//      right-meta column with aria-label="working". Animates via CSS
//      keyframe `pv-conv-wip-pulse` (index.css). Respects
//      prefers-reduced-motion.
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
  isWip = false,
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  onSwipeOpenChange?: (open: boolean) => void;
  forceClosed?: boolean;
  // Patch #136 render slot — when true, renders a bare-glyph
  // pulse dot as the LAST child in the right-meta column with
  // aria-label="working" (animated via pv-conv-wip-pulse
  // keyframes in index.css). Patch #137 will wire this to a
  // store subscription; #136 always passes false from the panel.
  isWip?: boolean;
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

  // ─── Avatar style (patch #136 — IdentityBadge lg-derived) ──────────────────
  // Adapted from IdentityBadge.tsx:58-62 (hue linear-gradient + border) and
  // :76 (multi-stop shadow). Radial-gradient retired 2026-07-23 per Ashley's
  // prototype v2 lock. RDP rows get the neutral (60,65,80 / 30,33,44) glass
  // treatment; hue-null non-RDP rows keep the cool-slate (45,55,80 /
  // 28,35,55) neutral treatment.
  const avatarStyle: CSSProperties = (() => {
    if (isRdp || hue == null) {
      const [c1, c2, borderRgba] = isRdp
        ? ["rgba(60,65,80,0.72)", "rgba(30,33,44,0.82)", "rgba(220,225,245,0.22)"]
        : ["rgba(45,55,80,0.72)", "rgba(28,35,55,0.82)", "rgba(120,140,180,0.35)"];
      return {
        background: `linear-gradient(160deg, ${c1}, ${c2})`,
        border: `1px solid ${borderRgba}`,
        boxShadow:
          "0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(220,225,245,0.20), 0 0 24px rgba(220,225,245,0.12)",
        color: "var(--color-pv-fg-muted)",
      };
    }
    return {
      background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
      border: `1px solid hsla(${hue}, 65%, 55%, 0.40)`,
      boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.40)`,
      color: "#fbf5e8",
      textShadow: "0 1px 1px rgba(0,0,0,0.4)",
    };
  })();

  // ─── Body-bubble treatment (patch #136 — every row, not selected-only) ─────
  // Full pretty-view assistant-bubble intensity (0.55/0.60 gradient, 0.32
  // hue border, multi-stop shadow) applies to EVERY non-RDP row with
  // hue != null. Hover overlays translateY(-1px) + stronger hue glow;
  // selected overlays the strongest treatment (0.55 hue border, 1px hue
  // ring, 56px glow). RDP rows and hue-null non-RDP rows get their own
  // neutral bubble treatments.
  const [hovered, setHovered] = useState(false);

  // Compute per-branch color tuple: [gradC1, gradC2, borderRgba,
  // hairlineRgba, glowRgba]. Selected/hover overlays layer on top.
  const [gradC1, gradC2, borderRgba, hairlineRgba, glowRgba]: [
    string,
    string,
    string,
    string,
    string,
  ] =
    isRdp
      ? [
          "rgba(60,65,80,0.42)",
          "rgba(30,33,44,0.58)",
          "rgba(220,225,245,0.14)",
          "rgba(220,225,245,0.06)",
          "rgba(220,225,245,0.05)",
        ]
      : hue == null
        ? [
            "rgba(45,55,80,0.55)",
            "rgba(28,35,55,0.60)",
            "rgba(120,140,180,0.32)",
            "rgba(120,140,180,0.16)",
            "rgba(120,140,180,0.08)",
          ]
        : [
            `hsla(${hue}, 50%, 38%, 0.55)`,
            `hsla(${hue}, 45%, 24%, 0.60)`,
            `hsla(${hue}, 65%, 55%, 0.32)`,
            `hsla(${hue}, 70%, 55%, 0.20)`,
            `hsla(${hue}, 70%, 52%, 0.18)`,
          ];
  const insetHighlight =
    isRdp || hue == null
      ? "rgba(220,225,245,0.10)"
      : "rgba(255,220,170,0.18)";

  const baseBodyStyle: CSSProperties = {
    background: `linear-gradient(160deg, ${gradC1}, ${gradC2})`,
    border: `1px solid ${borderRgba}`,
    boxShadow: `0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 ${insetHighlight}, 0 0 0 0.5px ${hairlineRgba}, 0 0 32px ${glowRgba}`,
    borderRadius: 14,
    color: "#fbf5e8",
    backdropFilter: "blur(20px) saturate(1.5)",
    WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  };

  // Selected overlay: strongest treatment. 1px hue ring (not 0.5px),
  // 56px glow, 0 14px 32px outer shadow, translateY(-1px), 0.55 border
  // alpha (hue) or per-branch neutral analog.
  const selectedBorderColor =
    isRdp
      ? "rgba(220,225,245,0.24)"
      : hue == null
        ? "rgba(120,140,180,0.55)"
        : `hsla(${hue}, 70%, 60%, 0.55)`;
  const selectedHairline =
    isRdp
      ? "rgba(220,225,245,0.20)"
      : hue == null
        ? "rgba(120,140,180,0.42)"
        : `hsla(${hue}, 70%, 55%, 0.42)`;
  const selectedGlow =
    isRdp
      ? "rgba(220,225,245,0.12)"
      : hue == null
        ? "rgba(120,140,180,0.34)"
        : `hsla(${hue}, 70%, 52%, 0.34)`;
  const selectedOverlay: CSSProperties = selected
    ? {
        transform: "translateY(-1px)",
        borderColor: selectedBorderColor,
        boxShadow: `0 14px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.28), 0 0 0 1px ${selectedHairline}, 0 0 56px ${selectedGlow}`,
      }
    : {};

  // Hover overlay: only on desktop (not mobile — no hover concept) and
  // only on unselected rows (selected already dominates). 0.42 border,
  // 0.28 hairline, 0.26 glow, 0 12px 28px outer, 40px glow.
  const hoverBorderColor =
    isRdp
      ? "rgba(220,225,245,0.20)"
      : hue == null
        ? "rgba(120,140,180,0.42)"
        : `hsla(${hue}, 70%, 55%, 0.42)`;
  const hoverHairline =
    isRdp
      ? "rgba(220,225,245,0.14)"
      : hue == null
        ? "rgba(120,140,180,0.28)"
        : `hsla(${hue}, 70%, 55%, 0.28)`;
  const hoverGlow =
    isRdp
      ? "rgba(220,225,245,0.10)"
      : hue == null
        ? "rgba(120,140,180,0.26)"
        : `hsla(${hue}, 70%, 52%, 0.26)`;
  const shouldHover = !isMobile && !selected && hovered;
  const hoverOverlay: CSSProperties = shouldHover
    ? {
        transform: "translateY(-1px)",
        borderColor: hoverBorderColor,
        boxShadow: `0 12px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,220,170,0.22), 0 0 0 0.5px ${hoverHairline}, 0 0 40px ${hoverGlow}`,
      }
    : {};

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

  // Merge base bubble + hover/selected overlay + transform for the body.
  // Order matters: base first, then hover, then selected (selected wins);
  // then transform (mobile swipe) on top so it applies unconditionally.
  // Desktop-only transition for hover/selected lift + shadow easing;
  // mobile relies on bodyTransformStyle's own swipe transition (which
  // spreads AFTER this key and correctly overrides on mobile).
  const desktopBodyTransition: CSSProperties = isMobile
    ? {}
    : {
        transition:
          "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease",
      };
  const bodyStyle: CSSProperties = {
    ...baseBodyStyle,
    ...hoverOverlay,
    ...selectedOverlay,
    ...desktopBodyTransition,
    ...bodyTransformStyle,
  };

  const bodyBaseClass =
    `${rowMinH} ${rowPadding} flex items-center ${rowGap} ` +
    "cursor-pointer select-none relative z-10";

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
        onMouseEnter={
          !isMobile && !selected ? () => setHovered(true) : undefined
        }
        onMouseLeave={
          !isMobile && !selected ? () => setHovered(false) : undefined
        }
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
              className={`${labelTextSize} font-semibold text-[#fbf5e8] truncate leading-tight`}
              style={{
                letterSpacing: "-0.005em",
                textShadow: "0 1px 2px rgba(0,0,0,0.4)",
              }}
            >
              {row.label}
            </span>
          </div>
          {row.host && (
            <div className={`flex items-center ${line2Gap} min-w-0`}>
              <Server
                className={`${hostIconSize} shrink-0`}
                style={{ color: "rgba(255,235,190,0.65)" }}
              />
              <span
                className={`${hostTextSize} truncate leading-tight`}
                style={{ color: "rgba(255,235,190,0.65)" }}
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

          {/* Patch #136 WIP render slot — bare-glyph pulse dot as the LAST
              child in the right-meta column (after PinAction and pin glyph).
              Neutral rgba background when hue is null; hue-based hsla
              otherwise. Animated by pv-conv-wip-pulse keyframes in
              index.css; prefers-reduced-motion freezes it as a static
              bright dot via [data-pv-conv-wip-dot="true"] selector. */}
          {isWip && (
            <span
              aria-label="working"
              data-pv-conv-wip-dot="true"
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background:
                  hue == null
                    ? "rgba(220,225,245,0.95)"
                    : `hsla(${hue}, 85%, 65%, 0.95)`,
                boxShadow:
                  hue == null
                    ? "0 0 10px 1px rgba(220,225,245,0.85), 0 0 20px 2px rgba(220,225,245,0.35)"
                    : `0 0 10px 1px hsla(${hue}, 85%, 55%, 0.85), 0 0 20px 2px hsla(${hue}, 85%, 55%, 0.35)`,
                animation:
                  "pv-conv-wip-pulse 1.35s ease-in-out infinite",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
