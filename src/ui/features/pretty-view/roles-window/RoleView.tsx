// The roles window's role view. What the role IS sits at the top — picture
// (tap to upload a new one), name, its one-line description (edited in
// place), a quiet line of facts, and the two cosmetic buttons (colour,
// voice). What it's made of sits underneath in tabs: role file, skills,
// files, and git when the folder holds a repo. Actions (start a
// conversation, sharing, archive) are in the ⋯ menu.
//
// Non-admins looking at a shared role get all of it view-only.
//
// Every per-field save merges one frontmatter key into the server-echoed
// role file and writes the whole file back (see role-frontmatter.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, Clock, Folder, GitBranch, Mic, Pencil, Plus, Users, Zap } from "lucide-react";
import { listScheduledAgents } from "@/api/scheduled-agents-api";
import { ModalFoot, ModalHead, ModalTabs } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
  kitAlert,
  kitConfirm,
  kitPrompt,
} from "@/components/kit";
import { RowGestures, RowKebabMenu, type RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import { roleAvatarUrl, updateRoleAvatarByName, type RoleSummary } from "@/api/identities-api";
import { getRoleFileByName, updateRoleFileByName } from "@/api/claude-session-api";
import {
  previewPromote,
  promote,
  promoteConfirmText,
  removeInstanceWide,
  type InstanceWideItem,
} from "@/api/instance-wide-api";
import { confirmAndArchiveRole, confirmAndDeleteRoleSkill } from "./role-actions";
import {
  createRoleSkill,
  listRoleSkills,
  RoleSkillAlreadyExistsError,
  type RoleSkillEntry,
} from "@/api/role-skills-api";
import { roleDisplayName } from "@/lib/role-display-name";
import { stripFrontmatter } from "@/lib/strip-frontmatter";
import { slugifyRoleName } from "@/lib/slugify-role-name";
import type { Identity } from "@/api/identities-api";
import type { TabState } from "../IdentityFileTab";
import { MarkdownEditor } from "../MarkdownEditor";
import { ColorPicker } from "../pickers/ColorPicker";
import { VoicePicker } from "../pickers/VoicePicker";
import { useVoiceLabel } from "../pickers/useVoiceCatalog";
import WorkspaceTab from "../WorkspaceTab";
import GitTab from "../GitTab";
import { useHasGitRepos } from "../use-has-git-repos";
import { InstanceWideSyncStatus } from "../InstanceWideStatus";
import {
  cleanRoleDescription,
  mergeRoleFrontmatter,
  readRoleFrontmatterValue,
  ROLE_DESCRIPTION_MAX,
  type RoleFrontmatterPatch,
} from "./role-frontmatter";
import { roleAvatarColor, roleHue, type EscapeHandler, type LeaveGuard } from "./RolesWindow";

export type RoleTab = "role" | "skills" | "files" | "git";

const TABS = [
  { value: "role", label: "Role file", Icon: Users },
  { value: "skills", label: "Skills", Icon: Zap },
  { value: "files", label: "Files", Icon: Folder },
] as const;
const GIT_TAB = { value: "git", label: "Git", Icon: GitBranch } as const;

const PROSE = [
  "prose prose-sm max-w-none dark:prose-invert",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "prose-pre:my-2 prose-pre:p-2 prose-pre:rounded",
  "prose-pre:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
  "prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
  "prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
  "prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]",
  "prose-code:border prose-code:border-white/[0.06]",
].join(" ");


function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function withBust(url: string, bust: number | null): string {
  return bust === null ? url : `${url}${url.includes("?") ? "&" : "?"}v=${bust}`;
}

export interface RoleViewProps {
  hostId: number;
  hostName: string;
  role: RoleSummary;
  /** Shared ("instance-wide"), as the window worked it out. */
  shared: boolean;
  isAdmin: boolean;
  instanceWideItem: InstanceWideItem | null;
  agents: Identity[];
  tab: RoleTab;
  onTabChange: (tab: RoleTab) => void;
  onBack: () => void;
  /** Opens one of the role's skills one level deeper (its description goes
   *  along for the skill's header). */
  onOpenSkill: (skill: string, description?: string) => void;
  onRoleChanged: (patch: Partial<RoleSummary>) => void;
  onHueDraft: (hue: number | null) => void;
  onSharingChanged: () => void;
  onArchived: () => void;
  onStartConversation: () => void | Promise<void>;
  /** The "N scheduled tasks" shortcut: the window closes and the scheduled
   *  tasks window opens on this role's tasks. */
  onOpenScheduledTasks: () => void | Promise<void>;
  registerGuard: (g: LeaveGuard | null) => void;
  registerEscape: (h: EscapeHandler | null) => void;
}

export function RoleView({
  hostId,
  role,
  shared,
  isAdmin,
  instanceWideItem,
  agents,
  tab,
  onTabChange,
  onBack,
  onOpenSkill,
  onRoleChanged,
  onHueDraft,
  onSharingChanged,
  onArchived,
  onStartConversation,
  onOpenScheduledTasks,
  registerGuard,
  registerEscape,
}: RoleViewProps): JSX.Element {
  const name = role.name;
  const label = roleDisplayName(name, role.displayName);
  const readOnly = shared && !isAdmin;

  // ── Role file ────────────────────────────────────────────────────────────
  const [roleFile, setRoleFile] = useState<TabState<string>>({ status: "loading" });
  const roleFileRef = useRef(roleFile);
  roleFileRef.current = roleFile;
  useEffect(() => {
    let cancelled = false;
    getRoleFileByName({ roleName: name, hostId })
      .then(({ markdown }) => !cancelled && setRoleFile({ status: "ready", data: markdown }))
      .catch((e: unknown) => {
        if (!cancelled) setRoleFile({ status: "error", error: e instanceof Error ? e.message : "Connection failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [name, hostId]);
  const fileReady = roleFile.status === "ready";
  const description = fileReady ? readRoleFrontmatterValue(roleFile.data, "description") : null;

  /** Merge frontmatter keys into the current file and save it. Saves run one
   *  at a time, each merging into the file the previous one wrote, so quick
   *  successive changes (description, then colour, then voice) all land. */
  const frontmatterQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [frontmatterSaving, setFrontmatterSaving] = useState(0);
  const saveFrontmatter = useCallback(
    (patch: RoleFrontmatterPatch, cleared?: string[]): Promise<string> => {
      const run = async (): Promise<string> => {
        const current = roleFileRef.current;
        if (current.status !== "ready") throw new Error("The role file hasn't loaded yet — try again in a moment.");
        const merged = mergeRoleFrontmatter(current.data, patch, cleared ? new Set(cleared) : undefined);
        const res = await updateRoleFileByName(name, hostId, merged);
        const next: TabState<string> = { status: "ready", data: res.markdown };
        roleFileRef.current = next;
        setRoleFile(next);
        return res.markdown;
      };
      setFrontmatterSaving((n) => n + 1);
      const result = frontmatterQueue.current.then(run, run);
      frontmatterQueue.current = result.catch(() => {});
      void result.finally(() => setFrontmatterSaving((n) => n - 1)).catch(() => {});
      return result;
    },
    [name, hostId],
  );

  // ── Role file editing state (declared early: while the file is being
  //    edited, the look and description are locked — each of those saves
  //    rewrites the file, and the editor's draft would put the old values
  //    back on Save).
  const [editing, setEditing] = useState(false);
  const lookLocked = readOnly || !fileReady || editing;

  // ── Description (edited in place) ────────────────────────────────────────
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const descCancelled = useRef(false);
  const startDescEdit = (): void => {
    if (lookLocked) return;
    descCancelled.current = false;
    setDescDraft(description ?? "");
    setDescEditing(true);
  };
  const finishDescEdit = async (): Promise<void> => {
    if (!descEditing) return;
    setDescEditing(false);
    if (descCancelled.current) return;
    const next = cleanRoleDescription(descDraft);
    if (next === (description ?? "")) return;
    try {
      await saveFrontmatter(next ? { description: next } : {}, next ? undefined : ["description"]);
      console.info({ operation: "role_description_saved", hostId, roleName: name, empty: next === "" });
      onRoleChanged({ description: next });
    } catch (err) {
      void kitAlert({ title: "Couldn't save the description", body: err instanceof Error ? err.message : undefined });
    }
  };

  // ── Colour + voice ───────────────────────────────────────────────────────
  const [hueDraft, setHueDraft] = useState(roleHue(role));
  const committedHue = useRef(roleHue(role));
  const [colorOpen, setColorOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voice, setVoice] = useState(role.voice ?? "");
  const voiceLabel = useVoiceLabel(voice);
  const colorRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onHueDraft(hueDraft);
  }, [hueDraft, onHueDraft]);

  const commitHue = useCallback(async (): Promise<void> => {
    const next = hueDraft;
    if (next === committedHue.current) return;
    const prev = committedHue.current;
    committedHue.current = next;
    try {
      await saveFrontmatter({ colorHue: next });
      onRoleChanged({ colorHue: next });
    } catch (err) {
      committedHue.current = prev;
      setHueDraft(prev);
      void kitAlert({ title: "Couldn't save the colour", body: err instanceof Error ? err.message : undefined });
    }
  }, [hueDraft, saveFrontmatter, onRoleChanged]);

  const closeColor = useCallback((): void => {
    setColorOpen(false);
    void commitHue();
  }, [commitHue]);

  const saveVoice = async (next: string): Promise<void> => {
    const prev = voice;
    setVoice(next);
    try {
      await saveFrontmatter(next ? { voice: next } : {}, next ? undefined : ["voice"]);
      onRoleChanged({ voice: next || undefined });
    } catch (err) {
      setVoice(prev);
      void kitAlert({ title: "Couldn't save the voice", body: err instanceof Error ? err.message : undefined });
    }
  };

  // Click outside a pop-over closes it (the colour commits on close).
  useEffect(() => {
    if (!colorOpen && !voiceOpen) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (colorOpen && colorRef.current && !colorRef.current.contains(t)) closeColor();
      if (voiceOpen && voiceRef.current && !voiceRef.current.contains(t)) setVoiceOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colorOpen, voiceOpen, closeColor]);

  // ── Picture ──────────────────────────────────────────────────────────────
  const [avatarBust, setAvatarBust] = useState<number | null>(null);
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const onAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { filename } = await updateRoleAvatarByName(hostId, name, file);
      await saveFrontmatter({ avatar: filename });
      setAvatarBust(Date.now());
      onRoleChanged({ avatar: filename });
    } catch (err) {
      void kitAlert({ title: "Couldn't upload the picture", body: err instanceof Error ? err.message : undefined });
    }
  };

  // ── Role file editing ────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The rich editor can re-serialise the file once more after it loads.
  // Until the user types or clicks in it, a change is the editor settling,
  // not an edit: it becomes the baseline instead of marking the file dirty.
  const [baseline, setBaseline] = useState("");
  const interacted = useRef(false);
  const onEditorChange = useCallback((md: string) => {
    if (!interacted.current) setBaseline(md);
    setDraft(md);
  }, []);
  const dirty = editing && fileReady && draft !== baseline;

  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      kitConfirm({
        title: "Discard your changes?",
        body: "Your edits to the role file haven't been saved.",
        confirmLabel: "Discard",
        destructive: true,
      }),
    [],
  );

  const cancelEdit = useCallback(async (): Promise<void> => {
    if (dirty && !(await confirmDiscard())) return;
    setEditing(false);
    setSaveError(null);
  }, [dirty, confirmDiscard]);

  const saveRoleFile = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await updateRoleFileByName(name, hostId, draft);
      setRoleFile({ status: "ready", data: res.markdown });
      setEditing(false);
      console.info({ operation: "role_file_saved", hostId, roleName: name });
      onRoleChanged({ description: readRoleFrontmatterValue(res.markdown, "description") });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Leaving with unsaved role-file edits asks first.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    registerGuard(async () => (dirtyRef.current ? confirmDiscard() : true));
    return () => registerGuard(null);
  }, [registerGuard, confirmDiscard]);

  // Esc: close a pop-over, cancel the description edit, or leave editing.
  const escState = useRef({ colorOpen, voiceOpen, descEditing, editing, closeColor, cancelEdit });
  escState.current = { colorOpen, voiceOpen, descEditing, editing, closeColor, cancelEdit };
  useEffect(() => {
    registerEscape(() => {
      const s = escState.current;
      if (s.colorOpen) {
        s.closeColor();
        return true;
      }
      if (s.voiceOpen) {
        setVoiceOpen(false);
        return true;
      }
      if (s.descEditing) {
        descCancelled.current = true;
        setDescEditing(false);
        return true;
      }
      if (s.editing) {
        void s.cancelEdit();
        return true;
      }
      return false;
    });
    return () => registerEscape(null);
  }, [registerEscape]);

  // ── Scheduled tasks (count for the shortcut) ─────────────────────────────
  // null = not known (loading, or the list failed); the shortcut still works.
  const [taskCount, setTaskCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTaskCount(null);
    listScheduledAgents()
      .then((items) => {
        if (!cancelled) setTaskCount(items.filter((i) => i.hostId === hostId && i.roles.includes(name)).length);
      })
      .catch((e: unknown) => {
        console.warn("[RoleView] scheduled-task count failed", {
          roleName: name,
          hostId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, name]);
  const scheduledTasksLabel =
    taskCount === null
      ? "Scheduled tasks"
      : taskCount === 0
        ? "No scheduled tasks"
        : `${taskCount} scheduled task${taskCount === 1 ? "" : "s"}`;

  // ── Skills ───────────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<TabState<RoleSkillEntry[]>>({ status: "loading" });
  const deleteSkillFromList = async (skill: string): Promise<void> => {
    if (!(await confirmAndDeleteRoleSkill({ hostId, roleName: name, skill }))) return;
    setSkills((prev) =>
      prev.status === "ready" ? { status: "ready", data: prev.data.filter((s) => s.name !== skill) } : prev,
    );
  };
  useEffect(() => {
    if (tab !== "skills") return;
    let cancelled = false;
    setSkills({ status: "loading" });
    listRoleSkills(hostId, name)
      .then((entries) => {
        if (!cancelled) setSkills({ status: "ready", data: [...entries].sort((a, b) => a.name.localeCompare(b.name)) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setSkills({ status: "error", error: err instanceof Error ? err.message : "Failed to load skills" });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, hostId, name]);

  // Same two steps as the Skills window's New skill: a name, then the
  // description agents read when they load the role (required).
  const newSkill = async (): Promise<void> => {
    const rawName = await kitPrompt({
      title: "New skill",
      label: "Name",
      body: "Something this role does again and again, written down once.",
      placeholder: "Weekly report",
      confirmLabel: "Next",
      validate: (v) => (slugifyRoleName(v.trim()).length === 0 ? "Use at least one letter or number." : null),
    });
    if (rawName == null) return;
    const displayName = rawName.trim();
    const slug = slugifyRoleName(displayName);
    const rawDesc = await kitPrompt({
      title: `Describe "${displayName}"`,
      body: "What it does and when an agent should use it — agents holding the role read this when they load.",
      label: "Description",
      confirmLabel: "Create skill",
      validate: (v) => (v.trim().length === 0 ? "A description is required." : null),
    });
    if (rawDesc == null) return;
    let created: { slug: string };
    try {
      created = await createRoleSkill(hostId, name, slug, rawDesc.trim());
    } catch (err) {
      void kitAlert({
        title: "Couldn't create the skill",
        body:
          err instanceof RoleSkillAlreadyExistsError
            ? `This role already has a skill called "${slug}".`
            : err instanceof Error
              ? err.message
              : undefined,
      });
      return;
    }
    console.info({ operation: "role_skill_created", hostId, roleName: name, skill: created.slug });
    onOpenSkill(created.slug, rawDesc.trim());
  };

  // ── Menu actions ─────────────────────────────────────────────────────────
  const handlePromote = async (): Promise<void> => {
    try {
      const preview = await previewPromote("role", name, hostId);
      if (preview.tooLarge) {
        void kitAlert({ title: `${label} is too big to make instance-wide`, body: `It has ${preview.files} files. Clean up its folder first.` });
        return;
      }
      if (
        !(await kitConfirm({
          title: `Make ${label} instance-wide?`,
          body: promoteConfirmText("role", name, preview).replace(/^[^\n]*\n\n?/, ""),
          confirmLabel: "Make instance-wide",
        }))
      )
        return;
      await promote("role", name, hostId);
      console.info({ operation: "role_promoted", hostId, roleName: name });
      onRoleChanged({ instanceWide: true });
      onSharingChanged();
    } catch (err) {
      void kitAlert({ title: "Couldn't make it instance-wide", body: err instanceof Error ? err.message : undefined });
    }
  };

  const handleDeleteEverywhere = async (): Promise<void> => {
    const count = instanceWideItem?.hostCount ?? 0;
    if (
      !(await kitConfirm({
        title: `Delete ${label} from every host?`,
        body: `It will be deleted from ${count === 0 ? "every host" : count === 1 ? "the 1 host it's on" : `all ${count} hosts it's on`}, along with anything agents saved in it there. Nobody will have it afterwards. This can't be undone.`,
        confirmLabel: "Delete everywhere",
        destructive: true,
      }))
    )
      return;
    try {
      await removeInstanceWide("role", name);
      console.info({ operation: "role_instance_wide_removed", hostId, roleName: name });
      onSharingChanged();
      onBack();
    } catch (err) {
      void kitAlert({ title: "Couldn't delete it", body: err instanceof Error ? err.message : undefined });
    }
  };

  const handleArchive = async (): Promise<void> => {
    if (await confirmAndArchiveRole({ hostId, name, label, agents })) onArchived();
  };

  const menuItems: RowKebabMenuItem[] = [
    {
      label: "Start a conversation",
      hint: "A new agent holding this role",
      onClick: () => void onStartConversation(),
      testId: "role-view-start-conversation",
    },
    ...(isAdmin
      ? [
          shared
            ? {
                label: "Delete from every host…",
                hint: "Nobody will have it afterwards",
                danger: true,
                separatorBefore: true,
                onClick: () => void handleDeleteEverywhere(),
                testId: "role-view-delete-everywhere",
              }
            : {
                label: "Make instance-wide…",
                hint: "Keep one copy in step on every host",
                separatorBefore: true,
                onClick: () => void handlePromote(),
                testId: "role-view-promote",
              },
        ]
      : []),
    shared
      ? {
          label: "Archive role…",
          hint: isAdmin ? "A shared role is deleted from every host instead" : "Only an admin can change a shared role",
          disabled: true,
          separatorBefore: true,
          testId: "role-view-archive",
        }
      : {
          label: "Archive role…",
          hint: agents.length ? `${plural(agents.length, "agent")} ${agents.length === 1 ? "holds" : "hold"} this role` : undefined,
          danger: true,
          separatorBefore: true,
          onClick: () => void handleArchive(),
          testId: "role-view-archive",
        },
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  const hasGit = useHasGitRepos({ kind: "role", roleSlug: name }, hostId, true);
  const facts = [
    agents.length === 0
      ? "No agents hold this role"
      : `${plural(agents.length, "agent")} ${agents.length === 1 ? "holds" : "hold"} this role`,
    // The machine isn't named (owner\'s call, 2026-10-22); a shared role still says
    // it's kept on every host.
    shared ? "on every host" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hero = (
    <div className="px-6 max-sm:px-5 pb-4 flex gap-[18px] max-sm:gap-3.5 items-center max-sm:items-start flex-shrink-0">
      <div className="relative shrink-0">
        {readOnly ? (
          <KitAvatar
            src={withBust(roleAvatarUrl(hostId, name), avatarBust)}
            fallback={label.charAt(0).toUpperCase()}
            color={roleAvatarColor(hueDraft)}
            size={76}
            data-testid="role-view-avatar"
          />
        ) : (
          <button
            type="button"
            onClick={() => avatarInput.current?.click()}
            disabled={lookLocked}
            title="Change picture"
            aria-label="Change picture"
            className="relative block rounded-full cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--k-acc)] focus-visible:outline-offset-2"
            data-testid="role-view-avatar-button"
          >
            <KitAvatar
              src={withBust(roleAvatarUrl(hostId, name), avatarBust)}
              fallback={label.charAt(0).toUpperCase()}
              color={roleAvatarColor(hueDraft)}
              size={76}
              data-testid="role-view-avatar"
            />
            <span className="absolute -right-0.5 -bottom-0.5 size-[26px] rounded-full bg-[var(--k-s3)] border-2 border-[var(--k-bg)] grid place-items-center text-[var(--k-t1)]">
              <Pencil className="size-3" aria-hidden="true" />
            </span>
          </button>
        )}
        <input
          ref={avatarInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void onAvatarPick(e)}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="text-[24px] max-sm:text-[21px] font-bold tracking-[-0.025em] truncate" aria-hidden="true">
          {label}
        </div>
        {description === null ? (
          <div className="h-[19px]" />
        ) : descEditing ? (
          <textarea
            autoFocus
            rows={2}
            maxLength={ROLE_DESCRIPTION_MAX}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => void finishDescEdit()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            placeholder="One line on what this role is for"
            aria-label="Description"
            className="k-input k-textarea !min-h-0 text-[13.5px]"
            data-testid="role-view-description-input"
          />
        ) : readOnly ? (
          <p
            className={`m-0 text-[13.5px] leading-[1.45] line-clamp-2 ${description ? "text-[var(--k-t2)]" : "italic text-[var(--k-t3)]"}`}
            data-testid="role-view-description"
          >
            {description || "No description"}
          </p>
        ) : (
          <button
            type="button"
            onClick={startDescEdit}
            title="Edit description"
            className="group self-start max-w-full inline-flex items-baseline gap-[7px] text-left text-[13.5px] leading-[1.45] cursor-pointer bg-transparent border-0 p-0"
            data-testid="role-view-description"
          >
            <span className={`line-clamp-2 ${description ? "text-[var(--k-t2)] group-hover:text-[var(--k-t1)]" : "italic text-[var(--k-t3)]"}`}>
              {description || "No description"}
            </span>
            <Pencil className="size-3 shrink-0 text-[var(--k-t3)] group-hover:text-[var(--k-t1)] relative top-px" aria-hidden="true" />
          </button>
        )}
        <div className="text-[12.5px] text-[var(--k-t3)] flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="role-view-facts">
          <span>{facts}</span>
          {/* A shortcut, not a second home: scheduled tasks live in the
              scheduled tasks window, which this opens on the role's tasks. */}
          <button
            type="button"
            onClick={() => void onOpenScheduledTasks()}
            className="inline-flex items-center gap-1 text-[var(--k-acc-text)] hover:underline cursor-pointer"
            title="Open Scheduled Tasks for this role"
            data-testid="role-view-scheduled-tasks"
          >
            <Clock className="size-3" aria-hidden="true" />
            {scheduledTasksLabel}
            <ChevronRight className="size-3" aria-hidden="true" />
          </button>
          {shared && isAdmin && instanceWideItem ? <InstanceWideSyncStatus item={instanceWideItem} /> : null}
        </div>
        {readOnly ? (
          <div className="text-[12.5px] text-[var(--k-t3)]" data-testid="role-view-readonly-note">
            Shared by an admin — only an admin can change it.
          </div>
        ) : null}
        <div className="relative mt-0.5 flex flex-wrap items-center gap-2" role="group" aria-label="Role look">
          <div ref={colorRef}>
            <KitButton
              size="sm"
              disabled={lookLocked}
              aria-expanded={colorOpen}
              onClick={() => (colorOpen ? closeColor() : (setVoiceOpen(false), setColorOpen(true)))}
              data-testid="role-view-color"
            >
              <span aria-hidden="true" className="inline-block size-3 rounded-full" style={{ background: `hsl(${hueDraft}, 55%, 48%)` }} />
              Colour
            </KitButton>
            {colorOpen && (
              <div
                role="dialog"
                aria-label="Colour"
                className="k-menu absolute left-0 top-[calc(100%+6px)] z-20 w-[300px] max-w-full !p-3 flex flex-col gap-2"
                data-testid="role-view-color-popover"
              >
                <div className="k-label">Colour</div>
                <ColorPicker value={hueDraft} onChange={setHueDraft} />
              </div>
            )}
          </div>
          <div ref={voiceRef}>
            <KitButton
              size="sm"
              disabled={lookLocked}
              aria-expanded={voiceOpen}
              onClick={() => {
                if (colorOpen) closeColor();
                setVoiceOpen((v) => !v);
              }}
              className="max-w-[220px]"
              data-testid="role-view-voice"
            >
              <Mic aria-hidden="true" />
              <span className="truncate">{voice ? voiceLabel : "Default voice"}</span>
            </KitButton>
            {voiceOpen && (
              <div
                role="dialog"
                aria-label="Voice"
                className="k-menu absolute left-0 top-[calc(100%+6px)] z-20 w-[300px] max-w-full !p-3 flex flex-col gap-1.5"
                data-testid="role-view-voice-popover"
              >
                <div className="k-label">Voice</div>
                <VoicePicker value={voice} onChange={(v) => void saveVoice(v)} ariaLabel="Voice" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const roleFilePane =
    roleFile.status === "loading" ? (
      <KitLoading lines={5} />
    ) : roleFile.status === "error" ? (
      <KitBanner tone="danger">Couldn&apos;t load the role file: {roleFile.error}</KitBanner>
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
          <MarkdownEditor filename="role.md" content={draft} onChange={onEditorChange} disabled={saving} />
        </div>
        {saveError && (
          <KitBanner tone="danger" className="mt-2">
            Save failed: {saveError}
          </KitBanner>
        )}
      </div>
    ) : stripFrontmatter(roleFile.data).trim() === "" ? (
      <KitEmpty title="The role file is empty." body={readOnly ? undefined : "Edit it to say what this role knows and how it works."} />
    ) : (
      <div className={PROSE} data-testid="role-view-role-file">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
        >
          {stripFrontmatter(roleFile.data)}
        </ReactMarkdown>
      </div>
    );

  const skillsPane =
    skills.status === "loading" ? (
      <KitLoading lines={3} />
    ) : skills.status === "error" ? (
      <KitBanner tone="danger">Couldn&apos;t load skills: {skills.error}</KitBanner>
    ) : skills.data.length === 0 ? (
      <KitEmpty
        icon={<Zap />}
        title="No skills yet"
        body="A role skill writes down how to do something this role does again and again. Every agent holding the role is told about it when it loads."
        action={
          readOnly ? undefined : (
            <KitButton variant="primary" size="sm" onClick={() => void newSkill()} data-testid="role-view-new-skill">
              <Plus /> New skill
            </KitButton>
          )
        }
      />
    ) : (
      <>
        <KitSettingsGroup note="How to do things this role does again and again. Every agent holding the role is told about them when it loads.">
          {skills.data.map((r) => (
            // Same row as the Skills window: the name as written, its
            // one-line description under it. Swipe left deletes (touch).
            <RowGestures
              key={r.name}
              swipe={readOnly ? undefined : { label: "Delete", onSwipe: () => deleteSkillFromList(r.name) }}
            >
              {(g) => (
                <KitSettingsRow
                  holdProps={g.holdProps}
                  label={r.name}
                  description={r.description}
                  truncate
                  onClick={() => onOpenSkill(r.name, r.description)}
                  data-testid={`role-view-skill-${r.name}`}
                >
                  {g.swipeAction}
                </KitSettingsRow>
              )}
            </RowGestures>
          ))}
        </KitSettingsGroup>
        {readOnly ? null : (
          <div className="mt-3.5">
            <KitButton variant="plain" size="sm" onClick={() => void newSkill()} data-testid="role-view-new-skill">
              <Plus /> New skill
            </KitButton>
          </div>
        )}
      </>
    );

  const footNote = shared && !readOnly ? "Changes go to every host." : null;

  return (
    <>
      <ModalHead
        title={<span className="sr-only">{label}</span>}
        closeTestId="roles-window-close"
        leading={
          <KitButton variant="plain" size="sm" onClick={onBack} data-testid="roles-window-back" data-modal-back="">
            <ChevronLeft /> Roles
          </KitButton>
        }
        actions={<RowKebabMenu items={menuItems} ariaLabel="Role options" testId="role-view-menu" />}
      />
      {hero}
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as RoleTab)} className="flex-1 min-h-0 flex flex-col">
        <ModalTabs
          tabs={hasGit ? [...TABS, GIT_TAB] : TABS}
          value={tab}
          onValueChange={(v) => onTabChange(v as RoleTab)}
          rowTestId="role-view-tabs"
          testIdPrefix="role-view-tab"
        />
        <TabsContent value="role" className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 border-t border-[var(--k-hair)]">
          {roleFilePane}
        </TabsContent>
        <TabsContent value="skills" className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 border-t border-[var(--k-hair)]">
          {skillsPane}
        </TabsContent>
        <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-[var(--k-hair)]">
          <WorkspaceTab
            target={{ kind: "role", roleSlug: name }}
            hostId={hostId}
            hue={hueDraft}
            hiddenNames={[`${name}.md`]}
            readOnly={readOnly}
            introCopy="Everything in this role's folder — the role file itself is on its own tab."
          />
        </TabsContent>
        {hasGit && (
          <TabsContent value="git" className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-[var(--k-hair)]">
            <GitTab
              target={{ kind: "role", roleSlug: name }}
              hostId={hostId}
              hue={hueDraft}
              introCopy="Git repos inside this role's folder and what's changed in each. Read-only."
            />
          </TabsContent>
        )}
      </Tabs>
      {tab === "role" && fileReady && !readOnly ? (
        <ModalFoot>
          {footNote ? <span className="flex-1 text-[12.5px] text-[var(--k-t3)] max-sm:hidden">{footNote}</span> : null}
          {editing ? (
            <>
              <KitButton disabled={saving} onClick={() => void cancelEdit()} data-testid="role-view-cancel-edit">
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                busy={saving}
                disabled={!dirty}
                onClick={() => void saveRoleFile()}
                data-testid="role-view-save"
              >
                {saving ? "Saving…" : "Save"}
              </KitButton>
            </>
          ) : (
            <KitButton
              // A details save in flight would land under the draft and be
              // put back by the editor's Save.
              disabled={frontmatterSaving > 0}
              onClick={() => {
                setDraft(roleFile.data);
                setBaseline(roleFile.data);
                interacted.current = false;
                setSaveError(null);
                setEditing(true);
              }}
              data-testid="role-view-edit"
            >
              <Pencil /> Edit
            </KitButton>
          )}
        </ModalFoot>
      ) : null}
    </>
  );
}
