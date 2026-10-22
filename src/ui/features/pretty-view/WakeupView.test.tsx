/**
 * WakeupView — one wake-up's form, one level deeper in the agent window (or a
 * blank one for "New wake-up").
 *
 * Ports the form coverage that used to live in WakeupsTab.test.tsx (inline
 * editor, tests 2–12 + schedule format v2) and AddWakeupDialog.test.tsx
 * (create spec shape, timezone fallback/override, monthly + interval
 * options), plus the view's own behaviour: the On switch, Delete wake-up…,
 * rename, and the leave guard.
 *
 * Save only enables once something changed, so the round-trip tests make a
 * trivial rename first and then assert the schedule written back.
 *
 * detectBrowserTimezone is pinned to Europe/London so the "blank zone uses
 * the browser's" assertions are stable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { Wakeup } from "@/api/claude-session-api";

vi.mock("./WakeupFormShared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, detectBrowserTimezone: () => "Europe/London" };
});

import { WakeupView, type WakeupViewProps } from "./WakeupView";
import type { LeaveGuard } from "./roles-window/RolesWindow";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

const NOW = Math.floor(Date.now() / 1000);

const BASE_WAKEUP: Wakeup = {
  slug: "daily-box-check",
  name: "daily-box-check",
  enabled: true,
  schedule: { type: "daily", at: "09:00", timezone: "America/New_York" },
  scheduleHuman: "daily @ 09:00 America/New_York",
  instruction: "Check the box.",
};

type Spies = {
  onToggle: ReturnType<typeof vi.fn>;
  onSave: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
  registerGuard: ReturnType<typeof vi.fn>;
  /** The guard the view registered most recently. */
  guard: () => LeaveGuard;
};

function renderView(
  wakeup: Wakeup | undefined,
  overrides: Partial<Pick<WakeupViewProps, "onToggle" | "onSave" | "onCreate" | "onDelete">> = {},
): Spies {
  const onToggle = vi.fn(overrides.onToggle ?? (() => Promise.resolve()));
  const onSave = vi.fn(overrides.onSave ?? (() => Promise.resolve()));
  const onCreate = vi.fn(overrides.onCreate ?? (() => Promise.resolve()));
  const onDelete = vi.fn(overrides.onDelete ?? (() => Promise.resolve()));
  const onDone = vi.fn();
  const registerGuard = vi.fn();
  render(
    <WakeupView
      wakeup={wakeup}
      onToggle={wakeup ? onToggle : undefined}
      onSave={wakeup ? onSave : undefined}
      onCreate={onCreate}
      onDelete={wakeup ? onDelete : undefined}
      onDone={onDone}
      registerGuard={registerGuard}
      registerEscape={vi.fn()}
    />,
  );
  const guard = (): LeaveGuard => {
    const calls = registerGuard.mock.calls.filter((c) => c[0] !== null);
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0] as LeaveGuard;
  };
  return { onToggle, onSave, onCreate, onDelete, onDone, registerGuard, guard };
}

function renderExisting(overrides?: Partial<Wakeup>): Spies {
  return renderView({ ...BASE_WAKEUP, ...overrides });
}

// The schedule kind is the kit segmented control (a group labelled
// "Schedule type" whose pressed segment is the current kind).
function scheduleKindGroup(): HTMLElement {
  return screen.getByRole("group", { name: /Schedule type/i });
}
function scheduleKind(): string | undefined {
  const pressed = within(scheduleKindGroup())
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true");
  return pressed?.getAttribute("data-testid")?.split("-").pop();
}
function pickKind(kind: string): void {
  const btn = scheduleKindGroup().querySelector(`[data-testid$="-${kind}"]`);
  if (!btn) throw new Error(`no schedule kind segment for ${kind}`);
  fireEvent.click(btn);
}

const nameInput = () => screen.getByTestId("wakeup-view-name") as HTMLInputElement;
const instructionInput = () => screen.getByTestId("wakeup-view-instruction") as HTMLTextAreaElement;
const tzInput = () => screen.getByTestId("wakeup-view-tz") as HTMLInputElement;
const saveButton = () => screen.getByTestId("wakeup-view-save") as HTMLButtonElement;

/** Make the form dirty without touching the schedule, so Save enables. */
function rename(to = "renamed"): void {
  fireEvent.change(nameInput(), { target: { value: to } });
}

async function savedUpdates(onSave: ReturnType<typeof vi.fn>): Promise<{
  name: string;
  schedule: Record<string, unknown>;
  instruction: string;
}> {
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
  vi.restoreAllMocks();
});

describe("WakeupView — editing an existing wake-up", () => {
  it("2: a daily wake-up hydrates schedule-type=daily, time=09:00, its name, instruction and zone", () => {
    renderExisting();
    expect(scheduleKind()).toBe("daily");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("daily-box-check");
    expect((screen.getByLabelText("Instruction") as HTMLTextAreaElement).value).toBe("Check the box.");
    expect(tzInput().value).toBe("America/New_York");
    // Nothing changed yet → Save is disabled.
    expect(saveButton().textContent).toBe("Save");
    expect(saveButton().disabled).toBe(true);
  });

  it("3: switching to interval renders Every + Unit; the Time zone field stays", () => {
    renderExisting();
    pickKind("interval");
    expect(screen.getByLabelText("Every")).toBeTruthy();
    expect(screen.getByLabelText("Unit")).toBeTruthy();
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.getByLabelText("Time zone")).toBeTruthy();
  });

  it("4: one_shot with a past datetime warns it fires immediately", () => {
    renderExisting();
    pickKind("one_shot");
    const at = screen.getByLabelText("Fires at") as HTMLInputElement;
    fireEvent.change(at, { target: { value: "2020-01-01T00:00" } });
    expect(screen.getByText(/That time is in the past/i)).toBeTruthy();
    expect(screen.getByText("immediately")).toBeTruthy();

    fireEvent.change(at, { target: { value: "2999-01-01T00:00" } });
    expect(screen.queryByText(/That time is in the past/i)).toBeNull();
  });

  it("5: the Time zone field shows on every repeating kind, with the browser's zone as placeholder + help", () => {
    renderExisting();
    for (const kind of ["daily", "interval", "weekly", "monthly", "yearly"]) {
      pickKind(kind);
      expect(tzInput().placeholder).toBe("Europe/London");
    }
    expect(screen.getByText(/Leave it blank for yours \(Europe\/London\)/)).toBeTruthy();
  });

  it("5a: a wake-up saved without a zone runs in its machine's zone, and saving keeps it that way", async () => {
    const s = renderExisting({ schedule: { type: "daily", at: "09:00" } });
    expect(tzInput().value).toBe("");
    expect(tzInput().placeholder).toBe("The machine's time zone");
    rename();
    fireEvent.click(saveButton());
    expect((await savedUpdates(s.onSave)).schedule).toEqual({ type: "daily", at: "09:00" });
  });

  it("5b: a one-time wake-up has no Time zone field — its time is the browser's", () => {
    renderExisting();
    pickKind("one_shot");
    expect(screen.queryByTestId("wakeup-view-tz")).toBeNull();
    expect(screen.getByText(/The time above is in your time zone \(Europe\/London\)/)).toBeTruthy();
  });

  it("6: Save writes {name, schedule, instruction}; interval and daily schedules include the timezone", async () => {
    // Case A: interval (defaults n=30, u=m on the kind switch).
    const a = renderExisting();
    pickKind("interval");
    fireEvent.click(saveButton());
    const updatesA = await savedUpdates(a.onSave);
    expect(updatesA).toEqual({
      name: "daily-box-check",
      instruction: "Check the box.",
      schedule: { type: "interval", every: "30m", timezone: "America/New_York" },
    });
    // Save goes back to the list.
    await waitFor(() => expect(a.onDone).toHaveBeenCalledTimes(1));
    cleanup();

    // Case B: daily, blank zone → the browser's zone.
    const b = renderExisting();
    fireEvent.change(tzInput(), { target: { value: "" } });
    fireEvent.click(saveButton());
    const updatesB = await savedUpdates(b.onSave);
    expect(updatesB.schedule).toEqual({ type: "daily", at: "09:00", timezone: "Europe/London" });
    cleanup();

    // Case C: a typed zone wins.
    const c = renderExisting();
    fireEvent.change(tzInput(), { target: { value: "UTC" } });
    fireEvent.click(saveButton());
    expect((await savedUpdates(c.onSave)).schedule).toEqual({ type: "daily", at: "09:00", timezone: "UTC" });
  });

  it("7: Cancel goes back without saving", () => {
    const { onSave, onDone } = renderExisting();
    rename("renamed-in-flight");
    pickKind("weekly");
    fireEvent.click(screen.getByTestId("wakeup-view-cancel"));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("re-opening re-hydrates from the wake-up, not the abandoned drafts", () => {
    renderExisting();
    rename("renamed-in-flight");
    pickKind("weekly");
    cleanup();
    renderExisting();
    expect(scheduleKind()).toBe("daily");
    expect(nameInput().value).toBe("daily-box-check");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("09:00");
  });

  it("renaming saves the new name", async () => {
    const { onSave } = renderExisting();
    rename("  morning check  ");
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    const updates = await savedUpdates(onSave);
    expect(updates.name).toBe("morning check");
    expect(updates.schedule).toEqual(BASE_WAKEUP.schedule);
  });

  it("editing the instruction saves it", async () => {
    const { onSave } = renderExisting();
    fireEvent.change(instructionInput(), { target: { value: "Check it twice." } });
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).instruction).toBe("Check it twice.");
  });

  it("Save is disabled for an empty name or one that slugs to nothing; an existing wake-up may have an empty instruction", () => {
    renderExisting();
    rename("");
    expect(saveButton().disabled).toBe(true);
    rename("!!!");
    expect(saveButton().disabled).toBe(true);
    rename("fine");
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(instructionInput(), { target: { value: "   " } });
    expect(saveButton().disabled).toBe(false);
  });

  it("a failed save shows the error and stays open", async () => {
    const { onSave, onDone } = renderView(BASE_WAKEUP, { onSave: () => Promise.reject(new Error("collision")) });
    rename();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/collision/)).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it("the On switch saves at once via onToggle", async () => {
    const { onToggle, onSave } = renderExisting();
    const sw = screen.getByTestId("wakeup-view-enabled") as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(screen.getByTestId("wakeup-view-on-note").textContent).toContain("daily @ 09:00 America/New_York");
    fireEvent.click(sw);
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(false));
    expect(onSave).not.toHaveBeenCalled();
  });

  // ── Restrict-to-days chips (round-trip + chip toggles) ─────────────────────

  it("8: a daily+weekdays spec saves days:[mon..fri] back unchanged", async () => {
    const { onSave } = renderExisting({
      schedule: { type: "daily", at: "23:00", timezone: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] },
      scheduleHuman: "Weekdays at 23:00 (box-local)",
    });
    rename();
    fireEvent.click(saveButton());
    const { schedule } = await savedUpdates(onSave);
    expect(schedule).toEqual({
      type: "daily",
      at: "23:00",
      timezone: "America/New_York",
      days: ["mon", "tue", "wed", "thu", "fri"],
    });
  });

  it("9: toggling 5 chips on a plain daily spec emits days:[mon..fri]", async () => {
    const { onSave } = renderExisting();
    expect(screen.getByRole("group", { name: /Restrict to days of week/i })).toBeTruthy();
    for (const day of ["Fri", "Mon", "Wed", "Tue", "Thu"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("10: toggling all 7 chips drops the days key", async () => {
    const { onSave } = renderExisting();
    for (const day of ["Sun", "Mon", "Sat", "Tue", "Fri", "Wed", "Thu"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }
    // Every day is the same schedule as none, so that alone isn't an edit.
    expect(saveButton().disabled).toBe(true);
    rename();
    fireEvent.click(saveButton());
    expect("days" in (await savedUpdates(onSave)).schedule).toBe(false);
  });

  it("11: deselecting every chip drops the days key and doesn't block Save", async () => {
    const { onSave } = renderExisting({
      schedule: { type: "daily", at: "23:00", timezone: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] },
    });
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getByRole("button", { name: `Toggle ${day}` }).getAttribute("aria-pressed")).toBe("true");
    }
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    const { schedule } = await savedUpdates(onSave);
    expect("days" in schedule).toBe(false);
    expect(schedule.type).toBe("daily");
    expect(schedule.at).toBe("23:00");
  });

  it("12: hydrate normalises unknown / non-string / uppercase days into canonical order", async () => {
    const { onSave } = renderExisting({
      schedule: {
        type: "daily",
        at: "23:00",
        timezone: "America/New_York",
        days: ["FRI", "mon", 42, null, "xyz", "WED", " tue "],
      },
    });
    rename();
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule.days).toEqual(["mon", "tue", "wed", "fri"]);
  });

  // ── Schedule format v2 ─────────────────────────────────────────────────────

  it("a v2 spec edited without touching the schedule saves every field back", async () => {
    const schedule = {
      type: "weekly",
      day: "fri",
      at: ["09:00", "13:00"],
      every: 2,
      start: "2026-10-16T00:00:00",
      days: ["mon", "fri"],
      count: 6,
      timezone: "America/New_York",
    };
    const { onSave } = renderExisting({ schedule });
    expect((screen.getByTestId("wakeup-every") as HTMLInputElement).value).toBe("2");
    expect((screen.getByTestId("wakeup-weekly-at-2") as HTMLInputElement).value).toBe("13:00");
    rename();
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule).toEqual(schedule);
  });

  it("monthly renders its day fields and Ends", () => {
    renderExisting();
    pickKind("monthly");
    expect(screen.getByLabelText("Day of month")).toBeTruthy();
    expect(screen.getByLabelText("Weekday of month")).toBeTruthy();
    expect(screen.getByLabelText("Ends")).toBeTruthy();
  });

  it("monthly — last Friday, two times, every 3 months, ends after 4 runs", async () => {
    const { onSave } = renderExisting();
    pickKind("monthly");
    fireEvent.click(screen.getByLabelText("Weekday of month"));
    fireEvent.change(screen.getByLabelText("Which"), { target: { value: "last" } });
    fireEvent.change(screen.getByLabelText("Weekday"), { target: { value: "fri" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "16:00" } });
    fireEvent.click(screen.getByTestId("wakeup-monthly-at-add"));
    fireEvent.change(screen.getByTestId("wakeup-every"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("wakeup-start"), { target: { value: "2027-01-01T00:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "count" } });
    fireEvent.change(screen.getByLabelText("Number of runs"), { target: { value: "4" } });
    fireEvent.change(tzInput(), { target: { value: "UTC" } });
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule).toEqual({
      type: "monthly",
      nth: "last",
      weekday: "fri",
      at: ["16:00", "17:00"],
      every: 3,
      timezone: "UTC",
      start: expect.stringMatching(/^2027-01-01T00:00:00[+-]\d\d:\d\d$/),
      count: 4,
    });
  });

  it("interval — only between 09:00 and 17:00 on weekdays, with timezone", async () => {
    const { onSave } = renderExisting();
    pickKind("interval");
    fireEvent.click(screen.getByLabelText("Only between"));
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${d}` }));
    }
    fireEvent.change(tzInput(), { target: { value: "America/Chicago" } });
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule).toEqual({
      type: "interval",
      every: "30m",
      window: { from: "09:00", to: "17:00" },
      days: ["mon", "tue", "wed", "thu", "fri"],
      timezone: "America/Chicago",
    });
  });

  // ── Sensor wake-ups ────────────────────────────────────────────────────────

  it("a sensor wake-up shows a read-only When + its details and saves its schedule unchanged", async () => {
    const { onSave } = renderExisting({
      schedule: { type: "sensor" },
      scheduleHuman: "Sensor",
      lastFiredAt: NOW - 2 * 3600,
      sensor: {
        state: "broken",
        run: "cadence",
        cadenceHuman: "Every 5m",
        lastRanAt: NOW - 60,
        trippedReason: null,
        trippedAt: null,
        error: "Traceback: boom",
      },
    });
    const when = screen.getByTestId("wakeup-sensor-schedule");
    expect(when.textContent).toMatch(/When its sensor fires/);
    expect(when.textContent).not.toMatch(/once/);
    expect(screen.queryByRole("group", { name: /Schedule type/i })).toBeNull();
    expect(screen.queryByTestId("wakeup-view-tz")).toBeNull();
    const details = screen.getByTestId("wakeup-sensor-details");
    expect(details.textContent).toContain("Runs: Every 5m");
    expect(screen.getByTestId("wakeup-sensor-details-error").textContent).toBe("Traceback: boom");

    rename();
    fireEvent.change(instructionInput(), { target: { value: "new instruction" } });
    fireEvent.click(saveButton());
    const updates = await savedUpdates(onSave);
    expect(updates).toMatchObject({ name: "renamed", instruction: "new instruction" });
    expect(updates.schedule).toEqual({ type: "sensor" });
  });

  it("a one-time sensor wake-up says so and keeps the once mark on save", async () => {
    const { onSave } = renderExisting({ schedule: { type: "sensor", once: true }, scheduleHuman: "Sensor · once" });
    expect(screen.getByTestId("wakeup-sensor-schedule").textContent).toMatch(/once, then it retires/);
    rename();
    fireEvent.click(saveButton());
    expect((await savedUpdates(onSave)).schedule).toEqual({ type: "sensor", once: true });
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  it("Delete wake-up… asks first; confirming calls onDelete and goes back", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    const { onDelete, onDone } = renderExisting();
    fireEvent.click(screen.getByTestId("wakeup-view-delete"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe("Delete this wake-up?");
    expect((dialogs.calls[0].opts as { body?: string }).body).toContain("daily-box-check");
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("the delete confirm is the kit dialog with a destructive Delete button", async () => {
    renderExisting();
    fireEvent.click(screen.getByTestId("wakeup-view-delete"));
    const dialog = await screen.findByTestId("kit-confirm-dialog");
    expect(within(dialog).getByText(/Delete this wake-up\?/i)).toBeTruthy();
    expect(dialog.textContent).toContain("daily-box-check");
    expect(within(dialog).getByTestId("kit-dialog-confirm").textContent).toBe("Delete");
  });

  it("cancelling the delete confirm doesn't delete", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { onDelete, onDone } = renderExisting();
    fireEvent.click(screen.getByTestId("wakeup-view-delete"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(onDelete).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a failed delete shows the error and stays open", async () => {
    autoAnswerKitDialogs({ confirm: true });
    const { onDone } = renderView(BASE_WAKEUP, { onDelete: () => Promise.reject(new Error("nope")) });
    fireEvent.click(screen.getByTestId("wakeup-view-delete"));
    await waitFor(() => expect(screen.getByText(/Couldn.t delete: nope/)).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
  });

  // ── Leave guard ────────────────────────────────────────────────────────────

  it("the leave guard lets you go when nothing changed, without asking", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { guard } = renderExisting();
    await expect(guard()()).resolves.toBe(true);
    expect(dialogs.calls).toHaveLength(0);
  });

  it("with unsaved edits the guard asks 'Discard your changes?' and returns false when you keep editing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { guard } = renderExisting();
    rename();
    await expect(guard()()).resolves.toBe(false);
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(nameInput().value).toBe("renamed");
  });

  it("with unsaved edits the guard returns true when you discard", async () => {
    autoAnswerKitDialogs({ confirm: true });
    const { guard } = renderExisting();
    rename();
    await expect(guard()()).resolves.toBe(true);
  });

  it("while a save is on its way the guard holds without asking", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    let finish: () => void = () => {};
    const { guard, onDone } = renderView(BASE_WAKEUP, {
      onSave: () => new Promise<void>((r) => (finish = r)),
    });
    rename();
    fireEvent.click(saveButton());
    await expect(guard()()).resolves.toBe(false);
    expect(dialogs.calls).toHaveLength(0);
    finish();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("unregisters its guard on unmount", () => {
    const { registerGuard } = renderExisting();
    cleanup();
    expect(registerGuard).toHaveBeenLastCalledWith(null);
  });
});

describe("WakeupView — a new wake-up", () => {
  it("starts blank on daily 09:00, switched on, with Create and no Delete", () => {
    renderView(undefined);
    expect(nameInput().value).toBe("");
    expect(instructionInput().value).toBe("");
    expect(scheduleKind()).toBe("daily");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("09:00");
    expect(tzInput().value).toBe("");
    expect((screen.getByTestId("wakeup-view-enabled") as HTMLInputElement).checked).toBe(true);
    expect(saveButton().textContent).toBe("Create");
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByTestId("wakeup-view-delete")).toBeNull();
  });

  it("Create calls onCreate with {name, enabled, schedule, instruction} — blank zone uses the browser's", async () => {
    const { onCreate, onDone } = renderView(undefined);
    fireEvent.change(nameInput(), { target: { value: "morning-standup" } });
    fireEvent.change(instructionInput(), { target: { value: "check the box" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toEqual({
      name: "morning-standup",
      enabled: true,
      instruction: "check the box",
      schedule: { type: "daily", at: "09:00", timezone: "Europe/London" },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("the On switch is part of Create (switched off → enabled:false), not a save", async () => {
    const { onCreate, onToggle } = renderView(undefined);
    fireEvent.click(screen.getByTestId("wakeup-view-enabled"));
    expect(screen.getByTestId("wakeup-view-on-note").textContent).toMatch(/created switched off/);
    fireEvent.change(nameInput(), { target: { value: "s" } });
    fireEvent.change(instructionInput(), { target: { value: "x" } });
    fireEvent.change(tzInput(), { target: { value: "UTC" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      enabled: false,
      schedule: { type: "daily", at: "09:00", timezone: "UTC" },
    });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Create is disabled until name (that slugs to something) and instruction are filled", () => {
    renderView(undefined);
    fireEvent.change(instructionInput(), { target: { value: "do the thing" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "!!!" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "ok" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(instructionInput(), { target: { value: "" } });
    expect(saveButton().disabled).toBe(true);
  });

  it("a failed create surfaces the error inline and stays open", async () => {
    const { onCreate, onDone } = renderView(undefined, { onCreate: () => Promise.reject(new Error("collision")) });
    fireEvent.change(nameInput(), { target: { value: "morning-standup" } });
    fireEvent.change(instructionInput(), { target: { value: "x" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/collision/)).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("the guard asks before throwing away a half-made wake-up", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { guard } = renderView(undefined);
    await expect(guard()()).resolves.toBe(true);
    fireEvent.change(nameInput(), { target: { value: "half" } });
    await expect(guard()()).resolves.toBe(false);
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
  });
});
