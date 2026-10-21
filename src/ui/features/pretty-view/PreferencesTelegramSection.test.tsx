/**
 * PreferencesTelegramSection — the per-user flow: BotFather steps + token
 * save, Open my bot + wait-for-Start poll, then linked controls (title-only,
 * test, disconnect).
 */

vi.mock("@/features/notifications/telegram-setup-api", () => ({
  getTelegramStatus: vi.fn(),
  putTelegramBot: vi.fn(),
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
  putTelegramBot,
} from "@/features/notifications/telegram-setup-api";
import { PreferencesTelegramSection } from "./PreferencesTelegramSection";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";

const NOT_SET_UP = { setUp: false, linked: false };
const AWAITING_START = { setUp: true, botUsername: "ash_bot", linked: false, titleOnly: false };
const LINKED = { setUp: true, botUsername: "ash_bot", linked: true, telegramName: "@ash", titleOnly: false };

beforeEach(() => {
  for (const fn of [getTelegramStatus, putTelegramBot, postTelegramLink, postTelegramTest, patchTelegram, deleteTelegram]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(postTelegramLink).mockResolvedValue({ url: "https://t.me/ash_bot?start=abc" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetKitDialogsForTests();
});

describe("PreferencesTelegramSection", () => {
  it("not set up: shows the BotFather steps and saves a pasted token", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(NOT_SET_UP);
    vi.mocked(putTelegramBot).mockResolvedValue(AWAITING_START);
    render(<PreferencesTelegramSection />);

    const setup = await screen.findByTestId("preferences-telegram-setup");
    expect(setup.textContent).toContain("Set up your bot — about a minute");
    expect(setup.textContent).toContain("/newbot");
    expect(setup.textContent).toContain("checked with Telegram before it's saved");
    const botFather = screen.getByTestId("preferences-telegram-open-botfather");
    expect(botFather.getAttribute("href")).toBe("https://t.me/BotFather");
    expect(botFather.getAttribute("target")).toBe("_blank");

    const save = screen.getByTestId("preferences-telegram-token-save") as HTMLButtonElement;
    expect(save.textContent).toBe("Connect");
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("preferences-telegram-token-input"), {
      target: { value: "  123:ABC  " },
    });
    fireEvent.click(save);

    await waitFor(() => expect(putTelegramBot).toHaveBeenCalledWith("123:ABC"));
    const awaiting = await screen.findByTestId("preferences-telegram-awaiting-start");
    expect(awaiting.textContent).toContain("@ash_bot");
    expect(awaiting.textContent).toContain("is ready");
    expect(awaiting.textContent).toMatch(/then tap Start in Telegram/);
  });

  it("shows why a token was rejected", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(NOT_SET_UP);
    vi.mocked(putTelegramBot).mockRejectedValue(new Error("Telegram didn't accept that token."));
    render(<PreferencesTelegramSection />);
    fireEvent.change(await screen.findByTestId("preferences-telegram-token-input"), {
      target: { value: "123:bad" },
    });
    fireEvent.click(screen.getByTestId("preferences-telegram-token-save"));
    expect((await screen.findByTestId("preferences-telegram-token-error")).textContent).toMatch(/didn't accept/);
  });

  it("bot saved: Open my bot carries the one-time code, then polls until linked", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValueOnce(AWAITING_START);
    render(<PreferencesTelegramSection />);
    const open = await screen.findByTestId("preferences-telegram-open-bot");
    expect(open.getAttribute("href")).toBe("https://t.me/ash_bot?start=abc");
    expect(open.getAttribute("target")).toBe("_blank");

    vi.useFakeTimers();
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    fireEvent.click(open);
    expect(screen.getByTestId("preferences-telegram-waiting")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId("preferences-telegram-linked")).toBeTruthy();
  });

  it("Use a different bot asks first, then returns to setup", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(AWAITING_START);
    vi.mocked(deleteTelegram).mockResolvedValue(NOT_SET_UP);
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<PreferencesTelegramSection />);
    fireEvent.click(await screen.findByTestId("preferences-telegram-use-different-bot"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(await screen.findByTestId("preferences-telegram-setup")).toBeTruthy();
  });

  it("linked: shows the account, toggles title-only, sends a test", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(patchTelegram).mockResolvedValue({ ...LINKED, titleOnly: true });
    vi.mocked(postTelegramTest).mockResolvedValue({ ok: true });
    render(<PreferencesTelegramSection />);

    const linked = await screen.findByTestId("preferences-telegram-linked");
    expect(linked.textContent).toContain("Connected to @ash");
    expect(linked.textContent).toContain("From your bot @ash_bot");

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

  it("disconnect asks first, then returns to setup", async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue(LINKED);
    vi.mocked(deleteTelegram).mockResolvedValue(NOT_SET_UP);
    const answers = [false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? false });
    render(<PreferencesTelegramSection />);

    fireEvent.click(await screen.findByTestId("preferences-telegram-disconnect"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(deleteTelegram).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("preferences-telegram-disconnect"));
    expect(await screen.findByTestId("preferences-telegram-setup")).toBeTruthy();
    expect(dialogs.calls).toHaveLength(2);
  });
});
