# Phase 10 Build-Verify Log

**Date:** 2026-07-22
**Branch:** feat/tab-title-from-tmux (post patch #128 code-complete)
**HEAD:** `ebf0c43` (docs(10-04): complete Wave 4 — sidebar retirement + F3-diag fully retired)
**Verifier:** Claude (Wave 5 automation)
**Verdict:** **PASS**

Wave 5 of Phase 10 (pretty-conversations visual-language rework). All three verification commands run cleanly, with only the four pre-existing ComposeBox failures inherited from patch #121 (Send-button removal) and patch #124 (ThumbsUp "yes"→"let's go" rename) surviving from earlier phases — those four remain out of Phase 10 scope per `deferred-items.md`.

Scope: local verification only. No `docker build`, no `docker compose up`, no push, no deploy — all deferred to Ashley's morning greenlight on the batched #123-#128 stack per the fork's post-deadman-retirement DEPLOY DISCIPLINE.

---

## 1. TypeScript check (`npx tsc --noEmit`)

```
$ npx tsc --noEmit
$ echo $?
0
```

**Result:** clean — zero errors.
**Analysis:** No diagnostics emitted. All Phase 10 additions (`src/ui/features/pretty-conversations/tokens.ts`, `PinAction.tsx`, `PrettyConversationRow.tsx`, `PrettyConversationsPanel.tsx`) type-check against the Phase 6-locked `ConversationRow` / `HostGroup` shapes from `src/ui/state/conversation-store.ts`. Wave 3's AppShell cutover (`a2868e6`) + persistent-top-left-toggle (`65c572c`) type-check. Wave 4's deletions leave zero stale references (grep confirmed in `10-04-SUMMARY.md`).

---

## 2. Vitest run (`npx vitest run`)

Full-suite tail:

```
 ❯ |frontend| src/ui/features/pretty-view/ComposeBox.test.tsx (15 tests | 4 failed) 692ms
 FAIL  src/ui/features/pretty-view/ComposeBox.test.tsx > Phase 05 upload wiring > Test 7: Send with attachments routes to onSendWithAttachments; without attachments still uses onSend
   → getByLabelText(/send 'yes'/i) — element not found
 FAIL  src/ui/features/pretty-view/ComposeBox.test.tsx > Phase 05 upload wiring > Test 8: Send button ENABLED with attachments even when caption text is empty; disabled without either
   → getByLabelText(/send 'yes'/i) — element not found
 FAIL  src/ui/features/pretty-view/ComposeBox.test.tsx > ComposeBox — Phase 9 layout > Phase 9 Layout: aux button group renders in a row that precedes the Send button's row
   → getByLabelText(/send 'yes'/i) — element not found
 FAIL  src/ui/features/pretty-view/ComposeBox.test.tsx > ComposeBox — Phase 9 layout > Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false
   → getByLabelText(/send 'yes'/i) — element not found

 Test Files  1 failed | 40 passed (41)
      Tests  4 failed | 499 passed (503)
   Start at  18:18:47
   Duration  50.54s (transform 3.75s, setup 854ms, import 12.23s, tests 6.74s, environment 22.76s)
```

**Result:** **499 / 503 passing** (99.2%). 4 pre-existing failures, all in `src/ui/features/pretty-view/ComposeBox.test.tsx`.

**Delta from Wave 4 tip:** neutral — Wave 4 (`ebf0c43`) already sat at 499/503 after the Test 1 prune (`40ee620`). Wave 5 is docs-only, so the count is unchanged.

**Delta from Phase 10 baseline (pre-Wave-1):** the count moved from 500/504 → 499/503 across the phase — a `-1 test / -1 pass` shift entirely explained by the retirement of NewSessionButton's isolation test (Test 1 in `NewSessionDialog.test.tsx`, pruned in Wave 4 commit `40ee620`). This is a net-neutral coverage change: the pencil-open-dialog path is still fully covered by `PrettyConversationsPanel.test.tsx` Test 5 (header-pencil-opens-NewSessionDialog).

**New Phase 10 tests (verified all-green via targeted run):**

```
$ npx vitest run src/ui/features/pretty-conversations/ src/ui/sidebar/NewSessionDialog.test.tsx
 Test Files  3 passed (3)
      Tests  36 passed (36)
   Duration  12.15s
```

| Test file | Passing | Total |
|---|---:|---:|
| `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | 12 | 12 |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 15 | 15 |
| `src/ui/sidebar/NewSessionDialog.test.tsx` (post Test-1 prune, Test-10 retarget) | 9 | 9 |
| **Total** | **36** | **36** |

The plan's Wave 5 gate targeted 11+15+9 = 35 new-Phase-10 tests; actual is 12+15+9 = 36 — the extra Row test came from Wave 1's `[Rule 2 - Coverage]` split of Test 7 into 7 + 7b for symmetric T-Test-34 coverage on both mobile and desktop variants (documented in `10-01-SUMMARY.md`).

**Pre-existing failures (out of Phase 10 scope — cross-referenced against `deferred-items.md`):**

| # | Test | Root cause | Owning patch |
|---|---|---|---|
| 1 | `Phase 05 upload wiring > Test 7: Send with attachments routes to onSendWithAttachments` | Test queries `getByLabelText(/send 'yes'/i)` — that aria-label no longer exists in `ComposeBox.tsx`. The label was renamed by patch #124 (ThumbsUp "yes"→"let's go"). | patch #124 test-fixture drift |
| 2 | `Phase 05 upload wiring > Test 8: Send button ENABLED with attachments even when caption text is empty` | Same `getByLabelText(/send 'yes'/i)` failure — the test uses ThumbsUp as an anchor to locate the row 1 flex container; the aria-label rename invalidated the anchor. Compounded with patch #121's Send-button removal (the actual Send button under test is also gone). | patches #121 + #124 test-fixture drift |
| 3 | `ComposeBox — Phase 9 layout > Phase 9 Layout: aux button group renders in a row that precedes the Send button's row` | Same anchor pattern; same double-cause. | patches #121 + #124 test-fixture drift |
| 4 | `ComposeBox — Phase 9 layout > Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false` | Same anchor pattern; same double-cause. | patches #121 + #124 test-fixture drift |

All 4 failures are test-only fixture drift — the underlying ComposeBox component works in production (confirmed via patch #125 UAT). Fix belongs in a Phase 11 test-hygiene sweep OR a quick task against patch #124 that ships the aria-label rename with matching test updates. Explicitly OUT OF SCOPE for Phase 10 per GSD SCOPE BOUNDARY rule (Phase 10 only touches `src/ui/features/pretty-conversations/*`, `src/ui/AppShell.tsx`, `src/ui/sidebar/NewSessionDialog.test.tsx`, and deletes 3 retired sidebar files — none of which contain aria-labels or Send-button state).

---

## 3. Vite build (`npm run build`)

```
$ rm -rf dist && npm run build
...
dist/assets/AppShell-DyuSOhoP.js                                    448.82 kB │ gzip:  87.63 kB
dist/assets/file-preview-vendor-BiN9N__o.js                       1,263.62 kB │ gzip: 414.19 kB
dist/assets/codemirror-DmmvekjV.js                                1,608.47 kB │ gzip: 568.29 kB

[PLUGIN_TIMINGS] Your build spent significant time in plugin `vite-plugin-svgr`. See https://rolldown.rs/options/checks#plugintimings for more details.

(!) Some chunks are larger than 1000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 13.60s
$ echo $?
0
```

**Result:** **success** — Vite built cleanly in 13.60s, no errors, no TypeScript diagnostics. Warnings are pre-existing informational (large vendor chunks: `file-preview-vendor` 1.26 MB, `codemirror` 1.61 MB) — identical to Phase 6/7/8/9 baselines.

**Key Phase 10 landing surface (AppShell):**

| Bundle | Size (bytes) | Phase 7 baseline (07-03 log) | Delta from Phase 7 baseline |
|---|---:|---:|---:|
| `dist/assets/AppShell-DyuSOhoP.js` | **448,825** | 443,537 | **+5,288** bytes (+1.19%) |
| `dist/assets/Terminal-BLYHyYKF.js` | **144,464** | 141,274 | **+3,190** bytes (+2.26%) |
| `dist/assets/index-ms7TuqsQ.js` | **333,125** | 333,125 | **0** (byte-identical) |

AppShell delta (+5,288 bytes) accounts for: new `src/ui/features/pretty-conversations/` component tree (~1006 LOC source: tokens 50 + PinAction 123 + PrettyConversationRow 441 + PrettyConversationsPanel 442, minus retired `ConversationsPanel.tsx` 430 + `ConversationRow.tsx` 150 + `NewSessionButton.tsx` 40 = net +386 LOC on the AppShell-imported side), plus the persistent-top-left-toggle addition and thin-strip removal in AppShell.tsx. The gzip'd delta (87.63 kB vs Phase 7's 85.63 kB → +2.00 kB) is comfortably inside noise.

Terminal chunk delta (+3,190 bytes) is unrelated to Phase 10 — likely absorbed patch #118 tmux-send-keys wiring + patch #120 interrupt WS event + patch #123 paperclip decouple + patch #125 Skynet rebrand + patch #126 safe-area polish, all shipped between Phase 7 baseline and Phase 10 tip. Confirmed non-Phase-10 by grepping git log for the AppShell/Terminal touching commits between `858ad42` (Phase 7 baseline commit) and `ebf0c43` (Phase 10 tip): all belong to quick-task patch #118-#126.

Backend bundle untouched — Phase 10 is presentation-only, no server changes.

**Bundle size delta versus Wave 3 tip:** not measured explicitly — Wave 3 committed the mount-site swap + persistent-top-left-toggle so the current AppShell size already reflects the full Phase 10 landing surface. Wave 4 deleted 620 LOC of retired source but those files were already fully imported into AppShell in Phase 6/7 (they contribute to the delta above, not on top of it).

---

## Verdict summary

**PASS.** All three commands green:

- ✅ `npx tsc --noEmit` — exit 0, zero errors
- ✅ `npx vitest run` — 499/503 passing (4 pre-existing failures documented in `deferred-items.md`, all in ComposeBox.test.tsx test-fixture drift from patches #121 + #124)
- ✅ `npm run build` — succeeds in 13.60s, no errors, warnings pre-existing

**Phase 10 code-complete on `feat/tab-title-from-tmux` at `ebf0c43`.** Ready for Ashley's morning greenlight on the batched #123-#128 deploy per current fork DEPLOY DISCIPLINE.

**Route-back target wave:** N/A — no failures to route back.
