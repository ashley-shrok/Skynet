/**
 * Phase 128 Plan 07 Task 2 — EnableNotificationsButton tests.
 *
 * Four behavior cases:
 *   1. Grant path: Notification.requestPermission → "granted" → the full
 *      flow runs (getVapidPublicKey → pushManager.subscribe → POST /push-subscriptions),
 *      and the button state flips to "enabled".
 *   2. Deny path: requestPermission → "denied" → flow short-circuits;
 *      no subscription mint, no POST, denied hint rendered.
 *   3. Subscribe error path: pushManager.subscribe throws → button renders
 *      error state; the button remains clickable for retry.
 *   4. LOAD-BEARING (Pitfall 4): requestPermission is called SYNCHRONOUSLY
 *      inside the onClick handler — no `await` boundary before the call.
 *      This test asserts the invocation lands in the same microtask as the
 *      click event (spy called by the time click() returns) — the iOS PWA
 *      gesture-gate silently blocks a permission request placed after an
 *      await boundary.
 *
 * Global stubs (jsdom does not provide Notification or ServiceWorker):
 *   - global.Notification with static requestPermission + `permission` field
 *   - navigator.serviceWorker.ready → mock registration with pushManager
 *   - global.fetch → mocked per-test for GET vapid-public-key + POST subs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnableNotificationsButton } from "./EnableNotificationsButton";

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

describe("EnableNotificationsButton", () => {
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

    // Fetch: GET vapid-public-key + POST /push-subscriptions
    global.fetch = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ publicKey: "SGVsbG8" }), // base64url decodes clean
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ ok: true }),
      })) as unknown as typeof global.fetch;

    render(<EnableNotificationsButton />);
    const btn = screen.getByRole("button", { name: /enable notifications/i });
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

    render(<EnableNotificationsButton />);
    const btn = screen.getByRole("button", { name: /enable notifications/i });
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

    render(<EnableNotificationsButton />);
    const btn = screen.getByRole("button", { name: /enable notifications/i });
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/notifications setup failed/i)).toBeTruthy();
    });

    // Button remains clickable — same element still in the DOM as a button
    expect(btn.tagName).toBe("BUTTON");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("Case 4 (LOAD-BEARING Pitfall 4): Notification.requestPermission is called synchronously inside onClick — no await boundary before the call", async () => {
    // The spy fires BEFORE any awaited fetch happens. If a future edit
    // introduces an `await` before requestPermission, this test will still
    // pass at runtime (because our onClick eventually calls it), but a
    // source-level grep in acceptance_criteria catches that regression.
    // Here we assert the call fires immediately after click dispatches —
    // in the same microtask, before any other awaited work.
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

    render(<EnableNotificationsButton />);
    const btn = screen.getByRole("button", { name: /enable notifications/i });

    // Manually dispatch a click via low-level API so we can observe the call
    // count immediately after the synchronous portion of the handler runs.
    btn.click();
    // requestPermission MUST have been invoked by the time click() returns.
    // If the onClick handler had `await` before requestPermission, the
    // handler would return before the call, and the count would be 0 here.
    expect(notif.requestPermission).toHaveBeenCalledTimes(1);
  });
});
