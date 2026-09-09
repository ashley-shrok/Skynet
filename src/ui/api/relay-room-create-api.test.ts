// Phase 91 Plan 04 — relay-room-create-api.test.ts
//
// Tests for the createRelayRoom() frontend api client.
// Mocks authApi via vi.mock("@/main-axios") per the authApi.post wrapper
// convention established in user-management-api.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRelayRoom } from "./relay-room-create-api";

// ─── Mocks (hoisted before imports by Vitest) ─────────────────────────────
vi.mock("@/main-axios", () => ({
  authApi: {
    post: vi.fn(),
  },
  handleApiError: vi.fn((error: unknown, _action: string) => {
    throw error;
  }),
}));

describe("relay-room-create-api (Phase 91 Plan 04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1: happy path ───────────────────────────────────────────────────
  it("Test 1: createRelayRoom resolves with typed CreateRelayRoomResponse on success", async () => {
    const { authApi } = await import("@/main-axios");
    const mockPost = vi.mocked(authApi.post);
    mockPost.mockResolvedValueOnce({
      data: {
        ok: true,
        roomId: "!r:s",
        sessionId: "s-1",
        roomTitle: "Chat",
      },
    });

    const req = {
      roomName: "Chat",
      humanMxids: ["@a:s"],
      agentMxids: ["@b:s"],
    };

    const result = await createRelayRoom(req);

    expect(result).toEqual({
      ok: true,
      roomId: "!r:s",
      sessionId: "s-1",
      roomTitle: "Chat",
    });
    expect(mockPost).toHaveBeenCalledWith("/relay-room/create", req);
  });

  // ─── Test 2: error path ───────────────────────────────────────────────────
  it("Test 2: createRelayRoom throws via handleApiError on axios 400 error", async () => {
    const { authApi, handleApiError } = await import("@/main-axios");
    const mockPost = vi.mocked(authApi.post);
    const axiosError = Object.assign(new Error("Bad Request"), {
      isAxiosError: true,
      response: {
        status: 400,
        data: { error: "room_name_required" },
      },
    });
    mockPost.mockRejectedValueOnce(axiosError);

    const mockHandleApiError = vi.mocked(handleApiError);
    mockHandleApiError.mockImplementationOnce((err: unknown, _action: string) => {
      throw err;
    });

    const req = {
      roomName: "",
      humanMxids: ["@a:s"],
      agentMxids: [],
    };

    await expect(createRelayRoom(req)).rejects.toThrow();
    expect(mockHandleApiError).toHaveBeenCalledWith(
      axiosError,
      "create relay room",
    );
  });
});
