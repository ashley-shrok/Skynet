import { useEffect, useRef } from "react";
import { useIdentities } from "@/state/identities-store";

export interface IdentityBadgeProps {
  identityKey: string | null;
  // When provided, the badge renders as a <button> with click affordance
  // (cursor-pointer, hover scale, aria-label). When absent, the badge
  // renders as a <div aria-hidden> — backward-compat with call sites
  // that don't wire the click.
  onClick?: () => void;
  // Quick 260806-lzd: tap-and-hold gesture primitive. When provided, a
  // 500ms `pointerdown` timer arms on pointerdown and fires onLongPress
  // if not cancelled by pointermove / pointerup / pointercancel first.
  // A completed long-press suppresses the trailing onClick so long-press
  // and tap are mutually exclusive (deterministic single-outcome per
  // gesture). Both call sites (Terminal.tsx terminal-mode surface,
  // PrettyView.tsx pretty-view surface) wire this to togglePrettyMode —
  // parity with AppShell's Ctrl+Shift+O keyboard shortcut, which stays
  // routed through the imperative-handle path (unchanged).
  onLongPress?: () => void;
}

// Quick 260806-lzd — single-variant refactor. The former `md` branch
// (patch #17/#38 terminal-pane treatment, 120px pill, 80px round avatar,
// hover-opacity-fade) is REMOVED entirely. Only the former `lg` treatment
// renders (glass pill, 56px avatar left, name+title right, hue-driven
// rim/glow, pv-identity-breathe 5s animation). The `size` prop is gone;
// no default value, no branch. This ships Ashley's "one identity badge
// treatment across terminal + pretty-view" decision.
export function IdentityBadge({
  identityKey,
  onClick,
  onLongPress,
}: IdentityBadgeProps) {
  const { byKey } = useIdentities();
  const identity = identityKey ? byKey.get(identityKey.toLowerCase()) : null;

  // Long-press timer bookkeeping. Refs so mutation doesn't re-render.
  //   timerRef        — the setTimeout id while armed; null once cleared/fired.
  //   longPressFiredRef — true from the moment onLongPress ran until the next
  //                       onPointerDown resets it. Used to gate the trailing
  //                       onClick so a completed long-press does NOT also open
  //                       the modal (test E).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  // Unmount safety: clear any armed timer so a component-unmount mid-press
  // does not invoke a stale onLongPress (T-260806-lzd-01 mitigation).
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  if (!identity) return null;

  // Identity hue drives border + inset rim + outer glow. NULL colorHue
  // falls back to hue 35 (warm amber, matches PrettyView's neutral
  // --pv-id-hue fallback). Font stack Inter for name/title.
  const hue = identity.colorHue ?? 35;
  const rootClassName = `pv-identity-breathe absolute top-4 right-5 z-[101] flex flex-row items-center gap-3 select-none font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif] transition-transform hover:scale-[1.015] active:scale-[0.995] hover:shadow-[0_8px_24px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,220,170,0.22),_0_0_56px_hsla(${hue},65%,55%,0.42)]`;
  const rootStyle: React.CSSProperties = {
    // Pill shape: border-radius 36 + padding 8 16 8 8 makes a capsule
    // where the 56px avatar circle sits concentric to the left curve.
    borderRadius: 36,
    padding: "8px 18px 8px 8px",
    background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
    backdropFilter: "blur(24px) saturate(1.4)",
    WebkitBackdropFilter: "blur(24px) saturate(1.4)",
    border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
    boxShadow: `0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(${hue}, 65%, 55%, 0.28)`,
    color: "#e8e4d8",
    animation: "pv-identity-breathe 5s ease-in-out infinite",
  };
  const inner = (
    <>
      <img
        src={identity.avatarUrl}
        alt=""
        className="object-cover shrink-0"
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
        }}
        draggable={false}
      />
      <div className="flex flex-col min-w-0">
        <span
          className="font-semibold truncate leading-tight"
          style={{ fontSize: 15, color: "#f0ebe0" }}
        >
          {identity.displayName}
        </span>
        {identity.title && (
          <span
            className="truncate leading-tight"
            style={{ fontSize: 12, color: "#a89a80" }}
          >
            {identity.title}
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    // Interactive branch: <button> with click affordance. Tailwind v4
    // does NOT default `<button>` to cursor: pointer, so `cursor-pointer`
    // is explicit on the button className (patch #89 rationale carried
    // through the consolidation).
    //
    // Long-press wiring: only attached when onLongPress is provided.
    // When absent, the button behaves exactly like a plain click target
    // (backward-compat for callers that only want tap).
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const handlePointerDown = onLongPress
      ? () => {
          // Fresh press → reset the fired flag so a prior completed
          // long-press does not indefinitely swallow taps.
          longPressFiredRef.current = false;
          clearTimer();
          timerRef.current = setTimeout(() => {
            longPressFiredRef.current = true;
            timerRef.current = null;
            onLongPress();
          }, 500);
        }
      : undefined;
    const handlePointerMove = onLongPress
      ? () => {
          // Any pointer movement while armed cancels the long-press.
          // Ashley wants deliberate press, not accidental hover-slide.
          clearTimer();
        }
      : undefined;
    const handlePointerUp = onLongPress
      ? () => {
          // Release before 500ms → cancel armed timer and let the
          // synthetic click fire normally (tap semantics).
          clearTimer();
        }
      : undefined;
    const handlePointerCancel = onLongPress
      ? () => {
          clearTimer();
        }
      : undefined;
    const handleClick = () => {
      // A completed long-press already dispatched onLongPress; the trailing
      // synthetic click that browsers fire after pointerup on a <button>
      // must NOT also open the modal. Reset the flag so subsequent taps
      // still work.
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      onClick();
    };
    return (
      <button
        type="button"
        data-testid="identity-badge-root"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label="Open identity info"
        title="Identity info"
        className={`${rootClassName} cursor-pointer`}
        style={rootStyle}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      data-testid="identity-badge-root"
      aria-hidden="true"
      className={rootClassName}
      style={rootStyle}
    >
      {inner}
    </div>
  );
}
