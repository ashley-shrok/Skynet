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
 * 2026-10-01: added Web Worker heartbeat. The main-thread heartbeat above
 * is useless when the renderer wedges in JS — console calls queue but the
 * forwarder's flush timer never fires. A Worker runs in a separate thread,
 * pings the main thread every 500ms, and when pongs stop for 2s+ posts
 * freeze-onset + last-known interaction state DIRECTLY to the forwarder
 * endpoint, bypassing the wedged main thread. The backend skew-lock
 * middleware's D-06 fail-open rule accepts header-less Worker requests.
 * Grep `[freeze-diag-worker]` to find onset / recovery lines.
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
  startFreezeDiagWorker();
}

// --- Web Worker heartbeat ----------------------------------------------------

const WORKER_PING_INTERVAL_MS = 500;
const FREEZE_THRESHOLD_MS = 2000;

// Worker source as a template string. Built with placeholders so the
// Worker code stays plain JS (no TS types inside the string, no imports).
// All `fetch` calls run on the Worker's own thread — main-thread wedge
// has zero effect on this path.
const workerSource = `
let lastPongAt = Date.now();
let lastState = null;
let frozen = false;
let freezeOnsetAt = null;
let seq = 0;

function post(msg) {
  const entry = {
    ts: new Date().toISOString(),
    level: "warn",
    tabId: "no-tab",
    msg: msg,
  };
  fetch("/debug/console-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ entries: [entry] }),
  }).catch(function () {});
}

setInterval(function () {
  self.postMessage({ type: "ping", seq: seq++ });
  const sinceLast = Date.now() - lastPongAt;
  if (!frozen && sinceLast >= __THRESHOLD__) {
    frozen = true;
    freezeOnsetAt = lastPongAt;
    post("[freeze-diag-worker] FROZEN onset=" + new Date(freezeOnsetAt).toISOString() +
      " lastState=" + JSON.stringify(lastState));
  } else if (frozen) {
    post("[freeze-diag-worker] still-frozen durationMs=" + sinceLast);
  }
}, __PING_INTERVAL__);

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "pong") {
    const now = Date.now();
    if (frozen) {
      post("[freeze-diag-worker] RECOVERED durationMs=" + (now - freezeOnsetAt) +
        " lastState=" + JSON.stringify(lastState));
      frozen = false;
      freezeOnsetAt = null;
    }
    lastPongAt = now;
    lastState = e.data.state;
  }
});
`
  .replace("__PING_INTERVAL__", String(WORKER_PING_INTERVAL_MS))
  .replace("__THRESHOLD__", String(FREEZE_THRESHOLD_MS));

let worker: Worker | null = null;
let lastClickTarget = "none";
let pointerListenerAttached = false;

function attachPointerListener(): void {
  if (pointerListenerAttached) return;
  pointerListenerAttached = true;
  // Captures last pointerdown target so the Worker's freeze-onset report
  // names what the user clicked immediately before the wedge. Capture
  // phase + passive so it never interferes with normal event dispatch.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as Element | null;
      if (!t) {
        lastClickTarget = "null";
        return;
      }
      const tag = t.tagName?.toLowerCase() ?? "?";
      const id = t.id ? "#" + t.id : "";
      // SVG elements expose className as SVGAnimatedString, not string —
      // guard before touching .split().
      const rawClass = typeof t.className === "string" ? t.className : "";
      const cls = rawClass ? "." + rawClass.split(/\s+/)[0] : "";
      lastClickTarget = `${tag}${id}${cls}@${Date.now()}`;
    },
    { capture: true, passive: true },
  );
}

function startFreezeDiagWorker(): void {
  if (worker !== null) return;
  if (typeof Worker === "undefined") return;
  attachPointerListener();
  try {
    const blob = new Blob([workerSource], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    worker.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string } | null;
      if (data?.type === "ping") {
        worker?.postMessage({
          type: "pong",
          state: {
            lastClick: lastClickTarget,
            url:
              typeof location !== "undefined"
                ? location.pathname + location.search
                : "?",
            nodes: readNodeCount(),
            heapMB: readHeapMB(),
            modals: { ...modalOpenCounts },
            bodyPE: readBodyPointerEvents(),
          },
        });
      }
    });
  } catch {
    worker = null;
  }
}

function emit(): void {
  const ws = getOpenClaudeSessionSocketCount();
  const heapMB = readHeapMB();
  const nodes = readNodeCount();
  const modals = { ...modalOpenCounts };
  // bodyPE: document.body.style.pointerEvents snapshot — the direct Radix
  // body-lock-leak detector. Normal value is "" (empty = inherit = auto);
  // a stuck "none" during a user-reported click-dead state is the smoking
  // gun for the Radix DropdownMenu modal-close-cleanup race (candidate
  // from the 2026-10-01 code dive on Phase 143's RowKebabMenu rollout).
  const bodyPE = readBodyPointerEvents();
  // Single-line, structured — easy to grep with `grep '\[freeze-diag\]'`
  // and easy to eyeball as JSON if we ever want to chart it.
  // eslint-disable-next-line no-console
  console.info(
    "[freeze-diag]",
    JSON.stringify({ ws, heapMB, nodes, modals, bodyPE }),
  );
}

function readBodyPointerEvents(): string {
  try {
    return document.body.style.pointerEvents;
  } catch {
    return "?";
  }
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
