// IdentityModal — the agent window (opened from the task pill).
//
// apple-ux / shape-identity-modal: a sibling of the roles window. Who the
// agent is sits at the top — picture, name, its roles as links (each opens
// the roles window on that role), the task (edited in place), the projects
// it sits in (top level down), and one cosmetic button for its voice. What
// it's made of sits underneath in tabs: Agent file, Wake-ups, Files, plus Git
// when the workspace holds a repo and Desktop while its desktop runs.
//
// A wake-up, a new wake-up, a repo, a commit and a diff each open one level
// deeper in the same window: a stack of views, the back control and Esc go
// up exactly one level, Esc at the top closes. Leaving the agent file editor
// or a wake-up with unsaved changes by any route asks first.
//
// The Desktop tab grows the window (its height follows the desktop's shape)
// and shrinks the top to a small picture and the name.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlarmClock, AppWindow, ChevronLeft, Folder, GitBranch, Mic, Monitor, Pencil, User } from "lucide-react";
import { Modal, ModalFoot, ModalHead, ModalTabs, escBelongsElsewhere } from "@/components/modal";
import { KitBanner, KitButton, KitEmpty, KitInput, KitLoading, kitConfirm } from "@/components/kit";
import { Tabs, TabsContent } from "@/components/tabs";
import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange, refreshIdentities } from "@/state/identities-store";
import { useProjects } from "@/state/conversation-store";
import { projectLineage } from "@/state/project-lineage";
import { roleDisplayName } from "@/lib/role-display-name";
import { stripFrontmatter } from "@/lib/strip-frontmatter";
import { hasNeutralLook, identityRoles, identityTint } from "@/lib/identity-roles";
import { AvatarImage } from "@/components/avatar-image";
import { toast } from "sonner";
import { VoicePicker } from "./pickers/VoicePicker";
import { useVoiceLabel } from "./pickers/useVoiceCatalog";
import {
  openClaudeSessionSocket,
  type IdentityGetIdentityFilePayload,
  type IdentityIdentityFileEvent,
  type IdentityListWakeupsPayload,
  type IdentityWakeupsEvent,
  type IdentityUpdateWakeupPayload,
  type IdentityWakeupUpdatedEvent,
  type Wakeup,
  type IdentityUpdateIdentityFilePayload,
  type IdentityIdentityFileUpdatedEvent,
  type WakeupSpecWire,
  type IdentityCreateWakeupPayload,
  type IdentityWakeupCreatedEvent,
  type IdentityDeleteWakeupPayload,
  type IdentityWakeupDeletedEvent,
} from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import type { GitCommit } from "@/api/workspace-git-api";
import { cn } from "@/lib/utils";
import type { TabState } from "./IdentityFileTab";
import { MarkdownEditor } from "./MarkdownEditor";
import { WakeupsTab } from "./WakeupsTab";
import { WakeupView, type WakeupUpdates } from "./WakeupView";
import { sensorStatusUnreachable } from "@/api/sensor-status-types";
import WorkspaceTab from "./WorkspaceTab";
import { useGitReposAnswer } from "./use-has-git-repos";
import {
  AgentGitCommit,
  AgentGitDiff,
  AgentGitRepo,
  AgentGitRoot,
  useAgentGit,
  type GitDiffSource,
} from "./AgentGit";
import DesktopTab from "./DesktopTab";
import { AppsTab, conversationAppsFor } from "./AppsTab";
import { useAppTiles } from "@/state/app-tiles-store";
import { requestDesktopPane } from "@/shell/desktop-drag";
import { useDesktopRunning } from "./use-desktop-running";
import type { EscapeHandler, LeaveGuard } from "./roles-window/RolesWindow";
import { bumpModalOpen } from "@/lib/freeze-diag";

/** How often an open Wake-ups tab re-reads its list (sensors shape 2). */
const WAKEUPS_REFRESH_MS = 30_000;

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

/** A view one or more levels below the agent itself. */
type DeepView =
  | { view: "wakeup"; slug: string; title: string }
  | { view: "new-wakeup"; title: string }
  | { view: "git-repo"; repoPath: string; title: string }
  | { view: "git-commit"; repoPath: string; commit: GitCommit; title: string }
  | { view: "git-diff"; source: GitDiffSource; title: string; subtitle: string };

export function IdentityModal({
  open,
  onOpenChange,
  identity,
  hue,
  hostId,
  onOpenRoleModal,
  initialTab,
  desktopRunningHint = false,
  gitReposHint = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
  hue: number;
  hostId: number;
  /** Opens the roles window on one of the identity's roles (by slug). */
  onOpenRoleModal: (identity: Identity, roleName: string) => void;
  /** Tab to land on when the modal opens (the task pill's round buttons).
   *  Absent → the remembered tab, as before. Read at the open transition. */
  initialTab?: string;
  /** The live fleet-status desktop signal: when true, the Desktop tab shows
   *  from the first frame instead of waiting for the modal's own status check. */
  desktopRunningHint?: boolean;
  /** True when the caller already knows the workspace holds a repo (the
   *  unpushed-work button), so the Git tab shows from the first frame. */
  gitReposHint?: boolean;
}): JSX.Element {
  // A modal mounted already-open honors the requested tab too (the open
  // transition below handles every later open).
  const [activeTab, setActiveTab] = useState<string>(() => (open && initialTab) || "identity");
  const [stack, setStack] = useState<DeepView[]>([]);
  const deep = stack.length > 0 ? stack[stack.length - 1] : null;
  // Agent file editing (more below) — declared here so the open reset can clear it.
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Task (edited in place).
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<string>(identity.task ?? "");
  const [savingTask, setSavingTask] = useState(false);

  // Voice button + pop-over.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<string>(identity.voice ?? "");
  const voiceLabel = useVoiceLabel(identity.voice ?? "");
  const voiceRef = useRef<HTMLDivElement | null>(null);

  // Tab data — WS one-shot fetches.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  const [identityWakeupsState, setIdentityWakeupsState] = useState<TabState<Wakeup[]>>({ status: "loading" });
  // The open wake-up as last seen, and whether its view holds unsaved edits.
  const lastWakeup = useRef<Wakeup | undefined>(undefined);
  const [wakeupDirty, setWakeupDirty] = useState(false);
  // Bumped by every wake-up write so an older background refresh can't
  // overwrite the list that write returned (sensors shape 2 refresh).
  const wakeupsWriteGen = useRef(0);

  // Git tab only when the workspace actually holds a repo.
  const gitTarget = { kind: "identity" as const, identityKey: identity.identityKey };
  // The hint covers only the wait for the probe; once it answers, it decides.
  const gitReposAnswer = useGitReposAnswer(gitTarget, hostId, open);
  const hasGitRepos = gitReposAnswer ?? (open && gitReposHint);
  const git = useAgentGit(gitTarget, hostId);
  // Desktop tab only once the identity's virtual desktop is up.
  const desktopRunningPolled = useDesktopRunning(identity.identityKey, hostId, open);
  // The live hint latches for the modal session, like the poll does, so a
  // stream blip never pulls the Desktop tab out from under the user.
  const [desktopHintLatched, setDesktopHintLatched] = useState(false);
  if (open && desktopRunningHint && !desktopHintLatched) setDesktopHintLatched(true);
  if (!open && desktopHintLatched) setDesktopHintLatched(false);
  const desktopRunning = desktopRunningPolled || (open && (desktopRunningHint || desktopHintLatched));
  // While the user drives the desktop, Esc belongs to it, not to the modal.
  const [desktopControl, setDesktopControl] = useState(false);
  // Each open starts on the agent itself. Reopening on a remembered Desktop
  // tab would show an empty, large modal until the desktop status comes back
  // (it resets on close) — reopen on the agent file instead. Adjusted during
  // render so the first frame is right.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStack([]);
      // Never carried over from the last time the window was open — and
      // never reset while it's open (a task or voice change mid-edit must
      // not throw the draft away).
      setEditing(false);
      setSaveError(null);
      if (initialTab) setActiveTab(initialTab);
      else if (activeTab === "desktop") setActiveTab("identity");
    }
  }
  // The Apps tab shows only while this conversation has apps of its own
  // (same conditional shape as Git / Desktop).
  const allApps = useAppTiles();
  const conversationApps = conversationAppsFor(allApps, hostId, identity.identityKey);
  const hasApps = conversationApps.length > 0;
  const NAV_SECTIONS = [
    { value: "identity", label: "Agent file", Icon: User },
    { value: "identity-wakeups", label: "Wake-ups", Icon: AlarmClock },
    { value: "workspace", label: "Files", Icon: Folder },
    ...(hasApps ? [{ value: "apps", label: "Apps", Icon: AppWindow }] : []),
    ...(hasGitRepos ? [{ value: "git", label: "Git", Icon: GitBranch }] : []),
    ...(desktopRunning ? [{ value: "desktop", label: "Desktop", Icon: Monitor }] : []),
  ] as const;
  // The tab actually shown: a requested or remembered tab that isn't
  // available right now (e.g. the desktop stopped as the button was pressed)
  // falls back to the agent file instead of leaving an empty body.
  const shownTab = NAV_SECTIONS.some((t) => t.value === activeTab) ? activeTab : "identity";

  // ── Agent file editing ───────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  // The rich editor can re-serialise the file once more after it loads.
  // Until the user types or clicks in it, a change is the editor settling,
  // not an edit: it becomes the baseline instead of marking the file dirty.
  const [baseline, setBaseline] = useState("");
  const interacted = useRef(false);
  const onEditorChange = useCallback((md: string) => {
    if (!interacted.current) setBaseline(md);
    setDraft(md);
  }, []);
  const fileReady = identityFileState.status === "ready";
  const fileDirty = editing && fileReady && draft !== baseline;
  const fileDirtyRef = useRef(fileDirty);
  fileDirtyRef.current = fileDirty;

  const confirmDiscardFile = useCallback(
    (): Promise<boolean> =>
      kitConfirm({
        title: "Discard your changes?",
        body: "Your edits to the agent file haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      }),
    [],
  );

  /** Stop editing the agent file, asking first when it has unsaved edits. */
  const leaveFileEdit = useCallback(async (): Promise<boolean> => {
    if (fileDirtyRef.current && !(await confirmDiscardFile())) return false;
    fileDirtyRef.current = false;
    setEditing(false);
    setSaveError(null);
    return true;
  }, [confirmDiscardFile]);

  // ── Navigation ───────────────────────────────────────────────────────────
  // A deeper view registers its own leave guard (unsaved wake-up edits) and
  // may use Esc itself first.
  const guardRef = useRef<LeaveGuard | null>(null);
  const escapeRef = useRef<EscapeHandler | null>(null);
  const registerGuard = useCallback((g: LeaveGuard | null) => {
    guardRef.current = g;
  }, []);
  const registerEscape = useCallback((h: EscapeHandler | null) => {
    escapeRef.current = h;
  }, []);

  /** Leave the current view: true when nothing unsaved stands in the way. */
  const leave = useCallback(async (): Promise<boolean> => {
    if (stack.length === 0) return leaveFileEdit();
    const g = guardRef.current;
    if (g && !(await g())) return false;
    guardRef.current = null;
    escapeRef.current = null;
    return true;
  }, [stack.length, leaveFileEdit]);

  const push = useCallback(
    async (next: DeepView): Promise<void> => {
      if (!(await leave())) return;
      console.debug("[IdentityModal] nav", { identityKey: identity.identityKey, to: next.view, depth: stack.length + 1 });
      setStack((s) => [...s, next]);
    },
    [leave, identity.identityKey, stack.length],
  );

  const back = useCallback(async (): Promise<void> => {
    if (stack.length === 0) return;
    if (!(await leave())) return;
    setStack((s) => s.slice(0, -1));
  }, [stack.length, leave]);

  const handleOpenChange = useCallback(
    async (next: boolean): Promise<void> => {
      if (next) return onOpenChange(true);
      if (!(await leave())) return;
      onOpenChange(false);
    },
    [leave, onOpenChange],
  );

  const changeTab = useCallback(
    async (next: string): Promise<void> => {
      if (next === shownTab) return;
      if (shownTab === "identity" && !(await leaveFileEdit())) return;
      setActiveTab(next);
    },
    [shownTab, leaveFileEdit],
  );

  // Esc: a deeper view goes up one level; at the top it closes a pop-over,
  // leaves the agent file editor, or (falling through to the modal) closes.
  // While the user drives the desktop, Esc is the desktop's.
  const escState = useRef({ voiceOpen, editing, depth: stack.length, desktopControl });
  escState.current = { voiceOpen, editing, depth: stack.length, desktopControl };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const s = escState.current;
      if (s.desktopControl) return;
      if (escBelongsElsewhere(e)) return;
      const stop = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (escapeRef.current?.()) return stop();
      if (s.depth > 0) {
        stop();
        void back();
        return;
      }
      if (s.voiceOpen) {
        stop();
        setVoiceOpen(false);
        return;
      }
      if (s.editing) {
        stop();
        void leaveFileEdit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, back, leaveFileEdit]);

  // Initial fetch of identity file + wake-ups on modal open (two parallel
  // WS one-shot requests).
  useEffect(() => {
    if (!open || !identity.identityKey) return;

    setIdentityFileState({ status: "loading" });
    setIdentityWakeupsState({ status: "loading" });

    let cancelled = false;
    const artifactSockets: WebSocket[] = [];

    function openOneShot<Req extends { type: string }, Res extends { type: string }>(
      request: Req,
      expectedType: string,
      onSuccess: (data: Res) => void,
      onError: (err: string) => void,
    ): WebSocket {
      let responded = false;
      const sock = openClaudeSessionSocket();
      artifactSockets.push(sock);
      sock.onopen = () => {
        if (cancelled) return;
        try {
          sock.send(JSON.stringify(request));
        } catch {
          /* ignore */
        }
      };
      sock.onmessage = (event: MessageEvent<string>) => {
        if (cancelled || responded) return;
        try {
          const raw = JSON.parse(event.data) as { type?: string };
          if (raw.type !== expectedType) return;
          responded = true;
          onSuccess(raw as Res);
          try {
            sock.close();
          } catch {
            /* ignore */
          }
        } catch {
          /* ignore */
        }
      };
      const handleFail = () => {
        if (cancelled || responded) return;
        responded = true;
        onError("Connection failed");
      };
      sock.onerror = handleFail;
      sock.onclose = () => {
        if (!responded) handleFail();
      };
      return sock;
    }

    openOneShot<IdentityGetIdentityFilePayload, IdentityIdentityFileEvent>(
      { type: "identity:get-identity-file", identityKey: identity.identityKey, hostId },
      "identity:identity-file",
      (ev) => setIdentityFileState(ev.error ? { status: "error", error: ev.error } : { status: "ready", data: ev.markdown }),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
      { type: "identity:list-wakeups", identityKey: identity.identityKey, hostId },
      "identity:wakeups",
      (ev) => setIdentityWakeupsState(ev.error ? { status: "error", error: ev.error } : { status: "ready", data: ev.wakeups }),
      (e) => setIdentityWakeupsState({ status: "error", error: e }),
    );

    return () => {
      cancelled = true;
      for (const sock of artifactSockets) {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, identity.identityKey, hostId]);

  // Sensors shape 2: while the Wake-ups tab (or a wake-up opened from it) is
  // showing, quietly re-read the list every 30s so sensor status and
  // last-fired stay current. A failed refresh keeps the last list on screen
  // rather than flipping the tab to an error, but its sensors turn Unknown —
  // a stale Healthy must never linger. An open wake-up's drafts never reset.
  useEffect(() => {
    if (!open || activeTab !== "identity-wakeups" || !identity.identityKey) return;
    const identityKey = identity.identityKey;
    let cancelled = false;
    let inFlight = false;
    const markSensorsUnreachable = () =>
      setIdentityWakeupsState((prev) =>
        prev.status !== "ready"
          ? prev
          : {
              status: "ready",
              data: prev.data.map((w) => (w.sensor ? { ...w, sensor: sensorStatusUnreachable(w.sensor) } : w)),
            },
      );
    const handle = setInterval(() => {
      // One refresh at a time, and a refresh that started before a write
      // (save / toggle / create / delete) never overwrites that write's list.
      if (inFlight) return;
      inFlight = true;
      const genAtStart = wakeupsWriteGen.current;
      sendIdentityMutation<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
        { type: "identity:list-wakeups", identityKey, hostId },
        "identity:wakeups",
      )
        .finally(() => {
          inFlight = false;
        })
        .then((ev) => {
          if (cancelled || wakeupsWriteGen.current !== genAtStart) return;
          if (ev.error) {
            markSensorsUnreachable();
            return;
          }
          setIdentityWakeupsState((prev) => (prev.status === "loading" ? prev : { status: "ready", data: ev.wakeups }));
        })
        .catch(() => {
          if (!cancelled && wakeupsWriteGen.current === genAtStart) markSensorsUnreachable();
        });
    }, WAKEUPS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // sendIdentityMutation is a stable-in-behaviour local helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, identity.identityKey, hostId]);

  // Reset per-field drafts on open.
  useEffect(() => {
    if (!open) return;
    setTaskDraft(identity.task ?? "");
    setEditingTask(false);
    setVoiceOpen(false);
    setVoiceDraft(identity.voice ?? "");
  }, [open, identity.identityKey, identity.task, identity.voice]);

  // freeze-diag: bump the identity-modal open counter on each closed→open
  // transition so the periodic heartbeat can correlate modal usage with
  // resource growth. See src/ui/lib/freeze-diag.ts.
  useEffect(() => {
    if (open) bumpModalOpen("identity");
  }, [open]);

  // Click outside the voice pop-over closes it.
  useEffect(() => {
    if (!voiceOpen) return;
    function onDown(e: MouseEvent) {
      if (!voiceRef.current) return;
      if (voiceRef.current.contains(e.target as Node)) return;
      setVoiceOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [voiceOpen]);

  // One-shot WS mutation helper — used by every wake-up handler + the agent
  // file editor.
  function sendIdentityMutation<Req, Res extends { error?: string; type: string }>(
    request: Req,
    expectedType: string,
  ): Promise<Res> {
    return new Promise<Res>((resolve, reject) => {
      const sock = openClaudeSessionSocket();
      let settled = false;
      const finish = (val: Res | Error) => {
        if (settled) return;
        settled = true;
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        if (val instanceof Error) reject(val);
        else resolve(val);
      };
      sock.onopen = () => {
        try {
          sock.send(JSON.stringify(request));
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      };
      sock.onmessage = (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data) as { type?: string };
          if (raw.type !== expectedType) return;
          finish(raw as Res);
        } catch {
          /* ignore */
        }
      };
      sock.onerror = () => finish(new Error("Connection failed"));
      sock.onclose = () => finish(new Error("Connection closed before response"));
    });
  }

  async function updateWakeup(
    wakeupSlug: string,
    updates: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string },
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    wakeupsWriteGen.current += 1;
    const payload: IdentityUpdateWakeupPayload = {
      type: "identity:update-wakeup",
      identityKey: identity.identityKey,
      hostId,
      wakeupSlug,
      updates,
    };
    const res = await sendIdentityMutation<IdentityUpdateWakeupPayload, IdentityWakeupUpdatedEvent>(
      payload,
      "identity:wakeup-updated",
    );
    // Bumped again once the write lands: a refresh that started while it was
    // in flight may have read the files before it, and must not win.
    wakeupsWriteGen.current += 1;
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function createIdentityWakeup(spec: WakeupSpecWire): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    wakeupsWriteGen.current += 1;
    const payload: IdentityCreateWakeupPayload = {
      type: "identity:create-wakeup",
      identityKey: identity.identityKey,
      hostId,
      spec,
    };
    const res = await sendIdentityMutation<IdentityCreateWakeupPayload, IdentityWakeupCreatedEvent>(
      payload,
      "identity:wakeup-created",
    );
    wakeupsWriteGen.current += 1;
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function deleteIdentityWakeup(wakeupSlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    wakeupsWriteGen.current += 1;
    const payload: IdentityDeleteWakeupPayload = {
      type: "identity:delete-wakeup",
      identityKey: identity.identityKey,
      hostId,
      wakeupSlug,
    };
    const res = await sendIdentityMutation<IdentityDeleteWakeupPayload, IdentityWakeupDeletedEvent>(
      payload,
      "identity:wakeup-deleted",
    );
    wakeupsWriteGen.current += 1;
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function saveAgentFile(): Promise<void> {
    if (!identity.identityKey) return;
    setSavingFile(true);
    setSaveError(null);
    try {
      const payload: IdentityUpdateIdentityFilePayload = {
        type: "identity:update-identity-file",
        identityKey: identity.identityKey,
        hostId,
        contents: draft,
      };
      const res = await sendIdentityMutation<IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent>(
        payload,
        "identity:identity-file-updated",
      );
      if (res.error) throw new Error(res.error);
      setIdentityFileState({ status: "ready", data: res.markdown });
      fileDirtyRef.current = false;
      setEditing(false);
      console.info({ operation: "identity_file_saved", identityKey: identity.identityKey, hostId });
      // A raw file save can change task/title/role/project. The pulse picks up
      // most of that next tick, but it deliberately never blanks a field (a
      // cleared `task:` would linger in the sidebar) — the authoritative
      // /identities refetch does.
      refreshIdentities().catch(() => {});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFile(false);
    }
  }

  async function saveTask(): Promise<void> {
    const next = taskDraft.trim();
    const current = identity.task ?? "";
    if (next === current) {
      setEditingTask(false);
      return;
    }
    setSavingTask(true);
    try {
      const updated = await updateIdentity(identity.identityKey, { task: next === "" ? null : next }, null, hostId);
      applyIdentityChange(updated);
      setEditingTask(false);
    } catch (err) {
      toast.error(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
    } finally {
      setSavingTask(false);
    }
  }

  async function saveVoice(nextVoice: string): Promise<void> {
    setVoiceDraft(nextVoice);
    try {
      const updated = await updateIdentity(identity.identityKey, { voice: nextVoice === "" ? null : nextVoice }, null, hostId);
      applyIdentityChange(updated);
    } catch (err) {
      toast.error(err instanceof Error ? `Voice save failed: ${err.message}` : "Voice save failed");
      setVoiceDraft(identity.voice ?? "");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const roles = identityRoles(identity);
  // No roles and no colorHue: the neutral grey (the caller passes NEUTRAL_HUE).
  const neutralLook = hasNeutralLook(identity);
  const tint = identityTint(hue, neutralLook);
  const roleLinks = roles.map((roleName) => ({
    roleName,
    label: roleDisplayName(roleName, roleName === identity.role ? identity.roleDefaults?.displayName : undefined),
  }));
  const projects = useProjects();
  const lineage = projectLineage(projects, identity.hostId ?? hostId, identity.project);

  const avatar = (size: number) => (
    <AvatarImage
      // avatarUrl already carries the sweep's avatar version (`&v=`).
      src={identity.avatarUrl}
      name={identity.displayName}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
      initialClassName="rounded-full shrink-0 inline-flex items-center justify-center font-semibold text-[var(--k-t1)]"
      initialStyle={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: tint(45, 35, 0.9) }}
    />
  );

  const openRole = async (roleName: string): Promise<void> => {
    if (!(await leave())) return;
    onOpenChange(false);
    onOpenRoleModal(identity, roleName);
  };

  const hero = (
    <div className="px-6 max-sm:px-5 pb-4 flex gap-[18px] max-sm:gap-3.5 items-center max-sm:items-start flex-shrink-0" data-testid="identity-modal-hero">
      <div className="shrink-0 max-sm:hidden">{avatar(76)}</div>
      <div className="shrink-0 sm:hidden">{avatar(64)}</div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="text-[24px] max-sm:text-[21px] font-bold tracking-[-0.025em] truncate" aria-hidden="true">
          {identity.displayName}
        </div>
        {roleLinks.length > 0 && (
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-1" data-testid="identity-modal-role-links">
            {roleLinks.map(({ roleName, label }, i) => (
              <span key={roleName} className="inline-flex items-baseline">
                <button
                  type="button"
                  onClick={() => void openRole(roleName)}
                  title={`Open ${label} in Roles`}
                  aria-label={`Open role: ${label}`}
                  className="bg-transparent border-0 p-0 cursor-pointer text-[13.5px] font-semibold text-[var(--k-acc-text)] hover:underline underline-offset-2"
                  data-testid="identity-modal-title-line-jump"
                  data-identity-key={identity.identityKey}
                >
                  {label}
                  {i === roleLinks.length - 1 ? <span className="ml-0.5" aria-hidden="true">›</span> : null}
                </button>
                {i < roleLinks.length - 1 ? <span className="text-[13.5px] text-[var(--k-t3)]">,</span> : null}
              </span>
            ))}
          </div>
        )}
        {editingTask ? (
          <KitInput
            size="sm"
            type="text"
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onBlur={() => void saveTask()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveTask();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingTask(false);
                setTaskDraft(identity.task ?? "");
              }
            }}
            // Esc cancels the edit, not the modal.
            data-modal-esc-local=""
            autoFocus
            disabled={savingTask}
            placeholder="What is this agent working on?"
            aria-label="Task"
            data-testid="identity-modal-task-input"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTaskDraft(identity.task ?? "");
              setEditingTask(true);
            }}
            title="Edit task"
            aria-label="Edit task"
            className="group self-start max-w-full inline-flex items-baseline gap-[7px] text-left text-[13.5px] leading-[1.45] cursor-pointer bg-transparent border-0 p-0"
            data-testid="identity-modal-task-pencil"
          >
            <span
              className={cn(
                "line-clamp-2",
                identity.task ? "text-[var(--k-t2)] group-hover:text-[var(--k-t1)]" : "italic text-[var(--k-t3)]",
              )}
              data-testid="identity-modal-task-value"
            >
              {identity.task || "No task set"}
            </span>
            <Pencil className="size-3 shrink-0 text-[var(--k-t3)] group-hover:text-[var(--k-t1)] relative top-px" aria-hidden="true" />
          </button>
        )}
        {lineage.length > 0 && (
          <div className="text-[12.5px] text-[var(--k-t3)] truncate" data-testid="identity-modal-project-line">
            In {lineage.join(" › ")}
          </div>
        )}
        <div className="relative mt-0.5 flex flex-wrap items-center gap-2" ref={voiceRef}>
          <KitButton
            size="sm"
            aria-expanded={voiceOpen}
            onClick={() => setVoiceOpen((v) => !v)}
            className="max-w-[220px]"
            title={identity.voice ? `Voice: ${voiceLabel}` : "Voice — uses the role's voice"}
            data-testid="identity-modal-voice-chip"
          >
            <Mic aria-hidden="true" />
            <span className="truncate">{identity.voice ? voiceLabel : "Role's voice"}</span>
          </KitButton>
          {voiceOpen && (
            <div
              role="dialog"
              aria-label="Voice picker"
              className="k-menu absolute left-0 top-[calc(100%+6px)] z-20 w-[300px] max-w-full !p-3 flex flex-col gap-1.5"
              data-testid="identity-modal-voice-popover"
            >
              <div className="k-label">Voice</div>
              <VoicePicker value={voiceDraft} onChange={(v) => void saveVoice(v)} ariaLabel="Voice" />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const agentFilePane =
    identityFileState.status === "loading" ? (
      <KitLoading lines={5} />
    ) : identityFileState.status === "error" ? (
      <KitBanner tone="danger">Couldn&apos;t load agent file: {identityFileState.error}</KitBanner>
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
          <MarkdownEditor filename="identity.md" content={draft} onChange={onEditorChange} disabled={savingFile} />
        </div>
        {saveError && (
          <KitBanner tone="danger" className="mt-2">
            Save failed: {saveError}
          </KitBanner>
        )}
      </div>
    ) : !identityFileState.data ? (
      <KitEmpty title="No agent file found for this agent." />
    ) : (
      <div className={PROSE} data-testid="identity-modal-agent-file">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
        >
          {stripFrontmatter(identityFileState.data)}
        </ReactMarkdown>
      </div>
    );

  const openers = {
    onOpenRepo: (repoPath: string) => void push({ view: "git-repo", repoPath, title: repoPath === "" ? "Workspace (root)" : repoPath }),
    onOpenCommit: (repoPath: string, commit: GitCommit) =>
      void push({ view: "git-commit", repoPath, commit, title: commit.subject }),
    onOpenDiff: (source: GitDiffSource, title: string, subtitle: string) =>
      void push({ view: "git-diff", source, title, subtitle }),
  };

  // ── The agent itself (top level) ─────────────────────────────────────────
  const onDesktop = shownTab === "desktop";
  const agentView = (
    <>
      {onDesktop ? (
        <ModalHead
          title={<span className="text-[16px] font-semibold">{identity.displayName}</span>}
          leading={avatar(28)}
          closeTestId="identity-modal-close"
          className="pb-2"
        />
      ) : (
        <>
          <ModalHead title={<span className="sr-only">{identity.displayName}</span>} closeTestId="identity-modal-close" className="pb-0" />
          {hero}
        </>
      )}
      <Tabs value={shownTab} onValueChange={(v) => void changeTab(v)} className="flex-1 min-h-0 flex flex-col">
        <ModalTabs
          tabs={NAV_SECTIONS}
          value={shownTab}
          onValueChange={(v) => void changeTab(v)}
          rowTestId="identity-modal-nav"
          testIdPrefix="identity-modal-nav"
          // Five tabs (with Git + Desktop) outrun a phone's width; scroll the
          // row instead of letting a tap on a clipped tab scroll the whole
          // modal sideways.
          scrollable
        />

        <TabsContent value="identity" className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 border-t border-[var(--k-hair)]">
          {agentFilePane}
        </TabsContent>

        <TabsContent
          value="identity-wakeups"
          className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 border-t border-[var(--k-hair)]"
        >
          <WakeupsTab
            state={identityWakeupsState}
            isCoordinator={identity.coordinator}
            onToggle={(slug, enabled) => updateWakeup(slug, { enabled })}
            onOpen={(slug) => {
              const w = identityWakeupsState.status === "ready" ? identityWakeupsState.data.find((x) => x.slug === slug) : undefined;
              void push({ view: "wakeup", slug, title: w?.name ?? slug });
            }}
            onNew={() => void push({ view: "new-wakeup", title: "New wake-up" })}
            onDelete={(slug) => deleteIdentityWakeup(slug)}
          />
        </TabsContent>

        <TabsContent value="workspace" className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-[var(--k-hair)]">
          <WorkspaceTab target={{ kind: "identity", identityKey: identity.identityKey }} hostId={hostId} hue={hue} />
        </TabsContent>

        {hasApps && (
          <TabsContent
            value="apps"
            className="flex-1 min-h-0 overflow-y-auto px-6 max-sm:px-5 py-4 border-t border-[var(--k-hair)]"
          >
            <AppsTab apps={conversationApps} onClose={() => onOpenChange(false)} />
          </TabsContent>
        )}

        {hasGitRepos && (
          <TabsContent value="git" className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--k-hair)]">
            <AgentGitRoot git={git} {...openers} />
          </TabsContent>
        )}

        {desktopRunning && (
          <TabsContent value="desktop" className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <DesktopTab
              identityKey={identity.identityKey}
              hostId={hostId}
              isVisible={open && shownTab === "desktop" && deep === null}
              onControlChange={setDesktopControl}
              onPopOut={() => {
                requestDesktopPane({
                  hostId,
                  identityKey: identity.identityKey.toLowerCase(),
                  label: identity.displayName || identity.identityKey,
                });
                onOpenChange(false);
              }}
            />
          </TabsContent>
        )}
      </Tabs>

      {shownTab === "identity" && fileReady && identityFileState.data ? (
        <ModalFoot>
          {editing ? (
            <>
              <KitButton disabled={savingFile} onClick={() => void leaveFileEdit()} data-testid="identity-modal-cancel-edit">
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                busy={savingFile}
                disabled={!fileDirty}
                onClick={() => void saveAgentFile()}
                data-testid="identity-modal-save"
              >
                {savingFile ? "Saving…" : "Save"}
              </KitButton>
            </>
          ) : (
            <KitButton
              onClick={() => {
                const data = identityFileState.status === "ready" ? identityFileState.data : "";
                setDraft(data);
                setBaseline(data);
                interacted.current = false;
                setSaveError(null);
                setEditing(true);
              }}
              data-testid="identity-modal-edit"
            >
              <Pencil /> Edit
            </KitButton>
          )}
        </ModalFoot>
      ) : null}
    </>
  );

  // ── One level (or more) deeper ───────────────────────────────────────────
  let deepView: JSX.Element | null = null;
  if (deep) {
    const backLabel = stack.length === 1 ? identity.displayName : stack[stack.length - 2].title;
    const head = (title: React.ReactNode, subtitle?: React.ReactNode) => (
      <ModalHead
        title={title}
        subtitle={subtitle}
        closeTestId="identity-modal-close"
        leading={
          <KitButton
            variant="plain"
            size="sm"
            onClick={() => void back()}
            className="max-w-[180px] max-sm:max-w-[120px]"
            data-testid="identity-modal-back"
            data-modal-back=""
          >
            <ChevronLeft /> <span className="truncate">{backLabel}</span>
          </KitButton>
        }
      />
    );
    if (deep.view === "wakeup" || deep.view === "new-wakeup") {
      const liveWakeup =
        deep.view === "wakeup" && identityWakeupsState.status === "ready"
          ? identityWakeupsState.data.find((w) => w.slug === deep.slug)
          : undefined;
      // Gone while being edited (a one-time one that fired, or deleted
      // elsewhere): keep the edits on screen to copy instead of dropping them.
      const goneWakeup =
        deep.view === "wakeup" && !liveWakeup && wakeupDirty && lastWakeup.current?.slug === deep.slug
          ? lastWakeup.current
          : undefined;
      const wakeup = liveWakeup ?? goneWakeup;
      if (liveWakeup) lastWakeup.current = liveWakeup;
      deepView =
        deep.view === "wakeup" && !wakeup ? (
          <>
            {head(deep.title, "Wake-up")}
            <div className="flex-1 min-h-0 px-6 py-4">
              <KitEmpty title="This wake-up is gone." body="It was deleted elsewhere." />
            </div>
          </>
        ) : (
          <>
            {head(
              deep.view === "new-wakeup" ? "New wake-up" : wakeup!.name,
              deep.view === "new-wakeup" ? `Wakes ${identity.displayName} with an instruction` : "Wake-up",
            )}
            <WakeupView
              key={deep.view === "wakeup" ? deep.slug : "new"}
              wakeup={wakeup}
              onToggle={wakeup ? (enabled) => updateWakeup(wakeup.slug, { enabled }) : undefined}
              onSave={wakeup ? (u: WakeupUpdates) => updateWakeup(wakeup.slug, u) : undefined}
              onCreate={createIdentityWakeup}
              onDelete={wakeup ? () => deleteIdentityWakeup(wakeup.slug) : undefined}
              onDone={() => void back()}
              registerGuard={registerGuard}
              registerEscape={registerEscape}
              onDirtyChange={setWakeupDirty}
              gone={
                goneWakeup
                  ? (goneWakeup.schedule as { type?: unknown } | null)?.type === "one_shot"
                    ? "ran"
                    : "deleted"
                  : undefined
              }
            />
          </>
        );
    } else if (deep.view === "git-repo") {
      deepView = (
        <>
          {head(deep.title, "Repo")}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <AgentGitRepo git={git} repoPath={deep.repoPath} {...openers} />
          </div>
        </>
      );
    } else if (deep.view === "git-commit") {
      const c = deep.commit;
      deepView = (
        <>
          {head(
            deep.title,
            <span>
              <span className="font-mono text-[12px]">{c.sha.slice(0, 7)}</span> · {c.author}
            </span>,
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <AgentGitCommit git={git} repoPath={deep.repoPath} commit={c} onOpenDiff={openers.onOpenDiff} />
          </div>
        </>
      );
    } else {
      deepView = (
        <>
          {head(<span className="font-mono text-[17px] break-all">{deep.title}</span>, deep.subtitle)}
          <AgentGitDiff git={git} source={deep.source} />
        </>
      );
    }
  }

  // The editor size throughout — the agent file is often long markdown, and
  // the Files tab matches the role and project windows' — except the Desktop
  // tab's wide viewer (height follows the desktop's shape).
  const size = deep === null && onDesktop ? "viewer" : "editor";

  return (
    <Modal
      open={open}
      onOpenChange={(o) => void handleOpenChange(o)}
      hue={hue}
      size={size}
      dismissible={!desktopControl}
      data-testid="identity-modal"
    >
      {deepView ?? agentView}
    </Modal>
  );
}
