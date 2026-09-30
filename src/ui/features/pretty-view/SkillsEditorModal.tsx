import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot, ModalTabs } from "@/components/modal";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listSkills,
  enumerateSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillFile,
  createSkill,
  deleteSkillFile,
  deleteSkill,
  SkillFileMtimeConflictError,
  SkillFileAlreadyExistsError,
  SkillAlreadyExistsError,
  type SkillEntry,
  type SkillFileEntry,
} from "@/api/skills-api";
import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import type { TabState } from "./IdentityFileTab";
import { bumpModalOpen } from "@/lib/freeze-diag";

// SkillsEditorModal — cross-host cross-skill multi-file editor.
//
// Modal-unification 2026-09-29 (revised 2026-09-30 UAT):
//   - Shell: <Modal hue={324}>. Blocking (proper backdrop + focus trap)
//     with document.body as the portal target — the earlier "blocking=false"
//     kept the composer typable but rendered the modal without any dim
//     behind it, making the whole surface easy to lose against live chat
//     content. Same retirement as IdentityModal 2026-09-30.
//   - Head: two rows.
//     Row 1: title="Skills" (static — this modal browses across skills,
//     not scoped to one) + close X via <ModalHead>.
//     Row 2 (picker bar sibling directly under head): host select
//     (hidden on single-host installs), skill select, "+ New skill"
//     button, delete-skill Trash (only when a skill is picked).
//   - File strip MOVED from bottom to TOP (matches RunbookEditor
//     translation — IDE convention: tabs atop the surface they select).
//     "+ New file" pill pinned at the end of the strip.
//   - Body: layered branches preserved (no-host / loading-skills /
//     error-skills / no-skills / no-skill-picked / loading-files /
//     error-files / no-files / editor). Active tab renders SkillFileTab
//     directly (Radix Tabs dropped — matches Runbook).
//   - Foot: canonical <ModalFoot> with Close (secondary) + Save
//     (primary). Save dispatches to active tab's write. Per-tab draft
//     state tracked at modal level via drafts Map + dirtySet.
//
// SkillFileTab passes `hideSaveButton={true}` — outer foot owns save.
// Delete-file affordance stays inside SkillFileTab (Trash next to the
// hidden Save slot). Delete-skill lives in the header picker row.
//
// Close/draft-guard: any dirty tab AND !savingRef → window.confirm.
// savingRef bypasses on save-success and delete-skill closes.
//
// All D-XX behaviors preserved: host auto-select, skill list refetch on
// host change, file list refetch on skill change, per-tab lazy load,
// mtime-409 conflict-reload, native window.confirm/prompt for
// create/delete flows, Phase 113 New-skill / New-file split.

const OPTION_STYLE = { backgroundColor: "#1a1a1a", color: "#e8e4d8" } as const;

function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) out.push(...collectAllHosts(child.children));
    else out.push(child);
  }
  return out;
}

export interface SkillsEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostTree: HostFolder | null;
  defaultHostId: number | null;
  container?: HTMLElement | null;
}

export default function SkillsEditorModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  container,
}: SkillsEditorModalProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skills, setSkills] = useState<TabState<SkillEntry[]>>({ status: "loading" });
  const [files, setFiles] = useState<TabState<SkillFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());

  // Per-tab draft state — SkillFileTab mirrors its internal draft here via
  // onDraftContentChange so the foot Save can dispatch to the correct
  // active tab. dirtySet drives the close-confirm draft-guard.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const flatHosts = useMemo(
    () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );

  // freeze-diag: bump the skills-modal open counter on each closed→open
  // transition. See src/ui/lib/freeze-diag.ts.
  useEffect(() => {
    if (open) bumpModalOpen("skills");
  }, [open]);

  // Auto-select host on open; reset state on close.
  useEffect(() => {
    if (!open) {
      setSelectedHostId(null);
      setSelectedSkillName(null);
      setSkills({ status: "loading" });
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDrafts(new Map());
      setDirtySet(new Set());
      setSaving(false);
      savingRef.current = false;
      return;
    }
    if (defaultHostId != null && flatHosts.some((h) => Number(h.id) === defaultHostId)) {
      setSelectedHostId(defaultHostId);
      return;
    }
    if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));
  }, [open, defaultHostId, flatHosts]);

  // Fetch skills list when host changes.
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setSkills({ status: "loading" });
    setSelectedSkillName(null);
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    setDrafts(new Map());
    setDirtySet(new Set());
    listSkills(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        setSkills({ status: "ready", data: entries });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSkills({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load skills",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHostId]);

  // Fetch file list when skill changes.
  useEffect(() => {
    if (selectedHostId == null || selectedSkillName == null) {
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDrafts(new Map());
      setDirtySet(new Set());
      return;
    }
    let cancelled = false;
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    setDrafts(new Map());
    setDirtySet(new Set());
    enumerateSkillFiles(selectedHostId, selectedSkillName)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        if (entries.length > 0) setActiveTab(entries[0].path);
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
  }, [selectedHostId, selectedSkillName]);

  // Lazy-load content for the active tab.
  useEffect(() => {
    if (selectedHostId == null || !selectedSkillName || !activeTab) return;
    if (tabData.has(activeTab)) return;
    let cancelled = false;
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readSkillFile(selectedHostId, selectedSkillName, activeTab)
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
  }, [selectedHostId, selectedSkillName, activeTab]);

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

  // Save handler — SkillFileTab-facing signature. Also called by foot Save.
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      if (selectedHostId == null || selectedSkillName == null) return;
      try {
        const result = await writeSkillFile({
          hostId: selectedHostId,
          skill: selectedSkillName,
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
      } catch (err) {
        if (err instanceof SkillFileMtimeConflictError) {
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
    [selectedHostId, selectedSkillName],
  );

  // Foot Save — dispatches to active tab's save with tracked draft.
  const handleFootSave = useCallback(async () => {
    if (saving) return;
    if (!activeTab) return;
    const tab = tabData.get(activeTab);
    if (tab?.status !== "ready") return;
    const draft = drafts.get(activeTab) ?? tab.data.content;
    if (draft === tab.data.content) return;
    setSaving(true);
    savingRef.current = true;
    try {
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [saving, activeTab, tabData, drafts, handleSave]);

  const handleAddFile = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null) return;
    const raw = window.prompt("New file name (relative to skill root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      await createSkillFile(selectedHostId, selectedSkillName, relPath);
      const entries = await enumerateSkillFiles(selectedHostId, selectedSkillName);
      setFiles({ status: "ready", data: entries });
      setActiveTab(relPath);
    } catch (err) {
      const msg =
        err instanceof SkillFileAlreadyExistsError
          ? `A file named "${relPath}" already exists in this skill.`
          : err instanceof Error
          ? `Couldn't create "${relPath}": ${err.message}`
          : `Couldn't create "${relPath}".`;
      window.alert(msg);
    }
  }, [selectedHostId, selectedSkillName]);

  // New-skill handler — chained window.prompt (name → description); slugify
  // client-side; empty slug reprompts name; empty description reprompts
  // description only (name retained via closure). See prior comment history
  // for D-01..D-05 rationale.
  const handleNewSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null) return;

    let displayName: string | null = null;
    let slug: string | null = null;
    while (slug === null) {
      const rawName = window.prompt("New skill name:", "");
      if (rawName == null) return;
      const trimmedRaw = rawName.trim();
      const candidate = slugifyRoleName(trimmedRaw);
      if (candidate.length === 0) {
        window.alert("Please pick a name with at least one letter or number.");
        continue;
      }
      displayName = trimmedRaw;
      slug = candidate;
    }

    let description: string | null = null;
    while (description === null) {
      const rawDesc = window.prompt(`Description for "${displayName}":`, "");
      if (rawDesc == null) return;
      const trimmed = rawDesc.trim();
      if (trimmed.length === 0) {
        window.alert("A description is required.");
        continue;
      }
      description = trimmed;
    }

    try {
      const result = await createSkill(selectedHostId, slug, description);
      const entries = await listSkills(selectedHostId);
      setSkills({ status: "ready", data: entries });
      setSelectedSkillName(result.slug);
    } catch (err) {
      const msg =
        err instanceof SkillAlreadyExistsError
          ? `A skill named "${displayName}" already exists on this host.`
          : err instanceof Error
          ? `Couldn't create "${displayName}": ${err.message}`
          : `Couldn't create "${displayName}".`;
      window.alert(msg);
    }
  }, [selectedHostId]);

  const handleDeleteFile = useCallback(
    async (doomedPath: string): Promise<void> => {
      if (selectedHostId == null || selectedSkillName == null) return;
      if (!window.confirm(`Delete "${selectedSkillName}/${doomedPath}"? This can't be undone.`)) return;
      try {
        await deleteSkillFile(selectedHostId, selectedSkillName, doomedPath);
        const entries = await enumerateSkillFiles(selectedHostId, selectedSkillName);
        setFiles({ status: "ready", data: entries });
        if (activeTab === doomedPath) {
          setActiveTab(entries.length > 0 ? entries[0].path : null);
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
        window.alert(msg);
      }
    },
    [selectedHostId, selectedSkillName, activeTab],
  );

  const handleDeleteSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null) return;
    if (
      !window.confirm(
        `Delete skill "${selectedSkillName}"? This removes the skill folder and every file inside it. This can't be undone.`,
      )
    )
      return;
    try {
      savingRef.current = true; // bypass draft-guard on the state clear
      await deleteSkill(selectedHostId, selectedSkillName);
      const entries = await listSkills(selectedHostId);
      setSkills({ status: "ready", data: entries });
      setSelectedSkillName(null);
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDrafts(new Map());
      setDirtySet(new Set());
      savingRef.current = false;
    } catch (err) {
      savingRef.current = false;
      const msg = err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete";
      window.alert(msg);
    }
  }, [selectedHostId, selectedSkillName]);

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

  const showHostSelect = flatHosts.length > 1;
  const skillPickerDisabled = selectedHostId == null || skills.status !== "ready";

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      hue={324}
      size="xl"
      // `container` prop still accepted for test injection (see .test.tsx —
      // 20 sites pass document.body explicitly). Default undefined portals
      // to document.body naturally.
      container={container ?? undefined}
      className="max-h-[80vh] flex flex-col"
      data-testid="skills-editor-modal"
    >
      <ModalHead title="Skills" closeTestId="skills-editor-modal-close" />

      {/* Picker row — sits directly under the head. Host select (multi-host
          only), skill select, + New skill, delete-skill Trash (when a skill
          is picked). */}
      <div
        className={cn(
          "px-4 py-2.5 flex flex-row items-center gap-2 flex-shrink-0 flex-wrap",
          "bg-black/25",
          "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
        )}
      >
        {showHostSelect && (
          <select
            aria-label="Host"
            value={selectedHostId ?? ""}
            onChange={(e) =>
              setSelectedHostId(e.target.value ? Number(e.target.value) : null)
            }
            data-testid="skills-editor-modal-host-select"
            className={cn(
              "text-[12px] px-2 py-1 rounded-md outline-none cursor-pointer min-w-[120px]",
              "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
              "text-[#fbf5e8]",
            )}
          >
            <option value="" style={OPTION_STYLE}>
              Pick a host…
            </option>
            {flatHosts.map((h) => (
              <option key={h.id} value={h.id} style={OPTION_STYLE}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Skill"
          value={selectedSkillName ?? ""}
          onChange={(e) =>
            setSelectedSkillName(e.target.value ? e.target.value : null)
          }
          disabled={skillPickerDisabled}
          data-testid="skills-editor-modal-skill-select"
          className={cn(
            "flex-1 min-w-0 text-[12px] px-2 py-1 rounded-md outline-none cursor-pointer",
            "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
            "text-[#fbf5e8]",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          )}
        >
          <option value="" style={OPTION_STYLE}>
            {selectedHostId != null && skills.status === "loading"
              ? "Loading skills…"
              : selectedHostId != null && skills.status === "error"
              ? "Couldn't load skills"
              : "Pick a skill…"}
          </option>
          {skills.status === "ready" &&
            skills.data.map((s) => (
              <option key={s.name} value={s.name} style={OPTION_STYLE}>
                {s.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => {
            void handleNewSkill();
          }}
          disabled={selectedHostId == null}
          aria-label="+ New skill"
          data-testid="skills-editor-modal-new-skill"
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] cursor-pointer",
            "bg-[hsla(var(--pv-id-hue),65%,55%,0.30)]",
            "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.42)]",
            "border border-[hsla(var(--pv-id-hue),75%,70%,0.45)]",
            "text-[#fbf5e8]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <Plus size={12} /> New
        </button>
        {selectedSkillName != null && (
          <button
            type="button"
            title="Delete this skill"
            aria-label="Delete this skill"
            onClick={() => {
              void handleDeleteSkill();
            }}
            data-testid="skills-editor-modal-delete-skill"
            className="size-8 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* File strip — canonical <ModalTabs> per UAT 2026-09-30. */}
      {selectedSkillName != null && files.status === "ready" && (
        <ModalTabs
          tabs={files.data.map((f) => ({
            value: f.path,
            label: f.path,
            Icon: FileText,
          }))}
          value={activeTab ?? ""}
          onValueChange={(v) => setActiveTab(v)}
          rowTestId="skills-editor-modal-file-strip"
          testIdPrefix="skills-editor-modal-tab"
          scrollable
          trailing={
            <button
              type="button"
              onClick={() => {
                void handleAddFile();
              }}
              data-testid="skills-editor-modal-add-file"
              className={cn(
                "shrink-0 flex items-center gap-1 px-2.5 py-2 text-[12.5px] cursor-pointer",
                "text-[hsla(var(--pv-id-hue),30%,90%,0.7)] hover:text-[#fbf5e8]",
                "border-b-2 border-transparent -mb-px transition-colors duration-150",
              )}
            >
              <Plus size={12} /> Add file
            </button>
          }
        />
      )}

      {/* Body — layered branches. */}
      {selectedHostId == null ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Pick a host to load its skills.
        </ModalBody>
      ) : skills.status === "loading" ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Loading skills…
        </ModalBody>
      ) : skills.status === "error" ? (
        <ModalBody className="flex items-center justify-center text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load skills: {skills.error}
        </ModalBody>
      ) : skills.data.length === 0 ? (
        <ModalBody className="flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-2 text-sm text-center px-6">
          <div>No skills on this host.</div>
          <div className="text-xs opacity-70">
            Skills live in{" "}
            <code className="px-1 rounded bg-black/30">~/.claude/skills/</code>{" "}
            on the host. Nothing to edit here yet.
          </div>
        </ModalBody>
      ) : selectedSkillName == null ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Pick a skill.
        </ModalBody>
      ) : files.status === "loading" ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Loading files…
        </ModalBody>
      ) : files.status === "error" ? (
        <ModalBody className="flex items-center justify-center text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load files: {files.error}
        </ModalBody>
      ) : files.data.length === 0 ? (
        <ModalBody className="flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-2 text-sm text-center px-6">
          <div>This skill has no files.</div>
          <div className="text-xs opacity-70">
            Use the &quot;+ Add file&quot; tab above to create one.
          </div>
        </ModalBody>
      ) : (
        <ModalBody
          className="p-0 flex flex-col min-h-0 overflow-y-auto px-6 py-4"
          data-testid="skills-editor-modal-body"
        >
          {activeTab != null && (
            <SkillFileTab
              state={tabData.get(activeTab) ?? { status: "loading" }}
              onSave={(content, expectedMtime) =>
                handleSave(activeTab, content, expectedMtime)
              }
              onRequestDelete={() => {
                void handleDeleteFile(activeTab);
              }}
              filename={activeTab}
              hideSaveButton={true}
              onDraftContentChange={handleDraftContentChange(activeTab)}
              onDraftChange={handleDraftDirtyChange(activeTab)}
            />
          )}
        </ModalBody>
      )}

      <ModalFoot>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          disabled={saving}
          data-testid="skills-editor-modal-close-foot"
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
          data-testid="skills-editor-modal-save"
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
