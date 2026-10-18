import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionPromptInfo } from "../../api/claude-session-api";
import { PROBE_INTERVAL_MS, usePermissionPrompt } from "./use-permission-prompt";

const prompt = (over: Partial<PermissionPromptInfo> = {}): PermissionPromptInfo => ({
  title: "Bash command",
  description: "Clean up",
  body: "rm -f x",
  reason: null,
  autoDenySeconds: 20,
  yesKey: "1",
  noKey: "2",
  fingerprint: "fp1",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePermissionPrompt", () => {
  it("probes immediately and every interval while waiting, and stops when not", () => {
    const send = vi.fn(() => true);
    const { result, rerender } = renderHook(({ w }) => usePermissionPrompt(w, send), {
      initialProps: { w: true },
    });
    expect(send).toHaveBeenCalledWith({ type: "permission_probe" });
    for (let i = 0; i < 2; i += 1) {
      act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: null }));
      act(() => {
        vi.advanceTimersByTime(PROBE_INTERVAL_MS);
      });
    }
    expect(send).toHaveBeenCalledTimes(3);
    rerender({ w: false });
    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS * 3);
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("hides once the auto-deny countdown runs out, and stays hidden", () => {
    const send = vi.fn(() => true);
    const { result } = renderHook(() => usePermissionPrompt(true, send));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 3 }) }));
    expect(result.current.hidden).toBe(false);
    expect(result.current.secondsLeft).toBe(3);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(result.current.hidden).toBe(true);
    // The prompt closes on screen but fleet-status hasn't cleared yet.
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: null }));
    expect(result.current.hidden).toBe(true);
  });

  it("a new prompt after expiry shows again", () => {
    const { result } = renderHook(() => usePermissionPrompt(true, () => true));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 1 }) }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.hidden).toBe(true);
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ fingerprint: "fp2" }) }));
    expect(result.current.hidden).toBe(false);
  });

  it("re-anchors the deadline from each probe reply", () => {
    const { result } = renderHook(() => usePermissionPrompt(true, () => true));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 2 }) }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 10 }) }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.hidden).toBe(false);
  });

  it("answer sends the fingerprint, and the result frame updates status", () => {
    const send = vi.fn(() => true);
    const { result } = renderHook(() => usePermissionPrompt(true, send));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt() }));
    act(() => result.current.onAnswer("allow"));
    expect(send).toHaveBeenCalledWith({ type: "permission_answer", choice: "allow", fingerprint: "fp1" });
    expect(result.current.answer?.status).toBe("sending");
    // A second click is ignored while one is in flight.
    act(() => result.current.onAnswer("deny"));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ choice: "deny" }));
    act(() =>
      result.current.handleFrame({ type: "permission_answer_result", choice: "allow", fingerprint: "fp1", status: "sent" }),
    );
    expect(result.current.answer?.status).toBe("sent");
    // The answered prompt stays shown after it leaves the screen.
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: null }));
    expect(result.current.prompt?.fingerprint).toBe("fp1");
  });

  it("clears everything when waiting ends", () => {
    const { result, rerender } = renderHook(({ w }) => usePermissionPrompt(w, () => true), {
      initialProps: { w: true },
    });
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt() }));
    rerender({ w: false });
    expect(result.current.prompt).toBeNull();
    expect(result.current.hidden).toBe(false);
  });
});

describe("usePermissionPrompt — review hardening", () => {
  it("after expiry, an unreadable wait shows the presence form once the grace window passes", () => {
    const { result } = renderHook(() => usePermissionPrompt(true, () => true));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 1 }) }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: null }));
    expect(result.current.hidden).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(result.current.hidden).toBe(false);
    expect(result.current.prompt).toBeNull();
  });

  it("an identical prompt after the first one closed is treated as new", () => {
    const { result } = renderHook(() => usePermissionPrompt(true, () => true));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt() }));
    act(() => result.current.onAnswer("allow"));
    act(() =>
      result.current.handleFrame({ type: "permission_answer_result", choice: "allow", fingerprint: "fp1", status: "sent" }),
    );
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: null }));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt() }));
    expect(result.current.answer).toBeNull();
  });

  it("an identical prompt whose countdown jumped back up is treated as new", () => {
    const { result } = renderHook(() => usePermissionPrompt(true, () => true));
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 20 }) }));
    act(() => result.current.onAnswer("allow"));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    act(() => result.current.handleFrame({ type: "permission_prompt_state", prompt: prompt({ autoDenySeconds: 20 }) }));
    expect(result.current.answer).toBeNull();
  });

  it("does not send a second probe while one is unanswered", () => {
    const send = vi.fn(() => true);
    renderHook(() => usePermissionPrompt(true, send));
    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS * 2);
    });
    expect(send).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS * 2);
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
