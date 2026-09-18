// ─── App tiles store (Phase 119 Plan 119-02 — sidebar apps surface) ─────────
// Standalone client-side subscription slice for the Phase 118 app-registry
// channel. Consumes the three app frames dispatched by fleet-status-client
// (app-snapshot / app-update / app-gone — see fleet-status-client.ts cases
// added by 119-01) and exposes a sorted `useAppTiles()` reader hook that
// PrettyConversationsPanel's new "Apps" section (119-04) will consume.
//
// D-14 (atomic reconciliation): every frame triggers a full re-render via
//   useSyncExternalStore's notify chain. Store mutation is atomic per frame
//   — publishAppSnapshot clears-and-repopulates in one map replacement,
//   publishAppUpdate mutates one key in a fresh map, publishAppGone deletes
//   one key from a fresh map. No partial states, no throttling, no batching.
//
// D-15 (stable sort): alphabetical by title with `${hostId}:${slug}` tiebreak,
//   case-insensitive locale-aware via
//   `String.prototype.localeCompare(other, undefined, { sensitivity: "base" })`.
//   Same sort applies to healthy + unhealthy tiles — no health-based grouping.
//   Tiebreak matters (Pitfall 6 from 117-RESEARCH.md): frames arrive
//   unordered; two apps with the same title on different hosts would swap
//   positions on every re-sort without a total order.
//
// D-16 (standalone slice): NOT bolted onto conversation-store, identities-
//   store, session-working-store, or any other pre-existing state module.
//   Different data axis, different lifecycle — mixing surfaces is where
//   regressions hide.
//
// D-17 (no pre-first-frame state): store starts empty; `useAppTiles()`
//   returns [] until the first `app-snapshot` frame arrives. NO "loading"
//   state, NO "connecting..." affordance, NO skeleton rows. The sidebar
//   Apps section is collapsed by default anyway — by the time the user
//   expands it, the first frame has arrived (subscribe-on-mount + Phase 118
//   D-16 snapshot-on-subscribe).
//
// Snapshot semantics (per 117-RESEARCH.md open question 3, RESOLVED):
//   Treat `app-snapshot` as an authoritative full-list replacement, not a
//   merge. If an `app-update` races ahead of `app-snapshot` on a fresh
//   subscription, the snapshot overwrites — acceptable, matches D-17.
//
// Store shape mirrors src/ui/state/session-working-store.ts —
//   module-scoped `state: { map }`, `snapshotVersion` counter, `Set<() => void>`
//   of listeners, `notify()` bumps version + fans out, `subscribe(cb)` returns
//   a disposer. In-memory only — no browser persistence layer of any kind
//   (D-14 atomic model; restart of the tab = fresh subscribe from cold via
//   Phase 118's snapshot-on-subscribe).

import { useMemo, useSyncExternalStore } from "react";
import type { AppState } from "../api/fleet-status-types.js";

// ─── Internal state ─────────────────────────────────────────────────────────

type State = {
  // Key: `${hostId}:${slug}` — the compound identifier the wire protocol uses.
  map: Map<string, AppState>;
};

let state: State = {
  map: new Map<string, AppState>(),
};

let snapshotVersion = 0;

const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Public subscribe API for cross-store bridges + tests. Mirrors
 * `subscribeSessionWorkingStore` from session-working-store.ts. Returns a
 * disposer that removes the listener from the module-scoped Set.
 *
 * Consumers should prefer the `useAppTiles()` hook (which uses
 * useSyncExternalStore under the hood) over calling this directly.
 */
export function subscribeAppTilesStore(cb: () => void): () => void {
  return subscribe(cb);
}

// ─── Publish fns ────────────────────────────────────────────────────────────

/**
 * Snapshot-as-full-list replacement (D-14).
 *
 * Builds a fresh Map from the incoming list (keyed by `${hostId}:${slug}`),
 * replaces the module-scoped state atomically, and notifies subscribers. Any
 * prior tiles NOT present in `apps` are dropped — this is the load-bearing
 * "snapshot = authoritative full picture" contract that Phase 118's
 * subscription registry emits on subscribe and on every reconnect.
 *
 * Always notifies (even for an empty `apps` array), because the transition
 * from "some tiles" to "no tiles" is a meaningful re-render for the sidebar
 * (empty-expanded state renders the D-04 prompt).
 */
export function publishAppSnapshot(apps: AppState[]): void {
  console.info({
    operation: "app_tiles_store_snapshot",
    appCount: apps.length,
  });

  const nextMap = new Map<string, AppState>();
  for (const app of apps) {
    nextMap.set(`${app.hostId}:${app.slug}`, app);
  }
  state = { map: nextMap };
  notify();
}

/**
 * Upsert one tile on the atomic reconcile path (D-14).
 *
 * Clones the current map, sets the `${hostId}:${slug}` key to the incoming
 * AppState (overwriting any prior value for the same key), replaces state,
 * notifies. Always notifies — the backend does not deduplicate identical
 * updates (see 119-01 fleet-status-client comment on `app-update`), so we
 * cannot no-op-guard based on structural equality without risking a missed
 * health-flip re-render.
 */
export function publishAppUpdate(app: AppState): void {
  const key = `${app.hostId}:${app.slug}`;
  console.info({
    operation: "app_tiles_store_update",
    hostId: app.hostId,
    slug: app.slug,
    isHealthy: app.isHealthy,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, app);
  state = { map: nextMap };
  notify();
}

/**
 * Delete one tile on the atomic reconcile path (D-14).
 *
 * Early-returns without notifying when the key is absent — matches the
 * server-side SubscriptionRegistry.publishAppGone shape (no-op on unknown
 * keys) and prevents double-delete churn from sweep restart cycles or racing
 * frames. When the key exists, clones the current map, deletes, replaces
 * state, notifies.
 */
export function publishAppGone(hostId: string, slug: string): void {
  const key = `${hostId}:${slug}`;
  if (!state.map.has(key)) return; // no-op

  console.info({
    operation: "app_tiles_store_gone",
    hostId,
    slug,
  });

  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}

// ─── Reader hook ────────────────────────────────────────────────────────────

function getMapSnapshot(): ReadonlyMap<string, AppState> {
  return state.map;
}

/**
 * React hook — subscribe to the sorted app-tile list.
 *
 * Returns an array of AppState sorted by title (case-insensitive,
 * locale-aware) with a `${hostId}:${slug}` tiebreak per D-15. Same sort
 * applies to healthy and unhealthy tiles — no grouping.
 *
 * useSyncExternalStore semantics: the identity of the returned Map changes
 * on every mutation (publish fns replace `state.map` wholesale), so the
 * useMemo below recomputes the sorted array on every publish. Between
 * publishes the memo returns the cached array — stable identity for
 * downstream React children that memoise on the tiles reference.
 */
export function useAppTiles(): AppState[] {
  const snapshot = useSyncExternalStore(
    subscribe,
    getMapSnapshot,
    getMapSnapshot,
  );
  return useMemo(() => {
    return Array.from(snapshot.values()).sort((a, b) => {
      // Primary: title compared case-insensitively via `sensitivity: "base"`
      // (per D-15 — matches user expectation that "apple" and "Apple" sort
      // together, and that "Banana" falls between "apple" and "cherry").
      const t = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
      });
      if (t !== 0) return t;
      // Tiebreak: full compound key. Prevents Pitfall 6 sort thrash — two
      // apps with the same title on different hosts stay in stable order
      // across every re-sort.
      return `${a.hostId}:${a.slug}`.localeCompare(`${b.hostId}:${b.slug}`);
    });
  }, [snapshot]);
}

// Suppress "declared but never read" for snapshotVersion (bumped by notify()).
void snapshotVersion;

// ─── Test-only helpers ──────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * app-tiles-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, AppState>() };
  notify();
}
