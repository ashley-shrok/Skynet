/**
 * PreferencesAccountPane tests
 *
 * Picture cases:
 *   1. Renders initials fallback when avatarPath=null
 *   2. Renders <img> when avatarPath="abc.png"
 *   3. Choosing a file shows local preview immediately
 *   4. Successful upload calls onAvatarChanged with response.avatarPath
 *   5. Failed upload reverts preview and shows an inline error (no toast)
 *   6. Clicking Remove calls removeUserAvatar and onAvatarChanged(null) on success
 *   7. Failed Remove shows inline error but does NOT call onAvatarChanged
 * Account cases: name + role line, account card, Log out asks first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesAccountPane, PreferencesAccountCard } from "./PreferencesAccountPane";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";

vi.mock("@/main-axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main-axios")>();
  return { ...actual, logoutUser: vi.fn().mockResolvedValue(undefined) };
});

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

const avatarImg = (): HTMLImageElement | null =>
  screen.getByTestId("preferences-account-avatar").querySelector("img");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PreferencesAccountPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: upload succeeds
    mockUpload.mockResolvedValue({ avatarPath: "new-avatar.png" });
    // Default: remove succeeds
    mockRemove.mockResolvedValue(undefined);
  });
  afterEach(() => {
    __resetKitDialogsForTests();
  });

  it("1. renders initials fallback when avatarPath=null", () => {
    render(
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );
    const avatar = screen.getByTestId("preferences-account-avatar");
    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.textContent).toContain("R");
    // No picture → no Remove.
    expect(screen.queryByTestId("preferences-account-remove-btn")).toBeNull();
  });

  it("2. renders <img> when avatarPath='abc.png'", () => {
    render(
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath="abc.png"
        onAvatarChanged={vi.fn()}
      />,
    );
    const img = avatarImg()!;
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
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );

    const fileInput = screen.getByTestId("preferences-account-file-input") as HTMLInputElement;
    const fakeFile = new File(["data"], "photo.png", { type: "image/png" });

    await user.upload(fileInput, fakeFile);

    // Local preview should be shown immediately
    const img = avatarImg()!;
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
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath={null}
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const fileInput = screen.getByTestId("preferences-account-file-input") as HTMLInputElement;
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
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath={null}
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const fileInput = screen.getByTestId("preferences-account-file-input") as HTMLInputElement;
    const fakeFile = new File(["data"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, fakeFile);

    await waitFor(() => {
      const errorEl = screen.getByTestId("preferences-account-error");
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain("Upload failed");
    });

    // Preview should be reverted — no img tag with blob src
    expect(avatarImg()).toBeNull();
    // onAvatarChanged should NOT have been called
    expect(onAvatarChanged).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("6. clicking Remove calls removeUserAvatar and onAvatarChanged(null) on success", async () => {
    const user = userEvent.setup();
    const onAvatarChanged = vi.fn();
    mockRemove.mockResolvedValue(undefined);

    render(
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath="existing.png"
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const removeBtn = screen.getByTestId("preferences-account-remove-btn");
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
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath="existing.png"
        onAvatarChanged={onAvatarChanged}
      />,
    );

    const removeBtn = screen.getByTestId("preferences-account-remove-btn");
    await user.click(removeBtn);

    await waitFor(() => {
      const errorEl = screen.getByTestId("preferences-account-error");
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain("Couldn't remove");
    });

    expect(onAvatarChanged).not.toHaveBeenCalled();
  });

  it("8. shows the name and the role line", () => {
    const { rerender } = render(
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={true}
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "robin" })).toBeTruthy();
    expect(screen.getByTestId("preferences-account-meta").textContent).toContain("Administrator");
    rerender(
      <PreferencesAccountPane
        userId="user-123"
        username="robin"
        isAdmin={false}
        avatarPath={null}
        onAvatarChanged={vi.fn()}
      />,
    );
    expect(screen.getByTestId("preferences-account-meta").textContent).toContain("Member");
  });

  it("9. Log out asks first; cancel stays logged in, confirm logs out", async () => {
    const onLogout = vi.fn();
    window.addEventListener("skynet:logout", onLogout);
    try {
      const answers = [false, true];
      const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? false });
      const user = userEvent.setup();
      render(
        <PreferencesAccountPane
          userId="user-123"
          username="robin"
          isAdmin={false}
          avatarPath={null}
          onAvatarChanged={vi.fn()}
        />,
      );
      await user.click(screen.getByTestId("preferences-account-logout"));
      await waitFor(() => expect(dialogs.calls).toHaveLength(1));
      expect(dialogs.calls[0].opts.title).toBe("Log out?");
      expect(onLogout).not.toHaveBeenCalled();

      await user.click(screen.getByTestId("preferences-account-logout"));
      await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener("skynet:logout", onLogout);
    }
  });
});

describe("PreferencesAccountCard", () => {
  it("shows the name, the picture and 'Picture, log out'; click selects", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PreferencesAccountCard
        userId="user-123"
        username="robin"
        avatarPath="abc.png"
        selected={true}
        drill={false}
        onSelect={onSelect}
      />,
    );
    const card = screen.getByTestId("preferences-nav-account");
    expect(card.textContent).toContain("robin");
    expect(card.textContent).toContain("Picture, log out");
    expect(card.getAttribute("aria-current")).toBe("true");
    expect(card.querySelector("img")?.getAttribute("src")).toContain("abc.png");
    await user.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
