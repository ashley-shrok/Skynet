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
   */
  subscribe(sendFrame: SendFrame): () => void;

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

  return {
    subscribe(sendFrame: SendFrame): () => void {
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

      // Return disposer
      return () => {
        subscribers.delete(sendFrame);
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
  };
}

// Re-export the FRAME_SCHEMA_VERSION for consumers that need it
export { FRAME_SCHEMA_VERSION };
