/**
 * Phase 128 Plan 03 Task 2 — `resolveAgentDisplayName(mxid)` wrapper.
 *
 * What this module does:
 *   Resolves a Matrix user ID (the sender of a message the push trigger is
 *   about to fire on) to a display-name string suitable for the notification
 *   title (D-07: content is `<agent display name>: <preview>`). The wrapper
 *   composes over the existing appearance-resolution cascade so ONE place
 *   in the codebase owns cosmetics merge (T-111-08 mitigation lives in
 *   `src/backend/fleet-status/identity-appearance.ts` — do not duplicate).
 *
 * Divergence-note vs 128-03-PLAN.md:
 *   The plan assumed `resolveIdentityAppearance` was async and could be
 *   called as `await resolveIdentityAppearance(identityKey)`. The actual
 *   `resolveIdentityAppearance` (fleet-status/identity-appearance.ts) is a
 *   PURE SYNC merge function that takes pre-loaded cosmetics + role +
 *   roleCosmetics. This wrapper therefore does the async disk-read chain
 *   itself (readIdentityFile + extractors + optional readRoleFileByName)
 *   and hands the assembled pieces to the sync resolver. The wrapper stays
 *   async (per plan behavior — "Function is async"); the mxid→identityKey
 *   convention (lowercase local-part) mirrors relay-mxid-resolve.ts.
 *   Documented as a deviation in 128-03-SUMMARY.md.
 *
 * Why local-branch (conn = null) only:
 *   The push trigger fires for LOCAL Skynet agents' outbound DMs to the
 *   local human user (D-01/D-02). All local agents live on the local box's
 *   `~/fleet/identities/` filesystem, so `readIdentityFile(null, key)`
 *   reads directly from disk. No SSH connection to remote hosts is needed
 *   or desired from a hot notification path.
 *
 * Contract:
 *   - `async` — resolves via the file-read chain then delegates to the
 *     sync resolver.
 *   - Never throws. Every failure mode (bad mxid, disk error, resolver
 *     exception, empty displayName) falls back to `localPart.slice(0, 40)`.
 *   - Return string is capped at 40 chars via `.slice(0, 40)` to keep the
 *     notification title from overflowing lock-screen chrome.
 *   - On any failure that goes through the try/catch, emits ONE `.warn`
 *     log naming the mxid and the failure so ops can see if the agent
 *     roster / disk / cascade is misbehaving.
 *
 * Threat register touch-points (from 128-03-PLAN.md <threat_model>):
 *   - T-128-14 (spoofing via unresolvable identity) mitigation: the
 *     local-part fallback is deterministic + verifiable — a user familiar
 *     with the mxid convention can spot a mis-attributed notification.
 */

import {
  readIdentityFile,
  readRoleFileByName,
  extractCosmeticsFromFrontmatter,
  extractRoleFromMarkdown,
} from "../claude-session/identity-artifact-reader.js";
import { resolveIdentityAppearance } from "../fleet-status/identity-appearance.js";
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Max length for the returned display-name string. Lock-screen chrome on
 * iOS truncates aggressively past ~40 chars, and the notification title
 * budget shares a payload with body + roomId + agentMxid (Web Push's
 * ~4KB post-encryption cap). 40 chars is a comfortable ceiling.
 */
const DISPLAY_NAME_MAX_LEN = 40;

/**
 * Placeholder hostId used when calling `resolveIdentityAppearance`. The
 * resolver only uses hostId to bake into `avatarUrl` (which this wrapper
 * discards — we only read the returned `displayName`). Passing 0 is a
 * safe placeholder that never appears in any consumer of this function.
 */
const PLACEHOLDER_HOST_ID = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Well-formed mxid pattern: `@local-part:server`. Mirrors MXID_REGEX in
 * `src/ui/features/pretty-view/relay-mxid-resolve.ts` — the client-side
 * cascade uses the same shape check before attempting an identity lookup.
 */
const MXID_PATTERN = /^@([^:]+):(.+)$/;

/**
 * Extract the mxid's local-part (the substring between `@` and `:`). Used
 * as both the identityKey (per the lowercase convention in
 * `relay-mxid-resolve.ts`) and the last-resort fallback display-name.
 *
 * Malformed mxids (missing `@` or `:`) still return a best-effort local-part:
 *   - No leading `@` → returned as-is up to the first `:`.
 *   - No trailing `:` → returned as-is after stripping the leading `@`.
 *
 * The result is deterministic and never throws.
 */
function extractLocalPart(mxid: string): string {
  return mxid.replace(/^@/, "").split(":")[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a Matrix user ID to a display-name string for the notification
 * title (D-07). Never throws.
 *
 * Resolution cascade:
 *   1. Extract localPart from mxid; lowercase → identityKey (mirrors
 *      relay-mxid-resolve.ts's convention).
 *   2. Read the identity file (LOCAL branch — see module doc).
 *   3. Extract cosmetics + role name from the identity file.
 *   4. If a role is present, read the role file + extract its cosmetics.
 *   5. Hand everything to `resolveIdentityAppearance` (the pure sync
 *      merge fn in fleet-status/identity-appearance.ts).
 *   6. If the resolved `displayName` is a non-empty string, return it
 *      truncated to DISPLAY_NAME_MAX_LEN.
 *   7. Otherwise return `localPart.slice(0, DISPLAY_NAME_MAX_LEN)`.
 *
 * Failure modes (all → localPart fallback with `.warn`):
 *   - readIdentityFile throws (disk / SSH error).
 *   - readRoleFileByName throws (role name gate / disk error).
 *   - Any extractor throws (unlikely — they're synchronous parsers).
 *   - resolveIdentityAppearance throws (unlikely — pure merge fn).
 *
 * @param mxid - Matrix user ID of the message sender.
 * @returns    Display-name string, guaranteed non-empty (given a non-empty mxid).
 */
export async function resolveAgentDisplayName(mxid: string): Promise<string> {
  // Compute the local-part fallback FIRST — this is what we return on any
  // failure below, and the try/catch's fallback branch uses it directly.
  const localPart = extractLocalPart(mxid);
  const fallback = localPart.slice(0, DISPLAY_NAME_MAX_LEN);

  try {
    // Short-circuit for malformed mxids (missing `@` or `:`) — mirrors the
    // client-side `relay-mxid-resolve.ts` behavior which returns the raw
    // mxid as displayName when MXID_REGEX fails. Here we return the
    // best-effort local-part directly rather than sending a nonsense
    // identityKey through the disk-read + resolver cascade (which would
    // hit ENOENT + return `capitalizeFirstIdentityKey` — an ambient
    // "Test-Agent-Foo"-shaped title-case that's misleading given the
    // mxid was already malformed).
    if (!MXID_PATTERN.test(mxid)) {
      return fallback;
    }

    // Lowercase per the relay-mxid-resolve.ts convention: identity folder
    // names on disk are always lowercase per IDENTITY_KEY_RE
    // (/^[a-z0-9_-]{1,64}$/), so the local-part must be lowercased before
    // the disk read.
    const identityKey = localPart.toLowerCase();

    // Empty local-part (e.g. mxid "@" or "@:server") → nothing to look up.
    if (identityKey.length === 0) {
      return fallback;
    }

    // Step 1: identity file.
    const { markdown: identityMd } = await readIdentityFile(null, identityKey);
    const cosmetics = extractCosmeticsFromFrontmatter(identityMd);
    const role = extractRoleFromMarkdown(identityMd);

    // Step 2: role file (optional — only if identity declares a role).
    let roleCosmetics: ReturnType<typeof extractCosmeticsFromFrontmatter> | null =
      null;
    if (role !== null) {
      try {
        const { markdown: roleMd } = await readRoleFileByName(null, role);
        // Empty role markdown → role file missing → treat as {} per the
        // "role exists but has no cosmetics" semantics documented in
        // identity-appearance.ts's roleDefaults JSDoc.
        roleCosmetics = roleMd
          ? extractCosmeticsFromFrontmatter(roleMd)
          : ({} as ReturnType<typeof extractCosmeticsFromFrontmatter>);
      } catch (roleErr) {
        // Role-read failure is non-fatal — the resolver's `identity ??
        // role ?? null` cascade tolerates a null roleCosmetics. Warn and
        // continue with the identity-only branch.
        systemLogger.warn(
          "resolveAgentDisplayName role-file read failed — continuing with identity-only cosmetics",
          {
            operation: "resolve_agent_display_name_role_read_failed",
            mxid,
            role,
            error:
              roleErr instanceof Error ? roleErr.message : "unknown",
          },
        );
        roleCosmetics = null;
      }
    }

    // Step 3: hand assembled cosmetics + role + roleCosmetics to the pure
    // sync resolver. `pinned` is not relevant to the display-name derivation
    // (the resolver only uses it as a returned field), so pass false.
    const resolved = resolveIdentityAppearance({
      identityKey,
      hostId: PLACEHOLDER_HOST_ID,
      cosmetics,
      roleCosmetics,
      role,
      pinned: false,
    });

    // Extract the display-name; empty-string guard falls to the local-part.
    const displayName =
      typeof resolved.displayName === "string" && resolved.displayName.length > 0
        ? resolved.displayName
        : fallback;

    return displayName.slice(0, DISPLAY_NAME_MAX_LEN);
  } catch (err) {
    // ANY failure in the cascade above lands here. Log at .warn (never
    // .error — this is an expected degradation mode, not a bug) and return
    // the deterministic local-part fallback.
    systemLogger.warn(
      "resolveAgentDisplayName appearance-resolution failed — using mxid local-part fallback",
      {
        operation: "resolve_agent_display_name_failed",
        mxid,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return fallback;
  }
}
