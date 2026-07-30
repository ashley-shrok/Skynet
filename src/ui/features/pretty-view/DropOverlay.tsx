import { Upload, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Full-surface drop overlay for pretty-view file uploads (UPLOAD-01,
// UPLOAD-12).
//
// LOCKS honored:
//   - `pointer-events-none` on the outermost element so the underlying
//     data-pv-root container in PrettyView still receives the drop event.
//     The overlay is a visual affordance only; PrettyView owns the
//     dragover / drop listeners and the resulting stageAttachments call.
//   - Absolute-positioned via `absolute inset-0`. Layered at `z-[95]` —
//     below IdentityBadge (z-[101]) so the badge stays clickable if
//     visible during a hover, above chat content. Kept in a distinct
//     z-band from the SessionHoldingOverlay (z-[99]) and app-modals
//     (z-[500]) per PrettyView's stacking convention.
//   - Mounts nothing when both flags are false (no chrome when idle).
//   - Folder-rejected variant uses a distinct visual treatment (warm
//     amber) from the plain drag-over variant (cool neutral) so a user
//     doesn't mistake refusal for acceptance.

export interface DropOverlayProps {
  isDragOver: boolean;
  /**
   * True for ~3s after a folder drop was refused. The caller (the
   * usePrettyViewUploads hook) owns the timer; this component only
   * renders based on the flag.
   */
  folderDropRejected: boolean;
}

export function DropOverlay({
  isDragOver,
  folderDropRejected,
}: DropOverlayProps) {
  if (!isDragOver && !folderDropRejected) return null;

  // Folder-rejection takes priority — if we're showing the amber nudge,
  // don't also render the cool drop-here treatment underneath. (Rare in
  // practice — the hook clears folderDropRejected via a timer, not via
  // a drag transition — but defensively single-render.)
  if (folderDropRejected) {
    return (
      <div
        data-testid="drop-overlay-folder-nudge"
        className={cn(
          "absolute inset-0 z-[95] pointer-events-none",
          "flex items-center justify-center",
          "bg-amber-500/10 backdrop-blur-[2px]",
        )}
      >
        <div
          className={cn(
            "flex flex-col items-center gap-2 px-6 py-4 rounded-lg",
            "bg-[rgba(30,20,10,0.75)] border border-amber-500/40",
            "text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
          )}
        >
          <AlertTriangle className="size-6 text-amber-300" aria-hidden />
          <div className="text-sm font-medium">
            please attach files or zip first
          </div>
          <div className="text-xs opacity-70">folders can't be uploaded</div>
        </div>
      </div>
    );
  }

  // isDragOver — cool neutral drop invitation.
  return (
    <div
      data-testid="drop-overlay-drag"
      className={cn(
        "absolute inset-0 z-[95] pointer-events-none",
        "flex items-center justify-center",
        "bg-slate-900/40 backdrop-blur-[2px]",
      )}
    >
      <div
        className={cn(
          "absolute inset-4 rounded-[16px]",
          "border-2 border-dashed border-white/30",
        )}
      />
      <div
        className={cn(
          "relative flex flex-col items-center gap-2 px-8 py-6 rounded-lg",
          "bg-[rgba(10,12,20,0.75)] border border-white/20",
          "text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.6)]",
        )}
      >
        <Upload className="size-7 text-slate-200" aria-hidden />
        <div className="text-base font-medium">Drop files here</div>
      </div>
    </div>
  );
}
