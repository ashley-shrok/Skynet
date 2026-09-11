/**
 * matrix-message-fetch.test.ts — Phase 90 Plan 04 Task 1.
 *
 * Behavior contract for `fetchRoomHistory`:
 *   - Composition-only layer over Plan 03's matrix-admin-client::getRoomMessages.
 *   - Canonicalizes 403/404 error codes to `not_member` / `not_found` for the
 *     WS server to translate into a Pitfall 8 D-18 `inactive` frame.
 *   - Passes through happy-path + empty-chunk (D-17) verbatim.
 *
 * Mocks getRoomMessages at the matrix-admin-client boundary — the primitive
 * itself is Plan 03's responsibility and has its own dedicated test suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock hoisting: the mock MUST come before the import of the module under
// test because that module imports from matrix-admin-client transitively.
vi.mock("../matrix/matrix-admin-client.js", () => ({
  getRoomMessages: vi.fn(),
}));

// eslint-disable-next-line import/first
import { getRoomMessages } from "../matrix/matrix-admin-client.js";
// eslint-disable-next-line import/first
import { fetchRoomHistory } from "./matrix-message-fetch.js";

const mockGetRoomMessages = getRoomMessages as unknown as ReturnType<typeof vi.fn>;

const SAMPLE_EVENT = {
  event_id: "$evt-1:server",
  type: "m.room.message",
  sender: "@alice_human:server",
  origin_server_ts: 1700000000000,
  content: { msgtype: "m.text", body: "hello" },
};

describe("fetchRoomHistory (Phase 90 Plan 04 Task 1)", () => {
  beforeEach(() => {
    mockGetRoomMessages.mockReset();
  });

  it("Test 1: paginated call passes beforeEventId as `from` cursor", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [SAMPLE_EVENT],
      end: "cursor-next",
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      beforeEventId: "cursor-prev",
      count: 20,
    });

    expect(mockGetRoomMessages).toHaveBeenCalledWith("!room:server", {
      dir: "b",
      from: "cursor-prev",
      limit: 20,
    });
    expect(result).toEqual({
      ok: true,
      events: [SAMPLE_EVENT],
      end: "cursor-next",
    });
  });

  it("Test 2: initial load (no beforeEventId) omits `from`", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [SAMPLE_EVENT],
      end: "cursor-tail",
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });

    expect(mockGetRoomMessages).toHaveBeenCalledWith("!room:server", {
      dir: "b",
      from: undefined,
      limit: 20,
    });
    expect(result.ok).toBe(true);
  });

  it("Test 3: 403 from Matrix canonicalizes to not_member error", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "admin_api_non_2xx",
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "not_member",
    });
  });

  it("Test 4: 404 from Matrix canonicalizes to not_found error", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "admin_api_non_2xx",
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("Test 5: empty chunk is D-17 empty-room state, not an error", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [],
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });

    expect(result).toEqual({
      ok: true,
      events: [],
    });
  });

  it("Test 6: other error statuses pass through verbatim (not canonicalized)", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });

    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: "admin_api_proxy_error",
    });
  });

  // ==========================================================================
  // M3 FIXUP TESTS (2026-09-09) — filter non-message events server-side
  // ==========================================================================

  const STATE_MEMBER_EVENT = {
    event_id: "$evt-join-1:server",
    type: "m.room.member",
    sender: "@alice_human:server",
    origin_server_ts: 1700000001000,
    content: { membership: "join" },
  };
  const STATE_NAME_EVENT = {
    event_id: "$evt-name-1:server",
    type: "m.room.name",
    sender: "@alice_human:server",
    origin_server_ts: 1700000002000,
    content: { name: "Working session" },
  };
  const REACTION_EVENT = {
    event_id: "$evt-reax-1:server",
    type: "m.reaction",
    sender: "@alice_human:server",
    origin_server_ts: 1700000003000,
    content: { "m.relates_to": { rel_type: "m.annotation", key: "👍" } },
  };

  it("M3-fixup: filters m.room.member state events out of the returned chunk", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [SAMPLE_EVENT, STATE_MEMBER_EVENT],
    });
    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.length).toBe(1);
      expect(result.events[0]!.type).toBe("m.room.message");
    }
  });

  it("M3-fixup: filters mixed state + reaction events; preserves m.room.message order", async () => {
    const secondMessage = {
      ...SAMPLE_EVENT,
      event_id: "$evt-2:server",
      content: { msgtype: "m.text", body: "second" },
    };
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [
        SAMPLE_EVENT,
        STATE_MEMBER_EVENT,
        REACTION_EVENT,
        secondMessage,
        STATE_NAME_EVENT,
      ],
      end: "cursor-next",
    });
    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Two messages survive; state + reaction dropped.
      expect(result.events.length).toBe(2);
      expect(result.events.map((e) => e.event_id)).toEqual([
        "$evt-1:server",
        "$evt-2:server",
      ]);
      // Cursor pass-through unchanged (opaque tokens, Matrix owns them).
      expect(result.end).toBe("cursor-next");
    }
  });

  it("M3-fixup: all-state chunk produces an empty event array (renders as empty-room state at the pane)", async () => {
    mockGetRoomMessages.mockResolvedValueOnce({
      ok: true,
      events: [STATE_MEMBER_EVENT, STATE_NAME_EVENT, REACTION_EVENT],
    });
    const result = await fetchRoomHistory("!room:server", {
      dir: "b",
      count: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toEqual([]);
    }
  });
});
