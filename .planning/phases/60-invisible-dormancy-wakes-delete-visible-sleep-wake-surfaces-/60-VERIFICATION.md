# Phase 60 Verification — invisible dormancy/wakes

**Verified:** 2026-08-23
**Status:** passed
**Verifier:** gsd-verifier (goal-backward against `.planning/shapes/shape-invisible-dormancy.md`)

**Scope:** All 8 shape facets walked against the actual codebase on branch `feat/tab-title-from-tmux` at `/home/ubuntu/skynet-tina`. SUMMARY.md claims independently confirmed. Not deployed (orchestrator-only per fleet directive).

---

## Facet Verification

### 1. Delete-don't-hide invariant

- [x] `src/ui/features/pretty-view/DormancyOverlay.tsx` — DELETED (`ls` returns ENOENT).
- [x] `src/ui/features/pretty-view/DormancyOverlay.test.tsx` — DELETED.
- [x] `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` — DELETED.
- [x] `PrettyView.tsx` no longer imports DormancyOverlay — `grep -c "DormancyOverlay" src/ui/features/pretty-view/PrettyView.tsx` = **0**.
- [x] `ComposeBox.tsx` has no `dormantActive` plumbing — `grep -c "dormantActive" src/ui/features/pretty-view/ComposeBox.tsx` = **0**.

**Finding:** Deleted, not hidden. No behind-a-flag preservation. Shape principle honored.

### 2. Send-while-dormant path — reuses `.resume-complete` freshness contract

Verified in `src/backend/claude-session/claude-session-server.ts` at L2070-2184 (inside `__applyInputMessageForTests`):

- [x] **Entry check** at L2070: `const wasDormant = deps.dormantLastEmitted?.() === true;` — runs BEFORE MAX_INPUT_BYTES cap.
- [x] **Sentinel drop** at L2099-2102: `exec(sshConn, \`rm -f ~/.claude/identities/'${currentTmuxSession}'/.dormant\`)` — byte-identical to the (now-deleted) wake-handler shape. Wrapped in try/catch that logs `pv_input_dormant_sentinel_drop_failed` on error and falls through.
- [x] **`wakeTriggerTs` write** at L2092: `deps.setWakeTriggerTs(triggerTs)` — writes into the connection-closure `let wakeTriggerTs` at L3166 so the existing dormant-poll marker-freshness gate at L2743 holds the pane's `dormant:true` frame in place.
- [x] **Marker poll** at L2136-2152: 500ms bounded loop; `markerCommand` returns `.resume-complete` body; parse via `Date.parse(body.trim())`; success on `markerTs > triggerTs`; fallback on `(now - triggerTs) >= MARKER_FALLBACK_MS`.
- [x] **`MARKER_FALLBACK_MS = 90_000`** confirmed at L778.
- [x] **Structured logs** at four path-taken transitions:
  - `pv_input_dormant_send_start` (L2081) — includes `hostId`, `tmuxSession`, `mqid`.
  - `pv_input_dormant_wait_marker` (L2121) — includes `triggerTs`.
  - `pv_input_dormant_marker_fresh` (L2170) — includes `elapsedMs`.
  - `pv_input_dormant_marker_fallback` (L2158) — includes `elapsedMs`, `fellBack: true`.
- [x] **Fall-through** to normal split-send at L2184+ (MAX_INPUT_BYTES cap + split-send + watchdog arm) — same code path as the awake-pane case.

**Wire-up verified:** WS input handler (~L5920-5946) passes all four deps: `dormantLastEmitted`, `setWakeTriggerTs`, `markerCommand`, `now: () => Date.now()`.

**Finding:** Send-path teaches invisible wake via the pre-existing `.resume-complete` marker contract. No new detection mechanism. Sentinel drop symmetric with the deleted wake handler's shape.

### 3. pv-send-watchdog widened window — exists and wired

Constants at `src/backend/claude-session/pv-send-watchdog.ts`:

- [x] `export const MARKER_FALLBACK_MS_MIRROR = 90_000` at L83.
- [x] `export const RETRY_ENTER_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + RETRY_ENTER_MS` at L90 (= 92_500).
- [x] `export const FULL_RESEND_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + FULL_RESEND_MS` at L93 (= 95_500).
- [x] `export const GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000` at L100 (= 120_000).

Flag + branch:

- [x] `dormantSend?: boolean` on `ArmPvSendWatchdogArgs` (L169).
- [x] Local delay vars at L237-239 swap widened vs normal based on flag.
- [x] `dormantSend: args.dormantSend === true` in both armed-log metadata objects (L312, L432).

Wiring at both arm sites in `claude-session-server.ts::__applyInputMessageForTests`:

- [x] Split-send arm site (L2295-2310) passes `dormantSend: wasDormant` (L2309) AND records it in the arm log (L2317).
- [x] Non-split retry-Enter-only safety net (L2345-2373) passes `dormantSend: wasDormant` (L2362) AND records it in the arm log (L2372).
- [x] `wasDormant` computed exactly once at L2070 (top of function, before side-effects).

**Finding:** Widened watchdog wired at BOTH arm sites, not just the split-send one. A healthy ~90s wake completes before T+120_000ms so the red-bubble backstop won't false-fire.

### 4. Backend "waking" state does NOT leak to frontend

- [x] `wakingSince` non-comment count in `claude-session-server.ts`: **0** (`grep -v '^ *//' | grep -v '^ *\*' | grep -c 'wakingSince'` = 0). The 6 remaining hits are all comment lines explaining what was removed.
- [x] `msg.type === "wake"` handler: **0** matches in `claude-session-server.ts`.
- [x] `__applyWakeMessageForTests` seam: **0** matches in `claude-session-server.ts`.
- [x] `WakeResultEvent` type export: **0** matches in `src/ui/api/claude-session-api.ts`.
- [x] `case "wake_result"` handler in `PrettyView.tsx`: **0** matches.
- [x] `type: "wake"` frame emission from `PrettyView.tsx`: **0** matches.

**Wire-protocol docblock check** — the `{type:"wake"}` and `{type:"wake_result"}` bullets at claude-session-server.ts L131-132 were deleted; the docblock at L133 confirms Plan 60-03 removed them.

**Finding:** No backend surface leaks a "waking" fingerprint. The `{type:"dormant"}` frame remains for internal `setDormant()` state tracking (WIP-indicator gating, live-frame auto-dismiss), but carries no timestamp the frontend could latch onto.

### 5. Preservation guards intact

- [x] `let wakeTriggerTs: number | null = null` at L3166 in claude-session-server.ts — PRESERVED. Written by Plan 01's `setWakeTriggerTs` at L5928-5930; read by the rediscovery-seam wire-up (L7133 clears it, and `state.wakeTriggerTs()` at L2743 reads it).
- [x] `wakeTriggerTs: () => wakeTriggerTs` production wire-up count: **1** (matches plan expectation — the L6369 `__DormantStateForTests` caller was correctly deleted alongside the type-field removal, leaving only the rediscovery-seam wire-up).
- [x] `DormantEvent` type in `src/ui/api/claude-session-api.ts` L316 — PRESERVED with updated Phase-56-accurate JSDoc.
- [x] `SessionHoldingOverlay.tsx` — UNTOUCHED by Phase 60 (`git log HEAD~15..HEAD -- src/ui/features/pretty-view/SessionHoldingOverlay.tsx` returns empty).
- [x] `identity-harness-start.ts` — UNTOUCHED by Phase 60 (last touched in commit 151c94da, pre-Phase-56).
- [x] `pane-state-emitter.ts` — UNTOUCHED by Phase 60. Zero `wakingSince` or `"waking"` string occurrences in that file.
- [x] `__applyDormantPollWithRediscoveryForTests` seam at L2671 — PRESERVED with its own `state.wakeTriggerTs` getter (L2743) for the marker-freshness gate.
- [x] `__applyDormantPollTickForTests` at L1900 — PRESERVED.

**Finding:** All preservation guards intact. Recycle mechanism and birth path untouched.

### 6. Test suite integrity

Full scoped run (`npx vitest run src/backend/claude-session/dormant-poll.test.ts src/backend/claude-session/pv-send-watchdog.test.ts src/ui/features/pretty-view/PrettyView.test.tsx --reporter=verbose`):

- **Result:** 77 passed / 1 skipped / 1 todo / 3 test files / exit 0 / 47.32s duration.

Test-name enumeration:
- [x] `dormant-poll.test.ts` — SWD-1..4 present (grep count = 4). Titles: marker-fresh success; MARKER_FALLBACK_MS fallback + fallback-log assertion; two-send ordering; awake-pane no-op.
- [x] `pv-send-watchdog.test.ts` — WW-1..5 present (grep count = 5). Titles: GIVE_UP swap; awake-pane no-regression; retry-Enter + full-resend delayed; retryEnterOnly compose; constant-drift guard.
- [x] `PrettyView.test.tsx` — Phase 60 Test 1..3 present (grep count = 3). Titles: dormant frame does not mount overlay + compose enabled; user can type + send to dormant pane; NO `{type:"wake"}` ever sent.

Sample test output confirmed passing:
```
✓ PrettyView — Phase 60: invisible dormancy (no user-facing wake surface) > Phase 60 Test 1
✓ PrettyView — Phase 60: invisible dormancy (no user-facing wake surface) > Phase 60 Test 2
✓ PrettyView — Phase 60: invisible dormancy (no user-facing wake surface) > Phase 60 Test 3
```

**Finding:** All new test coverage present + passing. Scoped run green. Some `act(...)` warnings in Phase 60 Tests 2 + 3 (ComposeBox state updates not wrapped in act) — non-blocking; tests still assert correctly and pass.

### 7. Build integrity

- [x] `npm run build:backend` — exit 0. `tsc -p tsconfig.node.json` clean.
- [x] `npm run build` — exit 0. Vite build produces frontend bundle (`✓ built in 17.21s`). All chunks emit successfully.

**Finding:** Both backend and frontend build clean end-to-end. Fleet-directive requirement satisfied (frontend `tsc --noEmit` alone would miss backend TS errors; both commands run green).

### 8. Shape's "What would make it wrong" negatives — actively prevented

- [x] **Any visible surface naming dormancy/waking to the user?** `grep -v '^ *//' | grep -v '^ *\*' | grep -in "asleep\|waking\|dormant" src/ui/features/pretty-view/PrettyView.tsx src/ui/features/pretty-view/ComposeBox.tsx` — matches are internal state (`dormant`/`setDormant`/`dormantRef`/`case "dormant"` for WS frame handling) and the compose-mount gate. **No user-facing text** in JSX renders "asleep", "waking", or "wake". No badge, no tooltip, no status pill.
- [x] **A dormant pane feeling broken when sent to?** Widened watchdog (Facet 3) covers T+120_000ms >> healthy ~90s wake latency. Marker-poll ensures send-keys fires at correct time.
- [x] **A message getting lost during the wake window?** Marker-freshness gate at claude-session-server.ts L2136-2152 waits for `markerTs > triggerTs` before falling through to send-keys. Fallback path at T+90s is the last resort.
- [x] **Multiple sends landing out of order?** No parallel handlers introduced. The `__applyInputMessageForTests` seam is sequential per WS frame; multiple sends serialize on the idempotent sentinel drop + shared marker wait. Test SWD-3 exercises the two-send-in-succession case and asserts send order.
- [x] **Backend state leaking to frontend?** See Facet 4 — all six leak vectors closed (wakingSince emission, wake handler, wake_result frame, WakeResultEvent type, `{type:"wake"}` emit from frontend, `__applyWakeMessageForTests` seam).
- [x] **Any wake trigger other than send?** `grep -rn "onFocus\|onScroll\|onMouseOver\|onMouseEnter" src/ui/features/pretty-view/ 2>&1 | grep -i "wake\|dormant"` — no hits. Send remains the only new invisible trigger; Matrix DM and scheduled fire (existing invisible triggers) unchanged.

**Finding:** Every negative in the shape's "What would make it wrong" section is actively prevented in the codebase.

---

## Notable Findings

1. **Compose-mount gate correctly PRESERVES `renderedState === "dormant"` OR-term** at PrettyView.tsx L3259. Phase 60's whole point is compose stays mounted on dormant panes so the user can type + hit send + trigger invisible wake. Verified by Phase 60 Test 1 assertion (compose textarea + send button both enabled after dormant frame).

2. **`dormant` local state slot at PrettyView.tsx L282 correctly PRESERVED** (not deleted with the other four state slots — waking/wakingStartTs/elapsedSeconds/wakeError). It's actively used by dormantRef at L563 + L1102 for live-frame auto-dismiss. Retention documented in Plan 03 Task 2's KEEP condition.

3. **Wire-up symmetry** across three sentinel-drop writers all pass connection-scoped `currentTmuxSession` (T-cd6-01 trust posture) — this used to be the deleted wake handler + `__applyWakeMessageForTests` seam + new send-path. Now only the send-path remains; symmetric with any future writers.

4. **Cross-file constant-drift guard** (WW-5) reads `claude-session-server.ts` at test time and asserts `MARKER_FALLBACK_MS === MARKER_FALLBACK_MS_MIRROR`. Guards against silent drift if either constant moves in future work. Pattern documented in Plan 02 SUMMARY under patterns-established.

5. **The `{type:"dormant"}` frame REMAINS on the wire** — this is intentional. Backend still tracks dormancy internally for WIP-indicator gating, live-frame auto-dismiss, and pane-state machine. Only the wakingSince timestamp field (which used to drive the frontend progress bar) is gone. Frontend still calls `setDormant(parsed.dormant)` to keep dormantRef in sync.

6. **Test suite ran with act(...) warnings** in Phase 60 Test 2 + Test 3 — ComposeBox state updates inside the tests weren't wrapped in `act()`. Non-blocking (tests pass and assert correctly), but noted as cosmetic follow-up if a future execution wants to clean up warnings.

7. **Task 6 (cosmetic stale-comment cleanup) was SKIPPED** per plan spec. ~20+ pre-Phase-56 DormancyOverlay mentions remain in JSDoc/rationale comments across PrettyViewLoadingOverlay.tsx, PrettyViewErrorOverlay.tsx, WaitingBubble.tsx, use-auto-scroll.ts. All historical cross-refs; non-load-bearing. Explicitly deferred as non-blocking cosmetic debt per plan Task 6 spec.

## Gaps

**None.** All 8 facets pass. No blocking issues surfaced during goal-backward walk.

## Ship Readiness

**Ready for orchestrator ship-gate** (full-suite `npx vitest run` + `docker build` + `docker compose up -d --force-recreate skynet` behind deadman + HTTPS 200 + Ashley UAT: invisible wake works, red-bubble fires on real failure).

Executor's remit ends here — code + commits + tests green + shape-conformance verified. Backend + frontend builds both exit 0. Scoped test suite (dormant-poll + pv-send-watchdog + PrettyView) = 77 pass. All 12 Phase 60 commits present (60-01 x2 code + 1 doc; 60-02 x3 code + 1 doc; 60-03 x4 code + 1 doc).

---

_Verified: 2026-08-23_
_Verifier: Claude (gsd-verifier) via goal-backward walk of `.planning/shapes/shape-invisible-dormancy.md` facets 1-8_
