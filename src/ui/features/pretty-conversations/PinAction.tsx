// ─── PinAction ───────────────────────────────────────────────────────────────
// Shared hue-tinted pin/unpin button used by both the mobile swipe-reveal
// strip and the desktop hover-reveal right column of PrettyConversationRow.
//
// Deliberately a dumb visual — no store subscription, no gesture handling, no
// row-select coordination. The row owns everything policy-level:
//   - The row decides when to render this (never for RDP rows; hover-gated
//     visibility on desktop; only inside the swipe strip on mobile).
//   - The row attaches e.stopPropagation() inside its onClick prop so the
//     row's own click handler doesn't fire when the pin is pressed. This
//     component just forwards the raw event to onClick.
//
// Phase 14B Slice 2 (Bug B): the mobile 48x48 hue-tinted circle chrome
// (rounded-full disc + inner-highlight box-shadow) was retired. Both
// viewports now render the mock's bare-icon-with-hue-drop-shadow treatment
// via the shared `.pv-pin-action` CSS class in pretty-conversations.css.
// Mobile keeps a bigger touch target (~32px hit area, via the CSS
// `.pv-pin-action[data-size="mobile"]` size variant) but visually still just
// the hue-glow pip on pinned rows. The `.pv-row:not(.pinned) .pv-meta .pv-pin`
// rule in the CSS continues to hide unpinned rows' pins unaffected.
//
// Visuals lifted verbatim from the Ashley-signed-off prototype:
//   - prototype.html lines 333-337 — bare-icon-with-hue-drop-shadow treatment
//     (`.meta .pin { color: hsla(var(--hue), 80%, 70%, 0.95);
//     filter: drop-shadow(0 0 4px hsla(var(--hue), 80%, 60%, 0.55)); }`).
//     Phase 13 Plan 03 (SHAPE-03) established the treatment for desktop;
//     Phase 14B extends it to mobile per Ashley 2026-07-24.
//
// Opacity / visibility is CSS-driven:
//   - Desktop: `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within)
//     .pv-pin-action { display: none }` — hidden on unpinned rows unless
//     hovered or keyboard-focused.
//   - Mobile: strip owns visibility; component never hides itself.
//
// No `animate-spin` or any other motion (per Phase 10 non-negotiables — the
// pin action is a static glyph).

import type { MouseEvent } from "react";
import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PinAction({
  hue: _hue,
  pinned,
  size,
  onClick,
  "data-testid": dataTestId,
}: {
  // hue is now unused at render time — the CSS class inherits `--pv-hue` from
  // the parent `.pv-row`. Kept in the props type for API stability across
  // both viewports (mobile and desktop) and future extension.
  hue: number | null;
  pinned: boolean;
  size: "mobile" | "desktop";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  "data-testid"?: string;
}) {
  const { t } = useTranslation();
  const label = pinned
    ? t("nav.conversations.unpin", { defaultValue: "Unpin" })
    : t("nav.conversations.pin", { defaultValue: "Pin" });

  // Unified bare-icon-with-hue-drop-shadow treatment. The CSS class applies
  // the color + filter via `hsla(var(--pv-hue), ...)` where `--pv-hue` is
  // inherited from the parent `.pv-row`. Icon size and hide-on-unpinned-non-
  // hovered rules are CSS-driven. `data-size` lets the CSS bump the mobile
  // hit-area up to ~32px without introducing button chrome.
  return (
    <button
      type="button"
      className="pv-pin-action"
      data-size={size}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={dataTestId ?? "pin-action"}
    >
      {pinned ? <PinOff /> : <Pin />}
    </button>
  );
}
