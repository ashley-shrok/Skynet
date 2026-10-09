import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordAvatarVersion,
  getAvatarVersion,
  forgetAvatarVersion,
  _clearAvatarVersionsForTest,
} from "./avatar-version-registry.js";

describe("avatar-version-registry", () => {
  beforeEach(() => _clearAvatarVersionsForTest());
  afterEach(() => vi.useRealTimers());

  it("records and returns the latest version per (host, identity)", () => {
    recordAvatarVersion(7, "aqua", "v1");
    recordAvatarVersion(7, "aqua", "v2");
    recordAvatarVersion(6, "aqua", "x");
    expect(getAvatarVersion(7, "aqua")).toBe("v2");
    expect(getAvatarVersion(6, "aqua")).toBe("x");
    expect(getAvatarVersion(7, "other")).toBeNull();
  });

  it("ignores null / empty versions", () => {
    recordAvatarVersion(7, "aqua", "v1");
    recordAvatarVersion(7, "aqua", null);
    recordAvatarVersion(7, "aqua", "");
    expect(getAvatarVersion(7, "aqua")).toBe("v1");
  });

  it("after forget, a late sweep can't restore the superseded version, but a new one lands", () => {
    vi.useFakeTimers();
    recordAvatarVersion(7, "aqua", "v1");
    forgetAvatarVersion(7, "aqua");
    recordAvatarVersion(7, "aqua", "v1"); // sweep that stat'd before the write
    expect(getAvatarVersion(7, "aqua")).toBeNull();
    recordAvatarVersion(7, "aqua", "v2");
    expect(getAvatarVersion(7, "aqua")).toBe("v2");
  });

  it("the block on the superseded version expires", () => {
    vi.useFakeTimers();
    recordAvatarVersion(7, "aqua", "v1");
    forgetAvatarVersion(7, "aqua");
    vi.advanceTimersByTime(61_000);
    recordAvatarVersion(7, "aqua", "v1");
    expect(getAvatarVersion(7, "aqua")).toBe("v1");
  });
});
