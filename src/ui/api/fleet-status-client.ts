/**
 * fleet-status-client.ts — browser-side WebSocket client for /fleet-status/ws
 *
 * Phase 34 Plan 06: boot-time singleton owned by AppShell. Parses
 * snapshot/update/gone frames from the fleet-status backend and dispatches
 * them to session-working-store + session-waiting-store via callbacks.
 *
 * Reconnect pattern: mirrors the patch #148 backoff from PrettyView.tsx
 * (proven in production). Backoff schedule: 2s, 4s, 6s, 8s, 8s (≈28s total),
 * then settles into an indefinite slow retry at SLOW_RETRY_MS (~30s) rather
 * than going permanently deaf (D-11). Full-jitter draw preserved on every cap
 * so a multi-tab restore does not re-clump the herd (D-13).
 *
 * Phase 111 Plan 06 (D-11, D-12, D-13):
 *   - After the backoff ladder is exhausted the client never gives up — it
 *     settles into a ~30s steady retry indefinitely. A phone in a pocket is
 *     the normal case; permanent deafness is the failure case.
 *   - Becoming visible reconnects immediately rather than waiting for the next
 *     slow retry (D-12). This is cross-platform (not iOS-PWA only — see the
 *     comment inside handleVisibilityChange).
 *   - The transition to slow-retry emits `fleet_status_client_slow_retry` ONCE.
 *     Any dashboard matching the retired gave-up operation string
 *     ("fleet_status_client_" + "gave_up") should be re-pointed at this new
 *     operation string.
 *   - No sequence-reconciliation, no gap-fill, no missed-event recovery (D-13).
 *     The reconnect sends a `subscribe` frame; the server answers with its held
 *     Map as a full snapshot. That snapshot IS the current picture and IS the
 *     backstop.
 *   - Budget owners: `reconnectAttempts` is reset in exactly two places —
 *     `ws.onopen` (successful connection) and the visible branch of the
 *     visibilitychange handler (user intent). No other site may reset it.
 *
 * Structured logging: console.info / console.warn with the same structured-fields
 * shape as the backend's systemLogger, grep-discoverable by `operation:` key.
 * NEVER serialize DOM Event objects via JSON.stringify — always extract fields explicitly.
 * Per T-34-20 (Repudiation mitigation) and the structured logging directive.
 *
 * Security (T-34-18 — Tampering):
 *   JSON.parse wrapped in try/catch. Malformed frames log + drop; connection
 *   stays open. The backend validates outbound frames via zod; the browser
 *   trusts contents but never lets a parse error crash the client.
 */

import { useSyncExternalStore } from "react";
import type {
  AppState,
  FrontendOutboundFrame,
  ProjectListEntry,
  SessionState,
} from "./fleet-status-types.js";
import { FRAME_SCHEMA_VERSION } from "./fleet-status-types.js";

// ---------------------------------------------------------------------------
// Constants — mirror patch #148 backoff schedule verbatim
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 5; // ladder length; no longer gates a terminal give-up (D-11)
const BACKOFF_SCHEDULE_MS = [2000, 4000, 6000, 8000, 8000] as const;

// D-11: after the ladder is exhausted the client settles into this slow steady
// retry indefinitely — cheap when nothing is listening; never unrecoverably deaf.
const SLOW_RETRY_MS = 30_000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface FleetStatusClientOptions {
  url: string;
  onSnapshot: (states: SessionState[]) => void;
  onUpdate: (state: SessionState) => void;
  onGone: (hostId: string, tmuxSession: string | null, sessionId: string) => void;
  /**
   * Phase 117 Plan 117-06 (D-37): fired on every `project-list-changed`
   * frame from the backend (published by
   * subscription-registry.publishProjectListChanged after every project
   * create / archive / session project assignment; also re-emitted on WS
   * reconnect via the registry snapshot replay). AppShell routes these into
   * conversation-store's projects slice (setProjects) so the sidebar
   * re-derives its per-project buckets. Optional for backward-compat with
   * tests that don't need the callback.
   */
  onProjectListChanged?: (projects: ProjectListEntry[]) => void;
  /**
   * Fired on every `session-project-changed` frame — a per-identity delta
   * emitted by the backend when an identity's `project:` frontmatter is
   * written (sidebar drag-drop onto a project, or clear). Distinct from
   * `onProjectListChanged`: the projects[] array is unchanged; only which
   * identity belongs to which project has moved. AppShell routes this into
   * the identities store's `setIdentityProject` to patch the affected row
   * in place without a full /identities refetch.
   *
   * `project` is nullable: string = assigned to slug; null = cleared.
   */
  onSessionProjectChanged?: (
    identityKey: string,
    hostId: number,
    project: string | null,
  ) => void;
  // Phase 119 Plan 119-01 (D-14, D-16): fired on every `app-snapshot` /
  // `app-update` / `app-gone` frame from the Phase 118 app-registry
  // channel. Later 117-* plans wire these to the new app-tiles store
  // slice's publish fns (`publishAppSnapshot` / `publishAppUpdate` /
  // `publishAppGone`) in AppShell. Optional because this task adds the
  // dispatch primitive standalone — the store slice + AppShell wiring
  // land in follow-up plans. Omitting all three MUST NOT throw when app
  // frames arrive (regression-tested in fleet-status-client.test.ts).
  onAppSnapshot?: (apps: AppState[]) => void;
  onAppUpdate?: (app: AppState) => void;
  onAppGone?: (hostId: string, slug: string) => void;
}

export interface FleetStatusClient {
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fleet-status WebSocket client. Opens immediately and reconnects on
 * drop. Call `dispose()` on AppShell unmount to cancel timers and close the
 * socket cleanly.
 */
export function createFleetStatusClient(
  opts: FleetStatusClientOptions,
): FleetStatusClient {
  const {
    url,
    onSnapshot,
    onUpdate,
    onGone,
    onProjectListChanged,
    onSessionProjectChanged,
    onAppSnapshot,
    onAppUpdate,
    onAppGone,
  } = opts;

  let reconnectAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let disposed = false;

  function connect(): void {
    if (disposed) return;

    console.info({
      operation: "fleet_status_client_connecting",
      url,
      attempt: reconnectAttempts,
    });

    ws = new WebSocket(url);

    ws.onopen = () => {
      if (disposed) {
        ws?.close();
        return;
      }
      console.info({
        operation: "fleet_status_client_open",
        url,
      });
      // Budget owner 1 of 2: reset on successful connection. The two budget
      // owners are ws.onopen (success) and the visible branch of the
      // visibilitychange handler (user intent). No other site resets this.
      reconnectAttempts = 0;
      // Send subscribe frame per wire protocol
      try {
        ws!.send(
          JSON.stringify({
            schemaVersion: FRAME_SCHEMA_VERSION,
            type: "subscribe",
          }),
        );
      } catch (err) {
        console.warn({
          operation: "fleet_status_client_send_error",
          url,
          errMessage: err instanceof Error ? err.message : String(err),
        });
      }
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (disposed) return;

      let parsed: FrontendOutboundFrame;
      try {
        parsed = JSON.parse(evt.data) as FrontendOutboundFrame;
      } catch (err) {
        console.warn({
          operation: "fleet_status_client_parse_error",
          url,
          errMessage: err instanceof Error ? err.message : String(err),
        });
        return; // drop malformed frame; connection stays open (T-34-18)
      }

      // Discriminated-union dispatch on frame type
      switch (parsed.type) {
        case "snapshot":
          console.info({
            operation: "fleet_status_client_snapshot",
            url,
            stateCount: parsed.states.length,
          });
          // Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, user
          // 2026-09-08 D-03 waiver): publish per-session contextPct into
          // the co-located store so useSessionContextPct consumers
          // (PrettyView post-swap, future relay-pane badge appendage)
          // re-render on the very next snapshot with fresh values. The
          // user's onSnapshot callback fires AFTER — matches the existing
          // ordering discipline in AppShell where session-working-store,
          // session-waiting-store, session-tmux-store all publish first.
          for (const s of parsed.states) {
            publishSessionContextPct(s.hostId, s.tmuxSession, s.contextPct ?? null);
          }
          onSnapshot(parsed.states);
          break;
        case "update":
          console.info({
            operation: "fleet_status_client_update",
            url,
            hostId: parsed.state.hostId,
            tmuxSession: parsed.state.tmuxSession,
            sessionId: parsed.state.sessionId,
            status: parsed.state.status,
          });
          publishSessionContextPct(
            parsed.state.hostId,
            parsed.state.tmuxSession,
            parsed.state.contextPct ?? null,
          );
          onUpdate(parsed.state);
          break;
        case "gone":
          console.info({
            operation: "fleet_status_client_gone",
            url,
            hostId: parsed.hostId,
            tmuxSession: parsed.tmuxSession,
            sessionId: parsed.sessionId,
          });
          // Clean up the contextPct entry so a session-not-in-fleet returns
          // null on the hook (D-10 correctness — no stale reading).
          publishSessionContextPctGone(parsed.hostId, parsed.tmuxSession);
          onGone(parsed.hostId, parsed.tmuxSession, parsed.sessionId);
          break;
        case "pong":
          // No-op — keepalive reply
          break;
        case "project-list-changed":
          // Phase 117 Plan 117-06 (D-37): distinct wire message published by
          // subscription-registry.publishProjectListChanged after every
          // project create / archive / session-project assignment (117-04 +
          // 117-05). Routes into the frontend's projects store slice via
          // the AppShell-provided onProjectListChanged callback
          // (setProjects on conversation-store — sidebar re-derives buckets).
          //
          // Rule-2 correctness guard (Phase 117 Plan 117-06): the browser
          // skips zod validation on inbound frames per fleet-status-types.ts,
          // so a malformed frame with `projects` set to a non-array would
          // reach here after JSON.parse. Short-circuit before invoking the
          // callback so consumers cannot observe garbage payloads.
          if (!Array.isArray(parsed.projects)) {
            console.warn({
              operation: "fleet_status_client_project_list_changed_malformed",
              url,
              projectsType: typeof parsed.projects,
            });
            break;
          }
          console.info({
            operation: "fleet_status_client_project_list_changed",
            url,
            projectCount: parsed.projects.length,
          });
          onProjectListChanged?.(parsed.projects);
          break;
        case "session-project-changed":
          // Per-identity delta from backend session-project-write. The frame
          // carries { identityKey, hostId, project } — no array to
          // shape-validate beyond what JSON.parse guarantees. Log for
          // observability and hand to AppShell's patch-in-place callback.
          console.info({
            operation: "fleet_status_client_session_project_changed",
            url,
            identityKey: parsed.identityKey,
            hostId: parsed.hostId,
            project: parsed.project,
          });
          onSessionProjectChanged?.(
            parsed.identityKey,
            parsed.hostId,
            parsed.project,
          );
          break;
        case "app-snapshot":
          // Phase 119 Plan 119-01 (D-14, D-16): Phase 118 app-registry
          // snapshot on subscribe (also re-emitted on WS reconnect). Later
          // 117-* plans wire the callback to publishAppSnapshot on the new
          // app-tiles store slice, which clears-and-repopulates the store
          // atomically (D-14 no partial states). Callback is optional so
          // this task can land standalone ahead of the store slice.
          console.info({
            operation: "fleet_status_client_app_snapshot",
            url,
            appCount: parsed.apps.length,
          });
          onAppSnapshot?.(parsed.apps);
          break;
        case "app-update":
          // Phase 119 Plan 119-01 (D-14): one app-state add / mutate on
          // the Phase 118 channel. Health-flips (same slug, isHealthy
          // changed) always emit — backend does NOT deduplicate — so
          // consumers can rely on the callback firing whenever the tile's
          // rendered state should update.
          console.info({
            operation: "fleet_status_client_app_update",
            url,
            hostId: parsed.app.hostId,
            slug: parsed.app.slug,
            isHealthy: parsed.app.isHealthy,
          });
          onAppUpdate?.(parsed.app);
          break;
        case "app-gone":
          // Phase 119 Plan 119-01 (D-14): the app dropped out of the sweep
          // (unit removed OR host lost visibility). Store slice deletes by
          // `${hostId}:${slug}` compound key on receipt.
          console.info({
            operation: "fleet_status_client_app_gone",
            url,
            hostId: parsed.hostId,
            slug: parsed.slug,
          });
          onAppGone?.(parsed.hostId, parsed.slug);
          break;
        default:
          // Unknown frame type — drop silently (forward-compatible)
          break;
      }
    };

    ws.onerror = () => {
      if (disposed) return;
      // The WS `error` event carries no useful cross-browser details.
      // The subsequent onclose event handles retry scheduling.
      console.warn({
        operation: "fleet_status_client_error",
        url,
        // Never log the event object — extract fields only (T-34-20)
        note: "error event received; onclose will handle retry",
      });
    };

    ws.onclose = (evt: CloseEvent) => {
      if (disposed) return;
      // Bounty t800-frontend-websocket-leak-on-container-recreate:
      // detach handler property refs on the just-closed WS BEFORE nulling the
      // module ref + scheduling replacement connect(). Without this, the dead
      // WS instance retains its own handlers (which close over `ws.send`) and
      // stays pinned across reconnect ladders — container-recreate storms then
      // compound the count against nginx worker_connections.
      const deadWs = ws;
      ws = null;
      if (deadWs !== null) {
        deadWs.onopen = null;
        deadWs.onmessage = null;
        deadWs.onerror = null;
        deadWs.onclose = null;
      }

      console.info({
        operation: "fleet_status_client_close",
        url,
        code: evt.code,
        reason: evt.reason,
        attempt: reconnectAttempts,
      });

      // D-11: never give up permanently. After the ladder is exhausted the
      // client settles into a slow steady retry at SLOW_RETRY_MS indefinitely.
      // The `reconnectAttempts >= MAX_RECONNECT_ATTEMPTS` early-return that
      // previously lived here (emitting the give-up log operation and
      // returning with no timer) is intentionally removed. The `Math.min`
      // clamp that followed it is also removed — it is now unreachable.
      //
      // Log the transition ONCE (not every slow retry — that would be a 30s
      // heartbeat of warnings). Subsequent slow retries use the existing
      // fleet_status_client_retry_scheduled info line.
      if (reconnectAttempts === MAX_RECONNECT_ATTEMPTS) {
        console.warn({
          operation: "fleet_status_client_slow_retry",
          url,
          totalAttempts: reconnectAttempts,
          slowRetryMs: SLOW_RETRY_MS,
        });
      }

      // Cap selection: ladder for the first MAX_RECONNECT_ATTEMPTS closes,
      // then SLOW_RETRY_MS indefinitely. The existing full-jitter draw
      // (`Math.floor(Math.random() * capMs)`) applies to SLOW_RETRY_MS too —
      // D-13 multi-tab restore herd prevention applies at all caps.
      const capMs =
        reconnectAttempts < BACKOFF_SCHEDULE_MS.length
          ? BACKOFF_SCHEDULE_MS[reconnectAttempts]
          : SLOW_RETRY_MS;

      // R-54-07: full-jitter — uniform random draw in [0, capMs) prevents 10-tab restore from re-clumping the herd on the reconnect ladder.
      const delayMs = Math.floor(Math.random() * capMs);
      reconnectAttempts += 1;

      console.info({
        operation: "fleet_status_client_retry_scheduled",
        url,
        delayMs,
        attempt: reconnectAttempts,
      });

      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delayMs);
    };
  }

  // D-12: wake-on-visible — cross-platform, NOT iOS-PWA only.
  //
  // PrettyView.tsx and Terminal.tsx open their analogous handlers with
  // the iOS-PWA-only gate found in PrettyView.tsx. That gate exists because on Chrome desktop /
  // Android / non-PWA Safari, force-reconnecting a session-attachment WS
  // creates a race (the old WS's detachWs fires AFTER the new one attaches,
  // destroying the session). fleet-status is READ-ONLY FANOUT with no
  // attachment semantics, so that race cannot occur. D-12 explicitly wants
  // wake-on-visible on every platform. Copying the gate would silently
  // deliver nothing on desktop.
  //
  // Guard set taken from PrettyView.tsx's hardened handler (NOT the iOS gate):
  //   1. disposed check (every handler in this file)
  //   2. hidden: clear retryTimer without resetting reconnectAttempts
  //      (a hide during retry must not drop the accumulated count)
  //   3. visible + ws !== null: double-fire guard (iOS PWA fires spuriously)
  //   4. visible + ws === null: clear any pending timer, fresh budget, connect
  //
  // D-13 note: there is NO sequence-reconciliation here. The reconnect's
  // `subscribe` frame causes the server to answer from its held Map with a
  // full snapshot; that snapshot IS the current picture and IS the backstop.
  // A future reader looking at a reconnect will be tempted to add gap-fill
  // or missed-event recovery — resist it. D-13 explicitly forbids it.
  const handleVisibilityChange = () => {
    if (disposed) return;

    if (document.visibilityState !== "visible") {
      // Tab hidden: cancel any pending retry timer. Do NOT reset
      // reconnectAttempts — a hide during a retry sequence must not drop
      // the accumulated count (PrettyView.tsx comment at ~:2964-2967).
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      return;
    }

    // Tab visible: reconnect if needed.
    // Double-fire guard: iOS PWA fires visibilitychange spuriously; connecting
    // over a live socket would create two sockets and potentially two subscriptions.
    if (ws !== null) return;

    // Clear any pending scheduled retry — an immediate connect supersedes it.
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    // Budget owner 2 of 2: fresh budget for this foreground event (user intent).
    // The two budget owners are ws.onopen (success) and here (visible). No other
    // site resets reconnectAttempts.
    reconnectAttempts = 0;

    connect();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Open immediately
  connect();

  const client: FleetStatusClient = {
    dispose(): void {
      disposed = true;
      _activeClients.delete(client);

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      if (ws !== null) {
        // Bounty t800-frontend-websocket-leak-on-container-recreate: detach
        // handler property refs before close so the disposed WS is not
        // retained by its own handler closures beyond this call.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }

      // Remove the visibilitychange listener — unlike console-forwarder.ts (a
      // process-lifetime forwarder that intentionally never removes its listener),
      // this client has a dispose() contract that must fully clean up.
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      console.info({
        operation: "fleet_status_client_disposed",
        url,
      });
    },
  };

  _activeClients.add(client);
  return client;
}

// ---------------------------------------------------------------------------
// TEST ONLY — module-level registry for test isolation.
//
// Tests that create clients via createFleetStatusClient and don't dispose them
// (intentionally, e.g. jitter tests that verify a single close) leave their
// visibilitychange listeners registered on document. This registry allows a
// test's beforeEach to dispose all previously-created clients before adding
// its own, ensuring visibility events don't trigger stale handlers.
// ---------------------------------------------------------------------------

/** @internal TEST ONLY — not part of the public API. */
const _activeClients = new Set<FleetStatusClient>();

/**
 * TEST ONLY — dispose every client currently in the module-level registry
 * and clear it. Call from a describe's beforeEach before creating new clients
 * to ensure visibilitychange listeners from prior tests don't fire.
 */
export function __disposeAllClientsForTest(): void {
  for (const client of _activeClients) {
    client.dispose();
  }
  _activeClients.clear();
}

// ---------------------------------------------------------------------------
// Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, user 2026-09-08 D-03
// waiver) — per-session contextPct store + useSessionContextPct hook.
//
// Co-located here rather than in a peer state module because contextPct only
// flows in one direction (fleet-status → hook consumers), the publish side is
// wired implicitly by createFleetStatusClient (no AppShell change needed for
// this axis alone), and the store has a single axis (unlike session-working-
// store's multi-axis composite). Same useSyncExternalStore + module-scoped
// Map + Set<() => void> listener registry pattern as
// src/ui/state/session-working-store.ts.
//
// KEY FORMAT: `${hostId}:${tmuxSession ?? ""}` — matches the backend
// contextpct-store.ts and the frontend session-working-store convention.
// This is the D-10 correctness invariant — both PrettyView (post D-03
// mechanical swap) and the future Plan 06 relay-pane badge appendage MUST
// build the key with the SAME shape.
//
// CONSUMED BY:
//   - PrettyView.tsx (post D-03 mechanical waiver): replaces the local
//     `useState<number | null>(null)` at L570 with
//     `useSessionContextPct(hostId, tmuxSession ?? "")`. The WS
//     `context_pct` handler at L2269 becomes a no-op (backend still emits
//     for backwards compat; the frontend no longer reads it there).
//   - AgentBadgeWithMeter (src/ui/features/pretty-view/AgentBadgeWithMeter.tsx per Phase 93): reads the SAME hook so the
//     same agent viewed on either surface shows identical values.
// ---------------------------------------------------------------------------

const contextPctStore = new Map<string, number | null>();
const contextPctListeners = new Set<() => void>();

function contextPctKey(hostId: string, tmuxSession: string | null): string {
  return `${hostId}:${tmuxSession ?? ""}`;
}

function notifyContextPctListeners(): void {
  for (const cb of contextPctListeners) cb();
}

/**
 * Publish a contextPct value for a (hostId, tmuxSession) pair. Called
 * internally by createFleetStatusClient on every snapshot + update frame.
 * Skips notify when the value is unchanged for the key (no-op guard prevents
 * spurious re-renders on repeated identical frames). Explicit null is a
 * valid value (dormant sentinel / no reading yet).
 */
function publishSessionContextPct(
  hostId: string,
  tmuxSession: string | null,
  pct: number | null,
): void {
  const key = contextPctKey(hostId, tmuxSession);
  const existing = contextPctStore.get(key);
  // No-op guard: only notify on actual change. Object.is handles null
  // identity correctly and treats 0 as not-equal to -0 (harmless here).
  if (contextPctStore.has(key) && Object.is(existing, pct)) return;
  contextPctStore.set(key, pct);
  notifyContextPctListeners();
}

/**
 * Remove the contextPct entry for a (hostId, tmuxSession) pair. Called
 * internally by createFleetStatusClient on every `gone` frame so a session
 * that leaves the fleet no longer serves stale readings.
 */
function publishSessionContextPctGone(
  hostId: string,
  tmuxSession: string | null,
): void {
  const key = contextPctKey(hostId, tmuxSession);
  if (!contextPctStore.has(key)) return;
  contextPctStore.delete(key);
  notifyContextPctListeners();
}

function subscribeContextPct(cb: () => void): () => void {
  contextPctListeners.add(cb);
  return () => {
    contextPctListeners.delete(cb);
  };
}

/**
 * React hook — subscribe to a single session's contextPct value from the
 * fleet-status stream. Returns null when:
 *   - The (hostId, tmuxSession) key has never been published (session not in
 *     fleet, or fleet-status client not yet connected).
 *   - The most recent published value was null (fresh session pre-scrape,
 *     dormant sentinel, or SSH-hiccup normalised-null on the backend).
 *
 * hostId is number-or-string on the caller side (PrettyView has number, the
 * relay-pane badge appendage will also have a numeric fleet-derived hostId).
 * Coerced to string here to match the backend contextpct-store's key format.
 *
 * useSyncExternalStore semantics: any publishSessionContextPct that changes
 * the value for this key re-renders consumers. Unchanged frames are skipped
 * at the publish boundary.
 */
export function useSessionContextPct(
  hostId: string | number,
  tmuxSession: string,
): number | null {
  const key = contextPctKey(String(hostId), tmuxSession);
  const getSnapshot = (): number | null => {
    const val = contextPctStore.get(key);
    if (val === undefined) return null;
    return val;
  };
  return useSyncExternalStore(subscribeContextPct, getSnapshot, getSnapshot);
}

/**
 * TEST ONLY — reset the module-scoped contextPct store so each test starts
 * from a clean slate. NOT a public API.
 */
export function __resetSessionContextPctForTests(): void {
  contextPctStore.clear();
  notifyContextPctListeners();
}

/**
 * TEST ONLY — allow tests to directly publish a value without going through
 * the WS lifecycle. Useful for isolation tests of the hook itself.
 */
export function __setSessionContextPctForTests(
  hostId: string,
  tmuxSession: string | null,
  pct: number | null,
): void {
  publishSessionContextPct(hostId, tmuxSession, pct);
}
