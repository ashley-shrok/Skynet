// ─── Phase 115 Plan 115-06 (D-06) — PrettyArchivedRow ────────────────────────
//
// Purely presentational, INERT row for the sidebar's Archived section. Rows
// arrive here via the fleet-status feeder's distinct `identity-archived` wire
// message pool (see PrettyConversationsPanel.tsx `useArchivedFleetRows`) —
// they exist for view only.
//
// D-06 lock (inert): No context menu. No onClick. No onSelect / onKill / onPin
// / onArchive handlers. Right-click on this row does not open a
// PrettyConversationContextMenu (there is no onContextMenu handler at all —
// the browser's own right-click context menu will appear, which is fine for
// static content). No hover-actions.
//
// This is deliberately SPARSE so a future phase can widen the surface as
// un-archive / restore semantics are decided (D-05 out of scope for now).

interface PrettyArchivedRowProps {
  name: string;
  hostname: string;
}

export function PrettyArchivedRow({ name, hostname }: PrettyArchivedRowProps) {
  // Reuses the `pv-panel-row` visual base to inherit spacing/typography, but
  // with a distinctive `.pv-archived-row` marker class so styling can dim /
  // desaturate. No role="button" — this is not an interactive element.
  return (
    <div
      className="pv-panel-row pv-archived-row px-4 py-2 opacity-60"
      data-testid="pretty-archived-row"
      data-archived-name={name}
      data-archived-hostname={hostname}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="text-[14px] text-[#e8e4d8]/75 truncate"
          title={`${name} (archived on ${hostname})`}
        >
          {name}
        </span>
        <span
          className="text-[12px] text-[#5c6070]/85 truncate"
          aria-hidden="true"
        >
          ({hostname})
        </span>
      </div>
    </div>
  );
}
