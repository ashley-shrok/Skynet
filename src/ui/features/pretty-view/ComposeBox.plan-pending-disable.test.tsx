/**
 * Phase 24 (Plan 05) — ComposeBox planPendingActive tests.
 *
 * Body-consumption tests for the new `planPendingActive?: boolean` prop
 * that flips every WS-side-effecting control off during the plan-mode
 * approval-prompt window while leaving the textarea typeable so Ashley
 * can pre-draft her feedback message while the [Approve] / [Feedback]
 * bubble is up. Prop is a verbatim clone of recycleActive's shape from
 * quick 260729-j8l — same disable semantics, same textarea-stays-typeable
 * treatment, same mic-available-when-composebox-disabled parity from
 * quick 260731-ulo.
 *
 * Truth table pinned (CONTEXT.md § Compose-box disable):
 *   - Send button: STAYS as Send (aria-label "Send", paper-plane icon,
 *     NOT morphed to X/Resume) but `disabled=true`. Send-morph is
 *     asideActive's job only.
 *   - Aux buttons (reset cell, ThumbsUp, Recap):
 *     ALL disabled=true when planPendingActive=true. Predicates OR-in
 *     `|| planPendingActive === true` in parallel with the existing
 *     `|| asideActive === true` and `|| recycleActive === true` clauses.
 *   - Textarea: STAYS typeable (disabled unchanged). Draft survives the
 *     plan-approval window by the existing autosave path (patches
 *     #57 / #119) — same treatment as recycleActive.
 *   - Enter key: does NOT fire onSend when planPendingActive=true (the
 *     handleKeyDown early-return closes the "button disabled but Enter
 *     still fires" gap; OR'd with recycleActive in the same guard).
 *   - Baseline (planPendingActive=false / undefined): every gate above
 *     reverts — Send fires on click, Enter fires, aux buttons enabled.
 *
 * Mic + paperclip parity (quick 260731-ulo bounty
 * mic-available-when-composebox-disabled):
 *   - Primary Paperclip + primary MicButton stay USABLE during
 *     planPendingActive (no WS side-effect from either alone).
 *   - Completed voice transcript during planPendingActive lands in the
 *     textarea/slot but does NOT auto-dispatch — Ashley sends manually
 *     once the approval window clears.
 *
 * Renders + mock setup mirror ComposeBox.recycle-disable.test.tsx verbatim
 * (established fixture pattern for the file). See that file's docblock for
 * the shared rationale on the truth-table cases.
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

describe("ComposeBox — Phase 24 planPendingActive gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Patch #129 test-hygiene: localStorage persists across tests in the
    // shared JSDOM instance and patch #119's compose-draft-ls mirror writes
    // to it on every keystroke. Clear so this file's tests don't hydrate
    // from a prior test's leftover draft.
    localStorage.clear();
  });

  it("B1: planPendingActive=true — Send button is disabled but NOT morphed to X (still aria-label 'Send')", () => {
    const { container } = render(
      <ComposeBox {...baseProps({ planPendingActive: true })} />,
    );
    // Type some text so `sendDisabled` is not driven by empty-text.
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello mid-plan-approval" } });

    // aria-label is "Send" (NOT "Resume"). Morph is aside-only.
    const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    // Disabled by sendDisabled → planPendingActive OR-in.
    expect(sendBtn.disabled).toBe(true);
    // Paper-plane inline SVG still renders (NOT the lucide X).
    const paperPlanePath = container.querySelector('path[d^="M14.536"]');
    expect(paperPlanePath).not.toBeNull();
    // No "Resume" button (morph is aside-only).
    expect(screen.queryByLabelText("Resume")).toBeNull();
  });

  it("B2: planPendingActive=true — aux WS-side-effect buttons (reset, thumbs-up, recap) disabled; aux Queue button removed per Vehicle C", () => {
    render(
      <ComposeBox
        {...baseProps({
          planPendingActive: true,
          showPaperclip: true,
          onAttachFiles: vi.fn(),
        })}
      />,
    );
    const resetBtn = screen.getByLabelText("Reset context window") as HTMLButtonElement;
    const thumbsUpBtn = screen.getByLabelText("Send 'thumbs up'") as HTMLButtonElement;
    const explainBtn = screen.getByLabelText("Recap the current situation") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(thumbsUpBtn.disabled).toBe(true);
    expect(explainBtn.disabled).toBe(true);
    expect(screen.queryByLabelText("Queue send for when session goes idle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send when idle" })).toBeNull();
  });

  it("B3: planPendingActive=true — textarea stays typeable", () => {
    render(<ComposeBox {...baseProps({ planPendingActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    fireEvent.change(textarea, { target: { value: "draft during plan-approval" } });
    expect(textarea.value).toBe("draft during plan-approval");
  });

  it("B4: planPendingActive=true — Enter key does NOT fire onSend", () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend, planPendingActive: true })} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "should not send on enter" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("B5: planPendingActive=false (default) — baseline sanity, Send enabled and short-tap fires onSend", async () => {
    // Phase 32 Plan 32-02: send path is now pointer-gesture-owned, not click-
    // owned. Stub navigator.mediaDevices so useHoldToRecord's onPointerDown ->
    // voice.start() -> getUserMedia does not crash; the short-tap branch awaits
    // voice.cancel() (Plan 32-01 pendingCancelRef synchronous teardown) which
    // discards the never-resolving getUserMedia promise.
    const originalNavigator = globalThis.navigator;
    const getUserMediaMock = vi.fn(() => new Promise(() => {}));
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: getUserMediaMock } },
      writable: true,
      configurable: true,
    });
    try {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend })} />);
      const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "normal send" } });
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);
      // Quick 260814-1hz: Send button now uses plain onClick (hold gesture
      // moved to MicButton). Click fires handleSend directly.
      fireEvent.click(sendBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(onSend).toHaveBeenCalledTimes(1);
      // Phase 50 D-18: onSend widened to (text, mqid?).
      expect(onSend).toHaveBeenCalledWith("normal send", expect.stringMatching(/^pv-optim-/));
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });

  it("B6: draft survives across a planPendingActive true→false transition (textarea `disabled` never flipped by planPendingActive)", () => {
    const { rerender } = render(
      <ComposeBox {...baseProps({ planPendingActive: true })} />,
    );
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "pre-draft" } });
    expect(textarea.value).toBe("pre-draft");
    // Plan approval completes — planPendingActive flips back to false.
    rerender(<ComposeBox {...baseProps({ planPendingActive: false })} />);
    // Same textarea DOM node (React preserved because `disabled` never
    // changed); value survives the transition.
    const textareaAfter = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe("pre-draft");
  });

  // Quick 260731-ulo (bounty mic-available-when-composebox-disabled)
  // parity for Phase 24: mic + paperclip stay usable during the plan-
  // approval window; a completed voice transcript lands in textarea but
  // does NOT dispatch. Nested describe adds mediaDevices + MediaRecorder
  // + fetch stubs (same pattern as ComposeBox.voice.test.tsx L102-116
  // and ComposeBox.recycle-disable.test.tsx L156-221) so the mic
  // renders and the voice-flow can be driven end-to-end during the
  // approval window. afterEach restores globals so B1-B6 above and
  // other test files are not perturbed.
  describe("planPendingActive=true — mic + paperclip usable (bounty mic-available-when-composebox-disabled)", () => {
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
      // Mirrors real MediaRecorder.state — flips to "recording" on start(),
      // "inactive" on stop(). useVoiceRecording's stopRecording() guard reads
      // this field (iOS Safari dropped-onstop cascade fix, quick-260808-1pa).
      state: "inactive" | "recording" | "paused" = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start = vi.fn().mockImplementation(() => {
        this.state = "recording";
      });
      stop = vi.fn().mockImplementation(() => {
        this.state = "inactive";
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

    it("C1: planPendingActive=true + showPaperclip=true — Paperclip button renders and is NOT disabled", () => {
      render(
        <ComposeBox
          {...baseProps({
            planPendingActive: true,
            showPaperclip: true,
            onAttachFiles: vi.fn(),
          })}
        />,
      );
      const attachBtn = screen.getByLabelText("Attach file") as HTMLButtonElement;
      expect(attachBtn).toBeTruthy();
      expect(attachBtn.disabled).toBe(false);
    });

    it("C2: planPendingActive=true — primary MicButton renders and is NOT disabled", () => {
      render(<ComposeBox {...baseProps({ planPendingActive: true })} />);
      const micBtn = screen.getByRole("button", { name: "Record voice" }) as HTMLButtonElement;
      expect(micBtn).toBeTruthy();
      expect(micBtn.disabled).toBe(false);
    });

    it("C3: planPendingActive=true — completed PRIMARY voice transcript lands in the textarea but does NOT trigger onSend", async () => {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend, planPendingActive: true })} />);

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

      // The core bounty assertion: no auto-send during the plan-approval window.
      expect(onSend).not.toHaveBeenCalled();
    });

    it("C4: planPendingActive=true — after voice transcript lands, Send button stays disabled (sendDisabled OR-in guard)", async () => {
      const onSend = vi.fn(() => true);
      render(<ComposeBox {...baseProps({ onSend, planPendingActive: true })} />);

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
      // enable Send), planPendingActive OR-in keeps sendDisabled=true. Guards
      // a future refactor that accidentally decouples the two.
      const sendBtn = screen.getByLabelText("Send") as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
    });

    // TODO(Phase 24): C5 slot-branch parity test — deferred; primary-mic
    // parity in C3 is required coverage. Rationale mirrors the same
    // deferral in ComposeBox.recycle-disable.test.tsx: seeding a queue
    // slot via the Plus-button flow and then driving the slot mic
    // through the voice pipeline requires a fixture shape that does not
    // cleanly extend the current file's baseProps pattern. The slot-
    // branch source-side guard in handleVoiceSend is symmetric with the
    // primary branch (both wrap dispatch in `if (!recycleActive &&
    // !planPendingActive)` with the same "text lands, no dispatch, slot
    // not removed" invariant) and exercised via handleVoiceAppend's
    // existing coverage in ComposeBox.voice.test.tsx.
  });
});
