// Phase 117 Plan 117-09 Task 1 — CreateProjectModal.tsx
// Translated to canonical Modal container 2026-09-29.
//
// Controlled modal for creating a project. Backend-authoritative slug
// derivation (D-25 + Pitfall 1 in 117-RESEARCH.md): the modal submits the
// raw displayName; the response body carries the slug produced by
// normalizeToSlug on the backend. No client-side slug preview per D-26.
//
// Error surfacing:
//   - 409 → inline "already exists" error message; modal stays open
//   - 400 → inline "needs at least one letter or number" error
//   - other → generic inline error
// All errors keep the modal open so the user can retry. No toast infra
// in v1 (D-07 graceful degradation).
//
// Composes from Modal + ModalHead + ModalBody + ModalFoot. Backdrop click
// is blocked at the Modal layer (unified 2026-09-29) so a stray outside click
// doesn't trash the user's typed name; ESC and the header close-X still work.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { createProject } from "@/api/project-list-api";
import type { Host, HostFolder } from "@/types/ui-types";

export interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on successful backend create with the echoed slug + user's raw displayName. */
  onCreated: (result: { slug: string; displayName: string }) => void;
  /**
   * Host tree threaded from the panel. Enables the Phase-84 "hide picker when
   * the user has exactly one host" affordance. When null (should not happen in
   * production — the panel always has a tree by open time), the picker
   * renders an empty listbox and submit stays disabled.
   */
  hostTree: HostFolder | null;
}

// ─── Local host-tree flatten helper ─────────────────────────────────────────
// Inlined verbatim from CreateRoleDialog.tsx / NewSessionDialog.tsx. Small
// enough that a shared util isn't worth the import cost; three copies is
// under the abstraction threshold.

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
 * throws ApiError instances carrying `.status` and `.code`.
 */
function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Map an error to the user-facing inline message.
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

  // Flat host list. Flatten via DFS, filter out RDP-only hosts (project
  // directories live over SSH; RDP-only hosts have no writable
  // ~/fleet/projects/ target).
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

  // Reset all local state whenever the modal closes.
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
  // pattern). Also handles the case where a host comes online mid-authoring.
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

  const isSingleHost = flatHosts.length === 1;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      hue={220}
      size="md"
      data-testid="create-project-modal"
      className={cn(
        isSingleHost ? "max-h-[320px]" : "max-h-[560px]",
        "flex flex-col",
      )}
    >
      <ModalHead title="New project" closeTestId="create-project-close" />
      <ModalBody className="overflow-y-auto flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="create-project-name-input"
            className="text-[10.5px] font-medium tracking-[0.1em] uppercase text-[hsla(var(--pv-id-hue),30%,90%,0.65)]"
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
              "w-full px-3 py-2 rounded-lg text-sm text-[#fbf5e8]",
              "bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)]",
              "outline-none",
              "focus:border-[hsla(var(--pv-id-hue),70%,60%,0.5)] focus:bg-black/30",
              "placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.55)]",
              "transition-colors duration-150",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          />
        </div>
        {/*
         * Host picker — hidden when the user has exactly one pickable host
         * (Phase 84 D-CONTEXT item 8 pattern). The auto-select-if-single
         * effect above ensures selectedHost is populated in that case so
         * submission still works without a visible picker.
         */}
        {!isSingleHost && (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="create-project-host-search"
              className="text-[10.5px] font-medium tracking-[0.1em] uppercase text-[hsla(var(--pv-id-hue),30%,90%,0.65)]"
            >
              Host
            </label>

            {/* Host search input */}
            <div className="flex items-center gap-2 px-2.5 h-8 bg-black/20 border border-[hsla(var(--pv-id-hue),65%,55%,0.22)] rounded-md">
              <Search className="size-3 text-[hsla(var(--pv-id-hue),22%,88%,0.55)] shrink-0" />
              <input
                id="create-project-host-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hosts"
                aria-label="Search hosts"
                disabled={inFlight}
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-[hsla(var(--pv-id-hue),22%,88%,0.55)] text-[#fbf5e8] min-w-0 disabled:opacity-50"
              />
            </div>

            {/* Host listbox */}
            <div
              className="flex flex-col max-h-56 overflow-y-auto border border-[hsla(var(--pv-id-hue),65%,55%,0.18)] rounded-md"
              role="listbox"
              aria-label="Hosts"
              data-testid="create-project-host-listbox"
            >
              {filteredHosts.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[hsla(var(--pv-id-hue),22%,88%,0.55)] text-center">
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
                        "flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                        "border-b border-[hsla(var(--pv-id-hue),65%,55%,0.10)] last:border-b-0",
                        "disabled:opacity-50",
                        selected
                          ? "bg-[hsla(var(--pv-id-hue),55%,45%,0.35)] text-[#fbf5e8]"
                          : "hover:bg-white/5 text-[hsla(var(--pv-id-hue),22%,92%,0.85)]",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full shrink-0",
                          h.online
                            ? "bg-green-500"
                            : "bg-[hsla(var(--pv-id-hue),22%,88%,0.45)]",
                        )}
                      />
                      <span className="flex-1 truncate">{h.name}</span>
                      {h.username && (
                        <span className="text-[10px] text-[hsla(var(--pv-id-hue),22%,88%,0.55)] shrink-0">
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
      </ModalBody>
      <ModalFoot>
        <Button
          type="button"
          variant="default"
          onClick={() => {
            void onSubmit();
          }}
          disabled={!canSubmit}
          data-testid="create-project-submit"
        >
          Create
        </Button>
      </ModalFoot>
    </Modal>
  );
}
