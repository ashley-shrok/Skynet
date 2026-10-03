/**
 * Phase 144 Plan 02 Task 2 — ntfy HTTP admin API client.
 * Phase 145 — mintUserToken removed (never actually useful: the ntfy iOS
 * app's per-topic Login dialog does Basic auth, not Bearer). Added
 * updateNtfyUserPassword for the Phase 145 regenerate flow.
 *
 * Talks to the ntfy container's admin HTTP API at http://ntfy:2586/v1/*
 * over the internal Docker network (never traverses the public internet).
 *
 * ## Admin auth
 *
 * All exported methods call admin endpoints (/v1/users, /v1/users/access)
 * gated by `ensureAdmin` — only a user with the `admin` role can call
 * them. Auth is HTTP Basic with `getNtfyAdminUser()` + `getNtfyAdminPassword()`.
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
 * Update the password for an existing ntfy user.
 * Authenticates as the ntfy admin user via Basic auth.
 *
 * PUT /v1/users (gated by ensureAdmin)
 * Body: { username, password }
 *
 * ntfy's admin API treats PUT /v1/users as "upsert password" for an existing
 * user. All of the user's existing tokens remain valid; only the Basic-auth
 * password is replaced. Used by the Phase 145 regenerate flow to rotate a
 * user's password without the delete-and-recreate dance that would also
 * invalidate any existing ACL grants.
 *
 * Throws NtfyAdminError on non-2xx.
 */
export async function updateNtfyUserPassword(
  username: string,
  password: string,
): Promise<void> {
  const baseUrl = getNtfyInternalPublishUrl();
  await adminFetch(
    "PUT",
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

