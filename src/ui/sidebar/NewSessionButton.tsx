// ─── NewSessionButton ────────────────────────────────────────────────────────
// Primary CTA at the top of the ConversationsPanel scroller (above pins,
// both mobile and desktop). Clicking opens the NewSessionDialog host picker.
// Distinct from the gear icon in the panel header — this is the primary
// affordance for starting a new conversation; the gear is unobtrusive
// settings chrome (TG-09 vs TG-10 separation).
//
// Visual language mirrors HostsPanel's "Add host" button (lines 688-697)
// for cross-sidebar consistency: accent-brand outline + h-7 + text label.
//
// Plan 07-02 (TG-16): icon is `Pencil` (Telegram-native pencil vocabulary
// — the Telegram compose-a-new-message affordance is a pencil glyph, not a
// plus). Function is UNCHANGED — button still opens the same NewSessionDialog
// with the same host picker + session-name flow (Plan 06-04 machinery
// preserved verbatim). Only the icon (Plus → Pencil) and the icon import
// line change; every other button chrome token (type, onClick, title,
// aria-label, className, i18n `t("nav.newSession")`) is byte-identical.
//
// Zero external state — the button is a dumb <button> that fires onOpen.
// Local dialog state lives in the ConversationsPanel parent (Task 3).

import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NewSessionButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const label = t("nav.newSession", { defaultValue: "New session" });
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 border border-accent-brand/30 rounded-sm shrink-0 transition-colors w-full justify-center"
    >
      <Pencil className="size-3 shrink-0" />
      {label}
    </button>
  );
}
