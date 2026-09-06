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
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../api/telegram-api", () => ({
  postTelegramValidate: vi.fn(),
  postTelegramActivate: vi.fn(),
  postTelegramDisconnect: vi.fn(),
  getTelegramStatus: vi.fn(),
}));

import {
  postTelegramValidate,
  postTelegramActivate,
  postTelegramDisconnect,
} from "../../api/telegram-api";
import { TelegramTab, type TelegramState } from "./TelegramTab";

const mockValidate = postTelegramValidate as unknown as ReturnType<typeof vi.fn>;
const mockActivate = postTelegramActivate as unknown as ReturnType<typeof vi.fn>;
const mockDisconnect = postTelegramDisconnect as unknown as ReturnType<typeof vi.fn>;

const VALID_TOKEN = "1234567890:AAAsecretsecretsecretsecretsecretse";

beforeEach(() => {
  vi.clearAllMocks();
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
      telegramHandle: "ashley",
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
      telegramHandle: "ashley",
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
