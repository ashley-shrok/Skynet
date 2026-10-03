/**
 * Phase 144 Plan 03 — ntfy-setup-api
 * Phase 145 — response shape changed: readingCredential (tk_... token) replaced
 * by ntfyPassword (Basic-auth password matched to ntfyUsername).
 *
 * Frontend API client for the ntfy setup endpoints.
 * Mirrors the authApi + handleApiError pattern established in the existing
 * API modules (e.g. apps-archive-api.ts, user-management-api.ts).
 *
 * All five endpoints require JWT authentication (handled by authApi's
 * withCredentials: true).
 *
 * Endpoint contract:
 *   GET    /push-subscriptions/ntfy-setup       → NtfySetup
 *   POST   /push-subscriptions/ntfy-setup       → NtfySetup  (idempotent provision)
 *   POST   /push-subscriptions/ntfy-test        → { ok: boolean; error?: string }
 *   POST   /push-subscriptions/ntfy-regenerate  → NtfySetup  (rotates ntfyPassword)
 *   DELETE /push-subscriptions/ntfy-setup       → { ok: true }
 */

import { authApi, handleApiError } from "@/main-axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NtfySetup {
  isSetUp: boolean;
  serverAddress?: string;
  topicName?: string;
  ntfyUsername?: string;
  ntfyPassword?: string;
}

export interface NtfyTestResult {
  ok: boolean;
  error?: string;
}

// ─── API-01: GET /push-subscriptions/ntfy-setup ───────────────────────────────

/**
 * Fetch the current user's ntfy setup state from the backend.
 * Returns { isSetUp: false } if the user has not provisioned ntfy yet.
 */
export async function getNtfySetup(): Promise<NtfySetup> {
  try {
    const response = await authApi.get("/push-subscriptions/ntfy-setup");
    return response.data as NtfySetup;
  } catch (error) {
    handleApiError(error, "get ntfy setup");
  }
}

// ─── API-02: POST /push-subscriptions/ntfy-setup ─────────────────────────────

/**
 * Provision ntfy credentials for the current user (idempotent).
 * Backend creates the push_subscriptions row if it does not exist,
 * or returns the existing values if it does.
 */
export async function postNtfySetup(): Promise<NtfySetup> {
  try {
    const response = await authApi.post("/push-subscriptions/ntfy-setup");
    return response.data as NtfySetup;
  } catch (error) {
    handleApiError(error, "post ntfy setup");
  }
}

// ─── API-03: POST /push-subscriptions/ntfy-test ──────────────────────────────

/**
 * Send a test notification to the current user's ntfy topic.
 * Returns { ok: true } if the publish succeeded, { ok: false, error: string }
 * on failure.
 */
export async function postNtfyTest(): Promise<NtfyTestResult> {
  try {
    const response = await authApi.post("/push-subscriptions/ntfy-test");
    return response.data as NtfyTestResult;
  } catch (error) {
    handleApiError(error, "post ntfy test");
  }
}

// ─── API-04: POST /push-subscriptions/ntfy-regenerate ────────────────────────

/**
 * Rotate the current user's ntfy password.
 * Old password is invalidated server-side immediately (hard rotation,
 * no overlap window). Returns the new setup shape with the new
 * ntfyPassword value.
 */
export async function postNtfyRegenerate(): Promise<NtfySetup> {
  try {
    const response = await authApi.post("/push-subscriptions/ntfy-regenerate");
    return response.data as NtfySetup;
  } catch (error) {
    handleApiError(error, "post ntfy regenerate");
  }
}

// ─── API-05: DELETE /push-subscriptions/ntfy-setup ───────────────────────────

/**
 * Remove the current user's ntfy setup entirely.
 * Returns { ok: true } on success.
 */
export async function deleteNtfySetup(): Promise<{ ok: true }> {
  try {
    const response = await authApi.delete("/push-subscriptions/ntfy-setup");
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "ntfy setup delete");
  }
}
