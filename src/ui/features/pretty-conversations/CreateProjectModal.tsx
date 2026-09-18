// Phase 117 Plan 117-09 Task 1 — CreateProjectModal.tsx
//
// Controlled modal for creating a project. Backend-authoritative slug
// derivation (D-25 + Pitfall 1 in 117-RESEARCH.md): the modal submits the
// raw displayName; the response body carries the slug produced by
// normalizeToSlug on the backend. No client-side slug preview per D-26.
//
// Byte-shape mirror of NewConversationModal.tsx — same controlled
// `open + onOpenChange` pattern, same Radix Dialog primitives, same
// onCreated callback shape. The single text input replaces the whole
// participant-picker flow; everything else is identical chrome.
//
// Error surfacing:
//   - 409 → inline "already exists" error message; modal stays open
//   - 400 → inline "needs at least one letter or number" error
//   - other → generic inline error
// All errors keep the modal open so the user can retry. No toast infra
// in v1 (D-07 graceful degradation).
//
// Inline-error rendering: the alert node lives inside DialogContent so
// screen readers announce it via role="alert" (aria-live=assertive on
// role="alert" is a built-in browser behavior).

import { useCallback, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogTitle } from "@/components/dialog";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { createProject } from "@/api/project-list-api";

export interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on successful backend create with the echoed slug + user's raw displayName. */
  onCreated: (result: { slug: string; displayName: string }) => void;
  /** The host to create the project on. Panel picks a default from hostTree. */
  hostId: number;
}

/**
 * Extract HTTP status from a caught error. handleApiError (main-axios.ts:1020)
 * throws ApiError instances carrying `.status` and `.code`. Ducks through
 * `instanceof` since ApiError is not exported from main-axios.
 */
function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Map an error to the user-facing inline message. Depends on ApiError's
 * post-handleApiError shape (`.status` + `.code`).
 */
function interpretError(err: unknown, rawDisplayName: string): string {
  const status = statusOf(err);
  if (status === 409) {
    return `A project with the slug for "${rawDisplayName}" already exists on this host — pick a different name.`;
  }
  if (status === 400) {
    return "Project name needs at least one letter or number.";
  }
  return "Couldn't create the project — try again.";
}

export function CreateProjectModal({
  open,
  onOpenChange,
  onCreated,
  hostId,
}: CreateProjectModalProps) {
  const [displayName, setDisplayName] = useState<string>("");
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all local state whenever the modal closes so a re-open sees a
  // clean slate. Mirrors NewConversationModal.tsx:165-170 M1 fix.
  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setInFlight(false);
      setError(null);
    }
  }, [open]);

  const canSubmit = displayName.trim().length > 0 && !inFlight;

  const onSubmit = useCallback(async () => {
    const raw = displayName.trim();
    if (raw === "") return;
    setError(null);
    setInFlight(true);
    try {
      const result = await createProject(hostId, raw);
      onCreated({ slug: result.slug, displayName: raw });
      onOpenChange(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error({
        operation: "create_project_modal_submit_error",
        hostId,
        rawDisplayName: raw,
        errMessage: err instanceof Error ? err.message : "unknown",
        status: statusOf(err),
      });
      setError(interpretError(err, raw));
    } finally {
      setInFlight(false);
    }
  }, [displayName, hostId, onCreated, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // X + Esc + Cancel are the only close paths.
            e.preventDefault();
          }}
          aria-label="New project"
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[420px] md:max-h-[280px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
          data-testid="create-project-modal"
        >
          <DialogTitle className="px-6 pt-5 pb-2 text-[15px] font-semibold text-[#f0ebe0]">
            New project
          </DialogTitle>

          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-3 gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="create-project-name-input"
                className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
              >
                Project name
              </label>
              <input
                id="create-project-name-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Phase 117 sidebar"
                autoFocus
                disabled={inFlight}
                maxLength={80}
                aria-required="true"
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
                  "placeholder:text-[color:var(--color-pv-fg-dim)]",
                  "transition-colors duration-150",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              />
            </div>
            {error !== null && (
              <div
                role="alert"
                className="text-xs text-red-400"
                data-testid="create-project-error"
              >
                {error}
              </div>
            )}
          </div>

          <div
            className="px-6 py-4 shrink-0 flex flex-row gap-2 justify-end"
            style={{ borderTop: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={inFlight}
              data-testid="create-project-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onSubmit();
              }}
              disabled={!canSubmit}
              data-testid="create-project-submit"
            >
              Create project
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
