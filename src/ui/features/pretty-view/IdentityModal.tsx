// quick-260912-0t4 follow-on bounty (documented, not fixed here):
//   IdentityModal receives its `identity` prop upstream-resolved by
//   IdentitySessionPane (see src/ui/shell/IdentitySessionPane.tsx L457, L461),
//   which uses bare-name `identitiesByKey.get(identityKey)!` — the pre-
//   quick-260912-0t4 lookup shape. IdentitySessionPane is OUT of the
//   quick-260912-0t4 fix_scope (its scope-widening changes multiple files
//   and threads hostId through IdentityBadge / tabUtils call chains).
//
//   Residual risk: if the box has two identities sharing a name across
//   different fleet hosts (Alice's original willow-on-workstation-vs-t1000
//   report), the badge-click that opens THIS modal from the terminal-mode
//   identity pane resolves the identity via IdentitySessionPane's bare-name
//   byKey lookup, which can pick the WRONG host's identity object even
//   though the pane itself knows its own host.id. The modal renders
//   whatever it's handed.
//
//   Follow-on fix (two-line): swap IdentitySessionPane.tsx L457/L461 to
//   `identitiesByHostKey.get(`${parseInt(host.id,10)}::${identityKey}`)` and
//   destructure byHostKey from useIdentities(). Batch with any future phase
//   that touches IdentitySessionPane.
//
//   The pretty-view badge-click path (PrettyView → IdentityModal via the
//   sidebar row) IS covered by quick-260912-0t4 because PrettyView threads
//   its own `hostId` prop through useSessionIdentity(name, hostId).
import { useCallback, useEffect, useRef, useState } from "react";
// Phase 86 Plan 86-05: type-only React import for ReactNode in the inherit-
// override render helpers below (renderInheritedBadge / renderRevertButton).
// Mirrors the pattern used by src/ui/components/section-card.tsx.
import type React from "react";
import { AlarmClock, Pencil, Send, User, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { Button } from "@/components/button";
import { Switch } from "@/components/switch";
// Quick 260731-1c8: add inline title + avatar editor to the Identity tab.
// updateIdentity is the existing PUT /identities/:identityKey HTTP client; applyIdentityChange
// broadcasts the fresh identity to all useIdentities() consumers so live
// IdentityBadge / SessionRow / PrettyConversationRow / RelayInboundBubble
// re-render without a manual refresh.
// Phase 68 Plan 04: avatarUrlWithHost DELETED — backend bakes hostId into identity.avatarUrl.
import { updateIdentity, getIdentityNoDormancy, setIdentityNoDormancy } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import {
  getCoordinatorWatermarkStyle,
  COORDINATOR_WATERMARK_HUE_FALLBACK,
} from "@/features/pretty-view/coordinator-watermark";
import { toast } from "sonner";
import { VoicePicker } from "./pickers/VoicePicker";
import { ColorPicker } from "./pickers/ColorPicker";
import {
  openClaudeSessionSocket,
  type IdentityGetIdentityFilePayload,
  type IdentityIdentityFileEvent,
  type IdentityListWakeupsPayload,
  type IdentityWakeupsEvent,
  type IdentityUpdateWakeupPayload,
  type IdentityWakeupUpdatedEvent,
  type Wakeup,
  // Phase 18 / IDMEDIT-01: markdown-tab write wire types from Plan 01
  type IdentityUpdateIdentityFilePayload,
  type IdentityIdentityFileUpdatedEvent,
  // Phase 72 Plan 01: identity-scope wakeup CRUD wire types.
  // Phase 90 Plan 90-06: role-scope wire types removed — role scope moves to RoleModal.
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
// Phase 79 Plan 07 — Telegram bridge tab (identity-scope, fixed real-estate
// per CONTEXT § Locked decisions #2). TelegramState is threaded from a
// useState slot in this component and reset on modal open/identity switch.
import { TelegramTab, type TelegramState } from "./TelegramTab";
// Phase 79 Plan 07 (blocker W-3) — resolve the authenticated user's userId
// on modal open so we can pass it as humanUserId to TelegramTab. Mirrors the
// AppShell.tsx:412 / FullScreenAppWrapper.tsx:43 / LoginPage.tsx pattern for
// the same source of truth.
import { getUserInfo } from "@/main-axios";

// Phase 90 Plan 90-06 (D-09): identity modal is now identity-scope only.
// Post-Phase-90-06 nav sections: Identity file / Wakeups / Telegram. All
// role-scope surfaces (Role file / Runbooks / Bounties / Role-Wakeups)
// moved to the new RoleModal component (Plan 90-04). The segmented
// Role/Identity scope switch is deleted; ModalScope store retired.
//
// Patch #17g: parallel fetch of artifacts (identity file, wakeups) on modal
// open; tab renderers extracted to sibling files (IdentityFileTab /
// WakeupsTab). Patch #92: hostId prop threads pane host to backend for
// cross-machine identity reads.
//
// Opens on click of the lg IdentityBadge in PrettyView (Task 3). Modal uses
// the same glass tokens as the IdentityBadge lg branch (D-05): same
// gradient/backdrop-blur/border/shadow family so the badge appears to
// "expand" to fill the surface. shadcn DialogContent base overrides use `!`
// important suffix per patch #81 rule (D-06).

// Phase 90 Plan 90-06 (D-04): clickable title-line span.
//
// D-04 exact spec: cursor:pointer + color #c4b89a + dotted underline
// (rgba(196, 184, 154, 0.35) at 2px offset) + trailing chevron `›` span with
// marginLeft:3, opacity:0.7, transition 120ms. On hover: color #f0ebe0,
// decoration solid, decoration-color rgba(240, 235, 224, 0.6), chevron
// opacity 1. Native `title` attribute `Open role modal: <role-display-name>`.
// Keyboard: Enter/Space activate.
//
// Implemented as a role="button" span (rather than <button>) so it can sit
// inside the flex column above as a text element without breaking the
// truncate class. Matches the panel-menu hover-flip pattern from
// PrettyConversationsPanel.tsx L2061-2062 — no pseudo-classes, inline
// style flips via onMouseEnter/onMouseLeave.
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
  /** patch #92: pane's SSH host id — threads into all WS requests for cross-machine reads. */
  hostId: number;
  /** Phase 90 Plan 90-06 (D-04): fired when the title-line span (or displayName
   *  fallback) is clicked. Parent (PrettyView) owns swap-not-stack coordination —
   *  the click handler in this modal calls onOpenChange(false) at the same tick
   *  onOpenRoleModal fires, so the parent's handler only needs to open the role
   *  modal (no double-close). Guard branch: when identity.role is null, the
   *  title-line renders un-decorated and this prop is not invoked (defensive). */
  onOpenRoleModal: (identity: Identity) => void;
  /** patch #108: DOM element to portal into (chat-content region of PrettyView) so the modal
   *  covers only bubbles/tasks/shells and leaves the composer + identity badge uncovered.
   *  When null (transient first render), Portal defaults to document.body — harmless because
   *  the modal doesn't open until the user clicks the IdentityBadge, by which point the ref
   *  has been set. Container must be `position: relative` for absolute positioning to resolve. */
  container?: HTMLElement | null;
}) {
  // Phase 90 Plan 90-06 (D-09): identity modal is identity-scope only.
  // The segmented scope switch, its useModalScope memory, the scope-conditional
  // activeTab reset, the bounties list + archive state, and the refetchKey are
  // all DELETED — those belonged to role-scope tabs that now live in RoleModal.
  // Default landing tab: "identity" (was scope-derived).
  const [activeTab, setActiveTab] = useState<string>("identity");

  // Quick 260731-1c8: inline editor state for the Identity tab.
  // titleDraft: controlled value for the title <input>.
  // committedTitle: the last successfully saved (or initial) title, used to
  //   determine if the draft differs from server truth (drives Save disabled state).
  //   Updates to `updated.title` on save success; resets to identity.title on open.
  // avatarFile: the picked File to upload on Save (null = no new file picked).
  // avatarPreviewUrl: object URL for the picked file (revoked on cleanup/cancel/save).
  // saving: true while the PUT is in-flight (disables Save + Cancel).
  // saveError: inline error string from the server, null when clean.
  // Phase 86 Plan 86-05 (D-CTX-86-surface-5): draft state seeded from the
  // RESOLVED value (identity ?? role default) so the inherit-state input
  // shows the role's value pre-populated — the wearer sees what they're
  // currently displaying. committed* still tracks the identity's OWN value
  // (title === null means "inherit from role"); the save-side predicate at
  // L1789 compares draft-against-role-default (via titleReverting) rather
  // than draft-against-committed when a field is inherited-and-unmodified.
  const [titleDraft, setTitleDraft] = useState<string>(
    identity.title ?? identity.roleDefaults?.title ?? "",
  );
  const [committedTitle, setCommittedTitle] = useState<string>(identity.title ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Patch #223: voice picker state (voices/sampleAudioRef/sampleUrlRef moved to VoicePicker)
  // Phase 86 Plan 86-05: voiceDraft seeded from resolved value so VoicePicker's
  // sample-play button plays the currently-displayed voice.
  const [voiceDraft, setVoiceDraft] = useState<string>(
    identity.voice ?? identity.roleDefaults?.voice ?? "",
  );
  const [committedVoice, setCommittedVoice] = useState<string | null>(identity.voice ?? null);
  // Patch #279: colorHue picker state — fall back to prop hue when identity.colorHue is null
  // Phase 86 Plan 86-05: hueDraft seeded from resolved value; identity.colorHue
  // still takes precedence, then role default, then prop hue as last-resort.
  const [hueDraft, setHueDraft] = useState<number>(
    identity.colorHue ?? identity.roleDefaults?.colorHue ?? hue,
  );
  const [committedHue, setCommittedHue] = useState<number>(identity.colorHue ?? hue);
  // Phase 86 Plan 86-05 (D-CTX-86-surface-5): per-field revert-pending state.
  // True iff the user clicked "Revert to role default" on that field this
  // edit session and has not saved yet. Any true value marks the Save button
  // dirty (revert-of-an-unmodified-field IS a dirty change — the save sends
  // meta.<field> = null which the backend PUT L563-574 translates to a
  // frontmatter-key delete). Reset on modal open / Cancel / Save success.
  const [titleReverting, setTitleReverting] = useState<boolean>(false);
  const [voiceReverting, setVoiceReverting] = useState<boolean>(false);
  const [hueReverting, setHueReverting] = useState<boolean>(false);
  const [avatarReverting, setAvatarReverting] = useState<boolean>(false);
  // Quick 260811-ax1: "Stays awake" switch — null = loading, boolean = loaded.
  const [staysAwake, setStaysAwake] = useState<boolean | null>(null);
  const [staysAwakeSaving, setStaysAwakeSaving] = useState<boolean>(false);

  // Patch #191: bottom icon-bar nav for section switching (Telegram-shape).
  //
  // Phase 90 Plan 90-06 (D-09): the two per-scope NAV_SECTIONS variants collapse
  // to a single NAV_SECTIONS array — role-scope entries (Role file / Runbooks /
  // Bounties / Role-Wakeups) migrated to RoleModal (Plan 90-04). Post-Phase-90-06
  // labels are just plain "Identity file" / "Wakeups" / "Telegram" — no
  // scope-disambiguating prefix needed since scope switch is gone.
  const NAV_SECTIONS = [
    { value: "identity", label: "Identity file", Icon: User },
    { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
    // Phase 79 Plan 07 — Telegram bridge tab (CONTEXT § 2 fixed real-estate).
    { value: "telegram", label: "Telegram", Icon: Send },
  ] as const;

  // Patch #17g: independent state slots for each artifact tab.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  // Phase 90 Plan 90-06: identity-scope wakeups state (role-scope roleWakeupsState
  // moved to RoleModal). Kept name for symmetry with the identity-wakeups tab value.
  const [identityWakeupsState, setIdentityWakeupsState] = useState<TabState<Wakeup[]>>({ status: "loading" });
  // Phase 79 Plan 07 — Telegram bridge tab state. Fetched on modal open via
  // getTelegramStatus (see effect below).
  const [telegramState, setTelegramState] = useState<TelegramState>({ status: "loading" });
  // Phase 79 Plan 07 (blocker W-3) — authenticated user's userId. Sourced
  // from getUserInfo() on modal open (mirrors AppShell.tsx:412 pattern).
  // Empty string until fetch resolves; TelegramTab's Submit gates on non-
  // empty. Backend re-verifies via authenticateJWT.req.userId — even a
  // spoofed empty humanUserId gets rejected there (Plan 03 T-79-03-01).
  const [authUserId, setAuthUserId] = useState<string>("");

  const wsRef = useRef<WebSocket | null>(null);

  // Phase 90 Plan 90-06 (D-09): initial-fetch effect drastically simplified —
  // only 2 parallel fetches now (identity file + identity-scope wakeups).
  // The bounties WS request, role-file WS request, role-scope wakeups WS
  // request, and the loadArchivedBounties lazy loader all migrated to
  // RoleModal (Plan 90-04). Independent state slots so one broken artifact
  // doesn't take down the other.
  useEffect(() => {
    if (!open || !identity.identityKey) return;

    // Reset artifact state slots to loading.
    setIdentityFileState({ status: "loading" });
    setIdentityWakeupsState({ status: "loading" });
    // Phase 79 Plan 07 — reset Telegram tab state + authUserId on modal
    // open / identity switch. Effects below re-fetch both.
    setTelegramState({ status: "loading" });
    setAuthUserId("");

    let cancelled = false;

    // Patch #17g: one-shot helper. Opens its own WS, sends request on open,
    // resolves on first matching response.
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
        try { sock.send(JSON.stringify(request)); } catch { /* ignore */ }
      };
      sock.onmessage = (event: MessageEvent<string>) => {
        if (cancelled || responded) return;
        try {
          const raw = JSON.parse(event.data) as { type?: string };
          if (raw.type !== expectedType) return;
          responded = true;
          onSuccess(raw as Res);
          try { sock.close(); } catch { /* ignore */ }
        } catch { /* ignore */ }
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
      { type: "identity:get-identity-file", identityKey: identity.identityKey, hostId, },
      "identity:identity-file",
      (ev) => setIdentityFileState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
      { type: "identity:list-wakeups", identityKey: identity.identityKey, hostId, },
      "identity:wakeups",
      (ev) => setIdentityWakeupsState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.wakeups }),
      (e) => setIdentityWakeupsState({ status: "error", error: e }),
    );

    return () => {
      cancelled = true;
      for (const sock of artifactSockets) {
        try { sock.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity.identityKey, hostId]);

  // Quick 260731-1c8: reset editor state on fresh open or identity switch.
  // Revokes any prior avatarPreviewUrl to avoid memory leaks; resets
  // titleDraft + committedTitle to server truth and clears avatarFile + saveError
  // so the editor is clean on each open.
  useEffect(() => {
    if (!open) return;
    // Phase 86 Plan 86-05: draft seeded from RESOLVED value so inherit-state
    // pre-populates from the role. committed* still tracks the identity's
    // OWN value (null = inherit).
    setTitleDraft(identity.title ?? identity.roleDefaults?.title ?? "");
    setCommittedTitle(identity.title ?? "");
    setAvatarFile(null);
    setSaveError(null);
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return null;
    });
    // Patch #223: reset voice draft on open/identity switch
    // Phase 86 Plan 86-05: seed from resolved value.
    setVoiceDraft(identity.voice ?? identity.roleDefaults?.voice ?? "");
    setCommittedVoice(identity.voice ?? null);
    // Patch #279: reset hue draft on open/identity switch
    // Phase 86 Plan 86-05: seed from resolved value.
    setHueDraft(identity.colorHue ?? identity.roleDefaults?.colorHue ?? hue);
    setCommittedHue(identity.colorHue ?? hue);
    // Phase 86 Plan 86-05: clear all revert-pending flags on fresh open /
    // identity switch — the modal starts each session with no pending
    // reverts (the identity's disk-side state is the baseline).
    setTitleReverting(false);
    setVoiceReverting(false);
    setHueReverting(false);
    setAvatarReverting(false);
  // Phase 68 Plan 04: identity.id removed from type; identityKey is the
  // canonical "which identity are we editing" signal (disk-authoritative key).
  // Phase 86: added roleDefaults.title/voice/colorHue to the dep list so the
  // draft re-seeds when the role's defaults change under a live modal (e.g.,
  // WS-driven identity refresh on another tab).
  }, [
    open,
    identity.identityKey,
    identity.title,
    identity.voice,
    identity.colorHue,
    identity.roleDefaults?.title,
    identity.roleDefaults?.voice,
    identity.roleDefaults?.colorHue,
  ]);

  // Cleanup: revoke the preview URL when the modal is unmounted mid-edit.
  useEffect(() => {
    return () => {
      setAvatarPreviewUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return null;
      });
    };
  }, []);

  // Quick 260811-ax1: load the stays-awake sentinel state on modal open or identity/host change.
  useEffect(() => {
    if (!open || !identity.identityKey) return;
    setStaysAwake(null);
    setStaysAwakeSaving(false);
    let cancelled = false;
    getIdentityNoDormancy(identity.identityKey, hostId).then(
      (present) => { if (!cancelled) setStaysAwake(present); },
      () => {
        if (!cancelled) {
          setStaysAwake(null);
          toast.error("Failed to read stays-awake state");
        }
      },
    );
    return () => { cancelled = true; };
  }, [open, identity.identityKey, hostId]);

  // Phase 79 Plan 07 (blocker W-3) — resolve the authenticated user's userId
  // once per modal open. Same mechanism AppShell.tsx:412 uses at app root.
  // Identity switches inside the same session reuse the userId (getUserInfo
  // hits /users/me which is JWT-cookie-authenticated so it's fast).
  //
  // On failure: authUserId stays empty, TelegramTab renders the "couldn't
  // verify session" hint + disabled Submit. Other tabs (Identity file /
  // Wakeups / Handoff) handle their own auth via the WebSocket path — no
  // change to them.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getUserInfo();
        if (cancelled) return;
        setAuthUserId(info.userId);
      } catch (err) {
        if (cancelled) return;
        // Non-fatal for the modal open. Do NOT toast — the missing session
        // is surfaced inside the Telegram tab where it actually matters.
        console.warn("IdentityModal: getUserInfo failed", err);
        setAuthUserId("");
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Phase 79 Plan 07 — fetch initial Telegram bridge status on modal open /
  // identity switch. Dynamic import keeps the modal chunk lean.
  useEffect(() => {
    if (!open || !identity.identityKey) return;
    let cancelled = false;
    (async () => {
      const { getTelegramStatus } = await import("../../api/telegram-api");
      const result = await getTelegramStatus(identity.identityKey);
      if (cancelled) return;
      if (result.status === "error") {
        setTelegramState({ status: "error", error: result.error });
      } else if (result.status === "connected") {
        setTelegramState({
          status: "connected",
          botUsername: result.botUsername,
          // Filled in once we learn the human's TG handle via chat_id lookup
          // (deferred to a later plan — the wire response today carries only
          // botUsername + telegramChatId; humanHandle resolution is a follow-
          // up). "unknown" is a placeholder that CONTEXT § 3A's minimal
          // connected view still reads cleanly.
          telegramHandle: "unknown",
        });
      } else {
        setTelegramState({ status: "unconfigured" });
      }
    })();
    return () => { cancelled = true; };
  }, [open, identity.identityKey]);

  // Phase 90 Plan 90-06: bounty grouping / `grouped` memo DELETED — bounties
  // moved to RoleModal via RoleBountiesTab (Plan 90-04 Task 2).

  // Patch #154: one-shot mutation helper. Opens a WS, sends the mutation,
  // resolves with the fresh list from the server response. Mirrors the
  // openOneShot read helper's shape but returns a Promise so the caller
  // (per-card save button) can await + surface errors inline.
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
        try { sock.close(); } catch { /* ignore */ }
        if (val instanceof Error) reject(val);
        else resolve(val);
      };
      sock.onopen = () => {
        try { sock.send(JSON.stringify(request)); } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
      };
      sock.onmessage = (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data) as { type?: string };
          if (raw.type !== expectedType) return;
          finish(raw as Res);
        } catch { /* ignore */ }
      };
      sock.onerror = () => finish(new Error("Connection failed"));
      sock.onclose = () => finish(new Error("Connection closed before response"));
    });
  }

  async function updateWakeup(
    wakeupSlug: string,
    // Quick 260731-2pa: signature widened to also accept `name` +
    // `instruction`. Form-based wakeup editor writes the full spec on Save.
    // Server-side payload assembly + sendIdentityMutation are already generic.
    updates: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string },
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
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
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  // Phase 72 Plan 03: identity-scope create handler. Consumed by the
  // WakeupsTab under Identity scope; the sub-modal (AddWakeupDialog from
  // Wave 2) hands us a WakeupSpecWire — we route it through the WS handler
  // added in Plan 01. Reject-on-error semantics let AddWakeupDialog surface
  // the reason inline without closing.
  async function createIdentityWakeup(spec: WakeupSpecWire): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
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
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  // Phase 72 Plan 03: identity-scope delete handler. Byte-shape mirror of
  // createIdentityWakeup; server responds with the fresh list post-delete.
  async function deleteIdentityWakeup(wakeupSlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
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
    if (res.error) throw new Error(res.error);
    setIdentityWakeupsState({ status: "ready", data: res.wakeups });
  }

  // Phase 90 Plan 90-06 (D-09): role-scope wakeup CRUD handlers (updateRoleWakeup,
  // createRoleWakeup, deleteRoleWakeup) DELETED — coverage moved to RoleModal
  // (Plan 90-04).

  // Phase 18 / IDMEDIT-01: save handler for the identity file (<key>.md).
  // Byte-shape mirror of updateWakeup — sendIdentityMutation generic, throws on
  // res.error, replaces state from server echo (T-18-12 mitigation).
  async function updateIdentityFile(contents: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateIdentityFilePayload = {
      type: "identity:update-identity-file",
      identityKey: identity.identityKey,
      hostId,
      contents,
    };
    const res = await sendIdentityMutation<IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent>(
      payload,
      "identity:identity-file-updated",
    );
    if (res.error) throw new Error(res.error);
    setIdentityFileState({ status: "ready", data: res.markdown });
  }

  // Phase 90 Plan 90-06 (D-09): updateRoleFile DELETED — coverage moved to
  // RoleModal (Plan 90-04) which uses updateRoleFileByName (role-name-keyed
  // WS wire type from Plan 90-03).

  // Quick 260811-ax1: toggle handler for the "Stays awake" switch.
  // Optimistic update: flip state immediately, revert on error + toast.
  async function onStaysAwakeToggle(next: boolean): Promise<void> {
    const prev = staysAwake;
    setStaysAwake(next);
    setStaysAwakeSaving(true);
    try {
      const confirmed = await setIdentityNoDormancy(identity.identityKey, hostId, next);
      setStaysAwake(confirmed);
    } catch {
      setStaysAwake(prev);
      toast.error("Failed to update stays-awake");
    } finally {
      setStaysAwakeSaving(false);
    }
  }

  // Phase 90 Plan 90-06 (D-09): all bounty mutation handlers (updateBountyPriority,
  // updateBountyStatus, updateBountyPinned, updateBountyNeedsDesk, updateBountyFields,
  // archiveBounty, deleteBounty) DELETED — coverage moved to RoleBountiesTab
  // (Plan 90-04 Task 2). The `sortedArchive`, `hasOpen`, `hasArchive`, and
  // bounty-query filter derivations went with them.

  // Quick 260731-1c8: Identity-tab editor handlers.

  // onAvatarPick: reads the picked file, revokes any prior object URL, sets new
  // avatarFile and avatarPreviewUrl. NOTE: no client-side preflight on size or
  // mime — the server is the source of truth; its error strings flow through
  // inline per the plan spec.
  function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return URL.createObjectURL(file);
    });
    setAvatarFile(file);
  }


  // onSave: calls updateIdentity with the current draft title + picked file,
  // then broadcasts the fresh identity via applyIdentityChange so all
  // useIdentities() consumers (IdentityBadge, SessionRow, PrettyConversationRow,
  // RelayInboundBubble) re-render without a manual refresh.
  async function onSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      // Only include title in the meta payload if it differs from last-committed truth.
      const meta: Record<string, unknown> = {};
      // Phase 86 Plan 86-05 (D-CTX-86-surface-5): explicit-null wins over
      // draft-vs-committed diffing when a revert is pending. The backend PUT
      // handler L563-574 treats null as REMOVE the frontmatter key (identity
      // falls back to inheriting from the role). Revert path takes precedence
      // because the user clicked the revert affordance — even if the current
      // draft happens to equal the role default numerically, presence of the
      // key in identity frontmatter would still count as an override.
      //
      // For the SET branch (draft differs from what we started with), compare
      // draft against the RESOLVED baseline (identity's own value if set, else
      // role default). This prevents redundant overrides for fields that
      // inherit-and-were-pre-populated-from-role: on modal open we seed
      // titleDraft = "Box maintainer" (role default) when identity.title is
      // null, so a naive draft-vs-committed check would incorrectly emit
      // meta.title = "Box maintainer" (creating a redundant override) even
      // when the user never touched the field. Comparing against the resolved
      // baseline instead correctly no-ops.
      // Resolved baseline uses committed* (identity's own value) OR role
      // default. Consistent with the dirty predicate + inherit detection
      // above — all three read the same source of truth so the modal's
      // internal state stays coherent after save-with-revert even before
      // the parent's identity prop re-renders.
      const titleResolvedInitial =
        (committedTitle !== "" ? committedTitle : identity.roleDefaults?.title) ?? "";
      const voiceResolvedInitial =
        (committedVoice ?? identity.roleDefaults?.voice) ?? "";
      const hueResolvedInitial =
        identity.colorHue ?? identity.roleDefaults?.colorHue ?? hue;
      if (titleReverting) {
        meta.title = null;
      } else if (titleDraft !== titleResolvedInitial) {
        meta.title = titleDraft.trim() === "" ? null : titleDraft;
      }
      // Patch #223: include voice if it changed
      if (voiceReverting) {
        meta.voice = null;
      } else if (voiceDraft !== voiceResolvedInitial) {
        meta.voice = voiceDraft === "" ? null : voiceDraft;
      }
      // Patch #279: include colorHue if it changed
      if (hueReverting) {
        meta.colorHue = null;
      } else if (hueDraft !== hueResolvedInitial) {
        meta.colorHue = hueDraft;
      }
      // 260909-dls: avatar-revert wire — backend PUT handler deletes the
      // identity's `avatar:` frontmatter key + sibling file on disk (see
      // src/backend/database/routes/identities.ts null-delete branch).
      // Post-revert GET falls back to the role's avatar via Phase 86 Plan 86-01.
      if (avatarReverting) {
        meta.avatar = null;
      }
      // Phase 66 Plan 66-02: thread the modal's existing hostId prop into
      // updateIdentity — the backend PUT handler now uses it to route the
      // disk-write to the identity's home box via the artifact-reader.
      // Phase 68 Plan 04: first arg is now identityKey (was identity.id).
      const updated = await updateIdentity(identity.identityKey, meta, avatarFile, hostId);
      // Patch #279: GET-verify guard — Skynet's multipart handler has been known to silently
      // no-op on the `data` field when middleware order gets misconfigured. Defensive check:
      // if we sent a colorHue change but the server echo doesn't reflect it, surface an inline
      // error instead of trusting the 200. Only guards colorHue changes (title/voice already
      // have their own draft-vs-echo recovery paths via setCommittedTitle/setCommittedVoice).
      // Phase 86 Plan 86-05: bypass the guard for the revert path. When we
      // sent meta.colorHue = null, the backend's publicIdentity merge
      // returns updated.colorHue = role's colorHue (not null) — the guard
      // would otherwise fire spuriously. In the revert-success case the
      // identity's frontmatter key is deleted (correct behavior); the
      // resolved value coming back is the role's default (also correct).
      if (
        meta.colorHue !== undefined &&
        !hueReverting &&
        updated.colorHue !== meta.colorHue
      ) {
        setSaveError(`Server did not persist colorHue (sent ${meta.colorHue as number}, got ${updated.colorHue ?? "null"})`);
        return;
      }
      applyIdentityChange(updated);
      // Revoke old preview URL; fall back to the freshly-etag-busted server URL.
      setAvatarPreviewUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return null;
      });
      setAvatarFile(null);
      // Phase 86 Plan 86-05: after save, drafts re-seed from the RESOLVED
      // value (identity ?? role default) so reverted fields display the
      // role's value with the Inherited marker on next edit-block open.
      // committed* still tracks the identity's own value (updated.title
      // being null after a revert = identity has no title = inherit).
      const newIdentityTitle = updated.title ?? null;
      setTitleDraft(newIdentityTitle ?? updated.roleDefaults?.title ?? "");
      // Update committedTitle so the Save button correctly re-disables when
      // draft === saved truth (even if the identity prop hasn't re-rendered yet).
      setCommittedTitle(newIdentityTitle ?? "");
      // Patch #223: update committed voice
      setCommittedVoice(updated.voice ?? null);
      setVoiceDraft(updated.voice ?? updated.roleDefaults?.voice ?? "");
      // Patch #279: update committed hue from server echo
      setCommittedHue(updated.colorHue ?? hueDraft);
      setHueDraft(updated.colorHue ?? updated.roleDefaults?.colorHue ?? hueDraft);
      // Phase 86 Plan 86-05: reset revert-pending flags on save success.
      setTitleReverting(false);
      setVoiceReverting(false);
      setHueReverting(false);
      setAvatarReverting(false);
      setSaveError(null);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // onCancel: discards unsaved drafts back to last-committed server truth,
  // revokes the preview URL, clears the inline error. Does NOT close the modal.
  function onCancel(): void {
    // Phase 86 Plan 86-05: reset drafts to the RESOLVED value (identity ?? role
    // default) so cancelling a partial edit reverts to what the wearer sees
    // in read mode. committed* still tracks the identity's OWN value; when
    // identity.title is null the resolved value is the role default.
    setTitleDraft(committedTitle || identity.roleDefaults?.title || "");
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return null;
    });
    setAvatarFile(null);
    setSaveError(null);
    // Patch #223: revert voice draft
    setVoiceDraft(committedVoice ?? identity.roleDefaults?.voice ?? "");
    // Patch #279: revert hue draft
    // Phase 86 Plan 86-05: prefer identity's own colorHue (via committedHue)
    // when set, else the role default, else the prop hue fallback. This
    // matches the initial-seed logic + dirty-predicate resolved-baseline so
    // Cancel correctly restores to a state where the Save button is disabled.
    setHueDraft(identity.colorHue ?? identity.roleDefaults?.colorHue ?? hue);
    // Phase 86 Plan 86-05: clear revert-pending flags on Cancel.
    setTitleReverting(false);
    setVoiceReverting(false);
    setHueReverting(false);
    setAvatarReverting(false);
    setEditing(false);
  }

  // Phase 86 Plan 86-05 (D-CTX-86-surface-5): per-field inherit vs override
  // detection for the edit block. Reads committed* state (the identity's OWN
  // value, refreshed on save success) rather than the identity prop directly
  // — this handles the case where a save-with-revert flips the identity's
  // own value to null-inheriting BEFORE the parent's identity prop re-renders
  // (in production applyIdentityChange broadcasts + parent re-renders; in
  // tests the mock breaks that chain, but committed* still reflects truth).
  //
  //   *Inherited (badge visible) — identity's own value is absent AND role
  //     has a default. `titleReverting` also flips to inherited state
  //     optimistically while a Revert click is pending, so the wearer sees
  //     the imminent shape before Save fires.
  //   *Set (Revert affordance visible) — identity has its own value.
  //     Suppressed while `*Reverting === true` (the field is transitioning
  //     to inherited).
  const roleDefaultTitle = identity.roleDefaults?.title;
  const roleDefaultVoice = identity.roleDefaults?.voice;
  const roleDefaultHue = identity.roleDefaults?.colorHue;
  const roleDefaultAvatar = identity.roleDefaults?.avatar;
  const titleInherited =
    titleReverting ||
    (committedTitle === "" && roleDefaultTitle !== undefined);
  const titleSet = !titleReverting && committedTitle !== "";
  const voiceInherited =
    voiceReverting ||
    (committedVoice === null && roleDefaultVoice !== undefined);
  const voiceSet = !voiceReverting && committedVoice !== null;
  // Color: committedHue defaults to the `hue` prop when identity.colorHue is
  // null (existing behavior), so we can't use "committedHue !== fallback" as
  // the has-own-value signal. Read the identity prop directly for color.
  const hueInherited =
    hueReverting ||
    (identity.colorHue === null && roleDefaultHue !== undefined);
  const hueSet = !hueReverting && identity.colorHue !== null;
  // Avatar heuristic per plan Task 1 Step 5 fallback: always show revert
  // affordance when role has an avatar (server no-ops the delete if the
  // identity's frontmatter avatar key was already absent).
  const avatarRevertAvailable =
    !avatarReverting && typeof roleDefaultAvatar === "string" && roleDefaultAvatar.length > 0;
  const avatarInherited =
    typeof roleDefaultAvatar === "string" && roleDefaultAvatar.length > 0 && avatarReverting;

  // Small render helper for the "Inherited from role" badge. Aria-label
  // encodes the resolved value so screen readers + tests can identify
  // which field's marker they're looking at.
  function renderInheritedBadge(value: string | number | null | undefined): React.ReactNode {
    if (value === null || value === undefined) return null;
    return (
      <span
        aria-label={`Inherited from role: ${value}`}
        className="text-[10px] uppercase tracking-wide"
        style={{
          background: "rgba(255,220,170,0.10)",
          border: "1px solid rgba(255,220,170,0.25)",
          borderRadius: 4,
          padding: "1px 6px",
          color: "rgba(255,220,170,0.75)",
          marginLeft: 8,
        }}
      >
        Inherited
      </span>
    );
  }

  // Small render helper for the "Revert to role default" affordance.
  function renderRevertButton(fieldLabel: string, onRevert: () => void): React.ReactNode {
    return (
      <button
        type="button"
        aria-label={`Revert ${fieldLabel} to role default`}
        title={`Revert ${fieldLabel} to role default`}
        className="text-[10px] uppercase tracking-wide cursor-pointer"
        style={{
          background: "rgba(140,180,255,0.08)",
          border: "1px solid rgba(140,180,255,0.25)",
          borderRadius: 4,
          padding: "1px 6px",
          color: "rgba(180,205,255,0.85)",
          marginLeft: 8,
        }}
        onClick={onRevert}
        disabled={saving}
      >
        Revert
      </button>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/* Patch #108: Portal into the chat-content region container (passed in
          from PrettyView) instead of document.body. Content is
          absolute-positioned inside that container so it covers only the
          chat-bubble/tasks/shells region — composer at the bottom AND
          identity badge at the top stay uncovered. Container prop defaults
          to body when undefined (Radix behavior) — safe for the transient
          window before PrettyView's ref binds, since the modal is closed
          during that window. */}
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* Overlay is absolute-inset-0 relative to the container (chat region),
            not fixed-inset-0 relative to viewport.
            Patch #111: bumped z-40 → z-[110] so the overlay covers IdentityBadge
            (z-[101]). Without this the badge sat on top of the modal and its X
            button was unclickable while the modal was open. */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          data-slot="identity-modal-content"
          onInteractOutside={(e) => {
            // Patch #111f: preserve chat-content-region exposure. Radix's
            // DismissableLayer fires close-on-outside via TWO paths:
            // onPointerDownOutside (click outside content) AND onFocusOutside
            // (focus moves outside content — which happens the instant the
            // composer textarea receives focus from the click). onInteractOutside
            // is the umbrella event that fires for BOTH — preventDefault-ing
            // it here catches both close paths in one shot. Prior attempts:
            //   patch #111b: onPointerDownOutside only → focus stealer close
            //   patch #111e: modal={false} → composer clickable, but the
            //     focus-outside path (previously suppressed by focus-trap
            //     when modal=true) is now active and closes on composer focus
            //   patch #111f (this): onInteractOutside covers pointer AND
            //     focus paths → composer clickable + focus received + modal
            //     stays open. X + Esc remain valid dismissal paths (Escape
            //     is handled by DismissableLayer's onEscapeKeyDown which is
            //     NOT part of onInteractOutside).
            e.preventDefault();
          }}
          className={cn(
            // Absolute-positioned INSIDE the chat-region container. inset-4
            // = 16px padding on all sides so the modal doesn't butt against
            // the region's edges. z-[120] sits above the z-[110] overlay.
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`,
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
            boxShadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(${hue}, 65%, 55%, 0.2)`,
            color: "#e8e4d8",
          }}
        >
        {/* a11y: sr-only title for screen readers; visible header is the visual title */}
        <DialogTitle className="sr-only">
          Identity: {identity.displayName}
        </DialogTitle>

        {/* Header — patch #91: symmetric py-4 (was pt-5 pb-3 which pushed
            the avatar visually above center; Alice called out on first
            #90 deploy eyeball). */}
        <DialogHeader
          className="shrink-0"
          // Phase 67: watermark positioning host + bleed clip.
          // overflow:hidden CLIPS the watermark's vertical bleed (top:-32,
          // bottom:-32) AND its rightward bleed (right:-28). The scrollable
          // flex-row moves to an inner wrapper below so the header itself
          // stays clip-only (watermark) while the controls row can scroll
          // horizontally on narrow viewports (see inner wrapper comment).
          style={{
            position: "relative",
            overflow: "hidden",
            borderBottom: `1px solid hsla(${hue}, 50%, 50%, 0.2)`,
          }}
        >
          {/* Phase 67 Plan 67-02 Track C: coordinator watermark. Renders iff
              the identity's coordinator boolean is strictly-true (Phase 67
              Plan 67-01 backend contract — safe-default false when the
              identity's on-disk YAML has no coordinator key). Sized to
              match the IdentityBadge treatment (opacity 0.14, width 148,
              bleed -28/-32) — same larger-surface treatment per shape file.
              Non-interactive (pointer-events: none) — never fights the
              header's stays-awake switch / share picker / pencil-toggle /
              DialogClose wiring. Renders BEFORE the avatar so it sits
              earliest in DOM order (aria-hidden keeps it silent for screen
              readers); z-index 0 keeps paint order below primary header
              elements (which have explicit z-index: 1 per M4).
              Phase 67 /close 2026-09-01 follow-up (M2 + M3): SVG + style
              hoisted to the shared coordinator-watermark helper; watermark
              hue null-fallback unified to 216 across all three surfaces (was
              the `hue` prop here, which arrives from PrettyView as
              `identity.colorHue ?? 35` — mismatching the row's CSS 216
              default). Chrome hue (dialog border, glow, gradient) still
              uses the incoming `hue` prop above — that's a separate concern
              with a broader blast radius. */}
          {identity.coordinator === true && (
            <span
              aria-hidden="true"
              data-testid="coordinator-watermark"
              style={getCoordinatorWatermarkStyle(
                identity.colorHue ?? COORDINATOR_WATERMARK_HUE_FALLBACK,
                "modal",
              )}
            />
          )}
          {/* Scrollable inner row (Alice 2026-09-02 mobile fix): the header's
              children (avatar + name/title + stays-awake switch + pencil + close)
              have a natural minimum width that exceeds a phone viewport — the
              "Boost response time…" label alone is ~200px wide, and it sits
              alongside a 40px avatar + 36px pencil + 36px close (all shrink-0).
              Pre-fix, the row overflowed the outer overflow:hidden and clipped
              the close button on the right, stranding Alice with no way to
              dismiss the modal on mobile short of force-quitting the app.
              overflow-x-auto lets the row scroll horizontally when it doesn't
              fit, so the close button is always reachable via touch flick.
              px-6/py-4 moved from DialogHeader to here so padding stays inside
              the scroll area (avoids padding-collapse artifacts at scroll
              extents). The name/title's flex-1+min-w-0 still expands to fill
              free space on desktop and collapses first on narrow viewports —
              scroll only kicks in when the shrink-0 controls' aggregate width
              still exceeds container width after that collapse. */}
          <div className="px-6 py-4 flex flex-row items-center gap-3 overflow-x-auto">
          {/* Quick 260731-1c8: cache-bust the header avatar with &v=<avatarEtag>
              so that after applyIdentityChange fires with a new avatarEtag the
              browser fetches the fresh image instead of serving the stale cache.
              Phase 68 Plan 04: hostId is now baked into identity.avatarUrl by the
              backend; render identity.avatarUrl directly. Etag guard: when
              avatarEtag is the "" safe-default (disk-cosmetics absent), SKIP the
              &v= entirely rather than emitting a literal `&v=`. */}
          {/* Phase 67 /close 2026-09-01 follow-up (M4): explicit
              position: relative + zIndex: 1 on every DialogHeader primary
              sibling below pins them above the coordinator watermark's
              zIndex: 0. Previously relied on auto vs 0 emergent stacking —
              a future hover state that added zIndex: -1 or a container
              that set isolation: isolate could have flipped the watermark
              above primaries + broken the interactive controls (stays-
              awake switch, share picker, pencil, close button). Belt-and-
              suspenders: interactive controls also need a stacking context
              for their pointer events to reliably win over the watermark
              (which is pointerEvents: none, so this is defensive only). */}
          <img
            src={
              // Phase 68 Plan 04: avatarUrlWithHost deleted — backend bakes hostId into
              // identity.avatarUrl. Etag suffix uses `&` (not `?`) because avatarUrl
              // already ends with `?hostId=N`; etag becomes an additional query param.
              identity.avatarEtag
                ? `${identity.avatarUrl}&v=${identity.avatarEtag}`
                : identity.avatarUrl
            }
            alt=""
            className="shrink-0 object-cover"
            style={{
              position: "relative",
              zIndex: 1,
              width: 40,
              height: 40,
              borderRadius: "50%",
              boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
            }}
            draggable={false}
          />
          <div
            className="flex flex-col min-w-0 flex-1"
            style={{ position: "relative", zIndex: 1 }}
          >
            {/* Phase 90 Plan 90-06 (D-04): title-line clickable treatment.
                When identity.role !== null AND identity.title is present, the
                title span is a clickable element with dotted underline + chevron.
                When identity.title is null but role !== null, the displayName
                span itself gets the treatment (D-04 fallback). When role === null,
                nothing is clickable (defensive — no target to jump to).
                Click closes this modal AND fires onOpenRoleModal at the same tick
                (swap-not-stack per D-03 — PrettyView opens the role modal).
                See 90-CONTEXT.md D-04 for exact colors. */}
            {(() => {
              const canJumpToRole = identity.role !== null;
              const hasTitle =
                typeof identity.title === "string" && identity.title.length > 0;
              const jumpTargetLabel = identity.role ?? identity.displayName;
              return (
                <>
                  {hasTitle ? (
                    <span className="font-semibold text-base text-[#f0ebe0] truncate leading-tight">
                      {identity.displayName}
                    </span>
                  ) : canJumpToRole ? (
                    <TitleLineJumpToRole
                      identity={identity}
                      text={identity.displayName}
                      className="font-semibold text-base truncate leading-tight"
                      jumpTargetLabel={jumpTargetLabel}
                      onJump={() => {
                        onOpenChange(false);
                        onOpenRoleModal(identity);
                      }}
                    />
                  ) : (
                    <span className="font-semibold text-base text-[#f0ebe0] truncate leading-tight">
                      {identity.displayName}
                    </span>
                  )}
                  {hasTitle && canJumpToRole && (
                    <TitleLineJumpToRole
                      identity={identity}
                      text={identity.title as string}
                      className="text-xs truncate leading-tight"
                      jumpTargetLabel={jumpTargetLabel}
                      onJump={() => {
                        onOpenChange(false);
                        onOpenRoleModal(identity);
                      }}
                    />
                  )}
                  {hasTitle && !canJumpToRole && (
                    <span className="text-xs text-[#a89a80] truncate leading-tight">
                      {identity.title}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          {/* Quick 260811-ax1: "Stays awake" sentinel toggle. Switch checked =
              .no-dormancy sentinel present on the identity's host. Disabled
              while loading (null) or saving. */}
          <label
            className="shrink-0 flex flex-row items-center gap-2 cursor-pointer select-none"
            title="Toggle stays-awake sentinel for this identity"
            style={{ position: "relative", zIndex: 1 }}
          >
            <Switch
              checked={staysAwake === true}
              onCheckedChange={onStaysAwakeToggle}
              disabled={staysAwake === null || staysAwakeSaving}
              aria-label={`Toggle stays-awake for ${identity.displayName}`}
            />
            <span className="text-xs text-[#a89a80]">Boost response time (uses more memory)</span>
          </label>
          {/* Patch #277: pencil toggle button — reveals/hides the edit block.
              Matches close-button glass affordance (same size, border, glow
              recipe) but NOT wrapped in DialogClose — does not close the dialog. */}
          <button
            type="button"
            aria-label={editing ? "Done editing" : "Edit agent"}
            title={editing ? "Done editing" : "Edit agent"}
            className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center transition-[color,background-color,border-color,box-shadow] duration-200"
            style={{
              // Phase 67 M4: pin above coordinator watermark (z-index: 0).
              position: "relative",
              zIndex: 1,
              background: editing ? "rgba(255, 255, 255, 0.10)" : "rgba(255, 255, 255, 0.04)",
              border: editing ? "1px solid rgba(220, 225, 245, 0.22)" : "1px solid rgba(220, 225, 245, 0.10)",
              boxShadow: editing ? `0 0 20px hsla(${hue}, 60%, 50%, 0.25)` : "none",
              color: editing ? "#f0ebe0" : "#a89a80",
            }}
            onMouseEnter={(e) => {
              if (!editing) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
                e.currentTarget.style.boxShadow = `0 0 20px hsla(${hue}, 60%, 50%, 0.25)`;
                e.currentTarget.style.color = "#f0ebe0";
              }
            }}
            onMouseLeave={(e) => {
              if (!editing) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.color = "#a89a80";
              }
            }}
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="size-4" />
          </button>
          {/* Patch #91: close button glow-up. Was a ghost square with no
              rest-state visual weight ("pretty lame looking" per Alice
              on first #90 deploy eyeball). Now a proper glass pill with:
              - rest: subtle warm-glass fill + hairline border, muted icon
              - hover: brightens fill + border + icon, hue-tinted outer glow
                that echoes the header border-bottom's own hue.
              - cursor-pointer (Tailwind v4 dropped v3's button default).
              `!` on bg per patch #81 shadcn override rule (Button's base
              has dark: variants that would otherwise win specificity). */}
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              title="Close"
              className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
              style={{
                // Phase 67 M4: pin above coordinator watermark (z-index: 0).
                position: "relative",
                zIndex: 1,
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(220, 225, 245, 0.10)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
                e.currentTarget.style.boxShadow = `0 0 20px hsla(${hue}, 60%, 50%, 0.25)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <X className="size-4" />
            </button>
          </DialogClose>
          </div>
        </DialogHeader>

        {/* Header-level edit drawer (2026-08-05): the pencil in DialogHeader
            toggles this block. Lives ABOVE <Tabs> so editing works regardless
            of the active tab. Previous placement was inside <TabsContent
            value="identity">, which made the pencil appear to do nothing when
            clicked from the Role tab (Phase 22 SRIC-06 made Role the default). */}
        {editing && (
          <div
            className="shrink-0 px-6 pt-3 pb-4 border-b"
            style={{ borderBottomColor: "rgba(220, 225, 245, 0.10)" }}
          >
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)] mb-3">
              Edit agent
            </h3>

            {/* Avatar preview + file picker row */}
            {/* Phase 68 Plan 04: avatarUrlWithHost deleted — same etag-guard
                shape as the header avatar above. avatarPreviewUrl (blob: URL
                from a fresh file pick) takes precedence unchanged. */}
            <div className="flex items-center gap-3 mb-3">
              <img
                src={
                  // Phase 68 Plan 04: avatarUrlWithHost deleted — backend bakes hostId into
                  // identity.avatarUrl. Same etag-suffix pattern as the header avatar above.
                  avatarPreviewUrl ??
                  (identity.avatarEtag
                    ? `${identity.avatarUrl}&v=${identity.avatarEtag}`
                    : identity.avatarUrl)
                }
                alt=""
                className="shrink-0 object-cover"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
                }}
                draggable={false}
              />
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={onAvatarPick}
                  disabled={saving}
                />
                <Button
                  variant="outline"
                  size="sm"
                  asChild={false}
                  type="button"
                  className="cursor-pointer"
                  disabled={saving}
                  onClick={(e) => {
                    // Delegate click to the hidden file input inside the label.
                    // Prevent the label's default click from double-firing.
                    (e.currentTarget.parentElement?.querySelector("input[type='file']") as HTMLInputElement | null)?.click();
                  }}
                >
                  Change avatar…
                </Button>
              </label>
              {/* Phase 86 Plan 86-05 (D-CTX-86-surface-5): Avatar revert
                  affordance. Per plan Task 1 Step 5 fallback heuristic:
                  always visible when the role has an avatar (backend echo
                  doesn't currently surface per-field override maps, and the
                  server no-ops the delete if the identity's avatar
                  frontmatter key was already absent — safe to always show).
                  Clicking sets avatarReverting=true, clears any picked file,
                  and revokes the preview URL. The <img> src at L1799 already
                  serves the role's avatar as fallback (Plan 86-01 GET
                  /:key/avatar role-folder fallback), so no src rewiring
                  needed. */}
              {avatarRevertAvailable && renderRevertButton("Avatar", () => {
                setAvatarReverting(true);
                setAvatarPreviewUrl((prior) => {
                  if (prior) URL.revokeObjectURL(prior);
                  return null;
                });
                setAvatarFile(null);
              })}
              {avatarInherited && renderInheritedBadge(roleDefaultAvatar)}
            </div>

            {/* Title input */}
            {/* Phase 86 Plan 86-05 (D-CTX-86-surface-5): label row grows the
                inherit/override affordance strip. Inherited badge shows when
                the identity has no title AND the role has one (wearer sees
                what they're currently displaying); Revert button shows when
                the identity has its OWN title (wearer can undo the override
                in one click). Draft input still owns the value binding —
                clicking Revert flips the draft to the role default AND sets
                titleReverting=true so onSave emits meta.title = null. */}
            <div className="mb-3">
              <div className="flex items-center mb-1">
                <label
                  className="block text-xs text-[var(--color-pv-fg-muted)]"
                  htmlFor="identity-title-input"
                >
                  Title
                </label>
                {titleInherited && renderInheritedBadge(roleDefaultTitle)}
                {titleSet && roleDefaultTitle !== undefined && renderRevertButton("Title", () => {
                  setTitleReverting(true);
                  setTitleDraft(roleDefaultTitle ?? "");
                })}
              </div>
              <input
                id="identity-title-input"
                type="text"
                value={titleDraft}
                onChange={(e) => {
                  // Phase 86 Plan 86-05: user edit cancels the revert-pending
                  // state — they're overriding the role default again with
                  // whatever they're typing. Save-side wire flips back to a
                  // regular set (title with a value written to frontmatter).
                  setTitleReverting(false);
                  setTitleDraft(e.target.value);
                }}
                disabled={saving}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(220,225,245,0.15)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "#f0ebe0",
                  fontSize: "0.875rem",
                  outline: "none",
                }}
              />
            </div>

            {/* Patch #223: Voice picker (extracted to VoicePicker component) */}
            {/* Phase 86 Plan 86-05: parallel inherit/override strip for Voice.
                VoicePicker's `value` binds to the resolved draft (identity ??
                role) so its sample-play button plays the currently-displayed
                voice. Change handler clears voiceReverting for parity with
                title. */}
            <div className="mb-3">
              <div className="flex items-center mb-1">
                <label className="block text-xs text-[var(--color-pv-fg-muted)]" htmlFor="identity-voice-select">Voice</label>
                {voiceInherited && renderInheritedBadge(roleDefaultVoice)}
                {voiceSet && roleDefaultVoice !== undefined && renderRevertButton("Voice", () => {
                  setVoiceReverting(true);
                  setVoiceDraft(roleDefaultVoice ?? "");
                })}
              </div>
              <VoicePicker
                id="identity-voice-select"
                value={voiceDraft}
                onChange={(next) => {
                  setVoiceReverting(false);
                  setVoiceDraft(next);
                }}
                disabled={saving}
              />
            </div>

            {/* Patch #279: colorHue picker (extracted to ColorPicker component) */}
            {/* Phase 86 Plan 86-05: parallel inherit/override strip for Color.
                ColorPicker's `value` binds to the resolved draft; swatch
                reflects the currently-displayed hue. Change handler clears
                hueReverting for parity. */}
            <div className="mb-3">
              <div className="flex items-center mb-1">
                <label className="block text-xs text-[var(--color-pv-fg-muted)]" htmlFor="identity-hue-input">Color</label>
                {hueInherited && renderInheritedBadge(roleDefaultHue)}
                {hueSet && roleDefaultHue !== undefined && renderRevertButton("Color", () => {
                  setHueReverting(true);
                  setHueDraft(roleDefaultHue ?? hue);
                })}
              </div>
              <ColorPicker
                id="identity-hue-input"
                value={hueDraft}
                onChange={(next) => {
                  setHueReverting(false);
                  setHueDraft(next);
                }}
                disabled={saving}
              />
            </div>

            {/* Inline error */}
            {saveError && (
              <p className="text-sm text-[color:var(--color-pv-code-fg)] mb-3">
                Couldn&apos;t save: {saveError}
              </p>
            )}

            {/* Save + Cancel buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                disabled={(() => {
                  if (saving) return true;
                  // Phase 86 Plan 86-05: dirty predicate rebuilt to respect
                  // the inherit-vs-override model. Each field is dirty iff
                  // (a) the revert flag is on (user clicked Revert on a SET
                  // field — pending delete), OR (b) the draft differs from
                  // the RESOLVED baseline (identity's own committed value if
                  // set, else role default). Uses `committed*` (identity's
                  // own value, refreshed on save) so a save-with-revert
                  // correctly re-disables the button even when the parent
                  // identity prop hasn't re-rendered yet (test scenario;
                  // production sees a fresh prop via applyIdentityChange).
                  const titleResolved =
                    (committedTitle !== "" ? committedTitle : identity.roleDefaults?.title) ?? "";
                  const voiceResolved =
                    (committedVoice ?? identity.roleDefaults?.voice) ?? "";
                  // Color uses the identity prop because committedHue defaults
                  // to the `hue` prop when identity.colorHue is null (existing
                  // behavior — see L297).
                  const hueResolved =
                    identity.colorHue ?? identity.roleDefaults?.colorHue ?? hue;
                  const titleDirty = titleReverting || titleDraft !== titleResolved;
                  const voiceDirty = voiceReverting || voiceDraft !== voiceResolved;
                  const hueDirty = hueReverting || hueDraft !== hueResolved;
                  const avatarDirty = avatarReverting || avatarFile !== null;
                  return !(titleDirty || voiceDirty || hueDirty || avatarDirty);
                })()}
                onClick={() => { void onSave(); }}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                disabled={saving}
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Phase 90 Plan 90-06 (D-09): segmented Role/Identity scope switch
            DELETED. Identity modal is identity-scope only; role-scope tabs
            moved to RoleModal (Plan 90-04). Title-line clickable treatment
            (D-04) above provides the jump path to the role modal. */}

        {/* Tabs — Phase 90 Plan 90-06 post-refactor: 3 tabs (Identity file /
            Wakeups / Telegram) — identity scope only. Role file, Runbooks,
            Bounties, and Role-Wakeups all moved to RoleModal. */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          {/* Identity tab — patch #17g: renders <key>.md as markdown.
              Quick 260731-1c8: adds inline title + avatar editor ABOVE the markdown
              block. Editor exposes exactly two fields (title + avatar); displayName
              and colorHue are NOT exposed as editable here. */}
          <TabsContent
            value="identity"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            {/* Existing identity.md markdown preview — Phase 18 / IDMEDIT-01: onSave threaded */}
            <IdentityFileTab state={identityFileState} onSave={updateIdentityFile} />
          </TabsContent>

          {/* Phase 90 Plan 90-06 (D-09): Bounties tab DELETED — bounties
              moved to RoleBountiesTab under RoleModal (Plan 90-04 Task 2).
              The sticky-search input, group renderers, archive accordion, and
              lazy-load loader all migrated with it. */}
          {/* Wakeups tab — Phase 90 Plan 90-06: identity-scope only now.
              The parallel role-wakeups TabsContent moved to RoleModal. */}
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
          {/* Phase 90 Plan 90-06 (D-09): role-wakeups TabsContent DELETED —
              role-scope wakeups moved to RoleModal (Plan 90-04). Only the
              identity-wakeups TabsContent above remains in this modal. */}

          {/* Phase 79 Plan 07 — Telegram bridge tab (identity-scope only).
              humanUserId sourced from getUserInfo() in the useEffect above
              (blocker W-3 fix); empty until fetch resolves, which disables
              TelegramTab's Submit inside the component. */}
          <TabsContent
            value="telegram"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <TelegramTab
              state={telegramState}
              identityKey={identity.identityKey}
              identityName={identity.displayName ?? identity.identityKey}
              humanUserId={authUserId}
              onStateChange={setTelegramState}
            />
          </TabsContent>

          {/* Patch #191: bottom icon-bar section switcher (Telegram-shape). */}
          <div
            className="shrink-0 flex items-stretch justify-around px-2 py-1 border-t"
            style={{
              borderTopColor: "rgba(220, 225, 245, 0.10)",
              background: "linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            {NAV_SECTIONS.map(({ value, label, Icon }) => {
              const selected = activeTab === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1",
                    selected
                      ? "text-[#f0ebe0] font-semibold"
                      : "text-[#a89a80] hover:text-[#e8e4d8]",
                  )}
                  // 2026-08-05: hue-tinted glassy pill on the selected tab so
                  // it reads at-a-glance — brightness alone was too subtle.
                  style={
                    selected
                      ? {
                          background:
                            "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.18)",
                          boxShadow:
                            "inset 0 0 0 1px hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
                        }
                      : undefined
                  }
                >
                  <Icon size={18} />
                  {label}
                </button>
              );
            })}
          </div>
        </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
