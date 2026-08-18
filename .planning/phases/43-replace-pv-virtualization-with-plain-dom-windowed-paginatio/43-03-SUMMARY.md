---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 03
subsystem: frontend/api
tags:
  - frontend
  - claude-session-api
  - wire-types
  - scaffolding
  - wave-1
  - fetch-older
dependency_graph:
  requires: []
  provides:
    - "openClaudeSessionSocket(opts?: { historyWindow?: number }): WebSocket — optional query-param bound on the initial `-n +1` replay; backcompat-preserved for no-arg callers (countIdentityBounties L945)"
    - "FetchOlderPayload = { type: 'fetch_older'; anchorEventId: string; count: number } — locked eventId-only wire contract (NO anchorLine field)"
    - "FetchOlderBatchEvent = { type: 'fetch_older_batch'; frames: unknown[]; reachedBeginning?: boolean; error?: string } — batched historical-frames response; frames typed `unknown[]` at scaffolding stage"
  affects:
    - src/backend/claude-session/claude-session-server.ts (Wave 2 43-04 will consume `FetchOlderPayload` shape when adding the `case "fetch_older":` handler + `historyWindow` handshake parse)
    - src/ui/api/claude-session-api.ts (Wave 2 43-05 will add `sendFetchOlder` + `isFetchOlderBatchEvent` runtime helpers on top of these types)
    - src/ui/features/pretty-view/PrettyView.tsx (Wave 3 43-07b will narrow `FetchOlderBatchEvent.frames` from `unknown[]` to the concrete ParsedLine emission-variant union when it wires the onmessage `case "fetch_older_batch":` branch)
tech_stack:
  added: []
  patterns:
    - "Payload+Event type-pair convention (mirrors IdentityCountBountiesPayload + IdentityBountyCountsEvent L820-833 verbatim — same shape, same clustering, same JSDoc discipline)"
    - "Opt-in query-param backcompat (mirrors the JWT token URL-param fallback discipline — missing / invalid → no param → server retains legacy behavior)"
    - "`Number.isFinite(hw) && hw > 0` positive-integer gate + `Math.floor()` on ingest — defense-in-depth against NaN, Infinity, negative, and non-integer values before URL construction"
key_files:
  created: []
  modified:
    - src/ui/api/claude-session-api.ts
decisions:
  - "Placement clustered adjacent to IdentityCountBountiesPayload + IdentityBountyCountsEvent (L820-833) — the plan named this as the analog and the co-location keeps the Payload/Event pair convention discoverable when Wave 2 (43-05) adds the runtime `sendFetchOlder` + `isFetchOlderBatchEvent` helpers alongside `countIdentityBounties`."
  - "`FetchOlderBatchEvent.frames: unknown[]` (not the concrete ParsedLine-emission union) — plan-authorized scaffolding-stage typing. The union `MessageEvent | ImageEvent | RelayOutboundEvent | RelayInboundEvent | MalformedLineEvent` is available in-file, but this plan is types+scaffolding only with zero consumers; JSDoc names the expected shape and Wave 3 (43-07b) narrows when the PrettyView onmessage switch actually reads `.frames`. Keeps the diff minimal and defers the concrete narrowing to the plan that has the runtime pressure to justify it."
  - "`historyWindow` param normalized with `Number.isFinite(hw) && hw > 0` + `Math.floor(hw)` — three checks composed as a single positive-finite-integer gate before URL string construction. Non-positive, NaN, Infinity, undefined, or non-numeric inputs all fall through to the empty query string, preserving byte-equivalent behavior for legacy no-arg callers (countIdentityBounties L945 verified unchanged post-edit)."
  - "Comment discipline: `anchorLine` string absent from the entire file (grep-verified `grep -c 'anchorLine' returns 0` per the plan's LOCKED acceptance criterion). The JSDoc explanation of why the wire is eventId-only uses phrasings like 'line-offset field' and 'line offset' instead — semantically equivalent, wire-contract-locked, and grep-clean."
  - "`openClaudeSessionSocket(opts?: { historyWindow?: number })` — signature uses an OPTIONAL object argument (not a positional bare-number arg) so future opt-in additions (e.g. Wave 2 might add `initialCursor` or Wave 4 a `paneId` observability tag) extend the same options bag without a signature break. Object-arg is also more discoverable at call sites."
metrics:
  duration_sec: 211
  duration_display: "~3.5m"
  completed_date: "2026-08-18"
  tasks_completed: 1
  files_created: 0
  files_modified: 1
  commits: 1
---

# Phase 43 Plan 03: Wire scaffolding — historyWindow connect option + fetch_older wire types — Summary

One-liner: Landed the tiny signature-compatible extension to `openClaudeSessionSocket` (accepts optional `{ historyWindow?: number }` → appended as `?historyWindow=N` query param) plus two new exported wire types (`FetchOlderPayload` with the LOCKED eventId-only anchor, and `FetchOlderBatchEvent` for the batched historical-frames response). Zero consumers wired; frozen type surface for Wave 2's backend handler (43-04) and frontend runtime helpers (43-05) to compile against without racing over the api file.

## What Was Built

Three surgical edits to `src/ui/api/claude-session-api.ts`, zero touches to any other file:

1. **Signature extension on `openClaudeSessionSocket`** (L14-42, was L14-23):
   - Added optional parameter `opts?: { historyWindow?: number }` with inline JSDoc documenting the semantics (opt-in, positive-integer-only, backcompat when omitted, and the observation-channel isolation guarantee from CONTEXT.md).
   - URL construction gains a `qp` local: `typeof hw === "number" && Number.isFinite(hw) && hw > 0 ? \`?historyWindow=${Math.floor(hw)}\` : ""`. The three-check positive-finite-integer gate rejects `NaN`, `Infinity`, `-1`, `0`, `0.5`, undefined, string-shaped values — everything except a genuine positive integer falls through to the empty string.
   - `const url = \`${scheme}//${host}/claude-session/websocket/${qp}\`` — for the no-arg call path this is byte-equivalent to the pre-edit URL (`?…` only appended when `qp` is non-empty).

2. **`FetchOlderPayload` export** (clustered immediately after `IdentityBountyCountsEvent` at L820-833, before `countIdentityBounties`):
   ```ts
   export type FetchOlderPayload = {
     type: "fetch_older";
     anchorEventId: string;
     count: number;
   };
   ```
   Exactly the three fields locked in Phase 43 CONTEXT.md `<decisions>` § "Backend contract additions" and the plan's `must_haves.truths`. No `anchorLine`, no optional secondary hint, no placeholder comments hinting at future line-offset additions. JSDoc names the field semantics (`anchorEventId` is the eventId of the oldest currently-loaded message; server resolves via `resolveEventIdToLine` and returns messages strictly older than that anchor).

3. **`FetchOlderBatchEvent` export** (adjacent to `FetchOlderPayload`):
   ```ts
   export type FetchOlderBatchEvent = {
     type: "fetch_older_batch";
     frames: unknown[];
     reachedBeginning?: boolean;
     error?: string;
   };
   ```
   `frames` typed `unknown[]` at scaffolding stage (plan-authorized) with JSDoc naming the expected shape (ParsedLine emission variants — `MessageEvent | ImageEvent | RelayOutboundEvent | RelayInboundEvent | MalformedLineEvent`). `reachedBeginning?` set by the server when the resolved startLine ≤ 1 (client stops firing `fetch_older` after receiving this). `error?` populated when the server could not resolve the anchor or the range read failed; per CONTEXT.md § "Fetch failure handling" the client clears loading state and does NOT retry.

Zero runtime code added (no new functions, no new consts, no new mocks). Zero changes to any other export (`openClaudeSessionSubscribe`, `countIdentityBounties`, the wire-type surface for identity/relay/etc. — all untouched). The `openClaudeSessionSocket()` call inside `countIdentityBounties` at L945 verified byte-unchanged.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend openClaudeSessionSocket with optional historyWindow + add FetchOlder wire types | `d6123dab` | `src/ui/api/claude-session-api.ts` |

## Verification Results

Per the plan's `<verify>` block and `<acceptance_criteria>`:

- **`npm run build:backend`** → EXIT 0 (backend tsc + package.json copy clean).
- **`npm run build`** → EXIT 0 (frontend vite build clean; ~5.80s; no type errors).
- **`npx tsc --noEmit -p tsconfig.json`** → EXIT 0 (no type errors anywhere in the tree).
- **`grep -c "anchorLine" src/ui/api/claude-session-api.ts`** → **0** ✓ (LOCKED wire contract honored — no line-offset field anywhere in the file, including in comments).
- **`grep -c "historyWindow" src/ui/api/claude-session-api.ts`** → **4** ✓ (≥2 required; parameter destructuring + local `hw` + `Number.isFinite` check + URL query-param string).
- **`grep -c "FetchOlderPayload" src/ui/api/claude-session-api.ts`** → **2** ✓ (≥1 required; export site + one cross-reference in a JSDoc comment).
- **`grep -c "FetchOlderBatchEvent" src/ui/api/claude-session-api.ts`** → **3** ✓ (≥1 required; export site + two mentions in comment blocks that name Wave 3 as the consumer).
- **`grep -c "fetch_older" src/ui/api/claude-session-api.ts`** → **9** ✓ (≥2 required; payload type literal + batch event type literal + numerous JSDoc mentions).
- **`grep -c "openClaudeSessionSocket(opts" src/ui/api/claude-session-api.ts`** → **1** ✓ (≥1 required; the signature extension site).
- **`grep -n "openClaudeSessionSocket()" src/ui/api/claude-session-api.ts`** → single hit at **L945** ✓ (pre-existing `countIdentityBounties` call preserved byte-for-byte; backcompat confirmed for the ONE remaining zero-arg call site).
- **Cross-file leakage** — `grep -rn "FetchOlderPayload\|FetchOlderBatchEvent" src/ --include="*.ts" --include="*.tsx" | grep -v claude-session-api.ts` → **0 hits** ✓ (no premature wiring of the new symbols; every consumer is deferred to Wave 2/3 plans per the wave contract).
- **`historyWindow` cross-file check** — one pre-existing hit in `src/backend/claude-session/session-file-tail.test.ts:113` from Plan 43-01's backend parameterization; unrelated to this plan's frontend wire scaffolding. No new hits introduced.

## Deviations from Plan

**None.** Plan executed exactly as written — three surgical edits to a single file, no additional bug fixes, no auto-added functionality, no blocking issues encountered. One post-edit comment fix caught by acceptance-criteria grep: my first draft of the fetch_older prelude comment contained the string literal `` `anchorLine` `` (in backticks, describing what was NOT on the wire); the LOCKED acceptance criterion is `grep -c "anchorLine" == 0`, so the wording was reworked to "line-offset field" / "line offset" (semantically equivalent, grep-clean). This was catching-and-fixing my own draft, not a plan deviation — the LOCKED contract was honored on the first pass at the type-declaration level; only the JSDoc phrasing needed a second pass.

## Threat Flags

None. This plan adds only type declarations (compile-time only) and an optional query-string parameter that the backend consumer (Wave 2 43-04) will validate. No new network endpoints, no new auth paths, no new file access, no schema changes. The query-param carrier itself is public (present in the WebSocket handshake URL) — not a secret.

## Known Stubs

None. `FetchOlderBatchEvent.frames` typed `unknown[]` is not a stub — it is plan-authorized deferred narrowing (Wave 3 43-07b), documented in JSDoc, with the expected concrete union spelled out in a comment. This is the intentional pattern the plan calls out: "Wave 3 PrettyView plan 43-07a/b will refine the type when it wires the case in the onmessage switch."

## Self-Check: PASSED

- FOUND: `src/ui/api/claude-session-api.ts` (modified; git diff confirms +96/-2 lines).
- FOUND: commit `d6123dab` (`git log --oneline -1` shows `d6123dab feat(43-03): add historyWindow connect option + fetch_older wire types`).
- FOUND: `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-03-SUMMARY.md` (this file — being written).
