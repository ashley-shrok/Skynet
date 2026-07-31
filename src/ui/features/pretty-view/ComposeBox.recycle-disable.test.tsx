/**
 * Quick 260729-j8l — ComposeBox recycleActive tests.
 *
 * Body consumption tests for the new `recycleActive?: boolean` prop
 * that flips every WS-side-effecting control off during a session
 * recycle while leaving the textarea typeable so Ashley can pre-draft
 * the next message during the 2-15s recycle window.
 *
 * Truth table pinned:
 *   - Send button: STAYS as Send (aria-label "Send", paper-plane icon,
 *     NOT morphed to X/Resume) but `disabled=true`. Send is orthogonal
 *     to aside — recycle disables, aside morphs.
 *   - Aux buttons (reset cell, ThumbsUp, Lightbulb, Queue):
 *     ALL disabled=true when recycleActive=true. Predicates OR-in
 *     `|| recycleActive === true` in parallel with the existing
 *     `|| asideActive === true` clause.
 *   - Textarea: STAYS typeable (disabled unchanged). Draft survives the
 *     recycle by the existing autosave path (patches #57 / #119).
 *   - Enter key: does NOT fire onSend when recycleActive=true (the
 *     handleKeyDown early-return closes the "button disabled but
 *     Enter still fires" gap).
 *   - Baseline (recycleActive=false / undefined): every gate above
 *     reverts — Send fires on click, Enter fires, aux buttons enabled.
 *
 * Renders + mock setup mirror ComposeBox.aside-morph.test.tsx verbatim
 * (established fixture pattern for the file).
 *
 * Quick 260731-ulo (bounty mic-available-when-composebox-disabled):
 * mic + paperclip stay USABLE during recycle (no WS side-effect from
 * either alone). Voice-send is gated so a completed transcript during
 * recycle lands in the textarea/slot but does NOT dispatch — Ashley
 * sends manually once the overlay clears.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

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

describe("ComposeBox — quick 260729-j8l recycleActive gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene: localStorage persists across tests in the
    // shared JSDOM instance and patch #119's compose-draft-ls mirror writes
    // to it on every keystroke. Clear so this file's tests don't hydrate
    // from a prior test's leftover draft.
    localStorage.clear();
  });

  it("B1: recycleActive=true — Send button is disabled but NOT morphed to X (still aria-label 'Send')", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ recycleActive: true })} />,
    );
    // Type some text so `sendDisabled` is not driven by empty-text.
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello mid-recycle" } });

    // aria-label is "Send" (NOT "Resume"). Morph is aside-only.
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    // Disabled by sendDisabled → recycleActive OR-in.
    expect(sendBtn.disabled).toBe(true);
    // Paper-plane inline SVG still renders (NOT the lucide X).
    const paperPlanePath = container.querySelector('path[d^="M14.536"]');
    expect(paperPlanePath).not.toBeNull();
    // No "Resume" button (morph is aside-only).
    expect(screen.queryByLabelText("Resume")).toBeNull();
  });

  it("B2: recycleActive=true — aux WS-side-effect buttons (reset, thumbs-up, explain, queue-for-idle) disabled", () => {
    render(
      <ComposeBox
        {...baseProps({
          recycleActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
          // onInterrupt intentionally omitted — the stop button doesn't
          // participate in the recycleActive gate (not in the plan's
          // aux-button disable set).
        })}
      />,
    );
    const resetBtn = screen.getByLabelText("Send with /id reset prefix") as HTMLButtonElement;
    const thumbsUpBtn = screen.getByLabelText("Send 'let's go'") as HTMLButtonElement;
    const explainBtn = screen.getByLabelText("Ask for a concise re-explanation") as HTMLButtonElement;
    const queueBtn = screen.getByLabelText("Queue send for when session goes idle") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(thumbsUpBtn.disabled).toBe(true);
    expect(explainBtn.disabled).toBe(true);
    expect(queueBtn.disabled).toBe(true);
  });

  it("B3: recycleActive=true — textarea stays typeable", () => {
    render(<ComposeBox {...baseProps({ recycleActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: "draft during recycle" } });
    expect(textarea.value).toBe("draft during recycle");
  });

  it("B4: recycleActive=true — Enter key does NOT fire onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, recycleActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "should not send on enter" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("B5: recycleActive=false (default) — baseline sanity, Send enabled and click fires onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "normal send" } });
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("normal send");
  });

  it("B6: draft survives across a recycleActive true→false transition (textarea `disabled` never flipped by recycleActive)", () => {
    const { rerender } = render(
      <ComposeBox {...baseProps({ recycleActive: true })} />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "pre-draft" } });
    expect(textarea.value).toBe("pre-draft");
    // Recycle completes — recycleActive flips back to false.
    rerender(<ComposeBox {...baseProps({ recycleActive: false })} />);
    // Same textarea DOM node (React preserved because `disabled` never
    // changed); value survives the transition.
    const textareaAfter = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe("pre-draft");
  });

  // Quick 260731-ulo (bounty mic-available-when-composebox-disabled).
  // Nested describe adds mediaDevices + MediaRecorder + fetch stubs
  // (same pattern as ComposeBox.voice.test.tsx L102-116) so the mic
  // renders and the voice-flow can be driven end-to-end during
  // recycle. afterEach restores globals so B1-B6 above and other test
  // files are not perturbed.
  describe("recycleActive=true — mic + paperclip usable (bounty mic-available-when-composebox-disabled)", () => {
    /** Minimal MediaStream stub: getTracks() returns one stoppable track. */
    function makeMockStream() {
      const track = { stop: vi.fn() };
      return {
        getTracks: vi.fn(() => [track]),
        _track: track,
      };
    }

    /** Minimal MediaRecorder stub. Tests can trigger ondataavailable / onstop manually. */
    class MockMediaRecorder {
      static instances: MockMediaRecorder[] = [];

      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start = vi.fn();
      stop = vi.fn().mockImplementation(() => {
        if (this.onstop) this.onstop();
      });

      constructor(public stream: MediaStream) {
        MockMediaRecorder.instances.push(this);
      }

      emitData(blob: Blob) {
        if (this.ondataavailable) this.ondataavailable({ data: blob });
      }
    }

    beforeEach(() => {
      vi.clearAllMocks();
      localStorage.clear();

      MockMediaRecorder.instances = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).MediaRecorder = MockMediaRecorder;

      const mockStream = makeMockStream();
      const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(globalThis, "navigator", {
        value: {
          mediaDevices: {
            getUserMedia: getUserMediaMock,
          },
        },
        writable: true,
        configurable: true,
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ text: "hello world" }),
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("C1: recycleActive=true + showPaperclip=true — Paperclip button renders and is NOT disabled", () => {
      render(
        <ComposeBox
          {...baseProps({
            recycleActive: true,
            showPaperclip: true,
            onAttachFiles: vi.fn(),
          })}
        />,
      );
      const attachBtn = screen.getByLabelText("Attach file") as HTMLButtonElement;
      expect(attachBtn).toBeTruthy();
      expect(attachBtn.disabled).toBe(false);
    });

    it("C2: recycleActive=true — primary MicButton renders and is NOT disabled", () => {
      render(<ComposeBox {...baseProps({ recycleActive: true })} />);
      const micBtn = screen.getByRole("button", { name: "Record voice" }) as HTMLButtonElement;
      expect(micBtn).toBeTruthy();
      expect(micBtn.disabled).toBe(false);
    });

    it("C3: recycleActive=true — completed PRIMARY voice transcript lands in the textarea but does NOT trigger onSend", async () => {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend, recycleActive: true })} />);

      const micBtn = screen.getByRole("button", { name: "Record voice" });
      fireEvent.click(micBtn);

      const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

      act(() => {
        const recorder = MockMediaRecorder.instances[0];
        recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
      });

      fireEvent.click(sendTranscriptBtn);

      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      await waitFor(() => {
        expect(textarea.value).toBe("hello world");
      });

      // The core bounty assertion: no auto-send during recycle.
      expect(onSend).not.toHaveBeenCalled();
    });

    it("C4: recycleActive=true — after voice transcript lands, Send button stays disabled (sendDisabled OR-in guard)", async () => {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend, recycleActive: true })} />);

      const micBtn = screen.getByRole("button", { name: "Record voice" });
      fireEvent.click(micBtn);

      const sendTranscriptBtn = await screen.findByRole("button", { name: "Send transcript" });

      act(() => {
        const recorder = MockMediaRecorder.instances[0];
        recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
      });

      fireEvent.click(sendTranscriptBtn);

      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      await waitFor(() => {
        expect(textarea.value).toBe("hello world");
      });

      // Even though the textarea now holds "hello world" (which would normally
      // enable Send), recycleActive OR-in keeps sendDisabled=true. Guards a
      // future refactor that accidentally decouples the two.
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });

    // TODO(quick 260731-ulo): C5 slot-branch parity test — deferred; primary-mic parity in C3 is required coverage.
    // Rationale: seeding a queue slot via the Plus-button flow and then
    // driving the slot mic through the voice pipeline requires a fixture
    // shape that does not cleanly extend the current file's baseProps
    // pattern (per-slot mic sharing aria-label with primary mic + relying
    // on `voice.state === "recording"` + `micTarget === slot.id` to render
    // RecordingControls inside the correct slot container). The plan
    // explicitly permits skipping C5 rather than expanding fixture wiring
    // for one test. Slot-branch source-side guard in handleVoiceSend is
    // symmetric with the primary branch (both wrap dispatch in
    // `if (!recycleActive)` with the same "text lands, no dispatch, slot
    // not removed" invariant) and exercised via handleVoiceAppend's
    // existing coverage in ComposeBox.voice.test.tsx.
  });
});
