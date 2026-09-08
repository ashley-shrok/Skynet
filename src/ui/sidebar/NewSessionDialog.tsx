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
// title, brief, avatar picker, voice picker, color picker. Path field visible
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
//
// ─── Phase 84 (D-CONTEXT items 7 + 8) ─────────────────────────────────
// UX pass paired with Plan 84-01 (CreateRoleDialog): modal title
// conforms to "New agent" dropdown label at
// PrettyConversationsPanel.tsx:2036 (defaultValue change in place at
// L845-847, no new i18n key). Host search + host listbox hidden when
// the user has exactly one pickable host — single host still auto-
// selected by the existing open-effect. Same inline gate shape as
// Plan 84-01 (not extracted into a shared symbol; refactor deferred
// per shape file §Scope edges).
//
// ─── Phase 86 Plan 86-04 (D-CTX-86-surface-4) ─────────────────────────
// Cosmetics moved to role level. The identity-mode branch of this dialog
// no longer authors Title / Brief / Voice / Color / Avatar — new identities
// wear their role's face on landing until per-identity override via
// IdentityModal (Plan 86-05). Stripped: title text input, brief textarea,
// voice/color pickers, entire avatar generator+upload section, and all
// associated state + handlers (title, brief, voice, colorHue, candidates,
// pickedCandidateId, gen/upload loading+error, manualPreviewUrl,
// manualUrlRef, associated generate/upload handlers). Birth stream call
// passes absent cosmetic fields — the backend (identity-birth.ts +
// identity-birth-orchestrator.ts) accepts the absence and skips the
// identity-side avatar sibling write (role folder's avatar file is
// served via Plan 86-01's GET /:key/avatar fallback).

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
import {
  listIdentities,
  getIdentityExistsOnHost,
  openBirthStream,
  listRolesForHost,
  pickPoolName,
  type BirthEvent,
  type RoleSummary,
} from "@/api/identities-api";
import { refreshIdentities } from "@/state/identities-store";

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

// Three-way discriminated union on `identityMode`:
//   - `false`   → regular-session open (Ashley picks a host + optional session name).
//   - `true`    → identity-birth success (the birth stream finished; the new identity
//                 has a fresh tmux session on `host` keyed by `name`). Phase 86 Plan
//                 86-04 (D-CTX-86-surface-4): cosmetic fields (title, brief, voice,
//                 colorHue, avatarCandidateId) removed from this variant — cosmetics
//                 live at the role level now and the born identity inherits its
//                 role's face. Downstream consumers (AppShell.tsx L2040,
//                 PrettyConversationsPanel.tsx L1945) never destructured these
//                 fields, so the narrowing is safe.
//   - `"existing"` → open a session on an identity that is ALREADY BORN server-side
//                 (quick-260806-bz7 clone-modal auto-route). The clone flow creates
//                 the tmux session as part of the backend clone step, so the
//                 frontend just needs to attach (allowCreateTmux false). No birth
//                 stream runs, so no birth-only concerns here either.
export type NewSessionOnCreateOpts =
  | { host: Host; sessionName?: string; path: string; identityMode: false }
  | {
      host: Host;
      sessionName?: string;
      path: string;
      identityMode: true;
      name: string;
    }
  | {
      host: Host;
      sessionName: string;
      path: string;
      identityMode: "existing";
      identityName: string;
      /** Phase 68 Plan 04: this string is the identityKey (was nanoid PK pre-phase).
       *  Field name retained for backward-compatibility with downstream callers;
       *  treat as opaque identity handle. Value is now identity.identityKey
       *  (e.g. "tina") instead of a DB-generated UUID. */
      identityId: string;
    };

// ─── BirthProgress ─────────────────────────────────────────────────────────
// Step labels for the 5-step birth sequence (matching CONTEXT.md §"Compound birth sequence")
// Phase 68 Plan 04: SHAPE B chosen in 68-03. Step 1 is now an SSH-side on-disk
// collision probe (SSH connect + folder check). Array length stays 5.
const BIRTH_STEP_LABELS = [
  "Check identity name is available on host",
  "Open tmux session", // rendered with hostName at runtime
  "Launch Claude CLI",
  "Bootstrap dance",
  "Send /id command",
];

// Failure blurbs verbatim from D-CONTEXT §"Failure blurbs", indexed 0-4 (step N is index N-1).
// Slots: <host>, <name>, <path> — replaced at render time.
// Phase 68 Plan 04: SHAPE B — blurb[0] updated for SSH-side collision probe.
const BIRTH_STEP_BLURBS = [
  "The identity name is already in use on this host. Pick a different name and retry.",
  "Name available, but couldn't open a tmux session on <host>. Open the session by hand: `ssh <host> tmux new-session -d -s <name> -c <path>`.",
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
  initialHost,
  initialRole,
  initialBrief: _initialBrief,
  isAdmin = false,
}: {
  open: boolean;
  onClose: () => void;
  hostTree: HostFolder | null;
  onCreate: (opts: NewSessionOnCreateOpts) => void;
  /**
   * Phase 22 SRIC-05 chain pre-fill: when both `initialHost` and `initialRole`
   * are provided, the dialog opens with selectedHost + selectedRole seeded
   * from these props. Both remain EDITABLE per D-CONTEXT §Claude's Discretion
   * default ("pre-filled but editable"). When only `initialHost` is provided,
   * host is seeded but role stays empty (user must pick manually). When only
   * `initialRole` is provided (no host), it is silently ignored — the role
   * dropdown only renders once a host is picked, and a role without a
   * matching host has no semantic anchor.
   *
   * `initialBrief` (2026-08-05, deprecated 2026-09-08 in Phase 86 Plan 86-04):
   * seeded the agent brief field when the dialog opened via the
   * CreateRoleDialog chain. Prop signature retained for backward-compat with
   * PrettyConversationsPanel.tsx's chain-prefill wire-up (which still passes
   * chainPrefill.description ?? null), but the brief input itself was
   * stripped when cosmetics moved to role level per D-CTX-86-surface-4 — the
   * prop is now unused and can be removed in a future cleanup once
   * PrettyConversationsPanel drops the chain-prefill.description branch.
   */
  initialHost?: Host | null;
  initialRole?: string | null;
  initialBrief?: string | null;
  /**
   * Phase 88 (Plan 88-01): admin-gate wired from PrettyConversationsPanel.tsx L285
   * (source of truth: destructured isAdmin prop with fail-closed default;
   * forwarded from AppShell state `users.is_admin` from `/users/me`). The
   * default at destructuring above is fail-closed — when a caller forgets to
   * pass the prop, non-admin behavior applies (Path field + shell checkbox
   * hidden). This matches the sibling gate at PrettyConversationsPanel.tsx
   * L1651 for `<WeeklyUsageMeter />` and shape-create-agent-modal-ux-pass
   * §What would make it wrong item #2/#3 ("Non-admin sees the 'Just a shell'
   * checkbox / Path field" = leaked shell access + defeated
   * per-agent-working-directory scoping).
   *
   * Downstream consumers land in Plan 88-02:
   *   - Path field admin-gate at the current L926-942 block, wrapped in an
   *     isAdmin-conditional JSX guard.
   *   - Identity-mode checkbox admin-gate at the current L944-960 block,
   *     wrapped in an isAdmin-conditional JSX guard.
   *   - Submit-onclick invariant: non-admin submits force the agent-birth
   *     branch regardless of local `identityMode` state, so a bug in the
   *     render gate cannot leak shell access at submit time.
   *
   * Plan 88-01 lands only the destructure + type declaration; no admin-gated
   * JSX ships in Wave 1.
   */
  isAdmin?: boolean;
}) {
  const { t } = useTranslation();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [search, setSearch] = useState("");

  // Path field — visible in BOTH modes, placed below host+name and above identity-mode checkbox.
  // Default "~/" (tilde-expanded server-side). Accepts "/" or "\" and normalizes to "/" on submit.
  // Trailing slash is deliberate: typing after the default naturally produces "~/foo" rather than
  // "~foo" (which POSIX reads as "home of user foo" and is almost never what's meant).
  const [path, setPath] = useState("~/");

  // Identity-mode checkbox (defaults ON per IDUI-01).
  // When on, reveals the identity-birth field cluster.
  const [identityMode, setIdentityMode] = useState(true);

  // Identity birth fields — Phase 86 Plan 86-04 (D-CTX-86-surface-4):
  // cosmetic authoring (title, brief, voice, colorHue, avatar) removed from
  // this dialog; those live at the role level now and the born identity
  // inherits them on landing. Only the identity's own name + task remain.
  const [name, setName] = useState(""); // identity name (distinct from regular sessionName)

  // Phase 80 Plan 80-06: task-description field state (see textarea below).
  const [task, setTask] = useState<string>("");
  const [poolPickedName, setPoolPickedName] = useState<string | null>(null);

  // Collision precheck state
  const [skynetCollision, setSkynetCollision] = useState(false);
  const [hostCollision, setHostCollision] = useState(false);
  const [collisionChecking, setCollisionChecking] = useState(false);

  // Debounce ref for collision precheck (cancel on remount/name change)
  const collisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 22 SRIC-05: tracks the previously-observed selectedHost.id so the
  // roles-for-host effect only clears selectedRole on an ACTUAL host change,
  // not on the initial seeding (which would nuke the chain pre-fill in
  // useEffect #1 above). null = "no host observed yet" (fresh mount).
  const prevHostIdRef = useRef<string | number | null>(null);

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

  // On open: seed from chain pre-fill props if provided, else auto-select the
  // sole host when the tree has exactly one (existing Test 9 behavior).
  // Phase 22 SRIC-05: `initialHost` takes precedence over auto-select. When
  // both `initialHost` and `initialRole` are provided AND identity-mode is
  // ON (default), `selectedRole` is also seeded. The roles-for-host effect
  // (keyed on [selectedHost, identityMode]) will fire on the next render as
  // a consequence of setSelectedHost — but that effect clears selectedRole
  // on host change. To make the pre-fill stick we set BOTH here and rely on
  // a separate validation effect (below) to clear selectedRole later if the
  // fetched roles do not contain it (Test 6 stale-role safety net).
  // On close: reset all local state so a re-open starts fresh.
  useEffect(() => {
    if (open) {
      if (initialHost) {
        setSelectedHost(initialHost);
        // Seed the role too, but only when identity-mode is on (the dropdown
        // only exists in identity-mode). identityMode default is true; when
        // the caller opens the dialog with identityMode still at its default,
        // this branch fires with identityMode=true.
        if (initialRole && identityMode) {
          setSelectedRole(initialRole);
        }
      } else if (flatHosts.length === 1) {
        setSelectedHost(flatHosts[0]);
      }
      // Phase 86 Plan 86-04: initialBrief seeding removed with the brief
      // textarea (cosmetic-strip per D-CTX-86-surface-4). Prop still
      // accepted for backward-compat but ignored.
    } else {
      // Abort any in-flight birth stream
      abortControllerRef.current?.abort();
      // Reset all state to defaults on close
      setSelectedHost(null);
      setSessionName("");
      setSearch("");
      setPath("~/");
      setIdentityMode(true);
      setName("");
      // Phase 80 Plan 80-06: reset task-input + pool-pick tracking on close.
      setTask("");
      setPoolPickedName(null);
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
      // Phase 22 SRIC-05: reset the host-change tracker so a subsequent
      // open with fresh chain pre-fill seed values takes effect (Test 8).
      prevHostIdRef.current = null;
      // Reset birth state
      resetBirthProgress();
    }
  }, [open, flatHosts]);

  // Component unmount cleanup — abort stream if modal unmounts mid-birth.
  // NOTE: the backend birth sequence continues regardless; this just stops
  // the frontend from consuming SSE events (intentional per D-CONTEXT
  // §"No cancel mid-birth").
  //
  // Phase 86 Plan 86-04: manual avatar object-URL revocation removed with the
  // avatar upload UI (cosmetic-strip per D-CTX-86-surface-4). No object URLs
  // are ever created here now.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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
      // Only clear selectedRole when we actually had a prior host (i.e.,
      // host was cleared or identity-mode toggled OFF). On the very first
      // mount when selectedHost is still null-by-initial-state, DO NOT clear
      // selectedRole — the on-open useEffect above may have just seeded it
      // via initialRole and the state update simply hasn't landed yet
      // (Phase 22 SRIC-05 Test 1).
      setRolesForHost([]);
      if (prevHostIdRef.current !== null) {
        setSelectedRole("");
      }
      setRolesLoading(false);
      setRolesError(null);
      prevHostIdRef.current = null;
      return;
    }
    let cancelled = false;
    setRolesLoading(true);
    setRolesError(null);
    // Force re-pick on ACTUAL host change (Test 22 regression gate): the
    // previous role's semantics don't carry across hosts. But do NOT clear
    // on the first observation of a host — that would nuke a chain pre-fill
    // seed placed by the on-open effect (Phase 22 SRIC-05 Test 1).
    if (prevHostIdRef.current !== null && prevHostIdRef.current !== selectedHost.id) {
      setSelectedRole("");
    }
    prevHostIdRef.current = selectedHost.id;
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

  // Phase 22 SRIC-05 Test 6: stale-role guard. After the roles-for-host fetch
  // resolves, if selectedRole was seeded from initialRole (chain pre-fill) but
  // that role name is not actually present on the picked host, clear the
  // selection so the user sees the empty dropdown state and can't submit with
  // a phantom role. Only runs when there IS a current selection AND the fetch
  // has landed (rolesForHost non-empty OR rolesLoading false after a fetch).
  useEffect(() => {
    if (!selectedRole || rolesLoading) return;
    if (rolesForHost.length === 0) return;
    if (!rolesForHost.some((r) => r.name === selectedRole)) {
      setSelectedRole("");
    }
  }, [rolesForHost, rolesLoading, selectedRole]);

  // Phase 80 Plan 80-06 Task 2: auto-prefill Name via pickPoolName on role
  // change. Fires whenever selectedRole, selectedHost, or identityMode changes
  // and only when all three are present. Backend picks an unused pool name
  // for the (role, host) pair; frontend prefills the Name input ONLY if the
  // user hasn't typed anything yet (name === "") — pool is a suggestion
  // source, not a restriction (D-01). Records the returned value in
  // `poolPickedName` so the birth-submit path can decide whether to send
  // `poolPicked: true` (A1 MXID lock). Silent on failure — user simply types
  // a name manually. cancelled-flag pattern guards against stale responses
  // when role/host changes mid-flight (T-80-06-04 threat mitigation).
  useEffect(() => {
    if (!identityMode || !selectedRole || !selectedHost) return;
    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum)) return;
    let cancelled = false;
    (async () => {
      try {
        const { name: poolName } = await pickPoolName(selectedRole, hostIdNum);
        if (cancelled) return;
        // Only prefill if user hasn't typed a custom name yet. User-typed
        // names are preserved (shape §Frontend creation flow: "user can
        // override the name field").
        if (name === "") {
          setName(poolName);
          setPoolPickedName(poolName);
        }
      } catch {
        // Silent: pool endpoint failure just means no prefill. User can type
        // a name manually. Do NOT surface an inline error banner — pool is a
        // suggestion source, not a hard requirement (T-80-06-03 mitigation).
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole, selectedHost, identityMode]);

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

  // Phase 86 Plan 86-04 (D-CTX-86-surface-4): the identity-side avatar
  // generation + manual-upload handlers were deleted with the cosmetic
  // authoring UI. Avatar generation now lives at the role level
  // (CreateRoleDialog per Plan 86-03); new identities inherit the role's
  // avatar via Plan 86-01's GET /:key/avatar role-folder fallback and
  // never need a per-identity avatar chosen at birth time.

  // Birth stream handler — runs when Create is clicked with identity-mode ON
  async function handleBirth() {
    if (!selectedHost) return;
    setBirthing(true);
    setBirthProgress(INITIAL_BIRTH_PROGRESS.map((s) => ({ ...s })));
    setBirthFailedStep(null);
    abortControllerRef.current = new AbortController();

    const normalizedPath = normalizePath(path);

    try {
      // Patch #315: Host.id is typed as `string` (see src/types/ui-types.ts)
      // and the /identities/birth route validates `typeof hostId === "number"`
      // strictly (no coercion). The old `as unknown as number` cast was a
      // compile-time lie that produced instant 400 "hostId must be a positive
      // integer" on first identity birth. Coerce like the sibling /roles call
      // above at line ~468 does.
      const hostIdNum = parseInt(String(selectedHost.id), 10);
      const stream = openBirthStream(
        {
          hostId: hostIdNum,
          name: name.toLowerCase(),
          path: normalizedPath,
          // Phase 86 Plan 86-04 (D-CTX-86-inherit): title / colorHue / voice /
          // avatarCandidateId are OMITTED from the birth request. The backend
          // (identity-birth.ts + identity-birth-orchestrator.ts) accepts the
          // absence and the identity's frontmatter is written without these
          // fields — the role's cosmetics resolve at read time via Plan 86-01's
          // publicIdentity merge (identity ?? role ?? null).
          colorHue: null,
          voice: null,
          // Phase 22 SRIC-02: required role from the dropdown.
          role: selectedRole,
          // Phase 80 Plan 80-06: optional task string (soft-cap 200 client-side,
          // backend hard-caps 500 defense-in-depth). Empty/whitespace-only →
          // undefined so the backend treats absence as legacy shape.
          task: task.trim() || undefined,
          // Phase 80 Plan 80-06 (A1 MXID lock signal): true iff the current
          // name state EXACTLY matches the last pool-picked value AND a
          // pool-pick actually happened. Any user edit flips this to false
          // by breaking the equality; a null poolPickedName (no pool-pick
          // fired, or pickPoolName rejected) also yields undefined. Backend
          // re-validates via composeMxidLocalpart shape check per plan
          // 80-03b Task 2 — a lying client cannot force a malformed MXID.
          poolPicked:
            poolPickedName !== null && name.trim() === poolPickedName
              ? true
              : undefined,
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
        // Patch #319: refresh the identities store BEFORE opening the tab.
        // The store loads once on first useIdentities() mount and never
        // auto-refreshes; without this the just-born identity isn't in
        // identitiesByKey when PrettyConversationRow resolves the session's
        // targetTmuxSession → identity — the row renders as a plain host
        // session (no avatar, hostname sublabel, no pretty-view routing).
        // Best-effort — a fetch failure shouldn't block the tab from opening;
        // the next mount's fetchOnce still eventually catches up.
        try {
          await refreshIdentities();
        } catch { /* best-effort — row will resolve on next store refresh */ }

        // Success: call onCreate for focus-follow, then close modal
        // Phase 86 Plan 86-04: cosmetic fields removed from the callback
        // shape (see NewSessionOnCreateOpts identityMode:true variant).
        // Consumers at AppShell.tsx L2040 + PrettyConversationsPanel.tsx
        // L1945 never destructured these fields, so no downstream update
        // required.
        onCreate({
          host: selectedHost,
          sessionName: name.toLowerCase(),
          path: normalizedPath,
          identityMode: true,
          name: name.toLowerCase(),
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
  // - identity-mode ON: require host + valid name + role + no collisions.
  //   Phase 86 Plan 86-04 (D-CTX-86-surface-4): title / brief / avatar-picked
  //   gates removed — cosmetics live at role level; new identities inherit.
  // - identity-mode OFF: require host + valid session name (mirrors existing logic)
  // During birthing: Create is disabled regardless
  const nameValid = identityMode
    ? name.length > 0 && IDENTITY_NAME_PATTERN.test(name)
    : SESSION_NAME_PATTERN.test(sessionName);

  const canOpen = !birthing && (identityMode
    ? selectedHost !== null &&
      nameValid &&
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
  // Phase 84 (D-CONTEXT item 7): modal title conforms DOWN to the dropdown
  // label at PrettyConversationsPanel.tsx:2036 ("New agent"). Same i18n
  // key, only the English defaultValue changes in place — no new key.
  // Existing translations continue to render "Start a new agent" until
  // re-translated; English is the source-of-truth locale for this bounty
  // (per Copy-guard LOCKED in 84-CONTEXT.md). Paired with Plan 84-01's
  // sibling change on CreateRoleDialog's title.
  const startTitle = t("nav.newSessionTitle", {
    defaultValue: "New agent",
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
          {/*
           * Phase 84 (D-CONTEXT item 8): hide the host search input + host listbox
           * entirely when the user has exactly one pickable host. The existing
           * open-effect at L413-414 (unchanged by this phase) still auto-selects
           * that sole host into `selectedHost`, so downstream birth-flow and
           * canOpen predicate at L822-833 still work. When the user has zero or
           * ≥2 pickable hosts, both the search box and the listbox render as
           * before. Rationale: Aither Health users (target segment) provision
           * one dedicated VM per user and hit this case constantly. Matched by
           * Plan 84-01's inline gate on CreateRoleDialog — same shape by design
           * (shape file §Scope edges: shared primitive, but NOT an extracted
           * symbol in this phase).
           */}
          {flatHosts.length !== 1 && (
            <>
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
            </>
          )}

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
              placeholder="~/"
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
              Create with new identity
            </label>
          </div>

          {/* Identity-birth field cluster — visible when identity-mode is ON */}
          {identityMode && (
            <div className="flex flex-col gap-3 pt-1 border-t border-[color:var(--color-pv-border-quiet)]">

              {/* Phase 80 Plan 80-06 Task 3 (RESEARCH §Landmine 2 fix,
                  Approach A per A4 lock): when identityMode is ON but no host
                  is picked yet, the role dropdown wrap below stays hidden
                  (host-gated at L1022) — surface a visible affordance instead
                  of leaving the user staring at an empty gap. Uses the same
                  muted-label CSS as other inline hints in this cluster. */}
              {selectedHost === null && (
                <div className="text-xs italic text-[color:var(--color-pv-fg-muted)]">
                  Pick a host to see available roles.
                </div>
              )}

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

              {/* Phase 80 Plan 80-06: task-description textarea.
                  Positioned ABOVE the Name input inside the identity cluster
                  (gated on identityMode along with the whole cluster). Soft-
                  cap 200 chars (D-Claude's Discretion — executor may retune
                  when badge widths render in plan 80-07). Backend hard-caps
                  500 chars (defense-in-depth per plan 80-03). */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-task"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  What will this agent work on?
                </label>
                <textarea
                  id="new-identity-task"
                  aria-label="Task"
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="Describe the task in 15-20 words…"
                  disabled={formDisabled}
                  className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] placeholder:text-[color:var(--color-pv-fg-dim)] outline-none disabled:opacity-50 resize-none"
                />
              </div>

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

              {/*
                Phase 86 Plan 86-04 (D-CTX-86-surface-4): title text input,
                brief textarea, voice/color pickers, and avatar generator +
                upload UI stripped. The new identity inherits its role's
                cosmetics (title, colorHue, voice, avatar) on landing per
                D-CTX-86-inherit; per-identity overrides remain possible via
                IdentityModal (Plan 86-05).
              */}
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
