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
function renderTab(wakeupOverrides?: Partial<Wakeup>): {
  onUpdate: ReturnType<typeof vi.fn>;
} {
  const wakeup: Wakeup = { ...BASE_WAKEUP, ...wakeupOverrides };
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(
    <WakeupsTab
      state={{ status: "ready", data: [wakeup] }}
      hue={200}
      onUpdate={onUpdate}
    />,
  );
  return { onUpdate };
}

describe("WakeupsTab — form-based wakeup editor (quick 260731-2pa)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("1: view mode renders the wakeup's human line + a pencil edit button", () => {
    renderTab();

    // Human line visible.
    expect(screen.getByText("daily @ 09:00 America/New_York")).toBeTruthy();

    // Pencil button present (aria-label "Edit schedule").
    const pencil = screen.getByRole("button", { name: /Edit schedule/i });
    expect(pencil).toBeTruthy();

    // No form fields visible in view mode.
    expect(screen.queryByLabelText(/Schedule type/i)).toBeNull();
  });

  it("2: pencil click → form renders; daily wakeup hydrates schedule-type=daily + time=09:00", () => {
    renderTab();

    // Enter edit mode.
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

    // Enter edit mode.
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

    // Enter edit mode.
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

    // Enter edit mode — starts as daily.
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

    // Enter edit mode.
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
});
