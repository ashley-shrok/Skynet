/**
 * Task 2 — Subscription registry tests (TDD RED phase)
 *
 * Tests 1-7: subscription-registry.ts behavior
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createSubscriptionRegistry } from "./subscription-registry.js";
import type { FrontendOutboundFrameType, SessionState } from "./wire-protocol.js";
import { FRAME_SCHEMA_VERSION } from "./wire-protocol.js";

function makeState(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): SessionState {
  return {
    hostId,
    tmuxSession,
    sessionId,
    pid: 1000,
    status: "busy",
    backgroundTasks: [],
    updatedAt: Date.now(),
  };
}

describe("subscription-registry", () => {
  it("Test 1: createSubscriptionRegistry() returns a registry with an empty state Map", () => {
    const registry = createSubscriptionRegistry();
    expect(registry.getSnapshot()).toEqual([]);
  });

  it("Test 2: publishSessionState inserts state at correct key and fans out update frames", () => {
    const registry = createSubscriptionRegistry();
    const receivedFrames: FrontendOutboundFrameType[] = [];
    registry.subscribe((frame) => receivedFrames.push(frame));

    // Clear the snapshot frame
    receivedFrames.length = 0;

    const state = makeState("host-42", "tina", "session-1");
    registry.publishSessionState("host-42", state);

    const updateFrames = receivedFrames.filter((f) => f.type === "update");
    expect(updateFrames).toHaveLength(1);
    expect(updateFrames[0]).toMatchObject({
      type: "update",
      schemaVersion: FRAME_SCHEMA_VERSION,
      state,
    });
  });

  it("Test 3: Late subscriber receives snapshot frame containing all previously published states", () => {
    const registry = createSubscriptionRegistry();

    const stateA = makeState("host-42", "tina", "session-a");
    const stateB = makeState("host-42", "nelly", "session-b");

    registry.publishSessionState("host-42", stateA);
    registry.publishSessionState("host-42", stateB);

    // Subscribe AFTER publishes
    const receivedFrames: FrontendOutboundFrameType[] = [];
    registry.subscribe((frame) => receivedFrames.push(frame));

    // First frame should be a snapshot with both states
    expect(receivedFrames).toHaveLength(1);
    const snapshotFrame = receivedFrames[0];
    expect(snapshotFrame.type).toBe("snapshot");
    if (snapshotFrame.type === "snapshot") {
      expect(snapshotFrame.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
      expect(snapshotFrame.states).toHaveLength(2);
      const ids = snapshotFrame.states.map((s) => s.sessionId);
      expect(ids).toContain("session-a");
      expect(ids).toContain("session-b");
    }
  });

  it("Test 4: Subscriber removed via disposer stops receiving updates", () => {
    const registry = createSubscriptionRegistry();
    const receivedFrames: FrontendOutboundFrameType[] = [];
    const disposer = registry.subscribe((frame) => receivedFrames.push(frame));

    // Snapshot frame received on subscribe
    receivedFrames.length = 0;

    disposer();

    // Publish after disposal — should not receive
    const state = makeState("host-42", "tina", "session-1");
    registry.publishSessionState("host-42", state);

    expect(receivedFrames).toHaveLength(0);
  });

  it("Test 5: publishSessionGone removes entry from map and sends gone frame to all subscribers", () => {
    const registry = createSubscriptionRegistry();

    const state = makeState("host-42", "tina", "session-1");
    registry.publishSessionState("host-42", state);

    const receivedFrames: FrontendOutboundFrameType[] = [];
    registry.subscribe((frame) => receivedFrames.push(frame));
    receivedFrames.length = 0; // clear snapshot

    registry.publishSessionGone("host-42", "tina", "session-1");

    // Map should be empty
    expect(registry.getSnapshot()).toHaveLength(0);

    // Subscriber received exactly one gone frame
    const goneFrames = receivedFrames.filter((f) => f.type === "gone");
    expect(goneFrames).toHaveLength(1);
    expect(goneFrames[0]).toMatchObject({
      type: "gone",
      schemaVersion: FRAME_SCHEMA_VERSION,
      hostId: "host-42",
      tmuxSession: "tina",
      sessionId: "session-1",
    });
  });

  it("Test 6: publishSessionGone for a key that doesn't exist is a no-op (zero sendFrame invocations)", () => {
    const registry = createSubscriptionRegistry();
    const sender = vi.fn();
    registry.subscribe(sender);
    sender.mockClear(); // clear snapshot call

    // Gone for a key that was never published
    registry.publishSessionGone("host-42", "nonexistent", "session-x");

    // Should not have called sender with a gone frame
    expect(sender).not.toHaveBeenCalled();
  });

  it("Test 7: Subscribing twice from the same sender is idempotent (Set, not Array)", () => {
    const registry = createSubscriptionRegistry();
    const sender = vi.fn();

    registry.subscribe(sender);
    sender.mockClear(); // clear first snapshot

    registry.subscribe(sender);
    sender.mockClear(); // clear second snapshot

    // Publish — should only call sender once, not twice
    const state = makeState("host-42", "tina", "session-1");
    registry.publishSessionState("host-42", state);

    const updateCalls = sender.mock.calls.filter(
      ([frame]: [FrontendOutboundFrameType]) => frame.type === "update",
    );
    expect(updateCalls).toHaveLength(1);
  });
});
