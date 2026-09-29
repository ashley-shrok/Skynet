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
// For required-shell modals (reload-required, version-check), pass
// `dismissible={false}` — backdrop click + ESC + close-X all become no-ops.

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
  /** When false, backdrop click + ESC + close-X do NOT dismiss the modal.
   *  Reserved for required-shell modals like SkewLockModal. */
  dismissible?: boolean;
  /** When false, backdrop click alone does NOT dismiss the modal (but ESC
   *  and the close-X still work if `dismissible` is true). Used by forms
   *  where accidentally clicking outside would trash user input —
   *  CreateProjectModal, CreateRoleDialog, NewSessionDialog. */
  dismissOnBackdrop?: boolean;
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
  dismissOnBackdrop = true,
  container,
  className,
  "data-testid": dataTestId,
  children,
  ...props
}: ModalProps) {
  const blockBackdrop = !dismissible || !dismissOnBackdrop;
  const blockEsc = !dismissible;
  return (
    <DialogPrimitive.Root {...props} modal={true}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay
          data-slot="modal-overlay"
          className={cn(
            "fixed inset-0 z-50 bg-black/55",
            "supports-backdrop-filter:backdrop-blur-sm",
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
              // rather than the app-wide amber default.
              "--pv-id-hue": String(hue),
              "--pv-hue": String(hue),
              background:
                "linear-gradient(160deg, hsla(var(--pv-id-hue), 50%, 38%, 0.60), hsla(var(--pv-id-hue), 45%, 22%, 0.68))",
              fontFamily: '"Inter Variable", system-ui, sans-serif',
            } as React.CSSProperties
          }
          onPointerDownOutside={
            blockBackdrop ? (e) => e.preventDefault() : undefined
          }
          onInteractOutside={
            blockBackdrop ? (e) => e.preventDefault() : undefined
          }
          onEscapeKeyDown={
            blockEsc ? (e) => e.preventDefault() : undefined
          }
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2",
            SIZE_CLASSES[size],
            "rounded-2xl overflow-hidden outline-none",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.35)]",
            "text-[#fbf5e8]",
            // Deep drop shadow + inset warm rim + hue outer glow (assistant-bubble aesthetic).
            "shadow-[0_8px_24px_rgba(0,0,0,0.5),0_1px_0_rgba(255,220,190,0.22)_inset,0_0_40px_hsla(var(--pv-id-hue),70%,55%,0.25)]",
            "supports-backdrop-filter:[backdrop-filter:blur(24px)_saturate(1.6)]",
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
          data-slot="modal-head-title"
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
            data-slot="modal-head-subtitle"
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

export { Modal, ModalHead, ModalBody, ModalFoot };
export type { ModalProps, ModalSize };
