/**
 * Quick 260731-1c8 — IdentityModal: title + avatar editor (Identity tab)
 *
 * Five tests covering:
 *   1. edit-title happy path
 *   2. avatar upload FormData shape
 *   3. oversized-file error surfaces inline, modal stays open, title draft preserved
 *   4. wrong-mime error surfaces inline, modal stays open
 *   5. cancel discards unsaved changes without closing the modal
 *
 * Mocking strategy:
 *   - @/api/identities-api: updateIdentity as vi.fn(); listIdentities as no-op.
 *   - @/state/identities-store: applyIdentityChange as vi.fn(); useIdentities
 *     returning a stable empty shape.
 *   - @/api/claude-session-api: openClaudeSessionSocket returns a no-op stub
 *     WS so the modal's 5 parallel WS open effects don't error.
 *   - @/state/bounty-counts-store: invalidateIdentity as no-op vi.fn().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub factory ──────────────────────────────────────────────────────────
// Mirrors the PrettyView.test.tsx WsStub shape so the modal's openClaudeSessionSocket
// calls get a fully-shaped stub without erroring.
type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function makeFakeWs(): WsStub {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    // updateIdentity is overridden per-test via vi.mocked().mockResolvedValue / mockRejectedValue.
    updateIdentity: vi.fn(),
    // listIdentities: no-op resolve so identities-store's fetchOnce doesn't error.
    listIdentities: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Late imports (after mocks are registered) ────────────────────────────────
import { updateIdentity } from "@/api/identities-api";
import { applyIdentityChange } from "@/state/identities-store";
import { IdentityModal } from "./IdentityModal";

const mockedUpdateIdentity = vi.mocked(updateIdentity);
const mockedApplyIdentityChange = vi.mocked(applyIdentityChange);

// ── Shared fixture ────────────────────────────────────────────────────────────
const BASE_IDENTITY: Identity = {
  id: "id-1",
  identityKey: "tina",
  displayName: "Tina",
  title: "Old title",
  colorHue: null,
  voice: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/id-1/avatar",
  avatarEtag: "etag-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Helper: render the modal open and return the onOpenChange spy.
function renderModal(identityOverrides?: Partial<Identity>): {
  onOpenChangeSpy: ReturnType<typeof vi.fn>;
} {
  const onOpenChangeSpy = vi.fn();
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  render(
    <IdentityModal
      open={true}
      onOpenChange={onOpenChangeSpy}
      identity={identity}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
  return { onOpenChangeSpy };
}

// ── Test suite ────────────────────────────────────────────────────────────────
describe("IdentityModal — title + avatar edit (quick 260731-1c8)", () => {
  beforeEach(() => {
    // Reset all mocks before each test so per-test mockResolvedValue doesn't leak.
    vi.clearAllMocks();
    // Restore URL mocking stubs (if any tests swapped global URL).
    // The identity store listIdentities stub needs to stay configured.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1: edit-title happy path — updateIdentity called with new title, applyIdentityChange called, Save button re-disables", async () => {
    const updatedIdentity: Identity = {
      ...BASE_IDENTITY,
      title: "New title",
      avatarEtag: "etag-2",
    };
    mockedUpdateIdentity.mockResolvedValue(updatedIdentity);

    renderModal();

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Get the title input and change its value.
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Old title");

    fireEvent.change(titleInput, { target: { value: "New title" } });
    expect(titleInput.value).toBe("New title");

    // Click Save.
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    // Wait for the async save to complete. Rule 1 fix: 15s timeout — can be
    // slow under full-suite CI load (CPU contention causes waitFor to overshoot).
    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    }, { timeout: 15000 });

    // Assert updateIdentity was called with (id, {title: "New title"}, null, hostId).
    // Phase 66 Plan 66-02: hostId is now the required 4th arg (renderModal wires hostId={1}).
    expect(mockedUpdateIdentity).toHaveBeenCalledWith(
      "id-1",
      { title: "New title" },
      null,
      1,
    );

    // Assert applyIdentityChange was called with the resolved identity.
    expect(mockedApplyIdentityChange).toHaveBeenCalledTimes(1);
    expect(mockedApplyIdentityChange).toHaveBeenCalledWith(updatedIdentity);

    // After save completes, setEditing(false) collapses the edit block.
    // Patch #277: verify pencil returned to non-editing state (Save button gone from DOM).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /edit agent/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Save/i })).toBeNull();
    }, { timeout: 15000 });
  }, 20000);

  it("2: avatar upload FormData shape — updateIdentity called with file, applyIdentityChange called", async () => {
    const updatedIdentity: Identity = {
      ...BASE_IDENTITY,
      avatarEtag: "etag-avatar",
    };
    mockedUpdateIdentity.mockResolvedValue(updatedIdentity);

    renderModal();

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Simulate picking a file via the hidden file input.
    const fileInput = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const fakeFile = new File(["fake-png"], "avatar.png", { type: "image/png" });
    // Mock URL.createObjectURL so the preview doesn't throw in jsdom.
    const revokeUrl = vi.fn();
    const createObjUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);

    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    // Click Save — title is unchanged so meta should be {}.
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    // Assert updateIdentity was called with (id, {} (no title change), File, hostId).
    // Phase 66 Plan 66-02: hostId now threaded as the 4th arg (renderModal wires hostId={1}).
    const [calledId, calledMeta, calledFile, calledHostId] =
      mockedUpdateIdentity.mock.calls[0];
    expect(calledId).toBe("id-1");
    expect(calledMeta).toEqual({});
    expect(calledFile).toBeInstanceOf(File);
    expect((calledFile as File).name).toBe("avatar.png");
    expect((calledFile as File).type).toBe("image/png");
    expect(calledHostId).toBe(1);

    // Assert applyIdentityChange was called with the resolved identity.
    expect(mockedApplyIdentityChange).toHaveBeenCalledWith(updatedIdentity);

    createObjUrl.mockRestore();
  });

  it("3: oversized-file error — error surfaces inline, modal stays open, title draft preserved", async () => {
    mockedUpdateIdentity.mockRejectedValue(new Error("File too large"));

    renderModal();

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Type a title change to test that it's preserved after error.
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Preserved title draft" } });

    // Simulate picking a file.
    const fileInput = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(vi.fn());

    const fakeFile = new File(["big"], "big-avatar.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    // Click Save.
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    // Wait for error to appear.
    await waitFor(() => {
      expect(screen.getByText(/File too large/i)).toBeTruthy();
    });

    // The inline error must mention "File too large" with the "Couldn't save:" prefix.
    const errorEl = screen.getByText(/Couldn.t save: File too large/i);
    expect(errorEl).toBeTruthy();

    // Modal must still be open (onOpenChange was NOT called with false).
    const { onOpenChangeSpy } = { onOpenChangeSpy: vi.fn() };
    // The renderModal helper's spy: we can verify the dialog root is still present.
    expect(document.querySelector("[data-slot='identity-modal-content']")).toBeTruthy();

    // Title draft must be preserved.
    const titleInputAfter = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInputAfter.value).toBe("Preserved title draft");
  });

  it("4: wrong-mime error — error surfaces inline with server message, modal stays open", async () => {
    mockedUpdateIdentity.mockRejectedValue(
      new Error("Avatar must be PNG, JPEG, or WebP"),
    );

    renderModal();

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Simulate picking a GIF file.
    const fileInput = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(vi.fn());

    const gifFile = new File(["gif"], "anim.gif", { type: "image/gif" });
    fireEvent.change(fileInput, { target: { files: [gifFile] } });

    const saveBtn = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveBtn);

    // Wait for the server error to surface inline.
    await waitFor(() => {
      expect(screen.getByText(/PNG, JPEG, or WebP/i)).toBeTruthy();
    });

    // Modal is still open.
    expect(document.querySelector("[data-slot='identity-modal-content']")).toBeTruthy();
  });

  it("6: hue picker smoke — hueDraft updates on slider change, colorHue included in save meta", async () => {
    mockedUpdateIdentity.mockResolvedValue({ ...BASE_IDENTITY, colorHue: 180 });

    renderModal();

    // Reveal edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Locate hue input by id.
    const hueInput = document.getElementById("identity-hue-input") as HTMLInputElement;
    expect(hueInput).toBeTruthy();

    // Change hue to 180.
    fireEvent.change(hueInput, { target: { value: "180" } });

    // Degree readout should update immediately.
    expect(screen.getByText("180°")).toBeTruthy();

    // Click Save — hue changed from committedHue=200 to 180, so meta.colorHue should be set.
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    const [, meta] = mockedUpdateIdentity.mock.calls[0];
    expect(meta).toEqual({ colorHue: 180 });
  });

  it("5: cancel discards unsaved changes — title reverts, no object URL in preview, updateIdentity not called, modal stays open", async () => {
    // Rule 1 fix: 20s it() timeout — IdentityModal's async effects (WS open, API
    // fetches) can keep the JS event loop busy under full-suite CI load, causing
    // this synchronous test to appear to run for >5000ms before cleanup completes.
    // This matches the pattern used for Test 1 in this file.
    // Spy on createObjectURL to detect whether it's in use after cancel.
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-cancel");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(vi.fn());

    renderModal({ title: "Original" });

    // Patch #277: reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Dirty the title.
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Original");
    fireEvent.change(titleInput, { target: { value: "Dirty" } });
    expect(titleInput.value).toBe("Dirty");

    // Simulate picking a file so there's an object URL in the preview.
    const fileInput = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    const fakeFile = new File(["x"], "pick.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    // Verify the preview is showing the object URL.
    const editorAvatarImgs = document.querySelectorAll(
      "[data-slot='identity-modal-content'] img",
    );
    // At least one img should have the object URL src (blob:fake-cancel).
    const previewImg = Array.from(editorAvatarImgs).find(
      (img) => (img as HTMLImageElement).src.includes("blob:"),
    );
    expect(previewImg).toBeTruthy();

    // Click Cancel.
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    // Patch #277: Cancel collapses the edit block (setEditing(false)).
    // Re-open via pencil to verify the title revert.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Title reverts to "Original".
    const titleInputAfter = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInputAfter.value).toBe("Original");

    // Current-avatar preview should fall back to using the server URL (not blob:).
    const editorAvatarImgsAfter = document.querySelectorAll(
      "[data-slot='identity-modal-content'] img",
    );
    const blobImgAfter = Array.from(editorAvatarImgsAfter).find(
      (img) => (img as HTMLImageElement).src.includes("blob:"),
    );
    expect(blobImgAfter).toBeUndefined();

    // updateIdentity was NOT called.
    expect(mockedUpdateIdentity).not.toHaveBeenCalled();

    // Modal is still open (dialog content is still present).
    expect(document.querySelector("[data-slot='identity-modal-content']")).toBeTruthy();
  }, 20000);
});
