# Phase 90: Relay-mediated group conversations sub-slice D — relay-session pane rendering with per-agent badge affordances - Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 18 new + 5 modified
**Analogs found:** 22 / 23

Every new file the slice ships has been classified by role + data-flow and paired with a concrete in-repo analog. Excerpts below are the code the plan-tasks will copy from — not paraphrases. Line numbers are load-bearing.

## File Classification

Green-field surfaces the slice creates (or widens):

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/relay-room-pane/RelayRoomPane.tsx` | pane orchestrator | request-response + subscription | `src/ui/features/pretty-view/PrettyView.tsx` | orchestration-model match (do NOT edit analog per D-03) |
| `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx` | test | — | `src/ui/features/pretty-view/PrettyView.test.tsx` + `src/ui/shell/IdentitySessionPane.test.tsx` | exact test shape |
| `src/ui/features/relay-room-pane/RelayMessageList.tsx` | component | render + paginate | `src/ui/features/pretty-view/PrettyView.tsx` L2077-2073 (message-list render + fetch_older_range_batch case) + `LoadMoreOlderButton.tsx` (reused as-is) | role + data-flow match |
| `src/ui/features/relay-room-pane/RelayMessageList.test.tsx` | test | — | `LoadMoreOlderButton.test.tsx` | exact |
| `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` | component | request-response (participant fetch) | none (novel row layout) — closest is `src/ui/features/pretty-view/PrettyConversationsPanel.tsx` humans-then-agents sort | partial (novel layout, reuses IdentityBadge primitive) |
| `src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx` | test | — | `IdentityBadge.test.tsx` | role match |
| `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` | component | subscription | `src/ui/features/terminal/IdentityBadge.tsx` (badge shell) + `src/ui/features/pretty-view/ComposeBox.tsx` L2287-2434 (meter well + reset cell) | composition of two exact matches |
| `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx` | test | — | `IdentityBadge.test.tsx` + `ComposeBox.test.tsx` (meter-well subset) | role match |
| `src/ui/features/relay-room-pane/use-relay-room-stream.ts` | hook | subscription + WS | `PrettyView.tsx` L1750-1830 (WS open + retry + connectToPane frame) | data-flow match, wire-protocol adapted |
| `src/ui/features/relay-room-pane/use-relay-room-stream.test.ts` | test | — | `PrettyView.load-more.test.tsx` + `PrettyView.optimistic-bubbles.test.tsx` | role match |
| `src/ui/features/relay-room-pane/relay-room-api.ts` | api types | request-response types | `src/ui/api/claude-session-api.ts` (frame discriminated union + `openClaudeSessionSocket`) | exact |
| `src/ui/features/relay-room-pane/error-state.tsx` | component | render | `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` | exact |
| `src/ui/features/relay-room-pane/error-state.test.tsx` | test | — | `PrettyViewErrorOverlay.test.tsx` | exact |
| `src/ui/components/OutboundBubble.tsx` | shared component (primitive) | render | `src/ui/features/pretty-view/ChatMessage.tsx` L430-594 (isUser branch) | exact extraction target |
| `src/ui/components/OutboundBubble.test.tsx` | test | — | `ChatMessage.test.tsx` (isUser subset) | role match |
| `src/ui/components/ComposeBoxShell.tsx` | shared component (primitive) | render + callback | `src/ui/features/pretty-view/ComposeBox.tsx` L2635-2730 (Row 2 textarea + Send) | exact extraction target |
| `src/ui/components/ComposeBoxShell.test.tsx` | test | — | `ComposeBox.test.tsx` (Row-2 subset) | role match |
| `src/ui/shell/RelayRoomSessionPane.tsx` | pane wrapper | orchestration | `src/ui/shell/IdentitySessionPane.tsx` | exact mirror-target |
| `src/backend/matrix/matrix-admin-client.ts` (extend) | api client (append primitives) | request-response | existing file — extends with `getRoomMessages` + `sendMessageAsUser` following `createRoom` (L867-930) + `loginAsUser` (L135-179) patterns | exact (in-file extension) |
| `src/backend/relay-room-stream/relay-room-stream-server.ts` (NEW subsystem) | WS server / route | subscription | `src/backend/claude-session/claude-session-server.ts` | orchestration-model match |
| `src/backend/relay-room-stream/matrix-message-fetch.ts` | service | request-response | `matrix-admin-client.ts::getRoomLatestEventTs` (L540-593) | exact |
| `src/backend/relay-room-stream/matrix-message-send.ts` | service | request-response | `matrix-admin-client.ts::createRoom` (L867-930) — same PUT/POST shape via loginAsUser | role + data-flow match |
| `src/ui/api/sessions-api.ts` (widen) | api types (widen) | — | existing file — widen `RemoteTmuxSession` to carry `kind: "harness" \| "relay-room"` + relay fields | in-file field addition |
| `src/ui/state/conversation-store.ts` (widen `FleetSession`) | state (widen) | — | existing file — widen `FleetSession` type similarly | in-file field addition |
| `src/types/ui-types.ts` (widen `Tab`) | types (widen) | — | existing file — add `sessionKind` + `relayRoomId` + `relayRoomTitle` optional fields | in-file field addition |
| `src/ui/shell/tabUtils.tsx` (widen branching) | orchestrator (widen) | — | existing file — `TerminalOrIdentitySessionPane` (L153-219) grows a third branch for `tab.sessionKind === "relay-room"` → `RelayRoomSessionPane` | exact in-file branch extension |
| `docker/nginx.conf` + `docker/nginx-https.conf` (widen) | infra | — | existing files — add matching `location ^~ /relay-room/websocket/` block mirroring `/claude-session/websocket/` (L710-733 in nginx-https.conf) | exact copy-with-port-swap |

---

## Pattern Assignments

### `src/ui/components/OutboundBubble.tsx` (shared component, render)

**Analog:** `src/ui/features/pretty-view/ChatMessage.tsx` (688 lines; isUser branch at L420-594)

**Extraction rule (D-03):** Copy the isUser branch of ChatMessage into a new standalone primitive. Do NOT modify ChatMessage in this slice. The primitive and ChatMessage's isUser branch will coexist — a future convergence slice can migrate ChatMessage to consume the primitive.

**Bubble wrapper + inline style pattern** (ChatMessage.tsx L420-436):
```tsx
const showSendingSpinner = isUser && pendingState === "sending";
const showFailedBubble = isUser && pendingState === "failed";
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      background: "hsla(0, 60%, 35%, 0.90)",
      borderColor: "hsla(0, 70%, 50%, 0.85)",
    }
  : { position: "relative" };
return (
  <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
    <div
      ref={containerRef}
      title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
      style={bubbleInlineStyle}
      {...(showFailedBubble ? { "data-pv-bubble-failed": "true" } : {})}
      className={cn(
        "pv-bubble",
        "max-w-[90%] [overflow-wrap:anywhere] text-sm leading-relaxed",
        "rounded-[var(--radius-pv-bubble)]",
        isUser ? "px-[12px] py-[7px]" : "pl-[12px] pr-[42px] py-[7px]",
        "backdrop-blur-xl saturate-150",
        "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
        "border border-white/[0.08]",
        "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
        // ... prose classes ...
```

**User-branch gradient (VERBATIM copy per D-13)** (ChatMessage.tsx L465-477):
```tsx
isUser
  ? cn(
      // User bubble = mock's original assistant treatment
      // (translucent mid-blue-gray gradient over the depth). Alice
      // is always Alice, no per-pane variation.
      "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]",
      "text-[#dfe3ee]",
      "border-[rgba(120,140,180,0.2)]",
      "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.1)_inset,_0_0_0_0.5px_rgba(120,140,180,0.15)]",
      "dark:prose-invert",
    )
```

**Sending-spinner pattern** (ChatMessage.tsx L581-594):
```tsx
{showSendingSpinner && (
  <Loader2
    aria-hidden
    data-pv-bubble-spinner
    className="ml-1 inline-block h-3 w-3 animate-spin opacity-70"
  />
)}
```

**Attachments render branch (per Phase 80 D-15)** (ChatMessage.tsx L525-572):
```tsx
) : attachments && attachments.length > 0 ? (
  <>
    {content.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {content}
      </div>
    )}
    <AttachmentChipStrip
      attachments={attachments.map((f, idx) => ({
        tempId: `pending-${idx}`,
        file: { name: f.filename, size: f.size, type: f.mimetype },
        status: "complete",
        bytesUploaded: f.size,
        error: null,
      }))}
      onRemove={() => { /* readOnly — never fires */ }}
      readOnly={true}
    />
  </>
) : (
```

**Props contract to preserve** (from ChatMessage L52-105):
- `content: string` (rendered as React text child — NEVER `dangerouslySetInnerHTML`, per RelayInboundBubble security discipline)
- `ts?: number` (optional; hover-title timestamp)
- `pendingState?: "sending" | "failed" | null`
- `attachments?: Array<{filename: string; size: number; mimetype: string}>`

**What NOT to include in the primitive** (per D-02 — share only truly-primitive pieces):
- The `isUser` discriminator branch — this primitive is user-only; drop the assistant path.
- The `onLongPressSpeak` / `onOpenEditor` / `autoplayArmed` machinery (assistant/speak features not applicable to right-side user bubbles).
- The `injected` (parseInjectedUserTurn) branch — that's a settled-attachment shape; the pending-with-attachments branch (attachments prop) covers what the primitive needs.
- The `!isUser` speak-button block at L595+ — assistant-only.

---

### `src/ui/components/ComposeBoxShell.tsx` (shared component, render + callback)

**Analog:** `src/ui/features/pretty-view/ComposeBox.tsx` (3608 lines; Row 2 extraction at L2635-2730)

**Extraction rule (D-04 + D-06):** Copy Row 2 (textarea + Send button) as the shell. Do NOT extract Row 1 (meter/reset/queue/stop/thumbs-up/recap) — that's PrettyView-specific. Expose `upperArea?: ReactNode` as a slot prop so pretty view can pass its Row 1 in future (D-03 defers that migration), and the relay pane passes `null` per D-04.

**Row 2 outer wrapper** (ComposeBox.tsx L2635-2645):
```tsx
{/* Row 2 — compose bar: textarea (flex-1, auto-grows 1→6 rows) +
    Send button. items-end so Send pins to the textarea bottom edge
    as the textarea grows. VISUAL-08 HARD LOCK on Send's amber
    gradient — never change. */}
<div className="flex items-end gap-2">
  <div className="relative flex-1 self-stretch">
    {/* attach button slot (relay pane passes null per D-05) */}
    <Textarea
      ref={textareaRef}
      value={text}
      onChange={(e) => handleTextChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={`Message ${identityName || "Claude"}…`}
      rows={1}
      // ...
```

**Textarea styling to preserve verbatim** (ComposeBox.tsx L2705-2740):
```tsx
className={cn(
  "resize-none w-full h-full",
  "min-h-8!",  // shadcn Textarea default is min-h-[80px]; `!` overrides
  "bg-[rgba(10,12,20,0.5)]! text-[#f0ebe0]",  // `!` load-bearing per patch #82
  // ... (see full block at L2705-2739 for the extensive comments)
)}
```

**Twin-arc spinner (VERBATIM per LoadMoreOlderButton lock)** (ComposeBox.tsx L2552-2564, cross-referenced in `LoadMoreOlderButton.tsx` L139-151):
```tsx
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

**Props contract to design** (from RESEARCH.md Code Example 2 L583-599):
- `value: string`, `onChange: (v: string) => void` — controlled textarea
- `onSend: (text: string) => void` — send handler
- `upperArea?: ReactNode` — slot for pretty-view Row 1 (relay pane passes null per D-04)
- `attachButton?: ReactNode` — slot for the attach affordance (relay pane passes null per D-05)
- `placeholder?: string`
- `canSend?: boolean` (disables Send when false)
- `className?: string`

**Send-button VISUAL-08 hard-lock (amber gradient — do NOT alter)** — read from ComposeBox.tsx via `grep -n "VISUAL-08" src/ui/features/pretty-view/ComposeBox.tsx` at plan time; the constants live in the Row-2 block below L2740.

---

### `src/ui/features/relay-room-pane/RelayRoomPane.tsx` (pane orchestrator, request-response + subscription)

**Analog:** `src/ui/features/pretty-view/PrettyView.tsx` (3800 lines — MODEL only; do NOT edit per D-01/D-03). Also: `src/ui/features/pretty-view/RelayInboundBubble.tsx` (reuse target) and the two shared primitives above.

**Component structure (adapt from PrettyView.tsx L1-80):**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LoadMoreOlderButton } from "@/features/pretty-view/LoadMoreOlderButton";
import { RelayInboundBubble } from "@/features/pretty-view/RelayInboundBubble";
import { OutboundBubble } from "@/components/OutboundBubble";
import { ComposeBoxShell } from "@/components/ComposeBoxShell";
import { IdentityBadgeRow } from "./IdentityBadgeRow";
import { RelayMessageList } from "./RelayMessageList";
import { RelayRoomErrorState } from "./error-state";
import { useRelayRoomStream } from "./use-relay-room-stream";
```

**WS setup pattern to mirror (PrettyView.tsx L1755-1788 — reconnect discipline + connectToPane frame):**
```tsx
let cancelled = false;
const ws = openClaudeSessionSocket();  // → replaced with openRelayRoomSocket in slice D
wsRef.current = ws;

ws.onopen = () => {
  if (cancelled) return;
  const payload: ConnectToPanePayload = {
    type: "connectToPane",
    hostId,      // → replaced with (userId, roomId) shape in slice D
    tmuxSession,
  };
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* ws may be mid-close */
  }
  setErrorMessage(null);
};
```

**Reconnect constants to adopt (PrettyView.tsx L84):**
```tsx
const MAX_RECONNECT_ATTEMPTS = 5;
// linear-with-cap schedule: 2s, 4s, 6s, 8s, 8s (~28s total window)
```

**Pending-send FIFO state machine (PrettyView.tsx L1112-1304 — mirror this exact shape per D-16):**
```tsx
type PendingSend = {
  mqid: string;
  content: string;
  sentAt: number;
  state: "sending" | "failed";
  timer: number | null;
  attachments?: Array<{filename: string; size: number; mimetype: string}>;
};
const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
const pendingSendsRef = useRef<PendingSend[]>([]);
useEffect(() => { pendingSendsRef.current = pendingSends; }, [pendingSends]);

const PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000;

const flipToFailed = useCallback((mqid: string, reason: string) => {
  setPendingSends((prev) => {
    const found = prev.find((p) => p.mqid === mqid && p.state === "sending");
    if (!found) return prev;
    if (found.timer !== null) window.clearTimeout(found.timer);
    return prev.map((p) =>
      p.mqid === mqid ? { ...p, state: "failed", timer: null } : p,
    );
  });
}, []);
```

**Match-source difference (Pitfall 4 from RESEARCH.md):** the FIFO shape is preserved, but the match key changes from "user-role frame parsed from JSONL" to "Matrix event where `sender === viewingUser.mxid` AND `unsigned.transaction_id === mqid`". Use the mqid directly as the Matrix `txnId` on send so exact match is possible.

---

### `src/ui/features/relay-room-pane/RelayMessageList.tsx` (component, render + paginate)

**Analog A (message-list render + pagination trigger):** `src/ui/features/pretty-view/PrettyView.tsx` L2077-2100 (`fetch_older_range_batch` handler) + L933-970 (`handleLoadOlder` click handler).

**Analog B (paginate button — reuse as-is per D-14):** `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` (166 lines, zero React hooks — pure presentation).

**Pagination click handler pattern** (PrettyView.tsx L933-970):
```tsx
const handleLoadOlder = useCallback(() => {
  if (loadOlderInFlightRef.current) return;  // sync guard
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (oldestLoadedLine === null) return;
  if (oldestLoadedLine <= 1) return;
  const payload: FetchOlderRangePayload = {
    type: "fetch_older_range",
    beforeLine: oldestLoadedLine,   // → beforeEventId per RESEARCH.md Pitfall 5
    count: 20,                       // WORKING_SET_CAP — MATCH pretty view (D-14)
  };
  loadOlderInFlightRef.current = true;
  try {
    ws.send(JSON.stringify(payload));
  } catch { /* swallow — best-effort */ }
}, [oldestLoadedLine]);
```

**Cursor adaptation (Pitfall 5):** pretty view paginates by line-number (`beforeLine`). Relay rooms have no lines — Matrix pagination is by event-id cursor. Rename the field: `{type: "fetch_older_range", beforeEventId: string, count: 20}`. Backend translates to `GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b&from=<eventId>&limit=20`.

**LoadMoreOlderButton mount pattern** (from `LoadMoreOlderButton.tsx` L54-102 props contract):
```tsx
<LoadMoreOlderButton
  hasOlder={hasOlderMessages}       // no-lie invariant — returns null when false
  status={loadOlderState}            // "idle" | "in-flight" | "error"
  error={loadOlderError}             // string | null
  onClick={handleLoadOlder}
/>
```

**Bubble render loop (adapted from PrettyView.tsx L2077-2100):** for each message frame, dispatch:
```tsx
if (frame.type === "relay_inbound") {
  return <RelayInboundBubble
    room={roomTitle}
    sender={frame.sender}
    body={frame.body}
    ts={frame.ts}
    hostId={0 /* relay-room panes have no host; RelayInboundBubble tolerates 0 for the pointer-fetch guard */}
  />;
}
if (frame.type === "outbound_from_viewing_user") {
  const pending = pendingSendsRef.current.find(p => p.mqid === frame.txnId);
  return <OutboundBubble
    content={frame.body}
    ts={frame.ts}
    pendingState={pending?.state ?? null}
  />;
}
```

---

### `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` (component, request-response)

**Analog A (badge primitive — reuse as-is):** `src/ui/features/terminal/IdentityBadge.tsx` (328 lines).

**Analog B (humans list source):** `src/ui/api/user-management-api.ts::getUsersListBasic` (L32-39) — returns `{id, username}[]`.

**Analog C (agent list source):** `src/ui/state/identities-store.ts::useIdentities()` (L206-227).

**Layout structure (per D-07 — humans first, alphabetical within each role, no self-badge):**
```tsx
export function IdentityBadgeRow({
  humans,          // {mxid, displayName, userId}[]
  agents,          // {mxid, identityKey, contextPct, onResetClicked}[]
  viewingUserMxid, // filter out self
}: IdentityBadgeRowProps) {
  const humansOther = humans
    .filter((h) => h.mxid !== viewingUserMxid)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const agentsSorted = [...agents].sort((a, b) =>
    a.identityKey.localeCompare(b.identityKey),
  );
  return (
    <div
      className="flex flex-row items-start gap-2 px-3 py-2 overflow-x-auto"
      data-testid="relay-room-identity-badge-row"
    >
      {humansOther.map((h) => (
        <IdentityBadge
          key={h.mxid}
          identityKey={/* human identity key resolution */}
          /* NO appendage — D-09: absence IS the human/agent distinction */
        />
      ))}
      {agentsSorted.map((a) => (
        <AgentBadgeWithAppendage key={a.mxid} {...a} />
      ))}
    </div>
  );
}
```

**Note on IdentityBadge reuse:** IdentityBadge currently positions itself absolutely (`absolute top-4 right-5 z-[101]` — see IdentityBadge.tsx L102). For badge-row use, wrap it in a container that establishes a non-absolute positioning context, OR extract the inner render (L122-190 `inner` fragment) as a sibling primitive callable from both positioning modes. Planner's call — the shape file's D-08 says "reuse existing identity badges" not "reuse existing absolute positioning."

---

### `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` (component, subscription)

**Analog A (badge primitive):** `src/ui/features/terminal/IdentityBadge.tsx` (as above).

**Analog B (meter well + reset cell — VERBATIM shrink):** `src/ui/features/pretty-view/ComposeBox.tsx` L2287-2434.

**Analog C (per-agent state channel — D-10 CORRECTNESS CRITICAL):** `src/ui/state/session-working-store.ts` L931-1022 (`useSessionIsWorking`, `useSessionIsRecycling`).

**Key resolution pattern (D-10 correctness invariant — from Pitfall 2 in RESEARCH.md):**
```tsx
// The badge appendage MUST resolve (hostId, tmuxSessionName) for each agent
// from the same fleet-derived identity → host mapping the sidebar already
// uses (buildIdentityHostsFromFleet at identities-store.ts:74), then subscribe
// to useSessionIsWorking(sessionKey) with sessionKey = `${hostId}:${tmuxSessionName}`.
const sessionKey = `${hostId}:${tmuxSessionName}`;
const isWorking = useSessionIsWorking(sessionKey);
const isRecycling = useSessionIsRecycling(sessionKey);
```

**Meter well pattern (ComposeBox.tsx L2287-2298 — shrunk):**
```tsx
<div
  className="self-stretch w-[var(--meter-width)] rounded-md flex flex-row p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]"
  style={{"--seg-count": SEG_COUNT, "--meter-width": "12rem"} as React.CSSProperties}
  role="meter"
  aria-label="Context window"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={contextPct ?? undefined}
  title={contextPct != null ? `Context ${contextPct}%` : "Context (unknown)"}
>
```

For the badge appendage, override `--meter-width` to a smaller value (e.g. `6rem` — planner picks) and keep `SEG_COUNT = 12` for visual parity.

**Reset cell pattern (ComposeBox.tsx L2305-2334):**
```tsx
<button
  type="button"
  onClick={handleResetClick}
  disabled={/* … same disable conditions as pretty view … */}
  aria-label="Reset context window"
  title="Reset context window"
  className={cn(
    "h-full w-6 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer",
    "transition-[background,box-shadow,color] duration-[180ms]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    isPulsing ? [/* pulsing gradient */] : [/* resting + hover styles */],
  )}
>
  <RotateCcw className="size-3.5" />
</button>
```

**Segment band-color computation (ComposeBox.tsx L2353-2410):**
```tsx
const band =
  contextPct == null
    ? "green"
    : contextPct >= 78 ? "red" : contextPct >= 45 ? "amber" : "green";
// Same litGreenBg / litAmberBg / litRedBg / dimNeutralBg constants
// Same isLit = typeof contextPct === "number" && i < litCount && !isDraining && !isHolding
```

**Reset send-path (D-10 invariant — same handler pretty view fires):** the reset button dispatches `/id reset` via the same send-input path pretty view uses. Concretely: the reset action fires through `pvSendInputRef` (IdentitySessionPane.tsx L280-291) → PrettyView's WS `send` — for the relay-pane badge appendage this MUST call the SAME per-agent send channel, not the relay-room WS. Planner's call: (a) mount a hidden PrettyView WS per agent (heavy), OR (b) invoke a new backend endpoint `/id-reset/:hostId/:tmuxSession` that shells out the same input the WS path does (lighter). Recommendation: option (b) — keeps agent orchestration out of the relay-pane component tree.

---

### `src/ui/features/relay-room-pane/use-relay-room-stream.ts` (hook, subscription + WS)

**Analog:** `src/ui/features/pretty-view/PrettyView.tsx` L1750-1830 (WS lifecycle) + L1790-2100 (frame dispatch). Also `src/ui/api/claude-session-api.ts::openClaudeSessionSocket` (L14-23) for the WS-open primitive shape.

**WS-open primitive to mirror** (claude-session-api.ts L14-23):
```tsx
export function openRelayRoomSocket(): WebSocket {
  const scheme =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  const url = `${scheme}//${host}/relay-room/websocket/`;
  return new WebSocket(url);
}
```

**Frame discriminated union pattern** (claude-session-api.ts L25-100 — copy the shape):
```tsx
export type RelayRoomServerEvent =
  | { type: "session"; roomId: string; roomTitle: string | null; totalMessages?: number }
  | { type: "history_batch"; events: MatrixEvent[]; hasMore: boolean }
  | { type: "live_event"; event: MatrixEvent }
  | { type: "send_ack"; txnId: string; eventId: string }
  | { type: "send_error"; txnId: string; reason: string }
  | { type: "participants"; humans: HumanParticipant[]; agents: AgentParticipant[] }
  | { type: "error"; message: string }
  | { type: "inactive"; reason: string };
```

**Hook shape:**
```tsx
export function useRelayRoomStream(opts: {
  userId: string;
  roomId: string;
  isVisible: boolean;
}) {
  const [events, setEvents] = useState<MatrixEvent[]>([]);
  const [participants, setParticipants] = useState<{humans: [], agents: []}>();
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // ... mirror PrettyView.tsx L1750-1830 lifecycle
  return { events, participants, error, sendMessage, fetchOlder };
}
```

**Visibility gate (PrettyView.tsx patch #344):** when `isVisible === false`, close the WS to stop unnecessary traffic. Re-open on visibility flip back to true. Mirror the pattern used in PrettyView's WS-setup useEffect.

---

### `src/ui/features/relay-room-pane/relay-room-api.ts` (api types, request-response types)

**Analog:** `src/ui/api/claude-session-api.ts` (1261 lines — type-only wire contracts + `openClaudeSessionSocket` primitive).

**Structural shape to mirror:**
- Top-of-file JSDoc naming the backend server (per claude-session-api.ts L1-12)
- `openRelayRoomSocket(): WebSocket` primitive
- Discriminated union `RelayRoomServerEvent` (see hook section above)
- Discriminated union `RelayRoomClientPayload` for outbound frames (`connectToRoom` + `send_message` + `fetch_older_range`)

**Client payload types (mirror ConnectToPanePayload at claude-session-api.ts L429):**
```tsx
export type ConnectToRoomPayload = {
  type: "connectToRoom";
  roomId: string;
};
export type SendMessagePayload = {
  type: "send_message";
  body: string;
  txnId: string;  // same as the frontend mqid — enables echo-back match per Pitfall 4
};
export type FetchOlderRangePayload = {
  type: "fetch_older_range";
  beforeEventId: string;
  count: number;   // 20 to match pretty view per D-14
};
```

---

### `src/ui/features/relay-room-pane/error-state.tsx` (component, render)

**Analog:** `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` (existing file, structure known from name + convention).

**When to render (per D-18):** on 403 / 404 from the initial history fetch (backend returns these when the user is no longer a member or the room doesn't exist). Copy:
> "This conversation is no longer available."
> Optional subline: "You may have been removed from this room."
> NO retry button (per RESEARCH.md Open Question 3 — there's nothing to retry).

Reference PrettyViewErrorOverlay for the exact visual treatment (dark card, warm-cream text, centered layout).

---

### `src/ui/shell/RelayRoomSessionPane.tsx` (pane wrapper, orchestration)

**Analog:** `src/ui/shell/IdentitySessionPane.tsx` (406 lines).

**Structural mirror (IdentitySessionPane.tsx L79-406):**
```tsx
export const RelayRoomSessionPane = forwardRef<RelayRoomPaneHandle, RelayRoomSessionPaneProps>(
  function RelayRoomSessionPane(
    { tab, roomId, roomTitle, isVisible, onCloseTab },
    ref,
  ) {
    // Structured log: mount (mirror IdentitySessionPane.tsx L109-118)
    useEffect(() => {
      console.info({
        operation: "relay_room_session_pane_mount",
        tabId: tab.id,
        roomId,
      });
    }, []);

    // useImperativeHandle: expose a peer of IdentityPaneHandle
    // (subset — relay-room panes have no Terminal, no queue drawer)
    useImperativeHandle(ref, () => ({
      togglePrettyMode: () => { /* no-op — relay panes have no terminal mode */ },
      toggleMessageQueue: () => { /* no-op — relay panes have no queue drawer */ },
      disconnect: () => { /* no-op — WS lifecycle owned inside RelayRoomPane */ },
      // ... etc.
    }), []);

    return (
      <div className="h-full w-full relative flex flex-col">
        <RelayRoomPane
          roomId={roomId}
          roomTitle={roomTitle}
          isVisible={isVisible}
          className="flex-1 min-h-0"
        />
      </div>
    );
  },
);
```

**What NOT to include (per D-04):** No Terminal, no MessageQueueDrawer, no IdentityBadge (the relay pane has its own IdentityBadgeRow), no IdentityModal (planner may reuse IdentityModal for badge-tap in a later slice; not v1).

---

### `src/ui/shell/tabUtils.tsx` (widen branching)

**Analog:** `src/ui/shell/tabUtils.tsx` L153-219 (`TerminalOrIdentitySessionPane` — the existing two-branch dispatcher).

**Existing shape** (tabUtils.tsx L187-219):
```tsx
const isIdentityPane =
  identityKey != null &&
  (identitiesByKey.has(identityKey) || !identitiesLoaded);

if (isIdentityPane) {
  return <IdentitySessionPane {...props} />;
}
return <TerminalTabContent {...props} />;
```

**Widened shape (Wave 4 wiring — per RESEARCH.md § Pattern 1):**
```tsx
// NEW branch — placed FIRST because it's the most specific discriminator
if (tab.sessionKind === "relay-room") {
  if (!tab.relayRoomId) {
    // Defensive: sessionKind marker without roomId — should never happen if
    // the tab-open path is correct, but log-and-fall-through to identity pane
    // rather than crashing.
    console.warn("relay-room tab missing relayRoomId", { tabId: tab.id });
  } else {
    return (
      <RelayRoomSessionPane
        tab={tab}
        roomId={tab.relayRoomId}
        roomTitle={tab.relayRoomTitle ?? null}
        isVisible={isVisible}
        onCloseTab={onCloseTab}
      />
    );
  }
}
// Existing identity-pane path unchanged
const isIdentityPane = /* … */;
if (isIdentityPane) { return <IdentitySessionPane {...} />; }
return <TerminalTabContent {...} />;
```

**Where the marker originates:** the sidebar-click path opens the tab; the click handler reads the row's `kind` field (widened on `FleetSession` — see below) and forwards it to `openSessionInTree` / `openTab`. Planner: trace from `PrettyConversationsPanel` row-click handler through to the tab-creation site (AppShell.tsx ~L1675 per RESEARCH.md — grep confirms `openSessionInTree`).

---

### `src/ui/api/sessions-api.ts` + `src/ui/state/conversation-store.ts` + `src/types/ui-types.ts` (widen types)

**Analog:** `src/backend/database/routes/sessions-merge-helper.ts` (99 lines) — already defines the `kind` discriminator on the backend contract.

**Backend contract to mirror on the frontend (sessions-merge-helper.ts L40-72):**
```typescript
export interface HarnessSessionRow {
  kind: "harness";
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
  lastMessageAt: number | null;
  aiTitle: string | null;
}

export interface RelayRoomSessionRow {
  kind: "relay-room";
  id: string;
  roomId: string;
  roomTitle: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionListItem = HarnessSessionRow | RelayRoomSessionRow;
```

**Widen `RemoteTmuxSession` in `src/ui/api/sessions-api.ts` L4-14** (existing shape shown; add discriminator + relay fields; keep every existing harness field optional-at-runtime for backward-compat with rehydrated caches). Consider a full discriminated-union refactor (see RESEARCH.md L672-676) but preserve the existing exported name to keep call-site diff small.

**Widen `FleetSession` in `src/ui/state/conversation-store.ts` L145-166** — same three fields (`kind`, `roomId`, `roomTitle`). Bump the localStorage cache-version constant (`v3` → `v4` per the sequence at L1049-1074) so old cached FleetSession objects without the new fields are invalidated cleanly.

**Widen `Tab` in `src/types/ui-types.ts`** — add `sessionKind?: "harness" | "relay-room"`, `relayRoomId?: string`, `relayRoomTitle?: string | null`.

**Backward-compat defense:** consumers that read `kind` should treat `undefined` as `"harness"` — matches how a Phase-89-era backend response looks (`kind` was already added) but a pre-Phase-89 rehydrated cache would not carry it.

---

### `src/backend/matrix/matrix-admin-client.ts` (extend with `getRoomMessages` + `sendMessageAsUser`)

**Analog A (in-file structure to preserve):** the file's own preamble (L1-46) locks the six per-primitive invariants — every new primitive MUST follow them.

**Analog B (GET pattern):** `getRoomLatestEventTs` (L540-593) — closest existing GET-with-Bearer-admin-token pattern.

**Analog C (loginAsUser mint):** `loginAsUser` (L135-179) — the per-user-token mint pattern; `sendMessageAsUser` composes it.

**Analog D (createRoom for response-parse discipline):** `createRoom` (L867-930) — how to defend against missing response fields.

**`getRoomMessages` pattern (adapted from `getRoomLatestEventTs` L540-593):**
```typescript
export type GetRoomMessagesOk = AdminOk<{
  events: MatrixEvent[];
  end?: string;    // cursor for older
  start?: string;  // cursor for newer
}>;

export async function getRoomMessages(
  roomId: string,
  opts: { dir: "b" | "f"; from?: string; limit?: number },
): Promise<GetRoomMessagesOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  const params = new URLSearchParams();
  params.set("dir", opts.dir);
  if (opts.from) params.set("from", opts.from);
  if (opts.limit) params.set("limit", String(opts.limit));
  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    const parsed = (await response.json()) as {
      chunk?: unknown; end?: unknown; start?: unknown;
    };
    // ... defensive parse (mirror getRoomLatestEventTs L568-582)
    return { ok: true, events: /* parsed events */, end: /* … */, start: /* … */ };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_get_room_messages",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**`sendMessageAsUser` pattern (RESEARCH.md § Pattern 2 L314-360, mint-per-request via loginAsUser):**
```typescript
export type SendMessageAsUserOk = AdminOk<{ eventId: string }>;

export async function sendMessageAsUser(
  senderMxid: string,
  roomId: string,
  body: string,
  txnId: string,
): Promise<SendMessageAsUserOk | AdminErr> {
  const login = await loginAsUser(senderMxid);   // MINT PER-USER TOKEN — NOT the admin token
  if (!login.ok) return login;

  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  const url = `${creds.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${login.accessToken}`,   // per-user token, NOT admin
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    const parsed = (await response.json()) as { event_id?: unknown };
    if (typeof parsed.event_id !== "string") {
      return { ok: false, status: 500, error: ERR_MISSING_FIELD };
    }
    return { ok: true, eventId: parsed.event_id };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_send_message_as_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**CRITICAL (Pitfall 3 from RESEARCH.md):** DO NOT reuse `creds.accessToken` for the PUT — the resulting Matrix event would appear as `@skynet-admin: hello` instead of `@alice_human: hello`. The `loginAsUser` mint is what makes the message read as the human user.

---

### `src/backend/relay-room-stream/relay-room-stream-server.ts` (NEW WS server)

**Analog:** `src/backend/claude-session/claude-session-server.ts` (existing WS server for `/claude-session/websocket/`). Structural mirror: `ws` package `WebSocketServer` on a dedicated port (30011 for claude-session; pick 30015 or similar for relay-room), keyed on `(userId, roomId)` (vs. `(hostId, tmuxSession)` for claude-session).

**Auth pattern to mirror** (`src/backend/database/routes/sessions.ts` L40 + L294):
```typescript
const authenticateJWT = authManager.createAuthMiddleware();
router.get("/list", authenticateJWT, async (req: Request, res: Response) => { … });
```

For WS: mirror the claude-session server's cookie-based auth (JWT read from httpOnly cookie on connection upgrade). NEVER accept `userId` from query params.

**Access-control invariant (RESEARCH.md § Security V4):**
```typescript
// Every relay-room WS operation MUST verify req.userId owns the relay_room_sessions row:
const row = db.$client
  .prepare(`SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?`)
  .get(req.userId, roomId);
if (!row) {
  // Return 404 for BOTH "row not found" AND "user not a member" to avoid an
  // existence oracle (Security V8 in RESEARCH.md).
  ws.close(4404, "not found");
  return;
}
```

---

### `docker/nginx.conf` + `docker/nginx-https.conf` (widen with `/relay-room/websocket/` route)

**Analog:** `docker/nginx-https.conf` L710-733 (existing `/claude-session/websocket/` block).

**Copy-with-port-swap** — mirror the block byte-for-byte, swap the upstream port:
```nginx
location ^~ /relay-room/websocket/ {
    proxy_pass http://127.0.0.1:30015/;  # or whichever port relay-room-stream-server binds
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Host $proxy_x_forwarded_host;
    proxy_set_header X-Forwarded-Port $proxy_x_forwarded_port;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_connect_timeout 10s;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
}
```

**Pitfall 6 lock:** the block MUST be added to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Skipping one deploys silently-broken in that environment (RESEARCH.md § Common Pitfalls). Reference: `docker/nginx.conf:726` + `docker/nginx-https.conf:710` per RESEARCH.md.

---

## Shared Patterns (cross-cutting — apply to multiple plans)

### 1. React text children — NEVER `dangerouslySetInnerHTML`

**Source:** `src/ui/features/pretty-view/RelayInboundBubble.tsx` L186 comment "T-17-03-01: body rendered via {body} in JSX (NOT dangerouslySetInnerHTML)."
**Apply to:** OutboundBubble.tsx, RelayMessageList.tsx (inbound + outbound bubbles), IdentityBadgeRow.tsx (participant displayNames), error-state.tsx.
**Discipline:** Every bubble / label / caption is a React text child. Sender-side content from strangers is untrusted by default. RelayInboundBubble has held this line since 2026-08-18 — preserve verbatim.

### 2. Structured logging at boundaries — explicit fields, NEVER `JSON.stringify(event)`

**Source:** Fleet-wide directive Alice 2026-08-11 (also enforced by `IdentitySessionPane.tsx` L109-118 mount log + L121-128 edge log).
**Apply to:** every new WS connect/disconnect/frame-in/frame-out, every send-path outcome, every observation loop touch.
**Pattern:**
```typescript
console.info({
  operation: "relay_room_pane_mount",
  tabId,
  roomId,
  initialIsVisible: isVisible,
});
```
NEVER pass a raw React SyntheticEvent, DragEvent, or Matrix response body to console.info / log — leaks large object graphs; SyntheticEvent has been recycled; Matrix bodies may contain tokens.

### 3. Backend-proxied Matrix — NEVER leak admin or per-user tokens to browser

**Source:** `src/backend/matrix/matrix-admin-client.ts` L1-46 preamble; Phase 88 D-08 lock.
**Apply to:** every backend endpoint slice D adds (`getRoomMessages`, `sendMessageAsUser`, participants fetch, WS server).
**Discipline:** browsers send application payloads (compose text, "fetch older", roomId path arg). Backend translates to Matrix protocol using admin creds OR fresh per-user tokens via `loginAsUser`. Response bodies scrub — never include Matrix response bodies in HTTP responses to the browser. Standard discriminated-union `{ok:true, ...} | {ok:false, status, error}` return shape (matrix-admin-client.ts L48-50).

### 4. Discriminated-union error shape (matrix-admin-client convention)

**Source:** `src/backend/matrix/matrix-admin-client.ts` L48-50, L107-109.
**Apply to:** every new primitive in `matrix-admin-client.ts` + new modules in `src/backend/relay-room-stream/`.
**Pattern:**
```typescript
type AdminOk<T> = { ok: true } & T;
type AdminErr = { ok: false; status: number; error: string };

// Stable error codes:
const ERR_CREDS_MISSING = "matrix_admin_creds_missing";
const ERR_NON_2XX = "admin_api_non_2xx";
const ERR_TIMEOUT = "admin_api_timeout";
const ERR_PROXY = "admin_api_proxy_error";
const ERR_NO_TOKEN = "admin_api_no_token";
const ERR_MISSING_FIELD = "admin_api_missing_field";
```

### 5. AbortController + 30s timeout on every backend fetch

**Source:** `src/backend/matrix/matrix-admin-client.ts` L22-23 + every primitive uses it.
**Apply to:** every new Matrix-touching backend fetch in `sendMessageAsUser`, `getRoomMessages`, participants endpoint.
**Pattern:**
```typescript
const REQUEST_TIMEOUT_MS = 30_000;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
try {
  const response = await fetch(url, { …, signal: controller.signal });
  clearTimeout(timeoutId);
  // …
} catch (err: unknown) {
  clearTimeout(timeoutId);
  if (err instanceof DOMException && err.name === "AbortError") {
    return { ok: false, status: 504, error: ERR_TIMEOUT };
  }
  // …
}
```
`clearTimeout` in BOTH success + error paths — no leaked timers.

### 6. `encodeURIComponent` on every externally-supplied path arg

**Source:** `src/backend/matrix/matrix-admin-client.ts` L84, L144, L548, L628, L716, L878, L960 — every URL-building line.
**Apply to:** every new fetch URL that interpolates roomId, mxid, txnId, eventId.
**Rationale:** T-75-05 path-traversal defense. `encodeURIComponent(roomId)` — never bare interpolation.

### 7. Test-file structure (existing convention)

**Source:** `src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` L1-35 (imports + factory helper) + `RelayInboundBubble.test.tsx` L15-55 (mocks + factory).
**Apply to:** every new `*.test.tsx` and `*.test.ts` in slice D.
**Pattern:**
```typescript
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComponentUnderTest } from "./ComponentUnderTest";

function makeProps(overrides: Partial<ComponentUnderTestProps> = {}): ComponentUnderTestProps {
  return {
    // ... default props
    ...overrides,
  };
}

describe("ComponentUnderTest", () => {
  it("Test 1: <specific behavior>", () => {
    render(<ComponentUnderTest {...makeProps({ /* variant */ })} />);
    // asserts
  });
});
```

### 8. `useSyncExternalStore` for external-store subscriptions

**Source:** `src/ui/state/session-working-store.ts` L92, L931-967 (`useSessionIsWorking` implementation).
**Apply to:** if the slice adds any new frontend state store (e.g., relay-room participants store), follow this pattern — module-scoped state + Map + Set<() => void> listener registry + snapshotVersion counter + `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)`. Do NOT introduce a new state-management library.
**Recommendation:** most slice-D state lives inside `RelayRoomPane` local `useState` + `use-relay-room-stream` hook — no new external store needed. If a "cross-pane participants cache" emerges, use this pattern.

---

## Optimistic-send correlation shape (D-16 — mqid ↔ Matrix txnId)

**Source:** RESEARCH.md § Common Pitfalls Pitfall 4 (L461-465) + PrettyView.tsx L1112-1304 (pending-send FIFO state machine).

**Design invariant:** the frontend-generated `mqid` (already generated by ComposeBox for pretty view — see ComposeBox.tsx `pv-optim-*` prefix; extract as a shared utility if needed) is used DIRECTLY as the Matrix `txnId` on the `PUT /rooms/{roomId}/send/m.room.message/{txnId}` call. Matrix echoes the `txnId` back in `unsigned.transaction_id` on the same event when received via `/sync`. The match becomes:
```typescript
incomingEvent.sender === viewingUser.mxid &&
incomingEvent.unsigned?.transaction_id === pending.mqid
```
No content-string matching (byte-fragile). No time-window heuristics. Exact echo-match.

**Assumption A4 verification:** RESEARCH.md L720 flags this as MEDIUM confidence — verify with a `curl` probe against local Synapse at Wave 1 planning start before committing to the pattern. Fallback: content+sender+ts-window match if echo-back is unreliable.

---

## Component-tree file layout (RESEARCH.md § Recommended Project Structure)

```
src/ui/features/relay-room-pane/       # NEW — parallel to pretty-view/
├── RelayRoomPane.tsx
├── RelayRoomPane.test.tsx
├── IdentityBadgeRow.tsx
├── IdentityBadgeRow.test.tsx
├── AgentBadgeWithAppendage.tsx
├── AgentBadgeWithAppendage.test.tsx
├── RelayMessageList.tsx
├── RelayMessageList.test.tsx
├── use-relay-room-stream.ts
├── use-relay-room-stream.test.ts
├── relay-room-api.ts
└── error-state.tsx

src/ui/components/                     # SHARED PRIMITIVES
├── OutboundBubble.tsx
├── OutboundBubble.test.tsx
├── ComposeBoxShell.tsx
└── ComposeBoxShell.test.tsx

src/ui/shell/
└── RelayRoomSessionPane.tsx           # peer of IdentitySessionPane.tsx

src/backend/relay-room-stream/         # NEW backend subsystem
├── relay-room-stream-server.ts
├── relay-room-stream-server.test.ts
├── matrix-message-fetch.ts
├── matrix-message-fetch.test.ts
├── matrix-message-send.ts
└── matrix-message-send.test.ts

src/backend/matrix/matrix-admin-client.ts    # EXTEND
src/ui/api/sessions-api.ts                   # WIDEN
src/ui/state/conversation-store.ts           # WIDEN FleetSession
src/ui/shell/tabUtils.tsx                    # WIDEN branch
src/types/ui-types.ts                        # WIDEN Tab
docker/nginx.conf                            # WIDEN with /relay-room/websocket/ block
docker/nginx-https.conf                      # WIDEN with /relay-room/websocket/ block
```

---

## No Analog Found

Files with no strong existing match in the codebase (planner should follow the referenced approach):

| File | Role | Data Flow | Reason / Recommendation |
|------|------|-----------|------------------------|
| `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` (LAYOUT ONLY) | component | render | The badge PRIMITIVE has an exact analog (`IdentityBadge.tsx`) but the "horizontal row of badges at top of pane, humans-first-alphabetical, no-self-tile" layout has no in-repo analog. Planner picks flexbox + `overflow-x-auto` per D-20 (reasonable narrow-viewport fallback). Take cues from `PrettyConversationsPanel.tsx` humans-then-agents partitioning if useful; otherwise implement fresh. |
| `src/backend/relay-room-stream/relay-room-stream-server.ts` (auth + access-control shape) | backend WS | subscription | The existing `claude-session-server.ts` provides the structural model but is keyed on `(hostId, tmuxSession)`. The `(userId, roomId)` keying + `relay_room_sessions WHERE user_id = ? AND room_id = ?` access-control gate is new; follow the security patterns in RESEARCH.md § V4 (access control) + § V8 (data protection) rather than a specific in-repo file. |
| Backend participants endpoint (`GET /relay-room/:roomId/participants`) | REST | request-response | RESEARCH.md § Open Question 1 recommends adding this endpoint; existing route file pattern lives at `src/backend/database/routes/sessions.ts` (auth middleware + Drizzle read). Follow that shape. |

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (43 files) — primary extraction source per D-02
- `src/ui/features/terminal/` (7 files) — IdentityBadge + session-hue reuse
- `src/ui/shell/` (10 files) — pane-mount + tab-branching model
- `src/ui/state/` (14 stores) — per-agent state reuse (D-10)
- `src/ui/components/` (35 shadcn primitives) — extraction destination
- `src/ui/api/` (~40 files) — sessions-api + claude-session-api + user-management-api
- `src/backend/matrix/` — matrix-admin-client extension target
- `src/backend/relay-sessions/` — Phase 89 backend for kind-discriminator source
- `src/backend/database/routes/` — sessions.ts auth pattern + sessions-merge-helper.ts kind contract
- `docker/nginx*.conf` — WS route pattern

**Files read (grep + Read):** ~25 files sampled at load-bearing line ranges.

**Pattern extraction date:** 2026-09-08
