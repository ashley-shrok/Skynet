/**
 * identity-reactivate — bring an archived agent's chat (Matrix) account back
 * to life so the identity can be un-archived.
 *
 * Asked for by the agent-supervisor on the identity's host when it picks up
 * an `.unarchive-requested` flag (front end and agents drop the same flag).
 * The chat admin credentials never leave the backend; this is the one narrow
 * thing a host may ask of them.
 *
 * The request names the account only. Archiving erases the account's
 * password on the chat server, so reactivating always sets a new one: the
 * backend generates it and it travels back only in the response to the host
 * that asked. Refused unless the account:
 *   - is currently switched off (never touches a live account's password),
 *   - is not a server admin,
 *   - has at some point been in the agents directory room,
 *   - has never been in the humans directory room.
 * On success the account is also re-joined to the agents directory so the
 * returned identity is recognized as an agent again (best-effort).
 *
 * Accepted gap (shape-unarchive-one-path-supervisor-reactivation.md): no
 * check that the account belongs to the asking host. Host-tagged account
 * names will close it.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";
import {
  createOrUpdateUser,
  getRoomMembershipOf,
  getUserAccountStatus,
} from "../../../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../../../matrix/matrix-admin-creds-store.js";
import { extractServerName } from "../../../matrix/username-to-mxid.js";
import {
  getAgentsRegistryRoomId,
  getHumansRegistryRoomId,
  joinAgentToAgentsRegistry,
} from "../../../relay-sessions/registry-rooms.js";

/** Matrix localparts are lowercase; the server part is checked separately. */
const ACCOUNT_RE = /^@([a-z0-9._=\-/]{1,200}):([A-Za-z0-9.\-:[\]]{1,255})$/;

export const identityReactivateInput = z.strictObject({
  /** Full chat account id from the archived identity's relay.json, e.g. "@ace:server". */
  account: z.string().regex(ACCOUNT_RE, "must be a full chat account id like @name:server"),
});

export interface IdentityReactivateResult {
  user_id: string;
  password: string;
}

export interface IdentityReactivateDeps {
  getServerName(): Promise<string | null>;
  getUserAccountStatus: typeof getUserAccountStatus;
  getRoomMembershipOf: typeof getRoomMembershipOf;
  getAgentsRegistryRoomId: typeof getAgentsRegistryRoomId;
  getHumansRegistryRoomId: typeof getHumansRegistryRoomId;
  createOrUpdateUser: typeof createOrUpdateUser;
  joinAgentToAgentsRegistry: typeof joinAgentToAgentsRegistry;
  generatePassword(): string;
}

const productionDeps: IdentityReactivateDeps = {
  async getServerName() {
    const creds = await getMatrixAdminCreds();
    if (!creds) return null;
    return creds.serverName ?? extractServerName(creds.homeserverBase);
  },
  getUserAccountStatus,
  getRoomMembershipOf,
  getAgentsRegistryRoomId,
  getHumansRegistryRoomId,
  createOrUpdateUser,
  joinAgentToAgentsRegistry,
  generatePassword: () => randomBytes(32).toString("base64url"),
};

/** Chat-server trouble: the supervisor keeps its flag and asks again later. */
const UNAVAILABLE = "matrix_unavailable";

export function createIdentityReactivateService(
  deps: IdentityReactivateDeps = productionDeps,
) {
  return defineService({
    name: "identity-reactivate",
    description: "Reactivate an archived agent's chat account for un-archive",
    input: identityReactivateInput,
    ttlMs: 5 * 60 * 1000,
    concurrency: 2,
    serializeBy: (input) => input.account,

    async handle(input, ctx) {
      const account = input.account;
      const logCtx = { account, hostId: ctx.host.id, requestId: ctx.requestId };

      const serverName = await deps.getServerName();
      if (serverName === null) {
        return fail("not_configured", "chat admin credentials are not set up on this Skynet");
      }
      if (account.slice(account.indexOf(":") + 1) !== serverName) {
        return fail("wrong_server", `account is not on this Skynet's chat server (${serverName})`);
      }

      const status = await deps.getUserAccountStatus(account);
      if (status.ok === false) {
        ctx.log.warn("identity-reactivate: account lookup failed", { ...logCtx, status: status.status, error: status.error });
        return fail(UNAVAILABLE, "couldn't reach the chat server; try again shortly");
      }
      if (!status.exists) return fail("account_not_found", "no such chat account");
      if (status.admin) return fail("admin_account", "admin accounts are never reactivated this way");
      if (!status.deactivated) {
        return fail("account_active", "the chat account is already active, so its password can't be reset this way");
      }

      const agentsRoom = await deps.getAgentsRegistryRoomId();
      const humansRoom = await deps.getHumansRegistryRoomId();
      if (agentsRoom === null || humansRoom === null) {
        return fail("not_configured", "the agents/humans directory rooms are not set up on this Skynet");
      }
      const inHumans = await deps.getRoomMembershipOf(humansRoom, account);
      const inAgents = await deps.getRoomMembershipOf(agentsRoom, account);
      if (inHumans.ok === false || inAgents.ok === false) {
        ctx.log.warn("identity-reactivate: directory lookup failed", logCtx);
        return fail(UNAVAILABLE, "couldn't reach the chat server; try again shortly");
      }
      if (inHumans.membership !== null) {
        return fail("human_account", "this account belongs to a person, not an agent");
      }
      if (inAgents.membership === null) {
        return fail("not_an_agent", "this account was never in the agents directory, so it can't be confirmed as an agent");
      }

      const password = deps.generatePassword();
      const reactivated = await deps.createOrUpdateUser(account, password);
      if (reactivated.ok === false) {
        ctx.log.warn("identity-reactivate: reactivate failed", { ...logCtx, status: reactivated.status, error: reactivated.error });
        return fail(UNAVAILABLE, "the chat server refused to reactivate the account; try again shortly");
      }

      const joined = await deps.joinAgentToAgentsRegistry(account);
      if (joined.ok === false) {
        ctx.log.warn("identity-reactivate: agents-directory re-join failed (best-effort)", { ...logCtx, status: joined.status, error: joined.error });
      }

      ctx.log.info("identity-reactivate: account reactivated", logCtx);
      return ok<IdentityReactivateResult>({ user_id: account, password });
    },
  });
}

export default createIdentityReactivateService();
