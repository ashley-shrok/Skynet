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
// When Create fires in agent mode (i.e. !shellOnly — see Phase 88 rename
// below), opens an SSE stream against POST /identities/birth, closes on
// success + fires focus-follow via AppShell's existing openTab flow.
// (Phase 106 Plan 106-02 collapsed the previous per-step progress UI —
// see block-level comment further down for the sole-spawner shape.)
// NO cancel/retry/rollback affordances per D-CONTEXT non-negotiables.
//
// ─── Phase 88 (create-agent-modal-ux-pass, Plan 88-02) ─────────────────
// Six coordinated edits on this file (paired with sibling role blurb
// revision in CreateRoleDialog.tsx same commit surface):
//   A. Agent blurb: startDescription defaultValue byte-exact revision to
//      the LOCKED text at 88-CONTEXT.md §Verbatim copy.
//   B. Path field gated on `isAdmin && shellOnly` — the knob is only
//      meaningful in the raw-shell branch (where it becomes the shell's
//      cwd). In agent mode both admin and non-admin get the backend
//      workspace-default substitution. Wire complement is Edit F.
//   C. Identity-mode checkbox admin-gated + label flipped from the
//      pre-Phase-88 wording to the Phase-88 LOCKED wording at
//      88-CONTEXT.md §Verbatim label (U+2014 em-dash).
//   D. LOCAL state variable rename `identityMode` → `shellOnly` with
//      default flip `true` → `false` and boolean-invert at every LOCAL
//      read-site. The PUBLIC callback-payload discriminant `identityMode`
//      in NewSessionOnCreateOpts + at the two onCreate call sites is
//      UNCHANGED — it is a wire contract consumed by AppShell.tsx
//      narrowing on `identityMode: true | false | "existing"`.
//   E. Submit-onclick invariant: regular-session (raw shell) branch is
//      gated on `isAdmin && shellOnly` (defense-in-depth so a bug in the
//      render gate cannot leak shell access to non-admin).
//   F. handleBirth openBirthStream sends `path: ""` unconditionally.
//      With Edit B's tightened gate the Path field never renders in agent
//      mode, so admin and non-admin both fall through to the backend
//      substitution at identity-birth.ts (Phase 96 D-04:
//      `~/fleet/identities/<name>/workspace/`).
// Depends on Plan 88-01's `isAdmin` prop (already destructured with
// fail-closed `= false` default).
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
//
// ─── 2026-09-14 (new-agent modal: name + task de-friction) ─────────────
// Three coordinated edits, all narrowing what creation asks a human for:
//   1. Sole-role auto-select — a host offering exactly one role selects it
//      rather than parking the user on a "Pick a role…" placeholder that
//      gates Create. Mirrors the existing single-host behavior (Phase 84).
//      Composes with — does not fight — the chain-prefill seed and the
//      phantom-role guard; see the effect's own comment for the ordering.
//   2. Name prefill no longer waits for a role. That gate existed only
//      because availability was probed as a composed MXID; the probe moved
//      to the target host's identity directories, which are
//      role-independent. The `name === ""` no-clobber rule is unchanged, so
//      a user-typed name is still never overwritten.
//   3. The "What will this agent work on?" textarea is gone, along with its
//      `task` state. Birth sends TASK_PLACEHOLDER and the agent writes its
//      real task into its own `task:` frontmatter on first wake — silently,
//      as internal bookkeeping rather than something narrated to the user.
// Paired backend change: POST /identities/pool/pick treats `role` as
// optional and answers availability from the host (see pool-routes.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2 } from "lucide-react";

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
import { roleDisplayName } from "@/lib/role-display-name";
import { useBrandingConfig } from "@/branding/branding-store";

// Chrome/Linux renders the <option> popup with browser defaults, not the parent
// <select>'s classes — light-on-light without this. Same fix as VoicePicker's
// options and the GlobalFilesModal/SkillsEditorModal host pickers.
const ROLE_OPTION_STYLE = { background: "#1a1c26", color: "#f0ebe0" } as const;

// Client-side session-name pattern — defense-in-depth (T-06-04-01). Word
// characters and dashes, 0-64 chars. Empty string matches (Open enabled +
// server-side auto-fill kicks in).
export const SESSION_NAME_PATTERN = /^[\w-]{0,64}$/;

// Identity name pattern matching backend IDENTITY_KEY_RE at identities.ts:22.
// Must match [a-z0-9._=/+-]+ (lowercase, digits, and specific special chars).
export const IDENTITY_NAME_PATTERN = /^[a-z0-9._=/+-]+$/;

/**
 * Stand-in written to a new identity's `task:` frontmatter at birth.
 *
 * 2026-09-14: the "What will this agent work on?" textarea was removed from this
 * dialog. Asking at creation time asks too early — the user often does not know
 * yet, and they will say it again in their own words the moment the agent wakes.
 * So birth records this stand-in and the agent replaces it with the real task on
 * first wake (see substrate/skills/id/SKILL.md § the task frontmatter field).
 *
 * This string is USER-VISIBLE: PrettyConversationRow renders `task` as a row's
 * primary text, so it is what an agent's row reads as until the agent overwrites
 * it. Kept deliberately plain — the operator picked the wording, and a stand-in with a
 * short life should not try to be clever (e.g. deriving something from the role).
 */
export const TASK_PLACEHOLDER = "Untitled conversation";

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
//   - `false`   → regular-session open (user picks a host + optional session name).
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

// ─── Phase 106 Plan 106-02 ─────────────────────────────────────────────────
// The previous per-step birth checklist (step-labels table, per-step failure
// blurb table, per-step state type + initial-state table, and the inline
// sub-component that rendered the ticking list) was deleted per D-13/D-19.
// Under the sole-spawner shape (agent-supervisor is the party that runs
// tmux+claude, not Skynet), per-step launch beats happen on the supervisor's
// timeline and can't be reported on the birth SSE stream — the modal collapses
// to a single spinner-in-Create-button, and any failure (Skynet-side OR
// supervisor-wait timeout, D-11) fires one generic
// `window.alert("agent creation failed")` per D-17. See handleBirth below.
// ────────────────────────────────────────────────────────────────────────────

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
   * Admin-gate forwarded from AppShell state `users.is_admin` (via
   * PrettyConversationsPanel). Fail-closed default: a caller that forgets
   * the prop gets non-admin behavior. Downstream consumers:
   *   - `Just a shell` checkbox is admin-only (JSX guard on `isAdmin`).
   *   - Path field is `isAdmin && shellOnly`-gated — only rendered in the
   *     raw-shell branch, where the value becomes the shell's cwd.
   *   - Submit-onclick routes non-admin to agent-birth regardless of local
   *     `shellOnly` state, so a render-gate bug can't leak shell access.
   */
  isAdmin?: boolean;
}) {
  const { t } = useTranslation();
  const brandingConfig = useBrandingConfig();
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [search, setSearch] = useState("");

  // Path field state — the field itself only renders when isAdmin && shellOnly (see JSX gate
  // below). In agent mode nothing reads this state; handleBirth submits `path: ""` and the
  // backend substitutes `~/fleet/identities/<name>/workspace/` (Phase 96 D-04). In shell-only
  // mode this state is the raw-shell cwd; blank → normalizePath returns "~" → shell opens in
  // the user's home dir.
  const [path, setPath] = useState("");

  // Phase 88 (88-CONTEXT.md §Identity-mode checkbox admin-gate + inversion):
  // local state variable renamed from `identityMode` to `shellOnly` to
  // resolve the semantic-drift trap (shape §What would make it wrong item
  // #5). The checkbox is now labeled per 88-CONTEXT.md §Verbatim label
  // (admin-only, gated in Edit C) and defaults UNCHECKED. Semantic invariant:
  //   shellOnly === true  → checkbox CHECKED → user opting into raw shell
  //   shellOnly === false → checkbox UNCHECKED → agent mode (new default)
  // The PUBLIC callback-payload discriminant `identityMode` in
  // NewSessionOnCreateOpts (see type above) and at the two onCreate call
  // sites (handleBirth success + regular-session submit) is UNCHANGED — it
  // is a wire contract consumed by AppShell.tsx narrowing on
  // `identityMode: true | false | "existing"` (PATTERNS.md §2e).
  const [shellOnly, setShellOnly] = useState(false);

  // Identity birth fields — Phase 86 Plan 86-04 (D-CTX-86-surface-4):
  // cosmetic authoring (title, brief, voice, colorHue, avatar) removed from
  // this dialog; those live at the role level now and the born identity
  // inherits them on landing. Only the identity's own name + task remain.
  const [name, setName] = useState(""); // identity name (distinct from regular sessionName)

  // 2026-09-14: the task-description textarea and its `task` state were removed.
  // Birth sends TASK_PLACEHOLDER and the agent self-fills on first wake.
  const [poolPickedName, setPoolPickedName] = useState<string | null>(null);

  // Current-value mirrors for the name-prefill effect. That effect intentionally
  // omits these from its dep array (including `name` would re-issue the request
  // on every keystroke), so a closure read would observe the render that STARTED
  // the request rather than the state when it RESOLVED. Refs are read at
  // resolve-time, which is what makes the "never clobber a typed name" and
  // "replace our own stale suggestion" rules actually hold. Assigned during
  // render rather than in an effect so they are already current for any response
  // that lands before effects flush.
  const nameRef = useRef(name);
  nameRef.current = name;
  const poolPickedNameRef = useRef(poolPickedName);
  poolPickedNameRef.current = poolPickedName;
  const selectedRoleRef = useRef("");

  // Collision precheck state
  const [skynetCollision, setSkynetCollision] = useState(false);
  const [hostCollision, setHostCollision] = useState(false);
  const [collisionChecking, setCollisionChecking] = useState(false);

  // Debounce ref for collision precheck (cancel on remount/name change)
  const collisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latched true the moment Create fires a birth; gates the collision precheck
  // so it can never report on the identity folder birth itself creates. See
  // runCollisionPrecheck for the race this closes.
  const birthStartedRef = useRef(false);

  // Phase 22 SRIC-05: tracks the previously-observed selectedHost.id so the
  // roles-for-host effect only clears selectedRole on an ACTUAL host change,
  // not on the initial seeding (which would nuke the chain pre-fill in
  // useEffect #1 above). null = "no host observed yet" (fresh mount).
  const prevHostIdRef = useRef<string | number | null>(null);

  // Phase 22 SRIC-02: Role dropdown state (populated from GET /roles?hostId=<n>
  // when a host is picked with identity-mode ON). Selection blocks Create until
  // the user actively picks a role. Reset on host change AND on modal close.
  const [selectedRole, setSelectedRole] = useState<string>("");
  // Mirror for the name-prefill effect (declared above with the other refs) —
  // role is sent along with the pick request but must not be a dep of it.
  selectedRoleRef.current = selectedRole;
  const [rolesForHost, setRolesForHost] = useState<RoleSummary[]>([]);
  const [rolesLoading, setRolesLoading] = useState<boolean>(false);
  const [rolesError, setRolesError] = useState<string | null>(null);

  // Birth stream state — Phase 106 Plan 106-02 (D-13, D-15): the sole survivor
  // of the previous step-checklist state. `birthing` gates form-field disable,
  // modal close lock, and the Create-button spinner. `abortControllerRef` is
  // still needed by the component-unmount cleanup effect below so a page
  // navigation mid-birth cancels the SSE stream (modal close mid-birth is
  // otherwise disabled per D-15).
  const [birthing, setBirthing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const flatHosts = useMemo(
    () =>
      // Patch #111 F4: exclude RDP-enabled hosts from the new-session picker.
      // Rationale (user UAT 2026-07-21): RDP hosts already surface as
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

  // On open: seed from chain pre-fill props if provided, else auto-select the
  // sole host when the tree has exactly one (existing Test 9 behavior).
  // Phase 22 SRIC-05: `initialHost` takes precedence over auto-select. When
  // both `initialHost` and `initialRole` are provided AND agent mode is ON
  // (default in Phase 88: `shellOnly === false`), `selectedRole` is also
  // seeded. The roles-for-host effect (keyed on [selectedHost, shellOnly])
  // will fire on the next render as
  // a consequence of setSelectedHost — but that effect clears selectedRole
  // on host change. To make the pre-fill stick we set BOTH here and rely on
  // a separate validation effect (below) to clear selectedRole later if the
  // fetched roles do not contain it (Test 6 stale-role safety net).
  // On close: reset all local state so a re-open starts fresh.
  useEffect(() => {
    if (open) {
      if (initialHost) {
        setSelectedHost(initialHost);
        // Seed the role too, but only when agent mode is on (the role
        // dropdown only exists in agent mode). Post-Phase-88 rename +
        // default flip: `shellOnly` defaults to false (agent mode is the
        // default), so this branch fires on a fresh open where the caller
        // hasn't toggled the admin-only "Just a shell" checkbox.
        if (initialRole && !shellOnly) {
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
      setShellOnly(false);
      setName("");
      // Phase 80 Plan 80-06: reset pool-pick tracking on close.
      setPoolPickedName(null);
      // Reset the prefill effect's mirrors too. State setters above are async,
      // so an in-flight response resolving between this close and the next
      // render would otherwise read pre-close values through the refs.
      nameRef.current = "";
      poolPickedNameRef.current = null;
      selectedRoleRef.current = "";
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
      // Reset birth state — Phase 106 Plan 106-02 (D-13/D-15): the only
      // surviving birth-related state is the `birthing` boolean.
      setBirthing(false);
      // Un-latch so the next open re-enables the collision precheck.
      birthStartedRef.current = false;
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
  // OR agent-mode gate changes. Populates rolesForHost via GET /roles?hostId=<n>.
  // Clears selectedRole on every host change (force re-pick — a role scoped to
  // host A is not necessarily valid on host B).
  //
  // Effect DOES NOT fire when shell-only mode is on (Role is CREATE-only per
  // D-CONTEXT §UX rules; the role dropdown is agent-mode-only). When
  // shell-only toggles ON or the host clears, we reset rolesForHost +
  // selectedRole to defaults so a subsequent toggle back to agent mode
  // starts fresh.
  useEffect(() => {
    if (!selectedHost || shellOnly) {
      // Only clear selectedRole when we actually had a prior host (i.e.,
      // host was cleared or shell-only toggled ON). On the very first
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
  }, [selectedHost, shellOnly]);

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

  // 2026-09-14: sole-role auto-select. When the picked host offers exactly one
  // role there is no decision to make, so select it rather than parking the
  // user on a "Pick a role…" placeholder that gates the Create button. Same
  // courtesy the host picker already extends when there is exactly one host
  // (see the open-effect above and the Phase 84 listbox gate).
  //
  // Ordering vs the two neighbours it must not fight:
  //   - The chain-prefill seed (open-effect) sets selectedRole BEFORE any fetch
  //     resolves. The `selectedRole !== ""` bail below means a seeded role is
  //     never overwritten — and when the seed matches the only available role,
  //     the assignment would be a no-op anyway.
  //   - The stale-role guard directly above may CLEAR a phantom seed once the
  //     fetch lands. That clear and this select both key on [rolesForHost,
  //     rolesLoading, selectedRole], so the clear re-runs this effect and the
  //     lone role is then selected — the user ends up on the only valid choice
  //     instead of an empty dropdown. The two compose; neither loops, because
  //     this effect only ever writes a value the guard considers valid.
  useEffect(() => {
    if (rolesLoading) return;
    if (selectedRole !== "") return;
    if (rolesForHost.length !== 1) return;
    setSelectedRole(rolesForHost[0].name);
  }, [rolesForHost, rolesLoading, selectedRole]);

  // Phase 80 Plan 80-06 Task 2: auto-prefill Name via pickPoolName.
  //
  // 2026-09-14: the `!selectedRole` gate is GONE. It was never about names —
  // the backend needed a role solely to compose the MXID it probed for
  // availability, and that probe has moved to the host's identity directories
  // (which are role-independent). So a name can be suggested the moment a host
  // is known, instead of the user staring at an empty Name field until they
  // also pick a role.
  //
  // Keyed on selectedHost only — NOT on selectedRole. Role does not affect the
  // answer any more (availability is host-scoped and role-independent), so
  // re-picking when a role lands would issue a second request whose result is
  // always discarded. Sole-role auto-select makes that the common path, so the
  // waste would be one redundant SSH connection per modal open.
  //
  // Records the applied value in `poolPickedName` so the birth-submit path can
  // decide whether to send `poolPicked: true` (A1 MXID lock). Silent on failure
  // — user simply types a name manually. cancelled-flag pattern guards against
  // stale responses when the host changes mid-flight (T-80-06-04 mitigation).
  //
  // ⚠️ Why the applied-name check goes through refs rather than reading `name`
  // and `poolPickedName` directly: this effect deliberately does not list them
  // as deps (listing `name` would re-fire the request on every keystroke), so a
  // closure read would see the values from the render that STARTED the request,
  // not the values at the moment it RESOLVES. That is a live bug rather than a
  // theoretical one — since the role gate came off, the request now fires at
  // modal open, so a user typing a name they already know races the response and
  // a stale `name === ""` read overwrites what they typed. Refs always observe
  // current state, so intent wins (shape §What would make it wrong: "A name the
  // person typed being overwritten by a suggestion. Suggestions yield to
  // intent, always.").
  useEffect(() => {
    if (shellOnly || !selectedHost) return;
    const hostIdNum = parseInt(String(selectedHost.id), 10);
    if (!Number.isFinite(hostIdNum)) return;
    let cancelled = false;
    (async () => {
      try {
        // Role is passed when known — it no longer gates the request, but it
        // keeps the call self-describing in backend logs.
        const { name: poolName } = await pickPoolName(
          hostIdNum,
          selectedRoleRef.current || undefined,
        );
        if (cancelled) return;
        // Apply only when the field is empty, or still holds a suggestion WE
        // wrote and the user has not touched. The second case is what lets a
        // host switch replace the previous host's suggestion — that name was
        // checked for availability on a different machine, so leaving it would
        // show an untrustworthy suggestion (shape §What would make it wrong:
        // "A suggested name that is already in use on the target machine").
        // A user-typed name matches neither branch and is never touched.
        const current = nameRef.current;
        if (current === "" || current === poolPickedNameRef.current) {
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
    // No exhaustive-deps suppression needed: every value this effect reads
    // reactively IS in the dep array. `name`, `poolPickedName`, and
    // `selectedRole` are read through refs precisely so they do not belong here.
  }, [selectedHost, shellOnly]);

  // Collision precheck: fired on name blur (debounced 300ms).
  // Fires both listIdentities + getIdentityExistsOnHost in parallel.
  //
  // ⚠️ Once birth has started, this check MUST NOT run or report. Clicking
  // Create blurs the name field, which schedules this timer, and the click then
  // starts birth immediately — so the probe would land ~300ms later, AFTER
  // Step 1/2 created `~/fleet/identities/<name>/` on the target host, and
  // report "Already exists on <host>" about a folder the birth itself just
  // made. The user sees a collision error on a birth that goes on to succeed
  // (observed on a fresh host, 2026-09-14). birthStartedRef is a ref, not the
  // `birthing` state, because the timer callback needs the value as of when it
  // FIRES; a state read would be captured from the render that scheduled it.
  function runCollisionPrecheck(currentName: string) {
    if (collisionTimerRef.current) {
      clearTimeout(collisionTimerRef.current);
    }
    if (birthStartedRef.current) return;
    // Clear state immediately if name is invalid or no host selected
    if (!currentName || !IDENTITY_NAME_PATTERN.test(currentName) || !selectedHost) {
      setSkynetCollision(false);
      setHostCollision(false);
      return;
    }
    collisionTimerRef.current = setTimeout(async () => {
      if (birthStartedRef.current) return;
      setCollisionChecking(true);
      try {
        const lowerName = currentName.toLowerCase();
        const [identities, existsOnHost] = await Promise.all([
          listIdentities(),
          getIdentityExistsOnHost(selectedHost.id as unknown as number, lowerName),
        ]);
        if (birthStartedRef.current) return;
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

  // Birth stream handler — runs when Create is clicked with identity-mode ON.
  // Phase 106 Plan 106-02 rewrite: intermediate `step` events are discarded
  // per D-12 (backend still emits them for log-forensic breadcrumbs but the
  // frontend has no per-step UI to tick against under the sole-spawner shape).
  // Only the terminal `ended` event matters. Failure of any kind — Skynet-side
  // (ended.ok:false) OR outer catch (stream throw / network) — fires the same
  // generic `window.alert("agent creation failed")` per D-17.
  async function handleBirth() {
    if (!selectedHost) return;
    // Latch BEFORE any await so the blur-scheduled collision probe (which fires
    // ~300ms from now, after Step 1 has created the identity folder) sees it.
    birthStartedRef.current = true;
    if (collisionTimerRef.current) {
      clearTimeout(collisionTimerRef.current);
      collisionTimerRef.current = null;
    }
    setBirthing(true);
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
          // Phase 88 (path-clear, both branches): the Path field only
          // renders in the raw-shell branch (see JSX gate on
          // `effectiveShellOnly`), so an agent-birth submit — admin or
          // non-admin — has no user-supplied path to honor. Send empty
          // unconditionally and let the backend narrow at identity-birth.ts
          // substitute `~/fleet/identities/<name>/workspace/` (Phase 96
          // D-04). Bypassing normalizePath here matters because
          // normalizePath("") → "~", which would be truthy on the backend
          // and defeat the substitution.
          path: "",
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
          // 2026-09-14: always the stand-in. The user is no longer asked what
          // the agent will work on at creation time; the agent writes the real
          // task into its own frontmatter on first wake. Sent unconditionally
          // (rather than omitted) so the row has readable primary text from the
          // moment it appears instead of rendering blank until first wake.
          task: TASK_PLACEHOLDER,
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

      // Phase 106 Plan 106-02 (D-12): frontend discards intermediate `step`
      // events — they exist on the wire purely as backend log-forensic
      // breadcrumbs. Only the terminal `ended` event drives frontend state.
      for await (const evt of stream) {
        if (evt.type === "ended") {
          endedEvent = evt;
          break;
        }
      }

      if (endedEvent && endedEvent.type === "ended" && endedEvent.ok) {
        // Post-quick-260918-52n: identity folder name (= tmux session name)
        // is derived from the MXID localpart, so it is NOT the raw user input
        // (`riff`) but the composed handle (`riff-box-maintainer-2`, with a
        // silent `-N` collision suffix). Read the authoritative value off the
        // ended event — falling back to the input name only if the field is
        // absent (older backend that predates the quick). Using the input
        // here caused "tmux session '<short>' not found" on every birth
        // because AppShell.tsx onCreateSession feeds opts.name into openTab's
        // targetTmuxSession, and the supervisor named the session after the
        // derived folder.
        const bornName =
          endedEvent.sessionName ?? endedEvent.identityId ?? name.toLowerCase();

        // Patch #319: refresh the identities store BEFORE opening the tab.
        // The store loads once on first useIdentities() mount and never
        // auto-refreshes; without this the just-born identity isn't in
        // identitiesByKey when PrettyConversationRow resolves the session's
        // targetTmuxSession → identity — the row renders as a plain host
        // session (no avatar, hostname sublabel, no pretty-view routing).
        // Best-effort — a fetch failure shouldn't block the tab from opening;
        // the next mount's fetchOnce still eventually catches up.
        // Phase 106 Plan 106-02 (D-18): the refreshIdentities → onCreate order
        // is preserved; refresh MUST fire between ended:ok consumption and
        // onCreate firing so the just-born identity is in the store before
        // AppShell's openTab resolves it into pretty-view routing.
        //
        // The explicit {name: hostId} entry is what makes that actually work.
        // refreshIdentities derives its host fanout from fleetSessions, and the
        // newborn has no tmux session yet (the supervisor opens it on its next
        // reconcile tick), so a bare refresh queries hosts that don't include
        // this one and returns nothing for this name — the terminal-instead-of-
        // PrettyView + missing-avatar symptoms. Naming the host directly means
        // the backend enumerates it and finds the folder birth just wrote.
        try {
          await refreshIdentities({ [bornName]: hostIdNum });
        } catch { /* best-effort — row will resolve on next store refresh */ }

        // Success (D-16): call onCreate for focus-follow, then close modal.
        // AppShell.tsx:2236 onCreateSession handler narrows on identityMode:true
        // and opens the tab with `allowCreateTmux: false` — attach-not-create
        // semantics unchanged (the party that made the tmux session differs
        // [supervisor instead of Skynet] but the frontend behavior is identical).
        onCreate({
          host: selectedHost,
          sessionName: bornName,
          path: normalizedPath,
          identityMode: true,
          name: bornName,
        });
        setBirthing(false);
        onClose();
      } else {
        // Failure — ended:ok:false (Skynet-side error OR supervisor-wait
        // timeout, D-11). Frontend ignores the reason string per D-11 and
        // always shows the same generic alert per D-17. Modal closes.
        window.alert("agent creation failed");
        setBirthing(false);
        onClose();
      }
    } catch (_e) {
      // Stream error (fetch reject, network error, aborted stream, etc.) —
      // same failure surface as ended:ok:false per D-17 (single generic alert,
      // no distinct error class). The reason string, if any, is not surfaced;
      // backend structured log at `identity_birth_supervisor_wait_timeout`
      // (Plan 106-01) is the diagnosis surface.
      window.alert("agent creation failed");
      setBirthing(false);
      onClose();
    }
  }

  // canOpen (Create button) computation:
  // - Agent mode (!shellOnly, the Phase-88 new default): require host +
  //   valid name + role + no collisions. Phase 86 Plan 86-04
  //   (D-CTX-86-surface-4): title / brief / avatar-picked gates removed —
  //   cosmetics live at role level; new identities inherit.
  // - Shell-only mode (shellOnly, admin opt-in via Phase-88 checkbox):
  //   require host + valid session name (mirrors pre-Phase-88 logic).
  // During birthing: Create is disabled regardless.
  const nameValid = !shellOnly
    ? name.length > 0 && IDENTITY_NAME_PATTERN.test(name)
    : SESSION_NAME_PATTERN.test(sessionName);

  // Path is never blocking. In agent mode the field doesn't render and the
  // backend substitutes the workspace default; in shell mode blank → "~".
  // Kept as a named constant so a future gate has an obvious hook.
  const pathValid = true;

  // Phase 88 code-review M2 (defense-in-depth consistency): the "shell only"
  // branch of the modal requires BOTH isAdmin AND shellOnly — a non-admin
  // with a hypothetical stale-truthy shellOnly (rendering bug, state
  // corruption, whatever) must still land in agent mode. Computing this at
  // render scope lets both the birth-cluster JSX gate below AND the submit-
  // onclick handler at L1310 read the SAME predicate — without this lift,
  // the onclick had `!effectiveShellOnly` but the render gate used bare
  // `!shellOnly`, so a non-admin+shellOnly-true state would hide the birth
  // fields (name/role/task) while the onclick STILL routed to handleBirth,
  // producing a silent 400 with no user-facing failure surface. Never fires
  // in practice; the point is that if it EVER did, the two gates now agree.
  const effectiveShellOnly = isAdmin && shellOnly;

  const canOpen = !birthing && (!shellOnly
    ? selectedHost !== null &&
      nameValid &&
      pathValid &&
      !skynetCollision &&
      !hostCollision &&
      !collisionChecking &&
      // Phase 22 SRIC-02: role is REQUIRED and CREATE-only.
      selectedRole !== ""
    : selectedHost !== null && nameValid && pathValid);

  // Phase 106 Plan 106-02 (D-13/D-15): form fields disabled ONLY while birthing.
  // Under the sole-spawner shape there is no failure-persist state — any birth
  // failure fires `window.alert("agent creation failed")` and immediately closes
  // the modal per D-17, so the previous failed-step-persist clause is gone.
  // The previous "any step active" / "show progress" derivations are gone with
  // the 5-step checklist (the Create button IS the spinner surface per D-14).
  const formDisabled = birthing;

  const startTitle = t("nav.newSessionTitle", {
    defaultValue: "Create a new agent conversation",
  });
  // Phase 88 (paired-blurb revision): in-place defaultValue edit only,
  // no new i18n key. Sibling role blurb ships in CreateRoleDialog.tsx
  // DialogDescription in the same commit surface; the shared verb is
  // ADOPT (role side: "agents ADOPT expertise"; agent side: "each one
  // ADOPTS a role"). See 88-CONTEXT.md §Verbatim copy for LOCKED text.
  const startDescription = t("nav.newSessionDescription", {
    defaultValue:
      "Agents are the workers you chat with. Each one adopts a role that shapes what they know and how they help.",
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
  const openLabel = t("common.create", { defaultValue: "Create" });
  const emptyHostsLabel = t("nav.newSessionNoHosts", {
    defaultValue: "No hosts available",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Phase 106 Plan 106-02 (D-15): modal is fully locked from Create
        // click to birth resolution. Any close attempt (X button, Esc,
        // backdrop click) is a no-op while `birthing === true`. Success or
        // failure of the birth stream fires `onClose()` directly inside
        // handleBirth after clearing the `birthing` flag.
        if (!next && !birthing) onClose();
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

          {/* Regular session-name input — only visible when shell-only mode is
              ON (admin explicitly checked the Phase-88 shell-only box; see
              88-CONTEXT.md §Verbatim label for the LOCKED text).
              Post-Phase-88 rename + default flip: `shellOnly` is the state
              variable; agent mode is the default so this input is hidden by
              default. */}
          {shellOnly && (
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

          {/* Path field gated on `effectiveShellOnly` (= isAdmin && shellOnly).
              Only meaningful in the raw-shell branch as the shell's cwd. In
              agent mode (both admin and non-admin) the backend substitutes
              the workspace default per Phase 96 D-04. */}
          {effectiveShellOnly && (
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
                placeholder="Working directory (blank = ~/)"
                disabled={formDisabled}
              />
            </div>
          )}

          {/* Phase 88 (Identity-mode checkbox admin-gate + label flip —
              88-CONTEXT.md §Identity-mode checkbox admin-gate + 88-PATTERNS.md
              §2c): visible ONLY when isAdmin is truthy. Same admin-gate idiom
              as the Path field above (mirrors PrettyConversationsPanel.tsx:1651).
              Fail-closed via Plan 88-01's `isAdmin = false` destructure default.
              Label text LOCKED byte-exact per 88-CONTEXT.md §Verbatim label
              with Unicode U+2014 em-dash.
              See Edit D below for the local state var rename
              `identityMode` → `shellOnly` + default flip `true` → `false`.
              The DOM anchor id intentionally stays (stable HTML anchor);
              only the state variable renames. */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="new-session-identity-mode"
                checked={shellOnly}
                onChange={(e) => !formDisabled && setShellOnly(e.target.checked)}
                disabled={formDisabled}
                className="w-3.5 h-3.5 rounded disabled:opacity-50"
              />
              <label
                htmlFor="new-session-identity-mode"
                className="text-xs text-[color:var(--color-pv-fg)] cursor-pointer select-none"
              >
                Just a shell — no agent
              </label>
            </div>
          )}

          {/* Identity-birth field cluster — visible when agent mode is ON.
              Phase 88 code-review M2: gated on `!effectiveShellOnly`
              (= `!(isAdmin && shellOnly)`) rather than bare `!shellOnly`, so
              a non-admin with a stale-truthy shellOnly still renders the
              birth cluster instead of hiding it — matches the submit-onclick
              gate at L1310 so both agree. Default is agent mode when the
              admin-only checkbox is unchecked, or when a non-admin caller
              never sees the checkbox at all per Edit C's isAdmin gate. */}
          {!effectiveShellOnly && (
            <div className="flex flex-col gap-3 pt-1 border-t border-[color:var(--color-pv-border-quiet)]">

              {/* Phase 80 Plan 80-06 Task 3 (RESEARCH §Landmine 2 fix,
                  Approach A per A4 lock): when agent mode is ON (i.e.
                  `!shellOnly`, the Phase-88 new default) but no host is
                  picked yet, the role dropdown wrap below stays hidden
                  (host-gated) — surface a visible affordance instead of
                  leaving the user staring at an empty gap. Uses the same
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
                    className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet-strong)] bg-white/[0.06] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] outline-none disabled:opacity-50"
                  >
                    <option value="" disabled style={ROLE_OPTION_STYLE}>
                      {rolesLoading ? "Loading roles..." : "Pick a role…"}
                    </option>
                    {rolesForHost.map((r) => (
                      <option key={r.name} value={r.name} style={ROLE_OPTION_STYLE}>
                        {roleDisplayName(r.name, r.displayName)}
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

              {/* 2026-09-14: the "What will this agent work on?" textarea that
                  sat here (Phase 80 Plan 80-06) was removed. It asked too early
                  — the user frequently does not know yet at creation time, and
                  restates it conversationally the moment the agent wakes. Birth
                  now records TASK_PLACEHOLDER and the agent overwrites its own
                  `task:` frontmatter on first wake. */}

              {/* Identity name field */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="new-identity-name"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Name (used when you want agents to talk to each other)
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
                    Already exists in {brandingConfig.appName}
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

          {/* Phase 106 Plan 106-02 (D-13): the per-step birth checklist was
              removed. Under the sole-spawner shape the modal shows a spinner
              in the Create button (see DialogFooter below) instead of a
              per-step ticking list. */}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={!canOpen}
            className="text-[color:var(--color-pv-code-fg)] hover:opacity-90 disabled:opacity-50"
            onClick={() => {
              if (!canOpen || !selectedHost) return;
              const normalizedPath = normalizePath(path);

              // Phase 88 invariant (88-CONTEXT.md §Non-admin invariant,
              // defense-in-depth): non-admin users cannot spawn a raw
              // shell. The `shellOnly` checkbox is admin-gated (never
              // renders when !isAdmin — see Edit C) and the local state
              // defaults to `false`. Enforce again at the submit path:
              // even if some future caller passes a stale `shellOnly =
              // true` local state (or the JSX gate is bypassed by a
              // rendering bug), the shell branch is only taken when BOTH
              // isAdmin AND shellOnly are true. Only admins who explicitly
              // checked the Phase-88 shell-only checkbox (see Edit C label
              // for LOCKED wording) reach the regular-session branch below.
              // `effectiveShellOnly` is computed at render scope (near
              // pathValid) so this handler shares the same predicate the
              // birth-cluster render gate uses — see M2 comment above.
              if (!effectiveShellOnly) {
                // Agent mode (default for non-admin, and default for admin
                // unless the shell-only checkbox is explicitly checked):
                // start birth stream. The birth stream's onCreate at
                // handleBirth's success path uses the PUBLIC payload
                // discriminant `identityMode: true` — UNCHANGED from
                // Phase 88 (wire contract for AppShell narrowing).
                void handleBirth();
              } else {
                // Admin explicitly opted into raw shell. Preserve the
                // pre-Phase-88 regular-session contract — the PUBLIC
                // callback-payload discriminant `identityMode: false`
                // below is UNCHANGED and remains the AppShell.tsx
                // narrowing signal for regular-session vs identity-mode.
                // Path passes through as normalizedPath (admin's Path
                // input default "~/" from useState above + any override).
                onCreate({
                  host: selectedHost,
                  sessionName: sessionName.length > 0 ? sessionName : undefined,
                  path: normalizedPath,
                  identityMode: false,
                });
              }
            }}
          >
            {/* Phase 106 Plan 106-02 (D-14): the Create button's text label is
                replaced by a spinner icon while the birth stream is in-flight.
                No more "Creating..." string — the Create button IS the spinner
                surface. `size-4` matches the Button component's default text
                line-height affordance (larger than the previous per-step icons
                which used size-3.5 in a different context, now removed). */}
            {birthing ? (
              <Loader2 className="size-4 animate-spin" aria-label="Creating agent" />
            ) : (
              openLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
