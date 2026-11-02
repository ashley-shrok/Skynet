/**
 * AdminSystemPane — Voice and Voice input sections: read-only main / backup
 * read-aloud and speech-to-text services, as the server reports them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { AdminSystemPane } from "./AdminSystemPane";

const m = vi.hoisted(() => ({ getTtsProviders: vi.fn() }));

vi.mock("@/api/voice-api", () => ({ getTtsProviders: m.getTtsProviders }));
vi.mock("@/api/settings-api", () => ({
  getLogLevel: vi.fn(async () => ({ level: "info" })),
  updateLogLevel: vi.fn(),
}));
vi.mock("@/api/system-status-api", () => ({
  getVersionInfo: vi.fn(async () => ({ localVersion: "2.3.2", status: "update_check_disabled" })),
  getAdminDbHealth: vi.fn(async () => ({ status: "ok" })),
}));

const STT_UNSET = {
  stt: { primary: { id: "bedrock", label: "Amazon Nova Sonic" }, backup: { id: null, label: null } },
};

beforeEach(() => {
  m.getTtsProviders.mockReset();
});

describe("AdminSystemPane — Voice", () => {
  it("shows the main and backup services, with no controls", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "openai", label: "OpenAI" },
      backup: { id: "elevenlabs", label: "ElevenLabs" },
      ...STT_UNSET,
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-primary").textContent).toBe("OpenAI"));
    expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("ElevenLabs");
    const section = screen.getByTestId("admin-system-voice");
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(within(section).queryAllByRole("combobox")).toHaveLength(0);
  });

  it("no backup configured → None", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "polly", label: "Amazon Polly" },
      backup: { id: null, label: null },
      ...STT_UNSET,
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("None"));
  });

  it("an ignored backup setting says why", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "openai", label: "OpenAI" },
      backup: { id: null, label: null, error: "Same as the main service — ignored" },
      ...STT_UNSET,
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("Not in use"));
    expect(screen.getByText("Same as the main service — ignored")).toBeTruthy();
  });

  it("load failure shows an error", async () => {
    m.getTtsProviders.mockRejectedValue(new Error("nope"));
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-error")).toBeTruthy());
    // Unknown, not "None": nothing claims the services are unset.
    expect(screen.getByTestId("admin-system-tts-primary").textContent).toBe("—");
    expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("—");
  });
});

describe("AdminSystemPane — Voice input", () => {
  it("shows the speech-to-text main and backup services, with no controls", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "polly", label: "Amazon Polly" },
      backup: { id: null, label: null },
      stt: { primary: { id: "elevenlabs", label: "ElevenLabs" }, backup: { id: "groq", label: "Groq" } },
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-stt-primary").textContent).toBe("ElevenLabs"));
    expect(screen.getByTestId("admin-system-stt-backup").textContent).toBe("Groq");
    const section = screen.getByTestId("admin-system-voice-input");
    expect(within(section).getByText("Voice input")).toBeTruthy();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(within(section).queryAllByRole("combobox")).toHaveLength(0);
  });

  it("no backup configured → None", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "polly", label: "Amazon Polly" },
      backup: { id: null, label: null },
      ...STT_UNSET,
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-stt-primary").textContent).toBe("Amazon Nova Sonic"));
    expect(screen.getByTestId("admin-system-stt-backup").textContent).toBe("None");
  });

  it("an ignored backup setting says why", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "polly", label: "Amazon Polly" },
      backup: { id: null, label: null },
      stt: {
        primary: { id: "elevenlabs", label: "ElevenLabs" },
        backup: { id: null, label: null, error: 'Unknown service "whisper" — ignored' },
      },
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-stt-backup").textContent).toBe("Not in use"));
    expect(screen.getByText('Unknown service "whisper" — ignored')).toBeTruthy();
  });

  it("load failure leaves both unknown", async () => {
    m.getTtsProviders.mockRejectedValue(new Error("nope"));
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-error")).toBeTruthy());
    expect(screen.getByTestId("admin-system-stt-primary").textContent).toBe("—");
    expect(screen.getByTestId("admin-system-stt-backup").textContent).toBe("—");
  });
});
