/**
 * WakeupsTab — the agent window's Wake-ups list.
 *
 * The tab is a list only: one row per wake-up (kind tile, name, schedule +
 * last fire or a sensor summary, an on/off switch that saves at once), a
 * "New wake-up" button, and the empty / coordinator-empty states. Editing,
 * creating and deleting happen one level deeper in WakeupView (see
 * WakeupView.test.tsx); here we only assert the list hands the right slug to
 * onToggle / onOpen and calls onNew.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { Wakeup } from "@/api/claude-session-api";
import { WakeupsTab, WAKEUPS_NOTE } from "./WakeupsTab";

const NOW = Math.floor(Date.now() / 1000);

const BASE_WAKEUP: Wakeup = {
  slug: "daily-box-check",
  name: "daily-box-check",
  enabled: true,
  schedule: { type: "daily", at: "09:00", timezone: "America/New_York" },
  scheduleHuman: "daily @ 09:00 America/New_York",
  instruction: "Check the box.",
};

const SENSOR_WAKEUP: Wakeup = {
  slug: "watcher",
  name: "watcher",
  enabled: true,
  schedule: { type: "sensor" },
  scheduleHuman: "Sensor",
  instruction: "x",
  lastFiredAt: NOW - 2 * 3600,
  sensor: {
    state: "healthy",
    run: "cadence",
    cadenceHuman: "Every 5m",
    lastRanAt: NOW - 60,
    waitingFires: 2,
    error: null,
  },
};

function renderTab(
  data: Wakeup[] = [BASE_WAKEUP],
  opts: { isCoordinator?: boolean; onToggle?: (slug: string, enabled: boolean) => Promise<void> } = {},
) {
  const onToggle = vi.fn(opts.onToggle ?? (() => Promise.resolve()));
  const onOpen = vi.fn();
  const onNew = vi.fn();
  render(
    <WakeupsTab
      state={{ status: "ready", data }}
      isCoordinator={opts.isCoordinator ?? false}
      onToggle={onToggle}
      onOpen={onOpen}
      onNew={onNew}
    />,
  );
  return { onToggle, onOpen, onNew };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WakeupsTab — list", () => {
  it("renders the note and one row per wake-up with name, schedule and last fire", () => {
    renderTab([
      { ...BASE_WAKEUP, lastFiredAt: NOW - 3 * 3600 },
      { ...BASE_WAKEUP, slug: "second", name: "second", scheduleHuman: "every 1h", lastFiredAt: null },
    ]);
    expect(screen.getByText(WAKEUPS_NOTE)).toBeTruthy();

    const first = screen.getByTestId("wakeup-row-daily-box-check");
    expect(within(first).getByText("daily-box-check")).toBeTruthy();
    expect(first.textContent).toContain("daily @ 09:00 America/New_York");
    const second = screen.getByTestId("wakeup-row-second");
    expect(second.textContent).toContain("every 1h");

    expect(screen.getAllByTestId("wakeup-last-fired").map((n) => n.textContent)).toEqual([
      " · Last fired 3h ago",
      " · Never fired",
    ]);
    // The list never shows the instruction or any form fields.
    expect(screen.queryByText("Check the box.")).toBeNull();
    expect(screen.queryByRole("group", { name: /Schedule type/i })).toBeNull();
  });

  it("each row's switch reflects enabled and saves at once via onToggle(slug, next)", async () => {
    const { onToggle, onOpen } = renderTab([
      BASE_WAKEUP,
      { ...BASE_WAKEUP, slug: "paused", name: "paused", enabled: false },
    ]);
    const on = screen.getByTestId("wakeup-switch-daily-box-check") as HTMLInputElement;
    const off = screen.getByTestId("wakeup-switch-paused") as HTMLInputElement;
    expect(on.checked).toBe(true);
    expect(off.checked).toBe(false);
    expect(on.getAttribute("aria-label")).toBe("Turn off daily-box-check");
    expect(off.getAttribute("aria-label")).toBe("Turn on paused");

    fireEvent.click(on);
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("daily-box-check", false));
    fireEvent.click(off);
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("paused", true));
    // Flipping the switch doesn't open the wake-up.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a failed toggle shows an error banner naming the wake-up", async () => {
    renderTab([BASE_WAKEUP], { onToggle: () => Promise.reject(new Error("nope")) });
    fireEvent.click(screen.getByTestId("wakeup-switch-daily-box-check"));
    await waitFor(() => expect(screen.getByText(/Couldn.t turn “daily-box-check” off: nope/)).toBeTruthy());
    // The wake-up is still listed.
    expect(screen.getByTestId("wakeup-row-daily-box-check")).toBeTruthy();
  });

  it("clicking a row opens it via onOpen(slug)", () => {
    const { onOpen } = renderTab([BASE_WAKEUP, { ...BASE_WAKEUP, slug: "second", name: "second" }]);
    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("second");
  });

  it("'New wake-up' calls onNew", () => {
    const { onNew, onOpen } = renderTab();
    const btn = screen.getByTestId("wakeup-add-button");
    expect(btn.textContent).toContain("New wake-up");
    fireEvent.click(btn);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a sensor wake-up's row shows the sensor summary (state, last fired, waiting) instead of a schedule", () => {
    renderTab([SENSOR_WAKEUP]);
    const summary = screen.getByTestId("wakeup-sensor-summary");
    expect(summary.textContent).toContain("Sensor");
    expect(summary.textContent).toContain("Healthy");
    expect(summary.textContent).toContain("Last fired 2h ago");
    expect(screen.getByTestId("wakeup-sensor-summary-state").getAttribute("data-state")).toBe("healthy");
    expect(screen.getByTestId("wakeup-sensor-summary-waiting").textContent).toContain("2 waiting");
    expect(screen.queryByTestId("wakeup-last-fired")).toBeNull();
    // Details stay off the list.
    expect(screen.queryByTestId("wakeup-sensor-details")).toBeNull();
  });

  it("a one-time sensor that never fired reads 'Sensor · once' and 'Never fired'", () => {
    renderTab([
      {
        ...SENSOR_WAKEUP,
        schedule: { type: "sensor", once: true },
        lastFiredAt: null,
        sensor: { ...SENSOR_WAKEUP.sensor!, waitingFires: 0 },
      },
    ]);
    const summary = screen.getByTestId("wakeup-sensor-summary");
    expect(summary.textContent).toContain("Sensor · once");
    expect(summary.textContent).toContain("Never fired");
    expect(screen.queryByTestId("wakeup-sensor-summary-waiting")).toBeNull();
  });

  it("empty list shows the empty state with a New wake-up button", () => {
    const { onNew } = renderTab([]);
    expect(screen.getByText("No wake-ups yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("wakeup-add-button"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("a coordinator with no wake-ups gets the role caption and no button", () => {
    renderTab([], { isCoordinator: true });
    expect(screen.getByTestId("wakeups-coordinator-empty-identity").textContent).toMatch(
      /Coordinators use role-scope wakeups only/,
    );
    expect(screen.queryByTestId("wakeup-add-button")).toBeNull();
  });

  it("loading and error states", () => {
    const props = { isCoordinator: false, onToggle: vi.fn(), onOpen: vi.fn(), onNew: vi.fn() };
    const { rerender } = render(<WakeupsTab state={{ status: "loading" }} {...props} />);
    expect(screen.queryByTestId("wakeups-list")).toBeNull();
    rerender(<WakeupsTab state={{ status: "error", error: "host down" }} {...props} />);
    expect(screen.getByText(/Couldn.t load wake-ups: host down/)).toBeTruthy();
  });
});
