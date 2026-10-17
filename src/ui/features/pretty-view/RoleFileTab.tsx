import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KitBanner, KitButton, KitEmpty, KitLoading, kitConfirm } from "@/components/kit";
import { stripFrontmatter } from "@/lib/strip-frontmatter";
import type { TabState } from "./IdentityFileTab";
import { MarkdownEditor } from "./MarkdownEditor";

// Phase 22 SRIC-06 / Plan 22-06: tab renderer for the identity's role file
// (~/.claude/roles/<role>/<role>.md). Byte-shape mirror of IdentityFileTab.tsx:
// same props shape ({state, onSave?}), same edit-mode toolbar + monospace
// textarea, same read-mode ReactMarkdown preview, same TabState<string>
// discriminated union (imported from IdentityFileTab to share the same shape
// per Phase 18 IDMEDIT-01 convention).
//
// The backend does the two-step (identity file → role: frontmatter → role
// artifact) inside readRoleFile / writeRoleFile — the frontend never sees the
// role name and the wire contract stays (identityKey, hostId). Per D-CONTEXT
// § "No no-role fallback branches" (user 2026-08-04), a missing role:
// frontmatter surfaces as state.status === "error" and renders the standard
// error branch below — NOT a fake empty state.
//
// Phase 112 / Plan 02b: edit-mode body swapped from raw <textarea> to the
// shared <MarkdownEditor> (D-08 consolidation). Role files are always
// markdown by contract, so we pass a synthetic filename="role.md" that
// forces the D-06 gate into the pretty MDXEditor branch. Byte-shape mirror
// discipline with IdentityFileTab is preserved.

export function RoleFileTab({
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

  async function handleCancel() {
    const confirmedMarkdown = state.status === "ready" ? state.data : "";
    if (draft === confirmedMarkdown) {
      setEditing(false);
    } else {
      if (
        await kitConfirm({
          title: "Discard unsaved changes?",
          body: "Your edits to the role file haven't been saved.",
          confirmLabel: "Discard",
          destructive: true,
        })
      ) {
        setEditing(false);
        setDraft(confirmedMarkdown);
      }
    }
  }

  if (state.status === "loading") {
    return <KitLoading lines={5} />;
  }

  if (state.status === "error") {
    return <KitBanner tone="danger">Couldn&apos;t load role file: {state.error}</KitBanner>;
  }

  if (!state.data) {
    return <KitEmpty title="No role file found for this agent." />;
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar — only shown when ready and onSave is threaded */}
      {state.status === "ready" && onSave && (
        <div className="flex justify-end gap-2 shrink-0">
          {!editing && (
            <KitButton
              size="sm"
              onClick={() => {
                setDraft(state.data);
                setSaveError(null);
                setEditing(true);
              }}
            >
              Edit
            </KitButton>
          )}
          {editing && (
            <>
              <KitButton
                size="sm"
                disabled={saving}
                onClick={() => { void handleCancel(); }}
              >
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                size="sm"
                busy={saving}
                disabled={draft === state.data}
                onClick={() => { void handleSave(); }}
              >
                {saving ? "Saving…" : "Save"}
              </KitButton>
            </>
          )}
        </div>
      )}

      {/* Body — pretty MarkdownEditor in edit mode (D-08; synthetic
          filename="role.md" forces the D-06 pretty branch), ReactMarkdown
          preview otherwise. */}
      {editing ? (
        <div className="flex flex-col flex-1 min-h-0">
          <MarkdownEditor
            filename="role.md"
            content={draft}
            onChange={setDraft}
            disabled={saving}
          />
          {saveError && (
            <KitBanner tone="danger" className="mt-2">
              Save failed: {saveError}
            </KitBanner>
          )}
        </div>
      ) : (
        <div
          className={[
            "prose prose-sm max-w-none overflow-y-auto h-full px-1",
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
              a: ({ node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {stripFrontmatter(state.data)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
