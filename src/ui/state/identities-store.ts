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
  hydratePinnedIdsFromServer,
  hydrateHiddenIdsFromServer,
  subscribeConversationStore,
  type FleetSession,
} from "./conversation-store";

type State = {
  identities: Identity[];
  byKey: Map<string, Identity>;
  /** quick-260912-0t4: hostId-scoped composite-key map. Key format
   *  `${hostId}::${identityKey.toLowerCase()}`. Cosmetics consumers that
   *  render a row/pane belonging to a specific host MUST read from here so
   *  cross-host name collisions (e.g. two identities named "willow" on
   *  different fleet hosts) don't collide on lookup. `byKey` above is
   *  preserved additively for existence-check consumers whose semantics are
   *  "is there ANY identity by this name?" (AppShell pane discriminator,
   *  IdentityBadge, tabUtils, IdentitySessionPane, conversation-store role
   *  fallback, relay-mxid-resolve) — see quick-260912-0t4 rationale. */
  byHostKey: Map<string, Identity>;
  loaded: boolean;
};

let state: State = {
  identities: [],
  byKey: new Map(),
  byHostKey: new Map(),
  loaded: false,
};
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

/**
 * Phase 111 Plan 04 — shared normalization + index-rebuild tail used by BOTH
 * `setIdentities` (the full-replacement door) and `mergeIdentityAppearance`
 * (the additive-merge door). Keeping both doors in sync means one place to
 * audit for correctness: normalization, the composite-key guard, and the
 * `byKey`/`byHostKey` dual build all live here.
 *
 * Returns a new `{ identities, byKey, byHostKey }` triple; the caller decides
 * the value of `loaded` and spreads accordingly. This is what satisfies D-09's
 * "one normalization tail" while satisfying D-10's "the pulse must not set
 * loaded": setIdentities spreads `loaded: true`; mergeIdentityAppearance
 * spreads `loaded: state.loaded`.
 */
function reindex(
  list: Identity[],
): Pick<State, "identities" | "byKey" | "byHostKey"> {
  const identities = list.map(withDisplayCap);
  // byKey is bare-name — retained additively for existence-check consumers
  // (AppShell pane discriminator, IdentityBadge, tabUtils, IdentitySessionPane,
  // conversation-store role fallback, relay-mxid-resolve). With the backend
  // now returning multiple rows for the same name across hosts, byKey.set
  // collides on name — last wire-order wins for the bare-name map, which is
  // fine because those consumers only ask `.has(name)` / `.get(name)` to
  // check "does ANY identity by this name exist?". Cosmetics consumers MUST
  // use byHostKey — see quick-260912-0t4 rationale.
  const byKey = new Map<string, Identity>();
  const byHostKey = new Map<string, Identity>();
  for (const i of identities) {
    const nameLc = i.identityKey.toLowerCase();
    byKey.set(nameLc, i);
    // Only index rows that carry a hostId — pre-quick-260912-0t4 fixtures
    // (test mocks) may omit it; skip those in the composite map rather than
    // seeding a `undefined::name` bucket that would silently mis-serve
    // production lookups.
    if (typeof i.hostId === "number" && Number.isFinite(i.hostId)) {
      byHostKey.set(`${i.hostId}::${nameLc}`, i);
    }
  }
  return { identities, byKey, byHostKey };
}

function setIdentities(list: Identity[]) {
  state = { ...reindex(list), loaded: true };
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

/**
 * Phase 92 Plan 04 (D-04) — project each identity's `pinned: boolean` field
 * (populated from disk by the backend at request time per D-03) into the
 * conversation-row id space (`fleet::<hostId>::<sessionName>`). Called by the
 * panel's hydrate effect (PrettyConversationsPanel.tsx L475+) as the
 * replacement for the retired getPinnedIds() /user-preferences fetch.
 *
 * H2 invariant: the `identityHosts` argument MUST be constructed via the
 * existing `buildIdentityHostsFromFleet(fleetSessions)` helper exported from
 * this same module (L74-85), which uses `sessionMatchKey(session.sessionName)`
 * from src/ui/features/terminal/session-hue.ts. That helper's null-return on
 * empty/undefined sessionName is what filters relay-room sessions and other
 * non-identity sessions out of the map. Callers MUST NOT construct
 * identityHosts by iterating fleetSessions with a naive
 * `session.sessionName.toLowerCase()` pattern — that crashes on the relay-
 * room `sessionName === undefined` case (per conversation-store.ts L710-731)
 * and diverges from the semantics the /identities fetch already uses.
 *
 * Fail-closed on missing `pinned` field: an identity object without the
 * field is treated as unpinned (matches backend Plan 02 fail-closed contract
 * where identityFileExists throws → pinned:false).
 *
 * Identity keys not present in identityHosts are filtered out — an identity
 * we don't have a host mapping for cannot render as a pinned row anyway
 * (no row to render), so including it in state.pinnedIds would produce an
 * inert entry.
 *
 * H3 invariant (from Plan 92-02): identity.identityKey is emitted verbatim
 * from listIdentityKeysOnHost's raw folder-name output — ALREADY lowercase
 * because identity-artifact-reader.ts IDENTITY_KEY_RE forbids uppercase.
 * The `.toLowerCase()` below is defense-in-depth belt-and-suspenders against
 * a future backend change that ever emitted a capitalized key. The emitted
 * `fleet::${hostId}::${lookupKey}` shape uses the lowercased key
 * deliberately: it matches conversation-store.ts:740
 * `fleetRowId(session.hostId, session.sessionName)` because session.sessionName
 * from the fleet-status wire is the lowercase identity name (id-skill uses
 * the same regex on the target host).
 */
export function deriveDiskPinnedIds(
  identityHosts: Record<string, number>,
): string[] {
  const out: string[] = [];
  for (const identity of state.identities) {
    // Fail-closed: `pinned !== true` treats undefined / false / any non-true
    // value as unpinned. Matches the backend's fail-closed contract at
    // identities.ts L282+ where an exists() throw catches to false.
    if (identity.pinned !== true) continue;
    const lookupKey = identity.identityKey.toLowerCase();
    const hostId = identityHosts[lookupKey];
    if (typeof hostId !== "number") continue;
    out.push(`fleet::${hostId}::${lookupKey}`);
  }
  return out;
}

/**
 * Phase 107 Plan 107-04 (D-04, SC-6) — project each identity's `hidden: boolean`
 * field (populated from disk by the backend at request time per Plan 107-02
 * Task 1) into the conversation-row id space (`fleet::<hostId>::<sessionName>`).
 * Called by the panel's hydrate effect (PrettyConversationsPanel.tsx L502+)
 * as the replacement for the retired getHiddenIds() /user-preferences fetch.
 *
 * H2 invariant: the identityHosts argument MUST be constructed via the
 * existing buildIdentityHostsFromFleet(fleetSessions) helper exported from
 * this same module (L111-122). Same constraint deriveDiskPinnedIds carries.
 *
 * Fail-closed on missing `hidden` field: an identity object without the
 * field is treated as unhidden (matches backend Plan 107-02 fail-closed
 * contract where identityFileExists throws → hidden:false).
 *
 * Identity keys not present in identityHosts are filtered out — an identity
 * we don't have a host mapping for cannot render as a hidden row anyway
 * (no row to render), so including it in state.hiddenIds would produce an
 * inert entry.
 *
 * H3 invariant (from Plan 107-02): identity.identityKey is emitted verbatim
 * from listIdentityKeysOnHost's raw folder-name output — ALREADY lowercase
 * because identity-artifact-reader.ts IDENTITY_KEY_RE forbids uppercase.
 * The `.toLowerCase()` below is defense-in-depth belt-and-suspenders. The
 * emitted `fleet::${hostId}::${lookupKey}` shape uses the lowercased key
 * deliberately: it matches conversation-store.ts:594 fleetRowId shape.
 */
export function deriveDiskHiddenIds(
  identityHosts: Record<string, number>,
): string[] {
  const out: string[] = [];
  for (const identity of state.identities) {
    // Fail-closed: `hidden !== true` treats undefined / false / any non-
    // true value as unhidden. Matches the backend's fail-closed contract
    // at identities.ts hidden probe .catch(() => false).
    if (identity.hidden !== true) continue;
    const lookupKey = identity.identityKey.toLowerCase();
    const hostId = identityHosts[lookupKey];
    if (typeof hostId !== "number") continue;
    out.push(`fleet::${hostId}::${lookupKey}`);
  }
  return out;
}

// Re-fetch after the first fleetSessions load. Succeeds at most ONCE per module
// lifetime (guarded by hasRefreshedAfterFleetLoad). The subscription itself
// is also installed lazily inside fetchOnce so a test that imports the module
// without ever calling fetchOnce doesn't leak a live subscription.
//
// The latch is set on SUCCESS, not on attempt. Setting it before the fetch
// resolved meant one failed attempt permanently spent the only automatic
// retry: the safe-default (null-cosmetics) render stayed up for the life of
// the tab, and the only way back was a user action that happens to call
// refreshIdentities directly — e.g. creating a role. The operator hit exactly that
// (4 rows rendered colourless; creating a role restored them), which is what
// identified this. An inflight guard keeps a burst of store notifications
// from stacking duplicate fetches while one is in the air.
function ensureFleetSubscription(): void {
  if (hasSubscribedToFleet) return;
  hasSubscribedToFleet = true;
  let refreshInflight = false;
  subscribeConversationStore(() => {
    if (hasRefreshedAfterFleetLoad || refreshInflight) return;
    const snapshot = getFleetSessionsSnapshot();
    if (snapshot.length === 0) return; // still empty — wait for the load flip
    refreshInflight = true;
    void refreshIdentities().then((ok) => {
      refreshInflight = false;
      // Only a successful refresh spends the latch. On failure the next
      // fleetSessions notification retries instead of leaving the user
      // stuck with safe-defaults.
      if (ok) hasRefreshedAfterFleetLoad = true;
    });
  });
}

async function fetchOnce(): Promise<void> {
  ensureFleetSubscription();
  if (state.loaded || inflight) return inflight ?? Promise.resolve();
  // 2026-09-08 (user): on cold reload, fleetSessions is empty until the WS
  // fleet-status frame arrives, so buildIdentityHostsFromFleet returns {}.
  // With Phase 69's disk-fanout backend, GET /identities?identityHosts={}
  // returns []; that response flips state.loaded=true with byKey=empty,
  // which sabotages TerminalOrIdentitySessionPane's hydration-race guard
  // in tabUtils.tsx (byKey.has(k) || !loaded evaluates to false → Terminal
  // component mounts for identity-shape panes during the ms window before
  // the fleet-status subscription fires refreshIdentities). Terminal boots
  // an xterm + real SSH WS + then unmounts when the discriminator flips,
  // leaking listeners (bounty: terminal-first-flash-on-reload-plus-listener-
  // leak). Skip the empty-map fetch entirely — stay loaded=false and let
  // ensureFleetSubscription's fleet-arrival callback fire the first real
  // fetch when it has non-empty identityHosts. Safe fallback if fleet-status
  // never arrives: loaded stays false forever, discriminator keeps assuming
  // identity, PVs render fine (they read tab props, not identity metadata —
  // see d4d87217 rationale).
  const identityHostsPrecheck = buildIdentityHostsFromFleet(
    getFleetSessionsSnapshot(),
  );
  if (Object.keys(identityHostsPrecheck).length === 0) return;
  inflight = (async () => {
    try {
      // Phase 66 Plan 05 — construct the identityHosts wire parameter from
      // conversation-store's fleet-sessions snapshot BEFORE calling
      // listIdentities. Skip guard above ensures this is non-empty; the
      // subscription re-runs the fetch if fleetSessions changes later.
      const identityHosts = buildIdentityHostsFromFleet(
        getFleetSessionsSnapshot(),
      );
      const list = await listIdentities(identityHosts);
      setIdentities(list);
    } catch (err) {
      console.warn("identities-store: initial identities fetch failed", err);
      state = { ...state, loaded: true };
      notify();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * @param extraIdentityHosts Additional `{ identityKey: hostId }` entries to
 *   union into the map derived from fleetSessions. Needed by the birth flow: a
 *   just-born identity has no tmux session yet (the agent-supervisor opens it
 *   on its next reconcile tick, per Phase 106 D-01), so it is absent from
 *   fleetSessions and buildIdentityHostsFromFleet cannot see it. Without an
 *   entry naming its host, the backend fans out to zero hosts for that name and
 *   the identity comes back in no response at all — leaving byKey without it,
 *   which makes AppShell mount a raw terminal instead of PrettyView and
 *   PrettyConversationRow render with no avatar/title. Worst on a host that has
 *   never birthed an identity, where the map may be empty entirely.
 */
export function refreshIdentities(
  extraIdentityHosts: Record<string, number> = {},
): Promise<boolean> {
  // Force a fresh fetch even if the initial fetchOnce is still inflight.
  //
  // 2026-09-01 user regression: the first fetchOnce fires from
  // useIdentities().useEffect immediately after component mount, when
  // conversation-store's fleetSessions is still empty (WS hasn't returned
  // fleet-status yet). It runs with an empty identityHosts map and the
  // backend returns safe-default cosmetics for every identity.
  //
  // Milliseconds later the WS fleet-status arrives; the subscription in
  // ensureFleetSubscription() fires the one-shot re-fetch via this
  // function. Under the previous shape (`state.loaded = false; return
  // fetchOnce();`), fetchOnce's guard `if (state.loaded || inflight)
  // return inflight` short-circuited back to the STILL-INFLIGHT initial
  // fetch. That fetch's promise resolves with the safe-default results
  // and never re-runs — so cosmetics stay null forever and every identity
  // renders as its blue-hue safe-default.
  //
  // Fix: bypass fetchOnce's guards. Do the fetch directly with the
  // now-populated identityHosts map. Any concurrent inflight remains
  // outstanding but its result is superseded by setIdentities from THIS
  // path — since setIdentities atomically replaces the identities array,
  // whichever call runs last wins, and the fresh (populated) call is what
  // the user wants regardless.
  ensureFleetSubscription();
  const p = (async () => {
    try {
      const identityHosts = {
        ...buildIdentityHostsFromFleet(getFleetSessionsSnapshot()),
        ...extraIdentityHosts,
      };
      const list = await listIdentities(identityHosts);
      setIdentities(list);
      return true;
    } catch (err) {
      // Never rejects — callers rely on that. But the failure is reported both
      // to the caller (so the post-fleet-load latch can retry) and to the
      // console: silently keeping the safe-default render is what made a
      // colourless conversation list undiagnosable.
      console.warn("identities-store: refreshIdentities failed", err);
      return false;
    }
  })();
  return p;
}

export function applyIdentityChange(
  next: Identity | null,
  removedKey?: string,
  /** quick-260912-0t4: optional hostId scoping for the remove/update path. When
   *  provided, the match narrows to the ROW whose (hostId, identityKey) tuple
   *  matches — necessary now that the backend returns per-(hostId, identityKey)
   *  rows and two identities can share a name across hosts. Absent → falls
   *  back to bare-name match (pre-quick-260912-0t4 semantics; matches first
   *  row in list — a caveat for existing callers that don't yet thread hostId
   *  through delete flows, but not a regression). */
  removedHostId?: number,
): void {
  let list = state.identities.slice();
  if (removedKey) {
    const removedKeyLc = removedKey.toLowerCase();
    if (typeof removedHostId === "number" && Number.isFinite(removedHostId)) {
      list = list.filter(
        (i) =>
          !(
            i.identityKey.toLowerCase() === removedKeyLc &&
            i.hostId === removedHostId
          ),
      );
    } else {
      // Bare-name filter — pre-existing behavior. When two identities share a
      // name across hosts, this removes ALL of them; when only one exists, it
      // removes that one. Caller should thread removedHostId once available.
      list = list.filter((i) => i.identityKey.toLowerCase() !== removedKeyLc);
    }
  } else if (next) {
    const nextKeyLc = next.identityKey.toLowerCase();
    // Widen the match to (hostId, identityKey) when both sides have hostId so
    // the correct per-host row is replaced on cross-host name collisions.
    // Falls back to bare-name findIndex when next.hostId is absent
    // (pre-quick-260912-0t4 test fixtures).
    const idx =
      typeof next.hostId === "number" && Number.isFinite(next.hostId)
        ? list.findIndex(
            (i) =>
              i.identityKey.toLowerCase() === nextKeyLc &&
              i.hostId === next.hostId,
          )
        : list.findIndex((i) => i.identityKey.toLowerCase() === nextKeyLc);
    if (idx >= 0) list[idx] = next;
    else list.push(next);
  }
  setIdentities(list);
}

/**
 * Patch a boolean sentinel field (`pinned` / `hidden`) on a single identity in
 * the local store to reflect a write that just succeeded server-side.
 *
 * Without this, pinConversation/hideConversation optimistically mutate
 * conversation-store's `pinnedIds`/`hiddenIds` but leave identities-store's
 * per-identity `pinned`/`hidden` STALE. The next PrettyConversationsPanel
 * remount re-runs its hydrate effect, deriveDisk{Pinned,Hidden}Ids reads the
 * stale identities snapshot, and hydrate{Pinned,Hidden}IdsFromServer overwrites
 * the just-set local set — the pin/hide silently reverts on mobile navigate-
 * away-and-back (list→session→list unmounts the panel per AppShell.tsx L2632).
 *
 * Match by (hostId, identityKey) — falls back to bare-name match when hostId
 * is absent (pre-quick-260912-0t4 fixtures + relay-room callers without a
 * fleet hostId). No-op when the field is already the target value (idempotent
 * on double-clicks and hydrate-echo).
 */
export function patchIdentityFlag(
  identityKey: string,
  hostId: number | null,
  field: "pinned" | "hidden",
  value: boolean,
): void {
  const keyLc = identityKey.toLowerCase();
  let changed = false;
  const nextList = state.identities.map((i) => {
    const keyMatches = i.identityKey.toLowerCase() === keyLc;
    if (!keyMatches) return i;
    const hostMatches =
      hostId === null ||
      typeof i.hostId !== "number" ||
      i.hostId === hostId;
    if (!hostMatches) return i;
    if (i[field] === value) return i;
    changed = true;
    return { ...i, [field]: value };
  });
  if (!changed) return;
  setIdentities(nextList);
}

// ─── Private helper: sorted-key JSON serialization for roleDefaults ──────────
// Used by mergeIdentityAppearance to compare roleDefaults structurally rather
// than by reference. Mirrors the sorted-key serialization the backend's
// appearanceFingerprintSegment (Plan 111-03) uses for the wire fingerprint —
// same determinism requirement.
function sortedKeyJson(obj: Record<string, unknown> | null | undefined): string {
  if (obj == null) return "null";
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

// ─── Private helper: re-project pinned/hidden into conversation-store rows ───
/**
 * Phase 111 Plan 04 — re-project each identity's `pinned`/`hidden` fields into
 * the conversation-row id space. Called by `mergeIdentityAppearance` ONLY when
 * `pinned` or `hidden` actually changed, to move a row without touching
 * PrettyConversationsPanel.tsx (freshly fixed, 4,906 lines, "prefer not to
 * touch").
 *
 * Mirrors the panel's own hydrate effect body exactly, so the two paths are
 * always in sync: buildIdentityHostsFromFleet → deriveDiskPinnedIds →
 * hydratePinnedIdsFromServer → deriveDiskHiddenIds → hydrateHiddenIdsFromServer.
 *
 * GATED on state.loaded — see quick-260912-5q2. Before the `GET /identities`
 * fetch has landed, state.identities is a partial picture. hydratePinnedIdsFromServer
 * REPLACES the row-id set wholesale — projecting from a partial store would wipe
 * pins for every identity not yet fetched. A pulse merge on a not-yet-loaded
 * store is already a no-op (absent-key guard in mergeIdentityAppearance), so this
 * gate costs nothing.
 *
 * Uses buildIdentityHostsFromFleet, never a hand-rolled iteration. Its H2
 * invariant (sessionMatchKey null-return filters relay rooms + undefined
 * sessionName) is exactly the protection against crashes on relay-room sessions.
 */
function reprojectDiskPinHideIntoRows(): void {
  // quick-260912-5q2: a partial store projection wipes pins for every identity
  // not yet in state.identities. Only re-project once the full picture is live.
  if (!state.loaded) return;
  const identityHosts = buildIdentityHostsFromFleet(getFleetSessionsSnapshot());
  hydratePinnedIdsFromServer(deriveDiskPinnedIds(identityHosts));
  hydrateHiddenIdsFromServer(deriveDiskHiddenIds(identityHosts));
}

/**
 * Phase 111 Plan 04 — additive-merge door for the fleet-status pulse.
 *
 * PURPOSE + WHY A NEW DOOR IS NEEDED (D-10, bounty terminal-first-flash-on-
 * reload-plus-listener-leak):
 *   `identities-store` answers TWO questions with one piece of data: "what does
 *   this identity look like?" AND "is this an agent at all?" The second drives
 *   `isIdentityPane` in `tabUtils.tsx` — the expression
 *   `identitiesByKey.has(identityKey) || !identitiesLoaded`. If `loaded` flips
 *   true while `byKey` is missing any key, every other identity pane hits
 *   `false && true` → the false-Terminal branch → N xterms + N real SSH WS
 *   connections boot and unmount, leaking listeners. The 2026-09-08 comment
 *   block in fetchOnce exists solely to document this; the empty-map skip-guard
 *   below it exists solely to prevent it.
 *
 *   This function MUST NOT write `state.loaded`. The word `loaded` does not
 *   appear in this function's body except as `loaded: state.loaded` (carry-
 *   forward). `setIdentities` is never called from here.
 *
 * D-09 — ADDITIVE MERGE:
 *   An answer that knows less must never blank one that knew more. Both
 *   `undefined` AND `null` incoming fields are SKIPPED (never written). This
 *   means a title genuinely cleared on disk will not disappear from the list
 *   until the next `GET /identities` — the correct side to err on: a stale-
 *   but-dressed row is invisible to the user, while an undressed row is the
 *   bug this phase exists to remove.
 *
 * D-09 — ABSENT KEY IS NO-OP, NOT STAGING MAP:
 *   A side map would be a second place appearance lives — a second authority.
 *   The no-op is correct because `GET /identities` reads the same disk
 *   frontmatter through `publicIdentity()`, which calls the same merge
 *   authority (`identity-appearance.ts`), so the row arrives fully dressed
 *   from the fetch. The pulse's job is keeping it current, not bootstrapping.
 *
 * FIELD SET:
 *   Exactly the eleven the wire carries: displayName, title, colorHue, voice,
 *   task, coordinator, role, roleDefaults, avatarUrl, pinned, hidden.
 *   NOT avatarMime or avatarEtag (sweep has no source for them).
 *   NOT identityKey or hostId (those identify the row, not its appearance).
 *
 * pinned / hidden:
 *   These ARE written on a true→false transition. They are membership and
 *   position axes, not cosmetics — a `false` here is a real sentinel-probe
 *   fact, not an absence. The fail-closed handling already happened server-
 *   side (=== true in Plan 111-03), so values arriving here are definite
 *   booleans.
 */
export function mergeIdentityAppearance(
  hostId: number,
  identityKey: string,
  appearance: Partial<
    Pick<
      Identity,
      | "displayName"
      | "title"
      | "colorHue"
      | "voice"
      | "task"
      | "coordinator"
      | "role"
      | "roleDefaults"
      | "avatarUrl"
      | "pinned"
      | "hidden"
    >
  >,
): void {
  // 1. Guard inputs. A non-finite hostId cannot key byHostKey and would
  //    silently mis-serve lookups.
  if (!Number.isFinite(hostId) || !identityKey) return;

  const keyLc = identityKey.toLowerCase();

  // 2. Locate by composite key ONLY — never bare byKey. byKey collides by
  //    design (last wire-order wins) and is only safe for existence checks.
  //    A bare-name lookup here would serve host A's appearance to a same-named
  //    identity on host B. Copy the findIndex composite shape from
  //    applyIdentityChange's locate half — but NOT its bare-name fallback and
  //    NOT anything after the locate.
  const idx = state.identities.findIndex(
    (i) => i.identityKey.toLowerCase() === keyLc && i.hostId === hostId,
  );

  // 3. Absent → no-op + debug log. Do NOT append. Appending a partial row is
  //    the path that poisons byKey while loaded is true, which causes every
  //    other identity pane to hit the false-Terminal branch in isIdentityPane
  //    (tabUtils.tsx), booting N xterms + N real SSH WS connections that then
  //    unmount and leak listeners — see the 2026-09-08 block in fetchOnce.
  //    The fuller GET /identities will bring the row fully dressed because it
  //    goes through the same merge authority (identity-appearance.ts, Plan
  //    111-02), so nothing is lost by dropping this write.
  if (idx === -1) {
    console.debug({
      operation: "identities_store_appearance_merge_no_row",
      hostId,
      identityKey,
    });
    return;
  }

  // 4. Additive field-wise merge. Per-field equality check before assignment.
  const existing = state.identities[idx];
  let changed = false;
  let next = { ...existing };

  // null is skipped, not written (D-09). `identityAppearance.title === null`
  // means "this identity has no title right now", but it also arrives when the
  // identity file could not be read this tick — the two are indistinguishable
  // at this boundary. Skipping means a row never undresses. Tradeoff: a title
  // genuinely CLEARED on disk will not disappear from the list until the next
  // GET /identities. That is the correct side to err on.

  if (appearance.displayName !== undefined && appearance.displayName !== null) {
    if (next.displayName !== appearance.displayName) {
      next.displayName = appearance.displayName;
      changed = true;
    }
  }
  if (appearance.title !== undefined && appearance.title !== null) {
    if (next.title !== appearance.title) {
      next.title = appearance.title;
      changed = true;
    }
  }
  if (appearance.colorHue !== undefined && appearance.colorHue !== null) {
    if (next.colorHue !== appearance.colorHue) {
      next.colorHue = appearance.colorHue;
      changed = true;
    }
  }
  if (appearance.voice !== undefined && appearance.voice !== null) {
    if (next.voice !== appearance.voice) {
      next.voice = appearance.voice;
      changed = true;
    }
  }
  if (appearance.task !== undefined && appearance.task !== null) {
    if (next.task !== appearance.task) {
      next.task = appearance.task;
      changed = true;
    }
  }
  if (appearance.coordinator !== undefined && appearance.coordinator !== null) {
    if (next.coordinator !== appearance.coordinator) {
      next.coordinator = appearance.coordinator;
      changed = true;
    }
  }
  if (appearance.role !== undefined && appearance.role !== null) {
    if (next.role !== appearance.role) {
      next.role = appearance.role;
      changed = true;
    }
  }
  // roleDefaults is an object — compare by sorted-key serialization for
  // deterministic structural equality, matching the backend fingerprint's
  // discipline (Plan 111-03 appearanceFingerprintSegment). A redundant
  // reference-unequal but structurally-equal re-merge must NOT notify.
  if (appearance.roleDefaults !== undefined && appearance.roleDefaults !== null) {
    if (sortedKeyJson(appearance.roleDefaults as Record<string, unknown>) !== sortedKeyJson(next.roleDefaults as Record<string, unknown> | null | undefined)) {
      next.roleDefaults = appearance.roleDefaults;
      changed = true;
    }
  }
  if (appearance.avatarUrl !== undefined && appearance.avatarUrl !== null) {
    if (next.avatarUrl !== appearance.avatarUrl) {
      next.avatarUrl = appearance.avatarUrl;
      changed = true;
    }
  }
  // pinned / hidden are membership axes, not cosmetics. A `false` here is a
  // real fact from a sentinel probe — not an absence. DO write on true→false
  // transitions. The `undefined || null` skip only prevents "no data this tick"
  // from blanking "known data from before".
  let pinHidChanged = false;
  if (appearance.pinned !== undefined && appearance.pinned !== null) {
    if (next.pinned !== appearance.pinned) {
      next.pinned = appearance.pinned;
      changed = true;
      pinHidChanged = true;
    }
  }
  if (appearance.hidden !== undefined && appearance.hidden !== null) {
    if (next.hidden !== appearance.hidden) {
      next.hidden = appearance.hidden;
      changed = true;
      pinHidChanged = true;
    }
  }

  // 5. No-op suppression — copy patchIdentityFlag's shape. No state write,
  //    no notify when nothing changed.
  if (!changed) return;

  // 6. Write state WITHOUT setIdentities. Use reindex to normalize and rebuild
  //    both maps. Carry loaded forward — NEVER set it here.
  const nextList = state.identities.slice();
  nextList[idx] = next;
  state = { ...reindex(nextList), loaded: state.loaded };
  notify();

  // 7. Re-project pinned/hidden into conversation-store row-id sets only when
  //    a sentinel actually moved. Cosmetics-only merges must not pay the cost
  //    of two set rebuilds. Gate is in reprojectDiskPinHideIntoRows itself
  //    (gated on state.loaded per quick-260912-5q2).
  if (pinHidChanged) {
    reprojectDiskPinHideIntoRows();
  }
}

export function useIdentities(): {
  identities: Identity[];
  byKey: Map<string, Identity>;
  /** quick-260912-0t4: hostId-scoped composite-key map for cosmetics consumers.
   *  Key: `${hostId}::${identityKey.toLowerCase()}`. See State.byHostKey JSDoc
   *  for the additive-vs-rename rationale. */
  byHostKey: Map<string, Identity>;
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
    byHostKey: state.byHostKey,
    loaded: state.loaded,
    refresh: refreshIdentities,
  };
}

// ─── Test-only helpers ───────────────────────────────────────────────────────
// Phase 66 Plan 05 — reset the module-scoped state (identities snapshot +
// inflight promise + refresh-after-fleet-load guard) for identities-store
// enrichment tests. Not part of the public API; keeps prior test's state from
// leaking into the next test in the same vitest worker.
export function __resetIdentitiesStoreForTest(): void {
  state = {
    identities: [],
    byKey: new Map(),
    byHostKey: new Map(),
    loaded: false,
  };
  inflight = null;
  hasRefreshedAfterFleetLoad = false;
  notify();
}

// Phase 111 Plan 04 — read-only snapshot of the module-scoped state for
// identities-store enrichment tests. Exposes `loaded`, `identities`, `byKey`,
// and `byHostKey` so tests can assert D-10/D-09 invariants without going
// through the React hook (which needs a component + act()). Not part of the
// public API.
export function __getIdentitiesStoreSnapshotForTest(): {
  loaded: boolean;
  identities: Identity[];
  byKey: Map<string, Identity>;
  byHostKey: Map<string, Identity>;
} {
  return {
    loaded: state.loaded,
    identities: state.identities,
    byKey: state.byKey,
    byHostKey: state.byHostKey,
  };
}

// Phase 111 Plan 04 — seed identities WITHOUT setting loaded=true, for testing
// that mergeIdentityAppearance's loaded:state.loaded carry-forward is the ONLY
// thing preventing the D-10 violation when a merge fires before GET /identities
// has returned. Only used by the D-10 load-bearing breakage proof in Case 1.
// Not part of the public API.
export function __seedIdentitiesLoadedFalseForTest(list: Identity[]): void {
  state = { ...reindex(list), loaded: false };
  notify();
}
