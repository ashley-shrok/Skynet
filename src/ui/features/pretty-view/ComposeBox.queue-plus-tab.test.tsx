// "Queue a message" retired (shape-conversation-view).
//
// The pebble-notch plus-tab (quick 260909-cdi) that added queued-message
// textareas is gone entirely — nothing can add a new queued slot. Slots saved
// in a restored draft before the retirement still render (and send) above
// the composer's text field, in their saved order. These tests lock both
// halves: no add affordance anywhere, restored slots still shown.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

describe("ComposeBox — Queue a message retired (shape-conversation-view)", () => {
  it("no 'Queue a message' button when there are no queued slots", async () => {
    render(<ComposeBox {...baseProps()} />);
    await flushDraftHydration();
    expect(screen.queryByRole("button", { name: /queue a message/i })).toBeNull();
    expect(document.querySelector("[data-slot-id]")).toBeNull();
  });

  it("restored queued slots still render, in saved order, above the text field — with no add button on them", async () => {
    vi.mocked(getComposeDraft).mockResolvedValueOnce({
      body: "",
      queueSlots: [
        { id: "slot-A", text: "first" },
        { id: "slot-B", text: "second" },
      ],
    });

    const { container } = render(<ComposeBox {...baseProps()} />);
    await flushDraftHydration();

    const slots = container.querySelectorAll("[data-slot-id]");
    expect(Array.from(slots).map((el) => el.getAttribute("data-slot-id"))).toEqual(["slot-A", "slot-B"]);
    // Above the text field in document order.
    const field = screen.getByTestId("compose-primary-wrapper");
    // eslint-disable-next-line no-bitwise
    expect(slots[1]!.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing offers to add another.
    expect(screen.queryByRole("button", { name: /queue a message/i })).toBeNull();
    // Each restored slot still has its own Send.
    expect(screen.getAllByRole("button", { name: /send queued message/i })).toHaveLength(2);
  });
});
