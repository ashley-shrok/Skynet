// phase-70: truth-table tests for pure auto-scroll-machine reducer — LOCKED truth table
/**
 * Truth-table unit tests for the pure `reduce` function defined in
 * ./auto-scroll-machine (phase 70 — two-state position-derived auto-scroll
 * state machine rewrite; plan 70-01).
 *
 * WHY THIS TEST FILE EXISTS:
 *
 * The previous auto-scroll implementation in use-auto-scroll.ts used a
 * reactive-observer stack (MutationObserver + per-child ResizeObserver +
 * IntersectionObserver). Phase 70 replaces that with a small deterministic
 * state machine driven by a single invariant: position relative to the
 * bottom. This file locks the machine's every (Mode × EventKind) cell so
 * regressions name the EXACT transition that broke.
 *
 * Test structure per 70-01-PLAN Task 2 <behavior>:
 *   - Groups 1-11: individual transition classes exercised
 *   - Group 10: full 2×6 matrix via table-driven describe.each
 *   - Group 11: type-surface exhaustiveness proof (compile-time only —
 *     tsc --noEmit; runtime is a no-op sanity check)
 *
 * The pattern is copied verbatim from
 * src/ui/features/pretty-view/resolve-phase.test.ts (the canonical
 * pure-function truth-table test-seam analog). No mocks, no timers,
 * no `renderHook` — this is a pure function; the whole test file is
 * `import + expect`.
 */

import { describe, it, expect } from "vitest";
import {
  reduce,
  createInitialState,
  type Mode,
  type AutoScrollEvent,
  type AutoScrollEffect,
  type AutoScrollState,
  BOTTOM_TOLERANCE_PX,
  BOTTOM_TOLERANCE_TOUCH_EXTRA_PX,
} from "./auto-scroll-machine";

// ── Type-membership self-checks ──────────────────────────────────────────────
//
// These `satisfies` self-checks pin the union memberships at compile time
// so the acceptance-grep for exact union shape is doubly enforced (grep
// + tsc). If a variant is added or removed upstream, either these arrays
// stop matching their satisfies target or the branch-per-`it` count in
// the describe blocks below no longer covers the full cross product —
// both are loud failures.

const ALL_MODES: readonly Mode[] = [
  "at-bottom",
  "not-at-bottom",
] as const satisfies readonly Mode[];

const ALL_EVENT_KINDS: readonly AutoScrollEvent["kind"][] = [
  "measured",
  "content-changed",
  "container-resized",
  "user-input",
  "jump-clicked",
  "send-fired",
] as const satisfies readonly AutoScrollEvent["kind"][];

// Reference the sentinel arrays so unused-var linters do not flag the
// self-checks. The expect assertion is cheap and doubles as a runtime
// safety net if someone edits the arrays without editing the union.
if (ALL_MODES.length !== 2 || ALL_EVENT_KINDS.length !== 6) {
  throw new Error(
    "auto-scroll-machine.test.ts: union self-check arrays out of sync with auto-scroll-machine.ts",
  );
}

// ── Helper factories ─────────────────────────────────────────────────────────

function atBottom(overrides: Partial<AutoScrollState> = {}): AutoScrollState {
  return {
    mode: "at-bottom",
    hasLandedOnce: true,
    lastMeasuredDistance: 0,
    ...overrides,
  };
}

function notAtBottom(
  overrides: Partial<AutoScrollState> = {},
): AutoScrollState {
  return {
    mode: "not-at-bottom",
    hasLandedOnce: true,
    lastMeasuredDistance: 100,
    ...overrides,
  };
}

// ── Group 1: at-bottom → at-bottom via symmetric events ──────────────────────
//
// The "symmetric event handling" invariant from the shape file: every event
// that could move the bottom is treated uniformly when in at-bottom mode —
// content-changed, container-resized, and measured all trigger a chase.

describe("Group 1: at-bottom → at-bottom via symmetric events (chase)", () => {
  it("Test 1a: at-bottom + content-changed → at-bottom + chase", () => {
    const result = reduce(atBottom(), { kind: "content-changed" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });

  it("Test 1b: at-bottom + container-resized → at-bottom + chase", () => {
    const result = reduce(atBottom(), { kind: "container-resized" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });

  it("Test 1c: at-bottom + measured → at-bottom + chase (post-landing; hasLandedOnce=true)", () => {
    const result = reduce(atBottom({ hasLandedOnce: true }), {
      kind: "measured",
      distanceFromBottom: 0,
      contentHeight: 500,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });
});

// ── Group 2: at-bottom → at-bottom via user-input inside tolerance ────────────

describe("Group 2: at-bottom → at-bottom via user-input inside tolerance (stay, no chase)", () => {
  it("Test 2a: at-bottom + user-input (desktop, distance=0, within tolerance) → at-bottom + none", () => {
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: 0,
      isTouch: false,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 2b: at-bottom + user-input (touch, distance at edge of touch-extra tolerance) → at-bottom + none", () => {
    // BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX is the touch threshold.
    // Exactly at the boundary (≤) → still at-bottom.
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX,
      isTouch: true,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });
});

// ── Group 3: at-bottom → not-at-bottom (OUT — only via user-input outside tolerance) ────

describe("Group 3: at-bottom → not-at-bottom (OUT — ONLY via user-input outside tolerance)", () => {
  it("Test 3a: at-bottom + user-input (desktop, just outside tolerance) → not-at-bottom + none", () => {
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + 1,
      isTouch: false,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 3b: at-bottom + user-input (desktop, far outside tolerance) → not-at-bottom + none", () => {
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: 500,
      isTouch: false,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 3c: at-bottom + user-input (touch, just outside touch-extra slack) → not-at-bottom + none", () => {
    // One pixel past the combined tolerance = OUT even on touch.
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX + 1,
      isTouch: true,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 3d: at-bottom + user-input (touch, far outside tolerance) → not-at-bottom + none", () => {
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: 400,
      isTouch: true,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });
});

// ── Group 4: at-bottom contamination guard — non-user-input events NEVER transition OUT ──
//
// LOAD-BEARING: content-changed, container-resized, and measured with arbitrarily
// large distances MUST NOT flip mode to not-at-bottom. Only user-input can trigger
// the OUT transition. This is the primary anti-contamination gate.

describe("Group 4: at-bottom contamination guard — non-user-input events NEVER trigger OUT", () => {
  it("Test 4a: at-bottom + content-changed (with huge implied distance) → at-bottom (NEVER out)", () => {
    // content-changed carries no distance; mode MUST stay at-bottom regardless.
    const result = reduce(atBottom(), { kind: "content-changed" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
  });

  it("Test 4b: at-bottom + container-resized (with huge implied distance) → at-bottom (NEVER out)", () => {
    const result = reduce(atBottom(), { kind: "container-resized" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
  });

  it("Test 4c: at-bottom + measured (huge distanceFromBottom=10000) → at-bottom (NEVER out)", () => {
    // measured carries a distanceFromBottom but MUST NOT trigger the OUT transition.
    // Only user-input events gate the OUT path.
    const result = reduce(atBottom({ hasLandedOnce: true }), {
      kind: "measured",
      distanceFromBottom: 10000,
      contentHeight: 500,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
  });
});

// ── Group 5: not-at-bottom → not-at-bottom (LOAD-BEARING no-yank) ────────────
//
// The "no yank when scrolled up" invariant. When in not-at-bottom mode, every
// bottom-moving event MUST be ignored — no scroll write, no mode change.

describe("Group 5: not-at-bottom → not-at-bottom (LOAD-BEARING no-yank: all symmetric events return none)", () => {
  it("Test 5a: not-at-bottom + content-changed → not-at-bottom + none (no yank)", () => {
    const result = reduce(notAtBottom(), { kind: "content-changed" });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 5b: not-at-bottom + container-resized → not-at-bottom + none (no yank)", () => {
    const result = reduce(notAtBottom(), { kind: "container-resized" });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test 5c: not-at-bottom + measured → not-at-bottom + none (no yank)", () => {
    const result = reduce(notAtBottom(), {
      kind: "measured",
      distanceFromBottom: 500,
      contentHeight: 2000,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });
});

// ── Group 6: not-at-bottom → at-bottom (IN — three specific triggers) ─────────

describe("Group 6: not-at-bottom → at-bottom (IN — three specific triggers)", () => {
  it("Test 6a: not-at-bottom + jump-clicked → at-bottom + chase", () => {
    const result = reduce(notAtBottom(), { kind: "jump-clicked" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });

  it("Test 6b: not-at-bottom + send-fired → at-bottom + chase", () => {
    const result = reduce(notAtBottom(), { kind: "send-fired" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });

  it("Test 6c: not-at-bottom + user-input (inside tolerance) → at-bottom + chase", () => {
    const result = reduce(notAtBottom(), {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX - 1,
      isTouch: false,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });
});

// ── Group 7: send-fired flips to at-bottom regardless of prior mode ───────────

describe("Group 7: send-fired flips to at-bottom regardless of prior mode", () => {
  it("Test 7a: at-bottom + send-fired → still at-bottom + chase (already there; chase guarantees position)", () => {
    const result = reduce(atBottom(), { kind: "send-fired" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });

  it("Test 7b: not-at-bottom + send-fired → at-bottom + chase (flip regardless of prior state)", () => {
    const result = reduce(notAtBottom(), { kind: "send-fired" });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("chase");
  });
});

// ── Group 8: Mount-landing (hide-pin-reveal) ──────────────────────────────────
//
// The mount-landing override fires once when hasLandedOnce is false and the
// first measured event with non-zero contentHeight arrives. The effect is
// "reveal" (flip the surface from hidden to visible). After the flip,
// subsequent measured events return "chase" (normal at-bottom behavior).

describe("Group 8: Mount-landing (hide-pin-reveal)", () => {
  it("Test 8a: createInitialState() returns hasLandedOnce: false and mode: at-bottom", () => {
    const initial = createInitialState();
    expect(initial.hasLandedOnce).toBe(false);
    expect(initial.mode).toBe<Mode>("at-bottom");
    expect(initial.lastMeasuredDistance).toBe(0);
  });

  it("Test 8b: hasLandedOnce=false + mode=at-bottom + measured(contentHeight>0) → reveal + flips hasLandedOnce to true", () => {
    const initial = createInitialState();
    const result = reduce(initial, {
      kind: "measured",
      distanceFromBottom: 0,
      contentHeight: 100,
    });
    expect(result.effect).toBe<AutoScrollEffect>("reveal");
    expect(result.next.hasLandedOnce).toBe(true);
    expect(result.next.mode).toBe<Mode>("at-bottom");
  });

  it("Test 8c: second measured after hasLandedOnce=true → chase, NOT reveal (idempotent; mount-landing fires exactly once)", () => {
    const initial = createInitialState();
    const afterLanding = reduce(initial, {
      kind: "measured",
      distanceFromBottom: 0,
      contentHeight: 100,
    });
    // Second measured event with hasLandedOnce=true → normal at-bottom+measured → chase
    const second = reduce(afterLanding.next, {
      kind: "measured",
      distanceFromBottom: 0,
      contentHeight: 100,
    });
    expect(second.effect).toBe<AutoScrollEffect>("chase");
    expect(second.next.hasLandedOnce).toBe(true);
  });

  it("Test 8d: hasLandedOnce=false + measured with contentHeight=0 → chase (NOT reveal; waits for non-zero height)", () => {
    const initial = createInitialState();
    const result = reduce(initial, {
      kind: "measured",
      distanceFromBottom: 0,
      contentHeight: 0,
    });
    // contentHeight=0: mount-landing gate not satisfied; falls through to normal at-bottom+measured
    expect(result.effect).toBe<AutoScrollEffect>("chase");
    expect(result.next.hasLandedOnce).toBe(false);
  });
});

// ── Group 9: Chase-write structural impossibility ─────────────────────────────
//
// Documents that the `reduce` function has no write-feedback event variant.
// Chase writes happen as side-effects of `effect: "chase"` being returned;
// by construction they cannot loop back into `reduce()`. This is what makes
// the recursive-bug pattern (shape file § What would make it wrong bullet 2)
// structurally impossible in this design.

describe("Group 9: Chase-write structural impossibility (shape-file invariant documented)", () => {
  it("Test 9: ALL_EVENT_KINDS does not include any write-feedback variant (chase writes are effects, not events)", () => {
    // The absence of a write-feedback variant in AutoScrollEvent is the compile-time
    // structural guarantee. This runtime check documents the invariant so future
    // maintainers can see it in the test suite output.
    //
    // Note: checking the string "programmatic-write" is intentionally avoided here
    // because the acceptance-grep gate on auto-scroll-machine.ts requires that
    // string to be absent from the source file. The invariant is the ABSENCE of
    // any such variant — documented here by asserting the full 6-member array.
    expect(ALL_EVENT_KINDS).toEqual([
      "measured",
      "content-changed",
      "container-resized",
      "user-input",
      "jump-clicked",
      "send-fired",
    ]);
    expect(ALL_EVENT_KINDS).toHaveLength(6);
  });
});

// ── Group 10: Full 2×6 matrix (12 base cells + user-input inside/outside × touch/desktop variants) ──
//
// Table-driven describe.each pattern for the full cross product. Every
// combination is exercised via a machine-generated `it` name so a regression
// on any single cell names the exact row that broke.

type MatrixCell = {
  mode: Mode;
  event: AutoScrollEvent;
  expectedNextMode: Mode;
  expectedEffect: AutoScrollEffect;
  label: string;
};

const FULL_MATRIX: readonly MatrixCell[] = [
  // ── at-bottom row ──
  {
    mode: "at-bottom",
    event: { kind: "content-changed" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "at-bottom + content-changed → at-bottom + chase",
  },
  {
    mode: "at-bottom",
    event: { kind: "container-resized" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "at-bottom + container-resized → at-bottom + chase",
  },
  {
    mode: "at-bottom",
    event: { kind: "measured", distanceFromBottom: 0, contentHeight: 500 },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "at-bottom + measured (hasLandedOnce=true) → at-bottom + chase",
  },
  {
    mode: "at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX - 1,
      isTouch: false,
    },
    expectedNextMode: "at-bottom",
    expectedEffect: "none",
    label: "at-bottom + user-input (desktop, inside tolerance) → at-bottom + none",
  },
  {
    mode: "at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + 1,
      isTouch: false,
    },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "at-bottom + user-input (desktop, outside tolerance) → not-at-bottom + none",
  },
  {
    mode: "at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + 1,
      isTouch: true,
    },
    expectedNextMode: "at-bottom",
    expectedEffect: "none",
    label: "at-bottom + user-input (touch, within touch-extra slack) → at-bottom + none",
  },
  {
    mode: "at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom:
        BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX + 1,
      isTouch: true,
    },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "at-bottom + user-input (touch, outside touch-extra slack) → not-at-bottom + none",
  },
  {
    mode: "at-bottom",
    event: { kind: "jump-clicked" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "at-bottom + jump-clicked → at-bottom + chase",
  },
  {
    mode: "at-bottom",
    event: { kind: "send-fired" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "at-bottom + send-fired → at-bottom + chase",
  },
  // ── not-at-bottom row ──
  {
    mode: "not-at-bottom",
    event: { kind: "content-changed" },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "not-at-bottom + content-changed → not-at-bottom + none (no yank)",
  },
  {
    mode: "not-at-bottom",
    event: { kind: "container-resized" },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "not-at-bottom + container-resized → not-at-bottom + none (no yank)",
  },
  {
    mode: "not-at-bottom",
    event: { kind: "measured", distanceFromBottom: 500, contentHeight: 2000 },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "not-at-bottom + measured → not-at-bottom + none (no yank)",
  },
  {
    mode: "not-at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX - 1,
      isTouch: false,
    },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "not-at-bottom + user-input (desktop, inside tolerance) → at-bottom + chase",
  },
  {
    mode: "not-at-bottom",
    event: {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + 1,
      isTouch: false,
    },
    expectedNextMode: "not-at-bottom",
    expectedEffect: "none",
    label: "not-at-bottom + user-input (desktop, outside tolerance) → not-at-bottom + none",
  },
  {
    mode: "not-at-bottom",
    event: { kind: "jump-clicked" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "not-at-bottom + jump-clicked → at-bottom + chase",
  },
  {
    mode: "not-at-bottom",
    event: { kind: "send-fired" },
    expectedNextMode: "at-bottom",
    expectedEffect: "chase",
    label: "not-at-bottom + send-fired → at-bottom + chase",
  },
];

describe("Group 10: Full 2×(6+variants) matrix", () => {
  describe.each(FULL_MATRIX)(
    "$label",
    ({ mode, event, expectedNextMode, expectedEffect }) => {
      it(`mode=${mode} + kind=${event.kind} → nextMode=${expectedNextMode} + effect=${expectedEffect}`, () => {
        const state: AutoScrollState =
          mode === "at-bottom"
            ? atBottom({ hasLandedOnce: true })
            : notAtBottom();
        const result = reduce(state, event);
        expect(result.next.mode).toBe<Mode>(expectedNextMode);
        expect(result.effect).toBe<AutoScrollEffect>(expectedEffect);
      });
    },
  );

  it("matrix cardinality sanity: FULL_MATRIX has expected cell count (≥12 base cells + user-input variants)", () => {
    expect(FULL_MATRIX.length).toBe(16);
  });
});

// ── iOS touch slack tests ─────────────────────────────────────────────────────
//
// Separate group to document the iOS touch-momentum overshoot pitfall from
// shape file § Prior context. Touch tolerance absorbs the rubber-band overshoot.

describe("iOS touch slack — user-input within touch-extra range stays at-bottom", () => {
  it("Test iOS-1: at-bottom + user-input (touch, exactly BOTTOM_TOLERANCE_PX+1) → at-bottom (within touch-extra slack)", () => {
    // Desktop would flip OUT here; touch should not.
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom: BOTTOM_TOLERANCE_PX + 1,
      isTouch: true,
    });
    expect(result.next.mode).toBe<Mode>("at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });

  it("Test iOS-2: at-bottom + user-input (touch, exactly BOTTOM_TOLERANCE_PX+BOTTOM_TOLERANCE_TOUCH_EXTRA_PX+1) → not-at-bottom (past touch-extra boundary)", () => {
    const result = reduce(atBottom(), {
      kind: "user-input",
      distanceFromBottom:
        BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX + 1,
      isTouch: true,
    });
    expect(result.next.mode).toBe<Mode>("not-at-bottom");
    expect(result.effect).toBe<AutoScrollEffect>("none");
  });
});

// ── Group 11: Compile-time exhaustiveness (documented) ───────────────────────
//
// The `_exhaust: never` sentinels inside `reduce()` fail `npx tsc --noEmit`
// at build time if a new AutoScrollEvent variant or Mode is added without
// a matching case branch. This test is a runtime no-op that documents the
// invariant so future maintainers can see it in the test-suite narrative.

describe("Group 11: compile-time exhaustiveness sentinel (documented; proved by npx tsc --noEmit)", () => {
  it("compile-time AutoScrollEvent.kind exhaustiveness is enforced via _exhaust: never (documented; proved by npx tsc --noEmit)", () => {
    // Runtime no-op — the real check is at build time. If a new AutoScrollEvent
    // variant is added without a matching switch branch in auto-scroll-machine.ts,
    // tsc will fail on the `_exhaust: never` lines before this test even runs.
    // This test's role is to lock the invariant in the test-suite narrative so
    // future maintainers know the sentinel exists and what it guards.
    expect(ALL_EVENT_KINDS.length).toBe(6);
    expect(ALL_MODES.length).toBe(2);
  });
});
