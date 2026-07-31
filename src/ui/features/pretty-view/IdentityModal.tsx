import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Clock, Handshake, Target, User, Volume2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/accordion";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
// Quick 260727-tb1: piggyback path — when Ashley reprioritizes a bounty via
// the modal, invalidate the panel's cached pinned count for this identity
// so the .pv-bounty-badge refreshes immediately instead of waiting for the
// next 60s poll. The spec (Key design decision #5) calls for wiring this
// off the identity:bounty-priority-updated response; the modal is the
// natural placement because it owns both identityKey + hostId + the WS
// response callback (there is no shared identity:* listener elsewhere).
import { invalidateIdentity as invalidateBountyCount } from "@/state/bounty-counts-store";
// Quick 260731-1c8: add inline title + avatar editor to the Identity tab.
// updateIdentity is the existing PUT /identities/:id HTTP client; applyIdentityChange
// broadcasts the fresh identity to all useIdentities() consumers so live
// IdentityBadge / SessionRow / PrettyConversationRow / RelayInboundBubble
// re-render without a manual refresh.
import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { postSpeak, getVoices, SAMPLE_PHRASE } from "@/api/voice-api";
import {
  openClaudeSessionSocket,
  type Bounty,
  type BountyPriority,
  type BountyStatus,
  type IdentityBountiesEvent,
  type IdentityListBountiesPayload,
  type IdentityGetIdentityFilePayload,
  type IdentityIdentityFileEvent,
  type IdentityGetHistoryPayload,
  type IdentityHistoryEvent,
  type IdentityListWakeupsPayload,
  type IdentityWakeupsEvent,
  type IdentityGetHandoffPayload,
  type IdentityHandoffEvent,
  type IdentityUpdateWakeupPayload,
  type IdentityWakeupUpdatedEvent,
  type IdentityUpdateBountyPriorityPayload,
  type IdentityBountyPriorityUpdatedEvent,
  type IdentityUpdateBountyStatusPayload,
  type IdentityBountyStatusUpdatedEvent,
  type IdentityUpdateBountyPinnedPayload,
  type IdentityBountyPinnedUpdatedEvent,
  type IdentityArchiveBountyPayload,
  type IdentityBountyArchivedEvent,
  type IdentityDeleteBountyPayload,
  type IdentityBountyDeletedEvent,
  type Wakeup,
  // Phase 18 / IDMEDIT-01,02,03: markdown-tab write wire types from Plan 01
  type IdentityUpdateIdentityFilePayload,
  type IdentityIdentityFileUpdatedEvent,
  type IdentityUpdateHistoryPayload,
  type IdentityHistoryUpdatedEvent,
  type IdentityUpdateHandoffPayload,
  type IdentityHandoffUpdatedEvent,
} from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import { BountyCard } from "./BountyCard";
import { cn } from "@/lib/utils";
import { IdentityFileTab, type TabState } from "./IdentityFileTab";
import { HistoryTab } from "./HistoryTab";
import { WakeupsTab } from "./WakeupsTab";
import { HandoffTab } from "./HandoffTab";

// Patch #87: tabbed near-fullscreen modal for the identity's bounties.
// Patch #17g: renamed Standing Directives → Identity; promoted Identity to
//   position 1 + default active tab; parallel fetch of 4 new artifacts
//   (identity file, history, wakeups, handoff) on modal open; tab renderers
//   extracted to sibling files (IdentityFileTab / HistoryTab / WakeupsTab /
//   HandoffTab). Bounties tab structure and patch #87 attribution preserved.
// Patch #92: hostId prop threads pane host to backend for cross-machine identity reads.
//   All 5 WS request payloads now carry hostId; useEffect deps include hostId so
//   switching panes re-fetches against the correct host.
//
// Opens on click of the lg IdentityBadge in PrettyView (Task 3). Fetches
// bounties via a one-shot identity:list-bounties WS request (D-02). Closes
// the WS after the single response — no live subscription (D-13).
//
// Modal uses the same glass tokens as the IdentityBadge lg branch (D-05):
// same gradient/backdrop-blur/border/shadow family so the badge appears to
// "expand" to fill the surface. shadcn DialogContent base overrides use `!`
// important suffix per patch #81 rule (D-06).
//
// Five tabs: Identity (default) / Bounties / History / Wakeups / Handoff.
// Sort/group logic is client-side only (D-08, D-09). Archive section is a
// collapsed Accordion below the open groups (D-03).

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  unprioritized: 4,
};

// Patch #172: `pinned` is now an independent boolean field. Pinned bounties
// get their own top group (`pinned`) rendered above the in_progress fence
// regardless of status. Below that, in_progress keeps its fence; `rest`
// still collapses waiting_on_someone_else + anything else that's not
// in_progress + not done/dropped into one flat priority-sorted region (no
// header). done/dropped-in-place bounties still bucket to `other` with a
// quiet header so recently-closed work doesn't blend into open work.
const OPEN_STATUS_ORDER = ["pinned", "in_progress", "rest", "other"];

const GROUP_LABELS: Record<string, string> = {
  pinned: "Pinned", // patch #172: pinned-boolean global top group
  in_progress: "In Progress",
  rest: "", // patch #109: no header for the flat priority-sorted region
  other: "Other",
};

function priorityWeight(p: string): number {
  return PRIORITY_WEIGHT[p] ?? 4;
}

function sortBounties(bounties: Bounty[]): Bounty[] {
  return [...bounties].sort((a, b) => {
    const pd = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (pd !== 0) return pd;
    // updated_at desc (most recent first)
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

export function IdentityModal({
  open,
  onOpenChange,
  identity,
  hue,
  hostId,
  container,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
  hue: number;
  /** patch #92: pane's SSH host id — threads into all 5 WS requests for cross-machine reads. */
  hostId: number;
  /** patch #108: DOM element to portal into (chat-content region of PrettyView) so the modal
   *  covers only bubbles/tasks/shells and leaves the composer + identity badge uncovered.
   *  When null (transient first render), Portal defaults to document.body — harmless because
   *  the modal doesn't open until the user clicks the IdentityBadge, by which point the ref
   *  has been set. Container must be `position: relative` for absolute positioning to resolve. */
  container?: HTMLElement | null;
}) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [archivedBounties, setArchivedBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("identity");
  // refetchKey increments on Retry to re-trigger the fetch effect.
  const [refetchKey, setRefetchKey] = useState(0);

  // Quick 260731-1c8: inline editor state for the Identity tab.
  // titleDraft: controlled value for the title <input>.
  // committedTitle: the last successfully saved (or initial) title, used to
  //   determine if the draft differs from server truth (drives Save disabled state).
  //   Updates to `updated.title` on save success; resets to identity.title on open.
  // avatarFile: the picked File to upload on Save (null = no new file picked).
  // avatarPreviewUrl: object URL for the picked file (revoked on cleanup/cancel/save).
  // saving: true while the PUT is in-flight (disables Save + Cancel).
  // saveError: inline error string from the server, null when clean.
  const [titleDraft, setTitleDraft] = useState<string>(identity.title ?? "");
  const [committedTitle, setCommittedTitle] = useState<string>(identity.title ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Patch #223: voice picker state
  const [voices, setVoices] = useState<{ display_name: string; filename: string }[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<string>(identity.voice ?? "");
  const [committedVoice, setCommittedVoice] = useState<string | null>(identity.voice ?? null);
  // Sample playback refs
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);

  // Patch #191: bottom icon-bar nav for section switching (Telegram-shape).
  // Replaces the previous shadcn TabsList strip, which (a) aesthetically didn't
  // match Skynet's pretty-view visual language and (b) got CUT OFF on narrow
  // mobile viewports (w-auto self-start, no overflow handling). Bottombar is
  // mobile-safe by construction — 5 evenly-flexed slots + icon-first labels.
  // Tuner arc: list / dropdown / bottombar variants shipped in commit 8e35dae,
  // Ashley UAT'd all three, bottombar picked as the winner; this commit locks
  // it in and drops the tuner + losing variants.
  const NAV_SECTIONS = [
    { value: "identity", label: "Identity", Icon: User },
    { value: "bounties", label: "Bounties", Icon: Target },
    { value: "history", label: "History", Icon: Clock },
    { value: "wakeups", label: "Wakeups", Icon: AlarmClock },
    { value: "handoff", label: "Handoff", Icon: Handshake },
  ] as const;

  // Patch #17g: independent state slots for each new artifact tab.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  // Phase 18 / IDMEDIT-02: widened from TabState<string[]> to carry both
  // entries (read-mode list rendering) and markdown (edit-mode textarea seed).
  const [historyState, setHistoryState] = useState<TabState<{ entries: string[]; markdown: string }>>({ status: "loading" });
  const [wakeupsState, setWakeupsState] = useState<TabState<Wakeup[]>>({ status: "loading" });
  const [handoffState, setHandoffState] = useState<TabState<string>>({ status: "loading" });

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch bounties + 4 new artifacts when modal opens (or refetch key increments).
  // All 5 WS requests fire in parallel in a single useEffect — independent state
  // slots so one broken artifact does not take down the others.
  useEffect(() => {
    if (!open || !identity.identityKey) return;

    setLoading(true);
    setError(null);
    setBounties([]);
    setArchivedBounties([]);

    // Reset all 4 new artifact state slots to loading.
    setIdentityFileState({ status: "loading" });
    setHistoryState({ status: "loading" });
    setWakeupsState({ status: "loading" });
    setHandoffState({ status: "loading" });

    let cancelled = false;
    const ws = openClaudeSessionSocket();
    wsRef.current = ws;

    // Patch #17g: one-shot helper for the 4 new artifact fetches.
    // Opens its own WS, sends request on open, resolves on first matching response.
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

    // Existing bounties WS (patch #87/#92 — now includes hostId).
    ws.onopen = () => {
      if (cancelled) return;
      const payload: IdentityListBountiesPayload = {
        type: "identity:list-bounties",
        identityKey: identity.identityKey,
        hostId,
      };
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        /* ws may be mid-close */
      }
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (cancelled) return;
      let parsed: IdentityBountiesEvent;
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== "identity:bounties") return; // ignore unrecognized frames
        parsed = raw as IdentityBountiesEvent;
      } catch {
        return;
      }
      setBounties(parsed.bounties ?? []);
      setArchivedBounties(parsed.archivedBounties ?? []);
      if (parsed.error) setError(parsed.error);
      setLoading(false);
      // One-shot: close WS after receiving the response (D-13).
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    const handleFailure = () => {
      if (cancelled) return;
      setError("Connection failed");
      setLoading(false);
    };

    ws.onerror = handleFailure;
    ws.onclose = () => {
      // Only treat as failure if we haven't received a response yet.
      if (!cancelled && loading) {
        handleFailure();
      }
    };

    // Patch #17g/#92: fire 4 new artifact fetches in parallel; each carries hostId.
    openOneShot<IdentityGetIdentityFilePayload, IdentityIdentityFileEvent>(
      { type: "identity:get-identity-file", identityKey: identity.identityKey, hostId, },
      "identity:identity-file",
      (ev) => setIdentityFileState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityGetHistoryPayload, IdentityHistoryEvent>(
      { type: "identity:get-history", identityKey: identity.identityKey, hostId, },
      "identity:history",
      // Phase 18 / IDMEDIT-02: store both entries (read-mode) and markdown (edit-mode textarea seed)
      (ev) => setHistoryState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: { entries: ev.entries, markdown: ev.markdown ?? "" } }),
      (e) => setHistoryState({ status: "error", error: e }),
    );

    openOneShot<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
      { type: "identity:list-wakeups", identityKey: identity.identityKey, hostId, },
      "identity:wakeups",
      (ev) => setWakeupsState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.wakeups }),
      (e) => setWakeupsState({ status: "error", error: e }),
    );

    openOneShot<IdentityGetHandoffPayload, IdentityHandoffEvent>(
      { type: "identity:get-handoff", identityKey: identity.identityKey, hostId, },
      "identity:handoff",
      (ev) => setHandoffState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setHandoffState({ status: "error", error: e }),
    );

    return () => {
      cancelled = true;
      try { ws.close(); } catch { /* ignore */ }
      for (const sock of artifactSockets) {
        try { sock.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity.identityKey, hostId, refetchKey]);

  // Quick 260731-1c8: reset editor state on fresh open or identity switch.
  // Revokes any prior avatarPreviewUrl to avoid memory leaks; resets
  // titleDraft + committedTitle to server truth and clears avatarFile + saveError
  // so the editor is clean on each open.
  useEffect(() => {
    if (!open) return;
    setTitleDraft(identity.title ?? "");
    setCommittedTitle(identity.title ?? "");
    setAvatarFile(null);
    setSaveError(null);
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return null;
    });
    // Patch #223: reset voice draft on open/identity switch
    setVoiceDraft(identity.voice ?? "");
    setCommittedVoice(identity.voice ?? null);
  }, [open, identity.id, identity.title, identity.voice]);

  // Patch #223: fetch available voices on modal open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getVoices()
      .then((list) => { if (!cancelled) setVoices(list); })
      .catch(() => { if (!cancelled) setVoices([]); });
    return () => { cancelled = true; };
  }, [open]);

  // Patch #223: unmount cleanup for sample audio
  useEffect(() => {
    return () => {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
        sampleAudioRef.current = null;
        sampleUrlRef.current = null;
      }
    };
  }, []);

  // Cleanup: revoke the preview URL when the modal is unmounted mid-edit.
  useEffect(() => {
    return () => {
      setAvatarPreviewUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return null;
      });
    };
  }, []);

  // Patch #172: pinned-first partition. `pinned` is now an independent
  // boolean field (fleet migration #168), so ANY bounty with pinned===true
  // wins the top group regardless of its `status` value. Below the pinned
  // group, patch #109's semantics still apply: in_progress fence + flat
  // priority-sorted rest + done/dropped-in-place → `other`. The pinned
  // check runs BEFORE the isArchived check so a pinned done/dropped bounty
  // still sits in Pinned (Ashley's requested behavior — pinning is the
  // "keep this visible" signal orthogonal to lifecycle).
  const grouped = useMemo(() => {
    const groups: Record<string, Bounty[]> = {
      pinned: [],
      in_progress: [],
      rest: [],
      other: [],
    };
    for (const b of bounties) {
      if (b.pinned === true) {
        groups.pinned.push(b);
        continue;
      }
      const isArchived = b.status === "done" || b.status === "dropped";
      if (isArchived) {
        // done/dropped in open dir: treat as archived-in-place (D-09).
        groups.other.push(b);
        continue;
      }
      if (b.status === "in_progress") {
        groups.in_progress.push(b);
      } else {
        // waiting_on_someone_else, or any other open non-pinned status →
        // all collapse into the flat priority-sorted rest region.
        groups.rest.push(b);
      }
    }
    // Sort every partition by priority asc, updated_at desc (same
    // sortBounties helper — the CHANGE is at the partition layer, not the
    // in-partition sort). This preserves within-group priority ordering
    // for the new pinned group too.
    for (const key of Object.keys(groups)) {
      groups[key] = sortBounties(groups[key]);
    }
    return groups;
  }, [bounties]);

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
    setWakeupsState({ status: "ready", data: res.wakeups });
  }

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

  // Phase 18 / IDMEDIT-02: save handler for history.md. Sets historyState
  // with both entries (read-mode list) and markdown (edit-mode textarea) from
  // the server echo; falls back to client draft for markdown if server omits it
  // (which should not happen post-widening — the fallback is defensive only).
  async function updateHistory(contents: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateHistoryPayload = {
      type: "identity:update-history",
      identityKey: identity.identityKey,
      hostId,
      contents,
    };
    const res = await sendIdentityMutation<IdentityUpdateHistoryPayload, IdentityHistoryUpdatedEvent>(
      payload,
      "identity:history-updated",
    );
    if (res.error) throw new Error(res.error);
    setHistoryState({ status: "ready", data: { entries: res.entries, markdown: res.markdown ?? contents } });
  }

  // Phase 18 / IDMEDIT-03: save handler for handoff.md.
  async function updateHandoff(contents: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateHandoffPayload = {
      type: "identity:update-handoff",
      identityKey: identity.identityKey,
      hostId,
      contents,
    };
    const res = await sendIdentityMutation<IdentityUpdateHandoffPayload, IdentityHandoffUpdatedEvent>(
      payload,
      "identity:handoff-updated",
    );
    if (res.error) throw new Error(res.error);
    setHandoffState({ status: "ready", data: res.markdown });
  }

  async function updateBountyPriority(
    bountySlug: string,
    priority: BountyPriority,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateBountyPriorityPayload = {
      type: "identity:update-bounty-priority",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      priority,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyPriorityPayload,
      IdentityBountyPriorityUpdatedEvent
    >(payload, "identity:bounty-priority-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    // Quick 260727-tb1: immediate-refresh piggyback. A priority change may
    // co-occur with a status change (or be a leading indicator of one), so
    // we invalidate the panel's cached pinned count for this identity
    // rather than wait up to 60s for the next poll. Fire-and-forget — the
    // store's error path already logs; the modal's own UI state is
    // authoritatively driven by res.bounties above.
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260727-v0b: byte-shape mirror of updateBountyPriority for the
  // parallel status write surface. Same one-shot request / fresh-list
  // response pattern; also invalidates the panel's cached pinned count —
  // even MORE strongly justified than the priority case, because a status
  // flip to/from `pinned` DIRECTLY changes the pinned count (the priority
  // path's invalidation was speculative; this one is deterministic).
  async function updateBountyStatus(
    bountySlug: string,
    status: BountyStatus,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateBountyStatusPayload = {
      type: "identity:update-bounty-status",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      status,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyStatusPayload,
      IdentityBountyStatusUpdatedEvent
    >(payload, "identity:bounty-status-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260728-sqk / patch #172: byte-shape mirror of updateBountyStatus
  // for the parallel `pinned` write surface. `pinned` is an independent
  // boolean orthogonal to lifecycle status; toggling directly changes the
  // panel's cached pinned count so invalidateBountyCount is deterministic
  // (unlike the priority case which was speculative).
  async function updateBountyPinned(
    bountySlug: string,
    pinned: boolean,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateBountyPinnedPayload = {
      type: "identity:update-bounty-pinned",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      pinned,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyPinnedPayload,
      IdentityBountyPinnedUpdatedEvent
    >(payload, "identity:bounty-pinned-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260727-wd0: byte-shape mirror of updateBountyStatus for the
  // archive write surface. Payload has NO status field — server decides
  // internally (flip live→done or preserve terminal). Same fresh-list
  // response pattern; also invalidates the pinned count because archiving
  // a pinned live bounty deterministically drops the count by 1.
  async function archiveBounty(bountySlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityArchiveBountyPayload = {
      type: "identity:archive-bounty",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
    };
    const res = await sendIdentityMutation<
      IdentityArchiveBountyPayload,
      IdentityBountyArchivedEvent
    >(payload, "identity:bounty-archived");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260729-g5r: byte-shape mirror of archiveBounty for the delete
  // write surface. Unlike archive, deleteBounty is threaded to BOTH open
  // AND archived render sites below — permanent rm -rf applies regardless
  // of location. window.confirm() gate lives in BountyCard (destructive
  // UX belongs next to the button, not at the API-call layer).
  async function deleteBounty(bountySlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityDeleteBountyPayload = {
      type: "identity:delete-bounty",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
    };
    const res = await sendIdentityMutation<
      IdentityDeleteBountyPayload,
      IdentityBountyDeletedEvent
    >(payload, "identity:bounty-deleted");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  const sortedArchive = useMemo(
    () => [...archivedBounties].sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    ),
    [archivedBounties],
  );

  const hasOpen = OPEN_STATUS_ORDER.some((s) => grouped[s].length > 0) ||
    grouped.other.length > 0;
  const hasArchive = sortedArchive.length > 0;

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

  // Patch #223: sample playback for voice picker
  async function onSampleClick(): Promise<void> {
    try {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
        sampleAudioRef.current = null;
        sampleUrlRef.current = null;
      }
      const blob = await postSpeak(SAMPLE_PHRASE, voiceDraft || undefined);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      sampleAudioRef.current = audio;
      sampleUrlRef.current = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (sampleAudioRef.current === audio) {
          sampleAudioRef.current = null;
          sampleUrlRef.current = null;
        }
      };
      // patch #211 lesson: NEVER bare audio.play().catch(...)
      Promise.resolve(audio.play()).catch(() => {});
    } catch {
      // swallow — handleApiError already logs
    }
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
      if (titleDraft !== committedTitle) {
        meta.title = titleDraft.trim() === "" ? null : titleDraft;
      }
      // Patch #223: include voice if it changed
      if ((voiceDraft || null) !== committedVoice) {
        meta.voice = voiceDraft === "" ? null : voiceDraft;
      }
      const updated = await updateIdentity(identity.id, meta, avatarFile);
      applyIdentityChange(updated);
      // Revoke old preview URL; fall back to the freshly-etag-busted server URL.
      setAvatarPreviewUrl((prior) => {
        if (prior) URL.revokeObjectURL(prior);
        return null;
      });
      setAvatarFile(null);
      const newTitle = updated.title ?? "";
      setTitleDraft(newTitle);
      // Update committedTitle so the Save button correctly re-disables when
      // draft === saved truth (even if the identity prop hasn't re-rendered yet).
      setCommittedTitle(newTitle);
      // Patch #223: update committed voice
      setCommittedVoice(updated.voice ?? null);
      setVoiceDraft(updated.voice ?? "");
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // onCancel: discards unsaved drafts back to last-committed server truth,
  // revokes the preview URL, clears the inline error. Does NOT close the modal.
  function onCancel(): void {
    setTitleDraft(committedTitle);
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return null;
    });
    setAvatarFile(null);
    setSaveError(null);
    // Patch #223: revert voice draft
    setVoiceDraft(committedVoice ?? "");
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
            the avatar visually above center; Ashley called out on first
            #90 deploy eyeball). */}
        <DialogHeader
          className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
          style={{
            borderBottom: `1px solid hsla(${hue}, 50%, 50%, 0.2)`,
          }}
        >
          {/* Quick 260731-1c8: cache-bust the header avatar with ?v=<avatarEtag>
              so that after applyIdentityChange fires with a new avatarEtag the
              browser fetches the fresh image instead of serving the stale cache. */}
          <img
            src={`${identity.avatarUrl}?v=${identity.avatarEtag}`}
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
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-semibold text-base text-[#f0ebe0] truncate leading-tight">
              {identity.displayName}
            </span>
            {identity.title && (
              <span className="text-xs text-[#a89a80] truncate leading-tight">
                {identity.title}
              </span>
            )}
          </div>
          {/* Patch #91: close button glow-up. Was a ghost square with no
              rest-state visual weight ("pretty lame looking" per Ashley
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
        </DialogHeader>

        {/* Tabs — patch #17g: Identity / Bounties / History / Wakeups / Handoff
            Patch #191: shadcn TabsList replaced with a bottom icon-bar
            (rendered after the TabsContent blocks below). */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          {/* Identity tab — patch #17g: default tab; renders <key>.md as markdown.
              Quick 260731-1c8: adds inline title + avatar editor ABOVE the markdown
              block. Editor exposes exactly two fields (title + avatar); displayName
              and colorHue are NOT exposed as editable here. */}
          <TabsContent
            value="identity"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            {/* Quick 260731-1c8: inline editor block — title + avatar */}
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)] mb-3">
                Edit identity
              </h3>

              {/* Avatar preview + file picker row */}
              <div className="flex items-center gap-3 mb-3">
                <img
                  src={avatarPreviewUrl ?? `${identity.avatarUrl}?v=${identity.avatarEtag}`}
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
              </div>

              {/* Title input */}
              <div className="mb-3">
                <label
                  className="block text-xs text-[var(--color-pv-fg-muted)] mb-1"
                  htmlFor="identity-title-input"
                >
                  Title
                </label>
                <input
                  id="identity-title-input"
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
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

              {/* Patch #223: Voice picker */}
              <div className="mb-3">
                <label
                  className="block text-xs text-[var(--color-pv-fg-muted)] mb-1"
                  htmlFor="identity-voice-select"
                >
                  Voice
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    id="identity-voice-select"
                    value={voiceDraft}
                    onChange={(e) => setVoiceDraft(e.target.value)}
                    disabled={saving}
                    style={{
                      flex: 1,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(220,225,245,0.15)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "#f0ebe0",
                      fontSize: "0.875rem",
                      outline: "none",
                    }}
                  >
                    <option value="">(default)</option>
                    {voices.map((v) => (
                      <option key={v.filename} value={v.filename}>
                        {v.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Sample voice"
                    onClick={() => { void onSampleClick(); }}
                    style={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      background: "rgba(0,0,0,0.28)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      color: "rgba(255,220,170,0.72)",
                      opacity: 0.62,
                      cursor: "pointer",
                    }}
                    className="hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
                  >
                    <Volume2 size={16} />
                  </button>
                </div>
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
                  disabled={
                    saving ||
                    (titleDraft === committedTitle && avatarFile === null && (voiceDraft || null) === committedVoice)
                  }
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

            {/* Existing identity.md markdown preview — Phase 18 / IDMEDIT-01: onSave threaded */}
            <IdentityFileTab state={identityFileState} onSave={updateIdentityFile} />
          </TabsContent>

          {/* Bounties tab — populated (patch #87 — unchanged) */}
          <TabsContent
            value="bounties"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            {loading ? (
              // Loading skeleton — 3 placeholder cards
              <div className="flex flex-col gap-3">
                <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
                <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
                <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
              </div>
            ) : error ? (
              // Error state with retry button
              <div className="flex flex-col items-start gap-3">
                <div className="text-sm text-[color:var(--color-pv-code-fg)]">
                  Couldn&apos;t load bounties: {error}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRefetchKey((k) => k + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : !hasOpen && !hasArchive ? (
              // Empty state
              <div className="flex flex-col gap-1 text-sm text-[var(--color-pv-fg-muted)]">
                <p>No open bounties for {identity.displayName}.</p>
                <p className="text-xs">Archive will show here when populated.</p>
              </div>
            ) : (
              <>
                {/* Patch #109: in_progress fence + flat priority-sorted rest
                    + done/dropped stragglers. OPEN_STATUS_ORDER now enumerates
                    only three partitions; the empty-label GROUP_LABELS entry
                    for "rest" suppresses the header for that region so it
                    reads as one continuous priority-ordered list under the
                    In Progress fence. */}
                {OPEN_STATUS_ORDER.map((statusKey) => {
                  const group = grouped[statusKey];
                  if (!group || group.length === 0) return null;
                  const label = GROUP_LABELS[statusKey];
                  return (
                    <div key={statusKey} className="mb-6">
                      {label && (
                        <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)] mb-2">
                          {label}
                        </h3>
                      )}
                      <div className="flex flex-col gap-3">
                        {group.map((b) => (
                          <BountyCard
                            key={b.id}
                            bounty={b}
                            hue={hue}
                            // Patch #154: "other" bucket = done/dropped in the
                            // open dir; priority is meaningless for terminal
                            // bounties, so we deliberately don't pass an
                            // onPriorityChange handler for that partition.
                            onPriorityChange={
                              statusKey === "other"
                                ? undefined
                                : (p) => updateBountyPriority(b.slug, p)
                            }
                            // Quick 260727-v0b: DELIBERATELY different from
                            // priority above — status IS meaningful on
                            // done/dropped bounties (resurrect: click
                            // "pinned" to pull them back into working set).
                            // Threaded for ALL three partitions including
                            // "other".
                            onStatusChange={(s) => updateBountyStatus(b.slug, s)}
                            // Quick 260728-sqk / patch #172: pin toggle
                            // threaded for ALL FOUR partitions (pinned /
                            // in_progress / rest / other). Pinning a
                            // done-in-place bounty is a legal resurrect
                            // signal on the pinned axis same as status.
                            onPinnedChange={(next) => updateBountyPinned(b.slug, next)}
                            // Quick 260727-wd0: Archive button threaded for
                            // ALL THREE OPEN partitions (in_progress / rest
                            // / other) — a single addition here covers all
                            // three because they share this BountyCard render.
                            // Deliberately NOT passed to sortedArchive.map
                            // below (locked semantics rule #3: cards already
                            // under archive/ don't get the button; unarchive
                            // is a separate follow-up).
                            onArchive={() => archiveBounty(b.slug)}
                            // Quick 260729-g5r: Delete button threaded for
                            // ALL THREE OPEN partitions alongside Archive
                            // above. Unlike Archive, Delete is ALSO threaded
                            // to sortedArchive.map below — permanent rm -rf
                            // applies regardless of location (locked D-2).
                            onDelete={() => deleteBounty(b.slug)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Archive accordion */}
                {hasArchive && (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="archive" className="border-white/10">
                      <AccordionTrigger className="text-sm text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] hover:no-underline">
                        Archive ({sortedArchive.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col gap-3 pt-2">
                          {sortedArchive.map((b) => (
                            <BountyCard
                              key={b.id}
                              bounty={b}
                              hue={hue}
                              archived
                              // Quick 260727-v0b: onStatusChange threaded for
                              // archived bounties too — that IS the resurrect
                              // flow. Deliberately NO onPriorityChange (still
                              // meaningless for archived bounties, so the
                              // Priority row stays hidden per patch #154's
                              // gate on `onPriorityChange &&`).
                              onStatusChange={(s) => updateBountyStatus(b.slug, s)}
                              // Quick 260728-sqk / patch #172: pin toggle
                              // threaded for archived bounties too — unpinning
                              // an archived pinned bounty stays legal, and
                              // re-pinning is the resurrect signal on the
                              // pinned axis (same rationale as onStatusChange).
                              onPinnedChange={(next) => updateBountyPinned(b.slug, next)}
                              /* Quick 260727-wd0: NO onArchive here — cards
                                 under archive/ do not get an Archive button
                                 (unarchive is a separate follow-up).
                                 Quick 260729-g5r: onDelete IS threaded here
                                 — permanent delete applies to archived cards
                                 too (locked design D-2). */
                              onDelete={() => deleteBounty(b.slug)}
                            />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </>
            )}
          </TabsContent>

          {/* History tab — patch #17g: reverse-chronological history.md rows */}
          <TabsContent
            value="history"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <HistoryTab state={historyState} onSave={updateHistory} />
          </TabsContent>

          {/* Wakeups tab — patch #17g: wakeups/*.json cards */}
          <TabsContent
            value="wakeups"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <WakeupsTab state={wakeupsState} hue={hue} onUpdate={updateWakeup} />
          </TabsContent>

          {/* Handoff tab — patch #17g: handoff.md as markdown */}
          <TabsContent
            value="handoff"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <HandoffTab state={handoffState} onSave={updateHandoff} />
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
            {NAV_SECTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1",
                  activeTab === value
                    ? "text-[#f0ebe0]"
                    : "text-[#a89a80] hover:text-[#e8e4d8]",
                )}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
