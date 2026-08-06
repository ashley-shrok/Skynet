// ─── CloneAgentDialog coverage (Phase 22 SRIC-03 Plan 22-03 Task 2)
//
// Tests 17-23 cover the new CloneAgentDialog component that ships with the
// Clone context-menu item and Panel-owned open state. Tests 13-16 for the
// row + panel wiring live in sibling test files.
//
// Behavior spec (from 22-03-PLAN.md <behavior>):
//   Test 17: renders Name (blank), Title (pre-filled from source),
//     Voice (pre-filled from source), Avatar preview (source's data-url)
//   Test 18 (LOCKED gates): does NOT render Host / Role / Color pickers
//     as editable UI (grep-style DOM query returns no input controls)
//   Test 19: Empty Name disables Submit; Name failing IDENTITY_KEY_RE
//     also disables Submit
//   Test 20: Regenerate avatar fires postGenerateAvatarBatch with
//     {name, title, brief: editedTitle} — brief seeded from title per
//     plan Action step 1 decision
//   Test 21: On submit, calls cloneIdentity({sourceIdentityKey, hostId,
//     newName, title, voice, avatarCandidateId}); dialog closes on success
//   Test 22: On 409, dialog stays open + inline error
//     `Name "<name>" is already in use — pick a different name.`
//   Test 23: On modal close, all state resets (name, title, voice, avatar,
//     candidates)
//
// Mock pattern lifted from CreateRoleDialog.test.tsx (react-i18next
// passthrough; mock cloneIdentity + IdentityCloneCollisionError + typed
// helpers). No hostTree needed — dialog receives sourceIdentity + hostId.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — the new cloneIdentity from Task 1 +
// IdentityCloneCollisionError + postGenerateAvatarBatch reuse.
const mockCloneIdentity = vi.fn();
const mockPostGenerateAvatarBatch = vi.fn();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    cloneIdentity: (...args: unknown[]) => mockCloneIdentity(...args),
    postGenerateAvatarBatch: (...args: unknown[]) =>
      mockPostGenerateAvatarBatch(...args),
  };
});

// Mock VoicePicker to a simple <input> so tests can drive it via change events.
vi.mock("@/features/pretty-view/pickers/VoicePicker", () => ({
  VoicePicker: (props: {
    value: string;
    onChange: (v: string) => void;
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
  }) => {
    return (
      <input
        data-testid="voice-picker-mock"
        id={props.id}
        aria-label={props.ariaLabel ?? "Voice"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
      />
    );
  },
}));

import { IdentityCloneCollisionError } from "@/api/identities-api";
import type { Identity } from "@/api/identities-api";
import { CloneAgentDialog } from "./CloneAgentDialog";

// ─── Fixture helper: source Identity ────────────────────────────────────────

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    id: "src-id",
    identityKey: "tina",
    displayName: "tina",
    title: "Fleet Operator",
    colorHue: 128,
    voice: "Elena.wav",
    avatarMime: "image/png",
    avatarUrl: "/identities/src-id/avatar",
    avatarEtag: "src-etag",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCloneIdentity.mockResolvedValue(
    makeIdentity({ id: "new-id", identityKey: "tina-2", displayName: "tina-2" }),
  );
  mockPostGenerateAvatarBatch.mockResolvedValue([
    { id: "cand-1", url: "data:image/png;base64,AAAA" },
    { id: "cand-2", url: "data:image/png;base64,BBBB" },
    { id: "cand-3", url: "data:image/png;base64,CCCC" },
  ]);
});

afterEach(() => {
  // @testing-library auto-unmounts.
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CloneAgentDialog", () => {
  it("Test 17: renders Name (blank), Title (pre-filled), Voice (pre-filled), Avatar preview (source's URL)", () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Name input — blank
    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    expect(nameInput.value).toBe("");

    // Title — pre-filled from source
    const titleInput = screen.getByLabelText(/^title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Fleet Operator");

    // Voice mock — pre-filled from source
    const voice = screen.getByTestId("voice-picker-mock") as HTMLInputElement;
    expect(voice.value).toBe("Elena.wav");

    // Avatar preview — should render an <img> with the source's avatarUrl
    // (initial state before any Regenerate)
    const img = screen.getByAltText(/avatar/i) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain(source.avatarUrl);
  });

  it("Test 18 (LOCKED gates): does NOT render Host/Role/Color pickers as editable UI", () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Assert no labeled inputs for host/role/color
    expect(screen.queryByLabelText(/^host/i)).toBeNull();
    expect(screen.queryByLabelText(/^role/i)).toBeNull();
    expect(screen.queryByLabelText(/^color/i)).toBeNull();
    // Assert no listbox (would be the case if a host picker were rendered)
    expect(screen.queryByRole("listbox")).toBeNull();
    // Assert no combobox with host/role/color name
    expect(screen.queryByRole("combobox", { name: /host|role|color/i })).toBeNull();
  });

  it("Test 19: Empty Name disables Submit; invalid Name (uppercase) also disables Submit", () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Initial state: name blank → submit disabled
    const submit = screen.getByRole("button", { name: /clone|submit|create/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // Invalid name: uppercase → still disabled
    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "BadName" } });
    expect(submit.disabled).toBe(true);

    // Valid name → enabled
    fireEvent.change(nameInput, { target: { value: "tina-2" } });
    expect(submit.disabled).toBe(false);
  });

  it("Test 20: Regenerate avatar fires postGenerateAvatarBatch with brief=editedTitle", async () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Fill name (needed by handleGenerate)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    // Edit title so we can assert brief=editedTitle
    const titleInput = screen.getByLabelText(/^title/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Edited Title" } });

    // Click Regenerate
    const regenBtn = screen.getByRole("button", { name: /regenerate|generate/i });
    fireEvent.click(regenBtn);

    await waitFor(() => {
      expect(mockPostGenerateAvatarBatch).toHaveBeenCalledTimes(1);
    });
    expect(mockPostGenerateAvatarBatch).toHaveBeenCalledWith({
      name: "tina-2",
      title: "Edited Title",
      brief: "Edited Title",
    });
  });

  it("Test 21: On submit, calls cloneIdentity({sourceIdentityKey, hostId, newName, title, voice, avatarCandidateId}); dialog closes on success", async () => {
    const source = makeIdentity();
    const onClose = vi.fn();
    render(
      <CloneAgentDialog
        open={true}
        onClose={onClose}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Fill required fields (title/voice already pre-filled)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });

    const submit = screen.getByRole("button", { name: /clone|submit|create/i });
    fireEvent.click(submit);

    await waitFor(() => expect(mockCloneIdentity).toHaveBeenCalledTimes(1));
    expect(mockCloneIdentity).toHaveBeenCalledWith({
      sourceIdentityKey: "tina",
      hostId: 5,
      newName: "tina-2",
      title: "Fleet Operator",
      voice: "Elena.wav",
      avatarCandidateId: null,
      path: "~",
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Test 22: On 409 collision, dialog stays open and renders inline 'already in use' error", async () => {
    mockCloneIdentity.mockRejectedValueOnce(
      new IdentityCloneCollisionError("tina-2"),
    );
    const source = makeIdentity();
    const onClose = vi.fn();
    render(
      <CloneAgentDialog
        open={true}
        onClose={onClose}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    fireEvent.click(screen.getByRole("button", { name: /clone|submit|create/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Name.*tina-2.*already in use/i),
      ).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Test 23: On modal close, all state resets (name, title, voice, avatar, candidates)", async () => {
    const source = makeIdentity();
    const { rerender } = render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Fill/change fields
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Edited" } });
    // Regenerate to add candidates
    fireEvent.click(screen.getByRole("button", { name: /regenerate|generate/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalled());

    // Close (open → false)
    rerender(
      <CloneAgentDialog
        open={false}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Re-open — all fields reset (name blank, title back to source's, no candidates)
    rerender(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^title/i) as HTMLInputElement).value).toBe("Fleet Operator");
    // Path resets to the "~" default (mirrors birth's default)
    expect((screen.getByLabelText(/^path/i) as HTMLInputElement).value).toBe("~");
    // No candidate images (only the source avatar preview) — count is either 0
    // avatar candidates rendered or the candidate row is absent
    expect(screen.queryByAltText(/Avatar candidate/i)).toBeNull();
  });

  it("Test 24: Create disabled when path is blanked; enabled again when path is refilled", async () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Fill name so nameValid + titleValid (source-prefilled title) both true.
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    const submit = screen.getByRole("button", { name: /clone|submit|create/i }) as HTMLButtonElement;

    // Baseline: path defaults to "~" so submit is enabled
    expect(submit.disabled).toBe(false);

    // Blank the path — submit disables + inline "Path is required." shows
    fireEvent.change(screen.getByLabelText(/^path/i), { target: { value: "" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Path is required/i)).toBeTruthy();

    // Refill — submit re-enables
    fireEvent.change(screen.getByLabelText(/^path/i), { target: { value: "~/projects/foo" } });
    expect(submit.disabled).toBe(false);
  });
});
