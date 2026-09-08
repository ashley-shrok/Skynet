/**
 * enumerate-agent-mxids.ts — Phase 89 fixup M-5 (2026-09-08).
 *
 * The optional `enumerateAgentMxids` dep for `runRegistryRoomsBackfill`. Not
 * wired at boot (backfill is manual per D-12 as refined post-verifier), but
 * an instance-deployer can wire it into the manual backfill invocation when
 * pre-existing agent accounts need to be joined to the agents-registry
 * room. Without this enumerator, manual backfill only covers humans (from
 * the users table) — pre-existing agents' two-party DMs materialize as
 * duplicate sidebar entries until a follow-up mint or a subsequent manual
 * backfill (with the enumerator wired) catches them up.
 *
 * ## Design
 *
 * SSH-based enumeration: for each identity-hosting host, run a shell
 * one-liner that walks `~/.claude/identities/<name>/relay.json` files and
 * emits each account's mxid on its own line. Aggregate across hosts,
 * dedupe, filter empty strings, return.
 *
 * The remote command:
 *
 *   for f in ~/.claude/identities/*\/relay.json; do
 *     jq -r .user_id "$f" 2>/dev/null
 *   done
 *
 * `jq -r` prints the raw string value (unquoted). `2>/dev/null` swallows
 * parse errors so a single malformed relay.json doesn't fail the whole
 * host enumeration. If jq is missing (rare on identity-hosting hosts),
 * the command returns empty and the host contributes zero mxids — same
 * outcome as a host with no identities.
 *
 * ## Failure semantics — best-effort, per-host, log-and-continue
 *
 * Any SSH failure on any single host is logged and skipped. A failing
 * host does NOT abort the enumeration for other hosts. If the whole
 * `listIdentityHostingHosts()` call fails, returns `{ ok:false, reason }`
 * so the caller (manual backfill invocation) can distinguish the
 * "couldn't get the host list at all" case from "got the list, some
 * hosts contributed zero mxids."
 *
 * ## Testability
 *
 * All I/O is behind the `EnumerateAgentMxidsDeps` interface — tests
 * inject vi.fn() stubs for `listHosts` and `runSshCommand`. No
 * ssh2/database coupling in this module.
 *
 * ## Usage from manual-backfill docker-exec
 *
 * The runbook (89-02-SUMMARY.md § Manual backfill runbook) shows two
 * invocation shapes:
 *   - Humans-only (default): `runRegistryRoomsBackfill({})`
 *   - Full (agents backfill wired): pass a deps object with
 *     `enumerateAgentMxids: () => enumerateAgentMxidsViaSSH(realDeps)`.
 *
 * The concrete `realDeps` implementation is left to the deployer's
 * choice of SSH pool (typically ssh2 Client via the same code path
 * ssh-poll-orchestrator uses). Wiring the real deps is documented in
 * the runbook.
 */

import { databaseLogger } from "../utils/logger.js";

/**
 * Minimal shape of an identity-hosting host record for enumeration
 * purposes. Matches the subset of HostRecord fields we actually use —
 * `id` for keying + logging, `name` for logging.
 */
export interface EnumerationHostRecord {
  id: string;
  name: string;
}

/**
 * SSH exec closure passed by the caller. Returns the raw stdout string
 * on success or null on any SSH-side failure (never throws — matches
 * SshChannel.exec from ssh-poll-orchestrator).
 */
export type RunSshCommand = (
  host: EnumerationHostRecord,
  command: string,
) => Promise<string | null>;

/** Deps for enumerateAgentMxidsViaSSH — fully injectable for unit tests. */
export interface EnumerateAgentMxidsDeps {
  /**
   * Return the list of identity-hosting hosts to enumerate over. Typically
   * wired via the same `listIdentityHostingHosts` path ssh-poll-orchestrator
   * uses (see starter.ts:473). For manual docker-exec invocation, a
   * simpler direct hosts-table query is acceptable — the deployer chooses
   * which coupling to accept.
   */
  listHosts: () => Promise<EnumerationHostRecord[]>;
  /** SSH exec closure. See RunSshCommand. */
  runSshCommand: RunSshCommand;
}

/** Result of enumerateAgentMxidsViaSSH — discriminated union. */
export type EnumerateAgentMxidsResult =
  | { ok: true; mxids: string[] }
  | { ok: false; reason: string };

/**
 * The exact shell one-liner run on each identity-hosting host. Exported
 * so tests can assert on the string (regression guard for the jq -r + err
 * suppression combo).
 */
export const REMOTE_ENUMERATE_COMMAND =
  "for f in ~/.claude/identities/*/relay.json; do jq -r .user_id \"$f\" 2>/dev/null; done";

/**
 * Enumerate agent mxids across the fleet via SSH. Best-effort per-host:
 * a failing host contributes zero mxids, does NOT abort the whole
 * enumeration.
 *
 * Returns deduplicated, non-empty, trimmed mxids on the happy path.
 * Returns `{ ok:false }` only if the listHosts call itself fails —
 * per-host failures downgrade to an empty contribution.
 */
export async function enumerateAgentMxidsViaSSH(
  deps: EnumerateAgentMxidsDeps,
): Promise<EnumerateAgentMxidsResult> {
  databaseLogger.info(
    "[phase-89 fixup M-5] enumerate agent mxids via SSH — start",
    {
      operation: "enumerate_agent_mxids_start",
    },
  );

  let hosts: EnumerationHostRecord[];
  try {
    hosts = await deps.listHosts();
  } catch (err) {
    databaseLogger.warn(
      "[phase-89 fixup M-5] enumerate agent mxids — listHosts failed, aborting",
      {
        operation: "enumerate_agent_mxids_list_hosts_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return { ok: false, reason: "list_hosts_failed" };
  }

  const seen = new Set<string>();
  for (const host of hosts) {
    let output: string | null = null;
    try {
      output = await deps.runSshCommand(host, REMOTE_ENUMERATE_COMMAND);
    } catch (err) {
      databaseLogger.warn(
        "[phase-89 fixup M-5] enumerate agent mxids — SSH exec threw for host, skipping",
        {
          operation: "enumerate_agent_mxids_ssh_exec_threw",
          hostId: host.id,
          hostName: host.name,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      continue;
    }
    if (output === null) {
      databaseLogger.warn(
        "[phase-89 fixup M-5] enumerate agent mxids — SSH exec returned null for host, skipping",
        {
          operation: "enumerate_agent_mxids_ssh_exec_null",
          hostId: host.id,
          hostName: host.name,
        },
      );
      continue;
    }
    let addedForHost = 0;
    for (const rawLine of output.split("\n")) {
      const line = rawLine.trim();
      // Filter: skip empty lines and jq's "null" literal (missing user_id
      // field → jq -r prints "null" on stdout).
      if (line === "" || line === "null") continue;
      if (!seen.has(line)) {
        seen.add(line);
        addedForHost++;
      }
    }
    databaseLogger.info(
      "[phase-89 fixup M-5] enumerate agent mxids — host enumerated",
      {
        operation: "enumerate_agent_mxids_host_enumerated",
        hostId: host.id,
        hostName: host.name,
        addedCount: addedForHost,
      },
    );
  }

  const mxids = Array.from(seen);
  databaseLogger.info(
    "[phase-89 fixup M-5] enumerate agent mxids — complete",
    {
      operation: "enumerate_agent_mxids_complete",
      totalMxids: mxids.length,
      hostsQueried: hosts.length,
    },
  );
  return { ok: true, mxids };
}
