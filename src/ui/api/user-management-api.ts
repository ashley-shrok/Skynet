import { authApi, handleApiError } from "@/main-axios";
import type { UserInfo } from "@/main-axios";

// USER MANAGEMENT
// ============================================================================

export async function getUserList(): Promise<{ users: UserInfo[] }> {
  try {
    const response = await authApi.get("/users/list");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user list");
  }
}

// ─── Phase 38: identity sharing — picker-facing users list ──────────────────
// Backing route: src/backend/database/routes/user-admin-routes.ts (/users/list-basic)
// GET /users/list-basic → { users: [{id, username}, ...] }
// Every user OTHER than the requester (server-side ne(users.id, requester)).
// Empty array on single-user deployments — picker hides itself in that case.
//
// Distinct from /users/list (admin-gated, exposes isAdmin/isOidc/etc.); this
// route is reachable by any authenticated user and is scoped to id+username
// only, enforced by an explicit-columns drizzle select on the backend.
//
// Consumed by ShareIdentityPicker to populate the DropdownMenu content.

export interface BasicUser {
  id: string;
  username: string;
}

export async function getUsersListBasic(): Promise<BasicUser[]> {
  try {
    const response = await authApi.get("/users/list-basic");
    return (response.data as { users: BasicUser[] }).users;
  } catch (error) {
    handleApiError(error, "list basic users");
  }
}

export async function getSessions(): Promise<{
  sessions: {
    id: string;
    userId: string;
    username?: string;
    deviceType: string;
    deviceInfo: string;
    createdAt: string;
    expiresAt: string;
    lastActiveAt: string;
    isRevoked?: boolean;
    isCurrentSession?: boolean;
  }[];
}> {
  try {
    const response = await authApi.get("/users/sessions");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch sessions");
  }
}

export async function revokeSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.delete(`/users/sessions/${sessionId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke session");
  }
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/sessions/revoke-all", {
      targetUserId: userId,
      exceptCurrent: false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke all user sessions");
  }
}

export interface ApiKey {
  id: string;
  name: string;
  userId: string;
  username: string | null;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
}

export interface CreatedApiKey extends ApiKey {
  token: string;
}

export async function createApiKey(
  name: string,
  userId: string,
  expiresAt?: string,
): Promise<CreatedApiKey> {
  try {
    const response = await authApi.post("/users/api-keys", {
      name,
      userId,
      expiresAt: expiresAt ?? null,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "create API key");
  }
}

export async function getApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  try {
    const response = await authApi.get("/users/api-keys");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch API keys");
  }
}

export async function deleteApiKey(
  keyId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(`/users/api-keys/${keyId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete API key");
  }
}

export async function makeUserAdmin(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/make-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "make user admin");
  }
}

export async function removeAdminStatus(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/remove-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove admin status");
  }
}

export async function deleteUser(
  username: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-user", {
      data: { username },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete user");
  }
}

export async function deleteAccount(
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-account", {
      data: { password },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete account");
  }
}

export async function updateRegistrationAllowed(
  allowed: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/registration-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update registration allowed");
  }
}

export async function getOidcAutoProvision(): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.get("/users/oidc-auto-provision");
    return response.data;
  } catch (error) {
    handleApiError(error, "check OIDC auto-provision status");
  }
}

export async function updateOidcAutoProvision(
  enabled: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/oidc-auto-provision", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update OIDC auto-provision");
  }
}

export async function updatePasswordLoginAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-login-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password login allowed");
  }
}

export async function getPasswordResetAllowed(): Promise<boolean> {
  try {
    const response = await authApi.get("/users/password-reset-allowed");
    return response.data.allowed;
  } catch (error) {
    handleApiError(error, "get password reset allowed");
  }
}

export async function updatePasswordResetAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-reset-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password reset allowed");
  }
}

export async function updateOIDCConfig(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/oidc-config", config);
    return response.data;
  } catch (error) {
    handleApiError(error, "update OIDC config");
  }
}

export async function disableOIDCConfig(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/oidc-config");
    return response.data;
  } catch (error) {
    handleApiError(error, "disable OIDC config");
  }
}

// ============================================================================
