// ─── Reload-loop sentinel (Phase 111 Plan 02, Pitfall 4 defense) ─────────────
//
// SessionStorage-backed counter that tracks reload attempts in a 60-second
// sliding window. Defends against RESEARCH.md §Pitfall 4 — if the server
// tag reads stale relative to the code it serves (env drift, image tag
// mismatch), every fresh client after redeploy would see server_build ≠
// client_build; the user would click Reload; the same stale server would
// serve them; loop.
//
// Contract:
//   - recordReloadAttempt(): append `Date.now()` to the sessionStorage-
//     persisted history, filter out entries older than 60s.
//   - shouldSuppressReload(): return `true` if MORE THAN 3 attempts remain
//     within the 60s window (i.e. the 4th attempt trips it).
//   - Fail-open on any exception (JSON parse, quota exceeded, sessionStorage
//     disabled by browser policy) — we do not add a second failure mode on
//     top of the first.
//
// Storage:
//   Key: "skynet_skew_reload_history"
//   Value: JSON.stringify(number[]) — an array of epoch-ms timestamps.
//
// Per-tab isolation: sessionStorage is per-tab-per-origin. Multi-tab reload
// sprees don't cross-contaminate — each tab has its own counter, matching
// D-17 (independent tabs, no cross-tab coordination).

const STORAGE_KEY = "skynet_skew_reload_history";
const WINDOW_MS = 60_000; // 60-second sliding window
const THRESHOLD = 3; // suppress when `count > THRESHOLD` — i.e. the 4th trips it

// ─── Internal helpers ────────────────────────────────────────────────────────

function readHistory(): number[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Filter to numeric entries only (defensive against tampering / partial writes).
    return parsed.filter((v): v is number => typeof v === "number");
  } catch {
    // Fail-open: parse error, sessionStorage disabled, etc.
    return [];
  }
}

function pruneToWindow(history: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  return history.filter((ts) => ts >= cutoff);
}

function writeHistory(history: number[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Fail-open: quota exceeded, sessionStorage disabled, etc.
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a reload attempt. Appends `Date.now()` to the persisted history and
 * prunes entries older than 60 seconds. Silently no-ops on any sessionStorage
 * exception (fail-open — don't compound a browser-storage failure on top of
 * whatever is already going wrong).
 */
export function recordReloadAttempt(): void {
  const now = Date.now();
  const pruned = pruneToWindow(readHistory(), now);
  pruned.push(now);
  writeHistory(pruned);
}

/**
 * Return `true` when more than 3 reload attempts have occurred within the
 * last 60 seconds (i.e. the 4th attempt is the trigger). Fail-open: returns
 * `false` on any sessionStorage exception.
 */
export function shouldSuppressReload(): boolean {
  try {
    const now = Date.now();
    const pruned = pruneToWindow(readHistory(), now);
    return pruned.length > THRESHOLD;
  } catch {
    return false;
  }
}
