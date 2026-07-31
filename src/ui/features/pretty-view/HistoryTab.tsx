import { useState } from "react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import type { TabState } from "./IdentityFileTab";

// Patch #17g: tab renderer for the identity's history.md (reverse-chronological list).
//
// Each line is parsed on `·` (space-middle-dot-space) into:
//   date (muted mono) | gist (main text) | slugs (pill chips, not clickable in v1).
// Lines that don't match the format fall back to raw text in the gist slot.
//
// History.md format (per ~/.claude/skills/id/SKILL.md):
//   YYYY-MM-DD · gist · slugs: foo,bar
// The slugs field is optional — 2-field variant is valid.
//
// Phase 18 / IDMEDIT-02: edit-mode toolbar + monospace textarea. onSave is
// optional — when undefined the tab renders in read-only mode. State type
// widened from TabState<string[]> to TabState<{ entries: string[]; markdown: string }>
// so the editor can populate its textarea with the raw file body without a
// separate read round-trip. Entries are used for read-mode list rendering as
// before; markdown is used as the textarea seed in edit-mode.

function parseHistoryLine(line: string): { date?: string; gist: string; slugs: string[] } {
  const parts = line.split(" · ");
  if (parts.length >= 3) {
    const date = parts[0];
    const gist = parts[1];
    const slugField = parts.slice(2).join(" · "); // rejoin in case gist had · in it — take last part as slugs
    const slugsRaw = slugField.replace(/^slugs:\s*/i, "");
    const slugs = slugsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { date, gist, slugs };
  }
  if (parts.length === 2) {
    return { date: parts[0], gist: parts[1], slugs: [] };
  }
  // Fallback: raw line, no date or slugs
  return { gist: line, slugs: [] };
}

export function HistoryTab({
  state,
  onSave,
}: {
  state: TabState<{ entries: string[]; markdown: string }>;
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
    const confirmedMarkdown = state.status === "ready" ? state.data.markdown : "";
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
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-8 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load history: {state.error}
      </div>
    );
  }

  if (state.data.entries.length === 0 && !editing) {
    return (
      <div className="flex flex-col h-full gap-2">
        {state.status === "ready" && onSave && (
          <div className="flex justify-end gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(state.data.markdown);
                setSaveError(null);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
        )}
        <div className="text-sm text-[var(--color-pv-fg-muted)]">
          No history yet.
        </div>
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
              onClick={() => {
                setDraft(state.data.markdown);
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
                disabled={saving || draft === state.data.markdown}
                onClick={() => { void handleSave(); }}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      {/* Body — textarea in edit mode, entries list otherwise */}
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
        <ul className="flex flex-col gap-2">
          {state.data.entries.map((line, i) => {
            const { date, gist, slugs } = parseHistoryLine(line);
            return (
              <li
                key={i}
                className="flex items-start gap-2 flex-wrap py-1 border-b border-white/[0.04]"
              >
                {date && (
                  <span className="text-xs text-[var(--color-pv-fg-dim)] font-mono shrink-0">
                    {date}
                  </span>
                )}
                <span className="text-sm text-[#e8e4d8]/90 flex-1">{gist}</span>
                {slugs.map((slug) => (
                  <span
                    key={slug}
                    className="px-2 py-0.5 rounded-full text-[10px] bg-white/[0.08] border border-white/10 text-[#a89a80]"
                  >
                    {slug}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
