/**
 * Phase 79 Plan 07 Task 2 — TelegramTab tests
 *
 * Seven tests covering the four state variants (unconfigured / pending-start /
 * connected / restart-failed) plus the three flow gates:
 *   1. unconfigured + valid token submit → activate → pending-start
 *   2. unconfigured + invalid token → inline error, input cleared, activate NOT called
 *   3. pending-start + Cancel → disconnect → unconfigured
 *   4. connected + Disconnect → AlertDialog with verbatim CONTEXT § 3D text →
 *      Confirm → disconnect → unconfigured
 *   5. connected + Disconnect → AlertDialog Cancel → still connected, onStateChange not called
 *   6. restart-failed + Retry → disconnect → unconfigured
 *   7. Token security: after successful activate, raw token string is NOT
 *      present in the DOM (T-79-07-02)
 *
 * Mock strategy: mock ../../api/telegram-api entirely so we can control each
 * fetch wrapper's return without a network round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../api/telegram-api", () => ({
  postTelegramValidate: vi.fn(),
  postTelegramActivate: vi.fn(),
  postTelegramDisconnect: vi.fn(),
  getTelegramStatus: vi.fn(),
  getTelegramPendingStatus: vi.fn(),
}));

import {
  postTelegramValidate,
  postTelegramActivate,
  postTelegramDisconnect,
  getTelegramPendingStatus,
} from "../../api/telegram-api";
import { TelegramTab, type TelegramState } from "./TelegramTab";

const mockValidate = postTelegramValidate as unknown as ReturnType<typeof vi.fn>;
const mockActivate = postTelegramActivate as unknown as ReturnType<typeof vi.fn>;
const mockDisconnect = postTelegramDisconnect as unknown as ReturnType<typeof vi.fn>;
const mockGetTelegramPendingStatus =
  getTelegramPendingStatus as unknown as ReturnType<typeof vi.fn>;

const VALID_TOKEN = "1234567890:AAAsecretsecretsecretsecretsecretse";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: poll returns null chatId so pre-existing tests that end in
  // pending-start (Test 1) don't crash when the interval fires. Individual
  // PLL tests override this via mockResolvedValueOnce chains.
  mockGetTelegramPendingStatus.mockResolvedValue({ ok: true, chatId: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderTab(
  state: TelegramState,
  overrides: { humanUserId?: string; onStateChange?: (s: TelegramState) => void } = {},
) {
  const onStateChange = overrides.onStateChange ?? vi.fn();
  render(
    <TelegramTab
      state={state}
      identityKey="alexander"
      identityName="Alexander"
      humanUserId={overrides.humanUserId ?? "user-42"}
      onStateChange={onStateChange}
    />,
  );
  return { onStateChange };
}

// ─── Test 1: unconfigured → submit valid token → pending-start ─────────────
describe("Test 1 — unconfigured: submit valid token transitions to pending-start", () => {
  it("calls validate then activate; onStateChange fires with pending-start; token input cleared", async () => {
    mockValidate.mockResolvedValueOnce({
      ok: true,
      botUsername: "alex_bot",
      botId: 999,
      firstName: "Alex",
    });
    mockActivate.mockResolvedValueOnce({ ok: true, botUsername: "alex_bot" });

    const { onStateChange } = renderTab({ status: "unconfigured" });

    const input = screen.getByLabelText(/bot token/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockValidate).toHaveBeenCalledWith({ botToken: VALID_TOKEN });
      expect(mockActivate).toHaveBeenCalledWith({
        identityKey: "alexander",
        botToken: VALID_TOKEN,
        humanUserId: "user-42",
      });
      expect(onStateChange).toHaveBeenCalledWith({
        status: "pending-start",
        botUsername: "alex_bot",
        botLink: "https://t.me/alex_bot",
      });
    });
  });
});

// ─── Test 2: unconfigured → invalid token → inline error, input cleared ────
describe("Test 2 — unconfigured: bad token clears input and shows inline error; activate NOT called", () => {
  it("renders inline error and does not call activate", async () => {
    mockValidate.mockResolvedValueOnce({ ok: false, error: "Unauthorized" });

    const { onStateChange } = renderTab({ status: "unconfigured" });

    const input = screen.getByLabelText(/bot token/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1234567890:BADBADBAD" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockValidate).toHaveBeenCalled();
      // CONTEXT § 3B: "Telegram rejected that token — check you copied the
      // full string from @BotFather." Test asserts substring.
      expect(screen.getByText(/Telegram rejected/i)).toBeTruthy();
    });
    expect(mockActivate).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
    // input value cleared
    expect((screen.getByLabelText(/bot token/i) as HTMLInputElement).value).toBe("");
  });
});

// ─── Test 3: pending-start → Cancel → unconfigured ─────────────────────────
describe("Test 3 — pending-start: Cancel calls disconnect and transitions to unconfigured", () => {
  it("Cancel click → disconnect → onStateChange({status:unconfigured})", async () => {
    mockDisconnect.mockResolvedValueOnce({ ok: true });

    const { onStateChange } = renderTab({
      status: "pending-start",
      botUsername: "alex_bot",
      botLink: "https://t.me/alex_bot",
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith({ identityKey: "alexander" });
      expect(onStateChange).toHaveBeenCalledWith({ status: "unconfigured" });
    });
  });
});

// ─── Test 4: connected → Disconnect → AlertDialog confirm → unconfigured ───
describe("Test 4 — connected: Disconnect opens AlertDialog with verbatim CONTEXT § 3D text; Confirm disconnects", () => {
  it("opens dialog with verbatim text, Confirm calls disconnect and transitions to unconfigured", async () => {
    mockDisconnect.mockResolvedValueOnce({ ok: true });

    const { onStateChange } = renderTab({
      status: "connected",
      botUsername: "alex_bot",
      telegramHandle: "alice",
    });

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    // AlertDialog content — CONTEXT § 3D verbatim
    await waitFor(() => {
      expect(
        screen.getByText(/The bot stays alive in Telegram/),
      ).toBeTruthy();
    });

    // Confirm inside the dialog
    const confirmButton = screen.getByRole("button", { name: /^confirm$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith({ identityKey: "alexander" });
      expect(onStateChange).toHaveBeenCalledWith({ status: "unconfigured" });
    });
  });
});

// ─── Test 5: connected → Disconnect → AlertDialog Cancel → still connected ─
describe("Test 5 — connected: AlertDialog Cancel does NOT disconnect", () => {
  it("Cancel closes the dialog without calling disconnect or onStateChange", async () => {
    const { onStateChange } = renderTab({
      status: "connected",
      botUsername: "alex_bot",
      telegramHandle: "alice",
    });

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    // AlertDialog appears — dismiss via Cancel button inside the dialog.
    await waitFor(() => {
      expect(screen.getByText(/The bot stays alive/)).toBeTruthy();
    });
    // There will be TWO "cancel" buttons if the test renders more than
    // one — inside the AlertDialog we filter by dialog role.
    const dialog = screen.getByRole("alertdialog");
    const cancelInDialog = dialog.querySelector<HTMLButtonElement>(
      'button[data-testid="telegram-disconnect-cancel"]',
    );
    expect(cancelInDialog).not.toBeNull();
    fireEvent.click(cancelInDialog!);

    // No side effects.
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

// ─── Test 6: restart-failed → Retry → disconnect → unconfigured ────────────
describe("Test 6 — restart-failed: Retry re-attempts disconnect", () => {
  it("Retry click → disconnect → onStateChange({status:unconfigured})", async () => {
    mockDisconnect.mockResolvedValueOnce({ ok: true });

    const { onStateChange } = renderTab({
      status: "restart-failed",
      error: "bridge did not come back",
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith({ identityKey: "alexander" });
      expect(onStateChange).toHaveBeenCalledWith({ status: "unconfigured" });
    });
  });
});

// ─── Test 7: token never lingers in DOM after successful activate ──────────
describe("Test 7 — raw bot token does NOT appear in the DOM (T-79-07-02)", () => {
  it("after activate succeeds, the token substring is not in document.body.innerHTML", async () => {
    mockValidate.mockResolvedValueOnce({
      ok: true,
      botUsername: "alex_bot",
      botId: 999,
      firstName: "Alex",
    });
    mockActivate.mockResolvedValueOnce({ ok: true, botUsername: "alex_bot" });

    renderTab({ status: "unconfigured" });

    const input = screen.getByLabelText(/bot token/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: VALID_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalled();
    });

    // Post-flow: input has been cleared (state transition scrubs token
    // from local state); the raw token substring is nowhere in the DOM.
    expect(document.body.innerHTML.includes(VALID_TOKEN)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 80 Plan 06 — pending-start poll suite
// ═══════════════════════════════════════════════════════════════════════════
//
// This suite lives in its own describe block with its own beforeEach/afterEach
// wiring fake timers. The prior suites use real timers (they rely on
// waitFor + microtask flushing for async state updates). Keeping the fake-
// timer setup scoped to this block avoids cross-suite interference.
//
// Cadence: 3000ms per CONTEXT § 5 (chosen from the 3-5s range).
// Error semantics: poll errors are silently swallowed — no error-state flip
// per CONTEXT § 5 "human gets to it when they get to it".

describe("Phase 80 Plan 06 — pending-start 3s poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTelegramPendingStatus.mockResolvedValue({ ok: true, chatId: null });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper: advance timers AND flush the microtask queue so any Promise
  // resolutions kicked off by the timer callback settle before assertions.
  // Wrapped in act() because React state updates may follow.
  async function tick(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      // Drain microtasks: one macrotask hop plus a Promise flush is enough
      // for the poll's single `await getTelegramPendingStatus(...)` chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // ─── PLL-01: poll fires on pending-start entry, at 3s cadence ─────────────
  it("PLL-01: poll fires every 3s with identityKey while in pending-start", async () => {
    const { rerender } = render(
      <TelegramTab
        state={{
          status: "pending-start",
          botUsername: "alex_bot",
          botLink: "https://t.me/alex_bot",
        }}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={vi.fn()}
      />,
    );

    // No poll before the first interval tick
    expect(mockGetTelegramPendingStatus).not.toHaveBeenCalled();

    await tick(3000);
    expect(mockGetTelegramPendingStatus).toHaveBeenCalledTimes(1);
    expect(mockGetTelegramPendingStatus).toHaveBeenLastCalledWith("alexander");

    await tick(3000);
    expect(mockGetTelegramPendingStatus).toHaveBeenCalledTimes(2);
    expect(mockGetTelegramPendingStatus).toHaveBeenLastCalledWith("alexander");

    // Silence unused-var lint
    void rerender;
  });

  // ─── PLL-02: transitions to connected on non-null chatId ──────────────────
  it("PLL-02: transitions to connected on non-null chatId; stops polling after", async () => {
    mockGetTelegramPendingStatus
      .mockResolvedValueOnce({ ok: true, chatId: null })
      .mockResolvedValueOnce({ ok: true, chatId: "12345678" })
      .mockResolvedValue({ ok: true, chatId: "12345678" });

    const onStateChange = vi.fn();

    // The parent normally rerenders with the new state after onStateChange.
    // Simulate that by rerendering into the connected state on the call.
    let currentState: TelegramState = {
      status: "pending-start",
      botUsername: "alex_bot",
      botLink: "https://t.me/alex_bot",
    };
    onStateChange.mockImplementation((next: TelegramState) => {
      currentState = next;
    });

    const { rerender } = render(
      <TelegramTab
        state={currentState}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={onStateChange}
      />,
    );

    // First tick — chatId null → no transition
    await tick(3000);
    expect(onStateChange).not.toHaveBeenCalled();

    // Second tick — chatId "12345678" → transition to connected
    await tick(3000);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith({
      status: "connected",
      botUsername: "alex_bot",
      telegramHandle: "12345678",
    });

    // Parent-simulated rerender with the new state — poll effect should
    // clean up now that state.status !== "pending-start"
    rerender(
      <TelegramTab
        state={currentState}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={onStateChange}
      />,
    );

    const callsAfterTransition = mockGetTelegramPendingStatus.mock.calls.length;

    // Third tick — no new poll should fire (we're in connected state)
    await tick(3000);
    expect(mockGetTelegramPendingStatus.mock.calls.length).toBe(
      callsAfterTransition,
    );
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  // ─── PLL-03: poll swallows errors — does NOT flip to error state ──────────
  it("PLL-03: poll errors do NOT transition state (no error-state flip per CONTEXT § 5)", async () => {
    mockGetTelegramPendingStatus.mockResolvedValue({
      ok: false,
      error: "network down",
    });

    const onStateChange = vi.fn();
    render(
      <TelegramTab
        state={{
          status: "pending-start",
          botUsername: "alex_bot",
          botLink: "https://t.me/alex_bot",
        }}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={onStateChange}
      />,
    );

    await tick(3000);
    await tick(3000);
    await tick(3000);

    expect(mockGetTelegramPendingStatus).toHaveBeenCalledTimes(3);
    expect(onStateChange).not.toHaveBeenCalled();

    // Still rendering pending-start UI
    expect(screen.getByText(/Waiting for you to send/)).toBeTruthy();
  });

  // ─── PLL-04: poll stopped on unmount ──────────────────────────────────────
  it("PLL-04: cleanup on unmount — no polls fire after unmount", async () => {
    const { unmount } = render(
      <TelegramTab
        state={{
          status: "pending-start",
          botUsername: "alex_bot",
          botLink: "https://t.me/alex_bot",
        }}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={vi.fn()}
      />,
    );

    await tick(3000);
    const callsBeforeUnmount = mockGetTelegramPendingStatus.mock.calls.length;
    expect(callsBeforeUnmount).toBe(1);

    unmount();

    await tick(6000);
    expect(mockGetTelegramPendingStatus.mock.calls.length).toBe(
      callsBeforeUnmount,
    );
  });

  // ─── PLL-05: poll does NOT start in other states ──────────────────────────
  it("PLL-05: poll does NOT start in unconfigured / connected / restart-failed / loading / error", async () => {
    const states: TelegramState[] = [
      { status: "unconfigured" },
      { status: "connected", botUsername: "alex_bot", telegramHandle: "12345678" },
      { status: "restart-failed", error: "boom" },
      { status: "loading" },
      { status: "error", error: "boom" },
    ];

    for (const s of states) {
      const { unmount } = render(
        <TelegramTab
          state={s}
          identityKey="alexander"
          identityName="Alexander"
          humanUserId="user-42"
          onStateChange={vi.fn()}
        />,
      );
      await tick(6000);
      unmount();
    }

    expect(mockGetTelegramPendingStatus).not.toHaveBeenCalled();
  });

  // ─── PLL-06: poll re-keys on identityKey change ───────────────────────────
  it("PLL-06: identityKey change restarts interval with the new key", async () => {
    const { rerender } = render(
      <TelegramTab
        state={{
          status: "pending-start",
          botUsername: "alex_bot",
          botLink: "https://t.me/alex_bot",
        }}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={vi.fn()}
      />,
    );

    await tick(3000);
    expect(mockGetTelegramPendingStatus).toHaveBeenLastCalledWith("alexander");
    const callsAfterFirst = mockGetTelegramPendingStatus.mock.calls.length;

    rerender(
      <TelegramTab
        state={{
          status: "pending-start",
          botUsername: "alex_bot",
          botLink: "https://t.me/alex_bot",
        }}
        identityKey="bravo"
        identityName="Bravo"
        humanUserId="user-42"
        onStateChange={vi.fn()}
      />,
    );

    await tick(3000);
    // Must have fired at least one more poll and the most recent must be
    // with the new key.
    expect(mockGetTelegramPendingStatus.mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
    expect(mockGetTelegramPendingStatus).toHaveBeenLastCalledWith("bravo");
  });

  // ─── PLL-07: after transition, no further polls even if chatId arrives ─────
  it("PLL-07: no further polls after pending-start → connected transition even after 30s", async () => {
    mockGetTelegramPendingStatus.mockResolvedValueOnce({
      ok: true,
      chatId: "42",
    });

    const onStateChange = vi.fn();
    let currentState: TelegramState = {
      status: "pending-start",
      botUsername: "alex_bot",
      botLink: "https://t.me/alex_bot",
    };
    onStateChange.mockImplementation((next: TelegramState) => {
      currentState = next;
    });

    const { rerender } = render(
      <TelegramTab
        state={currentState}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={onStateChange}
      />,
    );

    await tick(3000);
    expect(onStateChange).toHaveBeenCalledWith({
      status: "connected",
      botUsername: "alex_bot",
      telegramHandle: "42",
    });

    rerender(
      <TelegramTab
        state={currentState}
        identityKey="alexander"
        identityName="Alexander"
        humanUserId="user-42"
        onStateChange={onStateChange}
      />,
    );

    const callsAfterTransition = mockGetTelegramPendingStatus.mock.calls.length;
    // Advance 30s — many potential interval firings
    await tick(30_000);
    expect(mockGetTelegramPendingStatus.mock.calls.length).toBe(
      callsAfterTransition,
    );
  });
});
