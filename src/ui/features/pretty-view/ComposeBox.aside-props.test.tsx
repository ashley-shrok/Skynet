/**
 * Phase 14 (plain-language-translation-asides) Wave 3 Task 2 —
 * ComposeBoxProps interface-additive type-shape gate.
 *
 * This wave adds `asideActive?: boolean` and `onAsideDismiss?: () => void`
 * to the ComposeBoxProps interface so PrettyView (Wave 3 Task 3) can pass
 * these props with typesafe correctness. Wave 4 owns the BODY consumption
 * of these props inside ComposeBox (button gates + Send→X morph); this
 * task is intentionally interface-only.
 *
 * The RED gate here lives at tsc-compile time: if the interface does NOT
 * include these fields, the `satisfies ComposeBoxProps` assertion on the
 * object literal below fails at type-check, and tsc --noEmit errors on
 * this file. GREEN gate: the interface DOES include them (both optional
 * so existing callers stay backward-compatible), tsc --noEmit exits 0,
 * this vitest runs the trivial assertion below.
 *
 * The vitest runtime assertion is a smoke check that the runtime shape
 * accepts the two new fields — but the load-bearing gate is the tsc
 * type-shape assertion in the object literal itself.
 */
import { describe, it, expect } from "vitest";
import type { ComposeBoxProps } from "./ComposeBox";

describe("ComposeBoxProps — Phase 14 Wave 3 Task 2 interface extension", () => {
  it("Test 1: accepts asideActive?: boolean + onAsideDismiss?: () => void as optional additive fields", () => {
    // Object literal exercises the two new optional interface fields.
    // If ComposeBoxProps lacks `asideActive` or `onAsideDismiss`, the
    // `satisfies ComposeBoxProps` assertion is a tsc --noEmit error and
    // the RED gate is preserved. When the interface adds them, tsc passes
    // and this vitest confirms the runtime object shape is unchanged.
    const propsWithAside = {
      onSend: (_text: string) => true,
      hostId: 42,
      asideActive: true,
      onAsideDismiss: () => {
        /* placeholder — Wave 4 will bind this to a real dismiss handler */
      },
    } satisfies ComposeBoxProps;

    expect(propsWithAside.asideActive).toBe(true);
    expect(typeof propsWithAside.onAsideDismiss).toBe("function");
  });

  it("Test 2: existing callers without the aside fields still typecheck (backward compat)", () => {
    // The two new fields are OPTIONAL, so a legacy caller passing only
    // the pre-Phase-14 props MUST still satisfy the interface — this
    // guards against an accidental `asideActive: boolean` (non-optional)
    // typo that would break every existing ComposeBox mount site.
    const legacyProps = {
      onSend: (_text: string) => true,
      hostId: 42,
    } satisfies ComposeBoxProps;
    expect(legacyProps.hostId).toBe(42);
  });
});
