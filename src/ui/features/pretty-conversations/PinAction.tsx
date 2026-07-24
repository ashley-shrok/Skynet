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
//     inner-highlight box shadow) — preserved verbatim (mock v4 doesn't
//     cover mobile swipe-reveal; fork-only affordance).
//   - desktop: prototype.html lines 333-337 — bare-icon-with-hue-drop-shadow
//     treatment (`.meta .pin { color: hsla(var(--hue), 80%, 70%, 0.95);
//     filter: drop-shadow(0 0 4px hsla(var(--hue), 80%, 60%, 0.55)); }`).
//     Phase 13 Plan 03 (SHAPE-03) retires the Skynet button chrome
//     (`w-6 h-6 rounded-md bg-transparent border-0 hover:bg-white/[0.06]`
//     + `text-muted-foreground/60`) and delegates styling to the
//     `.pv-pin-action-desktop` selector in pretty-conversations.css. The
//     `--pv-hue` custom property is inherited from the parent `.pv-row`.
//
// Opacity / visibility is CSS-driven:
//   - Desktop: `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within)
//     .pv-pin-action-desktop { display: none }` — hidden on unpinned rows
//     unless hovered or keyboard-focused.
//   - Mobile: strip owns visibility; component never hides itself.
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
    // lines 226-228. UNCHANGED by Phase 13 Plan 03 — the mock is a desktop
    // layout and mobile swipe-reveal is a fork-only affordance Ashley kept.
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

  // Desktop: bare icon with hue-drop-shadow. All button-chrome retired — no
  // background, no border, no rounded-md wrapper, no hover:bg. CSS class
  // `.pv-pin-action-desktop` (declared in pretty-conversations.css) applies
  // the color + filter via `hsla(var(--pv-hue), ...)` where `--pv-hue` is
  // inherited from the parent `.pv-row`. Icon size and hide-on-unpinned-
  // non-hovered rules are also CSS-driven.
  return (
    <button
      type="button"
      className="pv-pin-action-desktop"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={dataTestId ?? "pin-action"}
    >
      {pinned ? <PinOff /> : <Pin />}
    </button>
  );
}
