/**
 * VoicePicker component unit tests.
 *
 * Covers:
 * 1. Renders voice options from getVoices on mount
 * 2. onChange fires with new filename on select change
 * 3. Sample button calls postSpeak with SAMPLE_PHRASE and voice
 * 4. Sample button uses undefined voice when value is empty
 * 5. Disabled prop disables select AND sample button
 * 6. Unmount revokes any playing sample URL and pauses audio
 * 7. SAMPLE_PHRASE is exported and non-empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  getVoices: vi.fn(async () => [
    { display_name: "Alice", filename: "Alice.wav" },
    { display_name: "Bob", filename: "Bob.wav" },
  ]),
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
}));

// ── Late imports ──────────────────────────────────────────────────────────────
import { VoicePicker, SAMPLE_PHRASE } from "./VoicePicker";
import { getVoices, postSpeak } from "@/api/voice-api";

const mockedGetVoices = vi.mocked(getVoices);
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
  it("Test 1 - renders voice options from getVoices on mount", async () => {
    render(<VoicePicker value="" onChange={vi.fn()} disabled={false} />);

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("");
      expect(options).toContain("Alice.wav");
      expect(options).toContain("Bob.wav");
      expect(options).toHaveLength(3);
    });
  });

  it("Test 2 - onChange fires with new filename on select change", async () => {
    const onChange = vi.fn();
    render(<VoicePicker value="" onChange={onChange} disabled={false} />);

    // Wait for voices to load
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(select.options).length).toBe(3);
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Alice.wav" } });

    expect(onChange).toHaveBeenCalledWith("Alice.wav");
  });

  it("Test 3 - sample button calls postSpeak with SAMPLE_PHRASE and voice", async () => {
    render(<VoicePicker value="Elena.wav" onChange={vi.fn()} disabled={false} />);

    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toBe("Elena.wav");
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
    const { unmount } = render(<VoicePicker value="Elena.wav" onChange={vi.fn()} disabled={false} />);

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
