/**
 * Phase 79 Plan 04 Task 1 — registry-writer.
 *
 * Serializes the current DB state into the tg-bridge's `/state/registry.json`
 * file in Nina's live shape — minus the `bot_token` and `.cred` fields per
 * Phase B blocker B-1: bot tokens live in per-agent `.bottoken` files
 * (written by bot-token-file-writer.ts), Matrix credentials never touch
 * disk (bridge reads `.token` files minted by Skynet on demand).
 *
 * Two exports:
 *   - buildRegistryFromRows: pure function, DB rows + lookup maps -> RegistryFile.
 *     Callers (bridge-config-writer.ts) supply the humans + agents maps.
 *   - writeRegistry: atomic .tmp + rename write to shared volume path,
 *     0644 (bridge needs read access; not sensitive — no secrets in this
 *     file after B-1's shape change).
 *
 * Mirrors the atomic-write pattern from human-token-writer.ts (see
 * PATTERNS.md § No Analog Found — this is the canonical Phase 79
 * bind-mount writer shape).
 */
import fs from "node:fs";
import { registryPath } from "./shared-volume.js";

export interface RegistryHumanEntry {
  name: string;
  mxid: string;
  chat_id: string | null;
  room: string | null; // Phase 83: populated via getSharedDMRoom lookup map (fallback null when absent/unknown).
  token: string; // filename only (e.g. "alice.token"), NOT contents.
}

export interface RegistryAgentEntry {
  name: string;
  mxid: string;
  humans: RegistryHumanEntry[];
}

export interface RegistryFile {
  agents: RegistryAgentEntry[];
}

/**
 * Build a Nina-shaped registry object from current DB rows.
 *
 * Callers supply:
 *   - rows: the flat list of telegram_bot_tokens rows.
 *   - humansByUserId: userId -> {name, mxid} lookup (built from `users` table
 *     where mxid is non-null).
 *   - agentsByIdentityKey: identityKey -> {name, mxid} lookup (derived from
 *     the row's identityKey + the resolved matrix homeserver hostname).
 *   - roomByAgentHumanMxidPair (optional, Phase 83 Plan 04): Map keyed by
 *     `${agentMxid}\t${humanMxid}` → room_id (string) or null. When
 *     provided, humans[].room is looked up here; when absent or key
 *     missing, humans[].room defaults to null. Tab is the separator
 *     because it never appears inside a Matrix mxid.
 *
 * Emits one agent entry per distinct identityKey. Each agent's humans[]
 * contains one entry per row whose humanUserId resolves in humansByUserId;
 * unresolved rows are silently skipped (the agent still emits with an
 * empty humans[]; the bridge treats zero-humans agents as inactive).
 */
export function buildRegistryFromRows(
  rows: Array<{
    identityKey: string;
    botUsername: string;
    humanUserId: string;
    telegramChatId: string | null;
  }>,
  humansByUserId: Map<string, { name: string; mxid: string }>,
  agentsByIdentityKey: Map<string, { name: string; mxid: string }>,
  roomByAgentHumanMxidPair?: Map<string, string | null>,
): RegistryFile {
  // Group rows by identityKey so multiple humans per identity — deferred in
  // v1 UI but supported by the bridge — collapse into a single agent entry.
  const rowsByKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = rowsByKey.get(row.identityKey) ?? [];
    arr.push(row);
    rowsByKey.set(row.identityKey, arr);
  }

  const agents: RegistryAgentEntry[] = [];
  for (const [identityKey, groupedRows] of rowsByKey) {
    const agentMeta = agentsByIdentityKey.get(identityKey);
    if (!agentMeta) {
      // Defensively skip identityKeys we can't resolve to an mxid — this
      // shouldn't happen in practice because the caller derives the map
      // from the same row set, but skipping is safer than emitting an
      // agent with a malformed mxid.
      continue;
    }

    const humans: RegistryHumanEntry[] = [];
    for (const row of groupedRows) {
      const human = humansByUserId.get(row.humanUserId);
      if (!human) continue; // unresolved user -> skip this row.
      humans.push({
        name: human.name,
        mxid: human.mxid,
        chat_id: row.telegramChatId ?? null,
        room:
          roomByAgentHumanMxidPair?.get(`${agentMeta.mxid}\t${human.mxid}`) ??
          null,
        token: `${human.name}.token`,
      });
    }

    agents.push({
      name: agentMeta.name,
      mxid: agentMeta.mxid,
      humans,
    });
  }

  return { agents };
}

/**
 * Atomically write the registry to the shared-volume path. 0644 because
 * the bridge (running as a sibling container UID) needs to read it; no
 * secrets in this file post-B-1 so world-readable inside the container
 * is acceptable.
 *
 * On any error during writeFile/rename, best-effort unlink the .tmp so
 * we don't leave a stranded partial-write hanging around, then re-throw.
 */
export async function writeRegistry(registry: RegistryFile): Promise<void> {
  const target = registryPath();
  const tmp = `${target}.tmp`;
  const body = JSON.stringify(registry, null, 2);

  try {
    await fs.promises.writeFile(tmp, body, { mode: 0o644 });
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {
      /* swallow — cleanup is best-effort */
    });
    throw err;
  }
}
