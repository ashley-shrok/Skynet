import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { RowKebabMenu } from "@/features/pretty-conversations/RowKebabMenu";
import { Modal, ModalHead, ModalBody, ModalFoot, ModalSidebar } from "@/components/modal";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listSkills,
  enumerateSkillFiles,
  readSkillFile,
  writeSkillFile,
  writeSkillFileBinary,
  createSkillFile,
  createSkill,
  deleteSkillFile,
  deleteSkill,
  SkillFileMtimeConflictError,
  SkillFileAlreadyExistsError,
  SkillAlreadyExistsError,
  type SkillEntry,
  type SkillFileEntry,
  skillFileUrl,
} from "@/api/skills-api";
import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import { fileViewNeverNeedsContent, type BinaryDraft } from "./file-viewers/registry";
import type { TabState } from "./IdentityFileTab";
import { bumpModalOpen } from "@/lib/freeze-diag";
import {
  isModelInvocationDisabled,
  setModelInvocationDisabled,
} from "./skill-frontmatter";
import {
  INSTANCE_HOST_ID,
  listInstanceWide,
  previewPromote,
  promote,
  promoteConfirmText,
  removeInstanceWide,
  type InstanceWideList,
} from "@/api/instance-wide-api";
import { InstanceWideChip, InstanceWideSyncStatus } from "./InstanceWideStatus";

// SkillsEditorModal — cross-host cross-skill multi-file editor.
//
// Modal-unification 2026-09-29 (revised 2026-09-30 UAT):
//   - Shell: canonical <Modal>. Blocking (proper backdrop + focus trap)
//     with document.body as the portal target — the earlier "blocking=false"
//     kept the composer typable but rendered the modal without any dim
//     behind it, making the whole surface easy to lose against live chat
//     content. Same retirement as IdentityModal 2026-09-30.
//   - Head: two rows.
//     Row 1: title="Skills" (static — this modal browses across skills,
//     not scoped to one) + "+ New" action + close X via <ModalHead>
//     (matches ScheduledAgentsModal's header "+ New").
//     Row 2 (picker bar sibling directly under head): host select
//     (hidden on single-host installs), skill select, delete-skill
//     Trash (only when a skill is picked).
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
// hidden Save slot). Delete-skill lives in the picker row's ⋮ skill menu.
//
// Close/draft-guard: any dirty tab AND !savingRef → window.confirm.
// savingRef bypasses on save-success and delete-skill closes.
//
// "Slash command only" (⋮ skill menu item, + a "slash only" chip when on) toggles
// `disable-model-invocation: true` in SKILL.md's frontmatter. It reads from
// the SKILL.md tabData entry (prefetched on skill pick even when SKILL.md
// isn't the first tab) and writes immediately — no foot Save. Disabled while
// SKILL.md has unsaved edits, since the write bumps mtime and SkillFileTab
// reseeds its draft from the new content on an mtime change.
//
// All D-XX behaviors preserved: host auto-select, skill list refetch on
// host change, file list refetch on skill change, per-tab lazy load,
// mtime-409 conflict-reload, native window.confirm/prompt for
// create/delete flows, Phase 113 New-skill / New-file split.

const SKILL_MD = "SKILL.md";

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
  // Unsaved binary edits per tab (PDF annotations). The PDF viewer remounts
  // on tab switch, so these can't survive one — switching away asks first.
  const [binaryDrafts, setBinaryDrafts] = useState<Map<string, BinaryDraft>>(new Map());
  const [saving, setSaving] = useState(false);
  const [togglingInvocation, setTogglingInvocation] = useState(false);
  const savingRef = useRef(false);
  // Instance-wide section: skills whose master copy lives in the app. When
  // one is picked, every file call goes to INSTANCE_HOST_ID instead of the
  // selected host. Non-admins see them read-only.
  const [instanceWide, setInstanceWide] = useState<InstanceWideList | null>(null);
  const [selectedIsInstance, setSelectedIsInstance] = useState(false);
  const apiHostId = selectedIsInstance ? INSTANCE_HOST_ID : selectedHostId;
  const iwItems = instanceWide?.items ?? [];
  const isAdmin = instanceWide?.isAdmin ?? false;
  const selectedIwItem = selectedIsInstance
    ? iwItems.find((i) => i.name === selectedSkillName) ?? null
    : null;
  const readOnly = selectedIsInstance && !isAdmin;
  // The host list includes instance-wide skills (they sit in the same folder
  // on disk); this window shows them only in the instance-wide section.
  const hostSkills = useMemo(() => {
    if (skills.status !== "ready") return [];
    const iwNames = new Set(iwItems.map((i) => i.name));
    return skills.data.filter((s) => !iwNames.has(s.name));
  }, [skills, iwItems]);

  const refreshInstanceWide = useCallback(async (): Promise<InstanceWideList> => {
    try {
      const list = await listInstanceWide("skill");
      setInstanceWide(list);
      return list;
    } catch {
      const empty = { isAdmin: false, items: [] };
      setInstanceWide(empty);
      return empty;
    }
  }, []);

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
      setSelectedIsInstance(false);
      setInstanceWide(null);
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

  useEffect(() => {
    if (open) void refreshInstanceWide();
  }, [open, refreshInstanceWide]);

  // Fetch skills list when host changes.
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setSkills({ status: "loading" });
    setSelectedSkillName(null);
    setSelectedIsInstance(false);
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
    if (apiHostId == null || selectedSkillName == null) {
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
    enumerateSkillFiles(apiHostId, selectedSkillName)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        if (entries.length > 0) setActiveTab(entries[0].path);
        // The invocation toggle reads SKILL.md. When it's the first tab the
        // lazy-load effect below fetches it; otherwise prefetch it here.
        if (entries.some((e) => e.path === SKILL_MD) && entries[0].path !== SKILL_MD) {
          readSkillFile(apiHostId, selectedSkillName, SKILL_MD)
            .then((result) => {
              if (cancelled) return;
              setTabData((prev) =>
                prev.has(SKILL_MD)
                  ? prev
                  : new Map(prev).set(SKILL_MD, {
                      status: "ready",
                      data: {
                        content: result.content,
                        mtime: result.mtime,
                        isText: result.isText,
                      },
                    }),
              );
            })
            .catch(() => {
              // Toggle stays hidden; the tab's own lazy load surfaces errors.
            });
        }
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
  }, [apiHostId, selectedSkillName]);

  // Lazy-load content for the active tab.
  useEffect(() => {
    if (apiHostId == null || !selectedSkillName || !activeTab) return;
    if (tabData.has(activeTab)) return;
    let cancelled = false;
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
    readSkillFile(apiHostId, selectedSkillName, activeTab)
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
  }, [apiHostId, selectedSkillName, activeTab]);

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

  // Save handler — SkillFileTab-facing signature. Also called by foot Save.
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      if (apiHostId == null || selectedSkillName == null) return;
      try {
        const result = await writeSkillFile({
          hostId: apiHostId,
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
    [apiHostId, selectedSkillName],
  );

  // Foot Save — dispatches to active tab's save with tracked draft.
  const handleFootSave = useCallback(async () => {
    if (saving) return;
    if (!activeTab) return;
    const tab = tabData.get(activeTab);
    if (tab?.status !== "ready") return;
    const binary = binaryDrafts.get(activeTab);
    if (binary) {
      if (apiHostId == null || selectedSkillName == null) return;
      setSaving(true);
      savingRef.current = true;
      try {
        const bytes = await binary.getBytes();
        await writeSkillFileBinary(apiHostId!, selectedSkillName!, activeTab, bytes);
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
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [saving, activeTab, tabData, drafts, handleSave, binaryDrafts, apiHostId, selectedSkillName]);

  const skillMdState = tabData.get(SKILL_MD);
  const skillMd = skillMdState?.status === "ready" ? skillMdState.data : null;
  const modelInvocationDisabled = skillMd ? isModelInvocationDisabled(skillMd.content) : false;
  const skillMdDirty = dirtySet.has(SKILL_MD);

  const handleToggleModelInvocation = useCallback(
    async (disabled: boolean): Promise<void> => {
      if (!skillMd || skillMdDirty || togglingInvocation) return;
      setTogglingInvocation(true);
      try {
        await handleSave(
          SKILL_MD,
          setModelInvocationDisabled(skillMd.content, disabled),
          skillMd.mtime,
        );
      } catch (err) {
        window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
      } finally {
        setTogglingInvocation(false);
      }
    },
    [skillMd, skillMdDirty, togglingInvocation, handleSave],
  );

  const handleAddFile = useCallback(async (): Promise<void> => {
    if (apiHostId == null || selectedSkillName == null) return;
    const raw = window.prompt("New file name (relative to skill root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      await createSkillFile(apiHostId, selectedSkillName, relPath);
      const entries = await enumerateSkillFiles(apiHostId, selectedSkillName);
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
  }, [apiHostId, selectedSkillName]);

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
      if (apiHostId == null || selectedSkillName == null) return;
      if (!window.confirm(`Delete "${selectedSkillName}/${doomedPath}"? This can't be undone.`)) return;
      try {
        await deleteSkillFile(apiHostId, selectedSkillName, doomedPath);
        const entries = await enumerateSkillFiles(apiHostId, selectedSkillName);
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
    [apiHostId, selectedSkillName, activeTab],
  );

  const handleDeleteSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null || selectedIsInstance) return;
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
  }, [selectedHostId, selectedSkillName, selectedIsInstance]);

  const clearSkillSelection = useCallback(() => {
    setSelectedSkillName(null);
    setSelectedIsInstance(false);
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    setDrafts(new Map());
    setDirtySet(new Set());
  }, []);

  // "Make instance-wide…" (admins, host skills): preview the size and any
  // same-name skills on other hosts, confirm with a blanket warning, promote,
  // then show the skill in the instance-wide section.
  const handlePromote = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null || selectedIsInstance) return;
    const name = selectedSkillName;
    try {
      const preview = await previewPromote("skill", name, selectedHostId);
      if (preview.tooLarge) {
        window.alert(
          `"${name}" is too big to make instance-wide (${preview.files} files). Clean up its folder first.`,
        );
        return;
      }
      if (!window.confirm(promoteConfirmText("skill", name, preview))) return;
      savingRef.current = true;
      await promote("skill", name, selectedHostId);
      await refreshInstanceWide();
      const entries = await listSkills(selectedHostId);
      setSkills({ status: "ready", data: entries });
      clearSkillSelection();
      setSelectedSkillName(name);
      setSelectedIsInstance(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't make it instance-wide");
    } finally {
      savingRef.current = false;
    }
  }, [selectedHostId, selectedSkillName, selectedIsInstance, refreshInstanceWide, clearSkillSelection]);

  // "Remove from every host…" (admins, instance-wide skills).
  const handleRemoveInstance = useCallback(async (): Promise<void> => {
    if (!selectedIsInstance || selectedSkillName == null) return;
    const name = selectedSkillName;
    const count = selectedIwItem?.hostCount ?? 0;
    if (
      !window.confirm(
        `Remove the instance-wide skill "${name}"? Its folder will be deleted from ${count} host${count === 1 ? "" : "s"}. This can't be undone.`,
      )
    )
      return;
    try {
      savingRef.current = true;
      await removeInstanceWide("skill", name);
      await refreshInstanceWide();
      clearSkillSelection();
      if (selectedHostId != null) {
        setSkills({ status: "ready", data: await listSkills(selectedHostId) });
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't remove it");
    } finally {
      savingRef.current = false;
    }
  }, [selectedIsInstance, selectedSkillName, selectedIwItem, selectedHostId, refreshInstanceWide, clearSkillSelection]);

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
    dirtySet.has(activeTab) &&
    !readOnly;

  const showHostSelect = flatHosts.length > 1;
  const skillPickerDisabled =
    iwItems.length === 0 && (selectedHostId == null || skills.status !== "ready");
  const hostLabel =
    flatHosts.find((h) => Number(h.id) === selectedHostId)?.name ?? "This host";

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="editor"
      // `container` prop still accepted for test injection (see .test.tsx —
      // 20 sites pass document.body explicitly). Default undefined portals
      // to document.body naturally.
      container={container ?? undefined}
      data-testid="skills-editor-modal"
    >
      <ModalHead
        title="Skills"
        subtitle="Skills are instructions available to all of your agents that you can invoke on-demand. After you create one, you can ask an agent to invoke it, or invoke it yourself using a slash command like /name-of-skill"
        closeTestId="skills-editor-modal-close"
        actions={
          <button
            type="button"
            onClick={() => {
              void handleNewSkill();
            }}
            disabled={selectedHostId == null}
            aria-label="+ New skill"
            title="New skill"
            data-testid="skills-editor-modal-new-skill"
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] cursor-pointer",
              "bg-[hsla(var(--pv-id-hue),65%,55%,0.30)]",
              "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.42)]",
              "border border-[hsla(var(--pv-id-hue),75%,70%,0.45)]",
              "text-[#fbf5e8]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Plus size={12} /> New
          </button>
        }
      />

      {/* Picker row — sits directly under the head. Host select (multi-host
          only) and skill select share the width; when a skill is picked, a
          "slash only" chip (if set) and a ⋮ menu holding "Slash command
          only" + "Delete skill…". Never wraps, so the selects stay legible
          on phones. */}
      <div
        className={cn(
          "px-4 py-2.5 flex flex-row items-center gap-2 flex-shrink-0",
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
              "flex-1 min-w-0 text-[12px] px-2 py-1 rounded-md outline-none cursor-pointer",
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
          onChange={(e) => {
            const name = e.target.value ? e.target.value : null;
            setSelectedSkillName(name);
            setSelectedIsInstance(name != null && iwItems.some((i) => i.name === name));
          }}
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
          {iwItems.length > 0 && (
            <optgroup label="Instance-wide — every host" style={OPTION_STYLE}>
              {iwItems.map((i) => (
                <option key={`iw:${i.name}`} value={i.name} style={OPTION_STYLE}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          )}
          {skills.status === "ready" &&
            (iwItems.length > 0 ? (
              hostSkills.length > 0 && (
                <optgroup label={hostLabel} style={OPTION_STYLE}>
                  {hostSkills.map((s) => (
                    <option key={s.name} value={s.name} style={OPTION_STYLE}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )
            ) : (
              hostSkills.map((s) => (
                <option key={s.name} value={s.name} style={OPTION_STYLE}>
                  {s.name}
                </option>
              ))
            ))}
        </select>
        {selectedIsInstance && <InstanceWideChip />}
        {selectedIwItem && <InstanceWideSyncStatus item={selectedIwItem} />}
        {selectedSkillName != null && skillMd != null && modelInvocationDisabled && (
          <span
            title={"Only a /" + selectedSkillName + " slash command invokes this skill"}
            data-testid="skills-editor-modal-slash-only-chip"
            className={cn(
              "shrink-0 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full",
              "text-[hsla(var(--pv-id-hue),75%,80%,1)] bg-[hsla(var(--pv-id-hue),55%,40%,0.35)]",
              "border border-[hsla(var(--pv-id-hue),70%,60%,0.4)]",
            )}
          >
            slash only
          </span>
        )}
        {selectedSkillName != null && (
          <RowKebabMenu
            ariaLabel="Skill options"
            testId="skills-editor-modal-skill-menu"
            triggerClassName="size-7"
            items={[
              // Items render from the start (disabled while their data
              // loads) so nothing pops in above "Delete skill…" and shifts it
              // under a fast click.
              ...(!readOnly
                ? [
                    {
                      label: "Slash command only",
                      hint: skillMd == null
                        ? "Loading…"
                        : skillMdDirty
                          ? "Save or discard your SKILL.md edits first"
                          : "Agents won't use it on their own — only /" +
                            selectedSkillName +
                            " will",
                      checked: modelInvocationDisabled,
                      disabled: skillMd == null || skillMdDirty || togglingInvocation,
                      testId: "skills-editor-modal-disable-model-invocation",
                      onClick: () => {
                        void handleToggleModelInvocation(!modelInvocationDisabled);
                      },
                    },
                  ]
                : []),
              // Admin status is unknown until the instance-wide list loads;
              // hold the slot (disabled) until then.
              ...(!selectedIsInstance && (isAdmin || instanceWide == null)
                ? [
                    {
                      label: "Make instance-wide…",
                      hint: instanceWide == null
                        ? "Loading…"
                        : "Keep one copy of this skill in step on every host",
                      disabled: instanceWide == null,
                      separatorBefore: !readOnly,
                      testId: "skills-editor-modal-promote-skill",
                      onClick: () => {
                        void handlePromote();
                      },
                    },
                  ]
                : []),
              ...(selectedIsInstance
                ? isAdmin
                  ? [
                      {
                        label: "Remove from every host…",
                        danger: true,
                        separatorBefore: !readOnly,
                        testId: "skills-editor-modal-remove-instance-skill",
                        onClick: () => {
                          void handleRemoveInstance();
                        },
                      },
                    ]
                  : [
                      {
                        label: "Managed instance-wide — only an admin can change it",
                        disabled: true,
                        testId: "skills-editor-modal-instance-readonly",
                        onClick: () => {},
                      },
                    ]
                : [
                    {
                      label: "Delete skill…",
                      danger: true,
                      separatorBefore: true,
                      testId: "skills-editor-modal-delete-skill",
                      onClick: () => {
                        void handleDeleteSkill();
                      },
                    },
                  ]),
            ]}
          />
        )}
      </div>

      {/* Layered branches for the skill/file state. Once ready + a
          skill is picked + files loaded, we drop into <ModalSidebar>
          (vertical file list + editor pane). */}
      {!selectedIsInstance && selectedHostId == null ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Pick a host to load its skills.
        </ModalBody>
      ) : !selectedIsInstance && skills.status === "loading" ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Loading skills…
        </ModalBody>
      ) : !selectedIsInstance && skills.status === "error" ? (
        <ModalBody className="flex items-center justify-center text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load skills: {skills.error}
        </ModalBody>
      ) : !selectedIsInstance &&
        skills.status === "ready" &&
        hostSkills.length === 0 &&
        iwItems.length === 0 ? (
        <ModalBody className="flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-2 text-sm text-center px-6">
          <div>No skills on this host.</div>
          <div className="text-xs opacity-70">Nothing to edit here yet.</div>
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
            Use &quot;+ Add file&quot; in the sidebar to create one.
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
          rowTestId="skills-editor-modal-file-strip"
          testIdPrefix="skills-editor-modal-tab"
          trailing={
            readOnly ? undefined : (
            <button
              type="button"
              onClick={() => {
                void handleAddFile();
              }}
              data-testid="skills-editor-modal-add-file"
              className={cn(
                "w-full flex items-center gap-1 px-2 py-1.5 rounded text-[12px] cursor-pointer",
                "text-[hsla(var(--pv-id-hue),30%,90%,0.75)] hover:text-[#fbf5e8]",
                "hover:bg-white/[0.05] transition-colors duration-150",
              )}
            >
              <Plus size={12} /> Add file
            </button>
            )
          }
        >
          <div
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
            data-testid="skills-editor-modal-body"
          >
            {activeTab != null && (
              <SkillFileTab
                state={tabData.get(activeTab) ?? { status: "loading" }}
                onSave={(content, expectedMtime) =>
                  handleSave(activeTab, content, expectedMtime)
                }
                onRequestDelete={
                  readOnly
                    ? undefined
                    : () => {
                        void handleDeleteFile(activeTab);
                      }
                }
                filename={activeTab}
                hideSaveButton={true}
                onDraftContentChange={handleDraftContentChange(activeTab)}
                onDraftChange={handleDraftDirtyChange(activeTab)}
                onBinaryDraftChange={handleBinaryDraftChange(activeTab)}
                mediaUrl={
                  apiHostId != null && selectedSkillName != null
                    ? skillFileUrl(apiHostId, selectedSkillName, activeTab, { inline: true })
                    : undefined
                }
                downloadUrl={
                  apiHostId != null && selectedSkillName != null
                    ? skillFileUrl(apiHostId, selectedSkillName, activeTab)
                    : undefined
                }
              />
            )}
          </div>
        </ModalSidebar>
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
