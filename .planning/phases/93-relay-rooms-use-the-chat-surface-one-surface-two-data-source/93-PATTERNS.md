# Phase 93: Relay rooms use the chat surface — one surface, two data sources — Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 30 (2 extend-in-place · 6+ new · 15 delete · 7 dispatcher-rewire/comment-sweep · test-migrate set)
**Analogs found:** 30 / 30 — every operation has a concrete in-codebase reference (this is a refactor: analogs live inside the files being retired or extended).

> **Meta-guidance:** This is a REFACTOR heavy on retirement + extension, light on greenfield. New files are limited to (a) the multi-badge component, (b) the source-prop type module, (c) the two adapter hooks (or one unified adapter), and (d) an optional shared error-state component. Every "new file" pattern is derived from an existing file scheduled for deletion — port + adapt, do not reinvent.

---

## File Classification

| File | Role | Data Flow | Closest Analog / Extension Surface | Match Quality |
|------|------|-----------|------------------------------------|---------------|
| `src/ui/features/pretty-view/PrettyView.tsx` | **extend-in-place** | request-response + WS ingestion | (self — same file, extend at anchors L541, L1176-1180, L1852-2770, L3349-3366) | exact |
| `src/ui/features/pretty-view/ComposeBox.tsx` | **extend-in-place** | request-response | (self — extend at prop L300, Row 1 L2321, Paperclip L2889) | exact |
| `src/ui/shell/tabUtils.tsx` | **dispatcher-rewire** | request-response | (self — rewire branch L204-222 + retire L306-326) | exact |
| `src/ui/features/pretty-view/sources/chat-surface-source.ts` | **new-file** (type module) | — | `src/ui/api/sessions-api.ts:22` + `src/backend/claude-session/session-file-parser.ts:115+124` (discriminated-union `kind` precedent) | exact |
| `src/ui/features/pretty-view/sources/use-relay-adapter.ts` | **new-file** (hook, ported blob) | WS event-driven | `src/ui/features/relay-room-pane/use-relay-room-stream.ts` (whole file — move-as-blob per D-10) | exact |
| `src/ui/features/pretty-view/sources/use-harness-adapter.ts` **OR** in-place gate | **new-file (thin)** OR **extend-in-place** | WS event-driven | (self — PrettyView.tsx L1852-2770 ingestion effect body; see Open Question 1 in RESEARCH — gated-in-place is recommended) | exact |
| `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` | **new-file** | pure render | `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` L242-290 (sort + row render) + `AgentBadgeCell` L181-228 (agent-badge cell shape) | exact — port + rehome the container to `absolute top-4 right-5 z-[101]` |
| `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` **OR inline** | **new-file** (or inline in MultiBadgeAnchor) | request-response (POST /agent-reset) + store read | `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` (whole file, ~292 lines — port verbatim; visuals unchanged) | exact |
| `src/ui/features/pretty-view/ChatSurfaceErrorState.tsx` | **new-file** (optional) | pure render | `src/ui/features/relay-room-pane/error-state.tsx` (113 lines — port verbatim; retitle for both cases OR keep relay-only) | exact |
| `src/ui/shell/IdentitySessionPane.tsx` | **extend-in-place** (prop restructure) | request-response | (self — L268-334 PrettyView mount; restructure to pass `source` variant) | exact |
| `src/ui/features/relay-room-pane/RelayRoomPane.tsx` | **delete** | — | (deletion — port `generateRelayMqid` L60 into adapter; port participants REST fallback L127+ into adapter or MultiBadgeAnchor) | — |
| `src/ui/features/relay-room-pane/RelayMessageList.tsx` | **delete** | — | (deletion — replaced by PrettyView's existing message-list; `extractBody` helper the backend comment references may need a small port) | — |
| `src/ui/features/relay-room-pane/RelayRoomInboundBubble.tsx` | **delete** (fork) | — | (deletion — go back to unforked `src/ui/features/pretty-view/RelayInboundBubble.tsx`; both cases share it per D-16) | — |
| `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx` | **delete** | — | (deletion — sort + cell patterns ported into MultiBadgeAnchor) | — |
| `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` | **delete** | — | (deletion — visuals + read/write plumbing ported into AgentBadgeWithMeter) | — |
| `src/ui/features/relay-room-pane/use-relay-room-stream.ts` | **delete** | — | (deletion — content re-materializes as `useRelayAdapter` per D-10) | — |
| `src/ui/features/relay-room-pane/error-state.tsx` | **delete** | — | (deletion — content ports into `ChatSurfaceErrorState.tsx`) | — |
| `src/ui/features/relay-room-pane/relay-room-api.ts` | **delete** | — | (deletion — wire types + `openRelayRoomSocket` move into `useRelayAdapter` OR stay as an internal helper in `pretty-view/sources/`) | — |
| `src/ui/shell/RelayRoomSessionPane.tsx` | **delete** | — | (deletion — dispatcher mounts PrettyView directly with relay source) | — |
| `src/ui/features/relay-room-pane/*.test.tsx` (7 files) | **delete** (test-retire) | — | (deletion — assertions re-land as PrettyView / ComposeBox / MultiBadgeAnchor tests per D-21) | — |
| `src/ui/shell/RelayRoomSessionPane.test.tsx` | **delete** | — | (deletion — assertion re-lands in `tabUtils.test.tsx`) | — |
| `src/ui/shell/tabUtils.test.tsx` | **test-migrate** | — | (self — update `vi.mock` + assertions L8, L16, L35-42, L205, L242) | exact |
| `src/ui/features/pretty-view/PrettyView.source-prop.test.tsx` | **new-file** (test) | — | Any of PrettyView's 15 existing `.test.tsx` files (naming convention `PrettyView.<aspect>.test.tsx`) | exact |
| `src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx` | **new-file** (test) | — | `src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx` (273 lines — port sort + role-attr + self-exclusion assertions) | exact |
| `src/ui/features/pretty-view/PrettyView.relay-source.test.tsx` | **new-file** (test) | — | `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx` (715 lines — port end-to-end relay assertions) | exact |
| `src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx` | **new-file** (test) | — | `src/ui/features/relay-room-pane/RelayRoomPane.test.tsx` (attach-hidden + upper-row-hidden assertions) + existing ComposeBox tests for `showPaperclip` gating | exact |
| `src/ui/AppShell.tsx` | **comment-sweep** | — | (self — L1448, L2156 stale comment refs) | exact |
| `src/ui/state/conversation-store.ts` | **comment-sweep** | — | (self — L193 stale comment ref) | exact |
| `src/ui/state/viewing-user-store.ts` | **comment-sweep** | — | (self — JSDoc L6-10 refs to `IdentityBadgeRow` + `RelayMessageList`) | exact |
| `src/ui/api/fleet-status-client.ts` | **comment-sweep** | — | (self — L292 ref to Plan 06 `AgentBadgeWithAppendage`) | exact |
| `src/backend/relay-room-stream/matrix-message-fetch.ts` | **comment-sweep** | — | (self — L106 ref to `RelayMessageList.extractBody`) | exact |

---

## Pattern Assignments

### `src/ui/features/pretty-view/sources/chat-surface-source.ts` (NEW file — type module)

**Analog:** `src/ui/api/sessions-api.ts:22` + `src/backend/claude-session/session-file-parser.ts:115+124` + `src/ui/state/conversation-store.ts:121+199` (four existing discriminated-union `kind` precedent sites — confirmed by grep in RESEARCH.md § Case-discrimination patterns).

**Precedent excerpt** (`src/ui/api/sessions-api.ts:22`, comment form):
```typescript
// | RelayRoomSessionRow, discriminated on `kind: "harness" | "relay-room"`
```

**Precedent excerpt** (`src/backend/claude-session/session-file-parser.ts` around L115/L124):
```typescript
kind: "relay_outbound";
// ...
kind: "relay_inbound";
```

**Pattern to mirror in new file:**
```typescript
// src/ui/features/pretty-view/sources/chat-surface-source.ts
export type ChatSurfaceSource =
  | {
      kind: "harness";
      hostId: number;
      tmuxSession: string;
      tabId?: string;
      // ... any other harness-only fields currently reachable from PrettyViewProps
    }
  | {
      kind: "relay";
      roomId: string;
      roomTitle: string | null;
      // viewingUserMxid resolved inside the adapter via useViewingUserMxid()
      // per W#8 Slice D pattern — do NOT thread as prop
    };
```

**Naming discipline (D-05 constraint):** At the tab level, `sessionKind` uses `"harness" | "relay-room"`. At the pane-source level, use `"harness" | "relay"` (shorter, avoids the tab-kind axis creeping into pane internals per D-05).

---

### `src/ui/features/pretty-view/PrettyView.tsx` (EXTEND-IN-PLACE)

**Extension surface #1 — badge anchor (D-01/D-02/D-03):** Lines 3349-3366.

**Current shape (byte-preserve for harness case):**
```tsx
{pvIdentityKey && (
  <IdentityBadge
    identityKey={pvIdentityKey}
    hostId={hostId}
    onClick={() => setIsIdentityModalOpen(true)}
    onLongPress={onTogglePrettyMode}
    tabId={tabId}
    onContextMenu={
      identityBadgeContextMenuItems &&
      identityBadgeContextMenuItems.length > 0
        ? (e) => {
            e.preventDefault();
            setIdentityBadgeMenu({ x: e.clientX, y: e.clientY });
          }
        : undefined
    }
  />
)}
```

**Extension shape (D-08 discipline — one hard `source.kind` check at outer level):**
```tsx
{source.kind === "harness" && pvIdentityKey && (
  // BYTE-IDENTICAL preservation — same <IdentityBadge> mount as today,
  // NO wrapper container introduced, so harness DOM is unchanged.
  <IdentityBadge identityKey={pvIdentityKey} hostId={hostId} ... />
)}
{source.kind === "relay" && (
  <MultiBadgeAnchor source={source} participants={adapter.participants} />
)}
```

**Sibling constraint (regression risk — Pitfall 1):** The task pill at L3391-3399 sits at `absolute top-4 left-1/2 -translate-x-1/2 z-[100]` — BELOW the badge's z-[101]. Multi-badge leftward growth must not overlap when many participants render (planner deferred v1 mobile per Slice D D-20).

---

**Extension surface #2 — send handler (D-13):** Lines 1176-1180.

**Current shape:**
```tsx
const handleComposeSend = useCallback((text, mqid) => {
  // ...
  onSendFired();
  return onSend ? onSend(text, mqid) : false;
}, [onSend, onSendFired]);
```

**Extension shape (case-selected `onSend`):**
```tsx
const handleComposeSend = useCallback((text, mqid) => {
  onSendFired();
  if (source.kind === "relay") {
    adapter.sendMessage(text, mqid);
    return true;
  }
  return onSend ? onSend(text, mqid) : false;
}, [source, adapter, onSend, onSendFired]);
```

**Preserve mqid contract in both cases** (Pitfall 4 — Matrix `unsigned.transaction_id` echo correlation): the mqid must flow ComposeBox → adapter.sendMessage → WS payload.txnId → Matrix → live_event.unsigned.transaction_id → adapter correlation. Slice D's `relay-optim-` prefix (RelayRoomPane.tsx:60) OR harness path's `pv-optim-` prefix — planner picks one; whichever wins, it must reach the backend verbatim.

---

**Extension surface #3 — message state + ingestion effect (D-09):** Line 541 (state declaration) + Lines 1852-2770 (ingestion effect body, ~900 lines).

**Current shape (state declaration L541):**
```tsx
const [messages, setMessages] = useState<StreamEvent[]>([]);
```

**Current shape (ingestion effect opening L1852-1862):**
```tsx
useEffect(() => {
  // Patch #148: distinguish a fresh pane mount from a retryKey-triggered re-run.
  if (paneKey !== paneKeyRef.current) {
    // Fresh pane mount — full reset.
    setMessages([]);
    setStatus("connecting");
    // ...
```

**Extension shape (RECOMMENDED — gated-in-place per RESEARCH § Open Question 1):**
```tsx
useEffect(() => {
  // NEW GUARD: relay case runs its adapter's own ingestion; skip harness effect.
  if (source.kind !== "harness") return;
  // Below: existing effect body byte-untouched.
  if (paneKey !== paneKeyRef.current) { ... }
  // ...
}, [hostId, tmuxSession, retryKey, source.kind]);
```

Then, add a peer effect (or delegated hook) that runs when `source.kind === "relay"`, populating the SAME `setMessages` with mapped `MatrixEvent`s from the relay-adapter. Alternative (higher-lift): full extraction into `useHarnessAdapter` per RESEARCH Pattern 2. Planner picks; RESEARCH recommends gated-in-place for slice 1 regression safety.

**Rules-of-hooks caveat (Pitfall 2):** If two peer effects both exist, always run both — each internally short-circuits on `source.kind !== "harness"` / `!== "relay"`. Do NOT conditionally call hooks.

---

### `src/ui/features/pretty-view/ComposeBox.tsx` (EXTEND-IN-PLACE)

**Extension surface #1 — props interface (D-11):** Add near line 300 (where `showPaperclip` lives).

**Current shape (L300):**
```tsx
// Gates whether the paperclip attach button renders in the aux row.
showPaperclip?: boolean;
```

**Extension shape:**
```tsx
// Phase 93 D-11: compose chrome mode. When "relay", the Row 1 instrument
// bar (meter/reset/queue/stop/thumbs-up/recap) AND the Paperclip attach
// button are HIDDEN monolithically. Textarea + Send visual shell unchanged
// per D-12. Default "harness" preserves today's behavior at every call site.
mode?: "harness" | "relay";
```

**Extension surface #2 — Row 1 hide (D-11):** Line 2321.

**Current shape:**
```tsx
<div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
  {/* Row 1 instrument bar body — meter well, aux buttons ... */}
</div>
```

**Extension shape:**
```tsx
{mode !== "relay" && (
  <div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
    {/* Row 1 body byte-untouched */}
  </div>
)}
```

**Extension surface #3 — Paperclip hide (D-11):** Line 2889.

**Current shape:**
```tsx
{showPaperclip && (
  <button
    type="button"
    onClick={() => handleOpenFilePicker("primary")}
    /* ... Paperclip button ... */
  >
    <Paperclip className="size-6" />
  </button>
)}
```

**Extension shape (two equivalent options — planner picks):**
```tsx
// Option A — dual gate:
{showPaperclip && mode !== "relay" && ( <button ...>...</button> )}

// Option B — PrettyView passes showPaperclip={false} for relay:
// (Zero ComposeBox change; harness case unchanged; relay case just doesn't request the paperclip.)
```

RESEARCH recommends Option A for consistency with D-11's monolithic-hide framing and to make case-based intent explicit at the ComposeBox layer.

**Preserve textarea + Send visual shell exactly (D-12):** Row 2 (L2668 onward) is not touched by this refactor.

---

### `src/ui/shell/tabUtils.tsx` (DISPATCHER-REWIRE)

**Rewire surface #1 — lazy import at L23-25:** DELETE (RelayRoomSessionPane retires).

**Current shape:**
```tsx
const RelayRoomSessionPane = lazy(() =>
  import("@/shell/RelayRoomSessionPane").then((m) => ({ default: m.RelayRoomSessionPane })),
);
```

**After retirement:** removed. Both remaining relay branches (below) render `PrettyView` directly — no new lazy import needed since PrettyView is already imported (via `IdentitySessionPane`); the planner may add a direct lazy-import of PrettyView for the relay branch, or hoist the mount through `IdentitySessionPane` (planner's call).

---

**Rewire surface #2 — `TerminalOrIdentitySessionPane` relay branch (D-04/D-06):** Lines 204-222.

**Current shape:**
```tsx
if (tab.sessionKind === "relay-room") {
  if (!tab.relayRoomId) {
    console.warn("relay-room tab missing relayRoomId", { tabId: tab.id });
    // Fall through to the existing dispatcher below.
  } else {
    return (
      <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
        <RelayRoomSessionPane
          tab={tab}
          roomId={tab.relayRoomId}
          roomTitle={tab.relayRoomTitle ?? null}
          isVisible={isVisible}
          onCloseTab={onCloseTab}
        />
      </Suspense>
    );
  }
}
```

**Rewire target:**
```tsx
if (tab.sessionKind === "relay-room") {
  if (!tab.relayRoomId) {
    console.warn("relay-room tab missing relayRoomId", { tabId: tab.id });
    // Fall through.
  } else {
    return (
      <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
        <PrettyView
          source={{
            kind: "relay",
            roomId: tab.relayRoomId,
            roomTitle: tab.relayRoomTitle ?? null,
          }}
          isVisible={isVisible}
          tabId={tab.id}
          className="h-full w-full"
        />
      </Suspense>
    );
  }
}
```

The `host`-optional handling lives inside PrettyView via the source-kind case-check; no separate host-null gate for the relay branch (D-06).

---

**Rewire surface #3 — `renderTabContent` case "terminal" early-return (D-06):** Lines 306-326. DELETE the entire early-return branch.

**Current shape (retire in full):**
```tsx
case "terminal":
  // Phase 91 UAT fix 2026-09-09 (Ashley): relay-room tabs are opened with
  // type="terminal" + host=null (they have no fleet host ...). Render
  // RelayRoomSessionPane inline here BEFORE the host check ...
  if (tab.sessionKind === "relay-room" && tab.relayRoomId) {
    return (
      <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
        <RelayRoomSessionPane ... />
      </Suspense>
    );
  }
  if (!host) return ( <EmptyState ... /> );
  // ...
```

**Rewire target (host-null gate is host-optional-aware):**
```tsx
case "terminal":
  // Host-null is a valid state ONLY for relay-room sessionKind. All other
  // terminal-type tabs still require a host. `TerminalOrIdentitySessionPane`
  // handles the relay branch internally with host-optional handling.
  if (!host && tab.sessionKind !== "relay-room") {
    return <EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />;
  }
  return (
    <TerminalOrIdentitySessionPane
      tab={tab}
      host={host as Host /* narrowed by sessionKind branch inside */}
      ...
    />
  );
```

`TerminalOrIdentitySessionPane`'s relay branch does not read `host`, so passing whatever's there (including `null`) is safe — but the current signature types `host: Host`, so a small signature widening to `host: Host | null` in `TerminalOrIdentitySessionPane` may also be needed. Planner's call.

---

### `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` (NEW file)

**Analog (sort + row shape):** `src/ui/features/relay-room-pane/IdentityBadgeRow.tsx:242-290`.

**Analog excerpt (sort discipline — port verbatim):**
```tsx
// D-07 self-exclusion filter for humans.
const humansOther = humans
  .filter((h) => h.mxid !== viewingUserMxid)
  .slice()
  .sort((a, b) => a.displayName.localeCompare(b.displayName));
// Agents sorted alphabetical by identityKey (D-07).
const agentsSorted = agents
  .slice()
  .sort((a, b) => a.identityKey.localeCompare(b.identityKey));
```

**Analog excerpt (agent-cell shape — L181-228, verbatim):**
```tsx
function AgentBadgeCell({ agent, fleetIdentityHosts }: {...}) {
  const identityKey = agent.identityKey;
  const hostId = fleetIdentityHosts[identityKey];
  if (hostId === undefined) {
    console.warn({ operation: "agent_badge_no_host_mapping", identityKey });
    return (
      <div data-testid="relay-room-participant" data-role="agent" data-mxid={agent.mxid}
           className="relative shrink-0 h-[72px] w-[220px] flex flex-col items-stretch">
        <IdentityBadge identityKey={identityKey} />
      </div>
    );
  }
  return (
    <div data-testid="relay-room-participant" data-role="agent" data-mxid={agent.mxid}
         className="relative shrink-0 h-[92px] w-[220px] flex flex-col items-stretch">
      <AgentBadgeWithAppendage
        identityKey={identityKey}
        mxid={agent.mxid}
        hostId={hostId}
        tmuxSessionName={identityKey}
      />
    </div>
  );
}
```

**Difference from analog (rehome to leftward-growing absolute anchor per D-01):** The Slice D `IdentityBadgeRow` was mounted as a top-of-pane in-flow horizontal row. Phase 93's MultiBadgeAnchor mounts absolute at the same anchor as PrettyView's current single badge:

```tsx
// src/ui/features/pretty-view/MultiBadgeAnchor.tsx — target shape
export function MultiBadgeAnchor({ source, participants }: MultiBadgeAnchorProps) {
  // source.kind === "relay" only — the harness case does NOT route through this component
  // (byte-identical harness DOM preservation per Pitfall 1).
  const humansOther = participants.humans
    .filter((h) => h.mxid !== viewingUserMxid)
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const agentsSorted = participants.agents
    .slice()
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  return (
    <div
      data-testid="multi-badge-anchor"
      className="absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2"
    >
      {/* Order matters — flex-row-reverse means the FIRST DOM child is RIGHTMOST.
          Per D-01, badges grow LEFTWARD from the harness anchor. The "leftmost"
          participant (visually farthest from the right edge) is the LAST DOM child.
          RESEARCH A3 assumption — verify by rendering a snapshot during slice execution. */}
      {agentsSorted.map((a) => <AgentBadgeWithMeter key={a.mxid} agent={a} />)}
      {humansOther.map((h) => <HumanBadge key={h.mxid} human={h} />)}
    </div>
  );
}
```

**Positioning-context hack (RESEARCH Open Question 3):** `IdentityBadge.tsx:110` bakes `absolute top-4 right-5 z-[101]` into its own `rootClassName`. Slice D wrapped each in `<div className="relative h-[72px] w-[220px]">` to scope the absolute to the cell. MultiBadgeAnchor should adopt the same wrapper-cell pattern for v1 (proven-working; minimum change).

---

### `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` (NEW file, or inline in MultiBadgeAnchor)

**Analog:** `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` — port whole file (~292 lines).

**Imports pattern to preserve verbatim** (AgentBadgeWithAppendage.tsx:52-62):
```typescript
import { useCallback, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { authApi } from "@/main-axios";
import {
  useSessionIsWorking,
  useSessionIsRecycling,
} from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { cn } from "@/lib/utils";
```

**Read-side plumbing (verbatim — D-10 zero-drift guarantee):**
- `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)` — same store, same key format as PrettyView's `sessionWorkingKey` (L1363).
- `useSessionIsRecycling(\`${hostId}:${tmuxSessionName}\`)` — Axis E per Phase 53 Plan 03.
- `useSessionContextPct(hostId, tmuxSessionName)` — Wave 0 hook.

**Write-side plumbing (verbatim):**
```typescript
authApi.post(`/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}`, { body: '' })
```

**Constants to preserve verbatim:**
```typescript
const SEG_COUNT = 12;             // matches ComposeBox L136
const METER_WIDTH_SHRUNK = "6rem"; // shrunk from ComposeBox's 12rem
```

**Reason to port whole file:** The visuals are a load-bearing COPY of ComposeBox meter well + reset cell (L2287-2434 in ComposeBox), shrunk. Slice D's D-03 extraction discipline (do NOT import from ComposeBox — copy is the seam) still applies.

---

### `src/ui/features/pretty-view/sources/use-relay-adapter.ts` (NEW file — port `use-relay-room-stream`)

**Analog:** `src/ui/features/relay-room-pane/use-relay-room-stream.ts` — port WHOLE FILE as a blob (~488 lines).

**Rationale (RESEARCH § use-relay-room-stream anatomy):** The 488-line hook is coherent, has no natural seams that would benefit from decomposition, and porting-in-place preserves all the discipline (structured logs, ref-based state, cleanup semantics) that took Slice D 7 plans to get right. Move-as-blob per CONTEXT § Claude's Discretion; do NOT keep the file at its old path as a shim per D-10.

**Constants to preserve verbatim (use-relay-room-stream.ts L74-80):**
```typescript
const PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const LOAD_OLDER_COUNT = 20;
```

**Send-path pattern to preserve verbatim (L197-271):**
```typescript
const sendMessage = useCallback((body: string, mqid: string) => {
  const ws = wsRef.current;
  if (ws === null || ws.readyState !== WebSocket.OPEN) {
    // Fail-immediately: seed pending as failed.
    setPendingSends((prev) => [...prev,
      { mqid, content: body, sentAt: Date.now(), state: "failed", timer: null }]);
    console.info({ operation: "relay_room_send_message", mqid, roomId: roomIdRef.current,
                   userId, ok: false, reason: "ws_not_open" });
    return;
  }
  const payload: SendMessagePayload = { type: "send_message", body, txnId: mqid };
  try { ws.send(JSON.stringify(payload)); }
  catch { /* seed failed */ return; }
  const timerHandle = setTimeout(() => flipToFailed(mqid, "timeout"), PENDING_SEND_TIMEOUT_MS_NORMAL);
  setPendingSends((prev) => [...prev,
    { mqid, content: body, sentAt: Date.now(), state: "sending", timer: timerHandle }]);
  console.info({ operation: "relay_room_send_message", mqid, roomId: roomIdRef.current, userId, ok: true });
}, [flipToFailed, userId]);
```

**Frame-dispatch pattern to preserve (frames handled, use-relay-room-stream.ts L341-417):**
- `session`, `history_batch`, `live_event`, `send_ack`, `send_error`, `participants`, `inactive`, `error`.

**Assumption A4 to preserve (L50-57):** Matrix `unsigned.transaction_id` echo-back. Backend `matrix-message-send.ts` passes frontend mqid verbatim as Matrix txnId. Pitfall 4 correlation.

**Structured logging discipline to preserve:** Log operations `relay_room_ws_open`, `relay_room_ws_close`, `relay_room_ws_reconnect`, `relay_room_send_message`, `relay_room_send_ack`, `relay_room_send_error`, `relay_room_fetch_older`, `relay_room_participants_update`. NEVER log raw event bodies or Matrix response payloads.

**Small additions during port:**
- Accept `source: { kind: "relay"; roomId; roomTitle }` instead of loose `{userId, roomId, viewingUserMxid, isVisible}` — align API to the discriminated-union shape.
- `viewingUserMxid` resolved internally via `useViewingUserMxid()` per W#8 — do NOT thread as parameter.
- Map `MatrixEvent` → PrettyView's `StreamEvent`-compatible shape (or a peer shape rendered case-agnostically) so `RelayInboundBubble` at `src/ui/features/pretty-view/RelayInboundBubble.tsx` can consume both cases' inbound events (RESEARCH Assumption A2).

---

### `src/ui/features/pretty-view/ChatSurfaceErrorState.tsx` (NEW file, optional — could reuse existing PrettyViewErrorOverlay)

**Analog:** `src/ui/features/relay-room-pane/error-state.tsx` (whole file, 113 lines).

**Pattern to port verbatim (imports + interface):**
```typescript
import { cn } from "@/lib/utils";

export interface RelayRoomErrorStateProps {
  title?: string;
  subline?: string;
  className?: string;
}

const DEFAULT_TITLE = "This conversation is no longer available.";

export function RelayRoomErrorState({ title = DEFAULT_TITLE, subline, className }: RelayRoomErrorStateProps) {
  return (
    <div
      data-testid="relay-room-error-state"
      role="status"
      aria-label={title}
      className={cn("flex-1 flex items-center justify-center p-6", className)}
    >
      <div className={cn(
        "rounded-[var(--radius-pv-bubble,12px)] px-5 py-4",
        "backdrop-blur-xl saturate-150",
        "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
        "bg-[linear-gradient(160deg,rgba(35,40,55,0.55),rgba(20,25,40,0.6))]",
        "text-[#e8e4d8]",
        "border border-white/[0.08]",
        "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.08)_inset]",
        "flex flex-col items-center gap-2 text-sm",
        "max-w-[420px]",
      )}>
        <div data-testid="relay-room-error-title" className="text-center font-medium">{title}</div>
        {subline !== undefined && subline.length > 0 && (
          <div data-testid="relay-room-error-subline" className="text-center text-[rgba(232,228,216,0.55)] text-xs">{subline}</div>
        )}
      </div>
    </div>
  );
}
```

**Security discipline to preserve (T-17-03-01):** body content is a React text child, NEVER `dangerouslySetInnerHTML`.

**Existence-oracle discipline to preserve (V8):** copy deliberately does NOT distinguish "kicked" vs "never a member" — both paths land on the same UX. Backend already canonicalizes 403 + 404 to the same code.

**Alternative:** if `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` can absorb the semantics (planner's call per D-20), skip this new file.

---

### `src/ui/shell/IdentitySessionPane.tsx` (EXTEND-IN-PLACE — prop restructure only)

**Extension surface — PrettyView mount at L268-334.**

**Current shape (harness call site):**
```tsx
<PrettyView
  hostId={parseInt(host.id, 10)}
  tmuxSession={effectiveTmuxSession ?? ""}
  className="flex-1 min-h-0"
  isVisible={isVisible}
  tabId={tabId}
  identityBadgeContextMenuItems={identityBadgeContextMenuItems}
  onSend={(text, mqid) => { ... pvSendInputRef ... }}
  onInterrupt={() => { ... }}
  ...
/>
```

**Extension target (D-07 discriminated-union shape):**
```tsx
<PrettyView
  source={{
    kind: "harness",
    hostId: parseInt(host.id, 10),
    tmuxSession: effectiveTmuxSession ?? "",
    tabId: tabId ?? undefined,
  }}
  className="flex-1 min-h-0"
  isVisible={isVisible}
  identityBadgeContextMenuItems={identityBadgeContextMenuItems}
  onSend={(text, mqid) => { ... pvSendInputRef ... /* unchanged */ }}
  onInterrupt={() => { ... }}
  /* All other props unchanged. */
/>
```

`PrettyView` grows a `source: ChatSurfaceSource` prop; the harness-only fields (`hostId`, `tmuxSession`, `tabId`) either move onto `source` (cleaner) or are duplicated during a migration window (planner's call — cleaner is better if callers can be updated atomically).

---

### `src/ui/shell/tabUtils.test.tsx` (TEST-MIGRATE)

**Analog (self):** Lines 8, 16 (JSDoc), 35-42 (`vi.mock`), 205, 242 (assertions).

**Current mock (L35-42 approximate — verify during slice):**
```typescript
vi.mock("@/shell/RelayRoomSessionPane", () => ({
  RelayRoomSessionPane: (props: any) => <div data-testid="mock-relay-room-session-pane" ...>...</div>,
}));
```

**Migration target:**
```typescript
vi.mock("@/features/pretty-view/PrettyView", () => ({
  PrettyView: (props: { source: ChatSurfaceSource, ... }) => (
    <div data-testid="mock-pretty-view" data-source-kind={props.source.kind}>...</div>
  ),
}));
```

**Assertion update at L205, L242:**
```typescript
// BEFORE: expect(screen.getByTestId("mock-relay-room-session-pane")).toBeInTheDocument();
// AFTER:
const pv = screen.getByTestId("mock-pretty-view");
expect(pv).toBeInTheDocument();
expect(pv).toHaveAttribute("data-source-kind", "relay");
```

---

### New test files (D-21)

**Analog for test-file naming + shape:** existing PrettyView test files (see RESEARCH § Existing test structure — 15 `.test.tsx` files following `PrettyView.<aspect>.test.tsx` convention).

| New test file | Ports assertions from | Purpose |
|---------------|----------------------|---------|
| `PrettyView.source-prop.test.tsx` | (new) | D-07/D-08 — assert source prop routing, adapter selection, harness case unchanged. |
| `PrettyView.multi-badge.test.tsx` | `relay-room-pane/IdentityBadgeRow.test.tsx` (273 lines) | D-01/D-02/D-03 — sort discipline, role attrs, self-exclusion, harness case renders exactly one badge byte-identical to today. |
| `PrettyView.relay-source.test.tsx` | `relay-room-pane/RelayRoomPane.test.tsx` (715 lines) | D-09/D-10/D-11/D-13 — end-to-end relay case (WS ingestion, live_event correlation, participants, error state). |
| `ComposeBox.mode-hide.test.tsx` | `RelayRoomPane.test.tsx` (attach + upper row hidden assertions) | D-11/D-12 — Row 1 hidden + paperclip hidden when `mode="relay"`; textarea + Send visual shell unchanged. |
| `PrettyView.optimistic-bubbles.test.tsx` (EXTEND existing) | `use-relay-room-stream.test.ts` (396 lines — port Test 5 correlation assertion) | D-14 — optimistic-bubble parity + Matrix `unsigned.transaction_id` echo correlation (Pitfall 4). |

---

## Shared Patterns

### Discriminated-union `source.kind` case-discrimination (D-07/D-08)

**Source:** `src/ui/api/sessions-api.ts:22` (precedent) + `src/backend/database/routes/sessions.ts:262-268` (precedent) + `src/backend/claude-session/session-file-parser.ts:115+124` (precedent).

**Apply to:** every case-based branch inside PrettyView + ComposeBox + tabUtils.

**Discipline:**
- Every case-based branch reads `source.kind` — NEVER other fields for case detection.
- Any read of `source.roomId` outside a `source.kind === "relay"` narrowing is a smell.
- TypeScript enforces invalid-state-unrepresentable at compile time.

---

### Structured logging discipline (V8 information-disclosure mitigation)

**Source:** `src/ui/features/relay-room-pane/use-relay-room-stream.ts:41-48` (JSDoc discipline) + all `console.info(...)` sites throughout that file.

**Apply to:** every logging site in the new `useRelayAdapter` port.

**Pattern:**
```typescript
console.info({
  operation: "relay_room_send_message",  // explicit slug
  mqid,                                   // explicit field
  roomId: roomIdRef.current,
  userId,
  ok: true,                               // never the raw event, never the body
});
```

**Forbidden tokens (preserve when porting):**
- `JSON.stringify(event)` on a raw WS frame or React SyntheticEvent
- Logging raw message bodies (privacy — user-typed content)
- Logging Matrix response payloads

---

### React JSX text-child rendering (V5 XSS mitigation)

**Source:** `src/ui/features/pretty-view/RelayInboundBubble.tsx:37` — comment `T-17-03-01: body rendered via {body} in JSX`.

**Apply to:** every message-body rendering site in the shared surface — `RelayInboundBubble`, `ChatSurfaceErrorState`, MultiBadgeAnchor's display-name rendering, any new relay-message branches.

**Discipline:** NEVER use `dangerouslySetInnerHTML` on sender-supplied content. React's text-child auto-escape is the load-bearing XSS defense. Test 5 of `RelayInboundBubble.test.tsx` (which asserts `<script>` bodies render as literal text) is the regression floor.

---

### `encodeURIComponent` on Matrix identifiers (path-traversal defense-in-depth)

**Source:** `src/ui/features/relay-room-pane/RelayRoomPane.tsx:163` (participants REST URL construction) + `AgentBadgeWithAppendage.tsx` reset-endpoint URL construction.

**Apply to:** every URL construction that concatenates a Matrix `roomId` or `tmuxSessionName` — those strings legitimately contain `!` and `:` which need percent-encoding.

**Pattern:**
```typescript
authApi.post(`/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}`, { body: '' });
authApi.get(`/relay-room/${encodeURIComponent(roomId)}/participants`);
```

---

### Harness case regression floor (Pitfall 1 mitigation)

**Source:** `src/ui/features/pretty-view/PrettyView.tsx:3311-3320` (comment describing badge-position lock) + Pitfall 1 in RESEARCH.md.

**Apply to:** every slice. Every slice's regression gate is:

- Mount PrettyView with `source={{kind:"harness",...}}` → assert:
  1. Exactly one badge renders.
  2. At the same position class: `absolute top-4 right-5 z-[101]`.
  3. With the same onClick behavior (opens IdentityModal).
  4. With the same hue calculation.
- Run all 15 `PrettyView*.test.tsx` files (broader than fleet's `--related` scope; justified per Pitfall 1 severity).
- Zero diff in `PrettyView.test.tsx` snapshots.

Non-negotiable — if a slice cannot clear this gate, stop and rework.

---

### Retirement sweep grep (Pitfall 3 + Pitfall 6 mitigation)

**Source:** Pitfall 3 + Pitfall 6 in RESEARCH.md.

**Apply to:** the retirement slice (or the atomic retirement + extension slice, if planner picks that ordering).

**Exhaustive grep (must return zero hits before retirement slice ships):**
```bash
grep -rn "features/relay-room-pane\|shell/RelayRoomSessionPane\|use-relay-room-stream\|RelayRoomInboundBubble\|AgentBadgeWithAppendage\|IdentityBadgeRow\|RelayRoomPane\|RelayMessageList" src/ tests/ scripts/ 2>/dev/null
```

**Comment-sweep grep (harmless if left, worth cleaning):**
```bash
grep -rn "RelayRoomSessionPane\|RelayRoomPane\|RelayMessageList\|IdentityBadgeRow\|AgentBadgeWithAppendage\|RelayRoomInboundBubble\|use-relay-room-stream\|relay-room-pane" src/ 2>/dev/null
```
Update or remove stale comment references at:
- `src/ui/AppShell.tsx:1448, :2156`
- `src/ui/state/conversation-store.ts:193`
- `src/ui/state/viewing-user-store.ts:6-10` + `:148, :167`
- `src/ui/api/fleet-status-client.ts:292`
- `src/backend/relay-room-stream/matrix-message-fetch.ts:106`

**Cache clear (RESEARCH § Runtime State Inventory):**
```bash
rm -rf node_modules/.vitest
```
Include in retirement slice's executor task list.

**Type-check gate:**
```bash
npx tsc --noEmit
```
Include in retirement slice — catches any dangling type references from the deleted tree.

---

## No Analog Found

None. This phase is a refactor of existing code — every operation has an analog in either:
- The existing PrettyView / ComposeBox / IdentityBadge / IdentitySessionPane / tabUtils files (extension-in-place surfaces), OR
- The Slice D relay-room-pane tree being retired (port-and-delete surfaces), OR
- An already-shipped shared primitive (`RelayInboundBubble.tsx`, `OutboundBubble.tsx`, `ComposeBoxShell.tsx`).

The single genuinely-new-shape component is `MultiBadgeAnchor` — but even it is a re-composition of the retiring `IdentityBadgeRow` + `AgentBadgeWithAppendage` + the existing `IdentityBadge`, rehomed to an absolute-positioned leftward-growing container.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (extension targets + shared primitives)
- `src/ui/features/relay-room-pane/` (retiring tree — port source for new files)
- `src/ui/shell/` (dispatcher + session-pane wrappers)
- `src/ui/features/terminal/IdentityBadge.tsx` (badge primitive)
- `src/ui/api/sessions-api.ts` + `src/backend/database/routes/sessions.ts` + `src/backend/claude-session/session-file-parser.ts` + `src/ui/state/conversation-store.ts` (discriminated-union precedent sites)
- `src/ui/AppShell.tsx` + `src/ui/state/viewing-user-store.ts` + `src/ui/api/fleet-status-client.ts` + `src/backend/relay-room-stream/matrix-message-fetch.ts` (comment-sweep sites)

**Files scanned (concrete Reads):** 12 primary files with targeted line-range reads: `PrettyView.tsx` (L535-570, L1170-1310, L1850-1910, L3340-3410), `ComposeBox.tsx` (L290-330, L2300-2345, L2870-2920), `tabUtils.tsx` (full 373 lines), `IdentityBadgeRow.tsx` (L100-290), `AgentBadgeWithAppendage.tsx` (L1-100), `use-relay-room-stream.ts` (L1-100, L190-310), `error-state.tsx` (full 113 lines), `RelayInboundBubble.tsx` (L1-80), `RelayRoomInboundBubble.tsx` (L1-50), `RelayRoomSessionPane.tsx` (full 153 lines), `RelayRoomPane.tsx` (L50-135), `IdentitySessionPane.tsx` (L260-340), `IdentityBadge.tsx` (L100-130). Plus grep sweeps for external comment refs across `src/ui/AppShell.tsx`, `src/ui/state/conversation-store.ts`, `src/ui/state/viewing-user-store.ts`, `src/ui/api/fleet-status-client.ts`, `src/backend/relay-room-stream/matrix-message-fetch.ts`, `src/ui/api/sessions-api.ts`.

**Pattern extraction date:** 2026-09-09
