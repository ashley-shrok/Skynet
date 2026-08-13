/**
 * Phase 38 Wave 2 (plan 38-02) — IdentityModal ↔ ShareIdentityPicker integration
 *
 * These tests exercise the DialogHeader wiring only — the picker's own
 * internals (menu open, item select, toast, API calls) are covered by
 * ShareIdentityPicker.test.tsx. Here we assert:
 *
 *   1. IdentityModal mounts ShareIdentityPicker in the DialogHeader with the
 *      correct props (identityId=identity.id, identityKey=identity.identityKey,
 *      onShareSuccess wired).
 *   2. The initial alreadySharedUserIds prop is an EMPTY Set (cold-start
 *      contract: Phase 38 does NOT precompute cross-user identity ownership).
 *   3. Invoking onShareSuccess with shared:true adds targetUserId to the Set
 *      so the picker's NEXT render sees it via props.
 *   4. Invoking onShareSuccess with shared:false ALSO adds targetUserId to
 *      the Set (per CONTEXT.md re-share-to-same-target: marker stays
 *      marked, not flipped).
 *
 * Mocking strategy:
 * - ./ShareIdentityPicker is replaced with a spy that records every render's
 *   props into a module-scoped array AND exposes two synthetic buttons
 *   ("simulate-share-true" / "simulate-share-false") that invoke
 *   props.onShareSuccess with a controllable payload.
 * - Other IdentityModal mocks (WS stub, identities-store, bounty-counts-store)
 *   mirror IdentityModal.test.tsx / IdentityModal.stays-awake.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { ShareIdentityPickerProps } from "./ShareIdentityPicker";

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

// ── ShareIdentityPicker spy (module-scoped props log + synthetic buttons) ────
//
// Vitest hoists vi.mock BEFORE any import (including imports of this test
// file's own top-level module symbols). We therefore keep the props-log
// array inside the mock factory closure and expose it via a named export
// that we re-import after the mocks are registered.

vi.mock("./ShareIdentityPicker", () => {
  const propsLog: ShareIdentityPickerProps[] = [];
  const clearLog = () => {
    propsLog.length = 0;
  };
  function ShareIdentityPicker(props: ShareIdentityPickerProps) {
    propsLog.push(props);
    return (
      <div data-testid="share-identity-picker-spy">
        <button
          type="button"
          data-testid="spy-simulate-share-true"
          onClick={() =>
            props.onShareSuccess({
              targetUserId: "u-new",
              shared: true,
              resultingIdentityId: "r-1",
            })
          }
        >
          simulate shared:true for u-new
        </button>
        <button
          type="button"
          data-testid="spy-simulate-share-false"
          onClick={() =>
            props.onShareSuccess({
              targetUserId: "u-existing",
              shared: false,
              resultingIdentityId: "r-2",
            })
          }
        >
          simulate shared:false for u-existing
        </button>
      </div>
    );
  }
  return { ShareIdentityPicker, __propsLog: propsLog, __clearLog: clearLog };
});

// ── Module mocks (mirror IdentityModal.stays-awake.test.tsx shape) ───────────

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
    setIdentityNoDormancy: vi.fn(),
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

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
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

// ── Late imports (after mocks registered) ────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
import * as PickerModule from "./ShareIdentityPicker";

// Cast to reach the spy-only symbols exposed by the mock factory.
const spyPickerModule = PickerModule as unknown as {
  __propsLog: ShareIdentityPickerProps[];
  __clearLog: () => void;
};

// ── Shared fixture ────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  id: "id-share-1",
  identityKey: "tina",
  displayName: "Tina",
  title: "Tester",
  colorHue: null,
  voice: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/id-share-1/avatar",
  avatarEtag: "etag-share-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
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

function latestPickerProps(): ShareIdentityPickerProps {
  const log = spyPickerModule.__propsLog;
  expect(log.length).toBeGreaterThan(0);
  return log[log.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IdentityModal — ShareIdentityPicker integration (Phase 38 Wave 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spyPickerModule.__clearLog();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: mounts ShareIdentityPicker in the DialogHeader with identityId + identityKey wired to the identity prop", async () => {
    renderModal();

    // The spy component is present in the DOM (i.e., inside the DialogHeader).
    await waitFor(() => {
      expect(screen.getByTestId("share-identity-picker-spy")).toBeTruthy();
    });

    const props = latestPickerProps();
    expect(props.identityId).toBe(BASE_IDENTITY.id);
    expect(props.identityKey).toBe(BASE_IDENTITY.identityKey);
    expect(typeof props.onShareSuccess).toBe("function");
  });

  it("Test 2: initial alreadySharedUserIds prop is an empty Set (cold-start contract)", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("share-identity-picker-spy")).toBeTruthy();
    });

    const props = latestPickerProps();
    // Set (not undefined, not null, not an array).
    expect(props.alreadySharedUserIds).toBeInstanceOf(Set);
    expect(props.alreadySharedUserIds.size).toBe(0);
  });

  it("Test 3: shared:true onShareSuccess payload adds targetUserId to the Set on next render", async () => {
    renderModal();

    // Wait for first render + capture the initial props snapshot.
    await waitFor(() => {
      expect(screen.getByTestId("share-identity-picker-spy")).toBeTruthy();
    });
    const initial = latestPickerProps();
    expect(initial.alreadySharedUserIds.has("u-new")).toBe(false);

    // Fire the spy's synthetic shared:true button.
    fireEvent.click(screen.getByTestId("spy-simulate-share-true"));

    // Wait for the parent to re-render the picker with the updated Set.
    await waitFor(() => {
      const next = latestPickerProps();
      expect(next.alreadySharedUserIds.has("u-new")).toBe(true);
    });

    // Verify the Set is a NEW instance (parent creates fresh Set on update
    // so React re-renders — asserting non-identity guards against a mutation
    // regression that would break the marker refresh).
    const next = latestPickerProps();
    expect(next.alreadySharedUserIds).not.toBe(initial.alreadySharedUserIds);
  });

  it("Test 4: shared:false onShareSuccess payload ALSO adds targetUserId to the Set (marker stays marked, per CONTEXT.md re-share contract)", async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("share-identity-picker-spy")).toBeTruthy();
    });
    const initial = latestPickerProps();
    expect(initial.alreadySharedUserIds.has("u-existing")).toBe(false);

    // Fire the spy's synthetic shared:false button.
    fireEvent.click(screen.getByTestId("spy-simulate-share-false"));

    // Even though the backend reported "already had this identityKey"
    // (shared:false), the parent still adds u-existing to the Set so the
    // marker stays marked on the next open — never flips false.
    await waitFor(() => {
      const next = latestPickerProps();
      expect(next.alreadySharedUserIds.has("u-existing")).toBe(true);
    });
  });
});
