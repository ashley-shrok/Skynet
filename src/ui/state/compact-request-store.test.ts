import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  OPTIMISTIC_MS,
  markCompactRequested,
  useSessionCompacting,
  __resetCompactRequestsForTests,
} from "./compact-request-store";
import { publishFleetStatusSessionState, __resetForTest as resetWorkingStore } from "./session-working-store";

function publish(condensing: boolean) {
  publishFleetStatusSessionState("1", {
    hostId: "1",
    tmuxSession: "s1",
    sessionId: "sid",
    pid: 1,
    status: "idle",
    backgroundTasks: [],
    updatedAt: Date.now(),
    lastMessageAt: null,
    aiTitle: null,
    dormant: false,
    condensing,
  });
}

describe("compact-request-store", () => {
  afterEach(() => {
    act(() => {
      __resetCompactRequestsForTests();
      resetWorkingStore();
    });
    vi.useRealTimers();
  });

  it("a request reads as compacting on every surface for that session, and only that session", () => {
    const a = renderHook(() => useSessionCompacting("1:s1"));
    const b = renderHook(() => useSessionCompacting("1:s1"));
    const other = renderHook(() => useSessionCompacting("1:s2"));
    act(() => markCompactRequested("1:s1"));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
    expect(other.result.current).toBe(false);
  });

  it("the request clears itself after OPTIMISTIC_MS when the poll never confirms it", () => {
    vi.useFakeTimers();
    const h = renderHook(() => useSessionCompacting("1:s1"));
    act(() => markCompactRequested("1:s1"));
    act(() => vi.advanceTimersByTime(OPTIMISTIC_MS - 1));
    expect(h.result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(h.result.current).toBe(false);
  });

  it("the poll takes over even with nothing on screen, so a finished compaction doesn't linger", () => {
    markCompactRequested("1:s1");
    publish(true);
    publish(false);
    const h = renderHook(() => useSessionCompacting("1:s1"));
    expect(h.result.current).toBe(false);
  });
});
