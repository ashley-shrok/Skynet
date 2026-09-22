/**
 * EnableNotificationsModal tests — ported from the retired
 * EnableNotificationsButton.test.tsx.
 *
 * Four behavior cases:
 *   1. Grant path: Notification.requestPermission → "granted" → full flow
 *      runs (getVapidPublicKey → pushManager.subscribe → POST
 *      /push-subscriptions), button state flips to "enabled".
 *   2. Deny path: requestPermission → "denied" → flow short-circuits;
 *      no subscription mint, no POST, denied hint rendered.
 *   3. Subscribe error path: pushManager.subscribe throws → error state
 *      rendered; button remains clickable for retry.
 *   4. LOAD-BEARING (Pitfall 4): requestPermission is called SYNCHRONOUSLY
 *      inside the enable-button onClick — no `await` boundary before the
 *      call. Regression gate for the iOS PWA gesture-gate invariant.
 *
 * Plus one feature-detect test for pushNotificationsSupported().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EnableNotificationsModal,
  pushNotificationsSupported,
} from "./EnableNotificationsModal";

// ─── Global stubs ────────────────────────────────────────────────────────────

type PermissionResult = "granted" | "denied" | "default";

interface NotificationMock {
  permission: PermissionResult;
  requestPermission: ReturnType<typeof vi.fn>;
}

function installNotificationMock(perm: PermissionResult): NotificationMock {
  const requestPermission = vi.fn().mockResolvedValue(perm);
  const NotificationCtor = function () {} as unknown as NotificationMock & (new () => Notification);
  (NotificationCtor as unknown as NotificationMock).permission = "default";
  (NotificationCtor as unknown as NotificationMock).requestPermission = requestPermission;
  Object.defineProperty(global, "Notification", {
    configurable: true,
    writable: true,
    value: NotificationCtor,
  });
  return NotificationCtor as unknown as NotificationMock;
}

function installServiceWorkerReadyMock(subscribe: ReturnType<typeof vi.fn>) {
  const registration = {
    pushManager: { subscribe },
  } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: {
      ready: Promise.resolve(registration),
      register: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: null,
    },
  });
  return registration;
}

function makeFakeSubscription(): PushSubscription {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
    expirationTime: null,
    options: {} as PushSubscriptionOptions,
    getKey(name: PushEncryptionKeyName): ArrayBuffer | null {
      if (name === "p256dh") return new Uint8Array([1, 2, 3]).buffer;
      if (name === "auth") return new Uint8Array([4, 5, 6]).buffer;
      return null;
    },
    toJSON() {
      return {} as PushSubscriptionJSON;
    },
    unsubscribe: async () => true,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EnableNotificationsModal", () => {
  let originalFetch: typeof global.fetch;
  let originalNotification: typeof global.Notification | undefined;
  let originalServiceWorker: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalNotification = (global as { Notification?: typeof Notification }).Notification;
    originalServiceWorker = Object.getOwnPropertyDescriptor(
      navigator,
      "serviceWorker",
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalNotification) {
      Object.defineProperty(global, "Notification", {
        configurable: true,
        writable: true,
        value: originalNotification,
      });
    } else {
      delete (global as { Notification?: typeof Notification }).Notification;
    }
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    }
    vi.restoreAllMocks();
  });

  it("Case 1 (granted): mints subscription and POSTs it; renders enabled state", async () => {
    installNotificationMock("granted");
    const subscribe = vi.fn().mockResolvedValue(makeFakeSubscription());
    installServiceWorkerReadyMock(subscribe);

    global.fetch = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ publicKey: "SGVsbG8" }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ ok: true }),
      })) as unknown as typeof global.fetch;

    render(<EnableNotificationsModal open={true} onOpenChange={() => {}} />);
    const btn = screen.getByTestId("enable-notifications-button");
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/notifications enabled/i)).toBeTruthy();
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    const [subOpts] = subscribe.mock.calls[0];
    expect(subOpts.userVisibleOnly).toBe(true);
    expect(subOpts.applicationServerKey).toBeInstanceOf(Uint8Array);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/push-subscriptions/vapid-public-key");
    expect(fetchMock.mock.calls[1][0]).toBe("/push-subscriptions");
  });

  it("Case 2 (denied): short-circuits after requestPermission; no subscribe, no POST; renders denied hint", async () => {
    installNotificationMock("denied");
    const subscribe = vi.fn();
    installServiceWorkerReadyMock(subscribe);
    global.fetch = vi.fn() as unknown as typeof global.fetch;

    render(<EnableNotificationsModal open={true} onOpenChange={() => {}} />);
    const btn = screen.getByTestId("enable-notifications-button");
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/not enabled/i)).toBeTruthy();
    });

    expect(subscribe).not.toHaveBeenCalled();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Case 3 (subscribe throws): renders failure state; button remains clickable", async () => {
    installNotificationMock("granted");
    const subscribe = vi.fn().mockRejectedValue(new Error("subscribe denied by browser"));
    installServiceWorkerReadyMock(subscribe);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ publicKey: "SGVsbG8" }),
    }) as unknown as typeof global.fetch;

    render(<EnableNotificationsModal open={true} onOpenChange={() => {}} />);
    const btn = screen.getByTestId("enable-notifications-button");
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/notifications setup failed/i)).toBeTruthy();
    });

    expect(btn.tagName).toBe("BUTTON");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("Case 4 (LOAD-BEARING Pitfall 4): Notification.requestPermission is called synchronously inside onClick — no await boundary before the call", async () => {
    const notif = installNotificationMock("granted");
    const subscribe = vi.fn().mockResolvedValue(makeFakeSubscription());
    installServiceWorkerReadyMock(subscribe);
    global.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ publicKey: "SGVsbG8" }),
      }) as unknown as typeof global.fetch;

    render(<EnableNotificationsModal open={true} onOpenChange={() => {}} />);
    const btn = screen.getByTestId("enable-notifications-button");

    btn.click();
    // requestPermission MUST have been invoked by the time click() returns.
    // If a future edit puts an `await` before the call, the count would be
    // 0 here because the handler would return before the call.
    expect(notif.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not render the modal content when open=false", () => {
    render(<EnableNotificationsModal open={false} onOpenChange={() => {}} />);
    expect(screen.queryByTestId("enable-notifications-button")).toBeNull();
  });
});

describe("pushNotificationsSupported", () => {
  let originalNotification: typeof global.Notification | undefined;
  let originalServiceWorker: PropertyDescriptor | undefined;
  let originalPushManager: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNotification = (global as { Notification?: typeof Notification }).Notification;
    originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    originalPushManager = Object.getOwnPropertyDescriptor(window, "PushManager");
  });

  afterEach(() => {
    if (originalNotification) {
      Object.defineProperty(global, "Notification", {
        configurable: true,
        writable: true,
        value: originalNotification,
      });
    } else {
      delete (global as { Notification?: typeof Notification }).Notification;
    }
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).serviceWorker;
    }
    if (originalPushManager) {
      Object.defineProperty(window, "PushManager", originalPushManager);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).PushManager;
    }
  });

  it("returns true when Notification + serviceWorker + PushManager are all present", () => {
    installNotificationMock("default");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: { ready: Promise.resolve({}), register: vi.fn() },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      writable: true,
      value: function () {},
    });

    expect(pushNotificationsSupported()).toBe(true);
  });

  it("returns false when PushManager is missing", () => {
    installNotificationMock("default");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: { ready: Promise.resolve({}), register: vi.fn() },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).PushManager;

    expect(pushNotificationsSupported()).toBe(false);
  });

  it("returns false when Notification is missing", () => {
    delete (global as { Notification?: typeof Notification }).Notification;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: { ready: Promise.resolve({}), register: vi.fn() },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      writable: true,
      value: function () {},
    });

    expect(pushNotificationsSupported()).toBe(false);
  });
});
