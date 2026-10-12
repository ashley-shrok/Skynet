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

const base = { hostId: 7, identityKey: "wren", currentTitle: "Old title" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("promptAndRenameIdentity", () => {
  it("prefills the prompt with the current title and writes the trimmed value as task", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("  New title  ");
    const updated = { identityKey: "wren", task: "New title" };
    updateIdentityMock.mockResolvedValue(updated);
    promptAndRenameIdentity(base);
    expect(promptSpy).toHaveBeenCalledWith("Rename conversation", "Old title");
    await vi.waitFor(() => expect(applyIdentityChangeMock).toHaveBeenCalledWith(updated));
    expect(updateIdentityMock).toHaveBeenCalledWith("wren", { task: "New title" }, null, 7);
  });

  it.each([
    ["cancel", null],
    ["blank", "   "],
    ["unchanged", "Old title"],
  ])("does nothing on %s", (_label, value) => {
    vi.spyOn(window, "prompt").mockReturnValue(value);
    promptAndRenameIdentity(base);
    expect(updateIdentityMock).not.toHaveBeenCalled();
  });

  it("rejects a name over the cap without writing", () => {
    vi.spyOn(window, "prompt").mockReturnValue("x".repeat(RENAME_MAX_LENGTH + 1));
    promptAndRenameIdentity(base);
    expect(window.alert).toHaveBeenCalled();
    expect(updateIdentityMock).not.toHaveBeenCalled();
  });

  it("alerts and leaves the store alone when the write fails", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("New title");
    updateIdentityMock.mockRejectedValue(new Error("boom"));
    promptAndRenameIdentity(base);
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith("Rename failed: boom"));
    expect(applyIdentityChangeMock).not.toHaveBeenCalled();
  });
});
