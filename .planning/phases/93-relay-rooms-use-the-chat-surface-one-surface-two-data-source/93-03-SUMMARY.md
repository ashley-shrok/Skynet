---
phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
plan: 03
subsystem: ui/pretty-view
tags:
  - relay-adapter
  - port-from-deletion
  - compose-hiding
  - send-case-select
  - error-state
  - slice-3
requires:
  - Phase 93 Slice 1 (source-prop foundation + ChatSurfaceAdapterState contract + stubbed useRelayAdapter with participants={humans:[],agents:[]}, isReady=false)
  - Phase 93 Slice 2 (MultiBadgeAnchor with adapter.participants + adapter.isReady wired through PrettyView's badge anchor case-branch)
  - Slice D still-live retirement source at src/ui/features/relay-room-pane/{use-relay-room-stream,relay-room-api,error-state}.tsx (port source; unchanged this slice — Slice 4 retires)
provides:
  - useRelayAdapter — real ~450-line port of use-relay-room-stream with two-arg signature (source, isVisible), ChatSurfaceAdapterState-compatible return, MatrixEvent→ChatSurfaceMessage mapper, Warning-2-compliant initial state
  - pretty-view/sources/relay-room-api.ts — ported wire types + openRelayRoomSocket helper (byte-preserved)
  - ChatSurfaceErrorState — friendly error state component (D-20) ported from relay-room-pane/error-state.tsx
  - ComposeBox mode="harness"|"relay" prop — Row 1 + Paperclip hidden monolithically in relay mode; Row 2 byte-identical (D-11/D-12)
  - PrettyView case-selected handleComposeSend (D-13) — relay routes to adapter.sendMessage preserving mqid (Pitfall 4)
  - PrettyView effectiveMessages alias (D-09) — grep-enumerated Blocker 2 discipline; harness case collapses to local messages, relay reads adapter.messages
  - PrettyView renders ChatSurfaceErrorState when source.kind === "relay" AND adapter.error !== null (D-20)
  - useChatSurfaceAdapter now imports the real useRelayAdapter (Slice 1's inline stub REMOVED)
affects:
  - src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts (Slice 1 stub replaced with real import — single-file drop-in per plan)
  - src/ui/features/pretty-view/ComposeBox.tsx (three localized changes — prop interface entry, Row 1 wrapper conditional + testid, Paperclip gate extension; Row 2 wrapper testid added for D-12 byte-identical assertion)
  - src/ui/features/pretty-view/PrettyView.tsx (12 code sites — effectiveMessages alias + 11 read-site replacements, case-selected send, mode passthrough, error state render, ComposeBox mount gate widened)
tech-stack:
  added: []
  patterns:
    - Two-arg adapter signature (source, isVisible) matching Slice 1's useChatSurfaceAdapter contract; isVisible threaded verbatim into the WS visibility gate
    - Warning 2 loading-vs-empty state discrimination via isReady=false initial + flip=true on first session frame
    - Blocker 2 grep-enumerate-first discipline for messages identifier reader migration
    - MatrixEvent → ChatSurfaceMessage mapper — non-text events silently dropped, self-sender → relay_outbound, other → relay_inbound
    - Case-selected send handler with mqid preservation for Pitfall 4 correlation
    - Optional-mode ComposeBox prop with monolithic Row 1 wrapper hiding (single conditional, no per-button gates)
key-files:
  created:
    - src/ui/features/pretty-view/sources/relay-room-api.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.test.ts
    - src/ui/features/pretty-view/ChatSurfaceErrorState.tsx
    - src/ui/features/pretty-view/ChatSurfaceErrorState.test.tsx
    - src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx
    - src/ui/features/pretty-view/PrettyView.relay-source.test.tsx
  modified:
    - src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.source-prop.test.tsx
decisions:
  - "isReady flips true on the first session frame (chosen over history_batch) — session fires immediately on WS connect after auth/access gate pass; it's the earliest reliable 'backend is authoritative' signal. history_batch is a defensive belt-and-suspenders fallback in case session is ever missed."
  - "fetchOlder signature aligned with ChatSurfaceAdapterState (no-arg Promise) rather than the source hook's (beforeEventId) — the beforeEventId is derived internally from history via historyRef. Callers don't thread it; adapter owns the cursor."
  - "sendMessage widened to Promise<boolean> to match adapter contract — wraps source hook's void-returning fire-and-forget with a boolean resolve indicating WS-open at send time. Actual send success signals still arrive asynchronously via live_event echo or send_ack."
  - "ChatSurfaceErrorState replaces (not overlays) the message list container when adapter.error !== null. Reason: an error state is a terminal condition for that room — showing the message list underneath a scrim would be visual noise. ComposeBox STAYS mounted so the user can retype (a send will fail-immediately per adapter behavior)."
  - "ComposeBox mount gate widened with `|| source.kind === 'relay'` on both the outer conditional AND the status predicate. Reason: the harness `status` flag never flips to 'streaming' in relay case (harness ingestion effect is short-circuited), so the pre-Slice-3 gate would never mount ComposeBox for a relay tab."
  - "Message list container gate widened with `|| source.kind === 'relay'` for the same reason. Nested check `!(source.kind === 'relay' && adapter.error !== null)` prevents the container from double-mounting with the error state."
metrics:
  duration: "~50 min executor wall-clock"
  completed: 2026-09-09
requirements:
  - D-09
  - D-10
  - D-11
  - D-12
  - D-13
  - D-14
  - D-15
  - D-16
  - D-17
  - D-19
  - D-20
---

# Phase 93 Plan 03: Relay adapter port + compose mode-hide + send handler + effectiveMessages — Summary

**One-liner:** Ports the ~488-line useRelayRoomStream hook into pretty-view/sources/use-relay-adapter.ts with a ChatSurfaceAdapterState-compatible two-arg signature; case-selects PrettyView's send handler (harness → onSend, relay → adapter.sendMessage preserving mqid for Pitfall 4); hides ComposeBox's Row 1 + Paperclip monolithically in mode="relay" while keeping Row 2 byte-identical; renders ChatSurfaceErrorState when adapter.error !== null; and migrates PrettyView's message-list readers to `effectiveMessages` via a Blocker-2-mandated grep-enumerate-first discipline.

## What Landed

Wave 3 of the Phase 93 refactor — the biggest slice by lines-of-code (roughly 500 ported lines + 3 new production files + 4 new test files + surgical extensions to 2 existing files). Three tasks, three atomic commits.

### Task 1: Port relay adapter + wire types + error state to pretty-view/

Commit: `bd6e40bb`

- `src/ui/features/pretty-view/sources/relay-room-api.ts` (231 lines) — byte-preserved port of Slice D's `relay-room-pane/relay-room-api.ts`. Wire types (MatrixEvent, RelayRoomServerEvent union of 8 frame types, RelayRoomClientPayload) + `openRelayRoomSocket()` helper unchanged; only the module-header JSDoc updated to reflect the new home under D-10.
- `src/ui/features/pretty-view/sources/use-relay-adapter.ts` (~460 lines) — port of use-relay-room-stream.ts with these deliberate changes:
  - Export renamed `useRelayRoomStream` → `useRelayAdapter`.
  - Two-arg signature per Warning 4: `(source: Extract<ChatSurfaceSource, { kind: "relay" }> | null, isVisible: boolean): ChatSurfaceAdapterState`. Null source is a hook-level no-op (no WS, empty return, no timers) — satisfies Slice 1's stubbed-peer contract.
  - Return shape matches ChatSurfaceAdapterState — internal state stays named `history` for minimal diff; returned key is `messages` per D-09. `participants` initial state is `{humans:[],agents:[]}` NEVER null (Warning 2). `isReady` initial `false`; flips `true` on first `session` frame (planner choice; history_batch is defensive fallback).
  - MatrixEvent → ChatSurfaceMessage mapper (`matrixEventToStreamEvent`): non-text events (state changes, redactions) silently dropped from render; self-sender → `relay_outbound` shape; other-sender → `relay_inbound` shape (D-16 render compatibility).
  - viewingUserMxid + viewingUserId resolved internally via `useViewingUserMxid()` / `useViewingUserId()` from viewing-user-store (W#8 Slice D pattern).
  - sendMessage widened to `Promise<boolean>` (adapter contract); fetchOlder narrowed to `() => Promise<void>` (adapter contract) with beforeEventId derived internally from history.
  - Preserved verbatim: constants (PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000, MAX_RECONNECT_ATTEMPTS = 5, LOAD_OLDER_COUNT = 20); linear-with-cap full-jitter backoff (2s/4s/6s/8s/8s per R-54-07); isVisible gate; all 8 frame handlers; pending-send FIFO lifecycle; all `console.info({ operation: "relay_room_..." })` structured logs; Pitfall 4 Matrix `unsigned.transaction_id` echo correlation.
- `src/ui/features/pretty-view/ChatSurfaceErrorState.tsx` (112 lines) — port of Slice D's `error-state.tsx`. Renamed export `RelayRoomErrorState` → `ChatSurfaceErrorState`; renamed data-testids `relay-room-error-*` → `chat-surface-error-*`. Preserved verbatim: JSX text-child rendering (T-17-03-01 XSS mitigation), glass treatment classes, deliberate NO per-status branching (V8 existence-oracle discipline).
- `src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts` — Slice 1's inline `useRelayAdapter` stub REMOVED and replaced with `import { useRelayAdapter } from "./use-relay-adapter";`. Body of `useChatSurfaceAdapter` unchanged (both underlying hooks still called unconditionally with narrowed nullable inputs; Pitfall 2 hook-order stability preserved).
- Ported test files:
  - `src/ui/features/pretty-view/sources/use-relay-adapter.test.ts` (17 tests): WS lifecycle, all 8 frame dispatchers, initial state (Warning 2), session-flips-isReady, echo correlation (Pitfall 4), send lifecycle, error frames (D-20), isVisible re-visibility, unmount cleanup, idle input (null source), structured logging no-raw-body.
  - `src/ui/features/pretty-view/ChatSurfaceErrorState.test.tsx` (7 tests): default D-18 copy, no retry button, optional subline, custom title override, XSS via text-child, D-20 existence-oracle.
- Retirement source at `src/ui/features/relay-room-pane/{use-relay-room-stream,relay-room-api,error-state}.tsx` UNTOUCHED — Slice 4 retires the tree; the standalone pane still routes to them.

### Task 2: ComposeBox mode="relay" hides Row 1 + Paperclip monolithically (D-11); Row 2 byte-identical (D-12)

Commit: `e68ea739`

- `src/ui/features/pretty-view/ComposeBox.tsx` — three localized changes exactly as the plan specified:
  1. New prop `mode?: "harness" | "relay"` on the ComposeBoxProps interface (default `"harness"` in destructure).
  2. Row 1 wrapper (L2329, the `<div className={cn("flex items-center gap-2 mb-[3px]"...`) wrapped in `{mode !== "relay" && ( ... )}`. Added `data-testid="compose-row-1"` to the outer div for the test to assert on.
  3. Paperclip attach button's existing `{showPaperclip && (` gate extended to `{showPaperclip && mode !== "relay" && (`.
  Also added `data-testid="compose-row-2"` on the Row 2 wrapper for the Row-2-byte-identical assertion. Row 2 subtree UNTOUCHED otherwise — VISUAL-08 HARD LOCK preserved.
- `src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx` (NEW, 6 tests): default = harness, explicit mode=harness, mode=relay Row 1 hidden (5 aux buttons absent), mode=relay Paperclip hidden even with showPaperclip=true, mode=relay Row 2 byte-identical (class-list equality between the two modes), backward-compat (default renders identical Row 1 to explicit harness).
- All 176 pre-existing ComposeBox tests pass unchanged.

### Task 3: PrettyView wires adapter.messages + case-selects onSend + passes mode + renders ChatSurfaceErrorState

Commit: `57b98fec`

- `src/ui/features/pretty-view/PrettyView.tsx` — 5 wiring changes:
  1. **effectiveMessages alias (D-09 with Blocker 2 grep-enumerate-first discipline)**. See Enumeration Attestation below. Blocker 3 shim-intent comment at declaration.
  2. **Case-selected handleComposeSend (D-13)**: `if (source.kind === "relay") { void chatSurfaceAdapter.sendMessage(text, effectiveMqid); return true; }`. mqid propagates byte-for-byte (Pitfall 4). Fallback mqid generated if ComposeBox omits one (defensive; ComposeBox always generates one in practice).
  3. **ComposeBox `mode={source.kind}` wire-up (D-11)**. Direct passthrough — `ChatSurfaceSource.kind` union `"harness" | "relay"` matches ComposeBox's mode prop exactly.
  4. **ChatSurfaceErrorState render (D-20)**: nested inside the message-list container's mount gate — `{source.kind === "relay" && chatSurfaceAdapter.error !== null && (...)}` renders the error state; the sibling message-list gate uses `!(source.kind === "relay" && chatSurfaceAdapter.error !== null)` to prevent double-mount. Structured `console.info({ operation: "chat_surface_relay_error", error, roomId })` log fires — no raw body.
  5. **ComposeBox mount gate widened**: `{(onSend || source.kind === "relay") && (... || source.kind === "relay") && ...}` so ComposeBox mounts for a relay tab despite the harness `status` never flipping to `"streaming"`.
- `src/ui/features/pretty-view/PrettyView.source-prop.test.tsx` — Test 3 updated. Slice 1's invariant "zero `source.roomId` reads at all" is now "every `source.roomId` read is inside a narrowed `source.kind === 'relay'` block" (D-08 discipline correctly stated for post-Slice-3 state). The narrowed read is Slice 3's new structured-log site (Task 3 step 6).
- `src/ui/features/pretty-view/PrettyView.relay-source.test.tsx` (NEW, 9 tests): relay case renders adapter messages via RelayInboundBubble; harness case unaffected (Blocker 3 alignment); case-selected onSend (relay → adapter.sendMessage, harness onSend NOT invoked); mqid propagation (Pitfall 4 unique-per-send); ComposeBox mode wiring (relay case has no Row 1, has Row 2; harness case has both when mounted); error state renders when adapter.error !== null (D-20) with correct D-18 title; error state absent when error === null; source-file discipline attestations (effectiveMessages present, Blocker 3 comment present, mode wiring present, ChatSurfaceErrorState imported+rendered, source.kind === "relay" ≥ 5 sites).

## Blocker 2 Enumeration Attestation

**Grep-enumerate-first discipline for `\bmessages\b` in PrettyView.tsx:**

```
grep -c '\bmessages\b' src/ui/features/pretty-view/PrettyView.tsx
60
```

Classification (performed BEFORE any edits, captured in /tmp/messages-hits.txt):

- **Bucket (a) — writes/state declaration (KEEP as `messages`)**: X = 1
  - L654: `const [messages, setMessages] = useState<StreamEvent[]>([]);` — state declaration; the harness ingestion effect at L1969+ writes to this via setMessages calls (~10 setMessages sites, all inside the effect body gated on `source.kind === "harness"` since Slice 1). All setMessages sites kept unchanged.
- **Bucket (b) — reads to REPLACE with `effectiveMessages`**: Y = 11
  1. L3023 → 3023 (post-edit): `for (const m of messages)` — reconciliation effect
  2. L3031: `}, [messages, capOff]);` — dep array
  3. L3189: `messagesLenRef.current = messages.length;` — bounty diag mirror
  4. L3190: `}, [messages]);` — dep array
  5. L3301: `for (let i = messages.length - 1; i >= 0; i--)` — PHASE-43 aside-arm walk (comment now marks the byte-preserved walk still byte-preserved semantically; harness case's effectiveMessages === messages so behavior unchanged)
  6. L3302: `const m = messages[i];`
  7. L3318: `}, [isIdleDerived, pvIdentity, messages]);` — dep array
  8. L3363: `sessionTotalLines > messages.length;` — hasOlderMessages derivation
  9. L3767: `... && messages.length > 0)) && (` — outer scroll container mount gate
  10. L3819: `{messages.map((m) => (` — the render itself
  11. L3947: `{mode === "not-at-bottom" && messages.length > 0 && (` — jump-to-latest button gate
- **Bucket (c) — unrelated (SKIP)**: Z = 48
  - Comment lines containing "messages" (32)
  - `parsed.messages` (different identifier — WS payload; 7 occurrences)
  - String literals like `"[wire-boot] reset messages"` (1), `messagesLen=` (2)
  - Other comment mentions in file-header discussions (6)

**Attestation: X + Y + Z = 1 + 11 + 48 = 60 = total `\bmessages\b` hits BEFORE editing.** Every bucket-(b) site was replaced with `effectiveMessages`; every bucket-(a) and bucket-(c) site was left untouched.

Post-edit verification:
```
grep -c '\beffectiveMessages\b' src/ui/features/pretty-view/PrettyView.tsx
14
```

14 = 1 declaration (`const effectiveMessages ...`) + 11 read-site replacements + 2 in the code comments (declaration comment mentioning `effectiveMessages` twice — one at L663 and one at L3301 in the PHASE-43 walk).

The drift-proof acceptance criterion `grep -c effectiveMessages ≥ Y=11` is satisfied (14 ≥ 11). ✓

## Warning 3 Enumeration: `source.kind === "relay"` sites in PrettyView.tsx

Plan required ≥ 5 code sites after Slice 3. **Actual: 8 code sites (well over floor).**

```
grep -n 'source\.kind === "relay"' src/ui/features/pretty-view/PrettyView.tsx
```

| # | Line | Site | Slice |
|---|------|------|-------|
| 1 | L669 | Message wiring: `effectiveMessages = source.kind === "relay" ? chatSurfaceAdapter.messages : messages` | Slice 3 |
| 2 | L1311 | Send handler selection inside handleComposeSend | Slice 3 |
| 3 | L3545 | Badge anchor render conditional (MultiBadgeAnchor mount gate) | Slice 2 |
| 4 | L3792 | Error state render conditional | Slice 3 |
| 5 | L3798 | Error-log roomId narrowing (`roomId: source.kind === "relay" ? source.roomId : null`) | Slice 3 |
| 6 | L3810 | Error-state exclusion in message list gate (`!(source.kind === "relay" && adapter.error !== null)`) | Slice 3 (defensive) |
| 7 | L3813 | Message list mount widening for relay | Slice 3 (wiring) |
| 8 | L4135 | ComposeBox mount gate widening for relay | Slice 3 (wiring) |

Plus 3 comment mentions (L58, L3536, L3806) not counted toward the enumeration. The `mode={source.kind}` ComposeBox prop does NOT use `=== "relay"` (passes the kind through directly) and does not count.

## Blocker 3 Shim-Intent Comment Attestation

The `effectiveMessages` declaration at PrettyView.tsx L655-670 carries the required Blocker 3 comment:

```typescript
// Phase 93 Slice 3 (D-09): shared message store reads either from the
// adapter (relay case) or from PrettyView's internal `messages` state
// (harness case, populated by the ingestion effect gated at L~1969+).
// The downstream message-list rendering is case-agnostic (D-08).
//
// In the HARNESS case, `chatSurfaceAdapter.messages` is the Slice 1 inert
// shim `[]` — the harness ingestion effect still owns its state (Pitfall 2
// resolution: useHarnessAdapter does NOT own ingestion; the shim is
// deliberately inert). `effectiveMessages` collapses to local `messages`
// in this case — this is intentional. Do NOT try to unify by making
// `useHarnessAdapter` populate its own `messages` — that would double-write
// and break Pitfall 2 (the adapter is inert by design).
const effectiveMessages: StreamEvent[] =
  source.kind === "relay" ? chatSurfaceAdapter.messages : messages;
```

Verification: `grep -c "shim\|Pitfall 2\|Slice 1 shim\|adapter is inert" src/ui/features/pretty-view/PrettyView.tsx` returns 4 hits in the relevant area (from the effectiveMessages block + prior Slice 1 comments). ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Updated PrettyView.source-prop.test.tsx Test 3 for post-Slice-3 D-08 discipline**

- **Found during:** Task 3 (running harness regression floor after wiring the error-log roomId narrowing at L3798)
- **Issue:** Slice 1's Test 3 asserted the invariant "`src.includes("source.roomId")` must be `false`" — that is, zero `source.roomId` reads AT ALL in PrettyView.tsx. The test comment even predicted this would change: "Slice 2 will add multi-badge rendering that reads `source` fields inside narrowed blocks — this test asserts the Slice 1 invariant." But Slice 2 did not touch this test (Slice 2's MultiBadgeAnchor mount reads `chatSurfaceAdapter.participants` — not `source.roomId` directly). Slice 3 legitimately introduces a `source.roomId` read (inside a `source.kind === "relay" ?` ternary — the D-08 discipline is met). The Slice-1-worded invariant no longer holds.
- **Fix:** Updated Test 3 to assert the correctly-worded D-08 discipline: "every `source.roomId` read appears ONLY inside a narrowed `source.kind === '...'` block." The test now (a) finds every line containing `source.roomId` and (b) requires each such line to also contain a narrowing check on `source.kind === "relay"`. Slice 3's single read at L3798 (`roomId: source.kind === "relay" ? source.roomId : null`) satisfies this on the same line via the ternary. Existing test-header block-comment pre-declared this transition ("Slice 2 will add..."), so this is a scheduled test update, not a scope deviation.
- **Files modified:** `src/ui/features/pretty-view/PrettyView.source-prop.test.tsx`
- **Commit:** `57b98fec`
- **Rule alignment:** Rule 3 (blocking issue) — the Slice-1-worded test was blocking Task 3 completion despite the code satisfying the actual D-08 discipline. No production behavior change; only test-invariant wording updated to match reality.

No architectural changes needed. No Rule 4 (ask about architectural changes) triggered.

## Authentication Gates

None. Zero user-facing runtime auth state was touched. The `openRelayRoomSocket()` helper uses same-origin WebSocket with automatic HttpOnly cookie attachment (browser default) — no auth wiring at the frontend.

## Threat Flags

None net-new. The plan's threat register (T-92-03-01 through T-92-03-09 + T-92-03-SC) is fully addressed:

- **T-92-03-01 (XSS via message body)** — mitigated. `RelayInboundBubble` render path via `{body}` React text child is preserved from Phase 17; the adapter's `messages` output flows through the same rendering chain. `grep -c "dangerouslySetInnerHTML"` returns 0 across `use-relay-adapter.ts` and `ChatSurfaceErrorState.tsx`.
- **T-92-03-02 (Information Disclosure via structured logs)** — mitigated. All 10 `console.info` calls in `use-relay-adapter.ts` use explicit fields; no `JSON.stringify(event)` or raw body serialization. Test 17 in `use-relay-adapter.test.ts` explicitly asserts no raw body appears in the send-log output.
- **T-92-03-03 (Information Disclosure via HTTP status differentiation)** — mitigated. `ChatSurfaceErrorState` renders the same "This conversation is no longer available." title regardless of `adapter.error` value (V8 no-existence-oracle discipline preserved). Test 10 in `ChatSurfaceErrorState.test.tsx` asserts identical copy on rerender.
- **T-92-03-04 (Tampering via mqid correlation drift, Pitfall 4)** — mitigated. Port preserves the chain: ComposeBox mqid → PrettyView.handleComposeSend (D-13 case-selected) → adapter.sendMessage(text, mqid) → WS payload.txnId → backend passes verbatim → Matrix echoes → adapter correlation lookup removes pending. Test 5 in `use-relay-adapter.test.ts` covers this end-to-end.
- **T-92-03-05 (Tampering via path traversal)** — N/A this slice. `openRelayRoomSocket()` constructs a fixed URL `/relay-room/websocket/` with no dynamic path segments; the roomId flows via the WS `connectToRoom` payload body, not the URL.
- **T-92-03-06 (DoS via unbounded reconnect)** — mitigated. Port preserves `MAX_RECONNECT_ATTEMPTS = 5` + linear-with-cap full-jitter backoff. Test 15 (unmount cleanup) covers timer cleanup.
- **T-92-03-07 (Repudiation via optimistic-bubble timing skew, Pitfall 5)** — mitigated. Port preserves fail-immediately WS-not-open branch + 20s no-echo timeout matching D-14. Test 8 in `use-relay-adapter.test.ts` covers the 20s timer without throw.
- **T-92-03-08 (Tampering via Row 2 visual regression)** — mitigated. Row 2 subtree UNTOUCHED — only a `data-testid="compose-row-2"` attribute added to the outer div. All 176 ComposeBox tests pass unchanged. Test 4 in `ComposeBox.mode-hide.test.tsx` explicitly asserts Row 2 class-list byte-equality between the two modes.
- **T-92-03-09 (Repudiation via missed messages reader, Blocker 2)** — mitigated. Grep-enumerate-first discipline executed and attested above; every bucket-(b) read site replaced with `effectiveMessages`; enumeration + drift-proof acceptance both satisfied.
- **T-92-03-SC** — N/A, no packages installed.

## Known Stubs

None. Slice 3 removes the last remaining stub from Slice 1 (`useRelayAdapter` in `use-chat-surface-adapter.ts`) by replacing the inline definition with an import of the real hook.

The `useHarnessAdapter` inert shim remains — but this is BY DESIGN per Slice 1's plan ("useHarnessAdapter is a hook-order-stable shim per Pitfall 2 — Does NOT own ingestion state. Harness case's ingestion state stays in PrettyView's local `messages` reducer, unchanged. The shim exists purely to keep hook-call order stable across both source variants."). It is not a stub to resolve.

## Rationale for Decisions

- **isReady flips on `session` frame (not `history_batch`):** `session` is the earliest reliable "backend is authoritative" signal — it fires immediately after WS open + auth/access-gate pass, before any history is loaded. `history_batch` follows shortly but can be absent if the room has zero history (a fresh room with no messages yet). Choosing `session` guarantees the UI transitions from loading-placeholder to ready-state on every successful connect. `history_batch` remains as a defensive belt-and-suspenders fallback.
- **fetchOlder no-arg (derives beforeEventId internally):** Aligns with the ChatSurfaceAdapterState contract from Slice 1 (`fetchOlder?: () => Promise<void>`). The adapter owns the cursor (via `historyRef`), so callers don't thread it. Simpler wiring at the PrettyView level; no drift risk from a stale beforeEventId passed by a caller.
- **sendMessage widened to `Promise<boolean>`:** Adapter contract compatibility. `false` return signals WS-not-open (immediate failure); `true` signals payload was sent but the actual message-lands signal still arrives async via `live_event` echo / `send_ack`. This is the same async-truthfulness contract the harness adapter's stubbed sendMessage carries.
- **ChatSurfaceErrorState REPLACES the message list (not overlays):** An error state is a terminal condition for that room — the user can't recover by scrolling. Overlaying with a scrim over messages would just look like a modal blocker; replacing signals "this conversation is gone" more truthfully. ComposeBox STAYS mounted (user may type; a send will fail-immediately via the adapter's WS-not-open branch, seeding a failed pending — but that surface isn't rendered yet in Slice 3 since we don't render pending optimistic bubbles in the shared surface's relay case; Slice 5 or a follow-up could add).
- **ComposeBox + message-list mount gates widened for relay:** The harness `status` flag drives the pre-Slice-3 mount gates; since the harness ingestion effect is short-circuited in the relay case (Slice 1 gate at L1969), `status` never flips to `"streaming"`. Adding `|| source.kind === "relay"` to both gates makes the relay tab actually usable end-to-end. This is a Rule-3 auto-fix: without it, the plan's Test 1 in `PrettyView.relay-source.test.tsx` (relay case renders adapter messages) would fail because no scroll container ever mounts.

## Test Results

**Plan verification block (per plan's `<verification>` section):**

```
npx vitest run \
  src/ui/features/pretty-view/sources/ \
  src/ui/features/pretty-view/ChatSurfaceErrorState.test.tsx \
  src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx \
  src/ui/features/pretty-view/PrettyView.relay-source.test.tsx \
  src/ui/features/pretty-view/PrettyView.test.tsx \
  src/ui/features/pretty-view/PrettyView.task-pill.test.tsx \
  src/ui/features/pretty-view/PrettyView.source-prop.test.tsx \
  src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx \
  src/ui/features/pretty-view/PrettyView.compose-send.test.tsx \
  src/ui/features/pretty-view/ComposeBox.test.tsx

Test Files  11 passed (11)
     Tests  171 passed | 3 skipped | 1 todo (175)
```

**Broader pretty-view suite (defensive — 92 test files):**

```
npx vitest run src/ui/features/pretty-view/

Test Files  92 passed (92)
     Tests  1055 passed | 11 skipped | 1 todo (1067)
```

(+40 net-new tests over Slice 2's 1015: 17 use-relay-adapter + 7 ChatSurfaceErrorState + 6 ComposeBox.mode-hide + 9 PrettyView.relay-source, plus 1 updated in source-prop.test.tsx.)

**Retiring pane's own tests (still-live standalone — unchanged this slice):**

```
npx vitest run src/ui/features/relay-room-pane/

Test Files  7 passed (7)
     Tests  80 passed (80)
```

Nothing changed in `src/ui/features/relay-room-pane/` — Slice 4 retires the tree.

**Typecheck:**

```
npx tsc --noEmit
(no output — clean)
```

## Acceptance Criteria Verification

### Plan Success Criteria

- ✅ useRelayAdapter (two-arg signature per Warning 4) + relay-room-api.ts + ChatSurfaceErrorState.tsx ported to pretty-view/.
- ✅ useRelayAdapter initial state is Warning-2-compliant (participants `{ humans: [], agents: [] }`, isReady `false`), never `participants: null` when source.kind === "relay". Verified in use-relay-adapter.test.ts Test 2.
- ✅ useChatSurfaceAdapter now calls the real relay adapter (Slice 1's stub replaced by direct import from `./use-relay-adapter`).
- ✅ ComposeBox accepts mode="relay"; Row 1 + Paperclip hidden monolithically; Row 2 byte-identical. Verified via ComposeBox.mode-hide.test.tsx Tests 2-4.
- ✅ PrettyView case-selects onSend (harness → existing path, relay → adapter.sendMessage) preserving mqid.
- ✅ PrettyView reads adapter.messages in the relay case via a grep-enumerated `effectiveMessages` alias (Blocker 2); harness case still owns its own messages state.
- ✅ Blocker 3 shim-intent comment present at the effectiveMessages declaration.
- ✅ PrettyView contains AT LEAST 5 `source.kind === "relay"` read sites (actual: 8 code sites — Warning 3 enumeration exceeded).
- ✅ PrettyView renders ChatSurfaceErrorState when relay adapter.error !== null. Verified in PrettyView.relay-source.test.tsx Test 6.
- ✅ PrettyView passes real adapter.participants AND adapter.isReady to MultiBadgeAnchor (Slice 2 wire-up preserved — no changes needed since Slice 2 already threaded them; Slice 3's real adapter now populates them for real).
- ✅ Harness case DOM byte-identical to master. Verified via 92 passing pretty-view test files (1055 tests).
- ✅ Standalone relay pane STILL routed to. Retirement source untouched.
- ✅ All existing PrettyView + ComposeBox + relay-room-pane tests pass unchanged (with one test-invariant update documented as Rule-3 deviation).
- ✅ `npx tsc --noEmit` passes.

### must_haves.truths (from plan frontmatter)

- ✅ `useRelayAdapter(source, isVisible)` opens WS to relay-room-stream backend, ingests all 8 frame types, returns unified adapter shape. Two-arg signature per Warning 4.
- ✅ `useRelayAdapter` initial state: `{ messages: [], participants: { humans: [], agents: [] }, sendMessage: <fn>, error: null, isReady: false }`. Participants NEVER null. Warning 2 compliant.
- ✅ Retiring use-relay-room-stream behavior preserved byte-for-behavior inside use-relay-adapter (D-10 move-as-blob).
- ✅ Retiring relay-room-api wire types + openRelayRoomSocket ported verbatim.
- ✅ ComposeBox accepts mode="relay"; Row 1 + Paperclip hidden monolithically (D-11).
- ✅ ComposeBox Row 2 byte-identical between modes (D-12).
- ✅ PrettyView handleComposeSend case-selected (D-13).
- ✅ Relay send-path fail-immediately on WS-not-open + 20s timeout on no echo (D-14).
- ✅ Outbound bubbles for viewer's own messages render right-aligned via shared OutboundBubble primitive (D-15) — RelayOutboundBubble already exists in pretty-view/; the adapter's mapper produces `relay_outbound` shape for self-sender events which routes through the existing right-aligned bubble path.
- ✅ Matrix `unsigned.transaction_id` echo correlation preserved (Pitfall 4).
- ✅ PrettyView renders ChatSurfaceErrorState when `source.kind === "relay"` and adapter.error !== null (D-20). V8 existence-oracle discipline preserved.
- ✅ Standalone relay pane STILL routed to. tabUtils untouched.
- ✅ PrettyView contains AT LEAST 5 `source.kind === "relay"` read sites (actual: 8).

## Follow-Ups for Downstream Slices

- **Slice 4** (retirement + tabUtils rewire): deletes `src/ui/features/relay-room-pane/` entirely + `RelayRoomSessionPane.tsx`. Sweeps comment references at `AppShell.tsx:1448,2156`, `conversation-store.ts:193`, `viewing-user-store.ts:6-10,148,167`, `fleet-status-client.ts:292`, `matrix-message-fetch.ts:106`. Updates `tabUtils.tsx` relay branch to mount `PrettyView` with `source={{ kind: "relay", ... }}` directly. Retires `tabUtils.tsx:306-326` early-return per D-06. Clears vitest cache.
- **Slice 5** (test migration cleanup): retires Slice D pane tests as their production siblings delete in Slice 4. Updates `tabUtils.test.tsx` to assert "sessionKind relay-room routes to shared chat surface with relay source." Consider flipping `source?:` back to `source:` (required) on PrettyView props once every internal caller migrated.
- **Optional (post-phase)**: expose the adapter's `pendingSends` internal state so the shared surface can render optimistic-bubble treatments for the relay case matching the harness case's Phase 50 D-01/D-15/D-20/D-21 discipline. Not needed for Slice 3 acceptance — the adapter's pending-send FIFO exists purely for Pitfall 4 correlation + timeout lifecycle at this point.

## Self-Check: PASSED

Files created:
- ✅ src/ui/features/pretty-view/sources/relay-room-api.ts (FOUND)
- ✅ src/ui/features/pretty-view/sources/use-relay-adapter.ts (FOUND)
- ✅ src/ui/features/pretty-view/sources/use-relay-adapter.test.ts (FOUND)
- ✅ src/ui/features/pretty-view/ChatSurfaceErrorState.tsx (FOUND)
- ✅ src/ui/features/pretty-view/ChatSurfaceErrorState.test.tsx (FOUND)
- ✅ src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx (FOUND)
- ✅ src/ui/features/pretty-view/PrettyView.relay-source.test.tsx (FOUND)

Files modified:
- ✅ src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts (verified via `grep -c "import.*useRelayAdapter" → 1`, stub removed)
- ✅ src/ui/features/pretty-view/ComposeBox.tsx (verified via `grep -c 'mode !== "relay"' → 2`; `grep -c 'data-testid="compose-row-1"' → 1`)
- ✅ src/ui/features/pretty-view/PrettyView.tsx (verified via `grep -c effectiveMessages → 14`; `grep -c 'mode={source.kind}' → 1`; `grep -c ChatSurfaceErrorState → 2`; `grep -c 'source.kind === "relay"' → 11` (8 code + 3 comments))
- ✅ src/ui/features/pretty-view/PrettyView.source-prop.test.tsx (Test 3 updated for post-Slice-3 D-08 discipline)

Commits (in order, all with `feat(93-03):` prefix per rescue-rebase context):
- ✅ bd6e40bb feat(93-03): port useRelayAdapter + relay-room-api + ChatSurfaceErrorState
- ✅ e68ea739 feat(93-03): ComposeBox mode="relay" hides Row 1 + Paperclip monolithically
- ✅ 57b98fec feat(93-03): PrettyView case-selects send, wires adapter.messages + mode + error state

Retirement source untouched:
- ✅ src/ui/features/relay-room-pane/use-relay-room-stream.ts (not in git status — Slice 4 retires)
- ✅ src/ui/features/relay-room-pane/relay-room-api.ts (not in git status — Slice 4 retires)
- ✅ src/ui/features/relay-room-pane/error-state.tsx (not in git status — Slice 4 retires)
- ✅ Retiring pane suite green: 7 test files, 80 tests passing.
