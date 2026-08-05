import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";

// Phase 23 GEFM-05: per-file tab body for GlobalFilesModal.
//
// Structural mirror of RoleFileTab.tsx (Phase 22 SRIC-06) — preview mode
// stripped per CONTEXT §GEFM-05 "plain monospace textarea, whole-file
// edit". Textarea is always editable — no view/edit-mode toggle.
//
// TabState imported from IdentityFileTab (not duplicated) per Phase 18
// IDMEDIT-01 convention: each tab file self-contained, TabState shared via import.

/**
 * Per-file data stored in the tab: the file's content + the mtime it was
 * read with. mtime is threaded to onSave for optimistic-concurrency writes
 * (PUT /global-files/write requires expectedMtime to detect stale edits).
 */
export type GlobalFileTabData = { content: string; mtime: number };

export default function GlobalFileTab({
  state,
  onSave,
}: {
  state: TabState<GlobalFileTabData>;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
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

  // Ready branch — plain monospace textarea (always editable, no view/edit toggle).
  // 2026-08-05: no early-return for empty (content="" && mtime===0) — the
  // textarea below renders empty and the user can type + save to CREATE the
  // file via the write handler's SFTP tmp+rename path. The disable predicate
  // (`draft === state.data.content`) keeps the save button off until the user
  // actually types something, so an unchanged-empty file still can't save.
  // Textarea styling copied VERBATIM from RoleFileTab.tsx L134 per CONTEXT §specifics
  // "do NOT reinvent, it's tuned". No Cancel button — modal-close is cancel.
  return (
    <div className="flex flex-col h-full gap-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
        spellCheck={false}
      />
      {saveError && (
        <div className="text-sm text-red-400 px-1">{saveError}</div>
      )}
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
    </div>
  );
}
