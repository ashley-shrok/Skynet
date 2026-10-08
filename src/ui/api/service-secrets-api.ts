/**
 * Agent-service per-user secrets — frontend client.
 *
 * Backing routes: src/backend/agent-services/user-secrets/routes.ts.
 * Write-only: the API reports whether a secret is set and when, never its
 * value. /users/me/* only covers user-managed secrets; admin-managed ones
 * (company-issued keys) are reachable only through the admin routes.
 */

import { authApi, handleApiError } from "@/main-axios";

export interface ServiceSecret {
  service: string;
  serviceDescription: string;
  name: string;
  label: string;
  description?: string;
  managedBy: "user" | "admin";
  /** The backend has a default value for users who set none. */
  hasFallback: boolean;
  isSet: boolean;
  updatedAt: string | null;
}

const path = (base: string, s: Pick<ServiceSecret, "service" | "name">) =>
  `${base}/${encodeURIComponent(s.service)}/${encodeURIComponent(s.name)}`;

const ME = "/users/me/service-secrets";
const forUser = (userId: string) =>
  `/users/${encodeURIComponent(userId)}/service-secrets`;

export async function getMyServiceSecrets(): Promise<ServiceSecret[]> {
  try {
    const response = await authApi.get(ME);
    return (response.data as { secrets: ServiceSecret[] }).secrets;
  } catch (error) {
    handleApiError(error, "list service secrets");
  }
}

export async function setMyServiceSecret(
  s: Pick<ServiceSecret, "service" | "name">,
  value: string,
): Promise<void> {
  try {
    await authApi.put(path(ME, s), { value });
  } catch (error) {
    handleApiError(error, "save service secret");
  }
}

export async function clearMyServiceSecret(
  s: Pick<ServiceSecret, "service" | "name">,
): Promise<void> {
  try {
    await authApi.delete(path(ME, s));
  } catch (error) {
    handleApiError(error, "clear service secret");
  }
}

export async function getUserServiceSecrets(
  userId: string,
): Promise<ServiceSecret[]> {
  try {
    const response = await authApi.get(forUser(userId));
    return (response.data as { secrets: ServiceSecret[] }).secrets;
  } catch (error) {
    handleApiError(error, "list user service secrets");
  }
}

export async function setUserServiceSecret(
  userId: string,
  s: Pick<ServiceSecret, "service" | "name">,
  value: string,
): Promise<void> {
  try {
    await authApi.put(path(forUser(userId), s), { value });
  } catch (error) {
    handleApiError(error, "save user service secret");
  }
}

export async function clearUserServiceSecret(
  userId: string,
  s: Pick<ServiceSecret, "service" | "name">,
): Promise<void> {
  try {
    await authApi.delete(path(forUser(userId), s));
  } catch (error) {
    handleApiError(error, "clear user service secret");
  }
}
