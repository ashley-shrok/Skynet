# Phase 35: pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow — Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 6 (3 modified, 1 created, 2 test files extended)
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/backend/claude-session/claude-session-server.ts` | service | event-driven (WS handler) | Same file — `raw_keystrokes` handler at :4015 + `wake` handler at :4063 | exact |
| `src/ui/features/pretty-view/PrettyView.tsx` | component | event-driven (WS send) | Same file — `handleWake` at :541, `handlePlanApprove` at :564, `handlePlanFeedback` at :574, `handleAsideDismiss` at :514 | exact |
| `src/ui/features/terminal/Terminal.tsx` | component | request-response | Same file — `handleInjectedTurnReady` at :3208, `onSend` at :3261, `onInterrupt` at :3300, `MessageQueueDrawer.onSend` at :3331 | exact (swap-in-place) |
| `src/backend/claude-session/claude-session-server.compose-send.test.ts` | test | — | `src/backend/claude-session/dormant-poll.test.ts` (wake seam pattern) + `src/backend/claude-session/claude-session-server.aside.test.ts` (timing gate pattern) | role-match |
| `src/ui/features/pretty-view/PrettyView.*.test.tsx` (extend existing) | test | — | `src/ui/features/pretty-view/PrettyView.aside.test.tsx` (WS-mock + `ws.send.mock.calls` assertions) | role-match |

---

## Pattern Assignments

### `src/backend/claude-session/claude-session-server.ts` — new `input` + `interrupt` handlers

**Analog:** Same file, `raw_keystrokes` handler at lines 4015–4054 + `wake` handler at lines 4063–4084.

**Insertion point:** Between the `raw_keystrokes` `return;` at line 4054 and the `wake` check at line 4063. The two new "write into the pane" handlers sit adjacent to `raw_keystrokes`.

**raw_keystrokes handler — core pattern to mirror** (lines 4015–4054):
```typescript
if (msg.type === "raw_keystrokes") {
  if (!sshConn || !currentTmuxSession) return;
  const bytes = String((msg as { bytes?: unknown }).bytes ?? "");
  if (bytes.length === 0) return;
  const MAX_RAW_KEYSTROKES_BYTES = 16 * 1024;
  if (bytes.length > MAX_RAW_KEYSTROKES_BYTES) {
    sshLogger.warn("raw_keystrokes rejected: payload too large", {
      operation: "raw_keystrokes_reject_size",
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      bytesLength: bytes.length,
      maxBytes: MAX_RAW_KEYSTROKES_BYTES,
    });
    return;
  }
  try {
    await execCommand(
      sshConn,
      `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`,
    );
  } catch (err) {
    sshLogger.warn("raw_keystrokes send failed", {
      operation: "raw_keystrokes_send_error",
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      bytesLength: bytes.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return;
}
```

**Trust boundary comment to copy verbatim** (lines 4010–4014):
```typescript
// Trust boundary (mirrors aside_dismissed T-14-02-01): the send target
// is derived from the connection's captured currentTmuxSession (set on
// connectToPane discovery success). We IGNORE any client-supplied
// hostId/tmuxSession in the payload — a client cannot spoof a raw
// keystroke into a pane it doesn't own.
```

**wake handler — pattern for two-call shape with async/await delay** (lines 4063–4084):
```typescript
if (msg.type === "wake") {
  let lastWakeOk = false;
  await __applyWakeMessageForTests({
    sshConn,
    currentTmuxSession,
    isIdentityShapedCached,
    execCommand,
    wsSend: (data: string) => {
      try { ws.send(data); } catch (err) { /* log-and-swallow */ }
    },
  });
  // ...
  return;
}
```

**Split-send timing — validated value from `terminal.ts:842`:**
The split-send body→Enter delay is **250ms** (NOT 50ms). The value lives at `src/backend/ssh/terminal.ts:842`:
```typescript
// terminal.ts:721-842 — the production split-send path (for reference only — do NOT modify)
setTimeout(() => {
  // ... submit via tmux send-keys Enter ...
}, 250);
```
The new backend handler uses the promisified form matching the existing async/await style:
```typescript
await new Promise(resolve => setTimeout(resolve, 250)); // 250ms — matches terminal.ts:842
```

**Constant declaration pattern — mirror `MAX_RAW_KEYSTROKES_BYTES` at line 4025:**
```typescript
// Declare adjacent to MAX_RAW_KEYSTROKES_BYTES at line 4025:
const MAX_INPUT_BYTES = 16 * 1024;
```

**`__applyWakeMessageForTests` exported seam — exact shape to mirror** (lines 1088–1108):
```typescript
export async function __applyWakeMessageForTests(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any | null;
  currentTmuxSession: string | null;
  isIdentityShapedCached: boolean | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
  wsSend: (data: string) => void;
}): Promise<void> {
  const { sshConn, currentTmuxSession, isIdentityShapedCached, execCommand: exec, wsSend } = deps;
  if (!sshConn || currentTmuxSession === null || isIdentityShapedCached !== true) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: "not connected to an identity pane" }));
    return;
  }
  // ...
  try {
    await exec(sshConn, `rm -f ~/.claude/identities/'${wakeEscapedName}'/.dormant`);
    wsSend(JSON.stringify({ type: "wake_result", ok: true }));
  } catch (err) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: err instanceof Error ? err.message : String(err) }));
  }
}
```

The new seams follow this exact shape but without `wsSend` (input/interrupt handlers don't respond on WS) and with `data`/`messageQueueItemId` instead of `isIdentityShapedCached`. See RESEARCH.md Code Examples section for the full proposed `__applyInputMessageForTests` / `__applyInterruptMessageForTests` signatures.

**`shellQuote` reference — defined at line 239, used at line 4039:**
```typescript
// Line 239:
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}`;

// Usage in raw_keystrokes at line 4039:
`tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`
// New input handler mirrors this exactly for body write; for Enter write omit -l:
`tmux send-keys -t ${shellQuote(currentTmuxSession)} Enter`
```

---

### `src/ui/features/pretty-view/PrettyView.tsx` — new `sendInput` / `sendInterrupt` callbacks

**Analog:** Same file — all four existing `wsRef.current`-reading callbacks: `handleAsideDismiss` (:514), `handleWake` (:541), `handlePlanApprove` (:564), `handlePlanFeedback` (:574).

**Guard pattern — identical across all four existing callbacks** (lines 521–534 for `handleAsideDismiss`, lines 542–548 for `handleWake`):
```typescript
const handleWake = useCallback(() => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "wake" }));
  } catch {
    /* swallow — best-effort; ws may be mid-close */
  }
  setWaking(true);
  setWakingStartTs(Date.now());
  setWakeError(null);
}, []);
```

```typescript
const handlePlanApprove = useCallback(() => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "raw_keystrokes", bytes: "1\r" }));
  } catch {
    /* swallow — best-effort; ws may be mid-close */
  }
}, []);
```

```typescript
const handlePlanFeedback = useCallback((feedback: string) => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(
      JSON.stringify({ type: "raw_keystrokes", bytes: `3${feedback}\r` }),
    );
  } catch {
    /* swallow — best-effort; ws may be mid-close */
  }
}, []);
```

**New `sendInput` callback shape** — mirrors the guard posture above but returns `boolean` (matching `onSend`'s signature) and conditionally includes `messageQueueItemId`:
```typescript
// From RESEARCH.md Code Examples — closes over wsRef, reads .current at call time
const sendInput = useCallback((text: string, mqid?: string): boolean => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({
    type: "input",
    data: text,
    ...(mqid ? { messageQueueItemId: mqid } : {}),
  }));
  return true;
}, []); // wsRef is a stable ref — read at call time, not captured
```

**New `sendInterrupt` callback shape** — mirrors `handleWake`'s posture (void return, swallow):
```typescript
const sendInterrupt = useCallback((): void => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "interrupt" }));
  } catch {
    /* swallow — best-effort */
  }
}, []);
```

**`wsRef` declaration — line 639:**
```typescript
const wsRef = useRef<WebSocket | null>(null);
```

**Ref-forwarding registration — no prior art in this codebase (see Gap 8 in RESEARCH.md).** Use `onRegisterSendInput` prop pattern from RESEARCH.md Code Examples:
```typescript
// In PrettyView function body — register callback in a useEffect:
useEffect(() => {
  props.onRegisterSendInput?.(sendInput);
  return () => { props.onUnregisterSendInput?.(); };
}, [sendInput, props.onRegisterSendInput, props.onUnregisterSendInput]);
```

`WebSocket.OPEN` vs `1` — existing callbacks use `WebSocket.OPEN` (lines 522, 543, 566, 576). Use `WebSocket.OPEN` in the new callbacks for consistency. Note: Terminal.tsx's current call sites use the numeric `1` — either is correct; prefer `WebSocket.OPEN` inside PrettyView to match its own existing style.

---

### `src/ui/features/terminal/Terminal.tsx` — swap four call sites

**Analog:** Same file — the four call sites being replaced are their own analogs for the post-migration shape.

**`handleInjectedTurnReady` current form (lines 3208–3223) — read `webSocketRef.current`:**
```typescript
const handleInjectedTurnReady = useCallback(
  (text: string, messageQueueItemId: string) => {
    const ws = webSocketRef.current;
    if (!ws || ws.readyState !== 1) return; // silent noop
    ws.send(JSON.stringify({ type: "input", data: text }));
    setTimeout(() => {
      const ws2 = webSocketRef.current;
      if (ws2 && ws2.readyState === 1) {
        ws2.send(
          JSON.stringify({ type: "input", data: "\r", messageQueueItemId }),
        );
      }
    }, 60);
  },
  [],
);
```

Post-migration: replace `webSocketRef.current` reads with `pvSendInputRef.current?.(...)`. The `deps: []` posture stays unchanged (both refs are React refs, read at call time).

**`onSend` current form (lines 3288–3298) — read `webSocketRef.current`:**
```typescript
const ws = webSocketRef.current;
if (!ws || ws.readyState !== 1) return false;
const mqid = "pv-adhoc-" + crypto.randomUUID();
ws.send(
  JSON.stringify({
    type: "input",
    data: text + "\r",
    messageQueueItemId: mqid,
  }),
);
return true;
```

Post-migration: `const sent = pvSendInputRef.current?.(text + "\r", "pv-adhoc-" + crypto.randomUUID()) ?? false; return sent;`

**`onInterrupt` current form (lines 3308–3310) — read `webSocketRef.current`:**
```typescript
const ws = webSocketRef.current;
if (!ws || ws.readyState !== 1) return;
ws.send(JSON.stringify({ type: "interrupt" }));
```

Post-migration: call `pvSendInterruptRef.current?.()` (or use a separate interrupt registration, or fold into `pvSendInputRef` pattern — planner picks).

**`MessageQueueDrawer.onSend` current form (lines 3331–3352) — read `webSocketRef.current`:**
```typescript
onSend={(text, messageQueueItemId) => {
  const ws = webSocketRef.current;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type: "input", data: text }));
  setTimeout(() => {
    const ws2 = webSocketRef.current;
    if (ws2 && ws2.readyState === 1) {
      const payload: { type: "input"; data: string; messageQueueItemId?: string } = { type: "input", data: "\r" };
      if (messageQueueItemId) payload.messageQueueItemId = messageQueueItemId;
      ws2.send(JSON.stringify(payload));
    }
  }, 60);
  return true;
}}
```

Post-migration: replace both `webSocketRef.current` reads with `pvSendInputRef.current?.(...)`. The two-event body-then-60ms-`\r`+mqid pattern stays; only the WS source changes.

**`pvSendInputRef` declaration shape (no prior art — establish new pattern):**
```typescript
// In Terminal.tsx, near other useRef declarations:
const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null);

// Pass to PrettyView as new props:
<PrettyView
  ...existing props...
  onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}
  onUnregisterSendInput={() => { pvSendInputRef.current = null; }}
/>
```

**`terminalWs` prop at line 3312 — does NOT migrate (stays on `webSocketRef.current`):**
```typescript
terminalWs={webSocketRef.current}  // feeds usePrettyViewUploads — NOT one of the four migrating call sites
```

---

### `src/backend/claude-session/claude-session-server.compose-send.test.ts` — new backend test file

**Analog 1:** `src/backend/claude-session/dormant-poll.test.ts` — wake handler test seam pattern.

**File header + imports pattern** (lines 1–51):
```typescript
/**
 * Phase 35 — pretty-view compose-send migrated to claude-session WS.
 *
 * Unit tests for the new `input` + `interrupt` message handlers exported
 * as test seams from claude-session-server.ts. [describe test plan here]
 *
 * Uses the __applyInputMessageForTests / __applyInterruptMessageForTests
 * seams (same "function seam" pattern as __applyWakeMessageForTests).
 * No real WebSocket server or SSH connection needed.
 */

import { describe, it, expect, vi } from "vitest";
import {
  __applyInputMessageForTests,
  __applyInterruptMessageForTests,
} from "./claude-session-server.js";

const fakeConn = {} as import("ssh2").Client;
```

**Wake test seam call pattern — Test D (null session guard) (lines 186–205):**
```typescript
describe("Test D: wake message with currentTmuxSession null → wake_result error, no execCommand", () => {
  it("responds wake_result ok:false without calling execCommand", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn();

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: null,  // ← no active pane
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).not.toHaveBeenCalled();
  });
});
```

**Wake test seam call pattern — Test E (happy path) (lines 210–232):**
```typescript
describe("Test E: wake message happy path → rm -f execCommand → wake_result ok:true", () => {
  it("invokes rm -f on the sentinel path and responds ok:true", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockResolvedValue("");

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "myagent",
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    expect(emitted.type).toBe("wake_result");
    expect(emitted.ok).toBe(true);
  });
});
```

**Wake test seam call pattern — Test F (error path) (lines 235–255):**
```typescript
describe("Test F: wake message with execCommand throw → wake_result ok:false with error message", () => {
  it("catches execCommand error and responds ok:false with the error message string", async () => {
    const wsSend = vi.fn();
    const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));

    await __applyWakeMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "myagent",
      isIdentityShapedCached: true,
      execCommand: exec,
      wsSend,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(wsSend.mock.calls[0][0]);
    expect(emitted.ok).toBe(false);
    expect(emitted.error).toBe("SSH channel closed");
  });
});
```

**Analog 2:** `src/backend/claude-session/claude-session-server.aside.test.ts` — timing gate pattern with `vi.useFakeTimers()`.

**Module-level vi.mock for execCommand + import-after-mock pattern** (lines 29–34):
```typescript
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// Import the mocked reference AFTER vi.mock so the mock is active.
import { execCommand } from "../ssh/tmux-helper.js";
```

**Timing gate test — `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` pattern** (lines 376–403):
```typescript
it("Test 2: 200ms delay is enforced between call #1 and call #2 (fake-timers gate)", async () => {
  vi.useFakeTimers();
  vi.mocked(execCommand).mockResolvedValue("");

  const promise = __injectBtwForTests(fakeConn, "test-session");

  // Allow microtasks to flush so call #1 completes.
  await Promise.resolve();
  await Promise.resolve();

  // Advance to 199ms — setTimeout has not yet fired.
  await vi.advanceTimersByTimeAsync(199);
  expect(vi.mocked(execCommand).mock.calls.length).toBe(1);

  // Advance by 1 more ms (total 200ms) — setTimeout fires, call #2 executes.
  await vi.advanceTimersByTimeAsync(1);
  await Promise.resolve();
  await Promise.resolve();

  expect(vi.mocked(execCommand).mock.calls.length).toBe(2);

  await promise;
});
```

The new split-send timing test mirrors this with `advanceTimersByTimeAsync(249)` / `(1)` to gate the 250ms boundary.

**Command-string assertion pattern** (lines 356–373):
```typescript
const cmd1 = vi.mocked(execCommand).mock.calls[0][1] as string;
const cmd2 = vi.mocked(execCommand).mock.calls[1][1] as string;

expect(cmd1).toContain("send-keys");
expect(cmd1).toContain("-l");  // literal flag present on body write
expect(cmd1).toContain("-t 'test-session'");
expect(cmd1).not.toMatch(/\sEnter\s*$/);  // body write — no Enter

expect(cmd2).toContain("send-keys");
expect(cmd2).not.toContain("-l");  // no literal flag on Enter write
expect(cmd2).toContain("-t 'test-session'");
expect(cmd2).toMatch(/\sEnter\s*$/);  // Enter write
```

---

### `src/ui/features/pretty-view/PrettyView.*.test.tsx` — extend existing frontend tests

**Analog:** `src/ui/features/pretty-view/PrettyView.aside.test.tsx` — full WS-mock scaffolding shape.

**WS stub type and mock** (lines 29–63):
```typescript
type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));
```

**`flipToStreaming` helper — sets WS to open+streaming state** (lines 92–101):
```typescript
function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}
```

**`ws.send.mock.calls` assertion pattern** (lines 200–227):
```typescript
// Baseline send count after streaming (only the connectToPane send).
const sendCountBefore = ws.send.mock.calls.length;

// ... trigger action ...

// Assert a specific WS send happened after the action.
await waitFor(() => {
  const newCalls = ws.send.mock.calls.slice(sendCountBefore);
  const targetSend = newCalls.find(([data]) => {
    try {
      return JSON.parse(data as string).type === "aside_arm"; // change type per assertion
    } catch {
      return false;
    }
  });
  expect(targetSend).toBeTruthy();
});
```

**`beforeEach` reset pattern** (lines 116–128):
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  wsStubs.length = 0;
  resizeObserverStub = vi.fn(function () {
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  });
  vi.stubGlobal("ResizeObserver", resizeObserverStub);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

**Additional vi.mock blocks the new test file needs** (lines 65–88):
```typescript
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));
```

---

## Shared Patterns

### Guard pattern — `!sshConn || !currentTmuxSession` (backend)
**Source:** `src/backend/claude-session/claude-session-server.ts` lines 4016
**Apply to:** Both new `input` and `interrupt` handlers
```typescript
if (!sshConn || !currentTmuxSession) return;
```

### Error-handling — log-and-swallow (backend)
**Source:** `src/backend/claude-session/claude-session-server.ts` lines 4041–4051
**Apply to:** Both new `input` and `interrupt` handler `catch` blocks
```typescript
} catch (err) {
  sshLogger.warn("raw_keystrokes send failed", {
    operation: "raw_keystrokes_send_error",
    hostId: currentHostId,
    tmuxSession: currentTmuxSession,
    bytesLength: bytes.length,
    error: err instanceof Error ? err.message : String(err),
  });
}
```
Mirror the field names: `operation` (e.g. `"input_send_error"`, `"interrupt_send_error"`), `hostId: currentHostId`, `tmuxSession: currentTmuxSession`, `error: err instanceof Error ? err.message : String(err)`.

### Guard pattern — `!ws || ws.readyState !== WebSocket.OPEN` (frontend)
**Source:** `src/ui/features/pretty-view/PrettyView.tsx` lines 522, 543, 566, 576
**Apply to:** Both new `sendInput` and `sendInterrupt` callbacks inside PrettyView
```typescript
const ws = wsRef.current;
if (!ws || ws.readyState !== WebSocket.OPEN) return;
try {
  ws.send(JSON.stringify({ ... }));
} catch {
  /* swallow — best-effort; ws may be mid-close */
}
```

### `useCallback` deps: `[]` posture
**Source:** `src/ui/features/terminal/Terminal.tsx` lines 3222 (`}, []);`) and RESEARCH.md Gap 9
**Apply to:** `sendInput`, `sendInterrupt` in PrettyView; `handleInjectedTurnReady` post-migration in Terminal.tsx
Both `wsRef` (PrettyView) and `pvSendInputRef` (Terminal.tsx) are React refs — `.current` is read at call time, not captured, so `deps: []` is correct and consistent with the existing `handleInjectedTurnReady` pattern.

### `shellQuote` for all tmux command construction (backend)
**Source:** `src/backend/claude-session/claude-session-server.ts` line 239 (definition) + line 4039 (usage)
**Apply to:** Both new handlers — wrap session name AND payload data in `shellQuote`. For the Enter write, no quoting needed on the key name itself (`Enter` is a tmux key name, not user data).

---

## No Analog Found

No files in this phase lack an analog. All patterns have close matches in the same files being modified.

---

## Metadata

**Analog search scope:**
- `src/backend/claude-session/` (all files — 20+ test files enumerated)
- `src/ui/features/pretty-view/` (PrettyView.tsx + 4 test files)
- `src/ui/features/terminal/Terminal.tsx`
- `src/backend/ssh/terminal.ts` (split-send timing reference)

**Files scanned:** 10 source files read (targeted sections); 8 backend test files enumerated via grep

**Pattern extraction date:** 2026-08-13

**Critical constraint for planner:**
- Split-send delay MUST be **250ms** — not 50ms. The 250ms value is at `terminal.ts:842` and is empirically validated (patches #111 + #118). The CONTEXT.md worked-example comment says "50ms" in one place — this is a stale artifact; RESEARCH.md Gap 5 documents the discrepancy and confirms 250ms.
- `terminalWs={webSocketRef.current}` at `Terminal.tsx:3312` does NOT migrate — it is a separate prop feeding `usePrettyViewUploads`, not one of the four compose-send call sites.
- MessageQueueDrawer file is at `src/ui/features/terminal/MessageQueueDrawer.tsx` (NOT `pretty-view/`), confirmed via grep. Its `onSend` prop interface is `(text: string, messageQueueItemId: string) => boolean` — the component itself needs no internal changes.
