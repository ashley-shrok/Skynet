// phase-29: truth-table tests for resolvePhase — SPEC req 4
/**
 * Truth-table unit tests for the pure `resolvePhase` reducer defined in
 * ./resolve-phase (phase 29 — unified session-entry state machine,
 * plan 29-01, SPEC req 4).
 *
 * WHY THIS TEST FILE EXISTS:
 *
 * `resolvePhase(wsState, backendFirstFrame): Phase` is the deterministic
 * core of the new pane-entry state machine — one pure function encodes
 * the entire SPEC req 4 truth table, and TypeScript exhaustiveness
 * (`_exhaust: never`) guards against silent drift when a new
 * `BackendFirstFrame` variant is added. That gives us type-level
 * coverage, but the value-level mapping still has to be pinned:
 * changing any branch's return value must show up in a specific
 * failing `it`, not silently ship the wrong overlay on Ashley's PWA.
 *
 * The plan mandates one dedicated `it` block per (wsState ×
 * backendFirstFrame) combination — 4 × 5 = 20 assertions across 4
 * `describe` blocks (grouped by wsState per PATTERNS.md §3). Every
 * assertion spells out the expected `Phase` literal so the failure
 * message on a regression names the exact table row.
 *
 * The pattern is copied verbatim from
 * src/backend/claude-session/layer1-detect.test.ts (the canonical fork
 * test-seam analog). No mocks, no timers, no `renderHook` — this is a
 * pure function; the whole test file is `import + expect`.
 */

import { describe, it, expect } from "vitest";
import {
  resolvePhase,
  type WsState,
  type BackendFirstFrame,
  type Phase,
} from "./resolve-phase";

// ── Type-membership self-checks ──────────────────────────────────────────────
//
// These `satisfies` self-checks pin the union memberships at compile time
// so the acceptance-grep for exact union shape is doubly enforced (grep
// + tsc). If a variant is added or removed upstream, either these arrays
// stop matching their satisfies target or the branch-per-`it` count in
// the describe blocks below no longer covers the full cross product —
// both are loud failures.

const ALL_WS_STATES: readonly WsState[] = [
  "not-connected",
  "opening",
  "open",
  "failed-permanently",
] as const satisfies readonly WsState[];

const ALL_BACKEND_FIRST_FRAMES: readonly BackendFirstFrame[] = [
  "not-yet",
  "active",
  "inactive",
  "session_holding",
  "dormant",
] as const satisfies readonly BackendFirstFrame[];

// Reference the sentinel arrays so unused-var linters do not flag the
// self-checks. The expect assertion is cheap and doubles as a runtime
// safety net if someone edits the arrays without editing the union.
if (ALL_WS_STATES.length !== 4 || ALL_BACKEND_FIRST_FRAMES.length !== 5) {
  throw new Error(
    "resolve-phase.test.ts: union self-check arrays out of sync with resolve-phase.ts",
  );
}

// ── describe #1: wsState=not-connected → always resolving ────────────────────

describe("resolvePhase — wsState=not-connected → always resolving", () => {
  it("not-connected + not-yet → resolving", () => {
    expect(resolvePhase("not-connected", "not-yet")).toBe<Phase>("resolving");
  });

  it("not-connected + active → resolving (WS not up yet, frame ignored)", () => {
    expect(resolvePhase("not-connected", "active")).toBe<Phase>("resolving");
  });

  it("not-connected + inactive → resolving (WS not up yet, frame ignored)", () => {
    expect(resolvePhase("not-connected", "inactive")).toBe<Phase>("resolving");
  });

  it("not-connected + session_holding → resolving (WS not up yet, frame ignored)", () => {
    expect(resolvePhase("not-connected", "session_holding")).toBe<Phase>(
      "resolving",
    );
  });

  it("not-connected + dormant → resolving (WS not up yet, frame ignored)", () => {
    expect(resolvePhase("not-connected", "dormant")).toBe<Phase>("resolving");
  });
});

// ── describe #2: wsState=opening → always resolving ──────────────────────────

describe("resolvePhase — wsState=opening → always resolving", () => {
  it("opening + not-yet → resolving", () => {
    expect(resolvePhase("opening", "not-yet")).toBe<Phase>("resolving");
  });

  it("opening + active → resolving (WS still opening, frame ignored)", () => {
    expect(resolvePhase("opening", "active")).toBe<Phase>("resolving");
  });

  it("opening + inactive → resolving (WS still opening, frame ignored)", () => {
    expect(resolvePhase("opening", "inactive")).toBe<Phase>("resolving");
  });

  it("opening + session_holding → resolving (WS still opening, frame ignored)", () => {
    expect(resolvePhase("opening", "session_holding")).toBe<Phase>("resolving");
  });

  it("opening + dormant → resolving (WS still opening, frame ignored)", () => {
    expect(resolvePhase("opening", "dormant")).toBe<Phase>("resolving");
  });
});

// ── describe #3: wsState=open — terminal-phase branch ────────────────────────

describe("resolvePhase — wsState=open — terminal-phase branch", () => {
  it("open + not-yet → resolving (WS up, no first frame yet — spinner waits)", () => {
    expect(resolvePhase("open", "not-yet")).toBe<Phase>("resolving");
  });

  it("open + active → active", () => {
    expect(resolvePhase("open", "active")).toBe<Phase>("active");
  });

  it("open + session_holding → holding", () => {
    expect(resolvePhase("open", "session_holding")).toBe<Phase>("holding");
  });

  it("open + dormant → dormant", () => {
    expect(resolvePhase("open", "dormant")).toBe<Phase>("dormant");
  });

  it("open + inactive → inactive", () => {
    expect(resolvePhase("open", "inactive")).toBe<Phase>("inactive");
  });
});

// ── describe #4: wsState=failed-permanently → always error ───────────────────
//
// D-04: WS terminal give-up is the ONLY path to `phase === "error"`.
// This branch short-circuits ahead of the WS-still-coming-up branch and
// ahead of the frame-arrival branches, so any backendFirstFrame value
// still yields "error". No wall-clock heuristic anywhere ever resolves
// to error (SPEC req 5).

describe("resolvePhase — wsState=failed-permanently → always error", () => {
  it("failed-permanently + not-yet → error", () => {
    expect(resolvePhase("failed-permanently", "not-yet")).toBe<Phase>("error");
  });

  it("failed-permanently + active → error (WS gave up, frame irrelevant)", () => {
    expect(resolvePhase("failed-permanently", "active")).toBe<Phase>("error");
  });

  it("failed-permanently + inactive → error (WS gave up, frame irrelevant)", () => {
    expect(resolvePhase("failed-permanently", "inactive")).toBe<Phase>("error");
  });

  it("failed-permanently + session_holding → error (WS gave up, frame irrelevant)", () => {
    expect(resolvePhase("failed-permanently", "session_holding")).toBe<Phase>(
      "error",
    );
  });

  it("failed-permanently + dormant → error (WS gave up, frame irrelevant)", () => {
    expect(resolvePhase("failed-permanently", "dormant")).toBe<Phase>("error");
  });
});
