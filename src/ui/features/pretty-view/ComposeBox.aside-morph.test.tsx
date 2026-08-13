/**
 * Phase 14 (plain-language-translation-asides) Wave 4 —
 * ComposeBox aside morph BODY consumption tests.
 *
 * Wave 3 landed the ComposeBoxProps interface extension (asideActive?,
 * onAsideDismiss?) plus PrettyView prop plumbing. Wave 4 (this test file)
 * covers the BODY consumption:
 *
 *   Task 1: aux button `disabled` predicates extended with `|| asideActive === true`
 *     - reset button (leftmost cell of the meter well) — disabled when asideActive
 *     - paperclip button — disabled when asideActive
 *     - thumbs-up (Send 'let's go') button — disabled when asideActive
 *     - queue (Hourglass) button — disabled when asideActive
 *     - textarea's own `disabled` prop is NOT extended (per CONTEXT.md § ComposeBox morph:
 *       "Textarea remains editable. Any partial draft text is preserved verbatim")
 *
 *   Task 2: inside-textarea Send button morphs on asideActive
 *     - icon: paper-plane inline SVG ↔ lucide X
 *     - aria-label + title: "Send" ↔ "Resume"
 *     - onClick: handleSend ↔ onAsideDismiss?.()
 *     - disabled: sendDisabled ↔ false (always clickable when morphed)
 *     - className: default color ↔ identity-hue color
 *
 * Zero-regression contract: when asideActive is undefined/false, ComposeBox
 * behavior is byte-preserved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    canSend: true,
    ...overrides,
  };
}

describe("ComposeBox — Phase 14 Wave 4 aside morph (Task 1: aux button disable)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("Task 1 Test 1: reset button becomes disabled when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const resetBtn = screen.getByLabelText(/reset context window/i);
    expect((resetBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Task 1 Test 2: reset button stays enabled when asideActive is undefined (backward-compat)", () => {
    render(
      <ComposeBox
        {...baseProps({})}
      />,
    );
    const resetBtn = screen.getByLabelText(/reset context window/i);
    // canSend=true, no aside → not disabled
    expect((resetBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("Task 1 Test 3: paperclip button becomes disabled when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const paperclipBtn = screen.getByLabelText(/attach file/i);
    expect((paperclipBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Task 1 Test 4: thumbs-up (let's go) button becomes disabled when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const thumbsUpBtn = screen.getByLabelText(/send 'let's go'/i);
    expect((thumbsUpBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Task 1 Test 5 (Vehicle C): aux-row Queue button is REMOVED — per-textarea arm-idle replaces it", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    expect(screen.queryByLabelText(/queue send for when session goes idle/i)).toBeNull();
  });

  it("Task 1 Test 6: textarea REMAINS editable when asideActive=true (locked per CONTEXT.md § ComposeBox morph)", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
  });

  // Task 1 Test 7 REMOVED (Vehicle B strip, quick 260801-62m): the /bounty
  // (Target) prefix-send button no longer exists — superseded by the
  // natural-language "bounty bounty" voice trigger shipped as patch #241
  // (composeIntentTransform). Removal-assertion coverage now lives in
  // ComposeBox.test.tsx under the "Vehicle B strip" describe block.
  //
  // Task 1 Test 8 REMOVED (Vehicle B strip, quick 260801-62m): the /queue
  // (ListPlus prefix-send) button no longer exists — superseded by the
  // queued-message textareas managed by the "Queue a message" (ListPlus)
  // add-textarea button in Row 2. Removal-assertion coverage now lives in
  // ComposeBox.test.tsx under the "Vehicle B strip" describe block.
});

describe("ComposeBox — Phase 14 Wave 4 aside morph (Task 2: Send button morph)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("Task 2 Test 1: Send button aria-label reads 'Send' when asideActive is undefined", () => {
    render(
      <ComposeBox {...baseProps({})} />,
    );
    // The inside-textarea Send button (paper-plane) — pre-morph identity.
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn).toBeTruthy();
  });

  it("Task 2 Test 2: Send button aria-label reads 'Resume' when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    expect(resumeBtn).toBeTruthy();
    // AND the pre-morph "Send" name should NOT be present on any button (morph is a
    // rename, not an addition of a second button).
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("Task 2 Test 3: title attribute mirrors aria-label — 'Resume' when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    expect(resumeBtn.getAttribute("title")).toBe("Resume");
  });

  it("Task 2 Test 4: Send button short-tap routes to handleSend when asideActive is undefined", async () => {
    // Phase 32 (Plan 32-02): the primary send button's onClick prop is now
    // `asideActive ? () => onAsideDismiss?.() : undefined` — the non-aside
    // send path is served exclusively by the useHoldToRecord hook's pointer
    // handlers. Test drives the short-tap-under-threshold pointer sequence,
    // which fires the hook's onShortTap after awaiting voice.cancel() (safe
    // synchronous no-op in state="idle" via the pendingCancelRef branch from
    // Plan 32-01 Task 1). onShortTap invokes the plan's `handleSend` wrapper
    // which forwards to the parent's onSend.
    //
    // navigator.mediaDevices mock: the hook's onPointerDown calls voice.start()
    // as its first non-conditional statement (D-16-02 invariant), which unconditionally
    // reaches into navigator.mediaDevices.getUserMedia. jsdom does not define
    // mediaDevices so we stub it (matching the pattern in ComposeBox.voice.test.tsx).
    // getUserMedia returns a never-resolving promise here because Test 4 only
    // exercises the SHORT-TAP path — the hook's onPointerUp calls voice.cancel()
    // before getUserMedia resolves, and cancel() takes the Plan 32-01 pendingCancelRef
    // branch that tears down the arriving stream. Test never touches recording state.
    const originalNavigator = globalThis.navigator;
    const getUserMediaMock = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: getUserMediaMock } },
      writable: true,
      configurable: true,
    });
    try {
      const onSend = vi.fn(() => true);
      render(
        <ComposeBox {...baseProps({ onSend })} />,
      );
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "hello" } });
      const sendBtn = screen.getByRole("button", { name: "Send" });
      // Short-tap: pointerdown → immediate pointerup, elapsed < 250ms.
      fireEvent.pointerDown(sendBtn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 0 });
      fireEvent.pointerUp(sendBtn, { pointerId: 1, clientX: 20, clientY: 20, timeStamp: 50 });
      // Flush microtasks so the awaited voice.cancel() → onShortTap dispatch resolves.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(onSend).toHaveBeenCalledWith("hello");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });

  it("Task 2 Test 5: Send button click routes to onAsideDismiss when asideActive=true, NOT handleSend", () => {
    const onSend = vi.fn(() => true);
    const onAsideDismiss = vi.fn();
    render(
      <ComposeBox
        {...baseProps({
          onSend,
          asideActive: true,
          onAsideDismiss,
        })}
      />,
    );
    // Even with text in the textarea, clicking the morphed X should dismiss NOT send.
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "partial draft" } });
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    fireEvent.click(resumeBtn);
    expect(onAsideDismiss).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Task 2 Test 6: Send button is ALWAYS clickable (disabled=false) when asideActive=true, even with empty textarea", () => {
    const onAsideDismiss = vi.fn();
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
          onAsideDismiss,
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    expect((resumeBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resumeBtn);
    expect(onAsideDismiss).toHaveBeenCalledTimes(1);
  });

  it("Task 2 Test 7: Send button uses identity-hue color class when asideActive=true", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    // Identity-hue color per PATTERNS.md L220-223.
    expect(resumeBtn.className).toMatch(/hsla\(var\(--pv-id-hue\),90%,72%,0\.95\)/);
  });

  it("Task 2 Test 8: Send button renders an X icon (SVG) when asideActive=true", () => {
    const { container } = render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    // lucide X renders as an <svg> with lucide-x class or lucide class.
    const svg = resumeBtn.querySelector("svg");
    expect(svg).not.toBeNull();
    // lucide-react's X icon carries a `lucide-x` class (or similar) — assert
    // it's NOT the paper-plane path.
    const path = svg?.querySelector("path");
    // Paper-plane path starts with M14.536 21.686. lucide X has two <line> children
    // (or two <path> — depends on lucide version) but definitely NOT that d attribute.
    expect(path?.getAttribute("d")).not.toContain("M14.536 21.686");
    // Assert containing SVG present in test container as sanity.
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("Task 2 Test 9: onAsideDismiss undefined is safe — no crash when asideActive=true and callback is absent", () => {
    render(
      <ComposeBox
        {...baseProps({
          asideActive: true,
          // onAsideDismiss intentionally omitted
        })}
      />,
    );
    const resumeBtn = screen.getByRole("button", { name: "Resume" });
    // Should not throw.
    expect(() => fireEvent.click(resumeBtn)).not.toThrow();
  });
});
