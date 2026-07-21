// ─── ConversationRow ─────────────────────────────────────────────────────────
// A single row in the Telegram-style conversation list. Deliberately simpler
// than SidebarTree's HostItem — no action tray, no bulk-select, no folder
// mgmt — but visually matches the existing sidebar chrome (same padding
// tokens, same font sizes, same accent-brand selected-state treatment as the
// AppRail's selected-tab idiom).
//
// Reuses (deliberately, do NOT reinvent — CONTEXT.md canonical_refs lock):
//   - `tabIcon(row.type)` from @/shell/tabUtils for the icon vocabulary
//   - `sessionMatchKey` + `useIdentities` from @/features/terminal/session-hue
//     for identity avatar carry-through (patch #17 pattern) — EXACT copy of
//     TabBar.tsx's `renderTabIcon` + `tabTintStyle` idiom so identity-tinted
//     tabs continue to read the same after the tab-strip is deleted.
//
// No new npm deps. No browser storage. Zero touches to pretty-view /
// terminal / guacamole internals (Phase 6 scope-fence).

import type { CSSProperties } from "react";
import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { tabIcon } from "@/shell/tabUtils";
import { useIdentities } from "@/state/identities-store";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";

export function ConversationRow({
  row,
  selected,
  pinned,
  onSelect,
  onTogglePin,
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useTranslation();
  const isTouchDevice = useIsTouchDevice();
  const { byKey: identitiesByKey } = useIdentities();

  // Identity carry-through — same shape as TabBar.tsx renderTabIcon (lines 60-74)
  const key = sessionMatchKey(row.targetTmuxSession);
  const identity = key ? identitiesByKey.get(key) ?? null : null;

  // Identity-hue tint — same shape as TabBar.tsx tabTintStyle (lines 76-86).
  // linear-gradient sits on top of any bg-* class so hover/selected states
  // remain visible underneath.
  const tintStyle: CSSProperties = (() => {
    const hue = identity?.colorHue ?? null;
    if (hue == null) return {};
    const tint = `hsla(${hue}, 75%, 52%, 0.18)`;
    return { backgroundImage: `linear-gradient(${tint}, ${tint})` };
  })();

  // Selected treatment mirrors AppRail's selected-tab chip:
  // `text-accent-brand bg-accent-brand/10` (see AppRail.tsx line 173).
  const selectedClass = selected
    ? "bg-accent-brand/10 text-accent-brand"
    : "text-foreground hover:bg-muted/40";

  // Pin toggle chrome: always-visible on touch, hover-reveal on desktop.
  // Matches SidebarTree HostItem's tray-affordance pattern (opacity-0
  // group-hover:opacity-100) so the row stays visually calm at rest.
  const pinBtnVisibilityClass = isTouchDevice
    ? "opacity-100"
    : pinned
      ? "opacity-100"
      : "opacity-0 group-hover/convrow:opacity-100 focus-visible:opacity-100";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group/convrow flex items-stretch cursor-pointer select-none transition-colors ${selectedClass}`}
      style={tintStyle}
      data-conversation-id={row.id}
      data-selected={selected ? "true" : "false"}
    >
      {/* Icon column — identity avatar OR tabIcon fallback. Same size + shape
          vocabulary as TabBar so the visual "which session is this" stays
          the same after the tab strip is deleted. */}
      <div className="flex items-center justify-center w-7 shrink-0">
        {identity ? (
          <img
            src={identity.avatarUrl}
            alt=""
            className="size-4 object-cover shrink-0"
            draggable={false}
          />
        ) : (
          <span className="flex items-center justify-center">
            {tabIcon(row.type)}
          </span>
        )}
      </div>

      {/* Body: label (primary) + host name (secondary muted) */}
      <div className="flex flex-col flex-1 min-w-0 px-2 pt-2 pb-1.5 gap-0.5">
        <span className="text-[13px] font-medium truncate leading-none">
          {row.label}
        </span>
        {row.host && (
          <span className="text-[11px] text-muted-foreground/60 truncate leading-none">
            {row.host.name}
          </span>
        )}
      </div>

      {/* Pin toggle — right column. e.stopPropagation() so the row's onClick
          doesn't also fire when the user clicks the pin. */}
      <div className="flex items-center pr-2 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={
            pinned
              ? t("nav.conversations.unpin", { defaultValue: "Unpin" })
              : t("nav.conversations.pin", { defaultValue: "Pin" })
          }
          aria-label={
            pinned
              ? t("nav.conversations.unpin", { defaultValue: "Unpin" })
              : t("nav.conversations.pin", { defaultValue: "Pin" })
          }
          className={`flex items-center justify-center size-6 rounded transition-colors ${pinBtnVisibilityClass} ${pinned ? "text-accent-brand hover:text-accent-brand/80" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60"}`}
        >
          {pinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
