import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Canonical modal container — the pv-styled modal shell every app modal
// composes from. See .planning/design/shape-modal-look-unification.md for
// the aesthetic direction and .planning/design/modal-tasting.html for the
// per-modal visual reference each translation targets.
//
// This is deliberately a sibling to the older Dialog primitive in this
// same folder — Dialog remains available for edge cases (raw radix access,
// non-standard chrome), but Modal is the canonical starting point for all
// new modal work and the target every existing modal is translated to.
//
// Composition:
//   <Modal open={open} onOpenChange={setOpen} hue={190} size="sm">
//     <ModalHead title="Delete this file?" subtitle="workspace / notes / groceries.md" />
//     <ModalBody>
//       Deleting removes the file. There's no undo from here.
//     </ModalBody>
//     <ModalFoot>
//       <button className="modal-btn modal-btn-secondary">Cancel</button>
//       <button className="modal-btn modal-btn-destructive">Delete</button>
//     </ModalFoot>
//   </Modal>
//
// The `hue` prop sets `--pv-id-hue` on the modal container, which cascades
// to all hue-tinted styles (border, background gradient, header separator,
// button accents). Default 190 matches the app-wide accent.
//
// Backdrop click never dismisses. The backdrop is decorative-only for every
// Modal instance — closes are always via the close-X or Esc. This is a
// unified rule (2026-09-29): no per-modal opt-in, no exception. Passing
// `dismissible={false}` additionally blocks Esc + close-X, reserved for
// required-shell modals (e.g. SkewLockModal) where the
// user must resolve the modal before continuing.
//
// Every modal is blocking. There is NO `blocking={false}` escape hatch
// anymore (retired 2026-09-30 UAT). The Modal component always renders
// a full-viewport backdrop that blocks pointer events and activates
// Radix's focus-trap. The old `blocking={false}` mode was designed for
// "keep typing while reading a shared file" but each consumer that
// adopted it turned into a whack-a-mole missing-backdrop bug during
// UAT. Backdrop is a load-bearing modal affordance, not a per-modal
// choice. The no-adhoc-modal-blocking-false.test.ts guard fails the
// ship-gate if any file re-introduces the pattern.

// ─── Size scale ──────────────────────────────────────────────────────────

type ModalSize =
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "list"
  | "settings"
  | "editor";

// Sizes apply on `sm:` (≥640px viewport) and up. Below the breakpoint every
// modal fills the viewport regardless of size (mobile takeover — see the
// container className in the Modal component). `flex flex-col` is applied
// at the container level so head/foot pin and body scrolls in every modal,
// not just list/settings/editor.
//
// Pixel caps are paired with viewport-proportional minimums via `min()`
// so modals scale up on 4K / ultrawide screens instead of staying stuck
// at a conservative fixed size, but can't become absurdly large.
const SIZE_CLASSES: Record<ModalSize, string> = {
  // Content-sized archetypes — confirms + forms don't want to grow.
  sm: "sm:max-w-[340px]",
  md: "sm:max-w-[400px]",
  lg: "sm:max-w-[520px]",
  xl: "sm:max-w-[640px]",
  // Picker / list — fixed-ish width, grows TALLER on bigger screens so more
  // rows are visible at once (common UAT ask on 4K: "I want to see more of
  // the scheduled-agents list without scrolling").
  list: "sm:max-w-[600px] sm:h-[min(85vh,780px)]",
  // Settings — modest horizontal + vertical scaling for 4K.
  settings: "sm:max-w-[min(720px,70vw)] sm:h-[min(85vh,640px)]",
  // File editor — generous both horizontally and vertically; the editor
  // wants ALL the room. Explicit sm:h-[85vh] (not just the max-h cap)
  // forces a definite height on desktop so content with no intrinsic
  // size (AG Grid's flex-1 min-h-0 wrapper, iframe'd email body, PDF
  // viewer, font tabs) actually fills the available viewport instead of
  // collapsing to content height. Mobile is unaffected — max-sm:h-full
  // on the modal shell always wins.
  editor: "sm:max-w-[min(1200px,80vw)] sm:h-[85vh]",
};

// ─── Modal (root) ────────────────────────────────────────────────────────

interface ModalProps
  extends Omit<
    React.ComponentProps<typeof DialogPrimitive.Root>,
    "modal" | "children"
  > {
  /** CSS custom-property --pv-id-hue value applied to this modal.
   *
   *  When PASSED: the modal is "hued" — background gradient, border, and
   *  outer glow are all tinted from this hue (assistant-bubble aesthetic).
   *  Reserved for identity- and role-scoped modals (IdentityModal passes
   *  the identity's colorHue; RoleModal passes the role's colorHue) —
   *  color IS the semantic there.
   *
   *  When OMITTED: the modal renders in the canonical slate palette
   *  (hue 220, low saturation) — every non-identity/non-role modal in the
   *  app shares this one look (2026-09-30 UAT: "we just pick a color and
   *  stick with it"). --pv-id-hue is still set to 220 internally so
   *  descendant tinting (borders, tabs, sidebar accents) remains coherent
   *  through the same var-based formulas. */
  hue?: number;
  /** Modal size. See SIZE_CLASSES. */
  size?: ModalSize;
  /** When false, ESC + close-X do NOT dismiss the modal. Backdrop click
   *  is ALWAYS blocked regardless of this flag (see file header). Reserved
   *  for required-shell modals (e.g. SkewLockModal). */
  dismissible?: boolean;
  /** Portal container. Defaults to document.body. */
  container?: HTMLElement | null;
  /** Extra class for the modal content shell. */
  className?: string;
  /** Passed through to the modal content element — for test targeting and
   *  legacy test-id continuity across the Dialog → Modal migration. */
  "data-testid"?: string;
  children?: React.ReactNode;
}

// Canonical slate palette — used when no `hue` is passed. Matches the
// tasting-picked "Slate" option (mt(2) in the tasting snippet).
const CANONICAL_HUE = 220;
const CANONICAL_BACKGROUND =
  "linear-gradient(160deg, hsl(220, 14%, 22%), hsl(220, 18%, 12%))";
const CANONICAL_BORDER_CLASS = "border border-[hsla(220,25%,55%,0.30)]";
const CANONICAL_SHADOW_CLASS =
  "shadow-[0_8px_24px_rgba(0,0,0,0.5),0_1px_0_rgba(255,220,190,0.22)_inset,0_0_40px_hsla(220,40%,55%,0.12)]";

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
  const canonical = hue === undefined;
  const effectiveHue = canonical ? CANONICAL_HUE : hue;
  return (
    <DialogPrimitive.Root {...props} modal={true}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay
          data-slot="modal-overlay"
          className={cn(
            // 2026-10-01: solid 60% black dim (bumped from 55% per UAT).
            // NO backdrop-filter blur — the blur-sm on a full-viewport
            // overlay was showing up as a GPU spike + "Page unresponsive"
            // prompts on the user's machine and the dim alone reads fine.
            "fixed inset-0 z-50 bg-black/60",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
            "duration-100",
          )}
        />
        <DialogPrimitive.Content
          data-slot="modal-content"
          data-testid={dataTestId}
          style={
            {
              // Both hue custom-properties scoped to the modal subtree.
              // --pv-id-hue drives the modal's own tinting (border, background,
              // header separator). --pv-hue is what the shared Button component
              // uses for its default+destructive variants — setting it here
              // means action buttons inside the modal inherit the modal's hue
              // rather than the app-wide amber default. Canonical modals get
              // the slate hue (220) so descendant tint formulas cohere.
              "--pv-id-hue": String(effectiveHue),
              "--pv-hue": String(effectiveHue),
              // Canonical: fixed slate gradient (low saturation, hardcoded)
              // so every non-identity/non-role modal shares the exact same
              // shell. Hued: the identity/role-driven gradient with the
              // assistant-bubble aesthetic.
              background: canonical
                ? CANONICAL_BACKGROUND
                : "linear-gradient(160deg, hsl(var(--pv-id-hue), 50%, 38%), hsl(var(--pv-id-hue), 45%, 22%))",
              fontFamily: '"Inter Variable", system-ui, sans-serif',
            } as React.CSSProperties
          }
          // Backdrop click never dismisses — the backdrop is decorative-only
          // across every Modal. Unified 2026-09-29; see file header.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={
            blockEsc ? (e) => e.preventDefault() : undefined
          }
          className={cn(
            // Positioning + shape. Mobile (<640px): fills viewport — every
            // modal is a full-screen takeover, head/foot pinned, body scrolls.
            // Desktop (sm:+): centered floating card with a max-width band
            // (SIZE_CLASSES) and a universal max-h-[85vh] cap so content
            // never overflows the browser window (body scrolls when tall).
            // Flex-col at the container level so head/foot pin and body
            // takes the middle in EVERY modal, not just list/settings.
            "fixed inset-0 z-50 flex flex-col",
            // iOS safe-area insets — pad the modal's internal content away
            // from the status bar / dynamic island at the top and the home
            // indicator at the bottom. Non-zero values are supplied by the
            // browser only when `viewport-fit=cover` is set in the viewport
            // meta (it is, in index.html). On desktop these resolve to zero.
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-full sm:h-auto sm:max-h-[85vh]",
            // Reset the safe-area padding on desktop so the modal content
            // sits flush against its border again.
            "sm:p-0",
            SIZE_CLASSES[size],
            // Rounded corners only on desktop — on mobile the modal hits
            // viewport edges so corners would be invisible anyway.
            "sm:rounded-[16px] overflow-hidden outline-none",
            canonical
              ? CANONICAL_BORDER_CLASS
              : "border border-[hsla(var(--pv-id-hue),65%,55%,0.35)]",
            "text-[#fbf5e8]",
            // Deep drop shadow + inset warm rim + outer glow.
            canonical
              ? CANONICAL_SHADOW_CLASS
              : "shadow-[0_8px_24px_rgba(0,0,0,0.5),0_1px_0_rgba(255,220,190,0.22)_inset,0_0_40px_hsla(var(--pv-id-hue),70%,55%,0.25)]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "duration-100",
            className,
            // Mobile override — placed AFTER consumer's className so it
            // beats any per-modal max-h / max-w / fixed height that was
            // declared without a responsive prefix (e.g. a modal passes
            // `max-h-[720px]` meaning "cap me on desktop" but without
            // `sm:` it would also clamp mobile and leave viewport space
            // showing the app behind). On mobile every modal takes the
            // whole viewport regardless of what the consumer declared.
            // Border + shadow (incl. the inset top rim) are dropped too —
            // at full-bleed they just outline the viewport edge and give
            // away that it's a blown-up floating card.
            "max-sm:w-full max-sm:h-full max-sm:max-w-full max-sm:max-h-full max-sm:rounded-none",
            "max-sm:border-0 max-sm:shadow-none",
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─── ModalHead ───────────────────────────────────────────────────────────

interface ModalHeadProps {
  /** The title line — Inter, semi-bold, primary-cream. Required by ARIA
   *  (radix Dialog demands a Title for accessibility). */
  title: React.ReactNode;
  /** Optional subtitle line — Inter, muted-cream. One or two lines of
   *  guidance. Skip entirely rather than passing an empty string when
   *  there's nothing to add. */
  subtitle?: React.ReactNode;
  /** Optional meta line ABOVE the title. Reserved for cases where the
   *  meta adds disambiguating info (e.g. "SSH · workstation" identifying
   *  which host). Do NOT use for label-chrome (e.g. "Fleet-wide · full
   *  text" is redundant with the title). */
  meta?: React.ReactNode;
  /** When true, no close button rendered. Pair with `dismissible={false}`
   *  on the parent Modal for required-shell modals. */
  hideClose?: boolean;
  /** Rendered next to the close button (e.g. a delete icon on the
   *  Runbook editor for delete-runbook). */
  actions?: React.ReactNode;
  /** Passed through to the close button — for test targeting. */
  closeTestId?: string;
  /** Override for the close button's aria-label. Defaults to "Close". */
  closeAriaLabel?: string;
  /** id attached to the underlying DialogPrimitive.Title. Consumers can
   *  reference this id from aria-labelledby on form controls inside the
   *  modal body to associate them with the heading. */
  titleId?: string;
  className?: string;
  /** Rendered inside the head text block after title/subtitle — for
   *  head-embedded controls (like the RolesListModal's host picker). */
  children?: React.ReactNode;
}

function ModalHead({
  title,
  subtitle,
  meta,
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
        "px-5 py-3.5 flex items-start justify-between gap-3",
        "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.22)]",
        "shadow-[0_1px_0_rgba(255,220,190,0.05)]",
        "flex-shrink-0",
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        {meta && (
          <p
            data-slot="modal-head-meta"
            className="m-0 mb-1 text-[10.5px] font-medium tracking-[0.14em] uppercase text-[hsla(var(--pv-id-hue),30%,88%,0.72)]"
          >
            {meta}
          </p>
        )}
        <DialogPrimitive.Title
          // data-slot="dialog-title" matches the shadcn/Dialog convention so
          // test queries like `[data-slot="dialog-title"]` find Modal titles
          // the same way they find legacy Dialog titles.
          data-slot="dialog-title"
          // Only pass `id` when the caller explicitly provided one — passing
          // undefined here clobbers Radix's auto-generated id, which breaks
          // the auto-wired aria-labelledby on DialogContent.
          {...(titleId ? { id: titleId } : {})}
          className="m-0 text-[16px] font-semibold text-[#fbf5e8] tracking-[-0.01em] leading-[1.3]"
        >
          {title}
        </DialogPrimitive.Title>
        {subtitle && (
          <DialogPrimitive.Description
            data-slot="dialog-description"
            className="m-0 mt-1 text-[12.5px] leading-[1.4] text-[hsla(var(--pv-id-hue),25%,90%,0.72)]"
          >
            {subtitle}
          </DialogPrimitive.Description>
        )}
        {children}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {actions}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={closeAriaLabel}
              data-testid={closeTestId}
              className={cn(
                "p-1.5 rounded-md bg-transparent border-none cursor-pointer",
                "text-[hsla(var(--pv-id-hue),25%,92%,0.7)]",
                "hover:text-[#fbf5e8] hover:bg-black/20",
                "transition-colors duration-100",
              )}
            >
              <XIcon size={16} />
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
        "px-5 py-3.5 text-[13.5px] leading-[1.6]",
        "text-[hsla(var(--pv-id-hue),22%,92%,0.82)]",
        // Grow to fill available space between head + foot; scroll when the
        // content is taller than the container. The universal max-h-[85vh]
        // on Modal (desktop) + full-viewport on mobile means the body IS
        // the scrolling region in every tall-content case — making
        // overflow-y-auto the default here rather than a per-modal opt-in.
        // Consumers that need a different overflow (e.g. overflow-hidden
        // for a nested scroll region) can override via className.
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
        "px-5 py-3 flex justify-end items-center gap-2",
        "border-t border-[hsla(var(--pv-id-hue),60%,55%,0.22)]",
        "shadow-[0_-1px_0_rgba(255,220,190,0.05)]",
        "flex-shrink-0",
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
// Canonical section-tabs row for modals that host multiple panels
// (IdentityModal, RoleModal, RunbookEditorModal). Underline-style per the
// tasting spec (border-bottom accent when selected, transparent otherwise).
// Consumers own their tab STATE + PANEL rendering — this component only
// renders the row and fires onValueChange. It intentionally does NOT pull
// in Radix Tabs — for the current 2-3 tab cases a naked <div><button>
// group is simpler and matches what every consumer was already writing
// inline before this extraction (2026-09-30 UAT).
//
// no-adhoc-modal-tabs.test.ts enforces "modals must use this component
// for their tab row" via a source grep — anyone reinventing tabs inside
// a `*Modal*.tsx` file with the old bordered-pill signature trips the
// ship-gate. Meta-goal: agents building new modals-with-tabs pick this
// up without prompting.

export interface ModalTabDef<V extends string = string> {
  value: V;
  label: React.ReactNode;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
}

interface ModalTabsProps<V extends string> {
  tabs: ReadonlyArray<ModalTabDef<V>>;
  value: V;
  onValueChange: (next: V) => void;
  /** Injected into each tab button's data-testid as
   *  `<testIdPrefix>-<tab.value>`. */
  testIdPrefix?: string;
  /** Applied to the row wrapper for a custom data-testid — kept as prop
   *  rather than derived so consumers can preserve legacy testids across
   *  the migration. */
  rowTestId?: string;
  /** Rendered inline after the tabs, styled as a peer of the tab buttons.
   *  Used for row-scoped actions (RunbookEditorModal's `+ Add file`). */
  trailing?: React.ReactNode;
  /** When true, the row scrolls horizontally under overflow (file-strip
   *  case where the tab list is dynamic and can grow past the row width). */
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
  scrollable,
  className,
}: ModalTabsProps<V>): JSX.Element {
  return (
    <div
      className={cn(
        // Underline-style row (tasting L475-495). Flush against section
        // separator via `-mb-px` overlap on each tab's bottom border.
        "shrink-0 flex items-stretch gap-1 px-4 pt-1.5",
        "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.22)]",
        "bg-black/22",
        scrollable && "overflow-x-auto",
        className,
      )}
      style={scrollable ? { WebkitOverflowScrolling: "touch" } : undefined}
      data-slot="modal-tabs"
      data-testid={rowTestId}
    >
      {tabs.map(({ value: v, label, Icon }) => {
        const selected = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onValueChange(v)}
            aria-pressed={selected}
            data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
            className={cn(
              "shrink-0 flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium cursor-pointer",
              "border-b-2 -mb-px transition-colors duration-150",
              selected
                ? "text-[#fbf5e8] border-[hsla(var(--pv-id-hue),75%,65%,0.9)]"
                : "text-[hsla(var(--pv-id-hue),22%,92%,0.6)] hover:text-[#e8e4d8] border-transparent",
            )}
          >
            {Icon ? <Icon size={15} className="opacity-85" /> : null} {label}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

// ─── ModalSidebar ────────────────────────────────────────────────────────
//
// Canonical vertical file-list + editor layout for modals with an
// unbounded number of tabs. The horizontal ModalTabs strip works fine
// for 2-4 fixed section tabs (IdentityModal, RoleModal); it breaks down
// when the tab count is dynamic and can grow past the modal width
// (RunbookEditorModal / SkillsEditorModal with many files) — files fall
// off the right edge, need shift+scroll on desktop, and are inaccessible
// on mobile (2026-09-30 UAT).
//
// Renders as a two-column flex row that fills the space between
// <ModalHead> and <ModalFoot>. Left column: fixed-width sidebar with a
// vertical list of buttons + optional trailing action. Right column:
// the main editor pane passed as `children`.
//
// Rule of thumb: use <ModalTabs> for 2-4 known-ahead-of-time section
// tabs; use <ModalSidebar> when the list is dynamic (files, records,
// anything driven by user content).

interface ModalSidebarProps<V extends string> {
  tabs: ReadonlyArray<ModalTabDef<V>>;
  value: V;
  onValueChange: (next: V) => void;
  /** Injected into each button's data-testid as
   *  `<testIdPrefix>-<tab.value>`. */
  testIdPrefix?: string;
  /** Applied to the sidebar column for a custom data-testid — kept as
   *  a prop rather than derived so consumers can preserve legacy testids
   *  across the migration. */
  rowTestId?: string;
  /** Rendered inside the sidebar column, below the list — for
   *  sidebar-scoped actions (RunbookEditor / SkillsEditor "+ Add
   *  file"). */
  trailing?: React.ReactNode;
  /** The right-column main editor pane content. */
  children: React.ReactNode;
  className?: string;
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
}: ModalSidebarProps<V>): JSX.Element {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 flex flex-row",
        className,
      )}
      data-slot="modal-split"
    >
      {/* Sidebar column — fixed width, scrolls vertically. */}
      <aside
        className={cn(
          "w-[180px] shrink-0 flex flex-col min-h-0",
          "border-r border-[hsla(var(--pv-id-hue),60%,55%,0.22)]",
          "bg-black/22",
        )}
        data-slot="modal-sidebar"
        data-testid={rowTestId}
      >
        <div className="flex-1 min-h-0 overflow-y-auto py-1.5 flex flex-col gap-0.5">
          {tabs.map(({ value: v, label, Icon }) => {
            const selected = value === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onValueChange(v)}
                aria-pressed={selected}
                data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
                className={cn(
                  "shrink-0 flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-medium cursor-pointer",
                  "border-l-2 transition-colors duration-150 text-left min-w-0",
                  selected
                    ? "text-[#fbf5e8] border-[hsla(var(--pv-id-hue),75%,65%,0.9)] bg-[hsla(var(--pv-id-hue),55%,40%,0.35)]"
                    : "text-[hsla(var(--pv-id-hue),22%,92%,0.6)] hover:text-[#e8e4d8] hover:bg-white/[0.04] border-transparent",
                )}
              >
                {Icon ? (
                  <Icon size={13} className="opacity-85 shrink-0" />
                ) : null}
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
        {trailing ? (
          <div className="shrink-0 border-t border-[hsla(var(--pv-id-hue),60%,55%,0.22)] p-1">
            {trailing}
          </div>
        ) : null}
      </aside>
      {/* Main pane — fills remaining width. */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}

export { Modal, ModalHead, ModalBody, ModalFoot, ModalTabs, ModalSidebar };
export type { ModalProps, ModalSize };
