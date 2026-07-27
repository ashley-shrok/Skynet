// ─── DeactivateAction ────────────────────────────────────────────────────────
// Shared red-tinted deactivate/close button used by both the mobile swipe-
// reveal strip and the desktop hover-reveal right column of
// PrettyConversationRow. Renders ONLY when the row is in Ashley's active-set
// AND non-RDP — row-level policy, this component is a dumb visual.
//
// quick-260727-gm3 (Ashley 2026-07-27 preview lockdown): deactivate is the
// pure REVERSE of tap-ambient-to-activate — click closes the tab AND removes
// the id from activeSet; the row recedes to ambient. Agent keeps running
// under the hood; tapping the row again reactivates it.
//
// Deliberately a dumb visual — no store subscription, no gesture handling, no
// row-select coordination. The row owns everything policy-level:
//   - The row decides when to render this (never for RDP rows; never for
//     ambient/non-active-set rows; hover-gated visibility on desktop via CSS;
//     side-by-side with PinAction inside the swipe strip on mobile).
//   - The row attaches e.stopPropagation() inside its onClick prop so the
//     row's own click handler doesn't fire when the X is pressed. This
//     component just forwards the raw event to onClick.
//
// Visual treatment mirrors PinAction's palette-driven bare-icon shape but
// with a red-tinted hue (hue=4, red-orange), sitting adjacent to the pin's
// identity-hue glyph without clashing. NOT a filled red pill — bare X icon
// with a subtle red drop-shadow, per Ashley's deactivate-preview.js console
// snippet.
//
// Opacity / visibility is CSS-driven:
//   - Desktop: `.pv-row.pv-row--desktop.active-set:not(:hover):not(:focus-within)
//     .pv-deactivate-action { display: none }` — hidden on active-set rows
//     unless hovered or keyboard-focused (mirrors pin hover-reveal). The
//     defensive `.pv-row.pv-row--desktop:not(.active-set) .pv-deactivate-action
//     { display: none }` guard covers the "row-level render should never
//     emit on ambient rows anyway" belt-and-suspenders case.
//   - Mobile: strip owns visibility; component never hides itself. Strip
//     also widens to 132px in Task 1 (see tokens.ts PC_SWIPE_REVEAL) to fit
//     both PinAction and DeactivateAction side-by-side.
//
// No `animate-spin` or any other motion (per Phase 10 non-negotiables — the
// deactivate action is a static glyph).

import type { MouseEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function DeactivateAction({
  hue: _hue,
  size,
  onClick,
  "data-testid": dataTestId,
}: {
  // hue is unused at render time — the CSS class uses a fixed red-orange
  // (hue=4) palette rather than the identity-driven --pv-hue that PinAction
  // inherits. Kept in the props type for API symmetry with PinAction so the
  // row can pass it uniformly to both actions without conditional prop shape.
  hue: number | null;
  size: "mobile" | "desktop";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  "data-testid"?: string;
}) {
  const { t } = useTranslation();
  const label = t("nav.conversations.deactivate", { defaultValue: "Deactivate" });

  return (
    <button
      type="button"
      className="pv-deactivate-action"
      data-size={size}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={dataTestId ?? "deactivate-action"}
    >
      <X />
    </button>
  );
}
