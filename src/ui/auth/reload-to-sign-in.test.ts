import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadToSignIn } from "./reload-to-sign-in";

describe("reloadToSignIn", () => {
  const replace = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    replace.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/", search: "?tab=abc", replace },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    window.sessionStorage.clear();
  });

  it("loads the app fresh at the bare path, dropping the old query string", () => {
    reloadToSignIn("logout");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("clears per-session UI state so the next account starts clean", () => {
    window.sessionStorage.setItem("pv-conv-active-set", JSON.stringify(["1:alice"]));
    window.sessionStorage.setItem("skynet_pending_tab", "tab=abc");
    reloadToSignIn("logout");
    expect(window.sessionStorage.length).toBe(0);
  });
});
