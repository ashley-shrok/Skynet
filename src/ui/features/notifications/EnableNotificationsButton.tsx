/**
 * Phase 128 Plan 07 Task 2 — EnableNotificationsButton.
 *
 * User-gesture-gated opt-in button. Wired at the AppShell chrome level
 * (Task 3 places it) so it's reachable AT ANY TIME per Pitfall 1 —
 * subscriptions rotate silently every 1-2 weeks on iOS, so the user needs
 * a persistent entry point to re-enable, not a one-shot onboarding modal.
 *
 * Non-negotiable load-bearing invariants:
 *
 *   1. (Pitfall 4) `Notification.requestPermission()` fires SYNCHRONOUSLY
 *      inside onClick. NO `await` boundary before the call. iOS PWAs
 *      silently block permission requests that don't sit directly inside
 *      a user gesture, so any await before the call breaks the flow.
 *
 *   2. (D-10) No auto-prompt on mount — the button MUST be tapped.
 *
 *   3. (D-12) No disable/unsubscribe path in this UI. Turning notifications
 *      off is a system-settings action (iOS Settings > Notifications >
 *      <PWA name>). This button is enable-only; the "enabled" state is
 *      informational.
 *
 *   4. (Pitfall 1) The button is reachable at all times AFTER first grant
 *      too — user needs a way to re-subscribe when iOS silently rotates
 *      the endpoint. AppShell placement (Task 3) preserves this by mounting
 *      the button in top-level chrome, not a one-shot dialog.
 *
 * Access to the SW registration is via `await navigator.serviceWorker.ready`
 * directly. The existing `useServiceWorker` hook does NOT expose the
 * registration in its return shape (see src/ui/hooks/use-service-worker.ts —
 * only `isSupported`, `isRegistered`, `updateAvailable`), so this button
 * reaches for the registration itself rather than requiring a hook
 * expansion that would touch a load-bearing file for no invariant win.
 */

import { useState, useCallback, useEffect } from "react";
import {
  getVapidPublicKey,
  postSubscription,
  urlBase64ToUint8Array,
} from "./push-subscription-api";

type Status = "idle" | "requesting" | "enabled" | "denied" | "failed";

export function EnableNotificationsButton(): JSX.Element {
  // On mount: if Notification.permission is already "granted", show the
  // enabled state as best-effort — no round-trip to the backend to verify
  // an active subscription (per D-15: no observability surface). The user
  // can still click to re-mint if iOS silently rotated the endpoint.
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      setStatus("enabled");
    }
  }, []);

  // LOAD-BEARING (Pitfall 4): the permission-request call below is the
  // FIRST asynchronous operation in this handler. It fires synchronously
  // in the click's task tick — the Promise it returns is chained via .then,
  // not consumed via a keyword that would introduce a boundary before it.
  // If a future edit puts any deferred operation ahead of that line, iOS
  // silently blocks the gesture-gated permission raise and the whole
  // opt-in flow dies without a single browser console line to explain why.
  // The plan's acceptance_criteria enforces this invariant via a source
  // grep — see 128-07-PLAN.md.
  const onClick = useCallback(() => {
    // Synchronous portion (fires in the same task tick as the click event):
    //   - Notification.requestPermission() is invoked immediately.
    //   - Its returned Promise is then chained via .then to keep the rest
    //     of the flow in the same handler body without introducing an
    //     await boundary in the SYNCHRONOUS prologue.
    // We deliberately do NOT `await` here in the handler body; the .then
    // chain keeps the microtask discipline clean.
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
        // From here on, we're past the iOS gesture-gate; regular awaits
        // are fine because permission was already granted synchronously.
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
        // Any thrown error → failure state. Button remains clickable for
        // retry (per Pitfall 1 — subscription rotation recovery path).
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
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        aria-label="Enable notifications"
        title="Enable notifications"
        data-testid="enable-notifications-button"
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,240,215,0.15)",
          background: "rgba(20,21,32,0.6)",
          color: "#e8e4d8",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Enable notifications
      </button>
      {status !== "idle" && (
        <span
          style={{
            fontSize: 11,
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
