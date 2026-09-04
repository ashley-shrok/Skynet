/**
 * Quick 260731-2pa — WakeupsTab: form-based wakeup schedule editor
 *
 * Seven tests covering the form editor rewrite that replaces patch #154's
 * raw JSON textarea:
 *   1. View-mode renders the human line + pencil.
 *   2. Pencil click enters edit-mode; daily schedule hydrates into a time
 *      input at value `09:00`.
 *   3. Type dropdown change → interval → interval fields render; tz hint
 *      is NOT present on interval.
 *   4. Type dropdown change → one_shot + past datetime → "fires this
 *      immediately" hint appears.
 *   5. Timezone hint on daily/weekly/one_shot renders (matches either the
 *      jsdom-resolved zone or the fallback America/New_York).
 *   6. Save with type=interval → onUpdate schedule has NO timezone field;
 *      Save with type=daily → onUpdate schedule includes timezone field.
 *   7. Cancel reverts drafts and hides the form; re-open re-hydrates from
 *      wakeup.schedule.
 *
 * Mocking strategy: WakeupsTab does NOT open a WS — it receives `onUpdate`
 * as a prop — so we mock nothing at the module level. Just render the
 * component with a spy onUpdate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { Wakeup } from "@/api/claude-session-api";
import { WakeupsTab } from "./WakeupsTab";

// ── Shared fixtures ────────────────────────────────────────────────────────────
const BASE_WAKEUP: Wakeup = {
  slug: "daily-box-check",
  name: "daily-box-check",
  enabled: true,
  schedule: { type: "daily", at: "09:00", timezone: "America/New_York" },
  scheduleHuman: "daily @ 09:00 America/New_York",
  instruction: "Check the box.",
};

// Helper: render the tab with a single BASE_WAKEUP and return the onUpdate spy.
// Phase 72 Plan 02 Task 2: WakeupsTab now requires scope + onCreate + onDelete;
// helper passes no-op defaults so existing tests keep working without change.
function renderTab(wakeupOverrides?: Partial<Wakeup>): {
  onUpdate: ReturnType<typeof vi.fn>;
} {
  const wakeup: Wakeup = { ...BASE_WAKEUP, ...wakeupOverrides };
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(
    <WakeupsTab
      state={{ status: "ready", data: [wakeup] }}
      hue={200}
      scope="identity"
      onUpdate={onUpdate}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { onUpdate };
}

// Quick 260808-<slug>: cards are collapsed by default. The pencil + form + instruction
// prose only render once the disclosure header is toggled open. Every test that
// exercises the form must first expand the card via this helper.
function expandCard(): void {
  // Header row's accessible name is "<name> <scheduleHuman> ..." — matching the
  // wakeup name is the stable anchor.
  fireEvent.click(screen.getByRole("button", { name: /daily-box-check/i }));
}

// Helper: enter edit mode on the single rendered wakeup card.
// Used by the Phase 65 tests to reduce duplication.
function enterEditMode(): void {
  expandCard();
  fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));
}

describe("WakeupsTab — form-based wakeup editor (quick 260731-2pa)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("1: collapsed by default — header shows name + schedule human; instruction + pencil hidden until expanded", () => {
    renderTab();

    // Header row shows name + schedule human even when collapsed (they're the
    // scan signal for picking which wakeup to expand).
    expect(screen.getByText("daily-box-check")).toBeTruthy();
    expect(screen.getByText("daily @ 09:00 America/New_York")).toBeTruthy();

    // Instruction prose is hidden when collapsed.
    expect(screen.queryByText("Check the box.")).toBeNull();

    // Pencil is hidden when collapsed.
    expect(screen.queryByRole("button", { name: /Edit schedule/i })).toBeNull();

    // No form fields either.
    expect(screen.queryByLabelText(/Schedule type/i)).toBeNull();

    // Expand: instruction + pencil appear.
    expandCard();
    expect(screen.getByText("Check the box.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit schedule/i })).toBeTruthy();
  });

  it("2: pencil click → form renders; daily wakeup hydrates schedule-type=daily + time=09:00", () => {
    renderTab();

    // Expand card, then enter edit mode.
    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Schedule-type select shows "daily".
    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe("daily");

    // Time input has hydrated value 09:00.
    const timeInput = screen.getByLabelText(/Time \(local\)/i) as HTMLInputElement;
    expect(timeInput.value).toBe("09:00");

    // Name input has the wakeup's name.
    const nameInput = screen.getByLabelText(/Wakeup name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("daily-box-check");
  });

  it("3: change type dropdown to interval → interval fields render; NO tz hint", () => {
    renderTab();

    // Expand card, then enter edit mode.
    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Change type to interval.
    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "interval" } });

    // Interval fields present.
    expect(screen.getByLabelText(/Every/i)).toBeTruthy();
    expect(screen.getByLabelText(/Unit/i)).toBeTruthy();

    // Timezone hint MUST NOT be present on interval.
    expect(screen.queryByText(/Timezone \(auto-detected from browser\):/i)).toBeNull();
  });

  it("4: type=one_shot with a past datetime → 'fires this immediately' hint appears", () => {
    renderTab();

    // Expand card, then enter edit mode.
    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Change type to one_shot.
    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "one_shot" } });

    // The one_shot datetime-local input is present.
    const atInput = screen.getByLabelText(/Fires at \(local\)/i) as HTMLInputElement;
    expect(atInput).toBeTruthy();

    // Set to a guaranteed-past value.
    fireEvent.change(atInput, { target: { value: "2020-01-01T00:00" } });

    // Past-datetime hint appears. The hint has an inline <b>immediately</b>
    // so getByText's default full-node matcher misses it; assert the two
    // text fragments are each rendered in the document instead.
    expect(screen.getByText(/that datetime is in the past/i)).toBeTruthy();
    expect(screen.getByText("immediately")).toBeTruthy();
  });

  it("5: daily/weekly/one_shot render the browser-detected (or fallback) tz hint", () => {
    renderTab();

    // Expand card, then enter edit mode — starts as daily.
    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Timezone hint present on daily (matches the "Timezone (auto-detected from browser):" prefix).
    // The zone value can be either the jsdom-resolved zone or America/New_York (fallback);
    // we just assert the label is visible.
    expect(screen.getByText(/Timezone \(auto-detected from browser\):/i)).toBeTruthy();

    // Switch to weekly — hint should still be present.
    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "weekly" } });
    expect(screen.getByText(/Timezone \(auto-detected from browser\):/i)).toBeTruthy();

    // Switch to one_shot — hint should still be present.
    fireEvent.change(typeSelect, { target: { value: "one_shot" } });
    expect(screen.getByText(/Timezone \(auto-detected from browser\):/i)).toBeTruthy();
  });

  it("6: Save writes {name, enabled, schedule, instruction}; interval schedule OMITS timezone; daily schedule INCLUDES it", async () => {
    // --- Case A: interval save — schedule has NO timezone ---
    const { onUpdate: onUpdateInterval } = renderTab();

    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Change type to interval. Defaults are n=30, u='m' per the type-swap handler.
    fireEvent.change(screen.getByLabelText(/Schedule type/i), { target: { value: "interval" } });

    // Click Save.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(onUpdateInterval).toHaveBeenCalledTimes(1);
    });

    const [slugArgA, updatesArgA] = onUpdateInterval.mock.calls[0];
    expect(slugArgA).toBe("daily-box-check");
    expect(updatesArgA).toMatchObject({
      name: "daily-box-check",
      enabled: true,
      instruction: "Check the box.",
      schedule: { type: "interval", every: "30m" },
    });
    // Assert timezone is NOT present on interval schedule.
    expect((updatesArgA.schedule as Record<string, unknown>).timezone).toBeUndefined();

    // Tear down first render before setting up the next.
    cleanup();

    // --- Case B: daily save — schedule INCLUDES timezone ---
    const { onUpdate: onUpdateDaily } = renderTab();

    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));
    // Still daily by default; just click Save.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(onUpdateDaily).toHaveBeenCalledTimes(1);
    });

    const [, updatesArgB] = onUpdateDaily.mock.calls[0];
    const dailyScheduleB = updatesArgB.schedule as Record<string, unknown>;
    expect(dailyScheduleB.type).toBe("daily");
    expect(dailyScheduleB.at).toBe("09:00");
    // Assert timezone IS present on daily schedule (value can vary per jsdom Intl).
    expect(typeof dailyScheduleB.timezone).toBe("string");
    expect((dailyScheduleB.timezone as string).length).toBeGreaterThan(0);
  });

  it("7: Cancel reverts drafts + hides form; re-open re-hydrates from wakeup.schedule", () => {
    const { onUpdate } = renderTab();

    // Expand card, then enter edit mode.
    expandCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));

    // Dirty the name and instruction drafts.
    const nameInput = screen.getByLabelText(/Wakeup name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "renamed-in-flight" } });
    expect(nameInput.value).toBe("renamed-in-flight");

    // Also change the type dropdown.
    fireEvent.change(screen.getByLabelText(/Schedule type/i), { target: { value: "weekly" } });

    // Click Cancel.
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    // Form is hidden — no schedule-type select present.
    expect(screen.queryByLabelText(/Schedule type/i)).toBeNull();
    // Human line reappears.
    expect(screen.getByText("daily @ 09:00 America/New_York")).toBeTruthy();

    // Re-open — form re-hydrates from wakeup.schedule (type=daily, at=09:00,
    // name reverted).
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/i }));
    const typeSelectAfter = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    expect(typeSelectAfter.value).toBe("daily");
    const nameInputAfter = screen.getByLabelText(/Wakeup name/i) as HTMLInputElement;
    expect(nameInputAfter.value).toBe("daily-box-check");
    const timeInputAfter = screen.getByLabelText(/Time \(local\)/i) as HTMLInputElement;
    expect(timeInputAfter.value).toBe("09:00");

    // onUpdate was never called by Cancel.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // ── Phase 65 Plan 02: days-gate round-trip + chip UI tests ─────────────────
  // Chip aria-label contract (must match Task 2 implementation exactly):
  //   - Container: role="group" aria-label="Restrict to days of week"
  //   - Each chip button: aria-label="Toggle Mon" / "Toggle Tue" / ... / "Toggle Sun"
  //   - Each chip button: aria-pressed="true" when selected, aria-pressed="false" when deselected

  it("8: Save preserves days:[mon,tue,wed,thu,fri] on a daily+weekdays spec — no data loss (Phase 65 Success Criteria #2, D-07 round-trip)", async () => {
    const { onUpdate } = renderTab({
      schedule: { type: "daily", at: "23:00", timezone: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] },
      scheduleHuman: "Weekdays at 23:00 (box-local)",
    });

    enterEditMode();

    // Do NOT modify any control — just click Save to prove round-trip fidelity.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

    const [, updates] = onUpdate.mock.calls[0] as [string, { schedule?: Record<string, unknown> }];
    const schedule = updates.schedule as Record<string, unknown>;

    expect(schedule.type).toBe("daily");
    expect(schedule.at).toBe("23:00");
    expect(Array.isArray(schedule.days)).toBe(true);
    // D-03: canonical mon→sun order preserved; D-07: round-trip fidelity
    expect(schedule.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("9: Chip toggle → build — starting from a plain daily spec (no days), toggling 5 chips emits days:[mon,tue,wed,thu,fri] on Save (Phase 65 Success Criteria #3)", async () => {
    const { onUpdate } = renderTab();

    enterEditMode();

    // Locate the chip-row container via aria-label (D-06 container contract).
    const chipContainer = screen.getByRole("group", { name: /Restrict to days of week/i });
    expect(chipContainer).toBeTruthy();

    // Click each of Mon, Tue, Wed, Thu, Fri chips (aria-label contract: "Toggle Mon" etc.).
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

    const [, updates] = onUpdate.mock.calls[0] as [string, { schedule?: Record<string, unknown> }];
    const schedule = updates.schedule as Record<string, unknown>;

    // D-03: canonical mon→sun order regardless of click order
    expect(schedule.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
  });

  it("10: D-02 full-7 drop — toggling all 7 chips on emits payload WITHOUT `days` key", async () => {
    const { onUpdate } = renderTab();

    enterEditMode();

    // Click all 7 chip buttons in ARBITRARY order (proves order-insensitivity per D-03).
    for (const day of ["Sun", "Mon", "Sat", "Tue", "Fri", "Wed", "Thu"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

    const [, updates] = onUpdate.mock.calls[0] as [string, { schedule?: Record<string, unknown> }];
    const schedule = updates.schedule as Record<string, unknown>;

    // D-02: full-7 drops the field entirely (key must be ABSENT, not just undefined).
    expect("days" in schedule).toBe(false);
  });

  it("11: D-04 empty subset drop — starting from a days-having spec, deselecting all chips emits payload WITHOUT `days` and does NOT block Save", async () => {
    const { onUpdate } = renderTab({
      schedule: { type: "daily", at: "23:00", timezone: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] },
      scheduleHuman: "Weekdays at 23:00 (box-local)",
    });

    enterEditMode();

    // Pre-condition: the 5 weekday chips render as selected on entry (aria-pressed="true").
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getByRole("button", { name: `Toggle ${day}` }).getAttribute("aria-pressed")).toBe("true");
    }

    // Deselect all 5 weekday chips.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      fireEvent.click(screen.getByRole("button", { name: `Toggle ${day}` }));
    }

    // No validation error banner (D-04: empty subset is not a blocking validation error).
    expect(screen.queryByText(/validation|must be|invalid|error/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

    const [, updates] = onUpdate.mock.calls[0] as [string, { schedule?: Record<string, unknown> }];
    const schedule = updates.schedule as Record<string, unknown>;

    // D-04: empty subset drops the field entirely.
    expect("days" in schedule).toBe(false);
    // Other fields preserved.
    expect(schedule.type).toBe("daily");
    expect(schedule.at).toBe("23:00");
  });

  it("12: D-03 hydrate normalization — unknown / non-string / uppercase entries in s.days are filtered and canonical-ordered", async () => {
    const { onUpdate } = renderTab({
      // Mixed case, whitespace, non-string, unknown code — hydrate must normalize defensively.
      schedule: { type: "daily", at: "23:00", timezone: "America/New_York", days: ["FRI", "mon", 42, null, "xyz", "WED", " tue "] },
      scheduleHuman: "Days at 23:00 (box-local)",
    });

    enterEditMode();

    // Click Save WITHOUT touching any chip — proves D-03 + D-07 defensive hydration.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

    const [, updates] = onUpdate.mock.calls[0] as [string, { schedule?: Record<string, unknown> }];
    const schedule = updates.schedule as Record<string, unknown>;

    // D-03: canonical mon→sun order; D-07: defensive normalization
    // FRI→fri, mon→mon, 42→drop, null→drop, xyz→drop, WED→wed, " tue "→tue
    // Sorted: mon, tue, wed, fri
    expect(schedule.days).toEqual(["mon", "tue", "wed", "fri"]);
  });

  // ── Phase 72 Plan 02 Task 2: scope prop + Add-wakeup + Delete + scope pill ──
  // WakeupsTab now accepts scope: "role" | "identity" + onCreate + onDelete
  // callbacks. The tab renders an Add-wakeup pill button + AddWakeupDialog
  // sub-modal at the top, a trash icon per row that opens an AlertDialog
  // confirm, and a scope pill on every row so scope is visible at a glance.

  it("13: scope='identity' — Add-wakeup button click opens AddWakeupDialog with identity-scope title", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={onCreate}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // Add-wakeup pill exists.
    const addBtn = screen.getByTestId("wakeup-add-button");
    expect(addBtn).toBeTruthy();
    // Dialog is not open initially.
    expect(screen.queryByTestId("add-wakeup-dialog")).toBeNull();
    // Click opens dialog.
    fireEvent.click(addBtn);
    expect(screen.getByTestId("add-wakeup-dialog")).toBeTruthy();
    // Title reflects identity-scope.
    expect(screen.getByText(/Add identity-scope wakeup/i)).toBeTruthy();
  });

  it("14: scope='role' — Add-wakeup button click opens AddWakeupDialog with role-scope title", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="role"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByTestId("wakeup-add-button"));
    expect(screen.getByTestId("add-wakeup-dialog")).toBeTruthy();
    expect(screen.getByText(/Add role-scope wakeup/i)).toBeTruthy();
  });

  it("15: onCreate fires with correctly-shaped spec when the sub-dialog Save button is clicked", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={onCreate}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByTestId("wakeup-add-button"));

    // Fill required fields.
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "morning-standup" } });
    fireEvent.change(screen.getByLabelText(/Instruction/i), { target: { value: "check the box" } });

    // Click Save.
    fireEvent.click(screen.getByTestId("add-wakeup-save"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const spec = onCreate.mock.calls[0][0] as {
      name: string;
      enabled: boolean;
      schedule: Record<string, unknown>;
      instruction: string;
    };
    expect(spec.name).toBe("morning-standup");
    expect(spec.enabled).toBe(true);
    expect(spec.instruction).toBe("check the box");
    // Default schedule is daily.
    expect(spec.schedule.type).toBe("daily");
  });

  it("16: trash icon renders on every wakeup row", () => {
    const twoWakeups: Wakeup[] = [
      BASE_WAKEUP,
      { ...BASE_WAKEUP, slug: "second-wakeup", name: "second-wakeup" },
    ];
    render(
      <WakeupsTab
        state={{ status: "ready", data: twoWakeups }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trashIcons = screen.getAllByTestId("wakeup-delete-icon");
    expect(trashIcons.length).toBe(2);
  });

  it("17: clicking trash icon opens AlertDialog confirm; slug appears in description", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByTestId("wakeup-delete-icon"));

    // AlertDialog confirm present; slug appears in body. Query by description
    // role so we're not matching the wakeup-name span in the header row too.
    expect(screen.getByText(/Delete wakeup\?/i)).toBeTruthy();
    const description = screen.getByRole("alertdialog").querySelector('[data-slot="alert-dialog-description"]');
    expect(description).toBeTruthy();
    expect(description!.textContent).toContain("daily-box-check");
  });

  it("18: clicking Delete-confirm calls onDelete with the row's slug", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByTestId("wakeup-delete-icon"));
    fireEvent.click(screen.getByTestId("wakeup-delete-confirm"));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith("daily-box-check");
  });

  it("19: clicking Cancel in the AlertDialog does NOT call onDelete", () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByTestId("wakeup-delete-icon"));
    // AlertDialog Cancel button is rendered by AlertDialogCancel — accessible role="button" name /Cancel/i.
    // Some Radix versions render two dialogs (portal); scope to a container.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("20: onDelete rejection surfaces error text in the AlertDialog and does not close it", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("nope"));
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByTestId("wakeup-delete-icon"));
    fireEvent.click(screen.getByTestId("wakeup-delete-confirm"));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    // Error text surfaces inline; dialog still shows the title.
    await waitFor(() => expect(screen.getByText(/nope/)).toBeTruthy());
    expect(screen.getByText(/Delete wakeup\?/i)).toBeTruthy();
  });

  it("21: scope='role' — every wakeup row's scope pill reads 'role'", () => {
    const twoWakeups: Wakeup[] = [
      BASE_WAKEUP,
      { ...BASE_WAKEUP, slug: "second-wakeup", name: "second-wakeup" },
    ];
    render(
      <WakeupsTab
        state={{ status: "ready", data: twoWakeups }}
        hue={200}
        scope="role"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const pills = screen.getAllByTestId("wakeup-scope-pill");
    expect(pills.length).toBe(2);
    for (const pill of pills) {
      expect(pill.textContent).toBe("role");
    }
  });

  it("22: scope='identity' — every wakeup row's scope pill reads 'identity'", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [BASE_WAKEUP] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const pill = screen.getByTestId("wakeup-scope-pill");
    expect(pill.textContent).toBe("identity");
  });

  it("23: empty-state branch still renders 'No scheduled wake-ups.' AND renders the Add-wakeup button so first-wakeup flow is reachable", () => {
    render(
      <WakeupsTab
        state={{ status: "ready", data: [] }}
        hue={200}
        scope="identity"
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/No scheduled wake-ups\./i)).toBeTruthy();
    // Add-wakeup pill remains reachable so the user can add the FIRST wakeup.
    expect(screen.getByTestId("wakeup-add-button")).toBeTruthy();
  });
});
