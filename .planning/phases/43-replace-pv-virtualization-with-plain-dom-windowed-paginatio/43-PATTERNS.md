# Phase 43: Replace PrettyView virtualization with plain-DOM windowed pagination — Pattern Map

**Mapped:** 2026-08-18
**Files analyzed:** 12 (modified/created/deleted)
**Analogs found:** 12 / 12
**Nature of phase:** Deletion + replacement (not greenfield create). Closest analogs are the CURRENT versions of the same files, plus sibling files for the two genuinely new capabilities (range-read handler + prepend response handler).

---

## File Classification

| Change | File | Role | Data Flow | Closest Analog | Match Quality |
|--------|------|------|-----------|----------------|---------------|
| **modify-heavy** | `src/backend/claude-session/session-file-tail.ts` | backend file-tail helper | streaming (SSH exec channel) | current file (self) — parameterize `-n +1` → `-n N` | self / exact |
| **modify-heavy** | `src/backend/claude-session/claude-session-server.ts` | backend WS server (message-frame emitter + observation channel + WS request router) | request/response + streaming | current file (self) — add `historyWindow` query param at handshake + add `fetch_older` case in msg switch | self / exact |
| **create-new-fn** | (inside `claude-session-server.ts` OR sibling `src/backend/claude-session/session-file-range.ts`) | backend range-read helper | request/response (one-shot SSH exec) | `src/backend/claude-session/context-pct-from-jsonl.ts` (one-shot `tail -c` via `execCommand`) | exact — same shape |
| **modify-heavy** | `src/ui/api/claude-session-api.ts` | frontend WS client (wire type declarations + one-shot request helpers) | request/response | current file (self) — add `historyWindow` to `openClaudeSessionSocket()` param + add `FetchOlderPayload` + `FetchOlderBatchEvent` types (mirror `IdentityCountBountiesPayload` / `IdentityBountyCountsEvent` shape) | self + `countIdentityBounties` sibling |
| **modify-heavy** | `src/ui/features/pretty-view/PrettyView.tsx` | frontend React component (message list surface + WS message handler + scroller DOM) | streaming (append) + request/response (fetch_older) | current file (self) — delete virtualizer cluster L920-1030 + L2360-2450, replace with plain-DOM map | self / exact |
| **modify-heavy (rewrite)** | `src/ui/features/pretty-view/use-auto-scroll.ts` | frontend React hook | scroll-event listener | current file (self, being drastically shrunk) — the "pill-visibility RO callback ONLY updates state" idea at L161-183 is the seed of the new hook | self / partial (structural shrink, not extend) |
| **delete** | `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` | frontend test | test | file being removed | n/a — deletion |
| **delete** | `src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx` | frontend test | test | file being removed | n/a — deletion |
| **delete-dep** | `package.json` / `package-lock.json` (`@tanstack/react-virtual@3.14.9`) | config | n/a | dep removal | n/a — deletion |
| **create-new-test** | `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (name suggestion — planner picks) | frontend test | test | `PrettyView.virtualization.test.tsx` (JSDOM patterns) + `PrettyView.compose-send.test.tsx` (WS-frame helpers) + `PrettyView.aside.test.tsx` (RO polyfill) | exact — same infra, different assertions |
| **create-new-test** | `src/ui/features/pretty-view/use-auto-scroll.test.ts` (if not extant) | frontend hook test | test | existing hook-test shape in this same directory | pattern-match |
| **create-new-test** | `src/backend/claude-session/claude-session-server.fetch-older.test.ts` (name suggestion) | backend WS-handler test | test | `claude-session-server.count-bounties.test.ts` (extracted-handler + test seam) + `claude-session-server.compose-send.test.ts` (`__apply*ForTests` seam pattern) | exact — same shape |

---

## Pattern Assignments

### 1. `src/backend/claude-session/session-file-tail.ts` — parameterize initial line count

**Analog:** the file itself (self). Reason: the shape of `tailSessionFile(conn, absolutePath, onLine, onError)` is already right; only the shell string needs to accept a per-connection `N` for the initial slice.

**Current shell command** (line 80):
```typescript
const command = "tail -F -n +1 " + shellEscape(absolutePath);
```

**Pattern to apply** — add an optional bounded-initial-lines param. The header comment at L7-22 already anticipates this ("`-n +1` starts the read at line 1"); Phase 43 replaces `+1` with `-n N` semantics:
- `-n +1` = start at line 1 (unbounded backfill — current behavior)
- `-n N` (no `+`) = start at N lines from the END of file, then follow (bounded initial-window)

Design decision for the planner: whether `tail -F -n N` alone is sufficient (GNU tail supports it — verify against Ubuntu 22.04 default `coreutils` on Ashley's fleet) or whether we compose `tail -n N + tail -F` (see CONTEXT.md `<decisions>` § "planner may prefer `tail -n N + tail -F` composition"). The CONTEXT explicitly leaves this to the planner.

**Backcompat rule (from CONTEXT.md `<decisions>`):** if the caller does not supply `N`, retain the `-n +1` default byte-for-byte so legacy callers (tests, dev tools) still see unbounded initial replay.

**Imports pattern** (lines 1, 27-29) — stays identical. `shellEscape` is already local.

**Error handling pattern** (lines 33, 119-133) — stays identical. `STDERR_ACCUMULATION_LIMIT_BYTES` gate and stderr-vs-stdout truth signal both preserved.

---

### 2. `src/backend/claude-session/claude-session-server.ts` — add `historyWindow` handshake + `fetch_older` WS request handler

**Analog for `historyWindow` handshake wire read:** the same file's JWT-token URL-param fallback at **L1618-1622**:
```typescript
if (!token) {
  const urlObj = new URL(req.url || "", "http://localhost");
  const qp = urlObj.searchParams.get("token");
  if (qp) token = qp;
}
```
This is the existing pattern for reading a query-string parameter off the WS handshake `req.url`. `historyWindow` follows the same shape: read `urlObj.searchParams.get("historyWindow")`, parse as int, validate (positive integer within a sane cap — planner picks the cap), default to unbounded on absence.

CONTEXT.md `<decisions>` § "Claude's Discretion" leaves the exact wire shape open (query param vs first WS message payload vs field on `openClaudeSessionSubscribe` payload). **Recommendation for the planner:** query string is the smallest diff (mirrors the JWT fallback pattern above; the tail-command construction happens at connect-time in `startActiveSessionFlow` around **L5210**, which is downstream of the JWT/URL parsing; the value is naturally available there).

**Wire read to plumb through:**
```typescript
// After JWT auth block, before ownedUploadBatches init at ~L1684:
const urlObj = new URL(req.url || "", "http://localhost");
const historyWindowRaw = urlObj.searchParams.get("historyWindow");
const historyWindow: number | null = (() => {
  if (!historyWindowRaw) return null; // unbounded — backcompat
  const n = Number.parseInt(historyWindowRaw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > /* planner cap */ 5000) return null;
  return n;
})();
```

Then thread `historyWindow` into the `tailSessionFile(sshConn!, sessionFile, onLine, onError)` calls at **L2826** and **L5210** — either as a 5th arg or via a small helper.

---

**Analog for the `fetch_older` WS request handler:** the extracted `handleIdentityGetRoleFile` helper at **L717-793** — SAME SHAPE (validate args, do the SSH work, ws.send the response, catch and emit error-shape response).

**Extracted-handler + test-seam pattern** (from role-file handler L736-793):
```typescript
export async function handleIdentityGetRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown };
  // validate...
  try {
    // do the SSH work (readRoleFile / execCommand)
    ws.send(JSON.stringify({ type: "identity:role-file", markdown }));
  } catch (err: unknown) {
    sshLogger.error("identity:get-role-file error", err, { ... });
    ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: err.message }));
  }
}
```

**Apply the SAME shape for `fetch_older`:** `handleFetchOlder(ws, msg, sshConn, currentSessionFile, ...)` — validate `msg.anchor` + `msg.count`, run the range read, parse each line via `parseSessionLine`, emit the batch, catch and emit error-shape.

**Dispatch site in the msg switch** — the aside_arm handler at **L4197-4215** is a good micro-analog for a per-connection stateful message (state, arm, no-op if precondition unmet, sshLogger.info diagnostic, await async work):
```typescript
if (msg.type === "aside_arm") {
  const state = asideState.get(ws);
  if (!state) return;
  if (state.armed || state.displayed) return;
  if (!sshConn || !currentTmuxSession) return;
  state.armed = true;
  // ... diag log ...
  await injectBtw(sshConn, currentTmuxSession);
  return;
}
```

**Apply the same shape for `fetch_older` dispatch:**
```typescript
if (msg.type === "fetch_older") {
  if (!sshConn || !currentSessionFile) {
    // send empty batch or error frame so client doesn't hang; planner picks
    ws.send(JSON.stringify({ type: "fetch_older_batch", frames: [], error: "no session" }));
    return;
  }
  await handleFetchOlder(ws, msg, sshConn, currentSessionFile, ...);
  return;
}
```

Register the test seam alongside `__handleIdentityCountBountiesForTests` at **L715** and `__applyInputMessageForTests` at **L4311** vicinity — the module already exports `__*ForTests` seams as the standard test-drive pattern.

---

**Observation channel — do NOT touch:** the `onLine` handler at **~L2014**, the parseSessionLine switch at **L2394-2472**, layer1-detect / context-pct-from-jsonl / plan-pending-parser / backgroundedAgents/Shells / dormant-poll — all continue to receive every line from the whole-file tail. Only the QUANTITY of lines the tail starts with changes; every line that arrives still fans out to observation-channel derivations. This is stated verbatim in CONTEXT.md `<decisions>` § "Observation channel UNTOUCHED."

---

### 3. Backend range-read helper (new function or new file — planner picks)

**Analog:** `src/backend/claude-session/context-pct-from-jsonl.ts` (whole file, 157 lines). This is the exact shape a `fetch_older` range read needs: one-shot SSH exec, timeout-race, catch-and-return-null (or error-shape), parse output line by line.

**Imports pattern** (context-pct-from-jsonl.ts L1-2):
```typescript
import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";
```

**Timeout constant pattern** (L61-63):
```typescript
const EXEC_TIMEOUT_MS = 3000;
```

**Core one-shot exec pattern** (L74-100):
```typescript
export async function readContextPctFromJsonl(
  conn: Client,
  sessionFile: string,
): Promise<number | null> {
  const tailCmd = `tail -c ${TAIL_BYTES} '${sessionFile}'`;
  let tailOutput: string;
  try {
    tailOutput = await Promise.race([
      execCommand(conn, tailCmd),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`tail timeout after ${EXEC_TIMEOUT_MS}ms`)), EXEC_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }
  // ... process tailOutput.split("\n")
}
```

**Apply this shape for `readSessionFileRange(conn, sessionFile, startLine, endLine): Promise<ParsedLine[] | null>`:**
- Shell primitive: CONTEXT.md § "Claude's Discretion" leaves the choice open — `sed -n 'M,Np' <file>` OR `awk 'NR>=M && NR<=N' <file>` OR a small Node-side stream reader. Planner picks. `sed -n` is the closest lexical match to the `tail -c` pattern above (one-shot, small output, no state).
- Path-escaping convention: single-quote wrap the path like L82 (`'${sessionFile}'`) — this is the same convention `session-file-discovery.ts:228-230` uses per L79-82 comment. `sessionFile` is validated upstream by `discoverClaudeSession` so single-quote escape is sufficient.
- Timeout: reuse `EXEC_TIMEOUT_MS = 3000` (or planner picks a slightly larger value if range reads can be bigger than 10KB tails).
- Parse: split on `\n`, feed each line through `parseSessionLine` (imported from `./session-file-parser.js`), collect emission-kind results (`message` / `image` / `relay_outbound` / `relay_inbound` / `malformed`) — DROP `skip` kind.
- Return: array of ParsedLine emission variants OR null on error (same posture as `readContextPctFromJsonl`).

**Return-frame batching** — the caller (WS handler in claude-session-server.ts) then builds the batched response frame containing the array of parsed emissions (with a distinct `type: "fetch_older_batch"` so the client knows they're historical, not live).

---

**Alternative shell-primitive analog if planner picks awk:** `src/backend/claude-session/session-file-discovery.ts:88-94` has a big awk BFS script for pid-tree walking — style is single-line JS string concatenation. Same idiom would work for `awk 'NR>=M && NR<=N'`.

---

**Fallback `execCommand` reference** — `src/backend/ssh/tmux-helper.ts:21-54`:
```typescript
export function execCommand(conn: Client, command: string): Promise<string> {
  sshLogger.info(`[tmux-helper] exec command="${command.slice(0, 80)}"`, { operation: "tmux_exec" });
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) { reject(err); return; }
      let stdout = ""; let stderr = "";
      stream.on("data", (data: Buffer) => { stdout += data.toString("utf-8"); });
      stream.stderr.on("data", (data: Buffer) => { stderr += data.toString("utf-8"); });
      stream.on("error", (err: Error) => { reject(err); });
      stream.on("close", (code: number) => {
        if (code !== 0 && stdout === "") reject(new Error(stderr.trim() || `Command exited with code ${code}`));
        else resolve(stdout.trim());
      });
    });
  });
}
```
Do NOT reimplement — reuse. It's the same helper `readContextPctFromJsonl` uses.

---

### 4. `src/ui/api/claude-session-api.ts` — wire types + connect-with-historyWindow + handle fetch_older_batch frame

**Analog for wire types:** the file itself — the request/response type-pair convention at L450-475 (`IdentityGetIdentityFilePayload` + `IdentityIdentityFileEvent`), L469-475 (`IdentityGetRoleFilePayload` + `IdentityRoleFileEvent`), L814-830 (`IdentityCountBountiesPayload` + `IdentityBountyCountsEvent`).

**Wire type pattern to mirror** (L814-830):
```typescript
export type IdentityCountBountiesPayload = {
  type: "identity:count-bounties";
  targets: BountyCountTarget[];
};

export type IdentityBountyCountsEvent = {
  type: "identity:bounty-counts";
  counts: BountyCountResult[];
};
```

**Apply the same shape for `fetch_older`:**
```typescript
export type FetchOlderPayload = {
  type: "fetch_older";
  anchor: /* planner picks: string (eventId) OR number (line offset) — see CONTEXT.md § "Claude's Discretion" */;
  count: number;
};

export type FetchOlderBatchEvent = {
  type: "fetch_older_batch";
  frames: Array< /* union of StreamEvent variants — mirror the same types used in the switch at PrettyView.tsx:1290+ */ >;
  reachedBeginning?: boolean; // set by server when startLine <= 1
  error?: string;
};
```

Also export these from a shape that `PrettyView.tsx`'s `ClaudeSessionServerEvent` union already covers, so the L1246 `onmessage` switch can add a `case "fetch_older_batch":` branch.

---

**Analog for `openClaudeSessionSocket()` extension:** the current function at L14-23:
```typescript
export function openClaudeSessionSocket(): WebSocket {
  const scheme = /* ... */ ? "wss:" : "ws:";
  const host = /* ... */;
  const url = `${scheme}//${host}/claude-session/websocket/`;
  return new WebSocket(url);
}
```

**Extend with optional param:**
```typescript
export function openClaudeSessionSocket(opts?: { historyWindow?: number }): WebSocket {
  const scheme = /* ... */;
  const host = /* ... */;
  const qp = opts?.historyWindow ? `?historyWindow=${opts.historyWindow}` : "";
  const url = `${scheme}//${host}/claude-session/websocket/${qp}`;
  return new WebSocket(url);
}
```
Backcompat: no-arg call still works (returns unbounded). Callers that opt in pass `{ historyWindow: N }`. PrettyView.tsx L1219 is the ONE caller in production that will start passing the param.

---

### 5. `src/ui/features/pretty-view/PrettyView.tsx` — delete virtualizer, add plain-DOM scroller + fetch_older client

**Analog:** the file itself. The deletion targets are stated in CONTEXT.md `<decisions>` § "Deletion scope."

**Deletion targets** (extracted from the current file — planner sees exact lines during PLAN construction):
- L199-232: `estimatePvBubbleSize` + `getMessageText` — delete entirely.
- L925-1030: virtualizer setup (`useVirtualizer`, `observeElementRect`, `initialRect`, `scrollMargin`, `getItemKey`, `estimateSize`) — delete entirely.
- L2360-2450: virtualized render (sized container div + `rowVirtualizer.getVirtualItems().map` + absolute-positioned children) — replace with plain in-flow `.map` over `messages`.
- L2354-2358: the `overflow-anchor:none` Tailwind class on the outer scroll container — **REMOVE `[overflow-anchor:none]`** so the browser's default `overflow-anchor: auto` takes effect. CONTEXT.md `<decisions>` § "`overflow-anchor: auto` is load-bearing" explicitly requires this.
- Import cleanup: `useVirtualizer`, `VirtualItem` from `@tanstack/react-virtual` — delete.

**New plain-DOM scroller shape** (planner picks CSS concretely per CONTEXT.md § "Claude's Discretion" — any structure that has a scrollable overflow, does NOT set `overflow-anchor: none`, and renders each message as an in-flow child). Minimal skeleton:
```tsx
<div
  ref={composeScrollRefs}
  className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3"
  // NOTE: [overflow-anchor:none] REMOVED — browser default overflow-anchor:auto is load-bearing
>
  {messages.map((m) => (
    <div key={m.eventId} data-pv-bubble data-event-id={m.eventId}>
      {/* existing bubble branch — ChatMessage / ImageBubble / RelayOutboundBubble /
          RelayInboundBubble / MalformedBubble — copy verbatim from L2409-2446 */}
    </div>
  ))}
  {/* Existing accessory siblings: WipBubble / PlanPendingBubble / AsideBubble / etc.
      keep as siblings of the message-list container inside the outer scroll — same
      layout invariant CONTEXT.md § Success criteria #8 established in Phase 27. */}
</div>
```

Preserve `data-pv-bubble` attribute — it's the empirical DOM-count hook the test infra relies on (see `PrettyView.virtualization.test.tsx:264-283` for the offsetHeight override keyed on this attribute).

---

**Analog for the WS `onmessage` switch extension:** the current switch at **L1290-1362**:
```typescript
switch (parsed.type) {
  case "message": {
    setMessages((prev) => appendDedup(prev, parsed));
    // ... autoplay logic ...
    break;
  }
  case "image": { setMessages((prev) => appendDedup(prev, parsed)); break; }
  case "relay_outbound": { setMessages((prev) => appendDedup(prev, parsed)); break; }
  // ...
}
```

**Add a `fetch_older_batch` case** that PREPENDS to `messages[]` (not appends). Live-tail messages come through the existing `message` / `image` / `relay_*` cases and go through `appendDedup` unchanged. The prepend path needs its own dedup:
```typescript
case "fetch_older_batch": {
  setMessages((prev) => {
    const existing = new Set(prev.map((m) => m.eventId));
    const fresh = parsed.frames.filter((f) => !existing.has(f.eventId));
    return [...fresh, ...prev]; // PREPEND
  });
  break;
}
```

**Drop-oldest logic** — applies to the LIVE-append path (existing `case "message"` / `case "image"` / etc.). Wrap `appendDedup` with a cap check:
```typescript
function appendDedupWithCap(prev: StreamEvent[], next: StreamEvent, cap: number): StreamEvent[] {
  if (prev.some((m) => m.eventId === next.eventId)) return prev;
  const withNew = [...prev, next];
  if (withNew.length <= cap) return withNew;
  return withNew.slice(withNew.length - cap); // drop oldest
}
```
Or introduce a separate `dropOldestIfOverCap(messages, cap)` and run it after `appendDedup` — planner picks the cleaner split. CONTEXT.md § "Working set" leaves the cap `M` for the planner to pick with rationale (starting point 150).

**Aside-arm backwards-walk at L2056** — CONFIRMED SAFE per CONTEXT.md `<decisions>` § "Aside-arm suppression walk." No changes required; drop-oldest never drops the newest, so `messages[messages.length-1]` walking backward always finds the last user turn.

---

**Analog for fetch_older CLIENT REQUEST** — the one-shot request/response pattern from `claude-session-api.ts` L846-889 (`countIdentityBounties`):
```typescript
export function countIdentityBounties(targets: BountyCountTarget[]): Promise<IdentityBountyCountsEvent> {
  return new Promise((resolve, reject) => {
    let responded = false;
    const sock = openClaudeSessionSocket();
    sock.onopen = () => {
      const payload: IdentityCountBountiesPayload = { type: "identity:count-bounties", targets };
      try { sock.send(JSON.stringify(payload)); } catch { /* mid-close */ }
    };
    sock.onmessage = (event) => {
      // ... parse, filter by type, resolve, close ...
    };
    // ... failure handlers ...
  });
}
```

However — `fetch_older` uses the EXISTING PrettyView WS (already open), NOT a fresh socket. The pattern to apply is closer to how PrettyView sends other messages via `wsRef.current`:
```typescript
// From PrettyView.tsx L1230:
ws.send(JSON.stringify(payload));
```

**Trigger site for `fetch_older`** — a new scroll-listener (or extension of use-auto-scroll's scroll listener) that fires when the user scrolls within ~500px of the top of the loaded window AND the oldest loaded message isn't the file's first line. CONTEXT.md § "Load-older UX" specifies the trigger + debounce. Planner picks exact threshold and debounce.

---

### 6. `src/ui/features/pretty-view/use-auto-scroll.ts` — rewrite to ~50 lines

**Analog:** the file itself, specifically **L161-183** — the "Case 2b — pill-visibility RO" block. This is the seed of the new hook because it already implements the "callback ONLY updates state" decoupling that the Phase 43 hook needs across the board.

**Current seed pattern** (L161-183):
```typescript
useEffect(() => {
  if (!scrollEl) return;
  const ro = new ResizeObserver(() => {
    const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD);
  });
  ro.observe(scrollEl);
  // ...
}, [scrollEl]);
```

**Target rewrite shape** (per CONTEXT.md `<decisions>` § "Frontend simplifications enabled"):
```typescript
const BOTTOM_EPSILON = 100; // px — same threshold as current L61

export function useAutoScroll(paneKey: string, messageCount: number) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => setScrollEl(el), []);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
  const pinnedRef = useRef<boolean>(true);

  // Update pinned state from scroll events. No delta heuristics, no
  // programmatic-write filtering — with virt gone, all scroll events are
  // real user scrolls or genuine scrollHeight-driven auto-anchor writes.
  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = () => {
      const dist = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const pinned = dist <= BOTTOM_EPSILON;
      pinnedRef.current = pinned;
      setIsPinnedToBottom(pinned);
    };
    onScroll(); // seed
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // Follow-when-pinned: when messages grow AND we're pinned, jump to bottom.
  useEffect(() => {
    if (!scrollEl) return;
    if (!pinnedRef.current) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl, messageCount]);

  // Explicit action for jump-to-bottom pill.
  const scrollToBottomAndFollow = useCallback(() => {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    pinnedRef.current = true;
    setIsPinnedToBottom(true);
  }, [scrollEl]);

  return { scrollRef, scrollToBottomAndFollow, isPinnedToBottom };
}
```

**Delete every construct listed in CONTEXT.md `<decisions>` § "Deletion scope":**
- `programmaticRef` — no more virtualizer writes to filter (L87, L93-99, L193).
- `MEASUREMENT_DELTA_IGNORE_PX` + the <20px delta heuristic (L70, L204-208).
- `stickyRef` + sticky-vs-pinned split — collapse to a single `pinnedRef` (L86, L107-113, L211-214).
- rAF chain for STICK_ARM_MS (L61, L102-123, L230-237).
- MutationObserver for per-child RO tracking (L149-183) — no accessories to observe anymore because `overflow-anchor:auto` handles scrollHeight changes natively.
- Tall-bubble jump-to-different-area protection — the whole 2026-08-13 correction becomes moot because there's no virtualizer to write scrollTop mid-scroll.

**Signature preserves API surface** — same three returned fields (`scrollRef`, `scrollToBottomAndFollow`, `isPinnedToBottom`) so PrettyView.tsx's consumer sites don't need refactoring.

---

### 7-9. Deletions

**`PrettyView.virtualization.test.tsx`, `PrettyView.estimateSize.test.tsx`, `@tanstack/react-virtual` dep** — no analog (deletion). CONTEXT.md `<decisions>` § "Deletion scope" enumerates these explicitly. Verify `git grep react-virtual` after removal returns zero hits before finalizing PLAN.

---

### 10. NEW test: `PrettyView.windowed-pagination.test.tsx`

**Analog:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (the file being deleted). The JSDOM infrastructure it establishes is exactly what the new test needs — ResizeObserver polyfill, HTMLElement.prototype.offsetHeight override on `[data-pv-bubble]`, WS-stub factory, fireWsMessage helper.

**Imports pattern** (L38-99):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
// WS stub scaffolding (verbatim from PrettyView.test.tsx)
type WsStub = { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; /* ... */ };
const wsStubs: WsStub[] = [];
vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => { /* factory ... */ }),
}));
// ... other mocks: compose-drafts-api, session-hue, IdentityBadge, useIsTouchDevice
import { PrettyView } from "./PrettyView";
```

**WS-frame helpers pattern** (L100-139):
```typescript
function flipToStreaming(ws: WsStub): void { /* onopen + session frame */ }
function fireWsMessage(ws: WsStub, payload: object): void { /* onmessage batch under act() */ }
function fireMessageBatch(ws: WsStub, count: number, makePayload: (i: number) => Record<string, unknown>): void {
  act(() => {
    for (let i = 0; i < count; i++) ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(makePayload(i)) }));
  });
}
```

**ResizeObserver polyfill pattern** (L246-262) — REUSE the widened capturing stub verbatim; it works for the plain-DOM path too.

**offsetHeight override pattern** (L285-320) — REUSE the `[data-pv-bubble]` selector override; it gives every message bubble a known non-zero height so scroll-position calculations in the new hook are deterministic.

**Test cases the new file must land (CONTEXT.md `<decisions>` § "Claude's Discretion" § "Test coverage shape"):**
1. Initial connect emits only last-N frames (mock backend replays N; assert `messages.length === N` after streaming).
2. `fetch_older` sends payload and client prepends response (mock backend responds with a batch of older frames; assert prepended IDs appear at the top of the rendered list).
3. Drop-oldest fires when `messages.length > M` on live-append (fire M+1 message frames; assert oldest is gone from DOM).
4. Refetch-on-scroll-back rehydrates a dropped range (scroll to top after a drop cycle; assert a `fetch_older` was sent; simulate response; assert prepended).
5. Auto-scroll follows-when-pinned (fire message while pinned; assert `scrollTop === scrollHeight`).
6. Auto-scroll doesn't yank when scrolled up (set scrollTop to 0; fire message; assert scrollTop unchanged).
7. `overflow-anchor` is not disabled anywhere in the tree (query the scroll container's className; assert `overflow-anchor:none` is absent; assert `overflow-anchor:auto` is either default or explicit).

---

### 11. NEW test: `use-auto-scroll.test.ts`

**Analog:** other hook tests in the same directory. `use-pretty-view-uploads.test.ts` (L1-30 preamble) shows the pattern: import the hook, mount it inside a test harness component, drive it with acted-on state changes, assert on the returned object's fields.

The rewritten `useAutoScroll` is small enough that a single test file covering the three effects (scroll listener, message-count follow, jumpToBottom action) is sufficient. Assert the returned `isPinnedToBottom` toggles correctly across scroll events and that `scrollToBottomAndFollow()` sets `scrollTop = scrollHeight`.

---

### 12. NEW test: `claude-session-server.fetch-older.test.ts`

**Analog:** `src/backend/claude-session/claude-session-server.count-bounties.test.ts` (whole file). Same shape needed for `fetch_older`.

**Test-seam import pattern** (count-bounties.test.ts L47):
```typescript
import { __handleIdentityCountBountiesForTests } from "./claude-session-server.js";
```

**Apply for fetch_older:** the new handler `handleFetchOlder` gets a companion `__handleFetchOlderForTests` export (planner: add alongside `__handleIdentityCountBountiesForTests` at L715).

**Mocking pattern** (count-bounties.test.ts L28-46):
```typescript
vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));
vi.mock("./identity-artifact-reader.js", async (importOriginal) => {
  const actual = await importOriginal<...>();
  return { ...actual, readIdentityBountyCounts: vi.fn() };
});
```

**Apply for fetch_older:** mock `execCommand` from `tmux-helper.js` (or mock the new `readSessionFileRange` helper directly if extracted). Drive `__handleFetchOlderForTests` with a fake ws + mocked SSH conn + anchor/count args; assert the shell command constructed matches `sed -n 'M,Np' <escaped-path>` (or awk equivalent — whatever the planner picks) and that the response frame's `type` and `frames` array match expectation.

**WS stub pattern** (count-bounties.test.ts L64-69):
```typescript
let sent: CountsMsg[];
const wsStub = {
  send: vi.fn((raw: string) => { sent.push(JSON.parse(raw) as CountsMsg); }),
};
```
Reuse verbatim.

**Test-drive pattern** — the compose-send test's `__applyInputMessageForTests` shape at `claude-session-server.compose-send.test.ts:42-100` is even closer if the handler takes small primitive args (no full ws in the seam):
```typescript
it("input: happy path", async () => {
  const exec = vi.fn();
  await __applyInputMessageForTests({ sshConn, currentTmuxSession, ... execCommand: exec, data: "hello" });
  expect(exec).toHaveBeenCalledWith(sshConn, /* expected command */);
});
```
Planner picks which seam shape matches — depends on whether `handleFetchOlder` closes over per-connection state (then ws-stub shape; count-bounties analog) or is a pure function of inputs (then apply-shape; compose-send analog).

---

## Shared Patterns

### Frame emission → wire type discipline

**Source:** `src/backend/claude-session/session-file-parser.ts` L48-123 (ParsedLine union) + `claude-session-server.ts` L2394-2472 (parseSessionLine emission switch) + `claude-session-api.ts` L25-58 (frontend wire types).

**Apply to:** every new emission from the `fetch_older` handler. The frames the range-read handler returns MUST be built from the same `parseSessionLine` output the live-tail path uses — do NOT invent a new parser, do NOT normalize keys, do NOT change field shapes. CONTEXT.md `<decisions>` § "Backend contract additions" locks this: *"Server does a one-shot ssh exec to read the target line range from the JSONL file (`sed -n 'M,Np'` or equivalent; planner picks the shell primitive), parses each line through `parseSessionLine`, and emits the parsed frames back as a batched response (typed distinctly from live-tail frames so the client knows they're historical)."*

The batched response's inner frames should be objects with the SAME shape as live-tail frames (`{ type: "message", role, content, eventId, ts }` etc. per L2404-2472) so the client's prepend path can dedup them by `eventId` against the existing `messages[]` without special-casing.

### Path escaping for SSH exec

**Source:** `session-file-tail.ts:27-29` (local `shellEscape`) + `context-pct-from-jsonl.ts:82` (single-quote wrap without helper, per L79-82 comment) + `identity-artifact-reader.ts:250-258` (another local `shellEscape`).

**Apply to:** the new range-read helper's shell command construction. `sessionFile` is validated by `discoverClaudeSession` upstream so single-quote wrap is sufficient per the `context-pct-from-jsonl.ts` precedent. If planner picks awk, still single-quote wrap the path arg.

### Extracted handler + test-seam export

**Source:** `claude-session-server.ts:717-793` (`handleIdentityGetRoleFile` + `__handleIdentityCountBountiesForTests` at L715) + `claude-session-server.compose-send.test.ts:31-35` (import shape).

**Apply to:** the new `handleFetchOlder` function. Extract to module scope (not inline in the msg switch) so vitest can drive it directly without spinning up a WSS + ssh2 pair. Export a `__handleFetchOlderForTests` seam.

### WS request/response with error-shape response frame

**Source:** `handleIdentityGetRoleFile` L744-746 (invalid arg case), L768 (host-not-found case), L790 (thrown error case) — all send an event of the RESPONSE type with `error: "reason"` field populated and payload fields empty/default.

**Apply to:** `fetch_older_batch` error path. Instead of failing silently or throwing, always send a `{ type: "fetch_older_batch", frames: [], error: "..." }` so the client's onmessage handler sees a definite response and can clear any loading indicator.

### Backcompat via opt-in parameter

**Source:** CONTEXT.md `<decisions>` § "Backcompat / migration" locks: *"client requests `historyWindow` on every new connect once shipped. Legacy clients (any that don't send it) get the current unbounded behavior — the server does NOT unilaterally window emissions unless the client asks."*

**Apply to:** `historyWindow` handshake param — missing/absent/invalid → fall back to unbounded `-n +1` byte-for-byte. Same discipline for the `fetch_older` handler — must be a NEW request type, not a modification of an existing one, so legacy clients that don't send it continue to work.

### Preserve every existing observation-channel derivation

**Source:** `claude-session-server.ts:2014-2393` (`onLine` handler with observation branches: layer1-detect L2044 vicinity, dormant-poll, context-pct-from-jsonl, plan-pending-parser, backgroundedAgents L2200-ish, backgroundedShells L2380).

**Apply to:** the entire backend plan. CONTEXT.md `<decisions>` § "Observation channel UNTOUCHED" mandates this. Only the EMISSION channel (parseSessionLine switch L2394-2472) is affected by the initial-window limit — but even it isn't modified structurally; it just runs against fewer initial lines when `historyWindow` is set.

---

## No Analog Found

None. Every file in Phase 43 has a strong analog:
- Modify-heavy files: the file itself is the analog (self-modification is the shape).
- New backend range-read helper: `context-pct-from-jsonl.ts` is an exact-shape analog.
- New tests: `PrettyView.virtualization.test.tsx` + `claude-session-server.count-bounties.test.ts` + `claude-session-server.compose-send.test.ts` are exact-infrastructure analogs.

---

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet/src/backend/claude-session/` (backend WS server + tail + parser + observation-channel derivations)
- `/home/ubuntu/skynet/src/backend/ssh/` (execCommand, shellEscape convention)
- `/home/ubuntu/skynet/src/ui/api/` (frontend WS client wire types + one-shot request helpers)
- `/home/ubuntu/skynet/src/ui/features/pretty-view/` (component, hook, existing tests, sibling bubbles)

**Files scanned:** ~15 direct reads + ~12 grep-then-read targeted excerpts

**Pattern extraction date:** 2026-08-18

**Key patterns identified (planner-summary):**
1. All new backend request handlers follow the extracted `handleIdentity*` + `__*ForTests` seam pattern — mirror `handleIdentityGetRoleFile` structure.
2. All new SSH exec range reads follow `readContextPctFromJsonl` — one-shot `execCommand` with `Promise.race` timeout, catch-and-return-null on any error.
3. All new wire types follow the `Payload` + `Event` pair convention with the `type` discriminator being the routing key on both sides.
4. All new frontend tests reuse the wsStubs + fireWsMessage + ResizeObserver polyfill + offsetHeight override infrastructure verbatim from `PrettyView.virtualization.test.tsx`.
5. `overflow-anchor:auto` is the browser primitive that replaces the entire virtualizer-vs-user-scroll conflict class — delete every anchor-disabling class, don't reintroduce it under any Tailwind arbitrary-value selector.
6. The observation channel (`onLine` fan-out to 6+ derivations) is a hard-preserve — the WHOLE-FILE tail continues to feed every observation branch even after `historyWindow` bounds the emission channel.
