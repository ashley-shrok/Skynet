// Phase 93 Slice 3 Task 2 — ComposeBox mode="relay" keeps only the mic and
// Send (D-11); the text field (textarea + Send visual shell) is identical
// between modes (D-12).
//
// shape-conversation-view: the composer is one card — the text field
// (`compose-primary-wrapper`) on top, one control row (`compose-row`)
// underneath. In harness mode the row carries attach, skills, the memory
// gauge, voice mode, the mic and the main button (thumbs-up with nothing
// typed). Relay rooms get only the mic and Send.

import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, fireEvent } from "@testing-library/react";
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
  it("Test 1 (default = harness): renders the harness controls AND Paperclip when mode is unset (backward-compat)", () => {
    const { container } = render(<ComposeBox {...baseProps()} />);
    // Control row present with the harness-only controls.
    const row = container.querySelector('[data-testid="compose-row"]');
    expect(row).not.toBeNull();
    // The memory pie lives in the task pill now, never in the compose row.
    expect(row!.querySelector('[data-testid="memory-gauge"]')).toBeNull();
    expect(row!.querySelector('button[aria-label="Send \'thumbs up\'"]')).not.toBeNull();
    // Paperclip button present (showPaperclip=true, harness default).
    expect(container.querySelector('button[aria-label="Attach file"]')).not.toBeNull();
    // Text field also present (baseline).
    expect(container.querySelector('[data-testid="compose-primary-wrapper"]')).not.toBeNull();
  });

  it("Test 1b (explicit mode=harness): same as default — harness controls + Paperclip present, no memory pie", () => {
    const { container } = render(<ComposeBox {...baseProps({ mode: "harness" })} />);
    expect(container.querySelector('[data-testid="memory-gauge"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Send \'thumbs up\'"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Attach file"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compose-primary-wrapper"]')).not.toBeNull();
  });

  it("Test 2 (mode=relay harness controls hidden): no memory gauge, thumbs-up, Stop or recap — only Send", () => {
    const { container } = render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    // Memory gauge (and its Condense conversation) absent.
    expect(container.querySelector('[data-testid="memory-gauge"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Agent memory"]')).toBeNull();
    // ThumbsUp button absent.
    expect(
      container.querySelector('button[aria-label="Send \'thumbs up\'"]'),
    ).toBeNull();
    // No Stop (there is none in any compose box now).
    expect(container.querySelector('button[aria-label="Interrupt"]')).toBeNull();
    // Recap (CircleHelp) button absent.
    expect(
      container.querySelector('button[aria-label="Recap the current situation"]'),
    ).toBeNull();
    // Send is always rendered in relay mode (disabled while empty).
    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement | null;
    expect(send).not.toBeNull();
    expect(send!.disabled).toBe(true);
  });

  it("Test 3 (mode=relay Paperclip hidden): Paperclip does NOT render, regardless of showPaperclip=true", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ mode: "relay", showPaperclip: true })} />,
    );
    expect(container.querySelector('button[aria-label="Attach file"]')).toBeNull();
  });

  it("Test 4 (mode=relay text field identical): text field wrapper class + textarea + Send visual shell match harness mode", () => {
    // Render both modes with identical (attachment-free) inputs to compare.
    const { container: harnessContainer } = render(
      <ComposeBox {...baseProps({ mode: "harness", showPaperclip: false })} />,
    );
    const { container: relayContainer } = render(
      <ComposeBox {...baseProps({ mode: "relay", showPaperclip: false })} />,
    );
    const harnessField = harnessContainer.querySelector('[data-testid="compose-primary-wrapper"]');
    const relayField = relayContainer.querySelector('[data-testid="compose-primary-wrapper"]');
    expect(harnessField).not.toBeNull();
    expect(relayField).not.toBeNull();
    // Same class list (no divergence in the text field's style).
    expect(harnessField!.className).toBe(relayField!.className);
    // Textarea present in both, same class list.
    const harnessTextarea = harnessField!.querySelector("textarea");
    const relayTextarea = relayField!.querySelector("textarea");
    expect(harnessTextarea).not.toBeNull();
    expect(relayTextarea).not.toBeNull();
    expect(harnessTextarea!.className).toBe(relayTextarea!.className);
    // Harness renders Send once there's something to send.
    fireEvent.change(harnessTextarea!, { target: { value: "hi" } });
    const harnessSend = harnessContainer.querySelector('button[aria-label="Send"]');
    const relaySend = relayContainer.querySelector('button[aria-label="Send"]');
    expect(harnessSend).not.toBeNull();
    expect(relaySend).not.toBeNull();
    // Send's classlist matches between modes (VISUAL-08 lock).
    expect(harnessSend!.className).toBe(relaySend!.className);
  });

  it("Test 5 (backward-compat): rendering without a mode prop yields the identical control row markup as mode=\"harness\"", () => {
    const { container: defaultContainer } = render(<ComposeBox {...baseProps()} />);
    const { container: harnessContainer } = render(
      <ComposeBox {...baseProps({ mode: "harness" })} />,
    );
    const defaultRow = defaultContainer.querySelector('[data-testid="compose-row"]');
    const harnessRow = harnessContainer.querySelector('[data-testid="compose-row"]');
    expect(defaultRow).not.toBeNull();
    expect(harnessRow).not.toBeNull();
    expect(defaultRow!.className).toBe(harnessRow!.className);
    expect(defaultRow!.children.length).toBe(harnessRow!.children.length);
  });

  it("Test 6 (Phase 97 F-3 Step 1 — relay has NO pl-11 gutter): mode=relay + showPaperclip=true → textarea does NOT carry the pl-11 class", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ mode: "relay", showPaperclip: true })} />,
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea!.classList.contains("pl-11")).toBe(false);
  });

  it("Test 7: the composer root reports its mode (data-mode) so CSS can tell the two apart", () => {
    const relay = render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    expect(relay.container.querySelector(".pv-composebox")!.getAttribute("data-mode")).toBe("relay");
    relay.unmount();
    const harness = render(<ComposeBox {...baseProps({ mode: "harness" })} />);
    expect(harness.container.querySelector(".pv-composebox")!.getAttribute("data-mode")).toBe("harness");
  });
});
