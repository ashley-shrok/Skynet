/**
 * Phase 90 Plan 90-04 Task 1 — RoleCosmeticEditBlock component tests.
 *
 * Byte-shape sibling of the identity-modal's cosmetic edit block MINUS the
 * inherit/override affordance layer (D-01 explicit rejection). Tests here
 * assert the presence of the four cosmetic inputs (title / color / voice /
 * avatar generator) AND the ABSENCE of any inherit/override language or
 * "revert to role default" buttons — a role IS the source of truth for its
 * cosmetics, so those affordances have no defined target on this surface.
 *
 * Tests (8 cases per plan Task 1 <behavior> + 2 Plan 90-10 additions):
 *   A. render — mount w/ full initial cosmetics → all four inputs pre-filled
 *   B. title edit — typing fires onDraftChange({title})
 *   C. color pick — ColorPicker onChange fires → onDraftChange({colorHue})
 *   D. voice pick — VoicePicker onChange fires → onDraftChange({voice})
 *   E. no revert buttons — none of the inherit/override affordances present
 *   F. no scope switch — role=group aria-label=scope absent (belt+suspenders)
 *   G. avatar generator smoke — Generate button renders, triggerable
 *   H. empty initial — mounts w/ initial={} → neutral fallbacks
 *   I. Plan 90-10 HIGH fix — manual upload passes File through onDraftChange.avatarFile
 *      (regression guard: pre-plan tuple hole discarded the file).
 *   J. Plan 90-10 MEDIUM fix — clearing a title that was set at mount emits
 *      `cleared: "title"` so the parent can DELETE the frontmatter key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the voice-api so VoicePicker's useEffect fetch doesn't fire in-test.
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  getVoices: vi.fn().mockResolvedValue([
    { display_name: "Alloy", filename: "alloy" },
    { display_name: "Echo", filename: "echo" },
  ]),
  postSpeak: vi.fn().mockResolvedValue(new Blob(["stub"], { type: "audio/mp3" })),
}));

// Mock identities-api so postGenerateAvatarBatch + postManualAvatarCandidate
// don't hit the wire. Also mock roleAvatarUrl so the avatar preview img has
// a deterministic src to assert against.
vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    postGenerateAvatarBatch: vi.fn().mockResolvedValue([
      { id: "c1", url: "blob:c1" },
      { id: "c2", url: "blob:c2" },
      { id: "c3", url: "blob:c3" },
    ]),
    postManualAvatarCandidate: vi.fn().mockResolvedValue({ id: "manual-1" }),
    roleAvatarUrl: (hostId: number, roleName: string) =>
      `/roles/${roleName}/avatar?hostId=${hostId}`,
  };
});

import { RoleCosmeticEditBlock } from "./RoleCosmeticEditBlock";

describe("RoleCosmeticEditBlock — Phase 90 Plan 90-04 (no inherit/override)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test A: render — mounts with full initial cosmetics, all four inputs pre-filled", () => {
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{
          title: "Skynet",
          colorHue: 320,
          voice: "alloy",
          avatar: "box-maintainer.webp",
        }}
        onDraftChange={vi.fn()}
        saving={false}
      />,
    );

    // Title input pre-filled to "Skynet"
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Skynet");

    // ColorPicker rendered — the range slider carries value=320
    const colorSlider = document.getElementById("role-color-picker") as HTMLInputElement | null;
    expect(colorSlider).toBeTruthy();
    expect(colorSlider!.value).toBe("320");

    // Avatar preview img present with the roleAvatarUrl src
    const avatarImg = document.querySelector(
      'img[data-testid="role-cosmetic-avatar-preview"]',
    ) as HTMLImageElement | null;
    expect(avatarImg).toBeTruthy();
    expect(avatarImg!.getAttribute("src")).toContain("/roles/box-maintainer/avatar");
  });

  it("Test B: title edit — typing fires onDraftChange({title})", () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Skynet Guardian" } });

    // onDraftChange fired with the new title
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Skynet Guardian" }),
    );
  });

  it("Test C: color pick — ColorPicker onChange fires onDraftChange({colorHue})", () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    const colorSlider = document.getElementById("role-color-picker") as HTMLInputElement;
    fireEvent.change(colorSlider, { target: { value: "200" } });

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ colorHue: 200 }),
    );
  });

  it("Test D: voice pick — VoicePicker onChange fires onDraftChange({voice})", async () => {
    const { getVoices } = await import("@/api/voice-api");
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    // Wait for the VoicePicker to populate its <option>s from getVoices()
    // (the useEffect fetch resolves on next microtask).
    await vi.waitFor(() => {
      expect(getVoices).toHaveBeenCalled();
      const opt = document.querySelector(
        '#role-voice-picker option[value="echo"]',
      );
      if (!opt) throw new Error("echo option not yet populated");
    });

    const voiceSelect = document.getElementById("role-voice-picker") as HTMLSelectElement;
    fireEvent.change(voiceSelect, { target: { value: "echo" } });

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "echo" }),
    );
  });

  it("Test E: no revert buttons — no inherit/override language present", () => {
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={vi.fn()}
        saving={false}
      />,
    );

    // No "revert to role default" affordance (D-01 rejection).
    expect(screen.queryByText(/revert to role default/i)).toBeNull();
    // No "inherited from role" ghost hint (D-01 rejection).
    expect(screen.queryByText(/inherited from role/i)).toBeNull();
    // Broader — no "inherited" language at all.
    expect(screen.queryByText(/inherited/i)).toBeNull();
    // No revert-title testid.
    expect(document.querySelector('[data-testid="revert-title"]')).toBeNull();
    expect(document.querySelector('[data-testid="revert-voice"]')).toBeNull();
    expect(document.querySelector('[data-testid="revert-color"]')).toBeNull();
    expect(document.querySelector('[data-testid="revert-avatar"]')).toBeNull();
  });

  it("Test F: no scope switch — the identity-modal scope group is absent", () => {
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={vi.fn()}
        saving={false}
      />,
    );

    // The identity modal's role=group aria-label=Scope switch has no place
    // in a role-scope-only component. Belt+suspenders check.
    expect(screen.queryByRole("group", { name: /scope/i })).toBeNull();
  });

  it("Test G: avatar generator smoke — Generate button renders and is clickable", () => {
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{
          title: "Skynet",
          colorHue: 320,
          voice: "alloy",
          avatar: "box-maintainer.webp",
        }}
        onDraftChange={vi.fn()}
        saving={false}
      />,
    );

    // Generate button present.
    const genBtn = screen.getByRole("button", { name: /generate|regenerate/i });
    expect(genBtn).toBeTruthy();

    // Upload button also present (mirrors CreateRoleDialog dual affordance).
    const uploadBtn = screen.getByRole("button", { name: /upload avatar/i });
    expect(uploadBtn).toBeTruthy();
  });

  it("Test H: empty initial — mounts with initial={} → neutral fallbacks (title empty, hue 190)", () => {
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{}}
        onDraftChange={vi.fn()}
        saving={false}
      />,
    );

    // Title input empty
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("");

    // ColorPicker at neutral fallback 190 (D-05 app-accent fallback)
    const colorSlider = document.getElementById("role-color-picker") as HTMLInputElement;
    expect(colorSlider.value).toBe("190");
  });

  // ── Phase 90 Plan 90-10 additions ─────────────────────────────────────────

  it("Test I (Plan 90-10 HIGH): manual upload passes the File through onDraftChange.avatarFile", async () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    // Grab the hidden file input inside the Upload label.
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();

    // Fabricate a File; jsdom + testing-library accept the Files list directly.
    const testFile = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "avatar.png",
      { type: "image/png" },
    );
    Object.defineProperty(fileInput!, "files", {
      value: [testFile],
      writable: false,
    });
    fireEvent.change(fileInput!);

    // Wait for the async postManualAvatarCandidate resolve + onDraftChange emit.
    await vi.waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: expect.stringMatching(/^box-maintainer\.png$/),
          avatarFile: testFile,
        }),
      );
    });
  });

  it("Test J (Plan 90-10 MEDIUM): clearing a title that was set at mount emits cleared:'title'", () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    // Clear the title field entirely.
    fireEvent.change(titleInput, { target: { value: "" } });

    // The clear signal is emitted so the parent can DELETE the frontmatter key.
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "", cleared: "title" }),
    );
  });

  it("Test J2 (Plan 90-10 MEDIUM): typing a non-empty title after clearing does NOT emit cleared", () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ title: "Skynet", colorHue: 320, voice: "alloy" }}
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    // Clear, then type a fresh value.
    fireEvent.change(titleInput, { target: { value: "" } });
    fireEvent.change(titleInput, { target: { value: "Skynet Guardian" } });

    // The last call should NOT carry `cleared`.
    const lastCall = onDraftChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual(
      expect.objectContaining({ title: "Skynet Guardian" }),
    );
    expect(lastCall).not.toHaveProperty("cleared");
  });

  it("Test J3 (Plan 90-10 MEDIUM): clearing a title that was NEVER set does NOT emit cleared", () => {
    const onDraftChange = vi.fn();
    render(
      <RoleCosmeticEditBlock
        roleName="box-maintainer"
        hostId={3}
        initial={{ colorHue: 320 }} // no title
        onDraftChange={onDraftChange}
        saving={false}
      />,
    );

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    // Type something, then clear it.
    fireEvent.change(titleInput, { target: { value: "typed" } });
    onDraftChange.mockClear();
    fireEvent.change(titleInput, { target: { value: "" } });

    // Since initial.title was undefined, the "cleared" signal must NOT fire
    // (the merge has nothing to delete — draft is just empty).
    const lastCall = onDraftChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ title: "" });
    expect(lastCall).not.toHaveProperty("cleared");
  });
});
