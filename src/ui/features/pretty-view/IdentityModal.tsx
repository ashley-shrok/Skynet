// IdentityModal — per-identity editor + record view.
//
// Modal-unification 2026-09-29:
//   - Shell: canonical <Modal hue={identity.colorHue ?? 220} blocking={false}
//     container={container}>. Portal target stays the chat-region container
//     so the composer + IdentityBadge stay visible/interactive underneath
//     while the modal is open (design intent: user often opens an identity
//     while drafting a reply to that identity).
//   - Head: avatar + display name (with inline pencil) + role slug meta +
//     task line (with inline pencil) + ⋯ menu (voice picker + boost
//     response time + avatar upload) + close X. Coordinator watermark
//     REMOVED (concept retired per Ashley 2026-09-29).
//   - Section-tabs: MOVED from the bottom to directly under the head
//     (IDE convention; matches Runbook/Skills translations). 3 tabs
//     unchanged: Identity file / Wake-ups / Files.
//   - Foot: canonical <ModalFoot> with a single Close button — chrome
//     consistency across all editor-lg modals.
//
// Save flow — per-field inline (was batch pencil-drawer):
//   - Display name pencil → text input → Enter/blur → updateIdentity
//     with meta.displayName.
//   - Task pencil → text input → Enter/blur → updateIdentity with
//     meta.task (backend PUT gains meta.task overlay in this same commit).
//   - Voice pick (⋯ menu) → onChange → updateIdentity with meta.voice.
//   - Boost response time (⋯ menu) → toggle → setIdentityNoDormancy.
//   - Avatar upload (⋯ menu) → file picker → updateIdentity with
//     avatar File (multipart).
//   Batch-save with per-field revert-to-role-default flags is REMOVED —
//   users revert by hand-editing the identity file frontmatter in the
//   Identity file tab (that surface hasn't changed).
//
// AddWakeupDialog stacking: unchanged. AddWakeupDialog is a separate
// canonical Modal that portals to document.body (default container),
// stacks OVER IdentityModal like today. No swap-not-stack.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { AlarmClock, Folder, MoreHorizontal, Pencil, Upload, User, X } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import { Switch } from "@/components/switch";
import {
  updateIdentity,
  getIdentityNoDormancy,
  setIdentityNoDormancy,
} from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { toast } from "sonner";
import { VoicePicker } from "./pickers/VoicePicker";
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
import { cn } from "@/lib/utils";
import { IdentityFileTab, type TabState } from "./IdentityFileTab";
import { WakeupsTab } from "./WakeupsTab";
import WorkspaceTab from "./WorkspaceTab";

// Title-line clickable treatment for jumping to the role modal. Preserved
// verbatim from the pre-unification IdentityModal (Phase 90 Plan 90-06 D-04).
function TitleLineJumpToRole({
  identity,
  text,
  className,
  jumpTargetLabel,
  onJump,
}: {
  identity: Identity;
  text: string;
  className?: string;
  jumpTargetLabel: string;
  onJump: () => void;
}): React.ReactElement {
  const REST_COLOR = "#c4b89a";
  const REST_DECO_COLOR = "rgba(196, 184, 154, 0.35)";
  const HOVER_COLOR = "#f0ebe0";
  const HOVER_DECO_COLOR = "rgba(240, 235, 224, 0.6)";
  const [hovered, setHovered] = useState(false);
  const handleActivate = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      onJump();
    },
    [onJump],
  );
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Open role modal: ${jumpTargetLabel}`}
      title={`Open role modal: ${jumpTargetLabel}`}
      data-testid="identity-modal-title-line-jump"
      data-identity-key={identity.identityKey}
      className={className}
      style={{
        cursor: "pointer",
        color: hovered ? HOVER_COLOR : REST_COLOR,
        textDecoration: "underline",
        textDecorationStyle: hovered ? "solid" : "dotted",
        textDecorationColor: hovered ? HOVER_DECO_COLOR : REST_DECO_COLOR,
        textUnderlineOffset: "2px",
        transition: "color 120ms, text-decoration 120ms",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate(e);
        }
      }}
    >
      {text}
      <span
        style={{
          marginLeft: 3,
          opacity: hovered ? 1 : 0.7,
          transition: "opacity 120ms",
        }}
      >
        {"›"}
      </span>
    </span>
  );
}

export function IdentityModal({
  open,
  onOpenChange,
  identity,
  hue,
  hostId,
  onOpenRoleModal,
  container,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
  hue: number;
  hostId: number;
  onOpenRoleModal: (identity: Identity) => void;
  container?: HTMLElement | null;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<string>("identity");

  // Per-field inline edit state — display name + task pencils in the head.
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>(identity.displayName);
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<string>(identity.task ?? "");
  const [savingField, setSavingField] = useState<null | "displayName" | "task">(null);

  // ⋯ menu (voice + boost response time + avatar upload).
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<string>(
    identity.voice ?? identity.roleDefaults?.voice ?? "",
  );
  const [staysAwake, setStaysAwake] = useState<boolean | null>(null);
  const [staysAwakeSaving, setStaysAwakeSaving] = useState<boolean>(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Tab data — same shape + WS-based fetches as the pre-unification impl.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  const [identityWakeupsState, setIdentityWakeupsState] = useState<TabState<Wakeup[]>>({ status: "loading" });

  const NAV_SECTIONS = [
    { value: "identity", label: "Identity file", Icon: User },
    { value: "identity-wakeups", label: "Wake-ups", Icon: AlarmClock },
    { value: "workspace", label: "Files", Icon: Folder },
  ] as const;

  // Initial fetch of identity file + wake-ups on modal open. Preserved
  // verbatim from pre-unification (two parallel WS one-shot requests).
  useEffect(() => {
    if (!open || !identity.identityKey) return;

    setIdentityFileState({ status: "loading" });
    setIdentityWakeupsState({ status: "loading" });

    let cancelled = false;
    const artifactSockets: WebSocket[] = [];

    function openOneShot<
      Req extends { type: string },
      Res extends { type: string },
    >(
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
      {
        type: "identity:get-identity-file",
        identityKey: identity.identityKey,
        hostId,
      },
      "identity:identity-file",
      (ev) =>
        setIdentityFileState(
          ev.error
            ? { status: "error", error: ev.error }
            : { status: "ready", data: ev.markdown },
        ),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
      {
        type: "identity:list-wakeups",
        identityKey: identity.identityKey,
        hostId,
      },
      "identity:wakeups",
      (ev) =>
        setIdentityWakeupsState(
          ev.error
            ? { status: "error", error: ev.error }
            : { status: "ready", data: ev.wakeups },
        ),
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

  // Reset per-field draft state + close menu on open.
  useEffect(() => {
    if (!open) return;
    setDisplayNameDraft(identity.displayName);
    setTaskDraft(identity.task ?? "");
    setEditingDisplayName(false);
    setEditingTask(false);
    setMenuOpen(false);
    setVoiceDraft(identity.voice ?? identity.roleDefaults?.voice ?? "");
  }, [
    open,
    identity.identityKey,
    identity.displayName,
    identity.task,
    identity.voice,
    identity.roleDefaults?.voice,
  ]);

  // Load the stays-awake sentinel state on modal open or identity/host change.
  useEffect(() => {
    if (!open || !identity.identityKey) return;
    setStaysAwake(null);
    setStaysAwakeSaving(false);
    let cancelled = false;
    getIdentityNoDormancy(identity.identityKey, hostId).then(
      (present) => {
        if (!cancelled) setStaysAwake(present);
      },
      () => {
        if (!cancelled) {
          setStaysAwake(null);
          toast.error("Failed to read stays-awake state");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, identity.identityKey, hostId]);

  // Click-outside close on the ⋯ popover.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // One-shot WS mutation helper (kept verbatim — used by every wake-up
  // handler + the identity file editor).
  function sendIdentityMutation<
    Req,
    Res extends { error?: string; type: string },
  >(request: Req, expectedType: string): Promise<Res> {
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
    updates: {
      enabled?: boolean;
      schedule?: unknown;
      name?: string;
      instruction?: string;
    },
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateWakeupPayload = {
      type: "identity:update-wakeup",
      identityKey: identity.identityKey,
      hostId,
      wakeupSlug,
      updates,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateWakeupPayload,
      IdentityWakeupUpdatedEvent
    >(payload, "identity:wakeup-updated");
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function createIdentityWakeup(spec: WakeupSpecWire): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityCreateWakeupPayload = {
      type: "identity:create-wakeup",
      identityKey: identity.identityKey,
      hostId,
      spec,
    };
    const res = await sendIdentityMutation<
      IdentityCreateWakeupPayload,
      IdentityWakeupCreatedEvent
    >(payload, "identity:wakeup-created");
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function deleteIdentityWakeup(wakeupSlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityDeleteWakeupPayload = {
      type: "identity:delete-wakeup",
      identityKey: identity.identityKey,
      hostId,
      wakeupSlug,
    };
    const res = await sendIdentityMutation<
      IdentityDeleteWakeupPayload,
      IdentityWakeupDeletedEvent
    >(payload, "identity:wakeup-deleted");
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  async function updateIdentityFile(contents: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateIdentityFilePayload = {
      type: "identity:update-identity-file",
      identityKey: identity.identityKey,
      hostId,
      contents,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateIdentityFilePayload,
      IdentityIdentityFileUpdatedEvent
    >(payload, "identity:identity-file-updated");
    if (res.error) throw new Error(res.error);
    setIdentityFileState({ status: "ready", data: res.markdown });
  }

  async function onStaysAwakeToggle(next: boolean): Promise<void> {
    const prev = staysAwake;
    setStaysAwake(next);
    setStaysAwakeSaving(true);
    try {
      const confirmed = await setIdentityNoDormancy(
        identity.identityKey,
        hostId,
        next,
      );
      setStaysAwake(confirmed);
    } catch {
      setStaysAwake(prev);
      toast.error("Failed to update stays-awake");
    } finally {
      setStaysAwakeSaving(false);
    }
  }

  // Per-field inline save — displayName.
  async function saveDisplayName(): Promise<void> {
    const next = displayNameDraft.trim();
    if (next.length === 0 || next === identity.displayName) {
      setEditingDisplayName(false);
      setDisplayNameDraft(identity.displayName);
      return;
    }
    setSavingField("displayName");
    try {
      const updated = await updateIdentity(
        identity.identityKey,
        { displayName: next },
        null,
        hostId,
      );
      applyIdentityChange(updated);
      setEditingDisplayName(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Save failed: ${err.message}`
          : "Save failed",
      );
    } finally {
      setSavingField(null);
    }
  }

  // Per-field inline save — task.
  async function saveTask(): Promise<void> {
    const next = taskDraft.trim();
    const current = identity.task ?? "";
    if (next === current) {
      setEditingTask(false);
      return;
    }
    setSavingField("task");
    try {
      const updated = await updateIdentity(
        identity.identityKey,
        { task: next === "" ? null : next },
        null,
        hostId,
      );
      applyIdentityChange(updated);
      setEditingTask(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Save failed: ${err.message}`
          : "Save failed",
      );
    } finally {
      setSavingField(null);
    }
  }

  // Voice save — fires when the picker changes.
  async function saveVoice(nextVoice: string): Promise<void> {
    setVoiceDraft(nextVoice);
    try {
      const updated = await updateIdentity(
        identity.identityKey,
        { voice: nextVoice === "" ? null : nextVoice },
        null,
        hostId,
      );
      applyIdentityChange(updated);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Voice save failed: ${err.message}`
          : "Voice save failed",
      );
      // Roll back the local draft on error
      setVoiceDraft(identity.voice ?? identity.roleDefaults?.voice ?? "");
    }
  }

  // Avatar upload — file picker in the ⋯ menu.
  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file re-fires onChange
    if (!file) return;
    try {
      const updated = await updateIdentity(
        identity.identityKey,
        {},
        file,
        hostId,
      );
      applyIdentityChange(updated);
      setMenuOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Avatar upload failed: ${err.message}`
          : "Avatar upload failed",
      );
    }
  }

  const canJumpToRole = identity.role !== null;
  const jumpTargetLabel = identity.role ?? identity.displayName;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      hue={hue}
      blocking={false}
      container={container ?? undefined}
      size="xl"
      className="max-h-[90vh] flex flex-col"
      data-testid="identity-modal"
    >
      {/* Head — avatar + inline-editable name/task + ⋯ menu + close X.
          Custom head shape (not <ModalHead>) because it holds inline edit
          UI + a popover — the canonical head is optimized for
          static-title-plus-actions rather than this multi-line inline-
          edit layout. */}
      <div
        className="px-5 py-4 flex flex-row items-start gap-3 flex-shrink-0"
        style={{
          borderBottom: `1px solid hsla(${hue}, 50%, 50%, 0.22)`,
        }}
      >
        <img
          src={
            identity.avatarEtag
              ? `${identity.avatarUrl}&v=${identity.avatarEtag}`
              : identity.avatarUrl
          }
          alt=""
          draggable={false}
          className="shrink-0 object-cover"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            boxShadow: `0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,190,0.25), 0 0 20px hsla(${hue}, 65%, 55%, 0.35)`,
          }}
        />
        <div className="flex flex-col flex-1 min-w-0 gap-1">
          {/* Line 1: display name + inline pencil */}
          <div className="flex items-center gap-2 min-w-0">
            {editingDisplayName ? (
              <input
                type="text"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                onBlur={() => {
                  void saveDisplayName();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveDisplayName();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingDisplayName(false);
                    setDisplayNameDraft(identity.displayName);
                  }
                }}
                autoFocus
                disabled={savingField === "displayName"}
                data-testid="identity-modal-displayname-input"
                className={cn(
                  "flex-1 min-w-0 px-2 py-1 rounded-md text-[16px] font-semibold",
                  "bg-black/25 border border-[hsla(var(--pv-id-hue),65%,55%,0.5)] text-[#f0ebe0]",
                  "outline-none",
                  "disabled:opacity-60",
                )}
              />
            ) : canJumpToRole ? (
              <TitleLineJumpToRole
                identity={identity}
                text={identity.displayName}
                className="font-semibold text-[16px] truncate leading-tight"
                jumpTargetLabel={jumpTargetLabel}
                onJump={() => {
                  onOpenChange(false);
                  onOpenRoleModal(identity);
                }}
              />
            ) : (
              <span className="font-semibold text-[16px] text-[#f0ebe0] truncate leading-tight">
                {identity.displayName}
              </span>
            )}
            {!editingDisplayName && (
              <button
                type="button"
                aria-label="Edit display name"
                title="Edit display name"
                onClick={() => {
                  setDisplayNameDraft(identity.displayName);
                  setEditingDisplayName(true);
                }}
                data-testid="identity-modal-displayname-pencil"
                className="shrink-0 cursor-pointer text-[hsla(var(--pv-id-hue),22%,88%,0.55)] hover:text-[#f0ebe0] transition-colors"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
          {/* Role slug meta line */}
          {identity.role !== null && (
            <div className="text-[11.5px] font-medium tracking-[0.06em] text-[hsla(var(--pv-id-hue),35%,90%,0.65)]">
              {identity.role}
            </div>
          )}
          {/* Task line + inline pencil */}
          <div className="flex items-center gap-2 min-w-0 mt-0.5">
            {editingTask ? (
              <input
                type="text"
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onBlur={() => {
                  void saveTask();
                }}
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
                autoFocus
                disabled={savingField === "task"}
                placeholder="What is this identity working on?"
                data-testid="identity-modal-task-input"
                className={cn(
                  "flex-1 min-w-0 px-2 py-1 rounded-md text-[12.5px]",
                  "bg-black/25 border border-[hsla(var(--pv-id-hue),65%,55%,0.5)] text-[#e8e4d8]",
                  "placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.35)]",
                  "outline-none",
                  "disabled:opacity-60",
                )}
              />
            ) : (
              <span
                className="text-[12.5px] leading-snug text-[hsla(var(--pv-id-hue),22%,92%,0.72)] truncate flex-1 min-w-0"
                data-testid="identity-modal-task-value"
              >
                {identity.task || (
                  <span className="italic opacity-60">No task set</span>
                )}
              </span>
            )}
            {!editingTask && (
              <button
                type="button"
                aria-label="Edit task"
                title="Edit task"
                onClick={() => {
                  setTaskDraft(identity.task ?? "");
                  setEditingTask(true);
                }}
                data-testid="identity-modal-task-pencil"
                className="shrink-0 cursor-pointer text-[hsla(var(--pv-id-hue),22%,88%,0.55)] hover:text-[#f0ebe0] transition-colors"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        </div>
        {/* ⋯ menu + close X — grouped tight at top-right. */}
        <div className="flex items-start gap-1 shrink-0" ref={menuRef}>
          <div className="relative">
            <button
              type="button"
              aria-label="More settings"
              title="More settings"
              onClick={() => setMenuOpen((v) => !v)}
              data-testid="identity-modal-menu-button"
              className={cn(
                "size-9 rounded-full flex items-center justify-center cursor-pointer",
                "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#f0ebe0]",
                "hover:bg-white/10 transition-colors",
                menuOpen && "bg-white/10 text-[#f0ebe0]",
              )}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                data-testid="identity-modal-menu"
                className={cn(
                  "absolute right-0 top-[calc(100%+6px)] z-20 min-w-[260px] p-3 rounded-lg flex flex-col gap-3",
                  "border border-[hsla(var(--pv-id-hue),60%,55%,0.32)]",
                )}
                style={{
                  background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.98), hsla(${hue}, 40%, 15%, 0.98))`,
                  boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)",
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-[hsla(var(--pv-id-hue),30%,88%,0.72)]">
                    Voice
                  </div>
                  <VoicePicker
                    value={voiceDraft}
                    onChange={(v) => {
                      void saveVoice(v);
                    }}
                    ariaLabel="Voice"
                  />
                </div>
                <label
                  className="flex items-center gap-2.5 cursor-pointer"
                  title="Toggle stays-awake sentinel for this identity"
                >
                  <Switch
                    checked={staysAwake === true}
                    onCheckedChange={onStaysAwakeToggle}
                    disabled={staysAwake === null || staysAwakeSaving}
                    aria-label={`Toggle stays-awake for ${identity.displayName}`}
                  />
                  <span className="text-[12.5px] text-[hsla(var(--pv-id-hue),22%,88%,0.85)]">
                    Boost response time (uses more memory)
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  data-testid="identity-modal-avatar-upload"
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] cursor-pointer",
                    "bg-black/25 border border-white/10 text-[#e8e4d8]",
                    "hover:bg-black/40",
                  )}
                >
                  <Upload size={12} /> Upload new avatar…
                </button>
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void onAvatarPick(e);
                  }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => onOpenChange(false)}
            data-testid="identity-modal-close"
            className={cn(
              "size-9 rounded-full flex items-center justify-center cursor-pointer",
              "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#f0ebe0]",
              "hover:bg-white/10 transition-colors",
            )}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Section tabs — MOVED to TOP per tasting. */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div
          className={cn(
            "shrink-0 flex items-stretch gap-1 px-2 py-1.5",
            "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
            "bg-black/25",
          )}
          data-testid="identity-modal-nav"
        >
          {NAV_SECTIONS.map(({ value, label, Icon }) => {
            const selected = activeTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                aria-pressed={selected}
                data-testid={`identity-modal-nav-${value}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] cursor-pointer",
                  "transition-colors duration-150",
                  selected
                    ? "text-[#fbf5e8] bg-[hsla(var(--pv-id-hue),65%,55%,0.28)] border border-[hsla(var(--pv-id-hue),65%,60%,0.42)]"
                    : "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#e8e4d8] hover:bg-white/[0.04] border border-transparent",
                )}
              >
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>

        <TabsContent
          value="identity"
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
        >
          <IdentityFileTab state={identityFileState} onSave={updateIdentityFile} />
        </TabsContent>

        <TabsContent
          value="identity-wakeups"
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
        >
          <WakeupsTab
            state={identityWakeupsState}
            hue={hue}
            scope="identity"
            isCoordinator={identity.coordinator}
            onUpdate={updateWakeup}
            onCreate={createIdentityWakeup}
            onDelete={deleteIdentityWakeup}
          />
        </TabsContent>

        <TabsContent
          value="workspace"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <WorkspaceTab identity={identity} hostId={hostId} hue={hue} />
        </TabsContent>
      </Tabs>

      {/* Canonical foot — chrome consistency across editor-lg modals. */}
      <ModalFoot>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          data-testid="identity-modal-close-foot"
          className={cn(
            "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
            "bg-black/20 border border-white/10",
            "hover:bg-black/30",
            "text-[#e8e4d8]",
          )}
        >
          Close
        </button>
      </ModalFoot>
    </Modal>
  );
}
