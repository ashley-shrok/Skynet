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
});
