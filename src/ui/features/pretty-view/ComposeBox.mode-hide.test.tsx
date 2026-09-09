// Phase 93 Slice 3 Task 2 — ComposeBox mode="relay" hides Row 1 + Paperclip
// monolithically (D-11); Row 2 (textarea + Send visual shell) is byte-identical
// (D-12).
//
// Test-plane rationale:
//   - Row 1 is the meter/reset/queue/stop/thumbs-up/recap instrument bar.
//     Hidden monolithically via a single wrapper conditional `mode !== "relay"`
//     — no per-button gates, no partial hiding.
//   - Paperclip is inside the Row 2 subtree (moved by patch #vtk-260730). Its
//     existing gate extends to `showPaperclip && mode !== "relay"`.
//   - Row 2's outer wrapper class + textarea + Send button visual shell stay
//     byte-identical between the two modes.

import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render.
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    showPaperclip: true,
    canSend: true,
    ...overrides,
  };
}

describe("ComposeBox mode-hide (Phase 93 Slice 3 Task 2)", () => {
  it("Test 1 (default = harness): renders Row 1 AND Paperclip when mode is unset (backward-compat)", () => {
    const { container } = render(<ComposeBox {...baseProps()} />);
    // Row 1 present (meter well + aux buttons wrapper).
    expect(container.querySelector('[data-testid="compose-row-1"]')).not.toBeNull();
    // Paperclip button present (showPaperclip=true, harness default).
    expect(container.querySelector('button[aria-label="Attach file"]')).not.toBeNull();
    // Row 2 also present (baseline).
    expect(container.querySelector('[data-testid="compose-row-2"]')).not.toBeNull();
  });

  it("Test 1b (explicit mode=harness): same as default — Row 1 + Paperclip present", () => {
    const { container } = render(<ComposeBox {...baseProps({ mode: "harness" })} />);
    expect(container.querySelector('[data-testid="compose-row-1"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Attach file"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compose-row-2"]')).not.toBeNull();
  });

  it("Test 2 (mode=relay Row 1 hidden): does NOT render the Row 1 wrapper OR any of its aux buttons", () => {
    const { container } = render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    // Row 1 wrapper absent.
    expect(container.querySelector('[data-testid="compose-row-1"]')).toBeNull();
    // Reset button (lives in the meter well inside Row 1) absent.
    expect(
      container.querySelector('button[aria-label="Reset context window"]'),
    ).toBeNull();
    // ThumbsUp button absent.
    expect(
      container.querySelector('button[aria-label="Send \'thumbs up\'"]'),
    ).toBeNull();
    // Recap (CircleHelp) button absent.
    expect(
      container.querySelector('button[aria-label="Recap the current situation"]'),
    ).toBeNull();
    // The meter role element (aria-label="Context window") absent.
    expect(
      container.querySelector('[role="meter"][aria-label="Context window"]'),
    ).toBeNull();
  });

  it("Test 3 (mode=relay Paperclip hidden): Paperclip does NOT render, regardless of showPaperclip=true", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ mode: "relay", showPaperclip: true })} />,
    );
    expect(container.querySelector('button[aria-label="Attach file"]')).toBeNull();
  });

  it("Test 4 (mode=relay Row 2 byte-identical): Row 2 wrapper class + textarea + Send visual shell match harness mode", () => {
    // Render both modes with identical (attachment-free) inputs to compare.
    const { container: harnessContainer } = render(
      <ComposeBox {...baseProps({ mode: "harness", showPaperclip: false })} />,
    );
    const { container: relayContainer } = render(
      <ComposeBox {...baseProps({ mode: "relay", showPaperclip: false })} />,
    );
    // Row 2 wrappers exist in both.
    const harnessRow2 = harnessContainer.querySelector('[data-testid="compose-row-2"]');
    const relayRow2 = relayContainer.querySelector('[data-testid="compose-row-2"]');
    expect(harnessRow2).not.toBeNull();
    expect(relayRow2).not.toBeNull();
    // Same class list (no divergence in Row 2 style).
    expect(harnessRow2!.className).toBe(relayRow2!.className);
    // Textarea present in both.
    expect(harnessRow2!.querySelector("textarea")).not.toBeNull();
    expect(relayRow2!.querySelector("textarea")).not.toBeNull();
    // Send button (aria-label "Send") present in both.
    const harnessSend = harnessRow2!.querySelector('button[aria-label="Send"]');
    const relaySend = relayRow2!.querySelector('button[aria-label="Send"]');
    expect(harnessSend).not.toBeNull();
    expect(relaySend).not.toBeNull();
    // Send's classlist matches byte-for-byte between modes (VISUAL-08 lock).
    expect(harnessSend!.className).toBe(relaySend!.className);
  });

  it("Test 5 (backward-compat): rendering without a mode prop yields the identical Row 1 markup as mode=\"harness\"", () => {
    const { container: defaultContainer } = render(<ComposeBox {...baseProps()} />);
    const { container: harnessContainer } = render(
      <ComposeBox {...baseProps({ mode: "harness" })} />,
    );
    const defaultRow1 = defaultContainer.querySelector('[data-testid="compose-row-1"]');
    const harnessRow1 = harnessContainer.querySelector('[data-testid="compose-row-1"]');
    expect(defaultRow1).not.toBeNull();
    expect(harnessRow1).not.toBeNull();
    // Class lists match (Row 1 outer wrapper identical between default + harness).
    expect(defaultRow1!.className).toBe(harnessRow1!.className);
  });
});
