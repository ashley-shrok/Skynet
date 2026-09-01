import { useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { useIdentities } from "@/state/identities-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { avatarUrlWithHost } from "@/api/identities-api";

export interface IdentityBadgeProps {
  identityKey: string | null;
  /** Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar requires
   *  hostId query param. When supplied, the avatar img src routes through
   *  avatarUrlWithHost(identity, hostId). Both existing call sites
   *  (PrettyView + IdentitySessionPane) already carry hostId in scope. Left
   *  optional so any future call site without hostId still renders (the img
   *  degrades to a 400 → placeholder via the browser's built-in broken-image
   *  handling; the badge itself doesn't crash). */
  hostId?: number;
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
  // Phase 58 Plan 01: identity-badge as third-gesture drag source.
  // When provided AND useIsMobile() is false, the badge root becomes
  // draggable=true and a dragstart handler writes the wire contract
  // (text/plain: tabId + application/x-skynet-badge: JSON.stringify({tabId}))
  // to dataTransfer with effectAllowed="move". Downstream drop targets
  // discriminate on the application/x-skynet-badge MIME:
  //   - Phase 56 Pane onDrop reads text/plain and routes to
  //     openSessionInTree(tabId, path, edge) — rearranges within the tree.
  //   - Phase 58 Plan 02 conv-list onDrop reads application/x-skynet-badge
  //     and calls closeTab(tabId) — full close.
  // Absent tabId OR mobile viewport → draggable=false, no handler wired.
  // Coexists with onClick + onLongPress via the browser's ~5px HTML5 drag
  // threshold (fires ABOVE the pointerdown/up level the click + long-press
  // paths use, so no explicit disambiguation code is needed — same
  // mechanism Phase 56 patch #511 established for PrettyConversationRow).
  tabId?: string;
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
  hostId,
  onClick,
  onLongPress,
  tabId,
}: IdentityBadgeProps) {
  const { byKey } = useIdentities();
  const identity = identityKey ? byKey.get(identityKey.toLowerCase()) : null;
  // Phase 58 Plan 01 (PV58-GESTURE-COEXISTENCE): mobile viewport suppresses
  // the drag source entirely — SplitView is desktop-only per
  // AppShell.tsx:2372 `{!isMobile && (<SplitView…/>)}`, so a draggable badge
  // on mobile would land on nothing useful. Explicit gate here matches the
  // shell-level mount gate.
  const isMobile = useIsMobile();
  const isDragSource = !!tabId && !isMobile;

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
  // Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar requires
  // hostId query param. Route through avatarUrlWithHost when hostId is in
  // scope (both existing call sites carry it); fall back to raw identity.avatarUrl
  // otherwise. The raw form now 400s at the backend (Plan 03 gate) → browser
  // shows a broken-image affordance, which is the intended degraded render for
  // callers that omit hostId (a rare or programmer-error path today).
  const avatarSrc =
    hostId != null ? avatarUrlWithHost(identity, hostId) : identity.avatarUrl;
  const inner = (
    <>
      <img
        src={avatarSrc}
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

  // Phase 58 Plan 01: dragstart handler. Wired only when isDragSource is true
  // (both render branches, <button> and <div>, share the same handler).
  //
  // dataTransfer payload contract (PV58-BADGE-PAYLOAD-DUAL-MIME):
  //   1. text/plain: tabId               — matches Phase 56 Pane onDrop
  //                                        text/plain branch at SplitView.tsx
  //                                        which routes to openSessionInTree
  //                                        (rearrange path — reused as-is).
  //   2. application/x-skynet-badge:
  //        JSON.stringify({tabId})       — NEW MIME distinct from patch #511's
  //                                        row-drag MIME. Phase 58 Plan 02
  //                                        conv-list onDrop reads this to
  //                                        discriminate badge-close from
  //                                        stray row drags. Payload minimal.
  //   3. effectAllowed = "move"          — matches conv-list row convention.
  //
  // Structured log (PV58-STRUCTURED-LOGGING, T-58-01-01 mitigation):
  // Explicit-field extraction ONLY — tabId + hasIdentity boolean. Do NOT
  // JSON.stringify the DragEvent (leaks React SyntheticEvent internals and
  // fights the fleet logging directive Ashley 2026-08-11). No PII (no
  // displayName, no colorHue, no avatar url).
  const onDragStart = isDragSource
    ? (e: ReactDragEvent<HTMLElement>) => {
        // tabId is non-null when isDragSource is true (the !!tabId gate),
        // but TS narrows it via the ternary above — assert here.
        const id = tabId!;
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.setData(
          "application/x-skynet-badge",
          JSON.stringify({ tabId: id }),
        );
        e.dataTransfer.effectAllowed = "move";
        console.info(
          `[badge-drag] tabId=${id} hasIdentity=${identity !== null}`,
        );
      }
    : undefined;

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
        draggable={isDragSource}
        onDragStart={onDragStart}
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
      draggable={isDragSource}
      onDragStart={onDragStart}
      className={rootClassName}
      style={rootStyle}
    >
      {inner}
    </div>
  );
}
