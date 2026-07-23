// ─── Conversation store ──────────────────────────────────────────────────────
// Module-scoped store for the Telegram-style conversation list.
//
// Contract (per Phase 6, Plan 06-01, CONTEXT.md §Decisions §"The list"):
//   - Flat single-select list of currently-active sessions with a host.
//   - Order below pins = existing sidebar host-tree order (depth-first). No
//     new sort rule, no recency shuffle, no alphabetical override.
//   - Pins float above host-grouped rows. Per-session (not per-host). Session
//     end removes the row AND clears its pin in the same mutation (T-06-01-01
//     stale-selection defense also lives here — a selected id no longer in
//     openTabs is coerced to null).
//   - Persistence is in-memory only (module-scoped Map/Set +
//     React `useSyncExternalStore`). Nothing written to any browser storage
//     layer per TG-05 — a full page refresh resets the store.
//   - Tabs excluded from the conversation list: "dashboard", "host-manager",
//     "user-profile", "admin-settings", "tunnel", "network_graph". These are
//     singletons or non-conversation surfaces; the conversation list is
//     "sessions I'm talking to" (terminal / rdp / vnc / telnet / stats /
//     files / docker on a host).
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
};

export type HostGroup = {
  hostId: string;
  hostName: string;
  rows: ConversationRow[];
};

export type ConversationList = {
  pinned: ConversationRow[];
  grouped: HostGroup[];
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
};

type SnapshotForTest = ConversationList & {
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
};

// ─── Which tab types are "conversations" ─────────────────────────────────────
// A tab is a "conversation" iff it targets a host and represents a session-
// like remote surface. Everything else (dashboard, settings singletons,
// tunnel, network_graph) is excluded from the list.

const CONVERSATION_TAB_TYPES = new Set<TabType>([
  "terminal",
  "rdp",
  "vnc",
  "telnet",
  "files",
  "docker",
  "stats",
]);

// Patch #137: sessionStorage key for the activeSet persistence layer. Value is
// a JSON array of conversation ids; sessionStorage semantics = per-tab, dies
// on tab close. See hydrateActiveSetFromStorage() + addToActiveSet() below.
const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";

// Patch #137: rehydrate the activeSet from sessionStorage on module load.
// Wrapped in try/catch so malformed JSON, missing key, empty string, quota
// errors, or an absent sessionStorage (SSR/JSDOM edge) ALL silently fall
// back to an empty Set — a corrupt persistence layer must never crash the
// UI thread.
function hydrateActiveSetFromStorage(): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set<string>();
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
  selectedId: string | null;
  // Plan 07-01 (TG-12, TG-17): fleet-discovery snapshot input. Fed ONCE per
  // page-load by AppShell's mount effect (empty dep array useEffect). No
  // polling, no interval, no focus refetch. Absence = openTabs-only rendering
  // (Phase 6 baseline). Combined with openTabs via the union+dedup logic
  // inside computeSnapshot().
  fleetSessions: FleetSession[];
  // Plan 07-01 (TG-14): flat hostId → Host lookup so the click-a-detached-row
  // handler can resolve a fleet row (identified by numeric hostId +
  // sessionName) to a Host object openTab requires. Populated by AppShell's
  // hostsById memo (keyed on stableHostTreeKey — reuses the Phase 6 NOTE-05
  // thrash-guard). Used both for fleet-row Host enrichment during rendering
  // (see computeSnapshot) AND — pending Plan 07-02 — for RDP row derivation
  // filtered on `host.enableRdp === true`.
  hostsFlat: Map<number, Host>;
  // Patch #137: sessionStorage-backed set of conversation ids Ashley has
  // selected in this browser-tab session. Persisted under key
  // "pv-conv-active-set" as a JSON array. Rehydrated on module load; grows
  // only (no remove API); dies on tab close (sessionStorage semantics).
  // Feeds PrettyConversationRow's ambient-recession branch (rows NOT in
  // the set visually recede) and the ready-for-attention dot render
  // condition (dot renders iff inActiveSet && isWorking===false).
  activeSet: Set<string>;
};

let state: State = {
  hostTree: null,
  openTabs: [],
  pinnedIds: new Set<string>(),
  selectedId: null,
  fleetSessions: [],
  hostsFlat: new Map<number, Host>(),
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

function rowFromTab(tab: Tab): ConversationRow {
  return {
    id: tab.id,
    type: tab.type,
    label: tab.label,
    host: tab.host,
    targetTmuxSession: tab.targetTmuxSession ?? null,
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
function fleetRowId(hostId: number, sessionName: string): string {
  return `fleet::${hostId}::${sessionName}`;
}

function computeSnapshot(): ConversationList {
  const conversationTabs = state.openTabs.filter(isConversationTab);

  // Pinned rows first — iterate openTabs order and filter by pinnedIds.
  // pinnedIds is authoritative on "is this pinned?"; openTabs order gives
  // deterministic within-pinned ordering (see plan Task 1 Step 7 — no
  // drag-to-reorder, pin order = pin-creation-relative = openTabs order).
  // Plan 07-01: pins are ONLY from openTabs (fleet-only rows CANNOT be
  // pinned — the existing pinConversation guard at lines below rejects any
  // id not in openTabs, and fleet ids never appear in openTabs; Test 30
  // asserts this defense-in-depth).
  const pinned: ConversationRow[] = [];
  for (const tab of conversationTabs) {
    if (state.pinnedIds.has(tab.id)) pinned.push(rowFromTab(tab));
  }

  // Grouped rows below — bucket non-pinned tabs by host id, then emit in
  // host-tree order. Hosts with zero non-pinned rows are skipped so the
  // panel doesn't render empty group headers.
  const byHostId = new Map<string, ConversationRow[]>();
  // Plan 07-01: build the openTabs session-identity set for dedup. For each
  // conversation tab that has (host, targetTmuxSession) both defined, add
  // `dedupKey(String(parseInt(host.id)), targetTmuxSession)` — normalizing
  // the string Host.id to numeric string aligns with FleetSession.hostId
  // (a raw JS number) after `String(hostId)`. Matches SessionsPanel.tsx:47's
  // `parseInt(h.id)` precedent verbatim. A null/empty targetTmuxSession tab
  // does NOT enter the dedup set (Test 26): its identity is "attached to
  // hostA without a known session", which is not the same as any named
  // fleet session on hostA.
  const openTabsSessionKeys = new Set<string>();
  for (const tab of conversationTabs) {
    if (state.pinnedIds.has(tab.id)) continue; // already in pinned
    if (!tab.host) continue; // defense-in-depth; isConversationTab already filtered
    const bucket = byHostId.get(tab.host.id);
    if (bucket) bucket.push(rowFromTab(tab));
    else byHostId.set(tab.host.id, [rowFromTab(tab)]);

    const tmux = tab.targetTmuxSession;
    if (tmux !== null && tmux !== "") {
      openTabsSessionKeys.add(dedupKey(String(parseInt(tab.host.id)), tmux));
    }
  }

  // Plan 07-01: emit fleet-derived synthetic rows for every FleetSession
  // whose (hostId, sessionName) identity is NOT already represented in
  // openTabs (openTabs-entry-wins per hard_constraint #7). Bucketed by
  // hostId (as a string, matching the byHostId map's key type) so fleet
  // rows for a host that ALSO has openTabs rows land in the SAME HostGroup
  // (append order — openTabs first, fleet-only after).
  //
  // Host resolution for synthetic rows: prefer state.hostsFlat.get(hostId)
  // (a real Host object with all fields — enableRdp, terminalConfig, etc.)
  // so the detached-row-click handler at AppShell can invoke openTab(host)
  // with everything it needs. Fall back to `undefined` (no Host object)
  // when hostsFlat has not yet populated — Test 28 covers this race.
  //
  // Also collect a per-fleet-hostId hostName fallback so the HostGroup
  // header can render even when the host is absent from state.hostTree
  // AND state.hostsFlat (initial-load race — Test 28).
  const fleetHostNameFallback = new Map<string, string>();
  for (const session of state.fleetSessions) {
    const hostIdStr = String(session.hostId);
    const key = dedupKey(hostIdStr, session.sessionName);
    if (openTabsSessionKeys.has(key)) continue; // openTabs-entry-wins
    const resolvedHost = state.hostsFlat.get(session.hostId);
    const syntheticRow: ConversationRow = {
      id: fleetRowId(session.hostId, session.sessionName),
      type: "terminal",
      label: session.sessionName,
      host: resolvedHost,
      targetTmuxSession: session.sessionName,
      fleetOnly: true,
    };
    const bucket = byHostId.get(hostIdStr);
    if (bucket) bucket.push(syntheticRow);
    else byHostId.set(hostIdStr, [syntheticRow]);
    if (!fleetHostNameFallback.has(hostIdStr)) {
      fleetHostNameFallback.set(hostIdStr, session.hostName);
    }
  }

  const grouped: HostGroup[] = [];
  const orderedHosts = collectHostOrder(state.hostTree);
  const seenHostIds = new Set<string>();
  for (const { id, name } of orderedHosts) {
    seenHostIds.add(id);
    const rows = byHostId.get(id);
    if (rows && rows.length > 0) {
      grouped.push({ hostId: id, hostName: name, rows });
    }
  }
  // Fallback: any conversation tab whose host is NOT in the current hostTree
  // (host was deleted server-side but the tab is still open, OR the hostTree
  // hasn't loaded yet) should still surface in a synthetic per-host bucket
  // so the row doesn't disappear. Emit them in openTabs order after the
  // known-tree hosts. This is a resilience choice, not a scope-widening —
  // Ashley's box has ~20 sessions on ~10 hosts; a missing host in the tree
  // must not cause silent row loss (T-06-01-01 stale-selection defense's
  // sibling: don't silently drop derived rows either).
  //
  // Plan 07-01: same resilience extended to fleet-only hosts. When a
  // FleetSession's host is absent from hostTree, prefer state.hostsFlat's
  // Host.name (matches an id-tree walk that succeeded), then the fleet's
  // own hostName (matches an initial-load race where hostsFlat is empty),
  // then finally the raw hostId as a last-resort label so nothing renders
  // as "undefined" chrome.
  for (const [hostId, rows] of byHostId) {
    if (seenHostIds.has(hostId)) continue;
    if (rows.length === 0) continue;
    const firstRow = rows[0];
    const hostName =
      firstRow.host?.name ??
      fleetHostNameFallback.get(hostId) ??
      hostId;
    grouped.push({ hostId, hostName, rows });
  }

  // Plan 07-02 (TG-15): synthesize RDP-host rows from state.hostsFlat filtered
  // on strict `enableRdp === true` (T-07-02-01 mitigation — undefined on
  // legacy Host records must NOT emit a row). Placed in a SENTINEL HostGroup
  // (`hostId: "__rdp__"`, `hostName: ""`) appended at the END of `grouped`
  // so they always render at the BOTTOM of the ConversationsPanel scroller
  // per shape-file "one row per RDP-enabled host at the bottom of the list."
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
  const rdpRows: ConversationRow[] = [];
  const rdpEmittedHostIds = new Set<number>();
  // Hosts in hostTree order first
  for (const { id } of orderedHosts) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) continue;
    const host = state.hostsFlat.get(numericId);
    if (!host) continue;
    if (host.enableRdp !== true) continue; // strict check per T-07-02-01
    rdpRows.push({
      id: `rdp-host::${host.id}`,
      type: "rdp",
      label: host.name,
      host,
      targetTmuxSession: null,
      rdpHostRow: true,
    });
    rdpEmittedHostIds.add(numericId);
  }
  // Orphan RDP hosts (in hostsFlat but not in hostTree) — appended after.
  // Uses hostsFlat's Map iteration order (insertion order in JS Maps).
  for (const [numericId, host] of state.hostsFlat) {
    if (rdpEmittedHostIds.has(numericId)) continue;
    if (host.enableRdp !== true) continue;
    rdpRows.push({
      id: `rdp-host::${host.id}`,
      type: "rdp",
      label: host.name,
      host,
      targetTmuxSession: null,
      rdpHostRow: true,
    });
  }
  if (rdpRows.length > 0) {
    grouped.push({ hostId: "__rdp__", hostName: "", rows: rdpRows });
  }

  return { pinned, grouped };
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

  // Prune pinned ids that no longer correspond to any open tab
  let nextPinnedIds = state.pinnedIds;
  let pinnedChanged = false;
  for (const id of state.pinnedIds) {
    if (!nextIds.has(id)) {
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
  if (sessions === state.fleetSessions) return; // reference-equal no-op
  // Length + shallow per-element ref check — catches the case where the
  // caller re-emits the same array elements in a new array literal (very
  // rare in practice — AppShell hands us a fresh array from an axios
  // response — but the guard mirrors updateOpenTabs for consistency).
  if (sessions.length === state.fleetSessions.length) {
    let allSame = true;
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i] !== state.fleetSessions[i]) {
        allSame = false;
        break;
      }
    }
    if (allSame) return; // shallow no-op — do not bump snapshotVersion
  }
  state = { ...state, fleetSessions: sessions };
  notify();
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

export function pinConversation(id: string): void {
  if (state.pinnedIds.has(id)) return; // already pinned — no-op
  // Reject pinning an id that isn't in openTabs (defense-in-depth)
  let found = false;
  for (const t of state.openTabs) {
    if (t.id === id) {
      found = true;
      break;
    }
  }
  if (!found) return;
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.add(id);
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}

export function unpinConversation(id: string): void {
  if (!state.pinnedIds.has(id)) return; // not pinned — no-op
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.delete(id);
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}

export function togglePinConversation(id: string): void {
  if (state.pinnedIds.has(id)) unpinConversation(id);
  else pinConversation(id);
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
    pinned: list.pinned,
    grouped: list.grouped,
    selectedId: state.selectedId,
    pinnedIds: state.pinnedIds,
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

// Plan 07-01 Task 1: expose all fleet-derived rows (across pinned + grouped)
// for test assertions. `fleetOnly === true` rows are synthetic — they came
// from state.fleetSessions and did NOT dedup with any openTabs entry.
// Fleet-only rows CANNOT appear in `pinned` (see the pin-defense in
// computeSnapshot + Test 30 regression) but we filter both slices for
// completeness.
export function __getFleetOnlyRowsForTest(): ConversationRow[] {
  const list = getSnapshot();
  const out: ConversationRow[] = [];
  for (const r of list.pinned) if (r.fleetOnly) out.push(r);
  for (const g of list.grouped) {
    for (const r of g.rows) if (r.fleetOnly) out.push(r);
  }
  return out;
}
