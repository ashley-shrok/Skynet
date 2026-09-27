/**
 * PreferencesNotificationsPane tests — ported from the retiring
 * EnableNotificationsModal.test.tsx.
 *
 * Seven behavior cases:
 *   1. Renders unsupported message when pushNotificationsSupported returns false.
 *   2. Renders Enable button when supported.
 *   3. Renders "Enabled" status when Notification.permission is "granted" at mount.
 *   4. LOAD-BEARING (Pitfall 4 / D-19): requestPermission is called SYNCHRONOUSLY
 *      inside the enable-button onClick — no `await` boundary before the call.
 *      Regression gate for the iOS PWA gesture-gate invariant.
 *   5. Grant path: Notification.requestPermission → "granted" → full flow runs
 *      (getVapidPublicKey → pushManager.subscribe → POST /push-subscriptions),
 *      button state flips to "enabled".
 *   6. Deny path: requestPermission → "denied" → flow short-circuits; no subscribe,
 *      no POST, denied hint rendered.
 *   7. Failed subscribe (postSubscription rejects) → status "failed".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

// ─── Unsupported-browser describe block (uses module-level mock) ──────────────

// Module mock is hoisted to the top — this entire describe block runs with the
// push-support module mocked to return false.
vi.mock("@/features/notifications/push-support", () => ({
  pushNotificationsSupported: vi.fn(() => false),
}));

describe("PreferencesNotificationsPane (unsupported browser)", () => {
  it("Case 1 (unsupported): renders unsupported message when pushNotificationsSupported returns false", async () => {
    const { pushNotificationsSupported } = await import("@/features/notifications/push-support");
    vi.mocked(pushNotificationsSupported).mockReturnValue(false);

    // Dynamic import to pick up the mocked module
    const { PreferencesNotificationsPane } = await import("./PreferencesNotificationsPane");
    render(<PreferencesNotificationsPane />);

    const unsupported = screen.getByTestId("preferences-notifications-unsupported");
    expect(unsupported).toBeTruthy();
    expect(unsupported.textContent).toContain("Push notifications aren");
  });
});

// ─── Supported-browser describe block ────────────────────────────────────────

// Reset the mock for the remaining tests so they see pushNotificationsSupported() === true
vi.mock("@/features/notifications/push-support", () => ({
  pushNotificationsSupported: vi.fn(() => true),
}));

describe("PreferencesNotificationsPane", () => {
  let originalFetch: typeof global.fetch;
  let originalNotification: typeof global.Notification | undefined;
  let originalServiceWorker: PropertyDescriptor | undefined;
  let originalPushManager: PropertyDescriptor | undefined;
  let PreferencesNotificationsPane: typeof import("./PreferencesNotificationsPane").PreferencesNotificationsPane;

  beforeEach(async () => {
    originalFetch = global.fetch;
    originalNotification = (global as { Notification?: typeof Notification }).Notification;
    originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    originalPushManager = Object.getOwnPropertyDescriptor(window, "PushManager");

    // Ensure mock returns true for supported-browser tests
    const pushSupport = await import("@/features/notifications/push-support");
    vi.mocked(pushSupport.pushNotificationsSupported).mockReturnValue(true);

    // Install PushManager so the component sees supported=true
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      writable: true,
      value: function () {},
    });

    const mod = await import("./PreferencesNotificationsPane");
    PreferencesNotificationsPane = mod.PreferencesNotificationsPane;
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
    if (originalPushManager) {
      Object.defineProperty(window, "PushManager", originalPushManager);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).PushManager;
    }
    vi.restoreAllMocks();
  });

  it("Case 2 (supported): renders Enable button when push notifications are supported", () => {
    installNotificationMock("default");
    installServiceWorkerReadyMock(vi.fn());

    render(<PreferencesNotificationsPane />);
    expect(screen.getByTestId("enable-notifications-button")).toBeTruthy();
  });

  it("Case 3 (already granted): renders enabled status when Notification.permission is granted at mount", async () => {
    const notif = installNotificationMock("granted");
    // Set permission to "granted" so the useEffect fires
    (notif as unknown as { permission: string }).permission = "granted";
    installServiceWorkerReadyMock(vi.fn());

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByText(/notifications enabled/i)).toBeTruthy();
    });
  });

  // Phase 137 D-19 — this regression gate must never be relaxed.
  // iOS PWA silently blocks async-boundary permission requests.
  it("Case 4 (LOAD-BEARING D-19 — Pitfall 4): Notification.requestPermission is called synchronously inside onClick — no await boundary before the call", async () => {
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

    render(<PreferencesNotificationsPane />);
    const btn = screen.getByTestId("enable-notifications-button");

    btn.click();
    // requestPermission MUST have been invoked by the time click() returns.
    // If a future edit puts an `await` before the call, the count would be
    // 0 here because the handler would return before the call.
    expect(notif.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("Case 5 (granted path): mints subscription and POSTs it; renders enabled state", async () => {
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

    render(<PreferencesNotificationsPane />);
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

  it("Case 6 (denied path): short-circuits after requestPermission; no subscribe, no POST; renders denied hint", async () => {
    installNotificationMock("denied");
    const subscribe = vi.fn();
    installServiceWorkerReadyMock(subscribe);
    global.fetch = vi.fn() as unknown as typeof global.fetch;

    render(<PreferencesNotificationsPane />);
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

  it("Case 7 (postSubscription rejects): renders failure state; button remains clickable", async () => {
    installNotificationMock("granted");
    const subscribe = vi.fn().mockRejectedValue(new Error("subscribe denied by browser"));
    installServiceWorkerReadyMock(subscribe);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ publicKey: "SGVsbG8" }),
    }) as unknown as typeof global.fetch;

    render(<PreferencesNotificationsPane />);
    const btn = screen.getByTestId("enable-notifications-button");
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/notifications setup failed/i)).toBeTruthy();
    });

    expect(btn.tagName).toBe("BUTTON");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
