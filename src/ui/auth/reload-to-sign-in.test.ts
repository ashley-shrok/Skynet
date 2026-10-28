import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSignOutBroadcast,
  reloadToSignIn,
  SIGN_OUT_BROADCAST_KEY,
} from "./reload-to-sign-in";

describe("reloadToSignIn", () => {
  const replace = vi.fn();
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    replace.mockReset();
    reload.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/", search: "?tab=abc", hash: "#tab=x", replace, reload },
    });
    window.sessionStorage.setItem("pv-conv-active-set", JSON.stringify(["1:alice"]));
    window.sessionStorage.setItem("skynet_pending_tab", "tab=abc");
    window.sessionStorage.setItem("skynet:reload-loop", "[]");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("logout loads the app fresh at the bare path, dropping the old layout", () => {
    reloadToSignIn("logout");
    expect(replace).toHaveBeenCalledWith("/");
    expect(reload).not.toHaveBeenCalled();
  });

  it("logout clears only the open-conversation set and pending tab", () => {
    reloadToSignIn("logout");
    expect(window.sessionStorage.getItem("pv-conv-active-set")).toBeNull();
    expect(window.sessionStorage.getItem("skynet_pending_tab")).toBeNull();
    expect(window.sessionStorage.getItem("skynet:reload-loop")).toBe("[]");
  });

  it("session expiry reloads in place, keeping the layout and open conversations", () => {
    reloadToSignIn("session-expired");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("pv-conv-active-set")).not.toBeNull();
  });

  it("broadcasts the sign-out to other tabs unless told not to", () => {
    reloadToSignIn("logout");
    const raw = window.localStorage.getItem(SIGN_OUT_BROADCAST_KEY);
    expect(JSON.parse(raw!).reason).toBe("logout");

    window.localStorage.clear();
    reloadToSignIn("session-expired", { broadcast: false });
    expect(window.localStorage.getItem(SIGN_OUT_BROADCAST_KEY)).toBeNull();
  });
});

describe("readSignOutBroadcast", () => {
  const ev = (key: string | null, newValue: string | null) =>
    new StorageEvent("storage", { key, newValue });

  it("reads the reason from a broadcast", () => {
    expect(readSignOutBroadcast(ev(SIGN_OUT_BROADCAST_KEY, JSON.stringify({ reason: "logout", at: 1 })))).toBe("logout");
    expect(readSignOutBroadcast(ev(SIGN_OUT_BROADCAST_KEY, JSON.stringify({ reason: "session-expired", at: 1 })))).toBe("session-expired");
  });

  it("ignores other keys, removals and malformed values", () => {
    expect(readSignOutBroadcast(ev("skynet_auth", null))).toBeNull();
    expect(readSignOutBroadcast(ev(SIGN_OUT_BROADCAST_KEY, null))).toBeNull();
    expect(readSignOutBroadcast(ev(SIGN_OUT_BROADCAST_KEY, "{not json"))).toBeNull();
    expect(readSignOutBroadcast(ev(SIGN_OUT_BROADCAST_KEY, JSON.stringify({ reason: "other" })))).toBeNull();
  });
});
