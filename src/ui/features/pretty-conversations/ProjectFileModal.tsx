// ProjectFileModal — controlled modal for editing a project's project.md.
// Opens from the per-section context menu's "Edit project file" item
// (wired in PrettyConversationsPanel handleEditProjectFile).
//
// Modal-unification 2026-09-29: composes from the canonical <Modal> shell.
// Head shows only the project displayName (user: every project file is
// called project.md, so the filename in the header is noise). The
// pre-unification view/edit toggle is gone — opening the modal drops the
// user straight into edit mode. Save + Close live in the canonical foot;
// close routes through a draft-guard that fires window.confirm on close
// when the draft is dirty (same pattern as EditableFileModal).
//
// Load path: GET /projects/:slug/file via getProjectFile — {markdown: string}
// resolves once, populates state, ProjectFileTab renders.
// Save path: PUT /projects/:slug/file via updateProjectFile — server-echoes
// the written body which becomes the new local source of truth (so a
// subsequent Close after successful save doesn't re-prompt for confirm).

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
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
}: ProjectFileModalProps): JSX.Element {
  const [fileState, setFileState] = useState<TabState<string>>({
    status: "loading",
  });
  const [draft, setDraft] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Bypass the draft-guard confirm on save-success closes (mirrors
  // EditableFileModal's savingRef pattern).
  const savingRef = useRef(false);

  // Fetch project.md on open. Reset state on close so a re-open shows the
  // loading skeleton rather than the previous project's stale content.
  useEffect(() => {
    if (!open) {
      setFileState({ status: "loading" });
      setDraft("");
      setIsDirty(false);
      setSaving(false);
      setSaveError(null);
      savingRef.current = false;
      return;
    }

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

  // Draft-guard wrapper on onOpenChange — dirty + not-mid-save → confirm.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty && !savingRef.current) {
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    savingRef.current = true;
    setSaveError(null);
    try {
      const { markdown } = await updateProjectFile(hostId, slug, draft);
      // Server-echoes the written body — that becomes the new source of
      // truth so any subsequent close doesn't re-prompt for confirm.
      setFileState({ status: "ready", data: markdown });
      // Reset dirty flag AFTER state update (the ProjectFileTab's own
      // effect will fire onDraftChange(false) once draft === new content).
      onOpenChange(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [saving, hostId, slug, draft, onOpenChange]);

  const canSave = fileState.status === "ready" && isDirty && !saving;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="lg"
      className="max-h-[80vh] flex flex-col"
      data-testid="project-file-modal"
    >
      <ModalHead title={displayName} closeTestId="project-file-modal-close" />

      <ModalBody className="p-0 overflow-y-auto flex flex-col px-6 py-4">
        <ProjectFileTab
          state={fileState}
          onDraftChange={setIsDirty}
          onDraftContentChange={setDraft}
          disabled={saving}
        />
        {saveError !== null && (
          <div
            role="alert"
            data-testid="project-file-modal-save-error"
            className="mt-3 px-3 py-2 rounded-md text-[12px] text-[hsla(4,60%,88%,1)] bg-[hsla(4,60%,40%,0.16)] border border-[hsla(4,60%,55%,0.32)]"
          >
            Save failed: {saveError}
          </div>
        )}
      </ModalBody>

      <ModalFoot>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          disabled={saving}
          data-testid="project-file-modal-close-foot"
          className={cn(
            "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
            "bg-black/20 border border-white/10",
            "hover:bg-black/30",
            "text-[#e8e4d8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={!canSave}
          data-testid="project-file-modal-save"
          className={cn(
            "px-4 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer",
            "bg-[hsla(var(--pv-id-hue),65%,45%,0.75)]",
            "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.85)]",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.7)]",
            "text-[#f4f1e8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </ModalFoot>
    </Modal>
  );
}
