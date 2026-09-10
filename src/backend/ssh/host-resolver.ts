import { getDb } from "../database/db/index.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { logger } from "../utils/logger.js";
import type { SSHHost } from "../../types/index.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";

const sshLogger = logger;

/**
 * Resolve a host with its credentials server-side by hostId.
 * This avoids passing credentials through the frontend.
 */
export async function resolveHostById(
  hostId: number,
  userId: string,
): Promise<SSHHost | null> {
  const db = getDb();

  const hostResults = await SimpleDBOps.select(
    db.select().from(hosts).where(eq(hosts.id, hostId)),
    "ssh_data",
    userId,
  );

  if (hostResults.length === 0) return null;

  const host = hostResults[0] as Record<string, unknown>;

  // Parse JSON fields
  if (typeof host.jumpHosts === "string" && host.jumpHosts) {
    try {
      host.jumpHosts = JSON.parse(host.jumpHosts as string);
    } catch {
      host.jumpHosts = [];
    }
  }
  if (typeof host.tunnelConnections === "string") {
    try {
      host.tunnelConnections = JSON.parse(host.tunnelConnections as string);
    } catch {
      host.tunnelConnections = [];
    }
  }
  if (typeof host.statsConfig === "string" && host.statsConfig) {
    try {
      host.statsConfig = JSON.parse(host.statsConfig as string);
    } catch {
      host.statsConfig = undefined;
    }
  }
  if (typeof host.terminalConfig === "string" && host.terminalConfig) {
    try {
      host.terminalConfig = JSON.parse(host.terminalConfig as string);
    } catch {
      host.terminalConfig = undefined;
    }
  }
  if (typeof host.socks5ProxyChain === "string" && host.socks5ProxyChain) {
    try {
      host.socks5ProxyChain = JSON.parse(host.socks5ProxyChain as string);
    } catch {
      host.socks5ProxyChain = [];
    }
  }
  if (typeof host.quickActions === "string" && host.quickActions) {
    try {
      host.quickActions = JSON.parse(host.quickActions as string);
    } catch {
      host.quickActions = [];
    }
  }

  // Resolve credential if using credential-based auth
  if (host.credentialId) {
    // Phase 75-04 D-08 + D-09: substrate hosts route through CSKEK, not per-user DEK.
    // Explicit branch — not a fallback — so non-substrate hosts remain byte-identical
    // to the pre-Phase-75 behavior (D-10 scope boundary).
    //
    // Load runsFleetSubstrate directly from the hosts row (not carried in the
    // input `host` object today — belt-and-suspenders correctness).
    try {
      const substrateRows = await db
        .select({ runsFleetSubstrate: hosts.runsFleetSubstrate })
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .limit(1);
      const isSubstrate = substrateRows[0]?.runsFleetSubstrate === true;

      if (isSubstrate) {
        try {
          const CSKEK = await SystemCrypto.getInstance().getCredentialSharingKey();
          const rawRows = await db
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, host.credentialId as number))
            .limit(1);
          if (rawRows.length === 0) {
            sshLogger.warn("Substrate host credential row not found", {
              operation: "host_resolver_substrate_missing_credential",
              hostId,
              credentialId: host.credentialId,
            });
            return null; // fail closed — do NOT fall through to user-DEK
          }
          const cred = rawRows[0] as Record<string, unknown>;
          const credIdStr = String(cred.id);
          host.password = cred.systemPassword
            ? FieldCrypto.decryptField(cred.systemPassword as string, CSKEK, credIdStr, "password")
            : null;
          host.key = cred.systemKey
            ? FieldCrypto.decryptField(cred.systemKey as string, CSKEK, credIdStr, "key")
            : null;
          host.keyPassword = cred.systemKeyPassword
            ? FieldCrypto.decryptField(cred.systemKeyPassword as string, CSKEK, credIdStr, "key_password")
            : null;
          host.keyType = cred.keyType;
          if (!host.overrideCredentialUsername) {
            host.username = cred.username;
          }
          host.authType = host.key ? "key" : host.password ? "password" : "none";
          return host as unknown as SSHHost; // EXPLICIT return — no fall-through
        } catch (e) {
          sshLogger.warn("Failed to resolve CSKEK credential for substrate host", {
            operation: "host_resolver_substrate_cskek",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
          return null; // fail closed — never leak to user-DEK path
        }
      }
    } catch (e) {
      // If we can't determine substrate status, log and fall through to user-DEK.
      // This handles the case where the runsFleetSubstrate lookup itself fails
      // (e.g., DB error) — we do NOT silently change crypto behavior.
      sshLogger.warn("Failed to check runsFleetSubstrate for host, falling through to user-DEK", {
        operation: "host_resolver_substrate_check_failed",
        hostId,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }

    const ownerId = (host.userId || userId) as string;
    try {
      // Try user's own override credential first
      if (userId !== ownerId) {
        try {
          const { hostAccess } = await import("../database/db/schema.js");
          const accessRecords = await db
            .select()
            .from(hostAccess)
            .where(
              and(eq(hostAccess.hostId, hostId), eq(hostAccess.userId, userId)),
            )
            .limit(1);
          const overrideCredId = accessRecords[0]?.overrideCredentialId as
            | number
            | null;
          if (overrideCredId) {
            const userCreds = await SimpleDBOps.select(
              db
                .select()
                .from(sshCredentials)
                .where(
                  and(
                    eq(sshCredentials.id, overrideCredId),
                    eq(sshCredentials.userId, userId),
                  ),
                ),
              "ssh_credentials",
              userId,
            );
            if (userCreds.length > 0) {
              const cred = userCreds[0] as Record<string, unknown>;
              host.password = cred.password;
              host.key = cred.key;
              host.keyPassword = cred.keyPassword;
              host.keyType = cred.keyType;
              if (!host.overrideCredentialUsername) {
                host.username = cred.username;
              }
              host.authType = cred.key
                ? "key"
                : cred.password
                  ? "password"
                  : "none";
              return host as unknown as SSHHost;
            }
          }
        } catch {
          // fall through to shared credential
        }

        try {
          const { SharedCredentialManager } =
            await import("../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            hostId,
            userId,
          );
          if (sharedCred) {
            host.password = sharedCred.password;
            host.key = sharedCred.key;
            host.keyPassword = sharedCred.keyPassword;
            host.keyType = sharedCred.keyType;
            if (!host.overrideCredentialUsername) {
              host.username = sharedCred.username;
            }
            host.authType = sharedCred.key
              ? "key"
              : sharedCred.password
                ? "password"
                : "none";
            return host as unknown as SSHHost;
          }
        } catch (e) {
          sshLogger.warn("Failed to get shared credential", {
            operation: "host_resolver_shared_credential",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }

        return null;
      }

      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId as number),
              eq(sshCredentials.userId, ownerId),
            ),
          ),
        "ssh_credentials",
        ownerId,
      );

      if (credentials.length > 0) {
        const cred = credentials[0] as Record<string, unknown>;
        host.password = cred.password;
        // Prefer the normalised private key; fall back to raw key field
        host.key = (cred.privateKey || cred.key) as string | null;
        host.keyPassword = cred.keyPassword;
        host.keyType = cred.keyType;
        // CA-signed certificate for cert-based auth
        (host as Record<string, unknown>).certPublicKey =
          cred.certPublicKey || null;
        if (!host.overrideCredentialUsername) {
          host.username = cred.username;
        }
        host.authType = host.key ? "key" : host.password ? "password" : "none";
      } else {
        // Cross-user shared credential fallback (2026-09-10, Ashley: "shared means
        // shared"). The row-owner's user-DEK path returned nothing — either
        // because the cred exists under a different user (admin-set via the
        // cross-user PUT from quick 260910-67z) or because ownerId's key can't
        // decrypt it. Mirror the substrate branch above: read the cred row raw
        // (no userId filter — the reference from an already-authorized host row
        // IS the authorization), decrypt via the system CSKEK. sshCredentials
        // dual-encrypt sensitive fields under both userId's data key AND the
        // system key on insert/update per SimpleDBOps L128-140, so systemPassword
        // / systemKey / systemKeyPassword are always populated on fresh rows.
        try {
          const rawRows = await db
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, host.credentialId as number))
            .limit(1);
          if (rawRows.length > 0) {
            const cred = rawRows[0] as Record<string, unknown>;
            const CSKEK =
              await SystemCrypto.getInstance().getCredentialSharingKey();
            const credIdStr = String(cred.id);
            const decryptedPassword = cred.systemPassword
              ? FieldCrypto.decryptField(
                  cred.systemPassword as string,
                  CSKEK,
                  credIdStr,
                  "password",
                )
              : null;
            const decryptedKey = cred.systemKey
              ? FieldCrypto.decryptField(
                  cred.systemKey as string,
                  CSKEK,
                  credIdStr,
                  "key",
                )
              : null;
            const decryptedKeyPassword = cred.systemKeyPassword
              ? FieldCrypto.decryptField(
                  cred.systemKeyPassword as string,
                  CSKEK,
                  credIdStr,
                  "key_password",
                )
              : null;
            host.password = decryptedPassword;
            host.key = decryptedKey;
            host.keyPassword = decryptedKeyPassword;
            host.keyType = cred.keyType;
            (host as Record<string, unknown>).certPublicKey =
              cred.certPublicKey || null;
            if (!host.overrideCredentialUsername) {
              host.username = cred.username;
            }
            host.authType = host.key
              ? "key"
              : host.password
                ? "password"
                : "none";
            sshLogger.info(
              "Cross-user shared credential resolved via CSKEK fallback",
              {
                operation: "host_resolver_cskek_fallback",
                hostId,
                credentialId: host.credentialId,
                credOwnerUserId: cred.userId,
                rowOwnerUserId: ownerId,
              },
            );
          }
        } catch (e) {
          sshLogger.warn(
            "Cross-user CSKEK fallback failed for host credential",
            {
              operation: "host_resolver_cskek_fallback_failed",
              hostId,
              credentialId: host.credentialId,
              error: e instanceof Error ? e.message : "Unknown",
            },
          );
        }
      }
    } catch (e) {
      sshLogger.warn("Failed to resolve credential for host", {
        operation: "host_resolver_credential",
        hostId,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }
  }

  return host as unknown as SSHHost;
}

/**
 * Resolve a host with its credentials server-side by friendly name, scoped to
 * the requesting user (Phase 75, Plan 75-01, Task 1).
 *
 * **Cross-user isolation invariant** (RESEARCH § Pitfall 7): `hosts.name` is
 * a per-user friendly name and is NOT unique across users. If two users both
 * have a host named `thenasty` (different physical boxes), filtering only by
 * `name` would let user A trigger reads on user B's host by guessing the
 * friendly name. The WHERE clause MUST be
 * `and(eq(hosts.name, name), eq(hosts.userId, userId))` — filtering by BOTH.
 *
 * On zero results the function returns `null` (not throw) so the route
 * boundary can map `null → 404 unknown_host` and avoid leaking cross-user
 * host existence via a 403 differentiation.
 *
 * The credential-resolution tail (JSON-field parsing, override-credential
 * fallback, shared-credential fallback, direct-credential resolution) is
 * copied VERBATIM from `resolveHostById` above — only the WHERE clause
 * changes. Do not re-derive the credential logic here.
 */
export async function resolveHostByName(
  name: string,
  userId: string,
): Promise<SSHHost | null> {
  const db = getDb();

  const hostResults = await SimpleDBOps.select(
    db
      .select()
      .from(hosts)
      .where(and(eq(hosts.name, name), eq(hosts.userId, userId))),
    "ssh_data",
    userId,
  );

  if (hostResults.length === 0) return null;

  const host = hostResults[0] as Record<string, unknown>;

  // Parse JSON fields — mirrors resolveHostById L28-72.
  if (typeof host.jumpHosts === "string" && host.jumpHosts) {
    try {
      host.jumpHosts = JSON.parse(host.jumpHosts as string);
    } catch {
      host.jumpHosts = [];
    }
  }
  if (typeof host.tunnelConnections === "string") {
    try {
      host.tunnelConnections = JSON.parse(host.tunnelConnections as string);
    } catch {
      host.tunnelConnections = [];
    }
  }
  if (typeof host.statsConfig === "string" && host.statsConfig) {
    try {
      host.statsConfig = JSON.parse(host.statsConfig as string);
    } catch {
      host.statsConfig = undefined;
    }
  }
  if (typeof host.terminalConfig === "string" && host.terminalConfig) {
    try {
      host.terminalConfig = JSON.parse(host.terminalConfig as string);
    } catch {
      host.terminalConfig = undefined;
    }
  }
  if (typeof host.socks5ProxyChain === "string" && host.socks5ProxyChain) {
    try {
      host.socks5ProxyChain = JSON.parse(host.socks5ProxyChain as string);
    } catch {
      host.socks5ProxyChain = [];
    }
  }
  if (typeof host.quickActions === "string" && host.quickActions) {
    try {
      host.quickActions = JSON.parse(host.quickActions as string);
    } catch {
      host.quickActions = [];
    }
  }

  // Resolve credential if using credential-based auth — mirrors
  // resolveHostById L74-197 verbatim. Since the WHERE clause above already
  // scoped by userId, `ownerId` here always equals `userId`; the user is the
  // host's owner (no shared-access branch to walk).
  const hostId = host.id as number;
  if (host.credentialId) {
    try {
      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId as number),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length > 0) {
        const cred = credentials[0] as Record<string, unknown>;
        host.password = cred.password;
        // Prefer the normalised private key; fall back to raw key field
        host.key = (cred.privateKey || cred.key) as string | null;
        host.keyPassword = cred.keyPassword;
        host.keyType = cred.keyType;
        (host as Record<string, unknown>).certPublicKey =
          cred.certPublicKey || null;
        if (!host.overrideCredentialUsername) {
          host.username = cred.username;
        }
        host.authType = host.key ? "key" : host.password ? "password" : "none";
      }
    } catch (e) {
      sshLogger.warn("Failed to resolve credential for host", {
        operation: "host_resolver_credential",
        hostId,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }
  }

  return host as unknown as SSHHost;
}

/**
 * Check if a user has access to a host (owner or shared access).
 */
export async function checkHostAccess(
  hostId: number,
  userId: string,
  hostUserId: string,
  requiredPermission: "read" | "execute" = "execute",
): Promise<boolean> {
  if (userId === hostUserId) return true;

  try {
    const { PermissionManager } =
      await import("../utils/permission-manager.js");
    const permissionManager = PermissionManager.getInstance();
    const accessInfo = await permissionManager.canAccessHost(
      userId,
      hostId,
      requiredPermission,
    );
    return accessInfo.hasAccess;
  } catch {
    return false;
  }
}
