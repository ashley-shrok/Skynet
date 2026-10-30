// ProjectModal — the project window, opened from the project section header's
// "Edit project" kebab item (wired in PrettyConversationsPanel
// handleOpenProject).
//
// A sibling of the agent window: what the project IS sits on top (folder
// tile, parent lineage for a sub-project, name, a count of what sits directly
// in it), what it holds sits in tabs underneath. Close X only.
//
// Tabs:
//   - Project file — formatted reading of project.md (frontmatter stripped),
//     Edit at the foot opens the editor with Cancel / Save. A file with
//     nothing written below its frontmatter shows an empty state whose
//     "Write it" opens the editor. Leaving the editor with unsaved edits by
//     any route (Cancel, Esc, X, switching tabs) asks first.
//   - Files — the shared WorkspaceTab explorer over ~/fleet/projects/<slug>/.
//     project.md is hidden at the root because it has its own tab; the
//     backend also refuses Files-tab writes to it (reserved_file).
//
// Load path: GET /projects/:slug/file via getProjectFile.
// Save path: PUT /projects/:slug/file via updateProjectFile — the server-echoed
// body becomes the new local source of truth.

import { SharedWithButton } from "@/features/sharing/SharedWithButton";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Folder, Pencil } from "lucide-react";
import { Modal, ModalHead, ModalFoot, ModalTabs, escBelongsElsewhere } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import { KitBanner, KitButton, KitEmpty, KitLoading, kitConfirm } from "@/components/kit";
import { getProjectFile, updateProjectFile } from "@/api/project-list-api";
import { useProjects } from "@/state/conversation-store";
import { projectLineage } from "@/state/project-lineage";
import { stripFrontmatter } from "@/lib/strip-frontmatter";
import type { TabState } from "@/features/pretty-view/IdentityFileTab";
import { MarkdownEditor } from "@/features/pretty-view/MarkdownEditor";
import WorkspaceTab from "@/features/pretty-view/WorkspaceTab";
import { FileSpeakButton } from "@/features/pretty-view/file-viewers/FileSpeakButton";

const NAV_SECTIONS = [
  { value: "project", label: "Project file", Icon: FileText },
  { value: "files", label: "Files", Icon: Folder },
] as const;

/** Canonical modal hue — the Files tab tints against it. */
const CANONICAL_HUE = 220;

/** project.md is edited on the Project file tab, so Files hides it at the root. */
const FILES_TAB_HIDDEN_NAMES: readonly string[] = ["project.md"];

const PROSE = [
  "prose prose-sm max-w-none dark:prose-invert",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
  "prose-code:bg-white/[0.08] prose-code:border prose-code:border-white/[0.06]",
].join(" ");

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface ProjectContents {
  /** Conversations the sidebar shows directly in the project (this user's view). */
  conversations: number;
  /** Sub-projects directly beneath it that the sidebar shows. */
  subProjects: number;
}

export interface ProjectModalProps {
  /** Controlled — true = modal open. */
  open: boolean;
  /** Fires with `false` when X or Esc dismiss. */
  onOpenChange: (open: boolean) => void;
  /** Project slug (kebab-case). Addresses the project endpoints + folder. */
  slug: string;
  /** Display name shown on top; from the project section header. */
  displayName: string;
  /** SSH host id of the host the project lives on. */
  hostId: number;
  /** What sits directly in the project, as the sidebar shows it. */
  contents?: ProjectContents;
}

export function ProjectModal({
  open,
  onOpenChange,
  slug,
  displayName,
  hostId,
  contents,
}: ProjectModalProps) {
  const [activeTab, setActiveTab] = useState<string>("project");
  const [fileState, setFileState] = useState<TabState<string>>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Parents only — the project's own name is the title.
  const projects = useProjects();
  const lineage = projectLineage(projects, hostId, slug).slice(0, -1);

  // Fetch project.md on open; reset on close so a re-open starts on reading.
  useEffect(() => {
    if (!open) {
      setActiveTab("project");
      setFileState({ status: "loading" });
      setEditing(false);
      setDraft("");
      setSaving(false);
      setSaveError(null);
      return;
    }

    setFileState({ status: "loading" });
    let cancelled = false;

    void (async () => {
      try {
        const { markdown } = await getProjectFile(hostId, slug);
        if (!cancelled) setFileState({ status: "ready", data: markdown });
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
  }, [open, slug, hostId, loadAttempt]);

  // ── Editing ──────────────────────────────────────────────────────────────
  // The rich editor can re-serialise the file once more after it loads.
  // Until the user types, clicks or pastes in it, a change is the editor
  // settling, not an edit: it becomes the baseline instead of marking dirty.
  const [baseline, setBaseline] = useState("");
  const interacted = useRef(false);
  const onEditorChange = useCallback((md: string) => {
    if (!interacted.current) setBaseline(md);
    setDraft(md);
  }, []);
  const fileReady = fileState.status === "ready";
  const fileDirty = editing && fileReady && draft !== baseline;
  const fileDirtyRef = useRef(fileDirty);
  fileDirtyRef.current = fileDirty;

  const startEditing = useCallback(() => {
    const data = fileState.status === "ready" ? fileState.data : "";
    setDraft(data);
    setBaseline(data);
    interacted.current = false;
    setSaveError(null);
    setEditing(true);
  }, [fileState]);

  /** Stop editing, asking first when there are unsaved edits. */
  const leaveEditing = useCallback(async (): Promise<boolean> => {
    if (fileDirtyRef.current) {
      const confirmed = await kitConfirm({
        title: "Discard your changes?",
        body: "Your edits to the project file haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!confirmed) return false;
    }
    fileDirtyRef.current = false;
    setEditing(false);
    setSaveError(null);
    return true;
  }, []);

  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (nextOpen) return onOpenChange(true);
      // No closing mid-save: a failed save would drop the draft with nowhere
      // to show the error.
      if (saving) return;
      if (!(await leaveEditing())) return;
      onOpenChange(false);
    },
    [saving, leaveEditing, onOpenChange],
  );

  const changeTab = useCallback(
    async (next: string) => {
      if (next === activeTab) return;
      if (activeTab === "project" && !(await leaveEditing())) return;
      setActiveTab(next);
    },
    [activeTab, leaveEditing],
  );

  // Esc while editing leaves the editor (asking first); while reading it
  // falls through to the modal, which closes.
  const escState = useRef({ editing, saving });
  escState.current = { editing, saving };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!escState.current.editing) return;
      if (escBelongsElsewhere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!escState.current.saving) void leaveEditing();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, leaveEditing]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { markdown } = await updateProjectFile(hostId, slug, draft);
      setFileState({ status: "ready", data: markdown });
      fileDirtyRef.current = false;
      setEditing(false);
      console.info({ operation: "project_file_saved", slug, hostId });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      console.warn({
        operation: "project_modal_save_failed",
        slug,
        hostId,
        reason: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [saving, hostId, slug, draft]);

  // ── Top ──────────────────────────────────────────────────────────────────
  // The last known count stays up if the sidebar briefly loses the project
  // (a refetch, or it's archived elsewhere) rather than the line blinking out.
  const lastContents = useRef(contents);
  if (contents) lastContents.current = contents;
  const shownContents = contents ?? lastContents.current;
  const countBits: string[] = [];
  if (shownContents) {
    countBits.push(plural(shownContents.conversations, "conversation"));
    if (shownContents.subProjects > 0) countBits.push(plural(shownContents.subProjects, "sub-project"));
  }

  const hero = (
    <div
      className="px-6 max-sm:px-5 pb-4 flex gap-[18px] max-sm:gap-3.5 items-center flex-shrink-0"
      data-testid="project-modal-hero"
    >
      <div
        className="shrink-0 size-16 max-sm:size-[52px] rounded-[18px] max-sm:rounded-[15px] bg-[var(--k-s2)] text-[var(--k-t2)] grid place-items-center"
        aria-hidden="true"
      >
        <Folder className="size-[30px] max-sm:size-6" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {lineage.length > 0 && (
          <div className="text-[12.5px] text-[var(--k-t3)] truncate" data-testid="project-modal-lineage">
            In {lineage.join(" › ")}
          </div>
        )}
        <div className="text-[24px] max-sm:text-[21px] font-bold tracking-[-0.025em] truncate" aria-hidden="true">
          {displayName}
        </div>
        {countBits.length > 0 && (
          <div className="text-[13.5px] text-[var(--k-t2)]" data-testid="project-modal-count">
            {countBits.join(" · ")}
          </div>
        )}
        <SharedWithButton
          hostId={hostId}
          kind="project"
          slug={slug}
          itemLabel={displayName}
          hint="Also shares its sub-projects and the agents in them."
          onGone={() => onOpenChange(false)}
          className="mt-1 self-start"
        />
      </div>
    </div>
  );

  // ── Project file ─────────────────────────────────────────────────────────
  const body = fileState.status === "ready" ? stripFrontmatter(fileState.data) : "";
  const written = body.trim().length > 0;

  const filePane =
    fileState.status === "loading" ? (
      <KitLoading lines={5} />
    ) : fileState.status === "error" ? (
      <KitBanner
        tone="danger"
        action={
          <KitButton size="sm" onClick={() => setLoadAttempt((n) => n + 1)} data-testid="project-modal-retry">
            Try again
          </KitButton>
        }
      >
        Couldn&apos;t load project file: {fileState.error}
      </KitBanner>
    ) : editing ? (
      <div className="flex flex-col h-full min-h-0">
        <div
          className="flex flex-col flex-1 min-h-0"
          onKeyDownCapture={() => (interacted.current = true)}
          onPointerDownCapture={() => (interacted.current = true)}
          onPasteCapture={() => (interacted.current = true)}
          onDropCapture={() => (interacted.current = true)}
          onBeforeInputCapture={() => (interacted.current = true)}
        >
          <MarkdownEditor filename="project.md" content={draft} onChange={onEditorChange} disabled={saving} />
        </div>
        {saveError !== null && (
          <KitBanner tone="danger" className="mt-2" data-testid="project-modal-save-error">
            Save failed: {saveError}
          </KitBanner>
        )}
      </div>
    ) : !written ? (
      <KitEmpty
        className="py-12"
        icon={<FileText aria-hidden="true" />}
        title="Nothing written yet"
        body="The project file says what this project is for and any conventions its agents share. Every agent in the project reads it when it starts."
        action={
          <KitButton variant="primary" size="sm" onClick={startEditing} data-testid="project-modal-write">
            <Pencil /> Write it
          </KitButton>
        }
        data-testid="project-modal-empty"
      />
    ) : (
      <div className={PROSE} data-testid="project-modal-file">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
        >
          {body}
        </ReactMarkdown>
      </div>
    );

  const showFoot = activeTab === "project" && fileReady && (editing || written);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        void handleOpenChange(next);
      }}
      // Same size as the agent and role windows (their Files tabs match).
      size="editor"
      data-testid="project-modal"
    >
      <ModalHead
        title={<span className="sr-only">{displayName}</span>}
        closeTestId="project-modal-close"
        className="pb-0"
      />
      {hero}

      <Tabs
        value={activeTab}
        onValueChange={(v) => void changeTab(v)}
        className="flex-1 min-h-0 flex flex-col"
      >
        <ModalTabs
          tabs={NAV_SECTIONS}
          value={activeTab}
          onValueChange={(v) => void changeTab(v)}
          rowTestId="project-modal-nav"
          testIdPrefix="project-modal-nav"
        />

        <TabsContent
          value="project"
          className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 flex flex-col border-t border-[var(--k-hair)]"
        >
          {filePane}
        </TabsContent>

        <TabsContent
          value="files"
          className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-[var(--k-hair)]"
        >
          <WorkspaceTab
            target={{ kind: "project", projectSlug: slug }}
            hostId={hostId}
            hue={CANONICAL_HUE}
            hiddenNames={FILES_TAB_HIDDEN_NAMES}
            introCopy="Reference material and anything else shared with the conversations in this project."
            emptyCopy="Upload or create a file here and every agent in the project can read it."
          />
        </TabsContent>
      </Tabs>

      {showFoot && (
        <ModalFoot>
          {editing ? (
            <>
              <KitButton disabled={saving} onClick={() => void leaveEditing()} data-testid="project-modal-cancel-edit">
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!fileDirty || saving}
                busy={saving}
                data-testid="project-modal-save"
              >
                {saving ? "Saving…" : "Save"}
              </KitButton>
            </>
          ) : (
            <>
              <FileSpeakButton filename="project.md" text={body} className="mr-auto" />
              <KitButton onClick={startEditing} data-testid="project-modal-edit">
                <Pencil /> Edit
              </KitButton>
            </>
          )}
        </ModalFoot>
      )}
    </Modal>
  );
}
