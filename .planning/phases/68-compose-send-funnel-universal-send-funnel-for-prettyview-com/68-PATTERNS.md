# Phase 68: compose-send-funnel — Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 3 modified + 1 new test file
**Analogs found:** 4 / 4 (refactor phase — closest analog IS the code being refactored)

## File Classification

| File | Change | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `src/ui/features/pretty-view/ComposeBox.tsx` | modify (extract + rewire 5 call sites + relax 2 disable predicates) | component + co-located hook | request-response (WS dispatch + optimistic bubble seed) | itself: `handleSend` L1413-1534 | exact (self) |
| `src/ui/features/pretty-view/PrettyView.tsx` | verify only (no shape change — L1004 mqid conditional stays as-is) | component | request-response (WS `input` frame) | itself: `sendInput` L996-1011 | exact (self) |
| `src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx` | new (5 per-trigger tests) | test | request-response assertion | `PrettyView.optimistic-bubbles.test.tsx` | exact (in-process style, same WS stub + `mount()` harness) |

## Pattern Assignments

### `src/ui/features/pretty-view/ComposeBox.tsx` — reference implementation to extract

**Analog:** itself — `handleSend` at L1413-1534 is the funnel's source shape.

**Prop contract the funnel keeps (L164-191):**
```tsx
onSend: (text: string, mqid?: string) => boolean;
onOptimisticSend?: (args: {
  payload: string;
  mqid: string;
  immediateFailure: boolean;
}) => void;
```

**Core funnel pattern to extract (L1487-1533) — the shape every trigger must inherit:**
```tsx
setErrorMessage(null); // clear any prior error

// D-50 policy: collapse newlines to spaces on send. Ink safety.
const payload = collapseNewlinesForSend(trimmed);

console.info(`[compose] submit-entry hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} attachmentCount=0 trigger=${trigger}`);
// Phase 50 D-01/D-18: generate the mqid ONCE per send. Pattern is `pv-optim-<ms>-<8hex>`.
const mqid = `pv-optim-${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
// Phase 50 D-01: fire the optimistic-bubble seed BEFORE the WS send so
// PrettyView renders the pending bubble on the same React frame as the
// send dispatches.
onOptimisticSend?.({ payload, mqid, immediateFailure: false });
const dispatched = onSend(payload, mqid);
if (dispatched) {
  console.info(`[compose] submit-success hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length}`);
  setText(""); // clear compose textarea on success
  clearAfterSend();
} else {
  console.warn(`[compose] submit-failed hostId=${hostId} tmuxSession=${tmuxSession ?? "null"} bodyLen=${payload.length} err="not-connected"`);
  setErrorMessage("Not connected — try again in a moment");
  // Phase 50 D-20: fire a SECOND onOptimisticSend with immediateFailure
  // so PrettyView flips the just-seeded pending bubble to red state
  // immediately (no waiting on the 20s timer for the WS-not-open case).
  onOptimisticSend?.({ payload, mqid, immediateFailure: true });
  // D-20 + D-56: do NOT clear text on onSend-returned-false.
}
```

**Contract boundary — what the funnel owns vs. what stays with the caller:**
- Funnel owns: mqid generation, `onOptimisticSend` seed (pre-send + failure), `onSend(payload, mqid)`, submit-entry / submit-success / submit-failed console logs, `setErrorMessage("Not connected — try again in a moment")` on `dispatched===false`.
- Caller keeps: `setText("")`, `clearAfterSend()`, attachment branching, textarea focus, source-armed cancel (`cancelSourceArmed(...)`), draft persistence, per-trigger UI cleanup (slot removal + `scheduleAutosave`, drain-sweep animation, `onResetClicked?.()`, `setMicTarget("primary")`).

---

### Call site A: `handleQueueSlotSend` L1348-1405 — text-only tail to rewire (L1391-1404)

```tsx
setErrorMessage(null);

const payload = collapseNewlinesForSend(trimmed);
const dispatched = onSend(payload);        // ← funnel replaces: no mqid, no bubble seed
if (dispatched) {
  const nextSlots = queueSlots.filter((s) => s.id !== slotId);
  setQueueSlots(nextSlots);
  scheduleAutosave(latestBodyRef.current, nextSlots);
} else {
  setErrorMessage("Not connected — try again in a moment");
  // Keep the slot — same failure-preservation posture as primary handleSend D-20.
}
```

**Refactor shape:** replace `onSend(payload)` + surrounding error handling with a funnel call; slot removal + `scheduleAutosave` remain per-caller. Attachment branch at L1366-1389 is untouched (out-of-scope per CONTEXT § Deferred).

---

### Call site B: `handleQuickSend` L1790-1816 — thumbs-up + recap tail to rewire

```tsx
function handleQuickSend(quickText: string) {
  setErrorMessage(null);
  const dispatched = onSend(quickText);     // ← funnel replaces: no mqid, no bubble seed
  if (dispatched) {
    clearAfterSend();
    // NOTE: intentionally does NOT setText("") — user's typed draft stays visible.
  } else {
    setErrorMessage("Not connected — try again in a moment");
  }
  if (isTouchDevice !== true) textareaRef.current?.focus();
}
```

**Wire sites (L2378 thumbs-up, L2411 recap):**
```tsx
onClick={() => { onGoodToGo?.(); handleQuickSend("thumbs up"); }}
disabled={canSend === false || asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true}
```
```tsx
onClick={() => { onGoodToGo?.(); handleQuickSend("/explain the current situation"); }}
disabled={canSend === false || asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true}
```

**D-02 bubble-text override:** thumbs-up caller must pass a `bubbleTextOverride: "👍"`-style parameter into the funnel; recap does not override.

**D-04/D-05 disable-predicate relaxation:** the `canSend === false` term is removed from both button `disabled` expressions. Retain the other terms (`asideActive`, `recycleActive`, `planPendingActive`, `reconnectingActive`) — those are non-dormant transport-unavailable states. `canSend` is used at 4 other sites (L1926 send-button, L2158 unrelated, L2458 prop passthrough, L2618 comment) — this phase only touches L2379 and L2412.

---

### Call site C: `dispatchResetPayload` L1735-1747 + `handleResetSend` L1749-1752 + `handleVoiceResetSend` L1761-1767 — reset tail to rewire

```tsx
function dispatchResetPayload(body: string) {
  const trimmed = body.trim();
  const payload = trimmed
    ? `/id reset (${collapseNewlinesForSend(trimmed)})`
    : "/id reset";
  const dispatched = onSend(payload);       // ← funnel replaces: no mqid → backend wake gate silent-misses
  if (dispatched) {
    setText("");
    clearAfterSend();
  } else {
    setErrorMessage("Not connected — try again in a moment");
  }
}
```

**D-03 invariant:** funnel MUST plumb an mqid even for reset. Render-blacklist stays in the render layer downstream — the funnel does not know about it. `fireResetSyncFx()` (L1691-1731: `onResetClicked?.()`, source-armed cancel, drain-sweep timers) runs BEFORE the funnel call and stays untouched — it's per-caller sync UI.

---

### `src/ui/features/pretty-view/PrettyView.tsx` — WS message construction (L996-1011)

**Load-bearing conditional the funnel's mqid contract touches:**
```tsx
const sendInput = useCallback((text: string, mqid?: string): boolean => {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(
      JSON.stringify({
        type: "input",
        data: text,
        ...(mqid ? { messageQueueItemId: mqid } : {}),   // ← mqid-conditional field
      }),
    );
    return true;
  } catch {
    return false;
  }
}, []);
```

**Refactor posture:** no shape change to this file. The funnel guarantees mqid is always present, so post-refactor every WS `input` frame carries `messageQueueItemId` — which is what the Phase 56 backend wake gate needs. The hypothesis in CONTEXT § domain #4 (reset drops into bare bash because mqid-less sends silently skip the pretty-view wake gate) is verified end-to-end by this uniformity.

---

## Shared Patterns

### mqid generation (Phase 50 D-01/D-18)
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx:1502`
**Apply to:** every funnel call — one mqid per send, generated ONCE, threaded through both `onOptimisticSend` and `onSend`.
```tsx
const mqid = `pv-optim-${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
```

### Optimistic bubble seed (Phase 50 D-01/D-20)
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx:1506, 1525`
**Apply to:** every funnel call, including reset (render layer skips blacklisted payloads).
```tsx
onOptimisticSend?.({ payload, mqid, immediateFailure: false });   // pre-send
// ... onSend ...
onOptimisticSend?.({ payload, mqid, immediateFailure: true });    // on dispatched===false
```

### Failure-preservation posture (Phase 50 D-20 / D-56)
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx:1519-1533`
**Apply to:** every funnel call — on `dispatched===false`, set inline error, fire immediateFailure seed, DO NOT clear text/slot/draft.
```tsx
setErrorMessage("Not connected — try again in a moment");
```

### Compose-submit instrumentation (Phase 31 D-02)
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx:1493, 1509, 1520`
**Apply to:** every funnel call — three log lines with matching format (submit-entry / submit-success / submit-failed), carrying hostId + tmuxSession + bodyLen + trigger. Existing tests assert against these lines; funnel must preserve the string format verbatim.

### Newline collapse (D-50 Ink safety)
**Source:** `src/ui/features/pretty-view/ComposeBox.tsx:1490`
**Apply to:** every funnel call — funnel calls `collapseNewlinesForSend(trimmed)` before dispatch. Reset's dispatchResetPayload already does this internally (L1738); if funnel absorbs it, reset caller passes raw body and the wrapper `/id reset (...)` construction moves into a caller-supplied payload builder OR stays in the caller and the funnel receives the already-wrapped payload. Planner's call.

---

## Test Pattern Assignment

### `src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx` (new)

**Analog:** `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — same in-process style, WS stub harness, `mount()` factory, mqid capture pattern.

**WS stub scaffold (L39-73):**
```tsx
type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  // ...
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  // ...
};
const wsStubs: WsStub[] = [];
vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = { readyState: 1, /* ... */ send: vi.fn(), /* ... */ };
    wsStubs.push(ws);
    return ws;
  }),
}));
```

**mqid capture pattern (L149-164) — the harness for asserting mqid presence per trigger:**
```tsx
let onSendMock: ReturnType<typeof vi.fn>;
let onSendMqidCapture: string | undefined;

beforeEach(() => {
  onSendMqidCapture = undefined;
  onSendMock = vi.fn((text: string, mqid?: string) => {
    onSendMqidCapture = mqid;
    return true;
  });
});
```

**`mount()` factory (L176-186):**
```tsx
function mount(onSendOverride?: (text: string, mqid?: string) => boolean) {
  const { container, unmount } = render(
    <PrettyView
      hostId={1}
      tmuxSession="s1"
      isVisible={true}
      onSend={onSendOverride ?? onSendMock}
    />,
  );
  return { container, unmount };
}
```

**Bubble-count helpers (L132-145):**
```tsx
function countPendingBubbles(container: HTMLElement): number {
  return container.querySelectorAll('[data-event-id^="pending-"]').length;
}
function countConfirmedBubbles(container: HTMLElement): number { /* ... */ }
```

**Assertion shape per trigger (adapted from Test 1 L188-207):**
- typing + Enter (main textarea) → 1 pending bubble, `data-event-id` matches `^pending-pv-optim-`, bubble text = payload.
- queue-slot send → 1 pending bubble seeded with slot payload, slot removed, `onSendMqidCapture` defined.
- thumbs-up → 1 pending bubble whose visible text is the override (👍) not `"thumbs up"`; onSendMqidCapture defined; assertion that button is NOT disabled when transport is dormant-but-available.
- recap → 1 pending bubble with text = `/explain the current situation` (no override); onSendMqidCapture defined.
- reset → 0 pending bubbles rendered (render-blacklist honored), BUT onSendMqidCapture IS defined (funnel plumbed mqid → backend wake gate fires).

**Fake-timer / paste_send_failed style (L445-483) — reuse if planner adds the WS-shape assertion for the reset-wake fix.**

---

## No Analog Needed

None. This is a refactor phase; every touched file has itself as the analog and every shared pattern already exists in `ComposeBox.tsx:1413-1534` and Phase 50 prior art.

## Metadata

**Analog search scope:** `src/ui/features/pretty-view/**` (tests + implementation), `src/backend/claude-session/**` (verified `sendInput` shape at `PrettyView.tsx:996`).
**Files scanned:** ComposeBox.tsx (5 call-site regions), PrettyView.tsx (sendInput region), `PrettyView.optimistic-bubbles.test.tsx` (harness + Test 1/6/7 excerpts), pretty-view test directory (11 test files enumerated for style consistency).
**Pattern extraction date:** 2026-09-02
