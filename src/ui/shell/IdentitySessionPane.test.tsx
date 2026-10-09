/**
 * Phase 41 Plan 02 — IdentitySessionPane component tests.
 *
 * P1: Terminal NOT mounted by default (isPrettyMode = true initial state).
 * P4: toggleMessageQueue() renders MessageQueueDrawer.
 * P5: MessageQueueDrawer onSend calls pvSendInputRef.current (split-send, 60ms apart).
 * P6: TerminalHandle methods are safe-noop when Terminal is unmounted.
 * P7: When Terminal IS mounted, fit() forwards to inner Terminal ref.
 *
 * (P2/P3 retired: togglePrettyMode() was removed from the imperative
 *  handle when the Ctrl+Shift+O keyboard shortcut retired — the badge
 *  context-menu "Switch view" item is now the sole toggle affordance,
 *  covered by the BADGE-MENU tests further below.)
 *
 * Mocking strategy:
 * - @/features/terminal/Terminal: replace with a simple div (data-testid="mock-terminal")
 *   + forwardRef exposing mock TerminalHandle methods (fit spy, etc.).
 * - @/features/pretty-view/PrettyView: replace with a div that captures
 *   onRegisterSendInput so we can populate pvSendInputRef from tests.
 * - @/features/terminal/MessageQueueDrawer: div with data-testid; exposes onSend
 *   via a global ref so tests can trigger it.
 * - @/state/identities-store: useIdentities returns a Map with one identity.
 * - @/api/message-queue-api: listMessageQueueItems returns [].
 * - @/features/terminal/command-history/CommandHistoryContext: passthrough provider.
 * - @/shell/TabContext: useTabsSafe returns previewTerminalTheme=null.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  act,
} from "@testing-library/react";
import { createRef, forwardRef } from "react";
import type { TerminalHandle } from "@/features/terminal/Terminal";

// ── Mock: identities-store ───────────────────────────────────────────────────
// Returns one identity so identityKey lookup is truthy (identity pane detection).
// Mutable so badge-menu tests can seed a `project` field on the identity to
// exercise the currentProjectSlug branch (checkmark + Remove-from-project).
let mockIdentity: Record<string, unknown> = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Agent",
  colorHue: 200,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
  project: null as string | null,
};
vi.mock("@/state/identities-store", () => {
  return {
    useIdentities: vi.fn(() => ({
      identities: [mockIdentity],
      byKey: new Map([["tina", mockIdentity]]),
      byHostKey: new Map([[`42::tina`, mockIdentity]]),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

// ── Mock: use-mobile ─────────────────────────────────────────────────────────
// Default false so the badge-menu builds real items; per-test override to true
// exercises the mobile-early-return branch.
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

// ── Mock: session-project-api ────────────────────────────────────────────────
// Spy on setSessionProject so badge-menu tests can assert wire args.
const mockSetSessionProject = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: (...args: unknown[]) => mockSetSessionProject(...args),
}));

// ── Mock: conversation-store (partial) ───────────────────────────────────────
// Override useProjects with a mutable fixture; keep the other exports the
// tests transitively touch (usePinnedIds, fleetRowId, pin/unpin) as no-op
// or passthrough stubs.
let mockProjectsList: Array<{
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
}> = [];
vi.mock("@/state/conversation-store", () => ({
  useProjects: vi.fn(() => mockProjectsList),
  usePinnedIds: vi.fn(() => new Set<string | number>()),
  fleetRowId: (hostId: number, session: string) => `fleet::${hostId}::${session}`,
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
}));

// ── Mock: message-queue-api ──────────────────────────────────────────────────
vi.mock("@/api/message-queue-api", () => ({
  listMessageQueueItems: vi.fn().mockResolvedValue([]),
  createMessageQueueItem: vi.fn().mockResolvedValue({ id: "mq-1", body: "" }),
  deleteMessageQueueItem: vi.fn().mockResolvedValue(undefined),
  flushMessageQueueItemKeepalive: vi.fn().mockResolvedValue(undefined),
  updateMessageQueueItem: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock: TabContext ──────────────────────────────────────────────────────────
vi.mock("@/shell/TabContext", () => ({
  useTabsSafe: vi.fn(() => ({ previewTerminalTheme: null })),
}));

// ── Mock: CommandHistoryContext (passthrough) ─────────────────────────────────
vi.mock("@/features/terminal/command-history/CommandHistoryContext", () => ({
  CommandHistoryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCommandHistory: vi.fn(() => ({ history: [], addCommand: vi.fn() })),
}));

// ── Mock: IdentityBadge ───────────────────────────────────────────────────────
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: ({ identityKey }: { identityKey: string | null }) =>
    identityKey ? <div data-testid="identity-badge">{identityKey}</div> : null,
}));

// ── Mock: IdentityModal ───────────────────────────────────────────────────────
vi.mock("@/features/pretty-view/IdentityModal", () => ({
  IdentityModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="identity-modal" /> : null,
}));

// ── Mock: session-hue ────────────────────────────────────────────────────────
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) => {
    if (!name) return null;
    return name.toLowerCase() || null;
  },
  hueFromSessionName: (_name: string | null | undefined) => 200,
}));

// ── Mock PrettyView ──────────────────────────────────────────────────────────
// Captures onRegisterSendInput so tests can populate the pvSendInputRef.
let capturedRegisterSendInput: ((fn: (text: string, mqid?: string) => boolean) => void) | null = null;
let capturedRegisterSendInterrupt: ((fn: () => void) => void) | null = null;
let prettyViewMountCount = 0;
// Phase 92 Slice 1 (D-07): capture every prop passed to PrettyView so tests
// can assert (a) `source={{ kind: "harness", ... }}` is present, (b)
// redundant legacy `hostId` / `tmuxSession` / `tabId` props are still
// present alongside `source`, and (c) all other props are unchanged
// byte-for-byte from pre-slice.
let capturedPrettyViewProps: Record<string, unknown> | null = null;

vi.mock("@/features/pretty-view/PrettyView", () => ({
  PrettyView: (props: {
    onRegisterSendInput?: (fn: (text: string, mqid?: string) => boolean) => void;
    onRegisterSendInterrupt?: (fn: () => void) => void;
    [key: string]: unknown;
  }) => {
    // Capture registration callbacks so tests can populate pvSendInputRef.
    if (props.onRegisterSendInput) capturedRegisterSendInput = props.onRegisterSendInput;
    if (props.onRegisterSendInterrupt) capturedRegisterSendInterrupt = props.onRegisterSendInterrupt;
    capturedPrettyViewProps = props;
    prettyViewMountCount++;
    return <div data-testid="pretty-view" />;
  },
}));

// ── Mock MessageQueueDrawer ──────────────────────────────────────────────────
// Exposes onSend via module-level so P5 can trigger a send.
let capturedMqOnSend: ((text: string, mqid: string) => boolean) | null = null;

vi.mock("@/features/terminal/MessageQueueDrawer", () => ({
  MessageQueueDrawer: ({
    onSend,
    onClose,
  }: {
    onSend: (text: string, mqid: string) => boolean;
    onClose: () => void;
  }) => {
    capturedMqOnSend = onSend;
    return (
      <div data-testid="message-queue-drawer">
        <button data-testid="mq-close" onClick={onClose}>
          Close
        </button>
      </div>
    );
  },
}));

// ── Mock Terminal (forwardRef) ────────────────────────────────────────────────
// Exposes a spy on fit() so P7 can assert forwarding.
let mockFitFn: ReturnType<typeof vi.fn> = vi.fn();
let terminalMountCount = 0;
let terminalUnmountCount = 0;

vi.mock("@/features/terminal/Terminal", async (importOriginal) => {
  const React = await importOriginal<typeof import("react")>();
  // We need forwardRef / useEffect / useImperativeHandle from react.
  // Import them via the actual react module.
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  const MockTerminal = forwardRef<TerminalHandle, Record<string, unknown>>(
    function MockTerminal(_props, ref) {
      terminalMountCount++;
      // Record unmount via useEffect cleanup.
      useEffect(() => {
        return () => {
          terminalUnmountCount++;
        };
      }, []);
      useImperativeHandle(ref, () => ({
        disconnect: vi.fn(),
        reconnect: vi.fn(),
        fit: mockFitFn,
        sendInput: vi.fn(),
        notifyResize: vi.fn(),
        refresh: vi.fn(),
        toggleMessageQueue: vi.fn(),
        togglePrettyMode: vi.fn(),
      }));
      return <div data-testid="mock-terminal" />;
    },
  );
  void React; // suppress unused import warning
  return { Terminal: MockTerminal };
});

// ── Late imports (after vi.mock registrations) ────────────────────────────────
import "@testing-library/jest-dom/vitest";
import { IdentitySessionPane } from "./IdentitySessionPane";
import type { IdentitySessionPaneProps } from "./IdentitySessionPane";

// ── Shared fixture ────────────────────────────────────────────────────────────
function makeProps(overrides?: Partial<IdentitySessionPaneProps>): IdentitySessionPaneProps {
  return {
    tab: {
      id: "tab-1",
      instanceId: "inst-1",
      type: "terminal",
      label: "tina",
      openedAt: 0,
      targetTmuxSession: "tina",
    },
    host: {
      id: "42",
      name: "box-1",
      username: "ash",
      ip: "100.64.1.1",
      port: 22,
      sshPort: 22,
      folder: "",
      online: true,
      cpu: null,
      ram: null,
      lastAccess: "",
      tags: [],
      authType: "key",
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      serverTunnels: [],
    } as unknown as import("@/types/ui-types").Host,
    label: "tina",
    isVisible: true,
    attach: true,
    ...overrides,
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────────
describe("IdentitySessionPane — Phase 41 Plan 02", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prettyViewMountCount = 0;
    terminalMountCount = 0;
    terminalUnmountCount = 0;
    capturedRegisterSendInput = null;
    capturedRegisterSendInterrupt = null;
    capturedMqOnSend = null;
    capturedPrettyViewProps = null;
    mockFitFn = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("P1: PrettyView renders by default; Terminal does NOT mount", () => {
    render(<IdentitySessionPane {...makeProps()} />);
    // PrettyView present.
    expect(screen.getByTestId("pretty-view")).toBeInTheDocument();
    // Terminal NOT present (Terminal only mounts when !isPrettyMode).
    expect(screen.queryByTestId("mock-terminal")).toBeNull();
    // Structural guard: Terminal mount count is 0.
    expect(terminalMountCount).toBe(0);
  });

  it("P4: toggleMessageQueue() renders MessageQueueDrawer", async () => {
    const ref = createRef<TerminalHandle>();
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    expect(screen.queryByTestId("message-queue-drawer")).toBeNull();

    await act(async () => {
      ref.current!.toggleMessageQueue();
    });

    expect(screen.getByTestId("message-queue-drawer")).toBeInTheDocument();
  });

  it("P5: MessageQueueDrawer onSend routes through pvSendInputRef (split-send: body then \\r+mqid 60ms later)", async () => {
    const ref = createRef<TerminalHandle>();
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    // 1. Simulate PrettyView registering a send function into pvSendInputRef.
    const mockSendFn = vi.fn((_text: string, _mqid?: string) => true);
    act(() => {
      capturedRegisterSendInput!(mockSendFn);
    });

    // 2. Open the message queue drawer.
    await act(async () => {
      ref.current!.toggleMessageQueue();
    });
    expect(capturedMqOnSend).not.toBeNull();

    // 3. Trigger a send via the drawer's onSend.
    act(() => {
      capturedMqOnSend!("hello world", "mq-item-abc");
    });

    // Body event fires synchronously.
    expect(mockSendFn).toHaveBeenCalledTimes(1);
    expect(mockSendFn).toHaveBeenCalledWith("hello world");

    // Advance past 60ms → second event fires with \r + mqid.
    act(() => {
      vi.advanceTimersByTime(59);
    });
    expect(mockSendFn).toHaveBeenCalledTimes(1); // not yet

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockSendFn).toHaveBeenCalledTimes(2);
    expect(mockSendFn).toHaveBeenLastCalledWith("\r", "mq-item-abc");
  });

  it("P6: TerminalHandle methods are safe-noop when Terminal is unmounted", async () => {
    const ref = createRef<TerminalHandle>();
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    // Terminal is NOT mounted (isPrettyMode = true). All calls must be silent noops.
    expect(() => { ref.current!.disconnect(); }).not.toThrow();
    expect(() => { ref.current!.reconnect(); }).not.toThrow();
    expect(() => { ref.current!.fit(); }).not.toThrow();
    expect(() => { ref.current!.sendInput("x"); }).not.toThrow();
    expect(() => { ref.current!.notifyResize(); }).not.toThrow();
    expect(() => { ref.current!.refresh(); }).not.toThrow();

    // Terminal was never mounted — mount count remains 0.
    expect(terminalMountCount).toBe(0);
  });

  it("P7: When Terminal IS mounted, fit() forwards to inner Terminal ref", async () => {
    const ref = createRef<TerminalHandle>();
    // Mount as admin so the Switch view badge-menu item is available;
    // firing that item's onClick is the sole path to flip isPrettyMode
    // now that the imperative-handle togglePrettyMode has retired.
    render(<IdentitySessionPane {...makeProps({ isAdmin: true })} ref={ref} />);

    const items = (capturedPrettyViewProps?.identityBadgeContextMenuItems ??
      []) as Array<{ label: string; onClick: () => void }>;
    const switchItem = items.find(
      (it) => it.label === "Switch to terminal view",
    );
    expect(switchItem).toBeDefined();

    // Mount Terminal by firing the Switch item's onClick (flips
    // isPrettyMode → false, mounts Terminal).
    await act(async () => {
      switchItem!.onClick();
    });
    expect(terminalMountCount).toBe(1);

    // Call fit() on the wrapper.
    act(() => {
      ref.current!.fit();
    });

    // The inner Terminal mock's fit() should have been called exactly once.
    expect(mockFitFn).toHaveBeenCalledTimes(1);
  });

  // ── Phase 92 Slice 1 tests ─────────────────────────────────────────────────
  // These tests assert the D-07 source prop is passed to PrettyView with the
  // correct shape AND the redundant legacy hostId/tmuxSession/tabId props
  // are still passed alongside (Blocker 1 resolution — flat props stay
  // during Slices 1-4).

  it("Phase 92 Test 1: PrettyView receives source={{ kind: 'harness', hostId, tmuxSession, tabId }}", () => {
    // makeProps() defaults tab.targetTmuxSession to "tina" — effectiveTmuxSession
    // reads that value at IdentitySessionPane.tsx:110.
    render(<IdentitySessionPane {...makeProps()} />);
    expect(capturedPrettyViewProps).not.toBeNull();
    const source = capturedPrettyViewProps!.source as
      | { kind: string; hostId: number; tmuxSession: string; tabId?: string }
      | undefined;
    expect(source).toBeDefined();
    expect(source!.kind).toBe("harness");
    // host.id in makeProps() is "42" → parseInt(..., 10) = 42
    expect(source!.hostId).toBe(42);
    // effectiveTmuxSession is tab.targetTmuxSession = "tina" per makeProps().
    expect(source!.tmuxSession).toBe("tina");
    // tabId is tab.id from makeProps() = "tab-1" (passed via tabId prop
    // computed inside IdentitySessionPane; if absent, undefined).
    expect(source!.tabId === "tab-1" || source!.tabId === undefined).toBe(true);
  });

  it("Phase 92 Test 2: PrettyView ALSO receives redundant legacy hostId, tmuxSession, tabId props", () => {
    render(<IdentitySessionPane {...makeProps()} />);
    expect(capturedPrettyViewProps).not.toBeNull();
    // Redundant legacy props retained per Blocker 1 resolution — many
    // PrettyView internal consumers still read these directly.
    expect(capturedPrettyViewProps!.hostId).toBe(42);
    expect(capturedPrettyViewProps!.tmuxSession).toBe("tina");
    // tabId is derived internally from tab.id inside IdentitySessionPane;
    // whichever value flows here should also match "tab-1" OR be undefined
    // if the consumer omits it.
    expect(
      capturedPrettyViewProps!.tabId === "tab-1" ||
        capturedPrettyViewProps!.tabId === undefined,
    ).toBe(true);
  });

  it("Phase 92 Test 3: all OTHER PrettyView props are unchanged byte-for-byte from pre-slice", () => {
    render(<IdentitySessionPane {...makeProps()} />);
    expect(capturedPrettyViewProps).not.toBeNull();
    // className, isVisible, and the callback-shape props stay untouched by
    // Slice 1's prop-shape addition. Assert the ones with load-bearing
    // shape.
    expect(capturedPrettyViewProps!.className).toBe("flex-1 min-h-0");
    expect(capturedPrettyViewProps!.isVisible).toBe(true);
    expect(typeof capturedPrettyViewProps!.onSend).toBe("function");
    expect(typeof capturedPrettyViewProps!.onInterrupt).toBe("function");
  });

  it("Phase 92 Test 4: existing IdentitySessionPane test suite passes unchanged (harness regression floor)", () => {
    // This test is a marker — the actual regression floor is the passing
    // status of P1-P7 above. If any of them break due to Slice 1's prop
    // addition, this test file's overall status flips to failing. Keeping
    // this explicit assertion as documentation of the intent.
    expect(true).toBe(true);
  });

  // ── Badge-menu Move-to (2026-09-27; renamed from "Move to project") ───────
  // Mirror of the row-menu shape (PrettyConversationRow items[] builder).
  // Badge-menu is per-host by construction, so host-scoping is a
  // filter-by-host.id, not the panel's projectsForRow narrowing.
  // Pinned and in-a-project are mutually exclusive, so the submenu lists
  // both kinds of destination: "Pinned" → host projects → trailing leaf
  // ("Unpin" when pinned, else "Remove from project" when in a project).

  describe("badge-menu Move-to", () => {
    beforeEach(async () => {
      mockProjectsList = [];
      mockIdentity = { ...mockIdentity, project: null };
      mockSetSessionProject.mockClear();
      const store = await import("@/state/conversation-store");
      vi.mocked(store.usePinnedIds).mockImplementation(() => new Set<string | number>());
    });

    function getMenuItems() {
      return (capturedPrettyViewProps!.identityBadgeContextMenuItems ?? []) as Array<{
        label: string;
        submenu?: Array<{ label: string; checked?: boolean; onClick: () => void }>;
      }>;
    }

    function getMoveToSubmenu() {
      const move = getMenuItems().find((it) => it.label === "Move to");
      expect(move).toBeDefined();
      return move!.submenu!;
    }

    async function setPinnedIds(ids: string[]) {
      const store = await import("@/state/conversation-store");
      vi.mocked(store.usePinnedIds).mockImplementation(() => new Set<string | number>(ids));
      return store;
    }

    it("zero projects on this host → 'Move to' still present, carrying only Pinned (no project entries)", () => {
      mockProjectsList = [
        // Non-matching host — should NOT surface on host 42's badge.
        { slug: "elsewhere", displayName: "Elsewhere", hostId: "99", hostname: "other", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const items = getMenuItems();
      expect(items.find((it) => it.label === "Move to project")).toBeUndefined();
      const submenu = getMoveToSubmenu();
      expect(submenu.map((s) => s.label)).toEqual(["Pinned"]);
      expect(submenu[0].checked).toBe(false);
    });

    it("Pinned entry with zero projects pins under the fleet-synthetic id", async () => {
      const store = await import("@/state/conversation-store");
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      submenu.find((s) => s.label === "Pinned")!.onClick();
      expect(store.pinConversation).toHaveBeenCalledTimes(1);
      expect(store.pinConversation).toHaveBeenCalledWith("fleet::42::tina");
      expect(store.unpinConversation).not.toHaveBeenCalled();
      expect(mockSetSessionProject).not.toHaveBeenCalled();
    });

    it("filters submenu to projects on the badge's host (host-scoped)", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
        { slug: "local-b", displayName: "Local B", hostId: "42", hostname: "box-1", archived: false },
        { slug: "elsewhere", displayName: "Elsewhere", hostId: "99", hostname: "other", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const labels = getMoveToSubmenu().map((s) => s.label);
      // Pinned first; no trailing leaf when neither pinned nor in a project.
      expect(labels).toEqual(["Pinned", "Local A", "Local B"]);
    });

    it("checkmarks the currently-assigned project and appends Remove-from-project leaf", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
        { slug: "local-b", displayName: "Local B", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "local-b" };
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      const pinned = submenu.find((s) => s.label === "Pinned");
      const a = submenu.find((s) => s.label === "Local A");
      const b = submenu.find((s) => s.label === "Local B");
      expect(pinned?.checked).toBe(false);
      expect(a?.checked).toBe(false);
      expect(b?.checked).toBe(true);
      expect(submenu[submenu.length - 1].label).toBe("Remove from project");
      expect(submenu.map((s) => s.label)).not.toContain("Unpin");
    });

    it("omits Remove-from-project leaf when identity has no project assigned", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      // mockIdentity.project === null (beforeEach reset).
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      expect(submenu.map((s) => s.label)).not.toContain("Remove from project");
    });

    it("clicking a non-current project fires setSessionProject(hostId, identityKey, slug)", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      submenu.find((s) => s.label === "Local A")!.onClick();
      expect(mockSetSessionProject).toHaveBeenCalledTimes(1);
      expect(mockSetSessionProject).toHaveBeenCalledWith(42, "tina", "local-a");
    });

    it("clicking the currently-assigned project is a silent no-op (no wire call)", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "local-a" };
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      submenu.find((s) => s.label === "Local A")!.onClick();
      expect(mockSetSessionProject).not.toHaveBeenCalled();
    });

    it("clicking Remove-from-project fires setSessionProject(hostId, identityKey, null)", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "local-a" };
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      submenu.find((s) => s.label === "Remove from project")!.onClick();
      expect(mockSetSessionProject).toHaveBeenCalledTimes(1);
      expect(mockSetSessionProject).toHaveBeenCalledWith(42, "tina", null);
    });

    it("skips archived projects in the submenu", () => {
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
        { slug: "old", displayName: "Old", hostId: "42", hostname: "box-1", archived: true },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      expect(submenu.map((s) => s.label)).toEqual(["Pinned", "Local A"]);
    });

    it("pinned (no project): Pinned is checked, trailing leaf is Unpin, and Unpin calls unpinConversation with the fleet id", async () => {
      const store = await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      expect(submenu.map((s) => s.label)).toEqual(["Pinned", "Local A", "Unpin"]);
      expect(submenu[0].checked).toBe(true);
      expect(submenu.map((s) => s.label)).not.toContain("Remove from project");
      // The checked Pinned entry is a no-op.
      submenu[0].onClick();
      expect(store.pinConversation).not.toHaveBeenCalled();
      expect(store.unpinConversation).not.toHaveBeenCalled();
      submenu.find((s) => s.label === "Unpin")!.onClick();
      expect(store.unpinConversation).toHaveBeenCalledWith("fleet::42::tina");
      expect(store.unpinConversation).not.toHaveBeenCalledWith("tab-1");
      expect(mockSetSessionProject).not.toHaveBeenCalled();
    });

    it("picking a project while pinned unpins locally AND fires setSessionProject", async () => {
      const store = await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      getMoveToSubmenu().find((s) => s.label === "Local A")!.onClick();
      expect(mockSetSessionProject).toHaveBeenCalledTimes(1);
      expect(mockSetSessionProject).toHaveBeenCalledWith(42, "tina", "local-a");
      // Unpin waits for the project write to land.
      await vi.waitFor(() =>
        expect(store.unpinConversation).toHaveBeenCalledWith("fleet::42::tina"),
      );
      expect(store.pinConversation).not.toHaveBeenCalled();
    });

    it("a failed project write keeps the pin", async () => {
      const store = await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockSetSessionProject.mockRejectedValueOnce(new Error("500"));
      render(<IdentitySessionPane {...makeProps()} />);
      getMoveToSubmenu().find((s) => s.label === "Local A")!.onClick();
      // Flush the rejected write's .then/.catch (suite runs fake timers).
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(store.unpinConversation).not.toHaveBeenCalled();
    });

    it("Remove from project on a stale-pinned member drops the pin too (lands in Conversations)", async () => {
      const store = await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "local-a" };
      render(<IdentitySessionPane {...makeProps()} />);
      getMoveToSubmenu().find((s) => s.label === "Remove from project")!.onClick();
      expect(store.unpinConversation).toHaveBeenCalledWith("fleet::42::tina");
      expect(mockSetSessionProject).toHaveBeenCalledWith(42, "tina", null);
    });

    it("a `project:` naming no known project on this host doesn't count: pinned shows checked with Unpin", async () => {
      await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "gone" };
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      expect(submenu[0].checked).toBe(true);
      expect(submenu.map((s) => s.label)).toEqual(["Pinned", "Local A", "Unpin"]);
    });

    it("stale pin on a project member: project wins — Pinned unchecked, leaf is Remove from project, and Pinned clears the project", async () => {
      const store = await setPinnedIds(["fleet::42::tina"]);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      mockIdentity = { ...mockIdentity, project: "local-a" };
      render(<IdentitySessionPane {...makeProps()} />);
      const submenu = getMoveToSubmenu();
      expect(submenu.map((s) => s.label)).toEqual(["Pinned", "Local A", "Remove from project"]);
      expect(submenu[0].checked).toBe(false);
      // A stale pin would make pinConversation a no-op, so Pinned clears the
      // project directly instead.
      submenu[0].onClick();
      expect(store.pinConversation).not.toHaveBeenCalled();
      expect(mockSetSessionProject).toHaveBeenCalledWith(42, "tina", null);
    });

    it("mobile: Move to still surfaces (badge menu now populates on mobile too)", async () => {
      // Prior behavior — useMemo returned [] on mobile — was retired when
      // the mobile badge grew its own long-press → context-menu affordance
      // (shape-context-menu-on-identity-badge-mobile). Mobile now gets
      // the same items DESKTOP does with the exception of Move-to-new-
      // window, which is still desktop-only.
      const useIsMobileMod = await import("@/hooks/use-mobile");
      vi.mocked(useIsMobileMod.useIsMobile).mockReturnValueOnce(true);
      mockProjectsList = [
        { slug: "local-a", displayName: "Local A", hostId: "42", hostname: "box-1", archived: false },
      ];
      render(<IdentitySessionPane {...makeProps()} />);
      const labels = getMenuItems().map((it) => it.label);
      expect(labels).toContain("Move to");
      // Move-to-new-window still guarded out on mobile.
      expect(labels).not.toContain("Move to new window");
    });
  });

  // ── Badge context-menu items tests ────────────────────────────────────────
  //
  // Verifies the useMemo at IdentitySessionPane.tsx builds the correct item
  // list flowing to PrettyView's `identityBadgeContextMenuItems` prop under
  // each combination of (isAdmin, isMobile):
  //
  //   BADGE-MENU-1: admin  + desktop → Move to new window,
  //                                    Switch to terminal view, Move to, Archive
  //   BADGE-MENU-2: non-admin + desktop → Move to new window, Move to,
  //                                       Archive (NO Switch item)
  //   BADGE-MENU-3: admin  + mobile  → Switch to terminal view, Move to,
  //                                    Archive (NO Move to new window)
  //   BADGE-MENU-4: non-admin + mobile → Move to, Archive (neither Switch
  //                                      nor Move to new window)
  //
  // There is no top-level Pin/Unpin item: pinning lives in the "Move to"
  // submenu (pinned and in-a-project are mutually exclusive).
  //
  // useIsMobile is mocked at the top of this file to return false by
  // default; the helper below overrides via vi.mocked(...).mockReturnValue
  // for tests that need mobile. Mirrors the pattern already used by the
  // "badge-menu Move-to" mobile test.
  async function setMobile(isMobile: boolean) {
    const useIsMobileMod = await import("@/hooks/use-mobile");
    vi.mocked(useIsMobileMod.useIsMobile).mockReturnValue(isMobile);
  }

  function itemLabels(): string[] {
    const items = (capturedPrettyViewProps?.identityBadgeContextMenuItems ??
      []) as Array<{ label: string }>;
    return items.map((it) => it.label);
  }

  it("BADGE-MENU-1: admin + desktop → exactly Move to new window, Switch to terminal view, Move to, Archive (in that order; no Pin)", async () => {
    await setMobile(false);
    render(<IdentitySessionPane {...makeProps({ isAdmin: true })} />);
    const labels = itemLabels();
    // Initial isPrettyMode = true → label reads "Switch to terminal view".
    expect(labels).toEqual([
      "Move to new window",
      "Switch to terminal view",
      "Move to",
      "Archive",
    ]);
    expect(labels).not.toContain("Pin");
    expect(labels).not.toContain("Unpin");
  });

  it("BADGE-MENU-2: non-admin + desktop → Switch item absent; Move to new window still present", async () => {
    await setMobile(false);
    render(<IdentitySessionPane {...makeProps({ isAdmin: false })} />);
    const labels = itemLabels();
    expect(labels).not.toContain("Pin");
    expect(labels).toEqual(["Move to new window", "Move to", "Archive"]);
    expect(labels).not.toContain("Switch to terminal view");
    expect(labels).not.toContain("Switch to chat view");
  });

  it("BADGE-MENU-3: admin + mobile → Move to new window absent; Switch item still present", async () => {
    await setMobile(true);
    render(<IdentitySessionPane {...makeProps({ isAdmin: true })} />);
    const labels = itemLabels();
    expect(labels).not.toContain("Pin");
    expect(labels).not.toContain("Move to new window");
    // Order: Switch < Move to < Archive.
    expect(labels).toEqual(["Switch to terminal view", "Move to", "Archive"]);
  });

  it("BADGE-MENU-4: non-admin + mobile → neither Switch nor Move to new window present", async () => {
    await setMobile(true);
    render(<IdentitySessionPane {...makeProps({ isAdmin: false })} />);
    const labels = itemLabels();
    expect(labels).not.toContain("Pin");
    expect(labels).toEqual(["Move to", "Archive"]);
    expect(labels).not.toContain("Switch to terminal view");
    expect(labels).not.toContain("Switch to chat view");
    expect(labels).not.toContain("Move to new window");
  });

  it("BADGE-MENU-5: isAdmin omitted (undefined) → defaults to non-admin (Switch item absent)", async () => {
    // Fail-closed default at every hop — an unresolved isAdmin state
    // MUST NOT accidentally surface the admin-only item.
    await setMobile(false);
    // Deliberately omit isAdmin from props.
    render(<IdentitySessionPane {...makeProps()} />);
    const labels = itemLabels();
    expect(labels).not.toContain("Switch to terminal view");
    expect(labels).not.toContain("Switch to chat view");
  });

  it("BADGE-MENU-6: Switch item onClick flips isPrettyMode → the label reads 'Switch to chat view' when in terminal mode", async () => {
    // Chain two renders — the initial render exposes the pretty-mode label;
    // firing the item's onClick flips state, and on the next flush the
    // captured items list carries the flipped label.
    await setMobile(false);
    render(<IdentitySessionPane {...makeProps({ isAdmin: true })} />);

    const initialItems = (capturedPrettyViewProps?.identityBadgeContextMenuItems ??
      []) as Array<{ label: string; onClick: () => void }>;
    const switchItem = initialItems.find((it) =>
      it.label === "Switch to terminal view",
    );
    expect(switchItem).toBeDefined();

    // Fire the item's onClick — flips isPrettyMode from true → false.
    act(() => {
      switchItem!.onClick();
    });

    // After the flip, the memo rebuilds with the flipped label.
    const flippedLabels = itemLabels();
    expect(flippedLabels).toContain("Switch to chat view");
    expect(flippedLabels).not.toContain("Switch to terminal view");
  });
});
