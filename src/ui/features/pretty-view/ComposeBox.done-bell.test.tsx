import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// In-process coverage for the done-bell (campaign notify-when-done, shape
// done-bell): while the agent works the main button is a bell; its menu sends
// the notify-me / call-me skill, offers Call me only with a phone number on
// file, and asks the browser's permission when nothing else reaches the user.

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));
vi.mock("@/api/skills-api", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  createSkill: vi.fn(),
  SkillAlreadyExistsError: class SkillAlreadyExistsError extends Error {},
}));

const getMyPhoneMock = vi.fn();
vi.mock("@/api/user-phone-api", () => ({ getMyPhone: () => getMyPhoneMock() }));
const getTelegramStatusMock = vi.fn();
vi.mock("@/features/notifications/telegram-setup-api", () => ({
  getTelegramStatus: () => getTelegramStatusMock(),
}));
let browserState: "unsupported" | "blocked" | "off" | "on" = "off";
const setBrowserEnabledMock = vi.fn(async (_on: boolean) => "on" as const);
vi.mock("@/features/notifications/browser-notifications", () => ({
  getBrowserNotificationsState: () => browserState,
  setBrowserNotificationsEnabled: (on: boolean) => setBrowserEnabledMock(on),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { _resetDoneBellReachForTests } from "./done-bell-reach";

let permission: NotificationPermission = "default";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    identityName: "garnet",
    canSend: true,
    agentWorking: true,
    ...overrides,
  };
}

/** Radix DropdownMenu opens on a primary-button pointerdown. */
function openMenu(button: HTMLElement): void {
  act(() => {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
}

async function settleReach(): Promise<void> {
  await waitFor(() => expect(getTelegramStatusMock).toHaveBeenCalled());
  await act(async () => {});
}

describe("ComposeBox — done-bell", () => {
  beforeEach(() => {
    _resetDoneBellReachForTests();
    localStorage.clear();
    getMyPhoneMock.mockReset().mockResolvedValue("+17165550100");
    getTelegramStatusMock.mockReset().mockResolvedValue({ linked: true });
    setBrowserEnabledMock.mockClear();
    browserState = "off";
    permission = "default";
    vi.stubGlobal("Notification", { get permission() { return permission; } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the main button while the agent works and nothing is typed", async () => {
    render(<ComposeBox {...baseProps()} />);
    expect(screen.getByTestId("done-bell-button")).toBeTruthy();
    expect(screen.queryByLabelText("Send 'thumbs up'")).toBeNull();
  });

  it("gives way to the thumbs-up when the agent isn't working", () => {
    render(<ComposeBox {...baseProps({ agentWorking: false })} />);
    expect(screen.queryByTestId("done-bell-button")).toBeNull();
    expect(screen.getByLabelText("Send 'thumbs up'")).toBeTruthy();
  });

  it("gives way to Send once something is typed", () => {
    render(<ComposeBox {...baseProps()} />);
    const textarea = screen.getByPlaceholderText("Write a message…");
    fireEvent.change(textarea, { target: { value: "one more thing" } });
    expect(screen.queryByTestId("done-bell-button")).toBeNull();
    expect(screen.getByLabelText("Send")).toBeTruthy();
  });

  it("never shows in a relay room", () => {
    render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    expect(screen.queryByTestId("done-bell-button")).toBeNull();
  });

  it("offers Notify me and Call me with the same hint, nothing highlighted", async () => {
    render(<ComposeBox {...baseProps()} />);
    await settleReach();
    openMenu(screen.getByTestId("done-bell-button"));
    const notify = await screen.findByTestId("done-bell-notify");
    const call = screen.getByTestId("done-bell-call");
    expect(notify.textContent).toContain("Notify me");
    expect(call.textContent).toContain("Call me");
    expect(notify.textContent).toContain("When it's done or needs you");
    expect(call.textContent).toContain("When it's done or needs you");
    expect(notify.hasAttribute("data-highlighted")).toBe(false);
    expect(call.hasAttribute("data-highlighted")).toBe(false);
  });

  it("leaves out Call me without a phone number on file", async () => {
    getMyPhoneMock.mockResolvedValue(null);
    render(<ComposeBox {...baseProps()} />);
    await settleReach();
    openMenu(screen.getByTestId("done-bell-button"));
    await screen.findByTestId("done-bell-notify");
    expect(screen.queryByTestId("done-bell-call")).toBeNull();
  });

  it("Notify me sends the notify-me skill and jumps to the bottom", async () => {
    const onSend = vi.fn(() => true);
    const onGoodToGo = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onGoodToGo })} />);
    await settleReach();
    openMenu(screen.getByTestId("done-bell-button"));
    fireEvent.click(await screen.findByTestId("done-bell-notify"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/notify-me");
    expect(onGoodToGo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("done-bell-menu")).toBeNull());
  });

  it("Call me sends the call-me skill", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    await settleReach();
    openMenu(screen.getByTestId("done-bell-button"));
    fireEvent.click(await screen.findByTestId("done-bell-call"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/call-me");
    expect(setBrowserEnabledMock).not.toHaveBeenCalled();
  });

  describe("the Allow prompt on Notify me", () => {
    async function pickNotify(onSend = vi.fn(() => true)) {
      render(<ComposeBox {...baseProps({ onSend })} />);
      await settleReach();
      openMenu(screen.getByTestId("done-bell-button"));
      fireEvent.click(await screen.findByTestId("done-bell-notify"));
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
      expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/notify-me");
    }

    it("asks when there's no Telegram and this browser hasn't been asked", async () => {
      getTelegramStatusMock.mockResolvedValue({ linked: false });
      await pickNotify();
      expect(setBrowserEnabledMock).toHaveBeenCalledWith(true);
    });

    it("doesn't ask when Telegram already reaches them", async () => {
      await pickNotify();
      expect(setBrowserEnabledMock).not.toHaveBeenCalled();
    });

    it("doesn't ask again once the browser has been answered", async () => {
      getTelegramStatusMock.mockResolvedValue({ linked: false });
      permission = "granted"; // answered before, then switched off in Preferences
      await pickNotify();
      expect(setBrowserEnabledMock).not.toHaveBeenCalled();
    });

    it("doesn't ask when notifications are blocked — and still sends", async () => {
      getTelegramStatusMock.mockResolvedValue({ linked: false });
      browserState = "blocked";
      permission = "denied";
      await pickNotify();
      expect(setBrowserEnabledMock).not.toHaveBeenCalled();
    });

    it("doesn't ask on a phone, where they aren't offered", async () => {
      getTelegramStatusMock.mockResolvedValue({ linked: false });
      browserState = "unsupported";
      await pickNotify();
      expect(setBrowserEnabledMock).not.toHaveBeenCalled();
    });

    it("doesn't ask on a guess when Telegram's status couldn't be read", async () => {
      getTelegramStatusMock.mockRejectedValue(new Error("down"));
      await pickNotify();
      expect(setBrowserEnabledMock).not.toHaveBeenCalled();
    });
  });
});
