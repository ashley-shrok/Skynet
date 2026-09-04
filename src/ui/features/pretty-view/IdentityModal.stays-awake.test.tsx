/**
 * Quick 260811-ax1: IdentityModal "Stays awake" Radix Switch tests.
 *
 * Tests cover:
 * 1. Mount: getIdentityNoDormancy called once with (key, hostId); resolves false → aria-checked="false", not disabled
 * 2. Mount: getIdentityNoDormancy resolves true → aria-checked="true", not disabled
 * 3. Click unchecked switch → setIdentityNoDormancy(key, hostId, true); optimistic flip to checked; stays checked on resolve
 * 4. Click checked switch → setIdentityNoDormancy(key, hostId, false); optimistic flip to unchecked; stays unchecked
 * 5. setIdentityNoDormancy rejects → switch reverts to previous state; toast.error called
 * 6. While loading (initial fetch not resolved) → switch is disabled; after resolve → enabled
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
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    getIdentityNoDormancy: vi.fn(),
    setIdentityNoDormancy: vi.fn(),
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

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  getVoices: vi.fn(async () => []),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { getIdentityNoDormancy, setIdentityNoDormancy } from "@/api/identities-api";
import { toast } from "sonner";
import { IdentityModal } from "./IdentityModal";
// Phase 72 Plan 03: defensive per-test reset of the modal-scope-store so
// scope memory from one test never leaks into the next. Stays-awake switch
// lives in the title bar above the scope switch — tests here don't touch
// scope-conditional tabs — but the reset is cheap insurance against future
// interaction and matches the pattern in every other IdentityModal test file.
import { __resetModalScopeForTest } from "@/state/modal-scope-store";

const mockedGetIdentityNoDormancy = vi.mocked(getIdentityNoDormancy);
const mockedSetIdentityNoDormancy = vi.mocked(setIdentityNoDormancy);
const mockedToastError = vi.mocked(toast.error);

// ── Shared fixture ────────────────────────────────────────────────────────────

// Phase 68: Identity no longer has id/createdAt/updatedAt; avatarUrl bakes
// hostId at backend (no avatarUrlWithHost on frontend).
const BASE_IDENTITY: Identity = {
  identityKey: "moxie",
  displayName: "Moxie",
  title: "Tester",
  colorHue: null,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/moxie/avatar?hostId=1",
  avatarEtag: "etag-sa-1",
  coordinator: false,
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
      container={document.body}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentityModal 'Stays awake' switch (Quick 260811-ax1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetModalScopeForTest();
    // Default: sentinel not present
    mockedGetIdentityNoDormancy.mockResolvedValue(false);
    // Default: setIdentityNoDormancy echoes back the requested state
    mockedSetIdentityNoDormancy.mockImplementation((_key, _hostId, present) =>
      Promise.resolve(present),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: getIdentityNoDormancy called once on open; sentinel false → aria-checked='false', not disabled", async () => {
    renderModal();

    await waitFor(() => {
      expect(mockedGetIdentityNoDormancy).toHaveBeenCalledTimes(1);
      expect(mockedGetIdentityNoDormancy).toHaveBeenCalledWith("moxie", 1);
    });

    await waitFor(() => {
      const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(switchEl.getAttribute("aria-checked")).toBe("false");
      expect(switchEl.hasAttribute("disabled")).toBe(false);
      expect(switchEl.getAttribute("data-disabled")).toBeNull();
    });
  });

  it("Test 2: sentinel true → switch renders aria-checked='true', not disabled", async () => {
    mockedGetIdentityNoDormancy.mockResolvedValue(true);
    renderModal();

    await waitFor(() => {
      expect(mockedGetIdentityNoDormancy).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(switchEl.getAttribute("aria-checked")).toBe("true");
      expect(switchEl.hasAttribute("disabled")).toBe(false);
      expect(switchEl.getAttribute("data-disabled")).toBeNull();
    });
  });

  it("Test 3: click unchecked → setIdentityNoDormancy(key, hostId, true) called; switch flips to checked", async () => {
    mockedGetIdentityNoDormancy.mockResolvedValue(false);
    renderModal();

    // Wait for initial load to settle
    await waitFor(() => {
      const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(switchEl.getAttribute("aria-checked")).toBe("false");
      expect(switchEl.hasAttribute("disabled")).toBe(false);
    });

    const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(mockedSetIdentityNoDormancy).toHaveBeenCalledWith("moxie", 1, true);
    });

    await waitFor(() => {
      const updatedSwitch = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(updatedSwitch.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("Test 4: click checked → setIdentityNoDormancy(key, hostId, false) called; switch flips to unchecked", async () => {
    mockedGetIdentityNoDormancy.mockResolvedValue(true);
    renderModal();

    // Wait for initial load
    await waitFor(() => {
      const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(switchEl.getAttribute("aria-checked")).toBe("true");
      expect(switchEl.hasAttribute("disabled")).toBe(false);
    });

    const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(mockedSetIdentityNoDormancy).toHaveBeenCalledWith("moxie", 1, false);
    });

    await waitFor(() => {
      const updatedSwitch = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(updatedSwitch.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("Test 5: setIdentityNoDormancy rejects → switch reverts; toast.error called", async () => {
    mockedGetIdentityNoDormancy.mockResolvedValue(false);
    mockedSetIdentityNoDormancy.mockRejectedValueOnce(new Error("boom"));
    renderModal();

    // Wait for initial load
    await waitFor(() => {
      const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(switchEl.getAttribute("aria-checked")).toBe("false");
      expect(switchEl.hasAttribute("disabled")).toBe(false);
    });

    const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
    fireEvent.click(switchEl);

    // Wait for revert + toast
    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith("Failed to update stays-awake");
    });

    // Switch should have reverted back to false
    await waitFor(() => {
      const updatedSwitch = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(updatedSwitch.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("Test 6: switch is disabled while loading; enabled after resolve", async () => {
    // Use a promise we control to keep the load pending
    let resolveLoad!: (v: boolean) => void;
    mockedGetIdentityNoDormancy.mockReturnValueOnce(
      new Promise<boolean>((resolve) => { resolveLoad = resolve; }),
    );

    renderModal();

    // While loading, switch should be disabled (data-disabled or disabled attr)
    const switchEl = screen.getByRole("switch", { name: /toggle stays-awake/i });
    // Radix Switch sets data-disabled when disabled prop is true
    expect(
      switchEl.hasAttribute("disabled") || switchEl.getAttribute("data-disabled") === "",
    ).toBe(true);

    // Resolve the load
    resolveLoad(false);

    await waitFor(() => {
      const updatedSwitch = screen.getByRole("switch", { name: /toggle stays-awake/i });
      expect(updatedSwitch.hasAttribute("disabled")).toBe(false);
      expect(updatedSwitch.getAttribute("data-disabled")).toBeNull();
    });
  });
});
