---
phase: 61-wip-indicator-shell-idle-gate
verified: 2026-08-29T08:58:00Z
status: passed
score: 8/8 locked decisions verified + 8/8 verification-context truths verified
overrides_applied: 0
verdict: PASSED
---

# Phase 61: WIP Indicator Shell-Idle-Gate Verification Report

**Phase Goal (ROADMAP.md):** The conversation-list WIP indicator stops lying about stale-shell sessions (Poppy/aqua/wilma pattern). New predicate: shell counts as work ONLY when the session status transitioned since its last Stop-hook fire; unknown-stop defaults to on (rollout safety). Fifth-slice extension to the fleet-status pipeline.

**Verified:** 2026-08-29T08:58:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement — Verification Context Truths

Each of the 8 truths from the verification context, mapped to observable code:

### Truth 1: Predicate exactly matches D-02 shape

**Status: VERIFIED**

`src/ui/state/session-working-store.ts` lines 233-240:

```typescript
const lastStopAt = state_arg.lastStopAt ?? null;
const lastStatusChangeAt = state_arg.lastStatusChangeAt ?? null;
const shellCountsAsWork =
  state_arg.status === "shell" &&
  (lastStopAt === null ||
    (lastStatusChangeAt !== null && lastStatusChangeAt > lastStopAt));
const main =
  state_arg.status === "busy" || shellCountsAsWork;
```

Byte-equivalent to the D-02 lock: `main = busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))`. Normalizes `undefined → null` first (defensive), then the null-branch triggers the default-on rollout-safety path (D-05) and the numeric branch enforces `>` (strict — same-timestamp does NOT count as fresh, which is the correct conservative semantic).

### Truth 2: Harness script writes per-session file AND box-wide file

**Status: VERIFIED**

`src/backend/fleet-status/stop-hook.sh`:
- Line 43: `printf "%s" "$payload" > "${BOX_TMP_FILE}" && mv "${BOX_TMP_FILE}" "${PAYLOAD_FILE}"` — box-wide file written UNCONDITIONALLY (fires before the regex gate).
- Line 47-52: `if [[ ... regex match ]]; then per_session_file="${PAYLOAD_DIR}/stop-${sid}.json"; printf ... > "$per_session_tmp" && mv "$per_session_tmp" "$per_session_file"; fi` — per-session file written only when sessionId passes strict `[a-zA-Z0-9_-]+` character-class regex.

Behavioral spot-check confirms:

```
Happy-path (session_id=abc-def-123):
  $ printf '{"session_id":"abc-def-123",...}' | HOME=/tmp/x bash stop-hook.sh
  → /tmp/x/.claude/fleet-status/last-stop-payload.json (created, 75 bytes)
  → /tmp/x/.claude/fleet-status/stop-abc-def-123.json (created, 75 bytes)

Attack-defense (session_id=../../evil):
  $ printf '{"session_id":"../../evil",...}' | HOME=/tmp/y bash stop-hook.sh
  → /tmp/y/.claude/fleet-status/last-stop-payload.json (created — box-wide preserved)
  → NO per-session file anywhere (regex rejected the traversal chars)
```

Per-session write is additive; box-wide write is preserved for `backgroundTasks[]` consumers (D-03 lock respected).

### Truth 3: STOP_HOOK_SCRIPT_CONTENTS byte-matches shipped stop-hook.sh, guarded by test

**Status: VERIFIED**

`src/backend/fleet-status/remote-hook-install.ts` line 73 declares the template literal starting `` STOP_HOOK_SCRIPT_CONTENTS = `#!/bin/bash ``. Contents (lines 73-127) include the same Phase 61 header comment, `bash -c` interpreter swap, strict regex on line 119, and per-session write on lines 121-123 — with every `$` escaped as `\$` and every `${...}` escaped as `\${...}` for template-literal safety.

Test 11 at `src/backend/fleet-status/remote-hook-install.test.ts:482-491`:

```typescript
describe("STOP_HOOK_SCRIPT_CONTENTS", () => {
  it("Test 11: STOP_HOOK_SCRIPT_CONTENTS byte-matches stop-hook.sh on disk", async () => {
    const diskContents = readFileSync(diskPath, "utf-8");
    expect(STOP_HOOK_SCRIPT_CONTENTS).toBe(diskContents);
  });
});
```

**Executed:** `npx vitest run src/backend/fleet-status/remote-hook-install --testNamePattern "Test 11"` → **1 passed** (byte equality asserted at test time).

### Truth 4: Backend tracks lastStatusChangeAt from status-delta, NOT sessionJson.updatedAt

**Status: VERIFIED**

`src/backend/fleet-status/ssh-poll-orchestrator.ts` lines 1097-1126:

```typescript
// Phase 61 Plan 02 — server-side status-delta tracking for the
// lastStatusChangeAt axis. MUST NOT source from sessionJson.updatedAt
// (Research § Common Pitfalls Pitfall 4: the harness bumps updatedAt
// on compose-box typing without a real state transition — using it
// as the source would defeat the whole point of the stop-gate).
let derivedLastStatusChangeAt: number;
if (
  isNew ||
  cached?.lastStatus === null ||
  cached?.lastStatus === undefined
) {
  derivedLastStatusChangeAt = deps.now();
} else if (cached.lastStatus !== sessionJson.status) {
  derivedLastStatusChangeAt = deps.now();
} else {
  derivedLastStatusChangeAt = cached.lastStatusChangeAt;
}
```

Grep confirms `sessionJson.updatedAt` usage across the whole file: 3 hits, all pre-existing OR comment-only. Line 1357 (`updatedAt: sessionJson.updatedAt`) is the existing composed-state SessionState `updatedAt` field — unrelated to `lastStatusChangeAt`. Lines 191 and 1099-1102 are comments explicitly forbidding the anti-pattern. There are ZERO new usages of `sessionJson.updatedAt` as a data source for `lastStatusChangeAt`.

Derivation is a poll-to-poll delta on the cached `lastStatus` field (of the previous tick's `sessionJson.status`) — a pure server-side state-transition detection.

### Truth 5: Wire protocol carries both axes as optional-nullable, FRAME_SCHEMA_VERSION unchanged

**Status: VERIFIED**

`src/backend/fleet-status/wire-protocol.ts`:
- Line 14: `export const FRAME_SCHEMA_VERSION = 1 as const;` — **unchanged at 1**.
- Line 253: `lastStopAt: z.number().nullable().optional(),`
- Line 255: `lastStatusChangeAt: z.number().nullable().optional(),`

`src/ui/api/fleet-status-types.ts`:
- Line 23: `export const FRAME_SCHEMA_VERSION = 1 as const;` — mirror unchanged.
- Line 175: `lastStopAt?: number | null;`
- Line 176: `lastStatusChangeAt?: number | null;`

Both fields are optional-nullable on both sides of the boundary. Frontend mirror uses the lockstep TypeScript shape (`?: number | null`) that maps identically to zod's `.number().nullable().optional()`. Additive-only — the 27 pre-existing wire-protocol tests remain green (10 new tests confirm back-compat behavior of pre-Phase-59 frames that omit both fields).

### Truth 6: Frontend store preserves both new axes across Axis A/D/E republish paths

**Status: VERIFIED** (all three sites)

Axis A `nextMap.set` at `src/ui/state/session-working-store.ts:294-306` includes:
- Line 304: `lastStopAt: existing?.lastStopAt ?? null,`
- Line 305: `lastStatusChangeAt: existing?.lastStatusChangeAt ?? null,`

Axis D `nextMap.set` at lines 347-357 includes:
- Line 355: `lastStopAt: existingAfterAxes.lastStopAt,`
- Line 356: `lastStatusChangeAt: existingAfterAxes.lastStatusChangeAt,`

Axis E `nextMap.set` at lines 382-392 includes:
- Line 390: `lastStopAt: existingAfterAxes.lastStopAt,`
- Line 391: `lastStatusChangeAt: existingAfterAxes.lastStatusChangeAt,`

Test P at `src/ui/state/session-working-store.test.ts:1430-1477` is the regression guard: publishes a frame with `{status:"shell", lastStopAt:1000, lastStatusChangeAt:5000}` → snapshot inspection confirms both cached; then publishes `{status:"idle"}` (isWorking flips, both stop-gate axes omitted from wire) → snapshot inspection confirms BOTH cached values still 1000/5000. Passes as part of the 64/64 green scoped run. Phase 53 Pitfall 3 verbatim guarded.

_Bonus (auto-add Rule 2):_ `advanceSessionLastMessageAt` at lines 542-543 and `advanceSessionAiTitle` at lines 631-632 also preserve both axes, closing an unstated but real path (Axis B/C chokepoint helpers writing fresh records).

### Truth 7: Existing Test B REVISED (not left in place)

**Status: VERIFIED**

`src/ui/state/session-working-store.test.ts` lines 85-127:
- Header block comment (lines 85-111): explicitly declares Phase 61 supersession of the `inline-260823-wip-shell-is-work` rule; cites CONTEXT.md D-05; cites RESEARCH.md § Pitfall 8 ("skipped Test B revision") as the exact bug being prevented.
- `describe(...)` title (line 113): includes `"Phase 61 rollout-safety default-on, supersedes inline-260823-wip-shell-is-work"`.
- `it(...)` title (line 114): now reads `"shell + wire omitted lastStopAt/lastStatusChangeAt → useSessionIsWorking returns true (rollout-safety default-on per CONTEXT.md D-05)"`.
- Assertion body: unchanged in shape (still publishes `makeState({status:"shell"})`), but the truth-carrying comment on line 120-121 explicitly names the new default-on branch as the reason the assertion holds.

Grep confirms:
- `"shell IS real tool-execution work"` (old expectation) → **0 hits** (removed from all assertion labels).
- `"rollout-safety"` / `"default-on"` (new expectation) → 6 hits.
- `"inline-260823-wip-shell-is-work"` → preserved as historical citation (6 hits).

Test B is definitively revised, not left dormant on the old rule.

### Truth 8: All 7 locked decisions D-01..D-07 map to observable code

| Decision | Lock | Code Evidence | Status |
|----------|------|--------------|--------|
| **D-01 positive-signal-only** | Trust "harness observed a stop at T", not "harness's stale state note = shell means work" | Predicate at session-working-store.ts:235-238 uses `lastStopAt` (positive signal — "we saw a stop") as the gate. Absence of Stop signal defaults on (D-05); presence of Stop with stale `lastStatusChangeAt` flips off. Never derives "work" from stale-status silence. | VERIFIED |
| **D-02 predicate shape** | `main = busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))` | session-working-store.ts:235-240 byte-equivalent | VERIFIED |
| **D-03 per-session additive** | Per-session file added; box-wide preserved for `backgroundTasks[]` | stop-hook.sh:43 (box-wide UNCONDITIONAL) + stop-hook.sh:47-51 (per-session guarded); ssh-poll-orchestrator.ts:587-588 hookPayloadPath still points at `last-stop-payload.json` for backgroundTasks consumer | VERIFIED |
| **D-04 server-side derivation, NOT updatedAt** | `lastStatusChangeAt` derived from poll-to-poll `sessionJson.status` transition, never from `sessionJson.updatedAt` | ssh-poll-orchestrator.ts:1099-1126 (explicit warning + status-delta implementation); no new usage of `sessionJson.updatedAt` as source | VERIFIED |
| **D-05 lazy rollout / default-on** | `lastStopAt === null` (never seen a Stop) → treat as still working | session-working-store.ts:220-223 (comment cites CONTEXT.md D-05); predicate returns true when `lastStopAt === null`; existing stale-shell sessions (Poppy/aqua/wilma) stay lit until their first Phase-59-era Stop file lands | VERIFIED |
| **D-06 passive on managed boxes** | Diagnostic layer changes nothing on the managed box beyond the additive Stop-hook file write; both writes are atomic (`.tmp` + `mv`) | stop-hook.sh:43 (box-wide `.tmp` + `mv`) + stop-hook.sh:50-51 (per-session `.tmp` + `mv`); backend read is pure `stat -c %Y` (ssh-poll-orchestrator.ts:1084-1086) — read-only, no writes to managed box | VERIFIED |
| **D-07 transcript-read alternative rejected** | Must use per-session file, not transcript tail | ssh-poll-orchestrator.ts:1084-1086 issues `stat -c %Y ~/.claude/fleet-status/stop-<sessionId>.json` — reads the per-session file's mtime; there is NO transcript tail path in the poll loop | VERIFIED |

All 7 locked decisions have observable code that upholds them.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/fleet-status/stop-hook.sh` | Additive per-session file write, box-wide preserved | VERIFIED | 54 lines; both writes present; strict character-class regex; interpreter swap `sh -c → bash -c`; `bash -n` syntax check passes |
| `src/backend/fleet-status/remote-hook-install.ts` | STOP_HOOK_SCRIPT_CONTENTS byte-in-sync | VERIFIED | Test 11 green |
| `src/backend/fleet-status/wire-protocol.ts` | SessionStateSchema extended with two optional-nullable fields; FRAME_SCHEMA_VERSION = 1 | VERIFIED | Lines 253, 255; version unchanged at line 14 |
| `src/ui/api/fleet-status-types.ts` | Frontend SessionState mirror | VERIFIED | Lines 175-176; FRAME_SCHEMA_VERSION = 1 mirror at line 23 |
| `src/backend/fleet-status/wire-protocol.test.ts` | 10 new tests covering additive axes | VERIFIED | 37/37 tests green (27 pre-existing + 10 new) |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | processPid derives both axes, both participate in fingerprint, both livenessMap.set branches cache | VERIFIED | Lines 1082-1126 (derivations), 1366-1367 (SessionState composition), 575 (fingerprint), 1409-1411 + 1433-1435 (both cache branches) |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | 6 new tests | VERIFIED | 94/94 tests green (88 pre-existing + 6 new) |
| `src/ui/state/session-working-store.ts` | Predicate revised; WorkingRecord extended; Axis A/D/E preserve; Axis F/G blocks appended | VERIFIED | Lines 143, 148 (record); 233-240 (predicate); 304-305 + 355-356 + 390-391 (preservation); 414-435 + 449-472 (Axis F/G) |
| `src/ui/state/session-working-store.test.ts` | Test B revised, Tests M/N/O/P added | VERIFIED | 64/64 tests green (60 pre-existing + 4 new); Test B revised in header + describe + it title; old wording removed |

---

## Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| stop-hook.sh (per-session write) | ssh-poll-orchestrator processPid (mtime read) | `~/.claude/fleet-status/stop-<sessionId>.json` on managed box | WIRED (line 1084-1086 issues `stat -c %Y` against the same path) |
| STOP_HOOK_SCRIPT_CONTENTS | stop-hook.sh (on disk) | Test 11 byte-equality assertion | WIRED (Test 11 green) |
| SessionStateSchema (backend) | SessionState interface (frontend) | Lockstep mirror + shared FRAME_SCHEMA_VERSION | WIRED (both fields present on both sides, both versions = 1) |
| processPid derivation | SubscriptionRegistry.publishSessionState | `deps.registry.publishSessionState(host.id, state)` at line 1375 with state carrying both new axes at lines 1366-1367 | WIRED |
| processPid derivation | computeFingerprint | Template literal at line 575 includes `|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}` — both axes fire fresh publishes on delta | WIRED |
| SessionState wire frame | session-working-store.publishFleetStatusSessionState | Predicate at line 233-240 reads `state_arg.lastStopAt` + `state_arg.lastStatusChangeAt` | WIRED |
| session-working-store WorkingRecord | useSessionIsWorking hook consumers | WipBubble (PrettyView) + row dot (PrettyConversationRow) via unchanged hook | WIRED (zero consumer-side changes required per Plan 03) |

---

## Data-Flow Trace (Level 4)

Traced end-to-end for both new axes:

**lastStopAt data flow:**
1. Managed-box harness fires Stop hook → stop-hook.sh writes `~/.claude/fleet-status/stop-<sessionId>.json` (atomic `.tmp` + `mv`).
2. Backend 2s poll tick issues `stat -c %Y ~/.claude/fleet-status/stop-<shellSingleQuote(sessionId)>.json` in processPid (ssh-poll-orchestrator.ts:1084-1086).
3. Backend parses stdout, multiplies by 1000, stamps on composed SessionState (line 1366).
4. Backend caches in `PidCacheEntry.lastStopAt` (both livenessMap.set branches).
5. Backend publishes SessionState via `deps.registry.publishSessionState` (line 1375).
6. Wire schema `SessionStateSchema.lastStopAt: z.number().nullable().optional()` validates the frame.
7. Frontend `SessionState.lastStopAt?: number | null` receives the field.
8. Frontend `publishFleetStatusSessionState` normalizes `undefined → null` (line 233), then uses in predicate (line 237).
9. WorkingRecord caches `lastStopAt: number | null` (line 143); Axis A/D/E preserve on republishes.

**lastStatusChangeAt data flow:**
1. Backend 2s poll parses `sessionJson.status` from the managed box.
2. Backend compares `sessionJson.status` to previous-tick cached `PidCacheEntry.lastStatus` (line 1122).
3. On transition or first-appearance → seed to `deps.now()` (lines 1121, 1123).
4. On same-status → preserve cached value (line 1125).
5. Backend stamps on composed SessionState (line 1367).
6. Backend caches in `PidCacheEntry.lastStatusChangeAt` (both livenessMap.set branches).
7. (Same wire + frontend flow as lastStopAt from step 5 onward.)

Both flows are FLOWING with real data — no static returns, no hollow props, no disconnected wiring.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| stop-hook.sh syntax valid | `bash -n src/backend/fleet-status/stop-hook.sh` | exit 0 | PASS |
| stop-hook.sh happy-path write | `printf '{"session_id":"abc-def-123",...}' \| HOME=/tmp/x bash stop-hook.sh; ls /tmp/x/.claude/fleet-status/` | Both files created (last-stop-payload.json 75B, stop-abc-def-123.json 75B) | PASS |
| stop-hook.sh attack-defense | `printf '{"session_id":"../../evil",...}' \| HOME=/tmp/y bash stop-hook.sh; find /tmp/y -type f` | ONLY last-stop-payload.json created; NO per-session file; NO path-traversal artifacts | PASS |
| STOP_HOOK_SCRIPT_CONTENTS byte-equality | `npx vitest run src/backend/fleet-status/remote-hook-install --testNamePattern "Test 11"` | 1 passed | PASS |
| Wire-protocol test suite | `npx vitest run src/backend/fleet-status/wire-protocol` | 37 passed (27 + 10 Phase 61) | PASS |
| ssh-poll-orchestrator test suite | `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator` | 94 passed (88 + 6 Phase 61) | PASS |
| session-working-store test suite | `npx vitest run src/ui/state/session-working-store` | 64 passed (60 + 4 Phase 61) | PASS |
| Full Phase 61 scoped test run | `npx vitest run <all 4 suites>` | 214 passed | PASS |
| Backend TypeScript build | `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` | exit 0 (twice, independent runs) | PASS |

---

## Anti-Patterns Found

None. Files modified by this phase were scanned for:
- Debt markers (`TBD`, `FIXME`, `XXX`) — 0 in Phase 61 code
- `TODO` / `HACK` / `PLACEHOLDER` — 0 in Phase 61 code
- Hardcoded empty stubs (`return null`, `return []`) — the only such returns are in fail-open paths documented as intentional (e.g., `cached?.lastStopAt ?? null` in ssh-poll-orchestrator.ts:1082, which is the documented cache-preservation on SSH hiccup; `existing?.lastStopAt ?? null` in Axis A preservation, which is the documented default for brand-new keys)
- `console.log`-only implementations — 0 (the `console.info` calls at Axis A are structured logging with real payloads, part of the existing forensic tracing pattern)

Every Phase 61 code path is documented with plan-referenced comments (Plan 61-01 / 02 / 03 tags throughout).

---

## Requirements Coverage

Phase 61 plans declared `requirements: []` in all three PLAN frontmatters — no formal REQ-* IDs to trace. Phase goal comes directly from CONTEXT.md and ROADMAP.md. All success-criteria bullets in the three PLAN files are green (see per-plan SUMMARY.md self-checks).

---

## Human Verification Required

None required for the phase-goal verification (all truths verifiable against code + tests).

**Post-deploy UAT** (out-of-scope for this verifier, but planned by 61-03-SUMMARY.md § Poppy/aqua/wilma post-deploy prediction): after Ashley deploys Phase 61, Poppy/aqua/wilma should remain lit initially (rollout-safety default-on since backend hasn't seen their per-session Stop file yet); on their next real turn-end, the per-session file lands for the first time, backend stamps lastStopAt, frontend predicate reads `lastStatusChangeAt (18-20h ago) < lastStopAt (now)` → indicator flips off. This is a live-fleet observability check, not a codebase check — the codebase-level verification (this document) confirms the machinery to enable that observation is fully wired.

---

## Gaps Summary

No gaps. All 8 verification-context truths are VERIFIED against observable code. All 7 locked decisions D-01..D-07 have supporting code. Byte-equality test (Test 11) is green, confirming the shipped stop-hook.sh and the inlined STOP_HOOK_SCRIPT_CONTENTS are identical. Backend build is clean. 214 scoped tests all pass. Manual smoke tests (happy-path + attack-defense) behave as specified.

Phase 61 goal achieved: the frontend WIP predicate exactly matches the D-02 contract, the harness-side per-session file is written and read correctly, the wire carries both new axes back-compat-safely, and Axis A/D/E cache preservation prevents Phase 53's Pitfall 3 from recurring on the two new axes.

---

## Verdict: **PASSED**

All must-haves verified. All 7 locked decisions have observable code support. All 214 scoped tests green. Backend TypeScript build clean. Manual smoke tests (happy-path + attack-defense) both behave as specified. Phase goal achieved.

**Ready to proceed.**

---

_Verified: 2026-08-29T08:58:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M-context)_
