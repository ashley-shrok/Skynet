// The roles window's runbook view — one level below the role. Same editor
// as the skills modal: the file open in full, an "N files" toggle that
// brings the file list down the side (on a phone it swaps to the list),
// "Add file" at the bottom of the list, a delete button per file, Close and
// Save at the foot. A runbook with no files offers its own "Add file".
//
// Per-file drafts are mirrored here so the foot's Save writes the open file
// and leaving with unsaved edits asks first.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, FileText, PanelLeft, Plus } from "lucide-react";
import { ModalBody, ModalFoot, ModalHead, ModalSidebar, useModalFullscreen } from "@/components/modal";
import { KitBanner, KitButton, KitEmpty, KitLoading, kitAlert, kitConfirm, kitPrompt } from "@/components/kit";
import { RowKebabMenu, type RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import type { RoleSummary } from "@/api/identities-api";
import {
  enumerateRunbookFiles,
  readRunbookFile,
  writeRunbookFile,
  writeRunbookFileBinary,
  createRunbookFile,
  deleteRunbookFile,
  deleteRunbook,
  renameRunbook,
  RunbookAlreadyExistsError,
  RenamedButEditsNotSavedError,
  RunbookFileMtimeConflictError,
  RunbookFileAlreadyExistsError,
  type RunbookFileEntry,
  runbookFileUrl,
} from "@/api/runbooks-api";
import { roleDisplayName } from "@/lib/role-display-name";
import SkillFileTab, { type SkillFileTabData } from "../SkillFileTab";
import { fileViewNeverNeedsContent, type BinaryDraft } from "../file-viewers/registry";
import type { TabState } from "../IdentityFileTab";
import { frontmatterName } from "../skill-frontmatter";
import { slugifyRoleName } from "@/lib/slugify-role-name";
import type { EscapeHandler, LeaveGuard } from "./RolesWindow";

export function RunbookView({
  hostId,
  role,
  runbook,
  readOnly,
  onBack,
  onClose,
  onDeleted,
  onRenamed,
  registerGuard,
  registerEscape,
}: {
  hostId: number;
  role: RoleSummary;
  runbook: string;
  readOnly: boolean;
  onBack: () => void;
  onClose: () => void;
  onDeleted: () => void;
  /** After a rename lands — the window re-opens the runbook under its new name. */
  onRenamed: (newName: string) => void;
  registerGuard: (g: LeaveGuard | null) => void;
  registerEscape: (h: EscapeHandler | null) => void;
}): JSX.Element {
  const roleName = role.name;
  const fullscreen = useModalFullscreen();
  const [files, setFiles] = useState<TabState<RunbookFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const [binaryDrafts, setBinaryDrafts] = useState<Map<string, BinaryDraft>>(new Map());
  const [saving, setSaving] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    console.debug("[RunbookView] open", { hostId, roleName, runbook });
    enumerateRunbookFiles(hostId, roleName, runbook)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        const first = entries.find((e) => e.path === "runbook.md") ?? entries[0];
        if (first) setActiveTab(first.path);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFiles({ status: "error", error: err instanceof Error ? err.message : "Failed to load files" });
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, roleName, runbook]);

  // Lazy-load the open file (one at a time).
  useEffect(() => {
    if (!activeTab || tabData.has(activeTab)) return;
    let cancelled = false;
    if (fileViewNeverNeedsContent(activeTab)) {
      setTabData((prev) => new Map(prev).set(activeTab, { status: "ready", data: { content: "", mtime: 0, isText: false } }));
      return;
    }
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readRunbookFile(hostId, roleName, runbook, activeTab)
      .then((r) => {
        if (!cancelled)
          setTabData((prev) =>
            new Map(prev).set(activeTab, { status: "ready", data: { content: r.content, mtime: r.mtime, isText: r.isText } }),
          );
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setTabData((prev) =>
            new Map(prev).set(activeTab, { status: "error", error: err instanceof Error ? err.message : "Failed to load" }),
          );
      });
    return () => {
      cancelled = true;
      // Left before the read answered: forget the half-loaded entry so coming
      // back reads the file again instead of loading forever.
      setTabData((prev) => {
        if (prev.get(activeTab)?.status !== "loading") return prev;
        const next = new Map(prev);
        next.delete(activeTab);
        return next;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, roleName, runbook, activeTab]);

  const handleDraftContentChange = useCallback(
    (path: string) => (draft: string) =>
      setDrafts((prev) => (prev.get(path) === draft ? prev : new Map(prev).set(path, draft))),
    [],
  );
  const handleDraftDirtyChange = useCallback(
    (path: string) => (dirty: boolean) =>
      setDirtySet((prev) => {
        if (prev.has(path) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(path);
        else next.delete(path);
        return next;
      }),
    [],
  );
  const handleBinaryDraftChange = useCallback(
    (path: string) => (draft: BinaryDraft | null) =>
      setBinaryDrafts((prev) => {
        if ((prev.get(path) ?? null) === draft) return prev;
        const next = new Map(prev);
        if (draft) next.set(path, draft);
        else next.delete(path);
        return next;
      }),
    [],
  );

  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      const keepIsText = (prev: Map<string, TabState<SkillFileTabData>>) => {
        const e = prev.get(path);
        return e?.status === "ready" ? e.data.isText : true;
      };
      try {
        const result = await writeRunbookFile({ hostId, role: roleName, runbook, path, content, expectedMtime });
        setTabData((prev) =>
          new Map(prev).set(path, { status: "ready", data: { content, mtime: result.mtime, isText: keepIsText(prev) } }),
        );
        console.debug("[RunbookView] save-ok", { path, mtime: result.mtime });
      } catch (err) {
        if (err instanceof RunbookFileMtimeConflictError) {
          const reload = await kitConfirm({
            title: "This file changed on disk",
            body: "It changed since you started editing. Reload it from disk? Your local edits will be lost.",
            confirmLabel: "Reload",
            destructive: true,
          });
          if (reload) {
            setTabData((prev) =>
              new Map(prev).set(path, {
                status: "ready",
                data: { content: err.currentContent, mtime: err.currentMtime, isText: keepIsText(prev) },
              }),
            );
            return;
          }
        }
        throw err;
      }
    },
    [hostId, roleName, runbook],
  );

  // Rename = move the runbook folder (the backend also renames a
  // `<runbook>.md` main file and rewrites a frontmatter `name:`). With
  // `draft`, that main-file draft rides along in the same request — checked
  // against the mtime it was loaded at before anything moves.
  const performRename = useCallback(
    async (newName: string, draft: { path: string; content: string; expectedMtime: number } | null): Promise<void> => {
      console.debug("[RunbookView] rename", { hostId, roleName, from: runbook, to: newName, withDraft: draft != null });
      let renamed = false;
      try {
        await renameRunbook(hostId, roleName, runbook, newName, draft ?? undefined);
        renamed = true;
      } catch (err) {
        renamed = err instanceof RenamedButEditsNotSavedError;
        console.debug("[RunbookView] rename-error", { hostId, roleName, from: runbook, to: newName, renamed });
        void kitAlert({
          title: renamed ? `Renamed to "${newName}"` : "Couldn't rename the runbook",
          body:
            err instanceof RunbookAlreadyExistsError
              ? `A runbook named "${newName}" already exists in this role.`
              : err instanceof RunbookFileMtimeConflictError
                ? `${draft?.path ?? "The file"} changed on disk since you opened it, so nothing was renamed. Copy your edits somewhere, reopen the runbook, and try again.`
                : renamed
                  ? "But your edits couldn't be saved."
                  : err instanceof Error
                    ? err.message
                    : undefined,
        });
      }
      if (renamed) onRenamed(newName);
    },
    [hostId, roleName, runbook, onRenamed],
  );

  const handleRenameRunbook = async (): Promise<void> => {
    if (dirtySet.size > 0 || binaryDrafts.size > 0) {
      void kitAlert({ title: "Save or discard your edits first", body: "Renaming the runbook reloads its files." });
      return;
    }
    const raw = await kitPrompt({
      title: `Rename "${runbook}"`,
      body: "Its folder, a main file named after it and the name in that file change together.",
      label: "New name",
      defaultValue: runbook,
      confirmLabel: "Rename",
      mono: true,
      validate: (v) =>
        slugifyRoleName(v.trim()).length === 0 ? "Pick a name with at least one letter or number." : null,
    });
    if (raw == null) return;
    const slug = slugifyRoleName(raw.trim());
    if (slug === runbook) return;
    await performRename(slug, null);
  };

  // A main-file save whose `name:` was changed away from the folder is never
  // saved as is — the backend refuses it; offer the rename instead. A name
  // that already disagreed on disk and wasn't touched saves normally.
  // Returns true when it handled the save (renamed, or refused with a note).
  const handleMainFileNameChange = useCallback(
    async (path: string, content: string, loaded: SkillFileTabData): Promise<boolean> => {
      if (path !== "runbook.md" && path !== `${runbook}.md`) return false;
      const name = frontmatterName(content);
      if (name === null || name === runbook) return false;
      if (name === frontmatterName(loaded.content)) return false;
      const slug = slugifyRoleName(name);
      if (slug !== name) {
        void kitAlert({
          title: `"${name}" can't be a runbook name`,
          body: `Use lowercase letters, numbers and hyphens${slug ? ` (e.g. "${slug}")` : ""}.`,
        });
        return true;
      }
      if ([...dirtySet].some((p) => p !== path) || binaryDrafts.size > 0) {
        void kitAlert({ title: "Save or discard your other files' edits first", body: "Renaming the runbook reloads them." });
        return true;
      }
      if (
        !(await kitConfirm({
          title: `Rename the runbook to "${name}"?`,
          body: `${path} now names it "${name}", but its folder is "${runbook}" — the two always match. Cancel keeps your edits unsaved.`,
          confirmLabel: "Rename",
        }))
      )
        return true;
      await performRename(name, { path, content, expectedMtime: loaded.mtime });
      return true;
    },
    [runbook, dirtySet, binaryDrafts, performRename],
  );

  const handleFootSave = useCallback(async (): Promise<void> => {
    if (saving || !activeTab) return;
    const tab = tabData.get(activeTab);
    if (tab?.status !== "ready") return;
    setSaving(true);
    try {
      const binary = binaryDrafts.get(activeTab);
      if (binary) {
        const bytes = await binary.getBytes();
        await writeRunbookFileBinary(hostId, roleName, runbook, activeTab, bytes);
        binary.markSaved(bytes);
        return;
      }
      const draft = drafts.get(activeTab) ?? tab.data.content;
      if (draft === tab.data.content) return;
      if (await handleMainFileNameChange(activeTab, draft, tab.data)) return;
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      void kitAlert({ title: "Save failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }, [saving, activeTab, tabData, drafts, binaryDrafts, handleSave, handleMainFileNameChange, hostId, roleName, runbook]);

  const refreshFiles = async (): Promise<RunbookFileEntry[]> => {
    const entries = await enumerateRunbookFiles(hostId, roleName, runbook);
    setFiles({ status: "ready", data: entries });
    return entries;
  };

  const handleAddFile = async (): Promise<void> => {
    const raw = await kitPrompt({
      title: "New file",
      label: "File name",
      body: "Relative to the runbook's folder, e.g. scripts/run.sh",
      placeholder: "notes.md",
      confirmLabel: "Create",
      mono: true,
    });
    const relPath = raw?.trim();
    if (!relPath) return;
    try {
      await createRunbookFile(hostId, roleName, runbook, relPath);
      console.debug("[RunbookView] add-file", { path: relPath });
      await refreshFiles();
      setActiveTab(relPath);
      if (fullscreen) setFilesOpen(false);
    } catch (err) {
      void kitAlert({
        title: "Couldn't create the file",
        body:
          err instanceof RunbookFileAlreadyExistsError
            ? `A file named "${relPath}" already exists in this runbook.`
            : err instanceof Error
              ? err.message
              : undefined,
      });
    }
  };

  const handleDeleteFile = async (path: string): Promise<void> => {
    if (
      !(await kitConfirm({
        title: `Delete "${path}"?`,
        body: `This removes ${runbook}/${path}. This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteRunbookFile(hostId, roleName, runbook, path);
      console.debug("[RunbookView] delete-file", { path });
      const entries = await refreshFiles();
      if (activeTab === path) setActiveTab(entries[0]?.path ?? null);
      const drop = <T,>(m: Map<string, T>) => {
        const n = new Map(m);
        n.delete(path);
        return n;
      };
      setTabData(drop);
      setDrafts(drop);
      setBinaryDrafts(drop);
      setDirtySet((prev) => {
        if (!prev.has(path)) return prev;
        const n = new Set(prev);
        n.delete(path);
        return n;
      });
    } catch (err) {
      void kitAlert({ title: "Couldn't delete the file", body: err instanceof Error ? err.message : undefined });
    }
  };

  const handleDeleteRunbook = async (): Promise<void> => {
    if (
      !(await kitConfirm({
        title: `Delete the ${roleDisplayName(runbook)} runbook?`,
        body: "This removes the runbook and every file inside it. This can't be undone.",
        confirmLabel: "Delete runbook",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteRunbook(hostId, roleName, runbook);
      console.info({ operation: "runbook_deleted", hostId, roleName, runbook });
      onDeleted();
    } catch (err) {
      void kitAlert({ title: "Couldn't delete the runbook", body: err instanceof Error ? err.message : undefined });
    }
  };

  const switchFile = async (path: string): Promise<void> => {
    if (
      activeTab != null &&
      path !== activeTab &&
      binaryDrafts.has(activeTab) &&
      !(await kitConfirm({
        title: "Discard unsaved changes to this PDF?",
        body: "Your annotations haven't been saved.",
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return;
    setActiveTab(path);
    if (fullscreen) setFilesOpen(false);
  };

  // Leaving with unsaved edits asks first; Esc first closes the phone's file list.
  const unsaved = useRef(false);
  unsaved.current = dirtySet.size > 0 || binaryDrafts.size > 0;
  const filesOpenRef = useRef(filesOpen);
  filesOpenRef.current = filesOpen;
  useEffect(() => {
    registerGuard(async () =>
      unsaved.current
        ? kitConfirm({
            title: "Discard your changes?",
            body: "Your edits to this runbook haven't been saved.",
            confirmLabel: "Discard",
            destructive: true,
          })
        : true,
    );
    registerEscape(() => {
      if (filesOpenRef.current) {
        setFilesOpen(false);
        return true;
      }
      return false;
    });
    return () => {
      registerGuard(null);
      registerEscape(null);
    };
  }, [registerGuard, registerEscape]);

  const fileCount = files.status === "ready" ? files.data.length : 0;
  const activeState = activeTab != null ? tabData.get(activeTab) : undefined;
  const canSave =
    !readOnly &&
    !saving &&
    activeTab != null &&
    activeState?.status === "ready" &&
    (dirtySet.has(activeTab) || binaryDrafts.has(activeTab));

  const filesToggle = (
    <KitButton
      size="sm"
      onClick={() => setFilesOpen((o) => !o)}
      aria-pressed={filesOpen}
      aria-expanded={filesOpen}
      title={filesOpen ? "Hide the file list" : "Show every file in this runbook"}
      data-variant={filesOpen ? "plain" : undefined}
      data-testid="runbook-view-files-toggle"
    >
      <PanelLeft /> {fileCount === 1 ? "Files" : `${fileCount} files`}
    </KitButton>
  );

  const menuItems: RowKebabMenuItem[] = readOnly
    ? [{ label: "Only an admin can change a shared role's runbooks", disabled: true }]
    : [
        { label: "Add file…", onClick: () => void handleAddFile(), testId: "runbook-view-add-file-menu" },
        {
          label: "Rename…",
          hint: dirtySet.size > 0 ? "Save or discard your edits first" : undefined,
          disabled: dirtySet.size > 0,
          onClick: () => void handleRenameRunbook(),
          testId: "runbook-view-rename",
        },
        {
          label: "Delete runbook…",
          danger: true,
          separatorBefore: true,
          onClick: () => void handleDeleteRunbook(),
          testId: "runbook-view-delete",
        },
      ];

  const addFileButton = (variant: "plain" | "primary", full?: boolean): JSX.Element => (
    <KitButton variant={variant} size="sm" full={full} onClick={() => void handleAddFile()} data-testid="runbook-view-add-file">
      <Plus /> Add file
    </KitButton>
  );

  return (
    <>
      <ModalHead
        title={roleDisplayName(runbook)}
        subtitle="Runbook"
        closeTestId="roles-window-close"
        leading={
          <KitButton variant="plain" size="sm" onClick={onBack} className="max-w-[40vw]" data-testid="roles-window-back">
            <ChevronLeft /> <span className="truncate">{roleDisplayName(roleName, role.displayName)}</span>
          </KitButton>
        }
        actions={<RowKebabMenu items={menuItems} ariaLabel="Runbook options" testId="runbook-view-menu" />}
      />
      {files.status === "loading" ? (
        <ModalBody>
          <KitLoading label="Loading files…" />
        </ModalBody>
      ) : files.status === "error" ? (
        <ModalBody>
          <KitBanner tone="danger">Couldn&apos;t load files: {files.error}</KitBanner>
        </ModalBody>
      ) : files.data.length === 0 ? (
        <ModalBody className="flex items-center justify-center">
          <KitEmpty
            icon={<FileText />}
            title="No files yet"
            body={readOnly ? undefined : "Add the runbook's first file — a runbook.md with the steps is a good start."}
            action={readOnly ? undefined : addFileButton("primary")}
          />
        </ModalBody>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--k-hair)] pt-2">
          <ModalSidebar
            tabs={files.data.map((f) => ({ value: f.path, label: f.path, Icon: FileText }))}
            value={activeTab ?? ""}
            onValueChange={(v) => void switchFile(v)}
            drill={{ fullscreen, drilled: !filesOpen, drillIn: () => setFilesOpen(false), back: () => setFilesOpen(false) }}
            listHidden={!filesOpen}
            hideDrillBack
            width={232}
            rowTestId="runbook-view-file-list"
            testIdPrefix="runbook-view-file"
            header={fullscreen ? <div className="flex items-center gap-2 pb-2">{filesToggle}</div> : undefined}
            trailing={readOnly ? undefined : addFileButton("plain", true)}
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-4 py-3" data-testid="runbook-view-body">
              {activeTab != null && (
                <SkillFileTab
                  key={activeTab}
                  state={tabData.get(activeTab) ?? { status: "loading" }}
                  onSave={async (content, expectedMtime) => {
                    const loaded = tabData.get(activeTab);
                    if (loaded?.status === "ready" && (await handleMainFileNameChange(activeTab, content, loaded.data)))
                      return;
                    await handleSave(activeTab, content, expectedMtime);
                  }}
                  onRequestDelete={readOnly ? undefined : () => void handleDeleteFile(activeTab)}
                  filename={activeTab}
                  readOnly={readOnly}
                  hideSaveButton
                  onDraftContentChange={handleDraftContentChange(activeTab)}
                  onDraftChange={handleDraftDirtyChange(activeTab)}
                  onBinaryDraftChange={handleBinaryDraftChange(activeTab)}
                  leading={
                    <>
                      {filesToggle}
                      <span className="truncate text-[13px] font-semibold text-[var(--k-t1)]" data-testid="runbook-view-current-file">
                        {activeTab}
                      </span>
                    </>
                  }
                  mediaUrl={runbookFileUrl(hostId, roleName, runbook, activeTab, { inline: true })}
                  downloadUrl={runbookFileUrl(hostId, roleName, runbook, activeTab)}
                />
              )}
            </div>
          </ModalSidebar>
        </div>
      )}
      <ModalFoot>
        <KitButton onClick={onClose} disabled={saving} data-testid="runbook-view-close">
          Close
        </KitButton>
        {readOnly ? null : (
          <KitButton
            variant="primary"
            onClick={() => void handleFootSave()}
            disabled={!canSave}
            busy={saving}
            data-testid="runbook-view-save"
          >
            {saving ? "Saving…" : "Save"}
          </KitButton>
        )}
      </ModalFoot>
    </>
  );
}
