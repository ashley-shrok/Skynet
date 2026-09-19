// Phase 117 Plan 117-09 Task 1 — CreateProjectModal.tsx
//
// Controlled modal for creating a project. Backend-authoritative slug
// derivation (D-25 + Pitfall 1 in 117-RESEARCH.md): the modal submits the
// raw displayName; the response body carries the slug produced by
// normalizeToSlug on the backend. No client-side slug preview per D-26.
//
// Byte-shape mirror of NewConversationModal.tsx — same controlled
// `open + onOpenChange` pattern, same Radix Dialog primitives, same
// onCreated callback shape. The single text input replaces the whole
// participant-picker flow; everything else is identical chrome.
//
// Error surfacing:
//   - 409 → inline "already exists" error message; modal stays open
//   - 400 → inline "needs at least one letter or number" error
//   - other → generic inline error
// All errors keep the modal open so the user can retry. No toast infra
// in v1 (D-07 graceful degradation).
//
// Inline-error rendering: the alert node lives inside DialogContent so
// screen readers announce it via role="alert" (aria-live=assertive on
// role="alert" is a built-in browser behavior).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { createProject } from "@/api/project-list-api";
import type { Host, HostFolder } from "@/types/ui-types";

export interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on successful backend create with the echoed slug + user's raw displayName. */
  onCreated: (result: { slug: string; displayName: string }) => void;
  /**
   * Host tree threaded from the panel. Same shape as CreateRoleDialog +
   * NewSessionDialog take; enables the Phase-84 "hide picker when the user has
   * exactly one host" affordance. When null (should not happen in production —
   * the panel always has a tree by open time), the picker renders an empty
   * listbox and submit stays disabled.
   */
  hostTree: HostFolder | null;
}

// ─── Local host-tree flatten helper ─────────────────────────────────────────
// Inlined verbatim from CreateRoleDialog.tsx:90-107 / NewSessionDialog.tsx:180-190.
// Small enough that a shared util isn't worth the import cost; three copies is
// under the abstraction threshold. If this ever grows, promote to
// SidebarTree.collectAllHosts (see F1 in CreateRoleDialog for the deferred
// refactor rationale).

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

/**
 * Extract HTTP status from a caught error. handleApiError (main-axios.ts:1020)
 * throws ApiError instances carrying `.status` and `.code`. Ducks through
 * `instanceof` since ApiError is not exported from main-axios.
 */
function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Map an error to the user-facing inline message. Depends on ApiError's
 * post-handleApiError shape (`.status` + `.code`).
 */
function interpretError(err: unknown, rawDisplayName: string): string {
  const status = statusOf(err);
  if (status === 409) {
    return `A project with the slug for "${rawDisplayName}" already exists on this host — pick a different name.`;
  }
  if (status === 400) {
    return "Project name needs at least one letter or number.";
  }
  return "Couldn't create the project — try again.";
}

export function CreateProjectModal({
  open,
  onOpenChange,
  onCreated,
  hostTree,
}: CreateProjectModalProps) {
  const [displayName, setDisplayName] = useState<string>("");
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [search, setSearch] = useState<string>("");

  // Flat host list. Mirrors CreateRoleDialog.tsx:219-225 — flatten via DFS,
  // filter out RDP-only hosts (project directories live over SSH, an RDP-only
  // host has no writable ~/fleet/projects/ target).
  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter(
        (h) => h.enableRdp !== true,
      ),
    [hostTree],
  );

  const filteredHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flatHosts;
    return flatHosts.filter((h) => {
      const hay = `${h.name} ${h.username ?? ""} ${h.ip ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [flatHosts, search]);

  // Reset all local state whenever the modal closes so a re-open sees a
  // clean slate. Mirrors NewConversationModal.tsx:165-170 M1 fix.
  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setInFlight(false);
      setError(null);
      setSelectedHost(null);
      setSearch("");
    }
  }, [open]);

  // Auto-select the single available host when only one exists (Phase 84
  // pattern, mirrors CreateRoleDialog.tsx:278-282). Also handles the case
  // where a host comes online mid-authoring (hostTree ref changes) — a
  // no-op if selectedHost was already user-picked.
  useEffect(() => {
    if (open && flatHosts.length === 1 && selectedHost === null) {
      setSelectedHost(flatHosts[0]);
    }
  }, [open, flatHosts, selectedHost]);

  const canSubmit =
    displayName.trim().length > 0 && !inFlight && selectedHost !== null;

  const onSubmit = useCallback(async () => {
    const raw = displayName.trim();
    if (raw === "" || selectedHost === null) return;
    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) {
      setError("Selected host has an invalid id — pick a different host.");
      return;
    }
    setError(null);
    setInFlight(true);
    try {
      const result = await createProject(hostIdNum, raw);
      onCreated({ slug: result.slug, displayName: raw });
      onOpenChange(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error({
        operation: "create_project_modal_submit_error",
        hostId: hostIdNum,
        rawDisplayName: raw,
        errMessage: err instanceof Error ? err.message : "unknown",
        status: statusOf(err),
      });
      setError(interpretError(err, raw));
    } finally {
      setInFlight(false);
    }
  }, [displayName, selectedHost, onCreated, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
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
            // X + Esc are the only close paths (Cancel button retired).
            e.preventDefault();
          }}
          aria-label="New project"
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            // Single-host users see the compact 320px shell (unchanged from
            // pre-picker). Multi-host users get a taller shell to accommodate
            // the search input + up to ~5 rows of listbox before scroll.
            flatHosts.length === 1
              ? "md:max-w-[420px] md:max-h-[320px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2"
              : "md:max-w-[420px] md:max-h-[560px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
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
          data-testid="create-project-modal"
        >
          {/* a11y: sr-only title for screen readers (visible title lives in the header row below) */}
          <DialogTitle className="sr-only">New project</DialogTitle>

          {/* ─── Header ───────────────────────────────────────────────────── */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <h2 className="text-[15px] font-semibold text-[#f0ebe0] flex-1">
              New project
            </h2>

            {/* Glass X close button — mirrors NewConversationModal.tsx L325-352
                (which was itself lifted verbatim from GlobalFilesModal.tsx). */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                data-testid="create-project-close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow =
                    "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-3 gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="create-project-name-input"
                className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
              >
                Project name
              </label>
              <input
                id="create-project-name-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Trip Planning"
                autoFocus
                disabled={inFlight}
                maxLength={80}
                aria-required="true"
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
                  "placeholder:text-[color:var(--color-pv-fg-dim)]",
                  "transition-colors duration-150",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              />
            </div>
            {/*
             * Host picker — hidden when the user has exactly one pickable
             * host (Phase 84 D-CONTEXT item 8 pattern, mirrors
             * CreateRoleDialog.tsx:729-797). The auto-select-if-single
             * effect above ensures selectedHost is populated in that case
             * so submission still works without a visible picker. When the
             * user has zero or ≥2 hosts, both the search box and the
             * listbox render — the multi-host user needs
             * to see WHERE the project lands so a mis-pick like
             * "test-project on thenasty when I meant t1000" can't happen
             * silently.
             */}
            {flatHosts.length !== 1 && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="create-project-host-search"
                  className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
                >
                  Host
                </label>

                {/* Host search input — same shape as CreateRoleDialog picker */}
                <div className="flex items-center gap-2 px-2.5 h-7 bg-black/20 border border-white/10 rounded-sm">
                  <Search className="size-3 text-[color:var(--color-pv-fg-dim)] shrink-0" />
                  <input
                    id="create-project-host-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search hosts"
                    aria-label="Search hosts"
                    disabled={inFlight}
                    className="flex-1 text-xs bg-transparent outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[#e8e4d8] min-w-0 disabled:opacity-50"
                  />
                </div>

                {/* Host listbox */}
                <div
                  className="flex flex-col max-h-56 overflow-y-auto border border-white/10 rounded-sm"
                  role="listbox"
                  aria-label="Hosts"
                  data-testid="create-project-host-listbox"
                >
                  {filteredHosts.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-[color:var(--color-pv-fg-dim)] text-center">
                      No hosts match your search.
                    </div>
                  ) : (
                    filteredHosts.map((h) => {
                      const selected = selectedHost?.id === h.id;
                      return (
                        <button
                          key={h.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={inFlight}
                          onClick={() => !inFlight && setSelectedHost(h)}
                          data-testid={`create-project-host-option-${h.id}`}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-white/5 last:border-b-0 disabled:opacity-50",
                            selected
                              ? "bg-[hsla(220,55%,45%,0.35)] text-[#f0ebe0]"
                              : "hover:bg-white/5 text-[#e8e4d8]",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full shrink-0",
                              h.online
                                ? "bg-green-500"
                                : "bg-[color:var(--color-pv-fg-dim)]",
                            )}
                          />
                          <span className="flex-1 truncate">{h.name}</span>
                          {h.username && (
                            <span className="text-[10px] text-[color:var(--color-pv-fg-dim)] shrink-0">
                              {h.username}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {error !== null && (
              <div
                role="alert"
                className="text-xs text-red-400"
                data-testid="create-project-error"
              >
                {error}
              </div>
            )}
          </div>

          <div
            className="px-6 py-4 shrink-0 flex flex-row gap-2 justify-end"
            style={{ borderTop: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <Button
              type="button"
              onClick={() => {
                void onSubmit();
              }}
              disabled={!canSubmit}
              data-testid="create-project-submit"
            >
              Create project
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
