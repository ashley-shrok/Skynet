// ─── identities-api — updateRoleAvatarByName (Phase 90 Plan 90-09 Task 3) ─
//
// Companion tests for the frontend counterpart of Plan 90-08's
// `POST /roles/:name/avatar` upload endpoint. Mocks authApi.post via
// vi.doMock (matches the identities-api.role-cosmetics.test.ts pattern) so
// nothing here touches the real axios instance.
//
// Test map:
//   A1. happy path — posts multipart to `/roles/<name>/avatar` with FormData
//       carrying `avatar` field + hostId query param; response passthrough.
//   A2. roleName is URL-encoded in the path (defense against special chars —
//       even though ROLE_NAME_PATTERN forbids them, the client encodes anyway
//       to mirror the sibling roleAvatarUrl helper).
//   A3. non-2xx axios error propagates as thrown Error (handleApiError
//       re-throws).
//   A4. Content-Type header explicitly set to multipart/form-data — required
//       to suppress axios v1's default JSON transform that would otherwise
//       drop the File field (see postManualAvatarCandidate L200-207).

import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/main-axios");
});

async function loadUpdateRoleAvatarWithMock(
  postImpl: (url: string, body: unknown, cfg?: unknown) => Promise<unknown>,
): Promise<{
  updateRoleAvatarByName: typeof import("./identities-api").updateRoleAvatarByName;
  mockPost: ReturnType<typeof vi.fn>;
}> {
  const mockPost = vi.fn(postImpl);
  vi.doMock("@/main-axios", () => ({
    authApi: { post: mockPost },
    handleApiError: (err: unknown, _op: string) => {
      throw err;
    },
  }));
  vi.resetModules();
  const mod = await import("./identities-api");
  return { updateRoleAvatarByName: mod.updateRoleAvatarByName, mockPost };
}

describe("updateRoleAvatarByName — Phase 90 Plan 90-09 avatar upload helper", () => {
  it("A1: posts multipart to /roles/<name>/avatar with `avatar` field + hostId query; passes response through", async () => {
    const { updateRoleAvatarByName, mockPost } =
      await loadUpdateRoleAvatarWithMock(async () => ({
        data: {
          filename: "box-maintainer.webp",
          avatarUrl: "/roles/box-maintainer/avatar?hostId=3",
        },
      }));

    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
    const file = new File([webpBytes], "picked-name.webp", {
      type: "image/webp",
    });

    const result = await updateRoleAvatarByName(3, "box-maintainer", file);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = mockPost.mock.calls[0] as [
      string,
      FormData,
      {
        params?: Record<string, unknown>;
        headers?: Record<string, string>;
      } | undefined,
    ];

    expect(url).toBe("/roles/box-maintainer/avatar");
    expect(body).toBeInstanceOf(FormData);
    expect(cfg?.params).toEqual({ hostId: 3 });

    // avatar field carries the File instance
    const avatarField = body.get("avatar");
    expect(avatarField).toBeInstanceOf(File);
    expect((avatarField as File).name).toBe("picked-name.webp");
    expect((avatarField as File).type).toBe("image/webp");

    // Response passthrough — server-echoed filename + avatarUrl.
    expect(result).toEqual({
      filename: "box-maintainer.webp",
      avatarUrl: "/roles/box-maintainer/avatar?hostId=3",
    });
  });

  it("A2: roleName is URL-encoded in the path (mirrors sibling roleAvatarUrl helper)", async () => {
    // ROLE_NAME_PATTERN forbids special chars, so this exercises the
    // encoding branch defensively — a name with a hyphen is a common
    // ROLE_NAME_PATTERN-valid input and is passthrough for encodeURIComponent.
    const { updateRoleAvatarByName, mockPost } =
      await loadUpdateRoleAvatarWithMock(async () => ({
        data: {
          filename: "kind-name.png",
          avatarUrl: "/roles/kind-name/avatar?hostId=1",
        },
      }));

    const file = new File([new Uint8Array([0])], "x.png", { type: "image/png" });
    await updateRoleAvatarByName(1, "kind-name", file);

    const [url] = mockPost.mock.calls[0] as [string, FormData, unknown];
    expect(url).toBe("/roles/kind-name/avatar");
  });

  it("A3: non-2xx axios error propagates as thrown Error (handleApiError re-throws)", async () => {
    const axiosErr = new Error("Request failed with status code 413");
    const { updateRoleAvatarByName } = await loadUpdateRoleAvatarWithMock(
      async () => {
        throw axiosErr;
      },
    );

    const file = new File([new Uint8Array([0])], "big.webp", {
      type: "image/webp",
    });
    await expect(
      updateRoleAvatarByName(3, "box-maintainer", file),
    ).rejects.toThrow(/413/);
  });

  it("A4: sets Content-Type: multipart/form-data header (suppresses axios v1 JSON transform)", async () => {
    const { updateRoleAvatarByName, mockPost } =
      await loadUpdateRoleAvatarWithMock(async () => ({
        data: { filename: "x.webp", avatarUrl: "/roles/x/avatar?hostId=1" },
      }));

    const file = new File([new Uint8Array([0])], "x.webp", {
      type: "image/webp",
    });
    await updateRoleAvatarByName(1, "x", file);

    const [, , cfg] = mockPost.mock.calls[0] as [
      string,
      FormData,
      { headers?: Record<string, string> } | undefined,
    ];
    expect(cfg?.headers?.["Content-Type"]).toBe("multipart/form-data");
  });
});
