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
  // Phase 90 Plan 00 Wave 0 — contextpct-store.setContextPct calls
  // databaseLogger.debug on every write; the store is now imported
  // transitively by subscription-registry, so the mock must cover it.
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createSubscriptionRegistry } from "./subscription-registry.js";
import type {
  AppState,
  FrontendOutboundFrameType,
  SessionState,
} from "./wire-protocol.js";
import { FRAME_SCHEMA_VERSION } from "./wire-protocol.js";
import { systemLogger } from "../utils/logger.js";
// Phase 90 Plan 00 Wave 0 — contextPct promotion.
import {
  setContextPct,
  __clearAllContextPctForTests,
} from "./contextpct-store.js";

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

    // Phase 118 Plan 118-03 (Rule 3 additive-extension ripple): subscribe()
    // now emits an app-snapshot alongside the session snapshot. Assert the
    // session-snapshot shape by TYPE-FILTERING rather than by position.
    const snapshotFrames = receivedFrames.filter((f) => f.type === "snapshot");
    expect(snapshotFrames).toHaveLength(1);
    const snapshotFrame = snapshotFrames[0];
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

  // -------------------------------------------------------------------------
  // Phase 39 — Presence-signal lifecycle hooks (Tests 8-14)
  // -------------------------------------------------------------------------

  it("Test 8: onFirstSubscriber fires with ctx.userId when a subscriber joins an empty registry", () => {
    const registry = createSubscriptionRegistry();
    const cb = vi.fn();
    registry.onFirstSubscriber(cb);

    registry.subscribe(() => {}, { userId: "u1" });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("Test 9: onFirstSubscriber does NOT fire on the second subscriber (edge already crossed)", () => {
    const registry = createSubscriptionRegistry();

    // First subscribe arrives BEFORE callback registration — the 0->1 edge has passed
    registry.subscribe(() => {}, { userId: "u1" });

    const cb = vi.fn();
    registry.onFirstSubscriber(cb);

    // Second subscribe — subscribers.size goes 1 -> 2, NOT 0 -> 1
    registry.subscribe(() => {}, { userId: "u2" });

    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("Test 10: onFirstSubscriber fires again after a full teardown-and-resubscribe cycle", () => {
    const registry = createSubscriptionRegistry();

    const disposer = registry.subscribe(() => {}, { userId: "u1" });
    disposer();

    // Register the callback AFTER the first cycle completes.
    // The registry is now empty again — the next subscribe re-enters the 0->1 edge.
    const cb = vi.fn();
    registry.onFirstSubscriber(cb);

    registry.subscribe(() => {}, { userId: "u2" });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ userId: "u2" });
  });

  it("Test 11: onLastUnsubscriber fires exactly when the last disposer runs (1 -> 0 edge)", () => {
    const registry = createSubscriptionRegistry();

    const disposeA = registry.subscribe(() => {}, { userId: "u1" });
    const disposeB = registry.subscribe(() => {}, { userId: "u2" });

    const cb = vi.fn();
    registry.onLastUnsubscriber(cb);

    // Dispose first — subscribers.size goes 2 -> 1, callback must NOT fire yet
    disposeA();
    expect(cb).toHaveBeenCalledTimes(0);

    // Dispose second — subscribers.size goes 1 -> 0, callback MUST fire exactly once
    disposeB();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("Test 12: Disposer returned by onFirstSubscriber unregisters the callback", () => {
    const registry = createSubscriptionRegistry();

    const cb = vi.fn();
    const unregister = registry.onFirstSubscriber(cb);
    unregister();

    // Fresh 0 -> 1 transition — callback must NOT fire since it was unregistered
    registry.subscribe(() => {}, { userId: "u1" });

    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("Test 13: subscribe() without ctx does NOT fire onFirstSubscriber (backward-compat guard)", () => {
    const registry = createSubscriptionRegistry();

    const cb = vi.fn();
    registry.onFirstSubscriber(cb);

    // No ctx — callback must NOT fire (preserves the 7 legacy tests' semantics)
    registry.subscribe(() => {});

    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("Test 14: Callback throws are caught and logged via systemLogger.warn", () => {
    const registry = createSubscriptionRegistry();
    const warnSpy = vi.mocked(systemLogger.warn);
    warnSpy.mockClear();

    const throwingCb = vi.fn(() => {
      throw new Error("boom");
    });
    registry.onFirstSubscriber(throwingCb);

    // subscribe MUST return normally despite the callback throwing
    expect(() =>
      registry.subscribe(() => {}, { userId: "u1" }),
    ).not.toThrow();

    // Callback was invoked exactly once
    expect(throwingCb).toHaveBeenCalledTimes(1);

    // systemLogger.warn was called with the fleet_status_lifecycle_cb_failed op tag
    const lifecycleWarns = warnSpy.mock.calls.filter(
      ([, ctx]: [string, Record<string, unknown> | undefined]) =>
        ctx?.operation === "fleet_status_lifecycle_cb_failed",
    );
    expect(lifecycleWarns.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Phase 90 Plan 00 Wave 0 — contextPct promotion (behaviors 9-10 per plan)
  // ---------------------------------------------------------------------------

  describe("contextPct stamping (Phase 90 Wave 0)", () => {
    beforeEach(() => {
      __clearAllContextPctForTests();
    });

    it(
      "Test 9 (behavior 9): on every publish, the fanned-out SessionState includes contextPct sourced from the shared store; sessions with no stored value get null",
      () => {
        const registry = createSubscriptionRegistry();
        const received: FrontendOutboundFrameType[] = [];
        registry.subscribe((f) => received.push(f));
        received.length = 0;

        // Session A: shared store has a value (65) — the fanned-out frame
        // must carry contextPct: 65.
        setContextPct("host-42", "tina", 65);
        const stateA = makeState("host-42", "tina", "session-a");
        registry.publishSessionState("host-42", stateA);

        // Session B: no store entry — the fanned-out frame must carry
        // contextPct: null.
        const stateB = makeState("host-42", "nelly", "session-b");
        registry.publishSessionState("host-42", stateB);

        const updateFrames = received.filter((f) => f.type === "update");
        expect(updateFrames).toHaveLength(2);

        const frameA = updateFrames[0];
        const frameB = updateFrames[1];
        if (frameA.type === "update" && frameB.type === "update") {
          expect(frameA.state.contextPct).toBe(65);
          expect(frameB.state.contextPct).toBeNull();
        }

        // Snapshot delivery must ALSO re-stamp contextPct at read time so
        // late subscribers see the CURRENT value in the shared store, not
        // whatever value existed at the last publish tick. Update the store
        // AFTER publish and confirm a fresh subscriber sees the new value.
        setContextPct("host-42", "tina", 77);
        const lateSubscriberFrames: FrontendOutboundFrameType[] = [];
        registry.subscribe((f) => lateSubscriberFrames.push(f));

        const snapshot = lateSubscriberFrames[0];
        expect(snapshot.type).toBe("snapshot");
        if (snapshot.type === "snapshot") {
          const tinaState = snapshot.states.find((s) => s.tmuxSession === "tina");
          expect(tinaState?.contextPct).toBe(77); // fresh store value
          const nellyState = snapshot.states.find((s) => s.tmuxSession === "nelly");
          expect(nellyState?.contextPct).toBeNull(); // still no entry
        }
      },
    );

    it(
      "Test 10 (behavior 10): additive-optional invariant preserved — SessionStateSchema still parses records from an older shape (no contextPct field) without validation failure",
      async () => {
        const { SessionStateSchema } = await import("./wire-protocol.js");

        // Older frame shape — no contextPct field at all.
        const olderShape: unknown = {
          hostId: "host-42",
          tmuxSession: "tina",
          sessionId: "session-1",
          pid: 1000,
          status: "busy",
          backgroundTasks: [],
          updatedAt: Date.now(),
        };
        const result = SessionStateSchema.safeParse(olderShape);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contextPct).toBeUndefined();
        }

        // Frame with contextPct: null — also accepted (nullable optional).
        const withNullPct = { ...(olderShape as Record<string, unknown>), contextPct: null };
        const r2 = SessionStateSchema.safeParse(withNullPct);
        expect(r2.success).toBe(true);
        if (r2.success) {
          expect(r2.data.contextPct).toBeNull();
        }

        // Frame with contextPct: 42 — accepted.
        const withNumPct = { ...(olderShape as Record<string, unknown>), contextPct: 42 };
        const r3 = SessionStateSchema.safeParse(withNumPct);
        expect(r3.success).toBe(true);
        if (r3.success) {
          expect(r3.data.contextPct).toBe(42);
        }
      },
    );
  });

  // ─── Phase 115 Plan 115-06 — publishIdentityArchived (D-06, D-18) ──────────
  describe("publishIdentityArchived (Phase 115 Plan 115-06)", () => {
    it("Test 11: publishIdentityArchived fans an identity-archived frame to all subscribers", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      // Drop the initial snapshot frame.
      receivedFrames.length = 0;

      registry.publishIdentityArchived("wren", "42", "thenasty");

      expect(receivedFrames).toHaveLength(1);
      const frame = receivedFrames[0];
      expect(frame.type).toBe("identity-archived");
      if (frame.type === "identity-archived") {
        expect(frame.name).toBe("wren");
        expect(frame.hostId).toBe("42");
        expect(frame.hostname).toBe("thenasty");
      }
    });

    it("Test 12: publishIdentityArchived is idempotent — republishing the same row does NOT re-fan", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishIdentityArchived("wren", "42", "thenasty");
      registry.publishIdentityArchived("wren", "42", "thenasty");
      registry.publishIdentityArchived("wren", "42", "thenasty");

      const archivedFrames = receivedFrames.filter(
        (f) => f.type === "identity-archived",
      );
      expect(archivedFrames).toHaveLength(1);
    });

    it("Test 13: late subscriber receives the archived-identity registry as replay frames after the snapshot", () => {
      const registry = createSubscriptionRegistry();

      registry.publishIdentityArchived("wren", "42", "thenasty");
      registry.publishIdentityArchived("tabitha", "42", "thenasty");

      // Subscribe AFTER publishes — the replay frames arrive on subscribe.
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));

      const archivedFrames = receivedFrames.filter(
        (f) => f.type === "identity-archived",
      );
      expect(archivedFrames).toHaveLength(2);
      const names = archivedFrames.map((f) =>
        f.type === "identity-archived" ? f.name : "",
      );
      expect(names).toContain("wren");
      expect(names).toContain("tabitha");
    });

    it("Test 14: cross-host name collision — same name, different hostId — produces TWO distinct archived entries", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishIdentityArchived("wren", "42", "thenasty");
      registry.publishIdentityArchived("wren", "99", "workstation");

      const archivedFrames = receivedFrames.filter(
        (f) => f.type === "identity-archived",
      );
      expect(archivedFrames).toHaveLength(2);
    });

    it("Test 15: republishing with a changed hostname is NOT idempotent — new frame fires", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishIdentityArchived("wren", "42", "thenasty");
      // Same key but different hostname — should re-fan (registry entry replaced).
      registry.publishIdentityArchived("wren", "42", "thenasty-renamed");

      const archivedFrames = receivedFrames.filter(
        (f) => f.type === "identity-archived",
      );
      expect(archivedFrames).toHaveLength(2);
    });
  });

  // ─── Phase 117 Plan 117-03 — publishProjectListChanged (D-37) ──────────────
  // Wire event for the projects pool. Full-array-replace on every emit;
  // idempotent byte-identity skip via JSON.stringify canonicalization.
  // Snapshot-on-subscribe replays the cached array to reconnecting clients.

  describe("publishProjectListChanged (Phase 117 Plan 117-03)", () => {
    const projectA = {
      slug: "alpha",
      displayName: "Alpha",
      hostId: "1",
      hostname: "t1000",
      archived: false,
    };
    const projectB = {
      slug: "beta",
      displayName: "Beta",
      hostId: "2",
      hostname: "workstation",
      archived: false,
    };

    it("Test P117-03-1: publishProjectListChanged fans out on delta — subscribers receive a project-list-changed frame with the full array", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      // Drop the initial snapshot frame.
      receivedFrames.length = 0;

      registry.publishProjectListChanged([projectA]);

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(1);
      const frame = projectFrames[0];
      if (frame.type === "project-list-changed") {
        expect(frame.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
        expect(frame.projects).toEqual([projectA]);
      }
    });

    it("Test P117-03-2: publishProjectListChanged is idempotent on byte-identical repeat — second call is a no-op", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishProjectListChanged([projectA]);
      registry.publishProjectListChanged([projectA]);
      registry.publishProjectListChanged([projectA]);

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(1);
    });

    it("Test P117-03-3: publishProjectListChanged fires on delta after cached state — [a] → [a, b] produces a second frame", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishProjectListChanged([projectA]);
      registry.publishProjectListChanged([projectA, projectB]);

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(2);
      const secondFrame = projectFrames[1];
      if (secondFrame.type === "project-list-changed") {
        expect(secondFrame.projects).toEqual([projectA, projectB]);
      }
    });

    it("Test P117-03-4: publishProjectListChanged with empty array from cached non-empty state — subscribers receive a real delta with projects: []", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      registry.publishProjectListChanged([projectA]);
      registry.publishProjectListChanged([]);

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(2);
      const emptyFrame = projectFrames[1];
      if (emptyFrame.type === "project-list-changed") {
        expect(emptyFrame.projects).toEqual([]);
      }
    });

    it("Test P117-03-5: snapshot-on-subscribe replay — pre-seed the registry, then subscribe a new client; new client receives the cached array", () => {
      const registry = createSubscriptionRegistry();

      registry.publishProjectListChanged([projectA, projectB]);

      // Subscribe AFTER the publish — the replay frame arrives on subscribe.
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(1);
      const frame = projectFrames[0];
      if (frame.type === "project-list-changed") {
        expect(frame.projects).toEqual([projectA, projectB]);
      }

      // Regression guard: the archived-identities snapshot replay must ALSO
      // still work on the same subscribe. Publish an archived identity
      // BEFORE the subscribe of a fresh client and confirm both replays fire.
      const registry2 = createSubscriptionRegistry();
      registry2.publishProjectListChanged([projectA]);
      registry2.publishIdentityArchived("wren", "42", "thenasty");

      const received2: FrontendOutboundFrameType[] = [];
      registry2.subscribe((f) => received2.push(f));

      const proj = received2.filter((f) => f.type === "project-list-changed");
      const arch = received2.filter((f) => f.type === "identity-archived");
      expect(proj).toHaveLength(1);
      expect(arch).toHaveLength(1);
    });

    it("Test P117-03-6: snapshot replay when no publish has occurred — no project-list-changed frame is fanned out; archived-identities replay still fires independently", () => {
      const registry = createSubscriptionRegistry();

      // Only publish an archived identity — do NOT publish a project list.
      registry.publishIdentityArchived("wren", "42", "thenasty");

      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      const archivedFrames = receivedFrames.filter(
        (f) => f.type === "identity-archived",
      );
      expect(projectFrames).toHaveLength(0);
      expect(archivedFrames).toHaveLength(1);
    });

    it("Test P117-03-7: idempotent-skip compares deeply (JSON.stringify canonicalization) — distinct arrays with identical field values do NOT re-fan", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      // Two distinct arrays with byte-identical serialized shape.
      const arr1 = [
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ];
      const arr2 = [
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ];

      registry.publishProjectListChanged(arr1);
      registry.publishProjectListChanged(arr2);

      const projectFrames = receivedFrames.filter(
        (f) => f.type === "project-list-changed",
      );
      expect(projectFrames).toHaveLength(1);
    });
  });
||||||| base

  // ─── Phase 118 Plan 118-03 — apps map + publish surface (D-09/D-10/D-13/D-14/D-16) ─
  // Sibling to the SessionState map: apps live in their own Map<`${hostId}:${slug}`,
  // AppState> populated by publishAppUpdate, drained by publishAppGoneByHostSlug,
  // and snapshotted to every new subscriber via the subscribe() path. In-memory
  // only (D-10) — no DB writes. NO idempotence guard on publishAppUpdate (D-13:
  // health-flips must always fan out).
  describe("Phase 118 apps map + publish surface", () => {
    function makeAppState(
      hostId: string,
      slug: string,
      overrides: Partial<AppState> = {},
    ): AppState {
      return {
        hostId,
        slug,
        title: `App ${slug}`,
        description: "test app",
        port: 9591,
        hasIcon: false,
        createdAtMs: 1_700_000_000_000,
        isHealthy: true,
        healthMessage: null,
        ...overrides,
      };
    }

    it("Test 1: publishAppUpdate inserts into the apps map + fans out exactly one app-update frame", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0; // drop snapshots

      const app = makeAppState("h1", "todo");
      registry.publishAppUpdate("h1", app);

      // Map contains the entry
      const snap = registry.getAppSnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]).toMatchObject({ hostId: "h1", slug: "todo" });

      // Exactly one app-update frame
      const updateFrames = receivedFrames.filter((f) => f.type === "app-update");
      expect(updateFrames).toHaveLength(1);
      const [frame] = updateFrames;
      expect(frame).toMatchObject({
        type: "app-update",
        schemaVersion: FRAME_SCHEMA_VERSION,
        app,
      });
    });

    it("Test 2: publishAppUpdate is NOT idempotent — repeated identical publishes fan out every time (D-13 health-flip discipline)", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0;

      const app = makeAppState("h1", "todo");
      registry.publishAppUpdate("h1", app);
      registry.publishAppUpdate("h1", app);

      const updateFrames = receivedFrames.filter((f) => f.type === "app-update");
      expect(updateFrames).toHaveLength(2);
    });

    it("Test 3: publishAppGoneByHostSlug for a known key removes the entry + fans out one app-gone frame", () => {
      const registry = createSubscriptionRegistry();
      registry.publishAppUpdate("h1", makeAppState("h1", "todo"));

      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));
      receivedFrames.length = 0; // drop snapshots

      registry.publishAppGoneByHostSlug("h1", "todo");

      // Map no longer contains the entry
      expect(registry.getAppSnapshot()).toHaveLength(0);

      // Exactly one app-gone frame
      const goneFrames = receivedFrames.filter((f) => f.type === "app-gone");
      expect(goneFrames).toHaveLength(1);
      expect(goneFrames[0]).toMatchObject({
        type: "app-gone",
        schemaVersion: FRAME_SCHEMA_VERSION,
        hostId: "h1",
        slug: "todo",
      });
    });

    it("Test 4: publishAppGoneByHostSlug for an unknown key is a no-op — no fan-out, no change to map", () => {
      const registry = createSubscriptionRegistry();
      const sender = vi.fn();
      registry.subscribe(sender);
      sender.mockClear(); // drop snapshot

      registry.publishAppGoneByHostSlug("h1", "nonexistent");

      expect(sender).not.toHaveBeenCalled();
      expect(registry.getAppSnapshot()).toHaveLength(0);
    });

    it("Test 5: late subscriber receives an app-snapshot frame carrying every previously-published app", () => {
      const registry = createSubscriptionRegistry();
      registry.publishAppUpdate("h1", makeAppState("h1", "todo"));
      registry.publishAppUpdate("h2", makeAppState("h2", "kanban"));

      // Subscribe AFTER publishes
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));

      const snapshotFrames = receivedFrames.filter(
        (f) => f.type === "app-snapshot",
      );
      expect(snapshotFrames).toHaveLength(1);
      const [frame] = snapshotFrames;
      if (frame.type === "app-snapshot") {
        expect(frame.apps).toHaveLength(2);
        const slugs = frame.apps.map((a) => a.slug).sort();
        expect(slugs).toEqual(["kanban", "todo"]);
      }
    });

    it("Test 6: subscribing with no published apps still emits an app-snapshot frame carrying apps: []", () => {
      const registry = createSubscriptionRegistry();
      const receivedFrames: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => receivedFrames.push(f));

      const snapshotFrames = receivedFrames.filter(
        (f) => f.type === "app-snapshot",
      );
      expect(snapshotFrames).toHaveLength(1);
      const [frame] = snapshotFrames;
      if (frame.type === "app-snapshot") {
        expect(frame.apps).toEqual([]);
      }
    });

    it("Test 7: publishAppUpdate fan-out uses the shared try/catch fanOut — one throwing subscriber does NOT starve others", () => {
      const registry = createSubscriptionRegistry();
      const goodFrames: FrontendOutboundFrameType[] = [];
      // Bad subscriber throws
      const badSender = vi.fn(() => {
        throw new Error("boom");
      });
      registry.subscribe(badSender);
      registry.subscribe((f) => goodFrames.push(f));
      goodFrames.length = 0; // drop snapshots
      badSender.mockClear();

      registry.publishAppUpdate("h1", makeAppState("h1", "todo"));

      // Bad subscriber was invoked (and threw); good subscriber still got the frame.
      expect(badSender).toHaveBeenCalledTimes(1);
      const updateFrames = goodFrames.filter((f) => f.type === "app-update");
      expect(updateFrames).toHaveLength(1);
    });
  });

  // ─── Phase 118 Plan 118-05 — per-user host-visibility filter on app frames ─
  // The registry accepts an optional `deps.appFrameFilter` in its factory.
  // When present, the async fanOutApp helper wraps every app-* fan-out call
  // and the subscribe-path snapshot emit — per-subscriber filtering. When
  // absent (existing 118-03 tests + starter.ts without wiring) the registry
  // uses the sync fanOut path unchanged (backward-compat).
  //
  // Session + archived-identity fan-out is UNAFFECTED (D-15 scopes to app
  // frames only; identity frames get filtered "or will be" per D-15's own
  // language — deferred to a follow-up plan).
  describe("Phase 118 Plan 118-05 app-frame filter integration", () => {
    function makeFilterAppState(
      hostId: string,
      slug: string,
      overrides: Partial<AppState> = {},
    ): AppState {
      return {
        hostId,
        slug,
        title: `App ${slug}`,
        description: "test app",
        port: 9591,
        hasIcon: false,
        createdAtMs: 1_700_000_000_000,
        isHealthy: true,
        healthMessage: null,
        ...overrides,
      };
    }

    async function tick(): Promise<void> {
      // Small delay to let the fire-and-forget fanOutApp promises settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    it("Filter-1: no appFrameFilter dep → registry runs unfiltered (backward-compat with 118-03 tests)", async () => {
      const registry = createSubscriptionRegistry(); // no deps
      const received: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => received.push(f), { userId: "U1" });
      received.length = 0;

      registry.publishAppUpdate("h1", makeFilterAppState("h1", "todo"));
      await tick();

      const updates = received.filter((f) => f.type === "app-update");
      expect(updates).toHaveLength(1);
    });

    it("Filter-2: filter dep present + bare subscriber (no ctx) → THROWS (HIGH-2 fix pass 2026-09-18 belt-and-suspenders refuse)", () => {
      // Prior behavior (Phase 118-05 land-time): the filter's own
      // backward-compat guard passed userId === undefined frames through
      // unchanged, which meant a bare subscriber to a filtered registry
      // received every app frame regardless of host access — same T-118-
      // 05-IL info-disclosure leak the filter was built to close. The
      // HIGH-2 fix refuses bare subscribe when the filter is attached.
      // Callers that intentionally want the unfiltered shape use
      // `createSubscriptionRegistry()` without deps (see Filter-1 above,
      // which is the intentional-unfiltered path and still works).
      const filterMock = vi.fn(async (frame: FrontendOutboundFrameType) => frame);
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      expect(() => registry.subscribe(() => {})).toThrow(
        /userId ctx required when app-frame filter is attached/,
      );
    });

    it("Filter-3: two subscribers with distinct userIds — filter drops for U2 on app-update", async () => {
      const filterMock = vi.fn(
        async (frame: FrontendOutboundFrameType, userId?: string) => {
          if (userId === "U2" && frame.type === "app-update") return null;
          return frame;
        },
      );
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      const framesU1: FrontendOutboundFrameType[] = [];
      const framesU2: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => framesU1.push(f), { userId: "U1" });
      registry.subscribe((f) => framesU2.push(f), { userId: "U2" });
      await tick();
      framesU1.length = 0;
      framesU2.length = 0;

      registry.publishAppUpdate("h1", makeFilterAppState("h1", "todo"));
      await tick();

      expect(framesU1.filter((f) => f.type === "app-update")).toHaveLength(1);
      expect(framesU2.filter((f) => f.type === "app-update")).toHaveLength(0);
    });

    it("Filter-4: publishAppGoneByHostSlug filtered per-subscriber — U1 sees the gone, U2 does not", async () => {
      const filterMock = vi.fn(
        async (frame: FrontendOutboundFrameType, userId?: string) => {
          if (userId === "U2" && frame.type === "app-gone") return null;
          return frame;
        },
      );
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      // Seed the map so the gone actually fans out.
      registry.publishAppUpdate("h1", makeFilterAppState("h1", "todo"));
      await tick();

      const framesU1: FrontendOutboundFrameType[] = [];
      const framesU2: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => framesU1.push(f), { userId: "U1" });
      registry.subscribe((f) => framesU2.push(f), { userId: "U2" });
      await tick();
      framesU1.length = 0;
      framesU2.length = 0;

      registry.publishAppGoneByHostSlug("h1", "todo");
      await tick();

      expect(framesU1.filter((f) => f.type === "app-gone")).toHaveLength(1);
      expect(framesU2.filter((f) => f.type === "app-gone")).toHaveLength(0);
    });

    it("Filter-5: subscribe-path app-snapshot is filtered per userId (projected copy)", async () => {
      const filterMock = vi.fn(
        async (frame: FrontendOutboundFrameType, _userId?: string) => {
          // Project the snapshot to only h1 apps (drop h2 apps entirely).
          if (frame.type === "app-snapshot") {
            return {
              ...frame,
              apps: frame.apps.filter((a) => a.hostId === "h1"),
            };
          }
          return frame;
        },
      );
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      // Seed with apps across two hosts BEFORE the subscribe.
      registry.publishAppUpdate("h1", makeFilterAppState("h1", "todo"));
      registry.publishAppUpdate("h2", makeFilterAppState("h2", "kanban"));
      await tick();

      const framesU1: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => framesU1.push(f), { userId: "U1" });
      await tick();

      const snapshots = framesU1.filter((f) => f.type === "app-snapshot");
      expect(snapshots).toHaveLength(1);
      const snap = snapshots[0];
      if (snap.type === "app-snapshot") {
        expect(snap.apps).toHaveLength(1);
        expect(snap.apps[0].hostId).toBe("h1");
      }
    });

    it("Filter-6: session + archived-identity fan-out UNAFFECTED by widening (still sync + unfiltered)", async () => {
      const filterMock = vi.fn(
        async (frame: FrontendOutboundFrameType) => frame,
      );
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      const framesU1: FrontendOutboundFrameType[] = [];
      const framesU2: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => framesU1.push(f), { userId: "U1" });
      registry.subscribe((f) => framesU2.push(f), { userId: "U2" });
      await tick();
      framesU1.length = 0;
      framesU2.length = 0;
      // Clear filter calls made during the subscribe-path app-snapshot emit
      // (those are correct: subscribe DOES filter the app-snapshot per D-15).
      filterMock.mockClear();

      // Session frame — must reach BOTH subscribers without going through filter.
      const state = makeState("host-42", "tina", "session-1");
      registry.publishSessionState("host-42", state);

      // Archived identity frame — also must reach BOTH subscribers.
      registry.publishIdentityArchived("wren", "42", "thenasty");

      // Filter was NOT called for session/archived (only app frames go through it).
      expect(filterMock).not.toHaveBeenCalled();

      expect(framesU1.filter((f) => f.type === "update")).toHaveLength(1);
      expect(framesU2.filter((f) => f.type === "update")).toHaveLength(1);
      expect(
        framesU1.filter((f) => f.type === "identity-archived"),
      ).toHaveLength(1);
      expect(
        framesU2.filter((f) => f.type === "identity-archived"),
      ).toHaveLength(1);
    });

    it("Filter-7: filter throwing for one subscriber does NOT block delivery to others", async () => {
      const filterMock = vi.fn(
        async (frame: FrontendOutboundFrameType, userId?: string) => {
          if (userId === "U-bad") {
            throw new Error("filter exploded");
          }
          return frame;
        },
      );
      const registry = createSubscriptionRegistry({ appFrameFilter: filterMock });

      const framesGood: FrontendOutboundFrameType[] = [];
      const framesBad: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => framesGood.push(f), { userId: "U-good" });
      registry.subscribe((f) => framesBad.push(f), { userId: "U-bad" });
      await tick();
      framesGood.length = 0;
      framesBad.length = 0;

      registry.publishAppUpdate("h1", makeFilterAppState("h1", "todo"));
      await tick();

      expect(framesGood.filter((f) => f.type === "app-update")).toHaveLength(1);
      // Bad subscriber's filter threw → frame not delivered to them.
      expect(framesBad.filter((f) => f.type === "app-update")).toHaveLength(0);
    });
  });

  // ─── Phase 118 code-review HIGH-4 (fix pass 2026-09-18) — snapshot-first ordering ─
  // The subscribe-path app-snapshot is fire-and-forget. Between the moment the
  // subscriber entry is added to the Set and the moment the async snapshot's
  // sendFrame call completes, publishAppUpdate/publishAppGoneByHostSlug ticks
  // COULD deliver updates before the snapshot — the frontend would then
  // overwrite the newer state with the stale snapshot ("picture has lied"
  // race). Queue-until-snapshot-flushes closes that window.
  describe("Phase 118 HIGH-4 fix — subscribe-snapshot ordering", () => {
    // A controllable filter — the test awaits `resolveFilter()` to release the
    // in-flight snapshot promise, letting us fire publishes DURING the window
    // deterministically without racing setTimeout.
    function makeGatedFilter() {
      let resolveFn: (() => void) | undefined;
      const gate = new Promise<void>((r) => {
        resolveFn = r;
      });
      const filter = vi.fn(async (frame: FrontendOutboundFrameType) => {
        await gate;
        return frame;
      });
      return {
        filter,
        release: () => {
          if (resolveFn) resolveFn();
        },
      };
    }

    function makeAppState2(
      hostId: string,
      slug: string,
      overrides: Partial<AppState> = {},
    ): AppState {
      return {
        hostId,
        slug,
        title: `App ${slug}`,
        description: "test app",
        port: 9591,
        hasIcon: false,
        createdAtMs: 1_700_000_000_000,
        isHealthy: true,
        healthMessage: null,
        ...overrides,
      };
    }

    async function tick(): Promise<void> {
      await new Promise((r) => setTimeout(r, 20));
    }

    it("HIGH-4-1: publishAppUpdate fired DURING the subscribe-snapshot window is queued — subscriber receives snapshot FIRST, then the update", async () => {
      const { filter, release } = makeGatedFilter();
      const registry = createSubscriptionRegistry({ appFrameFilter: filter });
      // Seed a pre-existing app so the snapshot contents differ from the
      // subsequent update (semantically distinct frames — proves ordering).
      registry.publishAppUpdate("h1", makeAppState2("h1", "todo"));

      const received: FrontendOutboundFrameType[] = [];
      // Subscribe with a userId → filter engages → pendingAppFrames = []
      registry.subscribe((f) => received.push(f), { userId: "U1" });

      // In the queue-window: publish an app-update BEFORE the filter releases.
      registry.publishAppUpdate(
        "h1",
        makeAppState2("h1", "todo", { title: "Updated Title" }),
      );

      // Snapshot promise still gated — receiving should NOT yet contain the
      // filtered app-snapshot OR the queued app-update.
      const appFramesBeforeRelease = received.filter(
        (f) => f.type === "app-snapshot" || f.type === "app-update",
      );
      expect(appFramesBeforeRelease).toHaveLength(0);

      release();
      await tick();

      // After release: app-snapshot arrives FIRST, then the queued update.
      const appFrames = received.filter(
        (f) => f.type === "app-snapshot" || f.type === "app-update",
      );
      expect(appFrames.length).toBeGreaterThanOrEqual(2);
      expect(appFrames[0].type).toBe("app-snapshot");
      expect(appFrames[1].type).toBe("app-update");
      if (appFrames[1].type === "app-update") {
        expect(appFrames[1].app.title).toBe("Updated Title");
      }
    });

    it("HIGH-4-2: publishAppGoneByHostSlug fired DURING the subscribe-snapshot window is also queued after the snapshot", async () => {
      const { filter, release } = makeGatedFilter();
      const registry = createSubscriptionRegistry({ appFrameFilter: filter });
      registry.publishAppUpdate("h1", makeAppState2("h1", "todo"));

      const received: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => received.push(f), { userId: "U1" });

      // Gone fires DURING the queue window.
      registry.publishAppGoneByHostSlug("h1", "todo");

      const appFramesBeforeRelease = received.filter(
        (f) => f.type === "app-snapshot" || f.type === "app-gone",
      );
      expect(appFramesBeforeRelease).toHaveLength(0);

      release();
      await tick();

      const appFrames = received.filter(
        (f) => f.type === "app-snapshot" || f.type === "app-gone",
      );
      expect(appFrames.length).toBeGreaterThanOrEqual(2);
      expect(appFrames[0].type).toBe("app-snapshot");
      expect(appFrames[1].type).toBe("app-gone");
    });

    it("HIGH-4-3: after snapshot flushes, subsequent publishes deliver normally — the queue is null and no double-buffering occurs", async () => {
      const { filter, release } = makeGatedFilter();
      const registry = createSubscriptionRegistry({ appFrameFilter: filter });

      const received: FrontendOutboundFrameType[] = [];
      registry.subscribe((f) => received.push(f), { userId: "U1" });

      release();
      await tick();
      received.length = 0;

      // Post-flush publish delivers normally — one fanOutApp round trip.
      registry.publishAppUpdate("h1", makeAppState2("h1", "todo"));
      await tick();

      const updates = received.filter((f) => f.type === "app-update");
      expect(updates).toHaveLength(1);

      registry.publishAppUpdate(
        "h1",
        makeAppState2("h1", "todo", { title: "Second" }),
      );
      await tick();
      const allUpdates = received.filter((f) => f.type === "app-update");
      expect(allUpdates).toHaveLength(2);
    });

    it("HIGH-4-4: disposer called DURING the queue window — no leaked frames delivered after unsubscribe", async () => {
      const { filter, release } = makeGatedFilter();
      const registry = createSubscriptionRegistry({ appFrameFilter: filter });

      const received: FrontendOutboundFrameType[] = [];
      const dispose = registry.subscribe((f) => received.push(f), {
        userId: "U1",
      });

      // Queue an update in the pending window
      registry.publishAppUpdate("h1", makeAppState2("h1", "todo"));

      // Dispose BEFORE the filter releases
      dispose();

      release();
      await tick();

      // No app frames should reach the subscriber (snapshot AND the queued
      // update are dropped because the disposer removed the entry from the
      // Set + nulled the queue).
      const appFrames = received.filter(
        (f) =>
          f.type === "app-snapshot" ||
          f.type === "app-update" ||
          f.type === "app-gone",
      );
      // The snapshot might still land (fire-and-forget resolves and calls
      // sendFrame regardless of Set membership — we still send the initial
      // snapshot via the closure's sendFrame reference). But the QUEUED
      // update MUST NOT be delivered — the drain checks
      // `subscribers.has(entry)` first.
      const queuedUpdates = appFrames.filter((f) => f.type === "app-update");
      expect(queuedUpdates).toHaveLength(0);
    });
  });
});
