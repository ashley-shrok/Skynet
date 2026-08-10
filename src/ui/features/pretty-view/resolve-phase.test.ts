// phase-30: truth-table tests for resolveRenderedState — PS30-06 LOCKED truth table
/**
 * Truth-table unit tests for the pure `resolveRenderedState` reducer defined
 * in ./resolve-phase (phase 30 — pane-state backend-authoritative, no client
 * inference; plan 30-03, requirements PS30-04 + PS30-05 + PS30-06 + PS30-08).
 *
 * WHY THIS TEST FILE EXISTS (post-Phase-30 rewrite):
 *
 * The old Phase-29 `resolvePhase(wsState, backendFirstFrame)` reducer took
 * a 4×5 truth table over CLIENT-INFERRED first-frame values. Phase 30
 * replaces that with a 4×6 truth table over BACKEND-AUTHORITATIVE PaneState
 * values (from the wire `{type:"pane_state", state, reason?}` frame). The
 * new reducer's key semantic difference: when transport regresses to
 * `not-connected` / `opening` after a paneState was received, we KEEP
 * rendering the last-known paneState (D-11 "don't flicker" rule) instead
 * of forcing the resolving spinner.
 *
 * Test structure per 30-03-PLAN Task 1 <behavior>:
 *   - Tests 1-13: individual truth-table rows exercised
 *   - Test 14: full 4×6 matrix via table-driven describe.each
 *   - Test 15: type-surface exhaustiveness proof (compile-time only —
 *     tsc --noEmit; runtime is a no-op sanity check)
 *
 * The pattern is copied verbatim from
 * src/backend/claude-session/layer1-detect.test.ts (the canonical fork
 * test-seam analog). No mocks, no timers, no `renderHook` — this is a
 * pure function; the whole test file is `import + expect`.
 */

import { describe, it, expect } from "vitest";
import {
  resolveRenderedState,
  type WsTransportState,
  type PaneState,
  type RenderedState,
} from "./resolve-phase";

// ── Type-membership self-checks ──────────────────────────────────────────────
//
// These `satisfies` self-checks pin the union memberships at compile time
// so the acceptance-grep for exact union shape is doubly enforced (grep
// + tsc). If a variant is added or removed upstream, either these arrays
// stop matching their satisfies target or the branch-per-`it` count in
// the describe blocks below no longer covers the full cross product —
// both are loud failures.

const ALL_WS_TRANSPORT_STATES: readonly WsTransportState[] = [
  "not-connected",
  "opening",
  "open",
  "failed-permanently",
] as const satisfies readonly WsTransportState[];

const ALL_PANE_STATES: readonly PaneState[] = [
  "active",
  "holding",
  "dormant",
  "inactive",
  "error",
] as const satisfies readonly PaneState[];

// Reference the sentinel arrays so unused-var linters do not flag the
// self-checks. The expect assertion is cheap and doubles as a runtime
// safety net if someone edits the arrays without editing the union.
if (ALL_WS_TRANSPORT_STATES.length !== 4 || ALL_PANE_STATES.length !== 5) {
  throw new Error(
    "resolve-phase.test.ts: union self-check arrays out of sync with resolve-phase.ts",
  );
}

// ── Test 1-2: failed-permanently short-circuit — ALWAYS error ────────────────
//
// The `failed-permanently` transport state is the ONLY path from transport
// signals to the error rendered-state (mirrors Phase 29 D-04). It
// short-circuits ahead of every other branch, so any paneState value still
// yields "error" (T-2 collapses to same value when paneState is also
// "error" — no conflict).

describe("resolveRenderedState — failed-permanently short-circuit → always error", () => {
  it("Test 1: failed-permanently + null paneState → error", () => {
    expect(resolveRenderedState("failed-permanently", null)).toBe<RenderedState>(
      "error",
    );
  });

  it("Test 2: failed-permanently overrides paneState (paneState=active) → error", () => {
    expect(
      resolveRenderedState("failed-permanently", "active"),
    ).toBe<RenderedState>("error");
  });

  it("failed-permanently + holding → error (transport gave up, paneState irrelevant)", () => {
    expect(
      resolveRenderedState("failed-permanently", "holding"),
    ).toBe<RenderedState>("error");
  });

  it("failed-permanently + dormant → error (transport gave up, paneState irrelevant)", () => {
    expect(
      resolveRenderedState("failed-permanently", "dormant"),
    ).toBe<RenderedState>("error");
  });

  it("failed-permanently + inactive → error (transport gave up, paneState irrelevant)", () => {
    expect(
      resolveRenderedState("failed-permanently", "inactive"),
    ).toBe<RenderedState>("error");
  });

  it("failed-permanently + error paneState → error (unified with transport-error)", () => {
    expect(
      resolveRenderedState("failed-permanently", "error"),
    ).toBe<RenderedState>("error");
  });
});

// ── Tests 3-4: transport not yet up + no paneState → resolving ───────────────

describe("resolveRenderedState — transport coming up + null paneState → resolving", () => {
  it("Test 3: opening + null → resolving (fresh mount, waiting for both)", () => {
    expect(resolveRenderedState("opening", null)).toBe<RenderedState>(
      "resolving",
    );
  });

  it("Test 4: not-connected + null → resolving (fresh mount, transport not up)", () => {
    expect(resolveRenderedState("not-connected", null)).toBe<RenderedState>(
      "resolving",
    );
  });
});

// ── Tests 5-7: transport transient drop + previous paneState → don't flicker ──
//
// D-11 "don't flicker" rule: if we previously received a paneState verdict
// and the transport transiently drops (not-connected / opening after having
// been open), keep rendering the last-known paneState's overlay rather
// than falling back to the resolving spinner. This is the KEY semantic
// difference vs. Phase 29's reducer.

describe("resolveRenderedState — transport transient drop with previous paneState → keep last-known", () => {
  it("Test 5: opening + previously-received active → active (D-11 don't-flicker)", () => {
    expect(resolveRenderedState("opening", "active")).toBe<RenderedState>(
      "active",
    );
  });

  it("Test 6: not-connected + previously-received holding → holding (D-11 don't-flicker)", () => {
    expect(resolveRenderedState("not-connected", "holding")).toBe<RenderedState>(
      "holding",
    );
  });

  it("Test 7: opening + previously-received dormant → dormant (D-11 don't-flicker)", () => {
    expect(resolveRenderedState("opening", "dormant")).toBe<RenderedState>(
      "dormant",
    );
  });

  it("opening + previously-received inactive → inactive (D-11 don't-flicker)", () => {
    expect(resolveRenderedState("opening", "inactive")).toBe<RenderedState>(
      "inactive",
    );
  });

  it("not-connected + previously-received error → error (D-11 don't-flicker; paneState error unified with transport error at render)", () => {
    expect(resolveRenderedState("not-connected", "error")).toBe<RenderedState>(
      "error",
    );
  });
});

// ── Test 8: open + no paneState → resolving (waiting for backend first emit) ─

describe("resolveRenderedState — open + null paneState → resolving", () => {
  it("Test 8: open + null → resolving (WS up, no backend verdict yet)", () => {
    expect(resolveRenderedState("open", null)).toBe<RenderedState>("resolving");
  });
});

// ── Tests 9-13: open + paneState → direct mapping (the happy path) ───────────

describe("resolveRenderedState — open + paneState → direct pass-through", () => {
  it("Test 9: open + active → active", () => {
    expect(resolveRenderedState("open", "active")).toBe<RenderedState>("active");
  });

  it("Test 10: open + holding → holding", () => {
    expect(resolveRenderedState("open", "holding")).toBe<RenderedState>(
      "holding",
    );
  });

  it("Test 11: open + dormant → dormant", () => {
    expect(resolveRenderedState("open", "dormant")).toBe<RenderedState>(
      "dormant",
    );
  });

  it("Test 12: open + inactive → inactive", () => {
    expect(resolveRenderedState("open", "inactive")).toBe<RenderedState>(
      "inactive",
    );
  });

  it("Test 13: open + error → error", () => {
    expect(resolveRenderedState("open", "error")).toBe<RenderedState>("error");
  });
});

// ── Test 14: full 4×6 matrix (4 transport states × 6 paneState values including null) ──
//
// Table-driven describe.each pattern for the full cross product. Every
// combination is exercised via a machine-generated `it` name so a regression
// on any single cell names the exact row that broke.
//
// Note: the "paneState" column has 6 values (5 PaneState members + null).
// Total: 4 × 6 = 24 cells.

type Cell = {
  transport: WsTransportState;
  paneState: PaneState | null;
  expected: RenderedState;
};

const FULL_MATRIX: readonly Cell[] = [
  // failed-permanently row — always error
  { transport: "failed-permanently", paneState: null, expected: "error" },
  { transport: "failed-permanently", paneState: "active", expected: "error" },
  { transport: "failed-permanently", paneState: "holding", expected: "error" },
  { transport: "failed-permanently", paneState: "dormant", expected: "error" },
  { transport: "failed-permanently", paneState: "inactive", expected: "error" },
  { transport: "failed-permanently", paneState: "error", expected: "error" },
  // not-connected row — resolving with null, otherwise last-known
  { transport: "not-connected", paneState: null, expected: "resolving" },
  { transport: "not-connected", paneState: "active", expected: "active" },
  { transport: "not-connected", paneState: "holding", expected: "holding" },
  { transport: "not-connected", paneState: "dormant", expected: "dormant" },
  { transport: "not-connected", paneState: "inactive", expected: "inactive" },
  { transport: "not-connected", paneState: "error", expected: "error" },
  // opening row — resolving with null, otherwise last-known
  { transport: "opening", paneState: null, expected: "resolving" },
  { transport: "opening", paneState: "active", expected: "active" },
  { transport: "opening", paneState: "holding", expected: "holding" },
  { transport: "opening", paneState: "dormant", expected: "dormant" },
  { transport: "opening", paneState: "inactive", expected: "inactive" },
  { transport: "opening", paneState: "error", expected: "error" },
  // open row — resolving with null, otherwise direct pass-through
  { transport: "open", paneState: null, expected: "resolving" },
  { transport: "open", paneState: "active", expected: "active" },
  { transport: "open", paneState: "holding", expected: "holding" },
  { transport: "open", paneState: "dormant", expected: "dormant" },
  { transport: "open", paneState: "inactive", expected: "inactive" },
  { transport: "open", paneState: "error", expected: "error" },
];

describe("resolveRenderedState — Test 14: full 4×6 matrix (24 cells)", () => {
  it.each(FULL_MATRIX)(
    "transport=$transport + paneState=$paneState → $expected",
    ({ transport, paneState, expected }) => {
      expect(resolveRenderedState(transport, paneState)).toBe<RenderedState>(
        expected,
      );
    },
  );

  it("matrix cardinality sanity: 4 transports × 6 paneState-values (incl. null) = 24 cells", () => {
    expect(FULL_MATRIX.length).toBe(24);
  });
});

// ── Test 15: type-surface exhaustiveness sentinel (compile-time only) ────────
//
// The `_exhaust: never` sentinel inside resolveRenderedState's open+paneState
// switch fails `npx tsc --noEmit` at build time if a new PaneState variant
// is added to the union without a matching case branch. This test is a
// runtime no-op that documents the invariant.

describe("resolveRenderedState — Test 15: compile-time exhaustiveness sentinel", () => {
  it("compile-time PaneState exhaustiveness is enforced via _exhaust: never (documented; proved by npx tsc --noEmit)", () => {
    // Runtime no-op — the real check is at build time. If a new PaneState
    // value is added without a matching switch branch in resolve-phase.ts,
    // tsc will fail on the `_exhaust: never` line before this test even
    // runs. This test's role is to lock the invariant in the test-suite
    // narrative so future maintainers know the sentinel exists.
    expect(ALL_PANE_STATES.length).toBe(5);
  });
});
