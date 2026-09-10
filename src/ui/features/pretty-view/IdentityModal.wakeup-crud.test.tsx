/**
 * Phase 90 Plan 90-06 (rewrite of Phase 72 Plan 03) — IdentityModal wakeup CRUD
 * WS-message integration tests. IDENTITY-SCOPE ONLY.
 *
 * 2 tests asserting the create/delete affordances in the identity-scope Wakeups
 * tab send the correct wire type + payload shape through the WS layer:
 *
 *   W1: identity scope create — actor mount + tap Add-wakeup pill + fill
 *       form + Save → asserts one fake WS socket sent a message of type
 *       "identity:create-wakeup" with identityKey/hostId + spec.name +
 *       spec.instruction + spec.enabled + non-null spec.schedule.
 *   W2: identity scope delete — actor mount + click trash + confirm →
 *       asserts one fake WS socket sent "identity:delete-wakeup" with
 *       correct identityKey + wakeupSlug.
 *
 * (Tests W3 + W4 for role-scope wakeup CRUD were RETIRED — role-scope wakeups
 * moved to RoleModal in Plan 90-04. Coverage lives in RoleModal.test.tsx.)
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub with scriptable message queue ────────────────────────────────────
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
  __sentPayloads: string[];
};

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((payload: string) => {
      ws.__sentPayloads.push(payload);
    }),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    __sentPayloads: [],
  };
  openedSockets.push(ws);
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

// ── Module mocks (hoisted before imports) ────────────────────────────────────

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
    setIdentityNoDormancy: vi.fn().mockResolvedValue(false),
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

// Phase 89 Plan 05: RunbooksTab (mounted inside IdentityModal) calls listRunbooks
// via HTTP. Mock it to return an empty list so the tab renders without a network call.
vi.mock("@/api/runbooks-api", () => ({
  listRunbooks: vi.fn().mockResolvedValue([]),
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
// Phase 90 Plan 90-06 (D-09): __resetModalScopeForTest reference DELETED —
// the modal-scope store no longer backs identity-modal state.

// ── Fixture ──────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: null,
  task: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
};

function renderModal(identityOverrides?: Partial<Identity>): void {
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

function findSocketForRequestType(reqType: string): WsStub | undefined {
  return openedSockets.find((ws) => {
    if (ws.__sentPayloads.length === 0) return false;
    try {
      const parsed = JSON.parse(ws.__sentPayloads[0]) as { type?: string };
      return parsed.type === reqType;
    } catch {
      return false;
    }
  });
}

// Seed the identity-scope wakeups list so a delete-row is present.
function deliverIdentityWakeups(): void {
  const sock = findSocketForRequestType("identity:list-wakeups");
  expect(sock).toBeDefined();
  act(() => {
    sock!.onmessage!({
      data: JSON.stringify({
        type: "identity:wakeups",
        wakeups: [
          {
            slug: "daily-box-check",
            name: "daily-box-check",
            enabled: true,
            schedule: { type: "daily", at: "09:00", timezone: "America/New_York" },
            scheduleHuman: "daily @ 09:00 America/New_York",
            instruction: "Check the box.",
          },
        ],
      }),
    } as MessageEvent<string>);
  });
}

// Phase 90 Plan 90-06 (D-09): deliverRoleWakeups + switchScope helpers DELETED
// — role-scope wakeups moved to RoleModal (Plan 90-04). Coverage lives in
// RoleModal.test.tsx.

// Click the Wakeups nav button in the currently-visible bottom bar.
function clickWakeupsNav(): void {
  const btn = Array.from(
    document.querySelectorAll(".shrink-0.flex.items-stretch button"),
  ).find((b) => b.textContent?.includes("Wakeups")) as
    | HTMLButtonElement
    | undefined;
  expect(btn).toBeDefined();
  fireEvent.click(btn!);
}

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
});

afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test W1 — identity scope create → identity:create-wakeup
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal wakeup CRUD — identity scope (Phase 90 Plan 90-06)", () => {
  it("test W1: create-wakeup — Save fires identity:create-wakeup with correct payload shape", async () => {
    renderModal({ coordinator: false });
    await new Promise((r) => setTimeout(r, 0));
    // Phase 90 D-09: identity modal is identity-scope only; no scope switch.
    // Click Wakeups nav so the pane is active.
    clickWakeupsNav();
    // Pre-seed the identity-scope list so the tab renders in "ready" (not
    // "loading" — the Add-wakeup pill renders in both branches, but seeding
    // is defensive: any list-render assertion downstream would need it).
    deliverIdentityWakeups();

    // Tap Add-wakeup pill → AddWakeupDialog opens.
    fireEvent.click(screen.getByTestId("wakeup-add-button"));

    // Fill Name + Instruction (default schedule=daily @ 09:00 covers spec.schedule).
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: "test-wake" },
    });
    fireEvent.change(screen.getByLabelText(/Instruction/i), {
      target: { value: "say hi" },
    });

    // Click Save.
    fireEvent.click(screen.getByTestId("add-wakeup-save"));

    // Give sendIdentityMutation's WS onopen a chance to fire so send() runs.
    await waitFor(() => {
      const sock = findSocketForRequestType("identity:create-wakeup");
      expect(sock).toBeDefined();
    });

    const createSock = findSocketForRequestType("identity:create-wakeup")!;
    const payload = JSON.parse(createSock.__sentPayloads[0]) as {
      type: string;
      identityKey: string;
      hostId: number;
      spec: {
        name: string;
        enabled: boolean;
        instruction: string;
        schedule: Record<string, unknown> | null;
      };
    };
    expect(payload.type).toBe("identity:create-wakeup");
    expect(payload.identityKey).toBe("tina");
    expect(payload.hostId).toBe(1);
    expect(payload.spec.name).toBe("test-wake");
    expect(payload.spec.instruction).toBe("say hi");
    expect(payload.spec.enabled).toBe(true);
    expect(payload.spec.schedule).toBeTruthy();
    expect(typeof payload.spec.schedule).toBe("object");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test W2 — identity scope delete → identity:delete-wakeup
  // ───────────────────────────────────────────────────────────────────────────
  it("test W2: delete-wakeup — clicking trash + confirm fires identity:delete-wakeup with correct payload", async () => {
    renderModal({ coordinator: false });
    await new Promise((r) => setTimeout(r, 0));
    clickWakeupsNav();
    // Pre-seed a wakeup so the trash icon exists.
    deliverIdentityWakeups();

    // Click the trash icon on the first (and only) wakeup row.
    await waitFor(() => {
      expect(screen.getByTestId("wakeup-delete-icon")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("wakeup-delete-icon"));

    // Click the confirm button in the AlertDialog.
    await waitFor(() => {
      expect(screen.getByTestId("wakeup-delete-confirm")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("wakeup-delete-confirm"));

    await waitFor(() => {
      const sock = findSocketForRequestType("identity:delete-wakeup");
      expect(sock).toBeDefined();
    });

    const deleteSock = findSocketForRequestType("identity:delete-wakeup")!;
    const payload = JSON.parse(deleteSock.__sentPayloads[0]) as {
      type: string;
      identityKey: string;
      hostId: number;
      wakeupSlug: string;
    };
    expect(payload.type).toBe("identity:delete-wakeup");
    expect(payload.identityKey).toBe("tina");
    expect(payload.hostId).toBe(1);
    expect(payload.wakeupSlug).toBe("daily-box-check");
  });
});

// Phase 90 Plan 90-06 (D-09): Tests W3 + W4 (role-scope wakeup CRUD)
// DELETED — role-scope wakeups moved to RoleModal (Plan 90-04). Coverage
// lives in RoleModal.test.tsx.
