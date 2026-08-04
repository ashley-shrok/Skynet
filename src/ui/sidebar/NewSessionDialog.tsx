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
// Phase 20 Plan 05: Extended with identity-birth field cluster (IDUI-01,
// IDUI-02, IDUI-03, IDUI-10). Identity-mode checkbox (default ON) reveals
// title, brief, avatar picker, VoicePicker, ColorPicker. Path field visible
// in both modes. Both collision checks fire on name blur. Avatar batch fetch
// + required pick. Brief EPHEMERAL — never persisted anywhere.
//
// Phase 20 Plan 06: SSE birth stream consumer (IDUI-06, IDUI-07, IDUI-08).
// When Create fires with identityMode=true, opens an SSE stream against
// POST /identities/birth, renders the 5-step BirthProgress checklist,
// shows per-step failure blurbs on failure, closes on success + fires
// focus-follow via AppShell's existing openTab flow.
// NO cancel/retry/rollback affordances per D-CONTEXT non-negotiables.
//
// Zero new npm deps. Reuses the fork's Dialog wrapper (@/components/dialog),
// Button (@/components/button), Input (@/components/input), Plus/Search icons
// from lucide-react.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2, Check, XCircle, Circle } from "lucide-react";

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
import { VoicePicker } from "@/features/pretty-view/pickers/VoicePicker";
import { ColorPicker } from "@/features/pretty-view/pickers/ColorPicker";
import {
  listIdentities,
  postGenerateAvatarBatch,
  getIdentityExistsOnHost,
  openBirthStream,
  listRolesForHost,
  type AvatarCandidate,
  type BirthEvent,
  type RoleSummary,
} from "@/api/identities-api";

// Client-side session-name pattern — defense-in-depth (T-06-04-01). Word
// characters and dashes, 0-64 chars. Empty string matches (Open enabled +
// server-side auto-fill kicks in).
export const SESSION_NAME_PATTERN = /^[\w-]{0,64}$/;

// Identity name pattern matching backend IDENTITY_KEY_RE at identities.ts:22.
// Must match [a-z0-9._=/+-]+ (lowercase, digits, and specific special chars).
export const IDENTITY_NAME_PATTERN = /^[a-z0-9._=/+-]+$/;

// Path normalization: convert backslashes to forward slashes; empty/whitespace → "~".
export function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return "~";
  return trimmed.replace(/\\/g, "/");
}

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

// TODO (plan 06): Update AppShell.tsx onCreate handler to accept this new discriminated union
// shape. Until plan 06 ships, AppShell.tsx will fail to compile if it references
// the old single-object shape.
export type NewSessionOnCreateOpts =
  | { host: Host; sessionName?: string; path: string; identityMode: false }
  | {
      host: Host;
      sessionName?: string;
      path: string;
      identityMode: true;
      name: string;
      title: string;
      brief: string;
      avatarCandidateId: string;
      voice: string | null;
      colorHue: number | null;
    };

// ─── BirthProgress ─────────────────────────────────────────────────────────
// Step labels for the 5-step birth sequence (matching CONTEXT.md §"Compound birth sequence")
const BIRTH_STEP_LABELS = [
  "Create Skynet identity record",
  "Open tmux session", // rendered with hostName at runtime
  "Launch Claude CLI",
  "Bootstrap dance",
  "Send /id command",
];

// Failure blurbs verbatim from D-CONTEXT §"Failure blurbs", indexed 0-4 (step N is index N-1).
// Slots: <host>, <name>, <path> — replaced at render time.
const BIRTH_STEP_BLURBS = [
  "Couldn't create the Skynet identity record. Nothing was created — safe to retry.",
  "Skynet record created, but couldn't open a tmux session on <host>. You'll need to delete the identity record from the identity modal before retrying, or open the session by hand: `ssh <host> tmux new-session -d -s <name> -c <path>`.",
  "Session is open on <host>, but the Claude CLI didn't launch. Attach with `ssh <host> tmux attach -t <name>` and start it yourself.",
  "Session is open and Claude launched, but the bootstrap dance didn't complete. Attach with `ssh <host> tmux attach -t <name>` and press Enter a few times until the REPL responds, then run `/id <name>` yourself.",
  "Session is at the REPL, but /id <name> didn't fire. Attach with `ssh <host> tmux attach -t <name>` and run it yourself.",
];

type StepStatus = "pending" | "in-progress" | "done" | "failed";

interface BirthStepState {
  n: 1 | 2 | 3 | 4 | 5;
  status: StepStatus;
  reason?: string;
}

const INITIAL_BIRTH_PROGRESS: BirthStepState[] = [
  { n: 1, status: "pending" },
  { n: 2, status: "pending" },
  { n: 3, status: "pending" },
  { n: 4, status: "pending" },
  { n: 5, status: "pending" },
];

// BirthProgress — inline sub-component for the 5-step ticking checklist
function BirthProgress({
  steps,
  failedStep,
  hostName,
  identityName,
  identityPath,
}: {
  steps: BirthStepState[];
  failedStep: number | null;
  hostName: string;
  identityName: string;
  identityPath: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-[color:var(--color-pv-border-quiet)]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
        Birth Progress
      </span>
      {steps.map((step, i) => {
        const label =
          step.n === 2
            ? `Open tmux session on ${hostName}`
            : BIRTH_STEP_LABELS[i];
        return (
          <div key={step.n} data-status={step.status} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center shrink-0">
                {step.status === "pending" && (
                  <Circle className="size-3.5 text-[color:var(--color-pv-fg-dim)]" />
                )}
                {step.status === "in-progress" && (
                  <Loader2 className="size-3.5 text-[color:var(--color-pv-code-fg)] animate-spin" />
                )}
                {step.status === "done" && (
                  <Check className="size-3.5 text-green-500" />
                )}
                {step.status === "failed" && (
                  <XCircle className="size-3.5 text-red-500" />
                )}
              </span>
              <span
                className={`text-xs ${
                  step.status === "done"
                    ? "text-green-500"
                    : step.status === "failed"
                      ? "text-red-400"
                      : step.status === "in-progress"
                        ? "text-[color:var(--color-pv-fg)]"
                        : "text-[color:var(--color-pv-fg-dim)]"
                }`}
              >
                {label}
              </span>
            </div>
            {/* Failure blurb — only shown for the failed step */}
            {step.status === "failed" && failedStep === step.n && (
              <div className="ml-5 flex flex-col gap-1">
                <p className="text-xs text-red-400">
                  {BIRTH_STEP_BLURBS[step.n - 1]
                    .replace(/<host>/g, hostName)
                    .replace(/<name>/g, identityName)
                    .replace(/<path>/g, identityPath)}
                </p>
                {step.reason && (
                  <p className="text-[10px] text-[color:var(--color-pv-fg-dim)] font-mono">
                    Debug: {step.reason}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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
  onCreate: (opts: NewSessionOnCreateOpts) => void;
}) {
  const { t } = useTranslation();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [search, setSearch] = useState("");

  // Path field — visible in BOTH modes, placed below host+name and above identity-mode checkbox.
  // Default "~" (tilde-expanded server-side). Accepts "/" or "\" and normalizes to "/" on submit.
  const [path, setPath] = useState("~");

  // Identity-mode checkbox (defaults ON per IDUI-01).
  // When on, reveals the identity-birth field cluster.
  const [identityMode, setIdentityMode] = useState(true);

  // Identity birth fields — all EPHEMERAL: never persisted to any storage or disk.
  const [name, setName] = useState(""); // identity name (distinct from regular sessionName)
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState(""); // EPHEMERAL: never persisted anywhere. Only sent to avatar batch.
  const [voice, setVoice] = useState<string>("");
  const [colorHue, setColorHue] = useState<number>(210); // 210 = cyan-blue, midpoint of used-hue clusters

  // Avatar batch state
  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Collision precheck state
  const [skynetCollision, setSkynetCollision] = useState(false);
  const [hostCollision, setHostCollision] = useState(false);
  const [collisionChecking, setCollisionChecking] = useState(false);

  // Debounce ref for collision precheck (cancel on remount/name change)
  const collisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 22 SRIC-02: Role dropdown state (populated from GET /roles?hostId=<n>
  // when a host is picked with identity-mode ON). Selection blocks Create until
  // the user actively picks a role. Reset on host change AND on modal close.
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [rolesForHost, setRolesForHost] = useState<RoleSummary[]>([]);
  const [rolesLoading, setRolesLoading] = useState<boolean>(false);
  const [rolesError, setRolesError] = useState<string | null>(null);

  // Birth stream state (plan 06)
  const [birthing, setBirthing] = useState(false);
  const [birthProgress, setBirthProgress] = useState<BirthStepState[]>(
    INITIAL_BIRTH_PROGRESS.map((s) => ({ ...s })),
  );
  const [birthFailedStep, setBirthFailedStep] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Reset birth progress helper
  function resetBirthProgress() {
    setBirthing(false);
    setBirthProgress(INITIAL_BIRTH_PROGRESS.map((s) => ({ ...s })));
    setBirthFailedStep(null);
  }

  // On open: if there's exactly one host in the tree, auto-select it (Test 9).
  // On close: reset all local state so a re-open starts fresh.
  useEffect(() => {
    if (open) {
      if (flatHosts.length === 1) {
        setSelectedHost(flatHosts[0]);
      }
    } else {
      // Abort any in-flight birth stream
      abortControllerRef.current?.abort();
      // Reset all state to defaults on close
      setSelectedHost(null);
      setSessionName("");
      setSearch("");
      setPath("~");
      setIdentityMode(true);
      setName("");
      setTitle("");
      setBrief("");
      setVoice("");
      setColorHue(210);
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      setSkynetCollision(false);
      setHostCollision(false);
      setCollisionChecking(false);
      if (collisionTimerRef.current) {
        clearTimeout(collisionTimerRef.current);
        collisionTimerRef.current = null;
      }
      // Phase 22 SRIC-02: reset role dropdown state on modal close.
      setSelectedRole("");
      setRolesForHost([]);
      setRolesLoading(false);
      setRolesError(null);
      // Reset birth state
      resetBirthProgress();
    }
  }, [open, flatHosts]);

  // Component unmount cleanup — abort stream if modal unmounts mid-birth.
  // NOTE: the backend birth sequence continues regardless; this just stops
  // the frontend from consuming SSE events (intentional per D-CONTEXT
  // §"No cancel mid-birth").
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // When identity-mode toggles OFF, clear avatar candidates + picked candidate.
  // D-CONTEXT § "Stale-avatar handling": do NOT auto-reset on name/title/brief field edits
  // (user's picked avatar stays even if they edit fields). Only clear on mode toggle.
  useEffect(() => {
    if (!identityMode) {
      setCandidates([]);
      setPickedCandidateId(null);
    }
  }, [identityMode]);

  // Phase 22 SRIC-02: Role dropdown effect — fires whenever the selected host
  // OR identity-mode changes. Populates rolesForHost via GET /roles?hostId=<n>.
  // Clears selectedRole on every host change (force re-pick — a role scoped to
  // host A is not necessarily valid on host B).
  //
  // Effect DOES NOT fire when identity-mode is OFF (Role is CREATE-only per
  // D-CONTEXT §UX rules). When identity-mode toggles OFF or the host clears,
  // we reset rolesForHost + selectedRole to defaults so a subsequent toggle
  // ON starts fresh.
  useEffect(() => {
    if (!selectedHost || !identityMode) {
      setRolesForHost([]);
      setSelectedRole("");
      setRolesLoading(false);
      setRolesError(null);
      return;
    }
    let cancelled = false;
    setRolesLoading(true);
    setRolesError(null);
    // Force re-pick on host change: the previous role's semantics don't
    // carry across hosts.
    setSelectedRole("");
    (async () => {
      try {
        const hostIdNum = parseInt(String(selectedHost.id), 10);
        const roles = await listRolesForHost(hostIdNum);
        if (cancelled) return;
        setRolesForHost(roles);
      } catch (err) {
        if (cancelled) return;
        setRolesError(err instanceof Error ? err.message : "role fetch failed");
        setRolesForHost([]);
      } finally {
        if (!cancelled) setRolesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHost, identityMode]);

  // Collision precheck: fired on name blur (debounced 300ms).
  // Fires both listIdentities + getIdentityExistsOnHost in parallel.
  function runCollisionPrecheck(currentName: string) {
    if (collisionTimerRef.current) {
      clearTimeout(collisionTimerRef.current);
    }
    // Clear state immediately if name is invalid or no host selected
    if (!currentName || !IDENTITY_NAME_PATTERN.test(currentName) || !selectedHost) {
      setSkynetCollision(false);
      setHostCollision(false);
      return;
    }
    collisionTimerRef.current = setTimeout(async () => {
      setCollisionChecking(true);
      try {
        const lowerName = currentName.toLowerCase();
        const [identities, existsOnHost] = await Promise.all([
          listIdentities(),
          getIdentityExistsOnHost(selectedHost.id as unknown as number, lowerName),
        ]);
        const skynetHit = identities.some((id) => id.identityKey === lowerName);
        setSkynetCollision(skynetHit);
        setHostCollision(existsOnHost);
      } catch {
        // If collision check fails, don't block — log silently
        setSkynetCollision(false);
        setHostCollision(false);
      } finally {
        setCollisionChecking(false);
      }
    }, 300);
  }

  // Generate/Regenerate handler
  async function handleGenerate() {
    if (genLoading) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const cands = await postGenerateAvatarBatch({ name, title, brief });
      setCandidates(cands);
      // Force re-pick per D-CONTEXT §Avatar — on explicit Regen, clear picked candidate
      // so user must pick from the fresh set. This is intentional.
      setPickedCandidateId(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  // Birth stream handler — runs when Create is clicked with identity-mode ON
  async function handleBirth() {
    if (!selectedHost || !pickedCandidateId) return;
    setBirthing(true);
    setBirthProgress(INITIAL_BIRTH_PROGRESS.map((s) => ({ ...s })));
    setBirthFailedStep(null);
    abortControllerRef.current = new AbortController();

    const normalizedPath = normalizePath(path);

    try {
      const stream = openBirthStream(
        {
          hostId: selectedHost.id as unknown as number,
          name: name.toLowerCase(),
          title,
          path: normalizedPath,
          colorHue,
          voice: voice || null,
          avatarCandidateId: pickedCandidateId,
          // Phase 22 SRIC-02: required role from the dropdown.
          role: selectedRole,
        },
        abortControllerRef.current.signal,
      );

      let endedEvent: BirthEvent | null = null;

      for await (const evt of stream) {
        if (evt.type === "step") {
          setBirthProgress((prev) => {
            const next = prev.map((s) => {
              if (s.n === evt.n) {
                return { ...s, status: evt.phase as StepStatus, reason: evt.reason };
              }
              return s;
            });
            return next;
          });
          if (evt.phase === "failed") {
            setBirthFailedStep(evt.n);
          }
        } else if (evt.type === "ended") {
          endedEvent = evt;
          break;
        }
      }

      if (endedEvent && endedEvent.type === "ended" && endedEvent.ok) {
        // Success: call onCreate for focus-follow, then close modal
        onCreate({
          host: selectedHost,
          sessionName: name.toLowerCase(),
          path: normalizedPath,
          identityMode: true,
          name: name.toLowerCase(),
          title,
          brief,
          avatarCandidateId: pickedCandidateId,
          voice: voice || null,
          colorHue,
        });
        setBirthing(false);
        onClose();
      } else {
        // Failure: keep modal open, form fields disabled (user must close to retry)
        setBirthing(false);
      }
    } catch (_e) {
      // Stream error (fetch reject, network error, etc.) — surface as step-1 failure
      setBirthProgress((prev) => {
        const next = [...prev];
        next[0] = { ...next[0], status: "failed", reason: _e instanceof Error ? _e.message : "birth failed" };
        return next;
      });
      setBirthFailedStep(1);
      setBirthing(false);
    }
  }

  // canOpen (Create button) computation:
  // - identity-mode ON: require host + valid name + title + brief + candidates + picked + no collisions
  // - identity-mode OFF: require host + valid session name (mirrors existing logic)
  // During birthing: Create is disabled regardless
  const nameValid = identityMode
    ? name.length > 0 && IDENTITY_NAME_PATTERN.test(name)
    : SESSION_NAME_PATTERN.test(sessionName);

  const canOpen = !birthing && (identityMode
    ? selectedHost !== null &&
      nameValid &&
      title.trim().length > 0 &&
      brief.trim().length > 0 &&
      candidates.length > 0 &&
      pickedCandidateId !== null &&
      !skynetCollision &&
      !hostCollision &&
      !collisionChecking &&
      // Phase 22 SRIC-02: role is REQUIRED and CREATE-only.
      selectedRole !== ""
    : selectedHost !== null && nameValid);

  // Whether birth failed (show progress even after birthing completes if failed)
  // Also show progress if any step has been started (non-pending) — keeps progress
  // visible while stream is in-flight even before birthFailedStep is set.
  const anyStepActive = birthProgress.some((s) => s.status !== "pending");
  const showBirthProgress = birthing || birthFailedStep !== null || anyStepActive;

  // Whether form fields should be disabled (during birthing OR after failure — user must close to reset)
  const formDisabled = birthing || birthFailedStep !== null;

  const uiTitle = t("nav.newSession", { defaultValue: "New agent" });
  const startTitle = t("nav.newSessionTitle", {
    defaultValue: "Start a new agent",
  });
  const startDescription = t("nav.newSessionDescription", {
    defaultValue: "Pick a host and (optionally) name the agent.",
  });
  const searchPlaceholder = t("nav.newSessionSearchHosts", {
    defaultValue: "Search hosts",
  });
  const namePlaceholder = t("nav.newSessionNamePlaceholder", {
    defaultValue: "auto",
  });
  const nameLabel = t("nav.newSessionNameLabel", {
    defaultValue: "Agent name (optional)",
  });
  const nameErrorText = t("nav.newSessionNameError", {
    defaultValue:
      "Use letters, numbers, underscores, or dashes (max 64 characters).",
  });
  const cancelLabel = t("common.cancel", { defaultValue: "Cancel" });
  const openLabel = t("common.create", { defaultValue: "Create" });
  const emptyHostsLabel = t("nav.newSessionNoHosts", {
    defaultValue: "No hosts available",
  });

  const hasGeneratedOnce = candidates.length > 0;
  void uiTitle; // suppress unused warning

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
              disabled={formDisabled}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] min-w-0 disabled:opacity-50"
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
                    disabled={formDisabled}
                    onClick={() => !formDisabled && setSelectedHost(h)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-[color:var(--color-pv-border-quiet)] last:border-b-0 disabled:opacity-50 ${
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

          {/* Regular session-name input — only visible when identity-mode is OFF */}
          {!identityMode && (
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
                disabled={formDisabled}
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
          )}

          {/* Path field — visible in BOTH modes, below host list + above identity-mode checkbox */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-session-path"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Path
            </label>
            <Input
              id="new-session-path"
              aria-label="Path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~"
              disabled={formDisabled}
            />
          </div>

          {/* Identity-mode checkbox — below the path field */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="new-session-identity-mode"
              checked={identityMode}
              onChange={(e) => !formDisabled && setIdentityMode(e.target.checked)}
              disabled={formDisabled}
              className="w-3.5 h-3.5 rounded disabled:opacity-50"
            />
            <label
              htmlFor="new-session-identity-mode"
              className="text-xs text-[color:var(--color-pv-fg)] cursor-pointer select-none"
            >
              Create new identity
            </label>
          </div>

          {/* Identity-birth field cluster — visible when identity-mode is ON */}
          {identityMode && (
            <div className="flex flex-col gap-3 pt-1 border-t border-[color:var(--color-pv-border-quiet)]">

              {/* Phase 22 SRIC-02: REQUIRED Role dropdown — positioned near the
                  host picker (first field in the identity cluster). Populates
                  via GET /roles?hostId=<n> whenever the selected host changes.
                  Zero-roles response renders an inline hint with a no-op stub
                  click (wired to CreateRoleDialog in plan 22-04 / SRIC-04). */}
              {selectedHost !== null && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="new-identity-role"
                    className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                  >
                    Role
                  </label>
                  <select
                    id="new-identity-role"
                    aria-label="Role"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    disabled={formDisabled || rolesLoading}
                    className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] outline-none disabled:opacity-50"
                  >
                    <option value="" disabled>
                      {rolesLoading ? "Loading roles..." : "Pick a role…"}
                    </option>
                    {rolesForHost.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {/* Role fetch error */}
                  {rolesError && (
                    <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                      {rolesError}
                    </span>
                  )}
                  {/* Zero-roles inline hint — click handler is a no-op stub in
                      this plan; will be wired to CreateRoleDialog in Plan 22-04
                      / SRIC-04. Preserves the UX affordance per D-CONTEXT
                      §Failure modes even before CreateRoleDialog exists. */}
                  {!rolesLoading &&
                    !rolesError &&
                    rolesForHost.length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          /* no-op stub — wired in 22-04 / SRIC-04 */
                        }}
                        className="text-xs text-left text-[color:var(--color-pv-code-fg)] underline underline-offset-2 hover:opacity-80"
                      >
                        no roles on this host — create one first
                      </button>
                    )}
                </div>
              )}

              {/* Identity name field */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-name"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Name
                </label>
                <Input
                  id="new-identity-name"
                  aria-label="Name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    // Clear collision state when name changes (re-check on blur)
                    setSkynetCollision(false);
                    setHostCollision(false);
                  }}
                  onBlur={() => runCollisionPrecheck(name)}
                  placeholder="e.g. alicia"
                  disabled={formDisabled}
                  aria-invalid={name.length > 0 && !IDENTITY_NAME_PATTERN.test(name)}
                />
                {/* Name validation errors */}
                {name.length > 0 && !IDENTITY_NAME_PATTERN.test(name) && (
                  <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                    Name must match [a-z0-9._=/+-]+
                  </span>
                )}
                {skynetCollision && (
                  <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                    Already exists in Skynet
                  </span>
                )}
                {hostCollision && selectedHost && (
                  <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                    Already exists on {selectedHost.name}
                  </span>
                )}
              </div>

              {/* Title field */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-title"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Title
                </label>
                <Input
                  id="new-identity-title"
                  aria-label="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Research Assistant"
                  disabled={formDisabled}
                />
              </div>

              {/* Brief textarea — EPHEMERAL: only sent to avatar batch, never persisted */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-brief"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Brief
                </label>
                <textarea
                  id="new-identity-brief"
                  aria-label="Brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="A short description to seed the avatar generation..."
                  rows={3}
                  disabled={formDisabled}
                  className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] placeholder:text-[color:var(--color-pv-fg-dim)] outline-none resize-none disabled:opacity-50"
                />
              </div>

              {/* Avatar section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                    Avatar
                  </span>
                  <button
                    type="button"
                    disabled={formDisabled || genLoading || !name || !title.trim() || !brief.trim()}
                    onClick={() => { void handleGenerate(); }}
                    className="text-xs px-2 py-1 rounded border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[color:var(--color-pv-surface)] transition-colors"
                    aria-label={hasGeneratedOnce ? "Regenerate" : "Generate"}
                  >
                    {hasGeneratedOnce ? "Regenerate" : "Generate"}
                  </button>
                </div>

                {/* Inline generation error */}
                {genError && (
                  <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                    {genError}
                  </span>
                )}

                {/* Candidate row — horizontal flex of 3 buttons */}
                {candidates.length > 0 && (
                  <div className="flex gap-2 justify-center">
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        data-candidate-id={c.id}
                        aria-selected={pickedCandidateId === c.id}
                        disabled={formDisabled}
                        onClick={() => !formDisabled && setPickedCandidateId(c.id)}
                        className={`flex-1 rounded overflow-hidden border-2 transition-all disabled:opacity-50 ${
                          pickedCandidateId === c.id
                            ? "border-[color:var(--color-pv-code-fg)] ring-1 ring-[color:var(--color-pv-code-fg)]"
                            : "border-transparent hover:border-[color:var(--color-pv-border-quiet)]"
                        }`}
                      >
                        <img
                          src={c.url}
                          alt={`Avatar candidate ${c.id}`}
                          className="w-full aspect-square object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Voice picker — reused from pretty-view/pickers (plan 03) */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-voice"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Voice
                </label>
                <VoicePicker
                  value={voice}
                  onChange={(v) => !formDisabled && setVoice(v)}
                  id="new-identity-voice"
                  ariaLabel="Voice"
                  disabled={formDisabled}
                />
              </div>

              {/* Color picker — reused from pretty-view/pickers (plan 03) */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-color"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Color
                </label>
                <ColorPicker
                  value={colorHue}
                  onChange={(v) => !formDisabled && setColorHue(v)}
                  id="new-identity-color"
                  disabled={formDisabled}
                />
              </div>
            </div>
          )}

          {/* Birth progress — shown during birth AND after failure */}
          {showBirthProgress && (
            <BirthProgress
              steps={birthProgress}
              failedStep={birthFailedStep}
              hostName={selectedHost?.name ?? ""}
              identityName={name.toLowerCase()}
              identityPath={normalizePath(path)}
            />
          )}
        </div>

        <DialogFooter>
          {/* Cancel button — hidden during birth (not during failure, to allow close) */}
          {!birthing && (
            <Button variant="ghost" onClick={onClose}>
              {cancelLabel}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!canOpen}
            className="text-[color:var(--color-pv-code-fg)] hover:opacity-90 disabled:opacity-50"
            onClick={() => {
              if (!canOpen || !selectedHost) return;
              const normalizedPath = normalizePath(path);
              if (identityMode) {
                // Identity-mode ON: start birth stream
                void handleBirth();
              } else {
                // Identity-mode OFF: existing regular-session contract + path
                onCreate({
                  host: selectedHost,
                  sessionName: sessionName.length > 0 ? sessionName : undefined,
                  path: normalizedPath,
                  identityMode: false,
                });
              }
            }}
          >
            {birthing ? "Creating..." : openLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
