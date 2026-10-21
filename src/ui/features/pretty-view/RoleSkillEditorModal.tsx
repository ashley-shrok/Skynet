import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot, ModalSidebar } from "@/components/modal";
import { cn } from "@/lib/utils";
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
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import { fileViewNeverNeedsContent, type BinaryDraft } from "./file-viewers/registry";
import type { TabState } from "./IdentityFileTab";
import { frontmatterName } from "./skill-frontmatter";
import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";

/** The tab a role skill opens on: its SKILL.md when it has one. */
function firstTab(entries: RoleSkillFileEntry[]): string {
  return entries.find((e) => e.path === "SKILL.md")?.path ?? entries[0].path;
}

// RoleSkillEditorModal — role-scoped multi-file editor for a single role skill.
//
// Modal-unification 2026-09-29 (revised 2026-09-30 UAT):
//   - Shell: canonical <Modal>. Standard blocking backdrop —
//     the earlier `blocking={false}` mode was retired fleet-wide.
//   - Head: meta = "Role skill · <roleName>", title = roleSkillName, actions =
//     Trash2 delete-skill grouped tight with close X. "+ Add file"
//     moved OUT of the head DOWN into the file strip (tasting anatomy).
//   - File strip MOVED from bottom to TOP — sits directly under the head,
//     above the editor pane (IDE convention: tabs sit atop the surface
//     they select).
//   - Body: <ModalBody> holds the ACTIVE tab's editor only (Radix Tabs is
//     dropped — we pick the active file's SkillFileTab directly).
//   - Foot: canonical <ModalFoot> with Close (secondary) + Save (primary).
//     Save fires the active tab's write endpoint using the per-tab draft
//     map. SkillFileTab renders with `hideSaveButton={true}` — the outer
//     foot owns save placement.
//
// Per-tab draft tracking:
//   drafts   : Map<path, string>  — updated on every keystroke via
//                                   SkillFileTab.onDraftContentChange
//   dirtySet : Set<path>          — updated via onDraftChange; drives the
//                                   close-confirm draft-guard
//
// Close/draft-guard: any dirty tab AND !mid-save fires window.confirm
// ("Discard unsaved changes?"). savingRef bypasses on save-success closes
// (same pattern as EditableFileModal / ProjectModal).
//
// Delete-file affordance stays inside SkillFileTab (Trash2 next to Save
// slot). Rename-skill (Pencil) and delete-skill (Trash2) live in the
// head actions slot, next to close X. Rename moves the folder on disk; the
// parent owns `roleSkillName`, so it learns the new name via onRenamed. A
// main-file save whose frontmatter `name:` no longer matches the folder
// offers the rename instead (the backend refuses the mismatch). Both use native window.confirm — no in-app confirm dialogs
// (fleet convention: natives for nested destructive confirms).
//
// Structured console.debug logging retained with [RoleSkillEditorModal]
// prefix per the role standing directive on log-first diagnostics.

export interface RoleSkillEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host id — inherited from identity modal (no host picker in this modal). */
  hostId: number;
  /** Role slug — dimension threading through every role-skills-api call. */
  roleName: string;
  /** Role skill slug — the single role skill this modal edits. */
  roleSkillName: string;
  /** Called with the new slug after a rename lands — the parent swaps its
   *  `roleSkillName` so the modal keeps editing the renamed role skill. */
  onRenamed: (newName: string) => void;
  /** Optional portal container — parent controls portal target. */
  container?: HTMLElement | null;
}

export default function RoleSkillEditorModal({
  open,
  onOpenChange,
  hostId,
  roleName,
  roleSkillName,
  onRenamed,
  container,
}: RoleSkillEditorModalProps): JSX.Element {
  const [files, setFiles] = useState<TabState<RoleSkillFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());

  // Per-tab draft state — SkillFileTab keeps its own internal draft, we
  // mirror it here (via onDraftContentChange) so the foot Save can write
  // the correct content without a ref/imperative call. Keyed by path.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  // Unsaved binary edits per tab (PDF annotations). The PDF viewer remounts
  // on tab switch, so these can't survive one — switching away asks first.
  const [binaryDrafts, setBinaryDrafts] = useState<Map<string, BinaryDraft>>(new Map());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      console.debug("[RoleSkillEditorModal] close");
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDrafts(new Map());
      setDirtySet(new Set());
      setSaving(false);
      savingRef.current = false;
    }
  }, [open]);

  // Fetch file list when modal opens (or when hostId/roleName/roleSkillName change).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    console.debug("[RoleSkillEditorModal] open", { hostId, roleName, roleSkillName });
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    setDrafts(new Map());
    setDirtySet(new Set());
    enumerateRoleSkillFiles(hostId, roleName, roleSkillName)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        console.debug("[RoleSkillEditorModal] files-ready", { count: entries.length });
        if (entries.length > 0) setActiveTab(firstTab(entries));
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFiles({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load files",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open, hostId, roleName, roleSkillName]);

  // Lazy-load content for the active tab (one at a time to conserve SSH conns).
  useEffect(() => {
    if (!open || !activeTab) return;
    if (tabData.has(activeTab)) return; // already loaded
    let cancelled = false;
    console.debug("[RoleSkillEditorModal] tab-switch", { path: activeTab });
    // Media and known-binary files render from the streamed URL; reading
    // them through the text endpoint would pull the whole file for nothing.
    if (fileViewNeverNeedsContent(activeTab)) {
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "ready",
          data: { content: "", mtime: 0, isText: false },
        }),
      );
      return;
    }
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readRoleSkillFile(hostId, roleName, roleSkillName, activeTab)
      .then((result) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "ready",
            data: {
              content: result.content,
              mtime: result.mtime,
              isText: result.isText,
            },
          }),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hostId, roleName, roleSkillName, activeTab]);

  // Per-tab draft callbacks — factory functions per active tab keep the
  // callbacks referentially stable within a single tab's mount cycle.
  const handleDraftContentChange = useCallback(
    (path: string) => (draft: string) => {
      setDrafts((prev) => {
        if (prev.get(path) === draft) return prev;
        const next = new Map(prev);
        next.set(path, draft);
        return next;
      });
    },
    [],
  );
  const handleDraftDirtyChange = useCallback(
    (path: string) => (dirty: boolean) => {
      setDirtySet((prev) => {
        const currentlyDirty = prev.has(path);
        if (dirty === currentlyDirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    [],
  );

  const handleBinaryDraftChange = useCallback(
    (path: string) => (draft: BinaryDraft | null) => {
      setBinaryDrafts((prev) => {
        if ((prev.get(path) ?? null) === draft) return prev;
        const next = new Map(prev);
        if (draft) next.set(path, draft);
        else next.delete(path);
        return next;
      });
    },
    [],
  );

  // Save handler — the SkillFileTab-facing signature (for handling its own
  // internal save button, though we hide it — this stays wired for the
  // conflict-reload branch which needs to update tab state).
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      try {
        const result = await writeRoleSkillFile({
          hostId,
          role: roleName,
          skill: roleSkillName,
          path,
          content,
          expectedMtime,
        });
        setTabData((prev) => {
          const prevEntry = prev.get(path);
          const prevIsText =
            prevEntry?.status === "ready" ? prevEntry.data.isText : true;
          return new Map(prev).set(path, {
            status: "ready",
            data: { content, mtime: result.mtime, isText: prevIsText },
          });
        });
        // After save-success, the draft matches the fresh mtime's content —
        // SkillFileTab's own effect will fire onDraftChange(false) on the
        // next tick, clearing this path from dirtySet.
        console.debug("[RoleSkillEditorModal] save-ok", { path, mtime: result.mtime });
      } catch (err) {
        if (err instanceof RoleSkillFileMtimeConflictError) {
          console.debug("[RoleSkillEditorModal] save-conflict", { path });
          const shouldReload = window.confirm(
            "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
          );
          if (shouldReload) {
            setTabData((prev) => {
              const prevEntry = prev.get(path);
              const prevIsText =
                prevEntry?.status === "ready" ? prevEntry.data.isText : true;
              return new Map(prev).set(path, {
                status: "ready",
                data: {
                  content: err.currentContent,
                  mtime: err.currentMtime,
                  isText: prevIsText,
                },
              });
            });
            return;
          }
          throw err;
        }
        throw err;
      }
    },
    [hostId, roleName, roleSkillName],
  );


  // Add-file handler — window.prompt per D-04.
  const handleAddFile = useCallback(async (): Promise<void> => {
    const raw = window.prompt("New file name (relative to role skill root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      console.debug("[RoleSkillEditorModal] add-file", { path: relPath });
      await createRoleSkillFile(hostId, roleName, roleSkillName, relPath);
      const entries = await enumerateRoleSkillFiles(hostId, roleName, roleSkillName);
      setFiles({ status: "ready", data: entries });
      setActiveTab(relPath);
    } catch (err) {
      const msg =
        err instanceof RoleSkillFileAlreadyExistsError
          ? `A file named "${relPath}" already exists in this role skill.`
          : err instanceof Error
          ? `Couldn't create "${relPath}": ${err.message}`
          : `Couldn't create "${relPath}".`;
      window.alert(msg);
    }
  }, [hostId, roleName, roleSkillName]);

  // Delete-file handler — native confirm + delete + refetch.
  const handleDeleteFile = useCallback(
    async (doomedPath: string): Promise<void> => {
      if (!window.confirm(`Delete "${roleSkillName}/${doomedPath}"? This can't be undone.`)) return;
      try {
        console.debug("[RoleSkillEditorModal] delete-file", { path: doomedPath });
        await deleteRoleSkillFile(hostId, roleName, roleSkillName, doomedPath);
        const entries = await enumerateRoleSkillFiles(hostId, roleName, roleSkillName);
        setFiles({ status: "ready", data: entries });
        if (activeTab === doomedPath) {
          setActiveTab(entries.length > 0 ? firstTab(entries) : null);
        }
        setTabData((prev) => {
          const next = new Map(prev);
          next.delete(doomedPath);
          return next;
        });
        setDrafts((prev) => {
          const next = new Map(prev);
          next.delete(doomedPath);
          return next;
        });
        setDirtySet((prev) => {
          if (!prev.has(doomedPath)) return prev;
          const next = new Set(prev);
          next.delete(doomedPath);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete";
        console.debug("[RoleSkillEditorModal] delete-file-error", { path: doomedPath, msg });
        window.alert(msg);
      }
    },
    [hostId, roleName, roleSkillName, activeTab],
  );

  // Rename = move the role skill folder (backend also retargets any runbook
  // forwarding links and rewrites SKILL.md's `name:`). With `draft`, that
  // SKILL.md draft rides along in the same request — checked against the
  // mtime it was loaded at before anything moves.
  const performRename = useCallback(
    async (
      newName: string,
      draft: { path: string; content: string; expectedMtime: number } | null,
    ): Promise<void> => {
      console.debug("[RoleSkillEditorModal] rename", { from: roleSkillName, to: newName, withDraft: draft != null });
      let renamed = false;
      try {
        await renameRoleSkill(hostId, roleName, roleSkillName, newName, draft ?? undefined);
        renamed = true;
      } catch (err) {
        renamed = err instanceof RenamedButEditsNotSavedError;
        console.debug("[RoleSkillEditorModal] rename-error", { from: roleSkillName, to: newName, renamed });
        window.alert(
          err instanceof RoleSkillAlreadyExistsError
            ? `A role skill named "${newName}" already exists in this role.`
            : err instanceof RoleSkillFileMtimeConflictError
            ? `${draft?.path ?? "The file"} changed on disk since you opened it, so nothing was renamed. Copy your edits somewhere, reopen the role skill, and try again.`
            : renamed
            ? `Renamed to "${newName}", but your edits couldn't be saved.`
            : `Couldn't rename "${roleSkillName}": ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
      if (renamed) onRenamed(newName);
    },
    [hostId, roleName, roleSkillName, onRenamed],
  );

  const handleRenameRoleSkill = useCallback(async (): Promise<void> => {
    if (dirtySet.size > 0 || binaryDrafts.size > 0) {
      window.alert("Save or discard your edits before renaming the role skill.");
      return;
    }
    const raw = window.prompt(`Rename "${roleSkillName}" to:`, roleSkillName);
    if (raw == null) return;
    const slug = slugifyRoleName(raw.trim());
    if (slug.length === 0) {
      window.alert("Please pick a name with at least one letter or number.");
      return;
    }
    if (slug === roleSkillName) return;
    await performRename(slug, null);
  }, [roleSkillName, dirtySet, binaryDrafts, performRename]);

  // Main-file save whose `name:` was changed away from the folder. A name
  // that already disagreed on disk and wasn't touched saves normally.
  // Returns true when it handled the save (renamed, or refused with an
  // explanation).
  const handleMainFileNameChange = useCallback(
    async (path: string, content: string, loaded: SkillFileTabData): Promise<boolean> => {
      if (path !== "SKILL.md") return false;
      const name = frontmatterName(content);
      if (name === null || name === roleSkillName) return false;
      if (name === frontmatterName(loaded.content)) return false;
      const slug = slugifyRoleName(name);
      if (slug !== name) {
        window.alert(
          `"${name}" can't be a role skill name — use lowercase letters, numbers and hyphens${slug ? ` (e.g. "${slug}")` : ""}.`,
        );
        return true;
      }
      if ([...dirtySet].some((p) => p !== path) || binaryDrafts.size > 0) {
        window.alert("Save or discard your other files' edits first — renaming the role skill reloads them.");
        return true;
      }
      if (
        !window.confirm(
          `${path} now names this role skill "${name}", but its folder is "${roleSkillName}". Rename the role skill to "${name}"?\n\nCancel keeps your edits unsaved.`,
        )
      )
        return true;
      await performRename(name, { path, content, expectedMtime: loaded.mtime });
      return true;
    },
    [roleSkillName, dirtySet, binaryDrafts, performRename],
  );

  // Foot Save — dispatches to active tab's save with the tracked draft.
  const handleFootSave = useCallback(async () => {
    if (saving) return;
    if (!activeTab) return;
    const tab = tabData.get(activeTab);
    if (tab?.status !== "ready") return;
    const binary = binaryDrafts.get(activeTab);
    if (binary) {
      setSaving(true);
      savingRef.current = true;
      try {
        const bytes = await binary.getBytes();
        await writeRoleSkillFileBinary(hostId, roleName, roleSkillName, activeTab, bytes);
        binary.markSaved(bytes);
      } catch (err) {
        window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
        savingRef.current = false;
      } finally {
        setSaving(false);
      }
      return;
    }
    const draft = drafts.get(activeTab) ?? tab.data.content;
    if (draft === tab.data.content) return;
    setSaving(true);
    savingRef.current = true;
    try {
      if (await handleMainFileNameChange(activeTab, draft, tab.data)) {
        // Nothing (or a rename) was saved — don't leave the close guard off.
        savingRef.current = false;
        return;
      }
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
      savingRef.current = false;
    } finally {
      setSaving(false);
      // Leave savingRef true briefly so a subsequent close-on-save doesn't
      // re-prompt. It resets naturally on close via the reset-on-close effect.
    }
  }, [saving, activeTab, tabData, drafts, handleSave, binaryDrafts, handleMainFileNameChange]);

  // Delete-skill handler — window.confirm + delete + close.
  const handleDeleteRoleSkill = useCallback(async (): Promise<void> => {
    if (
      !window.confirm(
        `Delete role skill "${roleSkillName}"? This removes the role skill folder and every file inside it. This can't be undone.`,
      )
    )
      return;
    try {
      console.debug("[RoleSkillEditorModal] delete-skill", { roleSkillName });
      savingRef.current = true; // bypass draft-guard on the close-after-delete
      await deleteRoleSkill(hostId, roleName, roleSkillName);
      onOpenChange(false);
    } catch (err) {
      savingRef.current = false;
      const msg = err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete";
      console.debug("[RoleSkillEditorModal] delete-skill-error", { roleSkillName, msg });
      window.alert(msg);
    }
  }, [hostId, roleName, roleSkillName, onOpenChange]);

  // Close/draft-guard.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && dirtySet.size > 0 && !savingRef.current) {
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [dirtySet, onOpenChange],
  );

  const activeTabState =
    activeTab != null ? tabData.get(activeTab) : undefined;
  const canFootSave =
    !saving &&
    activeTab != null &&
    activeTabState?.status === "ready" &&
    dirtySet.has(activeTab);

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="editor"
      container={container ?? undefined}
      data-testid="role-skill-editor-modal"
    >
      <ModalHead
        meta={`Role skill · ${roleName}`}
        title={roleSkillName}
        closeTestId="role-skill-editor-modal-close"
        actions={
          <>
            <button
              type="button"
              title="Rename this role skill"
              aria-label="Rename this role skill"
              onClick={() => {
                void handleRenameRoleSkill();
              }}
              data-testid="role-skill-editor-modal-rename"
              className="size-8 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#fbf5e8] cursor-pointer"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              title="Delete this role skill"
              aria-label="Delete this role skill"
              onClick={() => {
                void handleDeleteRoleSkill();
              }}
              data-testid="role-skill-editor-modal-delete"
              className="size-8 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
            >
              <Trash2 size={16} />
            </button>
          </>
        }
      />

      {/* Layered branches for the file list state. */}
      {files.status === "loading" ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Loading files…
        </ModalBody>
      ) : files.status === "error" ? (
        <ModalBody className="flex items-center justify-center text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load files: {files.error}
        </ModalBody>
      ) : files.data.length === 0 ? (
        <ModalBody className="flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-2 text-sm text-center px-6">
          <div>This roleSkill has no files.</div>
          <div className="text-xs opacity-70">
            Use &quot;+ Add file&quot; to create one.
          </div>
        </ModalBody>
      ) : (
        <ModalSidebar
          tabs={files.data.map((f) => ({
            value: f.path,
            label: f.path,
            Icon: FileText,
          }))}
          value={activeTab ?? ""}
          onValueChange={(v) => {
            if (
              activeTab != null &&
              v !== activeTab &&
              binaryDrafts.has(activeTab) &&
              !window.confirm("Discard unsaved changes to this PDF?")
            ) {
              return;
            }
            setActiveTab(v);
          }}
          rowTestId="role-skill-editor-modal-file-strip"
          testIdPrefix="role-skill-editor-modal-tab"
          trailing={
            <button
              type="button"
              onClick={() => {
                void handleAddFile();
              }}
              data-testid="role-skill-editor-modal-add-file"
              className={cn(
                "w-full flex items-center gap-1 px-2 py-1.5 rounded text-[12px] cursor-pointer",
                "text-[hsla(var(--pv-id-hue),30%,90%,0.75)] hover:text-[#fbf5e8]",
                "hover:bg-white/[0.05] transition-colors duration-150",
              )}
            >
              <Plus size={12} /> Add file
            </button>
          }
        >
          <div
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
            data-testid="role-skill-editor-modal-body"
          >
            {activeTab != null && (
              <SkillFileTab
                state={tabData.get(activeTab) ?? { status: "loading" }}
                onSave={async (content, expectedMtime) => {
                  const loaded = tabData.get(activeTab);
                  if (loaded?.status === "ready" && (await handleMainFileNameChange(activeTab, content, loaded.data)))
                    return;
                  await handleSave(activeTab, content, expectedMtime);
                }}
                onRequestDelete={() => {
                  void handleDeleteFile(activeTab);
                }}
                filename={activeTab}
                hideSaveButton={true}
                onDraftContentChange={handleDraftContentChange(activeTab)}
                onDraftChange={handleDraftDirtyChange(activeTab)}
                onBinaryDraftChange={handleBinaryDraftChange(activeTab)}
                mediaUrl={roleSkillFileUrl(hostId, roleName, roleSkillName, activeTab, { inline: true })}
                downloadUrl={roleSkillFileUrl(hostId, roleName, roleSkillName, activeTab)}
              />
            )}
          </div>
        </ModalSidebar>
      )}

      {/* Foot — Close + Save. Rendered even when no files (Save disabled)
          so the modal chrome is consistent across states. */}
      <ModalFoot>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          disabled={saving}
          data-testid="role-skill-editor-modal-close-foot"
          className={cn(
            "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
            "bg-black/20 border border-white/10",
            "hover:bg-black/30",
            "text-[#e8e4d8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            void handleFootSave();
          }}
          disabled={!canFootSave}
          data-testid="role-skill-editor-modal-save"
          className={cn(
            "px-4 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer",
            "bg-[hsla(var(--pv-id-hue),65%,45%,0.75)]",
            "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.85)]",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.7)]",
            "text-[#f4f1e8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </ModalFoot>
    </Modal>
  );
}
