/**
 * `resolveAgentLabel` — what a notification calls the agent that sent it.
 *
 * The label is the identity's `displayName` plus the `displayName` of every
 * role it holds — e.g. `{ name: "Mitzi", roles: "General Assistant" }` —
 * read from the box the identity actually lives on (`agentHostId`, already
 * resolved by the push-trigger loop). Sources, cheapest first:
 *
 *   1. The user's fleet-status orchestrator cache — sweep-fresh cosmetics,
 *      no I/O. Only populated while the user has Skynet open.
 *   2. This box's disk, when the host is local.
 *   3. A one-shot SSH read of the identity + role files on the peer box.
 *
 * Results from 2 and 3 are cached per (userId, hostId, identity) so a chatty
 * agent costs one read per LABEL_TTL_MS, not one per message.
 *
 * Fallbacks: no identity `displayName` → capitalized identity key (same as
 * the sidebar); a role without a `displayName` → its de-slugged name; any
 * failure → the capitalized mxid local-part with no roles. Never throws.
 */

import {
  readIdentityFile,
  readRoleFileByName,
  extractCosmeticsFromFrontmatter,
  extractRolesFromMarkdown,
  isLocalHostId,
  IDENTITY_KEY_RE,
} from "../claude-session/identity-artifact-reader.js";
import {
  capitalizeFirstIdentityKey,
  type RawCosmetics,
} from "../fleet-status/identity-appearance.js";
import { getOrchestrator } from "../fleet-status/orchestrator-holder.js";
import { systemLogger } from "../utils/logger.js";
import { withRemoteHost, type OneShotConn } from "./remote-host-exec.js";

export interface AgentLabel {
  /** Identity display name, e.g. "Mitzi". */
  name: string;
  /** Role display names joined with ", ", or null when none resolved. */
  roles: string | null;
}

/** Keeps a multi-role label from swamping the notification. */
const NAME_MAX_LEN = 40;
const ROLES_MAX_LEN = 60;

export const LABEL_TTL_MS = 10 * 60_000;
const REMOTE_READ_TIMEOUT_MS = 5000;

const MXID_PATTERN = /^@([^:]+):(.+)$/;

/** The identity's cosmetics and, per role, its slug + cosmetics. */
export interface AgentCosmetics {
  identity: RawCosmetics | null;
  roles: Array<{ slug: string; cosmetics: RawCosmetics | null }>;
}

export interface AgentLabelDeps {
  /** Sweep cache lookup; null on miss. */
  readCached(userId: string, hostId: number, identityKey: string): AgentCosmetics | null;
  /** Read the identity + role files from the host. Null when unreachable. May throw. */
  readFiles(userId: string, hostId: number, identityKey: string): Promise<AgentCosmetics | null>;
  now(): number;
}

function deslug(slug: string): string {
  return capitalizeFirstIdentityKey(slug.replace(/[-_]+/g, " "));
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function buildAgentLabel(identityKey: string, c: AgentCosmetics): AgentLabel {
  const name = nonEmpty(c.identity?.displayName) ?? capitalizeFirstIdentityKey(identityKey);
  const roleNames = c.roles.map((r) => nonEmpty(r.cosmetics?.displayName) ?? deslug(r.slug));
  return {
    name: cap(name, NAME_MAX_LEN),
    roles: roleNames.length > 0 ? cap(roleNames.join(", "), ROLES_MAX_LEN) : null,
  };
}

export function createAgentLabelResolver(
  deps: AgentLabelDeps,
): (mxid: string, userId: string, hostId: number) => Promise<AgentLabel> {
  const cache = new Map<string, { label: AgentLabel; expiresAt: number }>();

  return async function resolveAgentLabel(mxid, userId, hostId) {
    const localPart = mxid.replace(/^@/, "").split(":")[0];
    const fallback: AgentLabel = {
      name: cap(capitalizeFirstIdentityKey(localPart), NAME_MAX_LEN),
      roles: null,
    };
    if (!MXID_PATTERN.test(mxid)) return fallback;
    const identityKey = localPart.toLowerCase();
    if (!IDENTITY_KEY_RE.test(identityKey)) return fallback;

    try {
      const cached = deps.readCached(userId, hostId, identityKey);
      if (cached !== null) return buildAgentLabel(identityKey, cached);

      const key = `${userId}::${hostId}::${identityKey}`;
      const hit = cache.get(key);
      if (hit !== undefined && hit.expiresAt > deps.now()) return hit.label;

      const read = await deps.readFiles(userId, hostId, identityKey);
      if (read === null) return fallback;
      const label = buildAgentLabel(identityKey, read);
      cache.set(key, { label, expiresAt: deps.now() + LABEL_TTL_MS });
      return label;
    } catch (err) {
      systemLogger.warn("resolveAgentLabel failed — using mxid local-part", {
        operation: "resolve_agent_label_failed",
        mxid,
        hostId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return fallback;
    }
  };
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

function readCachedFromOrchestrator(
  userId: string,
  hostId: number,
  identityKey: string,
): AgentCosmetics | null {
  const entry = getOrchestrator(userId)?.getCachedIdentityCosmetics(String(hostId), identityKey);
  if (!entry) return null;
  const slugs = entry.roles ?? (entry.role !== null ? [entry.role] : []);
  return {
    identity: entry.identityCosmetics,
    roles: slugs.map((slug, i) => ({
      slug,
      cosmetics:
        slugs.length === 1 && entry.rolesCosmetics === undefined
          ? entry.roleCosmetics
          : (entry.rolesCosmetics?.[i] ?? null),
    })),
  };
}

async function readCosmetics(conn: OneShotConn | null, identityKey: string): Promise<AgentCosmetics> {
  const { markdown } = await readIdentityFile(conn, identityKey);
  const slugs = extractRolesFromMarkdown(markdown);
  const roles = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const { markdown: roleMd } = await readRoleFileByName(conn, slug);
        return { slug, cosmetics: roleMd ? extractCosmeticsFromFrontmatter(roleMd) : null };
      } catch {
        return { slug, cosmetics: null };
      }
    }),
  );
  return { identity: markdown ? extractCosmeticsFromFrontmatter(markdown) : null, roles };
}

async function readFilesFromHost(
  userId: string,
  hostId: number,
  identityKey: string,
): Promise<AgentCosmetics | null> {
  if (isLocalHostId(hostId)) return readCosmetics(null, identityKey);
  return withRemoteHost(hostId, userId, REMOTE_READ_TIMEOUT_MS, (conn) =>
    readCosmetics(conn, identityKey),
  );
}

/** Resolve the notification label for `mxid`, living on `hostId` as seen by `userId`. */
export const resolveAgentLabel = createAgentLabelResolver({
  readCached: readCachedFromOrchestrator,
  readFiles: readFilesFromHost,
  now: () => Date.now(),
});
