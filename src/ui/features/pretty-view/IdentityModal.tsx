import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Clock, Handshake, Pencil, Target, User, Users, X } from "lucide-react";
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
// Quick 260829-f9l: shadcn Input for the Bounties-tab search box.
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
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
import { updateIdentity, getIdentityNoDormancy, setIdentityNoDormancy, avatarUrlWithHost } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { toast } from "sonner";
import { VoicePicker } from "./pickers/VoicePicker";
import { ColorPicker } from "./pickers/ColorPicker";
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
  type IdentityUpdateBountyNeedsDeskPayload,
  type IdentityBountyNeedsDeskUpdatedEvent,
  type IdentityArchiveBountyPayload,
  type IdentityBountyArchivedEvent,
  type IdentityDeleteBountyPayload,
  type IdentityBountyDeletedEvent,
  type BountyFieldsPatch,
  type IdentityUpdateBountyFieldsPayload,
  type IdentityBountyFieldsUpdatedEvent,
  type Wakeup,
  // Phase 18 / IDMEDIT-01,02,03: markdown-tab write wire types from Plan 01
  type IdentityUpdateIdentityFilePayload,
  type IdentityIdentityFileUpdatedEvent,
  type IdentityUpdateHistoryPayload,
  type IdentityHistoryUpdatedEvent,
  type IdentityUpdateHandoffPayload,
  type IdentityHandoffUpdatedEvent,
  // Phase 22 SRIC-06 / Plan 22-06: role-file read + update wire types.
  // Backend does the two-step; frontend contract stays (identityKey, hostId).
  type IdentityGetRoleFilePayload,
  type IdentityRoleFileEvent,
  type IdentityUpdateRoleFilePayload,
  type IdentityRoleFileUpdatedEvent,
} from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import { BountyCard } from "./BountyCard";
import { cn } from "@/lib/utils";
import { IdentityFileTab, type TabState } from "./IdentityFileTab";
import { RoleFileTab } from "./RoleFileTab";
import { HistoryTab } from "./HistoryTab";
import { WakeupsTab } from "./WakeupsTab";
import { HandoffTab } from "./HandoffTab";
// Phase 38 Wave 2: share this identity with another Skynet user from the modal header.
import { ShareIdentityPicker } from "./ShareIdentityPicker";

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
  // Quick 260823-80r: archive is loaded lazily on Accordion expand. The
  // initial modal-open bounties fetch omits `includeArchived: true`, so the
  // backend returns `archivedBounties: []` without running the expensive
  // `for d in */; do cat "$d/bounty.json"; done` shell one-liner (which
  // exceeds REMOTE_EXEC_TIMEOUT_MS for roles like Wendy/Molly/Aqua on host 7).
  //   unloaded — the accordion has never been opened this session; label reads `Archive`
  //   loading  — a fetch is in flight; label reads `Archive (loading…)`
  //   loaded   — server responded; label reads `Archive (N)`
  // Failure surfaces via `archivedError` while `archivedLoadState` returns to
  // `unloaded` so the next click re-fires the fetch.
  const [archivedLoadState, setArchivedLoadState] = useState<
    "unloaded" | "loading" | "loaded"
  >("unloaded");
  const [archivedError, setArchivedError] = useState<string | null>(null);
  // Quick 260829-f9l: client-side search box for the Bounties tab. Filters
  // BOTH open partitions AND (when loaded) the archive accordion body by
  // case-insensitive substring match against title / premise / slug /
  // keywords[]. No debounce (list is < 100 items per role — useMemo is enough).
  // Typing MUST NOT force an archive fetch — the accordion still owns the
  // lazy-load click gesture; typing while archive is unloaded surfaces a
  // hint below the query-driven empty state instead.
  const [bountyQuery, setBountyQuery] = useState<string>("");
  // Quick 260823-80r: controlled Radix Accordion value. Empty string = closed;
  // "archive" = expanded. We control it so the failure path can programmatically
  // close the accordion on WS-close-before-response, guaranteeing that the
  // user's next click on the trigger transitions "" → "archive" (which fires
  // `onValueChange("archive")` and re-triggers the fetch). Without the
  // controlled value, an uncontrolled Radix Accordion stays "open" after a
  // failed fetch and the retry click would fire `onValueChange("")` instead,
  // silently no-op'ing.
  const [archiveAccordionValue, setArchiveAccordionValue] = useState<string>("");
  // Phase 22 SRIC-06 / Plan 22-06: Role tab is FIRST and DEFAULT per D-CONTEXT
  // §UX rules ("Role tab is FIRST and DEFAULT — not slotted after Identity,
  // not toggleable in position"). Locked with Ashley 2026-08-04.
  // 2026-08-05: default to Bounties on open (Ashley) — the tab you actually
  // want to see first when clicking an identity badge.
  const [activeTab, setActiveTab] = useState("bounties");
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
  const [editing, setEditing] = useState(false);
  // Patch #223: voice picker state (voices/sampleAudioRef/sampleUrlRef moved to VoicePicker)
  const [voiceDraft, setVoiceDraft] = useState<string>(identity.voice ?? "");
  const [committedVoice, setCommittedVoice] = useState<string | null>(identity.voice ?? null);
  // Patch #279: colorHue picker state — fall back to prop hue when identity.colorHue is null
  const [hueDraft, setHueDraft] = useState<number>(identity.colorHue ?? hue);
  const [committedHue, setCommittedHue] = useState<number>(identity.colorHue ?? hue);
  // Quick 260811-ax1: "Stays awake" switch — null = loading, boolean = loaded.
  const [staysAwake, setStaysAwake] = useState<boolean | null>(null);
  const [staysAwakeSaving, setStaysAwakeSaving] = useState<boolean>(false);

  // Phase 38 Wave 2 (plan 38-02): Parent-owned set of userIds who already have
  // this identityKey. Empty at open — the frontend does NOT precompute
  // "who has this identityKey" via a cross-user query in Phase 38 (there is
  // no such endpoint, and adding one is the deferred provenance-display
  // feature). As the user shares to targets this session, ShareIdentityPicker
  // reports each successful share via onShareSuccess; we add the targetUserId
  // to the Set so subsequent picker opens render the "shared" marker without
  // a refetch. Set is created lazily so a re-render does not thrash the
  // referential identity (which would churn the picker's props).
  const [alreadySharedUserIds, setAlreadySharedUserIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // Reset alreadySharedUserIds when the modal is bound to a different identity.
  // IdentityModal is mounted persistently in the tree (PrettyView reuses a
  // single mount and swaps the `identity` prop as Ashley taps different badges),
  // so the Set would otherwise carry stale target-user ids from the previous
  // identity and render misleading "shared" markers under the new one.
  // Keyed on identity.identityKey — that is the actual "am I looking at the
  // same person?" signal (identity.id is the row PK, which also changes on
  // switch, but identityKey is the semantic key that maps to the underlying
  // agent). Session-scoped by design per CONTEXT.md § Deferred: provenance
  // display — cross-session persistence would require a "who has this
  // identityKey" endpoint that is explicitly out of scope for Phase 38.
  useEffect(() => {
    setAlreadySharedUserIds(new Set<string>());
  }, [identity.identityKey]);

  // handleShareSuccess adds result.targetUserId to alreadySharedUserIds so the
  // picker's per-row marker updates on the next open without a refetch.
  const handleShareSuccess = useCallback(
    (result: { targetUserId: string; shared: boolean; resultingIdentityId: string }) => {
      // Fresh Set instance so React sees a new reference and re-renders the
      // picker with the updated marker state. Handles both shared:true (real
      // hand-over) and shared:false (silent no-op-on-repeat) the same way —
      // per CONTEXT.md re-share-to-same-target contract, the marker should
      // stay marked after any successful call, not flip.
      setAlreadySharedUserIds((prev) => {
        const next = new Set(prev);
        next.add(result.targetUserId);
        return next;
      });
    },
    [],
  );

  // Patch #191: bottom icon-bar nav for section switching (Telegram-shape).
  // Replaces the previous shadcn TabsList strip, which (a) aesthetically didn't
  // match Skynet's pretty-view visual language and (b) got CUT OFF on narrow
  // mobile viewports (w-auto self-start, no overflow handling). Bottombar is
  // mobile-safe by construction — 5 evenly-flexed slots + icon-first labels.
  // Tuner arc: list / dropdown / bottombar variants shipped in commit 8e35dae,
  // Ashley UAT'd all three, bottombar picked as the winner; this commit locks
  // it in and drops the tuner + losing variants.
  // Phase 22 SRIC-06 / Plan 22-06: Role tab inserted at position 0 (FIRST).
  // Ordering is LOCKED per D-CONTEXT §UX rules — not toggleable in position.
  // Users icon from lucide-react per D-CONTEXT §Claude's Discretion.
  const NAV_SECTIONS = [
    { value: "role", label: "Role", Icon: Users },
    { value: "identity", label: "Identity", Icon: User },
    { value: "bounties", label: "Bounties", Icon: Target },
    { value: "history", label: "History", Icon: Clock },
    { value: "wakeups", label: "Wakeups", Icon: AlarmClock },
    { value: "handoff", label: "Handoff", Icon: Handshake },
  ] as const;

  // Patch #17g: independent state slots for each new artifact tab.
  const [identityFileState, setIdentityFileState] = useState<TabState<string>>({ status: "loading" });
  // Phase 22 SRIC-06 / Plan 22-06: sixth state slot for the Role tab. Backend
  // does the two-step (identity file → role: frontmatter → role artifact) so
  // the frontend just observes the wire {markdown, error?} shape.
  const [roleFileState, setRoleFileState] = useState<TabState<string>>({ status: "loading" });
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
    // Quick 260823-80r: reset lazy archive state — a fresh modal open (or
    // identity/host switch) must not carry over the previous session's
    // loaded/loading/error state, or the user would see the wrong count in
    // the trigger label until they clicked again.
    setArchivedLoadState("unloaded");
    setArchivedError(null);
    setArchiveAccordionValue("");

    // Reset all 5 artifact state slots to loading (identity file + Plan 22-06 role file + 3 others).
    setIdentityFileState({ status: "loading" });
    setRoleFileState({ status: "loading" });
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
      // Quick 260823-80r: DO NOT setArchivedBounties from the initial fetch —
      // the backend returns `archivedBounties: []` when includeArchived is
      // omitted (its new default), so this call would clobber whatever
      // loadArchivedBounties() has already populated (which is nothing on
      // the initial open, but the removal keeps the seam clean for the
      // future case where a mutation refetch races with the initial load).
      // Actual archive population lives in loadArchivedBounties() below.
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
    // Phase 22 SRIC-06 / Plan 22-06: add sixth parallel fetch for the role file.
    // Backend does the two-step; frontend only sees the wire {markdown, error?} shape.
    openOneShot<IdentityGetIdentityFilePayload, IdentityIdentityFileEvent>(
      { type: "identity:get-identity-file", identityKey: identity.identityKey, hostId, },
      "identity:identity-file",
      (ev) => setIdentityFileState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityGetRoleFilePayload, IdentityRoleFileEvent>(
      { type: "identity:get-role-file", identityKey: identity.identityKey, hostId, },
      "identity:role-file",
      (ev) => setRoleFileState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setRoleFileState({ status: "error", error: e }),
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

  // Quick 260823-80r: lazy archive loader. Fires a NEW one-shot WS with
  // `includeArchived: true` when the user first expands the Archive accordion.
  // Idempotent — the `archivedLoadState === "loaded"` early return means a
  // second click (collapse → re-expand) does not open another WS. Failure
  // (WS closes before response) sets `archivedError` + returns state to
  // `unloaded` so the very next click on the trigger retries. This mirrors
  // the one-shot pattern used elsewhere in the modal (openOneShot in the
  // initial-fetch effect, sendIdentityMutation for the write-then-refetch
  // path) — same shape, different lifecycle.
  //
  // Reads state via `archivedLoadState` (functional check inside the
  // callback would be cleaner but the closure over the current render's
  // state is fine because the useCallback deps include it, so React
  // regenerates the callback on every state transition — no stale reads).
  const loadArchivedBounties = useCallback(() => {
    if (!identity.identityKey) return;
    // Idempotency: once loaded (with no error), the current archivedBounties
    // state is authoritative and a re-expand should render from it. The
    // error case falls through to a fresh fetch (retry).
    if (archivedLoadState === "loaded" && archivedError === null) return;
    if (archivedLoadState === "loading") return; // in flight — dedupe

    setArchivedLoadState("loading");
    setArchivedError(null);

    let responded = false;
    const sock = openClaudeSessionSocket();
    sock.onopen = () => {
      const payload: IdentityListBountiesPayload = {
        type: "identity:list-bounties",
        identityKey: identity.identityKey,
        hostId,
        includeArchived: true,
      };
      try { sock.send(JSON.stringify(payload)); } catch { /* ws mid-close */ }
    };
    sock.onmessage = (event: MessageEvent<string>) => {
      if (responded) return;
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== "identity:bounties") return;
        const parsed = raw as IdentityBountiesEvent;
        responded = true;
        setArchivedBounties(parsed.archivedBounties ?? []);
        setArchivedLoadState("loaded");
        setArchivedError(null);
        try { sock.close(); } catch { /* ignore */ }
      } catch { /* ignore */ }
    };
    const handleFail = () => {
      if (responded) return;
      responded = true;
      // Return to unloaded so the next trigger click retries. `archivedError`
      // drives the trigger label into the "failed to load — click to retry"
      // variant so the user knows why the count didn't appear. We also
      // programmatically CLOSE the accordion (value → "") so the retry click
      // fires a "" → "archive" transition (Radix only invokes onValueChange
      // when the value actually changes — clicking a still-open accordion
      // after a failure would otherwise fire onValueChange("") and NOT
      // re-invoke this loader).
      setArchivedError("Failed to load archive");
      setArchivedLoadState("unloaded");
      setArchiveAccordionValue("");
    };
    sock.onerror = handleFail;
    sock.onclose = () => { if (!responded) handleFail(); };
  }, [identity.identityKey, hostId, archivedLoadState, archivedError]);

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
    // Patch #279: reset hue draft on open/identity switch
    setHueDraft(identity.colorHue ?? hue);
    setCommittedHue(identity.colorHue ?? hue);
  }, [open, identity.id, identity.title, identity.voice, identity.colorHue]);

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

  // Phase 22 SRIC-06 / Plan 22-06: save handler for the role file
  // (~/.claude/roles/<role>/<role>.md). Byte-shape mirror of updateIdentityFile
  // — same sendIdentityMutation, same throw-on-res.error, same
  // set-from-server-echo. Backend does the two-step + re-read so this frontend
  // is a mechanical mirror of the identity-file handler.
  async function updateRoleFile(contents: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateRoleFilePayload = {
      type: "identity:update-role-file",
      identityKey: identity.identityKey,
      hostId,
      contents,
    };
    const res = await sendIdentityMutation<IdentityUpdateRoleFilePayload, IdentityRoleFileUpdatedEvent>(
      payload,
      "identity:role-file-updated",
    );
    if (res.error) throw new Error(res.error);
    setRoleFileState({ status: "ready", data: res.markdown });
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

  async function updateBountyPriority(
    bountySlug: string,
    priority: BountyPriority,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    // Quick 260823-80r: only opt into the archive refetch if the modal has
    // already loaded the archive this session — otherwise the backend would
    // do the expensive walk we're specifically trying to avoid, AND the
    // returned archivedBounties would clobber our (correctly empty pre-load)
    // local state. When archive is loaded, we DO want the fresh list so any
    // knock-on effects (e.g. priority change on an archived pinned bounty)
    // reflect immediately.
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityUpdateBountyPriorityPayload = {
      type: "identity:update-bounty-priority",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      priority,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyPriorityPayload,
      IdentityBountyPriorityUpdatedEvent
    >(payload, "identity:bounty-priority-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
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
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityUpdateBountyStatusPayload = {
      type: "identity:update-bounty-status",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      status,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyStatusPayload,
      IdentityBountyStatusUpdatedEvent
    >(payload, "identity:bounty-status-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
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
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityUpdateBountyPinnedPayload = {
      type: "identity:update-bounty-pinned",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      pinned,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyPinnedPayload,
      IdentityBountyPinnedUpdatedEvent
    >(payload, "identity:bounty-pinned-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // This quick: byte-shape mirror of updateBountyPinned for the parallel
  // `needs_desk` write surface. Independent user-reserved boolean orthogonal
  // to both `status` and `pinned`. Toggling deterministically changes the
  // panel's cached needsDeskCount so invalidateBountyCount fires the same
  // fire-and-forget as pinned.
  async function updateBountyNeedsDesk(
    bountySlug: string,
    needsDesk: boolean,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityUpdateBountyNeedsDeskPayload = {
      type: "identity:update-bounty-needs-desk",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      needs_desk: needsDesk,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyNeedsDeskPayload,
      IdentityBountyNeedsDeskUpdatedEvent
    >(payload, "identity:bounty-needs-desk-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Phase 18 / IDMEDIT-04 / Plan 05: byte-shape mirror of updateBountyPriority
  // for the bounty field editor write surface. Accepts a partial patch covering
  // any subset of the seven editable fields (title, premise, todos, keywords,
  // source_links, deadline, meeting_questions); server merges only the provided
  // keys. invalidateBountyCount fire-and-forget matches the existing convention
  // (a field edit such as todos-done-toggle or meeting_questions-add can
  // indirectly affect counts in future derivation expansions).
  async function updateBountyFields(
    bountySlug: string,
    patch: BountyFieldsPatch,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityUpdateBountyFieldsPayload = {
      type: "identity:update-bounty-fields",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      patch,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyFieldsPayload,
      IdentityBountyFieldsUpdatedEvent
    >(payload, "identity:bounty-fields-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
    // Rebuild the pinned-count cache — a field edit (especially todos state
    // changes or a meeting_questions add) can flip counts indirectly if the
    // panel's count derivation ever expands beyond raw pinned. Fire-and-
    // forget matches the existing convention.
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260727-wd0: byte-shape mirror of updateBountyStatus for the
  // archive write surface. Payload has NO status field — server decides
  // internally (flip live→done or preserve terminal). Same fresh-list
  // response pattern; also invalidates the pinned count because archiving
  // a pinned live bounty deterministically drops the count by 1.
  async function archiveBounty(bountySlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityArchiveBountyPayload = {
      type: "identity:archive-bounty",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityArchiveBountyPayload,
      IdentityBountyArchivedEvent
    >(payload, "identity:bounty-archived");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
    void invalidateBountyCount(identity.identityKey, hostId);
  }

  // Quick 260729-g5r: byte-shape mirror of archiveBounty for the delete
  // write surface. Unlike archive, deleteBounty is threaded to BOTH open
  // AND archived render sites below — permanent rm -rf applies regardless
  // of location. window.confirm() gate lives in BountyCard (destructive
  // UX belongs next to the button, not at the API-call layer).
  async function deleteBounty(bountySlug: string): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    // Quick 260823-80r: opt-in archive refetch (see updateBountyPriority for rationale).
    const archiveLoaded = archivedLoadState === "loaded";
    const payload: IdentityDeleteBountyPayload = {
      type: "identity:delete-bounty",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      includeArchived: archiveLoaded,
    };
    const res = await sendIdentityMutation<
      IdentityDeleteBountyPayload,
      IdentityBountyDeletedEvent
    >(payload, "identity:bounty-deleted");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    if (archiveLoaded) setArchivedBounties(res.archivedBounties);
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

  // Quick 260829-f9l: normalized query + filter predicate for the Bounties
  // tab search box. `bountyQueryNorm` runs .trim().toLowerCase() ONCE per
  // keystroke; the predicate builds one `hay` per card and does one
  // .includes() call. `keywords.join(" ")` is safe because a keyword like
  // "web-ui" never straddles the space boundary — collapsing to a single
  // .includes() beats a per-keyword .some() branch for the < 100-card list.
  const bountyQueryNorm = useMemo(
    () => bountyQuery.trim().toLowerCase(),
    [bountyQuery],
  );
  const bountyMatchesQuery = useCallback(
    (b: Bounty): boolean => {
      if (!bountyQueryNorm) return true;
      const hay = [
        b.title,
        b.premise,
        b.slug,
        b.keywords.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(bountyQueryNorm);
    },
    [bountyQueryNorm],
  );
  // Derived visibility booleans post-filter — used to drive the query-driven
  // empty state below. Kept as separate useMemo blocks so the archive check
  // only recomputes when sortedArchive changes; the open check depends on
  // `grouped` which recomputes on every bounty set update.
  const hasOpenAfterFilter = useMemo(
    () =>
      OPEN_STATUS_ORDER.some((s) =>
        (grouped[s] ?? []).some(bountyMatchesQuery),
      ),
    [grouped, bountyMatchesQuery],
  );
  const hasArchiveAfterFilter = useMemo(
    () => sortedArchive.some(bountyMatchesQuery),
    [sortedArchive, bountyMatchesQuery],
  );

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
      if (titleDraft !== committedTitle) {
        meta.title = titleDraft.trim() === "" ? null : titleDraft;
      }
      // Patch #223: include voice if it changed
      if ((voiceDraft || null) !== committedVoice) {
        meta.voice = voiceDraft === "" ? null : voiceDraft;
      }
      // Patch #279: include colorHue if it changed
      if (hueDraft !== committedHue) {
        meta.colorHue = hueDraft;
      }
      // Phase 66 Plan 66-02: thread the modal's existing hostId prop into
      // updateIdentity — the backend PUT handler now uses it to route the
      // disk-write to the identity's home box via the artifact-reader.
      const updated = await updateIdentity(identity.id, meta, avatarFile, hostId);
      // Patch #279: GET-verify guard — Skynet's multipart handler has been known to silently
      // no-op on the `data` field when middleware order gets misconfigured. Defensive check:
      // if we sent a colorHue change but the server echo doesn't reflect it, surface an inline
      // error instead of trusting the 200. Only guards colorHue changes (title/voice already
      // have their own draft-vs-echo recovery paths via setCommittedTitle/setCommittedVoice).
      if (meta.colorHue !== undefined && updated.colorHue !== meta.colorHue) {
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
      const newTitle = updated.title ?? "";
      setTitleDraft(newTitle);
      // Update committedTitle so the Save button correctly re-disables when
      // draft === saved truth (even if the identity prop hasn't re-rendered yet).
      setCommittedTitle(newTitle);
      // Patch #223: update committed voice
      setCommittedVoice(updated.voice ?? null);
      setVoiceDraft(updated.voice ?? "");
      // Patch #279: update committed hue from server echo
      setCommittedHue(updated.colorHue ?? hueDraft);
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
    setTitleDraft(committedTitle);
    setAvatarPreviewUrl((prior) => {
      if (prior) URL.revokeObjectURL(prior);
      return null;
    });
    setAvatarFile(null);
    setSaveError(null);
    // Patch #223: revert voice draft
    setVoiceDraft(committedVoice ?? "");
    // Patch #279: revert hue draft
    setHueDraft(committedHue);
    setEditing(false);
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
              browser fetches the fresh image instead of serving the stale cache.
              Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar
              requires hostId query param; use avatarUrlWithHost helper. Etag
              guard: when avatarEtag is the "" safe-default from Plan 03's
              publicIdentity (disk-cosmetics absent), SKIP the &v= entirely
              rather than emitting a literal `&v=`. */}
          <img
            src={
              identity.avatarEtag
                ? `${avatarUrlWithHost(identity, hostId)}&v=${identity.avatarEtag}`
                : avatarUrlWithHost(identity, hostId)
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
          {/* Quick 260811-ax1: "Stays awake" sentinel toggle. Switch checked =
              .no-dormancy sentinel present on the identity's host. Disabled
              while loading (null) or saving. */}
          <label
            className="shrink-0 flex flex-row items-center gap-2 cursor-pointer select-none"
            title="Toggle stays-awake sentinel for this identity"
          >
            <Switch
              checked={staysAwake === true}
              onCheckedChange={onStaysAwakeToggle}
              disabled={staysAwake === null || staysAwakeSaving}
              aria-label={`Toggle stays-awake for ${identity.displayName}`}
            />
            <span className="text-xs text-[#a89a80]">Boost response time (uses more memory)</span>
          </label>
          {/* Phase 38 Wave 2 (plan 38-02): share this identity with another
              Skynet user. Hides itself when the deployment has no other users
              so the header does not carry a dead affordance. Parent owns the
              already-shared Set + updates it via handleShareSuccess. */}
          <ShareIdentityPicker
            identityId={identity.id}
            identityKey={identity.identityKey}
            alreadySharedUserIds={alreadySharedUserIds}
            onShareSuccess={handleShareSuccess}
          />
          {/* Patch #277: pencil toggle button — reveals/hides the edit block.
              Matches close-button glass affordance (same size, border, glow
              recipe) but NOT wrapped in DialogClose — does not close the dialog. */}
          <button
            type="button"
            aria-label={editing ? "Done editing" : "Edit agent"}
            title={editing ? "Done editing" : "Edit agent"}
            className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center transition-[color,background-color,border-color,box-shadow] duration-200"
            style={{
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
            {/* Phase 66 Plan 05: hostId threading + etag guard — same shape as
                the header avatar above. avatarPreviewUrl (blob: URL from a
                fresh file pick) takes precedence unchanged. */}
            <div className="flex items-center gap-3 mb-3">
              <img
                src={
                  avatarPreviewUrl ??
                  (identity.avatarEtag
                    ? `${avatarUrlWithHost(identity, hostId)}&v=${identity.avatarEtag}`
                    : avatarUrlWithHost(identity, hostId))
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

            {/* Patch #223: Voice picker (extracted to VoicePicker component) */}
            <div className="mb-3">
              <label className="block text-xs text-[var(--color-pv-fg-muted)] mb-1" htmlFor="identity-voice-select">Voice</label>
              <VoicePicker id="identity-voice-select" value={voiceDraft} onChange={setVoiceDraft} disabled={saving} />
            </div>

            {/* Patch #279: colorHue picker (extracted to ColorPicker component) */}
            <div className="mb-3">
              <label className="block text-xs text-[var(--color-pv-fg-muted)] mb-1" htmlFor="identity-hue-input">Color</label>
              <ColorPicker id="identity-hue-input" value={hueDraft} onChange={setHueDraft} disabled={saving} />
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
                  (titleDraft === committedTitle && avatarFile === null && (voiceDraft || null) === committedVoice && hueDraft === committedHue)
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
        )}

        {/* Tabs — patch #17g: Identity / Bounties / History / Wakeups / Handoff
            Phase 22 SRIC-06 / Plan 22-06: Role tab inserted at position 0 (FIRST)
            per D-CONTEXT §UX rules ("Role tab is FIRST and DEFAULT").
            Patch #191: shadcn TabsList replaced with a bottom icon-bar
            (rendered after the TabsContent blocks below). */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          {/* Role tab — Phase 22 SRIC-06: DEFAULT tab; renders the identity's
              role file (~/.claude/roles/<role>/<role>.md) via the backend
              two-step. Missing role: frontmatter surfaces as RoleFileTab's
              error branch — NO fallback empty state per D-CONTEXT lock. */}
          <TabsContent
            value="role"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <RoleFileTab state={roleFileState} onSave={updateRoleFile} />
          </TabsContent>

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

          {/* Bounties tab — populated (patch #87 — unchanged) */}
          {/* Quick 260829-f9l: split pane into flex-col so the search input
              can sit sticky at the top of the inner scroll container. The
              old `overflow-y-auto px-6 py-4` moved off the pane onto the
              inner scroll <div>; the pane itself is now just a vertical
              flex column that hosts (a) the sticky search bar and (b) the
              scroll container. Sticky bar lives INSIDE the scroll container
              so it stays visible while scrolling the bounty list (matches
              Ashley's ask). */}
          <TabsContent
            value="bounties"
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-0 pb-4">
            {/* Quick 260829-f9l: sticky search input. `sticky top-0` inside
                the scroll container pins the bar to the top of the scroll
                region. Background is hue-tinted to match the modal's own
                gradient (Ashley 2026-08-29: the fixed near-black token
                looked like a "weird darkness" out-of-place against the
                identity-hue modal). Uses a mid-gradient stop as an inline
                style so it participates in the per-identity hue. backdrop-
                blur still covers content underneath as it scrolls past.
                Rendered UNCONDITIONALLY so keyboard focus is never yanked
                out of it by branch swaps. */}
            <div
              className="sticky top-0 z-10 -mx-6 px-6 pt-4 pb-2 backdrop-blur"
              style={{ background: `hsla(${hue}, 42%, 20%, 0.85)` }}
            >
              <div className="relative">
                <Input
                  value={bountyQuery}
                  onChange={(e) => setBountyQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setBountyQuery("");
                    }
                  }}
                  placeholder="Search bounties…"
                  aria-label="Search bounties"
                  className={
                    // Reuse the muted glass token classes from the title editor
                    // (~line 1001 in the pre-change file) so the search input
                    // sits visually with the rest of the modal's editor chrome.
                    "text-sm bg-white/5 border-white/20 text-[#f0ebe0] pr-8"
                  }
                />
                {bountyQuery !== "" && (
                  <button
                    type="button"
                    onClick={() => setBountyQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
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
            ) : !hasOpen && !hasArchive && archivedLoadState === "loaded" && bountyQueryNorm === "" ? (
              // Empty state — quick 260823-80r: only render this pure-empty
              // branch once we've CONFIRMED (loaded) the archive is also
              // empty. Otherwise fall through so the Archive accordion below
              // stays clickable (the whole point of the lazy-load fix is
              // that we DON'T know if archive is empty on modal open).
              // Quick 260829-f9l: gate on `bountyQueryNorm === ""` so a
              // non-empty query yields the query-driven empty state below
              // instead of this "no bounties at all" message.
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
                  // Quick 260829-f9l: filter the group and hide the entire
                  // partition header when its post-filter card count is
                  // zero — otherwise a lonely "Pinned" header would sit
                  // above an empty region when the query filters away all
                  // its cards.
                  const filteredGroup = (group ?? []).filter(bountyMatchesQuery);
                  if (!group || filteredGroup.length === 0) return null;
                  const label = GROUP_LABELS[statusKey];
                  return (
                    <div key={statusKey} className="mb-6">
                      {label && (
                        <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)] mb-2">
                          {label}
                        </h3>
                      )}
                      <div className="flex flex-col gap-3">
                        {/* Quick 260829-f9l: render post-filter set. */}
                        {filteredGroup.map((b) => (
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
                            // This quick: needs_desk toggle threaded for ALL
                            // FOUR partitions (mirrors pinned above). Flipping
                            // needs_desk on a done/dropped bounty stays legal
                            // — same user-reserved-flag semantics as pinned.
                            onNeedsDeskChange={(next) => updateBountyNeedsDesk(b.slug, next)}
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
                            // Phase 18 / IDMEDIT-04 / Plan 05: field editors
                            // threaded for ALL THREE OPEN partitions
                            // (pinned / in_progress / rest / other via
                            // OPEN_STATUS_ORDER). Archived cards also get
                            // field editors (sortedArchive.map below) since
                            // even archived bounties can have fields edited
                            // (e.g. retrospective meeting_question).
                            onFieldsChange={(patch) => updateBountyFields(b.slug, patch)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Quick 260829-f9l: query-driven empty state. Fires when the
                    user has typed something AND no open partition renders any
                    card AND either (a) the archive is loaded and also has no
                    matches, or (b) the archive isn't loaded (in which case we
                    can't know for sure — append the archive-not-loaded hint so
                    Ashley knows to click the accordion to include it). Placed
                    BEFORE the Archive accordion so the accordion trigger is
                    still clickable underneath the message and the lazy-load
                    still works. */}
                {bountyQueryNorm !== "" &&
                  !hasOpenAfterFilter &&
                  ((archivedLoadState === "loaded" && !hasArchiveAfterFilter) ||
                    archivedLoadState !== "loaded") && (
                    <div className="flex flex-col gap-1 text-sm text-[var(--color-pv-fg-muted)] mt-4">
                      <p>no matches for &ldquo;{bountyQuery}&rdquo;</p>
                      {archivedLoadState !== "loaded" && (
                        <p className="text-xs">
                          archive not loaded — expand to include it
                        </p>
                      )}
                    </div>
                  )}

                {/* Archive accordion — quick 260823-80r: rendered whenever
                    we don't know for sure that archive is empty, so the user
                    always has a click target to trigger the lazy load. Only
                    hidden once we've CONFIRMED (loaded + no error) that the
                    archive is empty. */}
                {(archivedLoadState !== "loaded" || hasArchive) && (
                  <Accordion
                    type="single"
                    collapsible
                    value={archiveAccordionValue}
                    onValueChange={(val) => {
                      // Quick 260823-80r: controlled — mirror Radix's value into
                      // our own state so failure paths can programmatically
                      // close the accordion (see loadArchivedBounties.handleFail).
                      setArchiveAccordionValue(val);
                      // Fire the archive fetch when the user expands. Idempotency
                      // lives inside loadArchivedBounties (early return when
                      // already loaded).
                      if (val === "archive") loadArchivedBounties();
                    }}
                  >
                    <AccordionItem value="archive" className="border-white/10">
                      <AccordionTrigger className="text-sm text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] hover:no-underline">
                        {/* Quick 260823-80r: label variants
                            - failed → "Archive (failed to load — click to retry)"
                            - loading → "Archive (loading…)"
                            - loaded  → "Archive (N)"
                            - unloaded (default) → "Archive" (no count — unknown) */}
                        {archivedError !== null
                          ? "Archive (failed to load — click to retry)"
                          : archivedLoadState === "loading"
                            ? "Archive (loading…)"
                            : archivedLoadState === "loaded"
                              ? `Archive (${sortedArchive.length})`
                              : "Archive"}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col gap-3 pt-2">
                          {/* Quick 260829-f9l: filter archive body by the
                              same predicate. The accordion TRIGGER label
                              still shows the total archive count (not the
                              filtered count) — Ashley's ask centers on
                              scanning matches, and the "Archive (N)" label
                              is the "how big is the archive drawer" signal. */}
                          {sortedArchive.filter(bountyMatchesQuery).map((b) => (
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
                              // This quick: needs_desk toggle threaded for
                              // archived bounties too — flipping the flag on
                              // an archived bounty stays legal, same rationale
                              // as onPinnedChange above.
                              onNeedsDeskChange={(next) => updateBountyNeedsDesk(b.slug, next)}
                              /* Quick 260727-wd0: NO onArchive here — cards
                                 under archive/ do not get an Archive button
                                 (unarchive is a separate follow-up).
                                 Quick 260729-g5r: onDelete IS threaded here
                                 — permanent delete applies to archived cards
                                 too (locked design D-2). */
                              onDelete={() => deleteBounty(b.slug)}
                              // Phase 18 / IDMEDIT-04 / Plan 05: field editors
                              // threaded for archived cards too — archived
                              // bounties can still have fields edited (e.g.
                              // add a retrospective meeting_question). SCRATCH-
                              // REPORT may gate specific fields read-only
                              // inside the card (none locked as read-only in
                              // the report for archived cards).
                              onFieldsChange={(patch) => updateBountyFields(b.slug, patch)}
                            />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </>
            )}
            </div>
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
