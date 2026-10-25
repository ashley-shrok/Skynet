/**
 * Every action agreed as "confirm it's you" stays behind requireRecentAuth.
 * Reads the route files and checks each protected route's middleware list,
 * so removing the check (or renaming a route out from under it) fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

const PROTECTED: Array<[file: string, method: string, path: string]> = [
  ["database/routes/user-api-key-routes.ts", "post", "/api-keys"],
  ["database/routes/user-api-key-routes.ts", "delete", "/api-keys/:keyId"],
  ["database/routes/user-totp-routes.ts", "post", "/totp/setup"],
  ["database/routes/user-totp-routes.ts", "post", "/totp/enable"],
  ["database/routes/user-totp-routes.ts", "post", "/totp/disable"],
  ["database/routes/user-totp-routes.ts", "post", "/totp/backup-codes"],
  ["database/routes/users.ts", "post", "/change-password"],
  ["database/routes/user-session-routes.ts", "post", "/sessions/revoke-all"],
  ["database/routes/user-session-routes.ts", "delete", "/sessions/:sessionId"],
  ["database/routes/user-admin-routes.ts", "post", "/make-admin"],
  ["database/routes/user-admin-routes.ts", "post", "/remove-admin"],
  ["database/routes/users.ts", "patch", "/registration-allowed"],
  ["database/routes/users.ts", "patch", "/password-login-allowed"],
  ["database/routes/users.ts", "patch", "/password-reset-allowed"],
  ["database/routes/users.ts", "patch", "/oidc-auto-provision"],
  ["database/routes/users.ts", "post", "/oidc-config"],
  ["database/routes/users.ts", "delete", "/oidc-config"],
  ["database/routes/user-settings-routes.ts", "patch", "/session-timeout"],
  ["database/database.ts", "post", "/database/export"],
  ["database/routes/host.ts", "get", "/db/host/:id/export"],
  ["database/routes/host.ts", "get", "/db/hosts/export"],
  ["database/routes/credential-deploy-routes.ts", "post", "/:id/deploy-to-host"],
  ["database/routes/push-subscriptions.ts", "put", "/telegram/bot"],
  ["database/routes/push-subscriptions.ts", "post", "/telegram/link"],
  ["database/routes/user-phone-routes.ts", "put", "/me/phone"],
  ["database/routes/user-admin-routes.ts", "post", "/:id/phone"],
];

function middlewareOf(src: string, method: string, path: string): string {
  const esc = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`\\.${method}\\(\\s*"${esc}"\\s*,([\\s\\S]*?)async\\s*\\(`);
  const m = src.match(re);
  if (!m) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return m[1];
}

describe("confirm-it's-you coverage", () => {
  it.each(PROTECTED)("%s %s %s needs a recent confirmation", (file, method, path) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(middlewareOf(src, method, path)).toContain("requireRecentAuth");
  });
});

describe("only password sign-ins start confirmed", () => {
  it("a sign-in starts confirmed only when it says so", () => {
    const src = readFileSync(join(ROOT, "utils/auth-manager.ts"), "utf8");
    expect(src).toContain("confirmedAt: options.identityConfirmed === true ? createdAt : null");
  });

  it("the password and two-step sign-ins say so; the SSO sign-in doesn't", () => {
    const users = readFileSync(join(ROOT, "database/routes/users.ts"), "utf8");
    const totp = readFileSync(join(ROOT, "database/routes/user-totp-routes.ts"), "utf8");
    const before = (src: string, marker: string) =>
      src.slice(src.indexOf(marker) - 400, src.indexOf(marker));
    expect(before(users, "loginRateLimiter.resetAttempts(clientIp, username);")).toContain(
      "identityConfirmed: true",
    );
    expect(before(totp, '"TOTP verification successful"')).toContain("identityConfirmed: true");
    expect(before(users, '"OIDC login successful"')).not.toContain("identityConfirmed");
  });
});
