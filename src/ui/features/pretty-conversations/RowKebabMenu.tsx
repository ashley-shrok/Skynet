import * as React from "react";
import { MoreVertical } from "lucide-react";

// ─── Phase 143 Plan 143-05 (D-12 / D-13 / D-14) — RowKebabMenu ──────────────
//
// Shared always-visible three-dots (⋮) kebab-menu affordance for rows across
// all three un-archive surface plans (143-06 / 143-07 / 143-08).
//
// D-12 (revised 2026-10-01, UAT item 1): tokens bumped for prominence after
//   the user reported the previous `size-5 text-[#5c6070]/85` treatment was
//   hard to see against hue-tinted rows. Now:
//     `inline-flex items-center justify-center size-6 rounded-md bg-white/10
//      hover:bg-white/20 text-white/80 hover:text-white shrink-0
//      transition-colors`
//   Icon: MoreVertical at size-[16px] (was 14).
//
// D-13: Menu is a proper popover (DropdownMenu) even when items.length === 1.
//   NO direct-action fallback — establishes an extensibility point for future
//   per-row actions.
//
// D-14 (revised 2026-10-01, UAT item 2): stop-propagation discipline extended
//   from the trigger to the entire dropdown surface. React synthetic events
//   bubble from portal-rendered content up through the REACT TREE, so clicks
//   on menu items would otherwise reach the parent row's onClick (observed
//   repro: archive confirm → RoleModal popped up on the row behind).
//     - Trigger button: onMouseDown + onClick stopProp (unchanged).
//     - DropdownMenuContent: onClick + onPointerDown stopProp — catches
//       everything inside the portal that bubbles via React tree.
//     - DropdownMenuItem: onClick stopProp — belt + suspenders.
//
// D-20 (added 2026-10-01, UAT item 3 — kebab unification): the shared menu
//   surface itself gets a nicer look (not just the trigger). The base
//   DropdownMenu/Item primitives render flat and square with `cursor-default`;
//   that's what the user called "lame looking no rounded borders no pointy
//   cursor" relative to the hand-rolled scheduled-agents popover. We override
//   via className: rounded-lg content with a neutral dark surface + subtle
//   border + deep shadow; items get cursor-pointer + an explicit hover/focus
//   tint. Cipher (sidebar kebab consumer) consumes this same component — one
//   paint, every kebab in the app.
//
// Purely presentational — this component is NOT responsible for state management
// (row removal, alert copy, etc.). It emits item.onClick() and stops. Callers
// own the side effects.
//
// No streaming affordances (no typing indicators, spinners, auto-expand) per
// Skynet's no-message-streaming standing directive.

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/dropdown-menu";
import { cn } from "@/lib/utils";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RowKebabMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Optional per-item test id (forwarded to DropdownMenuItem). */
  testId?: string;
}

export interface RowKebabMenuProps {
  items: RowKebabMenuItem[];
  ariaLabel?: string;
  testId?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RowKebabMenu({
  items,
  ariaLabel,
  testId,
}: RowKebabMenuProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center size-6 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white shrink-0 transition-colors"
          aria-label={ariaLabel ?? "Row menu"}
          data-testid={testId ?? "row-kebab-trigger"}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <MoreVertical className="size-[16px]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="rounded-lg bg-[#1f1f24] border border-white/10 shadow-xl p-1 min-w-[140px]"
        onClick={(e) => {
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onSelect={() => {
              item.onClick();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            disabled={item.disabled}
            data-testid={item.testId}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-[#e8e4d8] focus:bg-white/10 focus:text-white",
              item.danger &&
                "text-[hsla(0,60%,76%,1)] focus:bg-[hsla(0,60%,40%,0.18)] focus:text-[hsla(0,60%,86%,1)]",
            )}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default RowKebabMenu;
