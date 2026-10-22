// The roles window's role-skill view — one level below the role. Same editor
// as the skills modal: the file open in full, an "N files" toggle that
// brings the file list down the side (on a phone it swaps to the list),
// "Add file" at the bottom of the list, a delete button per file, Close and
// Save at the foot. A skill with no files offers its own "Add file". It
// opens on SKILL.md, whose frontmatter carries the skill's name and the
// description agents read when they load the role.
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
  enumerateRoleSkillFiles,
  readRoleSkillFile,
  writeRoleSkillFile,
  writeRoleSkillFileBinary,
  createRoleSkillFile,
  deleteRoleSkillFile,
  deleteRoleSkill,
  renameRoleSkill,
  RoleSkillAlreadyExistsError,
  RenamedButEditsNotSavedError,
  RoleSkillFileMtimeConflictError,
  RoleSkillFileAlreadyExistsError,
  type RoleSkillFileEntry,
  roleSkillFileUrl,
} from "@/api/role-skills-api";
import { roleDisplayName } from "@/lib/role-display-name";
import SkillFileTab, { type SkillFileTabData } from "../SkillFileTab";
import { fileViewNeverNeedsContent, type BinaryDraft } from "../file-viewers/registry";
import type { TabState } from "../IdentityFileTab";
import { frontmatterName } from "../skill-frontmatter";
import { slugifyRoleName } from "@/lib/slugify-role-name";
import type { EscapeHandler, LeaveGuard } from "./RolesWindow";

export function RoleSkillView({
  hostId,
  role,
  skill,
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
  skill: string;
  readOnly: boolean;
  onBack: () => void;
  onClose: () => void;
  onDeleted: () => void;
  /** After a rename lands — the window re-opens the skill under its new name. */
  onRenamed: (newName: string) => void;
  registerGuard: (g: LeaveGuard | null) => void;
  registerEscape: (h: EscapeHandler | null) => void;
}): JSX.Element {
  const roleName = role.name;
  const fullscreen = useModalFullscreen();
  const [files, setFiles] = useState<TabState<RoleSkillFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const [binaryDrafts, setBinaryDrafts] = useState<Map<string, BinaryDraft>>(new Map());
  const [saving, setSaving] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    console.debug("[RoleSkillView] open", { hostId, roleName, skill });
    enumerateRoleSkillFiles(hostId, roleName, skill)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        const first = entries.find((e) => e.path === "SKILL.md") ?? entries[0];
        if (first) setActiveTab(first.path);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFiles({ status: "error", error: err instanceof Error ? err.message : "Failed to load files" });
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, roleName, skill]);

  // Lazy-load the open file (one at a time).
  useEffect(() => {
    if (!activeTab || tabData.has(activeTab)) return;
    let cancelled = false;
    if (fileViewNeverNeedsContent(activeTab)) {
      setTabData((prev) => new Map(prev).set(activeTab, { status: "ready", data: { content: "", mtime: 0, isText: false } }));
      return;
    }
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readRoleSkillFile(hostId, roleName, skill, activeTab)
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
  }, [hostId, roleName, skill, activeTab]);

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
        const result = await writeRoleSkillFile({ hostId, role: roleName, skill, path, content, expectedMtime });
        setTabData((prev) =>
          new Map(prev).set(path, { status: "ready", data: { content, mtime: result.mtime, isText: keepIsText(prev) } }),
        );
        console.debug("[RoleSkillView] save-ok", { path, mtime: result.mtime });
      } catch (err) {
        if (err instanceof RoleSkillFileMtimeConflictError) {
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
    [hostId, roleName, skill],
  );

  // Rename = move the skill folder (the backend also rewrites SKILL.md's
  // `name:` and retargets links left at a runbook's old path). With
  // `draft`, that main-file draft rides along in the same request — checked
  // against the mtime it was loaded at before anything moves.
  const performRename = useCallback(
    async (newName: string, draft: { path: string; content: string; expectedMtime: number } | null): Promise<void> => {
      console.debug("[RoleSkillView] rename", { hostId, roleName, from: skill, to: newName, withDraft: draft != null });
      let renamed = false;
      try {
        await renameRoleSkill(hostId, roleName, skill, newName, draft ?? undefined);
        renamed = true;
      } catch (err) {
        renamed = err instanceof RenamedButEditsNotSavedError;
        console.debug("[RoleSkillView] rename-error", { hostId, roleName, from: skill, to: newName, renamed });
        void kitAlert({
          title: renamed ? `Renamed to "${newName}"` : "Couldn't rename the skill",
          body:
            err instanceof RoleSkillAlreadyExistsError
              ? `A skill named "${newName}" already exists in this role.`
              : err instanceof RoleSkillFileMtimeConflictError
                ? `${draft?.path ?? "The file"} changed on disk since you opened it, so nothing was renamed. Copy your edits somewhere, reopen the skill, and try again.`
                : renamed
                  ? "But your edits couldn't be saved."
                  : err instanceof Error
                    ? err.message
                    : undefined,
        });
      }
      if (renamed) onRenamed(newName);
    },
    [hostId, roleName, skill, onRenamed],
  );

  const handleRenameSkill = async (): Promise<void> => {
    if (dirtySet.size > 0 || binaryDrafts.size > 0) {
      void kitAlert({ title: "Save or discard your edits first", body: "Renaming the skill reloads its files." });
      return;
    }
    const raw = await kitPrompt({
      title: `Rename "${skill}"`,
      body: "Its folder and the name in its SKILL.md change together.",
      label: "New name",
      defaultValue: skill,
      confirmLabel: "Rename",
      mono: true,
      validate: (v) =>
        slugifyRoleName(v.trim()).length === 0 ? "Pick a name with at least one letter or number." : null,
    });
    if (raw == null) return;
    const slug = slugifyRoleName(raw.trim());
    if (slug === skill) return;
    await performRename(slug, null);
  };

  // A main-file save whose `name:` was changed away from the folder is never
  // saved as is — the backend refuses it; offer the rename instead. A name
  // that already disagreed on disk and wasn't touched saves normally.
  // Returns true when it handled the save (renamed, or refused with a note).
  const handleMainFileNameChange = useCallback(
    async (path: string, content: string, loaded: SkillFileTabData): Promise<boolean> => {
      if (path !== "SKILL.md") return false;
      const name = frontmatterName(content);
      if (name === null || name === skill) return false;
      if (name === frontmatterName(loaded.content)) return false;
      const slug = slugifyRoleName(name);
      if (slug !== name) {
        void kitAlert({
          title: `"${name}" can't be a skill name`,
          body: `Use lowercase letters, numbers and hyphens${slug ? ` (e.g. "${slug}")` : ""}.`,
        });
        return true;
      }
      if ([...dirtySet].some((p) => p !== path) || binaryDrafts.size > 0) {
        void kitAlert({ title: "Save or discard your other files' edits first", body: "Renaming the skill reloads them." });
        return true;
      }
      if (
        !(await kitConfirm({
          title: `Rename the skill to "${name}"?`,
          body: `${path} now names it "${name}", but its folder is "${skill}" — the two always match. Cancel keeps your edits unsaved.`,
          confirmLabel: "Rename",
        }))
      )
        return true;
      await performRename(name, { path, content, expectedMtime: loaded.mtime });
      return true;
    },
    [skill, dirtySet, binaryDrafts, performRename],
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
        await writeRoleSkillFileBinary(hostId, roleName, skill, activeTab, bytes);
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
  }, [saving, activeTab, tabData, drafts, binaryDrafts, handleSave, handleMainFileNameChange, hostId, roleName, skill]);

  const refreshFiles = async (): Promise<RoleSkillFileEntry[]> => {
    const entries = await enumerateRoleSkillFiles(hostId, roleName, skill);
    setFiles({ status: "ready", data: entries });
    return entries;
  };

  const handleAddFile = async (): Promise<void> => {
    const raw = await kitPrompt({
      title: "New file",
      label: "File name",
      body: "Relative to the skill's folder, e.g. scripts/run.sh",
      placeholder: "notes.md",
      confirmLabel: "Create",
      mono: true,
    });
    const relPath = raw?.trim();
    if (!relPath) return;
    try {
      await createRoleSkillFile(hostId, roleName, skill, relPath);
      console.debug("[RoleSkillView] add-file", { path: relPath });
      await refreshFiles();
      setActiveTab(relPath);
      if (fullscreen) setFilesOpen(false);
    } catch (err) {
      void kitAlert({
        title: "Couldn't create the file",
        body:
          err instanceof RoleSkillFileAlreadyExistsError
            ? `A file named "${relPath}" already exists in this skill.`
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
        body: `This removes ${skill}/${path}. This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteRoleSkillFile(hostId, roleName, skill, path);
      console.debug("[RoleSkillView] delete-file", { path });
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

  const handleDeleteSkill = async (): Promise<void> => {
    if (
      !(await kitConfirm({
        title: `Delete the ${roleDisplayName(skill)} skill?`,
        body: "This removes the skill and every file inside it. This can't be undone.",
        confirmLabel: "Delete skill",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteRoleSkill(hostId, roleName, skill);
      console.info({ operation: "role_skill_deleted", hostId, roleName, skill });
      onDeleted();
    } catch (err) {
      void kitAlert({ title: "Couldn't delete the skill", body: err instanceof Error ? err.message : undefined });
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
            body: "Your edits to this skill haven't been saved.",
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
      title={filesOpen ? "Hide the file list" : "Show every file in this skill"}
      data-variant={filesOpen ? "plain" : undefined}
      data-testid="skill-view-files-toggle"
    >
      <PanelLeft /> {fileCount === 1 ? "Files" : `${fileCount} files`}
    </KitButton>
  );

  const menuItems: RowKebabMenuItem[] = readOnly
    ? [{ label: "Only an admin can change a shared role's skills", disabled: true }]
    : [
        { label: "Add file…", onClick: () => void handleAddFile(), testId: "skill-view-add-file-menu" },
        {
          label: "Rename…",
          hint: dirtySet.size > 0 ? "Save or discard your edits first" : undefined,
          disabled: dirtySet.size > 0,
          onClick: () => void handleRenameSkill(),
          testId: "skill-view-rename",
        },
        {
          label: "Delete skill…",
          danger: true,
          separatorBefore: true,
          onClick: () => void handleDeleteSkill(),
          testId: "skill-view-delete",
        },
      ];

  const addFileButton = (variant: "plain" | "primary", full?: boolean): JSX.Element => (
    <KitButton variant={variant} size="sm" full={full} onClick={() => void handleAddFile()} data-testid="skill-view-add-file">
      <Plus /> Add file
    </KitButton>
  );

  return (
    <>
      <ModalHead
        title={roleDisplayName(skill)}
        subtitle="Role skill"
        closeTestId="roles-window-close"
        leading={
          <KitButton variant="plain" size="sm" onClick={onBack} className="max-w-[40vw]" data-testid="roles-window-back">
            <ChevronLeft /> <span className="truncate">{roleDisplayName(roleName, role.displayName)}</span>
          </KitButton>
        }
        actions={<RowKebabMenu items={menuItems} ariaLabel="Skill options" testId="skill-view-menu" />}
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
            body={readOnly ? undefined : "Add its SKILL.md — a name and description agents read, then the steps."}
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
            rowTestId="skill-view-file-list"
            testIdPrefix="skill-view-file"
            header={fullscreen ? <div className="flex items-center gap-2 pb-2">{filesToggle}</div> : undefined}
            trailing={readOnly ? undefined : addFileButton("plain", true)}
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-4 py-3" data-testid="skill-view-body">
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
                      <span className="truncate text-[13px] font-semibold text-[var(--k-t1)]" data-testid="skill-view-current-file">
                        {activeTab}
                      </span>
                    </>
                  }
                  mediaUrl={roleSkillFileUrl(hostId, roleName, skill, activeTab, { inline: true })}
                  downloadUrl={roleSkillFileUrl(hostId, roleName, skill, activeTab)}
                />
              )}
            </div>
          </ModalSidebar>
        </div>
      )}
      <ModalFoot>
        <KitButton onClick={onClose} disabled={saving} data-testid="skill-view-close">
          Close
        </KitButton>
        {readOnly ? null : (
          <KitButton
            variant="primary"
            onClick={() => void handleFootSave()}
            disabled={!canSave}
            busy={saving}
            data-testid="skill-view-save"
          >
            {saving ? "Saving…" : "Save"}
          </KitButton>
        )}
      </ModalFoot>
    </>
  );
}
