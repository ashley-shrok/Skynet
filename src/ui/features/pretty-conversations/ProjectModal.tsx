// ProjectModal — per-project modal, opened from the project section header's
// "Open project" kebab item (wired in PrettyConversationsPanel
// handleOpenProject).
//
// Same shell as RoleModal / IdentityModal: canonical <Modal>, head with the
// project's display name, <ModalTabs> across the top, <ModalFoot> at the
// bottom. Projects carry no cosmetics, so the shell stays canonical (no hue).
//
// Tabs:
//   - Project file — always-edit editor over project.md (ProjectFileTab).
//     Save lives in the foot and is shown only while this tab is active; a
//     save keeps the modal open. The tab is force-mounted so a draft survives
//     switching to Files and back; closing the modal with a dirty draft asks
//     before discarding it.
//   - Files — the shared WorkspaceTab explorer over ~/fleet/projects/<slug>/.
//     project.md is hidden at the root because it has its own tab; the
//     backend also refuses Files-tab writes to it (reserved_file).
//
// Load path: GET /projects/:slug/file via getProjectFile.
// Save path: PUT /projects/:slug/file via updateProjectFile — the server-echoed
// body becomes the new local source of truth, so the draft reads clean again.

import { useCallback, useEffect, useState } from "react";
import { FileText, Folder } from "lucide-react";
import { Modal, ModalHead, ModalFoot, ModalTabs } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import { KitBanner, KitButton, kitConfirm } from "@/components/kit";
import { getProjectFile, updateProjectFile } from "@/api/project-list-api";
import type { TabState } from "@/features/pretty-view/IdentityFileTab";
import WorkspaceTab from "@/features/pretty-view/WorkspaceTab";
import { FileSpeakButton } from "@/features/pretty-view/file-viewers/FileSpeakButton";
import { ProjectFileTab } from "./ProjectFileTab";

const NAV_SECTIONS = [
  { value: "project", label: "Project file", Icon: FileText },
  { value: "files", label: "Files", Icon: Folder },
] as const;

/** Canonical modal hue — the Files tab tints against it. */
const CANONICAL_HUE = 220;

/** project.md is edited on the Project file tab, so Files hides it at the root. */
const FILES_TAB_HIDDEN_NAMES: readonly string[] = ["project.md"];

export interface ProjectModalProps {
  /** Controlled — true = modal open. */
  open: boolean;
  /** Fires with `false` when X, Esc, or the foot Close dismiss. */
  onOpenChange: (open: boolean) => void;
  /** Project slug (kebab-case). Addresses the project endpoints + folder. */
  slug: string;
  /** Display name shown in the header; from the project section header. */
  displayName: string;
  /** SSH host id of the host the project lives on. */
  hostId: number;
}

export function ProjectModal({
  open,
  onOpenChange,
  slug,
  displayName,
  hostId,
}: ProjectModalProps) {
  const [activeTab, setActiveTab] = useState<string>("project");
  const [fileState, setFileState] = useState<TabState<string>>({
    status: "loading",
  });
  const [draft, setDraft] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch project.md on open. Reset state on close so a re-open shows the
  // loading skeleton on the Project file tab rather than stale content.
  useEffect(() => {
    if (!open) {
      setActiveTab("project");
      setFileState({ status: "loading" });
      setDraft("");
      setIsDirty(false);
      setSaving(false);
      setSaveError(null);
      return;
    }

    setFileState({ status: "loading" });
    let cancelled = false;

    void (async () => {
      try {
        const { markdown } = await getProjectFile(hostId, slug);
        if (!cancelled) {
          setFileState({ status: "ready", data: markdown });
        }
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
  }, [open, slug, hostId]);

  // Draft-guard wrapper on onOpenChange. No closing mid-save (a failed save
  // would otherwise drop the draft with nowhere to show the error); a dirty
  // draft asks before it's discarded.
  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && saving) return;
      if (!nextOpen && isDirty) {
        const confirmed = await kitConfirm({
          title: "Discard unsaved changes?",
          body: "Your edits to the project file haven't been saved.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          destructive: true,
        });
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, saving, onOpenChange],
  );

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { markdown } = await updateProjectFile(hostId, slug, draft);
      // Server-echoed body becomes the source of truth; ProjectFileTab
      // reseeds its draft from it and reports clean.
      setFileState({ status: "ready", data: markdown });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      // eslint-disable-next-line no-console
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

  const onProjectTab = activeTab === "project";
  const canSave = fileState.status === "ready" && isDirty && !saving;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        void handleOpenChange(next);
      }}
      size="xl"
      data-testid="project-modal"
    >
      <ModalHead
        title={displayName}
        closeTestId="project-modal-close"
        actions={
          onProjectTab ? <FileSpeakButton filename="project.md" text={draft} /> : undefined
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col"
      >
        <ModalTabs
          tabs={NAV_SECTIONS}
          value={activeTab}
          onValueChange={setActiveTab}
          rowTestId="project-modal-nav"
          testIdPrefix="project-modal-nav"
        />

        {/* Force-mounted (hidden while inactive) so an unsaved draft
            survives a trip to the Files tab. */}
        <TabsContent
          value="project"
          forceMount
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col data-[state=inactive]:hidden"
        >
          <ProjectFileTab
            state={fileState}
            onDraftChange={setIsDirty}
            onDraftContentChange={setDraft}
            disabled={saving}
          />
          {saveError !== null && (
            <KitBanner tone="danger" className="mt-3" data-testid="project-modal-save-error">
              Save failed: {saveError}
            </KitBanner>
          )}
        </TabsContent>

        <TabsContent
          value="files"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <WorkspaceTab
            target={{ kind: "project", projectSlug: slug }}
            hostId={hostId}
            hue={CANONICAL_HUE}
            hiddenNames={FILES_TAB_HIDDEN_NAMES}
            introCopy="Files inside this project's folder — reference material and anything else shared with the conversations in this project."
          />
        </TabsContent>
      </Tabs>

      <ModalFoot>
        <KitButton
          onClick={() => {
            void handleOpenChange(false);
          }}
          disabled={saving}
          data-testid="project-modal-close-foot"
        >
          Close
        </KitButton>
        {onProjectTab && (
          <KitButton
            variant="primary"
            onClick={() => {
              void handleSave();
            }}
            disabled={!canSave}
            busy={saving}
            data-testid="project-modal-save"
          >
            {saving ? "Saving…" : "Save"}
          </KitButton>
        )}
      </ModalFoot>
    </Modal>
  );
}
