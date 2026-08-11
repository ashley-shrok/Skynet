/**
 * Bounty pretty-view-per-pane-cost-diag (2026-08-08).
 *
 * Interval emitter that walks the diag registry and console.logs one
 * [render] tick envelope (Phase 31 D-13 canonical prefix; previously
 * [render]). The existing console-forwarder (patch #146) batches to
 * POST /debug/console-log; backend appends to
 * /var/log/skynet/console-forward/console-forward.log which is bind-
 * mounted to /opt/skynet/console-forward-logs/ on the host. tina reads:
 *   sudo cat /opt/skynet/console-forward-logs/console-forward.log \
 *     | grep '\[render\] tick' | tail | jq -r '.msg'
 *
 * Kicked off once from main.tsx right after initConsoleForwarder().
 */

import { collectSnapshots, type PaneSnapshot } from "./diag-registry";

const DEFAULT_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

type ChromeMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

export type DiagEnvelope = {
  ts: string;
  panes: PaneSnapshot[];
  mountedPaneCount: number;
  // Chrome/Chromium only — Safari does not expose performance.memory
  // (privacy). null on iOS PWA is expected.
  heap: {
    used: number;
    total: number;
    limit: number;
  } | null;
  ua: string;
};

export function startDiagEmitter(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (timer !== null) return;
  timer = setInterval(() => emitOnce(), intervalMs);
}

export function stopDiagEmitter(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function emitOnce(): void {
  try {
    const panes = collectSnapshots();
    const mem = (performance as unknown as { memory?: ChromeMemory }).memory;
    const envelope: DiagEnvelope = {
      ts: new Date().toISOString(),
      panes,
      mountedPaneCount: panes.length,
      heap: mem
        ? {
            used: mem.usedJSHeapSize,
            total: mem.totalJSHeapSize,
            limit: mem.jsHeapSizeLimit,
          }
        : null,
      ua: navigator.userAgent.slice(0, 160),
    };
    console.log("[render] tick", JSON.stringify(envelope));
  } catch (err) {
    // The diag must not break the app; log with warn so tina can find
    // the emitter fault by grepping [render] in the log too.
    console.warn(
      `[render] tick-failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
