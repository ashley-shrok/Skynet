// Phase 117 followup — ProjectFileModal.tsx
//
// Controlled modal for editing a project's project.md. Opens from the
// per-section context menu's "Edit project file" item (wired in
// PrettyConversationsPanel handleEditProjectFile).
//
// Byte-shape mirror of RoleModal.tsx (pretty-view/) with the tabs / cosmetic
// block / wakeups / bounties surfaces removed. What remains is the load →
// edit → save round-trip and the modal chrome (glass gradient shell, sr-only
// title, glass X close, portal to document.body).
//
// Load path: GET /projects/:slug/file via getProjectFile — {markdown: string}
// resolves once, populates the state, ProjectFileTab renders.
// Save path: PUT /projects/:slug/file via updateProjectFile — server-echoes
// the written body which becomes the new local source of truth.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { cn } from "@/lib/utils";
import { getProjectFile, updateProjectFile } from "@/api/project-list-api";
import type { TabState } from "@/features/pretty-view/IdentityFileTab";
import { ProjectFileTab } from "./ProjectFileTab";

export interface ProjectFileModalProps {
  /** Controlled — true = modal open. */
  open: boolean;
  /** Fires with `false` when X or Esc dismiss. */
  onOpenChange: (open: boolean) => void;
  /** Project slug (kebab-case). Addresses the GET/PUT endpoints. */
  slug: string;
  /** Display name to show in the header; from the project section header. */
  displayName: string;
  /** SSH host id — pane's active host. Threaded through both endpoints. */
  hostId: number;
}

export function ProjectFileModal({
  open,
  onOpenChange,
  slug,
  displayName,
  hostId,
}: ProjectFileModalProps) {
  const [fileState, setFileState] = useState<TabState<string>>({
    status: "loading",
  });

  // Fetch project.md on open. Reset state on close so a re-open shows the
  // loading skeleton rather than the previous project's stale content.
  useEffect(() => {
    if (!open) return;

    setFileState({ status: "loading" });
    let cancelled = false;

    void (async () => {
      try {
        const { markdown } = await getProjectFile(hostId, slug);
        if (!cancelled) {
          setFileState({ status: "ready", data: markdown });
        }
      } catch (e) {
        if (!cancelled) {
          setFileState({
            status: "error",
            error: e instanceof Error ? e.message : "Connection failed",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, slug, hostId]);

  const handleSave = useCallback(
    async (contents: string): Promise<void> => {
      // updateProjectFile throws (via handleApiError) on any non-2xx — the
      // throw propagates to ProjectFileTab's handleSave which surfaces it
      // inline. Success server-echoes the written body; that becomes the new
      // source of truth in state so a subsequent Cancel discards to the just-
      // saved value rather than the pre-edit value.
      const { markdown } = await updateProjectFile(hostId, slug, contents);
      setFileState({ status: "ready", data: markdown });
    },
    [hostId, slug],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          data-slot="project-file-modal-content"
          data-testid="project-file-modal"
          onInteractOutside={(e) => {
            // X + Esc are the only close paths — mirrors RoleModal +
            // CreateProjectModal.
            e.preventDefault();
          }}
          aria-label={`Edit ${displayName}`}
          className={cn(
            "fixed inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[720px] md:max-h-[80vh] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            // Neutral blue chrome mirrors CreateProjectModal — projects have
            // no per-project hue in v1, so we borrow the sibling modal's palette
            // for family resemblance across all project surfaces.
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          <DialogTitle className="sr-only">Edit {displayName}</DialogTitle>

          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-semibold text-base text-[#f0ebe0] truncate leading-tight">
                {displayName}
              </span>
              <span className="text-xs text-[#a89a80] truncate leading-tight">
                project.md
              </span>
            </div>

            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                data-testid="project-file-modal-close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow =
                    "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            <ProjectFileTab state={fileState} onSave={handleSave} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
