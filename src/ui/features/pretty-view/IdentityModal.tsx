import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/tabs";
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
  type IdentityArchiveBountyPayload,
  type IdentityBountyArchivedEvent,
  type Wakeup,
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

// Patch #109: below the in_progress fence we no longer partition by status.
// Ashley: "I want to know priority-wise more than I want to know whether
// having another section that's just pinned" — so pinned +
// waiting_on_someone_else + anything else that's not in_progress + not
// done/dropped collapse into a single flat priority-sorted list under the
// header-less "rest" region. in_progress keeps its own header (fence) at top.
// done/dropped-in-place bounties (status=done or status=dropped in the open
// dir, not yet moved to bounties/archive/) still get their own quiet "Other"
// section so recently-closed work doesn't visually blend into open work.
const OPEN_STATUS_ORDER = ["in_progress", "rest", "other"];

const GROUP_LABELS: Record<string, string> = {
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

  // Patch #17g: independent state slots for each new artifact tab.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  const [historyState, setHistoryState] = useState<TabState<string[]>>({ status: "loading" });
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
      (ev) => setHistoryState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.entries }),
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

  // Patch #109: two-partition split — in_progress fence + flat priority-
  // sorted rest — replaces the older status-grouped (in_progress / pinned /
  // waiting_on_someone_else / other) render. done/dropped-in-place still
  // buckets into `other` so they don't visually blend with open work.
  const grouped = useMemo(() => {
    const groups: Record<string, Bounty[]> = {
      in_progress: [],
      rest: [],
      other: [],
    };
    for (const b of bounties) {
      const isArchived = b.status === "done" || b.status === "dropped";
      if (isArchived) {
        // done/dropped in open dir: treat as archived-in-place (D-09).
        groups.other.push(b);
        continue;
      }
      if (b.status === "in_progress") {
        groups.in_progress.push(b);
      } else {
        // pinned, waiting_on_someone_else, or any other open status →
        // all collapse into the flat priority-sorted rest region.
        groups.rest.push(b);
      }
    }
    // Sort every partition by priority asc, updated_at desc (same
    // sortBounties helper — the CHANGE is at the partition layer, not the
    // in-partition sort).
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
    updates: { enabled?: boolean; schedule?: unknown },
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

  const sortedArchive = useMemo(
    () => [...archivedBounties].sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    ),
    [archivedBounties],
  );

  const hasOpen = OPEN_STATUS_ORDER.some((s) => grouped[s].length > 0) ||
    grouped.other.length > 0;
  const hasArchive = sortedArchive.length > 0;

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
          <img
            src={identity.avatarUrl}
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

        {/* Tabs — patch #17g: Identity / Bounties / History / Wakeups / Handoff */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Patch #91: tabs polish.
              - TabsList: refined glass surface (was flat bg-black/20 border-white/10).
                Warm-cool-black gradient + slightly stronger border + backdrop-blur
                so it reads as part of the modal chrome, not a bolted-on strip.
                p-1 gives active pill some breathing room inside the well.
              - TabsTrigger: cursor-pointer (Tailwind v4 dropped v3's button
                default); patch #81 `!` on active bg (shadcn's base carries
                dark:data-[state=active]:bg-input/30 which would win specificity
                on our plain override). Active state = brighter warm-cream fill
                that reads as "pressed in" against the well; hover = subtle
                brighten of the inactive text. Custom size/padding for a
                cleaner rhythm than shadcn defaults. */}
          <TabsList
            className="mx-6 mt-4 shrink-0 w-auto self-start p-1 rounded-lg h-auto"
            style={{
              background: "linear-gradient(180deg, rgba(28,30,40,0.55), rgba(18,20,28,0.62))",
              border: "1px solid rgba(220, 225, 245, 0.12)",
              boxShadow: "inset 0 1px 0 rgba(220, 225, 245, 0.05), inset 0 2px 8px rgba(0, 0, 0, 0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            {[
              { value: "identity", label: "Identity" },
              { value: "bounties", label: "Bounties" },
              { value: "history", label: "History" },
              { value: "wakeups", label: "Wakeups" },
              { value: "handoff", label: "Handoff" },
            ].map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="cursor-pointer px-3.5 py-1.5 text-sm text-[#a89a80] hover:text-[#e8e4d8] data-[state=active]:bg-[rgba(240,235,224,0.08)]! data-[state=active]:text-[#f0ebe0] data-[state=active]:border-[rgba(220,225,245,0.18)]! data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),_0_1px_2px_rgba(0,0,0,0.3)]"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Identity tab — patch #17g: default tab; renders <key>.md as markdown */}
          <TabsContent
            value="identity"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <IdentityFileTab state={identityFileState} />
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
                            // Quick 260727-wd0: Archive button threaded for
                            // ALL THREE OPEN partitions (in_progress / rest
                            // / other) — a single addition here covers all
                            // three because they share this BountyCard render.
                            // Deliberately NOT passed to sortedArchive.map
                            // below (locked semantics rule #3: cards already
                            // under archive/ don't get the button; unarchive
                            // is a separate follow-up).
                            onArchive={() => archiveBounty(b.slug)}
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
                              /* Quick 260727-wd0: NO onArchive here — cards
                                 already under archive/ do not get an Archive
                                 button (locked semantics rule #3; unarchive
                                 is a separate follow-up). */
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
            <HistoryTab state={historyState} />
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
            <HandoffTab state={handoffState} />
          </TabsContent>
        </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
