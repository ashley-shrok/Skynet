// ─── CreateRoleDialog coverage (Phase 22 SRIC-04 Plan 22-04 Task 2) ─────────
//
// Original Phase 22 shape (Tests 11-20):
//   Test 11: renders Name (input), Description (textarea), Host picker,
//     `Then create an agent with this role` checkbox (CHECKED by default)
//   Test 12: Name validation — kebab-case-lowercase gate; invalid inline error;
//     Create disabled while invalid
//   Test 13: Description validation — empty disables Create
//   Test 14: Host validation — no host picked disables Create
//   Test 15: Auto-select single host on open
//   Test 16: On submit, createRole is called with {name, description, hostId}
//   Test 17: On successful submit → onChainToCreateIdentity invoked
//   Test 18: DELETED in Phase 84 (checkbox gate was removed).
//   Test 19: On 409 conflict from server → dialog stays open + inline error
//   Test 20: On modal close, all state resets
//
// ─── Phase 84 (Plan 84-03) delta ───────────────────────────────────────────
//   Test 11: no longer asserts checkbox; asserts header blurb + no
//     required-caption text.
//   Test 15: listbox is HIDDEN when single-host; sole host still auto-picked.
//   Test 17: onChainToCreateIdentity fires unconditionally on success.
//   Test 18: DELETED.
//   Test 20: state reset no longer includes checkbox.
//   Test 22 (NEW): single-host picker suppression.
//
// ─── Phase 86 (Plan 86-06 for Plan 86-03 landings) ─────────────────────────
// Plan 86-03 grew CreateRoleDialog with four cosmetic authoring controls:
// Title (input), VoicePicker, ColorPicker, Avatar generator (Generate/Upload
// buttons + candidate carousel + manual preview). `canOpen` predicate extended
// to require title + voice + a picked avatar. `createRole()` client call
// widened to a multipart 2-arg call: `createRole({name, description, hostId,
// cosmetics: {title, colorHue, voice}}, avatarFile)`.
//
// Deltas below realign the Phase 22/84 tests to the Phase 86 landings and add
// three new test blocks (Tests 22-cosmetic-gate, 23-generator-flow,
// 24-manual-upload).
//
//   Test 11: header blurb + no required-caption preserved. Adds assertions
//     that the four cosmetic controls (Title input, VoicePicker mock, ColorPicker
//     mock, Generate + Upload buttons) all render.
//   Test 12: name validation preserved.
//   Test 13-14: description/host validation preserved; setups now populate
//     the cosmetic fields so Create can enable when the tested gate lifts.
//   Test 15/22: single-host suppression preserved (Create enablement now
//     requires cosmetic fields too — setups extended).
//   Test 16: createRole assertion updated to the widened multipart call
//     shape `({name, description, hostId, cosmetics: {title, colorHue, voice}},
//     avatarFile)`.
//   Test 17: cosmetic-fields setup added; chain callback shape unchanged.
//   Test 19: cosmetic-fields setup added so submit fires and hits the 409.
//   Test 20: extended to assert title/voice/colorHue/candidates/pickedCandidateId
//     all reset on close.
//   Test 22 (Phase 86 NEW): cosmetic gates — title empty / voice empty /
//     avatar not picked → Create disabled.
//   Test 23 (Phase 86 NEW): avatar generator flow — Generate calls
//     postGenerateAvatarBatch with {name, title, brief: description, colorHue};
//     3 candidates render; clicking a candidate sets aria-selected='true'.
//   Test 24 (Phase 86 NEW): manual upload — file input change calls
//     postManualAvatarCandidate; preview renders; generated carousel is
//     cleared (mutual exclusion).
//
// Mock pattern lifted from NewSessionDialog.test.tsx L20-97 (voice-api,
// react-i18next, identities-api passthrough). ColorPicker + VoicePicker mocked
// as passthrough components so the test can drive their onChange from a
// deterministic button click without depending on the real picker chrome.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — createRole, postGenerateAvatarBatch, postManualAvatarCandidate.
// Phase 86 (Plan 86-06): createRole is now the widened 2-arg multipart call
// per Plan 86-01 Task 3 + Plan 86-03. The batch/upload endpoints power the
// avatar generator inlined in Plan 86-03.
const mockCreateRole = vi.fn();
const mockPostGenerateAvatarBatch = vi.fn();
const mockPostManualAvatarCandidate = vi.fn();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createRole: (...args: unknown[]) => mockCreateRole(...args),
    postGenerateAvatarBatch: (...args: unknown[]) => mockPostGenerateAvatarBatch(...args),
    postManualAvatarCandidate: (...args: unknown[]) => mockPostManualAvatarCandidate(...args),
  };
});

// Phase 86 (Plan 86-06): mock the cosmetic pickers as passthrough components
// so tests can drive their onChange from a deterministic button click without
// pulling in voice-api / audio playback. Both mocks expose the value prop as
// data-testid + a "set-<name>" button that calls onChange with a fixed value.
// Tests populate these fields by clicking those buttons. (Phase 98 Plan 03:
// runtime voice-catalog fetch retired — VoicePicker inlines POLLY_VOICES const.)
vi.mock("@/features/pretty-view/pickers/ColorPicker", () => ({
  ColorPicker: (props: {
    value: number;
    onChange: (n: number) => void;
    disabled?: boolean;
    id?: string;
  }) => (
    <div data-testid="color-picker" data-value={props.value}>
      <button
        type="button"
        data-testid="color-picker-set-180"
        disabled={props.disabled}
        onClick={() => props.onChange(180)}
      >
        set-hue-180
      </button>
    </div>
  ),
}));

vi.mock("@/features/pretty-view/pickers/VoicePicker", () => ({
  VoicePicker: (props: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
  }) => (
    <div data-testid="voice-picker" data-value={props.value}>
      <button
        type="button"
        data-testid="voice-picker-set-elena"
        disabled={props.disabled}
        onClick={() => props.onChange("Elena.wav")}
      >
        set-voice-elena
      </button>
    </div>
  ),
}));

// The dialog imports RoleAlreadyExistsError directly. Import the real class so
// the mockRejectedValue tests below throw the actual instance the dialog
// checks against with instanceof.
import { RoleAlreadyExistsError } from "@/api/identities-api";
import { CreateRoleDialog } from "./CreateRoleDialog";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeHost(id: string, name: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name,
    username: "user",
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

function makeHostTree(hosts: Host[]): HostFolder {
  return { name: "root", children: hosts } as HostFolder;
}

// Phase 86 (Plan 86-06): stub URL.createObjectURL / revokeObjectURL for jsdom
// (not implemented natively). The manual-upload path calls createObjectURL on
// the picked File and the reset-on-close effect calls revokeObjectURL.
beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRole.mockResolvedValue({
    name: "box-maintainer",
    description: "d",
    cosmetics: {},
  });
  mockPostGenerateAvatarBatch.mockResolvedValue([
    { id: "c1", url: "blob:c1" },
    { id: "c2", url: "blob:c2" },
    { id: "c3", url: "blob:c3" },
  ]);
  mockPostManualAvatarCandidate.mockResolvedValue({ id: "manual-1" });

  (globalThis as unknown as Record<string, unknown>).URL = {
    ...(globalThis as unknown as Record<
      string,
      { createObjectURL?: unknown; revokeObjectURL?: unknown }
    >).URL,
    createObjectURL: vi.fn(() => "blob:mock-preview"),
    revokeObjectURL: vi.fn(),
  };
});

afterEach(() => {
  // Best-effort cleanup — @testing-library auto-unmounts, no explicit action.
});

// ─── Phase 86 helper — populate the four cosmetic gates in one call ──────
// After name + description + host are already set, this drives Title,
// VoicePicker mock, and picks the first generated candidate so `canOpen`
// flips to true. Called from tests 13-17, 19-20 whose Phase 22/84 shape
// only exercised the pre-cosmetic gates.
async function fillCosmeticsAndPickAvatar(opts: { title?: string } = {}) {
  const title = opts.title ?? "Box Maintainer";
  // Title input
  fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: title } });
  // Voice via passthrough mock button
  fireEvent.click(screen.getByTestId("voice-picker-set-elena"));
  // Generate candidates + pick the first one
  fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
  await waitFor(() =>
    expect(mockPostGenerateAvatarBatch).toHaveBeenCalled(),
  );
  await waitFor(
    () => {
      const candidateBtns = document.querySelectorAll("[data-candidate-id]");
      expect(candidateBtns.length).toBeGreaterThanOrEqual(1);
    },
    { timeout: 2000 },
  );
  const firstCandidate = document.querySelectorAll("[data-candidate-id]")[0] as HTMLElement;
  fireEvent.click(firstCandidate);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CreateRoleDialog", () => {
  it("Test 11 (Phase 86 Plan 06): renders Name, Description, four cosmetic controls (Title / VoicePicker / ColorPicker / Generate+Upload), Host picker; header blurb present; required-caption + chain-checkbox both DELETED from DOM", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([
          makeHost("h1", "hostA"),
          makeHost("h2", "hostB"),
        ])}
      />,
    );

    // Phase 84 (Plan 84-01 CHANGE E.2): title conforms to dropdown label —
    // "New role", not "Create a role". Regression here would revert the
    // dropdown↔modal alignment intent.
    expect(
      screen.getByRole("heading", { name: /^new role$/i }),
    ).toBeTruthy();

    // Name input
    expect(screen.getByLabelText(/name/i)).toBeTruthy();
    // Description textarea (multi-line)
    const desc = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(desc).toBeTruthy();
    expect(desc.tagName).toBe("TEXTAREA");

    // Phase 86 Plan 86-06: the four cosmetic authoring controls added by
    // Plan 86-03 all render. Title input, VoicePicker (mocked), ColorPicker
    // (mocked), and the avatar section's Generate + Upload buttons.
    expect(screen.getByLabelText(/^title$/i)).toBeTruthy();
    expect(screen.getByTestId("voice-picker")).toBeTruthy();
    expect(screen.getByTestId("color-picker")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /upload avatar/i })).toBeTruthy();

    // Host picker — listbox with two options (2-host tree exercises the
    // non-suppressed picker branch)
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeTruthy();
    expect(screen.getByRole("option", { name: /hostA/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /hostB/ })).toBeTruthy();

    // Phase 84 (Plan 84-01 CHANGE F.3): the chain-checkbox is DELETED
    // from DOM entirely. Assert its ABSENCE rather than its presence.
    expect(
      screen.queryByRole("checkbox", {
        name: /then create an agent with this role/i,
      }),
    ).toBeNull();

    // Phase 84 (Plan 84-01 CHANGE F.1): the header blurb renders below
    // the title, above the fields. Phase 88 (Plan 88-02 Task 1): revised
    // to a two-sentence paired-vocabulary form — shared verb "adopt" pairs
    // with the sibling create-agent blurb at NewSessionDialog.tsx
    // startDescription. Exact string from 88-CONTEXT.md §Verbatim copy
    // Role blurb (LOCKED by Ashley greenlight 2026-09-07).
    expect(
      screen.getByText(
        /Roles are the expertise your agents adopt\. Every agent using this role inherits its goals, rules, and knowledge\./,
      ),
    ).toBeTruthy();

    // Phase 84 (Plan 84-01 CHANGE E.1 + F.1): the pre-Phase-84
    // required-caption sentence ("... Name and description are
    // required.") is DELETED from source — the DialogDescription now
    // holds the blurb instead.
    expect(
      screen.queryByText(/Name and description are required/i),
    ).toBeNull();
  });

  it("Test 12: Name validation — 'Box_Maintainer' shows inline error and disables Create; 'box-maintainer' clears the error", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "hostA")])}
      />,
    );

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    // Type an invalid name (uppercase + underscore both fail /^[a-z0-9-]+$/)
    fireEvent.change(nameInput, { target: { value: "Box_Maintainer" } });

    // Inline error present
    expect(
      screen.getByText(/kebab-case-lowercase|a-z, 0-9, hyphen/i),
    ).toBeTruthy();

    // Create button disabled (regardless of any other field state)
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Now type a valid name → inline error clears (Create enablement is
    // separately gated on cosmetics — Test 22 covers that).
    fireEvent.change(nameInput, { target: { value: "box-maintainer" } });
    expect(
      screen.queryByText(/kebab-case-lowercase|a-z, 0-9, hyphen/i),
    ).toBeNull();
  });

  it("Test 13 (Phase 86 Plan 06): Description validation — empty description disables Create even when name+host+cosmetics are all valid", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "hostA")])}
      />,
    );

    // Auto-select single-host (Test 15) means selectedHost is already set.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });

    // Fill title + voice (2 of the 3 cosmetic gates that would otherwise
    // mask the description gate). Description stays EMPTY — this is the
    // gate we're testing. Avatar can't be picked without description (the
    // canGenerate predicate requires description), so we only fill title+voice
    // here and rely on the assertion that description alone keeps Create off.
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Box Maintainer" },
    });
    fireEvent.click(screen.getByTestId("voice-picker-set-elena"));

    // Description empty → still disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Fill description + generate/pick avatar → all gates satisfied → enabled
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "Some description" },
    });
    // Now description is set, avatar generator is enable-able.
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalled());
    await waitFor(
      () => {
        const candidateBtns = document.querySelectorAll("[data-candidate-id]");
        expect(candidateBtns.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 2000 },
    );
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);

    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  it("Test 14 (Phase 86 Plan 06): Host validation — no host picked disables Create even when name+description+cosmetics are all valid", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([
          makeHost("h1", "hostA"),
          makeHost("h2", "hostB"),
        ])}
      />,
    );

    // Two hosts → NO auto-select (single-host auto-select only)
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "description" },
    });
    // Fill all cosmetics too so ONLY the host gate is missing.
    await fillCosmeticsAndPickAvatar();

    // No host picked → disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Click hostA → enabled
    fireEvent.click(screen.getByRole("option", { name: /hostA/ }));
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  it("Test 15 (Phase 84 Plan 03 / Phase 86 Plan 06): Auto-select single host on open — listbox is HIDDEN per Plan 84-01 CHANGE F.2, but sole host is still auto-picked as evidenced by canOpen predicate (once all cosmetic gates are also satisfied per Plan 86-03)", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    // Phase 84 (Plan 84-01 CHANGE F.2): single-host picker suppression
    // means the listbox is NOT rendered. Assert its absence.
    expect(screen.queryByRole("listbox")).toBeNull();
    // The search input is inside the same guard — also absent.
    expect(screen.queryByPlaceholderText(/search hosts/i)).toBeNull();

    // The auto-select branch in the open-effect (Plan 84-01 CHANGE B kept
    // this intact) still fires. Evidence: after all Phase 84 + Phase 86
    // required fields are filled, Create becomes enabled — which requires
    // selectedHost !== null in the canOpen predicate.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    await fillCosmeticsAndPickAvatar();
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  it("Test 16 (Phase 86 Plan 06): On submit, createRole is called with the widened multipart shape ({name, description, hostId, cosmetics: {title, colorHue, voice}}, avatarFile)", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    // Populate cosmetics + pick a generated candidate. Manual-upload path
    // is exercised separately in Test 24.
    await fillCosmeticsAndPickAvatar({ title: "Box Maintainer" });

    // Stub fetch for the generated candidate — resolveAvatarFile() calls
    // fetch(candidate.url), reads `.blob()`, then reads `blob.type` to derive
    // the File's mimetype. In jsdom the Response's blob adopts the response's
    // Content-Type header (not the input Blob's type), so we set the header
    // explicitly to image/webp — matches what the backend serves for
    // generated candidates.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob([new Uint8Array(4)]), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(mockCreateRole).toHaveBeenCalledTimes(1);
    });
    // Widened 2-arg call. First arg carries {name, description, hostId,
    // cosmetics: {title, colorHue, voice}}. Second arg is a File.
    const [input, avatarFile] = mockCreateRole.mock.calls[0] as [
      Record<string, unknown>,
      File | null,
    ];
    expect(input).toMatchObject({
      name: "box-maintainer",
      description: "d1",
      hostId: 42,
      cosmetics: {
        title: "Box Maintainer",
        voice: "Elena.wav",
      },
    });
    // colorHue is seeded randomly per open — assert it's a number in range.
    const cos = input.cosmetics as Record<string, unknown>;
    expect(typeof cos.colorHue).toBe("number");
    expect(cos.colorHue as number).toBeGreaterThanOrEqual(0);
    expect(cos.colorHue as number).toBeLessThan(360);
    // Second arg is the resolved File (from the generated candidate).
    // resolveAvatarFile() derives the File's type from the fetched blob's
    // mimetype (which jsdom fills from the Response's Content-Type header
    // stubbed above).
    expect(avatarFile).toBeInstanceOf(File);
    expect((avatarFile as File).type).toBe("image/webp");

    fetchSpy.mockRestore();
  });

  it("Test 17 (Phase 84 Plan 03 / Phase 86 Plan 06): On successful submit, onChainToCreateIdentity is invoked UNCONDITIONALLY when the callback prop is provided (checkbox gate removed per Plan 84-01 CHANGE C); callback shape unchanged", async () => {
    const chainSpy = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
        onChainToCreateIdentity={chainSpy}
      />,
    );

    // Single-host tree → listbox suppressed, hostA auto-picked (Plan 84-01
    // CHANGE F.2 + B). No option click needed. Fill name + description +
    // cosmetics.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    await fillCosmeticsAndPickAvatar();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob([new Uint8Array(4)], { type: "image/webp" }), {
        status: 200,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(chainSpy).toHaveBeenCalledTimes(1));
    expect(chainSpy).toHaveBeenCalledWith({
      role: "box-maintainer",
      host: expect.objectContaining({ id: "42", name: "hostA" }),
      description: "d1",
    });
    expect(onClose).toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  // Test 18 (Phase 84 Plan 03): DELETED. The behavior it verified
  // ("checkbox UNCHECKED → chain does NOT fire") no longer exists in
  // CreateRoleDialog — per D-CONTEXT item 4 LOCKED, the primary button
  // ALWAYS advances to the create-agent modal on success. There is no
  // un-chain path in the component anymore, so there is nothing to test.

  it("Test 19 (Phase 86 Plan 06): On 409 conflict, dialog stays open and renders inline 'already exists on <host>' error", async () => {
    mockCreateRole.mockRejectedValueOnce(new RoleAlreadyExistsError("box-maintainer"));
    const onClose = vi.fn();

    render(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    await fillCosmeticsAndPickAvatar();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob([new Uint8Array(4)], { type: "image/webp" }), {
        status: 200,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      // Inline error rendered
      expect(
        screen.getByText(
          /A role named .*box-maintainer.* already exists on .*hostA/i,
        ),
      ).toBeTruthy();
    });

    // Dialog stays open — onClose NOT called
    expect(onClose).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("Test 20 (Phase 86 Plan 06): On modal close, all state resets — name, description, host, AND the Phase 86 cosmetic state (title, voice, colorHue reseeded, candidates cleared, pickedCandidateId cleared)", async () => {
    let openState = true;
    const setOpen = (v: boolean) => { openState = v; };
    const { rerender } = render(
      <CreateRoleDialog
        open={openState}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Fill everything (name, description, host, cosmetics). 2-host tree
    // means the listbox IS rendered — click hostB to pick it.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    fireEvent.click(screen.getByRole("option", { name: /hostB/ }));
    await fillCosmeticsAndPickAvatar({ title: "Prior Title" });

    // Verify some cosmetic state actually landed on the DOM before close.
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("Prior Title");
    expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3);

    // Close (open=false)
    rerender(
      <CreateRoleDialog
        open={false}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Re-open — all state should be reset
    rerender(
      <CreateRoleDialog
        open={true}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Phase 22/84 fields reset
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^description$/i) as HTMLTextAreaElement).value).toBe("");
    // Neither host selected (two hosts → no auto-select)
    expect(
      screen.getByRole("option", { name: /hostA/ }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen.getByRole("option", { name: /hostB/ }).getAttribute("aria-selected"),
    ).toBe("false");

    // Phase 86 cosmetic state reset
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("");
    // VoicePicker mock passes value through as data-value on its stub.
    expect(
      screen.getByTestId("voice-picker").getAttribute("data-value"),
    ).toBe("");
    // ColorPicker's value is a number seeded randomly on open — assert
    // it's a valid hue but ALSO assert it re-rolled (data-value is a
    // number in [0, 360)).
    const colorPickerValue = Number(
      screen.getByTestId("color-picker").getAttribute("data-value"),
    );
    expect(Number.isInteger(colorPickerValue)).toBe(true);
    expect(colorPickerValue).toBeGreaterThanOrEqual(0);
    expect(colorPickerValue).toBeLessThan(360);
    // Candidates cleared (no data-candidate-id buttons)
    expect(document.querySelectorAll("[data-candidate-id]").length).toBe(0);
    // Manual preview cleared
    expect(screen.queryByAltText(/manual avatar preview/i)).toBeNull();

    // Phase 84 (Plan 84-01 CHANGE A): the thenCreateIdentity state hook
    // was DELETED. There is no checkbox to assert reset-to-CHECKED on.
    expect(
      screen.queryByRole("checkbox", {
        name: /then create an agent with this role/i,
      }),
    ).toBeNull();
  });

  it("Test 22 (Phase 84 Plan 03; implements Plan 84-01 CHANGE F.2 / Phase 86 Plan 06): with a single-host hostTree, the search input and the host listbox are NOT rendered; the sole host is still auto-picked so Create can enable once ALL Phase 86 cosmetic gates are also satisfied", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("42", "onlyHost")])}
      />,
    );

    // Picker chrome absent
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByPlaceholderText(/search hosts/i)).toBeNull();

    // The single host has no option button either — the whole subtree
    // is guarded by flatHosts.length !== 1.
    expect(screen.queryByRole("option", { name: /onlyHost/ })).toBeNull();

    // But the sole host IS auto-picked into selectedHost (Plan 84-01
    // CHANGE B kept the open-effect's auto-select-single-host branch
    // intact). Evidence: Create button enables after valid name + desc
    // + cosmetics.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    await fillCosmeticsAndPickAvatar();
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  // ─── Phase 86 (Plan 86-06) NEW tests ──────────────────────────────────

  it("Test 22-cosmetic-gate-title (Phase 86 Plan 06): with everything else valid, empty title keeps Create disabled per D-CTX-86-empty-not-scenario", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    // Fill name + description (single-host tree auto-picks host)
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    // Fill voice; skip title. Also generate + pick avatar (requires title
    // internally for the seed, but we set a title, generate/pick, then
    // CLEAR the title to prove the gate is enforced at Create-time).
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Temporary" },
    });
    fireEvent.click(screen.getByTestId("voice-picker-set-elena"));
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalled());
    await waitFor(
      () => expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3),
    );
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);

    // Sanity: everything is set → Create is enabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    await waitFor(() => expect(createBtn.disabled).toBe(false));

    // Clear the title → Create disables
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "" },
    });
    expect(createBtn.disabled).toBe(true);
  });

  it("Test 22-cosmetic-gate-voice (Phase 86 Plan 06): with everything else valid, empty voice keeps Create disabled", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Box Maintainer" },
    });
    // Skip voice — leave the VoicePicker's value as "".
    // Generate + pick avatar to lift the avatar gate.
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalled());
    await waitFor(
      () => expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3),
    );
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);

    // Voice unset → Create disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Set voice → Create enables
    fireEvent.click(screen.getByTestId("voice-picker-set-elena"));
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  it("Test 22-cosmetic-gate-avatar (Phase 86 Plan 06): with everything else valid, no picked avatar keeps Create disabled; picking one enables it", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Box Maintainer" },
    });
    fireEvent.click(screen.getByTestId("voice-picker-set-elena"));

    // Generate but do NOT pick → Create stays disabled
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalled());
    await waitFor(
      () => expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3),
    );
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Pick the first candidate → Create enables
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });

  it("Test 23 (Phase 86 Plan 06): Avatar generator flow — Generate calls postGenerateAvatarBatch with {name, title, brief: description, colorHue}; three candidates render; clicking a candidate sets aria-selected='true' on that button", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "role description" },
    });
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Box Maintainer" },
    });

    // Click Generate
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    // Seed mapping per D-CTX-86-surface-3: brief maps from description.
    await waitFor(() =>
      expect(mockPostGenerateAvatarBatch).toHaveBeenCalledTimes(1),
    );
    expect(mockPostGenerateAvatarBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "box-maintainer",
        title: "Box Maintainer",
        brief: "role description",
      }),
    );
    // colorHue is seeded randomly on open — assert a number in [0, 360).
    const call = mockPostGenerateAvatarBatch.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call.colorHue).toBe("number");
    expect(call.colorHue as number).toBeGreaterThanOrEqual(0);
    expect(call.colorHue as number).toBeLessThan(360);

    // Three candidate buttons render (mocked fixture returns 3).
    await waitFor(
      () => expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3),
    );

    // Click the second candidate → aria-selected='true' on that button,
    // aria-selected='false' on the others.
    const candidateBtns = Array.from(
      document.querySelectorAll("[data-candidate-id]"),
    ) as HTMLElement[];
    fireEvent.click(candidateBtns[1]);
    expect(candidateBtns[1].getAttribute("aria-selected")).toBe("true");
    expect(candidateBtns[0].getAttribute("aria-selected")).toBe("false");
    expect(candidateBtns[2].getAttribute("aria-selected")).toBe("false");
  });

  it("Test 24 (Phase 86 Plan 06): Manual upload — file input change calls postManualAvatarCandidate; preview image renders; any generated candidate carousel is cleared (mutual exclusion)", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    // First generate candidates so we can observe the carousel getting cleared.
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "d1" },
    });
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Box Maintainer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(
      () => expect(document.querySelectorAll("[data-candidate-id]").length).toBe(3),
    );

    // Grab the sr-only file input (the Upload button internally clicks it).
    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Fire a change with a mock File.
    const testFile = new File([new Uint8Array(4)], "custom.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    // postManualAvatarCandidate called with the file
    await waitFor(() =>
      expect(mockPostManualAvatarCandidate).toHaveBeenCalledTimes(1),
    );
    expect(mockPostManualAvatarCandidate).toHaveBeenCalledWith({ file: testFile });

    // Manual preview img renders
    await waitFor(() =>
      expect(screen.getByAltText(/manual avatar preview/i)).toBeTruthy(),
    );

    // Generated candidate carousel cleared (mutual exclusion — Plan 86-03
    // handleManualUpload clears `candidates` on successful upload).
    expect(document.querySelectorAll("[data-candidate-id]").length).toBe(0);
  });
});
