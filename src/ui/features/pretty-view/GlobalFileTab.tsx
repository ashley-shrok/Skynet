import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";
import { MarkdownEditor } from "./MarkdownEditor";

// Phase 23 GEFM-05: per-file tab body for GlobalFilesModal.
//
// Structural mirror of RoleFileTab.tsx (Phase 22 SRIC-06) — preview mode
// stripped per CONTEXT §GEFM-05 "plain monospace textarea, whole-file
// edit". Textarea is always editable — no view/edit-mode toggle.
//
// TabState imported from IdentityFileTab (not duplicated) per Phase 18
// IDMEDIT-01 convention: each tab file self-contained, TabState shared via import.
//
// Phase 112 Plan 02a: adopts the shared MarkdownEditor for the ready branch.
// A required `filename` prop is threaded from the hosting modal
// (GlobalFilesModal / EditableFileModal). MarkdownEditor gates on the
// extension per D-06 — .md renders the pretty MDXEditor, everything else
// keeps the verbatim raw <textarea> styling that used to live inline here.
// Save flow (mtime optimistic concurrency), onDraftChange divergence
// signalling, and loading/error branches are unchanged.

/**
 * Per-file data stored in the tab: the file's content + the mtime it was
 * read with. mtime is threaded to onSave for optimistic-concurrency writes
 * (PUT /global-files/write requires expectedMtime to detect stale edits).
 */
export type GlobalFileTabData = { content: string; mtime: number };

export default function GlobalFileTab({
  state,
  onSave,
  onDraftChange,
  filename,
  hideSaveButton = false,
}: {
  state: TabState<GlobalFileTabData>;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  /**
   * Phase 40 Plan 40-03 (rev-2): optional callback fired whenever the draft
   * diverges from or converges back to the fetched content. EditableFileModal
   * uses this to drive its close-guard confirm prompt ("Discard unsaved
   * changes?"). Fully backward-compatible — existing callers (GlobalFilesModal)
   * pass no prop and see zero behavior change.
   */
  onDraftChange?: (dirty: boolean) => void;
  /**
   * Phase 112 Plan 02a: file path/name (with extension) — drives the D-06
   * filetype gate inside MarkdownEditor (.md → pretty MDXEditor, else →
   * raw <textarea>). Required so the gate is deterministic; hosting modals
   * (GlobalFilesModal, EditableFileModal) always know the filename.
   */
  filename: string;
  /**
   * When true, GlobalFileTab does NOT render its own save button — the
   * consumer owns save placement in its own header/chrome. WorkspaceFileViewer
   * uses this to hoist save into the Files-tab header alongside Back and
   * Download. onSave is still called by the consumer via handleSave.
   */
  hideSaveButton?: boolean;
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

  // Phase 40 Plan 40-03 (rev-2): fire onDraftChange whenever draft diverges
  // from or converges back to the fetched content. Only fires when state is
  // ready — there is no "dirty" concept before content loads. Existing callers
  // that omit the prop see this effect as a no-op.
  useEffect(() => {
    if (!onDraftChange) return;
    if (state.status !== "ready") return;
    onDraftChange(draft !== state.data.content);
  }, [draft, state, onDraftChange]);

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

  // Loading branch — mirrors RoleFileTab L60-67 (same skeleton class)
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  // Error branch — mirrors RoleFileTab L70-76
  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load file: {state.error}
      </div>
    );
  }

  // Ready branch — MarkdownEditor gates on filename per D-06 (.md → pretty
  // MDXEditor, else → verbatim raw <textarea>). Byte-for-byte textarea
  // styling is preserved inside MarkdownEditor for the non-.md branch.
  // 2026-08-05: no early-return for empty (content="" && mtime===0) — the
  // editor below renders empty and the user can type + save to CREATE the
  // file via the write handler's SFTP tmp+rename path. The disable predicate
  // (`draft === state.data.content`) keeps the save button off until the user
  // actually types something, so an unchanged-empty file still can't save.
  // No Cancel button — modal-close is cancel.
  return (
    <div className="flex flex-col h-full gap-2">
      {!hideSaveButton && (
        <div className="flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saving || draft === state.data.content}
            className="px-4 py-2 rounded-md bg-[hsla(var(--pv-id-hue,220),80%,60%,0.2)] hover:bg-[hsla(var(--pv-id-hue,220),80%,60%,0.3)] text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed text-sm cursor-pointer"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <MarkdownEditor
          filename={filename}
          content={draft}
          onChange={setDraft}
          disabled={saving}
        />
      </div>
      {saveError && (
        <div className="text-sm text-red-400 px-1">{saveError}</div>
      )}
    </div>
  );
}
