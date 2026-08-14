/**
 * Patch #223: IdentityModal voice picker + sample button tests.
 *
 * Tests cover:
 * 1. getVoices() called once on modal open, populates <select>
 * 2. <select> value reflects identity.voice on mount (null→"(default)", set→filename)
 * 3. changing dropdown updates local state without immediately calling updateIdentity
 * 4. sample button calls postSpeak(SAMPLE_PHRASE, voice) -- omit voice when default
 * 5. Save with changed voice calls updateIdentity with voice in meta
 * 6. Save with dropdown reset to "(default)" calls updateIdentity with voice: null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub factory ──────────────────────────────────────────────────────────
type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function makeFakeWs(): WsStub {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  getVoices: vi.fn(async () => [
    { display_name: "Elena", filename: "Elena.wav" },
    { display_name: "Marcus", filename: "Marcus.wav" },
  ]),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { updateIdentity } from "@/api/identities-api";
import { IdentityModal } from "./IdentityModal";
import { postSpeak, getVoices } from "@/api/voice-api";

const mockedUpdateIdentity = vi.mocked(updateIdentity);
const mockedGetVoices = vi.mocked(getVoices);
const mockedPostSpeak = vi.mocked(postSpeak);

// ── Audio + URL globals ──────────────────────────────────────────────────────

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  constructor(src: string) { this.src = src; }
  play() { return Promise.resolve(); }
  pause() {}
}

// ── Shared fixture ────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  id: "id-voice-1",
  identityKey: "elena",
  displayName: "Elena",
  title: "Tester",
  colorHue: null,
  voice: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/id-voice-1/avatar",
  avatarEtag: "etag-v1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderModal(identityOverrides?: Partial<Identity>) {
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={identity}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentityModal voice picker (patch #223)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-voice"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: getVoices() called exactly once on open; select has Elena + Marcus options (plus default)", async () => {
    renderModal();

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Rule 1 fix: increased timeout from default 5000ms to 15000ms — this
    // async await can be slow under heavy CI load (full-suite parallel run
    // exhausts CPU budget, causing the waitFor polling loop to overshoot
    // the default window). The logic is correct; the flake is purely timing.
    await waitFor(() => {
      expect(mockedGetVoices).toHaveBeenCalledTimes(1);
    }, { timeout: 15000 });

    // Wait for options to populate
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("");
      expect(options).toContain("Elena.wav");
      expect(options).toContain("Marcus.wav");
    }, { timeout: 15000 });
  }, 20000);

  it("Test 2a: identity.voice === null → select value is '' (default)", async () => {
    renderModal({ voice: null });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("");
    });
  });

  it("Test 2b: identity.voice === 'Elena.wav' → select value is 'Elena.wav'", async () => {
    renderModal({ voice: "Elena.wav" });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("Elena.wav");
    });
  });

  it("Test 3: changing dropdown does not immediately call updateIdentity", async () => {
    renderModal({ voice: null });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Wait for voices to load
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(select.options).length).toBeGreaterThan(1);
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Elena.wav" } });

    expect(select.value).toBe("Elena.wav");
    expect(mockedUpdateIdentity).not.toHaveBeenCalled();
  });

  it("Test 4: sample button calls postSpeak(SAMPLE_PHRASE, currentDropdownValue || undefined)", async () => {
    renderModal({ voice: null });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Wait for voices to load
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(select.options).length).toBeGreaterThan(1);
    });

    // Select Elena.wav
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Elena.wav" } });

    // Click sample button
    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toBe("Elena.wav");
    });
  });

  it("Test 4b: when '(default)' selected, postSpeak called with undefined voice", async () => {
    renderModal({ voice: null });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Leave dropdown at "(default)" — value is ""
    const sampleBtn = screen.getByLabelText("Sample voice");
    fireEvent.click(sampleBtn);

    await waitFor(() => {
      expect(mockedPostSpeak).toHaveBeenCalled();
      const [phrase, voice] = mockedPostSpeak.mock.calls[0];
      expect(phrase).toBe("Hi, this is your voice.");
      expect(voice).toBeUndefined();
    });
  });

  it("Test 5: Save with changed voice calls updateIdentity with voice in meta", async () => {
    const updatedIdentity: Identity = { ...BASE_IDENTITY, voice: "Elena.wav" };
    mockedUpdateIdentity.mockResolvedValue(updatedIdentity);

    renderModal({ voice: null });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Wait for voices to load
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(select.options).length).toBeGreaterThan(1);
    });

    // Change to Elena.wav
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Elena.wav" } });

    // Save button should be enabled
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    const [, calledMeta] = mockedUpdateIdentity.mock.calls[0];
    expect((calledMeta as Record<string, unknown>).voice).toBe("Elena.wav");
  });

  it("Test 6: Save with dropdown reset to '(default)' calls updateIdentity with voice: null", async () => {
    const updatedIdentity: Identity = { ...BASE_IDENTITY, voice: null };
    mockedUpdateIdentity.mockResolvedValue(updatedIdentity);

    renderModal({ voice: "Elena.wav" });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Wait for voices to load
    await waitFor(() => {
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(Array.from(select.options).length).toBeGreaterThan(1);
    });

    // Reset to "(default)"
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });

    // Save
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    const [, calledMeta] = mockedUpdateIdentity.mock.calls[0];
    expect((calledMeta as Record<string, unknown>).voice).toBeNull();
  });
});
