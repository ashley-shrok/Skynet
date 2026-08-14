/**
 * subscription-registry.ts
 *
 * In-memory registry of (hostId, tmuxSession) → SessionState plus a Set of
 * frontend-connection subscribers with snapshot + fan-out semantics.
 *
 * Key convention: `${hostId}:${tmuxSession ?? ''}` — mirrors session-working-store.ts.
 */
import { systemLogger } from "../utils/logger.js";
import type { SessionState, FrontendOutboundFrameType } from "./wire-protocol.js";
import {
  FRAME_SCHEMA_VERSION,
  makeSnapshotFrame,
  makeUpdateFrame,
  makeGoneFrame,
} from "./wire-protocol.js";

type SendFrame = (frame: FrontendOutboundFrameType) => void;

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

  return {
    subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void {
      // Capture emptiness BEFORE adding so we fire the 0 → 1 edge exactly once
      const wasEmpty = subscribers.size === 0;

      // Idempotent — Set ignores duplicates by reference
      subscribers.add(sendFrame);

      // Immediately send a snapshot of current state
      const snapshot = makeSnapshotFrame(Array.from(state.values()));
      try {
        sendFrame(snapshot);
      } catch (err) {
        systemLogger.warn("Fleet-status initial snapshot delivery failed", {
          operation: "fleet_status_snapshot_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
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
      state.set(key, sessionState);
      fanOut(subscribers, makeUpdateFrame(sessionState));
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

    getSnapshot(): SessionState[] {
      return Array.from(state.values());
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
