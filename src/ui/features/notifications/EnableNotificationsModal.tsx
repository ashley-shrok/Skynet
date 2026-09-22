/**
 * EnableNotificationsModal — modal-shell replacement for the retired
 * fixed-position EnableNotificationsButton.
 *
 * Opened from the PrettyConversationsPanel kebab menu ("Enable
 * notifications…"). The kebab entry is hidden when the browser lacks
 * Web Push support (see pushNotificationsSupported() below), so this
 * component may assume Notification / serviceWorker / PushManager are
 * present when it renders.
 *
 * Load-bearing invariants preserved from the retired button:
 *
 *   1. (Pitfall 4) Notification.requestPermission() fires SYNCHRONOUSLY
 *      inside the enable-button onClick. NO await boundary before the
 *      call. iOS PWAs silently block permission requests that don't sit
 *      directly inside a user gesture.
 *
 *   2. (D-10) No auto-prompt on modal open — the user MUST tap the
 *      button inside the modal.
 *
 *   3. (D-12) No unsubscribe path — disabling notifications is a system-
 *      settings action (iOS/desktop OS settings > Notifications > <PWA>).
 *      This modal is enable-only.
 *
 *   4. (Pitfall 1) The modal is reachable AT ANY TIME from the sidebar
 *      kebab, so the user can re-mint the subscription after iOS silently
 *      rotates the endpoint (~1-2 weeks).
 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { cn } from "@/lib/utils";
import {
  getVapidPublicKey,
  postSubscription,
  urlBase64ToUint8Array,
} from "./push-subscription-api";

type Status = "idle" | "requesting" | "enabled" | "denied" | "failed";

/**
 * Feature-detect Web Push support. Callers (kebab menu) use this to
 * hide the "Enable notifications…" entry on browsers that can't
 * subscribe (e.g. old Safari, in-app WebViews). Returns false in SSR
 * contexts because `window`/`navigator` are undefined there.
 */
export function pushNotificationsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export interface EnableNotificationsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnableNotificationsModal({
  open,
  onOpenChange,
}: EnableNotificationsModalProps): JSX.Element {
  const [status, setStatus] = useState<Status>("idle");

  // On open: reflect "already granted" as the initial state so a user
  // opening the modal after a prior grant sees "Notifications enabled"
  // rather than the neutral idle button.
  useEffect(() => {
    if (!open) return;
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      setStatus("enabled");
    } else {
      setStatus("idle");
    }
  }, [open]);

  // LOAD-BEARING (Pitfall 4): the permission-request call below is the
  // FIRST asynchronous operation in this handler. It fires synchronously
  // in the click's task tick — the Promise it returns is chained via .then,
  // not consumed via `await` that would introduce a boundary before it.
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Match NewConversationModal — X and Esc are the close paths.
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[480px] md:max-h-[360px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
          data-testid="enable-notifications-modal"
        >
          <DialogTitle className="sr-only">Enable notifications</DialogTitle>

          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <h2 className="text-[15px] font-semibold text-[#f0ebe0] flex-1">
              Notifications
            </h2>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
              >
                <X size={18} />
              </button>
            </DialogClose>
          </DialogHeader>

          <div className="flex-1 min-h-0 px-6 py-5 flex flex-col gap-4">
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
