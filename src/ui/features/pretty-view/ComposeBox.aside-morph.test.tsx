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
    const thumbsUpBtn = screen.getByLabelText(/send 'thumbs up'/i);
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

  it("Task 2 Test 4: Send button click routes to handleSend when asideActive is undefined", () => {
    const onSend = vi.fn(() => true);
    render(
      <ComposeBox {...baseProps({ onSend })} />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello" } });
    const sendBtn = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledWith("hello");
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
