# Phase 81: Optimistic bubble for every compose-box send — Pattern Map

**Mapped:** 2026-09-07
**Files analyzed:** 6 (4 production + 2 test) — scope corrected by RESEARCH.md § "State-of-Play Correction" (queue-slot text + cadence text already routed through funnel by Phase 68 follow-up)
**Analogs found:** 6 / 6 (all exact — every touched file has a strong in-file analog from Phase 05 / 50 / 68 / 76)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/ComposeBox.tsx` (modify — TYPE ONLY) | component / prop-surface | request-response | Same file L187-192 (existing `onOptimisticSend` shape) | exact (self) |
| `src/ui/features/pretty-view/PrettyView.tsx` (modify — 3 sites) | container / state-owner | event-driven | Same file L1118-1258 (Phase 50 `PendingSend` + `handleOptimisticSend`) and same file L1477-1486 (existing `onUploadReadyToInject` closure) | exact (self) |
| `src/ui/features/pretty-view/ChatMessage.tsx` (modify — new render branch) | component | render / prop-driven | Same file L479-509 (settled `injected` branch) | exact (self — mirror shape) |
| `src/ui/features/pretty-view/use-pretty-view-uploads.ts` (NO CHANGES per RESEARCH § Option B) | hook | event-driven | — | n/a — RESEARCH.md § Option B keeps hook unchanged; seed lives in PrettyView's callback closure |
| `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` (extend inline) | test | scenario-driven | Same file L188-207 (Test 1 seed+render pattern) and L1042-1091 (Test 14/15 latest-only render) | exact (self — reuse harness) |
| `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` (extend — one new test) | test | integration / two-event | Same file L241-322 (Test 3 handleInjectedTurnReady two-event pattern) | exact (self — extend for seed) |

**Files explicitly OUT-OF-SCOPE per RESEARCH.md correction:**
- `ComposeBox.test.tsx` — no ComposeBox logic changes (seed lives in PrettyView under Option B).
- `ComposeBox.queued-attachment.test.tsx` — same reason.
- `use-pretty-view-uploads.test.ts` — hook not modified.
- Queue-slot text and cadence text branches in ComposeBox — ALREADY route through funnel (see RESEARCH.md § "Queue-Slot Text Sends — Already Handled"). Do NOT add duplicate seeds.

---

## Pattern Assignments

### `src/ui/features/pretty-view/ComposeBox.tsx` (component, request-response) — TYPE WIDENING ONLY

**Analog:** existing `onOptimisticSend` prop-type shape at same file L181-192.

**Existing shape** (verbatim, lines 181-192):
```typescript
// Phase 50 D-01/D-03: called synchronously from handleSend just before
// onSend (immediateFailure:false), and again after onSend returns false
// (immediateFailure:true, D-20 immediate-red-bubble on WS unavailable).
// The same mqid flows into both calls so PrettyView can track a single
// PendingSend record and just update its state on the second call.
// Optional so read-only or non-PrettyView callers stay backward-compat.
onOptimisticSend?: (args: {
  payload: string;
  mqid: string;
  immediateFailure: boolean;
}) => void;
```

**Pattern to copy** (widen field, keep style + doc block):
Extend the args object with an optional `attachments?: Array<{filename: string; size: number; mimetype: string}>` field per D-16. Text-only callers omit it (backward-compat) — the existing L471/L487 funnel callsites need ZERO change. Optional-field pattern mirrors how `overrideText?: string | null` at L198 keeps back-compat with historical mount sites.

**Existing funnel callsites that stay unchanged** (verified — no attachment field added at these sites):
- `ComposeBox.tsx:471` — `onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: false })`
- `ComposeBox.tsx:487` — `onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: true })`

**Anti-pattern to avoid:** Do NOT add a new callback prop (`onOptimisticSeedWithAttachments`). RESEARCH.md § Option B locates the seed in PrettyView's `onUploadReadyToInject` closure, not in ComposeBox. Widening the existing field is the smallest surface change.

---

### `src/ui/features/pretty-view/PrettyView.tsx` (container, event-driven) — 3 SITES

#### Site A: `PendingSend` type widening (L1118-1124)

**Analog:** existing `PendingSend` type declaration at same location.

**Existing shape** (verbatim):
```typescript
type PendingSend = {
  mqid: string;
  content: string;
  sentAt: number;
  state: "sending" | "failed";
  timer: number | null;
};
```

**Pattern to copy** (add optional field, mirror `timer` optionality style):
Add `attachments?: Array<{filename: string; size: number; mimetype: string}>` — D-14. All existing consumers listed in RESEARCH.md § "PendingSend consumers" are unaffected because they read `mqid`/`state`/`timer`/`content` only. The three sites that DO care are enumerated below (Site B render + Site C spread + type).

#### Site B: `handleOptimisticSend` args widening + record spread (L1182-1256)

**Analog:** existing `handleOptimisticSend` at same location — same file, same function; extend the args object and copy `attachments` into the new record.

**Existing signature + seed spread pattern** (verbatim, L1182-1184 and L1246-1255):
```typescript
const handleOptimisticSend = useCallback(
  (args: { payload: string; mqid: string; immediateFailure: boolean }) => {
    const { payload, mqid, immediateFailure } = args;
    // …
    setPendingSends((prev) => [
      ...prev,
      {
        mqid,
        content: collapsed,
        sentAt: Date.now(),
        state: "sending",
        timer: timerHandle,
      },
    ]);
  },
  [collapseNewlinesForMatch, flipToFailed],
);
```

**Pattern to copy** — add `attachments?` to args, destructure, spread into record:
1. Add `attachments?: Array<{filename, size, mimetype}>` to args typing.
2. Destructure `attachments` alongside `payload, mqid, immediateFailure`.
3. When `attachments` is present and non-empty, include it in the record spread (both the immediateFailure fallback at L1211-1220 AND the primary seed at L1246-1255).
4. Add diagnostic marker per RESEARCH.md § Open Questions #1: extend the existing `[diag-dormant-send] arm` log at L1240 with `attachmentCount=${attachments?.length ?? 0}`.

**Note on `isIdCommand` render-blacklist at L1193:** Attachment sends never route through `/id` commands (upload flow disallows), so the existing guard stays as-is — no need to also gate on `attachments`.

#### Site C: `pendingSends.map` render call (L3317-3338)

**Analog:** existing pending render at same location.

**Existing pattern** (verbatim):
```typescript
{pendingSends.map((p) => {
  const computedPendingState: "sending" | "failed" | null =
    p.state === "failed"
      ? "failed"
      : p === latestSendingPending
        ? "sending"
        : null;
  return (
    <div
      key={`pending-${p.mqid}`}
      data-pv-bubble
      data-event-id={`pending-${p.mqid}`}
      style={{ paddingBottom: 9 }}
    >
      <ChatMessage
        role="user"
        content={p.content}
        pendingState={computedPendingState}
      />
    </div>
  );
})}
```

**Pattern to copy** — pass `attachments` prop through to `ChatMessage`:
Add one line inside the `<ChatMessage>` element: `attachments={p.attachments}`. When undefined (text-only pending), ChatMessage's new branch condition `pendingAttachments && pendingAttachments.length > 0` is false and existing markdown render fires — zero regression risk on text-only path.

#### Site D: `onUploadReadyToInject` closure — NEW seed call (L1477-1486)

**Analog:** existing closure that already lives at this exact site — extend with a seed call BEFORE the existing `formatInjectedUserTurn` + `onInjectedTurnReady` sequence.

**Existing pattern** (verbatim, L1477-1486):
```typescript
const uploads = usePrettyViewUploads({
  ws: uploadWs,
  onUploadReadyToInject: ({ messageQueueItemId, files, caption }) => {
    const injectedText = formatInjectedUserTurn({ caption, files });
    onInjectedTurnReady?.(injectedText, messageQueueItemId);
    // Clear staging after the injected turn is handed off.
    uploads.resetBatch();
  },
  getBufferedAmount: () => uploadWs?.bufferedAmount ?? 0,
});
```

**Pattern to copy** (RESEARCH.md § Option B recommendation — seed BEFORE dispatch):
Insert `handleOptimisticSend({payload: caption, mqid: messageQueueItemId, immediateFailure: false, attachments: files.map(...)})` as the FIRST statement inside the callback body, BEFORE `formatInjectedUserTurn`. Ordering per Phase 50 D-01: seed must precede the WS input frame so FIFO head-match at L1900 finds a pending record to clear.

**Concrete shape** (from RESEARCH.md § Option B):
```typescript
onUploadReadyToInject: ({ messageQueueItemId, files, caption }) => {
  // NEW — Phase 81: seed the pending bubble BEFORE dispatching the WS input frame.
  // Same handleOptimisticSend the text-only funnel calls, extended with attachments.
  // mqid === messageQueueItemId === batchId (Pitfall #2 — reuse, don't mint).
  handleOptimisticSend({
    payload: caption,
    mqid: messageQueueItemId,
    immediateFailure: false,
    attachments: files.map((f) => ({
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
    })),
  });
  // EXISTING — unchanged:
  const injectedText = formatInjectedUserTurn({ caption, files });
  onInjectedTurnReady?.(injectedText, messageQueueItemId);
  uploads.resetBatch();
},
```

**Critical invariant to preserve** (RESEARCH.md Pitfall #2): Pass `messageQueueItemId` from the event AS the mqid — DO NOT mint a fresh `pv-optim-*` id. Add a code comment naming this invariant to prevent future drift.

---

### `src/ui/features/pretty-view/ChatMessage.tsx` (component, render/prop-driven) — NEW PROP + NEW RENDER BRANCH

**Analog:** existing settled `injected` render branch at same file L479-509 — mirror the caption+chip-strip shape, but source data from a NEW prop instead of `parseInjectedUserTurn(content)`.

**Existing settled-injected pattern** (verbatim, L479-509):
```jsx
) : injected ? (
  <>
    {injected.caption.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {injected.caption}
      </div>
    )}
    <AttachmentChipStrip
      attachments={injected.files.map((f) => ({
        tempId: f.landingPath,
        file: { name: f.filename, size: f.size, type: f.mimetype },
        status: "complete",
        bytesUploaded: f.size,
        error: null,
      }))}
      onRemove={() => {
        /* readOnly — never fires */
      }}
      readOnly={true}
    />
  </>
) : (
```

**Prop-widening pattern** (mirror existing optional-prop style at L86 `pendingState?: "sending" | "failed" | null`):
Add `attachments?: Array<{filename: string; size: number; mimetype: string}>` to ChatMessage's props declaration at L52-87. Optional so text-only pendings and settled bubbles omit it (backward-compat).

**New render branch — pattern to copy** (place AFTER `injected` branch, BEFORE ReactMarkdown fallback; ordering per RESEARCH.md § "Share vs Duplicate" — `injected` first so settled-bubble semantics stay unchanged):
```jsx
) : injected ? (
  // EXISTING settled branch (unchanged)
  <> … </>
) : (attachments && attachments.length > 0) ? (
  // NEW — Phase 81 D-15: pending-with-attachments render branch.
  // Mirrors the settled `injected` branch shape but sources data from
  // the `attachments` prop (fed by PendingSend.attachments) instead of
  // parseInjectedUserTurn(content). No parse — content field carries
  // only the caption text. tempId is synthetic (pending records have no
  // landingPath); the pending bubble is short-lived so React key
  // stability across the pending→settled transition is not required.
  <>
    {content.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {content}
      </div>
    )}
    <AttachmentChipStrip
      attachments={attachments.map((f) => ({
        tempId: `pending-${f.filename}-${f.size}`,
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
  <ReactMarkdown …>{processedContent}</ReactMarkdown>
)}
```

**Rationale to duplicate inline (not extract helper)** — RESEARCH.md § "Share vs Duplicate":
1. Different caption source (`injected.caption` parsed vs raw `content`).
2. Different tempId source (`f.landingPath` verified-unique vs synthetic `pending-${filename}-${size}`).
3. Different upstream shape (`ParsedInjectedTurn["files"]` vs `PendingSend["attachments"]` stripped triple).
4. 8 lines of JSX — extracting is not a density win.

**Failure treatment inherits for free** (RESEARCH.md § "Failure Treatment Mechanics"):
The whole-bubble red style at L406-414 (`bubbleInlineStyle` applied at outer bubble `<div>` L420) applies UNIFORMLY regardless of inner content branch. Nothing new in ChatMessage for D-08 — Phase 76's Red-fill applies to the new pending-with-attachments branch by construction.

**Anti-pattern to avoid** (RESEARCH.md § "Anti-Patterns to Avoid"):
Do NOT synthesize a fake `formatInjectedUserTurn()` string on the pending record's `content` field just to reuse the existing `injected` branch. Requires fabricating `landingPath` values the pending bubble doesn't know and shouldn't display. Direct prop-passing is structurally simpler.

---

### `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` (test, scenario-driven) — INLINE EXTENSION

**Analog:** existing tests at same file — reuse the mount factory (L176-186), the WS stub (`getCurrentWs`), `flipToStreaming`, and `typeAndEnter` helpers.

**Existing mount + seed test pattern** (verbatim, L188-207):
```typescript
it("Test 1: onOptimisticSend seeds pendingSends and renders an optimistic bubble", async () => {
  const { container } = mount();
  const ws = getCurrentWs();
  flipToStreaming(ws);
  await waitFor(() =>
    expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
  );

  typeAndEnter(container, "hello");
  await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
  const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
  expect(pendingEl).not.toBeNull();
  const eventId = pendingEl.getAttribute("data-event-id");
  expect(eventId).toMatch(/^pending-pv-optim-/);
  expect(pendingEl.textContent).toContain("hello");
  expect(pendingEl.querySelector("[data-pv-bubble-spinner]")).not.toBeNull();
});
```

**Extension pattern** — add a nested describe at end of file (after L1008 "render latest-only + interleaving" block):
```typescript
describe("PrettyView — attachment pending bubbles (Phase 81)", () => {
  beforeEach(() => { /* mirror L152-168 setup */ });
  afterEach(() => { /* mirror L170-174 */ });

  // Test cases per RESEARCH.md § "Suggested new test cases":
  it("upload_ready_to_inject event → pending bubble seeds with caption + chip metadata", ...);
  it("pending attachment bubble renders caption above chip strip (AttachmentChipStrip readOnly)", ...);
  it("empty caption + attachments → chip strip only, no caption line", ...);
  it("pending attachment bubble → whole bubble red on flip-to-failed (Phase 76 D-06 inheritance)", ...);
  it("superseded batch (A superseded by B) → only B's pending bubble seeds, not A's", ...);
  it("upload_failed → NO pending bubble ever seeds (D-12 regression)", ...);
  it("WS-not-open at startBatch → NO pending bubble ever seeds (D-12 regression)", ...);
  it("FIFO head-match on user-role echo clears pending attachment bubble same as text (D-10)", ...);
  it("mqid on pending attachment bubble === batchId === messageQueueItemId from upload_ready_to_inject", ...);
  it("caption containing '---attached files---' literal renders as pending-attachment (Pitfall #4)", ...);
});
```

**Trigger mechanism for attachment tests:** Since the seed lives in PrettyView's `onUploadReadyToInject` closure (Option B), the test needs to fire an `upload_ready_to_inject` WS frame at the mounted PrettyView. The existing WS stub harness (`getCurrentWs`, `wsStubs.length = 0` reset at beforeEach L154) supports arbitrary frame injection via `ws.onmessage({ data: JSON.stringify({type: "upload_ready_to_inject", messageQueueItemId, files: [...]}) })`. No new harness needed — reuse the existing stub verbatim.

---

### `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` (test, integration/two-event) — ONE NEW TEST

**Analog:** existing Test 3 "handleInjectedTurnReady two-event pattern" at L241-322.

**Existing pattern** — mounts PrettyView, drives `handleInjectedTurnReady` via the ref, asserts WS write ordering (body first no-mqid, then 60ms-delayed `\r+mqid`).

**Pattern to copy** — add a NEW test after Test 3 that additionally asserts the seed. Same mount, same ref-driver, but with a wired-up mocked `handleOptimisticSend` spy or a query for the `pending-${mqid}` bubble in the DOM. The test verifies: when `upload_ready_to_inject` fires (via `usePrettyViewUploads` internal state, or by injecting the WS frame directly), the pending bubble appears in the DOM WITH the `messageQueueItemId` as its mqid AND BEFORE the WS write frames go out.

**Assertion focus** (RESEARCH.md § "Test File Layout"): This is where the plumbing landing site can be regression-tested at the integration level. One test suffices — coverage of individual trigger sites is redundant because Option B funnels ALL four attachment-trigger paths through the same `onUploadReadyToInject` handler.

---

## Shared Patterns

### Optimistic-seed callback contract (Phase 50 baseline — extends unchanged)
**Source:** `PrettyView.tsx:1182-1258` (`handleOptimisticSend`)
**Apply to:** the new `onUploadReadyToInject` seed call site + existing funnel callsites
**Excerpt of the invariant to preserve:**
```typescript
// Seed BEFORE dispatch (Phase 50 D-01). The FIFO head-match at L1900 fires
// when the harness echo arrives; if the pending record doesn't exist yet
// when the echo lands, the echo appends as a normal user message and no
// cleanup happens — pending bubble orphans forever.
onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: false });
const dispatched = onSend(payload, mqid);
```

### FIFO head-match cleanup (Phase 50 baseline — extends unchanged for attachments)
**Source:** `PrettyView.tsx:1900-1911`
**Apply to:** attachment pendings — this exact block clears them on echo via role + state + FIFO position (content-equality NOT required — D-10).
```typescript
if (parsed.role === "user") {
  const list = pendingSendsRef.current;
  const oldestSendingIdx = list.findIndex((p) => p.state === "sending");
  if (oldestSendingIdx !== -1) {
    const match = list[oldestSendingIdx]!;
    if (match.timer !== null) window.clearTimeout(match.timer);
    setPendingSends((prev) => prev.filter((p) => p.mqid !== match.mqid));
  }
}
```

### Whole-bubble red on failure (Phase 76 D-06 — inherits for free)
**Source:** `ChatMessage.tsx:406-414` and its application at L420
**Apply to:** the new pending-with-attachments render branch — nothing to do; the outer bubble `<div>` inline style applies regardless of inner branch.
```typescript
const showFailedBubble = isUser && pendingState === "failed";
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      background: "hsla(0, 60%, 35%, 0.90)",
      borderColor: "hsla(0, 70%, 50%, 0.85)",
    }
  : { position: "relative" };
// Applied at L420: <div … style={bubbleInlineStyle} …>
```

### Sender-side chip render via `readOnly` mode (Phase 05 UPLOAD-11 lock)
**Source:** `AttachmentChipStrip.tsx:36-49` (prop contract), `AttachmentChipStrip.tsx:107` (data-readonly attribute), `AttachmentChipStrip.tsx:114-134` (styling gates)
**Apply to:** the new pending-with-attachments render branch — pass `readOnly={true}` verbatim (RESEARCH.md Pitfall #6: omitting it renders interactive-staging chrome, wrong visual).
**Test assertion aid:** `data-readonly="true"` attribute at L107 lets tests assert readOnly mode is on.

### mqid === messageQueueItemId === batchId invariant (Phase 81 NEW — codify to prevent drift)
**Source:** RESEARCH.md § Pitfall #2 + `use-pretty-view-uploads.ts:449-469`
**Apply to:** the new seed call inside `onUploadReadyToInject` closure — the mqid MUST be `messageQueueItemId` from the event, not a freshly-minted `pv-optim-*` id. Add a code comment naming this invariant at the seed site. Regression risk: copy-paste from `useComposeSend.send` at `ComposeBox.tsx:465` would introduce a fresh id and decorrelate frontend/backend logs.

### Diagnostic-log marker for attachment pendings (RESEARCH.md § Open Questions #1)
**Source:** `PrettyView.tsx:1240` (existing `[diag-dormant-send] arm` log)
**Apply to:** `handleOptimisticSend` — extend the existing log line with `attachmentCount=${attachments?.length ?? 0}` so post-ship grep can distinguish attachment seeds from text-only seeds without correlating two log lines. One-line addition, high diagnostic value.

---

## No Analog Found

None. Every touched file has an in-file analog from a prior phase (Phase 05 for the chip-strip render; Phase 50 for the PendingSend + FIFO + seed machinery; Phase 68 for the funnel primitive; Phase 76 for the red-fill treatment). This phase is 90% wiring per RESEARCH.md.

---

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet-tabitha/src/ui/features/pretty-view/` (all files)
- `/home/ubuntu/skynet-tabitha/src/ui/api/pretty-view-upload-protocol.ts`

**Files scanned/read:**
- `ComposeBox.tsx` (targeted reads L175-204, L440-496)
- `PrettyView.tsx` (targeted reads L1110-1290, L1467-1490, L1880-1918, L3310-3358)
- `ChatMessage.tsx` (reads L1-120, L280-520)
- `use-pretty-view-uploads.ts` (targeted reads L80-120, L440-475)
- `AttachmentChipStrip.tsx` (read L1-140)
- `pretty-view-upload-protocol.ts` (targeted read L115-142)
- `PrettyView.optimistic-bubbles.test.tsx` (structure grep + targeted read L147-207)
- `PrettyView.compose-send.test.tsx` (structure grep)

**Pattern extraction date:** 2026-09-07
**Corrections applied from RESEARCH.md:**
- Trigger-site matrix corrected from D-18: only 4 attachment sites need seed calls, not 6 (queue-slot text and cadence text already route through funnel via Phase 68 follow-up).
- Plumbing option chosen: Option B (seed in PrettyView's `onUploadReadyToInject` closure). Option A rejected on ordering grounds. Option C recognized as functionally identical to B.
- ChatMessage new branch: duplicate inline, do NOT extract shared helper.
- Test structure: inline extension of `PrettyView.optimistic-bubbles.test.tsx` + ONE integration test in `PrettyView.compose-send.test.tsx`. No sibling test files.
