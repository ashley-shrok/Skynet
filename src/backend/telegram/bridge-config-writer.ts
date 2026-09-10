// Phase 79 Plan 04 — bridge-config-writer
/**
 * Phase 79 Plan 04 Task 2 — bridge-config-writer.
 * Phase 98 Plan 08 — the old Chatterbox-direct STT-URL write is dropped;
 * SKYNET_BASE + SKYNET_BRIDGE_TOKEN added (per D-Telegram-bridge-STT locked
 * 2026-09-10). The bridge no longer POSTs voice notes directly to Chatterbox
 * on the tailnet — it now POSTs to $SKYNET_BASE/voice/transcribe with a
 * bridge-scoped Bearer JWT, and Skynet handles the provider translation
 * (AWS Transcribe today, whatever tomorrow). This keeps the bridge
 * provider-agnostic.
 *
 * Orchestrates the substrate-side writes that make the tg-bridge Docker
 * service functional:
 *   1. `/state/config.env` — MATRIX_ROOT + SKYNET_BASE + SKYNET_BRIDGE_TOKEN
 *      (bash-source-safe), read by the bridge at startup so nothing is
 *      hardcoded.
 *   2. `/state/<identityKey>.bottoken` — one per row, plaintext bot token,
 *      0600. Nina's live convention, preserved verbatim in Phase B per
 *      blocker B-1.
 *   3. `/state/<humanName>.token` — one per registered human (minted via
 *      matrix-admin loginAsUser). Kills the old `<human>.cred` pattern.
 *   4. `/state/registry.json` — Nina-shape (no bot_token, no cred).
 *
 * THREE exports:
 *   - writeBridgeConfigEnv() — atomic write of config.env only.
 *   - rewriteRegistryFromCurrentState() — steps 2-4. RE-CALLABLE from
 *     HTTP handlers (Plan 03's /telegram/activate and /disconnect wire
 *     through this — blocker B-2 fix). NEVER throws — always returns
 *     shape-clean result so callers can act on it without try/catch.
 *   - ensureBridgeConfigWritten() — startup one-shot. Fire-and-forget from
 *     starter.ts. Non-fatal on failure; bridge tolerates a 5-min cold-start
 *     delay per RESEARCH § A9 and Plan 08's reconcile is the safety net.
 *
 * Do NOT re-throw anywhere in the public entry points. starter.ts fires
 * ensureBridgeConfigWritten without awaiting; Plan 03's HTTP handlers
 * check the returned shape and log-warn on failure. Neither wants an
 * exception.
 */
import fs from "node:fs";
import { getMatrixHomeserverBase } from "../matrix/matrix-config.js";
import { mintBridgeServiceToken } from "./bridge-service-token.js";
import { configEnvPath } from "./shared-volume.js";
import { listTelegramBotTokens } from "./tokens-store.js";
import { syncAllBotTokenFiles } from "./bot-token-file-writer.js";
import { mintAndWriteHumanToken } from "./human-token-writer.js";
import {
  buildRegistryFromRows,
  writeRegistry,
} from "./registry-writer.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";
import { getSharedDMRoom } from "../matrix/matrix-admin-client.js";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Extract Matrix server_name from a fully-qualified mxid.
 *
 * @example
 *   serverNameFromMxid("@skynet-admin:thenasty.taild9b663.ts.net")
 *   // => "thenasty.taild9b663.ts.net"
 *
 * Returns null on malformed input (missing colon).
 *
 * Why this exists: the Matrix homeserver base URL may use an IP (`http://
 * 100.113.23.63:8008`), which is fine as a network endpoint but is NOT the
 * server_name the Matrix federation/mxid space uses. Extracting hostname
 * from that URL produces `100.113.23.63`, but agent+human mxids are
 * `@name:thenasty.taild9b663.ts.net` — mismatched, causing MX→TG routing
 * to silently drop (bridge scans events by sender mxid). Fix: derive
 * server_name from the admin's own mxid (matrix_admin_creds.userId), which
 * IS in the correct server_name space.
 */
export function serverNameFromMxid(mxid: string): string | null {
  const colon = mxid.indexOf(":");
  if (colon <= 0 || colon === mxid.length - 1) return null;
  return mxid.slice(colon + 1);
}

/**
 * Skynet's internal-network base URL as seen by the tg-bridge Docker service.
 *
 * The tg-bridge container is joined to `skynet-net` alongside the `skynet`
 * service (docker-compose service name resolves via Docker's embedded DNS),
 * and Skynet listens internally on port 8080 (`expose: ["8080"]` +
 * `PORT: "8080"` env from docker-compose.yml). No env-var override is
 * exposed here because the bridge and Skynet are always co-deployed via
 * docker-compose — the internal-network topology is invariant. If a
 * future era decouples them, this becomes an env-var read.
 */
const SKYNET_INTERNAL_BASE = "http://skynet:8080";

export async function writeBridgeConfigEnv(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const homeserverBase = await getMatrixHomeserverBase();
  if (homeserverBase === null) {
    databaseLogger.warn(
      "bridge config not written — no admin creds ingested yet",
      { operation: "bridge_config_write_skipped" },
    );
    return { ok: false, reason: "no matrix admin creds ingested" };
  }

  // Phase 98 Plan 08 — mint a bridge-scoped JWT (per D-Telegram-bridge-STT
  // locked 2026-09-10). The token authenticates bridge → Skynet POSTs to
  // /voice/transcribe via authenticateJWT middleware on the same verify
  // path user JWTs traverse.
  const mintResult = await mintBridgeServiceToken();
  if (mintResult.ok === false) {
    databaseLogger.warn(
      "bridge config not written — bridge service token mint failed",
      {
        operation: "bridge_config_write_skipped",
        reason: mintResult.reason,
      },
    );
    return {
      ok: false,
      reason: `token mint failed: ${mintResult.reason}`,
    };
  }
  const bridgeToken = mintResult.token;

  // Bash-source safety: refuse anything that could break the shell parse
  // or embed a comment marker. homeserverBase comes from user-ingested
  // creds; SKYNET_INTERNAL_BASE is a compile-time constant (defensive
  // check only); bridgeToken is a JWT (dot-separated base64url segments,
  // no `#` or `\n` under normal encoding — defensive check only).
  if (
    homeserverBase.includes("#") ||
    homeserverBase.includes("\n") ||
    SKYNET_INTERNAL_BASE.includes("#") ||
    SKYNET_INTERNAL_BASE.includes("\n") ||
    bridgeToken.includes("#") ||
    bridgeToken.includes("\n")
  ) {
    databaseLogger.error(
      "bridge config refused — URL or token contains unsafe chars",
      undefined,
      {
        operation: "bridge_config_write_unsafe",
      },
    );
    return { ok: false, reason: "unsafe chars in URL or token" };
  }

  const body =
    `# Written by Skynet at boot — Phase 98. Do not edit by hand.\n` +
    `MATRIX_ROOT=${homeserverBase}\n` +
    `SKYNET_BASE=${SKYNET_INTERNAL_BASE}\n` +
    `SKYNET_BRIDGE_TOKEN=${bridgeToken}\n`;

  const target = configEnvPath();
  const tmp = `${target}.tmp`;
  try {
    // 0600: config.env carries SKYNET_BRIDGE_TOKEN, a 30-day service JWT
    // with /voice/* access (see bridge-service-token.ts). Match the 0600
    // convention sibling secret files (per-human .token files at line 18).
    await fs.promises.writeFile(tmp, body, { mode: 0o600 });
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {
      /* swallow cleanup */
    });
    databaseLogger.warn("bridge config write failed", {
      operation: "bridge_config_write_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fs write failed",
    };
  }

  databaseLogger.info("bridge config written", {
    operation: "bridge_config_write",
    target,
  });
  return { ok: true };
}

/**
 * Re-callable helper Plan 03's activate + disconnect routes wire through
 * (blocker B-2). Wraps the whole pipeline in try/catch and NEVER throws —
 * always returns `{ok:true, agentCount, humanCount}` or `{ok:false, error}`.
 */
export async function rewriteRegistryFromCurrentState(): Promise<
  | { ok: true; agentCount: number; humanCount: number }
  | { ok: false; error: string }
> {
  try {
    // Step 1: pull all telegram_bot_tokens rows (decrypts eagerly).
    const rows = await listTelegramBotTokens();

    // Step 2: resolve the Matrix server_name for building agent mxids.
    // Sourced from the admin's own mxid — NOT from the homeserverBase URL,
    // which may be an IP endpoint (`http://100.113.23.63:8008`) that
    // produces a wrong-namespace `@tina:100.113.23.63` mxid. Admin userId
    // is always canonical `@name:server_name` (verified by Synapse at
    // ingest time via /whoami).
    let serverName: string | null = null;
    const adminCreds = await getMatrixAdminCreds();
    if (adminCreds !== null) {
      serverName = serverNameFromMxid(adminCreds.userId);
      if (serverName === null) {
        databaseLogger.warn(
          "rewriteRegistryFromCurrentState: admin userId malformed",
          {
            operation: "bridge_registry_admin_mxid_parse_failed",
            adminUserId: adminCreds.userId,
          },
        );
      }
    }

    // Step 3: build the humans map from the users table. Per revision
    // blocker B-4: users.username is already lowercase for prod (ashley,
    // zoey). A defensive .toLowerCase() would be harmless but is not
    // required.
    const userRows = (await db
      .select({
        id: users.id,
        username: users.username,
        mxid: users.mxid,
      })
      .from(users)) as Array<{
      id: string;
      username: string;
      mxid: string | null;
    }>;

    const humansByUserId = new Map<
      string,
      { name: string; mxid: string }
    >();
    for (const row of userRows) {
      if (row.mxid && typeof row.mxid === "string") {
        humansByUserId.set(row.id, {
          name: row.username,
          mxid: row.mxid,
        });
      }
    }

    // Step 4: build the agents map from row identityKeys.
    const agentsByIdentityKey = new Map<
      string,
      { name: string; mxid: string }
    >();
    for (const row of rows) {
      if (agentsByIdentityKey.has(row.identityKey)) continue;
      if (!serverName) {
        // Without a server_name we can't safely build an mxid — skip this
        // agent from the registry rather than emit a malformed value.
        continue;
      }
      agentsByIdentityKey.set(row.identityKey, {
        name: row.identityKey,
        mxid: `@${row.identityKey}:${serverName}`,
      });
    }

    // Step 5: sync per-agent .bottoken files (blocker B-1). Never throws
    // per its own contract.
    const syncResult = await syncAllBotTokenFiles();
    databaseLogger.info(
      "rewriteRegistryFromCurrentState: bot-token files synced",
      {
        operation: "bridge_bottoken_sync",
        written: syncResult.written,
        failed: syncResult.failed,
      },
    );

    // Step 6: mint fresh Matrix tokens for every human referenced by a row.
    // Best-effort — individual failures logged; loop continues.
    const humansSeen = new Set<string>();
    for (const row of rows) {
      const human = humansByUserId.get(row.humanUserId);
      if (!human) continue;
      if (humansSeen.has(human.mxid)) continue; // dedupe when multiple agents share a human
      humansSeen.add(human.mxid);
      try {
        const mintResult = await mintAndWriteHumanToken(
          human.mxid,
          human.name,
        );
        // `=== false` narrowing — strict tsc (docker build) doesn't narrow
        // discriminated unions on `!x.ok`; see commit 967ab598.
        if (mintResult.ok === false) {
          databaseLogger.warn(
            "rewriteRegistryFromCurrentState: mint failed for human",
            {
              operation: "bridge_mint_human_token_failed",
              humanName: human.name,
              mxid: human.mxid,
              error: mintResult.error,
            },
          );
        }
      } catch (err) {
        // Defensive — mintAndWriteHumanToken shouldn't throw except on
        // guard-rejected humanName, but paranoia is cheap here.
        databaseLogger.warn(
          "rewriteRegistryFromCurrentState: mint threw",
          {
            operation: "bridge_mint_human_token_threw",
            humanName: human.name,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
    }

    // Step 6.5: discover Matrix DM rooms per (agentMxid, humanMxid) pair.
    // Phase 83 Plan 04 — getSharedDMRoom returns the 2-member Matrix DM
    // room where a bridge can safely route MX→TG replies. Failures for
    // individual pairs collapse to null in the map; registry.json emits
    // humans[].room = null for those pairs and the bridge falls back to
    // not routing MX→TG for that pair (bridge.sh:243 filter). Acceptable
    // per CONTEXT § 4 — a later reconcile can retry.
    //
    // No caching (CONTEXT § 4 explicit): every rewrite re-queries. Cheap
    // because rewrites fire only on activate/disconnect/reconcile, never
    // per-message.
    //
    // Key format is `${agentMxid}\t${humanMxid}` — tab is never valid
    // inside a Matrix mxid (@localpart:dns-name), so no collision risk.
    const roomByAgentHumanMxidPair = new Map<string, string | null>();
    const pairs: Array<[string, string]> = [];
    for (const row of rows) {
      const agent = agentsByIdentityKey.get(row.identityKey);
      const human = humansByUserId.get(row.humanUserId);
      if (!agent || !human) continue;
      pairs.push([agent.mxid, human.mxid]);
    }
    await Promise.all(
      pairs.map(async ([agentMxid, humanMxid]) => {
        const key = `${agentMxid}\t${humanMxid}`;
        try {
          const roomId = await getSharedDMRoom(agentMxid, humanMxid);
          roomByAgentHumanMxidPair.set(key, roomId);
        } catch (err) {
          databaseLogger.warn(
            "rewriteRegistryFromCurrentState: room lookup failed for pair",
            {
              operation: "bridge_registry_room_lookup_failed",
              agentMxid,
              humanMxid,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
          roomByAgentHumanMxidPair.set(key, null);
        }
      }),
    );

    // Step 7: build + write registry.json.
    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
      roomByAgentHumanMxidPair,
    );
    await writeRegistry(registry);

    databaseLogger.info(
      "rewriteRegistryFromCurrentState: registry written",
      {
        operation: "bridge_registry_write",
        agentCount: agentsByIdentityKey.size,
        humanCount: humansByUserId.size,
      },
    );

    return {
      ok: true,
      agentCount: agentsByIdentityKey.size,
      humanCount: humansByUserId.size,
    };
  } catch (err) {
    // Absolute barrier — this function MUST NOT throw.
    const message = err instanceof Error ? err.message : "unknown error";
    databaseLogger.warn(
      "rewriteRegistryFromCurrentState: pipeline failed",
      {
        operation: "bridge_registry_rewrite_failed",
        error: message,
      },
    );
    return { ok: false, error: message };
  }
}

/**
 * Startup one-shot. Called fire-and-forget from starter.ts after DB init.
 * Wraps everything in try/catch; NEVER re-throws.
 */
export async function ensureBridgeConfigWritten(): Promise<void> {
  try {
    const configResult = await writeBridgeConfigEnv();
    // `=== false` narrowing — strict tsc doesn't narrow discriminated unions
    // on `!x.ok`; see commit 967ab598.
    if (configResult.ok === false) {
      databaseLogger.warn(
        "ensureBridgeConfigWritten: config write failed — skipping registry rewrite (bridge will retry for 5 min per RESEARCH A9)",
        {
          operation: "bridge_config_write_skipped",
          reason: configResult.reason,
        },
      );
      return;
    }

    const rewriteResult = await rewriteRegistryFromCurrentState();
    if (rewriteResult.ok === false) {
      databaseLogger.warn(
        "ensureBridgeConfigWritten: registry rewrite failed at startup",
        {
          operation: "bridge_registry_rewrite_startup_failed",
          error: rewriteResult.error,
        },
      );
    } else {
      databaseLogger.info(
        "ensureBridgeConfigWritten: startup complete",
        {
          operation: "bridge_config_startup_ok",
          agentCount: rewriteResult.agentCount,
          humanCount: rewriteResult.humanCount,
        },
      );
    }
  } catch (err) {
    databaseLogger.warn(
      "ensureBridgeConfigWritten: unhandled error at startup",
      {
        operation: "bridge_config_startup_error",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}
