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
//      narrowing on `identityMode: true | false`.
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
//
// ─── 2026-10-18 (no host step for agents) ──────────────────────────────
// Picking a host first only ever served to narrow the Roles dropdown, so the
// host list is gone from agent mode. Roles are fetched from every pickable
// host at open and listed in one dropdown, sectioned by host (alphabetical)
// when there is more than one host and flat when there is one. The host is
// whichever one the picked roles come from; an agent lives on one machine, so
// picking a role from a different host replaces the earlier picks. The host
// list stays for the admin-only shell branch, where there is no role.
//
// ─── 2026-10-18 (roles are optional) ───────────────────────────────────────
// An agent may hold zero roles. The Roles dropdown carries a "No roles" entry
// — at the top of the flat list with one host (preselected, so Create works
// straight away), and at the top of every host's section with several (nothing
// preselected; picking one also picks that host). "No roles" and roles are
// mutually exclusive, and unticking the last role falls back to "No roles" on
// that role's host. Birth then sends no role at all. A host's only role is
// not auto-selected.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2 } from "lucide-react";

import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { Button } from "@/components/button";
import { MultiSelect } from "@/components/multi-select";
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
import { refreshOneIdentity } from "@/state/identities-store";
import { roleDisplayName } from "@/lib/role-display-name";
import { previewSlugFromPrettyName } from "@/lib/pretty-name-slug-preview";
import { useBrandingConfig } from "@/branding/branding-store";

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

const NO_ROLES: RoleSummary[] = [];

// Option value of the "No roles" entry. Role names are kebab-case
// ([a-z0-9-]), so a leading colon can never collide with a real role.
const NO_ROLES_OPTION = ":no-roles";

type HostRolesState = {
  roles: RoleSummary[];
  loading: boolean;
  error: string | null;
};

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

// Two-way discriminated union on `identityMode`:
//   - `false`   → regular-session open (user picks a host + optional session name).
//   - `true`    → identity-birth success (the birth stream finished; the new identity
//                 has a fresh tmux session on `host` keyed by `name`). Phase 86 Plan
//                 86-04 (D-CTX-86-surface-4): cosmetic fields (title, brief, voice,
//                 colorHue, avatarCandidateId) removed from this variant — cosmetics
//                 live at the role level now and the born identity inherits its
//                 role's face. Downstream consumers (AppShell.tsx L2040,
//                 PrettyConversationsPanel.tsx L1945) never destructured these
//                 fields, so the narrowing is safe.
export type NewSessionOnCreateOpts =
  | { host: Host; sessionName?: string; path: string; identityMode: false }
  | {
      host: Host;
      sessionName?: string;
      path: string;
      identityMode: true;
      name: string;
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
  initialRoles,
  initialName = null,
  initialBrief: _initialBrief,
  isAdmin = false,
  project = null,
  onNewRole,
}: {
  /**
   * Project slug the agent is born into (opened from a project section's
   * "New conversation"). Sent with the birth request so the identity file is
   * born with `project:` — the row appears in its section from the first
   * frame instead of landing unassigned and jumping in seconds later.
   */
  project?: string | null;
  open: boolean;
  onClose: () => void;
  hostTree: HostFolder | null;
  onCreate: (opts: NewSessionOnCreateOpts) => void;
  /**
   * Phase 22 SRIC-05 chain pre-fill: when both `initialHost` and `initialRole`
   * are provided, the dialog opens with selectedHost + selectedRoles seeded
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
  /**
   * Several roles to seed, in pick order. Takes precedence over
   * `initialRole`. Used when returning from the "New role…" hop so the roles
   * picked before the hop survive alongside the new one.
   */
  initialRoles?: string[] | null;
  initialBrief?: string | null;
  /**
   * "New role…" row at the top of the Roles dropdown. The caller swaps this
   * dialog for CreateRoleDialog and brings the user back afterwards; the
   * current host + picked roles are handed over so they can be restored.
   * Absent = no row.
   */
  onNewRole?: (ctx: { host: Host | null; roles: string[]; name: string | null }) => void;
  /**
   * A custom agent name to restore (with the custom-name input revealed) —
   * set when returning from the "New role…" hop. Pool suggestions are not
   * carried; a fresh one is picked on reopen.
   */
  initialName?: string | null;
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
  // `identityMode: true | false` (PATTERNS.md §2e).
  const [shellOnly, setShellOnly] = useState(false);

  // Identity birth fields — Phase 86 Plan 86-04 (D-CTX-86-surface-4):
  // cosmetic authoring (title, brief, voice, colorHue, avatar) removed from
  // this dialog; those live at the role level now and the born identity
  // inherits them on landing. Only the identity's own name + task remain.
  const [name, setName] = useState(""); // identity name (distinct from regular sessionName)

  // 2026-09-27: auto-generate name by default. `autoName === false` (unchecked,
  // the default) means the pool-picked name is submitted silently and the manual
  // input is hidden. `autoName === true` means the user opted into typing their
  // own name — the input reveals and the pool suggestion becomes a starting point
  // they can accept, edit, or replace. On pool-pick failure the catch branch in
  // the effect below flips this to `true` so the input reveals and the user can
  // recover manually without seeing an error.
  const [autoName, setAutoName] = useState(false);

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

  // Phase 22 SRIC-02: Role dropdown state (populated from GET /roles?hostId=<n>
  // for every pickable host while agent mode is on). Create is blocked until
  // the user picks "No roles" or at least one role. Reset on modal close.
  // Multi-role: every role the agent will hold, in pick order — the first
  // becomes the frontmatter list's first entry (and the pool-picked MXID's
  // role segment). Empty when "No roles" is picked.
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  // "No roles" picked (on selectedHost). Never true while selectedRoles is
  // non-empty — the two are mutually exclusive.
  const [noRoles, setNoRoles] = useState(false);
  // Mirror for the name-prefill effect (declared above with the other refs) —
  // role is sent along with the pick request but must not be a dep of it.
  selectedRoleRef.current = selectedRoles[0] ?? "";
  // Roles per host, keyed by host id. A host with no entry has not been asked
  // yet; each host's request resolves on its own so a slow or offline machine
  // never holds up the others' roles.
  const [hostRoles, setHostRoles] = useState<Record<string, HostRolesState>>({});

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

  // Host sections for the Roles dropdown, alphabetical by host name.
  const sortedHosts = useMemo(
    () =>
      [...flatHosts].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [flatHosts],
  );
  const multiHost = flatHosts.length > 1;
  const anyRolesLoading = flatHosts.some(
    (h) => hostRoles[h.id] === undefined || hostRoles[h.id].loading,
  );
  const allRoles = sortedHosts.flatMap((h) =>
    (hostRoles[h.id]?.roles ?? []).map((role) => ({ host: h, role })),
  );
  // The picked host's roles — what the stale-role guard validates against.
  const selectedHostRoles = selectedHost ? hostRoles[selectedHost.id] : undefined;
  const rolesForHost = selectedHostRoles?.roles ?? NO_ROLES;
  const rolesLoading = selectedHost
    ? selectedHostRoles === undefined || selectedHostRoles.loading
    : anyRolesLoading;

  // On open: seed from chain pre-fill props if provided, else auto-select the
  // sole host when the tree has exactly one (existing Test 9 behavior).
  // Phase 22 SRIC-05: `initialHost` takes precedence over auto-select. When
  // both `initialHost` and `initialRole` are provided AND agent mode is ON
  // (default in Phase 88: `shellOnly === false`), `selectedRoles` is also
  // seeded. Roles are fetched for every host regardless of the seed; the
  // stale-role guard (below) clears seeded roles the seeded host turns out
  // not to have once its roles land (Test 6 safety net).
  // On close: reset all local state so a re-open starts fresh.
  // The pre-fill seeds (roles, name) apply ONCE per open: this effect also
  // re-runs on every `flatHosts` change while open, and re-seeding then would
  // silently revert picks the user changed since.
  const seededThisOpenRef = useRef(false);
  // The user (or a pre-fill seed) has made a roles pick this open, so the
  // one-machine "No roles" default must not override it. Cleared on close and
  // on entering shell-only mode (which drops all picks).
  const rolesTouchedRef = useRef(false);
  // The current "No roles" pick is the untouched one-machine default, not a
  // choice — so it is withdrawn if a second machine appears.
  const noRolesIsDefaultRef = useRef(false);
  useEffect(() => {
    if (open) {
      const firstRun = !seededThisOpenRef.current;
      seededThisOpenRef.current = true;
      if (initialHost) {
        setSelectedHost(initialHost);
        // Seed the role too, but only when agent mode is on (the role
        // dropdown only exists in agent mode). Post-Phase-88 rename +
        // default flip: `shellOnly` defaults to false (agent mode is the
        // default), so this branch fires on a fresh open where the caller
        // hasn't toggled the admin-only "Just a shell" checkbox.
        const seedRoles = initialRoles ?? (initialRole ? [initialRole] : []);
        if (firstRun && seedRoles.length > 0 && !shellOnly) {
          setSelectedRoles(seedRoles);
          rolesTouchedRef.current = true;
        }
        if (firstRun && initialName) {
          nameRef.current = initialName;
          setName(initialName);
          setAutoName(true);
        }
      } else if (flatHosts.length === 1) {
        setSelectedHost(flatHosts[0]);
      }
      // The one-machine "No roles" default is applied by its own effect
      // below, which tracks the machine count for as long as the dialog is open.
      // Phase 86 Plan 86-04: initialBrief seeding removed with the brief
      // textarea (cosmetic-strip per D-CTX-86-surface-4). Prop still
      // accepted for backward-compat but ignored.
    } else {
      seededThisOpenRef.current = false;
      rolesTouchedRef.current = false;
      noRolesIsDefaultRef.current = false;
      // Abort any in-flight birth stream
      abortControllerRef.current?.abort();
      // Reset all state to defaults on close
      setSelectedHost(null);
      setSessionName("");
      setSearch("");
      setPath("~/");
      setShellOnly(false);
      setName("");
      setAutoName(false);
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
      setSelectedRoles([]);
      setNoRoles(false);
      setHostRoles({});
      rolesRequestedRef.current = new Set();
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

  // Phase 22 SRIC-02: Role dropdown fetch — asks every pickable host for its
  // roles while the dialog is open in agent mode. Each host is asked once per
  // open (rolesRequestedRef); a host joining the tree mid-open is asked when it
  // appears. Results land per host as they arrive.
  //
  // Not fetched in shell-only mode (Role is agent-mode-only per D-CONTEXT §UX
  // rules); toggling shell-only ON clears the picked roles so a toggle back
  // to agent mode starts fresh.
  const rolesRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!open || shellOnly) {
      if (shellOnly) {
        setSelectedRoles((prev) => (prev.length > 0 ? [] : prev));
        setNoRoles(false);
        // Leaving shell-only mode starts the roles pick fresh, so the
        // one-machine default applies again.
        rolesTouchedRef.current = false;
        noRolesIsDefaultRef.current = false;
      }
      return;
    }
    const pending = flatHosts.filter((h) => !rolesRequestedRef.current.has(h.id));
    if (pending.length === 0) return;
    for (const h of pending) rolesRequestedRef.current.add(h.id);
    setHostRoles((prev) => {
      const next = { ...prev };
      for (const h of pending) next[h.id] = { roles: [], loading: true, error: null };
      return next;
    });
    // Requests are not cancelled when the dialog closes: the close reset
    // empties hostRoles and rolesRequestedRef, and `requested` below is
    // checked so a late answer from a previous open is dropped.
    const requested = rolesRequestedRef.current;
    for (const h of pending) {
      const hostIdNum = parseInt(String(h.id), 10);
      listRolesForHost(hostIdNum)
        .then((roles) => ({ roles, error: null }))
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "role fetch failed";
          console.warn(`[new-session] roles fetch failed hostId=${h.id} host=${h.name}: ${error}`);
          return { roles: [] as RoleSummary[], error };
        })
        .then((result) => {
          if (rolesRequestedRef.current !== requested) return;
          setHostRoles((prev) => ({ ...prev, [h.id]: { ...result, loading: false } }));
        });
    }
  }, [open, shellOnly, flatHosts]);

  // One-machine "No roles" default. While there is exactly one pickable
  // machine and nothing has been picked by the user (or seeded), "No roles" is
  // preselected so Create works straight away. It tracks the machine count:
  // if a second machine appears while the pick is still the untouched
  // default, the default is withdrawn (several machines → nothing
  // preselected, Create disabled until the user picks).
  useEffect(() => {
    if (!open || shellOnly) return;
    if (flatHosts.length === 1) {
      if (!rolesTouchedRef.current && !noRoles && selectedRoles.length === 0) {
        noRolesIsDefaultRef.current = true;
        setNoRoles(true);
      }
    } else if (noRolesIsDefaultRef.current) {
      noRolesIsDefaultRef.current = false;
      setNoRoles(false);
      // The sole-machine auto-pick goes with it; a caller-supplied host stays.
      if (!initialHost) setSelectedHost(null);
    }
  }, [open, shellOnly, flatHosts, noRoles, selectedRoles, initialHost]);

  // Phase 22 SRIC-05 Test 6: stale-role guard. After the picked host's roles
  // land, if selectedRoles was seeded from initialRole (chain pre-fill) but
  // that role name is not actually present on that host, clear the
  // selection so the user sees the empty dropdown state and can't submit with
  // a phantom role. Only runs when there IS a current selection AND the fetch
  // has landed (rolesForHost non-empty OR rolesLoading false after a fetch).
  useEffect(() => {
    if (selectedRoles.length === 0 || rolesLoading) return;
    if (rolesForHost.length === 0) return;
    const valid = selectedRoles.filter((sel) =>
      rolesForHost.some((r) => r.name === sel),
    );
    if (valid.length !== selectedRoles.length) {
      setSelectedRoles(valid);
      // With one machine an empty pick is "No roles", as on open.
      if (valid.length === 0 && !multiHost) {
        noRolesIsDefaultRef.current = true;
        setNoRoles(true);
      }
    }
  }, [rolesForHost, rolesLoading, selectedRoles, multiHost]);

  // Roles dropdown wiring. With several hosts an option's value is
  // `<hostId>/<role>` (a role can exist on more than one host — instance-wide
  // roles are on all of them); with one host it is the bare role name.
  // Each host's entries start with "No roles" (value NO_ROLES_OPTION in place
  // of a role name), so a host with no roles still offers somewhere to land.
  // With several hosts, a host whose roles couldn't be fetched gets no section
  // at all. With one host, its "No roles" entry stays (it doesn't depend on
  // roles loading) so the preselected default is always visible.
  const roleOptionValue = (host: Host, role: string) =>
    multiHost ? `${host.id}/${role}` : role;
  const noRolesLabel = t("nav.newSessionNoRoles", { defaultValue: "No roles" });
  const roleOptions = sortedHosts.flatMap((host) => {
    if (hostRoles[host.id]?.error && multiHost) return [];
    const group = multiHost ? { group: host.name } : {};
    const noRolesOption = {
      value: roleOptionValue(host, NO_ROLES_OPTION),
      label: noRolesLabel,
      ...(multiHost ? { ...group, pillLabel: `${noRolesLabel} · ${host.name}` } : {}),
    };
    const hostOptions = (hostRoles[host.id]?.roles ?? []).map((role) => {
      // Instance-wide roles carry a marker (same role on every host).
      const label =
        roleDisplayName(role.name, role.displayName) +
        (role.instanceWide ? " · instance-wide" : "");
      return {
        value: roleOptionValue(host, role.name),
        label,
        ...(multiHost ? { ...group, pillLabel: `${label} · ${host.name}` } : {}),
      };
    });
    return [noRolesOption, ...hostOptions];
  });
  const pickedRoleValues = selectedHost
    ? (noRoles ? [NO_ROLES_OPTION] : selectedRoles).map((r) => roleOptionValue(selectedHost, r))
    : [];
  function handleRolesChange(next: string[]) {
    // Any pick from here on is the user's own choice.
    rolesTouchedRef.current = true;
    noRolesIsDefaultRef.current = false;
    const parse = (v: string) => {
      if (!multiHost) return { hostId: selectedHost?.id ?? "", role: v };
      const slash = v.indexOf("/");
      return { hostId: v.slice(0, slash), role: v.slice(slash + 1) };
    };
    const added = next.find((v) => !pickedRoleValues.includes(v));
    if (added) {
      const { hostId, role } = parse(added);
      if (multiHost && selectedHost?.id !== hostId) {
        // An entry from another host: the agent will live there instead, and
        // roles picked from the previous host can't come along.
        const host = flatHosts.find((h) => h.id === hostId);
        if (!host) return;
        console.log(
          `[new-session] role host switch from=${selectedHost?.id ?? "-"} to=${hostId} role=${role} dropped=${selectedRoles.join(",") || "-"}`,
        );
        setSelectedHost(host);
        setNoRoles(role === NO_ROLES_OPTION);
        setSelectedRoles(role === NO_ROLES_OPTION ? [] : [role]);
        return;
      }
      if (role === NO_ROLES_OPTION) {
        // "No roles" clears any picked roles.
        setNoRoles(true);
        setSelectedRoles([]);
        return;
      }
    }
    // Picking a role clears "No roles".
    const roles = next.map((v) => parse(v).role).filter((r) => r !== NO_ROLES_OPTION);
    if (roles.length === 0 && selectedRoles.length > 0 && !noRoles) {
      // Unticked the last role: fall back to "No roles" on its host.
      setNoRoles(true);
      setSelectedRoles([]);
      return;
    }
    setNoRoles(false);
    setSelectedRoles(roles);
    // "No roles" unticked: nothing is picked, so no host either (with several
    // hosts) — "New role…" then asks for one and a typed name isn't checked
    // against a machine the user has backed out of.
    if (roles.length === 0 && multiHost) setSelectedHost(null);
  }

  // Phase 80 Plan 80-06 Task 2: auto-prefill Name via pickPoolName.
  //
  // 2026-09-14: the `!selectedRoles` gate is GONE. It was never about names —
  // the backend needed a role solely to compose the MXID it probed for
  // availability, and that probe has moved to the host's identity directories
  // (which are role-independent). So a name can be suggested the moment a host
  // is known, instead of the user staring at an empty Name field until they
  // also pick a role.
  //
  // Keyed on selectedHost only — NOT on selectedRoles. Role does not affect the
  // answer any more (availability is host-scoped and role-independent), so
  // re-picking when a role lands would issue a second request whose result is
  // always discarded — one redundant SSH connection per role pick.
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
        //
        // 2026-09-27: on failure, flip the auto-name checkbox to `true` so the
        // manual input reveals. Without this the user would sit staring at just
        // a checked-off "Choose a custom agent name" checkbox with no input to
        // type in, and Create would be disabled forever. Same "degrade
        // invisibly" spirit as the swallow above — no banner, no explanation,
        // the input just appears and the user types.
        if (!cancelled) setAutoName(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // No exhaustive-deps suppression needed: every value this effect reads
    // reactively IS in the dep array. `name`, `poolPickedName`, and
    // `selectedRoles` are read through refs precisely so they do not belong here.
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
    // Clear state immediately if name is invalid or no host selected.
    // Pretty-names shape (2026-09-30): derive the slug the backend WOULD
    // produce via the shared preview helper and probe by that; this makes
    // the pre-check meaningful for free-form pretty names like "Alicia Smith".
    const previewSlug = previewSlugFromPrettyName(currentName ?? "");
    if (!previewSlug || !selectedHost) {
      setSkynetCollision(false);
      setHostCollision(false);
      return;
    }
    collisionTimerRef.current = setTimeout(async () => {
      if (birthStartedRef.current) return;
      setCollisionChecking(true);
      try {
        const [identities, existsOnHost] = await Promise.all([
          listIdentities(),
          getIdentityExistsOnHost(selectedHost.id as unknown as number, previewSlug),
        ]);
        if (birthStartedRef.current) return;
        const skynetHit = identities.some((id) => id.identityKey === previewSlug);
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

  // A typed name is checked against the host it will be born on. With no host
  // step that host can arrive (or change) after the name was typed — via the
  // role pick — so check again whenever it does.
  useEffect(() => {
    if (shellOnly || !autoName || name.trim() === "") return;
    runCollisionPrecheck(name);
    // Keyed on the host only; the name is re-checked on blur as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHost?.id]);

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
      // Pretty-names shape (2026-09-30): send the raw typed pretty name as
      // `displayName` when the user came through the name-it-myself path;
      // the backend derives the identity slug. The pool-picked path sends
      // the pool-chosen slug directly as `name`.
      const isPoolPicked =
        poolPickedName !== null && name.trim() === poolPickedName;
      const stream = openBirthStream(
        {
          hostId: hostIdNum,
          ...(isPoolPicked
            ? { name: name.toLowerCase() }
            : { displayName: name.trim() }),
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
          // Multi-role: the first pick goes in `role`, any further picks in
          // `roles`; the identity file lists them all, in pick order. "No
          // roles" sends neither.
          ...(selectedRoles.length > 0 ? { role: selectedRoles[0] } : {}),
          ...(selectedRoles.length > 1 ? { roles: selectedRoles.slice(1) } : {}),
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
          ...(project ? { project } : {}),
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
        // Phase 106 Plan 106-02 (D-18): the refresh → onCreate order
        // is preserved; refresh MUST fire between ended:ok consumption and
        // onCreate firing so the just-born identity is in the store before
        // AppShell's openTab resolves it into pretty-view routing.
        //
        // Fetch ONLY the newborn, by name + host. A bare refresh derives its
        // hosts from fleetSessions, which may not include the newborn yet —
        // the terminal-instead-of-PrettyView + missing-avatar symptoms. A full
        // refresh naming the host did work but read every identity file on
        // every host first (~6-8s on the live fleet) while the user stared at
        // the modal. refreshOneIdentity upserts just this row; the rest of the
        // store is already current. Best-effort — never rejects.
        await refreshOneIdentity(bornName, hostIdNum);

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
  //   valid name + a roles pick ("No roles" counts) + no collisions. Phase 86 Plan 86-04
  //   (D-CTX-86-surface-4): title / brief / avatar-picked gates removed —
  //   cosmetics live at role level; new identities inherit.
  // - Shell-only mode (shellOnly, admin opt-in via Phase-88 checkbox):
  //   require host + valid session name (mirrors pre-Phase-88 logic).
  // During birthing: Create is disabled regardless.
  //
  // Pretty-names shape (2026-09-30): the agent-mode name field is now a
  // free-form pretty name — backend derives the identity slug. Client-side
  // we only check that it would slug to at least one letter — same shared
  // recipe as the CreateRoleDialog preview — so the user gets instant
  // feedback on all-emoji / all-punctuation input.
  const nameSlugPreview = previewSlugFromPrettyName(name);
  const nameValid = !shellOnly
    ? name.trim().length > 0 && name.trim().length <= 80 && nameSlugPreview.length > 0
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
      // Something must be picked: "No roles", or one or more roles.
      (noRoles || selectedRoles.length > 0)
    : selectedHost !== null && nameValid && pathValid);

  // Phase 106 Plan 106-02 (D-13/D-15): form fields disabled ONLY while birthing.
  // Under the sole-spawner shape there is no failure-persist state — any birth
  // failure fires `window.alert("agent creation failed")` and immediately closes
  // the modal per D-17, so the previous failed-step-persist clause is gone.
  // The previous "any step active" / "show progress" derivations are gone with
  // the 5-step checklist (the Create button IS the spinner surface per D-14).
  const formDisabled = birthing;

  // Title copy updated 2026-09-29 per user's tasting: this modal is now
  // "New conversation" (paired with NewConversationModal's rename to
  // "New group conversation"). The i18n key stays the same for translation
  // continuity; only the defaultValue changes.
  const startTitle = t("nav.newSessionTitle", {
    defaultValue: "New conversation",
  });
  // Phase 88 (paired-blurb revision): in-place defaultValue edit only,
  // no new i18n key. Sibling role blurb ships in CreateRoleDialog.tsx
  // DialogDescription in the same commit surface; the shared verb is
  // ADOPT (role side: "agents ADOPT expertise"; agent side: "each one
  // ADOPTS a role"). See 88-CONTEXT.md §Verbatim copy for LOCKED text.
  const startDescription = t("nav.newSessionDescription", {
    defaultValue:
      "Agents are the workers you chat with. Each one can adopt roles that shape what they know and how they help.",
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
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Phase 106 Plan 106-02 (D-15): modal is fully locked from Create
        // click to birth resolution. Any close attempt (X button, Esc,
        // backdrop click) is a no-op while `birthing === true`. Success or
        // failure of the birth stream fires `onClose()` directly inside
        // handleBirth after clearing the `birthing` flag.
        if (!next && !birthing) onClose();
      }}
      size="md"
      className="max-h-[90vh] flex flex-col"
    >
      <div
        style={{ "--color-pv-code-fg": "#92eafc" } as React.CSSProperties}
        className="flex flex-col flex-1 min-h-0 overflow-hidden"
      >
        <ModalHead title={startTitle} subtitle={startDescription} />
        <ModalBody className="overflow-y-auto flex flex-col gap-3">
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
          {effectiveShellOnly && flatHosts.length !== 1 && (
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

              {/* Phase 22 SRIC-02: Role dropdown — first field in the identity
                  cluster. Lists every host's "No roles" entry and roles
                  (sectioned by host when there are several); the pick decides
                  the host. */}
              <div className="flex flex-col gap-1.5">
                {/* Multi-role: a dropdown multi-select replaces the old
                    single-pick <select>. Pick one or more; the order of
                    picking is the order the identity file lists them in. */}
                <label
                  htmlFor="new-identity-roles"
                  className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
                >
                  Roles
                </label>
                <MultiSelect
                  id="new-identity-roles"
                  ariaLabel="Roles"
                  // Options show as each host answers; the placeholder only
                  // says "loading" while there is nothing to pick yet.
                  placeholder={
                    anyRolesLoading && allRoles.length === 0
                      ? "Loading roles..."
                      : "Pick roles…"
                  }
                  disabled={
                    formDisabled ||
                    (anyRolesLoading && allRoles.length === 0) ||
                    (roleOptions.length === 0 && !onNewRole)
                  }
                  options={roleOptions}
                  value={pickedRoleValues}
                  onChange={handleRolesChange}
                  leadingAction={
                    onNewRole
                      ? {
                          label: "New role…",
                          onSelect: () => {
                            console.log(
                              `[new-session] new-role hop hostId=${selectedHost?.id ?? "-"} roles=${selectedRoles.join(",") || "-"}`,
                            );
                            // Only a name the user chose travels; a pool
                            // suggestion is re-picked on the way back.
                            const customName =
                              autoName && name.trim() !== "" && name !== poolPickedName
                                ? name
                                : null;
                            onNewRole({ host: selectedHost, roles: selectedRoles, name: customName });
                          },
                        }
                      : undefined
                  }
                />
                {/* Role fetch errors are not shown — an unreachable host is
                    routine, its roles just don't list (console.warn logs it). */}
              </div>

              {/* 2026-09-14: the "What will this agent work on?" textarea that
                  sat here (Phase 80 Plan 80-06) was removed. It asked too early
                  — the user frequently does not know yet at creation time, and
                  restates it conversationally the moment the agent wakes. Birth
                  now records TASK_PLACEHOLDER and the agent overwrites its own
                  `task:` frontmatter on first wake. */}

              {/* 2026-09-27: Identity-name group inverted from label+input to
                  checkbox+conditional-input. Default state (unchecked) leaves
                  the name to the vetted-pool picker's suggestion, keeping the
                  form to a single visible checkbox row. Checking the box
                  reveals the manual input for a user who wants to pick their
                  own name.

                  The checkbox label replaces the previous small-caps NAME row
                  (byte-exact text change from user 2026-09-27: "choose a custom
                  agent name"). Anchor id `new-identity-auto-name` mirrors the
                  shell-only checkbox anchor idiom at `new-session-identity-mode`
                  above. `htmlFor` targets the checkbox, not the input, so
                  clicking the label toggles the checkbox — the input keeps its
                  `aria-label="Name"` for AT users.

                  Pool-pick failure flips autoName true silently (see effect at
                  ~line 619's catch), so a user never sits stuck on an
                  auto-generate checkbox with no input to type in. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="new-identity-auto-name"
                    checked={autoName}
                    onChange={(e) => !formDisabled && setAutoName(e.target.checked)}
                    disabled={formDisabled}
                    className="w-3.5 h-3.5 rounded disabled:opacity-50"
                  />
                  <label
                    htmlFor="new-identity-auto-name"
                    className="text-xs text-[color:var(--color-pv-fg)] cursor-pointer select-none"
                  >
                    Choose a custom agent name
                  </label>
                </div>
                {autoName && (
                  <>
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
                      aria-invalid={name.trim().length > 0 && !nameValid}
                    />
                    {/* Name validation errors — pretty-names shape (2026-09-30) */}
                    {name.trim().length > 0 && !nameValid && (
                      <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                        {name.trim().length > 80
                          ? "Name must be 80 characters or fewer"
                          : "Name must contain at least one letter"}
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
                  </>
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
              in the Create button (see ModalFoot below) instead of a
              per-step ticking list. */}
        </ModalBody>

        <ModalFoot>
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
        </ModalFoot>
      </div>
    </Modal>
  );
}
