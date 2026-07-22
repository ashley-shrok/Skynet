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
// Visuals come verbatim from the Ashley-signed-off prototypes:
//   - mobile: prototype.html lines 210-228 (48x48 hue-tinted circle with
//     inner-highlight box shadow)
//   - desktop: desktop.html lines 366-386 (24x24 rounded-md with transparent
//     background, hue-colored icon when pinned, muted when unpinned)
//
// Opacity / visibility is the ROW's responsibility (hover-reveal on desktop,
// always-present-when-strip-revealed on mobile). This component never
// hides itself.
//
// No `animate-spin` or any other motion (per Phase 10 non-negotiables — the
// pin action is a static glyph).

import type { MouseEvent } from "react";
import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PinAction({
  hue,
  pinned,
  size,
  onClick,
  "data-testid": dataTestId,
}: {
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

  if (size === "mobile") {
    // Mobile: 48x48 hue-tinted disc inside the swipe-reveal strip. Hue null
    // falls back to the neutral blue-gray no-identity treatment per prototype
    // lines 226-228.
    const bg =
      hue == null
        ? "rgba(90,105,140,0.9)"
        : `hsla(${hue}, 60%, 42%, 0.95)`;
    const borderColor =
      hue == null
        ? "rgba(120,140,180,0.55)"
        : `hsla(${hue}, 70%, 55%, 0.6)`;
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        data-testid={dataTestId ?? "pin-action"}
        style={{
          background: bg,
          borderColor,
        }}
        className={
          "inline-flex items-center justify-center " +
          "w-12 h-12 rounded-full " +
          "border text-white/95 " +
          "shadow-[0_3px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.15)] " +
          "[-webkit-tap-highlight-color:transparent] " +
          "cursor-pointer select-none"
        }
      >
        {pinned ? <PinOff className="w-5 h-5" /> : <Pin className="w-5 h-5" />}
      </button>
    );
  }

  // Desktop: 24x24 rounded-md, transparent background. Hue-colored icon when
  // pinned; muted when unpinned. No opacity/visibility class here — the row
  // wraps this button in a container whose classes drive hover-reveal.
  const iconColorStyle =
    hue == null
      ? undefined
      : pinned
        ? { color: `hsla(${hue}, 70%, 60%, 0.85)` }
        : undefined;
  const iconClassBase =
    hue == null
      ? pinned
        ? "text-muted-foreground/60"
        : "text-muted-foreground/60 hover:text-foreground"
      : pinned
        ? ""
        : "text-muted-foreground/60 hover:text-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={dataTestId ?? "pin-action"}
      style={iconColorStyle}
      className={
        "inline-flex items-center justify-center " +
        "w-6 h-6 rounded-md bg-transparent border-0 " +
        "hover:bg-white/[0.06] " +
        "transition-colors duration-100 " +
        "cursor-pointer " +
        iconClassBase
      }
    >
      {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
    </button>
  );
}
