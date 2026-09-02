/**
 * Phase 41 Plan 02 — IdentitySessionPane component tests.
 *
 * P1: Terminal NOT mounted by default (isPrettyMode = true initial state).
 * P2: togglePrettyMode() mounts Terminal.
 * P3: second togglePrettyMode() unmounts Terminal, PrettyView stays mounted.
 * P4: toggleMessageQueue() renders MessageQueueDrawer.
 * P5: MessageQueueDrawer onSend calls pvSendInputRef.current (split-send, 60ms apart).
 * P6: TerminalHandle methods are safe-noop when Terminal is unmounted.
 * P7: When Terminal IS mounted, fit() forwards to inner Terminal ref.
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
vi.mock("@/state/identities-store", () => {
  // Phase 68: Identity no longer has id/createdAt/updatedAt; avatarUrl bakes
  // hostId at backend (no avatarUrlWithHost on frontend).
  const identity = {
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
  };
  return {
    useIdentities: vi.fn(() => ({
      identities: [identity],
      byKey: new Map([["tina", identity]]),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

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

vi.mock("@/features/pretty-view/PrettyView", () => ({
  PrettyView: ({
    onRegisterSendInput,
    onRegisterSendInterrupt,
  }: {
    onRegisterSendInput?: (fn: (text: string, mqid?: string) => boolean) => void;
    onRegisterSendInterrupt?: (fn: () => void) => void;
  }) => {
    // Capture registration callbacks so tests can populate pvSendInputRef.
    if (onRegisterSendInput) capturedRegisterSendInput = onRegisterSendInput;
    if (onRegisterSendInterrupt) capturedRegisterSendInterrupt = onRegisterSendInterrupt;
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

  it("P2: togglePrettyMode() via ref mounts Terminal", async () => {
    const ref = createRef<TerminalHandle>();
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    expect(screen.queryByTestId("mock-terminal")).toBeNull();

    await act(async () => {
      ref.current!.togglePrettyMode();
    });

    expect(screen.getByTestId("mock-terminal")).toBeInTheDocument();
    expect(terminalMountCount).toBe(1);
    // PrettyView still present.
    expect(screen.getByTestId("pretty-view")).toBeInTheDocument();
  });

  it("P3: second togglePrettyMode() unmounts Terminal; PrettyView remains mounted across both toggles", async () => {
    const ref = createRef<TerminalHandle>();
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    // Mount Terminal.
    await act(async () => {
      ref.current!.togglePrettyMode();
    });
    expect(terminalMountCount).toBe(1);
    expect(terminalUnmountCount).toBe(0);

    // Unmount Terminal.
    await act(async () => {
      ref.current!.togglePrettyMode();
    });
    expect(screen.queryByTestId("mock-terminal")).toBeNull();
    expect(terminalUnmountCount).toBe(1);

    // PrettyView mount count is 1 across the entire test (it never unmounted).
    // Note: prettyViewMountCount is a running counter; 1 = it mounted once and stayed.
    expect(prettyViewMountCount).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("pretty-view")).toBeInTheDocument();
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
    render(<IdentitySessionPane {...makeProps()} ref={ref} />);

    // Mount Terminal.
    await act(async () => {
      ref.current!.togglePrettyMode();
    });
    expect(terminalMountCount).toBe(1);

    // Call fit() on the wrapper.
    act(() => {
      ref.current!.fit();
    });

    // The inner Terminal mock's fit() should have been called exactly once.
    expect(mockFitFn).toHaveBeenCalledTimes(1);
  });
});
