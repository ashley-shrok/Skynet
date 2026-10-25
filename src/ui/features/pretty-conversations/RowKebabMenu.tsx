import * as React from "react";
import { createPortal } from "react-dom";
import { Slot } from "radix-ui";
import { MoreVertical, MoreHorizontal, Check } from "lucide-react";
import { useKitScope } from "@/components/kit/scope";

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
// D-21 (added 2026-10-01, shape-sidebar-header-affordances task 6): one-level
//   submenu support for the conversation-row kebab's Move-to-project
//   drill-in. An item with a `submenu` field renders as DropdownMenuSub +
//   SubTrigger + SubContent instead of DropdownMenuItem; the submenu
//   inherits the same visual tokens as the primary content so a drilled-in
//   level looks identical to the top. Submenu items may carry `checked: true`
//   to render a Check icon on the left (used for the row's currently-
//   assigned project in the Move-to-project picker). Submenu nesting is
//   intentionally limited to ONE level — multi-level drill-ins add UX
//   complexity and no existing consumer needs them.
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from "@/components/dropdown-menu";
import { cn } from "@/lib/utils";
import { systemLogger } from "@/lib/frontend-logger";
import { useRowTouchGestures, type RowTouchGestures } from "./row-touch-gestures";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Child item of a submenu. Submenus do not nest — a submenu item cannot carry
 * its own submenu. `checked: true` renders a Check icon prefix (used for the
 * row's currently-assigned project in the Move-to-project picker).
 */
export interface RowKebabSubmenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** Optional per-item test id (forwarded to DropdownMenuItem). */
  testId?: string;
  /** Nesting level for tree-shaped lists (nested projects in Move to);
   *  each level indents the label. 0 / undefined = flush. */
  indent?: number;
}

/**
 * Top-level kebab item. Mutually exclusive shapes:
 *   - leaf item: has `onClick`, no `submenu`
 *   - submenu parent: has `submenu` with ≥1 child, no `onClick`
 * TypeScript doesn't enforce this; callers should pass one or the other.
 */
export interface RowKebabMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  submenu?: RowKebabSubmenuItem[];
  /** Optional per-item test id (forwarded to DropdownMenuItem). */
  testId?: string;
  /** Leaf items only: a boolean renders a Check-icon slot on the left
   *  (checked → icon, false → blank spacer), for toggle-style items like
   *  the Skills modal's "User-invoked only". Undefined = plain item. */
  checked?: boolean;
  /** Leaf items only: a muted second line under the label. */
  hint?: string;
  /** Leaf items only: a separator is drawn above this item. */
  separatorBefore?: boolean;
}

export interface RowKebabMenuProps {
  items: RowKebabMenuItem[];
  ariaLabel?: string;
  testId?: string;
  /** Extra classes for the ⋮ trigger (e.g. a larger size beside form
   *  controls). Merged over the default size-6 trigger. */
  triggerClassName?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

// Shared classNames so the submenu's content/items match the primary surface.
// `w-auto` overrides the shared DropdownMenuContent default of
// `w-(--radix-dropdown-menu-trigger-width)`, which pins content width to the
// trigger. Kebab triggers are 24px squares, so without this the content falls
// back to `min-w-[140px]` and labels like "Archive project" wrap mid-text on
// large screens. Letting it be `auto` sizes to the widest item.
const CONTENT_CLASS = "w-auto rounded-lg bg-[#1f1f24] border border-white/10 shadow-xl p-1 min-w-[140px]";
const ITEM_CLASS_BASE = "cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] max-md:px-[14px] max-md:py-[14px] max-md:text-[14px] text-[#e8e4d8] focus:bg-white/10 focus:text-white";
const ITEM_CLASS_DANGER = "text-[hsla(0,60%,76%,1)] focus:bg-[hsla(0,60%,40%,0.18)] focus:text-[hsla(0,60%,86%,1)]";

/**
 * The kebab menu surface (content + items), shared by the ⋮ trigger
 * (RowKebabMenu) and the right-click path (useRowKebabContextMenu) so both
 * gestures render the identical menu. Must be rendered inside a DropdownMenu.
 */
function KebabMenuContent({
  items,
  ...contentProps
}: {
  items: RowKebabMenuItem[];
} & Pick<
  React.ComponentProps<typeof DropdownMenuContent>,
  | "sideOffset"
  | "alignOffset"
  | "onCloseAutoFocus"
  | "onFocusOutside"
  | "onPointerDownOutside"
  | "onEscapeKeyDown"
  | "onClickCapture"
>): React.JSX.Element {
  // Always the kit look; inside a modal it also takes the modal's hue (it
  // portals out of the modal's DOM, so it can't inherit that by CSS).
  const kit = useKitScope();
  const contentClass = cn(CONTENT_CLASS, "k-menu k-hued");
  const kitStyle = kit ? ({ "--pv-id-hue": String(kit.hue) } as React.CSSProperties) : undefined;
  return (
    <DropdownMenuContent
      className={contentClass}
      style={kitStyle}
      {...contentProps}
      onContextMenu={(e) => {
        // Right-clicking inside an open menu must not re-open it at the new
        // cursor position (via useRowKebabContextMenu on the surface behind),
        // nor show the browser's native menu on top of ours.
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {items.map((item) => {
        if (item.submenu && item.submenu.length > 0) {
          // Submenu parent — DropdownMenuSub with SubTrigger + SubContent.
          // The SubContent inherits the same CONTENT_CLASS so the drilled
          // level looks identical to the primary.
          return (
            <DropdownMenuSub key={item.label}>
              <DropdownMenuSubTrigger
                disabled={item.disabled}
                data-testid={item.testId}
                data-danger={item.danger ? "true" : undefined}
                className={cn(
                  ITEM_CLASS_BASE,
                  item.danger && ITEM_CLASS_DANGER,
                )}
              >
                {item.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  className={contentClass}
                  style={kitStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {item.submenu.map((sub, subIdx) => (
                    <DropdownMenuItem
                      key={sub.testId ?? `${subIdx}:${sub.label}`}
                      onSelect={() => {
                        sub.onClick();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      disabled={sub.disabled}
                      data-testid={sub.testId}
                      data-danger={sub.danger ? "true" : undefined}
                      className={cn(
                        ITEM_CLASS_BASE,
                        "flex items-center gap-2",
                        sub.danger && ITEM_CLASS_DANGER,
                      )}
                    >
                      {sub.checked === true ? (
                        <Check
                          className="size-[14px] shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          className="inline-block size-[14px] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      {sub.indent ? (
                        <span
                          className="inline-block shrink-0"
                          style={{ width: `${sub.indent * 12}px` }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>{sub.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          );
        }
        // Leaf item. `checked` (toggle slot) and `hint` (second line) are
        // opt-in; plain items render exactly as before.
        const hasCheckSlot = item.checked !== undefined;
        return (
          <React.Fragment key={item.label}>
            {item.separatorBefore ? (
              <DropdownMenuSeparator className="my-1 bg-white/10" />
            ) : null}
            <DropdownMenuItem
              onSelect={() => {
                item.onClick?.();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              disabled={item.disabled}
              data-testid={item.testId}
              data-danger={item.danger ? "true" : undefined}
              aria-checked={hasCheckSlot ? item.checked : undefined}
              className={cn(
                ITEM_CLASS_BASE,
                (hasCheckSlot || item.hint) && "flex items-start gap-2",
                item.danger && ITEM_CLASS_DANGER,
              )}
            >
              {hasCheckSlot ? (
                item.checked ? (
                  <Check
                    className="size-[14px] shrink-0 mt-[2px]"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="inline-block size-[14px] shrink-0"
                    aria-hidden="true"
                  />
                )
              ) : null}
              {item.hint ? (
                <span className="flex flex-col min-w-0">
                  <span>{item.label}</span>
                  <span className="text-[11px] max-md:text-[12px] text-[#a39b8a]">
                    {item.hint}
                  </span>
                </span>
              ) : (
                item.label
              )}
            </DropdownMenuItem>
          </React.Fragment>
        );
      })}
    </DropdownMenuContent>
  );
}

export function RowKebabMenu({
  items,
  ariaLabel,
  testId,
  triggerClassName,
}: RowKebabMenuProps): React.JSX.Element {
  const kit = useKitScope();
  return (
    // modal={false} — Phase 143's sidebar-row kebab roll-out hit a Radix
    // body-lock leak (document.body.style.pointerEvents="none" stuck on after
    // a dropdown close race) that landed as a "whole page uninteractable until
    // refresh" symptom. ~40 of these dropdowns in the sidebar meant ~40× the
    // chance of hitting the race per session. Smoking-gun evidence in
    // /opt/skynet/console-forward-logs/console-forward.log 2026-10-01: 45
    // bodyPE="none" heartbeats across one session, including a 70+ second
    // sustained run matching the user's "10-min freeze" complaint. A sidebar
    // kebab doesn't need the modal-mode focus-trap + scroll-lock, so
    // modal={false} disables the body-lock cleanly.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            kit
              ? "k-icon-btn"
              : "inline-flex items-center justify-center size-6 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white shrink-0 transition-colors",
            triggerClassName,
          )}
          aria-label={ariaLabel ?? "Row menu"}
          data-testid={testId ?? "row-kebab-trigger"}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {kit ? (
            <MoreHorizontal aria-hidden="true" />
          ) : (
            <MoreVertical className="size-[16px]" aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <KebabMenuContent items={items} />
    </DropdownMenu>
  );
}

// ─── Right-click → same menu ──────────────────────────────────────────────────
//
// Convenience gesture: right-clicking a surface that carries a kebab opens the
// SAME menu (same items, same KebabMenuContent) at the cursor. The ⋮ trigger
// stays the primary/discoverable affordance — this is not a second menu. A
// contextmenu event synthesized from a touch long-press is ignored; on touch,
// press-and-hold opens the menu instead — spread `holdProps` on the surface
// (row-touch-gestures.ts). Sidebar conversation rows run their own gesture
// (hold + swipe) and call `openAt` from it.
//
// Usage:
//   const ctx = useRowKebabContextMenu(items);
//   <div onContextMenu={ctx.onContextMenu} {...ctx.holdProps}> … <RowKebabMenu items={items}/> {ctx.menu} </div>
//
// Mechanics: on contextmenu we record the cursor position and open a
// controlled DropdownMenu whose trigger is an invisible 0×0 element fixed at
// that point, portaled to <body> so a transformed ancestor (e.g. a centered
// Dialog) can't re-base `position: fixed`. The menu is only mounted while
// open, so N rows cost N handlers, not N extra Radix menus. modal={false}
// for the same body-lock reason as RowKebabMenu.

/** True when the event target is somewhere the native menu is more useful. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  );
}

export interface RowKebabContextMenu {
  /** Attach to the surface's onContextMenu. */
  onContextMenu: (e: React.MouseEvent) => void;
  /** Render anywhere inside the surface (it portals itself). */
  menu: React.ReactNode;
  /** Open the menu at a viewport point (press-and-hold on touch). */
  openAt: (x: number, y: number) => void;
  /** Spread on the surface: press-and-hold on touch opens the menu.
   *  `data-hold-menu` turns off text selection and the iOS callout there on
   *  touch screens (index.css). */
  holdProps: RowTouchGestures["handlers"] & { "data-hold-menu"?: "" };
}

/** How long after a press-and-hold opens the menu the finger's lift is ignored. */
const OPEN_SETTLE_MS = 450;

function logDismiss(how: string): void {
  systemLogger.info(`row menu closed: ${how}`, { operation: "row_menu_dismiss", how });
}

export function useRowKebabContextMenu(
  items: RowKebabMenuItem[],
): RowKebabContextMenu {
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const enabled = items.length > 0;
  // Where focus was when the menu opened (the row, for the keyboard's menu
  // key) — it goes back there when the menu closes.
  const opener = React.useRef<HTMLElement | null>(null);
  // A press-and-hold opens the menu under the finger. Lifting it then can
  // still bring the browser's follow-up tap (focus moving to the row, a click
  // on the item now under the finger — iPhone does this): within a moment of
  // opening, those don't close the menu or pick an item.
  const openedAt = React.useRef(0);
  const settling = () => performance.now() - openedAt.current < OPEN_SETTLE_MS;
  const noteOpener = () => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  };

  const onContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || e.defaultPrevented) return;
      // Touch long-press → leave alone (see header comment). `pointerType`
      // exists where contextmenu is dispatched as a PointerEvent (Chromium).
      const pointerType = (e.nativeEvent as Partial<PointerEvent>).pointerType;
      if (pointerType === "touch" || pointerType === "pen") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      // Innermost kebab surface wins when surfaces nest.
      e.stopPropagation();
      noteOpener();
      setPos({ x: e.clientX, y: e.clientY });
    },
    [enabled],
  );

  const menu =
    pos === null
      ? null
      : createPortal(
          <DropdownMenu
            // Remount per position so a second right-click re-anchors cleanly.
            key={`${pos.x},${pos.y}`}
            modal={false}
            open
            onOpenChange={(open) => {
              if (!open) setPos(null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden="true"
                data-testid="row-kebab-context-anchor"
                style={{
                  position: "fixed",
                  left: pos.x,
                  top: pos.y,
                  width: 0,
                  height: 0,
                  pointerEvents: "none",
                }}
              />
            </DropdownMenuTrigger>
            <KebabMenuContent
              items={items}
              // Small offset (as Radix ContextMenu does) so the mouseup that ends
              // the right-click doesn't land on — and select — the first item.
              sideOffset={2}
              alignOffset={2}
              onFocusOutside={(e) => {
                if (settling()) e.preventDefault();
                else logDismiss("focus-outside");
              }}
              onPointerDownOutside={(e) => {
                if (settling()) e.preventDefault();
                else logDismiss("pointer-outside");
              }}
              onEscapeKeyDown={() => logDismiss("escape")}
              onClickCapture={(e) => {
                if (!settling()) return;
                systemLogger.info("row menu: early click ignored", { operation: "row_menu_early_click" });
                e.preventDefault();
                e.stopPropagation();
              }}
              // The anchor unmounts on close; focus goes back to where it was.
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                const el = opener.current;
                opener.current = null;
                if (el?.isConnected) el.focus({ preventScroll: true });
              }}
            />
          </DropdownMenu>,
          document.body,
        );

  const openAt = React.useCallback(
    (x: number, y: number) => {
      if (!enabled) return;
      noteOpener();
      openedAt.current = performance.now();
      setPos({ x, y });
    },
    [enabled],
  );

  const hold = useRowTouchGestures({ onHold: enabled ? openAt : undefined });
  const holdProps = enabled ? { ...hold.handlers, "data-hold-menu": "" as const } : hold.handlers;

  return { onContextMenu, menu, openAt, holdProps };
}

/**
 * Component form of useRowKebabContextMenu for surfaces rendered inside a
 * .map() (where a hook can't be called per item). Merges onContextMenu and
 * press-and-hold onto its single child element via Slot; the menu itself
 * portals to <body>.
 *
 *   <RowKebabContextMenuSurface items={items}><div …row…/></RowKebabContextMenuSurface>
 */
export function RowKebabContextMenuSurface({
  items,
  children,
}: {
  items: RowKebabMenuItem[];
  children: React.ReactElement;
}): React.JSX.Element {
  const { onContextMenu, menu, holdProps } = useRowKebabContextMenu(items);
  return (
    <>
      <Slot.Root onContextMenu={onContextMenu} {...holdProps}>{children}</Slot.Root>
      {menu}
    </>
  );
}

export default RowKebabMenu;
