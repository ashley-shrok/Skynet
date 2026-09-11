/**
 * matrix-message-send.test.ts — Phase 90 Plan 04 Task 1.
 *
 * Behavior contract for `sendRoomMessage`:
 *   - Validates body (non-empty after trim; length <= BODY_MAX_LENGTH; no NUL).
 *   - Validates txnId (non-empty; no NUL; length <= 256).
 *   - Delegates to Plan 03's sendMessageAsUser with mqid used VERBATIM as
 *     the Matrix txnId (Pitfall 4 correlation infrastructure).
 *   - Passes primitive error through verbatim on downstream failure.
 *
 * Mocks sendMessageAsUser at the matrix-admin-client boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../matrix/matrix-admin-client.js", () => ({
  sendMessageAsUser: vi.fn(),
}));

// eslint-disable-next-line import/first
import { sendMessageAsUser } from "../matrix/matrix-admin-client.js";
// eslint-disable-next-line import/first
import { sendRoomMessage } from "./matrix-message-send.js";

const mockSendMessageAsUser = sendMessageAsUser as unknown as ReturnType<
  typeof vi.fn
>;

describe("sendRoomMessage (Phase 90 Plan 04 Task 1)", () => {
  beforeEach(() => {
    mockSendMessageAsUser.mockReset();
  });

  it("Test 1: passes mqid VERBATIM as the Matrix txnId (Pitfall 4)", async () => {
    mockSendMessageAsUser.mockResolvedValueOnce({
      ok: true,
      eventId: "$evt-1:server",
    });

    const result = await sendRoomMessage(
      "@alice_human:server",
      "!room:server",
      "hello",
      "mqid-abc-123",
    );

    expect(mockSendMessageAsUser).toHaveBeenCalledWith(
      "@alice_human:server",
      "!room:server",
      "hello",
      "mqid-abc-123",
    );
    expect(result).toEqual({ ok: true, eventId: "$evt-1:server" });
  });

  it("Test 2: happy-path returns primitive result verbatim", async () => {
    mockSendMessageAsUser.mockResolvedValueOnce({
      ok: true,
      eventId: "$evt-happy:server",
    });

    const result = await sendRoomMessage(
      "@a:s",
      "!r:s",
      "hi",
      "txn-1",
    );

    expect(result).toEqual({ ok: true, eventId: "$evt-happy:server" });
  });

  it("Test 3a: empty body (after trim) rejects with 400 empty_body — no Matrix call", async () => {
    const result = await sendRoomMessage("@a:s", "!r:s", "   ", "txn-1");

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "empty_body",
    });
    expect(mockSendMessageAsUser).not.toHaveBeenCalled();
  });

  it("Test 3b: overlong body rejects with 413 body_too_long — no Matrix call", async () => {
    const overlong = "a".repeat(32769);
    const result = await sendRoomMessage("@a:s", "!r:s", overlong, "txn-1");

    expect(result).toEqual({
      ok: false,
      status: 413,
      error: "body_too_long",
    });
    expect(mockSendMessageAsUser).not.toHaveBeenCalled();
  });

  it("Test 4a: mqid with NUL byte rejects with 400 invalid_txn_id", async () => {
    const result = await sendRoomMessage(
      "@a:s",
      "!r:s",
      "hi",
      "txn-\x00-bad",
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "invalid_txn_id",
    });
    expect(mockSendMessageAsUser).not.toHaveBeenCalled();
  });

  it("Test 4b: empty mqid rejects with 400 invalid_txn_id", async () => {
    const result = await sendRoomMessage("@a:s", "!r:s", "hi", "");

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "invalid_txn_id",
    });
    expect(mockSendMessageAsUser).not.toHaveBeenCalled();
  });

  it("Test 4c: overlong mqid (>256 chars) rejects with 400 invalid_txn_id", async () => {
    const longTxn = "a".repeat(257);
    const result = await sendRoomMessage("@a:s", "!r:s", "hi", longTxn);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "invalid_txn_id",
    });
    expect(mockSendMessageAsUser).not.toHaveBeenCalled();
  });

  it("Test 5: primitive failure passes through verbatim", async () => {
    mockSendMessageAsUser.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });

    const result = await sendRoomMessage("@a:s", "!r:s", "hi", "txn-1");

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });
  });

  it("Test 6: body is trimmed before size check (non-empty after trim is valid)", async () => {
    mockSendMessageAsUser.mockResolvedValueOnce({
      ok: true,
      eventId: "$evt:s",
    });

    // Body has surrounding whitespace but is non-empty after trim — allowed.
    // The plan says validation is "non-empty after trim"; the actual body
    // sent should preserve intent (whitespace preserved is fine; a caller
    // relies on us NOT truncating).
    const result = await sendRoomMessage(
      "@a:s",
      "!r:s",
      "  hello  ",
      "txn-1",
    );

    expect(result.ok).toBe(true);
    expect(mockSendMessageAsUser).toHaveBeenCalledWith(
      "@a:s",
      "!r:s",
      "  hello  ",
      "txn-1",
    );
  });
});
