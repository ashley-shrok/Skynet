/**
 * Phase 90 Plan 90-04 Task 2 — RoleBountiesTab (Plan 90-10 shim-removal refactor)
 *
 * Lift of the identity-modal Bounties tab body (IdentityModal.tsx L2212-2501)
 * into a standalone component consumed by the new RoleModal.
 *
 * ── Plan 90-10: role-name-keyed reads (identity-shim prop removed) ─────────
 * D-08.3 (CONTEXT.md lock) rejects the identity indirection. Plan 90-09
 * shipped `listBountiesForRoleName({roleName, hostId, includeArchived?})` in
 * claude-session-api.ts; this component consumes it directly. There is no
 * identity indirection anywhere in the read path.
 *
 * ── Behavior parity with IdentityModal bounties tab ──────────────────────────
 * Same client-side sort/group logic (pinned → in_progress → rest → other),
 * same lazy archive load (helper omits `includeArchived: true` on initial
 * fetch; expanding the Archive accordion fires a second call with the flag),
 * same client-side search (case-insensitive substring against title / premise
 * / slug / keywords). CRUD side effects (priority / status / pin / needs-desk
 * / archive / delete / field edits) INTENTIONALLY not lifted in this file —
 * bounty mutations from the modal UI are v2 scope (bounties are typically
 * edited via terminal). If a mutation handler was ever added, it would
 * consume a future `role:update-bounty` wire type; today the tab is read-only.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { X } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/accordion";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  listBountiesForRoleName,
  type Bounty,
} from "@/api/claude-session-api";
import { BountyCard } from "./BountyCard";

// ── Sort/group helpers duplicated verbatim from IdentityModal L155-190 ───────
// Planner-pick (Task 2 <read_first>): dup-not-extract for this phase. A
// shared module for these helpers is a future follow-up phase.
const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  unprioritized: 4,
};

const OPEN_STATUS_ORDER = ["pinned", "in_progress", "rest", "other"];

const GROUP_LABELS: Record<string, string> = {
  pinned: "Pinned",
  in_progress: "In Progress",
  rest: "",
  other: "Other",
};

function priorityWeight(p: string): number {
  return PRIORITY_WEIGHT[p] ?? 4;
}

function sortBounties(bounties: Bounty[]): Bounty[] {
  return [...bounties].sort((a, b) => {
    const pd = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (pd !== 0) return pd;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

export interface RoleBountiesTabProps {
  /** Role slug (kebab-case). Threaded into every listBountiesForRoleName call.
   *  Phase 90 Plan 90-10: the earlier identity-shim prop was removed after
   *  Plan 90-09 shipped the role-name-keyed helper (D-08.3 lock). */
  roleName: string;
  /** SSH host id — pane's active host, threaded into the byName helper. */
  hostId: number;
  /** Role's colorHue — drives the search-bar background tint so the sticky
   *  header integrates with the parent RoleModal's hue chrome. */
  hue: number;
}

export function RoleBountiesTab({
  roleName,
  hostId,
  hue,
}: RoleBountiesTabProps): JSX.Element {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [archivedBounties, setArchivedBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState<number>(0);

  // Lazy archive fetch state (mirrors IdentityModal L234-254).
  const [archivedLoadState, setArchivedLoadState] = useState<
    "unloaded" | "loading" | "loaded"
  >("unloaded");
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archiveAccordionValue, setArchiveAccordionValue] = useState<string>("");

  // Search box (mirrors IdentityModal L245).
  const [bountyQuery, setBountyQuery] = useState<string>("");

  // ── Initial fetch ────────────────────────────────────────────────────────
  //
  // Plan 90-10 shim removal: routes through listBountiesForRoleName which
  // handles socket lifecycle internally. The prior openClaudeSessionSocket
  // plumbing was pure duplication.
  useEffect(() => {
    if (!roleName) return;
    setLoading(true);
    setError(null);
    setBounties([]);
    setArchivedBounties([]);
    setArchivedLoadState("unloaded");
    setArchivedError(null);
    setArchiveAccordionValue("");

    let cancelled = false;

    void (async () => {
      try {
        const { bounties: fetched } = await listBountiesForRoleName({
          roleName,
          hostId,
          // includeArchived intentionally omitted — the lazy loader below
          // fetches the archive on accordion expand.
        });
        if (cancelled) return;
        setBounties((fetched as Bounty[]) ?? []);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Connection failed");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roleName, hostId, refetchKey]);

  // ── Lazy archive loader ──────────────────────────────────────────────────
  const loadArchivedBounties = useCallback(() => {
    if (!roleName) return;
    if (archivedLoadState === "loaded" && archivedError === null) return;
    if (archivedLoadState === "loading") return;

    setArchivedLoadState("loading");
    setArchivedError(null);

    void (async () => {
      try {
        const { archivedBounties: fetched } = await listBountiesForRoleName({
          roleName,
          hostId,
          includeArchived: true,
        });
        setArchivedBounties((fetched as Bounty[]) ?? []);
        setArchivedLoadState("loaded");
        setArchivedError(null);
      } catch (e) {
        setArchivedError(
          e instanceof Error ? e.message : "Failed to load archive",
        );
        setArchivedLoadState("unloaded");
        setArchiveAccordionValue("");
      }
    })();
  }, [roleName, hostId, archivedLoadState, archivedError]);

  // ── Group open bounties (lifted verbatim from IdentityModal L788-822) ─────
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
        groups.other.push(b);
        continue;
      }
      if (b.status === "in_progress") {
        groups.in_progress.push(b);
      } else {
        groups.rest.push(b);
      }
    }
    for (const key of Object.keys(groups)) {
      groups[key] = sortBounties(groups[key]);
    }
    return groups;
  }, [bounties]);

  const sortedArchive = useMemo(
    () =>
      [...archivedBounties].sort((a, b) =>
        (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
      ),
    [archivedBounties],
  );

  const hasOpen =
    OPEN_STATUS_ORDER.some((s) => grouped[s].length > 0) ||
    grouped.other.length > 0;
  const hasArchive = sortedArchive.length > 0;

  const bountyQueryNorm = useMemo(
    () => bountyQuery.trim().toLowerCase(),
    [bountyQuery],
  );
  const bountyMatchesQuery = useCallback(
    (b: Bounty): boolean => {
      if (!bountyQueryNorm) return true;
      const hay = [b.title, b.premise, b.slug, b.keywords.join(" ")]
        .join(" ")
        .toLowerCase();
      return hay.includes(bountyQueryNorm);
    },
    [bountyQueryNorm],
  );
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-0 pb-4">
      {/* Sticky search bar (mirrors IdentityModal L2227-2261). Rendered
          UNCONDITIONALLY so keyboard focus is never yanked by branch swaps
          (Alice 2026-08-29 lock). Background tint uses the role's hue for
          continuity with the parent RoleModal's chrome. */}
      <div
        className="sticky top-0 z-10 -mx-6 px-6 pt-4 pb-2 backdrop-blur"
        style={{ background: `hsla(${hue}, 45%, 25%, 0.82)` }}
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
            className="text-sm bg-white/5 border-white/20 text-[#f0ebe0] pr-8"
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
          <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
          <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        </div>
      ) : error ? (
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
      ) : !hasOpen &&
        !hasArchive &&
        archivedLoadState === "loaded" &&
        bountyQueryNorm === "" ? (
        <div className="flex flex-col gap-1 text-sm text-[var(--color-pv-fg-muted)]">
          <p>No open bounties for this role.</p>
          <p className="text-xs">Archive will show here when populated.</p>
        </div>
      ) : (
        <>
          {OPEN_STATUS_ORDER.map((statusKey) => {
            const group = grouped[statusKey];
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
                  {filteredGroup.map((b) => (
                    <BountyCard key={b.id} bounty={b} hue={hue} />
                  ))}
                </div>
              </div>
            );
          })}

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

          {(archivedLoadState !== "loaded" || hasArchive) && (
            <Accordion
              type="single"
              collapsible
              value={archiveAccordionValue}
              onValueChange={(val) => {
                setArchiveAccordionValue(val);
                if (val === "archive") loadArchivedBounties();
              }}
            >
              <AccordionItem value="archive" className="border-white/10">
                <AccordionTrigger className="text-sm text-[var(--color-pv-fg-muted)] hover:text-[#e8e4d8] hover:no-underline">
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
                    {sortedArchive.filter(bountyMatchesQuery).map((b) => (
                      <BountyCard key={b.id} bounty={b} hue={hue} archived />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </>
      )}
    </div>
  );
}
