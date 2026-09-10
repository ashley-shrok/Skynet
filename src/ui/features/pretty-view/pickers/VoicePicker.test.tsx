/**
 * VoicePicker component unit tests.
 *
 * Phase 98 Plan 03 rewrite: VoicePicker inlines POLLY_VOICES const — no
 * runtime voice-catalog fetch. Tests assert on the 7 static Polly voice IDs
 * (Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen) rendered
 * synchronously on mount.
 *
 * Covers:
 * 1. Renders 7 POLLY_VOICES options + default synchronously on mount
 * 2. onChange fires with new voiceId on select change
 * 3. Sample button calls postSpeak with SAMPLE_PHRASE and voice
 * 4. Sample button uses undefined voice when value is empty
 * 5. Disabled prop disables select AND sample button
 * 6. Unmount revokes any playing sample URL and pauses audio
 * 7. SAMPLE_PHRASE is exported and non-empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Phase 98 Plan 03: VoicePicker no longer fetches a voice catalog at runtime.
// Only postSpeak (sample button) and SAMPLE_PHRASE are imported.
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
}));

// ── Late imports ──────────────────────────────────────────────────────────────
import { VoicePicker, SAMPLE_PHRASE } from "./VoicePicker";
import { postSpeak } from "@/api/voice-api";

const mockedPostSpeak = vi.mocked(postSpeak);

// ── Audio + URL globals ───────────────────────────────────────────────────────

let mockAudioInstance: MockAudio | null = null;

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());

  constructor(src: string) {
    this.src = src;
    mockAudioInstance = this;
  }
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAudioInstance = null;
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock-voice-url"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VoicePicker", () => {
  it("Test 1 - renders 7 POLLY_VOICES + default synchronously on mount", () => {
    render(<VoicePicker value="" onChange={vi.fn()} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    // Default fallback + 7 Polly voice IDs (order per POLLY_VOICES const)
    expect(options).toEqual([
      "",
      "Danielle",
      "Joanna",
      "Ruth",
      "Salli",
      "Tiffany",
      "Matthew",
      "Stephen",
    ]);
  });

  it("Test 2 - onChange fires with new voiceId on select change", () => {
    const onChange = vi.fn();
    render(<VoicePicker value="" onChange={onChange} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Joanna" } });

    expect(onChange).toHaveBeenCalledWith("Joanna");
  });

  it("Test 3 - sample button calls postSpeak with SAMPLE_PHRASE and voice", async () => {
    render(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toBe("Joanna");
    });
  });

  it("Test 4 - sample button uses undefined voice when value is empty", async () => {
    render(<VoicePicker value="" onChange={vi.fn()} disabled={false} />);

    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toBeUndefined();
    });
  });

  it("Test 5 - disabled prop disables select AND sample button", () => {
    render(<VoicePicker value="" onChange={vi.fn()} disabled={true} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const sampleBtn = screen.getByLabelText("Sample voice") as HTMLButtonElement;

    expect(select.disabled).toBe(true);
    expect(sampleBtn.disabled).toBe(true);
  });

  it("Test 6 - unmount revokes any playing sample URL and pauses audio", async () => {
    const { unmount } = render(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    // Trigger sample playback
    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    // Wait for postSpeak to be called and audio created
    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
    });

    // Give microtask queue time to run (audio setup happens in async chain)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Now unmount — cleanup effect should pause + revoke
    unmount();

    expect(mockAudioInstance?.pause).toHaveBeenCalled();
    expect((URL.revokeObjectURL as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("blob:mock-voice-url");
  });

  it("Test 7 - SAMPLE_PHRASE is exported and non-empty", () => {
    expect(SAMPLE_PHRASE.length).toBeGreaterThan(0);
  });
});
