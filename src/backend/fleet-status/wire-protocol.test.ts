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
} from "./wire-protocol.js";

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
  // ~/.claude/identities/<tmuxSession>/.dormant sentinel file on the target
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
  // SessionState. Source: ~/.claude/identities/<tmuxSession>/.recycled-at sentinel
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
