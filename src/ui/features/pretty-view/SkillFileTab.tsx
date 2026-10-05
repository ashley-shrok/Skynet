import { Trash2 } from "lucide-react";
import type { TabState } from "./IdentityFileTab";
import { FileView } from "./file-viewers/FileView";
import type { BinaryDraft } from "./file-viewers/registry";

// Phase 44 SKILLED-05: per-file tab body for SkillsEditorModal and
// RunbookEditorModal.
//
// The file body (viewer choice, draft, binary notice, Save) is the shared
// <FileView>; this wrapper only adds the skill-specific delete-file trigger
// (Trash2, hidden for SKILL.md) to FileView's toolbar row.

/**
 * Per-file data stored in the tab: the file's content + the mtime it was
 * read with + isText flag (server byte-sniff; content is "" when false).
 * mtime is threaded to onSave for optimistic-concurrency writes
 * (PUT /skills-editor/write requires expectedMtime to detect stale edits).
 */
export type SkillFileTabData = {
  content: string;
  mtime: number;
  isText: boolean;
};

export default function SkillFileTab({
  state,
  onSave,
  onRequestDelete,
  filename,
  hideSaveButton = false,
  onDraftContentChange,
  onDraftChange,
  mediaUrl,
  downloadUrl,
  onBinaryDraftChange,
}: {
  state: TabState<SkillFileTabData>;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  /**
   * Fired when the user clicks the Trash2 delete-file trigger. Parent modal
   * opens DeleteConfirmDialog and calls deleteSkillFile on confirm. Optional
   * so the tab still renders when the parent doesn't care (e.g. in a preview
   * scenario) — SkillsEditorModal always passes it.
   */
  onRequestDelete?: () => void;
  /**
   * Phase 112 Plan 02a: file path/name (with extension) — drives the D-06
   * filetype gate inside MarkdownEditor (.md → pretty MDXEditor, else →
   * raw <textarea>). Required so the gate is deterministic; hosting modals
   * (SkillsEditorModal, RunbookEditorModal) always know the filename.
   */
  filename: string;
  /**
   * When true, the tab does NOT render its own Save button — the outer chrome
   * owns save placement in its own foot. Consumers still receive onSave
   * calls through the outer Save button (via onDraftContentChange +
   * external save handler). Modal-unification 2026-09-29 seam:
   * RunbookEditorModal passes true to move Save into the canonical
   * <ModalFoot>. Default false preserves the pre-unification behavior
   * SkillsEditorModal relies on.
   */
  hideSaveButton?: boolean;
  /**
   * Fires with the raw draft string on every keystroke. Consumers that
   * host their own outer Save button use this to know what to write.
   * Guarded on `ready` state — no-op until content loads.
   */
  onDraftContentChange?: (draft: string) => void;
  /**
   * Fires when the draft diverges from or converges back to the fetched
   * content. Consumers use this to compute cross-tab dirty state for a
   * close-confirm draft-guard. Guarded on `ready` state.
   */
  onDraftChange?: (dirty: boolean) => void;
  /** Streamed in-place URL for viewers (media, PDF); see skillFileUrl. */
  mediaUrl?: string;
  /** Download link offered on the can't-preview notice. */
  downloadUrl?: string;
  /** Unsaved binary edits (PDF annotations); see FileView. */
  onBinaryDraftChange?: (draft: BinaryDraft | null) => void;
}): JSX.Element {
  return (
    <FileView
      filename={filename}
      state={state}
      mediaUrl={mediaUrl}
      downloadUrl={downloadUrl}
      onBinaryDraftChange={onBinaryDraftChange}
      onSave={onSave}
      hideSaveButton={hideSaveButton}
      onDraftChange={onDraftChange}
      onDraftContentChange={onDraftContentChange}
      toolbarStart={
        state.status === "ready" && filename !== "SKILL.md" ? (
          <button
            type="button"
            title="Delete this file"
            onClick={() => onRequestDelete?.()}
            className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        ) : undefined
      }
    />
  );
}
