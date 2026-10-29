/**
 * browser-notifications — the per-browser setting, permission handling, the
 * one-tab rule, the looking-at-it skip, and click-to-open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let touch = false;
vi.mock("@/hooks/use-is-touch-device", () => ({ isTouchDeviceNow: () => touch }));

import {
  LOOKING_WAIT_MS,
  _resetBrowserNotificationsForTests,
  getBrowserNotificationsState,
  handleAgentNotified,
  setBrowserNotificationsEnabled,
  setLookingAtConversations,
  showTestNotification,
  startBrowserNotifications,
  subscribeOpenConversationRequests,
} from "./browser-notifications";

type Shown = { title: string; options: NotificationOptions; onclick: (() => void) | null; close: ReturnType<typeof vi.fn> };
let shown: Shown[] = [];
let permission: NotificationPermission = "default";
let requestResult: NotificationPermission = "granted";

class FakeNotification {
  static get permission(): NotificationPermission {
    return permission;
  }
  static requestPermission = vi.fn(async () => {
    permission = requestResult;
    return permission;
  });
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options: NotificationOptions) {
    shown.push(this as unknown as Shown);
    (this as unknown as Shown).title = title;
    (this as unknown as Shown).options = options;
  }
}

/** A BroadcastChannel shared by every "tab" in the test, like a real browser. */
const channels = new Set<FakeChannel>();
class FakeChannel {
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    channels.add(this);
  }
  postMessage(data: unknown) {
    for (const c of channels) if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
  }
  close() {
    channels.delete(this);
  }
}

const N = {
  notificationId: "$ev1",
  hostId: "7",
  identityName: "aspen",
  agentMxid: "@aspen:t1000.example",
  title: "Aspen",
  body: "Deploy is live.",
};

function setNoLocks() {
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetBrowserNotificationsForTests();
  shown = [];
  permission = "default";
  requestResult = "granted";
  touch = false;
  localStorage.clear();
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  setNoLocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  channels.clear();
});

async function turnOn() {
  await setBrowserNotificationsEnabled(true);
  startBrowserNotifications();
}

describe("the setting", () => {
  it("is off until turned on, and turning it on asks the browser", async () => {
    expect(getBrowserNotificationsState()).toBe("off");
    expect(await setBrowserNotificationsEnabled(true)).toBe("on");
    expect(FakeNotification.requestPermission).toHaveBeenCalled();
    expect(localStorage.getItem("browser-notifications-enabled")).toBe("1");
  });

  it("stays off when the user says no at the prompt — and then reads as blocked", async () => {
    requestResult = "denied";
    expect(await setBrowserNotificationsEnabled(true)).toBe("blocked");
    expect(localStorage.getItem("browser-notifications-enabled")).toBeNull();
  });

  it("never reads as on while the browser blocks it, even if it was switched on", async () => {
    await setBrowserNotificationsEnabled(true);
    permission = "denied";
    expect(getBrowserNotificationsState()).toBe("blocked");
  });

  it("is unsupported on a touch device", () => {
    touch = true;
    expect(getBrowserNotificationsState()).toBe("unsupported");
  });

  it("turns off", async () => {
    await setBrowserNotificationsEnabled(true);
    expect(await setBrowserNotificationsEnabled(false)).toBe("off");
  });
});

describe("showing a notification", () => {
  it("shows the agent's name and message after the short wait", async () => {
    await turnOn();
    handleAgentNotified(N);
    expect(shown).toHaveLength(0);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Aspen");
    expect(shown[0].options).toMatchObject({ body: "Deploy is live.", tag: "$ev1" });
  });

  it("shows nothing while switched off", () => {
    permission = "granted";
    startBrowserNotifications();
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(0);
  });

  it("shows the same notification only once", async () => {
    await turnOn();
    handleAgentNotified(N);
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(1);
  });

  it("stays quiet when this tab is focused on that conversation", async () => {
    await turnOn();
    setLookingAtConversations([{ hostId: "7", identityName: "aspen" }]);
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(0);
  });

  it("still fires when the conversation is on screen but the window isn't focused", async () => {
    await turnOn();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    setLookingAtConversations([{ hostId: "7", identityName: "aspen" }]);
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(1);
  });

  it("still fires for a different conversation than the one on screen", async () => {
    await turnOn();
    setLookingAtConversations([{ hostId: "7", identityName: "birch" }]);
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(1);
  });

  it("stays quiet when another tab says it's looking at that conversation", async () => {
    await turnOn();
    const otherTab = new FakeChannel("agent-notifications");
    handleAgentNotified(N);
    otherTab.postMessage({ kind: "looking", notificationId: "$ev1" });
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(0);
  });

  it("only the tab holding the lock shows it", async () => {
    let grant: (() => void) | null = null;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn((_name: string, cb: () => Promise<void>) => {
          grant = () => void cb();
          return new Promise(() => {});
        }),
      },
    });
    await turnOn();
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(0); // not the chosen tab yet
    grant!();
    handleAgentNotified({ ...N, notificationId: "$ev2" });
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    expect(shown).toHaveLength(1);
  });

  it("clicking opens the conversation and closes the notification", async () => {
    await turnOn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const opened: unknown[] = [];
    subscribeOpenConversationRequests((r) => opened.push(r));
    handleAgentNotified(N);
    vi.advanceTimersByTime(LOOKING_WAIT_MS);
    shown[0].onclick!();
    expect(focus).toHaveBeenCalled();
    expect(opened).toEqual([{ mxid: "@aspen:t1000.example", hostId: 7 }]);
    expect(shown[0].close).toHaveBeenCalled();
  });
});

describe("test notification", () => {
  it("shows one under the instance's own name when on", async () => {
    await turnOn();
    expect(showTestNotification("Aither")).toBe(true);
    expect(shown[0].title).toBe("Aither");
  });

  it("does nothing when off", () => {
    expect(showTestNotification("Aither")).toBe(false);
    expect(shown).toHaveLength(0);
  });
});
