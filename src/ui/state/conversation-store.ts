// ─── Conversation store ──────────────────────────────────────────────────────
// Module-scoped store for the Telegram-style conversation list.
//
// Contract (per Phase 41 Plan 01, CONTEXT.md §Sort model — middle section):
//   - Three-zone conversation list: pinned (top, stable), middle (flat, recency-
//     desc with no-history-to-top), rdpGroup (bottom, stable).
//   - Pinned zone + activeSet + RDP zone use `compareByHostRoleLabel`
//     — (host outer, role middle, label inner), case-insensitive, null-role
//     sorts last. Pre-Phase-41 the middle also used this comparator; Phase 41
//     flipped the middle to `compareByRecencyDesc` (freshest activity first;
//     rows with `lastMessageAt == null` sort to the TOP; ties + no-history rows
//     fall back to insertion-order key for deterministic stability).
//   - Middle is FLAT: no host bucketing, no per-host separators, no hostTree
//     walk. All non-pinned / non-active-set / non-RDP identity-tmux + fleet-
//     synthetic rows land in a single `middle: ConversationRow[]` array.
//   - RDP zone is emitted iff at least one host has `enableRdp === true`. When
//     zero RDP-eligible hosts exist, `rdpGroup === null` (Ashley lock: no
//     empty RDP header). RDP rows internally follow hostTree order (see the
//     synthesis pass below), then sort by compareByHostRoleLabel.
//   - Plan 03 (deferred, full-stack) will populate `lastMessageAt` on rows via
//     a fleet-status protocol extension. Until then, EVERY row has
//     `lastMessageAt: null` (no-history branch), so the middle zone degrades
//     cleanly to insertion-order fallback.
//   - Pins float above the middle. Per-session (not per-host). Session
//     end removes the row AND clears its pin in the same mutation (T-06-01-01
//     stale-selection defense also lives here — a selected id no longer in
//     openTabs is coerced to null).
//   - Persistence is in-memory only (module-scoped Map/Set +
//     React `useSyncExternalStore`). Nothing written to any browser storage
//     layer per TG-05 — a full page refresh resets the store.
//   - Tabs excluded from the conversation list: "dashboard". This is a
//     singleton non-conversation surface; the conversation list is
//     "sessions I'm talking to" (terminal / rdp / vnc / telnet on a host).
//   - Phase 14A retired the "files", "docker", "stats", "tunnel",
//     "host-manager", "user-profile", "admin-settings", "network_graph"
//     tab types entirely — they're absent from the TabType union so the
//     set below only lists what actually exists.
//
// Pattern is deliberately the same as src/ui/state/identities-store.ts —
// module-scoped `state` + `Set<() => void>` listener registry + a snapshot
// version counter so `useSyncExternalStore` gets a stable reference across
// no-op updates but a new reference on every real mutation.
//
// No React imports at module scope; hooks live inside the exported use*
// functions. No dependency on zustand / jotai / redux / mobx — the fork
// rolls its own stores (identities-store.ts is the reference).

import { useSyncExternalStore } from "react";
import type { Host, HostFolder, Tab, TabType } from "@/types/ui-types";
import { putPinnedIds, putHiddenIds } from "@/api/user-preferences-api";
import type { Identity } from "@/api/identities-api";
import { sessionMatchKey } from "@/features/terminal/session-hue";
// Phase 41 Plan 03 — bridge to the working-store cache for the wire-side
// lastMessageAt signal + a subscribe hook so a working-store publish invalidates
// our memoized snapshot (row derivation re-runs and re-picks up fresh recency).
import {
  getSessionLastMessageAt,
  subscribeSessionWorkingStore,
} from "./session-working-store";

// ─── Public derived types ────────────────────────────────────────────────────

export type ConversationRow = {
  id: string;
  type: TabType;
  label: string;
  host: Host | undefined;
  targetTmuxSession: string | null;
  // Plan 07-01 (TG-12, TG-13, TG-14): INTERNAL routing marker for detached-
  // row-click plumbing. `true` on synthetic fleet-derived rows that have no
  // corresponding entry in `openTabs`; `undefined` on openTabs-derived rows
  // (deliberately OMITTED, not set to `false`, so the row-shape stays as
  // close as possible to the Phase 6 5-key contract — see Test 8's filter
  // in conversation-store.test.ts). ConversationRow.tsx MUST render both
  // states identically per TG-13 shape lock; this field exists only so
  // ConversationsPanel's row-click handler can branch to
  // `onDetachedRowClick(row)` (Plan 07-01 Task 2) vs `selectConversation`.
  fleetOnly?: boolean;
  // Plan 07-02 (TG-15): INTERNAL routing marker for RDP-host-row-click
  // plumbing. `true` on synthetic rows synthesized from a Host with
  // `enableRdp === true` (fleet fact, NOT tab state — the row exists as long
  // as the host has RDP enabled, regardless of whether an RDP tab is
  // currently open). RDP rows live in a sentinel HostGroup with
  // `hostId === "__rdp__"` at the BOTTOM of the derived ConversationList.
  // The panel-layer uses this marker to route click → onRdpRowClick(row) →
  // AppShell → openTab(host, "rdp"). Never present on openTabs-derived rows
  // or fleet-only rows.
  rdpHostRow?: boolean;
  // Phase 25 (Plan 25-02): identity role resolved from identity file frontmatter
  // at row-construction time. Used as the middle sort key in compareByHostRoleLabel
  // (host outer, role middle, label inner). Deliberately OMITTED (not set to null)
  // when the row has no identity resolution — same "omit-when-null" convention as
  // `fleetOnly` and `rdpHostRow`. `undefined` and `null` both sort last in
  // compareByHostRoleLabel via the `a.role ?? null` normalization.
  role?: string | null;
  // Phase 41 (Plan 01): the "message either direction" activity timestamp used
  // by `compareByRecencyDesc` to order the flat middle zone. Set to `null` when
  // no history exists (row sorts to the TOP of the middle per Ashley's
  // no-history-to-top exception). Plan 03 will populate this via a fleet-status
  // protocol extension; until then, EVERY row carries `lastMessageAt: null`
  // and the middle degrades to insertion-order fallback. Deliberately OPTIONAL
  // so existing row constructors (which don't yet set it) still typecheck; the
  // comparator normalizes `undefined` → `null` for consistent no-history sort.
  lastMessageAt?: number | null;
};

export type HostGroup = {
  hostId: string;
  hostName: string;
  rows: ConversationRow[];
};

// Phase 41 (Plan 01): three-zone shape.
//   - `activeSet`: rows currently in Ashley's active-set (state.activeSet),
//     sorted by (host, role, label). Structurally UNCHANGED from Phase 25.
//   - `pinned`: rows pinned but NOT in activeSet, sorted by (host, role, label).
//     Structurally UNCHANGED from Phase 25.
//   - `middle`: FLAT list of remaining identity-tmux + fleet-synthetic rows
//     (non-pinned, non-active-set, non-RDP). Sorted by `compareByRecencyDesc`
//     — no-history rows (lastMessageAt == null) sort to the TOP; rows with
//     timestamps sort DESC (freshest first); ties + no-history rows fall back
//     to insertion-order key for deterministic stability. Replaces the
//     pre-Phase-41 `grouped: HostGroup[]` for the middle tier.
//   - `rdpGroup`: sentinel HostGroup (`hostId: "__rdp__"`) containing all
//     RDP-eligible rows, OR `null` when zero hosts have `enableRdp === true`.
//     No empty header renders in the panel when null (Ashley lock).
export type ConversationList = {
  activeSet: ConversationRow[];
  pinned: ConversationRow[];
  middle: ConversationRow[];
  rdpGroup: HostGroup | null;
};

// Plan 07-01 (TG-12): fleet-discovered tmux session shape. Re-declared here
// (not imported from `@/api/sessions-api`) so the UI-state layer does NOT
// depend on the API layer — matches the fork's layering discipline from
// Phase 6 §layering. AppShell fetches getSessionList() then feeds the result
// into `updateFleetSessions(...)` via a one-shot mount effect (no polling).
// Shape mirrors `RemoteTmuxSession` in @/api/sessions-api verbatim.
export type FleetSession = {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
};

type SnapshotForTest = ConversationList & {
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
};

// Phase 41 (Plan 01): retire the `activeSet` field's ambient-visual mention in
// the State type comment. The `state.activeSet: Set<string>` field survives
// AS-IS — it still drives the deactivate-action semantics (per Ashley lock #5).
// Only the visual tier's ambient-recession rendering was retired; the field
// itself is load-bearing for deactivate menu-item gating.

// ─── Which tab types are "conversations" ─────────────────────────────────────
// A tab is a "conversation" iff it targets a host and represents a session-
// like remote surface. Everything else (dashboard, settings singletons,
// tunnel, network_graph) is excluded from the list.

const CONVERSATION_TAB_TYPES = new Set<TabType>([
  "terminal",
  "rdp",
  "vnc",
  "telnet",
]);

// Patch #137: sessionStorage key for the activeSet persistence layer. Value is
// a JSON array of conversation ids; sessionStorage semantics = per-tab, dies
// on tab close. See hydrateActiveSetFromStorage() + addToActiveSet() +
// removeFromActiveSet() below. quick-260727-gm3 introduced remove semantics
// (Ashley 2026-07-27 deactivate action) — the pre-gm3 lock ("no remove API by
// design") was intentionally lifted; the set now grows AND shrinks within a
// session, but still dies on tab close.
const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";

// Phase 41 Plan 02: sessionStorage key for the one-shot cold-load scroll-hide
// sentinel owned by PrettyConversationsPanel's search-input mount. Declared
// here so the only=1 sessionStorage-bleed guard below can clear it alongside
// pv-conv-active-set — same T-41-02-01 mitigation as the activeSet key. The
// panel component owns the read/write semantics; the store only owns the
// only=1 guard extension so a single hash-parse pass handles every
// session-scoped key.
const SEARCH_HIDDEN_SENTINEL_KEY = "pv-conv-search-hidden-once";

// Patch #137: rehydrate the activeSet from sessionStorage on module load.
// Wrapped in try/catch so malformed JSON, missing key, empty string, quota
// errors, or an absent sessionStorage (SSR/JSDOM edge) ALL silently fall
// back to an empty Set — a corrupt persistence layer must never crash the
// UI thread.
//
// Ashley 2026-08-05 (fix chain 70q→7rq→53a36a6→ea0098c→THIS): Move-to-new-
// window / Open-in-new-window URLs carry `only=1` in the hash. Since we drop
// `noopener` on window.open (PrettyConversationRow.tsx uo4-noopener-fix so
// the null-check for popup-blocker safety works), the child window inherits
// the opener's sessionStorage — including this key. Without the guard below,
// the new window's hydrate would pull the opener's whole activeSet in on
// module load, causing Move-to-new-window to bring along every origin-active
// row alongside the target row. Detect `only=1` in the URL hash and start
// fresh: return an empty Set AND remove the storage key so any later
// addToActiveSet calls persist onto a clean slate. AppShell's URL-restore
// path (patch #230) enrolls the URL-supplied tabs into the active set via
// its normal enroll logic, so the new window ends up with only the URL's
// tabs active — matching what `only=1` was designed to promise.
function hydrateActiveSetFromStorage(): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set<string>();

    // only=1 sessionStorage-bleed guard — see block comment above.
    // Phase 41 Plan 02: the guard now clears BOTH pv-conv-active-set AND
    // pv-conv-search-hidden-once so the new window's search-hide effect
    // gets a fresh cold-load hide (same rationale as the activeSet clear).
    if (typeof window !== "undefined" && window.location?.hash) {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      if (params.get("only") === "1") {
        try {
          sessionStorage.removeItem(ACTIVE_SET_STORAGE_KEY);
        } catch {
          /* best-effort clear */
        }
        try {
          sessionStorage.removeItem(SEARCH_HIDDEN_SENTINEL_KEY);
        } catch {
          /* best-effort clear */
        }
        return new Set<string>();
      }
    }

    const raw = sessionStorage.getItem(ACTIVE_SET_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    const out = new Set<string>();
    for (const v of parsed) if (typeof v === "string") out.add(v);
    return out;
  } catch {
    return new Set<string>();
  }
}

function isConversationTab(tab: Tab): boolean {
  if (!CONVERSATION_TAB_TYPES.has(tab.type)) return false;
  if (!tab.host) return false;
  return true;
}

// ─── Module-scoped state ─────────────────────────────────────────────────────

type State = {
  hostTree: HostFolder | null;
  openTabs: Tab[];
  pinnedIds: Set<string>;
  hiddenIds: Set<string>;
  selectedId: string | null;
  // Plan 07-01 (TG-12, TG-17): fleet-discovery snapshot input. Fed ONCE per
  // page-load by AppShell's mount effect (empty dep array useEffect). No
  // polling, no interval, no focus refetch. Absence = openTabs-only rendering
  // (Phase 6 baseline). Combined with openTabs via the union+dedup logic
  // inside computeSnapshot().
  fleetSessions: FleetSession[];
  // quick-260727-kbw: has updateFleetSessions been called at least once this
  // session? Starts false; flips true on the first call (empty [] counts as
  // loaded). Consumed by PrettyConversationsPanel's mount-effect gate for the
  // getPinnedIds fetch — see PrettyConversationsPanel.tsx §Phase 15 (Wave 3)
  // mount effect §(d). Closes the load-order race where hydratePinnedIds-
  // FromServer landed a fleet pin BEFORE updateFleetSessions populated
  // state.fleetSessions, causing the next updateOpenTabs to nuke the pin
  // via an empty fleetPinKeepSet.
  fleetSessionsLoaded: boolean;
  // Plan 07-01 (TG-14): flat hostId → Host lookup so the click-a-detached-row
  // handler can resolve a fleet row (identified by numeric hostId +
  // sessionName) to a Host object openTab requires. Populated by AppShell's
  // hostsById memo (keyed on stableHostTreeKey — reuses the Phase 6 NOTE-05
  // thrash-guard). Used both for fleet-row Host enrichment during rendering
  // (see computeSnapshot) AND — pending Plan 07-02 — for RDP row derivation
  // filtered on `host.enableRdp === true`.
  hostsFlat: Map<number, Host>;
  // Phase 25 (Plan 25-02): identityKey.toLowerCase() → Identity lookup for
  // role resolution at row-construction time. Fed by AppShell via
  // updateIdentitiesByKey on identity-store change — mirrors the hostsFlat
  // pattern. keyed identically to identities-store.ts byKey (identityKey.toLowerCase()).
  identitiesByKey: Map<string, Identity>;
  // Patch #137: sessionStorage-backed set of conversation ids Ashley has
  // selected in this browser-tab session. Persisted under key
  // "pv-conv-active-set" as a JSON array. Rehydrated on module load;
  // add + remove APIs (quick-260727-gm3 added removeFromActiveSet as the
  // pure reverse of tap-ambient-to-activate); dies on tab close
  // (sessionStorage semantics).
  // Feeds PrettyConversationRow's ambient-recession branch (rows NOT in
  // the set visually recede) and the ready-for-attention dot render
  // condition (dot renders iff inActiveSet && isWorking===false).
  activeSet: Set<string>;
};

let state: State = {
  hostTree: null,
  openTabs: [],
  pinnedIds: new Set<string>(),
  hiddenIds: new Set<string>(),
  selectedId: null,
  fleetSessions: [],
  fleetSessionsLoaded: false,
  hostsFlat: new Map<number, Host>(),
  identitiesByKey: new Map<string, Identity>(),
  activeSet: hydrateActiveSetFromStorage(),
};

// Plan 06-04 race defense (T-06-04-04): openTab's setTabs is batched — the
// new tab id is NOT visible in `state.openTabs` synchronously after openTab
// returns. `selectConversationDeferred(newTabId)` parks the id here; the next
// `updateOpenTabs` call that includes the id flushes it into `state.selectedId`.
// A direct `selectConversation` call (post stale-guard) also clears pending —
// see the re-decided placement in selectConversation() below (NOTE-03).
let pendingSelectId: string | null = null;

// Version bump on every real mutation. Snapshot memoization is keyed on it —
// consumers of `useSyncExternalStore` see a stable ConversationList reference
// as long as `snapshotVersion` is unchanged, so React does NOT tear.
let snapshotVersion = 0;

// Memoized derived-list snapshot. Recomputed lazily on demand when
// `snapshotVersion` has advanced past `cachedSnapshotVersion`.
let cachedSnapshot: ConversationList | null = null;
let cachedSnapshotVersion = -1;

const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  cachedSnapshot = null; // invalidate — will be rebuilt on next getSnapshot()
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Derivation ──────────────────────────────────────────────────────────────

// Phase 41 Plan 01: test-only injection map for row.lastMessageAt.
// Keyed on row id (or fleet-synthetic id for fleet rows). Plan 03 has now
// landed the real fleet-status wire-side signal (session-working-store's
// per-key cache is the primary source); this map SURVIVES as the test-only
// injection API for the store's own unit tests, which don't want to go
// through the wire path for every assertion. Production callers never touch
// it. Defense-in-depth: resolves to `null` for any id not in the map.
const lastMessageAtByRowId = new Map<string, number | null>();

/**
 * Phase 41 Plan 03 — derive the working-store session-key for a row's
 * (host, targetTmuxSession) pair. Mirrors sessionWorkingKey() at
 * PrettyConversationsPanel.tsx:127-130 verbatim — a change to that helper
 * MUST be mirrored here (search for "sessionWorkingKey" for the sibling
 * callsite). Returns null when the row lacks a host (fleet-only pre-resolution
 * race, mirroring the panel's dot-suppression path).
 */
function sessionWorkingKeyForRow(
  host: Host | undefined,
  targetTmuxSession: string | null | undefined,
): string | null {
  if (!host) return null;
  return `${host.id}:${targetTmuxSession ?? ""}`;
}

/**
 * Phase 41 Plan 01 + Plan 03 — resolve lastMessageAt for a row at snapshot
 * derivation time. Precedence:
 *   1. Test injection map (Plan 01 __setLastMessageAtForTest hook). Kept as
 *      the primary path in tests so unit tests don't need to plumb the wire
 *      publish just to exercise the comparator.
 *   2. Working-store cache (Plan 03 — real wire-side signal from the
 *      fleet-status WS). Derived from (host, targetTmuxSession) via
 *      sessionWorkingKeyForRow.
 * Returns null when neither source has a value.
 */
function resolveLastMessageAt(
  rowId: string,
  host: Host | undefined,
  targetTmuxSession: string | null | undefined,
): number | null {
  const injected = lastMessageAtByRowId.get(rowId);
  if (injected !== undefined) return injected;
  const key = sessionWorkingKeyForRow(host, targetTmuxSession);
  return getSessionLastMessageAt(key);
}

function rowFromTab(tab: Tab, sessionRoleByKey: Map<string, string | null>): ConversationRow {
  // Role lookup: prefer fleet-authoritative session.role (resolved on the identity's home box
  // via same SSH conn as tmux list-sessions), fall back to identitiesByKey as defense-in-depth.
  let role: string | null = null;
  if (tab.host && tab.targetTmuxSession) {
    const hostIdStr = String(parseInt(tab.host.id));
    const dedupK = dedupKey(hostIdStr, tab.targetTmuxSession);
    if (sessionRoleByKey.has(dedupK)) {
      role = sessionRoleByKey.get(dedupK) ?? null;
    } else {
      const matchKey = sessionMatchKey(tab.targetTmuxSession);
      role = matchKey ? (state.identitiesByKey.get(matchKey)?.role ?? null) : null;
    }
  }
  const lastMessageAt = resolveLastMessageAt(
    tab.id,
    tab.host,
    tab.targetTmuxSession,
  );
  return {
    id: tab.id,
    type: tab.type,
    label: tab.label,
    host: tab.host,
    targetTmuxSession: tab.targetTmuxSession ?? null,
    ...(role !== null ? { role } : {}),
    ...(lastMessageAt !== null ? { lastMessageAt } : {}),
  };
}

function isHostFolder(node: Host | HostFolder): node is HostFolder {
  return "children" in node;
}

// Depth-first host-tree walk. Emits host ids in the exact order SidebarTree
// renders them today — no alphabetical / recency override.
function collectHostOrder(tree: HostFolder | null): { id: string; name: string }[] {
  if (!tree) return [];
  const out: { id: string; name: string }[] = [];
  const walk = (folder: HostFolder): void => {
    for (const child of folder.children) {
      if (isHostFolder(child)) {
        walk(child);
      } else {
        out.push({ id: child.id, name: child.name });
      }
    }
  };
  walk(tree);
  return out;
}

// Plan 07-01 dedup key. Uses `\0` (null byte) as separator: guaranteed absent
// from user-typed tmux session names (tmux itself rejects control chars in
// session names) AND from Host.id strings (numeric-string coercion via
// String(parseInt(...))). Internal helper — NOT exported (test coverage is
// via the dedup-behavior tests, not a direct dedupKey unit test, so this
// stays a private implementation detail we can change if needed).
function dedupKey(hostIdStr: string, sessionName: string): string {
  return `${hostIdStr}\0${sessionName}`;
}

// Plan 07-01: canonical fleet-row id prefix. Format: `fleet::${hostId}::${sessionName}`.
// VISIBLE-ASCII `::` separator so ids are inspectable in DevTools
// (data-conversation-id attributes) — the null-byte dedup separator is
// INTERNAL only. Kept as a small helper so the AppShell click handler and
// the row-shape assertions in tests read from a single source of truth if
// they need to.
export function fleetRowId(hostId: number, sessionName: string): string {
  return `fleet::${hostId}::${sessionName}`;
}

// Phase 25 (Plan 25-02) — three-key sort comparator for all five row-bucket
// sort sites in computeSnapshot. Implements the LOCKED tuple from
// 25-CONTEXT.md §Sort semantics: (host, role, label) case-insensitive
// alphabetical with null-role-last (25-CONTEXT.md §Null-role handling).
//
// Key order:
//   Outer  — host.name (case-insensitive, no numeric-natural: host names rarely
//             have "host10 vs host9" ordering needs, and host-tree walk order
//             governs Tier 3's outer bucket structure anyway — the comparator's
//             host key is defense-in-depth for Tier 1 + Tier 2).
//   Middle — role (null/undefined sorts AFTER any real role per CONTEXT.md
//             §Null-role handling). `a.role ?? null` normalises both `undefined`
//             (field omitted per §ConversationRow-omit convention) and `null` to
//             a single null value before comparison.
//   Inner  — label (case-insensitive, numeric-natural — same as the pre-Phase-25
//             label-only sort so ordering within (host, role) tuples matches the
//             prior behaviour exactly).
const compareByHostRoleLabel = (a: ConversationRow, b: ConversationRow): number => {
  // Outer: host name (case-insensitive)
  const hostA = a.host?.name ?? "";
  const hostB = b.host?.name ?? "";
  const hostCmp = hostA.localeCompare(hostB, undefined, { sensitivity: "base" });
  if (hostCmp !== 0) return hostCmp;

  // Middle: role (null/undefined sorts AFTER any real role)
  const roleA = a.role ?? null;
  const roleB = b.role ?? null;
  if (roleA !== roleB) {
    if (roleA === null) return 1;  // null role → sort later
    if (roleB === null) return -1;
    const roleCmp = roleA.localeCompare(roleB, undefined, { sensitivity: "base" });
    if (roleCmp !== 0) return roleCmp;
  }

  // Inner: label (case-insensitive, numeric-natural — identical to the pre-Phase-25 label sort)
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
};

// Phase 41 (Plan 01) — middle-zone recency comparator.
//
// Ordering contract (§Sort model — middle section, Ashley lock 2026-08-14):
//   (1) Rows with `lastMessageAt == null` (no history) sort BEFORE rows with
//       any real timestamp (Ashley: "if there is no history of messages going
//       back and forth then it should show up at the top").
//   (2) Among no-history rows: fall back to `middleInsertionOrder` (a WeakMap
//       populated during computeSnapshot's middle-build pass — see the flat
//       middleRows push loop below) so ordering is deterministic across
//       snapshot recomputes.
//   (3) Among rows with real timestamps: `lastMessageAt` DESC (freshest first).
//   (4) When two rows have identical `lastMessageAt`: fall back to
//       `middleInsertionOrder` for stability.
//
// Since Plan 03 has NOT yet landed the `lastMessageAt` signal, EVERY row
// currently carries `lastMessageAt: null` — the middle degrades entirely to
// insertion-order (branch 1 + 2). Plan 03 will land the real signal without
// changing this comparator.
//
// The insertion-order map is passed in as a parameter (not read from
// module-scope) so the comparator stays pure and the sort is deterministic
// even if computeSnapshot fires concurrently (which it can't today — the
// store's snapshot cache is version-keyed — but the discipline stays honest).
const compareByRecencyDesc = (
  insertionOrder: WeakMap<ConversationRow, number>,
) => (a: ConversationRow, b: ConversationRow): number => {
  const aTs = a.lastMessageAt ?? null;
  const bTs = b.lastMessageAt ?? null;
  // Rule (1): no-history-to-top. Rows with null sort BEFORE rows with a
  // timestamp (return < 0 when a is null and b is not).
  if (aTs === null && bTs !== null) return -1;
  if (aTs !== null && bTs === null) return 1;
  // Rule (3): both have timestamps → DESC by lastMessageAt.
  if (aTs !== null && bTs !== null && aTs !== bTs) {
    return bTs - aTs; // b - a for DESC
  }
  // Rule (2)/(4) fallback: insertion-order key. Rows not tracked in the map
  // sort AFTER tracked rows (defensive default; should never happen in
  // practice since every middle row is registered during the build pass).
  const aKey = insertionOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
  const bKey = insertionOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
  return aKey - bKey;
};

function computeSnapshot(): ConversationList {
  const conversationTabs = state.openTabs.filter(isConversationTab);

  // Build a (hostId, sessionName) → role Map from fleet sessions FIRST so rowFromTab
  // can prefer fleet-authoritative role (resolved on the identity's home box via same
  // SSH conn as tmux list-sessions) over the pre-fix identitiesByKey fallback.
  // Keyed on dedupKey(hostIdStr, sessionName) — same key space as openTabsSessionKeys.
  const sessionRoleByKey = new Map<string, string | null>();
  for (const session of state.fleetSessions) {
    const hostIdStr = String(session.hostId);
    sessionRoleByKey.set(dedupKey(hostIdStr, session.sessionName), session.role);
  }

  // Plan 07-01: build the openTabs session-identity set for dedup FIRST (own
  // pass over conversationTabs) so the tier-assignment loops below can iterate
  // from scratch with clean semantics. A null/empty targetTmuxSession tab does
  // NOT enter the dedup set (Test 26): its identity is "attached to hostA
  // without a known session", not the same as any named fleet session on hostA.
  const openTabsSessionKeys = new Set<string>();
  for (const tab of conversationTabs) {
    if (!tab.host) continue;
    const tmux = tab.targetTmuxSession;
    if (tmux !== null && tmux !== "") {
      openTabsSessionKeys.add(dedupKey(String(parseInt(tab.host.id)), tmux));
    }
  }

  // Plan 07-01: build the merged fleet-derived synthetic-row list. Emit one
  // ConversationRow per FleetSession whose (hostId, sessionName) identity is
  // NOT already represented in openTabs (openTabs-entry-wins). Collect the
  // rows as { hostIdStr, row } tuples so the Tier 3 bucketing loop below
  // doesn't need to re-parse the fleet id.
  //
  // Host resolution: prefer state.hostsFlat.get(hostId) (a real Host with all
  // fields); fall back to undefined when hostsFlat hasn't populated yet (Test 28).
  // Also collect per-fleet-hostId hostName fallback so the HostGroup header can
  // render even when the host is absent from hostTree AND hostsFlat (Test 28).
  const fleetHostNameFallback = new Map<string, string>();
  const fleetSyntheticRows: { hostIdStr: string; row: ConversationRow }[] = [];
  for (const session of state.fleetSessions) {
    const hostIdStr = String(session.hostId);
    const key = dedupKey(hostIdStr, session.sessionName);
    if (openTabsSessionKeys.has(key)) continue; // openTabs-entry-wins
    const resolvedHost = state.hostsFlat.get(session.hostId);
    // Role is now authoritative from the backend session row (resolved on same SSH conn
    // as tmux list-sessions). The pre-fix identitiesByKey lookup returned null for every
    // non-tina identity because /identities used LOCAL-only resolveRoleForIdentity.
    const role = session.role;
    const fleetSyntheticId = fleetRowId(session.hostId, session.sessionName);
    const lastMessageAt = resolveLastMessageAt(
      fleetSyntheticId,
      resolvedHost,
      session.sessionName,
    );
    const syntheticRow: ConversationRow = {
      id: fleetSyntheticId,
      type: "terminal",
      label: session.sessionName,
      host: resolvedHost,
      targetTmuxSession: session.sessionName,
      fleetOnly: true,
      ...(role !== null ? { role } : {}),
      ...(lastMessageAt !== null ? { lastMessageAt } : {}),
    };
    fleetSyntheticRows.push({ hostIdStr, row: syntheticRow });
    if (!fleetHostNameFallback.has(hostIdStr)) {
      fleetHostNameFallback.set(hostIdStr, session.hostName);
    }
  }

  // Tier-assignment dedup tracker — every emitted row id is added here after
  // placement so Tier 2 and Tier 3 can skip ids already claimed by a higher tier.
  const emittedIds = new Set<string>();

  // ── Tier 1 (activeSet): rows in state.activeSet, overtaking pinned ──────────
  // Iterate conversationTabs first (openTabs order), then fleetSyntheticRows
  // (fleetSessions order) — same openTabs-first precedence used throughout.
  // RDP rows are never eligible: activeSet excludes them per patch #137
  // contract, and the loops here only iterate conversationTabs +
  // fleetSyntheticRows (rdpRows is a separate synthesized list that never
  // joins either set).
  const activeSetRows: ConversationRow[] = [];
  for (const tab of conversationTabs) {
    if (!state.activeSet.has(tab.id)) continue;
    activeSetRows.push(rowFromTab(tab, sessionRoleByKey));
    emittedIds.add(tab.id);
  }
  for (const { row } of fleetSyntheticRows) {
    if (!state.activeSet.has(row.id)) continue;
    activeSetRows.push(row);
    emittedIds.add(row.id);
  }
  activeSetRows.sort(compareByHostRoleLabel);

  // ── Tier 2 (pinned, not in activeSet): rows in pinnedIds and NOT emitted ────
  // Patch #149 B: previously iterated only conversationTabs; now ALSO iterates
  // fleetSyntheticRows so fleet-derived pinned rows surface at the top.
  const pinned: ConversationRow[] = [];
  for (const tab of conversationTabs) {
    // patch #230 B: a URL-restored (or freshly-opened) tab has a
    // dynamic openTab id (`hostname-terminal-${Date.now()}-${counter}`,
    // AppShell.openTab L1033) that never matches the fleet-format id
    // (`fleet::${hostId}::${sessionName}`) server-persisted pins use.
    // When the openTab shadows a fleet session, the fleet synthetic
    // row gets deduped out at L324 ("openTabs-entry-wins"), so a pin
    // whose id is the fleet form must ALSO be recognized against the
    // openTab's fleet-shadow id here — else the pin has nowhere to
    // render (fleet row gone, openTab id doesn't match pinnedIds) and
    // silently disappears from the pinned tier despite surviving in
    // state.pinnedIds. The store-mutation pruner already keeps such
    // pins alive via fleetPinKeepSet built from state.fleetSessions
    // (see updateOpenTabs L552-557); this is the render-side counterpart.
    const shadowFleetId =
      tab.host && tab.targetTmuxSession
        ? fleetRowId(parseInt(tab.host.id), tab.targetTmuxSession)
        : null;
    const isPinned =
      state.pinnedIds.has(tab.id) ||
      (shadowFleetId !== null && state.pinnedIds.has(shadowFleetId));
    if (!isPinned) continue;
    if (emittedIds.has(tab.id)) continue; // already in Tier 1
    pinned.push(rowFromTab(tab, sessionRoleByKey));
    emittedIds.add(tab.id);
  }
  for (const { row } of fleetSyntheticRows) {
    if (!state.pinnedIds.has(row.id)) continue;
    if (emittedIds.has(row.id)) continue; // already in Tier 1
    pinned.push(row);
    emittedIds.add(row.id);
  }
  pinned.sort(compareByHostRoleLabel);

  // ── Middle zone (Phase 41 Plan 01): FLAT list of non-pinned / non-active-set
  //    / non-RDP identity-tmux + fleet-synthetic rows, sorted by
  //    compareByRecencyDesc.
  //
  // Phase 41 retired the per-host bucketing (`byHostId` map + hostTree walk
  // + orphan-host fallback groups) that built the pre-Phase-41
  // `grouped: HostGroup[]` shape. The middle is now ONE flat array.
  //
  // Insertion-order key: each row's push-index into `middleRows` is captured in
  // a WeakMap keyed on row-object identity. The comparator reads the map for
  // the deterministic-stability fallback (see `compareByRecencyDesc` above).
  // The map is scoped to this single computeSnapshot invocation — a fresh
  // WeakMap on every call — so the "stable across a single snapshot" contract
  // holds regardless of how many times computeSnapshot fires.
  //
  // `collectHostOrder(state.hostTree)` is NOT consumed by the middle-build
  // anymore; it survives below in the RDP synthesis pass, which still uses
  // hostTree order to make the RDP section deterministic during initial-load.
  const middleRows: ConversationRow[] = [];
  const middleInsertionOrder = new WeakMap<ConversationRow, number>();
  let middlePushIndex = 0;
  for (const tab of conversationTabs) {
    if (emittedIds.has(tab.id)) continue; // already in Tier 1 or Tier 2
    if (!tab.host) continue; // defense-in-depth; isConversationTab already filtered
    const row = rowFromTab(tab, sessionRoleByKey);
    middleRows.push(row);
    middleInsertionOrder.set(row, middlePushIndex++);
  }
  for (const { row } of fleetSyntheticRows) {
    if (emittedIds.has(row.id)) continue; // already in Tier 1 or Tier 2
    middleRows.push(row);
    middleInsertionOrder.set(row, middlePushIndex++);
  }
  middleRows.sort(compareByRecencyDesc(middleInsertionOrder));
  // Consume the fleet hostName fallback + host-tree order to keep the
  // ESLint no-unused-vars / TypeScript unused-symbol linters quiet — both
  // survived the retirement for downstream consumers (RDP synthesis below
  // reads orderedHosts). fleetHostNameFallback is now inert for the middle
  // path but still populated by the fleetSyntheticRows loop above; retire
  // its middle-side consumption by referencing it as an intentional no-op
  // read to avoid a variable-cleanup churn diff.
  void fleetHostNameFallback;
  const orderedHosts = collectHostOrder(state.hostTree);

  // Plan 07-02 (TG-15): synthesize RDP-host rows from state.hostsFlat filtered
  // on strict `enableRdp === true` (T-07-02-01 mitigation — undefined on
  // legacy Host records must NOT emit a row). Placed in a SENTINEL HostGroup
  // (`hostId: "__rdp__"`, `hostName: ""`) emitted as `rdpGroup` at the BOTTOM
  // of the ConversationsPanel scroller per shape-file "one row per RDP-enabled
  // host at the bottom of the list." Phase 41 retired the `grouped: HostGroup[]`
  // shape; RDP now emits as a standalone field `rdpGroup: HostGroup | null`.
  //
  // ConversationsPanel special-cases `hostId === "__rdp__"` to suppress the
  // semibold host-header render (see NOTE-A in 07-PLAN-CHECK.md) — otherwise
  // an empty header would render above the RDP rows. Rendering the rows with
  // a monitor icon + host name (no identity hue, no avatar, no host secondary
  // line) is the panel's responsibility; the store only supplies the shape.
  //
  // Ordering: iterate the hostTree walk order first (so RDP rows for hosts
  // present in the tree follow the same top-to-bottom order as their
  // identity-tmux groups above), then any RDP-eligible hosts NOT in the
  // tree (orphan — host record exists in hostsFlat but the tree hasn't seen
  // it yet, mirroring the fallback path above). This makes the RDP section
  // deterministic even during initial-load races.
  //
  // Row shape: id `rdp-host::${host.id}` (deterministic per host — a fleet
  // fact, not tied to any tab-lifecycle counter), type "rdp", label
  // `host.name`, host: resolvedHost, targetTmuxSession: null, rdpHostRow: true.
  //
  // RDP rows are NEVER considered for Tier 1 or Tier 2: activeSet excludes
  // them per patch #137 contract, and the tier loops above only iterate
  // conversationTabs + fleetSyntheticRows. rdpRows is a separate synthesized
  // list that never joins those sets.
  const rdpRows: ConversationRow[] = [];
  const rdpEmittedHostIds = new Set<number>();
  // Hosts in hostTree order first
  for (const { id } of orderedHosts) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) continue;
    const host = state.hostsFlat.get(numericId);
    if (!host) continue;
    if (host.enableRdp !== true) continue; // strict check per T-07-02-01
    {
      const rdpRowId = `rdp-host::${host.id}`;
      const lastMessageAt = resolveLastMessageAt(rdpRowId, host, null);
      rdpRows.push({
        id: rdpRowId,
        type: "rdp",
        label: host.name,
        host,
        targetTmuxSession: null,
        rdpHostRow: true,
        ...(lastMessageAt !== null ? { lastMessageAt } : {}),
      });
    }
    rdpEmittedHostIds.add(numericId);
  }
  // Orphan RDP hosts (in hostsFlat but not in hostTree) — appended after.
  // Uses hostsFlat's Map iteration order (insertion order in JS Maps).
  for (const [numericId, host] of state.hostsFlat) {
    if (rdpEmittedHostIds.has(numericId)) continue;
    if (host.enableRdp !== true) continue;
    const rdpRowId = `rdp-host::${host.id}`;
    const lastMessageAt = resolveLastMessageAt(rdpRowId, host, null);
    rdpRows.push({
      id: rdpRowId,
      type: "rdp",
      label: host.name,
      host,
      targetTmuxSession: null,
      rdpHostRow: true,
      ...(lastMessageAt !== null ? { lastMessageAt } : {}),
    });
  }
  rdpRows.sort(compareByHostRoleLabel);
  // Phase 41 (Plan 01): rdpGroup is `null` iff zero RDP-eligible hosts exist.
  // This preserves the pre-Phase-41 store-level gate at L632 verbatim (Ashley
  // lock #7 — no empty RDP header renders when no RDP hosts).
  const rdpGroup: HostGroup | null =
    rdpRows.length > 0
      ? { hostId: "__rdp__", hostName: "", rows: rdpRows }
      : null;

  // quick-260731-tgg (updated Phase 41 Plan 01): final render-time filter —
  // remove hiddenIds from activeSet, pinned, AND the flat middle zone.
  // Applied AFTER all tier logic so it acts as a pure removal pass. Hidden
  // rows are still in openTabs/fleetSessions; they simply don't surface in
  // the visible tiers.
  //
  // RDP rows (synthesized into rdpGroup) are NOT eligible for hiding — their
  // id shape (rdp-host::${host.id}) never appears in hiddenIds (the hide
  // affordance is suppressed for RDP rows at the row level). This is inert
  // behavior; the guard isn't needed in practice but the exemption is
  // documented for future maintainers.
  if (state.hiddenIds.size > 0) {
    const hiddenIds = state.hiddenIds;
    const filteredActiveSet = activeSetRows.filter((r) => !hiddenIds.has(r.id));
    const filteredPinned = pinned.filter((r) => !hiddenIds.has(r.id));
    const filteredMiddle = middleRows.filter((r) => !hiddenIds.has(r.id));
    return {
      activeSet: filteredActiveSet,
      pinned: filteredPinned,
      middle: filteredMiddle,
      rdpGroup,
    };
  }

  return { activeSet: activeSetRows, pinned, middle: middleRows, rdpGroup };
}

function getSnapshot(): ConversationList {
  if (cachedSnapshot !== null && cachedSnapshotVersion === snapshotVersion) {
    return cachedSnapshot;
  }
  cachedSnapshot = computeSnapshot();
  cachedSnapshotVersion = snapshotVersion;
  return cachedSnapshot;
}

// ─── Actions (public API) ────────────────────────────────────────────────────

export function updateHostTree(tree: HostFolder | null): void {
  if (tree === state.hostTree) return; // reference-equal no-op
  state = { ...state, hostTree: tree };
  notify();
}

export function updateOpenTabs(tabs: Tab[]): void {
  // Reference-equal AND same-length no-op check for the hot path (identical
  // ref array from React unchanged prev). We can't compare tab-by-tab cheaply,
  // but reference equality catches the common batched-no-op case.
  if (tabs === state.openTabs) return;

  const nextIds = new Set<string>();
  for (const t of tabs) nextIds.add(t.id);

  // Patch #150 A: prune pinned ids that are neither open tabs NOR fleet-derived.
  // Post-#149 A (cf624a4) `pinConversation` accepts any id, including fleet
  // synthetic ids from `fleetRowId(hostId, sessionName)` — so `pinnedIds` now
  // legitimately holds a union of openTab ids and fleet ids. The pre-#150
  // pruner only considered openTabs membership, which silently nuked every
  // pinned fleet row the instant `updateOpenTabs` fired (Ashley's followup-1:
  // "pin 4-5 fleet rows → single click destroys all pins"). The keep-set is
  // now the union `nextIds ∪ fleetPinKeepSet`; ids belonging to neither
  // (stale openTab pin after session-end, or fleet id after the session left
  // fleetSessions) are still dropped as they were pre-#150. Regression tests:
  //   - "clicking a pinned fleet row does NOT unpin OTHER pinned fleet rows"
  //   - "clicking an openTab row still prunes stale openTab pins as before"
  // (both in the "pruner fleet-aware (patch #150 A)" describe block).
  //
  // Micro-guard: only pay the O(fleetSessions) fleetPinKeepSet build cost on
  // the uncommon pinnedIds-non-empty path — the empty-pinned hot path (fresh
  // page load, every tab reconciliation before Ashley pins anything) stays
  // exactly as fast as pre-#150.
  let fleetPinKeepSet: Set<string> | null = null;
  if (state.pinnedIds.size > 0) {
    fleetPinKeepSet = new Set<string>();
    for (const session of state.fleetSessions) {
      fleetPinKeepSet.add(fleetRowId(session.hostId, session.sessionName));
    }
  }

  // Prune pinned ids that no longer correspond to any open tab OR fleet session
  let nextPinnedIds = state.pinnedIds;
  let pinnedChanged = false;
  for (const id of state.pinnedIds) {
    if (!nextIds.has(id) && !(fleetPinKeepSet && fleetPinKeepSet.has(id))) {
      if (!pinnedChanged) {
        nextPinnedIds = new Set(state.pinnedIds);
        pinnedChanged = true;
      }
      nextPinnedIds.delete(id);
    }
  }

  // Coerce selection if it points at a tab that no longer exists
  let nextSelectedId = state.selectedId;
  if (nextSelectedId !== null && !nextIds.has(nextSelectedId)) {
    nextSelectedId = null;
  }

  // Plan 06-04 race defense (T-06-04-04): if a pending deferred-select id
  // has arrived in the new tabs, promote it into selectedId and clear the
  // pending slot. Runs AFTER the stale-selection coercion so a pending
  // arrival takes precedence over a coerced-to-null selection on the same
  // tick (e.g. the previously-selected tab closed AND the new tab arrived
  // in the same setTabs commit). Runs BEFORE the no-op short-circuit so a
  // same-array re-emission that happens to satisfy the pending id still
  // fires — updateOpenTabs is the flush point.
  if (pendingSelectId !== null && nextIds.has(pendingSelectId)) {
    nextSelectedId = pendingSelectId;
    pendingSelectId = null;
  }

  // Was there a REAL change? We already know tabs !== state.openTabs by ref,
  // but the array MAY be a re-emission with the same contents. Check length
  // + shallow per-element ref equality; if identical, treat as no-op.
  let tabsChanged = tabs.length !== state.openTabs.length;
  if (!tabsChanged) {
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i] !== state.openTabs[i]) {
        tabsChanged = true;
        break;
      }
    }
  }

  if (
    !tabsChanged &&
    !pinnedChanged &&
    nextSelectedId === state.selectedId
  ) {
    return; // full no-op — do not bump snapshotVersion
  }

  state = {
    ...state,
    openTabs: tabs,
    pinnedIds: nextPinnedIds,
    selectedId: nextSelectedId,
  };
  notify();
}

// Plan 07-01 (TG-12, TG-17): fleet-discovery snapshot input. AppShell calls
// this ONCE per page-load after getSessionList() resolves. No polling — the
// hard shape lock (see 07-CONTEXT.md §Scope Fence item #2) forbids any
// interval/focus/visibility refetch that would produce visible list
// mutations after page-load. Cross-device staleness is deliberately
// acceptable; Ashley refreshes to update.
//
// Same reference-equality + per-element ref no-op story as updateHostTree /
// updateOpenTabs — a fresh array from a fresh fetch that happens to be
// content-equal to the last one still fires (we do NOT deep-equal; the
// polling-thrash-guard lives upstream at the AppShell memoization layer).
// Test 27 asserts both the ref-equal no-op and the different-ref-same-
// content DOES-fire semantics.
export function updateFleetSessions(sessions: FleetSession[]): void {
  // quick-260727-kbw: compute shallow no-op WITHOUT early-return — the
  // fleetSessionsLoaded flag transition (false→true) can force a notify()
  // even when the sessions array itself is a shallow no-op. The first call
  // to updateFleetSessions ALWAYS transitions the flag (starts false), so
  // the very first call must always notify() even if the caller happens to
  // pass an empty [] or a same-content array.
  const sessionsRefEqual = sessions === state.fleetSessions;
  let sessionsShallowEqual = sessionsRefEqual;
  if (!sessionsRefEqual && sessions.length === state.fleetSessions.length) {
    let allSame = true;
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i] !== state.fleetSessions[i]) {
        allSame = false;
        break;
      }
    }
    if (allSame) sessionsShallowEqual = true;
  }
  const needsFlagFlip = !state.fleetSessionsLoaded;

  // Full no-op path: sessions are a shallow no-op AND the flag is already
  // true. Nothing has changed — do NOT bump snapshotVersion.
  if (sessionsShallowEqual && !needsFlagFlip) return;

  // Real mutation. Reuse the current sessions ref when the incoming array
  // is a shallow no-op (avoids gratuitously bumping downstream reference
  // equality checks on state.fleetSessions consumers). Always set the flag
  // to true — this is unconditional per quick-260727-kbw.
  const nextSessions = sessionsShallowEqual ? state.fleetSessions : sessions;
  state = {
    ...state,
    fleetSessions: nextSessions,
    fleetSessionsLoaded: true,
  };
  notify();
}

/**
 * Surgically remove one FleetSession from state (by hostId + sessionName)
 * AND trim it out of the localStorage cache so a page reload does not briefly
 * re-show the row from stale cache before the next getSessionList() resolves.
 *
 * Idempotent no-op when the (hostId, sessionName) tuple is not present in
 * state.fleetSessions — same shape as updateFleetSessions' same-content
 * short-circuit (skip notify(), skip cache write).
 *
 * Used by AppShell.onKillRow (quick-260810-oig) after a successful tmux
 * kill-session so the fleet-synthetic row disappears immediately without
 * waiting for a page reload. Companion to closeTab, which only removes
 * openTabs-derived rows; non-identity throwaway rows are fleet-synthetic and
 * closeTab is a no-op for them.
 */
export function removeFleetSession(hostId: number, sessionName: string): void {
  const nextFleetSessions = state.fleetSessions.filter(
    (s) => !(s.hostId === hostId && s.sessionName === sessionName),
  );
  // No-op path: tuple was not present — no state mutation, no cache write, no notify.
  if (nextFleetSessions.length === state.fleetSessions.length) return;

  state = { ...state, fleetSessions: nextFleetSessions };
  notify();

  // Cache trim. Silent on write failure — mirrors writeFleetSessionsCache's
  // own failure policy. Do NOT block or unwind the in-memory update if the
  // cache write throws (localStorage quota, disabled storage, private mode).
  try {
    writeFleetSessionsCache(nextFleetSessions);
  } catch {
    // Silent — cache-write failure is non-fatal; next getSessionList() fetch
    // on the next page load will re-persist the fresh (post-kill) snapshot.
  }
}

// ─── FleetSession localStorage cache (quick-260805-tub) ──────────────────────
// Persist the fleet snapshot across page refreshes so the first paint after a
// reload shows the last-known conversation-list row set instead of an empty
// list for the ~200ms it takes getSessionList() to return. Row EXISTENCE only
// — activeSet, WIP, pin state, hostTree are still live-derived and NOT cached
// (Ashley 2026-08-05).
//
// Versioned key so a shape change to FleetSession can invalidate every
// client's cache in one deploy just by bumping the suffix.
const FLEET_CACHE_KEY = "skynet:convo-fleet-cache:v1";

function isFleetSession(x: unknown): x is FleetSession {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.hostId === "number" &&
    typeof r.hostName === "string" &&
    typeof r.sessionName === "string" &&
    typeof r.created === "number" &&
    (r.role === null || typeof r.role === "string")
  );
}

/**
 * Read the cached fleet snapshot from localStorage. Returns `[]` on any
 * failure mode (missing key, malformed JSON, non-array top level, elements
 * that don't match FleetSession shape) — the caller treats an empty cache
 * identically to a cold start, so the store's Phase 6 openTabs-only fallback
 * still handles it.
 *
 * Silent by contract: no throws, no console noise, no toasts.
 */
export function readFleetSessionsCache(): FleetSession[] {
  try {
    const raw = typeof localStorage !== "undefined"
      ? localStorage.getItem(FLEET_CACHE_KEY)
      : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: FleetSession[] = [];
    for (const item of parsed) {
      if (isFleetSession(item)) {
        // Defensive filter: only the canonical fields make it back into
        // memory even if a future writer accidentally serialized more.
        valid.push({
          hostId: item.hostId,
          hostName: item.hostName,
          sessionName: item.sessionName,
          created: item.created,
          role: item.role,
        });
      }
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Write the fleet snapshot to localStorage. Overwrites; no TTL, no merge.
 * Silent on any storage error (QuotaExceededError, disabled storage,
 * private-mode failures) — losing the cache is not a user-visible failure.
 *
 * Serializes only the 4 canonical `FleetSession` fields so future field
 * additions on FleetSession don't silently leak to storage.
 */
export function writeFleetSessionsCache(sessions: FleetSession[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const canonical = sessions.map((s) => ({
      hostId: s.hostId,
      hostName: s.hostName,
      sessionName: s.sessionName,
      created: s.created,
      role: s.role,
    }));
    localStorage.setItem(FLEET_CACHE_KEY, JSON.stringify(canonical));
  } catch {
    // Silent — cache-write failure is non-fatal.
  }
}

// Plan 07-01 (TG-14): hostId → Host flat lookup. AppShell maintains a memo
// keyed on stableHostTreeKey (the NOTE-05 thrash-guard from Phase 6) and
// pushes the Map here whenever the memo re-derives.
//
// hostsFlat feeds two rendering paths:
//   1. This plan: synthetic fleet-row Host enrichment inside computeSnapshot
//      so the detached-row-click handler at AppShell has a real Host object
//      to hand to openTab(host, "terminal", ...).
//   2. Plan 07-02 (RDP rows at bottom): iterate hostsFlat, filter on strict
//      `host.enableRdp === true`, emit one row per matching host at the end
//      of `grouped`.
//
// Because both paths consume hostsFlat via computeSnapshot(), any change
// MUST bump snapshotVersion. Same ref-equality no-op story as the other
// inputs; Test 29 asserts same-ref no-op and different-Map-same-content
// DOES fire.
export function updateHostsFlat(hostsById: Map<number, Host>): void {
  if (hostsById === state.hostsFlat) return; // reference-equal no-op
  state = { ...state, hostsFlat: hostsById };
  notify();
}

// Phase 25 (Plan 25-02): plumb identity.role onto ConversationRow at row-construction
// time for the (host, role, label) sort comparator (compareByHostRoleLabel).
// Mirrors the hostsFlat pattern: AppShell drives the Map here on identity-store change
// via a useEffect; computeSnapshot reads from state.identitiesByKey directly inside
// rowFromTab() and fleetSyntheticRows construction.
// Reference-equal no-op guard: if byKey is the same Map reference that was previously
// pushed in (identities-store rebuilds byKey on setIdentities — same ref = no change),
// skip the snapshot invalidation.
export function updateIdentitiesByKey(byKey: Map<string, Identity>): void {
  if (byKey === state.identitiesByKey) return; // reference-equal no-op
  state = { ...state, identitiesByKey: byKey };
  notify();
}

export function selectConversation(id: string | null): void {
  // T-06-01-01 stale-id guard runs FIRST — a select of a nonexistent id
  // must NOT clear pendingSelectId (a stale call shouldn't cancel an
  // in-flight deferred select).
  if (id !== null) {
    let found = false;
    for (const t of state.openTabs) {
      if (t.id === id) {
        found = true;
        break;
      }
    }
    if (!found) return; // silent no-op
  }
  // Plan 06-04 NOTE-03 re-decision: clear pendingSelectId AFTER the stale
  // guard has passed but BEFORE the "no change" short-circuit — so a direct
  // selectConversation(id) call ALWAYS cancels an in-flight deferred select,
  // even when the id being selected is the id we're already on. Otherwise a
  // same-id call would leak a stale pending id past its owner's intent.
  pendingSelectId = null;
  // Patch #137: every non-null selection is an active-set engagement signal —
  // record it BEFORE the same-selectedId short-circuit so a re-select of the
  // currently-selected id still counts as engagement. addToActiveSet is
  // idempotent so this is a cheap no-op when the id is already present.
  // Deselect (id === null) does NOT touch activeSet — deselecting is not
  // positive engagement.
  if (id !== null) addToActiveSet(id);
  if (id === state.selectedId) return; // no-op — already selected
  state = { ...state, selectedId: id };
  notify();
}

// Plan 06-04 (T-06-04-04): defends against the openTab-setTabs / immediate-
// select race. If the id is already in openTabs, this behaves exactly like
// selectConversation(id). Otherwise the id is parked in pendingSelectId; the
// next updateOpenTabs(tabs) that includes it flushes selection to it.
// Last-write-wins on repeated deferred calls before the flush.
export function selectConversationDeferred(id: string): void {
  for (const t of state.openTabs) {
    if (t.id === id) {
      // Already present — this is not really "deferred"; delegate to the
      // direct path (which clears pending as a side effect per re-decision).
      selectConversation(id);
      return;
    }
  }
  pendingSelectId = id;
  // Deliberately NO notify() here — nothing user-visible has changed. The
  // flush emit happens inside updateOpenTabs when the id arrives.
}

// Patch #137: activeSet mutator. Idempotent no-op when the id is already
// present (avoids gratuitous sessionStorage writes on repeat selects).
// Silent try/catch on sessionStorage so SSR/JSDOM/quota-exceeded errors
// never crash the UI thread — an in-memory update still fires and notify()
// still runs so the UI stays functional for the current session even if
// persistence fails.
export function addToActiveSet(id: string): void {
  if (state.activeSet.has(id)) return;
  const nextActiveSet = new Set(state.activeSet);
  nextActiveSet.add(id);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        ACTIVE_SET_STORAGE_KEY,
        JSON.stringify([...nextActiveSet]),
      );
    }
  } catch {
    // Silent — do not block state update on storage failure.
  }
  state = { ...state, activeSet: nextActiveSet };
  notify();
}

// quick-260727-gm3: activeSet reverse-mutator. Idempotent no-op when the id is
// absent (avoids gratuitous sessionStorage writes on repeat deactivate clicks).
// Silent try/catch on sessionStorage so SSR/JSDOM/quota-exceeded errors never
// crash the UI thread — an in-memory update still fires and notify() still
// runs so the UI stays functional for the current session even if persistence
// fails. Deliberately does NOT touch state.selectedId — deactivation is
// orthogonal to selection at the store layer; the panel wires closeTab
// separately (see PrettyConversationsPanel.handleRowDeactivate + AppShell's
// onDeactivateRow → closeTab bridge). Ashley 2026-07-27: agent keeps running
// under the hood; tapping the row again reactivates it.
export function removeFromActiveSet(id: string): void {
  if (!state.activeSet.has(id)) return;
  const nextActiveSet = new Set(state.activeSet);
  nextActiveSet.delete(id);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        ACTIVE_SET_STORAGE_KEY,
        JSON.stringify([...nextActiveSet]),
      );
    }
  } catch {
    // Silent — mirrors addToActiveSet's storage-failure policy.
  }
  state = { ...state, activeSet: nextActiveSet };
  notify();
}

export function pinConversation(id: string): void {
  if (state.pinnedIds.has(id)) return; // already pinned — no-op
  // Patch #149 (A): the pre-#149 defense-in-depth guard rejected any id
  // not present in state.openTabs, which silently no-op'd pin clicks on
  // every fleet-derived row (~26 of 32 in Ashley's normal panel). Mock v4
  // treats all non-RDP rows uniformly — the row-level render only excludes
  // RDP rows from the pin affordance, so any id that reaches this function
  // is legitimately pinnable. An orphaned pin id (session gone) is inert:
  // computeSnapshot's pinned-section iteration skips ids without a matching
  // row source, so no render damage.
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.add(id);
  // Phase 15: fire-and-forget server write. Failures leave the optimistic
  // pin in place; the next pin/unpin OR next panel mount reconciles from
  // server. Mirrors addToActiveSet's silent-catch pattern at L713-722.
  try {
    void putPinnedIds([...nextPinnedIds]);
  } catch {
    // Silent — do not block state update on network failure.
    // Optimistic update stands; retry on next mount or next pin/unpin.
  }
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}

export function unpinConversation(id: string): void {
  if (!state.pinnedIds.has(id)) return; // not pinned — no-op
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.delete(id);
  // Phase 15: fire-and-forget server write. Failures leave the optimistic
  // unpin in place; the next pin/unpin OR next panel mount reconciles from
  // server. Mirrors addToActiveSet's silent-catch pattern at L713-722.
  try {
    void putPinnedIds([...nextPinnedIds]);
  } catch {
    // Silent — do not block state update on network failure.
    // Optimistic update stands; retry on next mount or next pin/unpin.
  }
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}

export function togglePinConversation(id: string): void {
  if (state.pinnedIds.has(id)) unpinConversation(id);
  else pinConversation(id);
}

// quick-260731-tgg: hide/unhide/toggle mutators. Fire-and-forget server write,
// same pattern as pin/unpin above. hiddenIds are intentionally sticky across
// openTab churn (unlike pinnedIds which get pruned in updateOpenTabs) — Ashley
// may want to keep a stale hidden id so it re-hides if the session reappears.
export function hideConversation(id: string): void {
  if (state.hiddenIds.has(id)) return; // already hidden — no-op
  const nextHiddenIds = new Set(state.hiddenIds);
  nextHiddenIds.add(id);
  try {
    void putHiddenIds([...nextHiddenIds]);
  } catch {
    // Silent — do not block state update on network failure.
  }
  state = { ...state, hiddenIds: nextHiddenIds };
  notify();
}

export function unhideConversation(id: string): void {
  if (!state.hiddenIds.has(id)) return; // not hidden — no-op
  const nextHiddenIds = new Set(state.hiddenIds);
  nextHiddenIds.delete(id);
  try {
    void putHiddenIds([...nextHiddenIds]);
  } catch {
    // Silent — do not block state update on network failure.
  }
  state = { ...state, hiddenIds: nextHiddenIds };
  notify();
}

export function toggleHideConversation(id: string): void {
  if (state.hiddenIds.has(id)) unhideConversation(id);
  else hideConversation(id);
}

// quick-260731-tgg: server-authoritative reconciliation for hiddenIds.
// Called by PrettyConversationsPanel's mount effect after a successful
// GET /user-preferences fetch. Same-content guard mirrors hydratePinnedIdsFromServer.
export function hydrateHiddenIdsFromServer(ids: string[]): void {
  const nextHiddenIds = new Set(ids);
  if (nextHiddenIds.size === state.hiddenIds.size) {
    let allSame = true;
    for (const id of nextHiddenIds) {
      if (!state.hiddenIds.has(id)) {
        allSame = false;
        break;
      }
    }
    if (allSame) return;
  }
  state = { ...state, hiddenIds: nextHiddenIds };
  notify();
}

// Phase 15: server-authoritative reconciliation. Called by PrettyConversations
// Panel's mount effect after a successful GET /user-preferences fetch.
// Replaces state.pinnedIds with the fetched set; drops any stale in-memory pins
// the server doesn't know about. Same-content guard mirrors updateFleetSessions
// at L611-625 — skip notify() when the incoming set matches the current set to
// avoid gratuitous re-renders on identical refetches.
export function hydratePinnedIdsFromServer(ids: string[]): void {
  const nextPinnedIds = new Set(ids);
  if (nextPinnedIds.size === state.pinnedIds.size) {
    let allSame = true;
    for (const id of nextPinnedIds) {
      if (!state.pinnedIds.has(id)) {
        allSame = false;
        break;
      }
    }
    if (allSame) return;
  }
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}

// ─── React hooks ─────────────────────────────────────────────────────────────

export function useConversations(): ConversationList {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// The selected-id snapshot is just the state.selectedId value; useSyncExternal
// -Store compares by Object.is, so returning a primitive is safe and stable.
function getSelectedIdSnapshot(): string | null {
  return state.selectedId;
}
export function useSelectedConversationId(): string | null {
  return useSyncExternalStore(
    subscribe,
    getSelectedIdSnapshot,
    getSelectedIdSnapshot,
  );
}

// Return the current pinnedIds Set. React compares by Object.is; because we
// build a new Set on every pin/unpin (see actions above), the identity flips
// on every real change → consumers re-render, and stays stable across no-ops.
function getPinnedIdsSnapshot(): ReadonlySet<string> {
  return state.pinnedIds;
}
export function usePinnedIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    getPinnedIdsSnapshot,
    getPinnedIdsSnapshot,
  );
}

// quick-260731-tgg: hiddenIds subscription. Mirrors usePinnedIds semantics —
// a new Set reference on every real mutation, stable reference across no-ops.
function getHiddenIdsSnapshot(): ReadonlySet<string> {
  return state.hiddenIds;
}
export function useHiddenIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    getHiddenIdsSnapshot,
    getHiddenIdsSnapshot,
  );
}

// quick-260727-kbw: fleet-loaded gate for the panel's mount-effect
// getPinnedIds fetch. The panel MUST NOT hydrate pinnedIds until
// state.fleetSessions has been populated at least once — otherwise the
// next background updateOpenTabs fires the pinnedIds pruner with an empty
// fleetPinKeepSet (built from state.fleetSessions inside updateOpenTabs)
// and nukes freshly-hydrated fleet pins. Primitive boolean is Object.is-
// safe; no memoization needed. Panel subscribes via useSyncExternalStore
// so the false→true flip triggers a re-render → mount effect body runs
// → hydration fetch begins. See PrettyConversationsPanel.tsx §(d) for
// the mirrored comment on the panel side.
function getFleetSessionsLoadedSnapshot(): boolean {
  return state.fleetSessionsLoaded;
}
export function useFleetSessionsLoaded(): boolean {
  return useSyncExternalStore(
    subscribe,
    getFleetSessionsLoadedSnapshot,
    getFleetSessionsLoadedSnapshot,
  );
}

// Patch #137: activeSet subscription. Mirrors usePinnedIds semantics — a new
// Set reference on every real mutation (see addToActiveSet), same reference
// across no-ops (idempotent second addToActiveSet(id) returns early without
// bumping snapshotVersion). Consumers get a stable ReadonlySet identity
// across renders that didn't touch activeSet.
function getActiveSetSnapshot(): ReadonlySet<string> {
  return state.activeSet;
}
export function useActiveSet(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    getActiveSetSnapshot,
    getActiveSetSnapshot,
  );
}

// ─── Test-only helpers ───────────────────────────────────────────────────────
// Underscore-prefixed exports for Vitest. NOT part of the public API — do not
// consume from production code. Kept exported (rather than gated on
// `import.meta.env.MODE === "test"`) because Vite's tree-shaker will drop
// them from the production bundle if no production code imports them.

export function __subscribeForTest(cb: () => void): () => void {
  return subscribe(cb);
}

export function __getSnapshotForTest(): SnapshotForTest {
  const list = getSnapshot();
  return {
    activeSet: list.activeSet,
    pinned: list.pinned,
    middle: list.middle,
    rdpGroup: list.rdpGroup,
    selectedId: state.selectedId,
    pinnedIds: state.pinnedIds,
    hiddenIds: state.hiddenIds,
  };
}

// Plan 06-04 Task 1: expose the module-scoped pendingSelectId slot so tests
// can assert the deferred-select semantics (set on absent id / cleared on
// arrival / cleared on direct selectConversation / last-write-wins).
export function __getPendingSelectIdForTest(): string | null {
  return pendingSelectId;
}

// Patch #137: reset the module-scoped activeSet to whatever
// hydrateActiveSetFromStorage returns for the current sessionStorage
// contents. Used by conversation-store.test.ts's beforeEach so a prior test's
// selectConversation-driven addToActiveSet write doesn't leak into later
// tests. Called AFTER sessionStorage.clear() so the resulting activeSet is
// empty; when a test wants to exercise the hydration path it can setItem +
// __resetActiveSetForTest to re-hydrate from the seeded storage.
export function __resetActiveSetForTest(): void {
  state = { ...state, activeSet: hydrateActiveSetFromStorage() };
  notify();
}

// Phase 15: reset the module-scoped pinnedIds set to empty. Used by
// conversation-store.test.ts's beforeEach so a prior test's
// pinConversation / unpinConversation writes don't leak forward.
export function __resetPinnedIdsForTest(): void {
  state = { ...state, pinnedIds: new Set<string>() };
  notify();
}

// quick-260731-tgg: reset the module-scoped hiddenIds set to empty. Mirrors
// __resetPinnedIdsForTest — used by tests' beforeEach to prevent leaks.
export function __resetHiddenIdsForTest(): void {
  state = { ...state, hiddenIds: new Set<string>() };
  notify();
}

// quick-260727-kbw: reset the module-scoped fleetSessionsLoaded flag to
// false + fleetSessions to []. Used by conversation-store.test.ts to
// exercise the false→true flip semantics of updateFleetSessions() from
// a known-clean starting point (beforeEach in that file otherwise fires
// updateFleetSessions([]) which — post-fix — flips the flag true, so
// tests that need to observe the flip subscribe AFTER this reset).
export function __resetFleetSessionsForTest(): void {
  state = { ...state, fleetSessions: [], fleetSessionsLoaded: false };
  notify();
}

// Phase 41 Plan 01: test-only setter for row.lastMessageAt. Populates the
// injection map that `rowFromTab` + the fleet-synthetic + RDP row builders
// read. Plan 03 will replace this with a real fleet-status wire-side signal;
// until then, tests seed known lastMessageAt values through this API to
// exercise the middle-zone recency comparator (compareByRecencyDesc).
//
// After calling this, callers must trigger a snapshot recompute (any real
// state mutation via updateOpenTabs / selectConversation / etc.) so the
// cached snapshot is invalidated and rowFromTab re-runs with the new values.
export function __setLastMessageAtForTest(rowId: string, ts: number | null): void {
  if (ts === null) {
    lastMessageAtByRowId.delete(rowId);
  } else {
    lastMessageAtByRowId.set(rowId, ts);
  }
  notify(); // invalidate cachedSnapshot so next getSnapshot() re-derives.
}

// Phase 41 Plan 01: reset the test-only lastMessageAt injection map. Used
// by tests' beforeEach so a prior test's stamps don't leak forward.
export function __resetLastMessageAtForTest(): void {
  lastMessageAtByRowId.clear();
  notify();
}

// Plan 07-01 Task 1 (updated Phase 41 Plan 01): expose all fleet-derived rows
// (across activeSet + pinned + middle + rdpGroup) for test assertions.
// `fleetOnly === true` rows are synthetic — they came from state.fleetSessions
// and did NOT dedup with any openTabs entry. rdpGroup rows carry
// `rdpHostRow: true` (not `fleetOnly`), so the rdpGroup iteration below is
// technically a no-op but preserved for completeness.
export function __getFleetOnlyRowsForTest(): ConversationRow[] {
  const list = getSnapshot();
  const out: ConversationRow[] = [];
  for (const r of list.activeSet) if (r.fleetOnly) out.push(r);
  for (const r of list.pinned) if (r.fleetOnly) out.push(r);
  for (const r of list.middle) if (r.fleetOnly) out.push(r);
  if (list.rdpGroup) {
    for (const r of list.rdpGroup.rows) if (r.fleetOnly) out.push(r);
  }
  return out;
}

// ─── Phase 41 Plan 03 — cross-store bridge to session-working-store ──────────
// The working-store owns the wire-side lastMessageAt cache; conversation-store
// reads it via getSessionLastMessageAt at row-derivation time. When the
// working-store publishes ANY change (isWorking flip OR lastMessageAt advance),
// bump conversation-store's notify() so its memoized snapshot invalidates and
// the next getSnapshot() re-derives with fresh recency values.
//
// This registration fires ONCE at module import — the returned disposer is
// intentionally discarded because both stores live for the browser session's
// lifetime. If the working-store ever adds selective per-key subscribes, we
// can tighten this to only fire on lastMessageAt changes; the current shape
// is fine because working-store already has a per-key no-op notify guard that
// suppresses spurious publishes (see publishFleetStatusSessionState).
subscribeSessionWorkingStore(() => {
  notify();
});
