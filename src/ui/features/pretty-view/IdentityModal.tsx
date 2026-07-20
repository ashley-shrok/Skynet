import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
import {
  openClaudeSessionSocket,
  type Bounty,
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

const OPEN_STATUS_ORDER = ["in_progress", "on_deck", "waiting_on_someone_else"];

const GROUP_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  on_deck: "On Deck",
  waiting_on_someone_else: "Waiting",
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
  hue: number;
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

    // Existing bounties WS (patch #87 — unchanged).
    ws.onopen = () => {
      if (cancelled) return;
      const payload: IdentityListBountiesPayload = {
        type: "identity:list-bounties",
        identityKey: identity.identityKey,
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

    // Patch #17g: fire 4 new artifact fetches in parallel.
    openOneShot<IdentityGetIdentityFilePayload, IdentityIdentityFileEvent>(
      { type: "identity:get-identity-file", identityKey: identity.identityKey },
      "identity:identity-file",
      (ev) => setIdentityFileState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.markdown }),
      (e) => setIdentityFileState({ status: "error", error: e }),
    );

    openOneShot<IdentityGetHistoryPayload, IdentityHistoryEvent>(
      { type: "identity:get-history", identityKey: identity.identityKey },
      "identity:history",
      (ev) => setHistoryState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.entries }),
      (e) => setHistoryState({ status: "error", error: e }),
    );

    openOneShot<IdentityListWakeupsPayload, IdentityWakeupsEvent>(
      { type: "identity:list-wakeups", identityKey: identity.identityKey },
      "identity:wakeups",
      (ev) => setWakeupsState(ev.error
        ? { status: "error", error: ev.error }
        : { status: "ready", data: ev.wakeups }),
      (e) => setWakeupsState({ status: "error", error: e }),
    );

    openOneShot<IdentityGetHandoffPayload, IdentityHandoffEvent>(
      { type: "identity:get-handoff", identityKey: identity.identityKey },
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
  }, [open, identity.identityKey, refetchKey]);

  // Sort/group open bounties by status group then priority (D-08, D-09).
  const grouped = useMemo(() => {
    const groups: Record<string, Bounty[]> = {
      in_progress: [],
      on_deck: [],
      waiting_on_someone_else: [],
      other: [],
    };
    for (const b of bounties) {
      const isArchived = b.status === "done" || b.status === "dropped";
      if (isArchived) {
        // done/dropped in open dir: treat as archived-in-place (D-09).
        groups.other.push(b);
        continue;
      }
      const bucket = OPEN_STATUS_ORDER.includes(b.status) ? b.status : "other";
      groups[bucket].push(b);
    }
    // Sort each group by priority asc, updated_at desc.
    for (const key of Object.keys(groups)) {
      groups[key] = sortBounties(groups[key]);
    }
    return groups;
  }, [bounties]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Size overrides — all use `!` important suffix per patch #81 rule (D-06).
          // These beat shadcn's base: max-w-[calc(100%-2rem)] sm:max-w-sm bg-popover p-4
          "w-[90vw]! max-w-[1200px]! max-w-none! h-[85vh]!",
          "p-0! bg-transparent! ring-0!",
          "flex flex-col overflow-hidden rounded-[24px]!",
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
                <div className="text-sm text-destructive">
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
                {/* Open bounties grouped by status */}
                {[...OPEN_STATUS_ORDER, "other"].map((statusKey) => {
                  const group = grouped[statusKey];
                  if (!group || group.length === 0) return null;
                  return (
                    <div key={statusKey} className="mb-6">
                      <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)] mb-2">
                        {GROUP_LABELS[statusKey]}
                      </h3>
                      <div className="flex flex-col gap-3">
                        {group.map((b) => (
                          <BountyCard key={b.id} bounty={b} hue={hue} />
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
            <WakeupsTab state={wakeupsState} hue={hue} />
          </TabsContent>

          {/* Handoff tab — patch #17g: handoff.md as markdown */}
          <TabsContent
            value="handoff"
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
          >
            <HandoffTab state={handoffState} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
