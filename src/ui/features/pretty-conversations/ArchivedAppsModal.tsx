import * as React from "react";
import { useEffect, useState } from "react";

// ─── Phase 143 D-09 / D-16 / D-17 / D-18 / D-19 — ArchivedAppsModal ─────────
//
// Fleet-wide modal that lists all archived apps and allows the user to
// un-archive them one at a time.
//
// D-09: Rounded-square (8px border-radius) avatars, NOT circles. No host label
//       per row — fleet-wide list.
// D-16: On un-archive 200: remove the row THEN fire a native alert with copy
//       "Un-archiving [slug] — it may take a moment to reflect elsewhere in the
//       app." Row is NOT removed until the endpoint returns 200 (Risk Summary
//       invariant: "the row must not be removed until the endpoint returns 200").
// D-17: On failure: row STAYS (never removed on failure). Native alert with
//       distinct wording for name_collision; generic fallback for everything
//       else. NOT sonner — native alert() per product decision.
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
  listArchivedApps,
  type ArchivedAppListEntry,
} from "@/api/apps-archive-list-api";
import { unarchiveApp, UnarchiveError } from "@/api/apps-unarchive-api";
import {
  RowKebabMenu,
  RowKebabContextMenuSurface,
  type RowKebabMenuItem,
} from "./RowKebabMenu";

// ─── Internal state shape ─────────────────────────────────────────────────────

type ModalState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ArchivedAppListEntry[] };

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchivedAppsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [state, setState] = useState<ModalState>({ status: "loading" });

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

    try {
      // STEP 1: endpoint first — row MUST NOT be removed before this resolves.
      await unarchiveApp(entry.hostId, entry.slug);

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

      // D-16 success alert (after state update).
      window.alert(
        `Un-archiving ${label} — it may take a moment to reflect elsewhere in the app.`,
      );
    } catch (err: unknown) {
      // STEP 3: failure — do NOT touch state. Row stays present by construction.
      let copy: string;

      if (err instanceof UnarchiveError && err.reason === "name_collision") {
        // D-17 name_collision: distinct wording so the user knows what's blocking.
        copy = `Couldn't un-archive ${label} — a live app with the same slug already exists.`;
      } else {
        // D-17 generic fallback.
        copy = `Couldn't un-archive ${label} — try again in a moment.`;
      }

      window.alert(copy);
    }
  }

  return (
    // No hue prop — ArchivedApps is non-identity/non-role, so it renders in
    // the canonical slate palette (hue 220, low saturation) per the
    // modal.tsx convention. Row + avatar styles below reference
    // `var(--pv-id-hue)` so they inherit the slate hue the modal sets.
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="list"
      data-testid="archived-apps-modal"
    >
      <ModalHead title="Archived apps" />
      <ModalBody className="p-0 overflow-y-auto flex flex-col">
        {state.status === "loading" ? (
          // D-18: loading state (mirror RolesListModal.tsx:330-332)
          <div className="flex-1 flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
            Loading…
          </div>
        ) : state.status === "error" ? (
          // Error state (mirror RolesListModal.tsx:333-336)
          <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
            {state.error}
          </div>
        ) : state.data.length === 0 ? (
          // D-18: empty state — always visible so the archived surface is discoverable.
          <div className="flex-1 flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.6)] text-sm">
            No archived apps.
          </div>
        ) : (
          // D-09: row list with rounded-square avatars.
          <div
            className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {state.data.map((entry) => {
              const label = entry.title ?? entry.slug;
              const kebabItems: RowKebabMenuItem[] = [
                {
                  label: "Un-archive",
                  onClick: () => void handleUnarchive(entry),
                },
              ];

              return (
                // Right-click the row → same kebab menu at the cursor.
                <RowKebabContextMenuSurface
                  key={`${entry.hostId}:${entry.slug}`}
                  items={kebabItems}
                >
                  <div
                    // Slate-tinted row — low saturation + hue from the Modal's
                    // canonical --pv-id-hue (220). Matches the ScheduledAgents /
                    // Preferences / other non-identity-non-role modal rows.
                    style={{
                      borderRadius: 14,
                      background: `linear-gradient(160deg, hsla(var(--pv-id-hue), 22%, 32%, 0.55), hsla(var(--pv-id-hue), 24%, 20%, 0.60))`,
                      border: `1px solid hsla(var(--pv-id-hue), 25%, 55%, 0.32)`,
                      boxShadow: [
                        "0 8px 24px rgba(0, 0, 0, 0.5)",
                        "inset 0 1px 0 rgba(220, 225, 245, 0.14)",
                        `0 0 32px hsla(var(--pv-id-hue), 30%, 55%, 0.14)`,
                      ].join(", "),
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      color: "#e8ecf0",
                    }}
                  >
                    {/* D-09: Rounded-SQUARE 40px avatar (NOT circle — D-09 verbatim).
                      border-radius: 8px matches .pv-app-icon-slot iOS-app-icon target
                      per AppTile.tsx D-10 (10px Claude discretion; 8 used here per
                      plan spec "border-radius: 8"). */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `linear-gradient(160deg, hsla(var(--pv-id-hue), 22%, 22%, 0.72), hsla(var(--pv-id-hue), 24%, 14%, 0.82))`,
                        border: `1px solid hsla(var(--pv-id-hue), 25%, 55%, 0.40)`,
                        boxShadow: [
                          "0 4px 12px rgba(0, 0, 0, 0.6)",
                          "inset 0 2px 0 rgba(220, 225, 245, 0.22)",
                          `0 0 24px hsla(var(--pv-id-hue), 30%, 55%, 0.26)`,
                        ].join(", "),
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {entry.iconUrl ? (
                        <img
                          src={entry.iconUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: 8,
                          }}
                        />
                      ) : (
                        // Fallback: first char of the display label (title when
                        // available, slug otherwise) in bold uppercase.
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#e8ecf0",
                          }}
                        >
                          {label.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Middle: entry label — NO host label (D-09 verbatim). */}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                        fontSize: 14,
                      }}
                    >
                      {label}
                    </span>

                    {/* Right: always-visible kebab menu — single Un-archive item (D-12/D-13). */}
                    <RowKebabMenu
                      items={kebabItems}
                      ariaLabel={`Row menu for ${entry.slug}`}
                      testId={`archived-apps-row-kebab-${entry.hostId}-${entry.slug}`}
                    />
                  </div>
                </RowKebabContextMenuSurface>
              );
            })}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

export default ArchivedAppsModal;
