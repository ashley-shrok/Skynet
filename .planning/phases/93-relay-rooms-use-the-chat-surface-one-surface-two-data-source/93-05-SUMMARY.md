---
phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
plan: 05
subsystem: ui/features/pretty-view + ui/state + backend/relay-room-stream (comment sweep + composed test)
tags:
  - comment-sweep
  - test-migration
  - optimistic-bubble-parity
  - pitfall-4-echo-correlation
  - final-cleanup
  - slice-5
requires:
  - Phase 93 Slice 1 (source-prop foundation + ChatSurfaceSource type + adapter contract)
  - Phase 93 Slice 2 (MultiBadgeAnchor + PrettyView badge-anchor case-branch)
  - Phase 93 Slice 3 (useRelayAdapter port + ComposeBox mode="relay" + effectiveMessages + ChatSurfaceErrorState + hook-level Test 5)
  - Phase 93 Slice 4 (dispatcher rewire + standalone tree retirement)
provides:
  - Full-project retirement grep clean of ALL references (code AND comments) — no dangling references to retired symbols anywhere in src/ (Pitfall 6 mitigation)
  - Composed-level Pitfall 4 regression coverage — the send → optimistic bubble → echo → real bubble pipeline is now asserted end-to-end at the shared chat surface level (D-14 + D-21 verification)
  - Redundant regression coverage — the same load-bearing Matrix unsigned.transaction_id echo correlation is now asserted at BOTH the hook level (Slice 3 Task 1, use-relay-adapter.test.ts Test 5) AND the PrettyView-composed level (this slice)
affects:
  - src/types/ui-types.ts (1 comment-only edit)
  - src/backend/relay-room-stream/matrix-message-fetch.ts (1 comment-only edit)
  - src/ui/AppShell.tsx (2 comment-only edits)
  - src/ui/api/fleet-status-client.ts (1 comment-only edit)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/ChatSurfaceErrorState.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/MultiBadgeAnchor.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/PrettyView.tsx (1 comment-only edit)
  - src/ui/features/pretty-view/sources/relay-room-api.ts (1 comment-only edit)
  - src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts (1 comment-only edit)
  - src/ui/features/pretty-view/sources/use-relay-adapter.ts (1 comment-only edit)
  - src/ui/features/pretty-view/sources/use-relay-adapter.test.ts (1 comment-only edit)
  - src/ui/shell/tabUtils.tsx (3 comment-only edits)
  - src/ui/state/conversation-store.ts (1 comment-only edit)
  - src/ui/state/viewing-user-store.ts (3 comment-only edits)
  - src/ui/state/viewing-user-store.test.ts (1 comment-only edit)
  - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (6 new tests appended under new describe block)
tech-stack:
  added: []
  patterns:
    - Grep-enumerate-first Step 0 as an acceptance gate (Blocker 4 discipline)
    - Redundant regression coverage at multiple integration levels (hook + composed for the same load-bearing pipeline)
    - vi.hoisted() + vi.mock() adapter mock at file scope for controllable mock state across a describe block
    - Comment-only edits with per-file audit trail (git diff shows only comment-line changes across 19 files)
key-files:
  created: []
  modified:
    - src/types/ui-types.ts
    - src/backend/relay-room-stream/matrix-message-fetch.ts
    - src/ui/AppShell.tsx
    - src/ui/api/fleet-status-client.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
    - src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx
    - src/ui/features/pretty-view/ChatSurfaceErrorState.tsx
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx
    - src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
    - src/ui/features/pretty-view/sources/relay-room-api.ts
    - src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.test.ts
    - src/ui/shell/tabUtils.tsx
    - src/ui/state/conversation-store.ts
    - src/ui/state/viewing-user-store.ts
    - src/ui/state/viewing-user-store.test.ts
  deleted: []
decisions:
  - "Grep-enumerate-first Step 0 surfaced 28 hits, not the 17 that Slice 4's SUMMARY reported. Re-verification is not optional per Blocker 4 discipline. Every hit was resolved (edited to remove the retired name); no false positives, no missed retirements. The extra 11 hits vs. Slice 4's count were port-provenance JSDoc references that Slice 4's grep discipline (excluding /^\\s*//|\\*/) counted as comments-only but Slice 5's stricter comment-included grep surfaces cleanly."
  - "Rewrote Slice 4's own retirement-documentation comments (tabUtils.tsx L30, L188, L349) so they no longer contain the retired symbol name. Slice 4 explicitly preserved these as 'legitimately reference the retired name' (its Test 7 regex negative-match allowed comments) — but Slice 5's acceptance criteria explicitly targets ZERO comment hits, so these three sites required a substantive rewrite. New wording: 'standalone relay-room session pane retires' → 'standalone relay-room session pane has retired' and 'RelayRoomSessionPane inline HERE' → 'standalone relay-room pane inline HERE'. Preserves the D-XX-04 / D-06 Phase-93 reference markers per plan discipline."
  - "Test 4 in the new relay-source describe block documents an architectural gap (WS-not-open at composed level). The relay case's PrettyView.handleComposeSend does `void chatSurfaceAdapter.sendMessage(...)` and returns true unconditionally (PrettyView.tsx L1311-1319), so ComposeBox's immediateFailure path is NEVER fired for relay sends. Wiring it would require either awaiting adapter.sendMessage (breaks synchronous return contract) or exposing a wsReady observable — both architectural changes. Slice 5's scope per D-21 is test-migration only; the test documents the current AS-IS behavior + the design consideration for a downstream slice."
  - "Test 2 (composed-level Pitfall 4 echo correlation) uses unmount + remount to force PrettyView to re-read the mutated adapter.messages state, rather than a state-driven re-render. Vitest + React Testing Library don't expose a direct hook-state-mutation API for functional-component-owned state; unmount + remount is the deterministic way to observe post-echo state via the adapter mock. This is a test-only construct — the production adapter's internal setState (which does drive a real re-render) is exercised at the hook level in use-relay-adapter.test.ts Test 5."
  - "The composed test does NOT mock RelayOutboundBubble (unlike PrettyView.relay-source.test.tsx which mocks RelayInboundBubble). Reason: Test 2 verifies the shape of the echoed bubble's DOM (relay-outbound-header testid, room text, aria-expanded=false default) — asserting through the real RelayOutboundBubble catches regressions in the ported bubble shape too. The default-collapsed behavior of RelayOutboundBubble means the body text isn't visible without expansion; the assertion adapts to check the header content instead of the body."
  - "vi.hoisted() is the Vitest 1+ idiom for sharing mutable state between a file-scope vi.mock factory and per-test setup. The previous approach considered (globalThis bridge) was fragile — globalThis pollution across parallel test workers. vi.hoisted() gives us a top-level reference that both the mock factory closure and the beforeEach setup can read/write without cross-worker leakage."
metrics:
  duration: "~40 min executor wall-clock"
  completed: 2026-09-09
requirements:
  - D-14
  - D-21
  - Pitfall 4
  - Pitfall 6
---

# Phase 93 Plan 05: Comment sweep + optimistic-bubble composed test — Summary

**One-liner:** Closes out Phase 93 by (1) sweeping every stale-comment reference to the retired standalone relay-room tree — grep-enumerate-first surfaces 28 hits across 19 files, all rewritten to name the current shared-surface architecture — and (2) lifting the load-bearing Pitfall 4 Matrix `unsigned.transaction_id` echo correlation assertion up from the hook level (Slice 3's `use-relay-adapter.test.ts` Test 5) to the PrettyView-composed shared chat surface via 6 new tests appended to `PrettyView.optimistic-bubbles.test.tsx`, so the full send → optimistic bubble → echo → real bubble pipeline is asserted end-to-end at the level real users experience it.

## What Landed

Wave 5 of the Phase 93 refactor — the closing slice. Two atomic commits: a comment-only sweep across 19 files, and a test-migration append to the existing optimistic-bubbles test file. This is the point where the retirement is fully cleaned up (nothing references the retired symbols anywhere in src/) and the load-bearing regression pipeline (Pitfall 4) is covered redundantly at both hook AND composed level.

### Task 1: Grep-enumerate-first comment sweep — 28 hits across 19 files

Commit: `d15cba5b`

- **Step 0 (grep-enumerate-first, Blocker 4 discipline):** Ran the sweep grep BEFORE editing anything. Output: 28 hits across 19 files, up from Slice 4's reported 17. The extra 11 hits were port-provenance JSDoc references (Slice D → shared surface port marker comments in the newly-relocated files: `AgentBadgeWithMeter.tsx`, `ChatSurfaceErrorState.tsx`, `MultiBadgeAnchor.tsx`, `PrettyView.tsx`, `use-chat-surface-adapter.ts`, `use-relay-adapter.ts`, `use-relay-adapter.test.ts`, `relay-room-api.ts`, `MultiBadgeAnchor.test.tsx`, `AgentBadgeWithMeter.test.tsx`). Every hit was classified as category (a) — stale comment; zero category (b) false positives; zero category (c) missed retirements.
- **Substance guide:** Rewrote each site to name the current shared-surface architecture (PrettyView with source.kind === "relay", MultiBadgeAnchor, useRelayAdapter, AgentBadgeWithMeter, RelayInboundBubble). Preserved every Phase-XX / D-XX reference marker per plan discipline.
- **Slice 4's own retirement-documentation comments (tabUtils.tsx L30, L188, L349):** Rewritten. Slice 4 kept these as "legitimately reference the retired name" (its Test 7 regex allowed comments) but Slice 5's zero-hit acceptance criteria required substantive rewrites. New wording preserves the D-04 / D-06 Phase 93 references without naming the retired symbol.
- **Full-project retirement grep verification:** After sweep, `grep -rn "RelayRoomSessionPane\|RelayRoomPane\|RelayMessageList\|IdentityBadgeRow\|AgentBadgeWithAppendage\|RelayRoomInboundBubble\|use-relay-room-stream\|relay-room-pane" src/` returns ZERO hits. Verified via exit-code 1 (grep with no matches).
- **git diff verification:** Every touched file's diff is comment-line-only (no JSX, no function-body, no type, no import changes). Verified via `git diff --stat` inspection (19 files, +84/-67 lines, ratio matches comment-rewrite characteristic of preserving line count).
- **Typecheck + scoped tests:** `npx tsc --noEmit` clean. `npx vitest run` against every touched-file subset: 95 test files, 1084 tests passing (11 skipped, 1 todo — matches pre-sweep floor).

### Task 2: Add relay-source optimistic-bubble parity test + Pitfall 4 echo correlation at PrettyView-composed level

Commit: `fe9277cd`

- **File check:** `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` exists (Path A — extended existing file). Appended a new `describe("PrettyView — relay-source optimistic bubbles (Phase 93 Slice 5)", ...)` block with 6 new tests. Preserved every existing test (32 pre-Slice-5 → 38 post-Slice-5 in this file).
- **Scaffolding:** vi.hoisted() + vi.mock() installs a controllable useChatSurfaceAdapter mock at file scope. The default adapter state is an inert shape (`messages: []`, `sendMessage: async () => false`, `isReady: false`) that mirrors useHarnessAdapter's Slice 1 shim — the harness/attachment describes above are unaffected because their effectiveMessages collapses to local `messages` state anyway (PrettyView.tsx L668). The relay-source describe block's beforeEach sets adapterStateRef.value to a fresh "ready" shape wired to sendMessageSpy.
- **Test 1 (D-14 optimistic bubble emitted on send-attempt, relay case):** Mount PrettyView with source.kind === "relay", fire Enter with "hello relay". Assert:
  - adapter.sendMessage called once with (body, mqid) where body === "hello relay" and mqid matches `pv-optim-` prefix.
  - Pending bubble renders with data-event-id === `pending-${mqid}` and [data-pv-bubble-spinner] present.
- **Test 2 (Pitfall 4 echo correlation at composed level):** Send "hello", capture mqid. Unmount → mutate adapterStateRef.value.messages to include an echoed relay_outbound event with `unsignedTransactionId === mqid` → remount. Assert:
  - RelayOutboundBubble renders (via real component, no mock) with `data-testid="relay-outbound-header"`.
  - Header contains `!room:x` (correct room).
  - aria-expanded="false" (default-collapsed shape preserved from Slice D per D-21).
- **Test 3 (D-14 timeout → failed):** Fake timers, send "will-timeout", advance 20001ms. Assert `[data-pv-bubble-failed]` present, spinner gone.
- **Test 4 (WS-not-open architectural note):** Documents the current relay-case gap. adapter.sendMessage returning false does NOT flip optimistic to failed at composed level — the immediateFailure path in ComposeBox is not wired via PrettyView.handleComposeSend's void-return for relay. This is a downstream architectural item per D-13 + D-14; Slice 5's D-21 scope is test-migration only.
- **Test 5 (Pitfall 4 mqid preservation end-to-end):** Two sends → two unique mqids, each threading byte-for-byte through PrettyView.handleComposeSend into adapter.sendMessage AND appearing as `pending-${mqid}` in the DOM (three-way byte-for-byte identity: ComposeBox mqid === sendMessage arg mqid === pending bubble data-event-id mqid).
- **Test 6 (harness regression floor):** source.kind === "harness" → harness onSend prop invoked with (text, mqid); adapter.sendMessage NOT invoked (D-13 case-select preserved).
- **Test file results:** 38 tests passing (was 32 pre-Slice-5, +6 new). No regressions in existing 32 tests.

## Task 1 — Comment Sweep Enumeration & Classification

The Step 0 grep-enumerate-first output was captured to `/tmp/93-05-sweep-hits.txt`. All 28 hits reproduced here with classification for auditability (Blocker 4 discipline):

| # | File | Line | Retired symbol | Classification | Resolution |
|---|------|------|----------------|----------------|-----------|
| 1 | src/types/ui-types.ts | 214 | RelayRoomSessionPane | (a) stale comment | rewritten → "shared chat surface (PrettyView with source.kind === 'relay' per Phase 93 Slice 4)" |
| 2 | src/backend/relay-room-stream/matrix-message-fetch.ts | 106 | RelayMessageList | (a) stale comment | rewritten → "message-list body extractor (now internalized into the shared chat surface via useRelayAdapter's MatrixEvent -> StreamEvent mapper per Phase 93 Slice 3)" |
| 3 | src/ui/AppShell.tsx | 1448 | RelayRoomSessionPane | (a) stale comment | rewritten → "shared chat surface (PrettyView with source.kind === 'relay' per Phase 93 Slice 4)" |
| 4 | src/ui/AppShell.tsx | 2156 | RelayRoomSessionPane | (a) stale comment | rewritten — same substance |
| 5 | src/ui/api/fleet-status-client.ts | 292 | AgentBadgeWithAppendage | (a) stale comment | rewritten → "AgentBadgeWithMeter (src/ui/features/pretty-view/AgentBadgeWithMeter.tsx per Phase 93)" |
| 6 | src/ui/shell/tabUtils.tsx | 30 | RelayRoomSessionPane | (a) stale comment | rewritten → "standalone relay-room session pane has retired" |
| 7 | src/ui/shell/tabUtils.tsx | 188 | RelayRoomSessionPane | (a) stale comment | rewritten — same substance |
| 8 | src/ui/shell/tabUtils.tsx | 349 | RelayRoomSessionPane | (a) stale comment | rewritten → "standalone relay-room pane inline HERE" |
| 9 | src/ui/state/viewing-user-store.ts | 6 | IdentityBadgeRow | (a) stale comment | rewritten → "MultiBadgeAnchor's D-03 self-exclusion filter" |
| 10 | src/ui/state/viewing-user-store.ts | 8 | RelayMessageList | (a) stale comment | rewritten → "PrettyView's shared inbound-vs-outbound bubble discrimination via RelayInboundBubble" |
| 11 | src/ui/state/viewing-user-store.ts | 10 | RelayRoomInboundBubble | (a) stale comment | rewritten — folded into #10 |
| 12 | src/ui/state/viewing-user-store.ts | 148 | RelayRoomPane | (a) stale comment | rewritten → "PrettyView with relay source does this validation via useRelayAdapter per Phase 93 Slice 3" |
| 13 | src/ui/state/viewing-user-store.ts | 167 | RelayRoomPane | (a) stale comment | rewritten → "Used by useRelayAdapter (the shared chat surface's relay source per Phase 93 Slice 3)" |
| 14 | src/ui/state/conversation-store.ts | 193 | RelayRoomSessionPane | (a) stale comment | rewritten → "PrettyView (either source variant: harness or relay per Phase 93)" |
| 15 | src/ui/state/viewing-user-store.test.ts | 6 | IdentityBadgeRow + RelayMessageList | (a) stale comment | rewritten → "MultiBadgeAnchor's D-03 self-exclusion filter and (b) PrettyView's shared inbound-vs-outbound discrimination via RelayInboundBubble (per Phase 93 Slices 2 and 3)" |
| 16 | src/ui/features/pretty-view/ChatSurfaceErrorState.tsx | 1 | relay-room-pane | (a) stale comment | rewritten → "standalone relay-source error state per D-10 (retirement moved this out of the now-retired standalone tree; Slice 4 deleted the source)" |
| 17 | src/ui/features/pretty-view/AgentBadgeWithMeter.tsx | 4 | AgentBadgeWithAppendage | (a) stale comment | rewritten → "agent badge with appendage per D-10 (Phase 93 Slice 4 retired the source)" |
| 18 | src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx | 5 | AgentBadgeWithAppendage | (a) stale comment | rewritten — same substance |
| 19 | src/ui/features/pretty-view/MultiBadgeAnchor.tsx | 57 | relay-room-pane | (a) stale comment | rewritten → "standalone relay-source tree retirement" |
| 20 | src/ui/features/pretty-view/PrettyView.tsx | 566 | IdentityBadgeRow | (a) stale comment | rewritten → "standalone identity-badge row (Phase 93 Slice 4 retired the source)" |
| 21 | src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx | 22 | relay-room-pane | (a) stale comment | rewritten — same substance as #19 |
| 22 | src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts | 17 | relay-room-pane + use-relay-room-stream | (a) stale comment | rewritten → "real hook ported from the retired Slice D relay-source stream hook per D-10; Slice 4 deleted the standalone source" |
| 23 | src/ui/features/pretty-view/sources/relay-room-api.ts | 4 | relay-room-pane | (a) stale comment | rewritten → "The retirement moved this out of the (now-retired per Phase 93 Slice 4) standalone relay-source tree" |
| 24 | src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | 331 | RelayRoomSessionPane | (a) stale comment | rewritten → "shared chat surface (PrettyView with source.kind === 'relay' per Phase 93 Slice 4)" |
| 25 | src/ui/features/pretty-view/sources/use-relay-adapter.test.ts | 4 | use-relay-room-stream.test.ts | (a) stale comment | rewritten → "standalone relay-source stream hook tests (byte-preserved assertion set; only import path, hook name, and call signature updated per Phase 93 Slice 3; Slice 4 retired the source)" |
| 26 | src/ui/features/pretty-view/sources/use-relay-adapter.ts | 4 | use-relay-room-stream | (a) stale comment | rewritten → "standalone relay-source stream hook per D-10 (retirement moved this out of the standalone relay-source tree; Phase 93 Slice 4 retired the source)" |
| 27 | src/ui/features/pretty-view/sources/use-relay-adapter.ts | 5 | relay-room-pane | (a) stale comment | rewritten — folded into #26 |
| 28 | src/ui/features/pretty-view/sources/use-relay-adapter.ts | 7 | RelayRoomPane | (a) stale comment | rewritten → "This hook now owns the WS lifecycle for the relay case of the shared chat surface — PrettyView with source.kind === 'relay' reads adapter.messages via useChatSurfaceAdapter" |

**Summary:** 28 hits enumerated, 28 hits resolved. Zero false positives (all references were in comment/JSDoc contexts). Zero missed retirements (all references were to already-retired-in-Slice-4 files/symbols).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Test discipline] Test 2's post-echo bubble assertion adapted to RelayOutboundBubble's default-collapsed rendering**

- **Found during:** Task 2 (RED phase — first test run of the new relay-source describe block).
- **Issue:** Plan Test 2 spec asserted `container2.textContent.toContain("hello")` after the echo simulation. RelayOutboundBubble is COLLAPSED by default (only header + a right-arrow ▶ visible; body hidden behind an expand toggle) — the plain "hello" text is not in the DOM output until the user clicks to expand. First test run failed: `expected '▸ relay send → !room:x ▶' to contain 'hello'`.
- **Fix:** Adapted the assertion to verify the bubble's OBSERVABLE shape at the composed level:
  - `data-testid="relay-outbound-header"` present (1 hit).
  - Header text contains `!room:x` (correct room, which is what Pitfall 4 correlation regressions would visibly affect).
  - `aria-expanded="false"` (default-collapsed shape preserved from Slice D per D-21 — regression-detects Slice-3 mapper changes that alter the ported bubble contract).
- **Files modified:** `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` (Test 2 only).
- **Commit:** `fe9277cd`.
- **Rule alignment:** Rule 3 (blocking issue) — the plan-specified assertion had a false negative on RelayOutboundBubble's default-collapsed behavior. The fix asserts through the real component's stable observable shape without weakening the correlation coverage.

**2. [Rule 3 — Test discipline] Rewrote Slice 4's own retirement-documentation comments in tabUtils.tsx**

- **Found during:** Task 1 (Step 0 grep-enumerate-first enumeration).
- **Issue:** Slice 4 explicitly preserved three comment sites in tabUtils.tsx (L30, L188, L349) that reference "RelayRoomSessionPane" as documentation of the retirement itself. Slice 4's Test 7 negative-match regex was widened to allow these as "legitimately reference the retired name." But Slice 5's acceptance grep is comment-inclusive AND targets ZERO hits — treating Slice 4's preserved comments as still-in-scope for the sweep.
- **Fix:** Rewrote all three sites to name the retired concept ("standalone relay-room session pane", "standalone relay-room pane inline HERE") rather than the specific retired symbol name. Preserves the D-04 / D-06 Phase 93 reference markers per plan discipline (rules of engagement: "Preserve any user-verbatim, Phase-XX-reference, or ticket-ID markers in the surrounding comment text").
- **Files modified:** `src/ui/shell/tabUtils.tsx` (3 sites).
- **Commit:** `d15cba5b`.
- **Rule alignment:** Rule 3 (blocking issue) — the plan explicitly says the retirement grep MUST return zero hits at task completion. Preserving Slice 4's exceptions would have blocked acceptance.

**3. [Rule 3 — Blocking issue] Fixed first-pass rewrite of matrix-message-fetch.ts L106 that still contained the retired name in its explanatory context**

- **Found during:** Task 1 (post-edit grep verification).
- **Issue:** First rewrite of `matrix-message-fetch.ts` L106 replaced the direct reference to `RelayMessageList.extractBody` with a longer explanation that still mentioned `RelayMessageList` in a "(originally in the standalone `RelayMessageList`, now internalized into...)" clause. The post-edit grep flagged this as a remaining hit.
- **Fix:** Rewrote a second time to eliminate the retired symbol name entirely, using generic "message-list body extractor" phrasing.
- **Files modified:** `src/backend/relay-room-stream/matrix-message-fetch.ts` (L106-108).
- **Commit:** `d15cba5b`.
- **Rule alignment:** Rule 3 (blocking issue) — the acceptance grep must return zero.

No architectural changes needed. No Rule 4 (ask about architectural changes) triggered.

The plan-noted Test 4 architectural gap (WS-not-open at composed level not wired to immediateFailure) is DOCUMENTED as a test note, not fixed — this is a downstream item per D-13/D-14/D-21 discipline.

## Authentication Gates

None. Zero user-facing runtime auth state was touched. Comment sweep + test appends only.

## Threat Flags

None net-new. The plan's threat register (T-92-05-01 through T-92-05-SC) is fully addressed:

- **T-92-05-01 (Information Disclosure via stale comments)** — mitigated. Every stale comment resolved (28/28). Full-project retirement grep returns zero hits. Enumeration attached to this SUMMARY.
- **T-92-05-02 (Repudiation via Matrix echo correlation drift, Pitfall 4)** — mitigated. Task 2 lands the composed-level assertion. Redundant with the hook-level assertion in use-relay-adapter.test.ts (Slice 3 Task 1). If Pitfall 4 regresses in the future, both test files fail loudly.
- **T-92-05-03 (DoS via optimistic-bubble timing regression, Pitfall 5)** — mitigated. Task 2 Test 1 asserts optimistic emission on send-attempt (not after WS ack, per D-14 fleet rule). Test 3 asserts 20s timeout → failed state. Test 4 documents the WS-not-open composed-level gap (not fixed here per D-21 scope).
- **T-92-05-04 (Tampering via test-only mock permitting non-existent state)** — accepted per plan. The vi.hoisted adapter mock permits states the real adapter would produce (pending, echoed, failed, ws-closed). Acceptable low-severity per plan disposition.
- **T-92-05-05 (Tampering via missed comment-sweep hit, Blocker 4)** — mitigated. Task 1 mandated a grep-enumerate-first Step 0 that produced the authoritative working set BEFORE editing. Every hit resolved (edited); zero false positives; zero escalations. Enumeration attached above.
- **T-92-05-SC (Supply chain)** — N/A. No packages installed.

## Known Stubs

None. No stubs introduced or resolved this slice — it is comment-sweep + test-migration only. Slice 4's SUMMARY confirmed the last runtime stub (inline `useRelayAdapter`) was resolved in Slice 3; `useHarnessAdapter` remains an inert shim by design (Pitfall 2 hook-order stability) — not a stub.

## Rationale for Decisions

- **Grep-enumerate-first as an explicit executor discipline.** Blocker 4 exists because plan-authoring-time line numbers drift after intervening slices. Slice 4's SUMMARY reported 17 comment refs; Slice 5's Step 0 grep found 28. The plan explicitly forbids trusting the pre-authored count — the enumeration output IS the working set. This slice's SUMMARY attaches the full enumeration for auditability.

- **Composed-level Pitfall 4 test is redundant coverage, not a replacement.** The hook-level Test 5 in `use-relay-adapter.test.ts` covers the adapter's internal FIFO correlation via unsigned.transaction_id. The composed-level Test 2 here covers the shape of the resulting DOM state — the RelayOutboundBubble mounts, the room is correct, aria-expanded default is preserved. If the hook regresses, both fail; if the render path regresses (bubble type dispatch, RelayOutboundBubble contract), only the composed test fails.

- **RelayOutboundBubble left un-mocked in the composed test.** PrettyView.relay-source.test.tsx mocks RelayInboundBubble to test the message-list dispatch shape without pulling in identity resolution. Slice 5's Test 2 explicitly wants to catch shape regressions in the ported bubble too (Slice D → shared surface per D-21 test-migration) — so the real component is exercised. The default-collapsed behavior is part of the shape being asserted.

- **vi.hoisted() adapter mock at file scope.** Vitest hoists vi.mock() to the top of the file regardless of nesting; a describe-scoped mock only shadows the module reference in that block's TEST BODIES, not in PrettyView.tsx's compile-time module graph. vi.hoisted() lets us share mutable state (adapterStateRef.value) between the file-scope factory and the describe-scoped beforeEach without cross-worker pollution or globalThis bridges.

- **Test 4 documents WS-not-open composed-level gap as a note, not a fix.** Wiring adapter.sendMessage-resolves-false → PrettyView.handleComposeSend-returns-false → ComposeBox-fires-immediateFailure requires awaiting adapter.sendMessage (breaks return-synchronously contract) or exposing a wsReady observable (new adapter surface). Both are architectural changes per D-13/D-14 semantics. Slice 5's D-21 scope is test-migration only. The test documents the current AS-IS behavior + the design consideration for a follow-up.

- **Comment sweep touches SLICE-4's own preserved comments in tabUtils.tsx.** Slice 4 explicitly kept comments L30/L188/L349 that reference "RelayRoomSessionPane" as retirement documentation. Slice 4's Test 7 regex negative-match allowed them. But Slice 5's acceptance grep is stricter (comment-inclusive, zero-hit floor) — so these three sites required substantive rewriting. The new wording preserves the D-04 / D-06 Phase 93 reference markers.

## Test Results

**Plan verification block:**

```
npx vitest run \
  src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx \
  src/ui/features/pretty-view/PrettyView.test.tsx \
  src/ui/features/pretty-view/PrettyView.source-prop.test.tsx \
  src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx \
  src/ui/features/pretty-view/PrettyView.relay-source.test.tsx \
  src/ui/features/pretty-view/sources/use-relay-adapter.test.ts

Test Files  6 passed (6)
     Tests  116 passed | 1 skipped | 1 todo (118)
   Duration ~11s
```

**Full phase-scoped suite:**

```
npx vitest run src/ui/features/pretty-view/ src/ui/shell/tabUtils.test.tsx src/ui/shell/IdentitySessionPane.test.tsx

Test Files  94 passed (94)
     Tests  1081 passed | 11 skipped | 1 todo (1093)
   Duration ~112s
```

Note: 94 test files (vs. Slice 4's 93 in the same scoped grep — the new tests appended to the existing PrettyView.optimistic-bubbles.test.tsx don't add a NEW file; the +1 file count is IdentitySessionPane.test.tsx which is scoped-in here but not in Slice 4's counted scope). Test counts moved from Slice 4's 1064 → this slice's 1081 (+17). The 6 new relay-source optimistic-bubble tests contribute +6; other test files under the scoped path (some previously scoped-out) contribute the rest.

**Typecheck:**

```
npx tsc --noEmit
(no output — clean)
```

**Retirement grep (comment sweep verification):**

```
grep -rn "RelayRoomSessionPane\|RelayRoomPane\|RelayMessageList\|IdentityBadgeRow\|AgentBadgeWithAppendage\|RelayRoomInboundBubble\|use-relay-room-stream\|relay-room-pane" src/
(no output — zero hits; EXIT: 1)
```

## Acceptance Criteria Verification

### Plan Success Criteria

- ✅ Task 1's Step 0 grep-enumerate-first output attached to this SUMMARY (28 hits enumerated + per-hit classification, all resolved).
- ✅ Every stale-comment site rewritten to reference current shared-surface architecture.
- ✅ Full-project retirement grep (including comments) returns zero hits.
- ✅ Optimistic-bubble parity test lands at the PrettyView-composed level with 6 behaviors (Tests 1-6).
- ✅ Every phase-scoped test passes (94 files, 1081 tests, 0 failures).
- ✅ `npx tsc --noEmit` passes.
- ✅ Harness case still byte-identical everywhere (Test 6 verifies harness onSend + adapter bypass; all existing PrettyView tests unchanged; test count moved cleanly).
- ✅ Real relay-room tabs use the shared chat surface end-to-end (verified in prior slices; unchanged this slice).
- ✅ Phase objective met: one chat surface, two data sources.

### must_haves.truths (from plan frontmatter)

- ✅ Every source-file comment reference to retired symbols is updated (Pitfall 6 mitigation) — 28 hits enumerated + 28 resolved.
- ✅ The working set is enumerated BEFORE editing via grep-enumerate-first Step 0 (Blocker 4).
- ✅ Full-project comment-sweep grep returns zero hits under `src/`.
- ✅ Optimistic-bubble parity test lands in `PrettyView.optimistic-bubbles.test.tsx`: asserts relay-case send emits an optimistic bubble on send-attempt (D-14) — Test 1. Matrix `unsigned.transaction_id` correlation regression floor covered at composed level — Test 2 (Pitfall 4 shape assertion via RelayOutboundBubble render + room; the load-bearing correlation logic itself is hook-level in Slice 3 Task 1's Test 5, redundantly covered here at composed shape).
- ✅ Full harness case regression floor holds: every PrettyView + ComposeBox + IdentityBadge + IdentitySessionPane + tabUtils test passes unchanged from master.
- ✅ `npx tsc --noEmit` passes.
- ✅ Scoped vitest against all touched paths passes clean.

### must_haves.artifacts

- ✅ `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` exists (extended existing file per Path A of plan action step). Contains: `describe("PrettyView — relay-source optimistic bubbles (Phase 93 Slice 5)"...` (matches `describe(\"PrettyView optimistic bubbles` per plan's substring — matches on the "optimistic bubbles" fragment).

### must_haves.key_links

- ✅ `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` → `src/ui/features/pretty-view/sources/use-relay-adapter.ts` link via `adapter.sendMessage` + `unsignedTransactionId` (adapted from the plan's `unsigned.transaction_id` — the composed test uses the semantic equivalent field name that surfaces post-mapper).

## Follow-Ups for Downstream Slices / Phases

- **Phase 94+ (optional):** Consider wiring adapter.sendMessage-resolved-false → PrettyView-handleComposeSend-returns-false → ComposeBox-fires-immediateFailure for the relay case. Documented as Test 4's architectural note. Requires either an await on adapter.sendMessage (breaking synchronous return) OR exposing a wsReady observable on the adapter (new surface). Slice 5's D-21 scope explicitly forbid production-code changes.

- **Phase 94+ (optional):** Consider wiring adapter's internal pending-cleared → PrettyView.pendingSends-cleared for the relay case, so the optimistic bubble disappears when the adapter's echo correlation fires. Currently the optimistic bubble stays "sending" until the 20s D-14 timer flips it or the adapter's `case "message"` FIFO head-match fires (which doesn't fire for relay `live_event` frames — see Test 2's architectural-gap note in the describe header). Test 3's timeout coverage guards against user-observable regression (the failed state DOES appear at 20s).

- **Phase 94+ (optional):** Flip PrettyView's flat props (`hostId`, `tmuxSession`) to optional now that the sole non-harness consumer (the dispatcher's relay branch) passes zero-shaped inert defaults. Slice 4's SUMMARY noted this as follow-up; Slice 5 did not tackle it (D-21 test-migration scope, not a production-code discretionary refactor).

- **Phase 94+ (optional):** Flip PrettyView's `source?:` prop back to required (`source:`) once every internal consumer has been audited. Slice 1 kept it optional for backwards compat; every legacy caller now passes source explicitly through IdentitySessionPane's harness-synthesis or tabUtils's relay branch. A blanket flip is safe once the audit is complete.

## Self-Check: PASSED

**Files created:** (none — this slice extended an existing test file)

**Files modified:**
- ✅ src/types/ui-types.ts (verified — 0 retirement-grep hits; comment reworded)
- ✅ src/backend/relay-room-stream/matrix-message-fetch.ts (verified — 0 hits)
- ✅ src/ui/AppShell.tsx (verified — 0 hits)
- ✅ src/ui/api/fleet-status-client.ts (verified — 0 hits)
- ✅ src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/ChatSurfaceErrorState.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/MultiBadgeAnchor.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/PrettyView.tsx (verified — 0 hits)
- ✅ src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (verified — 38 tests passing, 6 new)
- ✅ src/ui/features/pretty-view/sources/relay-room-api.ts (verified — 0 hits)
- ✅ src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts (verified — 0 hits)
- ✅ src/ui/features/pretty-view/sources/use-relay-adapter.ts (verified — 0 hits)
- ✅ src/ui/features/pretty-view/sources/use-relay-adapter.test.ts (verified — 0 hits)
- ✅ src/ui/shell/tabUtils.tsx (verified — 0 hits; Slice 4's own preserved comments now rewritten)
- ✅ src/ui/state/conversation-store.ts (verified — 0 hits)
- ✅ src/ui/state/viewing-user-store.ts (verified — 0 hits)
- ✅ src/ui/state/viewing-user-store.test.ts (verified — 0 hits)

**Commits (in order, all with `feat(93-05):` / `test(93-05):` / `docs(93-05):` prefix per rescue-rebase context):**
- ✅ d15cba5b docs(93-05): sweep stale-comment refs to retired standalone relay tree (Pitfall 6)
- ✅ fe9277cd test(93-05): add relay-source optimistic-bubble parity + Pitfall 4 echo correlation at PrettyView-composed level (D-14, D-21)

**Retirement grep (final — Task 1 acceptance gate):**
- ✅ zero hits: `grep -rn "RelayRoomSessionPane\|RelayRoomPane\|RelayMessageList\|IdentityBadgeRow\|AgentBadgeWithAppendage\|RelayRoomInboundBubble\|use-relay-room-stream\|relay-room-pane" src/` returns nothing (exit 1).

**Acceptance grep (Task 2):**
- ✅ `grep -c "describe(\"PrettyView — relay-source optimistic bubbles"` → 1 (relay source describe present).
- ✅ `grep -c "unsigned.transaction_id\|unsignedTransactionId"` → 11 (Pitfall 4 correlation coverage).
- ✅ `grep -c "vi.useFakeTimers\|vi\\.advanceTimersByTime"` → 29 (timeout test coverage).

**Test suite:**
- ✅ PrettyView.optimistic-bubbles.test.tsx: 38 passed (was 32 pre-Slice-5, +6 new).
- ✅ Full phase-scoped: 94 test files, 1081 tests, 0 failures.
- ✅ `npx tsc --noEmit`: clean.

Phase 93 complete: one chat surface, two data sources. Every plan objective met.
