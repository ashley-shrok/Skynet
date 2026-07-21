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
};

let state: State = {
  hostTree: null,
  openTabs: [],
  pinnedIds: new Set<string>(),
  selectedId: null,
};

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

function computeSnapshot(): ConversationList {
  const conversationTabs = state.openTabs.filter(isConversationTab);

  // Pinned rows first — iterate openTabs order and filter by pinnedIds.
  // pinnedIds is authoritative on "is this pinned?"; openTabs order gives
  // deterministic within-pinned ordering (see plan Task 1 Step 7 — no
  // drag-to-reorder, pin order = pin-creation-relative = openTabs order).
  const pinned: ConversationRow[] = [];
  for (const tab of conversationTabs) {
    if (state.pinnedIds.has(tab.id)) pinned.push(rowFromTab(tab));
  }

  // Grouped rows below — bucket non-pinned tabs by host id, then emit in
  // host-tree order. Hosts with zero non-pinned rows are skipped so the
  // panel doesn't render empty group headers.
  const byHostId = new Map<string, ConversationRow[]>();
  for (const tab of conversationTabs) {
    if (state.pinnedIds.has(tab.id)) continue; // already in pinned
    if (!tab.host) continue; // defense-in-depth; isConversationTab already filtered
    const bucket = byHostId.get(tab.host.id);
    if (bucket) bucket.push(rowFromTab(tab));
    else byHostId.set(tab.host.id, [rowFromTab(tab)]);
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
  for (const [hostId, rows] of byHostId) {
    if (seenHostIds.has(hostId)) continue;
    if (rows.length === 0) continue;
    const firstRow = rows[0];
    const hostName = firstRow.host?.name ?? hostId;
    grouped.push({ hostId, hostName, rows });
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

export function selectConversation(id: string | null): void {
  if (id === state.selectedId) return; // no-op — already selected
  if (id !== null) {
    // Stale-id guard: reject selection of an id not in openTabs (T-06-01-01)
    let found = false;
    for (const t of state.openTabs) {
      if (t.id === id) {
        found = true;
        break;
      }
    }
    if (!found) return; // silent no-op
  }
  state = { ...state, selectedId: id };
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
