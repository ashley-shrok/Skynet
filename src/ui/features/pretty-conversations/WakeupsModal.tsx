// Phase 135 Plan 135-01 Task 3 — WakeupsModal (wave 1: list view only).
//
// Radix Dialog shell mirroring ConversationSearchModal.tsx's chrome
// (glass-morphism, 24px rounded, blue-hue gradient, backdrop blur, warm
// off-white text). ONE dimensional change: `md:max-w-[640px]` instead of
// `md:max-w-[560px]` per the settled prototype + RESEARCH § Chrome Token
// Dictionary.
//
// Wave 1 scope: fetch-on-open + reset-on-close, filter bar (search / role /
// host), row rendering via WakeupsModalRow, three Skeleton bars during
// loading, dim helper text on empty, footer count. Wave 1 stubs the form
// view — the state machine (view="list"|"form", editingSlug, kebabOpen)
// is fully wired, but the "form" branch just renders a placeholder that
// wave 2 replaces.
//
// D-XX contract:
//   D-03: no client cache — refetch every open.
//   D-06: chrome mirrors ConversationSearchModal recipe at 640×720.
//   D-08: default state on open is list.
//   D-09: host chip in metadata line (rendered by WakeupsModalRow).
//   D-10: filter bar = search + role + host, "ALL" sentinels default.
//   D-11: row click enters edit mode; toggle + kebab stopPropagation.
//   D-12: pessimistic toggle — wave 2 wires the writer; wave 1 renders
//         the banner slot but the handler is a stub.
//   D-15: loading = 3 Skeleton bars (matches shipped WakeupsTab /
//         RoleFileTab pattern per RESEARCH Pitfall #1). NOT loading text.
//   D-16: empty state = centered dim helper text (fleet-wide zero vs
//         filter-narrows-to-zero copy).
//   D-17: filter state resets on close.
//   D-18: footer = live count of visible rows + how many enabled.
//   D-26: controlled open state lifted to PrettyConversationsPanel.
//   D-27: internal state machine — list ↔ form (form is a wave-2 stub).
//   D-28: no streaming affordances (no lingering spinners).
//
// RESEARCH Pitfalls mitigated:
//   #1: 3 Skeleton bars, not loading text.
//   #7: onInteractOutside=preventDefault — X + Escape are the only close
//       paths (matches ConversationSearchModal / NewConversationModal /
//       CreateProjectModal discipline).
// Anti-Patterns:
//   - X button uses direct onClick={() => onOpenChange(false)} — the
//     Radix DialogClose wrapper is deliberately NOT used, matching the
//     ConversationSearchModal / CreateProjectModal pattern.
//   - No client-cache across modal-open cycles.
//   - No streaming affordances.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/skeleton";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  deleteWakeup,
  listWakeups,
  toggleWakeupEnabled,
  type WakeupListItem,
} from "@/api/wakeups-api";
import { WakeupsModalRow } from "./WakeupsModalRow";
import { WakeupsModalForm } from "./WakeupsModalForm";

// ---------------------------------------------------------------------------
// Host-tree flatten helpers
//
// Inlined verbatim from CreateProjectModal.tsx:55-69 (small enough that a
// shared util is not worth the migration cost — three copies exist across
// modals). Filters out RDP-only hosts so the wake-ups host dropdown mirrors
// the shape of every other host picker in the panel cluster.
// ---------------------------------------------------------------------------

function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WakeupsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostTree: HostFolder | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Filter "no filter" sentinel. Using `__ALL__` (double-underscore-bracketed)
// so the value can never collide with a real user-defined role or host name.
// (Fixed post-/close code review — M2.)
const ALL_SENTINEL = "__ALL__" as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WakeupsModal({
  open,
  onOpenChange,
  hostTree,
}: WakeupsModalProps): JSX.Element {
  // ─── State ────────────────────────────────────────────────────────────
  // items === null → loading; items === [] → empty (either fleet-wide zero
  // or load error); items non-empty → rendered by WakeupsModalRow.
  const [items, setItems] = useState<WakeupListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state (D-10). "ALL" sentinels mean "no filter". Reset on close
  // (D-17).
  const [search, setSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>(ALL_SENTINEL);
  const [hostFilter, setHostFilter] = useState<number | typeof ALL_SENTINEL>(
    ALL_SENTINEL,
  );

  // Two internal views (D-27): list default, form is a wave-2 stub. The
  // state machine transitions are fully wired in wave 1 so wave 2 only
  // has to swap the form-view placeholder for a real form.
  const [view, setView] = useState<"list" | "form">("list");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  // Which row's kebab popover is currently open (D-13 popover — Edit +
  // Delete only). null = closed.
  const [kebabOpen, setKebabOpen] = useState<string | null>(null);

  // D-12 pessimistic-toggle banner slot. Wave 2 fills the writer — the
  // real toggle handler surfaces API errors here. Local state is NOT
  // flipped on failure; visual state stays put per pessimistic semantics.
  const [toggleError, setToggleError] = useState<string | null>(null);

  // D-14 delete banner slot (wave 2). Populated by handleDeleteFromKebab
  // when the DELETE API call rejects; renders alongside toggleError at
  // the top of the list-view region.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Toggle in-flight guard (fixed post-/close code review — M3). Set of
  // slugs currently mid-PATCH; a rage-click on the same row is a no-op
  // until the first request resolves. Prevents double-fire races that
  // ping-pong the enabled state.
  const toggleInFlightRef = useRef<Set<string>>(new Set<string>());

  // ─── Fetch-on-open + reset-on-close (D-03, D-17) ──────────────────────
  useEffect(() => {
    if (!open) {
      // D-17: filter state resets on close. Also clear items so the next
      // open shows the skeleton state (D-03: no client cache).
      setItems(null);
      setLoadError(null);
      setSearch("");
      setRoleFilter(ALL_SENTINEL);
      setHostFilter(ALL_SENTINEL);
      setView("list");
      setEditingSlug(null);
      setKebabOpen(null);
      setToggleError(null);
      setDeleteError(null);
      return;
    }

    const controller = new AbortController();
    listWakeups()
      .then((rows) => {
        if (controller.signal.aborted) return;
        setItems(rows);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setLoadError(
          err instanceof Error ? err.message : "Couldn't load wake-ups",
        );
      });
    return () => controller.abort();
  }, [open]);

  // ─── Refetch helper (D-03) ────────────────────────────────────────────
  // Reused by every write handler (toggle / delete / form-save success /
  // form-cancel per RESEARCH Recommendation #7). Populates setLoadError on
  // failure so a stale-fetch banner surfaces at the top of the list.
  const refetch = useCallback(async (): Promise<void> => {
    try {
      const rows = await listWakeups();
      setItems(rows);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Couldn't refresh wake-ups",
      );
    }
  }, []);

  // ─── Derived state ────────────────────────────────────────────────────
  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter(
        (h) => h.enableRdp !== true,
      ),
    [hostTree],
  );

  // Role filter dropdown population strategy (RESEARCH Assumption A1): use
  // the union of roles across every WakeupListItem returned by the LIST
  // response. Simpler than per-host `listRolesForHost` fan-out; wave 2 may
  // revisit if users report missing-role frustration.
  const availableRoles = useMemo<string[]>(() => {
    if (items === null) return [];
    const set = new Set<string>();
    for (const item of items) {
      for (const r of item.roles) set.add(r);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Filter reconciliation (fixed post-/close code review — M1). If the user
  // has selected a role or host that no longer exists in the fresh option
  // set (because the wake-up carrying it was deleted, or the host was
  // withdrawn from access), reset the filter to "no filter" so the list
  // doesn't silently narrow to zero with a stale selection.
  useEffect(() => {
    if (
      roleFilter !== ALL_SENTINEL &&
      availableRoles.length > 0 &&
      !availableRoles.includes(roleFilter)
    ) {
      setRoleFilter(ALL_SENTINEL);
    }
  }, [availableRoles, roleFilter]);
  useEffect(() => {
    if (hostFilter === ALL_SENTINEL) return;
    const hostIds = new Set<number>();
    for (const h of flatHosts) {
      const idNum = parseInt(String(h.id), 10);
      if (Number.isFinite(idNum) && idNum > 0) hostIds.add(idNum);
    }
    if (!hostIds.has(hostFilter)) setHostFilter(ALL_SENTINEL);
  }, [flatHosts, hostFilter]);

  // Client-side filter application (D-10). Search matches on name + prompt
  // case-insensitive; role filter matches when the item's roles include
  // the picked role; host filter matches by hostId.
  const visibleItems = useMemo<WakeupListItem[]>(() => {
    if (items === null) return [];
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (q.length > 0) {
        const nameHit = row.name.toLowerCase().includes(q);
        const promptHit = row.prompt.toLowerCase().includes(q);
        if (!nameHit && !promptHit) return false;
      }
      if (roleFilter !== ALL_SENTINEL && !row.roles.includes(roleFilter)) {
        return false;
      }
      if (hostFilter !== ALL_SENTINEL && row.hostId !== hostFilter) {
        return false;
      }
      return true;
    });
  }, [items, search, roleFilter, hostFilter]);

  const totalItems = items ?? [];
  const isFiltered =
    search.trim().length > 0 ||
    roleFilter !== ALL_SENTINEL ||
    hostFilter !== ALL_SENTINEL;

  // ─── Wave-2 handlers ──────────────────────────────────────────────────
  // Row click → edit mode. The form-view branch renders the real
  // WakeupsModalForm; on save/cancel the parent refetches + swaps back.
  function handleRowClick(row: WakeupListItem): void {
    setKebabOpen(null);
    setEditingSlug(row.slug);
    setView("form");
  }

  // Pessimistic toggle (D-12): the visual state waits for API ack. On
  // failure, no local flip — the banner surfaces the API message and the
  // toggle stays in its original position.
  //
  // In-flight guard (fixed post-/close code review — M3): rage-click on the
  // same row's toggle is a no-op until the first request resolves. Prevents
  // double-fire races that ping-pong the enabled state.
  async function handleToggleClick(row: WakeupListItem): Promise<void> {
    if (toggleInFlightRef.current.has(row.slug)) return;
    toggleInFlightRef.current.add(row.slug);
    setToggleError(null);
    try {
      await toggleWakeupEnabled(row.slug, row.hostId, !row.enabled);
      await refetch(); // D-03: refetch after write
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Toggle failed");
      // NOTE: no local state flip — visual state stays in original
      // position per pessimistic semantics (D-12).
    } finally {
      toggleInFlightRef.current.delete(row.slug);
    }
  }

  function handleKebabClick(row: WakeupListItem): void {
    setKebabOpen((current) => (current === row.slug ? null : row.slug));
  }

  function handleEditFromKebab(row: WakeupListItem): void {
    setKebabOpen(null);
    setEditingSlug(row.slug);
    setView("form");
  }

  // Delete with native window.confirm (D-14). On OK, call DELETE API +
  // refetch. On Cancel, no-op. On failure, banner slot surfaces error.
  async function handleDeleteFromKebab(row: WakeupListItem): Promise<void> {
    setKebabOpen(null);
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete wake-up "${row.name}"?`);
    if (!ok) return;
    setDeleteError(null);
    try {
      await deleteWakeup(row.slug, row.hostId);
      await refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function enterCreateMode(): void {
    setEditingSlug(null);
    setView("form");
  }

  function backToList(): void {
    setView("list");
    setEditingSlug(null);
    void refetch();
  }

  // ─── Render ───────────────────────────────────────────────────────────
  const headerTitle =
    view === "list"
      ? "Wake-ups"
      : editingSlug !== null
        ? "Edit wake-up"
        : "New wake-up";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={true}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // RESEARCH Pitfall #7 (patch #111f): X + Escape are the only
            // close paths. Every other Skynet modal overrides Radix's
            // click-outside-closes default; this modal joins the pattern.
            e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            // Wave 2: in form view, Escape returns to list view instead of
            // closing the modal (unsaved-work protection matching D-27's
            // Cancel semantics). In list view, defer to Radix's default
            // (Escape closes the modal via onOpenChange(false)).
            if (view === "form") {
              e.preventDefault();
              setView("list");
              setEditingSlug(null);
              void refetch();
            }
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            // 640×720 desktop per RESEARCH § Chrome Token Dictionary
            // (prototype's spec; ConversationSearchModal uses 560).
            "md:max-w-[640px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Wake-ups
          </DialogPrimitive.Title>

          {/* ─── Header (title + [+] + close X) ──────────────────────── */}
          <div
            className="px-4 py-3 shrink-0 flex flex-row items-center gap-2"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <h2 className="text-[15px] font-semibold text-[#f0ebe0] flex-1">
              {headerTitle}
            </h2>
            {view === "list" && (
              <button
                type="button"
                aria-label="New wake-up"
                title="New wake-up"
                data-testid="wakeups-modal-add-button"
                onClick={() => enterCreateMode()}
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-colors duration-150"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
              >
                <Plus size={18} />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={() => onOpenChange(false)}
              data-testid="wakeups-modal-close-button"
              className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-colors duration-150"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(220, 225, 245, 0.10)",
              }}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ─── Body ─────────────────────────────────────────────────── */}
          {view === "list" ? (
            <>
              {/* Filter bar (D-10) — search + role + host, left-to-right. */}
              <div
                className="px-4 py-3 shrink-0 flex flex-row items-center gap-2"
                style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.06)" }}
              >
                <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md"
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.10)",
                  }}
                >
                  <Search size={14} className="shrink-0 text-[#a89a80]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or prompt..."
                    data-testid="wakeups-modal-filter-search"
                    className={cn(
                      "flex-1 min-w-0 bg-transparent text-sm text-[#e8e4d8] outline-none",
                      "placeholder:text-[color:var(--color-pv-fg-dim)]",
                    )}
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  data-testid="wakeups-modal-filter-role"
                  className="text-xs px-2 py-1.5 rounded-md outline-none cursor-pointer"
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.10)",
                    color: "#e8e4d8",
                  }}
                >
                  <option value={ALL_SENTINEL}>All roles</option>
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select
                  value={
                    hostFilter === ALL_SENTINEL ? ALL_SENTINEL : String(hostFilter)
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === ALL_SENTINEL) {
                      setHostFilter(ALL_SENTINEL);
                    } else {
                      // Fixed post-/close code review — L1: gate on parsed > 0
                      // to match WakeupsModalForm's host-id validation, which
                      // rejects 0/negative as an invalid Skynet host id.
                      const parsed = parseInt(raw, 10);
                      if (Number.isFinite(parsed) && parsed > 0) {
                        setHostFilter(parsed);
                      }
                    }
                  }}
                  data-testid="wakeups-modal-filter-host"
                  className="text-xs px-2 py-1.5 rounded-md outline-none cursor-pointer"
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.10)",
                    color: "#e8e4d8",
                  }}
                >
                  <option value={ALL_SENTINEL}>All hosts</option>
                  {flatHosts.map((h) => {
                    const idNum = parseInt(String(h.id), 10);
                    if (!Number.isFinite(idNum)) return null;
                    return (
                      <option key={h.id} value={String(idNum)}>
                        {h.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Toggle-error banner (D-12 pessimistic-write failure). */}
              {toggleError !== null && (
                <div
                  role="alert"
                  data-testid="wakeups-modal-toggle-error"
                  className="mx-4 mt-3 shrink-0 px-3 py-2 text-xs rounded-md"
                  style={{
                    background: "hsla(0, 60%, 40%, 0.14)",
                    border: "1px solid hsla(0, 60%, 55%, 0.30)",
                    color: "hsla(0, 60%, 82%, 1)",
                  }}
                >
                  {toggleError}
                </div>
              )}

              {/* Delete-error banner (D-14 delete failure). */}
              {deleteError !== null && (
                <div
                  role="alert"
                  data-testid="wakeups-modal-delete-error"
                  className="mx-4 mt-3 shrink-0 px-3 py-2 text-xs rounded-md"
                  style={{
                    background: "hsla(0, 60%, 40%, 0.14)",
                    border: "1px solid hsla(0, 60%, 55%, 0.30)",
                    color: "hsla(0, 60%, 82%, 1)",
                  }}
                >
                  {deleteError}
                </div>
              )}

              {/* Load-error banner (LIST fetch failure, initial OR refetch).
                  Fixed post-/close code review — M4: previously only rendered
                  when items was empty, so a refetch failure after a successful
                  initial load left the user staring at stale rows with no
                  indication they were stale. Now renders whenever loadError
                  is non-null; stale rows still show below so the user isn't
                  left with a blank modal on transient network drops. */}
              {loadError !== null && (
                <div
                  role="alert"
                  data-testid="wakeups-modal-load-error"
                  className="mx-4 mt-3 shrink-0 px-3 py-2 text-xs rounded-md"
                  style={{
                    background: "hsla(0, 60%, 40%, 0.14)",
                    border: "1px solid hsla(0, 60%, 55%, 0.30)",
                    color: "hsla(0, 60%, 82%, 1)",
                  }}
                >
                  {loadError}
                </div>
              )}

              {/* Scrollable rows region. */}
              <div
                className="flex flex-col flex-1 min-h-0 overflow-y-auto px-3 py-3 gap-1"
                data-testid="wakeups-modal-list"
              >
                {items === null ? (
                  // D-15 corrected via RESEARCH Pitfall #1: 3 Skeleton bars,
                  // matches shipped WakeupsTab / RoleFileTab / IdentityFileTab.
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
                    <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
                    <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
                  </div>
                ) : visibleItems.length === 0 ? (
                  // D-16: empty state, two copies depending on whether the
                  // fleet-wide count is zero OR the filter narrows to zero.
                  <div
                    className="flex items-center justify-center h-full min-h-[120px] px-6 py-8 text-center text-sm"
                    style={{ color: "var(--color-pv-fg-dim)" }}
                    data-testid="wakeups-modal-empty-state"
                  >
                    {totalItems.length === 0
                      ? "No wake-ups on any host. Click + to create one."
                      : "No wake-ups match this filter."}
                  </div>
                ) : (
                  visibleItems.map((row) => (
                    <WakeupsModalRow
                      key={`${row.hostId}::${row.slug}`}
                      row={row}
                      onRowClick={handleRowClick}
                      onToggleClick={(r) => {
                        void handleToggleClick(r);
                      }}
                      onKebabClick={handleKebabClick}
                      kebabOpen={kebabOpen === row.slug}
                      onEditFromKebab={handleEditFromKebab}
                      onDeleteFromKebab={(r) => {
                        void handleDeleteFromKebab(r);
                      }}
                    />
                  ))
                )}
              </div>

              {/* Footer (D-18) — only in list view. */}
              <div
                className="px-4 py-2 shrink-0 text-[11px] flex flex-row items-center justify-end"
                style={{
                  borderTop: "1px solid rgba(220, 225, 245, 0.10)",
                  color: "var(--color-pv-fg-dim)",
                }}
              >
                {items !== null && (
                  <div data-testid="wakeups-modal-footer-count">
                    {isFiltered && visibleItems.length !== totalItems.length
                      ? `${visibleItems.length} of ${totalItems.length} · ${visibleItems.filter((i) => i.enabled).length} enabled`
                      : `${totalItems.length} wake-up${totalItems.length === 1 ? "" : "s"} · ${totalItems.filter((i) => i.enabled).length} enabled`}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Wave-2 form view: real create/edit form. On edit-mode
               initialSpec is resolved from `items` via editingSlug; on
               create-mode it is null (form starts empty). Cancel + Save
               both trigger a refetch (D-03) and return to list view. */
            <WakeupsModalForm
              mode={editingSlug !== null ? "edit" : "create"}
              initialSpec={
                editingSlug !== null
                  ? (items?.find((i) => i.slug === editingSlug) ?? null)
                  : null
              }
              flatHosts={flatHosts}
              onCancel={backToList}
              onSaved={backToList}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
