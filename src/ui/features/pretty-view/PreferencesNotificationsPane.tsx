/**
 * PreferencesNotificationsPane — folded-in notifications enable flow for the
 * Preferences modal's Notifications tab (Phase 137 D-18).
 *
 * Load-bearing invariants (preserved from the retired notification modal):
 *
 *   1. (Pitfall 4 / D-19) The permission-request fires synchronously inside the
 *      enable-button onClick — NO await boundary before the call. iOS PWAs
 *      silently block permission requests that don't sit directly inside a
 *      user gesture.
 *
 *   2. (D-10) No auto-prompt on pane open — the user MUST tap the button.
 *
 *   3. (D-12) No unsubscribe path — disabling notifications is a system-
 *      settings action (iOS/desktop OS settings > Notifications > <PWA>).
 *      This pane is enable-only.
 *
 *   4. (D-20) Feature-gated on pushNotificationsSupported(). When the browser
 *      can't subscribe (old Safari, in-app WebViews), an unsupported message
 *      is shown instead of the button.
 */

import { useCallback, useEffect, useState } from "react";
import { pushNotificationsSupported } from "@/features/notifications/push-support";
import {
  getVapidPublicKey,
  postSubscription,
  urlBase64ToUint8Array,
} from "@/features/notifications/push-subscription-api";

type Status = "idle" | "requesting" | "enabled" | "denied" | "failed";

export interface PreferencesNotificationsPaneProps {
  userId?: string;
}

export function PreferencesNotificationsPane(
  _props: PreferencesNotificationsPaneProps,
): JSX.Element {
  const supported = pushNotificationsSupported();

  if (!supported) {
    return (
      <div
        className="flex-1 p-6 text-[13px] text-[#c8c4b8]"
        data-testid="preferences-notifications-unsupported"
      >
        Push notifications aren&apos;t supported in this browser.
      </div>
    );
  }

  return <PreferencesNotificationsPaneInner />;
}

function PreferencesNotificationsPaneInner(): JSX.Element {
  const [status, setStatus] = useState<Status>("idle");

  // On mount: reflect "already granted" as the initial state so a user
  // opening the pane after a prior grant sees "Notifications enabled"
  // rather than the neutral idle button.
  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      setStatus("enabled");
    } else {
      setStatus("idle");
    }
  }, []);

  // Phase 137 D-19 — LOAD-BEARING invariant. (Pitfall 4): the
  // permission-request call below is the FIRST asynchronous operation in
  // this handler. It fires synchronously in the click's task tick — the
  // Promise it returns is chained via .then, not consumed via `await` that
  // would introduce a boundary before it.
  const onClick = useCallback(() => {
    if (typeof Notification === "undefined") {
      setStatus("failed");
      return;
    }
    setStatus("requesting");
    const permPromise = Notification.requestPermission();
    permPromise
      .then(async (perm) => {
        if (perm !== "granted") {
          setStatus("denied");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const vapidKey = await getVapidPublicKey();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        await postSubscription(sub);
        setStatus("enabled");
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[enable-notifications] setup failed", err);
        setStatus("failed");
      });
  }, []);

  const label = (() => {
    switch (status) {
      case "enabled":
        return "Notifications enabled";
      case "denied":
        return "Notifications not enabled";
      case "failed":
        return "Notifications setup failed — tap to retry";
      case "requesting":
        return "Enabling notifications…";
      case "idle":
      default:
        return "Enable notifications";
    }
  })();

  return (
    <div className="flex-1 p-6 flex flex-col gap-4">
      <p className="text-[13px] leading-[18px] text-[#c8c4b8]">
        Get push notifications on this device when new messages arrive.
        iOS re-mints the subscription silently every 1–2 weeks — reopen
        this dialog and tap the button again to re-enable if you stop
        receiving notifications.
      </p>

      <button
        type="button"
        onClick={onClick}
        aria-label="Enable notifications"
        title="Enable notifications"
        data-testid="enable-notifications-button"
        style={{
          padding: "10px 16px",
          borderRadius: 10,
          border: "1px solid rgba(255,240,215,0.18)",
          background: "rgba(20,21,32,0.6)",
          color: "#e8e4d8",
          fontSize: 14,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        Enable notifications
      </button>

      {status !== "idle" && (
        <span
          data-testid="enable-notifications-status"
          style={{
            fontSize: 12,
            color:
              status === "enabled"
                ? "#8fd39e"
                : status === "denied"
                  ? "#d3a58f"
                  : status === "failed"
                    ? "#d38f8f"
                    : "#c8c4b8",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
