import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogTitle } from "@/components/dialog";

// Phase 44 SKILLED-05: generic destructive-confirm modal-in-modal dialog.
// No direct in-repo mirror — synthesized from GlobalFilesModal.tsx L186-217
// (Radix Dialog primitive stack chrome) with UI-SPEC L212-220 specifics:
//
//   - Overlay: absolute inset-4 (dims parent modal only, not the full app)
//     + z-[125] (above parent's z-[120] content).
//   - Content: max-w-[400px] w-[85%], centered via absolute + translate,
//     rounded-[16px], z-[130]. Slightly darker glass gradient than parent
//     so the layer stack reads as "raised further".
//
// Consumed by SkillsEditorModal twice — once for delete-file, once for
// delete-skill — with heading/body/primaryLabel/onConfirm/inFlight/error props.
// The `container` prop lets both mounts portal into the same container as the
// parent modal (so the overlay's `inset-4` is anchored to the same box).

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  body: React.ReactNode;
  primaryLabel: string;
  onConfirm: () => void;
  inFlight: boolean;
  error?: string | null;
  container?: HTMLElement | null;
}

export default function DeleteConfirmDialog({
  open,
  onOpenChange,
  heading,
  body,
  primaryLabel,
  onConfirm,
  inFlight,
  error,
  container,
}: DeleteConfirmDialogProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* Overlay: inset-4 (parent-modal-only dim) + z-[125] above parent's z-[120] */}
        <DialogPrimitive.Overlay
          className="absolute inset-4 z-[125] bg-black/40 data-open:animate-in data-open:fade-in-0"
        />
        <DialogPrimitive.Content
          className="absolute z-[130] outline-none max-w-[400px] w-[85%] rounded-[16px] p-6 flex flex-col gap-4"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background:
              "linear-gradient(160deg, hsla(220, 45%, 20%, 0.92), hsla(220, 40%, 12%, 0.94))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
            color: "#e8e4d8",
          }}
        >
          <DialogTitle className="text-[15px] font-semibold text-[#f0ebe0]">
            {heading}
          </DialogTitle>
          <div className="text-sm text-[#e8e4d8]">{body}</div>
          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={inFlight}
              className="px-4 py-2 rounded-md bg-transparent border border-white/10 text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={onConfirm}
              disabled={inFlight}
              className="px-4 py-2 rounded-md bg-[hsla(0,75%,55%,0.20)] hover:bg-[hsla(0,75%,55%,0.30)] text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: "inset 0 0 0 1px hsla(0, 75%, 65%, 0.35)" }}
            >
              {inFlight ? "Deleting…" : primaryLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
