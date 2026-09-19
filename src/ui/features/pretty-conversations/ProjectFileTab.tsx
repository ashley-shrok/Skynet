// Phase 117 followup — ProjectFileTab.tsx
//
// Byte-shape fork of RoleFileTab.tsx (pretty-view/) with project vocabulary.
// Same TabState<string> discriminated union (imported from IdentityFileTab to
// share the same shape per the Phase 18 IDMEDIT-01 convention that
// RoleFileTab also follows). Same edit-mode toolbar + MarkdownEditor body,
// same read-mode ReactMarkdown preview, same discard-unsaved-changes
// confirmation.
//
// Why a fork rather than a label-prop extension of RoleFileTab: the tab lives
// in a different feature folder (pretty-conversations/) and belongs with its
// caller (ProjectFileModal). Under 100 net lines and no shared behaviour to
// diverge — the byte-shape mirror discipline that RoleFileTab itself follows
// applies here too.

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import type { TabState } from "@/features/pretty-view/IdentityFileTab";
import { MarkdownEditor } from "@/features/pretty-view/MarkdownEditor";

export function ProjectFileTab({
  state,
  onSave,
}: {
  state: TabState<string>;
  onSave?: (contents: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    const confirmedMarkdown = state.status === "ready" ? state.data : "";
    if (draft === confirmedMarkdown) {
      setEditing(false);
    } else {
      if (window.confirm("Discard unsaved changes?")) {
        setEditing(false);
        setDraft(confirmedMarkdown);
      }
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load project file: {state.error}
      </div>
    );
  }

  // Empty-body case — a fresh project whose project.md holds only frontmatter
  // (or is truly missing on disk, which the backend surfaces as markdown=""
  // per readProjectFile's ENOENT contract). Render an inline empty state that
  // still exposes the Edit toolbar so the user can start writing.
  const isEmpty = !state.data;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar — Edit / Save+Cancel — shown when ready and onSave threaded */}
      {state.status === "ready" && onSave && (
        <div className="flex justify-end gap-2 shrink-0">
          {!editing && (
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => {
                setDraft(state.data);
                setSaveError(null);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="default"
                size="sm"
                className="cursor-pointer"
                disabled={saving || draft === state.data}
                onClick={() => { void handleSave(); }}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                disabled={saving}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      {/* Body — MarkdownEditor in edit mode (synthetic filename="project.md"
          forces the D-06 pretty branch of the shared editor), ReactMarkdown
          preview otherwise. */}
      {editing ? (
        <div className="flex flex-col flex-1 min-h-0">
          <MarkdownEditor
            filename="project.md"
            content={draft}
            onChange={setDraft}
            disabled={saving}
          />
          {saveError && (
            <div className="text-sm text-[color:var(--color-pv-code-fg)] mt-2">
              Save failed: {saveError}
            </div>
          )}
        </div>
      ) : isEmpty ? (
        <div className="text-sm text-[var(--color-pv-fg-muted)]">
          This project has no project.md yet — click Edit to start writing.
        </div>
      ) : (
        <div
          className={[
            "prose prose-sm max-w-none overflow-y-auto h-full px-1",
            "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
            "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            "dark:prose-invert",
            "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
            "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
            "prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]",
            "prose-pre:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]",
            "prose-code:before:content-none prose-code:after:content-none",
            "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
            "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
            "prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]",
            "prose-code:border prose-code:border-white/[0.06]",
          ].join(" ")}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {state.data}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
