// Patch #156: unit coverage for the isIosPwa() gate helper.
// Covers all four combinations of (navigator.standalone × iOS UA) plus the
// SSR guard. Every mutation to navigator/window is restored in afterEach so
// tests can't leak state to sibling suites in the same worker.

import { describe, it, expect, afterEach, vi } from "vitest";
import { isIosPwa } from "./is-ios-pwa";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function setStandalone(value: boolean | undefined): void {
  // Navigator.standalone is iOS-Safari-only — jsdom's Navigator does not
  // declare it, so we defineProperty with configurable:true for tear-down.
  Object.defineProperty(navigator, "standalone", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("isIosPwa", () => {
  // Snapshot original navigator surface so afterEach can restore fully.
  const originalUa = navigator.userAgent;

  afterEach(() => {
    setUserAgent(originalUa);
    // Remove the standalone property we may have added.
    delete (navigator as { standalone?: boolean }).standalone;
    vi.unstubAllGlobals();
  });

  it("returns true when navigator.standalone === true AND UA matches iOS", () => {
    setStandalone(true);
    setUserAgent(IPHONE_UA);
    expect(isIosPwa()).toBe(true);
  });

  it("returns false when standalone=true but UA is Chrome desktop", () => {
    setStandalone(true);
    setUserAgent(CHROME_DESKTOP_UA);
    expect(isIosPwa()).toBe(false);
  });

  it("returns false when standalone=false but UA is iPhone (iOS Safari, not PWA)", () => {
    setStandalone(false);
    setUserAgent(IPHONE_UA);
    expect(isIosPwa()).toBe(false);
  });

  it("returns false when standalone=false and UA is Chrome desktop", () => {
    setStandalone(false);
    setUserAgent(CHROME_DESKTOP_UA);
    expect(isIosPwa()).toBe(false);
  });

  it("returns false in SSR (window is undefined) without throwing", () => {
    // Simulate SSR by stubbing globalThis.window to undefined. The helper's
    // `typeof window === "undefined"` guard must catch this before touching
    // window.navigator (which would otherwise throw).
    vi.stubGlobal("window", undefined);
    expect(() => isIosPwa()).not.toThrow();
    expect(isIosPwa()).toBe(false);
  });
});
