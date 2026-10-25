// ─── PrettyProjectSectionHeader ─────────────────────────────────────────────
// Phase 117 Plan 117-08 Task 1 — reusable per-project section wrapper.
// Reshaped by shape-sidebar-header-affordances (un-archiving campaign, shape 3):
// the inline SquarePen new-conversation button + the right-click/long-press
// context menu are both retired and all four section-scoped actions move into
// a single kebab menu:
//   - Edit project (opens the project modal)
//   - New conversation in this project
//   - Rename project
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
// Security invariants (T-117-08-01, T-117-08-02, T-117-08-03):
//   - Type-gate on application/x-skynet-row, or an identity badge that
//     `resolveBadgeDrop` maps to a sidebar row (it then files as that row).
//     OS file drops and unresolvable badges never activate the overlay AND
//     never reach onDropRow (Pitfall 7).
//   - JSON.parse wrapped in try/catch. Malformed payloads silent-drop.
//   - `id` field required + non-empty; `rdpHostRow === true` REFUSED at the
//     section boundary as defense-in-depth (backend also refuses per D-08 but
//     the frontend gate short-circuits UX).
//   - `isolation: isolate` on the wrapper sandboxes the overlay's z-index
//     budget so it can't escape past outer stacking contexts (mirrors
//     BadgeDropLane.tsx discipline).

import {
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Folder, Mail } from "lucide-react";

import { useDragPreviewClaim } from "@/shell/drag-preview-session";
import {
  BADGE_MIME,
  getDraggedBadge,
  hasBadgeMime,
  parseBadgePayload,
  type DraggedBadge,
} from "@/shell/badge-drag";

import { isCoarsePointer } from "./row-touch-gestures";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabSubmenuItem,
} from "./RowKebabMenu";
import {
  endProjectDrag,
  getDraggedProject,
  hasProjectMime,
  startProjectDrag,
  type DraggedProject,
} from "./project-drag";

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
  /**
   * Something anywhere inside (own rows or any sub-project, any depth) is
   * unread. Shown as a dot after the label while collapsed, so a mark is
   * never hidden behind a closed project.
   */
  hasUnread?: boolean;
  /**
   * Something anywhere inside was DM'd by its agent. Shown as a red envelope
   * after the label while collapsed, in place of the unread dot.
   */
  hasDm?: boolean;
  /** Fired on header-body click with the section's slug. */
  onToggleCollapse: (slug: string) => void;
  /** Fired on the "New conversation in this project" kebab item click. */
  onNewConversationClick: (slug: string) => void;
  /** Fired on a successful drop with the section's slug + parsed row payload. */
  onDropRow: (slug: string, payload: PrettyProjectDropPayload) => void;
  /**
   * Resolves a dragged identity badge to the row payload it files as —
   * null when the badge has no sidebar row (or can't be filed). Absent →
   * badge drags aren't accepted here.
   */
  resolveBadgeDrop?: (badge: DraggedBadge | null) => PrettyProjectDropPayload | null;
  /**
   * shape-sidebar-header-affordances: per-action callbacks for the section's
   * kebab items. All optional so the header can be mounted in test contexts
   * that don't exercise every action.
   */
  onRenameProject?: (slug: string, currentDisplayName: string) => void;
  /** Opens the project modal (Project file + Files tabs). */
  onOpenProject?: (slug: string) => void;
  onArchiveProject?: (slug: string) => void;
  /** Nested projects: "New sub-project" kebab item. */
  onNewSubProject?: (slug: string) => void;
  /**
   * Nested projects: the "Move to" kebab submenu — "Top level" plus every
   * eligible parent, already indented and filtered by the panel. Absent or
   * empty = no Move to item.
   */
  moveToItems?: RowKebabSubmenuItem[];
  /**
   * Nested projects: this section's host — carried in the header's drag
   * payload. Header dragging is enabled only when this, `draggable` and
   * `classifyProjectDrop` are all present.
   */
  hostId?: string;
  /** Header can be dragged to re-parent the project (desktop only). */
  draggable?: boolean;
  /**
   * Decides what a project drag over this section means:
   *   - "accept": a legal new parent — light up and take the drop
   *   - "own-subtree": the dragged project itself or one of its
   *     descendants — never lights up, and stops the drag from lighting an
   *     outer (ancestor) section either
   *   - "reject": not a target here (e.g. another host); outer sections may
   *     still decide
   */
  classifyProjectDrop?: (dragged: DraggedProject) => "accept" | "own-subtree" | "reject";
  /** Fired when a project is dropped here (already classified "accept"). */
  onDropProject?: (dragged: DraggedProject) => void;
}

const ROW_MIME = "application/x-skynet-row";

const hasRowMime = (dt: DataTransfer | null | undefined) =>
  !!dt && Array.from(dt.types).includes(ROW_MIME);

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
  hasUnread = false,
  hasDm = false,
  onToggleCollapse,
  onNewConversationClick,
  onDropRow,
  resolveBadgeDrop,
  onRenameProject,
  onOpenProject,
  onArchiveProject,
  onNewSubProject,
  moveToItems,
  hostId,
  draggable,
  classifyProjectDrop,
  onDropProject,
}: PrettyProjectSectionHeaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Exclusive-claim + session-end sweep (drag-preview-session.ts). Covers
  // Escape-cancel (no dragleave fires) and the lost dragend when dropping a
  // row here re-sorts it into this section and detaches the drag source.
  const { claim: claimPreview, release: releasePreview } = useDragPreviewClaim(
    `project:${slug}`,
    () => setIsDragOver(false),
  );

  // Row drags, plus badge drags that resolve to a fileable row. Anything
  // else (OS file drops, unresolvable badges) falls through without
  // preventDefault so the browser's not-a-drop-target default holds
  // (Pitfall 7).
  const accepts = (dt: DataTransfer | null | undefined) =>
    hasRowMime(dt) ||
    (hasBadgeMime(dt) && resolveBadgeDrop !== undefined && resolveBadgeDrop(getDraggedBadge()) !== null);

  // Project-header drags (nested projects). Classified per section; the
  // innermost section under the pointer decides first.
  const projectDropKind = (dt: DataTransfer | null | undefined) => {
    if (!hasProjectMime(dt) || classifyProjectDrop === undefined) return null;
    const dragged = getDraggedProject();
    if (dragged === null) return null;
    return classifyProjectDrop(dragged);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const projectKind = projectDropKind(e.dataTransfer);
    if (projectKind === "own-subtree") {
      // Swallow so no ancestor section lights up over the dragged subtree,
      // and take the preview claim (without lighting) so an ancestor lit
      // a moment ago goes dark.
      e.stopPropagation();
      claimPreview();
      return;
    }
    if (projectKind === "accept") {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
      claimPreview();
      return;
    }
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    claimPreview();
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!accepts(e.dataTransfer) && projectDropKind(e.dataTransfer) !== "accept") return;
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
    releasePreview();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // Clear overlay FIRST regardless of downstream branch (idempotent).
    setIsDragOver(false);
    releasePreview();
    const projectKind = projectDropKind(e.dataTransfer);
    if (projectKind !== null) {
      if (projectKind === "own-subtree") {
        e.stopPropagation();
        return;
      }
      if (projectKind !== "accept") return;
      e.preventDefault();
      e.stopPropagation();
      const dragged = getDraggedProject();
      endProjectDrag();
      if (dragged !== null) onDropProject?.(dragged);
      return;
    }
    // Step 1: read the discriminator MIME. A badge drop files as the row
    // it resolves to; no row MIME and no resolvable badge = not ours.
    const raw = e.dataTransfer?.getData(ROW_MIME) ?? "";
    let parsed: unknown;
    if (raw === "") {
      if (!hasBadgeMime(e.dataTransfer) || resolveBadgeDrop === undefined) return;
      parsed = resolveBadgeDrop(parseBadgePayload(e.dataTransfer.getData(BADGE_MIME)));
    } else {
      // Step 2: JSON.parse safely (T-117-08-01 — malformed payload silent drop).
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
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

  // Assemble the kebab items, each wiring an item onClick (or the Move to
  // submenu) to the per-action callback prop. Order: open the project first, then the
  // positive actions, destructive last.
  const kebabItems = [
    ...(onOpenProject
      ? [{
          label: "Edit project",
          onClick: () => onOpenProject(slug),
          testId: `pv-project-section-kebab-open-${slug}`,
        }]
      : []),
    {
      label: "New conversation in this project",
      onClick: () => onNewConversationClick(slug),
      testId: `pv-project-section-kebab-new-conv-${slug}`,
    },
    ...(onNewSubProject
      ? [{
          label: "New sub-project",
          onClick: () => onNewSubProject(slug),
          testId: `pv-project-section-kebab-new-sub-${slug}`,
        }]
      : []),
    ...(onRenameProject
      ? [{
          label: "Rename project",
          onClick: () => onRenameProject(slug, displayName),
          testId: `pv-project-section-kebab-rename-${slug}`,
        }]
      : []),
    ...(moveToItems && moveToItems.length > 0
      ? [{
          label: "Move to",
          submenu: moveToItems,
          testId: `pv-project-section-kebab-move-to-${slug}`,
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
  // Touch screens drag nothing — a press-and-hold there opens the menu.
  const headerDraggable =
    draggable === true && hostId !== undefined && classifyProjectDrop !== undefined && !isCoarsePointer();

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
        {...kebabContextMenu.holdProps}
        onKeyDown={(e) => {
          // WAI-ARIA button pattern: Enter and Space both fire the
          // collapse toggle. preventDefault on Space avoids page scroll.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse(slug);
          }
        }}
        draggable={headerDraggable || undefined}
        onDragStart={
          headerDraggable
            ? (e) => {
                startProjectDrag(e.dataTransfer, { slug, hostId: hostId! });
                console.info(`[project-drag] start slug=${slug} hostId=${hostId}`);
              }
            : undefined
        }
        onDragEnd={headerDraggable ? () => endProjectDrag() : undefined}
        className="pv-project-head group w-full text-left cursor-pointer"
        data-testid={`pv-project-section-header-${slug}`}
        aria-expanded={!collapsed}
        aria-controls={`pv-project-section-content-${slug}`}
      >
        <ChevronDown
          className="pv-section-chevron"
          data-open={collapsed ? "false" : "true"}
          aria-hidden="true"
        />
        <Folder className="pv-project-folder" aria-hidden="true" />
        <span className="pv-section-label">
          {displayName}
        </span>
        {collapsed && hasDm ? (
          <span
            className="pv-section-dm-mark"
            role="img"
            aria-label="An agent notified you"
            data-testid={`pv-project-section-dm-${slug}`}
          >
            <Mail aria-hidden="true" />
          </span>
        ) : collapsed && hasUnread ? (
          <span
            className="pv-section-unread-dot"
            role="img"
            aria-label="Has unread conversations"
            data-testid={`pv-project-section-unread-${slug}`}
          />
        ) : null}
        <span aria-hidden="true" className="flex-1" />
        {/* shape-sidebar-header-affordances: project header kebab. The
            hover-reveal wrapper mirrors the Apps header pattern verbatim
            (opacity-0 → group-hover:opacity-100 at md+; opacity-100 at <md;
            also group-focus-within for keyboard Tab-into-kebab a11y).
            RowKebabMenu's portal-click-containment prevents item-click
            leaks to the outer div's collapse toggle. */}
        <div
          className="pv-section-kebab-slot opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity shrink-0"
          data-testid={`pv-project-section-kebab-slot-${slug}`}
        >
          <RowKebabMenu
            ariaLabel={`${displayName} section menu`}
            testId={`pv-project-section-kebab-trigger-${slug}`}
            items={kebabItems}
          />
          {kebabContextMenu.menu}
        </div>
      </div>
      {!collapsed && (
        <div id={`pv-project-section-content-${slug}`} className="pv-project-content">{rows}</div>
      )}
    </div>
  );
}
