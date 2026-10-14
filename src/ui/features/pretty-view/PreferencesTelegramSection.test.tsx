/**
 * PreferencesTelegramSection — unavailable / connect / linked states, the
 * wait-for-Start poll, title-only toggle, test, and disconnect.
 */

vi.mock("@/features/notifications/telegram-setup-api", () => ({
  getTelegramStatus: vi.fn(),
  postTelegramLink: vi.fn(),
  postTelegramTest: vi.fn(),
  patchTelegram: vi.fn(),
  deleteTelegram: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import {
  deleteTelegram,
  getTelegramStatus,
  patchTelegram,
  postTelegramLink,
  postTelegramTest,
} from "@/features/notifications/telegram-setup-api";
import { PreferencesTelegramSection } from "./PreferencesTelegramSection";

const LINKED = { available: true, botUsername: "sky_bot", linked: true, telegramName: "@ash", titleOnly: false };
const NOT_LINKED = { available: true, botUsername: "sky_bot", linked: false };

beforeEach(() => {
  vi.mocked(getTelegramStatus).mockReset();
  vi.mocked(postTelegramLink).mockReset();
  vi.mocked(postTelegramTest).mockReset();
  vi.mocked(patchTelegram).mockReset();
  vi.mocked(deleteTelegram).mockReset();
  vi.mocked(postTelegramLink).mockResolvedValue({ url: "https://t.me/sky_bot?start=abc" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PreferencesTelegramSection", () => {
  it("says so when the server has no bot", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue({ available: false, linked: false });
    render(<PreferencesTelegramSection />);
    expect(await screen.findByTestId("preferences-telegram-unavailable")).toBeTruthy();
    expect(postTelegramLink).not.toHaveBeenCalled();
  });

  it("shows a Connect link carrying the one-time code", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(NOT_LINKED);
    render(<PreferencesTelegramSection />);
    const link = await screen.findByTestId("preferences-telegram-connect");
    expect(link.getAttribute("href")).toBe("https://t.me/sky_bot?start=abc");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("after Connect, polls until the link lands", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValueOnce(NOT_LINKED);
    render(<PreferencesTelegramSection />);
    const link = await screen.findByTestId("preferences-telegram-connect");

    vi.useFakeTimers();
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    fireEvent.click(link);
    expect(screen.getByTestId("preferences-telegram-waiting")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId("preferences-telegram-linked")).toBeTruthy();
    expect(screen.queryByTestId("preferences-telegram-waiting")).toBeNull();
  });

  it("linked: shows the account, toggles title-only, sends a test", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(patchTelegram).mockResolvedValue({ ...LINKED, titleOnly: true });
    vi.mocked(postTelegramTest).mockResolvedValue({ ok: true });
    render(<PreferencesTelegramSection />);

    expect((await screen.findByTestId("preferences-telegram-linked")).textContent).toContain("@ash");

    const toggle = screen.getByTestId("preferences-telegram-title-only") as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(patchTelegram).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle.checked).toBe(true));

    fireEvent.click(screen.getByTestId("preferences-telegram-test"));
    expect((await screen.findByTestId("preferences-telegram-test-result")).textContent).toMatch(/Test sent/);
  });

  it("surfaces a failed test", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(postTelegramTest).mockResolvedValue({ ok: false, error: "Telegram error: boom" });
    render(<PreferencesTelegramSection />);
    fireEvent.click(await screen.findByTestId("preferences-telegram-test"));
    expect((await screen.findByTestId("preferences-telegram-test-result")).textContent).toMatch(/boom/);
  });

  it("disconnect asks first, then returns to the Connect state", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(deleteTelegram).mockResolvedValue(NOT_LINKED);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<PreferencesTelegramSection />);

    fireEvent.click(await screen.findByTestId("preferences-telegram-disconnect"));
    expect(deleteTelegram).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("preferences-telegram-disconnect"));
    expect(await screen.findByTestId("preferences-telegram-connect")).toBeTruthy();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
