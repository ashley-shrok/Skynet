// IdentityModal — per-identity editor + record view.
//
// Modal-unification 2026-09-29 (revised 2026-09-30 UAT):
//   - Shell: canonical <Modal hue={identity.colorHue ?? 220}>. Portals to
//     document.body (blocking default = true) with a proper backdrop and
//     focus trap. The earlier "per-pane, blocking=false" treatment made
//     the modal show only inside the pane's stacking context — in split
//     view it rendered under the neighboring pane. Backdrop dims the
//     whole viewport now; badge sits UNDER the modal.
//   - Head: avatar + display name (plain text, no jump treatment) + role
//     line (clickable, jumps to RoleModal — prettified via the shared
//     roleDisplayName helper on roleDefaults.displayName with title-cased
//     slug fallback) + task line (with inline pencil) + voice chip + close
//     X. The ⋯ menu, Boost toggle, identity avatar upload, and displayName
//     pencil are all retired.
//   - Section-tabs at top: 3 tabs (Identity file / Wake-ups / Files),
//     underline-style per tasting. Canonical <ModalFoot> with Close.
//
// Save flow:
//   - Task pencil → text input → Enter/blur → updateIdentity with meta.task.
//   - Voice chip → click opens picker popover → VoicePicker onChange →
//     updateIdentity with meta.voice. Chip shows "default" (italic) when
//     identity.voice is null (inherits identity.roleDefaults?.voice).
//
// AddWakeupDialog stacking: unchanged. AddWakeupDialog is a separate
// canonical Modal that portals to document.body, stacks OVER IdentityModal
// like today. No swap-not-stack.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { AlarmClock, ChevronDown, Folder, Mic, Pencil, User, X } from "lucide-react";
import { Modal, ModalFoot, ModalTabs } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { roleDisplayName } from "@/lib/role-display-name";
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
import { bumpModalOpen } from "@/lib/freeze-diag";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
  hue: number;
  hostId: number;
  onOpenRoleModal: (identity: Identity) => void;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<string>("identity");

  // Per-field inline edit state — task pencil only (displayName pencil
  // retired 2026-09-29; identities not renamable via UI).
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<string>(identity.task ?? "");
  const [savingField, setSavingField] = useState<null | "task">(null);

  // Voice chip + popover (pinned top of head).
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<string>(identity.voice ?? "");
  const voicePickerRef = useRef<HTMLDivElement | null>(null);

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
    setTaskDraft(identity.task ?? "");
    setEditingTask(false);
    setVoicePickerOpen(false);
    setVoiceDraft(identity.voice ?? "");
  }, [open, identity.identityKey, identity.task, identity.voice]);

  // freeze-diag: bump the identity-modal open counter on each closed→open
  // transition so the periodic heartbeat can correlate modal usage with
  // resource growth. See src/ui/lib/freeze-diag.ts.
  useEffect(() => {
    if (open) bumpModalOpen("identity");
  }, [open]);

  // Click-outside close on the voice picker popover.
  useEffect(() => {
    if (!voicePickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!voicePickerRef.current) return;
      if (voicePickerRef.current.contains(e.target as Node)) return;
      setVoicePickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [voicePickerOpen]);

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
      setVoiceDraft(identity.voice ?? "");
    }
  }

  // saveDisplayName / onStaysAwakeToggle / onAvatarPick retired 2026-09-29
  // (identities not renamable via UI; Boost switch retired; identity avatar
  // upload retired). The .no-dormancy sentinel mechanism still exists on
  // disk — agents touch/rm the file per user request.

  const canJumpToRole = identity.role !== null;
  // Pretty-names shape (2026-09-30): roles carry `displayName` in their
  // frontmatter instead of `title`. Route through the shared helper so
  // the fallback title-cases the slug ("box-maintainer" → "Box Maintainer")
  // consistently with every other surface that renders a role name.
  const roleDisplay = identity.role
    ? roleDisplayName(identity.role, identity.roleDefaults?.displayName)
    : "";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      hue={hue}
      size="xl"
      className="max-h-[90vh] flex flex-col"
      data-testid="identity-modal"
    >
      {/* Head — avatar + display name (no pencil) + role slug + inline-
          editable task + voice chip pinned top-right + close X. Custom
          head shape (not <ModalHead>) because it holds inline-edit UI
          and chip-triggered popovers. */}
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
          {/* Line 1: display name — plain text, never clickable. The
              jump-to-role treatment lives on line 2 (the role line). */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-[16px] text-[#f0ebe0] truncate leading-tight">
              {identity.displayName}
            </span>
          </div>
          {/* Role line — clickable, prettified (uses role frontmatter
              title if present, else the raw slug). This is what opens
              RoleModal. */}
          {canJumpToRole && (
            <div className="min-w-0">
              <TitleLineJumpToRole
                identity={identity}
                text={roleDisplay}
                className="text-[12px] font-medium tracking-[0.04em]"
                jumpTargetLabel={roleDisplay}
                onJump={() => {
                  onOpenChange(false);
                  onOpenRoleModal(identity);
                }}
              />
            </div>
          )}
          {/* Task line + inline pencil. Edit mode uses a full-width input
              (still flex-1 for a comfortable typing target). Read mode
              wraps text + pencil in an inline-flex block so the pencil
              sits adjacent to the actual task text instead of floating
              at the far right of the row when the task is short. */}
          <div className="flex items-center min-w-0 mt-0.5">
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
              <div className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                <span
                  className="text-[12.5px] leading-snug text-[hsla(var(--pv-id-hue),22%,92%,0.72)] truncate min-w-0"
                  data-testid="identity-modal-task-value"
                >
                  {identity.task || (
                    <span className="italic opacity-60">No task set</span>
                  )}
                </span>
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
              </div>
            )}
          </div>
        </div>
        {/* Voice chip + close X — pinned to the top of the header. */}
        <div className="flex items-start gap-1 shrink-0">
          <div className="relative" ref={voicePickerRef}>
            <button
              type="button"
              aria-label="Voice — click to pick"
              title={
                identity.voice
                  ? `Voice: ${identity.voice} — click to change`
                  : "Voice — click to pick (currently inherits role default)"
              }
              onClick={() => setVoicePickerOpen((v) => !v)}
              data-testid="identity-modal-voice-chip"
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer",
                "border transition-colors",
                voicePickerOpen
                  ? "bg-[hsla(var(--pv-id-hue),55%,45%,0.7)] border-[hsla(var(--pv-id-hue),65%,60%,0.55)] text-[#fbf5e8]"
                  : "bg-[hsla(var(--pv-id-hue),55%,40%,0.55)] border-[hsla(var(--pv-id-hue),65%,55%,0.45)] text-[#fbf5e8] hover:bg-[hsla(var(--pv-id-hue),55%,45%,0.65)]",
              )}
            >
              <Mic size={12} className="opacity-85" />
              {identity.voice ? (
                <span>{identity.voice}</span>
              ) : (
                <span className="italic opacity-75">default</span>
              )}
              <ChevronDown size={12} className="opacity-70" />
            </button>
            {voicePickerOpen && (
              <div
                role="dialog"
                aria-label="Voice picker"
                data-testid="identity-modal-voice-popover"
                className={cn(
                  "absolute right-0 top-[calc(100%+6px)] z-20 min-w-[260px] p-3 rounded-lg flex flex-col gap-1.5",
                  "border border-[hsla(var(--pv-id-hue),60%,55%,0.32)]",
                )}
                style={{
                  background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.98), hsla(${hue}, 40%, 15%, 0.98))`,
                  boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)",
                }}
              >
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
        <ModalTabs
          tabs={NAV_SECTIONS}
          value={activeTab}
          onValueChange={setActiveTab}
          rowTestId="identity-modal-nav"
          testIdPrefix="identity-modal-nav"
        />

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
          <WorkspaceTab
            target={{ kind: "identity", identityKey: identity.identityKey }}
            hostId={hostId}
            hue={hue}
          />
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
