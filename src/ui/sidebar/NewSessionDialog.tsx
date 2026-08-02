// ─── NewSessionDialog ────────────────────────────────────────────────────────
// Host picker modal for the new-session flow (TG-09). Opened by
// NewSessionButton. Renders a filterable flat host list + optional
// session-name input + Cancel/Open. Auto-selects the sole host when the
// tree contains exactly one.
//
// Consumes the hostTree via a prop rather than calling getSSHHosts itself —
// AppShell already owns the fetch + memoized realHostTree, and threading
// via prop keeps this component render-in-isolation-testable and
// viewport-agnostic (no useIsTouchDevice inside — the mobile navigateToView
// is fired by AppShell's onCreateSession callback wrapper).
//
// Client-side session-name validation (T-06-04-01) is DEFENSE-IN-DEPTH:
// pattern /^[\w-]{0,64}$/, Open button disabled while non-empty invalid.
// Empty name is ALLOWED (Open enabled) — auto-fills from tmux window title
// server-side via the fork's feat/tab-title-from-tmux behavior. Backend
// tmux-session-creation sanitization is UNCHANGED and remains the actual
// security boundary.
//
// Zero new npm deps. Reuses the fork's Dialog wrapper (@/components/dialog),
// Button (@/components/button), Input (@/components/input), Plus/Search icons
// from lucide-react.

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

// Client-side session-name pattern — defense-in-depth (T-06-04-01). Word
// characters and dashes, 0-64 chars. Empty string matches (Open enabled +
// server-side auto-fill kicks in).
export const SESSION_NAME_PATTERN = /^[\w-]{0,64}$/;

// Local type-guard inlined from src/ui/sidebar/SidebarTree.tsx (Phase 12 Plan 02 — enables SidebarTree deletion in Plan 03).
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

// Local copy of SidebarTree.collectAllHosts — small enough to inline, keeps
// this file self-contained (no cross-module coupling with SidebarTree's
// internal DFS walker; if that helper is ever removed we don't break here).
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

export function NewSessionDialog({
  open,
  onClose,
  hostTree,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  hostTree: HostFolder | null;
  onCreate: (opts: { host: Host; sessionName?: string }) => void;
}) {
  const { t } = useTranslation();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [search, setSearch] = useState("");

  const flatHosts = useMemo(
    () =>
      // Patch #111 F4: exclude RDP-enabled hosts from the new-session picker.
      // Rationale (Ashley UAT 2026-07-21): RDP hosts already surface as
      // sentinel rows at the bottom of the conversation list (Plan 07-02
      // TG-15), so listing them here too is redundant clutter. Match the
      // exact predicate used in conversation-store's RDP row derivation
      // (state.hostsFlat filter on `enableRdp === true`) so the two
      // surfaces stay in agreement: any host that renders as an RDP row
      // is NOT offered in the new-session picker.
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

  // On open: if there's exactly one host in the tree, auto-select it (Test 9).
  // On close: reset all local state so a re-open starts fresh.
  useEffect(() => {
    if (open) {
      if (flatHosts.length === 1) {
        setSelectedHost(flatHosts[0]);
      }
    } else {
      setSelectedHost(null);
      setSessionName("");
      setSearch("");
    }
  }, [open, flatHosts]);

  const nameValid = SESSION_NAME_PATTERN.test(sessionName);
  const canOpen = selectedHost !== null && nameValid;

  const title = t("nav.newSession", { defaultValue: "New session" });
  const startTitle = t("nav.newSessionTitle", {
    defaultValue: "Start a new conversation",
  });
  const startDescription = t("nav.newSessionDescription", {
    defaultValue: "Pick a host and (optionally) name the session.",
  });
  const searchPlaceholder = t("nav.newSessionSearchHosts", {
    defaultValue: "Search hosts",
  });
  const namePlaceholder = t("nav.newSessionNamePlaceholder", {
    defaultValue: "auto",
  });
  const nameLabel = t("nav.newSessionNameLabel", {
    defaultValue: "Session name (optional)",
  });
  const nameErrorText = t("nav.newSessionNameError", {
    defaultValue:
      "Use letters, numbers, underscores, or dashes (max 64 characters).",
  });
  const cancelLabel = t("common.cancel", { defaultValue: "Cancel" });
  const openLabel = t("common.open", { defaultValue: "Open" });
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
        className="w-[calc(100vw-2rem)] sm:max-w-md"
        style={{ "--pv-hue": "190", "--color-pv-code-fg": "#92eafc" } as React.CSSProperties}
      >
        <DialogHeader>
          <DialogTitle>{startTitle}</DialogTitle>
          <DialogDescription>{startDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Search input — same visual idiom as HostsPanel.tsx lines 331-347 */}
          <div className="flex items-center gap-2 px-2.5 h-7 bg-[color:var(--color-pv-surface-quiet)] border border-[color:var(--color-pv-border-quiet-strong)] rounded-sm">
            <Search className="size-3 text-[color:var(--color-pv-fg-dim)] shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] min-w-0"
            />
          </div>

          {/* Scrollable host list */}
          <div
            className="flex flex-col max-h-72 overflow-y-auto border border-[color:var(--color-pv-border-quiet)] rounded-sm"
            role="listbox"
            aria-label={t("nav.newSessionHostList", { defaultValue: "Hosts" })}
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
                    onClick={() => setSelectedHost(h)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-[color:var(--color-pv-border-quiet)] last:border-b-0 ${
                      selected
                        ? "bg-[hsla(var(--pv-hue,35),45%,28%,0.42)] text-[color:var(--color-pv-fg)]"
                        : "hover:bg-[hsla(var(--pv-hue,35),40%,25%,0.18)] text-[color:var(--color-pv-fg)]"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${
                        h.online ? "bg-green-500" : "bg-[color:var(--color-pv-fg-dim)]"
                      }`}
                      aria-hidden
                    />
                    <span className="font-semibold truncate flex-1">
                      {h.name}
                    </span>
                    <span className="text-[10px] text-[color:var(--color-pv-fg-muted)] truncate">
                      {h.username ? `${h.username}@${h.ip}` : h.ip}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Session-name input — optional; empty is valid (server auto-fills
              from tmux window title). Validation is defense-in-depth per
              T-06-04-01 — the backend tmux path is the security boundary. */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-session-name"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              {nameLabel}
            </label>
            <Input
              id="new-session-name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder={namePlaceholder}
              aria-invalid={!nameValid}
              aria-describedby={!nameValid ? "new-session-name-error" : undefined}
            />
            {!nameValid && sessionName.length > 0 && (
              <span
                id="new-session-name-error"
                className="text-xs text-[color:var(--color-pv-code-fg)]"
              >
                {nameErrorText}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="outline"
            disabled={!canOpen}
            className="text-[color:var(--color-pv-code-fg)] hover:opacity-90 disabled:opacity-50"
            onClick={() => {
              if (!canOpen || !selectedHost) return;
              onCreate({
                host: selectedHost,
                sessionName: sessionName.length > 0 ? sessionName : undefined,
              });
            }}
          >
            {openLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

