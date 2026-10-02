// User-scoped localStorage cache helpers.
//
// Wraps a payload with the current logged-in username so a cache written by
// user A cannot be read by user B. On owner-mismatch or legacy un-tagged
// payload, read returns null AND removes the key so the next writer starts
// clean. Covers both explicit logout and auth-expiry: the check runs on
// every read, regardless of how the previous session ended.
//
// Current user is read from localStorage["skynet_auth"] — written by
// storeAuth() on successful login (src/ui/auth/Auth.tsx:106) and cleared by
// clearStoredAuth() on logout (src/ui/auth/Auth.tsx:102). By the time any
// cache seed runs, skynet_auth already reflects the newly-logged-in user
// (Auth.tsx fires storeAuth before the phase flip that mounts AppShell).
//
// Helper deliberately parses skynet_auth as its canonical JSON shape
// {loggedIn, username}. Does NOT fall back to the raw string: there is no
// production path that writes the legacy format, and accepting both widens
// the trust surface.

const AUTH_KEY = "skynet_auth";

type OwnerTaggedPayload<T> = { owner: string; payload: T };

export function getCurrentUser(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const u = parsed.username;
    return typeof u === "string" && u.length > 0 ? u : null;
  } catch {
    return null;
  }
}

// Read a user-scoped cache. Returns null when:
//   • localStorage unavailable
//   • no logged-in user
//   • key empty
//   • payload malformed, missing owner, or owner !== current user
// On any of the mismatch cases, the key is removed so a future same-user
// write starts clean. Pass legacyKeys to drop pre-owner-tag versions of the
// same cache on first read of the new key (hygiene post-deploy).
export function readUserScopedCache<T>(
  key: string,
  legacyKeys: string[] = [],
): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    for (const legacy of legacyKeys) {
      try { localStorage.removeItem(legacy); } catch { /* ignore */ }
    }
    const user = getCurrentUser();
    if (!user) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OwnerTaggedPayload<T> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.owner !== "string" ||
      parsed.owner !== user
    ) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    return parsed.payload;
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

// Write a user-scoped cache. No-op when no logged-in user — writes without
// an owner can only cause confusion downstream.
export function writeUserScopedCache<T>(key: string, payload: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    const user = getCurrentUser();
    if (!user) return;
    const wrapper: OwnerTaggedPayload<T> = { owner: user, payload };
    localStorage.setItem(key, JSON.stringify(wrapper));
  } catch {
    // Silent — cache-write failure is non-fatal.
  }
}

export function clearUserScopedCache(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // Silent
  }
}

// Returns true iff a user-scoped payload exists AND belongs to the current
// user. Does NOT remove the key on mismatch (callers that want that use
// readUserScopedCache). Useful for "is my cache warm?" checks that must
// not have side effects.
export function hasUserScopedCache(key: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const user = getCurrentUser();
    if (!user) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as OwnerTaggedPayload<unknown> | null;
    return !!parsed && typeof parsed === "object" && parsed.owner === user;
  } catch {
    return false;
  }
}
