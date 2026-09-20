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
// D-17 (localStorage seed for cold-boot paint — REVERSED from original
//   in-memory-only design): the store seeds `state.map` from
//   `APP_TILES_CACHE_KEY` at module load, so a page refresh paints tiles
//   from the last-known snapshot BEFORE the fleet-status WS first frame
//   arrives. First `app-snapshot` from the WS is still authoritative and
//   replaces the seeded map wholesale — cache is a paint hint, not a
//   source of truth. `notify()` writes the current tile list back to
//   localStorage on every state change, so the cache is always as fresh
//   as the last-received frame. Silent on read/write failure (mirrors
//   identities-store appearance-cache pattern).
//
// Snapshot semantics (per 117-RESEARCH.md open question 3, RESOLVED):
//   Treat `app-snapshot` as an authoritative full-list replacement, not a
//   merge. If an `app-update` races ahead of `app-snapshot` on a fresh
//   subscription, the snapshot overwrites.
//
// Store shape mirrors src/ui/state/session-working-store.ts —
//   module-scoped `state: { map }`, `snapshotVersion` counter, `Set<() => void>`
//   of listeners, `notify()` bumps version + fans out, `subscribe(cb)` returns
//   a disposer. Persistence layer per D-17.

import { useMemo, useSyncExternalStore } from "react";
import type { AppState } from "../api/fleet-status-types.js";

// Storage key for the app-tiles cold-boot cache read at module load and
// written on every state-change notify(). Bump the version suffix on any
// schema change to AppState (avoids reading a stale-shape cache into an
// incompatible reader).
const APP_TILES_CACHE_KEY = "skynet:app-tiles-cache:v1";

// ─── Internal state ─────────────────────────────────────────────────────────

type State = {
  // Key: `${hostId}:${slug}` — the compound identifier the wire protocol uses.
  map: Map<string, AppState>;
};

// Module-load seed from localStorage: paint tiles on cold refresh BEFORE
// the fleet-status WS first-frame arrives (D-17). Empty / missing /
// malformed cache falls back to the empty initial state; readAppTilesCache
// is silent by contract.
let state: State = (() => {
  const cached = readAppTilesCache();
  const map = new Map<string, AppState>();
  for (const app of cached) {
    map.set(`${app.hostId}:${app.slug}`, app);
  }
  return { map };
})();

let snapshotVersion = 0;

const listeners = new Set<() => void>();

function notify(): void {
  // Single-authority cache write: every state change that reaches listeners
  // also updates the localStorage cache so the next cold paint has the
  // freshest tile list to seed from. Silent on write failure by contract.
  writeAppTilesCache(Array.from(state.map.values()));
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

// ─── Cache read/write ───────────────────────────────────────────────────────

function isCachedAppState(x: unknown): x is AppState {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.hostId !== "string") return false;
  if (typeof r.slug !== "string") return false;
  if (typeof r.title !== "string") return false;
  if (typeof r.description !== "string") return false;
  if (r.port !== null && typeof r.port !== "number") return false;
  if (typeof r.hasIcon !== "boolean") return false;
  if (typeof r.createdAtMs !== "number") return false;
  if (typeof r.isHealthy !== "boolean") return false;
  if (r.healthMessage !== null && typeof r.healthMessage !== "string")
    return false;
  return true;
}

export function readAppTilesCache(): AppState[] {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(APP_TILES_CACHE_KEY)
        : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: AppState[] = [];
    for (const item of parsed) {
      if (isCachedAppState(item)) {
        // Defensive per-field pick — only canonical fields make it back into
        // memory even if a future writer accidentally serialized more.
        valid.push({
          hostId: item.hostId,
          slug: item.slug,
          title: item.title,
          description: item.description,
          port: item.port,
          hasIcon: item.hasIcon,
          createdAtMs: item.createdAtMs,
          isHealthy: item.isHealthy,
          healthMessage: item.healthMessage,
        });
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function writeAppTilesCache(list: AppState[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const canonical = list.map((a) => ({
      hostId: a.hostId,
      slug: a.slug,
      title: a.title,
      description: a.description,
      port: a.port,
      hasIcon: a.hasIcon,
      createdAtMs: a.createdAtMs,
      isHealthy: a.isHealthy,
      healthMessage: a.healthMessage,
    }));
    localStorage.setItem(APP_TILES_CACHE_KEY, JSON.stringify(canonical));
  } catch {
    // Silent — cache write failure is non-fatal.
  }
}

// ─── Test-only helpers ──────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * app-tiles-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. Also clears the localStorage cache so cross-test
 * bleed via seed-on-load can't happen. NOT a public API.
 */
export function __resetForTest(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(APP_TILES_CACHE_KEY);
    }
  } catch {
    // Silent.
  }
  state = { map: new Map<string, AppState>() };
  notify();
}

/**
 * Re-run the module-load cache seed after tests have populated localStorage.
 * Production callers rely on the IIFE at module init; tests can't easily
 * control that timing (module loads once per file), so this helper exposes
 * the same seed logic on demand.
 */
export function __seedFromCacheForTest(): void {
  const cached = readAppTilesCache();
  const map = new Map<string, AppState>();
  for (const app of cached) {
    map.set(`${app.hostId}:${app.slug}`, app);
  }
  state = { map };
  notify();
}
