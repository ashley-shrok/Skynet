/**
 * Tests for role requests: the `kind: "role"` parser, the scan-batch
 * dispatch, and processRoleRequest (avatar-first ordering, response files,
 * owner auto-tag on multi-user hosts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingBirth, RoleRequestBody } from "./types.js";

vi.mock("../claude-session/identity-artifact-reader.js", async (importActual) => {
  const actual = await importActual<typeof import("../claude-session/identity-artifact-reader.js")>();
  return {
    ...actual,
    // worker.ts's writeResponseFile branches on this; LOCAL keeps the
    // response write on deps.writeMarkdownFileAtomic(null, ...).
    isLocalHostId: vi.fn().mockReturnValue(true),
  };
});

vi.mock("../utils/logger.js", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() };
  return { systemLogger: mockLogger, sshLogger: mockLogger, databaseLogger: mockLogger, logger: mockLogger };
});

vi.mock("../database/db/index.js", () => ({ getDb: vi.fn() }));

import { parseRoleRequestBody, isRoleRequestBody } from "./parse-request-body.js";
import { parseSpawnRequestBatch } from "../fleet-status/ssh-poll-orchestrator.js";
import { processRoleRequest, DEFAULT_ROLE_VOICE, type RoleWorkerDeps } from "./role-worker.js";

const UUID = "11111111-2222-3333-4444-555555555555";

function roleBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "role",
    name: "Garden Keeper",
    description: "Tends the garden.",
    requested_at: "2026-10-11T00:00:00Z",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseRoleRequestBody", () => {
  it("accepts a well-formed role request", () => {
    const r = parseRoleRequestBody(roleBody({ requested_by: "anchor" }));
    expect(r).toEqual({
      ok: true,
      body: {
        kind: "role",
        name: "Garden Keeper",
        description: "Tends the garden.",
        requested_at: "2026-10-11T00:00:00Z",
        requested_by: "anchor",
      },
    });
  });

  it("rejects unknown fields, naming them", () => {
    const r = parseRoleRequestBody(roleBody({ roles: ["x"], prompt: "hi" }));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/unknown field\(s\).*roles, prompt/);
  });

  it("rejects a missing name with the drop's field name", () => {
    const r = parseRoleRequestBody(roleBody({ name: undefined }));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toBe("name is required");
  });

  it("rejects a name with no letters", () => {
    const r = parseRoleRequestBody(roleBody({ name: "!!!" }));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty or oversized description", () => {
    expect(parseRoleRequestBody(roleBody({ description: "" })).ok).toBe(false);
    expect(parseRoleRequestBody(roleBody({ description: "x".repeat(4097) })).ok).toBe(false);
  });

  it("rejects a missing requested_at", () => {
    expect(parseRoleRequestBody(roleBody({ requested_at: undefined })).ok).toBe(false);
  });

  it("isRoleRequestBody only matches kind: role objects", () => {
    expect(isRoleRequestBody(roleBody())).toBe(true);
    expect(isRoleRequestBody(JSON.stringify({ roles: ["a"] }))).toBe(false);
    expect(isRoleRequestBody(JSON.stringify({ kind: "identity" }))).toBe(false);
    expect(isRoleRequestBody("not json")).toBe(false);
    expect(isRoleRequestBody("[]")).toBe(false);
  });
});

describe("parseSpawnRequestBatch — role dispatch", () => {
  it("emits a roleRequest item for kind: role", () => {
    const items = parseSpawnRequestBatch(`${UUID}.json\t${roleBody()}`, "6");
    expect(items).toHaveLength(1);
    expect(items[0].roleRequest?.name).toBe("Garden Keeper");
    expect(items[0].malformedReason).toBeUndefined();
    expect(items[0].hostIdNum).toBe(6);
  });

  it("emits a malformed item (no roleRequest) for a bad role request", () => {
    const items = parseSpawnRequestBatch(`${UUID}.json\t${roleBody({ extra: 1 })}`, "6");
    expect(items).toHaveLength(1);
    expect(items[0].roleRequest).toBeUndefined();
    expect(items[0].malformedReason).toMatch(/unknown field/);
  });

  it("leaves identity requests on the identity path", () => {
    const body = JSON.stringify({ roles: ["general-purpose"], prompt: "hi", task: "t", requested_at: "x" });
    const items = parseSpawnRequestBatch(`${UUID}.json\t${body}`, "6");
    expect(items[0].roleRequest).toBeUndefined();
    expect(items[0].roles).toEqual(["general-purpose"]);
  });
});

// ---------------------------------------------------------------------------
// processRoleRequest
// ---------------------------------------------------------------------------

function makeItem(request?: Partial<RoleRequestBody>): PendingBirth {
  return {
    hostId: "6",
    hostIdNum: 6,
    uuid: UUID,
    roles: [],
    prompt: "",
    task: null,
    requested_at: "2026-10-11T00:00:00Z",
    roleRequest: {
      kind: "role",
      name: "Garden Keeper",
      description: "Tends the garden.",
      requested_at: "2026-10-11T00:00:00Z",
      ...request,
    },
  };
}

function makeDeps(overrides: Partial<RoleWorkerDeps> = {}): RoleWorkerDeps & {
  writes: Array<{ path: string; body: string }>;
} {
  const writes: Array<{ path: string; body: string }> = [];
  const deps: RoleWorkerDeps = {
    connectOneShot: vi.fn() as unknown as RoleWorkerDeps["connectOneShot"],
    writeMarkdownFileAtomic: vi.fn(async (_conn, path: string, body: string) => {
      writes.push({ path, body });
    }) as unknown as RoleWorkerDeps["writeMarkdownFileAtomic"],
    generateAvatarImages: vi.fn(async () => ({
      ok: true as const,
      images: [{ bytes: Buffer.from("img"), mime: "image/webp" }],
    })),
    createRoleOnHost: vi.fn(async () => ({
      ok: true as const,
      name: "garden-keeper",
      cosmetics: {},
    })),
    getHostOwnerUserId: vi.fn(async () => "owner-id"),
    isHostMultiUser: vi.fn(async () => false),
    getUsernameForUserId: vi.fn(async () => "Ashley"),
    isLocalHostId: vi.fn(() => true),
    randomHue: () => 123,
    now: () => new Date("2026-10-11T01:02:03Z"),
    ...overrides,
  };
  return Object.assign(deps, { writes });
}

describe("processRoleRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates one avatar, creates the role locally, and drops a success file", async () => {
    const deps = makeDeps();
    await processRoleRequest(makeItem(), deps);

    expect(deps.generateAvatarImages).toHaveBeenCalledWith(
      { name: "Garden Keeper", title: "Garden Keeper", brief: "Tends the garden.", colorHue: 123 },
      1,
    );
    expect(deps.createRoleOnHost).toHaveBeenCalledWith(
      null,
      {
        baseSlug: "garden-keeper",
        displayName: "Garden Keeper",
        description: "Tends the garden.",
        colorHue: 123,
        voice: DEFAULT_ROLE_VOICE,
        users: undefined,
        avatar: { ext: "webp", bytes: Buffer.from("img") },
      },
      { hostId: 6, source: "role-request" },
    );
    expect(deps.writes).toHaveLength(1);
    expect(deps.writes[0].path).toBe(`$HOME/fleet/spawn-requests/${UUID}.success.json`);
    expect(JSON.parse(deps.writes[0].body)).toEqual({
      name: "garden-keeper",
      created_at: "2026-10-11T01:02:03.000Z",
    });
  });

  it("writes avatar_failed and creates nothing when generation fails", async () => {
    const deps = makeDeps({
      generateAvatarImages: vi.fn(async () => ({
        ok: false as const,
        status: 503 as const,
        error: "OpenAI not configured",
      })),
    });
    await processRoleRequest(makeItem(), deps);

    expect(deps.createRoleOnHost).not.toHaveBeenCalled();
    expect(deps.writes[0].path).toBe(`$HOME/fleet/spawn-requests/${UUID}.failure.json`);
    expect(JSON.parse(deps.writes[0].body)).toEqual({
      reason: "avatar_failed",
      message: "OpenAI not configured",
    });
  });

  it("writes avatar_failed when generation throws", async () => {
    const deps = makeDeps({
      generateAvatarImages: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await processRoleRequest(makeItem(), deps);
    expect(deps.createRoleOnHost).not.toHaveBeenCalled();
    expect(JSON.parse(deps.writes[0].body).reason).toBe("avatar_failed");
  });

  it("writes role_create_failed when provisioning fails", async () => {
    const deps = makeDeps({
      createRoleOnHost: vi.fn(async () => ({ ok: false as const, error: "write_failed" as const })),
    });
    await processRoleRequest(makeItem(), deps);
    expect(JSON.parse(deps.writes[0].body)).toEqual({ reason: "role_create_failed" });
  });

  it("writes role_create_failed when the host has no owner", async () => {
    const deps = makeDeps({ getHostOwnerUserId: vi.fn(async () => null) });
    await processRoleRequest(makeItem(), deps);
    expect(deps.generateAvatarImages).not.toHaveBeenCalled();
    expect(JSON.parse(deps.writes[0].body).reason).toBe("role_create_failed");
  });

  it("tags the host owner on multi-user hosts", async () => {
    const deps = makeDeps({ isHostMultiUser: vi.fn(async () => true) });
    await processRoleRequest(makeItem(), deps);
    expect(deps.getUsernameForUserId).toHaveBeenCalledWith("owner-id");
    expect(vi.mocked(deps.createRoleOnHost).mock.calls[0][1].users).toEqual(["Ashley"]);
  });

  it("returns the auto-suffixed slug when the base name was taken", async () => {
    const deps = makeDeps({
      createRoleOnHost: vi.fn(async () => ({ ok: true as const, name: "garden-keeper-2", cosmetics: {} })),
    });
    await processRoleRequest(makeItem(), deps);
    expect(JSON.parse(deps.writes[0].body).name).toBe("garden-keeper-2");
  });
});
