/**
 * Phase 121 Plan 02 Task 1 — feedback-store tests.
 *
 * Verifies the useSyncExternalStore singleton mirroring branding-store.ts,
 * simplified to a boolean-only "feedback enabled" signal (D-08).
 *
 * Behavior contract (from PLAN.md task 1):
 *   - Initial state: useFeedbackEnabled() returns false before any publish
 *     (D-08 default disabled — hide UI until backend confirms enablement).
 *   - publishFeedbackEnabled(true) → hook returns true; subscribers fire once.
 *   - Consecutive publish with same value is a no-op (guards against redundant
 *     notify — mirrors branding-store.ts L136-139 equality guard, simplified
 *     for a boolean).
 *   - __resetForTest() restores {enabled:false} and notifies subscribers.
 *   - subscribe() returns a remover that pops the listener from the Set.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useFeedbackEnabled,
  publishFeedbackEnabled,
  __resetForTest,
} from "./feedback-store";

describe("feedback-store (Phase 121 Plan 02 Task 1)", () => {
  beforeEach(() => {
    __resetForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial value is false before any publish (D-08 default disabled)", () => {
    const { result } = renderHook(() => useFeedbackEnabled());
    expect(result.current).toBe(false);
  });

  it("publishFeedbackEnabled(true) makes useFeedbackEnabled return true", () => {
    const { result } = renderHook(() => useFeedbackEnabled());
    expect(result.current).toBe(false);

    act(() => {
      publishFeedbackEnabled(true);
    });

    expect(result.current).toBe(true);
  });

  it("publish(true) called twice consecutively fires subscribers only ONCE (same-value no-op)", () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useFeedbackEnabled();
    });

    const initial = renderCount;
    act(() => {
      publishFeedbackEnabled(true);
    });
    const afterFirst = renderCount;
    expect(afterFirst).toBeGreaterThan(initial);

    act(() => {
      publishFeedbackEnabled(true);
    });
    // Second identical publish must NOT trigger a re-render.
    expect(renderCount).toBe(afterFirst);
  });

  it("publish(false) after publish(true) toggles the value back and notifies", () => {
    const { result } = renderHook(() => useFeedbackEnabled());

    act(() => {
      publishFeedbackEnabled(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      publishFeedbackEnabled(false);
    });
    expect(result.current).toBe(false);
  });

  it("__resetForTest() restores default (false) and notifies subscribers", () => {
    const { result } = renderHook(() => useFeedbackEnabled());

    act(() => {
      publishFeedbackEnabled(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      __resetForTest();
    });
    expect(result.current).toBe(false);
  });

  it("publish emits a structured console.info log on state change", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    act(() => {
      publishFeedbackEnabled(true);
    });

    expect(infoSpy).toHaveBeenCalled();
    const payload = infoSpy.mock.calls[0]?.[0];
    expect(typeof payload).toBe("object");
    expect(payload).not.toBeNull();
    expect((payload as { operation: string }).operation).toBe(
      "feedback_enabled_publish",
    );
    expect((payload as { previous: boolean }).previous).toBe(false);
    expect((payload as { next: boolean }).next).toBe(true);
  });

  it("publish emits NO log when value is unchanged (no-op guard applies before console.info)", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    // Initial state is already false — publishing false must be a no-op.
    act(() => {
      publishFeedbackEnabled(false);
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
