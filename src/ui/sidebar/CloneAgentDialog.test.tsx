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
const mockPostManualAvatarCandidate = vi.fn();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    cloneIdentity: (...args: unknown[]) => mockCloneIdentity(...args),
    postGenerateAvatarBatch: (...args: unknown[]) =>
      mockPostGenerateAvatarBatch(...args),
    postManualAvatarCandidate: (...args: unknown[]) =>
      mockPostManualAvatarCandidate(...args),
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
import type { Host } from "@/types/ui-types";
import { CloneAgentDialog } from "./CloneAgentDialog";

// ─── Fixture helper: Host stub (mirrors PrettyConversationsPanel.clone-dialog.test.tsx) ──

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: "5",
    name: "thenasty",
    username: "root",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "password",
    enableTerminal: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: false,
    enableDocker: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  } as Host;
}

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
  mockPostManualAvatarCandidate.mockResolvedValue({ id: "manual-99" });
  // Stub URL.createObjectURL / revokeObjectURL in jsdom
  (globalThis as unknown as Record<string, unknown>).URL = {
    ...(globalThis as unknown as Record<string, { createObjectURL?: unknown; revokeObjectURL?: unknown }>).URL,
    createObjectURL: vi.fn(() => "blob:mock-clone-url"),
    revokeObjectURL: vi.fn(),
  };
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
    const onCreateSession = vi.fn();
    const stubHost = makeHost();
    render(
      <CloneAgentDialog
        open={true}
        onClose={onClose}
        sourceIdentity={source}
        hostId={5}
        sourceHost={stubHost}
        onCreateSession={onCreateSession}
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
      // Phase 66 /close 2026-09-01 follow-up: source's colorHue is threaded
      // through so the clone's on-disk frontmatter inherits it (LOCKED in UI —
      // no picker).
      colorHue: 128,
      avatarCandidateId: null,
      path: "~/",
    });

    // quick-260806-bz7: auto-route into new session fires EXACTLY once with
    // the widened identityMode:"existing" opts shape derived from the resolved
    // Identity, BEFORE onClose.
    await waitFor(() => expect(onCreateSession).toHaveBeenCalledTimes(1));
    expect(onCreateSession).toHaveBeenCalledWith({
      host: stubHost,
      sessionName: "tina-2",
      path: "~/",
      identityMode: "existing",
      identityName: "tina-2",
      identityId: "new-id",
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Ordering: onCreateSession must have been invoked BEFORE onClose.
    const createOrder = onCreateSession.mock.invocationCallOrder[0];
    const closeOrder = onClose.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(closeOrder);
    // onClose called exactly once.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Test 21c: onCreateSession undefined → existing success path (onCloned → onClose) still fires unchanged", async () => {
    const source = makeIdentity();
    const onClose = vi.fn();
    const onCloned = vi.fn();
    // No onCreateSession, no sourceHost — belt-and-suspenders backward-compat.
    render(
      <CloneAgentDialog
        open={true}
        onClose={onClose}
        sourceIdentity={source}
        hostId={5}
        onCloned={onCloned}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    fireEvent.click(screen.getByRole("button", { name: /clone|submit|create/i }));

    await waitFor(() => expect(mockCloneIdentity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // onCloned fires before onClose (existing invariant).
    const clonedOrder = onCloned.mock.invocationCallOrder[0];
    const closeOrder = onClose.mock.invocationCallOrder[0];
    expect(clonedOrder).toBeLessThan(closeOrder);
  });

  it("Test 21d: onCreateSession throws → onClose still fires (try/catch swallow)", async () => {
    const source = makeIdentity();
    const onClose = vi.fn();
    const stubHost = makeHost();
    const onCreateSession = vi.fn(() => {
      throw new Error("route failed");
    });
    render(
      <CloneAgentDialog
        open={true}
        onClose={onClose}
        sourceIdentity={source}
        hostId={5}
        sourceHost={stubHost}
        onCreateSession={onCreateSession}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    fireEvent.click(screen.getByRole("button", { name: /clone|submit|create/i }));

    await waitFor(() => expect(mockCloneIdentity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreateSession).toHaveBeenCalledTimes(1));
    // Even though onCreateSession threw synchronously, onClose STILL fires.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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
    // Path resets to the "~/" default (mirrors birth's default)
    expect((screen.getByLabelText(/^path/i) as HTMLInputElement).value).toBe("~/");
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

    // Baseline: path defaults to "~/" so submit is enabled
    expect(submit.disabled).toBe(false);

    // Blank the path — submit disables + inline "Path is required." shows
    fireEvent.change(screen.getByLabelText(/^path/i), { target: { value: "" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Path is required/i)).toBeTruthy();

    // Refill — submit re-enables
    fireEvent.change(screen.getByLabelText(/^path/i), { target: { value: "~/projects/foo" } });
    expect(submit.disabled).toBe(false);
  });

  it("RTL-C1: Upload button visible; picking a file calls postManualAvatarCandidate, shows manual preview, hides source avatar", async () => {
    const source = makeIdentity();
    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Upload button should be present
    expect(screen.getByRole("button", { name: /upload avatar/i })).toBeTruthy();

    // Source avatar is visible before upload
    expect(screen.getByAltText(/Avatar for tina/i)).toBeTruthy();

    // Trigger file upload
    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const testFile = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    await waitFor(() => expect(mockPostManualAvatarCandidate).toHaveBeenCalledTimes(1));
    expect(mockPostManualAvatarCandidate).toHaveBeenCalledWith({ file: testFile });

    // Manual preview should appear
    await waitFor(() => expect(screen.getByAltText(/manual avatar preview/i)).toBeTruthy());

    // Source avatar preview should no longer be showing (manual wins)
    expect(screen.queryByAltText(/Avatar for tina/i)).toBeNull();
  });

  it("RTL-C2: manual upload → Clone calls cloneIdentity with the manual id as avatarCandidateId", async () => {
    mockPostManualAvatarCandidate.mockResolvedValueOnce({ id: "manual-99" });
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

    // Fill name
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });

    // Upload file
    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;
    const testFile = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [testFile] } });
    await waitFor(() => expect(mockPostManualAvatarCandidate).toHaveBeenCalledTimes(1));

    // Click Clone
    const cloneBtn = screen.getByRole("button", { name: /clone|submit|create/i });
    fireEvent.click(cloneBtn);

    await waitFor(() => expect(mockCloneIdentity).toHaveBeenCalledTimes(1));
    expect(mockCloneIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ avatarCandidateId: "manual-99" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Test 25: shows 'Preparing session…' status while cloneIdentity is pending, clears on resolve [260806-dwe]", async () => {
    // The clone endpoint now blocks ~25s on the backend running startHarness-
    // OnIdentity before responding 201. Without a visible signal during that
    // gap, the modal looks hung — user retries, second POST collides with
    // half-created state, cascade. This test guards the accessible status
    // line (role="status" aria-live="polite") that renders under the modal
    // body while `submitting === true`.
    const source = makeIdentity();
    let resolveClone: (v: Identity) => void = () => {};
    mockCloneIdentity.mockReturnValueOnce(
      new Promise<Identity>((r) => {
        resolveClone = r;
      }),
    );

    render(
      <CloneAgentDialog
        open={true}
        onClose={() => {}}
        sourceIdentity={source}
        hostId={5}
      />,
    );

    // Fill required fields + click Clone (title/voice/path already pre-filled).
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "tina-2" } });
    fireEvent.click(
      screen.getByRole("button", { name: /clone|submit|create/i }),
    );

    // Preparing text appears while the cloneIdentity promise is pending.
    await waitFor(() => {
      expect(screen.getByText(/preparing session/i)).toBeTruthy();
    });

    // Resolve the promise → submitting flips false → preparing text clears.
    resolveClone(
      makeIdentity({
        id: "new-id",
        identityKey: "tina-2",
        displayName: "tina-2",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText(/preparing session/i)).toBeNull();
    });
  });
});
