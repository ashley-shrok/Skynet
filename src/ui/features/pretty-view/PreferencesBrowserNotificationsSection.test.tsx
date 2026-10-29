/**
 * PreferencesBrowserNotificationsSection — off / on / blocked, and the test
 * send. The notifications module is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

let state: "unsupported" | "blocked" | "off" | "on" = "off";
const listeners = new Set<() => void>();
const setEnabled = vi.fn(async (on: boolean) => {
  state = on ? "on" : "off";
  for (const l of listeners) l();
  return state;
});
const showTest = vi.fn((_name: string) => true);
vi.mock("@/features/notifications/browser-notifications", () => ({
  getBrowserNotificationsState: () => state,
  subscribeBrowserNotificationsState: (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  setBrowserNotificationsEnabled: (on: boolean) => setEnabled(on),
  showTestNotification: (name: string) => showTest(name),
}));
vi.mock("@/branding/branding-store", () => ({ useBrandingConfig: () => ({ appName: "Acme" }) }));

import { PreferencesBrowserNotificationsSection } from "./PreferencesBrowserNotificationsSection";

beforeEach(() => {
  state = "off";
  listeners.clear();
  setEnabled.mockClear();
  showTest.mockClear();
});

describe("PreferencesBrowserNotificationsSection", () => {
  it("renders nothing where unsupported", () => {
    state = "unsupported";
    const { container } = render(<PreferencesBrowserNotificationsSection />);
    expect(container.innerHTML).toBe("");
  });

  it("is off with the open-tab note in the instance's own name, and no test button", () => {
    render(<PreferencesBrowserNotificationsSection />);
    expect(screen.getByTestId("preferences-browser-notifications-switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Works while a tab of Acme is open in this browser.")).toBeTruthy();
    expect(screen.queryByTestId("preferences-browser-notifications-test")).toBeNull();
  });

  it("turning it on asks to enable, then offers a test send under the instance's name", async () => {
    render(<PreferencesBrowserNotificationsSection />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("preferences-browser-notifications-switch"));
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("preferences-browser-notifications-test"));
    expect(showTest).toHaveBeenCalledWith("Acme");
    expect(screen.getByTestId("preferences-browser-notifications-test-result")).toBeTruthy();
  });

  it("says plainly when the browser blocks it, with the switch off and disabled", () => {
    state = "blocked";
    render(<PreferencesBrowserNotificationsSection />);
    const sw = screen.getByTestId("preferences-browser-notifications-switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("preferences-browser-notifications-blocked").textContent).toMatch(/blocking notifications/);
  });

  it("never says Skynet", () => {
    for (const s of ["off", "on", "blocked"] as const) {
      state = s;
      const { container, unmount } = render(<PreferencesBrowserNotificationsSection />);
      expect(container.textContent).not.toMatch(/skynet/i);
      unmount();
    }
  });
});
