import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";

// Patch #17g: tab renderer for the identity's <key>.md file.
//
// Shared TabState<T> type is exported from here so all 4 tab files share
// the same shape without a shared abstraction layer (each tab file is self-contained).
//
// Markdown scaffold mirrors ChatMessage.tsx assistant bubble — same
// ReactMarkdown + remarkGfm + prose class chain. The ~675-line identity file
// scrolls inside the tab pane via overflow-y-auto on the wrapper div.
//
// Phase 18 / IDMEDIT-01: edit-mode toolbar + monospace textarea. onSave is
// optional — when undefined the tab renders in read-only mode (existing call
// sites that do not thread a handler remain safe). Toolbar is hidden when
// state.status !== "ready" or onSave is undefined.

export type TabState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

export function IdentityFileTab({
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
        Couldn&apos;t load identity file: {state.error}
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No identity file found for this identity.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar — only shown when ready and onSave is threaded */}
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

      {/* Body — textarea in edit mode, ReactMarkdown preview otherwise */}
      {editing ? (
        <div className="flex flex-col flex-1 min-h-0">
          <textarea
            className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          {saveError && (
            <div className="text-sm text-[color:var(--color-pv-code-fg)] mt-2">
              Save failed: {saveError}
            </div>
          )}
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
              a: ({ node, ...props }) => (
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
