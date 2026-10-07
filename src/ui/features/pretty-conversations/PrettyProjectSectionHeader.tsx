// ─── PrettyProjectSectionHeader ─────────────────────────────────────────────
// Phase 117 Plan 117-08 Task 1 — reusable per-project section wrapper.
// Reshaped by shape-sidebar-header-affordances (un-archiving campaign, shape 3):
// the inline SquarePen new-conversation button + the right-click/long-press
// context menu are both retired and all four section-scoped actions move into
// a single kebab menu:
//   - New conversation in this project
//   - Rename project
//   - Edit project file
//   - Archive project (danger)
// Kebab reveal discipline (consumer-side, not in the shared RowKebabMenu
// primitive): hover-reveal on desktop via group/group-hover + group-focus-within
// at md+; always-visible on mobile (opacity-100 at <md where no hover exists).
// Right-click and long-press are retired entirely on sidebar surfaces —
// kebab tap/click is the sole gesture.
//
// Drop-lane mechanics (D-22 gesture #1) and collapse mechanics are unchanged.
//
// Byte-shape references (surviving):
//   - Coral overlay palette (verbatim): PrettyConversationsPanel.tsx:1636-1647
//     — bg rgba(255,184,150,0.22), border 2px rgba(255,184,150,0.60), zIndex 30.
//   - Drop-lane grammar (hover-only coral, NO baseline coral): CollapsedPanel
//     CloseLane.tsx — canonical example of a type-gated hover-only lane.
//   - DnD source contract: PrettyConversationRow.tsx:949-973 — the payload
//     shape this component's onDrop parses.
//
// Component contract:
//   - Display container: the caller passes pre-rendered rows via `rows` prop.
//     The section is NOT responsible for row selection / row props; it's a
//     pure wrapping display layer with drop-lane + collapse mechanics.
//   - Collapse state is CONTROLLED (caller owns `collapsed` + `onToggleCollapse`).
//     Persistence is a caller concern (D-40 useCollapsedProjectSlugs hook).
//   - Drop routing is HANDED UP via onDropRow(slug, payload). Actual API dispatch
//     (setSessionProject / setRelayRoomProject) lives in the panel-level handler
//     which has access to userMxid + row-source resolution.
//   - Kebab actions are HANDED UP via four per-action callbacks. The panel-level
//     handlers own the modal state + API dispatch; the header just wires the
//     item onClicks.
//
// Security invariants (T-117-08-01, T-117-08-02, T-117-08-03) — unchanged:
//   - Type-gate on application/x-skynet-row ONLY. Badge drags + OS file drops
//     never activate the overlay AND never reach onDropRow (Pitfall 7).
//   - JSON.parse wrapped in try/catch. Malformed payloads silent-drop.
//   - `id` field required + non-empty; `rdpHostRow === true` REFUSED at the
//     section boundary as defense-in-depth (backend also refuses per D-08 but
//     the frontend gate short-circuits UX).
//   - `isolation: isolate` on the wrapper sandboxes the overlay's z-index
//     budget so it can't escape past outer stacking contexts (mirrors
//     CollapsedPanelCloseLane.tsx:40 discipline).

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { FolderOpen, ChevronDown } from "lucide-react";

import { RowKebabMenu, useRowKebabContextMenu } from "./RowKebabMenu";

/**
 * Row payload extracted from the DnD dataTransfer's `application/x-skynet-row`
 * MIME. Mirrors the shape written by PrettyConversationRow.tsx:949-973 plus
 * the additive matrixRoomId + identityKey fields introduced in 117-08 for
 * relay-room + identity routing at the panel-level onDropRow handler.
 *
 * Optional fields absent on some row kinds — the panel-level handler branches
 * on which subset is present (matrixRoomId → relay-room path; host +
 * targetTmuxSession → identity path).
 */
export type PrettyProjectDropPayload = {
  id: string;
  host?: { id: string } | null;
  targetTmuxSession?: string | null;
  matrixRoomId?: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
  identityKey?: string | null;
};

export interface PrettyProjectSectionHeaderProps {
  /** Kebab-case project slug — stable identifier. Emitted verbatim in callbacks. */
  slug: string;
  /** User-facing project name. Rendered as the section label per D-12. */
  displayName: string;
  /** Pre-rendered per-project rows. Rendered inside the collapsible content region. */
  rows: ReactNode;
  /** Controlled collapse state. `true` = header only; `false` = header + rows. */
  collapsed: boolean;
  /** Fired on header-body click with the section's slug. */
  onToggleCollapse: (slug: string) => void;
  /** Fired on the "New conversation in this project" kebab item click. */
  onNewConversationClick: (slug: string) => void;
  /** Fired on a successful drop with the section's slug + parsed row payload. */
  onDropRow: (slug: string, payload: PrettyProjectDropPayload) => void;
  /**
   * shape-sidebar-header-affordances: per-action callbacks for the section's
   * kebab items. All optional so the header can be mounted in test contexts
   * that don't exercise every action.
   */
  onRenameProject?: (slug: string, currentDisplayName: string) => void;
  onEditProjectFile?: (slug: string) => void;
  onArchiveProject?: (slug: string) => void;
}

const ROW_MIME = "application/x-skynet-row";

/**
 * Per-project section wrapper: header + drop lane + collapsible rows.
 *
 * See file header for the full contract + security invariants. Tests live at
 * `PrettyProjectSectionHeader.test.tsx` colocated in the same directory.
 */
export function PrettyProjectSectionHeader({
  slug,
  displayName,
  rows,
  collapsed,
  onToggleCollapse,
  onNewConversationClick,
  onDropRow,
  onRenameProject,
  onEditProjectFile,
  onArchiveProject,
}: PrettyProjectSectionHeaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Window-level dragend for Escape-cancel path — a drag cancelled via
  // Escape does NOT fire dragleave on the section (cursor did not move),
  // so the overlay would stay lit forever without this listener. Mirrors
  // PrettyConversationsPanel.tsx:1499-1510 + CollapsedPanelCloseLane.tsx:232-234.
  useEffect(() => {
    const onDragEnd = () => setIsDragOver(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, []);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Type-gate FIRST — ONLY row drags activate the coral overlay. Badge
    // drags + OS file drops fall through without preventDefault so the
    // browser's default not-a-drop-target semantic is preserved (Pitfall 7).
    const types = e.dataTransfer?.types;
    if (!(types && Array.from(types).includes(ROW_MIME))) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Type-gate FIRST (mirrors PrettyConversationsPanel.tsx:1531-1539).
    const types = e.dataTransfer?.types;
    if (!(types && Array.from(types).includes(ROW_MIME))) return;
    // Bounding-rect stateless guard against child-boundary crossings —
    // moving the cursor between the header button and the rows region
    // fires dragleave on the outer div; the cursor is still inside the
    // section so the overlay MUST stay lit. Mirrors SplitView.tsx:301-305.
    const rect = e.currentTarget.getBoundingClientRect();
    const stillInside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (stillInside) return;
    setIsDragOver(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // Clear overlay FIRST regardless of downstream branch (idempotent).
    setIsDragOver(false);
    // Step 1: read the discriminator MIME. Empty string = not a row drop.
    const raw = e.dataTransfer?.getData(ROW_MIME) ?? "";
    if (raw === "") return;
    // Step 2: JSON.parse safely (T-117-08-01 — malformed payload silent drop).
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    // Step 3: shape validation. Must be an object with a non-empty string `id`.
    if (parsed === null || typeof parsed !== "object") return;
    const p = parsed as Partial<PrettyProjectDropPayload>;
    if (typeof p.id !== "string" || p.id.length === 0) return;
    // Step 4: RDP row refusal (T-117-08-03 / D-08 defense-in-depth).
    if (p.rdpHostRow === true) return;
    // Step 5: signal handled — prevent default browser behavior + stop
    // propagation so the outer flat-middle drop handler doesn't ALSO fire.
    e.preventDefault();
    e.stopPropagation();
    // Step 6: fire the callback. Panel-level handler resolves the row-kind
    // → API dispatch (setSessionProject for identity; setRelayRoomProject
    // for relay-room). The section only knows about the section's slug.
    onDropRow(slug, p as PrettyProjectDropPayload);
  };

  // Assemble the kebab items — four actions, each wiring an item onClick to
  // the per-action callback prop. Order follows the standard pattern (primary
  // positive action first, destructive last).
  const kebabItems = [
    {
      label: "New conversation in this project",
      onClick: () => onNewConversationClick(slug),
      testId: `pv-project-section-kebab-new-conv-${slug}`,
    },
    ...(onRenameProject
      ? [{
          label: "Rename project",
          onClick: () => onRenameProject(slug, displayName),
          testId: `pv-project-section-kebab-rename-${slug}`,
        }]
      : []),
    ...(onEditProjectFile
      ? [{
          label: "Edit project file",
          onClick: () => onEditProjectFile(slug),
          testId: `pv-project-section-kebab-edit-${slug}`,
        }]
      : []),
    ...(onArchiveProject
      ? [{
          label: "Archive project",
          onClick: () => onArchiveProject(slug),
          danger: true,
          testId: `pv-project-section-kebab-archive-${slug}`,
        }]
      : []),
  ];
  // Right-click on the header row opens the same kebab menu at the cursor.
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);

  return (
    <div
      data-testid={`pv-project-section-${slug}`}
      data-project-slug={slug}
      className="pv-panel-group pv-project-section relative"
      style={{ isolation: "isolate" }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div
          data-testid={`pv-project-drop-overlay-${slug}`}
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "rgba(255, 184, 150, 0.22)",
            border: "2px solid rgba(255, 184, 150, 0.60)",
            zIndex: 30,
          }}
        />
      )}
      {/* Outer <div role="button"> so the kebab can be a SIBLING button —
          nesting <button>s is invalid HTML. `group` enables the kebab's
          hover-reveal via group-hover below. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggleCollapse(slug)}
        onContextMenu={kebabContextMenu.onContextMenu}
        onKeyDown={(e) => {
          // WAI-ARIA button pattern: Enter and Space both fire the
          // collapse toggle. preventDefault on Space avoids page scroll.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse(slug);
          }
        }}
        className="group flex items-center gap-2.5 pl-1 pr-4 pt-3.5 pb-1.5 w-full text-left cursor-pointer"
        data-testid={`pv-project-section-header-${slug}`}
        aria-expanded={!collapsed}
        aria-controls={`pv-project-section-content-${slug}`}
      >
        <FolderOpen
          className="size-3.5 text-[#a89a80] opacity-90 shrink-0"
          aria-hidden="true"
        />
        <span className="text-[13px] font-semibold text-[#a89a80] shrink-0">
          {displayName}
        </span>
        <span
          aria-hidden="true"
          className="flex-1 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(168,154,128,0.20)_30%,rgba(168,154,128,0.20)_70%,transparent_100%)]"
        />
        {/* shape-sidebar-header-affordances: project header kebab. The
            hover-reveal wrapper mirrors the Apps header pattern verbatim
            (opacity-0 → group-hover:opacity-100 at md+; opacity-100 at <md;
            also group-focus-within for keyboard Tab-into-kebab a11y).
            RowKebabMenu's portal-click-containment prevents item-click
            leaks to the outer div's collapse toggle. */}
        <div
          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity shrink-0"
          data-testid={`pv-project-section-kebab-slot-${slug}`}
        >
          <RowKebabMenu
            ariaLabel={`${displayName} section menu`}
            testId={`pv-project-section-kebab-trigger-${slug}`}
            items={kebabItems}
          />
          {kebabContextMenu.menu}
        </div>
        <ChevronDown
          className={`size-3.5 text-[#a89a80] opacity-90 shrink-0 transition-transform ${collapsed ? "" : "rotate-180"}`}
          aria-hidden="true"
        />
      </div>
      {!collapsed && (
        <div id={`pv-project-section-content-${slug}`} className="pl-3.5">{rows}</div>
      )}
    </div>
  );
}
