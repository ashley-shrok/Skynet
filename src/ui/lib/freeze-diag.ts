/**
 * freeze-diag — periodic heartbeat that ships browser-side resource
 * indicators to the console-forward log so we can post-mortem the "page
 * unresponsive" freezes the user reports intermittently after the modal
 * arc (2026-09-30 UAT).
 *
 * Every FREEZE_DIAG_INTERVAL_MS the module emits one console.info line
 * tagged `[freeze-diag]` with:
 *   - ws: live-socket count from claude-session-api.getOpenClaudeSessionSocketCount()
 *   - heapMB: performance.memory.usedJSHeapSize / 2^20 (Chrome only; NaN elsewhere)
 *   - nodes: document.querySelectorAll("*").length — DOM node count
 *   - modals: per-modal open-count map, bumped by bumpModalOpen() from mount effects
 *
 * The console-forwarder batches these to /opt/skynet/console-forward-logs/
 * so the last ~5s pre-freeze is on disk even when the tab locks solid.
 * When the user hits a freeze, grep the log around the wall-clock time —
 * a WS count climbing without a matching decrement is the WS-leak
 * signature; a heap climbing unboundedly is a JS-leak signature; a
 * DOM-node count climbing unboundedly is a mount-leak signature.
 *
 * Zero user-visible effect. Small, self-contained; remove once the
 * freeze cause is identified.
 */

import { getOpenClaudeSessionSocketCount } from "@/api/claude-session-api";

const FREEZE_DIAG_INTERVAL_MS = 5000;

const modalOpenCounts: Record<string, number> = {};

/** Bump the open-count for a modal by name. Call from a useEffect that
 *  fires when the modal transitions from closed→open. */
export function bumpModalOpen(name: string): void {
  modalOpenCounts[name] = (modalOpenCounts[name] ?? 0) + 1;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Start the freeze-diag heartbeat. Idempotent — a second call is a no-op. */
export function startFreezeDiag(): void {
  if (intervalHandle !== null) return;
  intervalHandle = setInterval(emit, FREEZE_DIAG_INTERVAL_MS);
}

function emit(): void {
  const ws = getOpenClaudeSessionSocketCount();
  const heapMB = readHeapMB();
  const nodes = readNodeCount();
  const modals = { ...modalOpenCounts };
  // Single-line, structured — easy to grep with `grep '\[freeze-diag\]'`
  // and easy to eyeball as JSON if we ever want to chart it.
  // eslint-disable-next-line no-console
  console.info(
    "[freeze-diag]",
    JSON.stringify({ ws, heapMB, nodes, modals }),
  );
}

function readHeapMB(): number {
  // performance.memory is Chrome-only + only exposed on some origins.
  // Falls back to NaN when unavailable so the line still emits.
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  const bytes = perf.memory?.usedJSHeapSize;
  if (typeof bytes !== "number") return NaN;
  return Math.round(bytes / (1024 * 1024));
}

function readNodeCount(): number {
  try {
    return document.querySelectorAll("*").length;
  } catch {
    return -1;
  }
}
