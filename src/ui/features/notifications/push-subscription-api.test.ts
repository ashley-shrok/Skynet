/**
 * Phase 128 Plan 07 Task 1 — push-subscription-api tests.
 *
 * Six behavior cases covering:
 *   - getVapidPublicKey happy path (200 → publicKey field returned)
 *   - getVapidPublicKey non-2xx throws
 *   - postSubscription happy path (URL, method, headers, body, credentials)
 *   - postSubscription non-2xx throws
 *   - arrayBufferToBase64Url round-trip with a known input
 *   - urlBase64ToUint8Array round-trip with a known input
 *
 * The module uses global.fetch. Tests replace fetch with vi.fn() per case.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getVapidPublicKey,
  postSubscription,
  arrayBufferToBase64Url,
  urlBase64ToUint8Array,
} from "./push-subscription-api";

describe("push-subscription-api", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getVapidPublicKey", () => {
    it("returns publicKey on 200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ publicKey: "abc-vapid-public-key" }),
      }) as unknown as typeof global.fetch;

      const key = await getVapidPublicKey();
      expect(key).toBe("abc-vapid-public-key");

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/push-subscriptions/vapid-public-key");
      expect(init).toMatchObject({ credentials: "include" });
    });

    it("throws on non-2xx response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }) as unknown as typeof global.fetch;

      await expect(getVapidPublicKey()).rejects.toThrow(/500/);
    });
  });

  describe("postSubscription", () => {
    // Helper to build a fake PushSubscription with predictable keys.
    function makeFakeSubscription(): PushSubscription {
      const p256dhBytes = new Uint8Array([1, 2, 3, 4]).buffer;
      const authBytes = new Uint8Array([5, 6, 7, 8]).buffer;
      return {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        expirationTime: null,
        options: {} as PushSubscriptionOptions,
        getKey(name: PushEncryptionKeyName): ArrayBuffer | null {
          if (name === "p256dh") return p256dhBytes;
          if (name === "auth") return authBytes;
          return null;
        },
        toJSON() {
          return {} as PushSubscriptionJSON;
        },
        unsubscribe: async () => true,
      };
    }

    it("POSTs the subscription with correct URL, method, headers, body, credentials", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ ok: true }),
      }) as unknown as typeof global.fetch;

      const sub = makeFakeSubscription();
      await postSubscription(sub);

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/push-subscriptions");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
      const body = JSON.parse(init.body as string);
      expect(body.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
      expect(typeof body.keys.p256dh).toBe("string");
      expect(typeof body.keys.auth).toBe("string");
      // base64url has no padding, no + or /
      expect(body.keys.p256dh).not.toMatch(/[+/=]/);
      expect(body.keys.auth).not.toMatch(/[+/=]/);
    });

    it("throws on non-2xx response with status in message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      }) as unknown as typeof global.fetch;

      const sub = makeFakeSubscription();
      await expect(postSubscription(sub)).rejects.toThrow(/403/);
    });
  });

  describe("arrayBufferToBase64Url", () => {
    it("round-trips a known input to the expected base64url output", () => {
      // Bytes [72, 101, 108, 108, 111] = "Hello" → "SGVsbG8" (no padding, base64url)
      const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer;
      const encoded = arrayBufferToBase64Url(buf);
      expect(encoded).toBe("SGVsbG8");
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it("returns empty string on null input", () => {
      expect(arrayBufferToBase64Url(null)).toBe("");
    });

    it("replaces + and / with - and _ in base64url output", () => {
      // Bytes that produce '+' and '/' in standard base64:
      // [251, 255, 191] → standard "+/+/", base64url "+_-"... let's use bytes
      // that reliably produce - and _ substitutions.
      // Byte 0xFB = 251, 0xEF = 239 encode with + and / in b64.
      const buf = new Uint8Array([0xfb, 0xef, 0xff]).buffer;
      const encoded = arrayBufferToBase64Url(buf);
      // standard: "++//" or similar; base64url swap: no + or /
      expect(encoded).not.toMatch(/[+/=]/);
    });
  });

  describe("urlBase64ToUint8Array", () => {
    it("round-trips a base64url-encoded VAPID key to bytes matching the encoded input", () => {
      // Known: "SGVsbG8" decodes to bytes [72, 101, 108, 108, 111]
      const bytes = urlBase64ToUint8Array("SGVsbG8");
      expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
    });

    it("handles base64url with - and _ (VAPID-key shape)", () => {
      // A base64url string with - and _ (would-be + and / in standard base64).
      // Byte roundtrip via arrayBufferToBase64Url and back.
      const original = new Uint8Array([0xfb, 0xef, 0xff, 0x00, 0x01]);
      const encoded = arrayBufferToBase64Url(original.buffer);
      const decoded = urlBase64ToUint8Array(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });
  });
});
