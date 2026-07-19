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
} from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import { BountyCard } from "./BountyCard";
import { cn } from "@/lib/utils";

// Patch #87: tabbed near-fullscreen modal for the identity's bounties.
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
// Five tabs: Bounties (populated), History / Wakeups / Handoff / Standing
// Directives (placeholder "Coming soon" — D-15). Sort/group logic is
// client-side only (D-08, D-09). Archive section is a collapsed Accordion
// below the open groups (D-03).

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
  const [activeTab, setActiveTab] = useState("bounties");
  // refetchKey increments on Retry to re-trigger the fetch effect.
  const [refetchKey, setRefetchKey] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch bounties when modal opens (or refetch key increments).
  useEffect(() => {
    if (!open || !identity.identityKey) return;

    setLoading(true);
    setError(null);
    setBounties([]);
    setArchivedBounties([]);

    let cancelled = false;
    const ws = openClaudeSessionSocket();
    wsRef.current = ws;

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

    return () => {
      cancelled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
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

        {/* Header */}
        <DialogHeader
          className="px-6 pt-5 pb-3 shrink-0 flex flex-row items-center gap-3"
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
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="shrink-0 text-[#a89a80] hover:text-[#e8e4d8] hover:bg-white/10"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="mx-6 mt-3 shrink-0 bg-black/20 border border-white/10 w-auto self-start">
            <TabsTrigger value="bounties">Bounties</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="wakeups">Wakeups</TabsTrigger>
            <TabsTrigger value="handoff">Handoff</TabsTrigger>
            <TabsTrigger value="directives">Standing Directives</TabsTrigger>
          </TabsList>

          {/* Bounties tab — populated */}
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

          {/* Placeholder tabs — Coming soon (D-15) */}
          <TabsContent
            value="history"
            className="flex-1 flex items-center justify-center px-6 py-4 text-sm text-[var(--color-pv-fg-muted)]"
          >
            Coming soon — recent activity from this identity&apos;s session log.
          </TabsContent>
          <TabsContent
            value="wakeups"
            className="flex-1 flex items-center justify-center px-6 py-4 text-sm text-[var(--color-pv-fg-muted)]"
          >
            Coming soon — scheduled wake-up prompts and their spec files.
          </TabsContent>
          <TabsContent
            value="handoff"
            className="flex-1 flex items-center justify-center px-6 py-4 text-sm text-[var(--color-pv-fg-muted)]"
          >
            Coming soon — checkpointed context for handoff to the next session.
          </TabsContent>
          <TabsContent
            value="directives"
            className="flex-1 flex items-center justify-center px-6 py-4 text-sm text-[var(--color-pv-fg-muted)]"
          >
            Coming soon — long-lived rules this identity carries between sessions.
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
