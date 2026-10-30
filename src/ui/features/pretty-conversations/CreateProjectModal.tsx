// Phase 117 Plan 117-09 Task 1 — CreateProjectModal.tsx
// Translated to canonical Modal container 2026-09-29.
//
// Controlled modal for creating a project. Backend-authoritative slug
// derivation (D-25 + Pitfall 1 in 117-RESEARCH.md): the modal submits the
// raw displayName; the response body carries the slug produced by
// normalizeToSlug on the backend. No client-side slug preview per D-26.
//
// Error surfacing:
//   - 400 → inline "needs at least one letter" error (unslugifiable input)
//   - other → generic inline error
// Pretty-names shape (2026-09-30): slug collisions auto-suffix on the
// backend, so 409 no longer fires for duplicate names.
// All errors keep the modal open so the user can retry. No toast infra
// in v1 (D-07 graceful degradation).
//
// Composes from Modal + ModalHead + ModalBody + ModalFoot. Backdrop click
// is blocked at the Modal layer (unified 2026-09-29) so a stray outside click
// doesn't trash the user's typed name; ESC and the header close-X still work.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder } from "lucide-react";
import {
  KitBanner,
  KitButton,
  KitField,
  KitHostPicker,
  KitInput,
  type KitHostOption,
} from "@/components/kit";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { createProject } from "@/api/project-list-api";
import { submitOnEnter } from "@/lib/submit-on-enter";
import { useProjects } from "@/state/conversation-store";
import { projectLineage } from "@/state/project-lineage";
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
  /**
   * Pins the project to this host and hides the picker. Set by the "Move to"
   * menus' "New project…" item: an identity's project must live on the
   * identity's own host, so there is nothing to choose.
   */
  lockedHostId?: number;
  /**
   * Creates a sub-project of this project (same host — pair with
   * `lockedHostId`). The dialog titles itself "New sub-project" and names
   * the parent. Absent = a top-level project.
   */
  parent?: { slug: string; displayName: string };
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
 * Map an error to the user-facing inline message. Pretty-names shape: 409
 * no longer fires for duplicate names (backend auto-suffixes); only 400
 * (unslugifiable input) and generic errors reach here.
 */
function interpretError(err: unknown): string {
  const status = statusOf(err);
  if (status === 400) {
    return "Project name needs at least one letter.";
  }
  return "Couldn't create the project — try again.";
}

export function CreateProjectModal({
  open,
  onOpenChange,
  onCreated,
  hostTree,
  lockedHostId,
  parent,
}: CreateProjectModalProps) {
  const [displayName, setDisplayName] = useState<string>("");
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);

  // Flat host list. Projects live where agents run, so only machines that
  // can host agents (Windows and other non-fleet hosts have no
  // ~/fleet/projects/).
  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter(
        (h) => h.canHostAgents === true,
      ),
    [hostTree],
  );

  const hostOptions = useMemo<KitHostOption[]>(
    () =>
      flatHosts.map((h) => ({
        id: String(h.id),
        name: h.name,
        detail: h.username || undefined,
        status: h.online ? "ok" : "off",
        searchText: `${h.username ?? ""} ${h.ip ?? ""}`,
      })),
    [flatHosts],
  );

  // Reset all local state whenever the modal closes.
  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setInFlight(false);
      setError(null);
      setSelectedHost(null);
    }
  }, [open]);

  // Auto-select the single available host when only one exists (Phase 84
  // pattern). Also handles the case where a host comes online mid-authoring.
  useEffect(() => {
    if (open && flatHosts.length === 1 && selectedHost === null) {
      setSelectedHost(flatHosts[0]);
    }
  }, [open, flatHosts, selectedHost]);

  const isHostLocked = lockedHostId !== undefined;
  const canSubmit =
    displayName.trim().length > 0 &&
    !inFlight &&
    (isHostLocked || selectedHost !== null);

  const onSubmit = useCallback(async () => {
    const raw = displayName.trim();
    if (raw === "") return;
    if (lockedHostId === undefined && selectedHost === null) return;
    const hostIdNum =
      lockedHostId ?? parseInt(String(selectedHost?.id), 10);
    if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) {
      setError("Selected host has an invalid id — pick a different host.");
      return;
    }
    setError(null);
    setInFlight(true);
    try {
      const result = parent
        ? await createProject(hostIdNum, raw, parent.slug)
        : await createProject(hostIdNum, raw);
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
      setError(interpretError(err));
    } finally {
      setInFlight(false);
    }
  }, [displayName, selectedHost, lockedHostId, parent, onCreated, onOpenChange]);

  const hidePicker = isHostLocked || flatHosts.length === 1;

  // A sub-project names where it will sit, top level down.
  const projects = useProjects();
  const parentLineage = parent
    ? (() => {
        const chain = lockedHostId !== undefined ? projectLineage(projects, lockedHostId, parent.slug) : [];
        return chain.length > 0 ? chain : [parent.displayName];
      })()
    : [];

  return (
    <Modal
      open={open}
      // No closing mid-create: the caller's follow-up (moving a conversation
      // into the new project) needs the dialog's context when it lands.
      onOpenChange={(next) => {
        if (!next && inFlight) return;
        onOpenChange(next);
      }}
      size="md"
      data-testid="create-project-modal"
    >
      <ModalHead
        title={parent ? "New sub-project" : "New project"}
        subtitle={
          parent
            ? "A project inside another one."
            : "Groups conversations in the sidebar, with a shared file and folder."
        }
        closeTestId="create-project-close"
      />
      <ModalBody className="flex flex-col gap-4">
        {parent && (
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--k-s2)] text-[13.5px] text-[var(--k-t2)] min-w-0"
            data-testid="create-project-inside"
          >
            <Folder className="size-4 shrink-0 text-[var(--k-t3)]" aria-hidden="true" />
            <span className="truncate">
              Inside <b className="font-semibold text-[var(--k-t1)]">{parentLineage.join(" › ")}</b>
            </span>
          </div>
        )}
        <KitField label="Name" htmlFor="create-project-name-input">
          <KitInput
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={submitOnEnter(canSubmit, () => void onSubmit())}
            placeholder="Trip Planning"
            autoFocus
            disabled={inFlight}
            maxLength={80}
            aria-required="true"
          />
        </KitField>
        {/*
         * Host picker — hidden when the user has exactly one pickable host
         * (Phase 84 D-CONTEXT item 8 pattern). The auto-select-if-single
         * effect above ensures selectedHost is populated in that case so
         * submission still works without a visible picker.
         */}
        {!hidePicker && (
          <KitField
            label="Host"
            htmlFor="create-project-host-search"
            help="The machine the project's folder lives on. Only agents on that machine can join it."
          >
            <KitHostPicker
              hosts={hostOptions}
              selectedId={selectedHost ? String(selectedHost.id) : null}
              onSelect={(id) => {
                if (inFlight) return;
                const h = flatHosts.find((x) => String(x.id) === id);
                if (h) setSelectedHost(h);
              }}
              disabled={inFlight}
              searchable
              searchId="create-project-host-search"
              testIdPrefix="create-project-host"
            />
          </KitField>
        )}

        {error !== null && (
          <KitBanner tone="danger" data-testid="create-project-error">
            {error}
          </KitBanner>
        )}
      </ModalBody>
      <ModalFoot>
        <KitButton
          onClick={() => onOpenChange(false)}
          disabled={inFlight}
          data-testid="create-project-cancel"
        >
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          onClick={() => {
            void onSubmit();
          }}
          disabled={!canSubmit}
          busy={inFlight}
          data-testid="create-project-submit"
        >
          Create
        </KitButton>
      </ModalFoot>
    </Modal>
  );
}
