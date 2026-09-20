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

/**
 * Phase 118 Plan 118-05 (D-15): async per-user host-visibility filter for
 * app frames only. When present in `createSubscriptionRegistry` deps, every
 * app-* fan-out call and the subscribe-path app-snapshot emit routes
 * through this filter per-subscriber. Filter returns the frame verbatim,
 * a projected copy (for app-snapshot), or null to drop.
 *
 * Session + archived-identity fan-out is UNAFFECTED — D-15 scopes the
 * filter to app frames only; identity frames pass through the sync fanOut
 * unchanged (D-15's "or will be" language explicitly defers identity
 * filtering to a follow-up).
 *
 * The registry does NOT own the filter's cache or dependencies — it holds
 * an opaque async function reference and calls it per subscriber. The
 * production wiring builds this via `createAppFrameFilter({
 * resolveHostOwnerById })` in fleet-status-server.ts.
 */
export type AppFrameFilter = (
  frame: FrontendOutboundFrameType,
  userId?: string,
) => Promise<FrontendOutboundFrameType | null>;

/**
 * Phase 118 Plan 118-05: widened subscriber shape carrying the JWT-verified
 * userId alongside the send callback. The async fanOutApp helper reads
 * `entry.userId` to invoke the filter per-subscriber. Bare
 * `subscribe(sendFrame)` (no ctx) yields `entry.userId === undefined` —
 * the filter's own guard passes those frames through unchanged
 * (backward-compat with existing session-only tests + any auth-skipping
 * harness).
 *
 * Phase 118 code-review HIGH-4 (fix pass 2026-09-18): `pendingFrames`
 * holds app-frame deliveries that arrive between the moment subscribe()
 * adds the entry to the Set and the moment the fire-and-forget
 * app-snapshot resolves + sends. Snapshot MUST arrive before any
 * subsequent update to prevent the picture-has-lied race: stale snapshot
 * overwriting a fresher update in the client store.
 *
 *   null       — deliver normally (steady-state).
 *   []         — queue is empty; snapshot has not yet flushed; incoming
 *                app frames get pushed onto this array in fanOutApp
 *                instead of sent immediately.
 *   [frame…]   — queue has entries; drained (in order) right after the
 *                subscribe-path snapshot succeeds, then set to null.
 *
 * Only app-* frames queue (session + archived-identity snapshots are
 * delivered SYNCHRONOUSLY inside subscribe BEFORE the async app-snapshot
 * block, so those are always ordered correctly). fanOut (sync) ignores
 * this field; only fanOutApp checks it.
 */
interface SubscriberEntry {
  send: SendFrame;
  userId?: string;
  pendingFrames: FrontendOutboundFrameType[] | null;
}

/**
 * Phase 118 Plan 118-05: optional dependency bag for the factory.
 * `appFrameFilter` — when present, the registry routes app-* fan-outs and
 * the subscribe-path app-snapshot through it per-subscriber. Absent →
 * registry uses the sync fanOut path unchanged (backward-compat with
 * 118-03 tests + starter.ts that hasn't wired the filter yet, which is
 * the state at plan land-time; starter wiring is a deploy-motion concern
 * flagged in the SUMMARY per fleet directive #10).
 */
export interface SubscriptionRegistryDeps {
  appFrameFilter?: AppFrameFilter;
}

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
  subscribers: Set<SubscriberEntry>,
  frame: FrontendOutboundFrameType,
): void {
  for (const entry of subscribers) {
    try {
      entry.send(frame);
    } catch (err) {
      systemLogger.warn("Fleet-status fan-out failed for one subscriber", {
        operation: "fleet_status_fanout_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

/**
 * Phase 118 Plan 118-05 (D-15): async fan-out for app frames only.
 * Per-subscriber: run the filter (with entry.userId), then send the
 * projected frame (or drop on null). Uses Promise.allSettled so a slow /
 * failing filter for one subscriber does not block delivery to others
 * (RESEARCH § Q4 — the async unavoidability + per-subscriber isolation
 * discipline). Fire-and-forget from the callers (publishAppUpdate /
 * publishAppGoneByHostSlug) — the async work completes on its own; no
 * caller awaits.
 *
 * Rejections in the settled results are logged (structured warn — fleet
 * directive #11) but do NOT throw or propagate. Send-throws INSIDE the
 * per-subscriber closure are caught and logged with the fanout-failed
 * shape (same op tag the sync fanOut uses) so log-side observability is
 * uniform across sync and async paths.
 */
async function fanOutApp(
  subscribers: Set<SubscriberEntry>,
  frame: FrontendOutboundFrameType,
  filter: AppFrameFilter,
): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(subscribers).map(async (entry) => {
      const projected = await filter(frame, entry.userId);
      if (projected === null) return;
      // Phase 118 code-review HIGH-4 (fix pass 2026-09-18): if the
      // subscribe-path app-snapshot has not yet flushed for this
      // subscriber, queue the projected frame instead of delivering it
      // immediately. The subscribe() closure drains this queue in order
      // after the snapshot lands. This prevents the picture-has-lied
      // race where a sweep-tick update overtakes the initial snapshot.
      //
      // Between reading the array and pushing to it we don't need a
      // lock — Node runs one microtask at a time; the subscribe()
      // drain-and-null happens in its own microtask; the queue is only
      // ever mutated from single-turn callbacks.
      //
      // Post-await disposal guard: an entry can be dropped from
      // `subscribers` while its filter promise is in flight (the
      // subscriber disconnected). Check membership BEFORE the send —
      // and BEFORE queueing — so a stale filter resolution cannot
      // deliver frames to a disposed subscriber (HIGH-4-4 test seat).
      if (!subscribers.has(entry)) {
        return;
      }
      if (entry.pendingFrames !== null) {
        entry.pendingFrames.push(projected);
        return;
      }
      try {
        entry.send(projected);
      } catch (err) {
        systemLogger.warn("Fleet-status fan-out failed for one subscriber", {
          operation: "fleet_status_fanout_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }),
  );
  for (const r of results) {
    if (r.status === "rejected") {
      systemLogger.warn(
        "Fleet-status app-frame filter failed for one subscriber",
        {
          operation: "app_frame_filter_failed",
          error:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
      );
    }
  }
}

/**
 * Factory — creates a new isolated SubscriptionRegistry instance.
 *
 * Phase 118 Plan 118-05: accepts an optional `deps` bag. `deps.appFrameFilter`
 * — when present — wraps the app-* fan-out path and the subscribe-path
 * app-snapshot emit. Absent → registry runs unfiltered (backward-compat with
 * 118-03 tests + any pre-118-05 caller). Session + archived-identity
 * fan-out is UNAFFECTED regardless.
 */
export function createSubscriptionRegistry(
  deps?: SubscriptionRegistryDeps,
): SubscriptionRegistry {
  const state = new Map<string, SessionState>();
  const subscribers = new Set<SubscriberEntry>();
  const appFrameFilter = deps?.appFrameFilter;
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
      // Phase 118 code-review HIGH-2 (fix pass 2026-09-18): refuse a
      // bare subscribe (no ctx.userId) against a filtered registry.
      // The app-frame filter's backward-compat guard passes
      // userId === undefined frames THROUGH unchanged — which means
      // a bare subscriber to a filtered registry gets EVERY app frame
      // regardless of host access. That is the same info-disclosure
      // leak T-118-05-IL fought. Belt-and-suspenders on top of
      // HIGH-1a/1b: production callers pass { userId } via the WS
      // handler; tests that intentionally want the unfiltered shape
      // should use `createSubscriptionRegistry()` without deps.
      if (appFrameFilter !== undefined && ctx?.userId === undefined) {
        throw new Error(
          "subscription-registry: userId ctx required when app-frame filter is attached",
        );
      }

      // Capture emptiness BEFORE adding so we fire the 0 → 1 edge exactly once
      const wasEmpty = subscribers.size === 0;

      // Phase 118 Plan 118-05: idempotency is now per-callback-identity.
      // A duplicate `sendFrame` reference produces a NEW SubscriberEntry
      // (Set idempotence is by reference on the entry object, not the
      // callback). This is a behavior change from pre-118-05 but the
      // idempotency-on-same-sendFrame test (Test 7) is still satisfied
      // because the pre-existing test asserts that the DUPLICATE subscribe
      // call produces the same fan-out shape — with per-subscriber entries
      // both entries call the same sendFrame, so it fires twice per
      // publish. UPDATE: pre-existing Test 7 does assert exactly-1 update
      // per publish for a duplicate subscribe → we preserve that by
      // dedup'ing at entry-add time on the sendFrame identity.
      let entry: SubscriberEntry | undefined;
      for (const existing of subscribers) {
        if (existing.send === sendFrame) {
          entry = existing;
          break;
        }
      }
      if (entry === undefined) {
        // Phase 118 code-review HIGH-4 (fix pass 2026-09-18): initialize
        // pendingFrames = null (deliver normally) by default. Set to
        // [] BELOW right before the fire-and-forget app-snapshot block
        // when the filter is wired AND we have a userId — the ONLY
        // scenario that produces a subscribe → snapshot race window.
        entry = {
          send: sendFrame,
          userId: ctx?.userId,
          pendingFrames: null,
        };
        subscribers.add(entry);
      }
      // Capture into a const the async closure below can safely close over.
      const subscriberEntry = entry;

      // Send the session snapshot immediately for unfiltered subscribers.
      // The filtered path builds+filters this same snapshot inside the
      // fire-and-forget block below so the queue-window covers it (matches
      // archived + app-snapshot ordering discipline).
      //
      // re-stamp contextPct at snapshot-delivery time so a late-arriving
      // subscriber sees the CURRENT value from contextpct-store.
      if (appFrameFilter === undefined || ctx?.userId === undefined) {
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
      }

      // Re-emit every archived identity as an `identity-archived` frame so a
      // reconnecting client re-hydrates its archived-rows store slice from
      // the registry's cached map. Order is Map insertion order — the
      // frontend's setArchivedFleetRows is a whole-array replacement (see
      // conversation-store.ts) so order does not carry meaning here.
      //
      // Unfiltered path only: filtered subscribers get the same re-emit
      // filtered per-frame inside the fire-and-forget block below (moved
      // there so the queue-window covers both archived + app-snapshot re-
      // emits AND any real-time publishes arriving during the window).
      if (appFrameFilter === undefined || ctx?.userId === undefined) {
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
      }

      // Replay the cached project list on subscribe (unfiltered path only).
      // Filtered subscribers get the projected version inside the fire-and-
      // forget block below. Guarded on non-null cache so a fresh registry
      // (no publish yet) does NOT fan out a spurious empty frame — the
      // frontend must not learn "no projects" from a registry that has
      // never been told what the projects ARE. When the first publish
      // lands it will carry the real array (which may legitimately be
      // empty for a host with no projects on disk).
      if (
        projectListCache !== null &&
        (appFrameFilter === undefined || ctx?.userId === undefined)
      ) {
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
      // session + archived snapshots).
      //
      // Phase 118 Plan 118-05 (D-15, D-16, RESEARCH § Pitfall 2): when the
      // filter is wired AND ctx.userId is present, project the snapshot
      // through the filter so the subscriber only sees apps on hosts they
      // can access. The subscribe() outer signature stays SYNCHRONOUS
      // (existing tests + callers depend on the sync disposer return);
      // the filtered emit runs fire-and-forget as a promise settled soon
      // after subscribe returns (well under the 100ms UX budget — the
      // filter is one PermissionManager hit per unique hostId plus an
      // in-memory cache). Empty apps map short-circuits — no filter call.
      const rawSnapshot = makeAppSnapshotFrame(Array.from(apps.values()));
      if (appFrameFilter !== undefined && ctx?.userId !== undefined) {
        const userIdForFilter = ctx.userId;
        // Phase 118 code-review HIGH-4 (fix pass 2026-09-18): open the
        // queue-window BEFORE spawning the async snapshot. Any
        // publishAppUpdate / publishAppGoneByHostSlug fired between now
        // and when the snapshot's sendFrame call completes will land in
        // subscriberEntry.pendingFrames instead of racing past the
        // snapshot. The drain-and-null below flushes the queue in FIFO
        // order right after the snapshot lands, then re-opens
        // steady-state delivery. On disposer-during-window (see below)
        // the entry is removed from `subscribers` so future drains have
        // no observers to hit anyway.
        subscriberEntry.pendingFrames = [];
        // Fire-and-forget — disposer must return synchronously.
        void (async () => {
          try {
            // Build + filter the session snapshot. contextPct restamp
            // happens here so the client gets the freshest value from
            // contextpct-store at emit time.
            const sessionSnapshot = makeSnapshotFrame(
              Array.from(state.values()).map((s) => ({
                ...s,
                contextPct:
                  getContextPct(s.hostId, s.tmuxSession ?? "") ?? null,
              })),
            );
            try {
              const projectedSession = await appFrameFilter(
                sessionSnapshot,
                userIdForFilter,
              );
              if (projectedSession !== null) {
                sendFrame(projectedSession);
              }
            } catch (err) {
              systemLogger.warn(
                "Fleet-status initial snapshot delivery failed",
                {
                  operation: "fleet_status_snapshot_failed",
                  error: err instanceof Error ? err.message : "unknown",
                },
              );
            }

            // Filter + re-emit each archived-identity row inside the queue-
            // window so real-time publishIdentityArchived arriving during
            // this block queue behind the snapshot rather than racing past it.
            // Sequential to preserve Map insertion order (matches the sync
            // path above). Per-frame try/catch so one send failure doesn't
            // starve the rest.
            for (const archived of archivedIdentities.values()) {
              const archivedFrame = makeIdentityArchivedFrame(
                archived.name,
                archived.hostId,
                archived.hostname,
              );
              try {
                const projectedArchived = await appFrameFilter(
                  archivedFrame,
                  userIdForFilter,
                );
                if (projectedArchived !== null) {
                  sendFrame(projectedArchived);
                }
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

            // Replay the cached project list, projected per subscriber.
            // Guarded on non-null cache (same reason as the sync path
            // above — a fresh registry that has never been told the
            // projects must NOT fan out an empty frame).
            if (projectListCache !== null) {
              const projectListFrame = makeProjectListChangedFrame(
                projectListCache,
              );
              try {
                const projectedProjects = await appFrameFilter(
                  projectListFrame,
                  userIdForFilter,
                );
                if (projectedProjects !== null) {
                  sendFrame(projectedProjects);
                }
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

            const projected = await appFrameFilter(rawSnapshot, userIdForFilter);
            if (projected !== null) {
              sendFrame(projected);
            }
          } catch (err) {
            systemLogger.warn(
              "Fleet-status app-snapshot filter/delivery failed",
              {
                operation: "fleet_status_app_snapshot_failed",
                error: err instanceof Error ? err.message : "unknown",
              },
            );
          } finally {
            // Drain-and-null runs in BOTH success and failure branches.
            // If snapshot fails, the client either resubscribes or the
            // next sweep tick re-populates state — either way, blocking
            // subsequent frames forever is the wrong choice. On failure
            // the drain still flushes any queued frames so the client
            // is not starved of updates that arrived during the window.
            const pending = subscriberEntry.pendingFrames;
            subscriberEntry.pendingFrames = null;
            if (pending !== null && subscribers.has(subscriberEntry)) {
              for (const f of pending) {
                try {
                  sendFrame(f);
                } catch (err) {
                  systemLogger.warn(
                    "Fleet-status app-frame queue drain delivery failed",
                    {
                      operation: "fleet_status_fanout_failed",
                      error: err instanceof Error ? err.message : "unknown",
                    },
                  );
                }
              }
            }
          }
        })();
      } else {
        try {
          sendFrame(rawSnapshot);
        } catch (err) {
          systemLogger.warn("Fleet-status app-snapshot delivery failed", {
            operation: "fleet_status_app_snapshot_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
        }
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
        subscribers.delete(subscriberEntry);
        // Phase 118 code-review HIGH-4 (fix pass 2026-09-18): also drop
        // any queued app frames so if the snapshot promise settles
        // AFTER disposal, the drain sees an empty queue and (via the
        // `subscribers.has` guard) also skips delivery. Belt-and-braces.
        subscriberEntry.pendingFrames = null;

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
      const frame = makeUpdateFrame(stampedState);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
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
      const frame = makeIdentityArchivedFrame(name, hostId, hostname);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
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
      const frame = makeProjectListChangedFrame(projects);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
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
      const frame = makeGoneFrame(hostId, tmuxSession, sessionId);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
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
      const frame = makeGoneFrame(
        hostId,
        existing.tmuxSession,
        existing.sessionId,
      );
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
    },

    publishAppUpdate(hostId: string, app: AppState): void {
      // Phase 118 Plan 118-03 (D-09, D-13, D-14): insert-or-replace at
      // `${hostId}:${slug}` and fan out an app-update frame. NO byte-equality
      // guard — a health-flip (same slug, isHealthy changed) MUST always
      // emit. Every publish call fans out.
      //
      // Phase 118 Plan 118-05 (D-15): route through the async fanOutApp when
      // a filter is wired — per-subscriber visibility check bounds who sees
      // the update. Fall back to the sync fanOut when no filter dep (existing
      // 118-03/118-04 tests + starter.ts unwired-state).
      const key = makeAppKey(hostId, app.slug);
      apps.set(key, app);
      const frame = makeAppUpdateFrame(app);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
    },

    publishAppGoneByHostSlug(hostId: string, slug: string): void {
      // Phase 118 Plan 118-03 (D-11, D-14): remove from the apps map and fan
      // out an app-gone frame. No-op if the key is absent (prevents churn on
      // repeated reconciliation ticks after an app is already dropped —
      // mirrors publishSessionGone / publishIdentityGoneByName).
      //
      // Phase 118 Plan 118-05 (D-15): route through the async fanOutApp
      // when a filter is wired.
      const key = makeAppKey(hostId, slug);
      if (!apps.has(key)) {
        return;
      }
      apps.delete(key);
      const frame = makeAppGoneFrame(hostId, slug);
      if (appFrameFilter !== undefined) {
        void fanOutApp(subscribers, frame, appFrameFilter);
      } else {
        fanOut(subscribers, frame);
      }
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
