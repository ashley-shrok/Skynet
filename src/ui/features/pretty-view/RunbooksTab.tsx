// Phase 89 Plan 05: Runbooks tab body for the identity modal (Wave 5).
//
// Renders a bare list of runbook slugs for the identity's role. Clicking a row
// fires onOpenRunbook(slug) up to the caller (Wave 6 PrettyView owns the
// swap-not-stack coordination — closes the identity modal and opens
// RunbookEditorModal). Per D-08 through D-11:
//   D-08: bare list in v1, row click is the only interaction.
//   D-09: alphabetically sorted by slug.
//   D-10: empty state per exact D-10 copy when folder absent/empty.
//   D-11: tab is always rendered even when the role has no runbooks.

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import { listRunbooks, type RunbookEntry } from "@/api/runbooks-api";
import type { TabState } from "./IdentityFileTab";

export interface RunbooksTabProps {
  /** SSH host id — inherited from the identity modal upstream. */
  hostId: number;
  /** Role slug for the loaded identity — sourced from identity.role (may be null). */
  roleName: string | null;
  /** Called when a runbook row is clicked. Fires the swap-not-stack coordination
   *  (D-06) up to PrettyView (Wave 6): PrettyView closes the identity modal and
   *  opens RunbookEditorModal for {roleName, runbookName}. */
  onOpenRunbook: (runbookName: string) => void;
}

export function RunbooksTab({ hostId, roleName, onOpenRunbook }: RunbooksTabProps): JSX.Element {
  const [runbooks, setRunbooks] = useState<TabState<RunbookEntry[]>>({ status: "loading" });

  useEffect(() => {
    // D-11: tab is always rendered, even when the role has no runbooks folder.
    // If the identity has no role resolved (identity.role is null), skip the
    // fetch and immediately show the empty state (D-10 copy).
    if (roleName === null) {
      setRunbooks({ status: "ready", data: [] });
      return;
    }
    let cancelled = false;
    setRunbooks({ status: "loading" });
    console.debug("[RunbooksTab] fetch", { hostId, roleName });
    listRunbooks(hostId, roleName)
      .then((entries) => {
        if (cancelled) return;
        console.debug("[RunbooksTab] fetch-ready", { count: entries.length });
        setRunbooks({ status: "ready", data: entries });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.debug("[RunbooksTab] fetch-error", { err });
        setRunbooks({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load runbooks",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, roleName]);

  // (1) Loading: three Skeleton placeholder rows.
  if (runbooks.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  // (2) Error: muted-red text with the error message.
  if (runbooks.status === "error") {
    return (
      <div className="text-sm text-red-400">
        Couldn&apos;t load runbooks: {runbooks.error}
      </div>
    );
  }

  // (3) Empty state per D-10 (role has no runbooks folder OR folder is empty OR roleName is null).
  // No affordance to create one (D-10: creation out of scope in v1).
  if (runbooks.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-sm text-[var(--color-pv-fg-muted)] py-8">
        This role has no runbooks yet.
      </div>
    );
  }

  // (4) List: alphabetically sorted rows per D-09. Row click is the ONLY
  // interaction (D-08 — row click only; no inline expand, no per-row menu).
  // D-09: alphabetically sorted (backend already sorts via `find | sort`,
  // but sort locally too as a defense against wire-order-drift).
  const sorted = [...runbooks.data].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((entry) => (
        <button
          key={entry.name}
          type="button"
          onClick={() => {
            console.debug("[RunbooksTab] row-click", { name: entry.name });
            onOpenRunbook(entry.name);
          }}
          className="text-left px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[#e8e4d8] text-sm cursor-pointer transition-colors"
        >
          {entry.name}
        </button>
      ))}
    </div>
  );
}
