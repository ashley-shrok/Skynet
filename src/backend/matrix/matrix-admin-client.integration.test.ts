/**
 * matrix-admin-client — END-TO-END integration test against the live thenasty
 * Synapse relay (http://100.113.23.63:8008).
 *
 * PURPOSE — Phase 75 Plan 75-05, implements RESEARCH.md § Open Question 5:
 * "Include one end-to-end integration test in Phase A that exercises
 *  loginAsUser(mxid) → use returned token to send m.room.message → confirm
 *  the send lands. This proves the admin foundation delivers what Phase B
 *  needs, and catches any admin-permission gotchas early."
 *
 * WHAT THIS TEST PROVES:
 *   1. `loginAsUser` can mint a fresh access_token against the live Synapse
 *      admin API (this is the primitive Phase B's Telegram-bridge inbound
 *      path will use to act as a human).
 *   2. That freshly-minted token has admin-derived authority — it can PUT
 *      a message into a room via the standard client-server API.
 *   3. The message is durably persisted (GET /messages returns it).
 *
 * ---------------------------------------------------------------------------
 * GATE — STRICT process.env.INTEGRATION_TESTS === "1" (S-2 lock).
 * ---------------------------------------------------------------------------
 * The gate MUST be strict string triple-equals against "1". Loose forms
 * (double-bang truthy, Boolean() coercion, or !== undefined presence-check)
 * would let unintended values ("0", "false", "true", "yes") opt in — the
 * exact failure mode S-2 forbids. The ONLY string that opts in is the
 * literal "1". Every other value — including unset — skips the entire
 * describe block.
 *
 * ---------------------------------------------------------------------------
 * OPERATOR SETUP (before running with INTEGRATION_TESTS=1):
 * ---------------------------------------------------------------------------
 *   1. The @skynet-admin creds must be ingested into the matrix_admin_creds
 *      table via setMatrixAdminCreds({...}) — Wave 3 human checkpoint step.
 *   2. Synapse must be reachable from wherever the test runs (usually the
 *      Skynet t1000 backend host, over tailnet).
 *   3. Optionally set MATRIX_INTEGRATION_ROOM_ID to override the default
 *      integration-test room. If unset, the test creates a fresh room owned
 *      by @skynet-admin (leaves it in place — Matrix rooms are cheap;
 *      operator can delete via admin API if desired).
 *
 * ---------------------------------------------------------------------------
 * TOKEN SAFETY:
 * ---------------------------------------------------------------------------
 * The minted access_token is used to authenticate the send/read round-trip
 * but is NEVER logged, echoed, or written to any file. The test only logs
 * operation names + HTTP status codes.
 */

import { describe, it, expect } from "vitest";

import { loginAsUser } from "./matrix-admin-client.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

// ---------------------------------------------------------------------------
// STRICT S-2 gate — the exact string "1" is the ONLY opt-in.
// ---------------------------------------------------------------------------
const gate = process.env.INTEGRATION_TESTS === "1";

// The target user we impersonate via loginAsUser. MUST NOT be @skynet-admin —
// Synapse's admin-login endpoint refuses to mint a token FOR the admin itself
// ("Cannot use admin API to login as self", verified 2026-09-06 during Phase 75
// human-checkpoint verification). The real Phase B use-case is admin → human
// impersonation (bridge inbound), so this test uses a non-admin fleet account.
// Default target is @tina, a durable long-lived non-admin account on the fleet
// relay; operator can override via env for testing against another account.
const LOGIN_TARGET_DEFAULT = "@tina:thenasty.taild9b663.ts.net";
const LOGIN_TARGET_MXID =
  process.env.MATRIX_INTEGRATION_LOGIN_TARGET ?? LOGIN_TARGET_DEFAULT;

// Optional operator override for the target room. If unset, the test creates
// a fresh room. Set via `MATRIX_INTEGRATION_ROOM_ID=!abc:server npx vitest ...`.
const OVERRIDE_ROOM_ID = process.env.MATRIX_INTEGRATION_ROOM_ID;

// Test-wide timeout (60s per plan) — network round-trips over tailnet are
// typically < 1s but be generous for slow-cluster mornings.
const INTEGRATION_TIMEOUT_MS = 60_000;

/**
 * Random hex — for room-name/txnId uniqueness. We don't need cryptographic
 * strength here, just uniqueness across concurrent test runs.
 */
function randHex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a fresh integration-test room via the standard client-server API,
 * using the minted access_token. Room is public + plaintext (no encryption —
 * relay convention per substrate/skills/agent-relay/SKILL.md L237-238).
 */
async function createIntegrationRoom(
  homeserverBase: string,
  accessToken: string,
): Promise<string> {
  const url = `${homeserverBase}/_matrix/client/v3/createRoom`;
  const body = {
    visibility: "private",
    preset: "private_chat",
    name: `phase-75-integration-${randHex(4)}`,
    topic:
      "Phase 75 Plan 05 integration test room — ephemeral messages, safe to delete",
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `createRoom failed: HTTP ${response.status} — the minted token for the target user may not have room-creation permission; verify the target account is unlocked + non-guest`,
    );
  }
  const parsed = (await response.json()) as { room_id?: string };
  if (typeof parsed.room_id !== "string") {
    throw new Error("createRoom returned no room_id");
  }
  return parsed.room_id;
}

// ---------------------------------------------------------------------------
// The gated describe block. When gate === false (INTEGRATION_TESTS unset, or
// any string other than the exact "1"), ALL tests inside are SKIPPED.
// ---------------------------------------------------------------------------
describe.skipIf(!gate)(
  "matrix-admin-client integration (live thenasty Synapse)",
  () => {
    it(
      "mints a token via loginAsUser then sends + reads an m.room.message",
      async () => {
        // ---- 0. Preflight: creds must be present ----------------------------
        const creds = await getMatrixAdminCreds();
        if (!creds) {
          throw new Error(
            "matrix_admin_creds row is missing — operator must run the ingestion step: " +
              "setMatrixAdminCreds({ homeserverBase, userId, accessToken, password }) " +
              "with values from ~/.claude/roles/box-maintainer/bounties/skynet-matrix-admin-integration/credentials.txt",
          );
        }

        // Confirm the homeserver base URL matches the live relay we're
        // testing against — mismatched creds would produce confusing 401s
        // from a different server.
        expect(creds.homeserverBase).toMatch(/^https?:\/\/.+/);

        // ---- 1. loginAsUser: mint a fresh access_token ---------------------
        // Target MUST be non-admin — Synapse refuses admin-login-as-self.
        const targetMxid = LOGIN_TARGET_MXID;
        const loginResult = await loginAsUser(targetMxid);
        if (!loginResult.ok) {
          throw new Error(
            `loginAsUser failed: status=${loginResult.status} error=${loginResult.error} — ` +
              `check that target ${targetMxid} exists on the relay and is NOT the ` +
              "admin account itself (Synapse refuses admin-login-as-self). Override " +
              "via MATRIX_INTEGRATION_LOGIN_TARGET=@othermxid:server env var if needed. " +
              "Verify with: curl -s -H 'Authorization: Bearer <admin-token>' " +
              creds.homeserverBase +
              "/_synapse/admin/v2/users/" +
              encodeURIComponent(targetMxid),
          );
        }
        // Basic shape assertions on the returned token — Synapse tokens are
        // "syt_..."-prefixed but we only assert length > 0 to stay tolerant
        // of any future prefix changes. Do NOT log the token itself.
        expect(loginResult.accessToken.length).toBeGreaterThan(0);

        const mintedToken = loginResult.accessToken;

        // ---- 2. Ensure we have a room to send into -------------------------
        const roomId =
          OVERRIDE_ROOM_ID ??
          (await createIntegrationRoom(creds.homeserverBase, mintedToken));
        expect(roomId).toMatch(/^!/); // Matrix room ids start with '!'

        // ---- 3. Send an m.room.message via the minted token ----------------
        const timestamp = new Date().toISOString();
        const sentBody = `Phase 75 integration test ${timestamp}`;
        const txnId = `p75-int-${randHex(8)}`;
        const sendUrl = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
        const sendResponse = await fetch(sendUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${mintedToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ msgtype: "m.text", body: sentBody }),
        });
        expect(sendResponse.ok).toBe(true);
        if (!sendResponse.ok) {
          // Belt-and-braces — expect().toBe(true) above will already have
          // thrown, but if a future rewrite changes that path, this gives
          // the operator a clear signal.
          throw new Error(
            `send failed: HTTP ${sendResponse.status} — proves admin-permission gotcha or Synapse regression`,
          );
        }
        const sendJson = (await sendResponse.json()) as { event_id?: string };
        expect(typeof sendJson.event_id).toBe("string");

        // ---- 4. Read the latest message back and confirm content -----------
        const readUrl = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=1`;
        const readResponse = await fetch(readUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${mintedToken}` },
        });
        expect(readResponse.ok).toBe(true);
        const readJson = (await readResponse.json()) as {
          chunk?: Array<{ content?: { body?: string } }>;
        };
        const latestEvent = readJson.chunk?.[0];
        expect(latestEvent).toBeDefined();
        expect(latestEvent?.content?.body).toBe(sentBody);
      },
      INTEGRATION_TIMEOUT_MS,
    );
  },
);
