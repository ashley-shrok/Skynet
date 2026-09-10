/**
 * Phase 86 Plan 86-05: IdentityModal inherit-vs-override affordance layer.
 *
 * Per D-CTX-86-surface-5 (locked): each of the four cosmetic edit fields
 * (Title, Voice, ColorHue, Avatar) surfaces two states in the edit block:
 *   1. UNSET on identity → shows role's default with visible "Inherited" marker
 *   2. SET on identity → shows the value with a "revert to role default" affordance
 *
 * Clicking revert:
 *   - clears the identity's draft to the role default value
 *   - marks the field dirty (Save becomes enabled even if no other edits)
 *   - on Save, sends `meta.<field> = null` in the multipart PUT payload
 *     (Plan 86-01 backend PUT L563-574 treats explicit null as REMOVE key —
 *      absence = inherit, presence = override).
 *
 * These tests use the same mock scaffolding pattern as
 * IdentityModal.voice.test.tsx (voice/color/identities-store/scope-store
 * mocks). BASE_IDENTITY extended with `roleDefaults` per the Plan 86-01
 * Identity.roleDefaults widening.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub factory ──────────────────────────────────────────────────────────
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

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    getIdentityNoDormancy: vi.fn().mockResolvedValue(false),
    setIdentityNoDormancy: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
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

// Phase 98 Plan 03: VoicePicker inlines POLLY_VOICES — no runtime fetch.
// Only postSpeak is called by the sample button.
vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// Phase 89 Plan 05: RunbooksTab (mounted inside IdentityModal) calls listRunbooks
// via HTTP. Mock it to return an empty list so the tab renders without a network call.
vi.mock("@/api/runbooks-api", () => ({
  listRunbooks: vi.fn().mockResolvedValue([]),
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { updateIdentity } from "@/api/identities-api";
import { IdentityModal } from "./IdentityModal";
// Phase 90 Plan 90-06 (D-09): modal-scope-store retired. Reset helper is a
// no-op for compatibility with the remaining test body.
const __resetModalScopeForTest = (): void => { /* retired */ };

const mockedUpdateIdentity = vi.mocked(updateIdentity);

// ── Audio + URL globals ──────────────────────────────────────────────────────

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

// ── Shared fixture ────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "elena",
  displayName: "Elena",
  title: null,
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  avatarMime: "image/png",
  avatarUrl: "/identities/elena/avatar?hostId=1",
  avatarEtag: "etag-v1",
  coordinator: false,
  task: null,
  roleDefaults: {
    title: "Box maintainer",
    colorHue: 216,
    voice: "Matthew",
    avatar: "box-maintainer.webp",
  },
};

function renderModal(identityOverrides?: Partial<Identity>) {
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={identity}
      hue={200}
      hostId={1}
      // Phase 90 Plan 90-06: onOpenRoleModal is the new required prop.
      onOpenRoleModal={vi.fn()}
      container={document.body}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentityModal inherit-vs-override affordances (Phase 86 Plan 86-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetModalScopeForTest();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-inherit"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: identity.title=null + roleDefaults.title=set → Title input shows role value with 'Inherited' marker", async () => {
    renderModal({ title: null });

    // Reveal the edit block via pencil toggle.
    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // The Title input's displayed value should be the role's title
    // (pre-populated so the wearer sees what they're currently displaying).
    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("Box maintainer");
    });

    // Visible "Inherited" marker adjacent to the Title field.
    // Scope the search to the aria-label so it doesn't collide with the avatar
    // or another field's marker.
    const inheritedBadges = screen.getAllByLabelText(/Inherited from role: Box maintainer/i);
    expect(inheritedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 2: identity.title='custom title' + roleDefaults.title=set → Title shows 'custom title' + 'Revert to role default' affordance", async () => {
    renderModal({ title: "custom title" });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    // Revert affordance — one per cosmetic field that's set; look for one
    // associated with the title. Aria-label pattern: "Revert Title to role default".
    const titleRevert = screen.getByLabelText(/Revert Title to role default/i);
    expect(titleRevert).toBeDefined();
  });

  it("Test 3: identity.title=null + roleDefaults.title=undefined → Title empty, no 'Inherited' marker (defensive backstop)", async () => {
    renderModal({
      title: null,
      roleDefaults: { colorHue: 216, voice: "Matthew", avatar: "box-maintainer.webp" },
    });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("");
    });

    // No "Inherited" badge for the title field (role has no title to inherit).
    const inheritedTitleBadges = screen.queryAllByLabelText(/Inherited from role:/i);
    // There may still be inherited badges for OTHER fields (voice/color/avatar),
    // but none of them should mention a title value.
    const titleSpecificBadges = inheritedTitleBadges.filter((el) =>
      /Box maintainer/.test(el.getAttribute("aria-label") ?? ""),
    );
    expect(titleSpecificBadges.length).toBe(0);
  });

  it("Test 4: clicking 'Revert to role default' on Title clears draft to role value AND marks dirty (Save enabled)", async () => {
    renderModal({ title: "custom title" });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    // Save button starts disabled (no dirty change yet).
    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Click the Title revert affordance.
    const titleRevert = screen.getByLabelText(/Revert Title to role default/i);
    fireEvent.click(titleRevert);

    // Draft flips to the role default.
    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("Box maintainer");
    });

    // Save button is now enabled — revert-of-set is a dirty change.
    expect(saveBtn.disabled).toBe(false);
  });

  it("Test 5: Save with reverted Title calls updateIdentity with meta.title === null", async () => {
    const echoed: Identity = {
      ...BASE_IDENTITY,
      title: "Box maintainer", // resolved from role (identity's own title deleted)
    };
    mockedUpdateIdentity.mockResolvedValue(echoed);

    renderModal({ title: "custom title" });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    const titleRevert = screen.getByLabelText(/Revert Title to role default/i);
    fireEvent.click(titleRevert);

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    const [, calledMeta] = mockedUpdateIdentity.mock.calls[0];
    expect((calledMeta as Record<string, unknown>).title).toBeNull();
  });

  it("Test 6: after save-with-revert echoes identity.title=null, field re-renders in INHERITED state", async () => {
    const echoed: Identity = {
      ...BASE_IDENTITY,
      title: null, // identity has no title after delete
      roleDefaults: BASE_IDENTITY.roleDefaults,
    };
    mockedUpdateIdentity.mockResolvedValue(echoed);

    renderModal({ title: "custom title" });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    const titleRevert = screen.getByLabelText(/Revert Title to role default/i);
    fireEvent.click(titleRevert);

    // Wait for draft flip + Save-enabled before clicking Save (ensures the
    // revert click's setState has flushed).
    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("Box maintainer");
    });

    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockedUpdateIdentity).toHaveBeenCalledTimes(1);
    });

    // After save success onSave sets editing=false — wait for the pencil
    // label to flip back to "Edit agent" before re-clicking.
    const pencilAfter = await screen.findByRole(
      "button",
      { name: /edit agent/i },
      { timeout: 5000 },
    );
    fireEvent.click(pencilAfter);

    // The field re-renders showing the role default with the Inherited marker.
    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("Box maintainer");
    });
    const inheritedBadges = screen.getAllByLabelText(/Inherited from role: Box maintainer/i);
    expect(inheritedBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 7: Voice inherited case — VoicePicker receives resolved value (identity.voice ?? roleDefaults.voice)", async () => {
    renderModal({ voice: null });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // VoicePicker's <select> value binds to the RESOLVED value so the
    // sample-play button plays the currently-displayed voice.
    await waitFor(() => {
      const voiceSelect = screen.getByLabelText(/^Voice/i) as HTMLSelectElement;
      expect(voiceSelect.value).toBe("Matthew");
    });

    // Inherited marker for voice.
    const voiceInherited = screen.getAllByLabelText(/Inherited from role: Matthew/i);
    expect(voiceInherited.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 8: ColorPicker inherited case — slider bound to role's colorHue with Inherited marker", async () => {
    renderModal({ colorHue: null });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const colorRange = screen.getByLabelText(/^Color/i) as HTMLInputElement;
      // Slider bound to the role default (216).
      expect(colorRange.value).toBe("216");
    });

    const colorInherited = screen.getAllByLabelText(/Inherited from role: 216/i);
    expect(colorInherited.length).toBeGreaterThanOrEqual(1);

    // If we then override colorHue on the identity, the revert affordance appears.
  });

  it("Test 8b: ColorPicker set case — identity's colorHue wins + revert affordance appears", async () => {
    renderModal({ colorHue: 42 });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const colorRange = screen.getByLabelText(/^Color/i) as HTMLInputElement;
      expect(colorRange.value).toBe("42");
    });

    const colorRevert = screen.getByLabelText(/Revert Color to role default/i);
    expect(colorRevert).toBeDefined();
  });

  it("Test 9: Avatar revert affordance visible when role has an avatar (fallback heuristic per plan action step 5)", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    // Revert-avatar affordance appears — plan's fallback heuristic
    // (always-visible-when-role-has-avatar; server no-ops if already absent).
    await waitFor(() => {
      const avatarRevert = screen.getByLabelText(/Revert Avatar to role default/i);
      expect(avatarRevert).toBeDefined();
    });
  });

  it("Test 10: Cancel resets all revert-pending state (draft returns to committed values)", async () => {
    renderModal({ title: "custom title" });

    fireEvent.click(screen.getByRole("button", { name: /edit agent/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    // Click revert — draft flips to role default, Save enabled.
    const titleRevert = screen.getByLabelText(/Revert Title to role default/i);
    fireEvent.click(titleRevert);

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("Box maintainer");
    });

    // Cancel resets everything (closes the edit block).
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    // Wait for the pencil to flip back to "Edit agent" (editing=false has
    // propagated); then re-open the edit block.
    const pencilAfterCancel = await screen.findByRole("button", { name: /edit agent/i });
    fireEvent.click(pencilAfterCancel);

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^Title/i) as HTMLInputElement;
      expect(titleInput.value).toBe("custom title");
    });

    // Save button back to disabled — no pending revert state.
    const saveBtn = screen.getByRole("button", { name: /^Save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});
