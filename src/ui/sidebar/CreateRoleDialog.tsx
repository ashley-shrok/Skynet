// ─── CreateRoleDialog ─────────────────────────────────────────────────────────
// Phase 22 (SRIC-04): the create-role modal launched from the
// PrettyConversationsPanel header's `+ New role` button. Provisions a new
// role folder on the picked target host via POST /roles (roles-create.ts).
//
// Fields:
//   - Name (required, kebab-case-lowercase; validated by ROLE_NAME_PATTERN)
//   - Description (required, multi-line textarea)
//   - Host picker (same visual pattern as NewSessionDialog's inline listbox;
//     suppressed when only one pickable host — auto-selected in-place)
//
// Chain hook: `onChainToCreateIdentity({role, host, description})` is an
// OPTIONAL callback prop invoked UNCONDITIONALLY on successful submit —
// roles-without-identities is a modeling accident the UI no longer advertises,
// so the primary button always advances to the identity dialog on success.
// The prop is optional and undefined-safe (guard-checked before invocation);
// PrettyConversationsPanel wires it to open NewSessionDialog with role/host/
// description pre-filled.
//
// Not touched: NewSessionDialog surface, PrettyConversationRow.tsx, existing
// clone/identity flows. This dialog is a standalone leaf next to
// NewSessionDialog in the sidebar layer.
//
// ─── Phase 84 (D-CONTEXT items 1-6, 8) ─────────────────────────────────
// UX pass: header blurb below title, required-caption dropped,
// "Then create an agent" checkbox deleted from DOM, primary button
// ALWAYS advances to create-agent (chain callback unconditional),
// modal title conforms to "New role" dropdown label, host picker
// hidden when only one pickable host (single host still auto-picked).
// Item 7 (sibling NewSessionDialog title conform) lives in Plan 84-02.
//
// Zero new npm deps. Reuses the fork's Dialog wrapper (@/components/dialog),
// Button (@/components/button), Input (@/components/input), lucide-react icons
// (Search only — no VoicePicker/ColorPicker/AvatarPicker here).

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { Host, HostFolder } from "@/types/ui-types";
import { createRole, RoleAlreadyExistsError } from "@/api/identities-api";

// ─── Type-guard + host DFS (duplicated from NewSessionDialog L82-99) ─────────
// Kept inline pending RESEARCH F1 recommendation ("extract into reusable
// HostPickerList"). Extracting is a scope-creep change for this plan — see
// F1 for the deferred refactor rationale.

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

// ─── Role name validation ────────────────────────────────────────────────────
// Matches backend ROLE_NAME_PATTERN (identity-birth-orchestrator.ts:72) —
// kebab-case-lowercase: /^[a-z0-9-]+$/. Stricter subset of IDENTITY_KEY_RE
// (no dots, slashes, plus, equals, underscores). Defense-in-depth: backend
// re-validates before any SSH/SFTP work.
export const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

// ─── Component ───────────────────────────────────────────────────────────────

export interface CreateRoleDialogProps {
  /** Whether the dialog is open. Controlled by the caller. */
  open: boolean;
  /** Called when the dialog wants to close (success, cancel, or dismiss). */
  onClose: () => void;
  /** Host tree to populate the picker. Null while the caller is still loading. */
  hostTree: HostFolder | null;
  /**
   * Optional success callback — invoked with {name, description, host} after
   * the POST /roles round-trip returns 201. Independent of the chain callback
   * so callers can react to creation without adopting the chain.
   */
  onCreated?: (result: { name: string; description: string; host: Host }) => void;
  /**
   * Chain hook — invoked UNCONDITIONALLY with {role, host, description} after
   * a successful 201. The prop is optional and undefined-safe (guard-checked
   * before invocation). `description` is the same text captured in the role's
   * description field — pre-fills the agent brief in NewSessionDialog since
   * they're usually the same thing.
   */
  onChainToCreateIdentity?: (opts: { role: string; host: Host; description: string }) => void;
}

export function CreateRoleDialog({
  open,
  onClose,
  hostTree,
  onCreated,
  onChainToCreateIdentity,
}: CreateRoleDialogProps) {
  const { t } = useTranslation();

  // ─── State ───────────────────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [search, setSearch] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Derived: flat host list + filtered ──────────────────────────────────
  // Matches NewSessionDialog L294-317 — flatten via DFS, filter out RDP-only
  // hosts (mirrors the sibling picker's Patch #111 F4 predicate for surface
  // parity).
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

  // ─── Effect: reset state on close + auto-select single host on open ──────
  // Mirrors NewSessionDialog L328-366 pattern. On open: auto-select if the
  // tree has exactly one host (matches sibling picker UX). On close: reset
  // all state so re-open starts fresh.
  useEffect(() => {
    if (open) {
      if (flatHosts.length === 1) {
        setSelectedHost(flatHosts[0]);
      }
    } else {
      setName("");
      setDescription("");
      setSelectedHost(null);
      setSearch("");
      setSubmitting(false);
      setSubmitError(null);
    }
  }, [open, flatHosts]);

  // ─── Validation ──────────────────────────────────────────────────────────
  const nameValid = name.length > 0 && ROLE_NAME_PATTERN.test(name);
  const nameShowError = name.length > 0 && !nameValid;
  const descriptionValid = description.trim().length > 0;
  const hostValid = selectedHost !== null;
  // canOpen predicate — enables the Create button. Matches Test 12-14 gates.
  const canOpen = nameValid && descriptionValid && hostValid && !submitting;

  // ─── Submit handler ──────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!canOpen || !selectedHost) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const hostIdNum = parseInt(String(selectedHost.id), 10);
      await createRole({
        name,
        description,
        hostId: hostIdNum,
      });

      // Phase 84 (D-CONTEXT items 4 + 5): the primary button always advances to
      // the create-agent modal on success. No branching, no gating. Role name
      // + description pre-fill carry via this callback unconditionally. The
      // checkbox that used to gate this call is gone (D-CONTEXT item 3). The
      // callback prop remains optional and undefined-safe for callers that
      // don't opt in to the chain (test-only pattern; production panel wires
      // it — see PrettyConversationsPanel.tsx chainPrefill).
      if (onChainToCreateIdentity) {
        onChainToCreateIdentity({ role: name, host: selectedHost, description });
      }
      if (onCreated) {
        onCreated({ name, description, host: selectedHost });
      }
      onClose();
    } catch (err) {
      // 409 → inline "already exists" message (Test 19).
      if (err instanceof RoleAlreadyExistsError) {
        setSubmitError(
          `A role named \`${name}\` already exists on ${selectedHost.name}`,
        );
      } else {
        setSubmitError(err instanceof Error ? err.message : "create role failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── I18n strings (with defaultValue fallbacks) ──────────────────────────
  // Phase 84 (D-CONTEXT item 6): modal title conforms DOWN to the dropdown
  // label at PrettyConversationsPanel.tsx:2037 ("New role"). Same i18n key,
  // only the English defaultValue changes in place — no new key. Existing
  // translations continue to render "Create a role" until re-translated;
  // English is the source-of-truth locale for this bounty (per Copy-guard
  // LOCKED in 84-CONTEXT.md).
  const startTitle = t("nav.createRoleTitle", {
    defaultValue: "New role",
  });
  const searchPlaceholder = t("nav.createRoleSearchHosts", {
    defaultValue: "Search hosts",
  });
  const nameLabel = t("nav.createRoleNameLabel", {
    defaultValue: "Name",
  });
  const namePlaceholder = t("nav.createRoleNamePlaceholder", {
    defaultValue: "box-maintainer",
  });
  const nameErrorText = t("nav.createRoleNameError", {
    defaultValue: "Name must be kebab-case-lowercase (a-z, 0-9, hyphen only)",
  });
  const descriptionLabel = t("nav.createRoleDescriptionLabel", {
    defaultValue: "Description",
  });
  const descriptionPlaceholder = t("nav.createRoleDescriptionPlaceholder", {
    defaultValue: "What is this role responsible for?",
  });
  const cancelLabel = t("common.cancel", { defaultValue: "Cancel" });
  const openLabel = t("common.create", { defaultValue: "Create" });
  const emptyHostsLabel = t("nav.newSessionNoHosts", {
    defaultValue: "No hosts available",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto"
        style={{ "--pv-hue": "190", "--color-pv-code-fg": "#92eafc" } as React.CSSProperties}
      >
        <DialogHeader>
          <DialogTitle>{startTitle}</DialogTitle>
          {/*
           * Phase 84 (D-CONTEXT item 1): one-sentence header blurb explaining
           * what a role IS. Paired vocabulary with the future create-agent
           * blurb (create-agent-modal-ux-pass bounty carries the sibling copy:
           * "An agent is one specific worker doing a role, with its own name
           * and history."). Product language, not engineering terms — see
           * shape file §Philosophy.
           *
           * Phase 84 (D-CONTEXT item 2): the prior <DialogDescription> that
           * said "Provision a new role folder on the picked host. Name and
           * description are required." is DELETED — the fields themselves
           * already signal required state, no separate caption needed.
           */}
          <DialogDescription>
            A role is what an agent does and how it thinks — many agents can share one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Name field */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
              {nameLabel}
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
              disabled={submitting}
              aria-invalid={nameShowError || undefined}
              aria-describedby={nameShowError ? "create-role-name-error" : undefined}
              className="text-xs"
            />
            {nameShowError && (
              <span
                id="create-role-name-error"
                role="alert"
                className="text-[10px] text-red-500"
              >
                {nameErrorText}
              </span>
            )}
          </label>

          {/* Description field — multi-line textarea per RESEARCH Open Q 4 */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
              {descriptionLabel}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={descriptionPlaceholder}
              disabled={submitting}
              rows={4}
              className="text-xs bg-[color:var(--color-pv-surface-quiet)] border border-[color:var(--color-pv-border-quiet-strong)] rounded-sm px-2 py-1 outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] disabled:opacity-50 resize-y"
            />
          </label>

          {/*
           * Phase 84 (D-CONTEXT item 8): hide the host search input + host listbox
           * entirely when the user has exactly one pickable host. The existing
           * open-effect above (unchanged by this phase) still auto-selects
           * that sole host into `selectedHost`, so submission still works. When
           * the user has zero or ≥2 hosts, both the search box and the listbox
           * render as before. Rationale: Aither Health users (target segment)
           * provision one dedicated VM per user and hit this case constantly;
           * Ashley hits it herself. Matched by Plan 84-02 for NewSessionDialog.
           */}
          {flatHosts.length !== 1 && (
            <>
              {/* Host search + picker (same shape as NewSessionDialog L638-696) */}
              <div className="flex items-center gap-2 px-2.5 h-7 bg-[color:var(--color-pv-surface-quiet)] border border-[color:var(--color-pv-border-quiet-strong)] rounded-sm">
                <Search className="size-3 text-[color:var(--color-pv-fg-dim)] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  disabled={submitting}
                  className="flex-1 text-xs bg-transparent outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] min-w-0 disabled:opacity-50"
                />
              </div>

              <div
                className="flex flex-col max-h-56 overflow-y-auto border border-[color:var(--color-pv-border-quiet)] rounded-sm"
                role="listbox"
                aria-label={t("nav.createRoleHostList", { defaultValue: "Hosts" })}
              >
                {filteredHosts.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-[color:var(--color-pv-fg-dim)] text-center">
                    {emptyHostsLabel}
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
                        disabled={submitting}
                        onClick={() => !submitting && setSelectedHost(h)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-[color:var(--color-pv-border-quiet)] last:border-b-0 disabled:opacity-50 ${
                          selected
                            ? "bg-[hsla(var(--pv-hue,190),45%,28%,0.42)] text-[color:var(--color-pv-fg)]"
                            : "hover:bg-[hsla(var(--pv-hue,190),40%,25%,0.18)] text-[color:var(--color-pv-fg)]"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full shrink-0 ${
                            h.online ? "bg-green-500" : "bg-[color:var(--color-pv-fg-dim)]"
                          }`}
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
            </>
          )}

          {/* Inline submit error (409 collision OR generic) */}
          {submitError && (
            <div
              role="alert"
              className="text-xs text-red-500 border border-red-500/40 rounded-sm px-3 py-2 bg-red-500/5"
            >
              {submitError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="text-xs"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canOpen}
            className="text-xs"
          >
            {openLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
