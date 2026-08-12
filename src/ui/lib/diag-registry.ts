/**
 * Bounty pretty-view-per-pane-cost-diag (2026-08-08).
 *
 * Singleton registry of mounted per-pane snapshot fns. Terminal + PrettyView
 * each call registerPane on mount and return-cleanup unregister on unmount.
 * The diag emitter walks the registry every 30s and console.logs one
 * envelope; the console-forwarder ships it to the backend log where tina
 * greps for [render] tick (Phase 31 D-13 canonical prefix; was [DIAG-REPORT]).
 *
 * Removable in one commit once mitigation shape is chosen — delete this
 * file, delete diag-emitter.ts, unwire the two registerPane effects.
 */

export type PaneKind = "terminal" | "pretty-view";

export type PaneSnapshot = {
  kind: PaneKind;
  paneId: string;
  hostId: number | null;
  tmuxSession: string | null;
  // Terminal knows its own visibility via the isVisible prop. PrettyView
  // is mounted inside Terminal but doesn't consume the signal — its
  // snapshot leaves this null and tina correlates via (hostId, tmuxSession)
  // when reading the log.
  isVisible: boolean | null;
  // PrettyView only — current React state count.
  messageCount?: number;
  // PrettyView only — Claude session WS frames since last snapshot.
  // Snapshot fn is expected to RESET the counter after reading so the
  // next interval measures fresh.
  wsFramesSinceLast?: number;
  // Terminal only — SSH WS bytes received since last snapshot. Same
  // read-and-reset semantics as wsFramesSinceLast.
  wsBytesSinceLast?: number;
  // Terminal only — xterm.js buffer scrollback line count. Proxy for
  // terminal memory footprint.
  scrollbackLines?: number;
  // Rough DOM weight — el.querySelectorAll('*').length under the pane's
  // container ref. Cheap enough at 30s cadence.
  domNodeCount?: number;
};

export type SnapshotFn = () => PaneSnapshot;

const registry = new Map<string, SnapshotFn>();

/**
 * Register a pane's snapshot fn. Returns an unregister fn that ONLY
 * removes the entry if the current registered fn is still the one we
 * added — this guards against a race where a fresh mount registers a
 * new fn before the previous mount's cleanup runs.
 */
export function registerPane(key: string, fn: SnapshotFn): () => void {
  console.info(`[render] pane-register paneId=${key}`);
  registry.set(key, fn);
  return () => {
    if (registry.get(key) === fn) {
      console.info(`[render] pane-unregister paneId=${key}`);
      registry.delete(key);
    }
  };
}

/**
 * Walk the registry and collect one snapshot per pane. A snapshot fn
 * that throws is skipped (best-effort — a broken snapshot must not kill
 * the whole diag emit).
 */
export function collectSnapshots(): PaneSnapshot[] {
  const out: PaneSnapshot[] = [];
  for (const fn of registry.values()) {
    try {
      out.push(fn());
    } catch {
      // best-effort — swallow and continue
    }
  }
  return out;
}

// --- test-only surfaces ---
/** @internal test-only */
export function __test_clear(): void {
  registry.clear();
}
/** @internal test-only */
export function __test_size(): number {
  return registry.size;
}
