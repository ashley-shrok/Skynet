/**
 * Phase 111 SKEW-01/SKEW-02: single source of truth for the backend build-id.
 * Value is captured ONCE at module load — never re-read from process.env
 * elsewhere. All consumers (middleware, WS handshake, WS piggyback, guacamole
 * token issuance) import `getServerBuildId()` from here.
 *
 * Source: docker-compose sets SKYNET_BUILD_SHA as build arg → Dockerfile ARG
 * propagates it as ENV VITE_BUILD_ID in the final runtime image → Node reads
 * it at process startup.
 *
 * Fallback: "dev-unknown" when the env var is missing. Any operator seeing
 * "dev-unknown" in production logs has a config drift (Pitfall 4).
 *
 * The getter fn exists purely to make the "read once" contract testable
 * (see server-build-id.test.ts Test 3) — no re-read of process.env is
 * permitted anywhere else in the codebase. The `SERVER_BUILD_ID` const is
 * also exported for callers that want the raw string directly (e.g. header
 * middleware sets a response header from it every request).
 */

const SERVER_BUILD_ID: string = process.env.VITE_BUILD_ID || "dev-unknown";

export function getServerBuildId(): string {
  return SERVER_BUILD_ID;
}

export { SERVER_BUILD_ID };
