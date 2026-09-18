import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Phase 117 Plan 117-06 Task 1 — session-project-api ──────────────────────
//
// Locks the wire shape of the two session-project fetch wrappers landed by
// 117-05's backend route:
//
//   POST /identities/:key/project              body { hostId, project }
//                                                → { ok: true }
//   POST /relay-rooms/:roomId/project          body { userMxid, project }
//                                                → { ok: true }
//
// Both `project` params accept slug string or null (null clears the field).
// Byte-shape mirror of identity-archive-api.test.ts.

vi.mock("@/main-axios", () => ({
  authApi: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  },
  handleApiError: (err: unknown, operation: string): never => {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";
    throw new Error(`${operation}: ${msg}`);
  },
}));

import {
  setSessionProject,
  setRelayRoomProject,
} from "@/api/session-project-api";
import { authApi } from "@/main-axios";

describe("Phase 117 Plan 117-06 Task 1 — session-project-api", () => {
  beforeEach(() => {
    vi.mocked(authApi.post).mockReset();
    vi.mocked(authApi.get).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Test 7 — setSessionProject assign
  it("Test 7 (setSessionProject assign): POSTs /identities/wren/project with body {hostId, project: 'alpha'}", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    const result = await setSessionProject(1, "wren", "alpha");

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/identities/wren/project", {
      hostId: 1,
      project: "alpha",
    });
    expect(result).toEqual({ ok: true });
  });

  // Test 8 — setSessionProject clear
  it("Test 8 (setSessionProject clear): null projectSlug produces body {hostId, project: null}", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    await setSessionProject(1, "wren", null);

    expect(authApi.post).toHaveBeenCalledWith("/identities/wren/project", {
      hostId: 1,
      project: null,
    });
  });

  // Test 9 — setSessionProject identity key URL-encoded
  it("Test 9 (setSessionProject identity key encoded): key 'id:1' becomes 'id%3A1' in the URL segment", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    await setSessionProject(1, "id:1", "alpha");

    expect(authApi.post).toHaveBeenCalledWith("/identities/id%3A1/project", {
      hostId: 1,
      project: "alpha",
    });
  });

  // Test 10 — setSessionProject error path
  it("Test 10 (setSessionProject error): rejected axios promise surfaces via handleApiError with 'set session project' label", async () => {
    vi.mocked(authApi.post).mockRejectedValueOnce(
      new Error("Request failed with status code 404"),
    );

    await expect(setSessionProject(1, "wren", "alpha")).rejects.toThrow(
      /set session project/i,
    );
  });

  // Test 11 — setRelayRoomProject assign
  //   roomId is "!room:host" — MUST be percent-encoded fully; userMxid goes
  //   into the JSON body, not the URL.
  it("Test 11 (setRelayRoomProject assign): POSTs /relay-rooms/%21room%3Ahost/project with body {userMxid, project}", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    const result = await setRelayRoomProject(
      "!room:host",
      "@ash:host",
      "alpha",
    );

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith(
      "/relay-rooms/%21room%3Ahost/project",
      { userMxid: "@ash:host", project: "alpha" },
    );
    expect(result).toEqual({ ok: true });
  });

  // Test 12 — setRelayRoomProject clear
  it("Test 12 (setRelayRoomProject clear): null projectSlug produces body.project === null", async () => {
    vi.mocked(authApi.post).mockResolvedValueOnce({
      data: { ok: true },
    });

    await setRelayRoomProject("!room:host", "@ash:host", null);

    const calledBody = vi.mocked(authApi.post).mock.calls[0][1] as {
      userMxid: string;
      project: string | null;
    };
    expect(calledBody.project).toBeNull();
    expect(calledBody.userMxid).toBe("@ash:host");
  });
});
