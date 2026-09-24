/**
 * Task 1 — Wire protocol tests (TDD RED phase)
 *
 * Tests 1-6: wire-protocol.ts schema validation
 * Test 7: host-id-resolver.ts is in host-id-resolver.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  FRAME_SCHEMA_VERSION,
  WatcherInboundFrame,
  FrontendOutboundFrame,
  FrontendInboundFrame,
  SessionStateSchema,
  // Phase 118 Plan 118-03 — app frame surface (D-05 seven fields + D-14 three frame kinds)
  AppStateSchema,
  makeAppSnapshotFrame,
  makeAppUpdateFrame,
  makeAppGoneFrame,
} from "./wire-protocol.js";
import type { AppState } from "./wire-protocol.js";

const validSessionState = {
  hostId: "host-42",
  tmuxSession: "tina",
  sessionId: "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
  pid: 3941934,
  status: "busy" as const,
  backgroundTasks: [],
  updatedAt: 1786577996976,
};

describe("wire-protocol", () => {
  it("Test 1: FRAME_SCHEMA_VERSION is exported as a numeric constant starting at 1", () => {
    expect(typeof FRAME_SCHEMA_VERSION).toBe("number");
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  it("Test 2: WatcherInboundFrame accepts valid hello frame and rejects frame missing hostname", () => {
    const validHello = {
      schemaVersion: 1,
      type: "hello",
      hostname: "thenasty",
    };
    expect(WatcherInboundFrame.safeParse(validHello).success).toBe(true);

    const missingHostname = { schemaVersion: 1, type: "hello" };
    const result = WatcherInboundFrame.safeParse(missingHostname);
    expect(result.success).toBe(false);
  });

  it("Test 3: WatcherInboundFrame accepts valid session_state and rejects state missing sessionId", () => {
    const validState = {
      schemaVersion: 1,
      type: "session_state",
      state: validSessionState,
    };
    expect(WatcherInboundFrame.safeParse(validState).success).toBe(true);

    const missingSessionId = {
      schemaVersion: 1,
      type: "session_state",
      state: { ...validSessionState, sessionId: undefined },
    };
    const result = WatcherInboundFrame.safeParse(missingSessionId);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("sessionId"))).toBe(true);
    }
  });

  it("Test 4: WatcherInboundFrame accepts valid session_gone frame", () => {
    const validGone = {
      schemaVersion: 1,
      type: "session_gone",
      tmuxSession: "tina",
      sessionId: "abc",
    };
    expect(WatcherInboundFrame.safeParse(validGone).success).toBe(true);
  });

  it("Test 5: FrontendOutboundFrame emits snapshot, update, and gone variants — each carrying schemaVersion", () => {
    const snapshot = {
      type: "snapshot",
      schemaVersion: 1,
      states: [validSessionState],
    };
    const update = {
      type: "update",
      schemaVersion: 1,
      state: validSessionState,
    };
    const gone = {
      type: "gone",
      schemaVersion: 1,
      hostId: "host-42",
      tmuxSession: "tina",
      sessionId: "abc",
    };
    const pong = { type: "pong", schemaVersion: 1 };

    expect(FrontendOutboundFrame.safeParse(snapshot).success).toBe(true);
    expect(FrontendOutboundFrame.safeParse(update).success).toBe(true);
    expect(FrontendOutboundFrame.safeParse(gone).success).toBe(true);
    expect(FrontendOutboundFrame.safeParse(pong).success).toBe(true);

    // Each must carry schemaVersion
    const noVersion = { type: "snapshot", states: [] };
    expect(FrontendOutboundFrame.safeParse(noVersion).success).toBe(false);
  });

  it("Test 6: FrontendInboundFrame accepts subscribe frame and rejects unknown types", () => {
    const subscribe = { schemaVersion: 1, type: "subscribe" };
    expect(FrontendInboundFrame.safeParse(subscribe).success).toBe(true);

    const ping = { schemaVersion: 1, type: "ping" };
    expect(FrontendInboundFrame.safeParse(ping).success).toBe(true);

    const unknown = { schemaVersion: 1, type: "unknown_type" };
    const result = FrontendInboundFrame.safeParse(unknown);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should reference the discriminant field
      const issueTexts = result.error.issues.map((i) => JSON.stringify(i));
      expect(issueTexts.some((t) => t.includes("type"))).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Phase 41 Plan 03 — lastMessageAt is an optional, back-compat field on
  // SessionState. Additive-only wire extension; FRAME_SCHEMA_VERSION stays at 1.
  // ---------------------------------------------------------------------------

  it("Test A (Phase 41 Plan 03 schema back-compat): SessionState parses when lastMessageAt is OMITTED — field is optional, watcher pre-dating Phase 41 remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry lastMessageAt —
    // parse must succeed; the parsed result must have lastMessageAt === undefined
    // (optional field, no default).
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastMessageAt).toBeUndefined();
    }
  });

  it("Test B (Phase 41 Plan 03 schema forward): SessionState parses when lastMessageAt is a numeric unix-millis timestamp — the numeric value is preserved", () => {
    const withTimestamp = { ...validSessionState, lastMessageAt: 1700000000000 };
    const result = SessionStateSchema.safeParse(withTimestamp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastMessageAt).toBe(1700000000000);
    }
  });

  it("Test C (Phase 41 Plan 03 schema null): SessionState parses when lastMessageAt is explicitly null — the null value is preserved (no-history convention)", () => {
    const withNull = { ...validSessionState, lastMessageAt: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastMessageAt).toBeNull();
    }
  });

  it("Test A-guard (Phase 41 Plan 03): FRAME_SCHEMA_VERSION is NOT bumped by the additive+optional lastMessageAt extension — stays at 1", () => {
    // Additive+optional fields never require a version bump. If this test
    // fails, someone bumped the version without recording the breaking change
    // rationale (Phase 41 Plan 03 is deliberately non-breaking).
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Phase 47 Plan 01 — aiTitle is an optional, back-compat field on
  // SessionState carrying the harness-produced ai-title string
  // (`{"type":"ai-title","aiTitle":"…","sessionId":"…"}`) from the session
  // JSONL tail. Additive-only wire extension; FRAME_SCHEMA_VERSION stays at 1.
  // ---------------------------------------------------------------------------

  it("Test P47-01 A (Phase 47 Plan 01 schema forward): SessionState parses when aiTitle is a string — the string value is preserved", () => {
    const withTitle = { ...validSessionState, aiTitle: "Fix bug X" };
    const result = SessionStateSchema.safeParse(withTitle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiTitle).toBe("Fix bug X");
    }
  });

  it("Test P47-01 B (Phase 47 Plan 01 schema null): SessionState parses when aiTitle is explicitly null — the null value is preserved (no-title-yet convention)", () => {
    const withNull = { ...validSessionState, aiTitle: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiTitle).toBeNull();
    }
  });

  it("Test P47-01 C (Phase 47 Plan 01 schema back-compat): SessionState parses when aiTitle is OMITTED — field is optional, pre-Phase-47 watcher remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry aiTitle —
    // parse must succeed; the parsed result has aiTitle === undefined
    // (optional field, no default). Frontend consumer treats undefined
    // and null identically (both → working-store cache holds null → row
    // renders the fallback ellipsis).
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aiTitle).toBeUndefined();
    }
  });

  it("Test P47-01 D (Phase 47 Plan 01 schema type-enforcement): SessionState rejects aiTitle of wrong type (number) — z.string() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, aiTitle: 42 };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("aiTitle"))).toBe(true);
    }
  });

  it("Test P47-01 A-guard (Phase 47 Plan 01): FRAME_SCHEMA_VERSION is NOT bumped by the additive+optional aiTitle extension — stays at 1", () => {
    // Same rationale as Phase 41 Plan 03: additive+optional fields never
    // require a version bump. Guard against inadvertent bumps.
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Phase 52 Plan 01 — dormant is an optional, back-compat boolean field on
  // SessionState carrying the inline supervisor-dormancy signal. Source is the
  // ~/fleet/identities/<tmuxSession>/.dormant sentinel file on the target
  // host. Additive-only wire extension; FRAME_SCHEMA_VERSION stays at 1.
  // Three-valued semantics: true → sentinel present, false → sentinel absent,
  // undefined → emitting watcher pre-dates this phase (treated as false).
  // ---------------------------------------------------------------------------

  it("Test P52-01 A (Phase 52 Plan 01 schema forward — true): SessionState parses when dormant is true — the boolean value is preserved", () => {
    const withDormantTrue = { ...validSessionState, dormant: true };
    const result = SessionStateSchema.safeParse(withDormantTrue);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dormant).toBe(true);
    }
  });

  it("Test P52-01 B (Phase 52 Plan 01 schema forward — false): SessionState parses when dormant is false — the boolean value is preserved", () => {
    const withDormantFalse = { ...validSessionState, dormant: false };
    const result = SessionStateSchema.safeParse(withDormantFalse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dormant).toBe(false);
    }
  });

  it("Test P52-01 C (Phase 52 Plan 01 schema null): SessionState parses when dormant is explicitly null — the null value is preserved (pre-Phase-52 path through nullable)", () => {
    const withNull = { ...validSessionState, dormant: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dormant).toBeNull();
    }
  });

  it("Test P52-01 D (Phase 52 Plan 01 schema back-compat): SessionState parses when dormant is OMITTED — field is optional, pre-Phase-52 watcher remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry dormant —
    // parse must succeed; the parsed result has dormant === undefined
    // (optional field, no default). Frontend consumer treats undefined
    // and null identically (both → false per the AND-of-negations Ready predicate).
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dormant).toBeUndefined();
    }
  });

  it("Test P52-01 E (Phase 52 Plan 01 schema type-enforcement): SessionState rejects dormant of wrong type (string) — z.boolean() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, dormant: "yes" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("dormant"))).toBe(true);
    }
  });

  it("Test P52-01 F (Phase 52 Plan 01 schema version guard): FRAME_SCHEMA_VERSION is NOT bumped by the additive+optional dormant extension — stays at 1", () => {
    // Additive+optional fields never require a version bump per T-41-03-05 mitigation.
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  // Phase 53 Plan 01 — recycling is an optional, back-compat boolean field on
  // SessionState. Source: ~/fleet/identities/<tmuxSession>/.recycled-at sentinel
  // file on the target host. Semantics: true → sentinel present (recycle in flight);
  // false → sentinel absent; null → normalised-null; undefined → pre-Phase-53 watcher.
  // Frontend treats undefined/null identically (both → false). FRAME_SCHEMA_VERSION
  // deliberately held at 1 (same T-41-03-05 mitigation as lastMessageAt/aiTitle/dormant).

  it("Test P53-01 A (Phase 53 Plan 01 schema forward — true): SessionState parses when recycling is true — the boolean value is preserved", () => {
    const withRecyclingTrue = { ...validSessionState, recycling: true };
    const result = SessionStateSchema.safeParse(withRecyclingTrue);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recycling).toBe(true);
    }
  });

  it("Test P53-01 B (Phase 53 Plan 01 schema forward — false): SessionState parses when recycling is false — the boolean value is preserved", () => {
    const withRecyclingFalse = { ...validSessionState, recycling: false };
    const result = SessionStateSchema.safeParse(withRecyclingFalse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recycling).toBe(false);
    }
  });

  it("Test P53-01 C (Phase 53 Plan 01 schema null): SessionState parses when recycling is explicitly null — the null value is preserved (pre-Phase-53 path through nullable)", () => {
    const withNull = { ...validSessionState, recycling: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recycling).toBeNull();
    }
  });

  it("Test P53-01 D (Phase 53 Plan 01 schema back-compat): SessionState parses when recycling is OMITTED — field is optional, pre-Phase-53 watcher remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry recycling —
    // parse must succeed; the parsed result has recycling === undefined
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recycling).toBeUndefined();
    }
  });

  it("Test P53-01 E (Phase 53 Plan 01 schema type-enforcement): SessionState rejects recycling of wrong type (string) — z.boolean() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, recycling: "yes" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("recycling"))).toBe(true);
    }
  });

  it("Test P53-01 F (Phase 53 Plan 01 schema version guard): FRAME_SCHEMA_VERSION is NOT bumped by the additive+optional recycling extension — stays at 1", () => {
    // Additive+optional fields never require a version bump per T-41-03-05 mitigation.
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 59 Plan 01 — lastStopAt + lastStatusChangeAt are optional, back-compat
// numeric fields on SessionState. lastStopAt: unix millis derived from the
// mtime of ~/.claude/fleet-status/stop-<sessionId>.json on the target host
// (0 = never; null = normalised-null in transit; undefined = pre-Phase-59
// emitter). lastStatusChangeAt: unix millis of the most recent poll tick
// where sessionJson.status transitioned to a different value — derived
// SERVER-SIDE by comparing this-tick status to previous-tick cached status
// (NOT sourced from sessionJson.updatedAt, which the harness bumps for
// compose-box typing without a real state transition).
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// (T-41-03-05 mitigation, fifth iteration inheriting the pattern established
// by Phase 41 lastMessageAt, continued by Phase 47 aiTitle + Phase 52
// dormant + Phase 53 recycling).
// ---------------------------------------------------------------------------

describe("wire-protocol Phase 59 additive axes — lastStopAt + lastStatusChangeAt", () => {
  it("Test P57-01 A (Phase 59 Plan 01 schema forward — lastStopAt number): SessionStateSchema accepts state with lastStopAt as a number — the numeric value is preserved", () => {
    const withStop = { ...validSessionState, lastStopAt: 1730000000000 };
    const result = SessionStateSchema.safeParse(withStop);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStopAt).toBe(1730000000000);
    }
  });

  it("Test P57-01 B (Phase 59 Plan 01 schema null — lastStopAt): SessionStateSchema accepts state with lastStopAt as null — the null value is preserved", () => {
    const withNull = { ...validSessionState, lastStopAt: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStopAt).toBeNull();
    }
  });

  it("Test P57-01 C (Phase 59 Plan 01 schema back-compat — lastStopAt): SessionStateSchema accepts state OMITTING lastStopAt — field is optional, pre-Phase-59 emitter remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry lastStopAt —
    // parse must succeed; the parsed result has lastStopAt === undefined
    // (optional field, no default). Frontend consumer treats undefined
    // and null identically at the working-store boundary (see 59-03).
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStopAt).toBeUndefined();
    }
  });

  it("Test P57-01 D (Phase 59 Plan 01 schema type-enforcement — lastStopAt): SessionStateSchema REJECTS state with lastStopAt as a string — z.number() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, lastStopAt: "not-a-number" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("lastStopAt"))).toBe(true);
    }
  });

  it("Test P57-01 A (Phase 59 Plan 01 schema forward — lastStatusChangeAt number): SessionStateSchema accepts state with lastStatusChangeAt as a number — the numeric value is preserved", () => {
    const withChange = { ...validSessionState, lastStatusChangeAt: 1730000005000 };
    const result = SessionStateSchema.safeParse(withChange);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStatusChangeAt).toBe(1730000005000);
    }
  });

  it("Test P57-01 B (Phase 59 Plan 01 schema null — lastStatusChangeAt): SessionStateSchema accepts state with lastStatusChangeAt as null — the null value is preserved", () => {
    const withNull = { ...validSessionState, lastStatusChangeAt: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStatusChangeAt).toBeNull();
    }
  });

  it("Test P57-01 C (Phase 59 Plan 01 schema back-compat — lastStatusChangeAt): SessionStateSchema accepts state OMITTING lastStatusChangeAt — field is optional, pre-Phase-59 emitter remains compatible", () => {
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStatusChangeAt).toBeUndefined();
    }
  });

  it("Test P57-01 D (Phase 59 Plan 01 schema type-enforcement — lastStatusChangeAt): SessionStateSchema REJECTS state with lastStatusChangeAt as a string — z.number() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, lastStatusChangeAt: "not-a-number" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("lastStatusChangeAt"))).toBe(true);
    }
  });

  it("Test P57-01 E (Phase 59 Plan 01 schema version guard): FRAME_SCHEMA_VERSION remains 1 — the two additive+optional axes never require a version bump (T-41-03-05 mitigation)", () => {
    // Fifth iteration of the pattern established by Phase 41 lastMessageAt
    // (continued by Phase 47 aiTitle + Phase 52 dormant + Phase 53 recycling).
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  it("Test P57-01 F (Phase 59 Plan 01 schema both-fields): SessionStateSchema accepts state with BOTH lastStopAt AND lastStatusChangeAt populated in the same frame — both values are preserved", () => {
    const withBoth = {
      ...validSessionState,
      lastStopAt: 1730000000000,
      lastStatusChangeAt: 1730000005000,
    };
    const result = SessionStateSchema.safeParse(withBoth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastStopAt).toBe(1730000000000);
      expect(result.data.lastStatusChangeAt).toBe(1730000005000);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 62 Plan 03 — activityMtime + stoppedMtime are optional, back-compat
// numeric fields on SessionState. Sources: mtime × 1000 of the two per-session
// marker files touched by the Plan 62-01 hook scripts installed via Plan 62-02:
//   - activityMtime: ~/.claude/fleet-status/hooks/<sessionId>/activity
//                    (touched on UserPromptSubmit + PreToolUse)
//   - stoppedMtime:  ~/.claude/fleet-status/hooks/<sessionId>/stopped
//                    (touched on Stop + StopFailure + PermissionRequest)
//
// Semantics (both fields):
//   - number    → mtime present (unix millis, seconds × 1000).
//   - null      → marker file absent OR SSH-hiccup normalised-null (frontend
//                 treats identically at session-working-store boundary; both
//                 signal "no direct hook signal available for this session —
//                 Option-1 rollout fallback engages, use Phase 59 predicate").
//   - undefined → emitting backend pre-dates Phase 62.
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1 —
// sixth iteration of the T-41-03-05 mitigation established by Phase 41
// lastMessageAt (Phase 41 → 47 aiTitle → 52 dormant → 53 recycling → 59
// lastStopAt + lastStatusChangeAt → this Phase 62 addition).
//
// Option-1 rollout retention proof: Phase 59 lastStopAt + lastStatusChangeAt
// fields remain on the wire alongside the two new axes for the entire Phase
// 62 rollout window — the frontend chooses which predicate to consume per-
// session based on marker presence (Plan 62-04). A follow-up phase retires
// the Phase 59 fields post-full-rollout.
// ---------------------------------------------------------------------------

describe("wire-protocol Phase 62 additive axes — activityMtime + stoppedMtime", () => {
  it("Test P62-03 A (activityMtime number): SessionStateSchema accepts state with activityMtime as a number — the numeric value is preserved", () => {
    const withActivity = { ...validSessionState, activityMtime: 1730000000000 };
    const result = SessionStateSchema.safeParse(withActivity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activityMtime).toBe(1730000000000);
    }
  });

  it("Test P62-03 B (activityMtime null): SessionStateSchema accepts state with activityMtime as null — the null value is preserved (marker absent OR SSH-hiccup normalised-null)", () => {
    const withNull = { ...validSessionState, activityMtime: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activityMtime).toBeNull();
    }
  });

  it("Test P62-03 C (activityMtime omitted — back-compat): SessionStateSchema accepts state OMITTING activityMtime — field is optional, pre-Phase-62 emitter remains compatible", () => {
    // validSessionState fixture at top-of-file does NOT carry activityMtime —
    // parse must succeed; the parsed result has activityMtime === undefined
    // (optional field, no default). Frontend consumer (Plan 62-04) treats
    // undefined and null identically at the working-store boundary — both
    // signal "no direct hook signal, fall through to Phase 59 predicate".
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activityMtime).toBeUndefined();
    }
  });

  it("Test P62-03 D (activityMtime type-enforcement): SessionStateSchema REJECTS state with activityMtime as a string — z.number() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, activityMtime: "not-a-number" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("activityMtime"))).toBe(true);
    }
  });

  it("Test P62-03 A (stoppedMtime number): SessionStateSchema accepts state with stoppedMtime as a number — the numeric value is preserved", () => {
    const withStopped = { ...validSessionState, stoppedMtime: 1730000005000 };
    const result = SessionStateSchema.safeParse(withStopped);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stoppedMtime).toBe(1730000005000);
    }
  });

  it("Test P62-03 B (stoppedMtime null): SessionStateSchema accepts state with stoppedMtime as null — the null value is preserved (marker absent OR SSH-hiccup normalised-null)", () => {
    const withNull = { ...validSessionState, stoppedMtime: null };
    const result = SessionStateSchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stoppedMtime).toBeNull();
    }
  });

  it("Test P62-03 C (stoppedMtime omitted — back-compat): SessionStateSchema accepts state OMITTING stoppedMtime — field is optional, pre-Phase-62 emitter remains compatible", () => {
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stoppedMtime).toBeUndefined();
    }
  });

  it("Test P62-03 D (stoppedMtime type-enforcement): SessionStateSchema REJECTS state with stoppedMtime as a string — z.number() enforces the type when the field IS present", () => {
    const withBadType = { ...validSessionState, stoppedMtime: "not-a-number" };
    const result = SessionStateSchema.safeParse(withBadType);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("stoppedMtime"))).toBe(true);
    }
  });

  it("Test P62-03 E (both new fields populated together): SessionStateSchema accepts state with BOTH activityMtime AND stoppedMtime populated in the same frame — both values are preserved", () => {
    const withBoth = {
      ...validSessionState,
      activityMtime: 1730000000000,
      stoppedMtime: 1730000005000,
    };
    const result = SessionStateSchema.safeParse(withBoth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activityMtime).toBe(1730000000000);
      expect(result.data.stoppedMtime).toBe(1730000005000);
    }
  });

  it("Test P62-03 F (schema version guard): FRAME_SCHEMA_VERSION remains 1 — the two additive+optional axes never require a version bump (T-41-03-05 mitigation, sixth iteration)", () => {
    // Sixth iteration of the pattern:
    //   Phase 41 lastMessageAt → Phase 47 aiTitle → Phase 52 dormant →
    //   Phase 53 recycling → Phase 59 lastStopAt + lastStatusChangeAt →
    //   this Phase 62 activityMtime + stoppedMtime.
    // Every prior addition held the version at 1; this one continues that.
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  it("Test P62-03 G (Option-1 rollout retention proof): SessionStateSchema accepts state with the full Phase 62 axis set AND the retained Phase 59 axis set populated together — all four values are preserved (backend publishes both signal sets simultaneously during rollout window)", () => {
    // CONTEXT.md §Rollout Option 1 (LOCKED): backend publishes BOTH the new
    // Phase 62 mtime axes AND the retained Phase 59 lastStopAt +
    // lastStatusChangeAt axes for the entire rollout window. Frontend Plan
    // 62-04 chooses which predicate to consume per-session based on marker
    // presence (activityMtime !== null || stoppedMtime !== null → new
    // predicate; both null → fall through to Phase 59 shell-idle-gate).
    const withAllFour = {
      ...validSessionState,
      activityMtime: 1730000000000,
      stoppedMtime: 1730000005000,
      lastStopAt: 1729999999000,
      lastStatusChangeAt: 1730000001000,
    };
    const result = SessionStateSchema.safeParse(withAllFour);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activityMtime).toBe(1730000000000);
      expect(result.data.stoppedMtime).toBe(1730000005000);
      expect(result.data.lastStopAt).toBe(1729999999000);
      expect(result.data.lastStatusChangeAt).toBe(1730000001000);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 111 Plan 111-02 — identityAppearance field tests
// ---------------------------------------------------------------------------

describe("Phase 111 Plan 111-02 — identityAppearance on SessionStateSchema", () => {
  const validAppearance = {
    displayName: "Pixel",
    title: "Skynet",
    colorHue: 324,
    voice: null,
    task: "Building things",
    coordinator: false,
    role: "box-maintainer",
    roleDefaults: { title: "Skynet", colorHue: 324 },
    avatarUrl: "/identities/pixel/avatar?hostId=6",
    pinned: false,
  };

  it("Test P111-02 A: FRAME_SCHEMA_VERSION is still 1 (eighth additive-optional iteration, D-04)", () => {
    // Eighth iteration of the T-41-03-05 mitigation.
    // If this fails, FRAME_SCHEMA_VERSION was bumped — that rejects all frames
    // simultaneously rather than degrading gracefully (DO NOT bump).
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });

  it("Test P111-02 B: SessionStateSchema accepts state with fully-populated identityAppearance", () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: validAppearance,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identityAppearance).toEqual(validAppearance);
    }
  });

  it("Test P111-02 C: SessionStateSchema accepts identityAppearance: null (fail-closed / hold-last signal)", () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identityAppearance).toBeNull();
    }
  });

  it("Test P111-02 D: SessionStateSchema accepts identityAppearance absent entirely (pre-Plan-111-01 host or source-A frame)", () => {
    // validSessionState at top-of-file does NOT carry identityAppearance —
    // must parse as undefined (optional field).
    const result = SessionStateSchema.safeParse(validSessionState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identityAppearance).toBeUndefined();
    }
  });

  it("Test P111-02 E: SessionStateSchema REJECTS identityAppearance with numeric displayName (nested schema validates, not z.unknown())", () => {
    // This test proves the nested IdentityAppearanceSchema actually validates
    // rather than being a pass-through z.unknown(). If someone swaps the nested
    // schema to z.unknown(), this test will catch it.
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: {
        ...validAppearance,
        displayName: 42, // number, should be string
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("displayName"))).toBe(true);
    }
  });

  // Phase 117 M6 fix (2026-09-18): IdentityAppearanceSchema now carries
  // `project` (nullable + optional). This lets the source-B pulse publisher
  // propagate identity project frontmatter over the WS instead of the
  // frontend hardcoding `project: null` for pulse-appended identities.
  it("Test P117-M6 A: identityAppearance accepts `project: <slug>` (string)", () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: {
        ...validAppearance,
        project: "alpha",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identityAppearance).toMatchObject({
        project: "alpha",
      });
    }
  });

  it("Test P117-M6 B: identityAppearance accepts `project: null` (identity has no project frontmatter)", () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: {
        ...validAppearance,
        project: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identityAppearance).toMatchObject({
        project: null,
      });
    }
  });

  it("Test P117-M6 C: identityAppearance accepts `project` absent (back-compat with pre-M6 publisher)", () => {
    // validAppearance itself omits `project` — this test confirms that's
    // still valid post-fix (schema field is .optional()).
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: validAppearance,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // project is undefined (not present in the parsed data) — the
      // frontend's merge path treats `undefined` as "no signal this tick".
      expect(
        (result.data.identityAppearance as { project?: unknown }).project,
      ).toBeUndefined();
    }
  });

  it("Test P117-M6 D: identityAppearance rejects numeric `project` (nested schema type check)", () => {
    const result = SessionStateSchema.safeParse({
      ...validSessionState,
      identityAppearance: {
        ...validAppearance,
        project: 42,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("project"))).toBe(true);
    }
  });
});

// ─── Phase 117 Plan 117-03 — project-list-changed frame (D-37) ───────────────
// Locks the distinct wire message shape for the projects pool. The frame
// carries the FULL projects array on every emit (RESEARCH § Open Q #4 —
// projects are cheap; a full-replace matches the Phase 115 registry-cache-
// then-fanout discipline). Snapshot-on-subscribe replays the cached array
// to reconnecting clients, mirroring the archivedIdentities replay pattern.
// FRAME_SCHEMA_VERSION deliberately held at 1 — adding a discriminated-union
// entry is additive and does NOT break older clients.

describe("wire-protocol Phase 117 Plan 117-03 — project-list-changed frame", () => {
  it("Test P117-03-1 (schema shape parse-happy): FrontendProjectListChangedFrameSchema.parse succeeds with a well-formed frame", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      hostId: "1",
      projects: [
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("project-list-changed");
      expect(result.data.hostId).toBe("1");
      expect(result.data.projects).toHaveLength(1);
      expect(result.data.projects[0].slug).toBe("alpha");
    }
  });

  it("Test P117-03-2 (empty projects array is valid): parse with `projects: []` succeeds — represents 'this host now has zero projects'", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      hostId: "1",
      projects: [],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual([]);
    }
  });

  it("Test P117-03-3 (schema rejects wrong type discriminant): parse with `type: 'snapshot'` fails", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "snapshot",
      hostId: "1",
      projects: [],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it("Test P117-03-4 (schema rejects wrong schemaVersion): parse with `schemaVersion: 99` fails", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: 99,
      type: "project-list-changed",
      hostId: "1",
      projects: [],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it("Test P117-03-5 (schema rejects missing project field): parse with a project missing `slug` fails", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      hostId: "1",
      projects: [
        {
          // slug: missing
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("slug"))).toBe(true);
    }
  });

  it("Test P117-03-6 (schema rejects wrong archived type): parse with `archived: 'false'` (string) fails", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      hostId: "1",
      projects: [
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: "false",
        },
      ],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("archived"))).toBe(true);
    }
  });

  it("Test P117-03-7 (discriminatedUnion accepts project-list-changed frame): additive extension preserves existing coverage", () => {
    const projectFrame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      hostId: "1",
      projects: [
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ],
    };
    expect(FrontendOutboundFrame.safeParse(projectFrame).success).toBe(true);

    // The Phase 115 identity-archived frame was retired in the Phase 122 shape
    // follow-up — it MUST no longer parse via FrontendOutboundFrame.
    const archivedFrame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "identity-archived",
      name: "wren",
      hostId: "42",
      hostname: "thenasty",
    };
    expect(FrontendOutboundFrame.safeParse(archivedFrame).success).toBe(false);
  });

  it("Test P117-03-8 (makeProjectListChangedFrame builder + round-trip): returns a frame with schemaVersion+type+hostId+projects; parses cleanly through FrontendOutboundFrame", async () => {
    const { makeProjectListChangedFrame } = await import("./wire-protocol.js");
    const projects = [
      {
        slug: "alpha",
        displayName: "Alpha",
        hostId: "1",
        hostname: "t1000",
        archived: false,
      },
      {
        slug: "beta",
        displayName: "Beta",
        hostId: "1",
        hostname: "t1000",
        archived: true,
      },
    ];
    const frame = makeProjectListChangedFrame("1", projects);
    expect(frame.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
    expect(frame.type).toBe("project-list-changed");
    if (frame.type === "project-list-changed") {
      expect(frame.hostId).toBe("1");
      expect(frame.projects).toEqual(projects);
    }

    // Round-trip: builder output MUST parse via FrontendOutboundFrame.
    const parsed = FrontendOutboundFrame.safeParse(frame);
    expect(parsed.success).toBe(true);
  });

  it("Test P117-03-10 (schema requires top-level hostId scope field): parse with hostId missing fails", async () => {
    const { FrontendProjectListChangedFrameSchema } = await import(
      "./wire-protocol.js"
    );
    const frame = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "project-list-changed",
      // hostId: missing
      projects: [],
    };
    const result = FrontendProjectListChangedFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p === "hostId")).toBe(true);
    }
  });

  it("Test P117-03-9 (FRAME_SCHEMA_VERSION unchanged): adding a discriminated-union entry does NOT bump the version — additive-optional invariant", () => {
    // Iterations of the T-41-03-05 mitigation. Lineage:
    //   Phase 41 lastMessageAt → Phase 47 aiTitle → Phase 52 dormant →
    //   Phase 53 recycling → Phase 59 lastStopAt/lastStatusChangeAt →
    //   Phase 62 activityMtime/stoppedMtime → Phase 90 contextPct →
    //   Phase 111 identityAppearance → THIS Phase 117 project-list-changed frame.
    //   (Phase 115 identity-archived frame retired in Phase 122 follow-up.)
    expect(FRAME_SCHEMA_VERSION).toBe(1);
  });
});

// (Phase 115 Plan 115-06 identity-archived-frame describe retired in the
//  Phase 122 shape follow-up alongside the sidebar Archived section + wire
//  pump. The retirement is regression-tested by Test P117-03-7 asserting
//  the frame no longer parses via FrontendOutboundFrame.)

// ─── Phase 118 Plan 118-03 — app frame surface (D-05 / D-14) ─────────────────
// Locks the wire shape for source-C apps: an AppStateSchema mirroring the
// seven D-05 fields (camelCase on the frontend side vs. the sweep wire's
// snake_case — same convention SessionStateSchema uses against SweepIdentityLine)
// plus three new discriminated-union frame kinds — app-snapshot, app-update,
// app-gone — modeled on the session snapshot/update/gone trio. Additive only —
// FRAME_SCHEMA_VERSION is NOT bumped (T-41-03-05 mitigation).

describe("Phase 118 app frame schemas", () => {
  const validAppState: AppState = {
    hostId: "h1",
    slug: "todo",
    title: "Todo",
    description: "A",
    port: 9591,
    hasIcon: false,
    createdAtMs: 1_700_000_000_000,
    isHealthy: true,
    healthMessage: null,
    // Phase 130: per-user visibility gate list. Null = falls open at the
    // gate seam (D-3). Required nullable on AppStateSchema so adapters
    // + fixtures don't need conditional handling.
    users: null,
  };

  it("Test 1: AppStateSchema accepts a valid seven-field app state (healthy branch)", () => {
    const result = AppStateSchema.safeParse(validAppState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("todo");
      expect(result.data.isHealthy).toBe(true);
      expect(result.data.healthMessage).toBeNull();
    }
  });

  it("Test 2: AppStateSchema rejects app state missing hostId", () => {
    const { hostId: _drop, ...missingHostId } = validAppState;
    const result = AppStateSchema.safeParse(missingHostId);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("hostId"))).toBe(true);
    }
  });

  it("Test 3: AppStateSchema accepts port: null (nullable per D-05)", () => {
    const nullPort = { ...validAppState, port: null };
    const result = AppStateSchema.safeParse(nullPort);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBeNull();
    }
  });

  it("Test 4: AppStateSchema accepts unhealthy branch — isHealthy:false + healthMessage string (D-02 + D-03)", () => {
    const unhealthy = {
      ...validAppState,
      isHealthy: false,
      healthMessage: "not running — ask an agent to check on it",
    };
    const result = AppStateSchema.safeParse(unhealthy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isHealthy).toBe(false);
      expect(result.data.healthMessage).toBe(
        "not running — ask an agent to check on it",
      );
    }
  });

  it("Test 5: makeAppSnapshotFrame returns a Zod-valid app-snapshot frame stamped with FRAME_SCHEMA_VERSION", () => {
    const frame = makeAppSnapshotFrame([validAppState]);
    const result = FrontendOutboundFrame.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app-snapshot");
      expect(result.data.schemaVersion).toBe(FRAME_SCHEMA_VERSION);
      if (result.data.type === "app-snapshot") {
        expect(result.data.apps).toHaveLength(1);
        expect(result.data.apps[0]?.slug).toBe("todo");
      }
    }
  });

  it("Test 6: makeAppUpdateFrame returns a Zod-valid app-update frame carrying the app payload", () => {
    const frame = makeAppUpdateFrame(validAppState);
    const result = FrontendOutboundFrame.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app-update");
      if (result.data.type === "app-update") {
        expect(result.data.app.slug).toBe("todo");
        expect(result.data.app.hostId).toBe("h1");
      }
    }
  });

  it("Test 7: makeAppGoneFrame returns a Zod-valid app-gone frame with hostId + slug", () => {
    const frame = makeAppGoneFrame("h1", "todo");
    const result = FrontendOutboundFrame.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app-gone");
      if (result.data.type === "app-gone") {
        expect(result.data.hostId).toBe("h1");
        expect(result.data.slug).toBe("todo");
      }
    }
  });

  it("Test 8: FrontendOutboundFrame discriminated-union accepts an empty-apps snapshot (union was widened correctly)", () => {
    const emptySnapshot = makeAppSnapshotFrame([]);
    const result = FrontendOutboundFrame.safeParse(emptySnapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app-snapshot");
      if (result.data.type === "app-snapshot") {
        expect(result.data.apps).toEqual([]);
      }
    }
  });

  it("Test 9: FrontendOutboundFrame rejects an unknown discriminator (regression guard on the union)", () => {
    const bogus = {
      schemaVersion: FRAME_SCHEMA_VERSION,
      type: "unknown",
    };
    const result = FrontendOutboundFrame.safeParse(bogus);
    expect(result.success).toBe(false);
  });
});
