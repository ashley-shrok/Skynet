// Quick 260909-cdi — behavioral coverage for the new pebble-notch plus-tab
// affordance that replaces the old ListPlus "Queue a message" aux-row button.
//
// The plus-tab visually notches into the top edge of whichever textarea is
// currently topmost in the compose stack:
//   - When queueSlots.length === 0, the tab rides on the primary textarea
//     wrapper ([data-testid="compose-primary-wrapper"]).
//   - When queueSlots.length > 0, the tab rides on the FIRST QueuedRow
//     (the slot at index 0 of queueSlots), NOT on the primary.
//
// Clicking the tab PREPENDS a new empty slot to queueSlots (index 0) — an
// inversion of today's append-at-end behavior on the deleted ListPlus button.
//
// The tab preserves the aria-label "Queue a message" of the old button so that
// existing tests (notably ComposeBox.hold-to-mic.test.tsx:1132) can continue
// to locate it via `getByRole("button", { name: /queue a message/i })`.
//
// This file also carries a redundant Recap-payload assertion (Test D) as a
// lightweight companion to send-funnel.test.tsx Test 4, keeping all four
// motions of the 260909-cdi quick behaviorally collocated.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComposeBoxProps } from "./ComposeBox";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// hydration effect uses the mock at first render. Default returns an empty
// draft; individual tests override via vi.mocked(...).mockResolvedValueOnce().
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox } from "./ComposeBox";
import { getComposeDraft } from "@/api/compose-drafts-api";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Default draft mock: empty. Individual tests override with
  // vi.mocked(getComposeDraft).mockResolvedValueOnce(...) BEFORE render.
  vi.mocked(getComposeDraft).mockResolvedValue({ body: "", queueSlots: [] });
  // navigator.mediaDevices needs to be truthy for showMicButton, but this
  // test file does not exercise the mic path — leave it as jsdom default.
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Walk enough fake time + microtask ticks so the compose-drafts hydration
 * .then() lands. Mirrors hold-to-mic.test.tsx:1121-1127 exactly.
 */
async function flushDraftHydration() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ComposeBox queue plus-tab (260909-cdi)", () => {
  it("Test A: renders on primary wrapper when queueSlots is empty", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushDraftHydration();

    const tab = screen.getByRole("button", { name: /queue a message/i });
    expect(tab).toBeTruthy();

    // The tab's closest primary-wrapper ancestor is truthy — the tab is
    // parented under the primary textarea wrapper when no slots exist.
    expect(tab.closest("[data-testid='compose-primary-wrapper']")).not.toBeNull();

    // And critically, it is NOT parented under any [data-slot-id] container,
    // because no QueuedRow exists in the tree yet.
    expect(tab.closest("[data-slot-id]")).toBeNull();
  });

  it("Test B: renders on the first (topmost) QueuedRow when slots exist", async () => {
    // Pre-seed two draft slots so we can prove the tab rides on the FIRST
    // slot (index 0), not the second. slot-A must come before slot-B in
    // queueSlots order.
    vi.mocked(getComposeDraft).mockResolvedValueOnce({
      body: "",
      queueSlots: [
        { id: "slot-A", text: "" },
        { id: "slot-B", text: "" },
      ],
    });

    render(<ComposeBox {...baseProps()} />);
    await flushDraftHydration();

    const tab = screen.getByRole("button", { name: /queue a message/i });
    const slotContainer = tab.closest("[data-slot-id]");
    expect(slotContainer).not.toBeNull();
    // The tab must live inside slot-A (index 0), not slot-B.
    expect(slotContainer?.getAttribute("data-slot-id")).toBe("slot-A");

    // And the tab must NOT be parented under the primary wrapper.
    expect(tab.closest("[data-testid='compose-primary-wrapper']")).toBeNull();
  });

  it("Test C: clicking the tab PREPENDS a new empty slot (not append)", async () => {
    const { container } = render(<ComposeBox {...baseProps()} />);
    await flushDraftHydration();

    // First click: from empty state → one slot exists. That slot's id is
    // the "first-created" id; the tab now rides on it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    let slots = container.querySelectorAll("[data-slot-id]");
    expect(slots.length).toBe(1);
    const firstCreatedId = slots[0]!.getAttribute("data-slot-id");
    expect(firstCreatedId).toBeTruthy();

    // Second click: another slot is PREPENDED — DOM order should now be
    // [new, first-created]. If the wiring accidentally appended instead of
    // prepended, the first-created slot would come first and this test
    // would fail.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    slots = container.querySelectorAll("[data-slot-id]");
    expect(slots.length).toBe(2);
    // The FIRST slot in DOM order is the newly-prepended one (its id
    // differs from firstCreatedId); the SECOND slot in DOM order is the
    // first-created one.
    const domFirstId = slots[0]!.getAttribute("data-slot-id");
    const domSecondId = slots[1]!.getAttribute("data-slot-id");
    expect(domFirstId).not.toBe(firstCreatedId);
    expect(domSecondId).toBe(firstCreatedId);
  });

  it("Test D: recap button sends the new payload (/explain what has gone on since my last message)", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    await flushDraftHydration();

    const recapBtn = screen.getByRole("button", {
      name: "Recap the current situation",
    });
    expect((recapBtn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(recapBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    // Phase 50 D-18: onSend widened to (text, mqid?). The payload string is
    // the load-bearing assertion for this quick; the mqid shape is
    // orthogonal but pinned here for good measure.
    expect(onSend).toHaveBeenCalledWith(
      "/explain what has gone on since my last message",
      expect.stringMatching(/^pv-optim-/),
    );
  });
});
