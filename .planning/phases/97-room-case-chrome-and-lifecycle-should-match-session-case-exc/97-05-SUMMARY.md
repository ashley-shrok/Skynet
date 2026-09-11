---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 05
subsystem: url-routing
tags: [url-persistence, relay, tab-restore, discriminated-union, chrome-window-restore]
requires:
  - src/ui/lib/tab-url.ts (Phase 56 Plan 02 splitTree round-trip; pre-existing)
  - src/ui/AppShell.tsx (Phase 90/91/93 relay-room tab plumbing; pre-existing)
  - src/types/ui-types.ts Tab.sessionKind + Tab.relayRoomId (Phase 90 Plan 01; pre-existing)
provides:
  - Relay-room URL round-trip via `relay:<encodeURIComponent(roomId)>` fragment
  - TabSpec discriminated union (harness variant vs relay variant) as the public grammar type
  - Idempotent tab-restore on refresh (reuse existing relay-room tab if roomId matches)
  - Structured `[url-restore]` log with masked roomId localpart
affects:
  - Chrome window-restore (Ctrl+Shift+T after closing a whole window) now preserves relay-room tabs
  - Any consumer that reads `spec.host` must narrow via `spec.protocol !== "relay"` guard
tech-stack:
  added: []
  patterns:
    - Discriminated-union TabSpec with `never` markers forcing exhaustive narrowing
    - Structural-grep test pattern (per sibling AppShell.new-conversation.test.tsx)
    - Phase 93 Landmine 6 discipline preserved (no JSON.stringify on DOM Event)
key-files:
  created:
    - src/ui/AppShell.relay-url-restore.test.tsx
  modified:
    - src/ui/lib/tab-url.ts
    - src/ui/lib/tab-url.test.ts
    - src/ui/AppShell.tsx
decisions:
  - D-15 shipped — URL identifier is the opaque Matrix room ID (readability not a concern)
  - D-16 shipped — URL shape mirrors the harness case's protocol-prefix pattern (`relay:<roomId>` alongside `tmux:<host>:<session>` etc.)
  - BLOCKER-2 (iter-2 plan-check) closed — TabSpec adopted discriminated-union form up front, not "if needed"; `npx tsc --noEmit` clean project-wide
  - BLOCKER-1 (iter-2 plan-check) closed — BOTH `pending.tabs` loops relay-branched (top-level open at ~L1256 AND splitTree positional resolver at ~L1344 including the resolver-closure fallback walk)
metrics:
  duration: 7m
  completed: 2026-09-10T02:14:04Z
  tasks_completed: 2
  files_touched: 4
  tests_added: 15 (relay-url-restore.test.tsx) + 12 (tab-url.test.ts relay describe block)
---

# Phase 97 Plan 05: Relay URL Persistence Summary

**One-liner:** Relay-room tabs round-trip through `#tab=relay:<encoded-roomId>` on Chrome refresh via a discriminated-union TabSpec + relay-branched URL-sync and BOTH tab-restore loops (top-level open + splitTree positional resolver), with a defensive 512-char roomId cap and structured logs that mask the shareable identifier to localpart.

## What Shipped

Two atomic tasks, RED-GREEN TDD per task, four commits total on `feat/tab-title-from-tmux`:

| Commit | Type | Description |
|--------|------|-------------|
| `76ec549f` | test(97-05) | RED — 12 new tab-url.test.ts tests for relay: grammar |
| `e73b6d32` | feat(97-05) | GREEN — tab-url.ts discriminated-union TabSpec + parseTabParam + encodeTabSpec + specForTab relay branches |
| `80bfd76c` | test(97-05) | RED — 15 new AppShell.relay-url-restore.test.tsx structural-grep tests |
| `cedef2d2` | feat(97-05) | GREEN — AppShell URL-sync + BOTH tab-restore loops relay-branched (BLOCKER-1 fix) |

### Task 1 — `src/ui/lib/tab-url.ts` grammar widening

- `TabSpec` converted from `interface` to a discriminated-union `type`:
  - Harness variant: `{protocol: "tmux" | "terminal" | "rdp" | "vnc" | "telnet"; host: string; session?: string; roomId?: never}` (host `string` unchanged from prior interface)
  - Relay variant: `{protocol: "relay"; roomId: string; host?: never; session?: never}`
  - The `?: never` markers force TS to narrow exhaustively — any consumer of `spec.host` must first eliminate the relay variant.
- `PROTOCOLS` list extended with `"relay"` (order-insensitive; appended for minimum diff churn).
- `parseTabParam`: relay branch BEFORE tmux/host paths, calls `decodeURIComponent`, rejects empty + oversized (>512 chars per T-97-05-02).
- `encodeTabSpec`: relay branch emits `relay:<encodeURIComponent(roomId)>`; else-branch spec.host is now narrowed to `string` (no `?? ""` fallback needed).
- `specForTab`: input widened with optional `sessionKind + relayRoomId`; relay branch fires when `sessionKind === "relay-room"` BEFORE the `host?.name` required check (relay tabs have no fleet host).

### Task 2 — `src/ui/AppShell.tsx` URL-sync + tab-restore wiring

Three coordinated code paths patched:

1. **URL-sync effect (L910-972) + splitTreeFragment callback (L945-957)** — both call sites now pass `sessionKind: t.sessionKind` and `relayRoomId: t.relayRoomId` to `specForTab`. The URL is keyed on roomId alone; `chatSurfaceAdapter.roomTitle` landing later intentionally does NOT trigger a URL rewrite (D-15 landmine).

2. **Tab-restore FIRST loop (~L1256)** — new `if (spec.protocol === "relay")` branch at the TOP (before any `spec.host` access):
   - Idempotency check: reuse existing tab where `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId`.
   - Else call `openTab(null, "terminal", undefined, {sessionKind: "relay-room", relayRoomId: spec.roomId, relayRoomTitle: null, label: spec.roomId, allowCreateTmux: false})` — the exact shape of `onRelayRoomRowClick` at L2169-2176.
   - Structured log `console.info({operation: "relay_room_url_restore", roomIdLocalpart, hasMatch: false})` — localpart-truncated only.
   - `continue` — skip the host-required logic below.

3. **Tab-restore SECOND loop (~L1344, splitTree positional resolver) — BLOCKER-1 fix**:
   - **Key builder** relay-branches to `\`relay:${spec.roomId}\`` before any `spec.host.toLowerCase()`. Pre-iter-2 the loop threw TypeError on relay specs and built a bogus `"relay:undefined:"` key that masked the bug behind a silent map-miss.
   - **Resolver closure** relay-branches identically for the key lookup AND walks the fallback via `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId` (roomId identity, not host-name lookup).

## BLOCKER-2 Closure Evidence (Discriminated-Union TabSpec)

The iter-2 plan-check called out that widening `host` from `string` to `string?` softly would leave consumers with `string | undefined` under `strictNullChecks`. The fix was to adopt the discriminated-union form up-front.

**Reality check discovery:** `tsconfig.app.json` and `tsconfig.node.json` both set `"strict": false`. Under this config, TS does NOT reject reading a `never` property (it happily returns `never`), so the discriminated-union form does not cascade tsc errors even without the AppShell guards. This means `npx tsc --noEmit` was CLEAN after Task 1 alone (before any AppShell changes) — the tsc gate passed by grace of the project's non-strict config, not by the guards being unnecessary.

**Why the guards still matter:** the runtime bugs are real — `undefined.toLowerCase()` throws, `"relay:undefined:"` masks logic, host-id `undefined === undefined` false-positives. BLOCKER-1's fix is a runtime-correctness fix (Rule 1 territory), not just a tsc appeaser. Task 2 lands both guards even though tsc wouldn't have complained without them.

**Final tsc PROJECT-WIDE:**

```
$ npx tsc --noEmit
$ echo $?
0
```

Zero lines of tsc output. Clean across the entire project. Task 1 gate + Task 2 gate both pass.

## BLOCKER-1 Closure Evidence (BOTH pending.tabs loops relay-branched)

Grep counts against the shipped `src/ui/AppShell.tsx`:

| Gate | Required | Actual |
|------|----------|--------|
| `spec.protocol === "relay"` | >= 2 (loop 1 + loop 2 + resolver = 3) | **3** |
| `spec.roomId` | >= 4 (loop-1 match-find + loop-1 openTab + loop-2 key + resolver key + resolver fallback = 5+) | **7** |
| `sessionKind: "relay-room"` (openTab shape) | >= 1 | **3** |
| `sessionKind: t.sessionKind` (specForTab call) | >= 2 (URL-sync + splitTreeFragment) | **2** |
| `relayRoomId: t.relayRoomId` (specForTab call) | >= 2 | **2** |
| `operation: "relay_room_url_restore"` (structured log) | 1 | **1** |
| `t.sessionKind === "relay-room" && t.relayRoomId === spec.roomId` (resolver fallback) | 1+ multiline occurrences | **2** (L1278-1279 open-loop, L1448-1449 resolver-closure) |
| `JSON.stringify(e)` (Phase 93 Landmine 6 regression) | 0 | **0** |

Both loops (L1256 top-level URL-open + L1344 splitTree positional resolver, plus the L1435 resolver closure inside the second loop) all guard `spec.protocol === "relay"` before touching `spec.host`.

## split-tree-url.ts Change Assessment

**Prediction (97-RESEARCH § Finding 7):** no split-tree-url.ts changes required.

**Verification:** `split-tree-url.ts`'s `decodeSpec` at L271-293 rejects any protocol other than `tmux` — split-tree URL grammar accepts only tmux specs into its alphabet. This means a relay leaf cannot currently be encoded INTO a `s=`/`t=` split-tree URL fragment (`encodeSplitTreeToUrl` at L60-92 would strip any leaf whose `sessionAddress` returns a relay spec because `stringifyTree`'s `encodeSpec` at L94-105 would emit `relay:<encoded roomId>:` which `decodeSpec` then rejects — so the pre-pass would technically encode it but the round-trip would drop it on decode).

**Consequence:** The RESEARCH-predicted "no change needed" holds — Plan 05 doesn't ship a splittree-embedded relay path via the URL. However, AppShell's splitTree resolver (L1436-1454 in the shipped file) DEFENSIVELY handles a relay spec should the codec ever be widened (BLOCKER-1 required this anyway because Task 1's discriminated union types `spec.host` as `never` on the relay variant, so any call-site accessing it must guard). That's the "cheap insurance" the plan called out — the fix is byte-identical to the fix required for correctness, so there's no cost to laying it down now.

**No changes made to `src/ui/lib/split-tree-url.ts` in Plan 05.**

## URL Fragment Format Observed

For a top-level relay tab (roomId `!abcdef:matrix.example.com`):

```
#tab=relay:!abcdef%3Amatrix.example.com
```

Note `!` is left unencoded by `encodeURIComponent` per RFC 3986 (it's a reserved char that IS a valid URI-component char). `:` and other URI-generic delimiters ARE encoded (`%3A`). The 512-char cap comfortably covers realistic Matrix roomIds (~40 chars) with ample defensive headroom. Round-trip covered by tab-url.test.ts Test 8 and Test 10c (which exercises `!`, `:`, `.`, `@`, `#` all together).

For a splitTree-embedded relay leaf: not currently emitted — see split-tree-url.ts change assessment above. If ever emitted, the resolver correctly routes it via roomId identity match.

## Structured Log Masking

`AppShell.tsx:1301-1308`:

```typescript
const localpart =
  spec.roomId.split(":")[0]?.replace(/^!/, "").slice(0, 12) ??
  "unknown";
console.info({
  operation: "relay_room_url_restore",
  roomIdLocalpart: localpart,
  hasMatch: false,
});
```

For roomId `!abcdef123456789:matrix.example.com` the localpart emitted is `abcdef123456` (12 chars, `!` prefix stripped, no server suffix). Full roomId is NEVER logged. Grep against the source confirms no `roomId: spec.roomId` unmasked emit in the log block.

## Deviations from Plan

### None (Rules 1-4 all not triggered)

Plan executed exactly as written for the two coordinated tasks. Two small notes:

- **`encodeURIComponent` behavior on `!` (Rule 1 note, not deviation):** The plan's Task 1 Test 3 asserted `encodeTabSpec({...roomId: "!abc..."})` returns `"relay:%21..."`. In reality `encodeURIComponent` does NOT encode `!` per RFC 3986. Test 3's assertion was updated to `"relay:!abc..."` to reflect actual `encodeURIComponent` output. The semantic invariant (round-trip through parseTabParam works for Matrix-legal chars including `!`, `:`, `.`, `@`, `#`) is preserved end-to-end via Test 8 (round-trip) and Test 10c (pathological all-special-chars). Not a deviation — the plan's test was over-specifying encoder output; the corrected form still gates the behavior the plan cares about.

- **`vitest --related` flag unavailable in v4.1.8 (verification-only, no behavior impact):** The plan's `<verify>` block ran `npx vitest run --related src/ui/AppShell.tsx`. `--related` is a v5+ option; Vitest 4.1.8 rejects it with `Unknown option --related`. The verification intent (running the tests that touch AppShell.tsx) was fully achieved by explicitly running the 5 AppShell test files + tab-url = 70/70 tests green. No plan-file change was needed; documenting here so future planners in this repo know to use explicit test file paths.

## Test Coverage

| File | Suite | Tests | Result |
|------|-------|-------|--------|
| src/ui/lib/tab-url.test.ts | Phase 56 Plan 02 splitTree round-trip (pre-existing) | 3 | pass (regression floor) |
| src/ui/lib/tab-url.test.ts | Phase 97 Plan 05 relay: grammar | 12 | pass |
| src/ui/AppShell.relay-url-restore.test.tsx | Phase 97 Plan 05 URL round-trip wiring | 15 | pass |
| src/ui/AppShell.persistence.test.tsx | Phase 25/34/35 URL persistence (pre-existing) | (varies) | pass |
| src/ui/AppShell.split-tree.test.tsx | Phase 56/59 split-tree mechanism (pre-existing) | (varies) | pass |
| src/ui/AppShell.new-conversation.test.tsx | Phase 91 Plan 05 onCreateRelayRoom (pre-existing) | 12 | pass |
| src/ui/AppShell.empty-pv-drop-tint.test.tsx | Phase 59 Plan 01 (pre-existing) | (varies) | pass |
| **6 test files total** | **All scoped AppShell + tab-url** | **70** | **70 passed** |

`npx tsc --noEmit` project-wide: **clean, zero output**.

## Non-Blocking Warnings Carried Forward

- **WARNING-5 (placeholder capitalization, iter-1 checker report):** belongs to Plan 03 (composebox reflow + placeholder), not Plan 05. Not addressed here. Cross-referenced for the phase's `/close`.

## Live Browser Verification

Not executed as part of this executor run — fleet directive is no docker / no playwright in executor scope. Live browser verification is Alice's `/close`-time gate for this phase: open a relay room, observe the URL fragment updates to include `relay:<encoded>`; refresh the browser; observe the relay tab restores. The unit-test coverage plus the shipped grep gates give high confidence the wiring is correct; live UAT closes the loop.

## Threat Flags

None. Plan 05 introduces no new security-relevant surface beyond what the STRIDE register in the plan already tracked. The URL fragment → parseTabParam → openTab → useRelayAdapter → WS chain is guarded by:

- T-97-05-01 (tampering — forged roomId): mitigated by existing backend WS auth-gate; client does no double-validation.
- T-97-05-02 (DoS — oversized roomId): mitigated by 512-char cap in parseTabParam.
- T-97-05-03 (info-disclosure — logs leaking full roomId): mitigated by localpart mask in the structured log.

All three mitigations are shipped.

## Self-Check: PASSED

- src/ui/lib/tab-url.ts: FOUND (modified, discriminated-union TabSpec + relay branches present)
- src/ui/lib/tab-url.test.ts: FOUND (12 new relay-describe-block tests, 15 total tests passing)
- src/ui/AppShell.tsx: FOUND (URL-sync + splitTreeFragment + BOTH tab-restore loops relay-branched)
- src/ui/AppShell.relay-url-restore.test.tsx: FOUND (new file, 15 tests passing)
- Commits:
  - `76ec549f` (test RED, tab-url): FOUND
  - `e73b6d32` (feat GREEN, tab-url): FOUND
  - `80bfd76c` (test RED, AppShell): FOUND
  - `cedef2d2` (feat GREEN, AppShell): FOUND

All artifacts present. All 70 scoped tests green. tsc project-wide clean.

## TDD Gate Compliance

Task 1: test(97-05) RED @ 76ec549f → feat(97-05) GREEN @ e73b6d32 (RED-GREEN gate satisfied).
Task 2: test(97-05) RED @ 80bfd76c → feat(97-05) GREEN @ cedef2d2 (RED-GREEN gate satisfied).

No REFACTOR commits needed — both GREEN implementations landed the shape the plan specified without a post-hoc cleanup pass.
