import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, FileText, PanelLeft, Plus, User } from "lucide-react";
import { RowGestures, RowKebabMenu } from "@/features/pretty-conversations/RowKebabMenu";
import { Modal, ModalHead, ModalBody, ModalFoot, ModalSidebar, useModalFullscreen } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitCell,
  KitEmpty,
  KitLoading,
  KitMark,
  KitSearch,
  KitSegmented,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  kitAlert,
  kitConfirm,
  kitPrompt,
} from "@/components/kit";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listSkills,
  enumerateSkillFiles,
  readSkillFile,
  writeSkillFile,
  writeSkillFileBinary,
  createSkillFile,
  deleteSkillFile,
  deleteSkill,
  SkillFileMtimeConflictError,
  SkillFileAlreadyExistsError,
  SkillAlreadyExistsError,
  renameSkill,
  RenamedButEditsNotSavedError,
  type SkillEntry,
  type SkillFileEntry,
  skillFileUrl,
} from "@/api/skills-api";
import { slugifyRoleName } from "@/lib/slugify-role-name";
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import { fileViewNeverNeedsContent, type BinaryDraft } from "./file-viewers/registry";
import type { TabState } from "./IdentityFileTab";
import { bumpModalOpen } from "@/lib/freeze-diag";
import {
  frontmatterName,
  isModelInvocationDisabled,
  isUserInvocationDisabled,
  setModelInvocationDisabled,
  setUserInvocationDisabled,
} from "./skill-frontmatter";
import { refreshSkillActions, settleSkillActions } from "./skill-actions-store";
import {
  INSTANCE_HOST_ID,
  listInstanceWide,
  previewPromote,
  promote,
  promoteConfirmText,
  removeInstanceWide,
  type InstanceWideList,
} from "@/api/instance-wide-api";
import { InstanceWideSyncStatus } from "./InstanceWideStatus";
import { isBlockedSkillName, SKILL_NAME_REFUSED_MESSAGE } from "@/types/blocked-commands";
import { promptNewSkill, skillNameError } from "./new-skill-flow";

// SkillsEditorModal — the skills window (footer lightning bolt).
// Shape: .planning/campaigns/apple-ux/shape-skills-modal.md
//
// Two views in one modal:
//   - Library (no skill picked): every skill on the host in sections —
//     "Shared to every host" (admins), "Your skills", "Fleet-distributed —
//     read-only" (admins) — each row with a You and an Agents switch that
//     save at once (read-only rows show fixed marks). Search + All/You/Agents
//     filter with counts. At least one switch stays on per skill; a skill
//     already set to "nobody" on disk is flagged.
//   - Skill (picked): back to the library, name + description, ⋯ menu
//     (share to every host / remove / delete), the two settings written out,
//     then the editor opened on SKILL.md. The file list starts collapsed
//     behind an "N files" toggle; on a phone it stands in for the editor.
//
// Non-admins never see shared skills: the server leaves them out of the
// host list and the shared list. Every way out of a skill with unsaved
// edits (back, another file, Esc, X) asks first; the in-skill switches wait
// while SKILL.md has unsaved edits (they rewrite that file).

const SKILL_MD = "SKILL.md";

// The two "who can use it" switches. You = offered to the user (Skills menu
// and /name; off = `user-invocable: false`). Agents = agents use it on their
// own (off = `disable-model-invocation: true`). At least one stays on.
type InvocationSwitch = "you" | "agents";
type InvocationFlags = { you: boolean; agents: boolean };

function flagsOf(e: { userInvocable?: false; modelInvocable?: false }): InvocationFlags {
  return { you: e.userInvocable !== false, agents: e.modelInvocable !== false };
}

function applyInvocationSwitch(content: string, which: InvocationSwitch, on: boolean): string {
  return which === "you"
    ? setUserInvocationDisabled(content, !on)
    : setModelInvocationDisabled(content, !on);
}

type LibrarySection = "shared" | "own" | "distributed";
interface LibraryRow {
  name: string;
  description?: string;
  section: LibrarySection;
  /** Served from the shared master copy (hostId 0) rather than the host. */
  instance: boolean;
  readOnly: boolean;
  flags: InvocationFlags;
}
type LibraryFilter = "all" | "you" | "agents";

// The compose Skills menu lists only skills the user can run. A "You" flip
// changes that list — re-check until the host shows it (a shared skill gets
// there a moment after the save); an "Agents" flip only needs one refresh.
function refreshMenuAfterSwitch(hostId: number, skill: string, which: InvocationSwitch, on: boolean): void {
  if (which === "you") void settleSkillActions(hostId, skill, on);
  else void refreshSkillActions(hostId, "invocation-toggle");
}

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
  /** A skill on `defaultHostId` to open once the list loads. */
  initialSkillName?: string | null;
  container?: HTMLElement | null;
}

export default function SkillsEditorModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  initialSkillName = null,
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
  const selectedHostIdRef = useRef(selectedHostId);
  selectedHostIdRef.current = selectedHostId;
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
  // On a host that receives shared skills, the host list includes their
  // copies (same folder on disk); this window shows them only in the shared
  // section. Elsewhere a same-named skill is the user's own and stays here.
  const hostSkills = useMemo(() => {
    if (skills.status !== "ready") return [];
    return skills.data.filter((s) => !s.shared);
  }, [skills]);
  // Fleet-distributed skills (admins only — the backend leaves them out for
  // everyone else) get their own section and are always read-only: the
  // distributor overwrites them from the Skynet repo on every sweep.
  const ownSkills = useMemo(() => hostSkills.filter((s) => !s.distributed), [hostSkills]);
  const distributedSkills = useMemo(() => hostSkills.filter((s) => s.distributed), [hostSkills]);
  const selectedIsDistributed =
    !selectedIsInstance &&
    selectedSkillName != null &&
    distributedSkills.some((s) => s.name === selectedSkillName);
  const readOnly = (selectedIsInstance && !isAdmin) || selectedIsDistributed;

  // The instance-wide fetch can settle after the modal unmounts; don't set
  // state on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshInstanceWide = useCallback(async (): Promise<InstanceWideList> => {
    try {
      const list = await listInstanceWide("skill");
      if (mountedRef.current) setInstanceWide(list);
      return list;
    } catch {
      const empty = { isAdmin: false, items: [] };
      if (mountedRef.current) setInstanceWide(empty);
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

  // The skill to open once the host's list arrives — consumed by that load.
  const pendingSkillRef = useRef<{ hostId: number; skill: string } | null>(null);
  useEffect(() => {
    pendingSkillRef.current =
      open && initialSkillName != null && defaultHostId != null
        ? { hostId: defaultHostId, skill: initialSkillName }
        : null;
  }, [open, initialSkillName, defaultHostId]);

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
    if (defaultHostId != null) {
      console.warn(`[skills-editor] requested host not in picker hostId=${defaultHostId} skill=${pendingSkillRef.current?.skill ?? "-"}`);
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
    listSkills(selectedHostId, { includeDistributed: true })
      .then((entries) => {
        if (cancelled) return;
        setSkills({ status: "ready", data: entries });
        // Only on the host it was asked for — the picker may have landed elsewhere.
        const pending = pendingSkillRef.current;
        pendingSkillRef.current = null;
        const want = pending?.hostId === selectedHostId ? pending.skill : null;
        if (want != null && entries.some((e) => e.name === want)) {
          console.info(`[skills-editor] open-initial-skill hostId=${selectedHostId} skill=${want}`);
          setSelectedSkillName(want);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        pendingSkillRef.current = null;
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
        // A skill opens on its SKILL.md — almost always the only file anyone
        // touches; the rest wait behind the collapsed file list.
        const first = entries.some((e) => e.path === SKILL_MD) ? SKILL_MD : entries[0]?.path;
        if (first != null) setActiveTab(first);
        // The invocation switches read SKILL.md. When it's the opening tab the
        // lazy-load effect below fetches it; otherwise prefetch it here.
        if (entries.some((e) => e.path === SKILL_MD) && first !== SKILL_MD) {
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
    async (path: string, content: string, expectedMtime: number): Promise<boolean> => {
      // Resolves true when the content was written, false when it wasn't (no
      // skill picked, or a disk conflict the user resolved by reloading).
      if (apiHostId == null || selectedSkillName == null) return false;
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
          const shouldReload = await kitConfirm({
            title: "This file changed on disk",
            body: "It changed since you started editing. Reload it from disk? Your local edits will be lost.",
            confirmLabel: "Reload",
            destructive: true,
          });
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
            return false;
          }
          throw err;
        }
        throw err;
      }
      return true;
    },
    [apiHostId, selectedSkillName],
  );

  // Rename = move the skill's folder (the backend also rewrites SKILL.md's
  // `name:`). With `draft`, that SKILL.md draft rides along in the same
  // request — checked against the mtime it was loaded at before anything
  // moves — the path for a SKILL.md whose `name:` was edited.
  const performRename = useCallback(
    async (newName: string, draft: { content: string; expectedMtime: number } | null): Promise<void> => {
      if (selectedHostId == null || selectedSkillName == null || selectedIsInstance) return;
      const hostId = selectedHostId;
      const oldName = selectedSkillName;
      console.info(
        `[skills-editor] rename hostId=${hostId} from=${oldName} to=${newName} withDraft=${draft != null}`,
      );
      let renamed = false;
      try {
        await renameSkill(hostId, oldName, newName, draft ?? undefined);
        renamed = true;
      } catch (err) {
        renamed = err instanceof RenamedButEditsNotSavedError;
        console.info(`[skills-editor] rename-error hostId=${hostId} from=${oldName} to=${newName} renamed=${renamed}`);
        void kitAlert({
          title: renamed ? `Renamed to "${newName}"` : "Couldn't rename the skill",
          body:
            err instanceof SkillAlreadyExistsError
              ? `A skill named "${newName}" already exists on this host.`
              : err instanceof SkillFileMtimeConflictError
                ? "SKILL.md changed on disk since you opened it, so nothing was renamed. Copy your edits somewhere, reload the skill, and try again."
                : renamed
                  ? "But your SKILL.md edits couldn't be saved."
                  : err instanceof Error
                    ? err.message
                    : undefined,
        });
      }
      if (!renamed) return;
      try {
        setSkills({ status: "ready", data: await listSkills(hostId, { includeDistributed: true }) });
      } catch {
        // The list keeps its old rows; the selection below still opens the renamed skill.
      }
      // Re-opens the skill under its new name; the old folder's drafts are
      // either saved into it or were refused above.
      setSelectedSkillName(newName);
      void refreshSkillActions(hostId, "rename");
    },
    [selectedHostId, selectedSkillName, selectedIsInstance],
  );

  const handleRenameSkill = useCallback(async (): Promise<void> => {
    if (selectedSkillName == null) return;
    if (dirtySet.size > 0 || binaryDrafts.size > 0) {
      void kitAlert({ title: "Save or discard your edits first", body: "Renaming the skill reloads its files." });
      return;
    }
    const current = selectedSkillName;
    const raw = await kitPrompt({
      title: `Rename "${current}"`,
      body: "Its folder and the name in its SKILL.md change together, so /<name> changes too.",
      label: "New name",
      defaultValue: current,
      confirmLabel: "Rename",
      mono: true,
      // Its current name may predate the rule (e.g. a fleet skill); keeping
      // it is a no-op, not a refusal.
      validate: (v) => (slugifyRoleName(v.trim()) === current ? null : skillNameError(v)),
    });
    if (raw == null) return;
    const slug = slugifyRoleName(raw.trim());
    if (slug === current) return;
    await performRename(slug, null);
  }, [selectedSkillName, dirtySet, binaryDrafts, performRename]);

  // A SKILL.md whose `name:` was changed away from the folder is never saved
  // as is — the backend refuses it. Offer the real rename instead. A name
  // that already disagreed on disk (older skills) and wasn't touched saves
  // normally. Returns true when it handled the save (renamed, or refused
  // with an explanation).
  const handleSkillMdNameChange = useCallback(
    async (content: string, loaded: SkillFileTabData): Promise<boolean> => {
      if (selectedSkillName == null) return false;
      const name = frontmatterName(content);
      if (name === null || name === selectedSkillName) return false;
      if (name === frontmatterName(loaded.content)) return false;
      const slug = slugifyRoleName(name);
      if (slug !== name) {
        void kitAlert({
          title: `"${name}" can't be a skill name`,
          body: `Use lowercase letters, numbers and hyphens${slug ? ` (e.g. "${slug}")` : ""}.`,
        });
        return true;
      }
      if (isBlockedSkillName(slug)) {
        void kitAlert({ title: `"${name}" can't be a skill name`, body: SKILL_NAME_REFUSED_MESSAGE });
        return true;
      }
      if (selectedIsInstance) {
        void kitAlert({
          title: `The name has to stay "${selectedSkillName}"`,
          body: "Skills shared to every host can't be renamed.",
        });
        return true;
      }
      if ([...dirtySet].some((p) => p !== SKILL_MD) || binaryDrafts.size > 0) {
        void kitAlert({
          title: "Save or discard your other files' edits first",
          body: "Renaming the skill reloads them.",
        });
        return true;
      }
      if (
        !(await kitConfirm({
          title: `Rename the skill to "${name}"?`,
          body: `SKILL.md now names it "${name}", but its folder is "${selectedSkillName}" — the two always match. Cancel keeps your edits unsaved.`,
          confirmLabel: "Rename",
        }))
      )
        return true;
      await performRename(name, { content, expectedMtime: loaded.mtime });
      return true;
    },
    [selectedSkillName, selectedIsInstance, dirtySet, binaryDrafts, performRename],
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
        void kitAlert({ title: "Save failed", body: err instanceof Error ? err.message : undefined });
      } finally {
        // Saving keeps the modal open, so the close guard must apply again
        // to anything typed after this save.
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }
    const draft = drafts.get(activeTab) ?? tab.data.content;
    if (draft === tab.data.content) return;
    setSaving(true);
    savingRef.current = true;
    try {
      if (activeTab === SKILL_MD && (await handleSkillMdNameChange(draft, tab.data))) return;
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      void kitAlert({ title: "Save failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [saving, activeTab, tabData, drafts, handleSave, binaryDrafts, apiHostId, selectedSkillName, handleSkillMdNameChange]);

  const skillMdState = tabData.get(SKILL_MD);
  const skillMd = skillMdState?.status === "ready" ? skillMdState.data : null;
  const modelInvocationDisabled = skillMd ? isModelInvocationDisabled(skillMd.content) : false;
  const userInvocationDisabled = skillMd ? isUserInvocationDisabled(skillMd.content) : false;
  const skillMdDirty = dirtySet.has(SKILL_MD);

  // Mirror a skill's two settings into whichever list it came from, so the
  // library shows the change without a refetch.
  const patchListedFlags = useCallback(
    (name: string, instance: boolean, flags: InvocationFlags): void => {
      const apply = <T extends { name: string; userInvocable?: false; modelInvocable?: false }>(e: T): T => {
        if (e.name !== name) return e;
        const { userInvocable: _u, modelInvocable: _m, ...rest } = e;
        return {
          ...rest,
          ...(flags.you ? {} : { userInvocable: false as const }),
          ...(flags.agents ? {} : { modelInvocable: false as const }),
        } as T;
      };
      if (instance) {
        setInstanceWide((prev) => (prev ? { ...prev, items: prev.items.map(apply) } : prev));
      } else {
        setSkills((prev) => (prev.status === "ready" ? { status: "ready", data: prev.data.map(apply) } : prev));
      }
    },
    [],
  );

  // The library's switches: read the skill's SKILL.md, flip the one setting,
  // write it back. Optimistic in the list; reverted (with a note) on failure.
  const [libraryBusy, setLibraryBusy] = useState<Set<string>>(new Set());
  // `n` bumps on every refusal so the nudge replays each time.
  const [refused, setRefusedState] = useState<{ name: string; which: InvocationSwitch; n: number } | null>(null);
  const setRefused = useCallback((r: { name: string; which: InvocationSwitch } | null) => {
    setRefusedState((prev) => (r == null ? null : { ...r, n: (prev?.n ?? 0) + 1 }));
  }, []);
  const handleLibrarySwitch = useCallback(
    async (row: LibraryRow, which: InvocationSwitch, on: boolean): Promise<void> => {
      const hostForRow = row.instance ? INSTANCE_HOST_ID : selectedHostId;
      if (hostForRow == null || row.readOnly || libraryBusy.has(row.name)) return;
      const next: InvocationFlags = { ...row.flags, [which]: on };
      if (!next.you && !next.agents) {
        console.info(`[skills-editor] library-switch refused (last one on) skill=${row.name} switch=${which}`);
        setRefused({ name: row.name, which });
        return;
      }
      setRefused(null);
      setLibraryBusy((prev) => new Set(prev).add(row.name));
      patchListedFlags(row.name, row.instance, next);
      try {
        const current = await readSkillFile(hostForRow, row.name, SKILL_MD);
        await writeSkillFile({
          hostId: hostForRow,
          skill: row.name,
          path: SKILL_MD,
          content: applyInvocationSwitch(current.content, which, on),
          expectedMtime: current.mtime,
        });
        console.info(
          `[skills-editor] library-switch hostId=${hostForRow} skill=${row.name} switch=${which} on=${on}`,
        );
        // The compose Skills menu shows only skills the user can run —
        // refresh its remembered list so the next open isn't stale.
        if (selectedHostId != null) refreshMenuAfterSwitch(selectedHostId, row.name, which, on);
      } catch (err) {
        patchListedFlags(row.name, row.instance, row.flags);
        console.warn(
          `[skills-editor] library-switch failed hostId=${hostForRow} skill=${row.name} switch=${which} err="${err instanceof Error ? err.message : String(err)}"`,
        );
        void kitAlert({
          title: `Couldn't change "${row.name}"`,
          body: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLibraryBusy((prev) => {
          const n = new Set(prev);
          n.delete(row.name);
          return n;
        });
      }
    },
    [selectedHostId, libraryBusy, patchListedFlags],
  );

  // The same two switches inside an open skill: they rewrite the SKILL.md
  // already loaded there, so they wait while it has unsaved edits.
  const handleToggleInvocation = useCallback(
    async (which: InvocationSwitch, on: boolean): Promise<void> => {
      if (!skillMd || skillMdDirty || togglingInvocation || selectedSkillName == null) return;
      const flags: InvocationFlags = {
        you: !userInvocationDisabled,
        agents: !modelInvocationDisabled,
        [which]: on,
      };
      if (!flags.you && !flags.agents) {
        console.info(`[skills-editor] invocation-toggle refused (last one on) skill=${selectedSkillName} switch=${which}`);
        setRefused({ name: selectedSkillName, which });
        return;
      }
      setRefused(null);
      setTogglingInvocation(true);
      try {
        console.info(
          `[skills-editor] invocation-toggle hostId=${apiHostId} skill=${selectedSkillName} switch=${which} on=${on}`,
        );
        const wrote = await handleSave(SKILL_MD, applyInvocationSwitch(skillMd.content, which, on), skillMd.mtime);
        // A disk conflict resolved by reloading wrote nothing — the list keeps
        // what's on disk.
        if (wrote) {
          patchListedFlags(selectedSkillName, selectedIsInstance, flags);
          if (selectedHostId != null) refreshMenuAfterSwitch(selectedHostId, selectedSkillName, which, on);
        }
      } catch (err) {
        void kitAlert({ title: "Save failed", body: err instanceof Error ? err.message : undefined });
      } finally {
        setTogglingInvocation(false);
      }
    },
    [
      skillMd,
      skillMdDirty,
      togglingInvocation,
      handleSave,
      apiHostId,
      selectedSkillName,
      selectedHostId,
      selectedIsInstance,
      userInvocationDisabled,
      modelInvocationDisabled,
      patchListedFlags,
    ],
  );

  // The open file's view is remounted per file, so its unsaved edits go with
  // it: ask first, then forget them. False = the user kept editing.
  const leaveActiveFile = useCallback(
    async (path: string): Promise<boolean> => {
      if (activeTab == null || path === activeTab) return true;
      if (!dirtySet.has(activeTab) && !binaryDrafts.has(activeTab)) return true;
      const ok = await kitConfirm({
        title: "Discard your changes?",
        body: `Your edits to ${activeTab} haven't been saved.`,
        confirmLabel: "Discard",
        destructive: true,
      });
      if (!ok) return false;
      const left = activeTab;
      setDirtySet((prev) => {
        const n = new Set(prev);
        n.delete(left);
        return n;
      });
      setDrafts((prev) => {
        const n = new Map(prev);
        n.delete(left);
        return n;
      });
      setBinaryDrafts((prev) => {
        const n = new Map(prev);
        n.delete(left);
        return n;
      });
      return true;
    },
    [activeTab, dirtySet, binaryDrafts],
  );

  const handleAddFile = useCallback(async (): Promise<void> => {
    if (apiHostId == null || selectedSkillName == null) return;
    const raw = await kitPrompt({
      title: "New file",
      label: "File name",
      body: "Relative to the skill's folder, e.g. scripts/run.sh",
      placeholder: "notes.md",
      confirmLabel: "Create",
      mono: true,
    });
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      await createSkillFile(apiHostId, selectedSkillName, relPath);
      const entries = await enumerateSkillFiles(apiHostId, selectedSkillName);
      setFiles({ status: "ready", data: entries });
      // Created either way; it opens unless the user keeps editing this one.
      if (await leaveActiveFile(relPath)) setActiveTab(relPath);
    } catch (err) {
      const msg =
        err instanceof SkillFileAlreadyExistsError
          ? `A file named "${relPath}" already exists in this skill.`
          : err instanceof Error
          ? `Couldn't create "${relPath}": ${err.message}`
          : `Couldn't create "${relPath}".`;
      void kitAlert({ title: "Couldn't create the file", body: msg });
    }
  }, [apiHostId, selectedSkillName, leaveActiveFile]);

  // New-skill handler — the shared name → description questions (also behind
  // the composer Skills menu's "New skill…"), then the new skill opens.
  const handleNewSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null) return;
    const slug = await promptNewSkill(selectedHostId, { source: "skills-editor" });
    if (slug == null) return;
    try {
      const entries = await listSkills(selectedHostId, { includeDistributed: true });
      setSkills({ status: "ready", data: entries });
    } catch (err) {
      console.warn(`[skills-editor] list-after-create failed hostId=${selectedHostId}`, err instanceof Error ? err.message : err);
    }
    setSelectedSkillName(slug);
  }, [selectedHostId]);

  const handleDeleteFile = useCallback(
    async (doomedPath: string): Promise<void> => {
      if (apiHostId == null || selectedSkillName == null) return;
      if (
        !(await kitConfirm({
          title: `Delete "${doomedPath}"?`,
          body: `This removes ${selectedSkillName}/${doomedPath}. This can't be undone.`,
          confirmLabel: "Delete",
          destructive: true,
        }))
      )
        return;
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
        void kitAlert({ title: "Couldn't delete the file", body: err instanceof Error ? err.message : undefined });
      }
    },
    [apiHostId, selectedSkillName, activeTab],
  );

  // Delete one of this host's own skills — from the open skill's ⋯ menu, or a
  // swipe on its row in the list (which leaves an open skill alone unless it
  // is the one deleted).
  const deleteHostSkill = useCallback(async (hostId: number, skillName: string): Promise<void> => {
    if (
      !(await kitConfirm({
        title: `Delete skill "${skillName}"?`,
        body: "This removes the skill folder and every file inside it. This can't be undone.",
        confirmLabel: "Delete skill",
        destructive: true,
      }))
    )
      return;
    try {
      savingRef.current = true; // bypass draft-guard on the state clear
      await deleteSkill(hostId, skillName);
      console.info({ operation: "skill_deleted", hostId, skill: skillName });
      const entries = await listSkills(hostId, { includeDistributed: true });
      // The user may have switched hosts while it ran — that list isn't this one.
      if (hostId === selectedHostIdRef.current) setSkills({ status: "ready", data: entries });
      if (hostId === selectedHostId && skillName === selectedSkillName && !selectedIsInstance) {
        setSelectedSkillName(null);
        setFiles({ status: "loading" });
        setActiveTab(null);
        setTabData(new Map());
        setDrafts(new Map());
        setDirtySet(new Set());
      }
      savingRef.current = false;
    } catch (err) {
      savingRef.current = false;
      void kitAlert({ title: "Couldn't delete the skill", body: err instanceof Error ? err.message : undefined });
    }
  }, [selectedHostId, selectedSkillName, selectedIsInstance]);

  const handleDeleteSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null || selectedIsInstance) return;
    await deleteHostSkill(selectedHostId, selectedSkillName);
  }, [selectedHostId, selectedSkillName, selectedIsInstance, deleteHostSkill]);

  const clearSkillSelection = useCallback(() => {
    setBinaryDrafts(new Map());
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
        void kitAlert({
          title: `"${name}" is too big to make instance-wide`,
          body: `It has ${preview.files} files. Clean up its folder first.`,
        });
        return;
      }
      if (
        !(await kitConfirm({
          title: `Make "${name}" instance-wide?`,
          // The text opens with the same question — the title carries it.
          body: promoteConfirmText("skill", name, preview).replace(/^[^\n]*\n\n?/, ""),
          confirmLabel: "Make instance-wide",
        }))
      )
        return;
      savingRef.current = true;
      await promote("skill", name, selectedHostId);
      await refreshInstanceWide();
      const entries = await listSkills(selectedHostId, { includeDistributed: true });
      setSkills({ status: "ready", data: entries });
      clearSkillSelection();
      setSelectedSkillName(name);
      setSelectedIsInstance(true);
    } catch (err) {
      void kitAlert({ title: "Couldn't make it instance-wide", body: err instanceof Error ? err.message : undefined });
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
      !(await kitConfirm({
        title: `Remove the instance-wide skill "${name}"?`,
        body: `Its folder will be deleted from ${count} host${count === 1 ? "" : "s"}. This can't be undone.`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    try {
      savingRef.current = true;
      await removeInstanceWide("skill", name);
      await refreshInstanceWide();
      clearSkillSelection();
      if (selectedHostId != null) {
        setSkills({ status: "ready", data: await listSkills(selectedHostId, { includeDistributed: true }) });
      }
    } catch (err) {
      void kitAlert({ title: "Couldn't remove it", body: err instanceof Error ? err.message : undefined });
    } finally {
      savingRef.current = false;
    }
  }, [selectedIsInstance, selectedSkillName, selectedIwItem, selectedHostId, refreshInstanceWide, clearSkillSelection]);

  // Close/draft-guard.
  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && (dirtySet.size > 0 || binaryDrafts.size > 0) && !savingRef.current) {
        const confirmed = await kitConfirm({
          title: "Discard your changes?",
          body: "Your edits to this skill haven't been saved.",
          confirmLabel: "Discard",
          destructive: true,
        });
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [dirtySet, binaryDrafts, onOpenChange],
  );


  // ── Navigation guards ──────────────────────────────────────────────────
  // Any way out of a skill with unsaved edits asks first.
  const hasUnsaved = dirtySet.size > 0 || binaryDrafts.size > 0;
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!hasUnsaved) return true;
    return kitConfirm({
      title: "Discard your changes?",
      body: "Your edits to this skill haven't been saved.",
      confirmLabel: "Discard",
      destructive: true,
    });
  }, [hasUnsaved]);

  const [filesOpen, setFilesOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const fullscreen = useModalFullscreen();

  useEffect(() => {
    if (open) return;
    setFilesOpen(false);
    setFileQuery("");
    setQuery("");
    setFilter("all");
    setRefused(null);
    setBinaryDrafts(new Map());
  }, [open]);

  const openSkill = useCallback((row: LibraryRow) => {
    console.info(`[skills-editor] open-skill hostId=${row.instance ? INSTANCE_HOST_ID : selectedHostId} skill=${row.name}`);
    setRefused(null);
    setFilesOpen(false);
    setFileQuery("");
    setSelectedSkillName(row.name);
    setSelectedIsInstance(row.instance);
  }, [selectedHostId]);

  const backToLibrary = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setRefused(null);
    setFilesOpen(false);
    setFileQuery("");
    setBinaryDrafts(new Map());
    clearSkillSelection();
  }, [confirmDiscard, clearSkillSelection]);

  const switchFile = useCallback(
    async (path: string) => {
      if (!(await leaveActiveFile(path))) return;
      setActiveTab(path);
      // On a phone the list stands in for the editor; picking a file returns to it.
      if (fullscreen) setFilesOpen(false);
    },
    [leaveActiveFile, fullscreen],
  );

  // ── Library rows ───────────────────────────────────────────────────────
  // Shared skills (everyone sees and uses them; only admins change them), the
  // host's own, and — admins only, the server leaves them out for everyone
  // else — fleet-distributed.
  const libraryRows = useMemo<LibraryRow[]>(() => {
    const rows: LibraryRow[] = [];
    for (const i of iwItems) {
      rows.push({ name: i.name, description: i.description, section: "shared", instance: true, readOnly: !isAdmin, flags: flagsOf(i) });
    }
    for (const s of ownSkills) {
      rows.push({ name: s.name, description: s.description, section: "own", instance: false, readOnly: false, flags: flagsOf(s) });
    }
    for (const s of distributedSkills) {
      rows.push({ name: s.name, description: s.description, section: "distributed", instance: false, readOnly: true, flags: flagsOf(s) });
    }
    return rows;
  }, [isAdmin, iwItems, ownSkills, distributedSkills]);

  // "You" counts what the Skills menu actually shows: fleet-distributed
  // skills stay out of it even though /name runs them.
  const inYourMenu = (r: LibraryRow) => r.flags.you && r.section !== "distributed";
  const counts = {
    all: libraryRows.length,
    you: libraryRows.filter(inYourMenu).length,
    agents: libraryRows.filter((r) => r.flags.agents).length,
  };
  const q = query.trim().toLowerCase();
  const visibleRows = libraryRows.filter(
    (r) =>
      (q === "" || r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "you" ? inYourMenu(r) : r.flags.agents)),
  );

  const selectedRow = selectedSkillName == null
    ? null
    : libraryRows.find((r) => r.name === selectedSkillName && r.instance === selectedIsInstance) ?? null;

  const activeTabState =
    activeTab != null ? tabData.get(activeTab) : undefined;
  const canFootSave =
    !saving &&
    activeTab != null &&
    activeTabState?.status === "ready" &&
    dirtySet.has(activeTab) &&
    !readOnly;

  const showHostSelect = flatHosts.length > 1;

  const switchFor = (row: LibraryRow, which: InvocationSwitch, inSkill: boolean): JSX.Element => {
    const on = row.flags[which];
    const what = which === "you" ? "You" : "Agents";
    if (row.readOnly) {
      const label =
        which === "you"
          ? on
            ? row.section === "distributed"
              ? "You can run it with /" + row.name + " — fleet-distributed skills stay out of the Skills button"
              : "In your Skills button"
            : "Not offered to you"
          : on
            ? "Agents can use it"
            : "Agents won't use it";
      return <KitMark on={on} label={label} data-testid={`skills-editor-modal-mark-${which}-${row.name}`} />;
    }
    const nudge = refused?.name === row.name && refused.which === which;
    return (
      <KitSwitch
        key={nudge ? `nudge-${refused.n}` : "still"}
        checked={on}
        onCheckedChange={(next) => {
          if (inSkill) void handleToggleInvocation(which, next);
          else void handleLibrarySwitch(row, which, next);
        }}
        disabled={inSkill ? skillMd == null || skillMdDirty || togglingInvocation : libraryBusy.has(row.name)}
        aria-label={`${what} — ${row.name}`}
        title={
          inSkill && skillMdDirty
            ? "Save or discard your edits first"
            : which === "you"
              ? "In your Skills button, and runs with /" + row.name
              : "Agents can use it on their own"
        }
        className={nudge ? "k-nudge" : undefined}
        data-testid={`skills-editor-modal-switch-${which}-${row.name}`}
      />
    );
  };

  const columns = [
    { label: "You", icon: <User />, hint: "In your Skills button, and runs with /name" },
    { label: "Agents", icon: <Bot />, hint: "Agents can use it on their own" },
  ];

  const renderRow = (row: LibraryRow): JSX.Element => {
    const nobody = !row.flags.you && !row.flags.agents;
    const refusedHere = refused?.name === row.name;
    // Swipe left deletes (touch) — only this host's own, editable skills.
    const swipe =
      row.section === "own" && !row.readOnly && !row.instance && selectedHostId != null
        ? { label: "Delete", onSwipe: () => deleteHostSkill(selectedHostId, row.name) }
        : undefined;
    return (
      <RowGestures key={`${row.section}:${row.name}`} swipe={swipe}>
        {(g) => (
      <KitSettingsRow
        holdProps={g.holdProps}
        label={row.name}
        description={
          refusedHere ? (
            <span className="k-row-warn">One of these has to stay on — a skill nobody can use would just sit there.</span>
          ) : nobody ? (
            <span className="k-row-warn" data-testid={`skills-editor-modal-nobody-${row.name}`}>Nobody can use this</span>
          ) : (
            row.description
          )
        }
        truncate
        onClick={() => openSkill(row)}
        openLabel={`Open ${row.name}`}
        control={
          <>
            <KitCell>{switchFor(row, "you", false)}</KitCell>
            <KitCell>{switchFor(row, "agents", false)}</KitCell>
          </>
        }
        data-testid={`skills-editor-modal-row-${row.name}`}
      >
        {g.swipeAction}
      </KitSettingsRow>
        )}
      </RowGestures>
    );
  };

  const section = (key: LibrarySection, title: string, note?: string): JSX.Element | null => {
    const rows = visibleRows.filter((r) => r.section === key);
    if (rows.length === 0) return null;
    return (
      <KitSettingsGroup
        title={title}
        note={note}
        columns={columns}
        chevronSpace
        data-testid={`skills-editor-modal-section-${key}`}
      >
        {rows.map(renderRow)}
      </KitSettingsGroup>
    );
  };

  // ── Library view ───────────────────────────────────────────────────────
  const libraryView = (
    <>
      <ModalHead
        title="Skills"
        // Hidden on a phone, where the host picker and New skill crowd it.
        subtitle={<span className="max-sm:hidden">Instructions your agents can use — or you can run with /name.</span>}
        closeTestId="skills-editor-modal-close"
        actions={
          <>
            {showHostSelect && (
              <KitSelect
                aria-label="Host"
                value={selectedHostId ?? ""}
                onChange={(e) => setSelectedHostId(e.target.value ? Number(e.target.value) : null)}
                data-testid="skills-editor-modal-host-select"
                className="w-auto max-w-[160px] h-8"
              >
                <option value="">Pick a host…</option>
                {flatHosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </KitSelect>
            )}
            <KitButton
              variant="primary"
              size="sm"
              onClick={() => {
                void handleNewSkill();
              }}
              disabled={selectedHostId == null}
              aria-label="New skill"
              title="New skill"
              data-testid="skills-editor-modal-new-skill"
            >
              <Plus /> <span className="max-sm:hidden">New skill</span>
            </KitButton>
          </>
        }
      />
      {selectedHostId == null ? (
        <ModalBody className="flex items-center justify-center">
          <KitEmpty title="Pick a host to load its skills." />
        </ModalBody>
      ) : skills.status === "loading" || instanceWide == null ? (
        // Wait for the shared list too: until it's in, shared skills would
        // show up as the host's own (and a flip would write the host copy).
        <ModalBody>
          <KitLoading label="Loading skills…" />
        </ModalBody>
      ) : skills.status === "error" ? (
        <ModalBody>
          <KitBanner tone="danger">Couldn&apos;t load skills: {skills.error}</KitBanner>
        </ModalBody>
      ) : libraryRows.length === 0 ? (
        <ModalBody className="flex items-center justify-center">
          <KitEmpty
            title="No skills on this host yet."
            body="A skill is a set of instructions your agents can pick up when it fits, or you can run yourself with /name. Make one with New skill."
          />
        </ModalBody>
      ) : (
        <>
          <div className="px-6 max-sm:px-5 pb-3 flex flex-row flex-wrap items-center gap-2.5 flex-shrink-0">
            <KitSearch
              value={query}
              onValueChange={setQuery}
              placeholder="Search skills"
              aria-label="Search skills"
              wrapperClassName="flex-1 min-w-[200px]"
              data-testid="skills-editor-modal-search"
            />
            <KitSegmented<LibraryFilter>
              aria-label="Show"
              value={filter}
              onValueChange={setFilter}
              testIdPrefix="skills-editor-modal-filter"
              options={[
                { value: "all", label: `All ${counts.all}` },
                { value: "you", label: `You ${counts.you}`, Icon: User },
                { value: "agents", label: `Agents ${counts.agents}`, Icon: Bot },
              ]}
            />
          </div>
          <ModalBody className="pt-1" data-testid="skills-editor-modal-library">
            {section(
              "shared",
              "Shared to every host",
              isAdmin
                ? "One copy, kept in step on every host. Changes here reach every host."
                : "One copy, kept in step on every host by an admin. Use them like your own; only an admin can change them.",
            )}
            {section("own", "Your skills")}
            {section(
              "distributed",
              "Fleet-distributed — read-only",
              "Installed on every machine from the Skynet repo — change them there. They run with /name but stay out of your Skills button.",
            )}
            {visibleRows.length === 0 ? <KitEmpty title="No skills match." /> : null}
          </ModalBody>
        </>
      )}
    </>
  );

  // ── Skill view ─────────────────────────────────────────────────────────
  const fileCount = files.status === "ready" ? files.data.length : 0;
  const filesToggle = (
    <KitButton
      size="sm"
      onClick={() => {
        setFileQuery("");
        setFilesOpen((o) => !o);
      }}
      aria-pressed={filesOpen}
      aria-expanded={filesOpen}
      title={filesOpen ? "Hide the file list" : "Show every file in this skill"}
      data-variant={filesOpen ? "plain" : undefined}
      data-testid="skills-editor-modal-files-toggle"
    >
      <PanelLeft /> {fileCount === 1 ? "Files" : `${fileCount} files`}
    </KitButton>
  );

  const fq = fileQuery.trim().toLowerCase();
  // Top-level files first (SKILL.md leading), then each folder's files —
  // folder headings only group correctly when no top-level file follows one.
  const listedFiles =
    files.status === "ready"
      ? files.data
          .filter((f) => fq === "" || f.path.toLowerCase().includes(fq))
          .map((f, i) => ({ f, i, rank: f.path === SKILL_MD ? 0 : f.path.includes("/") ? 2 : 1 }))
          .sort((a, b) => a.rank - b.rank || a.i - b.i)
          .map(({ f }) => f)
      : [];
  const fileTabs = listedFiles.map((f) => {
    const slash = f.path.lastIndexOf("/");
    return {
      value: f.path,
      label: slash < 0 ? f.path : f.path.slice(slash + 1),
      Icon: FileText,
      group: slash < 0 ? undefined : f.path.slice(0, slash) + "/",
    };
  });
  // The list shows only on demand. On a phone it stands in for the editor
  // while open (the editor stays mounted underneath, so no draft is lost),
  // and picking any file — even the open one — goes back to the editor.
  const fileDrill = {
    fullscreen,
    drilled: !filesOpen,
    drillIn: () => setFilesOpen(false),
    back: () => setFilesOpen(false),
  };

  const editor = activeTab != null && (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-4 py-3" data-testid="skills-editor-modal-body">
      <SkillFileTab
        key={`${selectedIsInstance ? "iw" : "host"}:${selectedSkillName}:${activeTab}`}
        state={tabData.get(activeTab) ?? { status: "loading" }}
        onSave={async (content, expectedMtime) => {
          const loaded = tabData.get(activeTab);
          if (
            activeTab === SKILL_MD &&
            loaded?.status === "ready" &&
            (await handleSkillMdNameChange(content, loaded.data))
          )
            return;
          await handleSave(activeTab, content, expectedMtime);
        }}
        onRequestDelete={
          readOnly
            ? undefined
            : () => {
                void handleDeleteFile(activeTab);
              }
        }
        filename={activeTab}
        readOnly={readOnly}
        hideSaveButton={true}
        onDraftContentChange={handleDraftContentChange(activeTab)}
        onDraftChange={handleDraftDirtyChange(activeTab)}
        onBinaryDraftChange={handleBinaryDraftChange(activeTab)}
        leading={
          <>
            {filesToggle}
            <span className="truncate text-[13px] font-semibold text-[var(--k-t1)]" data-testid="skills-editor-modal-current-file">
              {activeTab}
            </span>
          </>
        }
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
    </div>
  );

  const fileList = (
    <ModalSidebar
      tabs={fileTabs}
      value={activeTab ?? ""}
      onValueChange={(v) => {
        void switchFile(v);
      }}
      drill={fileDrill}
      listHidden={!filesOpen}
      hideDrillBack
      width={232}
      rowTestId="skills-editor-modal-file-strip"
      testIdPrefix="skills-editor-modal-tab"
      header={
        <>
          {fullscreen ? <div className="flex items-center gap-2 pb-2">{filesToggle}</div> : null}
          {fileCount > 10 ? (
            <KitSearch
              value={fileQuery}
              onValueChange={setFileQuery}
              placeholder="Find a file"
              aria-label="Find a file"
              data-testid="skills-editor-modal-file-search"
            />
          ) : null}
        </>
      }
      trailing={
        readOnly ? undefined : (
          <KitButton
            variant="plain"
            size="sm"
            full
            onClick={() => {
              void handleAddFile();
            }}
            data-testid="skills-editor-modal-add-file"
          >
            <Plus /> Add file
          </KitButton>
        )
      }
    >
      {editor}
    </ModalSidebar>
  );

  const nobodyInSkill = skillMd != null && modelInvocationDisabled && userInvocationDisabled;
  const settingsStrip =
    selectedRow == null ? null : selectedRow.readOnly ? (
      <KitBanner tone="info" data-testid="skills-editor-modal-readonly-banner">
        {selectedRow.section === "distributed"
          ? "Fleet-distributed — installed on every machine from the Skynet repo. Change it there; here it's view-only."
          : "Shared to every host and kept in step by an admin — use it like your own; only an admin can change it."}
      </KitBanner>
    ) : (
      <div className="flex flex-row flex-wrap items-center gap-x-5 gap-y-2.5">
        <label className="flex items-center gap-2.5 text-[13.5px] text-[var(--k-t2)]">
          {switchFor(
            { ...selectedRow, flags: { you: !userInvocationDisabled, agents: !modelInvocationDisabled } },
            "you",
            true,
          )}
          <User className="size-[15px] opacity-80" aria-hidden="true" />
          In my Skills button
        </label>
        <label className="flex items-center gap-2.5 text-[13.5px] text-[var(--k-t2)]">
          {switchFor(
            { ...selectedRow, flags: { you: !userInvocationDisabled, agents: !modelInvocationDisabled } },
            "agents",
            true,
          )}
          <Bot className="size-[15px] opacity-80" aria-hidden="true" />
          Agents can use it
        </label>
        {selectedIwItem && isAdmin ? <InstanceWideSyncStatus item={selectedIwItem} /> : null}
        {skillMdDirty ? (
          <span className="text-[12.5px] text-[var(--k-t3)]">Save or discard your edits first</span>
        ) : refused?.name === selectedRow.name ? (
          <span className="k-row-warn text-[12.5px]">One of these has to stay on.</span>
        ) : nobodyInSkill ? (
          <span className="k-row-warn text-[12.5px]">Nobody can use this — turn one on.</span>
        ) : null}
      </div>
    );

  const skillMenu = selectedSkillName != null && (
    <RowKebabMenu
      ariaLabel="Skill options"
      testId="skills-editor-modal-skill-menu"
      items={[
        // Admin status is unknown until the shared list loads; hold the
        // slot (disabled) until then.
        ...(!selectedIsInstance && !selectedIsDistributed && (isAdmin || instanceWide == null)
          ? [
              {
                label: "Share to every host…",
                hint: instanceWide == null ? "Loading…" : "Keep one copy of this skill in step on every host",
                disabled: instanceWide == null,
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
                  testId: "skills-editor-modal-remove-instance-skill",
                  onClick: () => {
                    void handleRemoveInstance();
                  },
                },
              ]
            : []
          : selectedIsDistributed
            ? [
                {
                  label: "Managed by the fleet distributor — change it in the Skynet repo",
                  disabled: true,
                  testId: "skills-editor-modal-distributed-readonly",
                  onClick: () => {},
                },
              ]
            : [
                {
                  label: "Rename…",
                  hint: dirtySet.size > 0 ? "Save or discard your edits first" : undefined,
                  disabled: dirtySet.size > 0,
                  separatorBefore: isAdmin || instanceWide == null,
                  testId: "skills-editor-modal-rename-skill",
                  onClick: () => {
                    void handleRenameSkill();
                  },
                },
                {
                  label: "Delete skill…",
                  danger: true,
                  testId: "skills-editor-modal-delete-skill",
                  onClick: () => {
                    void handleDeleteSkill();
                  },
                },
              ]),
      ]}
    />
  );

  const skillView = (
    <>
      <ModalHead
        title={selectedSkillName ?? ""}
        subtitle={
          selectedRow?.description ? <span className="line-clamp-2">{selectedRow.description}</span> : undefined
        }
        closeTestId="skills-editor-modal-close"
        leading={
          <KitButton
            variant="plain"
            size="sm"
            onClick={() => {
              void backToLibrary();
            }}
            data-testid="skills-editor-modal-back"
            data-modal-back=""
          >
            <ChevronLeft /> Skills
          </KitButton>
        }
        actions={skillMenu}
      />
      {settingsStrip ? <div className="px-6 max-sm:px-5 pb-3 flex-shrink-0">{settingsStrip}</div> : null}
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
            title="This skill has no files."
            action={
              readOnly ? undefined : (
                <KitButton
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void handleAddFile();
                  }}
                  data-testid="skills-editor-modal-add-file"
                >
                  <Plus /> Add file
                </KitButton>
              )
            }
          />
        </ModalBody>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--k-hair)] pt-2">{fileList}</div>
      )}
      <ModalFoot>
        <KitButton
          onClick={() => {
            void handleOpenChange(false);
          }}
          disabled={saving}
          data-testid="skills-editor-modal-close-foot"
        >
          Close
        </KitButton>
        {readOnly ? null : (
          <KitButton
            variant="primary"
            onClick={() => {
              void handleFootSave();
            }}
            disabled={!canFootSave}
            busy={saving}
            data-testid="skills-editor-modal-save"
          >
            {saving ? "Saving…" : "Save"}
          </KitButton>
        )}
      </ModalFoot>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        void handleOpenChange(o);
      }}
      size="editor"
      // `container` prop still accepted for test injection.
      container={container ?? undefined}
      data-testid="skills-editor-modal"
    >
      {selectedSkillName == null ? libraryView : skillView}
    </Modal>
  );
}
