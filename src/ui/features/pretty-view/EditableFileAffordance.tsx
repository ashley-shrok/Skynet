import type { MouseEvent } from "react";
import { Pencil } from "lucide-react";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";

/**
 * Phase 40 Plan 40-03 Task 1 — per-link edit affordance.
 *
 * LOCKED decisions honored:
 *   - D-03 (additive-not-replacive → sibling to the anchor, never a wrapper).
 *     Per UI-SPEC L136 this component renders as a single <button> element
 *     that Plan 40-04 will mount as a SIBLING to the ReactMarkdown-rendered
 *     <a> inside a React fragment. Any wrapping regression is caught by
 *     EditableFileAffordance.test.tsx Test 6.
 *   - UI-SPEC L124 (visual treatment): warm-coral (`#ffb896` via
 *     `--color-pv-code-fg`) glyph at rest; identity-hue + drop-shadow on
 *     hover (mirrors PinAction.tsx's bare-icon-with-hue-drop-shadow idiom
 *     locked in Phase 13 SHAPE-03). Pencil icon at 16px.
 *   - Research Assumption A5 (bubble container class dependency): the
 *     desktop hover-reveal uses the arbitrary Tailwind variant
 *     `[.pv-bubble:hover_&]:opacity-100`. This depends on the parent
 *     ChatMessage bubble div having `pv-bubble` in its className list —
 *     Plan 40-04 Task 1 is on the hook to add that class (or switch to a
 *     `group`/`group-hover:` pattern if the bubble adopts `group` instead).
 *     Until then the affordance degrades gracefully to "always invisible
 *     on desktop" (opacity-0 with no reveal trigger) — safe fail.
 *
 * Per-viewport interaction contract (UI-SPEC L146-147):
 *   - Mobile: always visible at ~72% opacity, 44x44 min touch target per
 *     Apple HIG (UI-SPEC L215). Uses the same
 *     `[@media(hover:none)]:!opacity-[0.72]` idiom as the speak button
 *     at ChatMessage.tsx:496.
 *   - Desktop: opacity-0 at rest → 100% on parent .pv-bubble hover with
 *     a 120ms transition. Hover-on-affordance flips glyph color to
 *     identity-hue with a 6px identity-hue drop-shadow.
 */

export function EditableFileAffordance({
  onOpen,
  filename,
}: {
  onOpen: () => void;
  filename: string;
}): JSX.Element {
  const isTouchDevice = useIsTouchDevice();
  const label = `Edit ${filename}`;

  const baseClasses =
    "inline-flex items-center gap-1 align-baseline ml-1 cursor-pointer " +
    "text-[color:var(--color-pv-code-fg)] transition-opacity duration-[120ms]";

  // Mobile: always visible at ~72% opacity, 44x44 min touch target per Apple
  // HIG (UI-SPEC L215). Uses the same [@media(hover:none)]:!opacity idiom as
  // the speak button at ChatMessage.tsx:496.
  const mobileClasses =
    "min-w-[44px] min-h-[44px] justify-center [@media(hover:none)]:!opacity-[0.72]";

  // Desktop: hover-reveal on parent bubble. Requires the parent .pv-bubble
  // class (see Plan 40-04 Task 1). Falls back to always-invisible if the
  // parent lacks that class — degrades gracefully (safe fail).
  const desktopClasses =
    "opacity-0 [.pv-bubble:hover_&]:opacity-100 " +
    "hover:text-[hsla(var(--pv-id-hue),80%,65%,1)]";

  const handleMouseEnter = (e: MouseEvent<HTMLButtonElement>) => {
    // UI-SPEC L124 hover glow — 6px identity-hue drop-shadow (mirrors
    // PinAction.tsx L69-79 idiom locked in Phase 13 SHAPE-03).
    e.currentTarget.style.filter =
      "drop-shadow(0 0 6px hsla(var(--pv-id-hue), 80%, 60%, 0.55))";
  };
  const handleMouseLeave = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.filter = "";
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onOpen()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={
        baseClasses + " " + (isTouchDevice ? mobileClasses : desktopClasses)
      }
    >
      <Pencil size={16} />
    </button>
  );
}
