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
// required-shell modals (SkewLockModal, ElectronVersionCheck) where the
// user must resolve the modal before continuing.
//
// `blocking={false}` keeps the composer / UI underneath INTERACTIVE while
// the modal is open. The overlay renders visually but is `pointer-events:
// none` so clicks pass through. Radix's focus-trap is disabled via
// `modal={false}` on Root. Reserved for read-and-type modals where
// blocking the composer is a UX regression — EditableFileModal is the
// canonical case (user may be reading a shared file AND typing a reply
// at the same time). The backdrop-never-dismisses rule still holds; this
// prop only controls whether the surrounding UI stays live.

// ─── Size scale ──────────────────────────────────────────────────────────

type ModalSize = "sm" | "md" | "lg" | "xl" | "list" | "settings";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-[340px]",
  md: "max-w-[400px]",
  lg: "max-w-[520px]",
  xl: "max-w-[640px]",
  // Structural variants — same anatomy, different container proportions.
  list: "max-w-[440px] h-[520px] flex flex-col",
  settings: "max-w-[640px] h-[480px] flex flex-col",
};

// ─── Modal (root) ────────────────────────────────────────────────────────

interface ModalProps
  extends Omit<
    React.ComponentProps<typeof DialogPrimitive.Root>,
    "modal" | "children"
  > {
  /** CSS custom-property --pv-id-hue value applied to this modal.
   *  Defaults to 190 (app-wide accent). Per-identity modals should pass
   *  the identity's colorHue; role-scoped modals should pass the role's
   *  colorHue. */
  hue?: number;
  /** Modal size. See SIZE_CLASSES. */
  size?: ModalSize;
  /** When false, ESC + close-X do NOT dismiss the modal. Backdrop click
   *  is ALWAYS blocked regardless of this flag (see file header). Reserved
   *  for required-shell modals (SkewLockModal, ElectronVersionCheck). */
  dismissible?: boolean;
  /** When false, the composer / UI underneath stays interactive while the
   *  modal is open. Overlay is `pointer-events: none`, Radix's focus-trap
   *  is disabled. Backdrop-dismiss still blocked. Reserved for read-and-
   *  type modals (EditableFileModal). Default: true. */
  blocking?: boolean;
  /** Portal container. Defaults to document.body. */
  container?: HTMLElement | null;
  /** Extra class for the modal content shell. */
  className?: string;
  /** Passed through to the modal content element — for test targeting and
   *  legacy test-id continuity across the Dialog → Modal migration. */
  "data-testid"?: string;
  children?: React.ReactNode;
}

function Modal({
  hue = 190,
  size = "sm",
  dismissible = true,
  blocking = true,
  container,
  className,
  "data-testid": dataTestId,
  children,
  ...props
}: ModalProps) {
  const blockEsc = !dismissible;
  return (
    <DialogPrimitive.Root {...props} modal={blocking}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay
          data-slot="modal-overlay"
          className={cn(
            // 2026-09-30: solid 55% black dim; NO backdrop-filter blur.
            // The blur-sm on a full-viewport overlay was showing up as a
            // GPU spike + "Page unresponsive" prompts on the user's
            // machine and the dim alone reads fine.
            "fixed inset-0 z-50 bg-black/55",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
            "duration-100",
            // When non-blocking, the overlay is visual dim only —
            // clicks pass through to the composer / UI underneath.
            !blocking && "pointer-events-none",
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
              // rather than the app-wide amber default.
              "--pv-id-hue": String(hue),
              "--pv-hue": String(hue),
              // Bumped from tasting alphas (0.60/0.68) so the gradient reads
              // solid over live chat content — the tasting sat on a static
              // dark page and could get away with more translucency.
              background:
                "linear-gradient(160deg, hsla(var(--pv-id-hue), 50%, 38%, 0.88), hsla(var(--pv-id-hue), 45%, 22%, 0.94))",
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
            "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2",
            SIZE_CLASSES[size],
            // Explicit 16px to match the tasting exactly; also independent of
            // the --radius token (which is theme-scoped and can be undefined).
            "rounded-[16px] overflow-hidden outline-none",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.35)]",
            "text-[#fbf5e8]",
            // Deep drop shadow + inset warm rim + hue outer glow (assistant-bubble aesthetic).
            "shadow-[0_8px_24px_rgba(0,0,0,0.5),0_1px_0_rgba(255,220,190,0.22)_inset,0_0_40px_hsla(var(--pv-id-hue),70%,55%,0.25)]",
            // Backdrop-filter removed 2026-09-30 — the modal gradient is
            // already 0.88/0.94 alpha so the shell reads solid without
            // needing the (expensive) blur behind it. Kept the solid
            // shadow + border chrome that carry the depth cue.
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "duration-100",
            className,
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
        // Grow to fill available space in list/settings variants.
        "flex-1 min-h-0",
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

export { Modal, ModalHead, ModalBody, ModalFoot, ModalTabs };
export type { ModalProps, ModalSize };
