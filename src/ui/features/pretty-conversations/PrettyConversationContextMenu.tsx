import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ─── PrettyConversationContextMenu ────────────────────────────────────────
// Pretty-view-styled right-click menu for conversation rows on desktop
// non-RDP. Replaces the always-visible desktop Pin + Deactivate icons in
// the row's meta column so the row surface can be tapped without
// accidentally hitting those actions while switching between
// conversations.
//
// - Portal-mounted to document.body so nothing above it can clip the menu
//   (pretty-conversations panel + row all set overflow, backgrounds, and
//   z-indexes that would otherwise get in the way).
// - Positioned at cursor coords (clientX/Y), clamped to viewport so the
//   menu stays fully visible near edges/corners.
// - Escape or click-outside dismisses. Menu-item click also dismisses
//   after invoking the action.
// - Glass styling borrows from the pretty-view palette (#141520 base,
//   #e8e4d8 text) and accepts a hue token so the border/glow can inherit
//   the row's identity hue when the caller has one.
// ─────────────────────────────────────────────────────────────────────────

export interface PrettyContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface PrettyConversationContextMenuProps {
  x: number;
  y: number;
  items: PrettyContextMenuItem[];
  hue?: number | null;
  onClose: () => void;
}

const MENU_MIN_WIDTH = 168;
const VIEWPORT_MARGIN = 8;

// quick-260807-igo: delay between an item's onClick firing and the parent's
// onClose so the CSS :active tap-flash on `.pv-context-menu-item` has time to
// paint at least one frame before the portal tears down. 120ms is the shortest
// value that reliably survives a 60Hz paint cycle (~16.7ms/frame) with margin
// for slower mobile devices, while staying short enough that the menu still
// feels responsive on desktop mouse click. Guarded by a mounted-ref + timer
// clear on unmount so onClose never fires against a torn-down parent.
const FLASH_DISMISS_MS = 120;

export function PrettyConversationContextMenu({
  x,
  y,
  items,
  hue,
  onClose,
}: PrettyConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  // quick-260807-igo: mounted-ref guards the deferred onClose (see
  // FLASH_DISMISS_MS above). React 18+ StrictMode double-invokes effects, but
  // the ref is initialized to true and flipped to false only in the cleanup
  // path, so the guard is invariant across re-renders. The pending-timeout
  // ref lets the same cleanup effect clearTimeout on unmount so a torn-down
  // parent never gets a delayed onClose call.
  const mountedRef = useRef(true);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingTimeoutRef.current !== null) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
    };
  }, []);

  // Clamp menu into viewport once we know its measured size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + VIEWPORT_MARGIN > vw) {
      left = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    }
    if (top + rect.height + VIEWPORT_MARGIN > vh) {
      top = Math.max(VIEWPORT_MARGIN, vh - rect.height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [x, y]);

  // Dismiss on Escape or outside click.
  //
  // ⚠️ Outside-click listener MUST be `click` in the BUBBLING phase, NOT
  // `mousedown` in capture. Prior implementation used capture-phase mousedown
  // and hit a fleet-wide iOS Safari class of bug: a capture-phase
  // mousedown/pointerdown listener on a parent scope (window, document)
  // causes iOS to silently DROP the tap→click synthesis for taps on
  // descendant tap targets — even when the listener itself does nothing
  // observable. Symptom: user taps a menu item, :active flash paints from
  // touchstart, but the synthesized click never fires so item.onClick
  // never runs and nothing happens. Ashley confirmed via UAT ("touch pin
  // twice before it actually pins") — matched tiffany's independent
  // 30%-no-op signal on the compose textarea (patch #181 delegated
  // pointerdown-capture had the same effect on textarea taps). Diagnosed
  // 2026-08-08 via tiffany's textarea-tap-coordinate-mismatch-ios-diag
  // instrumentation. Fix pattern (this file's half): `click` bubbling on
  // window fires AFTER iOS has committed the click synth, so it doesn't
  // interfere with the synth path. Same pattern Radix/Floating UI use.
  // Inside-click bubbling is stopped on the menu container's own onClick
  // (see the div below), so a click inside the menu does not reach this
  // window listener and does not fire onClose. Keydown is unaffected —
  // iOS has no key-synth mechanism, so capture-phase keydown is fine.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick);
    };
  }, [onClose]);

  const hueVarStyle =
    typeof hue === "number"
      ? ({ ["--pv-id-hue" as string]: String(hue) } as React.CSSProperties)
      : undefined;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      onContextMenu={(e) => e.preventDefault()}
      // stopPropagation on the menu's own click so an inside-click bubbles
      // to this handler and STOPS — never reaches the window `click` listener
      // above (which would otherwise call onClose). Load-bearing: without
      // this, tapping a menu item would fire the item's onClick AND then
      // bubble up through the menu to window → dismiss → correct behavior
      // by accident (menu closes after item fires, same as before). WITH
      // this, dismiss only happens on OUTSIDE clicks reaching window, and
      // menu-item clicks let their own onClick's deferred setTimeout(onClose,
      // 120ms) drive dismiss so the :active flash paints (patch #330).
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        minWidth: MENU_MIN_WIDTH,
        zIndex: 200,
        padding: 4,
        borderRadius: 12,
        background:
          "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))",
        border:
          typeof hue === "number"
            ? "1px solid hsla(var(--pv-id-hue),65%,55%,0.32)"
            : "1px solid rgba(255,240,215,0.12)",
        boxShadow:
          "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)",
        backdropFilter: "blur(20px) saturate(1.6)",
        WebkitBackdropFilter: "blur(20px) saturate(1.6)",
        color: "#e8e4d8",
        ...hueVarStyle,
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            // Fire the action synchronously so parent state updates happen
            // right away. onClose is DEFERRED by FLASH_DISMISS_MS so the CSS
            // :active tap-flash on .pv-context-menu-item paints at least one
            // frame before the portal tears down. Deferred call is guarded by
            // the mounted-ref (see the mount/unmount effect above) so a
            // parent that unmounts mid-delay never receives a stale onClose.
            item.onClick();
            const t = setTimeout(() => {
              pendingTimeoutRef.current = null;
              if (mountedRef.current) onClose();
            }, FLASH_DISMISS_MS);
            pendingTimeoutRef.current = t;
          }}
          className="pv-context-menu-item py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            fontSize: 14,
            lineHeight: "18px",
            borderRadius: 8,
            border: "none",
            color: item.danger ? "#ff9a8a" : "#e8e4d8",
            cursor: "pointer",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
