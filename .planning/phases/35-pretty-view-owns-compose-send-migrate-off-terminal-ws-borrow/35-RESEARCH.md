# Phase 35: pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow — Research

**Researched:** 2026-08-13
**Domain:** WebSocket migration — frontend React + Node.js backend WS handler
**Confidence:** HIGH (all findings from live codebase grep/read; no web search required)

## Summary

This phase migrates four call sites in `Terminal.tsx` that borrow the terminal SSH WS
(`webSocketRef.current`) onto pretty-view's own claude-session WS (`wsRef.current` inside
`PrettyView.tsx`). The design is fully locked in CONTEXT.md. This research verifies the
locked design against the live codebase and surfaces one significant discrepancy plus several
implementation details the planner needs.

**Critical discrepancy found:** CONTEXT.md's backend handler shape uses a 50ms setTimeout
between the body write and the Enter send-keys in the split-send path. The ACTUAL value in
`terminal.ts` is **250ms** (patched from 50ms → 250ms in patch #111, then adjusted again
in patch #118 with tmux send-keys). The new `input` handler on the claude-session WS should
use **250ms** to match the validated timing, not 50ms as the CONTEXT.md example shows.

**Primary recommendation:** Use `await new Promise(resolve => setTimeout(resolve, 250))` in
the split-send path of the new `input` handler, matching `terminal.ts:842`. All other
CONTEXT.md design decisions verified correct against live code.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Backend approach: additive `type:"input"` + `type:"interrupt"` handlers on claude-session WS
- Trust boundary: connection-scoped `currentTmuxSession` only — ignore any client-supplied hostId/tmuxSession
- 16KB payload cap mirroring `MAX_RAW_KEYSTROKES_BYTES`
- Split-send gate: `mqid.length > 0 && data.endsWith("\r")` — strip `\r`, send body via `tmux send-keys -l`, wait, then `tmux send-keys Enter`
- Four frontend call sites swap atomically: `onSend` (:3261), `onInterrupt` (:3300), `handleInjectedTurnReady` (:3208), `MessageQueueDrawer.onSend` (:3331)
- Verification = `npx vitest run` green + `npm run build:backend` green
- No byte-stream comparison
- MessageQueueDrawer mount stays where it is (sibling of PrettyView in Terminal.tsx)
- Terminal-mode compose-send stays on terminal SSH WS
- Phase 35 ships before Phase 34 + quick 260813-0qx

### Claude's Discretion
- Planner picks between ref-forwarding shape (PrettyView sets `sendInputRef.current = callback` on mount) vs other approaches for the MessageQueueDrawer WS source
- New backend test file name (CONTEXT.md suggests `claude-session-server.compose-send.test.ts` or extending an existing file)
- Whether to introduce a `usePrettyViewWsSender` hook to reduce duplication across the four call sites

### Deferred Ideas (OUT OF SCOPE)
- Terminal WS keep-alive ping
- Removing `terminal.ts:499`'s `type:"input"` handler
- Migrating terminal-mode webSocketRef.current uses
- Byte-stream comparison verification
- Consolidating `raw_keystrokes` and `input` frames
</user_constraints>

---

## Verification Results (Research Gap Answers)

### Gap 1: MessageQueueDrawer exact file path

**VERIFIED.** File lives at:

```
src/ui/features/terminal/MessageQueueDrawer.tsx
```

CONTEXT.md guessed `src/ui/features/pretty-view/MessageQueueDrawer.tsx` — incorrect. It is
inside `features/terminal/`, NOT `features/pretty-view/`. This is consistent with CONTEXT.md's
note that its mount stays inside Terminal.tsx. [VERIFIED: grep find]

Import in Terminal.tsx at line 46:
```typescript
import { MessageQueueDrawer } from "./MessageQueueDrawer.tsx";
```

Interface (confirmed at MessageQueueDrawer.tsx lines 15-20):
```typescript
interface MessageQueueDrawerProps {
  hostId: number;
  tmuxSession: string | null;
  onSend: (text: string, messageQueueItemId: string) => boolean;
  onClose: () => void;
}
```

The component does NOT need internal changes — only its `onSend` prop source changes.

### Gap 2: webSocketRef.current reads in Terminal.tsx — are the deferred ones truly terminal-mode plumbing?

**CONFIRMED.** Every `webSocketRef.current` reference outside the four migrating call sites
is terminal-mode infrastructure. Categorized below:

| Lines | What They Do | Terminal-mode? |
|-------|-------------|----------------|
| 679, 713 | Close WS on visibility hide | YES — terminal WS lifecycle |
| 837, 842 | Send TOTP/password response | YES — SSH auth flow |
| 865, 870 | Send TOTP response | YES — SSH auth flow |
| 904, 905 | Send resize event | YES — xterm.js resize |
| 934, 935 | Send resize event | YES — xterm.js resize |
| 968, 969 | Send ping | YES — terminal keepalive |
| 1009–1013 | Send disconnect + close | YES — terminal teardown |
| 1063–1094 | CWD poll send | YES — `get_cwd` terminal plumbing |
| 1273–1289 | Close prior WS + assign new WS | YES — WS reconnect machinery |
| 1323–1324 | Close session WS on switch | YES — session switch cleanup |
| 1413 | Stale-WS guard | YES — terminal reconnect guard |
| 1481–1484 | Send focus event | YES — terminal focus routing |
| 1550–1758 | SSH auth challenges, opkssh, host key verification | YES — terminal auth dialogs |
| 1797, 1798 | Send input (sshAdapter) | YES — xterm.js keystrokes |
| 1954, 1955 | Close on session switch | YES — terminal teardown |
| 2029–2031 | Close on unmount | YES — terminal teardown |
| 2256–2283 | Autocomplete send | YES — terminal autocomplete |
| 2580, 2581 | CWD send | YES — terminal cwd request |
| 2685–2700 | Ping send | YES — terminal keepalive |
| 2791, 2792 | Close terminal WS | YES — terminal teardown |
| 2824, 2825 | Identity badge send | YES — identity flow |
| 2891, 2892 | Tmux list send | YES — tmux session picker |
| 2946–2948 | Session selection | YES — tmux session picker |
| 2995, 2996 | Theme apply | YES — terminal theme |
| 3014, 3015 | Execute command | YES — executeCommand prop |
| 3035–3050 | Opkssh auth start | YES — SSH auth |
| 3126–3128 | Connected check | YES — terminal status |
| 3175, 3176 | xterm.js data handler (keystrokes from terminal) | YES — terminal-mode input |
| 3527–3623 | Opkssh dialog, host key verification, tmux session picker | YES — terminal auth/plumbing |

**No surprises.** None of the deferred lines are pretty-view-related. The four migrating lines
(3210/3214, 3288, 3308, 3332/3340) are cleanly isolated. [VERIFIED: manual review of each line]

**One additional observation:** Line 3312 (`terminalWs={webSocketRef.current}`) is NOT one
of the four migrating call sites. `terminalWs` is consumed by `usePrettyViewUploads` for
file-upload chunk pumping — it stays as `webSocketRef.current` post-migration. Only the four
`onSend`/`onInterrupt`/`handleInjectedTurnReady`/`MessageQueueDrawer.onSend` call sites
migrate.

### Gap 3: All claude-session-server test files

**VERIFIED.** Full enumeration (from `find`): [VERIFIED: filesystem]

```
src/backend/claude-session/claude-session-server.aside.integration.test.ts
src/backend/claude-session/claude-session-server.aside.test.ts
src/backend/claude-session/claude-session-server.count-bounties.test.ts
src/backend/claude-session/claude-session-server.dormant-tail.test.ts
src/backend/claude-session/claude-session-server.layer1.test.ts
src/backend/claude-session/claude-session-server.malformed-eventid.test.ts
src/backend/claude-session/claude-session-server.repoll.test.ts
src/backend/claude-session/claude-session-server.role-file.test.ts
```

Plus peer files NOT prefixed `claude-session-server.*` but in the same directory:
```
src/backend/claude-session/dormant-poll.test.ts           ← wake handler tests live HERE
src/backend/claude-session/layer1-detect.test.ts
src/backend/claude-session/context-pct-from-jsonl.test.ts
src/backend/claude-session/context-pct-parser.test.ts
src/backend/claude-session/discover-identity-session-file.test.ts
src/backend/claude-session/pane-state-emitter.test.ts
src/backend/claude-session/plan-pending-parser.test.ts
src/backend/claude-session/session-file-discovery.test.ts
src/backend/claude-session/session-file-parser.id-reset.test.ts
src/backend/claude-session/session-file-parser.test.ts
src/backend/claude-session/identity-artifact-reader.*.test.ts (7 files)
```

**Recommended file for new input/interrupt handler tests:**
`src/backend/claude-session/claude-session-server.compose-send.test.ts`

Rationale: the naming convention is `claude-session-server.<feature>.test.ts`. The `dormant-poll.test.ts` file (which holds wake handler tests) is an exception — it was named by its domain, not the server file. Following the majority convention (`aside.test.ts`, `repoll.test.ts`, `malformed-eventid.test.ts`) points to `compose-send.test.ts`. Do NOT extend `layer1.test.ts` (layer 1 detection) or `aside.test.ts` (aside primitives) — those are thematically unrelated.

### Gap 4: Existing test coverage for raw_keystrokes / wake / aside_dismissed backend handlers

**Finding: raw_keystrokes has NO dedicated unit test.** Grep across all test files returns zero
results for `raw_keystrokes` or `MAX_RAW_KEYSTROKES_BYTES`. The handler lives inside the
`wss.on("connection")` closure and has no exported test seam. [VERIFIED: exhaustive grep]

**Wake handler tests** live in `dormant-poll.test.ts` and use the `__applyWakeMessageForTests`
exported seam. The mock pattern:

```typescript
const fakeConn = {} as import("ssh2").Client;

// Happy path (Test E):
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
const rmCmd = exec.mock.calls[0][1] as string;
// Assert command string

// Error path (Test F):
const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));
// ...
```

**InjectBtw (two-call shape with timing) tests** live in `claude-session-server.aside.test.ts`
and use the `__injectBtwForTests` exported seam + `vi.useFakeTimers()`. The mock pattern for
timing assertions:

```typescript
it("Test 2: 200ms delay is enforced between call #1 and call #2 (fake-timers gate)", async () => {
  vi.useFakeTimers();
  vi.mocked(execCommand).mockResolvedValue("");
  const promise = __injectBtwForTests(fakeConn, "test-session");
  await Promise.resolve(); // flush microtasks
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(199);
  expect(vi.mocked(execCommand).mock.calls.length).toBe(1);
  await vi.advanceTimersByTimeAsync(1); // now at 200ms — fires
  await Promise.resolve();
  await Promise.resolve();
  expect(vi.mocked(execCommand).mock.calls.length).toBe(2);
  await promise;
});
```

**Trust-boundary tests** use the `T-14-02-01` / `T-cd6-01` approach from aside integration
tests — they set up module-scope state directly and verify that client-supplied hostId/tmuxSession
fields are IGNORED. The pattern is: call the seam with an explicit `sshConn` stub + fixed
`currentTmuxSession`; assert that `execCommand` is called with `currentTmuxSession` (not any
value the client payload might supply). Since the new `input`/`interrupt` handlers won't have
an exported test seam that receives client payload, the trust-boundary test for the new handlers
should assert that the command string contains `shellQuote(currentTmuxSession)` verbatim.

**Implication for new tests:** The new `compose-send.test.ts` should export test seams
(`__applyInputMessageForTests`, `__applyInterruptMessageForTests`) following the
`__applyWakeMessageForTests` shape from `claude-session-server.ts:1088`. This is the
established pattern for handlers-inside-closures: extract the pure logic into an exported
async function that takes `{sshConn, currentTmuxSession, execCommand, ...payload}` and can
be called directly from tests without a live WS server. The timing test for split-send should
use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(249)` / `(1)` to assert the 250ms
boundary (see Gap 5 below for the correct delay).

### Gap 5 (CRITICAL DISCREPANCY): terminal.ts:499 split-send — actual timing

**DISCREPANCY FOUND.** CONTEXT.md's worked example uses `50ms`. The live codebase uses
**250ms**. [VERIFIED: direct code read]

The `terminal.ts` split-send implementation (`src/backend/ssh/terminal.ts`, starting at
line 634 `case "input"`) does:

1. Write `body` (inputData without trailing `\r`) to `inputStream` (raw PTY write)
2. `setTimeout(() => { ... }, 250)` — the setTimeout callback fires at **250ms** (line 842)
3. Inside the callback: `submitConn.exec("tmux send-keys -t ... Enter", ...)` via `sshConn.exec`

History from comments in `terminal.ts`:
- **patch #100:** original split-send, 50ms gap
- **patch #111:** bumped to 250ms ("50ms was too tight — Ashley UAT'd... Ink stays in paste-detection past 50ms for long bodies")
- **patch #118:** switched from raw PTY CR to `tmux send-keys ... Enter` via exec channel (same 250ms delay)

**The new `input` handler on the claude-session WS is tmux-only from the start** (no raw PTY
path, no fallback) — so it uses `await new Promise(resolve => setTimeout(resolve, 250))` which
is `async/await`-style (matching the existing `injectBtw` delay pattern in claude-session-server.ts).

**Additional tmux-path difference:** terminal.ts uses `sshConn.exec(...)` via callback-style
ssh2 API. The claude-session WS path should use `execCommand(sshConn, ...)` (the promisified
wrapper from `tmux-helper.ts`), matching `raw_keystrokes` at line 4037.

**Watchdog note:** terminal.ts also arms `armPvSubmitWatchdog` after the split-send
(quick 260803-1xw). This watchdog is NOT used anywhere in `claude-session-server.ts` and is
not imported there. The CONTEXT.md design does NOT include a watchdog for the new handler —
the design decision is that log-and-swallow on error is sufficient. The planner should not add
a watchdog unless Ashley asks for it.

**Corrected handler timing for the plan:**

```typescript
if (isSplitSend) {
  const body = data.slice(0, -1);
  if (body.length > 0) {
    await execCommand(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(body)}`);
  }
  await new Promise(resolve => setTimeout(resolve, 250)); // 250ms — matches terminal.ts:842
  await execCommand(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} Enter`);
}
```

### Gap 6: connectToPane scope — sshConn/currentTmuxSession initialization and guard race

**CONFIRMED. No race window exists.** [VERIFIED: code read]

`currentTmuxSession` is declared at line 1654 in the connection closure:
```typescript
let currentTmuxSession: string | null = null;
```

It is set to a non-null value at EXACTLY three places:
- Line 4224: `currentTmuxSession = activeTmuxSession;` — inside `startActiveSessionFlow` callback, which is called only after successful discovery
- Line 4909: same pattern in dormant-poll rediscovery path
- Line 5207: same pattern in initial-active-discovery path

Until one of these three paths sets it, `currentTmuxSession` remains `null`. The guard
`if (!sshConn || !currentTmuxSession) return;` at the top of the new handler catches any
pre-`connectToPane` message silently (returns, sends nothing). This is identical to
`raw_keystrokes` at line 4016: `if (!sshConn || !currentTmuxSession) return;`.

There is no race window: `currentTmuxSession` is set synchronously inside a callback that
runs only after SSH discovery completes. An `input` frame arriving before `connectToPane`
discovery gets the `null` guard and is silently dropped — consistent behavior with
`raw_keystrokes`.

`sshConn` follows the same pattern — declared `null` at line 1461, set only on SSH connection
success inside the `connectToPane` flow.

### Gap 7: Trust-boundary test pattern

**Confirmed.** The T-14-02-01 / T-cd6-01 trust-boundary pattern is documented in comments
in `claude-session-server.ts:4010-4014`:

```
// Trust boundary (mirrors aside_dismissed T-14-02-01): the send target
// is derived from the connection's captured currentTmuxSession (set on
// connectToPane discovery success). We IGNORE any client-supplied
// hostId/tmuxSession in the payload — a client cannot spoof a raw
// keystroke into a pane it doesn't own.
```

The pattern for asserting this in tests: the test seam takes `currentTmuxSession` as a
parameter (not read from the message payload). A test proves trust-boundary by:
1. Passing `currentTmuxSession: "legit-session"` to the seam
2. Constructing a message payload with `hostId: 999, tmuxSession: "spoofed-session"` (or no
   such fields at all — they're simply ignored by the handler logic)
3. Asserting that `execCommand` was called with a command string containing
   `shellQuote("legit-session")` and NOT `"spoofed-session"`

Since the handler doesn't read `msg.hostId` or `msg.tmuxSession`, the trust assertion is
trivially true by code structure — the test's value is documentation and regression-guard.

### Gap 8: Frontend prop-drilling — prior art for callback from PrettyView to Terminal.tsx

**Finding: no prior ref-forwarding from PrettyView back up to Terminal.tsx exists.** [VERIFIED: grep]

The relationship is currently one-directional: Terminal.tsx passes props DOWN to PrettyView
(`onSend`, `onInterrupt`, `onInjectedTurnReady`, `isVisible`, `isIdle`, `terminalWs`, etc.).
PrettyView fires callbacks but does not share its internal `wsRef` upward.

The `forwardRef` pattern already used in Terminal.tsx is for exposing `TerminalHandle` to
Terminal's PARENT (AppShell), not for internal subcomponents.

**Three viable approaches for the MessageQueueDrawer WS source:**

**Option A (Ref-forwarding / callback ref — recommended by CONTEXT.md):**
Terminal.tsx creates `const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null)`.
PrettyView receives a new `onRegisterSendInput` prop (or `sendInputRef` prop).
PrettyView calls `props.sendInputRef.current = sendInput` inside a `useEffect` on mount,
and `props.sendInputRef.current = null` on unmount. Terminal.tsx's MessageQueueDrawer.onSend
reads `pvSendInputRef.current?.(text, mqid) ?? false`.

**Option B (Inline closure inside onSend prop to PrettyView — cleanest):**
PrettyView's `onSend` prop is already a callback Terminal.tsx provides inline. Add a new
prop `onInterrupt` → done. For MessageQueueDrawer, Terminal.tsx creates a local
`const pvSendRef = useRef<((t: string, mqid?: string) => boolean) | null>(null)` and
passes a `onRegisterSend={(fn) => { pvSendRef.current = fn; }}` callback to PrettyView.
PrettyView calls `onRegisterSend?.(sendInput)` in a `useEffect`. This avoids ref mutation
on the prop itself.

**Option C (Lift the callback out of PrettyView into Terminal.tsx):**
Terminal.tsx creates its own `sendViaPrettyViewWs` function that reads `pvWsRef.current`
(a ref it passes to PrettyView as a `wsRef` prop). PrettyView sets `wsRef.current = wsRef.current`
on open. But this "punches through" PrettyView's WS ownership — the cleaner approach keeps
the WS ref inside PrettyView.

**Recommended: Option A (ref-forwarding shape from CONTEXT.md) is the safest.** It keeps
`wsRef` internal to PrettyView and only exposes a stable callback surface. No existing pattern
to conflict with.

**`useCallback` deps note for the four call sites:** The current `handleInjectedTurnReady`
uses `deps: []` because `webSocketRef` is a React ref (reads `.current` at call time, no
re-render trigger). The equivalent callback from PrettyView will close over PrettyView's
`wsRef.current` at call time too — so if Terminal.tsx holds a ref to PrettyView's callback,
that ref is stable (doesn't change between renders unless PrettyView remounts). The `deps: []`
posture is correct for `handleInjectedTurnReady` post-migration because the callback ref
(`pvSendInputRef.current`) is also read at call time.

For `onSend` and `onInterrupt` (inline callbacks in the PrettyView JSX), they can be
refactored to use `pvSendInputRef.current?.(...)` and `pvSendInputRef.current?.(...)` inline,
which requires no dep tracking.

### Gap 9: useCallback deps posture for the four call sites

**CONFIRMED.** [VERIFIED: code read]

`handleInjectedTurnReady` at line 3208 uses `deps: []` (line 3222: `}, []);`). The comment
at 3203-3207 explains:

> "Deps are `[]` because `webSocketRef` is a React ref (mutation does not re-render) and the
> ref's `.current` is read at call time inside the callback body — never captured at
> callback-creation time."

Post-migration, the equivalent reads `pvSendInputRef.current?.(text, mqid)` at call time.
This has identical semantics — `pvSendInputRef` is also a React ref (`useRef`), mutation does
not re-render, `.current` is read at call time. **`deps: []` is correct post-migration.**

The other three call sites (`onSend`, `onInterrupt`, `MessageQueueDrawer.onSend`) are inline
callbacks in JSX — they are re-created on each render regardless. Post-migration they will
also read `pvSendInputRef.current?.(...)` at call time. No deps change needed.

---

## Architecture Patterns

### System Architecture Diagram

```
Terminal.tsx (mount orchestrator)
  ├── webSocketRef ──► terminal SSH WS (port 4022 / Skynet upstream)
  │    └── [stays here] xterm.js data, resize, CWD poll, auth, keepalive
  │
  ├── PrettyView.tsx
  │    ├── wsRef ──► claude-session WS (port 30011)  [phase 35 target]
  │    │    ├── [existing] connectToPane, raw_keystrokes, wake, aside_*
  │    │    ├── [NEW] type:"input" handler → tmux send-keys -l body, 250ms, tmux send-keys Enter
  │    │    └── [NEW] type:"interrupt" handler → tmux send-keys C-c
  │    │
  │    ├── onSend prop ──► Terminal.tsx sends {type:"input", data:text+"\r", mqid} over wsRef  [migrated]
  │    ├── onInterrupt prop ──► Terminal.tsx sends {type:"interrupt"} over wsRef  [migrated]
  │    └── onInjectedTurnReady prop ──► Terminal.tsx sends two events over wsRef  [migrated]
  │
  ├── MessageQueueDrawer.tsx (sibling of PrettyView in Terminal.tsx's JSX)
  │    └── onSend prop ──► reads pvSendInputRef.current (callback from PrettyView)  [migrated]
  │         └── pvSendInputRef set by PrettyView on mount
  │
  └── pvSendInputRef ──► PrettyView sets .current = sendInput on mount
                          sendInput closes over wsRef.current, reads at call time
```

### Handler Insertion Point in claude-session-server.ts

New handlers slot BETWEEN `raw_keystrokes` (line 4053 `return;`) and `wake` (line 4063
`if (msg.type === "wake")`):

```typescript
// [existing] raw_keystrokes at 4015–4053
if (msg.type === "raw_keystrokes") { ... return; }

// [NEW] Phase 35 — input handler
if (msg.type === "input") { ... return; }
// [NEW] Phase 35 — interrupt handler
if (msg.type === "interrupt") { ... return; }

// [existing] wake at 4063
if (msg.type === "wake") { ... return; }
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shell quoting for tmux args | Custom escaping | `shellQuote` at line 239 of claude-session-server.ts | Already tested, POSIX-correct, both files must stay byte-identical |
| SSH exec | Raw ssh2 callback | `execCommand` from `../ssh/tmux-helper.js` | Promisified, logged, consistent with all other handlers |
| Split-send timing | Different delay | 250ms matching terminal.ts:842 | Empirically validated by Ashley UAT (patches #111, #118) |

---

## Common Pitfalls

### Pitfall 1: Using 50ms instead of 250ms in split-send
**What goes wrong:** Messages arrive in Claude Code's composer but don't submit. Ashley's
paste-detection symptom returns.
**Why it happens:** CONTEXT.md's worked example shows `50ms` but this was the patch #100
value, superseded by patch #111 (250ms) due to UAT failure.
**How to avoid:** Use `await new Promise(resolve => setTimeout(resolve, 250))`.
**Warning signs:** Test for split-send passes (because fake timers advance) but UAT shows
message-not-submitting symptom.

### Pitfall 2: Forgetting terminalWs stays on webSocketRef.current
**What goes wrong:** Removing `terminalWs={webSocketRef.current}` from the PrettyView render
breaks file uploads.
**Why it happens:** `terminalWs` is separate from compose-send — it feeds `usePrettyViewUploads`.
**How to avoid:** Only migrate the four explicit call sites. `terminalWs` prop at line 3312
stays pointing to `webSocketRef.current`.

### Pitfall 3: Half-migrating (leaving one call site on webSocketRef.current)
**What goes wrong:** The un-migrated path still borrows the terminal WS and will hit the
silent-death bug.
**Why it happens:** The four call sites are spread across ~130 lines and easy to miss one.
**How to avoid:** Grep for `webSocketRef.current` after migration — only terminal-mode uses
should remain (lines 679, 713, 837–3176 range, plus the `terminalWs` prop at 3312).

### Pitfall 4: Placing MessageQueueDrawer inside PrettyView subtree
**What goes wrong:** MessageQueueDrawer becomes invisible when isPrettyMode is false, since
PrettyView is unmounted in that case.
**Why it happens:** The MQD mount at line 3327 has NO `isPrettyMode` gate — it must be visible
in both terminal and pretty modes (queue items exist regardless of current mode).
**How to avoid:** MessageQueueDrawer stays as sibling of PrettyView in Terminal.tsx's JSX.

### Pitfall 5: Expecting a test seam for raw_keystrokes to copy from
**What goes wrong:** Spending time looking for a `__applyRawKeystrokesForTests` export that
doesn't exist.
**Why it happens:** raw_keystrokes has no test seam — it was never extracted.
**How to avoid:** Model the new `input`/`interrupt` test seams on `__applyWakeMessageForTests`
(in `claude-session-server.ts:1088`) — that's the correct precedent for handlers-in-closures.

### Pitfall 6: Using `vi.mock` for execCommand timing tests
**What goes wrong:** Timing tests using `vi.mock("../ssh/tmux-helper.js")` only intercept at
the module boundary — the `await new Promise(resolve => setTimeout(resolve, 250))` is a plain
Promise and doesn't need a mock; it just needs `vi.useFakeTimers()` to advance.
**How to avoid:** Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(N)` for timing
assertions. Mock `execCommand` separately to observe call counts and command strings.

---

## Code Examples

### New test seam shape (model on __applyWakeMessageForTests)

```typescript
// In claude-session-server.ts — export alongside __applyWakeMessageForTests

export async function __applyInputMessageForTests(deps: {
  sshConn: unknown | null;
  currentTmuxSession: string | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
  data: string;
  messageQueueItemId?: string;
}): Promise<void> {
  const { sshConn, currentTmuxSession, execCommand: exec } = deps;
  if (!sshConn || !currentTmuxSession) return;
  const data = String(deps.data ?? "");
  if (data.length === 0) return;
  const MAX_INPUT_BYTES = 16 * 1024;
  if (data.length > MAX_INPUT_BYTES) { /* log + return */ return; }
  const mqid = String(deps.messageQueueItemId ?? "");
  const isSplitSend = mqid.length > 0 && data.endsWith("\r");
  try {
    if (isSplitSend) {
      const body = data.slice(0, -1);
      if (body.length > 0) {
        await exec(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(body)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      await exec(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} Enter`);
    } else {
      await exec(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(data)}`);
    }
  } catch (err) {
    sshLogger.warn("input send failed", { ... });
  }
}

export async function __applyInterruptMessageForTests(deps: {
  sshConn: unknown | null;
  currentTmuxSession: string | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
}): Promise<void> {
  const { sshConn, currentTmuxSession, execCommand: exec } = deps;
  if (!sshConn || !currentTmuxSession) return;
  try {
    await exec(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} C-c`);
  } catch (err) {
    sshLogger.warn("interrupt send failed", { ... });
  }
}
```

### Frontend ref-forwarding shape (Terminal.tsx)

```typescript
// In Terminal.tsx — declare ref for PrettyView's sendInput callback
const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null);

// In PrettyView render:
<PrettyView
  ...existing props...
  onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}
  onUnregisterSendInput={() => { pvSendInputRef.current = null; }}
/>

// handleInjectedTurnReady (post-migration):
const handleInjectedTurnReady = useCallback(
  (text: string, messageQueueItemId: string) => {
    const send = pvSendInputRef.current;
    if (!send) return;
    send(text); // body event — no mqid
    setTimeout(() => {
      const send2 = pvSendInputRef.current;
      if (send2) send2("\r", messageQueueItemId);
    }, 60);
  },
  [], // deps: [] — pvSendInputRef is a React ref, read at call time
);

// MessageQueueDrawer.onSend (post-migration):
onSend={(text, messageQueueItemId) => {
  const send = pvSendInputRef.current;
  if (!send) return false;
  send(text); // body event
  setTimeout(() => {
    const send2 = pvSendInputRef.current;
    if (send2) send2("\r", messageQueueItemId);
  }, 60);
  return true;
}}
```

### PrettyView internal sendInput callback

```typescript
// Inside PrettyView function body — closes over wsRef
const sendInput = useCallback((text: string, mqid?: string): boolean => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({
    type: "input",
    data: text,
    ...(mqid ? { messageQueueItemId: mqid } : {}),
  }));
  return true;
}, []); // wsRef is stable ref — read at call time

// Register/unregister in useEffect:
useEffect(() => {
  props.onRegisterSendInput?.(sendInput);
  return () => { props.onUnregisterSendInput?.(); };
}, [sendInput, props.onRegisterSendInput, props.onUnregisterSendInput]);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Split-send 50ms gap | 250ms gap | patch #111 (UAT failure) | Paste-detection now exits before Enter arrives |
| Raw PTY `\r` for Enter | `tmux send-keys Enter` via exec channel | patch #118 | Bypasses Ink paste-detection framing entirely |
| Two frontend events (body + 60ms `\r`) for compose-send | Single event with `data:text+"\r"+mqid` | patch #110 | Eliminates race window on the 60ms gap |
| Borrowed terminal SSH WS for pretty-view sends | Own claude-session WS | Phase 35 (this phase) | Fixes silent-death bug on long-idle sessions |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `onRegisterSendInput`/`onUnregisterSendInput` prop names are available (no collision with existing PrettyView props) | Gap 8 code example | Rename to any unused prop names — low risk |
| A2 | `usePrettyViewWsSender` hook (mentioned in CONTEXT.md as planner option) would wrap the same pattern; no separate research performed | CONTEXT.md discretion | Planner may choose hook form — implementation equivalent |

---

## Open Questions (RESOLVED)

1. **Whether to add a `usePrettyViewWsSender` hook** — RESOLVED: NO. Planner chose the ref-forwarding shape directly; `pvSendInputRef.current?.(...)` at each call site is terse enough that hook extraction would add indirection without eliminating meaningful duplication. The three post-cutover call-site shapes (single-event split-send, two-event body+delay+CR, interrupt-only) are structurally distinct enough that a shared hook would need branches for each case anyway.

2. **Whether `onSend` in PrettyView's JSX should become a stable useCallback** — RESOLVED: NO. Inline lambda retained. The re-creation cost is negligible at PrettyView's render frequency (once per session-frame update, not per keystroke), and the callback body reads a ref at call time so referential equality doesn't affect child behavior. Optimization deferred as out-of-scope per CONTEXT.md § deferred.

---

## Environment Availability

Step 2.6: SKIPPED (no new external tools required; `tmux` and SSH are already production-available and exercised by existing `raw_keystrokes` + `wake` handlers)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (inferred from `npx vitest run` in CONTEXT.md + `vi.fn()` / `vi.mock` patterns throughout) |
| Config file | `vitest.config.*` (root — not confirmed exact path but implied by `npx vitest run`) |
| Quick run command | `npx vitest run --reporter=verbose src/backend/claude-session/claude-session-server.compose-send.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Behavior | Test Type | Automated Command | File |
|----------|-----------|-------------------|------|
| `input` handler: split-send fires two execCommand calls with 250ms gap | unit | `npx vitest run .../claude-session-server.compose-send.test.ts` | Wave 0 gap |
| `input` handler: non-split-send fires one execCommand call | unit | same | Wave 0 gap |
| `input` handler: guard returns if sshConn null | unit | same | Wave 0 gap |
| `input` handler: guard returns if currentTmuxSession null | unit | same | Wave 0 gap |
| `input` handler: 16KB cap enforced | unit | same | Wave 0 gap |
| `input` handler: trust boundary (uses currentTmuxSession not client payload) | unit | same | Wave 0 gap |
| `interrupt` handler: fires `tmux send-keys C-c` | unit | same | Wave 0 gap |
| `interrupt` handler: guard returns if not connected | unit | same | Wave 0 gap |
| `interrupt` handler: log-and-swallow on execCommand throw | unit | same | Wave 0 gap |
| Frontend: onSend writes to pretty-view WS not terminal WS | unit | `npx vitest run .../PrettyView.test.tsx` | Existing (extend) |
| Frontend: onInterrupt writes to pretty-view WS | unit | same | Existing (extend) |
| Frontend: onInjectedTurnReady writes two events over pretty-view WS | unit | same | Existing (extend) |
| Frontend: MessageQueueDrawer.onSend writes two events over pretty-view WS | unit | same | Existing (extend) |
| Suite-wide green | regression | `npx vitest run` | Existing |
| Backend build green | build | `npm run build:backend` | Existing |

### Sampling Rate
- **Per task commit:** `npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite + build green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/backend/claude-session/claude-session-server.compose-send.test.ts` — new file, covers all `input`/`interrupt` handler unit tests
- [ ] Export `__applyInputMessageForTests` and `__applyInterruptMessageForTests` seams from `claude-session-server.ts`

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | YES | Trust boundary: connection-scoped `currentTmuxSession` only; client payload hostId/tmuxSession ignored (mirrors T-14-02-01) |
| V5 Input Validation | YES | `data` coerced to string; 16KB size cap; empty-data early return |
| V2 Authentication | NO (handled at WS connection level — JWT verification at line 1415) | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client sends `input` with spoofed tmuxSession targeting another user's pane | Elevation of Privilege | Trust boundary: ignore msg.tmuxSession; use connection-scoped `currentTmuxSession` only |
| Oversized payload to trigger ARG_MAX failure in tmux | Tampering/DoS | 16KB cap (mirrors `MAX_RAW_KEYSTROKES_BYTES` at line 4025) |
| Shell injection via unquoted data in tmux command | Tampering | `shellQuote()` wraps both session name and data |

---

## Sources

### Primary (HIGH confidence)

- `src/backend/claude-session/claude-session-server.ts` — live codebase; lines 1382–5276 read directly
- `src/backend/ssh/terminal.ts` — live codebase; lines 634–842 read directly (split-send implementation)
- `src/ui/features/terminal/Terminal.tsx` — live codebase; lines 3200–3360 read directly (four call sites)
- `src/ui/features/pretty-view/PrettyView.tsx` — live codebase; lines 105–739 read directly
- `src/ui/features/terminal/MessageQueueDrawer.tsx` — live codebase; lines 1–50 read directly
- `src/backend/claude-session/dormant-poll.test.ts` — live codebase; full file read (wake mock patterns)
- `src/backend/claude-session/claude-session-server.aside.test.ts` — live codebase; lines 329–404 read (timing test pattern)
- `src/backend/ssh/tmux-helper.ts` — live codebase; execCommand signature confirmed

### Secondary (MEDIUM confidence)

- CONTEXT.md section § Specific Ideas — informed handler shape (50ms discrepancy corrected above)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — codebase is the source; no external libraries needed
- Architecture: HIGH — all patterns verified against live code; no inferred knowledge
- Pitfalls: HIGH — discrepancy (250ms vs 50ms) confirmed from live source at terminal.ts:842

**Research date:** 2026-08-13
**Valid until:** Until any of the four call sites or claude-session-server.ts message dispatch block is modified
