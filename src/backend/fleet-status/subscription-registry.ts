/**
 * subscription-registry.ts
 *
 * In-memory registry of (hostId, tmuxSession) → SessionState plus a Set of
 * frontend-connection subscribers with snapshot + fan-out semantics.
 *
 * Key convention: `${hostId}:${tmuxSession ?? ''}` — mirrors session-working-store.ts.
 */
import { systemLogger } from "../utils/logger.js";
import type {
  AppState,
  FrontendOutboundFrameType,
  SessionState,
} from "./wire-protocol.js";
import {
  FRAME_SCHEMA_VERSION,
  makeAppGoneFrame,
  makeAppSnapshotFrame,
  makeAppUpdateFrame,
  makeGoneFrame,
  makeIdentityArchivedFrame,
  makeProjectListChangedFrame,
  makeSnapshotFrame,
  makeUpdateFrame,
} from "./wire-protocol.js";
// Phase 90 Plan 00 (Wave 0, 2026-09-08 — D-10 delivery mechanism):
// contextPct is PROMOTED from PrettyView-local useState to a per-session
// field on fleet-status. Every SessionState published + every snapshot frame
// carries the contextPct value read from the shared in-memory map, which is
// dual-written by the two `context_pct` WS emission sites in
// claude-session-server.ts (L3219 dormant + L7074 primary timer branch).
// See contextpct-store.ts docblock for the D-10 correctness invariant.
import { getContextPct } from "./contextpct-store.js";

type SendFrame = (frame: FrontendOutboundFrameType) => void;

// Phase 117 Plan 117-03 (D-37): shape of a project row on the
// project-list-changed frame. Mirrors the zod schema in
// wire-protocol.ts (FrontendProjectListChangedFrameSchema.projects).
//
// Phase 117 Plan 117-04: promoted to `export` so Wave 2 write routes
// (project-list.ts, session-project-write.ts) can typecheck the entries
// they build to hand to publishProjectListChanged. No runtime shape change.
export type ProjectListEntry = {
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
};

export interface SubscriptionRegistry {
  /**
   * Add a subscriber that will receive fleet-status frames.
   * Immediately sends a snapshot of current state.
   * Returns a disposer that removes the subscriber.
   *
   * @param sendFrame - Callback invoked with each outbound frame.
   * @param ctx - Optional { userId } context. When present AND the subscriber
   *   count transitions 0 → 1, every callback registered via
   *   onFirstSubscriber is fired with the ctx. Required by Phase 39
   *   Path C — the SSH-poll orchestrator uses ctx.userId as the subject
   *   for `resolveHostById(hostId, userId)` decrypt. Backward-compatible:
   *   existing callers may still call `subscribe(sendFrame)` with no ctx.
   */
  subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void;

  /**
   * Publish a new or updated SessionState for (hostId, state.tmuxSession).
   * Fans out an `update` frame to all subscribers.
   */
  publishSessionState(hostId: string, state: SessionState): void;

  /**
   * Phase 115 Plan 115-06 (D-06, D-18): publish an `identity-archived`
   * frame for a row sourced from the archive tree. Distinct from
   * publishSessionState — archived rows are NOT indexed in the session
   * map (D-06 inert semantics); the registry simply fans the frame out
   * to all current subscribers. Snapshot-on-subscribe behavior: archived
   * rows are re-emitted on every subscribe via the archivedIdentities
   * map maintained here so a reconnecting client sees the current
   * archive set as part of its initial state.
   */
  publishIdentityArchived(
    name: string,
    hostId: string,
    hostname: string,
  ): void;

  /**
   * Phase 117 Plan 117-03 (D-37): publish a project-list-changed frame
   * carrying the FULL projects array (not a delta — per RESEARCH § Open Q #4,
   * projects are cheap and full-replace matches the Phase 115 registry-
   * cache-then-fanout discipline).
   *
   * Snapshot-on-subscribe: reconnecting clients get the cached array
   * replayed on subscribe (mirrors the archivedIdentities replay pattern
   * in the subscribe() body).
   *
   * Idempotent: byte-identical array replay is a no-op via JSON.stringify
   * canonicalization compare against a single-cell cache. Cache-hit → no
   * fanout; cache-miss → cache is replaced and the frame fans out.
   *
   * Empty array is a valid state (represents "no projects on any host") —
   * publishing [] after a non-empty cache IS a delta and DOES fan out.
   */
  publishProjectListChanged(projects: ProjectListEntry[]): void;

  /**
   * Mark a session as gone. If the key exists in the map:
   *   - Removes it from the map
   *   - Fans out a `gone` frame to all subscribers
   * If the key does NOT exist, this is a no-op (prevents false-negative churn
   * from watcher restart cycles).
   */
  publishSessionGone(
    hostId: string,
    tmuxSession: string | null,
    sessionId: string,
  ): void;

  /**
   * Phase 115 hotfix (2026-09-18): identity-scoped "gone" for the per-host
   * sweep reconciliation. Looks up the cached SessionState at makeKey(hostId,
   * identityName) — source-B (dormant) publishes use tmuxSession = identity
   * name (see ssh-poll-orchestrator.ts) so the key composes identically.
   * Extracts the entry's own sessionId for the gone-frame fanout so the
   * frontend can correlate with the row it needs to drop. No-op if the key
   * doesn't exist (prevents churn on repeated reconciliation ticks after
   * an identity is already dropped).
   *
   * Distinct from publishSessionGone in that the caller doesn't need to
   * know the sessionId — the registry reads it from its own cache entry.
   * The reconciliation loop in ssh-poll-orchestrator knows the identity
   * name (from the previous tick's live-tree set), not the sessionId, so
   * this shape is the ergonomic fit for that call site.
   */
  publishIdentityGoneByName(hostId: string, identityName: string): void;

  /**
   * Phase 118 Plan 118-03 (D-09, D-13, D-14): publish an add/mutate for one
   * source-C app. The apps map is indexed by `${hostId}:${slug}` (a separate
   * key helper `makeAppKey` — NOT reused with makeKey because slug and
   * tmuxSession could collide in a shared map; here they live in different
   * maps but the helper carries the discipline).
   *
   * NO byte-equality idempotence guard — D-13 requires that a health-flip
   * (same slug, isHealthy changed) always emits an app-update. Every publish
   * call fans out.
   *
   * Called from ssh-poll-orchestrator.ts (Plan 118-04) inside the per-host
   * successful-sweep loop.
   */
  publishAppUpdate(hostId: string, app: AppState): void;

  /**
   * Phase 118 Plan 118-03 (D-11, D-14): remove one source-C app from the map
   * and fan out an app-gone frame. No-op when the key is absent (prevents
   * churn on repeated reconciliation ticks after an app is already dropped).
   * Called from ssh-poll-orchestrator.ts (Plan 118-04) per-host reconciliation.
   */
  publishAppGoneByHostSlug(hostId: string, slug: string): void;

  /**
   * Return all current AppState values as an array (order not guaranteed).
   * Symmetric with getSnapshot() for sessions.
   */
  getAppSnapshot(): AppState[];

  /**
   * Return all current SessionState values as an array (order not guaranteed).
   */
  getSnapshot(): SessionState[];

  /**
   * Register a callback fired ONCE on the 0 → 1 subscribers transition
   * (i.e. exactly when the registry becomes non-empty via `subscribe`).
   * The callback receives the ctx passed to that subscribe() call.
   *
   * Returns a disposer that unregisters the callback.
   *
   * Semantics:
   *   - Fires only when ctx was provided to subscribe(). A no-ctx
   *     subscribe does NOT fire onFirstSubscriber (Phase 39 backward-compat).
   *   - Re-fires on subsequent 0 → 1 cycles (subscribe → dispose → subscribe).
   *   - Callback exceptions are caught + logged; they never bubble to subscribe().
   *
   * Phase 39 D-01 (GATE2-01): wired by starter.ts to start the SSH-poll orchestrator.
   */
  onFirstSubscriber(cb: (ctx: { userId: string }) => void): () => void;

  /**
   * Register a callback fired ONCE on the 1 → 0 subscribers transition
   * (i.e. when the last subscriber's disposer runs).
   *
   * Returns a disposer that unregisters the callback.
   *
   * Semantics:
   *   - Fires when subscribers.size transitions to 0 via disposer invocation.
   *   - Re-fires on subsequent 1 → 0 cycles.
   *   - Callback exceptions are caught + logged; they never bubble to disposer().
   *
   * Phase 39 D-02 (GATE2-02): wired by starter.ts to stop the SSH-poll orchestrator.
   */
  onLastUnsubscriber(cb: () => void): () => void;
}

function makeKey(hostId: string, tmuxSession: string | null): string {
  return `${hostId}:${tmuxSession ?? ""}`;
}

/**
 * Phase 118 Plan 118-03 (D-09, T-118-03-KC): compose the key for the sibling
 * apps map. Kept DISTINCT from makeKey — the two callers live in different
 * maps (the apps map vs. the session state map), so byte-level string
 * collisions between a slug and a tmuxSession are structurally impossible
 * here; the named helper mirrors the makeKey precedent for readability and
 * keeps the discipline that slugs and tmuxSessions are NEVER interchangeable.
 */
function makeAppKey(hostId: string, slug: string): string {
  return `${hostId}:${slug}`;
}

function fanOut(
  subscribers: Set<SendFrame>,
  frame: FrontendOutboundFrameType,
): void {
  for (const send of subscribers) {
    try {
      send(frame);
    } catch (err) {
      systemLogger.warn("Fleet-status fan-out failed for one subscriber", {
        operation: "fleet_status_fanout_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

/**
 * Factory — creates a new isolated SubscriptionRegistry instance.
 */
export function createSubscriptionRegistry(): SubscriptionRegistry {
  const state = new Map<string, SessionState>();
  const subscribers = new Set<SendFrame>();
  // Phase 39 — presence signals for Path C (D-01 / D-02)
  const firstSubCallbacks = new Set<(ctx: { userId: string }) => void>();
  const lastUnsubCallbacks = new Set<() => void>();
  // Phase 115 Plan 115-06 (D-06, D-18): archived-tree row cache. Keyed on
  // `${hostId}::${name}` so cross-host name collisions produce distinct
  // entries (per RESEARCH §5 — should not happen in practice; if it does,
  // both survive). Snapshot-on-subscribe re-emits every entry so a
  // reconnecting client sees the current archive set as part of its
  // initial state. Never removed here — retire-flow's folder-move happens
  // once and the row lives until the next sweep tick clears it. If a
  // future phase wants to un-archive, add a `publishIdentityUnarchived`
  // + corresponding delete + `identity-unarchived` frame; for now (D-05
  // out of scope) the map only grows.
  const archivedIdentities = new Map<
    string,
    { name: string; hostId: string; hostname: string }
  >();
  // Phase 117 Plan 117-03 (D-37): single-cell cache for the projects pool.
  // The wire event carries the WHOLE array on every emit (per RESEARCH §
  // Open Q #4 — full-replace, not delta), so a single nullable cell is
  // enough. `null` means "no publish has occurred yet" — snapshot-on-
  // subscribe skips the project-list replay in that state. Idempotent-skip
  // in publishProjectListChanged compares JSON.stringify(projects) against
  // JSON.stringify(projectListCache) to drop no-op republishes at cache-hit.
  let projectListCache: ProjectListEntry[] | null = null;
  // Phase 118 Plan 118-03 (D-09): sibling map for source-C apps, indexed by
  // `${hostId}:${slug}` via makeAppKey. Populated by publishAppUpdate, drained
  // by publishAppGoneByHostSlug, and re-emitted to every new subscriber via
  // subscribe() as an app-snapshot frame. In-memory only per D-10 — no DB
  // persistence, restart wipes it, next successful sweep tick rebuilds it
  // from disk-on-boxes.
  const apps = new Map<string, AppState>();

  return {
    subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void {
      // Capture emptiness BEFORE adding so we fire the 0 → 1 edge exactly once
      const wasEmpty = subscribers.size === 0;

      // Idempotent — Set ignores duplicates by reference
      subscribers.add(sendFrame);

      // Immediately send a snapshot of current state.
      //
      // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism): re-stamp
      // contextPct at snapshot-delivery time so a late-arriving subscriber
      // sees the CURRENT value, not the value stored at the last
      // publishSessionState tick. Uses the same store-read the publish path
      // uses; null when the store has no entry.
      const snapshot = makeSnapshotFrame(
        Array.from(state.values()).map((s) => ({
          ...s,
          contextPct: getContextPct(s.hostId, s.tmuxSession ?? "") ?? null,
        })),
      );
      try {
        sendFrame(snapshot);
      } catch (err) {
        systemLogger.warn("Fleet-status initial snapshot delivery failed", {
          operation: "fleet_status_snapshot_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }

      // Phase 115 Plan 115-06 (D-06, D-18): re-emit every archived identity
      // as an `identity-archived` frame so a reconnecting client re-hydrates
      // its archived-rows store slice from the registry's cached map. Order
      // is Map insertion order — the frontend's setArchivedFleetRows is a
      // whole-array replacement (see conversation-store.ts) so order does
      // not carry meaning here.
      for (const entry of archivedIdentities.values()) {
        try {
          sendFrame(
            makeIdentityArchivedFrame(entry.name, entry.hostId, entry.hostname),
          );
        } catch (err) {
          systemLogger.warn(
            "Fleet-status archived-identity snapshot delivery failed",
            {
              operation: "fleet_status_archived_snapshot_failed",
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        }
      }

      // Phase 117 Plan 117-03 (D-37): replay the cached project list on
      // subscribe. Guarded on non-null cache so a fresh registry (no publish
      // yet) does NOT fan out a spurious empty frame — the frontend must not
      // learn "no projects" from a registry that has never been told what
      // the projects ARE. When the first publish lands it will carry the
      // real array (which may legitimately be empty for a host with no
      // projects on disk).
      if (projectListCache !== null) {
        try {
          sendFrame(makeProjectListChangedFrame(projectListCache));
        } catch (err) {
          systemLogger.warn(
            "Fleet-status project-list snapshot delivery failed",
            {
              operation: "fleet_status_project_list_snapshot_failed",
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        }
      }

      // Phase 118 Plan 118-03 (D-14, D-16): re-emit the current apps map as
      // one app-snapshot frame so a reconnecting client sees the current app
      // picture without waiting for the next 2s sweep tick. Emit is
      // UNCONDITIONAL — an empty apps map still produces an app-snapshot with
      // apps: [] (a valid state — proves the emit happens alongside the
      // session + archived snapshots). The per-user host-visibility filter is
      // NOT applied here at this phase; Plan 118-05 will wrap this emit and
      // the publishApp* fanouts with the filter (see T-118-03-IL: 118-05 MUST
      // land in the same deploy as 118-03 + 118-04 to close the info-
      // disclosure gap).
      try {
        sendFrame(makeAppSnapshotFrame(Array.from(apps.values())));
      } catch (err) {
        systemLogger.warn(
          "Fleet-status app-snapshot delivery failed",
          {
            operation: "fleet_status_app_snapshot_failed",
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }

      // Phase 39 — fire onFirstSubscriber callbacks on 0 → 1 transition when ctx is provided.
      // Callbacks isolated by try/catch so consumer bugs cannot break subscribe().
      if (wasEmpty && ctx) {
        for (const cb of firstSubCallbacks) {
          try {
            cb(ctx);
          } catch (err) {
            systemLogger.warn(
              "Fleet-status onFirstSubscriber callback threw",
              {
                operation: "fleet_status_lifecycle_cb_failed",
                error: err instanceof Error ? err.message : "unknown",
              },
            );
          }
        }
      }

      // Return disposer
      return () => {
        subscribers.delete(sendFrame);

        // Phase 39 — fire onLastUnsubscriber callbacks on 1 → 0 transition.
        // Same try/catch isolation pattern as onFirstSubscriber.
        if (subscribers.size === 0) {
          for (const cb of lastUnsubCallbacks) {
            try {
              cb();
            } catch (err) {
              systemLogger.warn(
                "Fleet-status onLastUnsubscriber callback threw",
                {
                  operation: "fleet_status_lifecycle_cb_failed",
                  error: err instanceof Error ? err.message : "unknown",
                },
              );
            }
          }
        }
      };
    },

    publishSessionState(hostId: string, sessionState: SessionState): void {
      const key = makeKey(hostId, sessionState.tmuxSession);
      // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism): stamp contextPct
      // from the shared in-memory store at publish time. `null` when the
      // store has no entry OR when the latest stored value is null (dormant
      // sentinel / cold session). tmuxSession is nullable on the wire; when
      // null the store lookup uses the empty-string key convention shared
      // with session-working-store.ts. The stamp is UNCONDITIONAL — every
      // frame carries the current value, so subscribers see the freshest
      // contextPct on the very next fleet-status frame after a store write.
      const stampedState: SessionState = {
        ...sessionState,
        contextPct: getContextPct(hostId, sessionState.tmuxSession ?? "") ?? null,
      };
      state.set(key, stampedState);
      fanOut(subscribers, makeUpdateFrame(stampedState));
    },

    publishIdentityArchived(
      name: string,
      hostId: string,
      hostname: string,
    ): void {
      const key = `${hostId}::${name}`;
      const existing = archivedIdentities.get(key);
      // Idempotent: if the registry already knows this archived identity
      // with byte-identical fields, no fanout. Prevents per-tick churn on
      // the WS when the sweep just re-observes the same archive-tree row.
      if (
        existing !== undefined &&
        existing.name === name &&
        existing.hostId === hostId &&
        existing.hostname === hostname
      ) {
        return;
      }
      archivedIdentities.set(key, { name, hostId, hostname });
      fanOut(subscribers, makeIdentityArchivedFrame(name, hostId, hostname));
    },

    publishProjectListChanged(projects: ProjectListEntry[]): void {
      // Deep-equal skip via JSON.stringify canonicalization. Field types
      // are small strings + booleans; stringify cost is O(N × avg field
      // size) which for realistic N (< 20 projects) is negligible per
      // RESEARCH § Pitfall 4. `null` cache serializes to the literal
      // string "null" which cannot collide with any valid array
      // serialization ("[...]"), so a first publish after registry
      // creation always fans out.
      const nextSerialized = JSON.stringify(projects);
      const prevSerialized =
        projectListCache === null ? null : JSON.stringify(projectListCache);
      if (prevSerialized === nextSerialized) {
        return;
      }
      // Defensive copy so a caller mutating the array post-publish cannot
      // silently corrupt the cache (and thus poison future idempotent-skip
      // comparisons and snapshot-on-subscribe replays).
      projectListCache = projects.slice();
      fanOut(subscribers, makeProjectListChangedFrame(projects));
    },

    publishSessionGone(
      hostId: string,
      tmuxSession: string | null,
      sessionId: string,
    ): void {
      const key = makeKey(hostId, tmuxSession);

      // No-op if key doesn't exist — prevents false churn on watcher restarts
      if (!state.has(key)) {
        return;
      }

      state.delete(key);
      fanOut(
        subscribers,
        makeGoneFrame(hostId, tmuxSession, sessionId),
      );
    },

    publishIdentityGoneByName(hostId: string, identityName: string): void {
      // Source-B publishes with tmuxSession = identityName, so the cache key
      // for a dormant identity composes as makeKey(hostId, identityName).
      // Look up the entry to extract its sessionId for the gone-frame fanout.
      const key = makeKey(hostId, identityName);
      const existing = state.get(key);
      if (existing === undefined) {
        return;
      }
      state.delete(key);
      fanOut(
        subscribers,
        makeGoneFrame(hostId, existing.tmuxSession, existing.sessionId),
      );
    },

    publishAppUpdate(hostId: string, app: AppState): void {
      // Phase 118 Plan 118-03 (D-09, D-13, D-14): insert-or-replace at
      // `${hostId}:${slug}` and fan out an app-update frame. NO byte-equality
      // guard — a health-flip (same slug, isHealthy changed) MUST always
      // emit. Every publish call fans out.
      const key = makeAppKey(hostId, app.slug);
      apps.set(key, app);
      fanOut(subscribers, makeAppUpdateFrame(app));
    },

    publishAppGoneByHostSlug(hostId: string, slug: string): void {
      // Phase 118 Plan 118-03 (D-11, D-14): remove from the apps map and fan
      // out an app-gone frame. No-op if the key is absent (prevents churn on
      // repeated reconciliation ticks after an app is already dropped —
      // mirrors publishSessionGone / publishIdentityGoneByName).
      const key = makeAppKey(hostId, slug);
      if (!apps.has(key)) {
        return;
      }
      apps.delete(key);
      fanOut(subscribers, makeAppGoneFrame(hostId, slug));
    },

    getAppSnapshot(): AppState[] {
      // Phase 118 Plan 118-03 — symmetric with getSnapshot() for sessions.
      // Order is Map insertion order; callers must not depend on it.
      return Array.from(apps.values());
    },

    getSnapshot(): SessionState[] {
      // Phase 90 Plan 00 (Wave 0) — re-stamp contextPct from the shared
      // store at read time so callers always see the CURRENT value, matching
      // the fanout semantics of publishSessionState + subscribe's snapshot.
      return Array.from(state.values()).map((s) => ({
        ...s,
        contextPct: getContextPct(s.hostId, s.tmuxSession ?? "") ?? null,
      }));
    },

    onFirstSubscriber(cb: (ctx: { userId: string }) => void): () => void {
      firstSubCallbacks.add(cb);
      return () => {
        firstSubCallbacks.delete(cb);
      };
    },

    onLastUnsubscriber(cb: () => void): () => void {
      lastUnsubCallbacks.add(cb);
      return () => {
        lastUnsubCallbacks.delete(cb);
      };
    },
  };
}

// Re-export the FRAME_SCHEMA_VERSION for consumers that need it
export { FRAME_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// Phase 117 Plan 117-04: module-level singleton accessor.
//
// The registry is created in `starter.ts` and dep-injected into
// fleet-status-server + ssh-poll-orchestrator. Database routes (like
// `project-list.ts` and `session-project-write.ts`) mount inside
// `database.ts` before starter.ts creates the registry — so they cannot
// receive it via a constructor argument.
//
// Rather than plumbing the registry down through the Express app locals
// or a request middleware, the router calls `getSubscriptionRegistry()`
// at REQUEST time (not module-import time). By the time an HTTP request
// hits the route, starter.ts has already run and called
// `setSubscriptionRegistry(registry)` — so the accessor returns the same
// instance the WS server is fanning out through.
//
// If the accessor is called before starter.ts has populated the cell
// (e.g. in a test that only mounts the router without a registry), it
// returns `null` — the route's fanout call becomes a no-op rather than
// crashing.
// ---------------------------------------------------------------------------

let sharedRegistry: SubscriptionRegistry | null = null;

/**
 * Set the process-wide singleton registry. Called exactly once by
 * `starter.ts` after `createSubscriptionRegistry()` — same instance that
 * is dep-injected into the WS server and the SSH-poll orchestrator, so
 * every publish path fans out through the SAME subscriber set.
 */
export function setSubscriptionRegistry(
  registry: SubscriptionRegistry,
): void {
  sharedRegistry = registry;
}

/**
 * Access the process-wide singleton registry. Returns `null` if the
 * registry has not been set yet — callers MUST tolerate null (typically
 * by skipping the fanout with a warn log). Do NOT throw on null; the
 * absence of a registry means the WS layer is not initialized, not that
 * the caller is misusing the API.
 */
export function getSubscriptionRegistry(): SubscriptionRegistry | null {
  return sharedRegistry;
}

/**
 * Test-only reset for the module-level cell. Vitest suites that create
 * their own registry should call this in `afterEach` to prevent leakage
 * across test files.
 */
export function __resetSubscriptionRegistryForTests(): void {
  sharedRegistry = null;
}
