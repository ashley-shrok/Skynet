/**
 * AdminSystemPane — Voice section: read-only main / backup read-aloud
 * services, as the server reports them.
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

beforeEach(() => {
  m.getTtsProviders.mockReset();
});

describe("AdminSystemPane — Voice", () => {
  it("shows the main and backup services, with no controls", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "openai", label: "OpenAI" },
      backup: { id: "elevenlabs", label: "ElevenLabs" },
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
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("None"));
  });

  it("an ignored backup setting says why", async () => {
    m.getTtsProviders.mockResolvedValue({
      primary: { id: "openai", label: "OpenAI" },
      backup: { id: null, label: null, error: "Same as the main service — ignored" },
    });
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-backup").textContent).toBe("Not in use"));
    expect(screen.getByText("Same as the main service — ignored")).toBeTruthy();
  });

  it("load failure shows an error", async () => {
    m.getTtsProviders.mockRejectedValue(new Error("nope"));
    render(<AdminSystemPane />);

    await waitFor(() => expect(screen.getByTestId("admin-system-tts-error")).toBeTruthy());
  });
});
