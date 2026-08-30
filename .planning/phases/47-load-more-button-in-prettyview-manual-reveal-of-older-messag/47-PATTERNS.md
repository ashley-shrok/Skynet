# Phase 47: Load-More Button in PrettyView — Pattern Map

**Mapped:** 2026-08-20
**Files analyzed:** 8 (planner will finalize; this is the working list from CONTEXT.md + orchestrator scope)
**Analogs found:** 8 / 8 (all files have strong in-repo analogs — no from-scratch cases)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/PrettyView.tsx` (MODIFY) | container / hook host | request-response + streaming | itself (existing per-pane state, `handleWake`/`handlePlanApprove` client-send patterns, `messages.map` render loop) | exact (self-modify) |
| `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` (NEW) | presentational component | request-response (3 visible states) | `src/ui/features/pretty-view/DormancyOverlay.tsx` (3-state, `role="status"`, `Button`+`onClick`+disabled, in-flow assistant-aligned bubble) | exact |
| `src/ui/features/pretty-view/use-load-more-older.ts` (NEW; optional per planner) | hook / per-pane state | request-response + effect | `src/ui/features/pretty-view/use-auto-scroll.ts` (per-pane hook, `useCallback`, `useState`, `useRef` mirror pattern, ~86 LOC contract) | role-match |
| `src/ui/api/claude-session-api.ts` (MODIFY) | wire-type module | request-response typed contract | itself (existing `IdentityCountBountiesPayload` / `IdentityBountyCountsEvent` request-response pair; existing 42-alternate `ClaudeSessionServerEvent` discriminated union) | exact (self-extend) |
| `src/backend/claude-session/claude-session-server.ts` (MODIFY) | WS message handler | request-response (bounded batch) | `handleIdentityGetRoleFile` at L738-795 (extracted async handler + `__forTests` seam + input validation + emit-response pattern) | exact |
| `src/backend/claude-session/session-file-parser.ts` (MODIFY; optional per planner) | JSONL parser | file I/O + transform | itself (existing `parseSessionLine` — the range read reuses the SAME line-parse for parity) | exact (self-extend) |
| `src/backend/claude-session/session-file-range-reader.ts` (NEW; planner names this) | reader helper | file I/O (bounded batch) | `src/backend/claude-session/identity-artifact-reader.ts` § `readIdentityFile` L329-363 (LOCAL/REMOTE branch, `conn === null` split, `execWithTimeout`, `fs.readFile` LOCAL / `cat` REMOTE) | role-match (identity artifacts are strings; sessionfile is JSONL — but branch shape is the same) |
| `src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` (NEW) | component test | test | `src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` (small presentational-component tests: render / click / state variants / aria-label lookups) | exact |
| `src/ui/features/pretty-view/PrettyView.load-more.test.tsx` (NEW) | integration test | test | `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` (WS stub scaffolding + `fireMessageBatch` + `findScrollContainer` + Test H `ws.send` payload assertion — this is the DEFINITIVE analog for the new file) | exact |
| `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` (NEW; planner names this) | backend handler test | test | `src/backend/claude-session/claude-session-server.count-bounties.test.ts` (test-seam pattern: import `__handleXForTests`, mock `readIdentityBountyCounts`, `wsStub.send` capture, per-request `expect(sent[0]).toEqual(...)`) | exact |

---

## Pattern Assignments

### `src/ui/features/pretty-view/PrettyView.tsx` (MODIFY — container)

**Analog:** self (in-file precedent for every needed shape)

**Where the changes land:**

**1. Per-pane cap-off state slot** — add alongside the existing state cluster at L312-465:
```typescript
// L312 (verbatim reference for placement — new state slot lives here)
const [messages, setMessages] = useState<StreamEvent[]>([]);
```
Add per-pane `capOff: boolean` and per-pane `loadOlderState: "idle" | "in-flight" | "error"` — reset in the same "fresh pane mount" reset block at L1054-1092:
```typescript
// L1054-1092 — fresh-pane reset block; new state slots MUST reset here too
if (paneKey !== paneKeyRef.current) {
  setMessages([]);
  setStatus("connecting");
  // ... 14 more state resets ...
  paneKeyRef.current = paneKey;
}
```
This is the LOAD-BEARING reset — per CONTEXT.md § Philosophy "Transient across pane lifetimes": close-and-reopen returns to default cap-enforced state.

**2. Conditional cap enforcement** — the 5 `appendDedupWithCap` sites (L1204, 1224, 1230, 1236, 1243) all take the shape:
```typescript
// L1204 — verbatim
setMessages((prev) => appendDedupWithCap(prev, parsed, WORKING_SET_CAP));
```
Post-Phase-47, these 5 sites become:
```typescript
setMessages((prev) => capOff ? appendDedup(prev, parsed) : appendDedupWithCap(prev, parsed, WORKING_SET_CAP));
```
Note: `appendDedup` (no cap) already exists at L197-203 — Phase 45 kept it as a documented pair per plan 43-07b key-decisions. Phase 47 activates it.

**3. Client-to-server send handler** — mirror `handleWake` at L626-637 byte-for-byte for the load-older request:
```typescript
// L626-637 (verbatim — copy shape for handleLoadOlder)
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
The new `handleLoadOlder` copies this shape: readyState guard → `ws.send(JSON.stringify(payload))` → set in-flight state → try/catch swallow. Deps: `[]` (reads only refs) — same as `handleWake`.

**4. New WS server-to-client handler branch** — insert alongside the `switch (parsed.type)` at L1168 (after `case "malformed_line"` L1239-1245):
```typescript
// L1239-1245 (structural analog for the new case branch)
case "malformed_line": {
  setMessages((prev) => appendDedupWithCap(prev, parsed, WORKING_SET_CAP));
  break;
}
```
The new case for the range-response frame will `setMessages(prev => [...olderBatch, ...prev])` (PREPEND, not append) after dedup — this is the key departure from every existing handler.

**5. Scroll-anchoring on prepend** — CONTEXT.md § "What would make it wrong" locks: `"clicking the button and getting older messages caused the view to jump to the top or bottom of the list, that would miss the point."` The prepend must preserve scroll position visually. Existing pattern for reference is `useAutoScroll` at L740:
```typescript
// L740 — hook returns { scrollRef, scrollToBottomAndFollow, isPinnedToBottom }
const { scrollRef, scrollToBottomAndFollow, isPinnedToBottom } = useAutoScroll(paneKey, messages.length);
```
Phase 43 stripped custom scroll-anchoring logic in favor of the browser's `overflow-anchor: auto` (see use-auto-scroll.ts § "overflow-anchor:auto is the sole scroll-position authority through measurement changes"). The Phase 47 prepend path benefits from this: browser's native scroll-anchoring should hold position when content is prepended above the anchor node. Planner: test this in the JSDOM test harness before adding manual scrollTop-preservation logic.

**6. Button mount site** — mount the `LoadMoreOlderButton` at the TOP of the message-list scroll container, immediately above the `messages.map` at L2257:
```typescript
// L2257 (existing render — new button mounts ABOVE this)
{messages.map((m) => (
  <div key={m.eventId} data-pv-bubble ...>
```
The button is a sibling of the `.map()` inside the same `overflow-y-auto` container at L2244. Same structural convention as accessory siblings (WipBubble/WaitingBubble/PlanPendingBubble) at L2318+ — plain in-flow child of the scroll container.

**7. Button visibility gate** — CONTEXT.md § "What would make it wrong": *"If the button appeared on a conversation that has no older messages behind it (all fifteen messages of a short conversation are already visible), it would be a lie."* Visibility depends on server-derived "has older" signal. The connection-init `session` frame (parsed.type === "session" at L1197-1201) is the natural site to receive a `hasOlder: boolean` OR `totalLines: number` companion field. Planner picks wire shape.

---

### `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` (NEW — presentational component)

**Analog:** `src/ui/features/pretty-view/DormancyOverlay.tsx` (three-state component with same aesthetic domain — pretty-view in-flow bubble with Button + status + variant treatment)

**Imports pattern** (DormancyOverlay.tsx L56-58):
```typescript
import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
```
For Phase 47's button, swap `Moon` for a suitable lucide glyph (planner picks — `ChevronUp` or `History` are candidates from lucide-react); the `cn` + `Button` imports remain identical.

**Three-state discrimination pattern** (DormancyOverlay.tsx L86-89):
```typescript
export function DormancyOverlay({
  waking, elapsedSeconds, onWake, error,
}: DormancyOverlayProps): JSX.Element {
  // Error variant: warm-red card (only in asleep state, not during waking).
  // When the wake fails, overlay goes back to asleep (waking=false) with error set.
  const showError = !waking && error != null;
```
For load-more: derive the 3 states as `status: "idle" | "in-flight" | "error"` prop (planner picks flat prop vs derived-from-multiple-props). DormancyOverlay's error-only-in-asleep-state pattern is directly transferable — error state must NOT block re-click (retry contract per CONTEXT.md § "Fail visibly").

**Accessible three-state aria-label** (DormancyOverlay.tsx L99-105):
```typescript
role="status"
aria-label={
  showError
    ? `Wake failed — ${error}`
    : waking
      ? "Waking identity session…"
      : "Session is asleep — tap Wake to restart"
}
```
Copy this exact structural pattern for the load-more button:
```typescript
aria-label={
  status === "error"
    ? `Couldn't load older messages — ${error} — tap to retry`
    : status === "in-flight"
      ? "Loading older messages…"
      : "Load older messages"
}
```

**Disabled during in-flight** — CONTEXT.md § "What would make it wrong": *"If clicking rapidly kicked off multiple concurrent requests and the results arrived out of order (or produced duplicates), the pane's top would become a mess. The single-request-in-flight rule with the disabled state during flight is what prevents this."*

Analog: ComposeBox Send button at ComposeBox.tsx L2509 already implements this exact pattern:
```typescript
// ComposeBox.tsx L2508-2509 (verbatim)
onClick={asideActive ? () => onAsideDismiss?.() : () => handleSend(undefined, "send-button")}
disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}
```
Copy shape: `disabled={status === "in-flight"}` — click-through blocked during flight.

**Spinner glyph pattern** (ComposeBox.tsx L2551-2564) — the LOCKED symmetric twin-arc spinner. Same 2 commits back (ab00cc61 → df4d7543): Ashley explicitly rejected `lucide's Loader2` for the wobbling-centroid issue. Copy VERBATIM:
```typescript
// ComposeBox.tsx L2552-2564
<svg
  className="size-6 animate-spin"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth={2}
  strokeLinecap="round"
  strokeLinejoin="round"
  aria-hidden="true"
>
  <path d="M21 12 A9 9 0 0 0 12 3" />
  <path d="M3 12 A9 9 0 0 0 12 21" />
</svg>
```
This is a repo-wide convention (Ashley 2026-08-19 commit df4d7543); the new load-more button MUST use this same spinner for in-flight state, not `Loader2` or `animate-spin` on a lucide glyph.

**Button + wrapper pattern** (DormancyOverlay.tsx L181-193):
```typescript
{!waking && (
  <div className="pt-1">
    <Button
      size="sm"
      variant="secondary"
      className="cursor-pointer"
      onClick={onWake}
      aria-label="Wake identity"
    >
      Wake
    </Button>
  </div>
)}
```
Copy this button-in-wrapper shape. `size="sm" variant="secondary"` is the pretty-view convention for in-flow secondary actions.

**Presentational purity** (AsideBubble.tsx L40-42 principle):
```typescript
// Purity: this is a pure function of props — no state, no effects, no
// refs, no event handlers. Dismiss lives on the ComposeBox morph (Wave 4)
// via the X (Resume) button. The bubble itself is passive display.
```
Copy this posture for LoadMoreOlderButton: pure display, all state lives in parent (PrettyView.tsx or the hook). Click handler is a passed-in `onClick` prop; no state hooks inside the component.

---

### `src/ui/features/pretty-view/use-load-more-older.ts` (NEW — optional hook; planner decides inline vs extracted)

**Analog:** `src/ui/features/pretty-view/use-auto-scroll.ts` (per-pane hook that composes state + effects + refs, exposes a small stable API surface)

**Hook signature convention** (use-auto-scroll.ts L30-36):
```typescript
export interface UseAutoScrollResult {
  scrollRef: (el: HTMLElement | null) => void;
  scrollToBottomAndFollow: () => void;
  isPinnedToBottom: boolean;
}

export function useAutoScroll(_paneKey: string, messageCount: number): UseAutoScrollResult {
```
Copy this shape:
```typescript
export interface UseLoadMoreOlderResult {
  status: "idle" | "in-flight" | "error";
  error: string | null;
  capOff: boolean;
  handleClick: () => void;
}
export function useLoadMoreOlder(paneKey: string, wsRef: React.RefObject<WebSocket | null>): UseLoadMoreOlderResult {
```
(Planner picks final shape; the point is the small stable surface.)

**useCallback + useRef mirror pattern** (use-auto-scroll.ts L44-46 + L74-79):
```typescript
const [isPinnedToBottom, setIsPinnedToBottom] = useState<boolean>(true);
const pinnedRef = useRef<boolean>(true);
// ...
const scrollToBottomAndFollow = useCallback(() => {
  if (!scrollEl) return;
  scrollEl.scrollTop = scrollEl.scrollHeight;
  pinnedRef.current = true;
  setIsPinnedToBottom(true);
}, [scrollEl]);
```
Ref mirrors state for stale-closure-safe reads inside `useCallback([])`. This is the SAME pattern PrettyView.tsx uses for `autoplayArmedRef` (L487) and `paneStateRef` (L1191). Load-more hook needs the same treatment for the `capOff` flag (since once flipped it must be readable from the WS onmessage handler without stale-closure risk).

**Reset-on-paneKey-change pattern** — the hook's state must reset when paneKey changes (CONTEXT.md § "Transient across pane lifetimes"). Analog in PrettyView.tsx L1054-1092 (see MODIFY section above). If the hook takes `paneKey`, the reset lives in a `useEffect([paneKey])` inside the hook.

---

### `src/ui/api/claude-session-api.ts` (MODIFY — wire-type module)

**Analog:** self (rich in-file precedent for both request-response and typed union extension)

**Client-to-server payload type** — copy shape from `RawKeystrokesPayload` at L362-365:
```typescript
// L362-365 (verbatim)
export type RawKeystrokesPayload = {
  type: "raw_keystrokes";
  bytes: string;
};
```
New Phase 47 payload:
```typescript
export type FetchOlderRangePayload = {
  type: "fetch_older_range"; // planner picks final type name — MUST NOT be "fetch_older"
  cursor: { eventId: string } | { beforeLine: number }; // planner picks cursor shape
  count: number; // planner locks — CONTEXT.md § scope-edges: "The batch size stays at twenty"
};
```

**IMPORTANT: forbidden type name** — CONTEXT.md orchestrator note + PrettyView.hydration-cap.test.tsx Test H at L614-688 asserts:
```typescript
// PrettyView.hydration-cap.test.tsx L679-682
return (
  parsed.type === "fetch_older" ||
  parsed.type === "fetch_older_batch"
);
```
This test locks that NO frame with `type: "fetch_older"` or `type: "fetch_older_batch"` is ever sent by the client. The Phase 47 wire contract MUST pick a NEW type name (e.g. `fetch_older_range` / `load_older_batch` / `pv_load_older` — planner names it) or Test H fails and Phase 47 accidentally resurrects the Phase 43 contract that Phase 45 explicitly ripped out.

**Server-to-client response type** — copy shape from `IdentityBountyCountsEvent` at L852-855:
```typescript
// L852-855 (verbatim)
export type IdentityBountyCountsEvent = {
  type: "identity:bounty-counts";
  counts: BountyCountResult[];
};
```
New Phase 47 response:
```typescript
export type FetchOlderRangeBatchEvent = {
  type: "fetch_older_range_batch"; // planner picks final name
  messages: StreamEvent[]; // or ChatMessageEvent[] | ImageEvent[] | ... — matches the union used by PrettyView.messages[]
  hasMore: boolean; // false = client has reached start of file; hides button
  error?: string; // present on failure; drives 3-state error variant
};
```

**Add to the union** at L272-314:
```typescript
// L272-314 — ClaudeSessionServerEvent discriminated union; extend here
export type ClaudeSessionServerEvent =
  | SessionMetaEvent
  | MessageEvent
  // ... 30+ existing variants ...
  | MalformedLineEvent;
```
Add `| FetchOlderRangeBatchEvent` to the union so PrettyView's `switch (parsed.type)` can exhaustive-match.

**Session frame widening (optional)** — if the button's initial visibility depends on server-side `hasOlder` at connect, widen `SessionMetaEvent` at L25-29:
```typescript
// L25-29 (verbatim)
export type SessionMetaEvent = {
  type: "session";
  pid: number;
  sessionFile: string;
};
```
Additive widening: add `totalLines?: number` (optional so older builds don't break; server always emits post-Phase-47).

**One-shot request helper (OPTIONAL — Phase 47 probably does NOT need this)** — countIdentityBounties at L871-914 shows the one-shot request/response WS-per-call pattern (open, send, wait for response, close). This is NOT the model Phase 47 uses: the load-more request piggybacks on the PrettyView's existing long-lived WS (like `handleWake` at PrettyView.tsx L626 sends `{ type: "wake" }` on the pane's own `wsRef.current`). No new WS lifecycle; no helper module.

---

### `src/backend/claude-session/claude-session-server.ts` (MODIFY — WS handler dispatch)

**Analog:** `handleIdentityGetRoleFile` at L738-795 (extracted async handler with test-seam export)

**Extracted handler pattern** (L738-795):
```typescript
// L738-795 — extract handler out of the switch so vitest can drive directly
export async function handleIdentityGetRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown };
  const rawKey = m.identityKey;
  if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
    try {
      ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "invalid identityKey" }));
    } catch (err) { databaseLogger.warn(...); }
    return;
  }
  // ... body ...
}
// L873
export const __handleIdentityGetRoleFileForTests = handleIdentityGetRoleFile;
```
Copy this shape for the new handler:
```typescript
export async function handleFetchOlderRange(
  ws: WebSocket,
  msg: unknown,
  deps: { sshConn: Client | null; currentSessionFile: string | null; currentHostId: number | null; },
): Promise<void> { /* ... */ }
export const __handleFetchOlderRangeForTests = handleFetchOlderRange;
```
Deps injection (rather than closure capture) is REQUIRED for the test seam — the handler needs `sshConn` + `currentSessionFile` which are connection-scoped `let` bindings inside the WS `wss.on("connection")` block (see L1834 `currentSessionFile` + L2016 comment on capture scope).

**Wire-shape guard pattern** (L744-750 — verbatim):
```typescript
if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
  try {
    ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "invalid identityKey" }));
  } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
  return;
}
```
Guards live BEFORE any I/O. Phase 47 guards to add:
- `cursor` payload well-formed (planner locks shape)
- `count` is a positive integer AND ≤ some cap (defense against a malicious client asking for 1e9 messages)
- `sshConn && currentSessionFile` non-null (no pane bound yet — silently return or emit error frame per planner's call)

**Dispatch site** (L3067 — the main `ws.on("message", ...)` block):
```typescript
// L3067 — main message dispatcher
ws.on("message", async (raw: RawData) => {
  if (stopped) { ... return; }
  let msg: { type?: unknown; ... };
  try { msg = JSON.parse(raw.toString()); } catch { ... return; }

  // ... 15 existing `if (msg.type === "...")` branches ...
```
Insert the new branch alongside existing branches (planner picks position — near `raw_keystrokes` at L4349 is natural since both are pane-scoped WS requests that require `sshConn && currentTmuxSession`):
```typescript
if (msg.type === "fetch_older_range") {
  await handleFetchOlderRange(ws, msg, { sshConn, currentSessionFile, currentHostId });
  return;
}
```

**Trust-boundary pattern** — raw_keystrokes handler at L4349-4388 is the canonical pattern for "connection-scoped state IS the authoritative session; ignore client-supplied hostId/tmuxSession":
```typescript
// L4349-4388 — verbatim T-14-02-01 trust-boundary shape
if (msg.type === "raw_keystrokes") {
  if (!sshConn || !currentTmuxSession) return;
  // ... uses currentTmuxSession from connection scope, NEVER from msg ...
}
```
Phase 47 MUST inherit this: the range-read reads `currentSessionFile` from connection scope. Client cannot spoof a session file path.

**Payload-size cap** — raw_keystrokes handler at L4359 sets `MAX_RAW_KEYSTROKES_BYTES = 16 * 1024`. Phase 47 must cap the requested `count` similarly (planner picks — 100 messages? matches the "batch size 20" but leaves headroom for future planner call to widen).

**Session frame emit site** — the `sessionFile` value is set on discovery success at L2803 and emitted to the client. Widening the emitted frame (for the `totalLines` field to gate the button's initial visibility) happens near where the frame is currently constructed. Grep landmark: `ws.send(JSON.stringify({ type: "session", pid, sessionFile }))` — planner uses this to locate the exact emit site.

---

### `src/backend/claude-session/session-file-range-reader.ts` (NEW — reader helper)

**Analog:** `src/backend/claude-session/identity-artifact-reader.ts` § `readIdentityFile` at L329-363 (LOCAL vs REMOTE branch with `conn === null` split)

**LOCAL/REMOTE branch pattern** (identity-artifact-reader.ts L329-363 — verbatim):
```typescript
export async function readIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return { markdown: "" };
      }
      throw err;
    }
  }
  // REMOTE branch — direct interpolation safe: identityKey validated by IDENTITY_KEY_RE
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}
```
Phase 47 range reader — copy the LOCAL/REMOTE branch structure but replace the read with a bounded-line-range read. Candidate REMOTE command (planner picks; may need tail/sed/awk pipelines):
```typescript
// REMOTE — read lines [start, start+count) from file at absolute path
// Path is trusted server-scope state (currentSessionFile, set on discovery success at L2803),
// NEVER a client-supplied value. shellEscape via the local helper from session-file-tail.ts:27-29.
const cmd = `sed -n '${startLine},${startLine + count - 1}p' ${shellEscape(sessionFilePath)}`;
```
LOCAL branch (fewer skynet fleet cases use LOCAL for session files — but if the pane's host is in `IDENTITIES_LOCAL_HOST_IDS` the direct fs read is faster):
```typescript
const raw = await fs.readFile(sessionFilePath, "utf-8");
const lines = raw.split("\n");
return { lines: lines.slice(startLine - 1, startLine - 1 + count) };
```

**JSONL parse — reuse existing parser** — call `parseSessionLine` from session-file-parser.ts for each returned line. This is the SAME parser the streaming tail consumers use (session-file-tail.ts → line callback → parseSessionLine in claude-session-server.ts), so the range-fetched messages are parse-shape-identical to the streaming ones. Do NOT invent a second parser.

**Cursor resolution** — CONTEXT.md § Shape: *"the server draws from the same underlying conversation record that fed the initial hydration"*. Client sends a cursor (eventId or line-number); server resolves cursor → line-position in the JSONL, reads `count` older lines, returns them parsed. Prior art: Phase 43 built a `resolveEventIdToLine` helper for this exact job and Phase 45 deleted it (`.planning/phases/45-.../45-CONTEXT.md` § Backend architecture). Planner may reference Phase 43's deleted helper via `git show 8325961d:src/backend/claude-session/session-file-parser.ts` for the resolution algorithm (do NOT reimport the code; rewrite fresh — the Phase 43 helper was tied to a different architecture).

**Bounded batch size** — always ≤ the client-requested `count`, always ≤ a server-side hard cap (planner picks — 100 seems safe; matches the raw_keystrokes 16KB posture).

---

### `src/backend/claude-session/session-file-parser.ts` (MODIFY — parser extension, optional)

**Analog:** self (`parseSessionLine` at the module head — reuse verbatim; no new parser needed for Phase 47's range-read since it returns raw lines that the caller parses)

Phase 47 probably does NOT need to modify this file. The range reader returns raw lines; the caller (handleFetchOlderRange or PrettyView-side) parses each line via the existing `parseSessionLine`. This mirrors how the tail consumers already work — session-file-tail.ts calls `onLine(line)` and the caller feeds each line to `parseSessionLine`. Same seam for range reads.

**If planner discovers a need for a line-range lookup helper** (e.g. locating a line by eventId): the extension goes at the bottom of session-file-parser.ts. Signature pattern from existing `detectRelayOutbound` at L166-199:
```typescript
export function detectRelayOutbound(obj: Record<string, unknown>): { room: string | null; ... } | null {
```
Same posture: exported pure function, no I/O, returns `null` when the input doesn't match, structured object on match.

---

### `src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` (NEW — component test)

**Analog:** `src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` (small presentational-component tests — direct render + assert + click + no WS scaffolding)

**Test setup pattern** (AttachmentChipStrip.test.tsx L1-15):
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttachmentChipStrip } from "./AttachmentChipStrip";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";

function makeAtt(overrides: Partial<StagedAttachmentLike> = {}): StagedAttachmentLike {
  return { tempId: overrides.tempId ?? "t1", ... };
}
```
Copy: import + `render/screen/fireEvent` + factory helper for default props.

**Presence assertion pattern** (AttachmentChipStrip.test.tsx L17-22):
```typescript
it("Test 1: returns null (no wrapper) when attachments is empty", () => {
  const { container } = render(<AttachmentChipStrip attachments={[]} onRemove={vi.fn()} />);
  expect(container.firstChild).toBeNull();
});
```
Adapt for Phase 47: "returns null when hasOlder=false" (button MUST NOT lie per CONTEXT.md § "What would make it wrong").

**Click-fires-callback pattern** (AttachmentChipStrip.test.tsx L57-72):
```typescript
it("Test 4: clicking the × button invokes onRemove with the chip's tempId", () => {
  const onRemove = vi.fn();
  render(<AttachmentChipStrip attachments={[...]} onRemove={onRemove} />);
  const btn = screen.getByLabelText(/Remove attachment two\.txt/i);
  fireEvent.click(btn);
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onRemove).toHaveBeenCalledWith("b");
});
```
Adapt for Phase 47: click fires `onClick` prop; disabled-during-flight blocks the click (assert `onClick` NOT called when status="in-flight").

**Progress-state pattern** (AttachmentChipStrip.test.tsx L74-91):
```typescript
it("Test 5: uploading chip shows progress indicator at correct percentage", () => {
  render(<AttachmentChipStrip attachments={[makeAtt({ status: "uploading", ... })]} onRemove={vi.fn()} />);
  const bar = screen.getByRole("progressbar");
  expect(bar).toBeTruthy();
  expect(bar.getAttribute("aria-valuenow")).toBe("50");
});
```
Adapt for Phase 47: "in-flight state renders spinner" — assert the twin-arc SVG is present (planner picks selector: `container.querySelector("svg.animate-spin")` or add `data-testid` to the SVG).

**Error-variant pattern** (AttachmentChipStrip.test.tsx L93-...):
```typescript
it("Test 6: error status turns chip red and surfaces error text via title/text", () => {
  render(<AttachmentChipStrip attachments={[makeAtt({ status: "error", error: "sftp_error: connection lost" })]} ... />);
```
Adapt for Phase 47: "error state renders retry-invitation aria-label + still clickable".

**Test coverage checklist per CONTEXT.md § Scope edges "In scope":**
1. hidden when no older (analog: Test 1 above)
2. idle → onClick invoked
3. in-flight → disabled (click does NOT invoke onClick)
4. in-flight → spinner rendered
5. error → error text rendered
6. error → clickable (retry contract)
7. three-state aria-label matches expected string

---

### `src/ui/features/pretty-view/PrettyView.load-more.test.tsx` (NEW — integration test)

**Analog:** `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` (the DEFINITIVE analog — same WS-through-PrettyView shape, same JSDOM scaffolding, same fireMessageBatch helper, same scroll-container assertion, and importantly the LOCK on the forbidden `fetch_older` payload type)

**WS stub scaffolding** (PrettyView.hydration-cap.test.tsx L62-102 — copy VERBATIM):
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
function getCurrentWs(): WsStub { return wsStubs[wsStubs.length - 1]; }

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onmessage: null, ... };
    wsStubs.push(ws);
    return ws;
  }),
}));
```

**Full mock stack** (PrettyView.hydration-cap.test.tsx L104-126):
```typescript
vi.mock("@/api/compose-drafts-api", () => ({ getComposeDraft: vi.fn().mockResolvedValue({ body: "" }), ... }));
const useSessionIdentityMock = vi.fn(() => ({ identity: null, identityHue: null }));
vi.mock("@/features/terminal/session-hue", () => ({ sessionMatchKey: vi.fn(() => null), useSessionIdentity: (name) => useSessionIdentityMock(name) }));
vi.mock("@/features/terminal/IdentityBadge", () => ({ IdentityBadge: () => null }));
vi.mock("@/hooks/use-is-touch-device", () => ({ useIsTouchDevice: vi.fn(() => false) }));
```
Copy VERBATIM — same set of mocks is required for PrettyView to render in JSDOM.

**JSDOM offsetHeight override** (PrettyView.hydration-cap.test.tsx L191-227) — verbatim copy required for anything that measures `[data-pv-bubble]` height.

**Frame-firing helpers** (PrettyView.hydration-cap.test.tsx L132-159):
```typescript
function flipToStreaming(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }) }));
  });
}

function fireMessageBatch(ws: WsStub, count: number, makePayload: (i: number) => Record<string, unknown>): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(makePayload(i)) }));
    }
  });
}
```

**Send-payload assertion pattern** (PrettyView.hydration-cap.test.tsx Test H L674-687 — CRITICAL for Phase 47):
```typescript
// Assert that when the load-more button IS clicked, the CORRECT payload type name is sent
// (must NOT be "fetch_older" — that's locked-forbidden by Test H of the hydration-cap spec).
const loadOlderSends = ws.send.mock.calls.filter((call) => {
  const arg = call[0];
  if (typeof arg !== "string") return false;
  try {
    const parsed = JSON.parse(arg);
    return parsed.type === "fetch_older_range"; // planner picks final name
  } catch { return false; }
});
expect(loadOlderSends.length).toBe(1);
```
Same shape used inversely: hydration-cap Test H asserts `fetch_older` sends === 0; Phase 47 asserts the NEW type name sends === 1 (after clicking the button once). The two tests MUST agree on the type name mapping — planner picks a fresh, differently-shaped name.

**Test coverage checklist** (from CONTEXT.md § Scope edges "In scope" — "Test coverage for the flow, the state transitions, and the interaction with incoming live messages while older is loaded"):

1. **Button hidden when no older** — after 5 message frames + session frame with `hasOlder=false`, no button in DOM.
2. **Button visible when older exists** — after session frame with `hasOlder=true`, button is in DOM at top of scroll container.
3. **Click sends the correct payload** — `ws.send.mock.calls` includes exactly one call with the NEW type name (see snippet above). ALSO: assert no `fetch_older` frame was ever sent (parity with hydration-cap Test H).
4. **Click flips cap-off — cap enforcement stops** — pre-click: fire 40 frames, cap holds at 20. Click button, server responds with 20 older, now 40 in DOM. Fire 5 more live-tail frames — DOM grows to 45 (NOT capped back to 20). This is the central Phase 47 behavior lock.
5. **Older messages prepend, not append** — after response arrives, the FIRST bubble in DOM is the OLDEST returned message (not the newest); the previously-top message is now at position `count+1`.
6. **Scroll position preserved on prepend** — assert `scrollContainer.scrollTop` is nonzero after prepend (browser's overflow-anchor preserves position; if it doesn't in JSDOM, planner locks the fix in the code, not just the test).
7. **In-flight blocks concurrent requests** — click button twice rapidly; assert `ws.send.mock.calls` filtered to load-more type has length 1 (single-request-in-flight rule from CONTEXT.md § "What would make it wrong").
8. **Error state on server error frame** — WS delivers `{ type: "fetch_older_range_batch", error: "boom" }`; button renders error state; button remains clickable (retry).
9. **hasMore=false hides button** — response includes `hasMore: false`; button unmounts after successful prepend.
10. **Pane close-and-reopen resets cap** — unmount + remount PrettyView with same paneKey; cap re-enforced from scratch (this is CONTEXT.md § Philosophy "Transient across pane lifetimes"). Consider using paneKey change (different `hostId`/`tmuxSession` prop values) to trigger the fresh-pane reset block at PrettyView.tsx:1054-1092.

---

### `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` (NEW — backend handler test)

**Analog:** `src/backend/claude-session/claude-session-server.count-bounties.test.ts` (test-seam pattern with `__handleXForTests` seam + mocked reader helper + `wsStub.send` capture)

**Mock scaffolding** (count-bounties.test.ts L26-46):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));
vi.mock("./identity-artifact-reader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./identity-artifact-reader.js")>();
  return { ...actual, readIdentityBountyCounts: vi.fn() };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { readIdentityBountyCounts } from "./identity-artifact-reader.js";
import { __handleIdentityCountBountiesForTests } from "./claude-session-server.js";
```
Adapt for Phase 47:
```typescript
vi.mock("./session-file-range-reader.js", () => ({ readSessionFileRange: vi.fn() }));
import { readSessionFileRange } from "./session-file-range-reader.js";
import { __handleFetchOlderRangeForTests } from "./claude-session-server.js";
```

**wsStub + captured-sends pattern** (count-bounties.test.ts L49-77):
```typescript
type CountsMsg = { type: "identity:bounty-counts"; counts: Array<...> };
let sent: CountsMsg[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as CountsMsg);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  // ...
});
```
Copy — same pattern for capturing the handler's `ws.send` calls.

**Test cases pattern** (count-bounties.test.ts L83-...):
```typescript
describe("identity:count-bounties handler — batched per-target read", () => {
  it("empty targets → empty counts array, no throw", async () => {
    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:count-bounties", targets: [] },
      /* userId */ 1,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "identity:bounty-counts", counts: [] });
    expect(connectOneShot).not.toHaveBeenCalled();
  });
```

**Test coverage checklist for Phase 47 backend handler:**

1. **Well-formed request → success response** — valid cursor + count, mock reader returns 20 lines, handler emits `{ type: "fetch_older_range_batch", messages: [...20 parsed messages...], hasMore: true }`.
2. **Missing sshConn or currentSessionFile → silently returns OR emits error** — planner picks; mirrors raw_keystrokes L4350 pattern.
3. **Invalid cursor payload → error response** — malformed cursor shape → emits `{ type: "fetch_older_range_batch", messages: [], error: "invalid cursor" }`.
4. **Count out of bounds → clamped or rejected** — client requests count=1e9 → server caps or rejects (planner locks policy).
5. **Cursor at start of file → hasMore=false** — reader returns fewer lines than requested → response has `hasMore: false`.
6. **Reader throws → error response** — `readSessionFileRange` mock rejects → handler emits `{ type: "fetch_older_range_batch", messages: [], error: "..." }` (does NOT crash the WS).
7. **Malformed JSONL line inside range → skipped or emitted as malformed_line variant** — parity with the streaming tail's `parseSessionLine` malformed handling (see session-file-parser.ts § malformed variant).

---

## Shared Patterns

### Pattern A: Client-to-server one-shot WS send (fire-and-forget over long-lived WS)

**Source:** `src/ui/features/pretty-view/PrettyView.tsx` L626-637 (`handleWake`), L649-657 (`handlePlanApprove`), L659-669 (`handlePlanFeedback`)

**Apply to:** the new `handleLoadOlder` in PrettyView.tsx (or the extracted hook)

```typescript
// Verbatim excerpt from PrettyView.tsx L626-637 — copy shape byte-for-byte
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

Same posture: readyState guard → JSON.stringify → try/catch swallow → local optimistic state flip. Deps `[]` (reads ref, not state).

### Pattern B: Server-side connection-scoped trust-boundary

**Source:** `src/backend/claude-session/claude-session-server.ts` L4349-4388 (raw_keystrokes) + L4291-4309 (aside_arm) + L4326-4334 (aside_dismissed)

**Apply to:** the new `handleFetchOlderRange` — MUST read `currentSessionFile` from connection scope, MUST NOT accept a file path in the client payload

```typescript
// L4349-4356 — verbatim T-14-02-01 trust-boundary shape
if (msg.type === "raw_keystrokes") {
  if (!sshConn || !currentTmuxSession) return;
  const bytes = String((msg as { bytes?: unknown }).bytes ?? "");
  if (bytes.length === 0) return;
  const MAX_RAW_KEYSTROKES_BYTES = 16 * 1024;
  if (bytes.length > MAX_RAW_KEYSTROKES_BYTES) {
    sshLogger.warn("raw_keystrokes rejected: payload too large", ...);
    return;
  }
  // ... uses currentTmuxSession from connection scope, NEVER from msg ...
}
```

### Pattern C: Test-seam export for backend handler

**Source:** `src/backend/claude-session/claude-session-server.ts` L873-874 (`__handleIdentityGetRoleFileForTests`), L717 (`__handleIdentityCountBountiesForTests`)

**Apply to:** `__handleFetchOlderRangeForTests` — required so vitest can drive the handler directly without spinning up WebSocketServer + ssh2

```typescript
// L873-874 — verbatim
export const __handleIdentityGetRoleFileForTests = handleIdentityGetRoleFile;
export const __handleIdentityUpdateRoleFileForTests = handleIdentityUpdateRoleFile;
```

### Pattern D: JSDOM WS test scaffolding

**Source:** `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` L62-102 (WS stub) + L104-126 (companion mocks) + L191-227 (JSDOM offsetHeight override)

**Apply to:** `PrettyView.load-more.test.tsx` — copy VERBATIM per Phase-45-PATTERNS.md § 10 "infrastructure verbatim reuse" — do NOT paraphrase, do NOT extract to a shared helper (existing convention: each test file self-contained)

### Pattern E: Never-import-fetch_older-type-name

**Source:** `src/ui/features/pretty-view/PrettyView.hydration-cap.test.tsx` Test H at L614-688

**Apply to:** every file in Phase 47 that touches wire types — the new payload type MUST NOT be `fetch_older` or `fetch_older_batch`. Test H is a LOCK; Phase 47 accidentally reintroducing the Phase 43 name breaks the fleet test suite and fails ship-readiness.

```typescript
// PrettyView.hydration-cap.test.tsx L679-682 — the assertion that locks the forbidden names
return (
  parsed.type === "fetch_older" ||
  parsed.type === "fetch_older_batch"
);
```

### Pattern F: Twin-arc spinner (repo-wide convention)

**Source:** `src/ui/features/pretty-view/ComposeBox.tsx` L2551-2564 (recent commit df4d7543 — "swap Loader2 for symmetric twin-arc spinner in Send button")

**Apply to:** every in-flight/loading affordance new in Phase 47 (the button's in-flight state)

```typescript
// ComposeBox.tsx L2552-2564 — verbatim, do NOT swap for Loader2
<svg
  className="size-6 animate-spin"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth={2}
  strokeLinecap="round"
  strokeLinejoin="round"
  aria-hidden="true"
>
  <path d="M21 12 A9 9 0 0 0 12 3" />
  <path d="M3 12 A9 9 0 0 0 12 21" />
</svg>
```

### Pattern G: `role="status"` + tri-branch aria-label for state-communicating widgets

**Source:** `src/ui/features/pretty-view/DormancyOverlay.tsx` L98-105

**Apply to:** the LoadMoreOlderButton — screen-reader-visible state must map 1:1 to visual state (idle / in-flight / error)

```typescript
role="status"
aria-label={
  showError
    ? `Wake failed — ${error}`
    : waking
      ? "Waking identity session…"
      : "Session is asleep — tap Wake to restart"
}
```

---

## No Analog Found

None. Every file in Phase 47 has a strong in-repo analog. The one place the mapping is "role-match" rather than "exact" is `session-file-range-reader.ts` — the identity-artifact-reader.ts § readIdentityFile is a shape match (LOCAL/REMOTE branch + conn===null split) but reads markdown strings, not JSONL frames. The new reader will need to compose that branch structure with the raw-lines-returning shape that `session-file-tail.ts` demonstrates (buffered stdout accumulator returning line strings).

---

## Cross-Cutting Callouts (planner MUST propagate to every relevant plan)

1. **NEVER use the type name `fetch_older` or `fetch_older_batch`** — locked forbidden by `PrettyView.hydration-cap.test.tsx` Test H. Fresh type name required. Recommendation: `fetch_older_range` for request + `fetch_older_range_batch` for response (or Ashley/planner names a different pair).

2. **Batch size stays at twenty** — CONTEXT.md § Scope edges "Out of scope: A user-configurable 'how many per click' setting. The batch size stays at twenty." No plan should widen or make this configurable.

3. **No persistence across pane lifetimes** — CONTEXT.md § Philosophy "Transient across pane lifetimes". The `capOff` flag MUST reset in the fresh-pane reset block at PrettyView.tsx:1054-1092.

4. **No auto-scroll-based loading** — CONTEXT.md § Scope edges "Out of scope: Automatic scroll-based loading (infinite-scroll style). Explicitly not this design." No plan should hook the button's onClick to a scroll listener; it is manual-button-only.

5. **Nginx caveat (CLAUDE.md standing directive)** — Phase 47 does NOT add new HTTP routes (all traffic is over the existing `/claude-session/websocket/` WS path). No `docker/nginx.conf` or `docker/nginx-https.conf` changes required. Confirmed by inspecting `openClaudeSessionSocket()` at `src/ui/api/claude-session-api.ts:14-23` — single WS path.

6. **Backend TS compile requires `npm run build:backend`, NOT `tsc --noEmit`** — CLAUDE.md standing directive. Any plan touching `src/backend/claude-session/**` MUST include this in its verification step.

7. **Trust boundary: session file path lives in server connection scope only** — never accept a file path from the client. Follows the T-14-02-01 pattern established by `raw_keystrokes` / `aside_dismissed` / `wake` handlers.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (component + hook analogs)
- `src/ui/api/` (wire-type analogs)
- `src/ui/components/` (Button primitive)
- `src/backend/claude-session/` (WS handler + reader helper + tests)

**Files scanned:** ~35 (targeted via Grep for pattern matches; full-read on 10 files, targeted-read on 5 files, structural-scan on the rest)

**Pattern extraction date:** 2026-08-20

**Key discovery:** The Phase 47 architecture is a near-perfect mirror of Phase 43's `fetch_older` architecture that Phase 45 ripped out — same wire-shape, same handler pattern, same client-side flip-on-first-click model. The ONE hard constraint is: it MUST use a different type name string (`fetch_older`/`fetch_older_batch` are locked-forbidden by hydration-cap Test H). Every other pattern in Phase 47 is a byte-shape mirror of a shipping in-repo pattern; nothing is greenfield.
