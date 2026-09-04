/**
 * Phase 72 Plan 02 Task 1 — AddWakeupDialog: Radix Dialog-in-Dialog sub-modal
 * for creating a new wakeup (identity-scope OR role-scope; the parent decides
 * which callback to hand to `onSubmit`).
 *
 * 12 tests A–L covering the 6 CONTEXT.md-locked form fields (Name /
 * Schedule-type / Schedule params / Timezone (optional IANA) / Instruction /
 * Enabled), including Timezone visibility per schedule type + placeholder text
 * + blank-fallback-to-detected-tz + user-override-wins semantics.
 *
 * Mocking strategy: AddWakeupDialog does NOT open a WS — it receives
 * `onSubmit` as a prop — so we mock nothing at the module level. Just render
 * the component with a spy onSubmit. `detectBrowserTimezone` is mocked at the
 * shared-module level for Test J so the placeholder assertion is stable
 * regardless of the jsdom-resolved zone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AddWakeupDialog } from "./AddWakeupDialog";

// Helper: render the dialog open with default props + a spy onSubmit.
function renderDialog(overrides: {
  open?: boolean;
  scope?: "role" | "identity";
  onSubmit?: (spec: unknown) => Promise<void>;
} = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onOpenChange: ReturnType<typeof vi.fn>;
} {
  const onSubmit = overrides.onSubmit
    ? (vi.fn(overrides.onSubmit) as ReturnType<typeof vi.fn>)
    : vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <AddWakeupDialog
      open={overrides.open ?? true}
      onOpenChange={onOpenChange}
      hue={200}
      scope={overrides.scope ?? "identity"}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe("AddWakeupDialog — Phase 72 Plan 02 Task 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("A: dialog renders when open=true, does not render when open=false", () => {
    const { unmount } = render(
      <AddWakeupDialog
        open={false}
        onOpenChange={() => {}}
        hue={200}
        scope="identity"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByTestId("add-wakeup-dialog")).toBeNull();
    unmount();
    cleanup();

    render(
      <AddWakeupDialog
        open={true}
        onOpenChange={() => {}}
        hue={200}
        scope="identity"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId("add-wakeup-dialog")).toBeTruthy();
  });

  it("B: switching schedule type re-renders per-type param fields (interval → daily → weekly → one_shot)", () => {
    renderDialog();

    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;

    // Default is daily → time input rendered.
    expect(typeSelect.value).toBe("daily");
    expect(screen.getByLabelText(/Time \(local\)/i)).toBeTruthy();

    // Switch to interval → Every + Unit render; no time input.
    fireEvent.change(typeSelect, { target: { value: "interval" } });
    expect(screen.getByLabelText(/Every/i)).toBeTruthy();
    expect(screen.getByLabelText(/Unit/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Time \(local\)/i)).toBeNull();

    // Switch to weekly → Day + Time render.
    fireEvent.change(typeSelect, { target: { value: "weekly" } });
    // Weekly day <select> anchored by its label "Day" (exact match, not
    // /Day/i which also matches the "Sunday", "Monday", etc. option labels
    // as accessible-name candidates for those <option> elements).
    expect(screen.getByLabelText("Day")).toBeTruthy();
    expect(screen.getByLabelText(/Time \(local\)/i)).toBeTruthy();

    // Switch to one_shot → Fires at renders.
    fireEvent.change(typeSelect, { target: { value: "one_shot" } });
    expect(screen.getByLabelText(/Fires at \(local\)/i)).toBeTruthy();
  });

  it("C: Save button disabled when Name is empty", () => {
    renderDialog();
    // Fill instruction only.
    const instruction = screen.getByLabelText(/Instruction/i) as HTMLTextAreaElement;
    fireEvent.change(instruction, { target: { value: "do the thing" } });
    // Name is still empty → Save disabled.
    const save = screen.getByTestId("add-wakeup-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("D: Save button disabled when Instruction is empty", () => {
    renderDialog();
    // Fill name only.
    const name = screen.getByLabelText(/Name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "morning-standup" } });
    // Instruction is still empty → Save disabled.
    const save = screen.getByTestId("add-wakeup-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("E: Save button disabled when Name normalizes to empty slug (e.g. '!!!')", () => {
    renderDialog();
    const name = screen.getByLabelText(/Name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "!!!" } });
    const instruction = screen.getByLabelText(/Instruction/i) as HTMLTextAreaElement;
    fireEvent.change(instruction, { target: { value: "do the thing" } });
    // Slug normalization strips all non-[a-z0-9]+ → empty → Save disabled.
    const save = screen.getByTestId("add-wakeup-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("F: Save fires onSubmit with correctly-shaped WakeupSpecWire payload (daily default)", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "morning-standup" } });
    fireEvent.change(screen.getByLabelText(/Instruction/i), { target: { value: "check the box" } });
    // Schedule stays daily default (09:00).
    const save = screen.getByTestId("add-wakeup-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const spec = onSubmit.mock.calls[0][0] as {
      name: string;
      enabled: boolean;
      schedule: Record<string, unknown>;
      instruction: string;
    };
    expect(spec.name).toBe("morning-standup");
    expect(spec.enabled).toBe(true);
    expect(spec.instruction).toBe("check the box");
    expect(spec.schedule.type).toBe("daily");
    expect(spec.schedule.at).toBe("09:00");
    // timezone included for daily
    expect(typeof spec.schedule.timezone).toBe("string");
  });

  it("G: Cancel calls onOpenChange(false) without calling onSubmit", () => {
    const { onSubmit, onOpenChange } = renderDialog();
    const cancel = screen.getByTestId("add-wakeup-cancel");
    fireEvent.click(cancel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("H: onSubmit rejection surfaces error inline; dialog stays open; Save re-enables", async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error("collision"));
    const { onOpenChange } = renderDialog({ onSubmit: rejecting });
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "morning-standup" } });
    fireEvent.change(screen.getByLabelText(/Instruction/i), { target: { value: "x" } });
    const save = screen.getByTestId("add-wakeup-save") as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => expect(rejecting).toHaveBeenCalledTimes(1));
    // Error surfaces inline.
    await waitFor(() => expect(screen.getByText(/collision/)).toBeTruthy());
    // Dialog was NOT asked to close.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Save re-enables (saving is false after finally).
    expect(save.disabled).toBe(false);
  });

  it("I: Timezone input is HIDDEN when schedule type is Interval; VISIBLE when Daily / Weekly / One-shot", () => {
    renderDialog();
    // Default is daily → tz input visible.
    expect(screen.queryByTestId("add-wakeup-tz-input")).toBeTruthy();

    const typeSelect = screen.getByLabelText(/Schedule type/i) as HTMLSelectElement;
    // Switch to interval → tz input HIDDEN.
    fireEvent.change(typeSelect, { target: { value: "interval" } });
    expect(screen.queryByTestId("add-wakeup-tz-input")).toBeNull();

    // Switch to weekly → tz visible.
    fireEvent.change(typeSelect, { target: { value: "weekly" } });
    expect(screen.queryByTestId("add-wakeup-tz-input")).toBeTruthy();

    // Switch to one_shot → tz visible.
    fireEvent.change(typeSelect, { target: { value: "one_shot" } });
    expect(screen.queryByTestId("add-wakeup-tz-input")).toBeTruthy();
  });

  it("J: Timezone input placeholder contains the auto-detected tz (mocked to Europe/London)", async () => {
    // Reset modules so the shared-module mock is applied to AddWakeupDialog's import.
    vi.resetModules();
    vi.doMock("./WakeupFormShared", async () => {
      const actual = await vi.importActual<typeof import("./WakeupFormShared")>("./WakeupFormShared");
      return {
        ...actual,
        detectBrowserTimezone: () => "Europe/London",
      };
    });
    const { AddWakeupDialog: FreshDialog } = await import("./AddWakeupDialog");
    render(
      <FreshDialog
        open={true}
        onOpenChange={() => {}}
        hue={200}
        scope="identity"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const tz = screen.getByTestId("add-wakeup-tz-input") as HTMLInputElement;
    expect(tz.placeholder).toContain("Europe/London");

    vi.doUnmock("./WakeupFormShared");
  });

  it("K: When Timezone input is left empty and schedule type is Daily, Save fires onSubmit with spec.schedule.timezone === detectedTz (fallback)", async () => {
    // Fresh mock so detected tz is deterministic.
    vi.resetModules();
    vi.doMock("./WakeupFormShared", async () => {
      const actual = await vi.importActual<typeof import("./WakeupFormShared")>("./WakeupFormShared");
      return {
        ...actual,
        detectBrowserTimezone: () => "Europe/London",
      };
    });
    const { AddWakeupDialog: FreshDialog } = await import("./AddWakeupDialog");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <FreshDialog
        open={true}
        onOpenChange={() => {}}
        hue={200}
        scope="identity"
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "s" } });
    fireEvent.change(screen.getByLabelText(/Instruction/i), { target: { value: "x" } });
    // Do NOT fill tz — leave empty. Default schedule is daily.
    fireEvent.click(screen.getByTestId("add-wakeup-save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const spec = onSubmit.mock.calls[0][0] as { schedule: Record<string, unknown> };
    expect(spec.schedule.timezone).toBe("Europe/London");

    vi.doUnmock("./WakeupFormShared");
  });

  it("L: When Timezone input is filled ('UTC') and schedule type is Daily, Save fires onSubmit with spec.schedule.timezone === 'UTC' (user override wins)", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "s" } });
    fireEvent.change(screen.getByLabelText(/Instruction/i), { target: { value: "x" } });

    const tz = screen.getByTestId("add-wakeup-tz-input") as HTMLInputElement;
    fireEvent.change(tz, { target: { value: "UTC" } });

    fireEvent.click(screen.getByTestId("add-wakeup-save"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const spec = onSubmit.mock.calls[0][0] as { schedule: Record<string, unknown> };
    expect(spec.schedule.timezone).toBe("UTC");
  });
});
