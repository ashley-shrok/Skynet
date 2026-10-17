import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const updateIdentityMock = vi.fn();
const applyIdentityChangeMock = vi.fn();
vi.mock("@/api/identities-api", () => ({
  updateIdentity: (...args: unknown[]) => updateIdentityMock(...args),
}));
vi.mock("@/state/identities-store", () => ({
  applyIdentityChange: (...args: unknown[]) => applyIdentityChangeMock(...args),
}));

import { promptAndRenameIdentity, RENAME_MAX_LENGTH } from "./rename-identity";
import {
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
  type KitPromptOptions,
  type KitAlertOptions,
} from "@/components/kit";

const base = { hostId: 7, identityKey: "wren", currentTitle: "Old title" };

/** Let the fire-and-forget async body run to completion. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  __resetKitDialogsForTests();
  vi.restoreAllMocks();
});

describe("promptAndRenameIdentity", () => {
  it("prefills the prompt with the current title and writes the trimmed value as task", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "  New title  " });
    const updated = { identityKey: "wren", task: "New title" };
    updateIdentityMock.mockResolvedValue(updated);
    promptAndRenameIdentity(base);
    await vi.waitFor(() => expect(applyIdentityChangeMock).toHaveBeenCalledWith(updated));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].kind).toBe("prompt");
    const opts = dialogs.calls[0].opts as KitPromptOptions;
    expect(opts.title).toBe("Rename conversation");
    expect(opts.defaultValue).toBe("Old title");
    expect(updateIdentityMock).toHaveBeenCalledWith("wren", { task: "New title" }, null, 7);
  });

  it.each([
    ["cancel", null],
    ["blank", "   "],
    ["unchanged", "Old title"],
  ])("does nothing on %s", async (_label, value) => {
    const dialogs = autoAnswerKitDialogs({ prompt: value });
    promptAndRenameIdentity(base);
    await flush();
    expect(dialogs.calls).toHaveLength(1);
    expect(updateIdentityMock).not.toHaveBeenCalled();
  });

  it("rejects a name over the cap without writing", async () => {
    const tooLong = "x".repeat(RENAME_MAX_LENGTH + 1);
    // Mirror the real dialog: validate blocks submit, so the user can only cancel.
    const dialogs = autoAnswerKitDialogs({
      prompt: (o) => (o.validate?.(tooLong) ? null : tooLong),
    });
    promptAndRenameIdentity(base);
    await flush();
    const opts = dialogs.calls[0].opts as KitPromptOptions;
    expect(opts.validate?.(tooLong)).toBe(`Name must be ${RENAME_MAX_LENGTH} characters or fewer.`);
    expect(opts.validate?.("x".repeat(RENAME_MAX_LENGTH))).toBeFalsy();
    expect(updateIdentityMock).not.toHaveBeenCalled();
  });

  it("alerts and leaves the store alone when the write fails", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "New title" });
    updateIdentityMock.mockRejectedValue(new Error("boom"));
    promptAndRenameIdentity(base);
    await vi.waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    const alert = dialogs.calls.find((c) => c.kind === "alert")!.opts as KitAlertOptions;
    expect(alert.title).toMatch(/rename/i);
    expect(alert.body).toBe("boom");
    expect(applyIdentityChangeMock).not.toHaveBeenCalled();
  });
});
