// ProjectFileTab — always-edit ready branch for the project.md editor.
//
// Modal-unification 2026-09-29 refactor: the pre-unification tab had a
// view/edit toggle (read-mode ReactMarkdown preview → click Edit →
// edit-mode MarkdownEditor → Save/Cancel). Per Ashley: opening the modal
// means you're editing, so the view/read toggle is gone. The tab now
// always renders <MarkdownEditor> in the ready branch and hands draft
// state to the parent via `onDraftContentChange` / `onDraftChange`. The
// outer <ModalFoot> in ProjectFileModal owns Save + Close.
//
// Byte-shape mirror of RoleFileTab.tsx conventions preserved: same
// TabState<string> discriminated union, same MarkdownEditor gate on
// filename=project.md (D-06 pretty MDXEditor branch).

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "@/features/pretty-view/IdentityFileTab";
import { MarkdownEditor } from "@/features/pretty-view/MarkdownEditor";

export interface ProjectFileTabProps {
  state: TabState<string>;
  /** Fires whenever draft diverges from OR converges back to the fetched
   *  content. Drives the parent modal's dirty-flag for the close-confirm
   *  draft-guard. */
  onDraftChange?: (dirty: boolean) => void;
  /** Fires with the raw draft string on every keystroke. Consumed by the
   *  parent modal's foot Save button (which owns the write endpoint). */
  onDraftContentChange?: (draft: string) => void;
  /** When true, the editor renders in read-only mode. Wired by the parent
   *  during an in-flight save. */
  disabled?: boolean;
}

export function ProjectFileTab({
  state,
  onDraftChange,
  onDraftContentChange,
  disabled = false,
}: ProjectFileTabProps): JSX.Element {
  const [draft, setDraft] = useState<string>("");

  // Seed the draft from state.data whenever fetched content changes (initial
  // load OR successful save that echoes the written body). Reset key is the
  // string content itself; identity change triggers a reseed.
  useEffect(() => {
    if (state.status === "ready") {
      setDraft(state.data);
    }
  }, [state]);

  // Fire onDraftChange whenever draft diverges from or converges back to the
  // fetched content. Guarded on `ready` — no "dirty" concept before load.
  useEffect(() => {
    if (!onDraftChange) return;
    if (state.status !== "ready") return;
    onDraftChange(draft !== state.data);
  }, [draft, state, onDraftChange]);

  // Fire the raw draft string to the outer chrome (which owns Save).
  useEffect(() => {
    if (!onDraftContentChange) return;
    if (state.status !== "ready") return;
    onDraftContentChange(draft);
  }, [draft, state, onDraftContentChange]);

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

  return (
    <div className="flex flex-col h-full">
      <MarkdownEditor
        filename="project.md"
        content={draft}
        onChange={setDraft}
        disabled={disabled}
        placeholder="This project has no project.md yet — start typing to begin."
      />
    </div>
  );
}
