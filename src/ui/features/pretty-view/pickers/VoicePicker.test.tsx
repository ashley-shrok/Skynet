/**
 * VoicePicker component unit tests.
 *
 * The voice list comes from the server (GET /voice/voices — the active TTS
 * provider's voices); the picker keeps no list of its own. A saved voice the
 * active provider doesn't offer stays on screen, greyed out with a note.
 *
 * Covers:
 * 1. Renders the server's voices + default once the list loads
 * 2. Select change stages a draft; onChange only fires when apply is clicked
 * 3. Sample button calls postSpeak with SAMPLE_PHRASE and [voice]
 * 4. Sample button sends no voice candidates when value is empty
 * 5. Disabled prop disables select AND sample button
 * 6. Unmount revokes any playing sample URL and pauses audio
 * 7. SAMPLE_PHRASE is exported and non-empty
 * 8. Sample button plays the DRAFT voice, not the committed value
 * 9. External value change resyncs draft and hides apply button
 * 10. Saved voice not offered by the active provider → greyed option + note
 * 11. List fetch failure → saved voice still shown, select disabled, error line
 * 12. Descriptions (ElevenLabs) render after the name
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Module mocks ──────────────────────────────────────────────────────────────

const POLLY_CATALOG = {
  voices: ["Danielle", "Joanna", "Ruth", "Salli", "Tiffany", "Matthew", "Stephen"].map((id) => ({ id, name: id })),
  defaultVoice: "Joanna",
  listError: false,
};

vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  fetchVoiceCatalog: vi.fn(),
}));

// ── Late imports ──────────────────────────────────────────────────────────────
import { VoicePicker, SAMPLE_PHRASE, UNAVAILABLE_NOTE, LIST_ERROR_NOTE } from "./VoicePicker";
import { resetVoiceCatalogCache } from "./useVoiceCatalog";
import { postSpeak, fetchVoiceCatalog } from "@/api/voice-api";

const mockedPostSpeak = vi.mocked(postSpeak);
const mockedFetchCatalog = vi.mocked(fetchVoiceCatalog);

/** Render and wait for the server voice list to land. */
async function renderLoaded(ui: React.ReactElement) {
  const utils = render(ui);
  await waitFor(() => expect(mockedFetchCatalog).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return utils;
}

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
  resetVoiceCatalogCache();
  mockedFetchCatalog.mockResolvedValue(POLLY_CATALOG);
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
  it("Test 1 - renders the server's voices + default once the list loads", async () => {
    await renderLoaded(<VoicePicker value="" onChange={vi.fn()} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(mockedFetchCatalog).toHaveBeenCalledTimes(1);
    expect(select.disabled).toBe(false);
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

  it("Test 2 - select change stages a draft; onChange only fires when apply is clicked", async () => {
    const onChange = vi.fn();
    await renderLoaded(<VoicePicker value="" onChange={onChange} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Joanna" } });

    // Dropdown reflects the staged pick, but nothing committed yet.
    expect(select.value).toBe("Joanna");
    expect(onChange).not.toHaveBeenCalled();

    // Apply button appears once draft diverges from value.
    const applyBtn = screen.getByTestId("voice-picker-apply");
    fireEvent.click(applyBtn);

    expect(onChange).toHaveBeenCalledWith("Joanna");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Test 3 - sample button calls postSpeak with SAMPLE_PHRASE and voice", async () => {
    render(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toEqual(["Joanna"]);
    });
  });

  it("Test 4 - sample button sends no voice candidates when value is empty", async () => {
    render(<VoicePicker value="" onChange={vi.fn()} disabled={false} />);

    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toEqual([]);
    });
  });

  it("Test 5 - disabled prop disables select AND sample button", async () => {
    await renderLoaded(<VoicePicker value="" onChange={vi.fn()} disabled={true} />);

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

  it("Test 8 - sample button plays the DRAFT voice, not the committed value", async () => {
    await renderLoaded(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    // Stage a different voice without applying.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Ruth" } });

    // Sample should play the DRAFT (Ruth), not the committed value (Joanna).
    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [, voice] = mockedPostSpeak.mock.calls[0];
      expect(voice).toEqual(["Ruth"]);
    });
  });

  it("Test 9 - external value change resyncs draft and hides apply button", async () => {
    const { rerender } = await renderLoaded(
      <VoicePicker value="" onChange={vi.fn()} disabled={false} />,
    );

    // Stage a draft; apply button appears.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Joanna" } });
    expect(screen.queryByTestId("voice-picker-apply")).not.toBeNull();

    // Parent pushes a new value (e.g., modal reopened on a different subject,
    // or save round-trip landed). Draft resyncs; apply button hides.
    rerender(<VoicePicker value="Matthew" onChange={vi.fn()} disabled={false} />);
    expect(select.value).toBe("Matthew");
    expect(screen.queryByTestId("voice-picker-apply")).toBeNull();
  });

  it("Test 10 - unavailable saved voice: greyed option selected, note shown, sample disabled", async () => {
    mockedFetchCatalog.mockResolvedValue({
      voices: [{ id: "marin", name: "Marin" }, { id: "nova", name: "Nova" }],
      defaultVoice: "marin",
      labels: { Joanna: "Joanna", marin: "Marin", nova: "Nova" },
      listError: false,
    });
    await renderLoaded(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("Joanna");
    const unavailable = screen.getByTestId("voice-picker-unavailable-option") as HTMLOptionElement;
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.textContent).toBe("Joanna");
    expect(screen.getByTestId("voice-picker-unavailable-note").textContent).toBe(UNAVAILABLE_NOTE);
    expect((screen.getByLabelText("Sample voice") as HTMLButtonElement).disabled).toBe(true);

    // Picking an offered voice clears the note and enables the sample.
    fireEvent.change(select, { target: { value: "nova" } });
    expect(screen.queryByTestId("voice-picker-unavailable-note")).toBeNull();
    expect((screen.getByLabelText("Sample voice") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Test 11 - list fetch failure: saved voice still shown, select disabled, error line", async () => {
    mockedFetchCatalog.mockResolvedValue({ voices: [], defaultVoice: "SAz9YHcvj6GT2YYXdXww", listError: true });
    await renderLoaded(<VoicePicker value="EXAVITQu4vr4xnSDxMaL" onChange={vi.fn()} disabled={false} />);

    await waitFor(() => expect(screen.getByTestId("voice-picker-list-error").textContent).toBe(LIST_ERROR_NOTE));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("EXAVITQu4vr4xnSDxMaL");
    // Never the raw provider code on screen.
    expect(select.options[select.selectedIndex].textContent).toBe("Saved voice");
    expect(screen.queryByTestId("voice-picker-unavailable-note")).toBeNull();
  });

  it("Test 12 - voices with a description render as 'Name — description'", async () => {
    mockedFetchCatalog.mockResolvedValue({
      voices: [{ id: "SAz9YHcvj6GT2YYXdXww", name: "River", description: "Relaxed, Neutral, Informative" }],
      defaultVoice: "SAz9YHcvj6GT2YYXdXww",
      listError: false,
    });
    await renderLoaded(<VoicePicker value="SAz9YHcvj6GT2YYXdXww" onChange={vi.fn()} disabled={false} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options[select.selectedIndex].textContent).toBe("River — Relaxed, Neutral, Informative");
  });

  it("Test 13 - a failed preview shows a notice instead of doing nothing", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "id");
    mockedPostSpeak.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }));
    await renderLoaded(<VoicePicker value="Joanna" onChange={vi.fn()} disabled={false} />);

    fireEvent.click(screen.getByLabelText("Sample voice"));

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Couldn't speak this message", {
        description: "The voice service is unavailable.",
      }),
    );
  });
});
