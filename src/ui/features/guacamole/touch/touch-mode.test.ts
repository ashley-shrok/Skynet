import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defaultTouchMode, getTouchMode, setTouchMode, TOUCH_MODE_STORAGE_KEY } from "./touch-mode";
import { phoneRemoteSize } from "../GuacamoleApp";

function screenOf(width: number, height: number) {
  vi.stubGlobal("screen", { width, height });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("touch mode", () => {
  it("phones start in trackpad mode, tablets in direct mode", () => {
    screenOf(390, 844);
    expect(defaultTouchMode()).toBe("trackpad");
    screenOf(844, 390); // held sideways: still a phone
    expect(defaultTouchMode()).toBe("trackpad");
    screenOf(820, 1180);
    expect(defaultTouchMode()).toBe("direct");
  });

  it("a choice is remembered on the device", () => {
    screenOf(390, 844);
    setTouchMode("direct");
    expect(localStorage.getItem(TOUCH_MODE_STORAGE_KEY)).toBe("direct");
    expect(getTouchMode()).toBe("direct");
  });
});

describe("a phone's remote screen", () => {
  it("is laptop-sized, shaped like the phone held sideways, the same either way up", () => {
    screenOf(390, 844);
    const upright = phoneRemoteSize();
    screenOf(844, 390);
    expect(phoneRemoteSize()).toEqual(upright);
    expect(upright.width).toBe(1280);
    expect(upright.height).toBe(592);
  });
});
