/**
 * PreferencesGeneralPane tests
 *
 * Seven behavior cases:
 *   1. Renders initials fallback when avatarPath=null
 *   2. Renders <img> when avatarPath="abc.png"
 *   3. Choosing a file shows local preview immediately
 *   4. Successful upload calls onAvatarChanged with response.avatarPath
 *   5. Failed upload reverts preview and shows an inline error (no toast)
 *   6. Clicking Remove calls removeUserAvatar and onAvatarChanged(null) on success
 *   7. Failed Remove shows inline error but does NOT call onAvatarChanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesGeneralPane } from "./PreferencesGeneralPane";

// ─── Mock the avatar API helpers ─────────────────────────────────────────────

vi.mock("@/api/user-preferences-api", () => ({
  uploadUserAvatar: vi.fn(),
  removeUserAvatar: vi.fn(),
  putPinnedIds: vi.fn(),
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
  toBareIdentityKey: vi.fn((id: string) => id),
}));

import {
  uploadUserAvatar,
  removeUserAvatar,
} from "@/api/user-preferences-api";

const mockUpload = uploadUserAvatar as ReturnType<typeof vi.fn>;
const mockRemove = removeUserAvatar as ReturnType<typeof vi.fn>;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PreferencesGeneralPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: upload succeeds
    mockUpload.mockResolvedValue({ avatarPath: "new-avatar.png" });
    // Default: remove succeeds
    mockRemove.mockResolvedValue(undefined);
  });

  it("1. renders initials fallback when avatarPath=null", () => {
    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );
    expect(screen.getByTestId("preferences-general-initials")).toBeTruthy();
    expect(screen.queryByTestId("preferences-general-avatar-img")).toBeNull();
  });

  it("2. renders <img> when avatarPath='abc.png'", () => {
    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath="abc.png"
        onAvatarChanged={vi.fn()}
      />,
    );
    const img = screen.getByTestId("preferences-general-avatar-img");
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toContain("/users/");
    expect((img as HTMLImageElement).src).toContain("abc.png");
  });

  it("3. choosing a file shows local preview immediately (before upload resolves)", async () => {
    const user = userEvent.setup();

    // Mock URL.createObjectURL to return a fake blob URL
    const fakeUrl = "blob:http://localhost/fake-preview";
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue(fakeUrl),
      revokeObjectURL: vi.fn(),
    });

    // Make upload hang so we can observe the local preview state
    let resolveUpload!: (val: { avatarPath: string }) => void;
    mockUpload.mockImplementation(
      () =>
        new Promise<{ avatarPath: string }>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );

    const fileInput = screen.getByTestId("preferences-general-file-input") as HTMLInputElement;
    const fakeFile = new File(["data"], "photo.png", { type: "image/png" });

    await user.upload(fileInput, fakeFile);

    // Local preview should be shown immediately
    const img = screen.getByTestId("preferences-general-avatar-img");
    expect((img as HTMLImageElement).src).toBe(fakeUrl);

    // Clean up the hanging promise
    resolveUpload({ avatarPath: "new.png" });

    vi.unstubAllGlobals();
  });

  it("4. successful upload calls onAvatarChanged with response.avatarPath", async () => {
    const user = userEvent.setup();
    const onAvatarChanged = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:fake"),
      revokeObjectURL: vi.fn(),
    });

    mockUpload.mockResolvedValue({ avatarPath: "server-minted.png" });

    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath={null}
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const fileInput = screen.getByTestId("preferences-general-file-input") as HTMLInputElement;
    const fakeFile = new File(["data"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, fakeFile);

    await waitFor(() => {
      expect(onAvatarChanged).toHaveBeenCalledWith("server-minted.png");
    });

    vi.unstubAllGlobals();
  });

  it("5. failed upload reverts preview and shows inline error (no toast)", async () => {
    const user = userEvent.setup();
    const onAvatarChanged = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:fake"),
      revokeObjectURL: vi.fn(),
    });

    mockUpload.mockRejectedValue(new Error("Network error"));

    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath={null}
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const fileInput = screen.getByTestId("preferences-general-file-input") as HTMLInputElement;
    const fakeFile = new File(["data"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, fakeFile);

    await waitFor(() => {
      const errorEl = screen.getByTestId("preferences-general-error");
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain("Upload failed");
    });

    // Preview should be reverted — no img tag with blob src
    expect(screen.queryByTestId("preferences-general-avatar-img")).toBeNull();
    // onAvatarChanged should NOT have been called
    expect(onAvatarChanged).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("6. clicking Remove calls removeUserAvatar and onAvatarChanged(null) on success", async () => {
    const user = userEvent.setup();
    const onAvatarChanged = vi.fn();
    mockRemove.mockResolvedValue(undefined);

    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath="existing.png"
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const removeBtn = screen.getByTestId("preferences-general-remove-btn");
    await user.click(removeBtn);

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith("user-123");
      expect(onAvatarChanged).toHaveBeenCalledWith(null);
    });
  });

  it("7. failed Remove shows inline error but does NOT call onAvatarChanged", async () => {
    const user = userEvent.setup();
    const onAvatarChanged = vi.fn();
    mockRemove.mockRejectedValue(new Error("Server error"));

    render(
      <PreferencesGeneralPane
        userId="user-123"
        avatarPath="existing.png"
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const removeBtn = screen.getByTestId("preferences-general-remove-btn");
    await user.click(removeBtn);

    await waitFor(() => {
      const errorEl = screen.getByTestId("preferences-general-error");
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain("Couldn't remove");
    });

    expect(onAvatarChanged).not.toHaveBeenCalled();
  });
});
