// ─── identities-api — Phase 85 Plan 85-01 Task 3 (createRole widening) ─────
//
// Phase 85 pulls forward what would have been Plan 85-02's Task 2 (client-side
// createRole widening) into Wave 1 to resolve the file-ownership conflict on
// src/ui/api/identities-api.ts (85-01 owns the full file this wave). The
// backend endpoint that speaks the new multipart body ships in Plan 85-02 in
// parallel; these tests mock authApi so they don't depend on the real backend.
//
// Test map (5 tests per plan Task 3 <behavior>):
//   C-1: no cosmetics, no avatar → multipart with `data` JSON only.
//   C-2: cosmetics present, no avatar → multipart with `data` JSON carrying
//        cosmetics, NO `avatar` file part.
//   C-3: cosmetics + avatar File → multipart with `data` JSON AND `avatar` part.
//   C-4: 409 response still throws RoleAlreadyExistsError(name) (regression).
//   C-5: backward-compat — existing single-argument call sites still typecheck
//        AND behave (no cosmetics implied).

import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/main-axios");
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: install an authApi.post mock, import the fresh module, return the
// widened createRole + the mock so per-test can assert call shape.
// ─────────────────────────────────────────────────────────────────────────────

async function loadCreateRoleWithMock(
  postImpl: (url: string, body: unknown, cfg?: unknown) => Promise<unknown>,
): Promise<{
  createRole: typeof import("./identities-api").createRole;
  RoleAlreadyExistsError: typeof import("./identities-api").RoleAlreadyExistsError;
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
  return {
    createRole: mod.createRole,
    RoleAlreadyExistsError: mod.RoleAlreadyExistsError,
    mockPost,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// C-1: bare create — no cosmetics, no avatar
// ─────────────────────────────────────────────────────────────────────────────

describe("createRole — Phase 85 widened multipart shape", () => {
  it("C-1: bare create sends multipart/form-data with `data` JSON only, no avatar part", async () => {
    const { createRole, mockPost } = await loadCreateRoleWithMock(async () => ({
      data: { name: "box-maintainer", description: "keeps the boxes", cosmetics: {} },
    }));

    await createRole({
      name: "box-maintainer",
      description: "keeps the boxes",
      hostId: 1,
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = mockPost.mock.calls[0] as [
      string,
      FormData,
      { headers?: Record<string, string> } | undefined,
    ];
    expect(url).toBe("/roles");
    expect(body).toBeInstanceOf(FormData);
    expect(cfg?.headers?.["Content-Type"]).toBe("multipart/form-data");

    // data field carries the JSON payload
    const dataField = body.get("data");
    expect(typeof dataField).toBe("string");
    const parsed = JSON.parse(dataField as string) as Record<string, unknown>;
    expect(parsed.name).toBe("box-maintainer");
    expect(parsed.description).toBe("keeps the boxes");
    expect(parsed.hostId).toBe(1);

    // No avatar file part
    expect(body.get("avatar")).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────
  // C-2: cosmetics present, no avatar file
  // ───────────────────────────────────────────────────────────────────────
  it("C-2: cosmetics-only send: `data` JSON carries cosmetics, NO avatar file part", async () => {
    const { createRole, mockPost } = await loadCreateRoleWithMock(async () => ({
      data: {
        name: "box-maintainer",
        description: "keeps the boxes",
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Kate.wav" },
      },
    }));

    await createRole(
      {
        name: "box-maintainer",
        description: "keeps the boxes",
        hostId: 1,
        cosmetics: { title: "Box maintainer", colorHue: 190, voice: "Kate.wav" },
      },
      undefined,
    );

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, body] = mockPost.mock.calls[0] as [string, FormData];
    const parsed = JSON.parse(body.get("data") as string) as Record<
      string,
      unknown
    >;
    expect(parsed.cosmetics).toEqual({
      title: "Box maintainer",
      colorHue: 190,
      voice: "Kate.wav",
    });
    expect(body.get("avatar")).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────
  // C-3: cosmetics + avatar File
  // ───────────────────────────────────────────────────────────────────────
  it("C-3: cosmetics + avatar File → multipart with `data` JSON AND `avatar` file part", async () => {
    const { createRole, mockPost } = await loadCreateRoleWithMock(async () => ({
      data: {
        name: "box-maintainer",
        description: "keeps the boxes",
        cosmetics: { title: "Box maintainer", colorHue: 190 },
      },
    }));

    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
    const avatar = new File([webpBytes], "box-maintainer.webp", {
      type: "image/webp",
    });

    await createRole(
      {
        name: "box-maintainer",
        description: "keeps the boxes",
        hostId: 1,
        cosmetics: { title: "Box maintainer", colorHue: 190 },
      },
      avatar,
    );

    const [, body] = mockPost.mock.calls[0] as [string, FormData];
    const parsed = JSON.parse(body.get("data") as string) as Record<
      string,
      unknown
    >;
    expect(parsed.cosmetics).toEqual({ title: "Box maintainer", colorHue: 190 });
    const avatarField = body.get("avatar");
    expect(avatarField).toBeInstanceOf(File);
    expect((avatarField as File).name).toBe("box-maintainer.webp");
    expect((avatarField as File).type).toBe("image/webp");
  });

  // ───────────────────────────────────────────────────────────────────────
  // C-4: 409 → RoleAlreadyExistsError preserved
  // ───────────────────────────────────────────────────────────────────────
  it("C-4: 409 response still throws RoleAlreadyExistsError(name) (existing behavior preserved)", async () => {
    const err409 = { response: { status: 409 } };
    const { createRole, RoleAlreadyExistsError } = await loadCreateRoleWithMock(
      async () => {
        throw err409;
      },
    );

    await expect(
      createRole({
        name: "box-maintainer",
        description: "keeps the boxes",
        hostId: 1,
      }),
    ).rejects.toBeInstanceOf(RoleAlreadyExistsError);
  });

  // ───────────────────────────────────────────────────────────────────────
  // C-5: backward-compat single-arg call sites still work
  // ───────────────────────────────────────────────────────────────────────
  it("C-5: backward-compat — single-argument call site sends multipart with no avatar and no cosmetics", async () => {
    const { createRole, mockPost } = await loadCreateRoleWithMock(async () => ({
      data: { name: "role-x", description: "desc", cosmetics: {} },
    }));

    // No second argument at all — existing call site pattern from
    // CreateRoleDialog.tsx L178-182 must remain valid.
    await createRole({ name: "role-x", description: "desc", hostId: 42 });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = mockPost.mock.calls[0] as [
      string,
      FormData,
      { headers?: Record<string, string> } | undefined,
    ];
    expect(url).toBe("/roles");
    expect(cfg?.headers?.["Content-Type"]).toBe("multipart/form-data");
    expect(body.get("avatar")).toBeNull();
    const parsed = JSON.parse(body.get("data") as string) as Record<
      string,
      unknown
    >;
    expect(parsed.name).toBe("role-x");
    expect(parsed.hostId).toBe(42);
  });
});
