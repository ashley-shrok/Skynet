/**
 * Phase 128 Plan 07 Task 1 — push-subscription-api.
 *
 * Thin fetch wrappers for the Wave 1 backend endpoints:
 *   - GET  /push-subscriptions/vapid-public-key  → { publicKey: string }
 *   - POST /push-subscriptions                   → 201 { ok: true }
 *
 * Plus the two base64url conversion helpers the browser subscription flow
 * needs at the JS<->Web-Push protocol boundary:
 *   - arrayBufferToBase64Url(buffer)  — mints the p256dh/auth wire values
 *     from `PushSubscription.getKey()` ArrayBuffers. Byte-mirrors the
 *     helper appended to public/sw.js in Plan 04 (RESEARCH.md § Pattern 3
 *     lines 482-488) so the two encoders always agree on wire format.
 *   - urlBase64ToUint8Array(base64url) — decodes the VAPID public key
 *     (base64url on the wire) into the Uint8Array pushManager.subscribe
 *     accepts as `applicationServerKey`. Canonical MDN Push API pattern.
 *
 * All fetch calls include `credentials: "include"` so the JWT cookie
 * travels — POST /push-subscriptions is JWT-gated; GET vapid-public-key
 * is not (public by design), but sending the cookie is harmless.
 *
 * NO axios import — plain browser fetch keeps the module UI-tier with
 * zero backend surface. Runs in jsdom for tests (both atob and btoa are
 * present).
 */

/**
 * Fetch the VAPID public key so the client can pass it to
 * pushManager.subscribe() as `applicationServerKey`.
 *
 * Public endpoint (no auth). Included credentials are harmless.
 */
export async function getVapidPublicKey(): Promise<string> {
  const response = await fetch("/push-subscriptions/vapid-public-key", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`vapid-public-key fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as { publicKey?: string };
  if (typeof body.publicKey !== "string" || body.publicKey.length === 0) {
    throw new Error("vapid-public-key response missing publicKey field");
  }
  return body.publicKey;
}

/**
 * Register the browser's PushSubscription against the authenticated user's
 * record on the backend. Fires POST /push-subscriptions with the endpoint +
 * p256dh + auth keys extracted from the subscription.
 *
 * On non-2xx response, throws with the status code — the button owns the
 * error-state rendering.
 */
export async function postSubscription(sub: PushSubscription): Promise<void> {
  const body = JSON.stringify({
    endpoint: sub.endpoint,
    keys: {
      p256dh: arrayBufferToBase64Url(sub.getKey("p256dh")),
      auth: arrayBufferToBase64Url(sub.getKey("auth")),
    },
  });
  const response = await fetch("/push-subscriptions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) {
    throw new Error(`subscription POST failed: ${response.status}`);
  }
}

/**
 * Encode an ArrayBuffer to base64url (no padding, `-` for `+`, `_` for `/`).
 * Returns "" on null input (mirrors PushSubscription.getKey() returning null
 * when a key is missing).
 *
 * Byte-mirror of the public/sw.js helper at lines 170-175 so the two
 * encoders (main thread + service worker) always produce identical wire
 * values for the same PushSubscription.
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (buffer === null) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode a base64url-encoded VAPID public key to the Uint8Array shape
 * pushManager.subscribe requires as `applicationServerKey`.
 *
 * Canonical MDN Push API reference implementation — pads to a length that
 * is a multiple of 4 (base64 required padding), swaps `-`→`+` and `_`→`/`
 * to convert base64url back to standard base64, then atob-decodes into a
 * Uint8Array of byte codepoints.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
