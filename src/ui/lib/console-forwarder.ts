/**
 * Patch #146: frontend console-forwarder.
 *
 * Intercepts console.log/warn/error calls after main.tsx boot, preserving
 * the original method behavior (DevTools console still fires) while also
 * batching entries to POST /debug/console-log every 500ms or when 20
 * entries accumulate.
 *
 * On iOS PWA tab-close (visibilitychange/pagehide), issues a final flush
 * via navigator.sendBeacon so in-flight logs are delivered.
 *
 * Phase 31 Plan 01 extension: the LogEntry envelope now carries optional
 * hostId/sessionKey fields (already accepted server-side by debug.ts).
 * Call setLogContext({ hostId, sessionKey }) once hostId is known (e.g.
 * from AppShell's active tab). Fields are OMITTED from the JSON when not
 * set, preserving wire-format compat with debug.ts's `"hostId" in e` guard.
 *
 * This module is intentionally side-effect-free until initConsoleForwarder()
 * is called. Call it once at the top of main.tsx, before snapshotPendingTab().
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
const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 500;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
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

function flushFetch(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const entries = buffer.splice(0);
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
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;

  const entries = buffer.splice(0);
  const blob = new Blob([JSON.stringify({ entries })], {
    type: "application/json",
  });
  // sendBeacon rides same-origin auth cookies automatically
  const ok = navigator.sendBeacon?.("/debug/console-log", blob) ?? false;
  if (!ok) {
    // entries are already lost to the tab close per the constraint
  }
}

// --- enqueue ---

function enqueue(level: LogLevel, args: unknown[]): void {
  buffer.push({
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
  });

  if (buffer.length >= MAX_BATCH) {
    flushFetch();
  } else if (flushTimer === null) {
    flushTimer = setTimeout(flushFetch, FLUSH_INTERVAL_MS);
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

    if (buffer.length >= MAX_BATCH) {
      flushFetch();
    } else if (flushTimer === null) {
      flushTimer = setTimeout(flushFetch, FLUSH_INTERVAL_MS);
    }
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
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  initialized = false;
  currentContext = {};
}
