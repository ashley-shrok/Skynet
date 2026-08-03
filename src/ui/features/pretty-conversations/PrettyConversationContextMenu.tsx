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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    // Use pointerdown/mousedown at the capture phase so we catch the click
    // that would otherwise fall through to a row body and re-open a menu.
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
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
            item.onClick();
            onClose();
          }}
          className="py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            fontSize: 14,
            lineHeight: "18px",
            borderRadius: 8,
            background: "transparent",
            border: "none",
            color: item.danger ? "#ff9a8a" : "#e8e4d8",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255,240,215,0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
