// ─── HideAction ──────────────────────────────────────────────────────────────
// Shared hide/show button used by the mobile swipe-reveal strip and the
// desktop context menu of PrettyConversationRow. Renders EyeOff when the row
// is NOT hidden (Hide affordance) and Eye when the row IS hidden (Show
// affordance). Same dumb-visual contract as DeactivateAction: props are hue,
// size, hidden, onClick, data-testid. Uses .pv-hide-action CSS class.
//
// Design-locked placement rules (quick-260731-tgg):
//   AMBIENT rows (non-active-set, non-RDP, non-hidden):
//     mobile swipe strip → [PinAction, HideAction(EyeOff)]
//     desktop → context menu Hide item only (hover-reveal via CSS)
//   ACTIVE-SET rows (non-RDP, non-hidden):
//     mobile swipe strip → [PinAction, DeactivateAction] (NO HideAction here)
//     desktop → context menu only (long-press to hide on mobile, menu item)
//   HIDDEN rows (inside expanded Hidden section, mobile):
//     mobile swipe strip → [HideAction(Eye)] only (Show affordance)
//     desktop → context menu Show item
//
// NO animation, NO motion (per Phase 10 non-negotiable — static glyph only).
//
// Color palette: neutral gray (--color-pv-fg-muted) rather than the red-
// tinted deactivate palette. Hide reads as "less destructive than Deactivate
// but still a removal action" — a quiet secondary action.

import type { MouseEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function HideAction({
  hue: _hue,
  size,
  hidden,
  onClick,
  "data-testid": dataTestId,
}: {
  // hue is unused at render time — .pv-hide-action uses a fixed neutral-gray
  // palette (var(--color-pv-fg-muted)) rather than the identity-driven
  // --pv-hue. Kept in props for API symmetry with PinAction + DeactivateAction
  // so the row can pass hue uniformly to all actions without conditional shape.
  hue: number | null;
  size: "mobile" | "desktop";
  // When true: row is already hidden → render Eye (Show affordance).
  // When false: row is visible → render EyeOff (Hide affordance).
  hidden: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  "data-testid"?: string;
}) {
  const { t } = useTranslation();
  const label = hidden
    ? t("nav.conversations.show", { defaultValue: "Show" })
    : t("nav.conversations.hide", { defaultValue: "Hide" });

  return (
    <button
      type="button"
      className="pv-hide-action"
      data-size={size}
      data-hidden={hidden ? "true" : "false"}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={dataTestId ?? "hide-action"}
    >
      {hidden ? <Eye /> : <EyeOff />}
    </button>
  );
}
