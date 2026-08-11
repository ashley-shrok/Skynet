---
phase: quick-260811-8we
plan: 01
subsystem: pretty-view/tts
tags:
  - pretty-view
  - tts
  - autoplay
  - long-press
bounty: prettyview-auto-play-new-assistant-messages
completed: 2026-08-11
---

# Quick 260811-8we: PrettyView Auto-Play New Assistant Messages

## One-Liner

Pane-scoped autoplay armed via long-press on the speak button: ChatMessage gains `startSpeak` extraction + pointer-event long-press detection + `autoplayTargetEventId`-driven autoplay effect + hue-cream tint; PrettyView gains `autoplayArmed`/`autoplayTargetEventId` state + stale-closure-safe ref mirror + WS dispatch gate + fresh-pane reset + prop threading to single ChatMessage render site.

## Files Modified

| File | Lines Changed | Notable Insertions |
|------|---------------|--------------------|
| `src/ui/features/pretty-view/ChatMessage.tsx` | +85 / -25 | Props widened (L50-70); `startSpeak()` extracted (L83-143); long-press refs + handlers on speak button (L73-78, L267-330); autoplay effect + `autoplayLastFiredRef` (L182-196); armed-tint via conditional inline `background`/`borderColor` style (L335-344) |
| `src/ui/features/pretty-view/ChatMessage.autoplay.test.tsx` | +348 (new) | LP1-LP5 (long-press detection), AP1-AP3 (autoplay effect), TINT1-TINT2 (armed tint), REG1-REG3 (regression) |
| `src/ui/features/pretty-view/PrettyView.tsx` | +65 / 0 | State slots (L406-408); `handleLongPressSpeak` callback (L448-462); autoplayArmedRef mirror effect (L1574-1580); fresh-pane reset (L1037-1044); dispatch-side target-set in `case "message"` (L1148-1157); prop threading at ChatMessage render site (L2181-2184) |
| `src/ui/features/pretty-view/PrettyView.autoplay.test.tsx` | +289 (new) | D1-D7 (dispatch matrix), D8-D9 (arm/disarm toggle), D10 (paneKey reset) |

## Test Counts

| Metric | Count |
|--------|-------|
| Baseline (STATE.md) | 1847 pass / 7 skip / 1 todo / 0 fail |
| New tests added | +23 (LP1-5, AP1-3, TINT1-2, REG1-3, D1-10) |
| Post-plan total | 1870 pass / 7 skip / 1 todo / 0 fail |
| Exit code | 0 |

## Commits

| Commit | Task | Description |
|--------|------|-------------|
| `df239c7` | Task 1 | `feat(quick-260811-8we-1)`: ChatMessage long-press + startSpeak extract + autoplay effect + tint + tests |
| `c6ce500` | Task 2 | `feat(quick-260811-8we-2)`: PrettyView autoplay state + dispatch wiring + reset + prop threading + tests |

Branch: `feat/tab-title-from-tmux` (main `~/skynet` tree; no worktrees per fleet rule 2026-07-31).

## Deviations from Plan

None — plan executed exactly as written.

Key choices consistent with plan:
- Used `act(() => { vi.advanceTimersByTime(500); await vi.runAllTimersAsync(); })` for fake-timer tests instead of `waitFor()` to avoid timeout (JSDOM waitFor polling is also faked). Plan said "deterministic" — this achieves that.
- TINT assertions use `getAttribute("style")` with regex/substring check rather than `toHaveStyle()` (not available in this vitest setup without jest-dom). Plan said "assert on className match OR computed style" — substring check on the style attribute satisfies the spirit.
- TINT1 check uses `toContain("--pv-id-hue")` because JSDOM preserves CSS `var()` references verbatim; TINT2 uses a regex `rgba(0,\s*0,\s*0,\s*0\.28)` because JSDOM normalizes rgba spacing.
- PrettyView dispatch tests (D2-D6) use the pattern of checking the target is NOT the filtered-out frame's eventId, rather than asserting exact null state, because the armed long-press itself sets the target to the armed bubble's eventId; only the subsequent filtered frames must not update it further.

## Known Stubs

None — all autoplay props are wired end-to-end: PrettyView state → ChatMessage props → startSpeak() invocation.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The autoplay feature reuses the existing `postSpeakStream` TTS path (threat surface unchanged from patch #237) and the existing WS `message` frame type. Risk posture per threat register in PLAN.md: T-QUICK-8we-01 to T-QUICK-8we-SC all accepted or mitigated as specified.

## NOT Pushed / NOT Built / NOT Deployed

Per box-maintainer fleet rule (Ashley 2026-08-08): sub-agents do not deploy. No `git push`, no `docker build`, no `docker compose`, no coord-room posts, no `skynet-patches.md` entries.

## Self-Check

- [x] `src/ui/features/pretty-view/ChatMessage.tsx` — modified (props + startSpeak + long-press + autoplay effect + tint)
- [x] `src/ui/features/pretty-view/ChatMessage.autoplay.test.tsx` — created (13 tests)
- [x] `src/ui/features/pretty-view/PrettyView.tsx` — modified (state + callback + mirror + reset + dispatch + props)
- [x] `src/ui/features/pretty-view/PrettyView.autoplay.test.tsx` — created (10 tests)
- [x] Commit `df239c7` exists: `git log --oneline | grep df239c7`
- [x] Commit `c6ce500` exists: `git log --oneline | grep c6ce500`
- [x] `npx vitest run` exits 0 with 1870 pass / 0 fail
- [x] `npm run build` exits 0 (TS clean)
- [x] `webAudioStreamPlayer.ts` unchanged (hard lock)
- [x] `package.json` / `package-lock.json` unchanged (no new deps)
- [x] `src/backend/` unchanged
- [x] `RelayInboundBubble.tsx` / `RelayOutboundBubble.tsx` unchanged
