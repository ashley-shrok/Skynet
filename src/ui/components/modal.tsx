import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { KitScopeContext } from "@/components/kit/scope";
import "@/components/kit/kit.css";

// Canonical modal container — the shell every app modal composes from, in
// the apple-ux campaign's look A: one flat near-black surface, a hairline
// edge, a plain title, no rules between head / body / foot. Colour appears
// only where something is chosen, is the main action, or has focus.
// Shape: .planning/campaigns/apple-ux/shape-ux-foundation.md
// Visual reference: .planning/campaigns/apple-ux/tasting-ux-foundation.js
//
// The parts inside a modal (buttons, fields, rows, chips, states, dialogs)
// come from the kit in src/ui/components/kit — never hand-rolled.
//
// Composition:
//   <Modal open={open} onOpenChange={setOpen} size="sm">
//     <ModalHead title="Delete this file?" subtitle="workspace / notes / groceries.md" />
//     <ModalBody>…</ModalBody>
//     <ModalFoot>
//       <KitButton>Cancel</KitButton>
//       <KitButton variant="danger">Delete</KitButton>
//     </ModalFoot>
//   </Modal>
//
// `hue` sets --pv-id-hue on the modal (and on menus opened from it), which
// tints the accent — selections, the main button, focus outlines. It never
// tints the background.
//
// Backdrop click never dismisses. Closes are via the close-X, Esc, Cancel —
// and, for a phone sheet with nothing typed in it, a swipe down. Passing
// `dismissible={false}` blocks all of those, reserved for required-shell
// modals (e.g. SkewLockModal).
//
// Every modal is blocking. There is NO `blocking={false}` escape hatch; the
// no-adhoc-modal-blocking-false.test.ts guard fails the ship-gate if any file
// re-introduces it.
//
// On a phone (below 640px) big modals fill the screen; small ones (sm / md /
// lg) are sheets that slide up from the bottom, only as tall as their
// content, with a grab bar. A swipe down on the sheet's top closes it unless
// something has been typed in it, in which case it springs back.

// ─── Size scale ──────────────────────────────────────────────────────────

type ModalSize =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "list"
  | "wide-list"
  | "settings"
  | "editor"
  | "viewer";

// Sizes apply on `sm:` (≥640px viewport) and up. Pixel caps are paired with
// viewport-proportional minimums via `min()` so modals scale up on 4K /
// ultrawide screens but can't become absurdly large.
const SIZE_CLASSES: Record<ModalSize, string> = {
  // Viewer — editor-wide, height follows the content (a fixed-aspect picture
  // such as an agent's desktop), capped by the universal 85vh max-h.
  viewer: "sm:max-w-[min(1200px,80vw)]",
  // Content-sized archetypes — confirms + forms don't want to grow.
  sm: "sm:max-w-[340px]",
  md: "sm:max-w-[400px]",
  lg: "sm:max-w-[520px]",
  xl: "sm:max-w-[640px]",
  // Picker / list — fixed-ish width, grows taller on bigger screens.
  list: "sm:max-w-[600px] sm:h-[min(85vh,780px)]",
  // Wide list — rows that carry readable text (conversation search passages).
  "wide-list": "sm:max-w-[min(1150px,70vw)] sm:h-[85vh]",
  // Settings — modest horizontal + vertical scaling for 4K.
  settings: "sm:max-w-[min(720px,70vw)] sm:h-[min(85vh,640px)]",
  // File editor — generous both ways; a definite height so content with no
  // intrinsic size (grids, iframes, PDF viewers) fills the viewport.
  editor: "sm:max-w-[min(1200px,80vw)] sm:h-[85vh]",
};

/** Sizes that become bottom sheets on a phone instead of full-screen. */
const SHEET_SIZES: ReadonlySet<ModalSize> = new Set(["sm", "md", "lg"]);

// ─── Modal (root) ────────────────────────────────────────────────────────

interface ModalProps
  extends Omit<
    React.ComponentProps<typeof DialogPrimitive.Root>,
    "modal" | "children"
  > {
  /** Accent hue for this modal (selections, main button, focus). Identity-
   *  and role-scoped modals pass the identity's / role's colorHue; every
   *  other modal leaves it unset and gets the canonical slate (220). */
  hue?: number;
  /** Modal size. See SIZE_CLASSES. */
  size?: ModalSize;
  /** When false, Esc, close-X and swipe do NOT dismiss. Backdrop click is
   *  always blocked. Reserved for required-shell modals (SkewLockModal). */
  dismissible?: boolean;
  /** Portal container. Defaults to document.body. */
  container?: HTMLElement | null;
  /** Extra class for the modal content shell. */
  className?: string;
  /** Passed through to the modal content element — for test targeting. */
  "data-testid"?: string;
  children?: React.ReactNode;
}

const CANONICAL_HUE = 220;

/** True when Esc was pressed inside an element that handles Esc itself. */
function escHandledLocally(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-modal-esc-local]") !== null;
}

/** Elements a sheet drag must never start on. */
const DRAG_EXCLUDE = "button, a, input, select, textarea, label, [contenteditable], [role='menuitem'], [role='option']";
/** Where a sheet drag may start: its grab zone, its head, a kit dialog body. */
const DRAG_HANDLE = "[data-sheet-grab], [data-slot='modal-head'], .k-dialog-body";
const SWIPE_CLOSE_PX = 90;

function Modal({
  hue,
  size = "sm",
  dismissible = true,
  container,
  className,
  "data-testid": dataTestId,
  children,
  ...props
}: ModalProps) {
  const blockEsc = !dismissible;
  const effectiveHue = hue === undefined ? CANONICAL_HUE : hue;
  const fullscreen = useModalFullscreen();
  const sheet = fullscreen && SHEET_SIZES.has(size);
  const scope = React.useMemo(() => ({ hue: effectiveHue }), [effectiveHue]);

  // Swipe-to-close state. `dirty` flips on the first keystroke inside the
  // sheet — from then on a swipe springs back instead of closing.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const dirty = React.useRef(false);
  const drag = React.useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null);
  const { onOpenChange, open } = props;
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    if (open) dirty.current = false;
  }, [open]);

  const setOffset = (px: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = px ? `translateY(${px}px)` : "";
  };

  const sheetHandlers: React.HTMLAttributes<HTMLDivElement> = sheet && dismissible
    ? {
        onInputCapture: () => {
          dirty.current = true;
        },
        onPointerDown: (e) => {
          const t = e.target as Element;
          if (e.button !== 0 || t.closest(DRAG_EXCLUDE) || !t.closest(DRAG_HANDLE)) return;
          drag.current = { y0: e.clientY, t0: e.timeStamp, dy: 0, id: e.pointerId };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          // Resist upward pulls; follow the finger downward.
          const raw = e.clientY - d.y0;
          d.dy = raw > 0 ? raw : raw / 6;
          setOffset(d.dy, false);
        },
        onPointerUp: (e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          const velocity = d.dy / Math.max(1, e.timeStamp - d.t0);
          const wantsClose = d.dy > SWIPE_CLOSE_PX || (d.dy > 30 && velocity > 0.6);
          if (wantsClose && !dirty.current) {
            const el = contentRef.current;
            if (el) {
              el.style.transition = "transform 0.2s ease-in";
              el.style.transform = "translateY(100%)";
            }
            window.setTimeout(() => {
              onOpenChange?.(false);
              // The owner may refuse to close (e.g. while it's busy) — then
              // bring the sheet back rather than leave it off screen.
              window.setTimeout(() => {
                if (openRef.current !== false) setOffset(0, true);
              }, 60);
            }, 180);
          } else {
            setOffset(0, true);
          }
        },
        onPointerCancel: () => {
          drag.current = null;
          setOffset(0, true);
        },
      }
    : {};

  return (
    <DialogPrimitive.Root {...props} modal={true}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay
          data-slot="modal-overlay"
          className={cn(
            // Solid dim. NO backdrop-filter blur — on a full-viewport overlay
            // it caused GPU spikes + "Page unresponsive" prompts.
            "fixed inset-0 z-50 bg-black/60",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
            "duration-100",
          )}
        />
        <KitScopeContext.Provider value={scope}>
          <DialogPrimitive.Content
            ref={contentRef}
            data-slot="modal-content"
            data-testid={dataTestId}
            data-sheet={sheet ? "true" : undefined}
            style={
              {
                // --pv-id-hue drives the kit accent; --pv-hue is what the older
                // shared Button keys off, so stragglers still match the modal.
                "--pv-id-hue": String(effectiveHue),
                "--pv-hue": String(effectiveHue),
              } as React.CSSProperties
            }
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            // A field marked data-modal-esc-local is using Esc itself (e.g. a
            // search box clearing its query), so the modal stays open.
            onEscapeKeyDown={(e) => {
              if (blockEsc || escHandledLocally(e.target)) e.preventDefault();
            }}
            {...sheetHandlers}
            className={cn(
              "k-hued fixed inset-0 z-50 flex flex-col outline-none overflow-hidden",
              "bg-[var(--k-bg)] text-[var(--k-t1)]",
              // iOS safe-area insets (non-zero only with viewport-fit=cover).
              "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
              // Desktop: centred floating card, 85vh cap, body scrolls.
              "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
              "sm:w-full sm:h-auto sm:max-h-[85vh] sm:p-0",
              SIZE_CLASSES[size],
              "sm:rounded-[20px] sm:border sm:border-[var(--k-hair)]",
              "sm:shadow-[0_30px_90px_rgba(0,0,0,0.7)]",
              sheet
                ? "data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom duration-300 ease-out"
                : "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100",
              className,
              // Phone overrides — AFTER the consumer's className so they win
              // over any un-prefixed per-modal max-h / max-w / height.
              sheet
                ? "max-sm:top-auto max-sm:bottom-0 max-sm:inset-x-0 max-sm:w-full max-sm:max-w-full max-sm:h-auto max-sm:max-h-[92dvh] max-sm:rounded-t-[20px] max-sm:rounded-b-none max-sm:pt-[14px] max-sm:border-t max-sm:border-[var(--k-hair)] max-sm:shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
                : "max-sm:w-full max-sm:h-full max-sm:max-w-full max-sm:max-h-full max-sm:rounded-none max-sm:border-0 max-sm:shadow-none",
            )}
          >
            {sheet ? (
              <div
                data-sheet-grab=""
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[22px] z-10 touch-none"
              >
                <span className="k-grabber" />
              </div>
            ) : null}
            {children}
          </DialogPrimitive.Content>
        </KitScopeContext.Provider>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─── ModalHead ───────────────────────────────────────────────────────────

interface ModalHeadProps {
  /** The title line. Required by ARIA (radix Dialog demands a Title). */
  title: React.ReactNode;
  /** Optional subtitle — one or two lines of guidance. Skip rather than
   *  passing an empty string. */
  subtitle?: React.ReactNode;
  /** Optional line ABOVE the title for disambiguating context (e.g. which
   *  host). Not for label-chrome. */
  meta?: React.ReactNode;
  /** Leading visual (avatar) beside the title block. */
  leading?: React.ReactNode;
  /** When true, no close button. Pair with `dismissible={false}`. */
  hideClose?: boolean;
  /** Rendered before the close button (header actions). */
  actions?: React.ReactNode;
  closeTestId?: string;
  closeAriaLabel?: string;
  /** id for the underlying Title, for aria-labelledby references. */
  titleId?: string;
  className?: string;
  /** Rendered inside the head text block after title/subtitle — for
   *  head-embedded controls. */
  children?: React.ReactNode;
}

function ModalHead({
  title,
  subtitle,
  meta,
  leading,
  hideClose,
  actions,
  closeTestId,
  closeAriaLabel = "Close",
  titleId,
  className,
  children,
}: ModalHeadProps) {
  return (
    <div
      data-slot="modal-head"
      className={cn(
        // Mobile: the container's safe-area-inset-top already clears the
        // status bar, so the head's own top padding stays small there.
        "px-6 pt-5 pb-3 flex items-start justify-between gap-3 flex-shrink-0",
        "max-sm:px-5 max-sm:pt-1.5",
        "[[data-sheet]_&]:touch-none",
        className,
      )}
    >
      {leading ? <div className="flex-shrink-0 self-center">{leading}</div> : null}
      <div className="flex-1 min-w-0 self-center">
        {meta && (
          <p
            data-slot="modal-head-meta"
            className="m-0 mb-0.5 text-[12.5px] font-medium text-[var(--k-t3)]"
          >
            {meta}
          </p>
        )}
        <DialogPrimitive.Title
          data-slot="dialog-title"
          // Only pass `id` when provided — undefined clobbers Radix's
          // auto-generated id and breaks aria-labelledby on the content.
          {...(titleId ? { id: titleId } : {})}
          className="m-0 text-[21px] font-bold text-[var(--k-t1)] tracking-[-0.025em] leading-[1.25] break-words"
        >
          {title}
        </DialogPrimitive.Title>
        {subtitle && (
          <DialogPrimitive.Description
            data-slot="dialog-description"
            className="m-0 mt-1 text-[13px] leading-[1.45] text-[var(--k-t2)] max-w-[64ch]"
          >
            {subtitle}
          </DialogPrimitive.Description>
        )}
        {children}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {actions}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={closeAriaLabel}
              data-testid={closeTestId}
              className="k-icon-btn"
              data-filled="true"
            >
              <XIcon />
            </button>
          </DialogPrimitive.Close>
        )}
      </div>
    </div>
  );
}

// ─── ModalBody ───────────────────────────────────────────────────────────

function ModalBody({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-body"
      className={cn(
        "px-6 py-3.5 text-[14px] leading-[1.55] text-[var(--k-t1)]",
        "max-sm:px-5",
        // The body is the scrolling region between head and foot.
        "flex-1 min-h-0 overflow-y-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── ModalFoot ───────────────────────────────────────────────────────────

function ModalFoot({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-foot"
      className={cn(
        "px-6 pt-3.5 pb-[18px] flex justify-end items-center gap-2.5 flex-shrink-0",
        "max-sm:px-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── ModalTabs ───────────────────────────────────────────────────────────
//
// Section tabs for modals with a few fixed panels (IdentityModal, RoleModal,
// ProjectModal) — rendered as the kit's segmented control, centred under the
// head. Consumers own tab state + panel rendering.
//
// no-adhoc-modal-tabs.test.ts enforces "modals must use this component for
// their tab row" via a source grep.

export interface ModalTabDef<V extends string = string> {
  value: V;
  label: React.ReactNode;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
}

interface ModalTabsProps<V extends string> {
  tabs: ReadonlyArray<ModalTabDef<V>>;
  value: V;
  onValueChange: (next: V) => void;
  /** Each tab button's data-testid is `<testIdPrefix>-<tab.value>`. */
  testIdPrefix?: string;
  /** data-testid for the row wrapper. */
  rowTestId?: string;
  /** Rendered after the control (row-scoped actions). */
  trailing?: React.ReactNode;
  /** The control scrolls horizontally under overflow. Always true now —
   *  kept for call-site compatibility. */
  scrollable?: boolean;
  className?: string;
}

function ModalTabs<V extends string>({
  tabs,
  value,
  onValueChange,
  testIdPrefix,
  rowTestId,
  trailing,
  className,
}: ModalTabsProps<V>): JSX.Element {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center gap-2 px-6 pt-0.5 pb-3.5 min-w-0",
        "max-sm:px-4",
        className,
      )}
      data-slot="modal-tabs"
      data-testid={rowTestId}
    >
      <div className="k-seg" role="group" aria-label="Sections">
        {tabs.map(({ value: v, label, Icon }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onValueChange(v)}
              aria-pressed={selected}
              data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
            >
              {Icon ? <Icon size={14} /> : null}
              {label}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

// ─── Mobile drill-in ─────────────────────────────────────────────────────
//
// Below the `sm` breakpoint big modals go fullscreen. A side list next to
// the pane eats half a phone's width there, so side-list modals switch to
// drill-in: the list fills the modal; picking an item swaps to the pane with
// a back bar. The query mirrors Tailwind's `max-sm:`.

const MODAL_FULLSCREEN_QUERY = "(max-width: 639.98px)";

function subscribeModalFullscreen(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MODAL_FULLSCREEN_QUERY);
  mql.addEventListener?.("change", cb);
  return () => mql.removeEventListener?.("change", cb);
}

function getModalFullscreen(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !!window.matchMedia(MODAL_FULLSCREEN_QUERY).matches;
}

/** True while the viewport is phone-width (modals fullscreen or sheets). */
function useModalFullscreen(): boolean {
  return React.useSyncExternalStore(
    subscribeModalFullscreen,
    getModalFullscreen,
    () => false,
  );
}

/**
 * Drill-in state for a side-list modal. `drilled` = showing the pane (on
 * mobile). Starts drilled when `startDrilled` (e.g. a one-item list). Any
 * change of `value` after mount drills in, so a selection made outside the
 * list lands on its pane. Picking the already-selected item calls
 * `drillIn()` directly.
 */
function useModalDrillIn<V>(
  value: V,
  startDrilled = false,
  /** Pass the modal's `open` when the caller outlives the modal content —
   *  while closed, drill state resets and value changes don't drill in. */
  active = true,
): {
  fullscreen: boolean;
  drilled: boolean;
  drillIn: () => void;
  back: () => void;
} {
  const fullscreen = useModalFullscreen();
  const [drilled, setDrilled] = React.useState(startDrilled);
  const prevValue = React.useRef(value);
  React.useEffect(() => {
    if (!active) {
      prevValue.current = value;
      setDrilled(startDrilled);
      return;
    }
    if (prevValue.current !== value) {
      prevValue.current = value;
      setDrilled(true);
    }
  }, [value, active, startDrilled]);
  return {
    fullscreen,
    drilled,
    drillIn: React.useCallback(() => setDrilled(true), []),
    back: React.useCallback(() => setDrilled(false), []),
  };
}

interface ModalDrillBackProps {
  /** Where back goes — the list's name ("Files", "Preferences"). */
  backLabel: string;
  /** The item currently open, shown after the back button. */
  current?: React.ReactNode;
  onBack: () => void;
  testId?: string;
}

/** Back bar shown above the pane while drilled in on mobile. */
function ModalDrillBack({
  backLabel,
  current,
  onBack,
  testId,
}: ModalDrillBackProps): JSX.Element {
  return (
    <div
      data-slot="modal-drill-back"
      className="shrink-0 flex items-center gap-2 px-3 pb-2 min-w-0"
    >
      <button
        type="button"
        onClick={onBack}
        data-testid={testId}
        className="shrink-0 flex items-center gap-0.5 pr-1.5 py-1 text-[15px] cursor-pointer text-[var(--k-acc-text)] rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--k-acc)]"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        {backLabel}
      </button>
      {current != null ? (
        <span className="min-w-0 truncate text-[15px] font-semibold text-[var(--k-t1)]">
          {current}
        </span>
      ) : null}
    </div>
  );
}

// ─── ModalSidebar ────────────────────────────────────────────────────────
//
// The side list + pane layout for modals whose list is dynamic (files,
// records, settings sections) — Skills, Runbook editor, Admin, Preferences.
// Use <ModalTabs> for 2-4 fixed sections instead.
//
// Tabs may carry a `group` heading; consecutive tabs with the same group sit
// under one heading. `pinned` tabs go to the bottom of the list (e.g. About,
// Log out).

export interface ModalSidebarTabDef<V extends string = string> extends ModalTabDef<V> {
  /** Small heading this item sits under. */
  group?: string;
  /** Pin to the bottom of the list (below a divider). */
  pinned?: boolean;
}

interface ModalSidebarProps<V extends string> {
  tabs: ReadonlyArray<ModalSidebarTabDef<V>>;
  value: V;
  onValueChange: (next: V) => void;
  /** Each button's data-testid is `<testIdPrefix>-<tab.value>`. */
  testIdPrefix?: string;
  /** data-testid for the sidebar column. */
  rowTestId?: string;
  /** Rendered below the list (e.g. "+ Add file"). */
  trailing?: React.ReactNode;
  /** The right-column pane content. */
  children: React.ReactNode;
  className?: string;
  /** Mobile drill-in back-button text — names the list ("Files"). */
  backLabel?: string;
  /** Desktop width of the list column. */
  width?: number;
  /** Controlled drill-in (when the caller needs it, e.g. to reset on close). */
  drill?: ReturnType<typeof useModalDrillIn<V>>;
}

function ModalSidebar<V extends string>({
  tabs,
  value,
  onValueChange,
  testIdPrefix,
  rowTestId,
  trailing,
  children,
  className,
  backLabel = "Files",
  width = 196,
  drill,
}: ModalSidebarProps<V>): JSX.Element {
  // Mobile: drill-in (list OR pane, never both). A one-item list starts on
  // its pane. See useModalDrillIn.
  const own = useModalDrillIn(value, tabs.length <= 1);
  const { fullscreen, drilled, drillIn, back } = drill ?? own;
  const drillMode = fullscreen;
  const showList = !drillMode || !drilled;
  const showPane = !drillMode || drilled;
  const currentLabel = tabs.find((t) => t.value === value)?.label;
  const main = tabs.filter((t) => !t.pinned);
  const pinned = tabs.filter((t) => t.pinned);

  const renderItem = ({ value: v, label, Icon }: ModalSidebarTabDef<V>) => {
    const selected = value === v;
    return (
      <button
        key={v}
        type="button"
        onClick={() => {
          // A different item drills in via the value-change effect (only if
          // the consumer accepts the switch); the current item drills in
          // directly.
          if (v === value) drillIn();
          else onValueChange(v);
        }}
        aria-pressed={selected}
        data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
        data-drill={drillMode ? "true" : undefined}
        className="k-side-item shrink-0"
      >
        {Icon ? <Icon size={drillMode ? 17 : 15} /> : null}
        <span className="truncate">{label}</span>
        {drillMode ? (
          <ChevronRight
            size={16}
            aria-hidden="true"
            className="ml-auto shrink-0 opacity-45"
          />
        ) : null}
      </button>
    );
  };

  const renderGroups = (list: ReadonlyArray<ModalSidebarTabDef<V>>) => {
    const out: React.ReactNode[] = [];
    let lastGroup: string | undefined;
    for (const t of list) {
      if (t.group && t.group !== lastGroup) {
        out.push(
          <div key={`g-${t.group}`} className="k-side-head">
            {t.group}
          </div>,
        );
      }
      lastGroup = t.group;
      out.push(renderItem(t));
    }
    return out;
  };

  return (
    <div
      className={cn(
        "flex-1 min-h-0 flex",
        drillMode ? "flex-col" : "flex-row",
        className,
      )}
      data-slot="modal-split"
      data-drill={drillMode ? (drilled ? "pane" : "list") : undefined}
    >
      <aside
        className={cn(
          "flex flex-col min-h-0",
          drillMode ? "flex-1" : "shrink-0",
          !showList && "hidden",
        )}
        style={drillMode ? undefined : { width }}
        data-slot="modal-sidebar"
        data-testid={rowTestId}
      >
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5",
            drillMode ? "px-3 py-1" : "px-2 pt-0.5 pb-2",
          )}
        >
          {renderGroups(main)}
          {pinned.length > 0 ? (
            <>
              <div className="flex-1 min-h-3" />
              <div className="h-px bg-[var(--k-hair)] mx-2 my-1" />
              {pinned.map(renderItem)}
            </>
          ) : null}
        </div>
        {trailing ? (
          <div className={cn("shrink-0", drillMode ? "px-3 pb-2" : "px-2 pb-2")}>{trailing}</div>
        ) : null}
      </aside>
      <div
        className={cn(
          "flex-1 min-w-0 min-h-0 flex flex-col",
          !showPane && "hidden",
        )}
      >
        {drillMode ? (
          <ModalDrillBack
            backLabel={backLabel}
            current={currentLabel}
            onBack={back}
            testId={testIdPrefix ? `${testIdPrefix}-back` : undefined}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

export {
  Modal,
  ModalHead,
  ModalBody,
  ModalFoot,
  ModalTabs,
  ModalSidebar,
  ModalDrillBack,
  useModalDrillIn,
  useModalFullscreen,
};
export type { ModalProps, ModalSize };
