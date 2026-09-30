import * as React from "react";
import { MoreVertical } from "lucide-react";

// ─── Phase 143 Plan 143-05 (D-12 / D-13 / D-14) — RowKebabMenu ──────────────
//
// Shared always-visible three-dots (⋮) kebab-menu affordance for rows across
// all three un-archive surface plans (143-06 / 143-07 / 143-08).
//
// D-12: Visual tokens locked verbatim:
//   `inline-flex items-center justify-center size-5 rounded hover:bg-white/5
//    text-[#5c6070]/85 shrink-0`
//   Icon: MoreVertical (lucide-react) at size-[14px] — matches the per-project
//   new-conversation button visual weight in PrettyProjectSectionHeader.tsx L360-378.
//
// D-13: Menu is a proper popover (DropdownMenu) even when items.length === 1.
//   NO direct-action fallback — establishes an extensibility point for future
//   per-row actions.
//
// D-14: Belt-and-suspenders stop-propagation discipline on the trigger button —
//   BOTH onMouseDown AND onClick call e.stopPropagation(). Either alone can leak
//   through to the row's default handler depending on synthetic-event timing.
//   Radix's DropdownMenuTrigger `asChild` forwards the click, so the button owns
//   the propagation boundary.
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
          className="inline-flex items-center justify-center size-5 rounded hover:bg-white/5 text-[#5c6070]/85 shrink-0"
          aria-label={ariaLabel ?? "Row menu"}
          data-testid={testId ?? "row-kebab-trigger"}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <MoreVertical className="size-[14px]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onSelect={() => {
              item.onClick();
            }}
            disabled={item.disabled}
            className={cn(item.danger && "text-red-400")}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default RowKebabMenu;
