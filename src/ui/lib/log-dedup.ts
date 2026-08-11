/**
 * Phase 31 Plan 01: frontend log-dedup rate-limiter.
 *
 * Implements the D-17 syslog "×N in Xs" collapse pattern for hot-path
 * frontend log lines. Hot paths (visibility flap, scroll, per-render
 * effects, DIAG-REPORT ticks) opt in by calling `shouldEmit(key, buildMsg)`;
 * genuinely-per-event lines ([ws] close, [tts] play-attempt) stay
 * opt-OUT so each individual event is preserved in the log.
 *
 * Usage:
 *   const dedup = createLogDedup({ N: 3, W: 5000 });
 *   if (dedup.shouldEmit(key, () => `[pwa] visibility-change state=${s}`).emit) {
 *     console.info(`[pwa] visibility-change state=${s}`);
 *   }
 *   // On visibilitychange→hidden: flush summaries for closed windows
 *   for (const summary of dedup.flush()) console.info(summary);
 *
 * Conceptual precedent: src/backend/utils/logger.ts:180-204 (shouldLog
 * rate-limit), which silently drops; this module emits "×N in Xs" summaries
 * at window-close instead of dropping silently.
 */

// --- D-13 canonical subsystem prefix taxonomy ---
// Frontend-facing + backend-side prefixes in a single authoritative list.
// Downstream plans can import this const to grep-verify their prefix usage.

export const SUBSYSTEM_PREFIXES = [
  "ws",
  "ws-msg",
  "pause-gate",
  "reopen",
  "session",
  "tts",
  "voice",
  "pwa",
  "compose",
  "tap",
  "render",
  "pane-state",
  "auth",
  "host-db",
  "relay",
  "fs",
  "ws-server",
  "session-server",
  "pane-state-emitter",
  "voice-server",
  "tmux-helper",
  "session-parser",
] as const;

// --- types ---

export type DedupConfig = {
  /** Max emissions before suppression kicks in within the current window. */
  N: number;
  /** Window size in milliseconds. */
  W: number;
  /** Injectable clock — defaults to Date.now. Override in tests for determinism. */
  now?: () => number;
};

export type DedupResult = {
  emit: boolean;
  /** Number of times this key was suppressed so far in the current window. */
  suppressed?: number;
};

// --- internal state shape ---

type WindowEntry = {
  count: number;
  windowStartMs: number;
  lastMsg?: string;
};

// --- factory ---

/**
 * Creates a per-subsystem log dedup instance.
 *
 * Defaults: N=3, W=5000ms.  All callers share the same Map internally
 * so keys must be globally unique within the instance
 * (recommended format: `${subsystem}:${event}:${hash-of-fields}`).
 */
export function createLogDedup(config?: Partial<DedupConfig>): {
  shouldEmit(key: string, buildMsg?: () => string): DedupResult;
  flush(): string[];
  reset(): void;
} {
  const N = config?.N ?? 3;
  const W = config?.W ?? 5000;
  const now = config?.now ?? (() => Date.now());

  const state = new Map<string, WindowEntry>();

  function shouldEmit(key: string, buildMsg?: () => string): DedupResult {
    const ts = now();
    const existing = state.get(key);

    if (!existing || ts - existing.windowStartMs >= W) {
      // No prior window or window is stale — open a fresh window.
      state.set(key, { count: 1, windowStartMs: ts });
      return { emit: true };
    }

    // Inside existing window
    existing.count++;

    if (existing.count <= N) {
      return { emit: true };
    }

    // Suppressed — store last message for the summary line.
    const suppressed = existing.count - N;
    existing.lastMsg = buildMsg?.() ?? key;
    return { emit: false, suppressed };
  }

  function flush(): string[] {
    const ts = now();
    const summaries: string[] = [];

    for (const [key, entry] of state.entries()) {
      const suppressed = entry.count - N;
      if (suppressed <= 0) {
        // Window may still be open but nothing was suppressed — evict if stale.
        if (ts - entry.windowStartMs >= W) {
          state.delete(key);
        }
        continue;
      }

      // Has suppressed occurrences — emit summary regardless of whether
      // the window is still open (explicit flush clears all pending).
      const windowAgeMs = ts - entry.windowStartMs;
      const ageSeconds = Math.round(windowAgeMs / 1000);
      const baseMsg = entry.lastMsg ?? key;
      summaries.push(`${baseMsg} ×${suppressed} in ${ageSeconds}s`);
      state.delete(key);
    }

    return summaries;
  }

  function reset(): void {
    state.clear();
  }

  return { shouldEmit, flush, reset };
}
