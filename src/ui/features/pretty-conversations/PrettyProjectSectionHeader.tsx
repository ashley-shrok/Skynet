// ─── PrettyProjectSectionHeader ─────────────────────────────────────────────
// Phase 117 Plan 117-08 Task 1 — reusable per-project section wrapper that
// implements the D-12 header shape (FolderOpen icon + "Project:" literal
// prefix + display name + SquarePen new-conversation button + ChevronDown
// collapse toggle) AND the D-22 gesture #1 per-section drop lane (type-gated
// on application/x-skynet-row, hover-only coral overlay per D-23, bounding-
// rect dragleave guard, window-level dragend for Escape-cancel, RDP row
// refusal per D-08).
//
// Byte-shape references:
//   - Header row shape: PrettyConversationsPanel.tsx:1995-2033 (Archived
//     section header) — same button + icon + label + gradient-rule +
//     chevron-rotate layout.
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
//
// Security invariants (T-117-08-01, T-117-08-02, T-117-08-03):
//   - Type-gate on application/x-skynet-row ONLY. Badge drags + OS file drops
//     never activate the overlay AND never reach onDropRow (Pitfall 7).
//   - JSON.parse wrapped in try/catch. Malformed payloads silent-drop.
//   - `id` field required + non-empty; `rdpHostRow === true` REFUSED at the
//     section boundary as defense-in-depth (backend also refuses per D-08 but
//     the frontend gate short-circuits UX).
//   - `isolation: isolate` on the wrapper sandboxes the overlay's z-index
//     budget so it can't escape past outer stacking contexts (mirrors
//     CollapsedPanelCloseLane.tsx:40 discipline).

import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, SquarePen, ChevronDown } from "lucide-react";

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
  /** User-facing project name. Rendered after the "Project:" prefix per D-12. */
  displayName: string;
  /** Pre-rendered per-project rows. Rendered inside the collapsible content region. */
  rows: ReactNode;
  /** Controlled collapse state. `true` = header only; `false` = header + rows. */
  collapsed: boolean;
  /** Fired on header-body click with the section's slug. */
  onToggleCollapse: (slug: string) => void;
  /** Fired on the SquarePen new-conversation button click with the section's slug. */
  onNewConversationClick: (slug: string) => void;
  /** Fired on a successful drop with the section's slug + parsed row payload. */
  onDropRow: (slug: string, payload: PrettyProjectDropPayload) => void;
  /**
   * Phase 117 Plan 117-09 Task 2 (D-14) — right-click / long-press handler
   * on the header. The panel opens a shared context menu at the pointer
   * coords with "Edit project file" + "Archive project" items. When
   * omitted, right-clicking falls through to browser default (no menu).
   */
  onContextMenu?: (slug: string, displayName: string, e: React.MouseEvent) => void;
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
  onContextMenu,
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
      <button
        type="button"
        onClick={() => onToggleCollapse(slug)}
        onContextMenu={(e) => {
          // Phase 117 Plan 117-09 Task 2 (D-14) — right-click / long-press
          // opens the shared context menu (Edit project file + Archive
          // project). Panel binds the callback; browser default is
          // suppressed inside the callback (`e.preventDefault()`).
          if (onContextMenu) onContextMenu(slug, displayName, e);
        }}
        className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
        data-testid={`pv-project-section-header-${slug}`}
        aria-expanded={!collapsed}
        aria-controls={`pv-project-section-content-${slug}`}
      >
        <FolderOpen
          className="size-3 text-[#5c6070]/85 shrink-0"
          aria-hidden="true"
        />
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
          Project: {displayName}
        </span>
        <span
          aria-hidden="true"
          className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
        />
        {/* Nested button: stopPropagation on the click so the header's
            collapse toggle does NOT fire when the new-conversation button
            is pressed. */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onNewConversationClick(slug);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onNewConversationClick(slug);
            }
          }}
          data-testid={`pv-project-section-new-conv-${slug}`}
          className="inline-flex items-center justify-center size-5 rounded hover:bg-white/5 text-[#5c6070]/85 shrink-0"
          aria-label={`New conversation in ${displayName}`}
          title={`New conversation in ${displayName}`}
        >
          <SquarePen className="size-3" aria-hidden="true" />
        </span>
        <ChevronDown
          className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${collapsed ? "" : "rotate-180"}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && (
        <div id={`pv-project-section-content-${slug}`}>{rows}</div>
      )}
    </div>
  );
}
