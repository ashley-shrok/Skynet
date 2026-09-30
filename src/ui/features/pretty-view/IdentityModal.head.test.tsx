/**
 * IdentityModal head-behavior coverage (post modal-unification 2026-09-29).
 *
 * Focused replacement for the three test files retired during the
 * IdentityModal translation (main / voice / stays-awake). Covers the
 * two remaining head interactions that live outside title-line-jump.test:
 *
 *   Test 1: task pencil renders + click → enters edit mode
 *   Test 2: task edit → Enter → updateIdentity called with { task }
 *   Test 3: task edit → Escape → reverts, no save
 *   Test 4: voice chip renders "default" (italic) when identity.voice is null
 *   Test 5: voice chip renders the voice name when identity.voice is set
 *   Test 6: click voice chip → popover opens with VoicePicker
 *   Test 7: VoicePicker onChange → updateIdentity called with { voice }
 *
 * Stays-awake NOT re-authored — Boost switch retired top-to-bottom.
 * Main structural coverage (tab count, no-scope-switch, jump-to-role) lives
 * in IdentityModal.title-line-jump.test.tsx + IdentityModal.scope-switch.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub ──────────────────────────────────────────────────────────────────

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

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
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
  openedSockets.push(ws);
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockUpdateIdentity = vi.fn();

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
    updateIdentity: (...args: unknown[]) => mockUpdateIdentity(...args),
    listIdentities: vi.fn().mockResolvedValue([]),
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

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1" }),
}));

// VoicePicker's onSampleClick posts to voice-api — mock so tests don't hit the network.
vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

import { IdentityModal } from "./IdentityModal";

// ── Fixture ──────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tabitha",
  displayName: "Tabitha",
  title: null,
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  task: null,
  project: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tabitha/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

function makeIdentity(overrides?: Partial<Identity>): Identity {
  return { ...BASE_IDENTITY, ...overrides };
}

function renderModal(identityOverrides?: Partial<Identity>) {
  const identity = makeIdentity(identityOverrides);
  const onOpenChange = vi.fn();
  render(
    <IdentityModal
      open={true}
      onOpenChange={onOpenChange}
      identity={identity}
      hue={220}
      hostId={7}
      onOpenRoleModal={vi.fn()}
      container={document.body}
    />,
  );
  return { identity, onOpenChange };
}

// ── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
  // Default: updateIdentity resolves to the identity as passed with the meta patch merged.
  mockUpdateIdentity.mockImplementation(
    async (_key: string, patch: Record<string, unknown>) => ({
      ...BASE_IDENTITY,
      ...patch,
    }),
  );
});

afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Task pencil
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal head — task pencil", () => {
  it("Test 1: renders the task pencil and value span in view mode", async () => {
    renderModal({ task: "Unify modals" });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    expect(screen.getByTestId("identity-modal-task-pencil")).toBeTruthy();
    const value = screen.getByTestId("identity-modal-task-value");
    expect(value.textContent).toContain("Unify modals");
  });

  it("Test 2: click pencil → input appears → Enter saves via updateIdentity({ task })", async () => {
    renderModal({ task: "Old task" });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("identity-modal-task-pencil"));
    const input = await screen.findByTestId("identity-modal-task-input") as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "New task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockUpdateIdentity).toHaveBeenCalledWith(
        "tabitha",
        { task: "New task" },
        null,
        7,
      );
    });
  });

  it("Test 3: click pencil → Escape → reverts to view mode WITHOUT calling updateIdentity", async () => {
    renderModal({ task: "Kept task" });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("identity-modal-task-pencil"));
    const input = await screen.findByTestId("identity-modal-task-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Never persisted" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Input should unmount, pencil reappears
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="identity-modal-task-input"]'),
      ).toBeNull();
    });
    expect(screen.getByTestId("identity-modal-task-pencil")).toBeTruthy();
    expect(mockUpdateIdentity).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice chip + popover
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal head — voice chip", () => {
  it('Test 4: renders "default" (italic) when identity.voice is null', async () => {
    renderModal({ voice: null });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const chip = screen.getByTestId("identity-modal-voice-chip");
    expect(chip.textContent).toContain("default");
    // The "default" label wears italic styling — grep the child span for it.
    const italicSpan = chip.querySelector("span.italic");
    expect(italicSpan).toBeTruthy();
    expect(italicSpan?.textContent).toBe("default");
  });

  it("Test 5: renders the voice name when identity.voice is set", async () => {
    renderModal({ voice: "Matthew" });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    const chip = screen.getByTestId("identity-modal-voice-chip");
    expect(chip.textContent).toContain("Matthew");
    // No italic-default span when voice is set.
    expect(chip.querySelector("span.italic")).toBeNull();
  });

  it("Test 6: click voice chip → popover renders with VoicePicker inside", async () => {
    renderModal({ voice: null });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    // Popover starts closed.
    expect(
      document.querySelector('[data-testid="identity-modal-voice-popover"]'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("identity-modal-voice-chip"));
    const popover = await screen.findByTestId("identity-modal-voice-popover");
    // VoicePicker renders a <select> inside — verify by finding it scoped to the popover.
    expect(within(popover).getByRole("combobox")).toBeTruthy();
  });

  it("Test 7: VoicePicker onChange → updateIdentity called with { voice }", async () => {
    renderModal({ voice: null });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("identity-modal-voice-chip"));
    const popover = await screen.findByTestId("identity-modal-voice-popover");
    const select = within(popover).getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Matthew" } });

    await waitFor(() => {
      expect(mockUpdateIdentity).toHaveBeenCalledWith(
        "tabitha",
        { voice: "Matthew" },
        null,
        7,
      );
    });
  });
});
