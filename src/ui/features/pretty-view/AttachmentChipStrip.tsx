import { File as FileIcon, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { formatHumanSize } from "@/api/pretty-view-upload-protocol";

// Chip strip staging component for pretty-view file uploads (UPLOAD-04).
//
// LOCKS honored:
//   - Returns null when attachments.length === 0 — the strip has NO
//     empty-state chrome, no wrapper div, nothing (UPLOAD-04 mounting rule
//     per 05-CONTEXT.md decisions).
//   - Chip = filename + human-size + × remove control only. No inline
//     previews, no thumbnails, no per-chip caption input (UPLOAD-11 +
//     UPLOAD-13 HARD LOCKS carried forward from the sender-side lock).
//   - One caption per batch is enforced UPSTREAM (ComposeBox owns the
//     single textarea). This component only stages the attachment row.
//   - Visual language borrows patch #86 ImageBubble's rounded / muted
//     border feel without importing anything from it.

// Public shape — kept minimal so tests can pass in POJOs without needing
// real File objects, and so the hook's StagedAttachment can flow in
// unchanged (structural compat).
export interface StagedAttachmentLike {
  tempId: string;
  file: { name: string; size: number; type: string };
  status: "staged" | "uploading" | "complete" | "error";
  bytesUploaded: number;
  error: string | null;
}

export interface AttachmentChipStripProps {
  attachments: StagedAttachmentLike[];
  onRemove: (tempId: string) => void;
  className?: string;
  /**
   * Phase 05 Plan 03: read-only render for sender-side chips in
   * ChatMessage's injected-turn bubble. When true:
   *   - No × remove button (batch is already sent — removal is nonsense).
   *   - No progress ring (chips are all `status: 'complete'` by contract;
   *     upload_ready_to_inject only fires on all-complete).
   *   - No error decorations (see above — errored chips never reach the
   *     read-only render path).
   *   - Uses subdued "sent" styling instead of the staging chip's
   *     interactive warm-black.
   * Chip content is filename + formatHumanSize(size) ONLY, matching the
   * UPLOAD-11 chip-only lock (no thumbnails, no inline previews, no
   * landing-path display).
   */
  readOnly?: boolean;
}

export function AttachmentChipStrip({
  attachments,
  onRemove,
  className,
  readOnly = false,
}: AttachmentChipStripProps) {
  // UPLOAD-04 mounting rule: no wrapper when empty. Returning null lets
  // ComposeBox mount this unconditionally without visual chrome when the
  // user hasn't staged anything.
  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="attachment-chip-strip"
      className={cn(
        "flex flex-wrap gap-2 px-1 py-1",
        className,
      )}
      role="list"
      aria-label={readOnly ? "Sent attachments" : "Staged attachments"}
    >
      {attachments.map((att) => (
        <Chip
          key={att.tempId}
          attachment={att}
          onRemove={onRemove}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function Chip({
  attachment,
  onRemove,
  readOnly,
}: {
  attachment: StagedAttachmentLike;
  onRemove: (tempId: string) => void;
  readOnly: boolean;
}) {
  const { tempId, file, status, bytesUploaded, error } = attachment;
  const isError = status === "error";
  const isComplete = status === "complete";
  const isUploading = status === "uploading";
  const pct =
    file.size > 0
      ? Math.max(0, Math.min(100, Math.round((bytesUploaded / file.size) * 100)))
      : 0;

  return (
    <div
      data-testid="attachment-chip"
      data-status={status}
      data-readonly={readOnly ? "true" : undefined}
      role="listitem"
      title={
        isError && !readOnly
          ? (error ?? "upload failed")
          : `${file.name} (${formatHumanSize(file.size)})`
      }
      className={cn(
        "inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs",
        "border shadow-[inset_0_1px_0_rgba(220,225,245,0.05)]",
        // Read-only sender-side render — quiet neutral. Overrides any of
        // the interactive-state tints below. Sits inside a user bubble so
        // the border is a hair lighter and the background a hair more
        // translucent than the staging chip.
        readOnly &&
          "bg-white/[0.04] border-white/[0.10] text-[#e8e4d8]",
        // Base warm-black background (matches ImageBubble family aesthetic
        // at low visual weight). Only applied when NOT read-only.
        !readOnly && !isError && !isComplete && "bg-[rgba(10,12,20,0.5)] border-white/10 text-[#e8e4d8]",
        // Error state — destructive tint, keeps chip visible so user can
        // decide to retry or remove. Suppressed in read-only mode.
        !readOnly && isError &&
          "bg-destructive/10 border-destructive text-[#f8caca]",
        // Complete state — quiet emerald edge to signal "landed" without
        // shouting. Suppressed in read-only mode (all chips are complete
        // by contract; the sent-bubble treatment carries that semantic).
        !readOnly && isComplete && "bg-[rgba(10,20,15,0.55)] border-emerald-500/40 text-[#dfe8e0]",
      )}
    >
      <FileIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="max-w-[220px] truncate">{file.name}</span>
      <span className="opacity-60">{formatHumanSize(file.size)}</span>

      {/* Interactive-state indicators — one at a time. Suppressed in read-only. */}
      {!readOnly && isUploading && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`Upload progress for ${file.name}`}
          className="w-8 h-1.5 rounded-full bg-white/10 overflow-hidden"
        >
          <div
            className="h-full bg-emerald-400/80 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {!readOnly && isComplete && (
        <Check
          className="size-3.5 shrink-0 text-emerald-400"
          aria-label="Upload complete"
        />
      )}
      {!readOnly && isError && (
        <>
          <AlertCircle
            className="size-3.5 shrink-0 text-[color:var(--color-pv-code-fg)]"
            aria-label="Upload failed"
          />
          {error && (
            <span className="max-w-[160px] truncate text-[10px] opacity-80">
              {error}
            </span>
          )}
        </>
      )}

      {/* × remove control — suppressed in read-only mode (batch is already
          sent; removing a landed file from the sender bubble would misrepresent
          what the agent has seen). */}
      {!readOnly && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => onRemove(tempId)}
          aria-label={`Remove attachment ${file.name}`}
          title={`Remove ${file.name}`}
          className="ml-1 opacity-70 hover:opacity-100"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
