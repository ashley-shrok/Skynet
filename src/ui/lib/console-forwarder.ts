/**
 * Frontend console-forwarder.
 *
 * Intercepts console.log/warn/error after main.tsx boot, preserves DevTools
 * console behavior, and forwards entries to POST /debug/console-log on a
 * fixed 500ms interval — steady cadence, no per-burst immediate-flush trigger
 * (the immediate-flush-at-N pattern was the root cause of the Phase 31 WS
 * regression: a per-tick burst of forwarded logs from Terminal.tsx tripped
 * the threshold, single POST hit auth middleware alongside the WS handshake
 * request, backend stalled).
 *
 * Cadence + caps:
 *   - Interval: FLUSH_INTERVAL_MS (500ms), started once in initConsoleForwarder.
 *     Empty-buffer ticks are cheap no-ops.
 *   - Per-flush cap: MAX_ENTRIES_PER_FLUSH (100). Excess stays in buffer,
 *     drains on the next tick.
 *   - Buffer ceiling: MAX_BUFFER_SIZE (500). Overflow entries are DROPPED
 *     (a counter is maintained and reported).
 *   - Truncation indicator: any flush that hits the cap or that had dropped
 *     entries since the last flush appends a synthetic warn-level entry
 *     naming both counts, so the sink can see it.
 *
 * On iOS PWA tab-close (visibilitychange/pagehide), issues a final flush
 * via navigator.sendBeacon so in-flight logs are delivered. Beacon flush
 * uses the same per-flush cap + truncation indicator.
 *
 * The LogEntry envelope carries optional hostId/sessionKey. Call
 * setLogContext({ hostId, sessionKey }) once hostId is known. Fields are
 * OMITTED from JSON when not set (preserves debug.ts's `"hostId" in e` guard).
 *
 * Side-effect-free until initConsoleForwarder() is called. Call once at the
 * top of main.tsx before snapshotPendingTab().
 */

// --- types ---

type LogLevel = "log" | "warn" | "error";

type LogEntry = {
  ts: string;
  level: LogLevel;
  tabId: string;
  hostId?: number;
  sessionKey?: string;
  msg: string;
};

/** Context fields threaded into every LogEntry when set via setLogContext(). */
export type LogContext = {
  hostId?: number;
  sessionKey?: string;
};

// --- module-scoped state ---

const buffer: LogEntry[] = [];
const FLUSH_INTERVAL_MS = 500;
const MAX_ENTRIES_PER_FLUSH = 100;
const MAX_BUFFER_SIZE = 500;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let droppedSinceLastFlush = 0;
let initialized = false;
let currentContext: LogContext = {};

// --- log context API ---

/**
 * Sets the per-tab log context fields threaded into every subsequent LogEntry.
 * Pass an empty object `{}` to clear (no hostId/sessionKey in future entries).
 *
 * Caller MUST pass numeric hostId and opaque sessionKey only.
 * Sensitive fields (SSH keys, passwords, JWT bodies) MUST NEVER be logged.
 */
export function setLogContext(ctx: LogContext): void {
  currentContext = { ...ctx };
}

// --- helpers ---

// TODO: wire from AppShell active tab in follow-up patch
function getTabId(): string {
  return "no-tab";
}

function serializeArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) {
    return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
  }
  if (typeof a === "object" && a !== null) {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

// --- flush paths ---

/**
 * Take up to MAX_ENTRIES_PER_FLUSH entries from the front of the buffer.
 * If the buffer had more, or if entries were dropped since the last flush,
 * append a synthetic warn-level indicator so the sink learns about it.
 * Returns the entries to send (may be empty).
 */
function takeFlushSlice(): LogEntry[] {
  const deferred = Math.max(0, buffer.length - MAX_ENTRIES_PER_FLUSH);
  const entries = buffer.splice(0, MAX_ENTRIES_PER_FLUSH);
  if (deferred > 0 || droppedSinceLastFlush > 0) {
    entries.push({
      ts: new Date().toISOString(),
      level: "warn",
      tabId: getTabId(),
      ...(currentContext.hostId !== undefined
        ? { hostId: currentContext.hostId }
        : {}),
      ...(currentContext.sessionKey !== undefined
        ? { sessionKey: currentContext.sessionKey }
        : {}),
      msg: `[console-forwarder] flush truncated: sent=${entries.length} deferred=${deferred} dropped=${droppedSinceLastFlush} (reduce log volume)`,
    });
    droppedSinceLastFlush = 0;
  }
  return entries;
}

function flushFetch(): void {
  if (buffer.length === 0 && droppedSinceLastFlush === 0) return;

  const entries = takeFlushSlice();
  fetch("/debug/console-log", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  }).catch(() => {
    // swallow — best-effort, don't re-enqueue on failure or we loop forever
    // on a broken endpoint
  });
}

function flushBeacon(): void {
  if (buffer.length === 0 && droppedSinceLastFlush === 0) return;

  const entries = takeFlushSlice();
  const blob = new Blob([JSON.stringify({ entries })], {
    type: "application/json",
  });
  // sendBeacon rides same-origin auth cookies automatically
  const ok = navigator.sendBeacon?.("/debug/console-log", blob) ?? false;
  if (!ok) {
    // entries are already lost to the tab close per the constraint
  }
}

// --- init ---

export type ConsoleForwarderOptions = {
  /**
   * @internal test-only — called with each enqueued entry immediately
   * after it is pushed into the buffer. Used by tests to inspect buffered
   * state without relying on timers or fetch.
   */
  onEnqueue?: (entry: LogEntry) => void;
};

export function initConsoleForwarder(
  options: ConsoleForwarderOptions = {},
): void {
  if (initialized) return;
  initialized = true;

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const { onEnqueue } = options;

  function enqueueWithCallback(level: LogLevel, args: unknown[]): void {
    if (buffer.length >= MAX_BUFFER_SIZE) {
      droppedSinceLastFlush++;
      return;
    }
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      tabId: getTabId(),
      ...(currentContext.hostId !== undefined
        ? { hostId: currentContext.hostId }
        : {}),
      ...(currentContext.sessionKey !== undefined
        ? { sessionKey: currentContext.sessionKey }
        : {}),
      msg: args.map(serializeArg).join(" "),
    };
    buffer.push(entry);
    onEnqueue?.(entry);
  }

  console.log = (...args: unknown[]) => {
    origLog(...args);
    enqueueWithCallback("log", args);
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    enqueueWithCallback("warn", args);
  };

  console.error = (...args: unknown[]) => {
    origError(...args);
    enqueueWithCallback("error", args);
  };

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });
  window.addEventListener("pagehide", flushBeacon);

  intervalTimer = setInterval(flushFetch, FLUSH_INTERVAL_MS);
}

/** @internal test-only — returns a shallow copy of the current buffer */
export function __test_getBuffer(): LogEntry[] {
  return [...buffer];
}

/** @internal test-only — returns the current log context */
export function __test_getContext(): LogContext {
  return { ...currentContext };
}

/** @internal test-only — resets module state between tests */
export function __test_reset(): void {
  buffer.splice(0);
  if (intervalTimer !== null) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  droppedSinceLastFlush = 0;
  initialized = false;
  currentContext = {};
}
