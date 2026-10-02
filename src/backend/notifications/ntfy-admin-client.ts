/**
 * Phase 144 Plan 02 Task 2 — ntfy HTTP admin API client.
 *
 * Talks to the ntfy container's admin HTTP API at http://ntfy:2586/v1/*
 * over the internal Docker network (never traverses the public internet).
 *
 * ## Admin vs per-user auth split (CRITICAL — per RESEARCH.md Q3-ADDENDUM)
 *
 * ntfy's admin endpoints (/v1/users, /v1/users/access) are gated by
 * `ensureAdmin` — only a user with the `admin` role can call them.
 * These use HTTP Basic auth with `getNtfyAdminUser()` + `getNtfyAdminPassword()`.
 *
 * ntfy's per-user token endpoint (/v1/account/token) is gated by
 * `ensureUser` — the caller must authenticate AS THAT USER, not as admin.
 * `mintUserToken` authenticates with the per-user username/password (NOT admin).
 * This is the critical split: admin credentials cannot mint per-user tokens.
 *
 * ## Error handling
 *
 * Non-2xx responses throw `NtfyAdminError` with the HTTP status code.
 * Callers in push-subscriptions.ts routes catch `NtfyAdminError` and map
 * to appropriate HTTP responses (409 → "user already exists" is swallowed
 * by ntfy-bootstrap.ts; 4xx/5xx → 500 with generic error string per
 * T-144-07 mitigation — no credential leakage in error bodies).
 *
 * ## Timeouts (T-144-10 mitigation)
 *
 * All methods use AbortSignal.timeout(5000). A slow ntfy container does
 * not block the caller indefinitely — after 5 seconds the fetch aborts
 * with a DOMException("signal timed out", "AbortError") which propagates
 * to the caller as a thrown error.
 */

import {
  getNtfyInternalPublishUrl,
  getNtfyAdminUser,
  getNtfyAdminPassword,
} from "./ntfy-config.js";

/**
 * Thrown when the ntfy admin API returns a non-2xx response.
 * Carries the HTTP status code so callers can distinguish 409 Conflict
 * (user already exists — expected idempotency case) from 4xx/5xx errors.
 *
 * T-144-07 mitigation: error messages never include the response body,
 * which may contain credential-adjacent information. Only the status code
 * and a generic description are exposed.
 */
export class NtfyAdminError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NtfyAdminError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build an HTTP Basic auth header value for the given username/password.
 * Format: "Basic <base64(username:password)>"
 */
function basicAuth(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

/**
 * Perform a fetch call with the given method, URL, admin Basic auth,
 * JSON body, and a 5-second timeout. Throws NtfyAdminError on non-2xx.
 *
 * @param method - HTTP method (POST, PUT, DELETE, GET)
 * @param url - Full URL (e.g., "http://ntfy:2586/v1/users")
 * @param authHeader - Value for the Authorization header (Basic or Bearer)
 * @param body - Request body object (will be JSON-serialized), or null
 */
async function adminFetch(
  method: string,
  url: string,
  authHeader: string,
  body: Record<string, string> | null,
): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new NtfyAdminError(
      response.status,
      `ntfy admin API returned ${response.status} for ${method} ${url}`,
    );
  }

  return response;
}

// ---------------------------------------------------------------------------
// Admin API methods
// ---------------------------------------------------------------------------

/**
 * Create a new ntfy user with the given username and password.
 * Authenticates as the ntfy admin user via Basic auth.
 *
 * POST /v1/users (gated by ensureAdmin)
 * Body: { username, password }
 *
 * Throws NtfyAdminError on non-2xx. 409 Conflict (user already exists)
 * is thrown with status 409 — ntfy-bootstrap.ts catches and swallows this
 * as the expected idempotency case.
 */
export async function createNtfyUser(
  username: string,
  password: string,
): Promise<void> {
  const baseUrl = getNtfyInternalPublishUrl();
  await adminFetch(
    "POST",
    `${baseUrl}/v1/users`,
    basicAuth(getNtfyAdminUser(), getNtfyAdminPassword()),
    { username, password },
  );
}

/**
 * Delete the ntfy user with the given username.
 * Authenticates as the ntfy admin user via Basic auth.
 *
 * DELETE /v1/users (gated by ensureAdmin)
 * Body: { username }
 *
 * Throws NtfyAdminError on non-2xx.
 */
export async function deleteNtfyUser(username: string): Promise<void> {
  const baseUrl = getNtfyInternalPublishUrl();
  await adminFetch(
    "DELETE",
    `${baseUrl}/v1/users`,
    basicAuth(getNtfyAdminUser(), getNtfyAdminPassword()),
    { username },
  );
}

/**
 * Grant read-only access to a topic for the given user.
 * Authenticates as the ntfy admin user via Basic auth.
 *
 * POST /v1/users/access (gated by ensureAdmin)
 * Body: { username, topic, permission: "ro" }
 *
 * The "ro" permission means the user can subscribe to (read) the topic
 * but cannot publish to it. This is the correct grant for ntfy iOS app
 * users — they only need to receive notifications, not send them.
 *
 * Throws NtfyAdminError on non-2xx.
 */
export async function grantTopicReadAccess(
  username: string,
  topic: string,
): Promise<void> {
  const baseUrl = getNtfyInternalPublishUrl();
  await adminFetch(
    "POST",
    `${baseUrl}/v1/users/access`,
    basicAuth(getNtfyAdminUser(), getNtfyAdminPassword()),
    { username, topic, permission: "ro" },
  );
}

/**
 * Revoke all topic access for the given user and topic.
 * Authenticates as the ntfy admin user via Basic auth.
 *
 * DELETE /v1/users/access (gated by ensureAdmin)
 * Body: { username, topic }
 *
 * Throws NtfyAdminError on non-2xx.
 */
export async function revokeTopicAccess(
  username: string,
  topic: string,
): Promise<void> {
  const baseUrl = getNtfyInternalPublishUrl();
  await adminFetch(
    "DELETE",
    `${baseUrl}/v1/users/access`,
    basicAuth(getNtfyAdminUser(), getNtfyAdminPassword()),
    { username, topic },
  );
}

/**
 * Mint a new access token for the given user.
 *
 * CRITICAL AUTH NOTE: This endpoint (/v1/account/token) is gated by
 * `ensureUser` in ntfy — the caller must authenticate AS THAT USER, not as
 * the admin. Basic auth must use the per-user username/password.
 * Using admin credentials here would fail or mint a token for the admin
 * account instead of the target user.
 *
 * POST /v1/account/token (gated by ensureUser — per-user auth)
 * Returns: the `token` field from the response body (a "tk_..." string)
 *
 * Throws NtfyAdminError on non-2xx.
 */
export async function mintUserToken(
  username: string,
  password: string,
): Promise<string> {
  const baseUrl = getNtfyInternalPublishUrl();
  const response = await adminFetch(
    "POST",
    `${baseUrl}/v1/account/token`,
    // Per-user Basic auth (NOT admin — ensureUser gate in ntfy source)
    basicAuth(username, password),
    {},
  );

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new NtfyAdminError(
      200,
      "mintUserToken: ntfy returned 200 but no token field in response body",
    );
  }
  return data.token;
}
