/**
 * PreferencesPhonePane tests — validation, save, and the remove confirm.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesPhonePane } from "./PreferencesPhonePane";

const { updateMyPhoneMock, clearMyPhoneMock } = vi.hoisted(() => ({
  updateMyPhoneMock: vi.fn<(phone: string) => Promise<string>>(),
  clearMyPhoneMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/api/user-phone-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/user-phone-api")>();
  return {
    ...actual,
    updateMyPhone: (phone: string) => updateMyPhoneMock(phone),
    clearMyPhone: () => clearMyPhoneMock(),
  };
});

function renderPane(onPhoneChanged = vi.fn()) {
  render(
    <PreferencesPhonePane phoneE164="+17165550100" onPhoneChanged={onPhoneChanged} />,
  );
  return { onPhoneChanged, input: screen.getByTestId("preferences-phone-input") };
}

describe("PreferencesPhonePane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMyPhoneMock.mockImplementation(async (p) => p);
    clearMyPhoneMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Save is disabled until the number changes", async () => {
    const user = userEvent.setup();
    const { input } = renderPane();
    const save = screen.getByTestId("preferences-phone-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(input, "1");
    expect(save.disabled).toBe(false);
  });

  it("strips formatting and saves as E.164", async () => {
    const user = userEvent.setup();
    const { input, onPhoneChanged } = renderPane();
    await user.clear(input);
    await user.type(input, "+1 (716) 555-0199");
    await user.click(screen.getByTestId("preferences-phone-save"));
    expect(updateMyPhoneMock).toHaveBeenCalledWith("+17165550199");
    await waitFor(() => expect(onPhoneChanged).toHaveBeenCalledWith("+17165550199"));
    expect(screen.getByTestId("preferences-phone-saved")).toBeTruthy();
  });

  it.each(["7165550199", "+1 555", "call me maybe"])(
    "rejects invalid number %j without calling the API",
    async (value) => {
      const user = userEvent.setup();
      const { input } = renderPane();
      await user.clear(input);
      await user.type(input, value);
      await user.click(screen.getByTestId("preferences-phone-save"));
      expect(screen.getByTestId("preferences-phone-error")).toBeTruthy();
      expect(updateMyPhoneMock).not.toHaveBeenCalled();
    },
  );

  it("shows the server error when save fails", async () => {
    updateMyPhoneMock.mockRejectedValue(new Error("Phone is not enabled for this account"));
    const user = userEvent.setup();
    const { input, onPhoneChanged } = renderPane();
    await user.clear(input);
    await user.type(input, "+17165550199");
    await user.click(screen.getByTestId("preferences-phone-save"));
    expect((await screen.findByTestId("preferences-phone-error")).textContent).toContain(
      "not enabled",
    );
    expect(onPhoneChanged).not.toHaveBeenCalled();
  });

  it("remove asks for confirmation mentioning admin re-enable; cancel does nothing", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    const { onPhoneChanged } = renderPane();
    await user.click(screen.getByTestId("preferences-phone-remove"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/admin/i));
    expect(clearMyPhoneMock).not.toHaveBeenCalled();
    expect(onPhoneChanged).not.toHaveBeenCalled();
  });

  it("confirmed remove clears the number and reports null", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const { onPhoneChanged } = renderPane();
    await user.click(screen.getByTestId("preferences-phone-remove"));
    expect(clearMyPhoneMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPhoneChanged).toHaveBeenCalledWith(null));
  });
});
