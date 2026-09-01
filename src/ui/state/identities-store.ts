import { useEffect, useState } from "react";
import { listIdentities, type Identity } from "@/api/identities-api";
// Phase 66 Plan 05 (W4): import sessionMatchKey DIRECTLY from its authoritative
// source (session-hue), NOT re-exported through conversation-store. This mirrors
// conversation-store.ts:54's own direct import — session-hue is the canonical
// home; adding a re-export elsewhere would create a second import path and
// risk a circular-dep loop if session-hue ever imports from conversation-store.
import { sessionMatchKey } from "@/features/terminal/session-hue";
import {
  getFleetSessionsSnapshot,
  subscribeConversationStore,
  type FleetSession,
} from "./conversation-store";

type State = {
  identities: Identity[];
  byKey: Map<string, Identity>;
  loaded: boolean;
};

let state: State = { identities: [], byKey: new Map(), loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

// Phase 66 Plan 05 — module-level guard for the one-shot re-fetch that fires
// AFTER conversation-store's fleetSessions flips loaded (empty first fetch →
// populated re-fetch). Prevents an unbounded refresh loop when the fleet
// sessions array continues to churn after the initial load.
let hasRefreshedAfterFleetLoad = false;
let hasSubscribedToFleet = false;

function notify() {
  for (const l of listeners) l();
}

// displayName is display-only (identityKey is the canonical id); normalize
// to first-letter-capitalized at store-load time so every consumer — sidebar
// rows, chat headers, badges, modals — reads a consistent shape regardless
// of whether the row was birthed with a capitalized name or cloned (clone
// sets displayName=newName which is lowercase per IDENTITY_KEY_RE).
function withDisplayCap(i: Identity): Identity {
  if (!i.displayName || i.displayName.length === 0) return i;
  const first = i.displayName.charAt(0);
  const capped = first.toUpperCase();
  if (capped === first) return i;
  return { ...i, displayName: capped + i.displayName.slice(1) };
}

function setIdentities(list: Identity[]) {
  const normalized = list.map(withDisplayCap);
  state = {
    identities: normalized,
    byKey: new Map(normalized.map((i) => [i.identityKey.toLowerCase(), i])),
    loaded: true,
  };
  notify();
}

/**
 * Phase 66 Plan 05 — build the caller-scoped identityHosts map from
 * conversation-store's fleet-sessions snapshot.
 *
 * Algorithm: iterate fleetSessions in order; for each session, compute
 * identityKey = sessionMatchKey(sessionName) (lowercased); if the key is
 * non-null AND not yet in the map, assign session.hostId. First-wins matches
 * the "one identity, one home box" invariant from the phase shape file — the
 * fleet-sessions snapshot may contain duplicate identity entries across boxes
 * during a transition/migration window; we honor the first occurrence.
 *
 * Empty input → empty map. The backend (Plan 03) treats identities NOT in
 * the map as "cosmetics safe-defaults" without SSH fanout, so an empty map
 * is a valid transition-window state, not an error.
 */
export function buildIdentityHostsFromFleet(
  fleetSessions: FleetSession[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const session of fleetSessions) {
    const identityKey = sessionMatchKey(session.sessionName);
    if (identityKey === null) continue;
    if (map[identityKey] !== undefined) continue; // first-wins
    map[identityKey] = session.hostId;
  }
  return map;
}

// One-shot re-fetch after the first fleetSessions load. Fires ONCE per module
// lifetime (guarded by hasRefreshedAfterFleetLoad). The subscription itself
// is also installed lazily inside fetchOnce so a test that imports the module
// without ever calling fetchOnce doesn't leak a live subscription.
function ensureFleetSubscription(): void {
  if (hasSubscribedToFleet) return;
  hasSubscribedToFleet = true;
  subscribeConversationStore(() => {
    if (hasRefreshedAfterFleetLoad) return;
    const snapshot = getFleetSessionsSnapshot();
    if (snapshot.length === 0) return; // still empty — wait for the load flip
    hasRefreshedAfterFleetLoad = true;
    // Fire-and-forget — a failure here (network error, backend down) is
    // benign: the safe-defaults render is still up from the first fetch,
    // and the next user-driven refreshIdentities() call has another shot.
    void refreshIdentities();
  });
}

async function fetchOnce(): Promise<void> {
  ensureFleetSubscription();
  if (state.loaded || inflight) return inflight ?? Promise.resolve();
  inflight = (async () => {
    try {
      // Phase 66 Plan 05 — construct the identityHosts wire parameter from
      // conversation-store's fleet-sessions snapshot BEFORE calling
      // listIdentities. When fleet is empty (first-load race), the map is
      // empty and the backend serves cosmetics-as-safe-defaults per Plan 03.
      // A one-shot re-fetch (see ensureFleetSubscription above) fires the
      // moment fleetSessions transitions from empty→populated so the render
      // pipeline picks up the disk-derived cosmetics without waiting for a
      // full refreshIdentities call.
      const identityHosts = buildIdentityHostsFromFleet(
        getFleetSessionsSnapshot(),
      );
      const list = await listIdentities(identityHosts);
      setIdentities(list);
    } catch {
      state = { ...state, loaded: true };
      notify();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function refreshIdentities(): Promise<void> {
  state = { ...state, loaded: false };
  return fetchOnce();
}

export function applyIdentityChange(
  next: Identity | null,
  removedId?: string,
): void {
  let list = state.identities.slice();
  if (removedId) {
    list = list.filter((i) => i.id !== removedId);
  } else if (next) {
    const idx = list.findIndex((i) => i.id === next.id);
    if (idx >= 0) list[idx] = next;
    else list.push(next);
  }
  setIdentities(list);
}

export function useIdentities(): {
  identities: Identity[];
  byKey: Map<string, Identity>;
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    void fetchOnce();
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return {
    identities: state.identities,
    byKey: state.byKey,
    loaded: state.loaded,
    refresh: refreshIdentities,
  };
}

// ─── Test-only helper ────────────────────────────────────────────────────────
// Phase 66 Plan 05 — reset the module-scoped state (identities snapshot +
// inflight promise + refresh-after-fleet-load guard) for identities-store
// enrichment tests. Not part of the public API; keeps prior test's state from
// leaking into the next test in the same vitest worker.
export function __resetIdentitiesStoreForTest(): void {
  state = { identities: [], byKey: new Map(), loaded: false };
  inflight = null;
  hasRefreshedAfterFleetLoad = false;
  notify();
}
