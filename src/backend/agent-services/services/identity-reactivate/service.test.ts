import { describe, it, expect, vi } from "vitest";

// The service under test gets fakes via deps; keep the production imports
// from reaching the DB or the chat server.
vi.mock("../../../matrix/matrix-admin-client.js", () => ({
  createOrUpdateUser: vi.fn(),
  setUserDisplayName: vi.fn(),
  getRoomMembershipOf: vi.fn(),
  getUserAccountStatus: vi.fn(),
}));
vi.mock("../../../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));
vi.mock("../../../relay-sessions/registry-rooms.js", () => ({
  getAgentsRegistryRoomId: vi.fn(),
  getHumansRegistryRoomId: vi.fn(),
  joinAgentToAgentsRegistry: vi.fn(),
}));

import {
  createIdentityReactivateService,
  identityReactivateInput,
  type IdentityReactivateDeps,
} from "./service.js";
import type { ServiceContext } from "../../engine/types.js";

const SERVER = "t1000.taild9b663.ts.net";
const ACCOUNT = `@ace:${SERVER}`;
const AGENTS_ROOM = "!agents:server";
const HUMANS_ROOM = "!humans:server";
const input = { account: ACCOUNT };

function makeCtx(): ServiceContext {
  return {
    requestId: "0b5c2f9e-1a2b-4c3d-8e9f-001122334455",
    host: { id: "3", idNum: 3 },
    attachments: {},
    secrets: {},
    userSecrets: {},
    log: { info: vi.fn(), warn: vi.fn() },
    now: () => 0,
  };
}

/** Defaults describe the happy path: switched-off agent account, never a human. */
function deps(overrides: Partial<IdentityReactivateDeps> = {}): IdentityReactivateDeps {
  return {
    getServerName: vi.fn(async () => SERVER),
    getUserAccountStatus: vi.fn(async () => ({
      ok: true as const,
      exists: true,
      deactivated: true,
      admin: false,
    })),
    getRoomMembershipOf: vi.fn(async (roomId: string) => ({
      ok: true as const,
      membership: roomId === AGENTS_ROOM ? "leave" : null,
    })),
    getAgentsRegistryRoomId: vi.fn(async () => AGENTS_ROOM),
    getHumansRegistryRoomId: vi.fn(async () => HUMANS_ROOM),
    createOrUpdateUser: vi.fn(async (mxid: string, password: string) => ({
      ok: true as const,
      mxid,
      password,
      status: 200,
    })),
    setUserDisplayName: vi.fn(async () => ({ ok: true as const })),
    joinAgentToAgentsRegistry: vi.fn(async () => ({ ok: true as const, roomId: AGENTS_ROOM })),
    generatePassword: vi.fn(() => "generated-pw"),
    ...overrides,
  } as IdentityReactivateDeps;
}

const run = (d: IdentityReactivateDeps, ctx = makeCtx()) =>
  createIdentityReactivateService(d).handle(input, ctx);

const failCode = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? null : r.code);

describe("identity-reactivate input", () => {
  it("accepts a full chat account id", () => {
    expect(identityReactivateInput.safeParse(input).success).toBe(true);
  });
  it("accepts a display name", () => {
    expect(identityReactivateInput.safeParse({ account: ACCOUNT, display_name: "Ace Two" }).success).toBe(true);
  });
  it.each([
    ["a password field", { account: ACCOUNT, password: "chosen-by-host" }],
    ["a bare localpart", { account: "ace" }],
    ["no leading @", { account: `ace:${SERVER}` }],
    ["no server part", { account: "@ace" }],
    ["an uppercase localpart", { account: `@Ace:${SERVER}` }],
    ["missing account", {}],
    ["an empty display name", { account: ACCOUNT, display_name: "" }],
    ["a display name with a newline", { account: ACCOUNT, display_name: "Ace\nTwo" }],
    ["a display name over 100 characters", { account: ACCOUNT, display_name: "a".repeat(101) }],
  ])("rejects %s", (_n, value) => {
    expect(identityReactivateInput.safeParse(value).success).toBe(false);
  });
});

describe("identity-reactivate service", () => {
  it("declares its name, TTL and one-request-per-account serialization", () => {
    const svc = createIdentityReactivateService(deps());
    expect(svc.name).toBe("identity-reactivate");
    expect(svc.ttlMs).toBe(5 * 60 * 1000);
    expect(svc.serializeBy?.(input)).toBe(ACCOUNT);
  });

  it("success: reactivates with the generated password, re-joins the agents directory, returns {user_id,password}", async () => {
    const d = deps();
    const r = await run(d);
    expect(r).toEqual({ ok: true, result: { user_id: ACCOUNT, password: "generated-pw" } });
    expect(d.generatePassword).toHaveBeenCalledTimes(1);
    expect(d.createOrUpdateUser).toHaveBeenCalledWith(ACCOUNT, "generated-pw");
    expect(d.setUserDisplayName).not.toHaveBeenCalled();
    expect(d.joinAgentToAgentsRegistry).toHaveBeenCalledWith(ACCOUNT);
    // Reactivate happens before the re-join.
    const reactivateOrder = vi.mocked(d.createOrUpdateUser).mock.invocationCallOrder[0];
    const joinOrder = vi.mocked(d.joinAgentToAgentsRegistry).mock.invocationCallOrder[0];
    expect(reactivateOrder).toBeLessThan(joinOrder);
    expect(d.getRoomMembershipOf).toHaveBeenCalledWith(HUMANS_ROOM, ACCOUNT);
    expect(d.getRoomMembershipOf).toHaveBeenCalledWith(AGENTS_ROOM, ACCOUNT);
  });

  it("success: gives the reactivated account its display name back", async () => {
    const d = deps();
    const r = await createIdentityReactivateService(d).handle({ account: ACCOUNT, display_name: "Ace" }, makeCtx());
    expect(r.ok).toBe(true);
    expect(d.createOrUpdateUser).toHaveBeenCalledWith(ACCOUNT, "generated-pw");
    expect(d.setUserDisplayName).toHaveBeenCalledWith(ACCOUNT, "Ace");
  });

  it("success even when setting the display name fails: the password still goes back (best-effort, logged)", async () => {
    const d = deps({
      setUserDisplayName: vi.fn(async () => ({ ok: false as const, status: 500, error: "ERR_NON_2XX" })),
    });
    const ctx = makeCtx();
    const r = await createIdentityReactivateService(d).handle({ account: ACCOUNT, display_name: "Ace" }, ctx);
    expect(r).toEqual({ ok: true, result: { user_id: ACCOUNT, password: "generated-pw" } });
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "identity-reactivate: display name not set (best-effort)",
      expect.objectContaining({ account: ACCOUNT, status: 500 }),
    );
    expect(d.joinAgentToAgentsRegistry).toHaveBeenCalledWith(ACCOUNT);
  });

  it("success even when the agents-directory re-join fails (best-effort, logged)", async () => {
    const ctx = makeCtx();
    const d = deps({
      joinAgentToAgentsRegistry: vi.fn(async () => ({
        ok: false as const,
        status: 502,
        error: "admin_api_proxy_error",
      })) as unknown as IdentityReactivateDeps["joinAgentToAgentsRegistry"],
    });
    const r = await run(d, ctx);
    expect(r).toEqual({ ok: true, result: { user_id: ACCOUNT, password: "generated-pw" } });
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/re-join failed/),
      expect.objectContaining({ account: ACCOUNT }),
    );
  });

  it("not_configured when chat admin creds are missing (no server name); nothing else touched", async () => {
    const d = deps({ getServerName: vi.fn(async () => null) });
    expect(failCode(await run(d))).toBe("not_configured");
    expect(d.getUserAccountStatus).not.toHaveBeenCalled();
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["agents", { getAgentsRegistryRoomId: vi.fn(async () => null) }],
    ["humans", { getHumansRegistryRoomId: vi.fn(async () => null) }],
  ])("not_configured when the %s directory room is missing", async (_n, o) => {
    const d = deps(o as Partial<IdentityReactivateDeps>);
    expect(failCode(await run(d))).toBe("not_configured");
    expect(d.getRoomMembershipOf).not.toHaveBeenCalled();
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it("wrong_server when the account is on another chat server", async () => {
    const d = deps();
    const r = await createIdentityReactivateService(d).handle(
      { account: "@ace:elsewhere.example" },
      makeCtx(),
    );
    expect(failCode(r)).toBe("wrong_server");
    expect(d.getUserAccountStatus).not.toHaveBeenCalled();
  });

  it("matrix_unavailable when the account lookup fails", async () => {
    const d = deps({
      getUserAccountStatus: vi.fn(async () => ({
        ok: false as const,
        status: 504,
        error: "admin_api_timeout",
      })) as unknown as IdentityReactivateDeps["getUserAccountStatus"],
    });
    expect(failCode(await run(d))).toBe("matrix_unavailable");
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it("account_not_found when the account doesn't exist", async () => {
    const d = deps({
      getUserAccountStatus: vi.fn(async () => ({
        ok: true as const,
        exists: false,
        deactivated: false,
        admin: false,
      })),
    });
    expect(failCode(await run(d))).toBe("account_not_found");
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it("admin_account for a server admin, even if switched off", async () => {
    const d = deps({
      getUserAccountStatus: vi.fn(async () => ({
        ok: true as const,
        exists: true,
        deactivated: true,
        admin: true,
      })),
    });
    expect(failCode(await run(d))).toBe("admin_account");
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it("account_active for a live account (never resets a live password)", async () => {
    const d = deps({
      getUserAccountStatus: vi.fn(async () => ({
        ok: true as const,
        exists: true,
        deactivated: false,
        admin: false,
      })),
    });
    expect(failCode(await run(d))).toBe("account_active");
    expect(d.getRoomMembershipOf).not.toHaveBeenCalled();
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it.each(["join", "leave", "invite", "ban"])(
    "human_account when the account has membership '%s' in the humans room",
    async (membership) => {
      const d = deps({
        getRoomMembershipOf: vi.fn(async () => ({ ok: true as const, membership })),
      });
      expect(failCode(await run(d))).toBe("human_account");
      expect(d.createOrUpdateUser).not.toHaveBeenCalled();
    },
  );

  it("not_an_agent when the account was never in the agents room", async () => {
    const d = deps({
      getRoomMembershipOf: vi.fn(async () => ({ ok: true as const, membership: null })),
    });
    expect(failCode(await run(d))).toBe("not_an_agent");
    expect(d.createOrUpdateUser).not.toHaveBeenCalled();
  });

  it.each(["invite", "ban", "knock"])(
    "not_an_agent when the agents-room membership is only %s",
    async (membership) => {
      const d = deps({
        getRoomMembershipOf: vi.fn(async (roomId: string) => ({
          ok: true as const,
          membership: roomId === AGENTS_ROOM ? membership : null,
        })) as unknown as IdentityReactivateDeps["getRoomMembershipOf"],
      });
      expect(failCode(await run(d))).toBe("not_an_agent");
      expect(d.createOrUpdateUser).not.toHaveBeenCalled();
    },
  );

  it.each([HUMANS_ROOM, AGENTS_ROOM])(
    "matrix_unavailable when the membership lookup for %s fails",
    async (failingRoom) => {
      const d = deps({
        getRoomMembershipOf: vi.fn(async (roomId: string) =>
          roomId === failingRoom
            ? { ok: false as const, status: 502, error: "admin_api_proxy_error" }
            : { ok: true as const, membership: roomId === AGENTS_ROOM ? "leave" : null },
        ) as unknown as IdentityReactivateDeps["getRoomMembershipOf"],
      });
      expect(failCode(await run(d))).toBe("matrix_unavailable");
      expect(d.createOrUpdateUser).not.toHaveBeenCalled();
    },
  );

  it("matrix_unavailable when the reactivate call fails; no re-join, no password returned", async () => {
    const d = deps({
      createOrUpdateUser: vi.fn(async () => ({
        ok: false as const,
        status: 500,
        error: "admin_api_non_2xx",
      })) as unknown as IdentityReactivateDeps["createOrUpdateUser"],
    });
    const r = await run(d);
    expect(failCode(r)).toBe("matrix_unavailable");
    expect(JSON.stringify(r)).not.toContain("generated-pw");
    expect(d.joinAgentToAgentsRegistry).not.toHaveBeenCalled();
  });
});
