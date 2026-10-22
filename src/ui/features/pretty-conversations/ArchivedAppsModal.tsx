import * as React from "react";
import { useEffect, useState } from "react";

// ─── Phase 143 D-09 / D-16 / D-17 / D-18 / D-19 — ArchivedAppsModal ─────────
//
// Fleet-wide modal that lists all archived apps and allows the user to
// un-archive them one at a time.
//
// D-09: Rounded-square (8px border-radius) avatars, NOT circles. No host label
//       per row — fleet-wide list.
// D-16: On un-archive 200: remove the row THEN fire a kit notice (kitAlert):
//       "Un-archiving [slug]" / "It may take a moment to reflect elsewhere in
//       the app." Row is NOT removed until the endpoint returns 200 (Risk Summary
//       invariant: "the row must not be removed until the endpoint returns 200").
// D-17: On failure: row STAYS (never removed on failure). Kit notice with
//       distinct wording for name_collision; generic fallback for everything
//       else. NOT sonner — a blocking notice per product decision.
// D-18: Empty state — muted line "No archived apps." — always visible when
//       zero archived apps exist so the archived surface is discoverable.
// D-19: Modal stays open after un-archive. handleUnarchive never auto-closes
//       the modal — the only dismiss path is the Modal's built-in close button.
//
// Fetch discipline: useEffect on `open === true` triggers listArchivedApps()
// and populates state. Re-fetch on every open (fresh state — matches
// Risk-Summary "archived-list is authoritative on next fetch" recovery path).

import { Modal, ModalHead, ModalBody } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitList,
  KitListRow,
  KitLoading,
  kitAlert,
} from "@/components/kit";
import {
  listArchivedApps,
  type ArchivedAppListEntry,
} from "@/api/apps-archive-list-api";
import { unarchiveApp, UnarchiveError } from "@/api/apps-unarchive-api";
import { clearPendingAppArchive } from "@/state/app-tiles-store";
import {
  RowKebabContextMenuSurface,
  type RowKebabMenuItem,
} from "./RowKebabMenu";

// ─── Internal state shape ─────────────────────────────────────────────────────

type ModalState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ArchivedAppListEntry[] };

// ─── Component ────────────────────────────────────────────────────────────────

// apple-ux shape-creation-and-search-dialogs: a line under the title saying
// what this is, and Un-archive as a visible button on every row (the row's
// right-click menu still offers it, so the row needs no ⋮ of its own). A row's button shows progress while the
// request is out.
export function ArchivedAppsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [state, setState] = useState<ModalState>({ status: "loading" });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // D-09: Fetch on every open (re-fetch = authoritative recovery path per Risk Summary).
  useEffect(() => {
    if (!open) return;

    setState({ status: "loading" });

    listArchivedApps()
      .then((data) => {
        setState({ status: "ready", data: data ?? [] });
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to load archived apps.";
        setState({ status: "error", error: message });
      });
  }, [open]);

  // D-16 / D-17 critical sequence (Risk Summary invariant):
  // 1. Call unarchiveApp FIRST — do NOT touch state yet. Row stays visible
  //    while the request is in-flight.
  // 2. On resolve (200): remove the row THEN fire the success alert.
  // 3. On reject: do NOT touch state (row stays by construction — we never
  //    removed it). Fire the failure alert.
  // 4. D-19: never auto-close — modal stays open after un-archive.
  async function handleUnarchive(entry: ArchivedAppListEntry): Promise<void> {
    const label = entry.title ?? entry.slug;
    const key = `${entry.hostId}:${entry.slug}`;
    if (busyKey !== null) return;
    setBusyKey(key);

    try {
      // STEP 1: endpoint first — row MUST NOT be removed before this resolves.
      await unarchiveApp(entry.hostId, entry.slug);
      // Release any optimistic-archive mark this tab still holds for the
      // app, so the reconciler's restore re-surfaces the tile here too.
      clearPendingAppArchive(String(entry.hostId), entry.slug);

      // STEP 2: 200 received — now remove the row.
      setState((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              data: prev.data.filter(
                (e) => !(e.hostId === entry.hostId && e.slug === entry.slug),
              ),
            }
          : prev,
      );

      // D-16 success notice (after state update).
      await kitAlert({
        title: `Un-archiving ${label}`,
        body: "It may take a moment to reflect elsewhere in the app.",
      });
    } catch (err: unknown) {
      // STEP 3: failure — do NOT touch state. Row stays present by construction.
      const body =
        err instanceof UnarchiveError && err.reason === "name_collision"
          ? // D-17 name_collision: distinct wording so the user knows what's blocking.
            "A live app with the same slug already exists."
          : // D-17 generic fallback.
            "Try again in a moment.";

      await kitAlert({ title: `Couldn't un-archive ${label}`, body });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    // No hue prop — ArchivedApps is non-identity/non-role, so it renders in
    // the canonical slate accent per the modal.tsx convention.
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="list"
      data-testid="archived-apps-modal"
    >
      <ModalHead
        title="Archived apps"
        subtitle="Apps you've archived. Un-archive one to put it back in the sidebar."
      />
      <ModalBody className="flex flex-col">
        {state.status === "loading" ? (
          <KitLoading label="Loading…" />
        ) : state.status === "error" ? (
          <KitBanner tone="danger">{state.error}</KitBanner>
        ) : state.data.length === 0 ? (
          // D-18: empty state — always visible so the archived surface is discoverable.
          <KitEmpty title="No archived apps" body="Apps you archive land here, ready to bring back." />
        ) : (
          // D-09: row list with rounded-square avatars, no host label.
          <KitList>
            {state.data.map((entry) => {
              const label = entry.title ?? entry.slug;
              const kebabItems: RowKebabMenuItem[] = [
                {
                  label: "Un-archive",
                  onClick: () => void handleUnarchive(entry),
                  // Like the row's button: one un-archive at a time.
                  disabled: busyKey !== null,
                },
              ];

              return (
                // Right-click the row → same kebab menu at the cursor.
                <RowKebabContextMenuSurface
                  key={`${entry.hostId}:${entry.slug}`}
                  items={kebabItems}
                >
                  <KitListRow
                    avatarShape="square"
                    avatarSrc={entry.iconUrl || undefined}
                    // Fallback: first char of the display label (title when
                    // available, slug otherwise).
                    avatar={label.charAt(0).toUpperCase()}
                    title={label}
                    trailing={
                      <KitButton
                        size="sm"
                        busy={busyKey === `${entry.hostId}:${entry.slug}`}
                        disabled={busyKey !== null}
                        onClick={() => void handleUnarchive(entry)}
                        data-testid={`archived-apps-unarchive-${entry.hostId}-${entry.slug}`}
                      >
                        Un-archive
                      </KitButton>
                    }
                  />
                </RowKebabContextMenuSurface>
              );
            })}
          </KitList>
        )}
      </ModalBody>
    </Modal>
  );
}

export default ArchivedAppsModal;
