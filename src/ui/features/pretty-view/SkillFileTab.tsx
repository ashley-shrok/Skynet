import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";
import { MarkdownEditor } from "./MarkdownEditor";

// Phase 44 SKILLED-05: per-file tab body for SkillsEditorModal.
//
// Byte-shape mirror of GlobalFileTab.tsx (Phase 23 GEFM-05) with two
// Phase 44 branches added:
//   1. Non-text file placeholder — when data.isText === false, render
//      AlertTriangle + heading + body per UI-SPEC L162-167. Editor pane
//      is replaced (never render textarea for binary files). This is a
//      tab-level policy about binary content — it fires BEFORE the
//      MarkdownEditor gate and stays in this file.
//   2. Delete-file trigger — a Trash2 icon-button placed to the LEFT of
//      the Save button per UI-SPEC L188, fires onRequestDelete up to the
//      parent modal to open the DeleteConfirmDialog.
//
// TabState imported from IdentityFileTab (not duplicated) per Phase 18
// IDMEDIT-01 convention. onDraftChange from Phase 40 40-03 is intentionally
// NOT threaded here — skills editor has no close-guard confirm gate.
//
// Phase 112 Plan 02a: adopts the shared MarkdownEditor for the ready+text
// branch. A required `filename` prop is threaded from the hosting modal
// (SkillsEditorModal / RunbookEditorModal). MarkdownEditor gates on the
// extension per D-06 — .md renders the pretty MDXEditor, everything else
// (.sh, .txt, no-extension, etc.) keeps the verbatim raw <textarea>
// styling that used to live inline here. Save flow (mtime optimistic
// concurrency), loading/error branches, non-text placeholder, and Trash2
// delete trigger are unchanged.

/**
 * Per-file data stored in the tab: the file's content + the mtime it was
 * read with + isText flag driving the text-vs-placeholder branch. mtime is
 * threaded to onSave for optimistic-concurrency writes (PUT /skills-editor/write
 * requires expectedMtime to detect stale edits).
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
}): JSX.Element {
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed draft from state.data.content whenever the mtime changes (i.e. after
  // a server-authoritative mtime echo from a successful save, or after a
  // 409-conflict reload). Reset key is mtime so a re-save after content
  // unchanged still correctly reseeds.
  useEffect(() => {
    if (state.status === "ready") {
      setDraft(state.data.content);
      setSaveError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status === "ready" ? state.data.mtime : null]);

  const handleSave = useCallback(async () => {
    if (state.status !== "ready") return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft, state.data.mtime);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [state, draft, onSave]);

  // Loading branch — mirrors GlobalFileTab L77-84 (three skeletons)
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  // Error branch — mirrors GlobalFileTab L88-93
  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load file: {state.error}
      </div>
    );
  }

  // Phase 44 non-text branch — per UI-SPEC L162-167. Renders AlertTriangle
  // + heading + body; no textarea, no save button. Height matches a loaded
  // text file (min-h-[400px]) so switching tabs doesn't jump the layout.
  if (!state.data.isText) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[400px]">
        <AlertTriangle size={20} className="text-[#a89a80]" />
        <div className="text-sm font-semibold text-[#e8e4d8]">
          Not a text file
        </div>
        <div className="text-sm text-[#a89a80]">
          This file isn&apos;t text and can&apos;t be edited here.
        </div>
      </div>
    );
  }

  // Ready + text branch — MarkdownEditor gates on filename per D-06 (.md →
  // pretty MDXEditor, else → verbatim raw <textarea>). Byte-for-byte
  // textarea styling is preserved inside MarkdownEditor for the non-.md
  // branch. Phase 44 addition: Trash2 delete-file trigger placed LEFT of
  // Save button per UI-SPEC L188. No Cancel button — modal-close is cancel.
  return (
    <div className="flex flex-col h-full gap-2">
      <MarkdownEditor
        filename={filename}
        content={draft}
        onChange={setDraft}
        disabled={saving}
      />
      {saveError && (
        <div className="text-sm text-red-400 px-1">{saveError}</div>
      )}
      <div className="flex justify-end gap-2 shrink-0 items-center">
        {filename !== "SKILL.md" && (
          <button
            type="button"
            title="Delete this file"
            onClick={() => onRequestDelete?.()}
            className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => { void handleSave(); }}
          disabled={saving || draft === state.data.content}
          className="px-4 py-2 rounded-md bg-[hsla(var(--pv-id-hue,220),80%,60%,0.2)] hover:bg-[hsla(var(--pv-id-hue,220),80%,60%,0.3)] text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed text-sm cursor-pointer"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
