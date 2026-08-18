# Phase 45: Fix-forward on Phase 43 — Context

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Source:** UAT-locked architectural decisions from Ashley 2026-08-18 (Phase 43 = patch #465 UAT-failed)

<domain>
## Phase Boundary

Phase 43 shipped as patch #465 and UAT-failed immediately with three bugs. The container was reverted to Tiffany's #464 baseline the same session; my Phase 43 code (HEAD `58de67ac` when handoff was written, now on origin at `8325961d` under Tanya's P44) is the fix-forward baseline. Phase 45 restores the correct architecture, reships as patch #466, and closes the bounty `replace-pv-virtualization-with-windowed-pagination` + parent `pretty-view-message-list-virtualization`.

**Bugs to close (all three, or the reship fails UAT again):**

1. **Backend `tail -F -n 50` starves the observation channel.** Phase 43 plans 43-01/-02/-04 rewired the backend under an assumption — that observation and emission were two separate `tail` streams — that turned out to be wrong. There is exactly ONE tail stream; capping it at `-n 50` also caps what the observation channel sees. Symptom: my session (~hundreds of messages) rendered only 4 bubbles because 50 LINES ≠ 50 FRAMES (multi-line frames burn through the line cap fast) AND the observation channel was starved of the older lines it needed. Penelope's short session (~15 msgs) rendered correctly (fit inside the cap); window resize did NOT reveal more bubbles or reflow (the missing data was never on the client).

2. **9px inter-bubble padding lost during 43-07a plain-DOM conversion.** Pre-43-07a had `paddingBottom: 9` inline on each virtualized item wrapper (`git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` line 2402). Plan 43-07a converted the render to plain-DOM per-message bubbles and dropped the inline style. Ashley verbatim on the value: *"the margin between the message bubbles before was nine pixels, although it showed up as padding and not margin before the changes so functionally it's margin but technically it's padding but I just want to give the value just in case, so that we didn't have to try to re-derive a good looking version of that."*

3. **`TypeError: Cannot read properties of undefined (reading 'replace')` at `bi` in `AppShell-BjR3_4Qj.js:1:33664` on send.** Called by `Zi` at `AppShell-BjR3_4Qj.js:5:13582`, inside React's render pipeline. Fired when Ashley sent a UAT message from the crashing #465 UI. The current dist is the revert build (`AppShell-wLv43V6G.js`), so `#465`'s minified stack cannot be source-mapped from disk. Investigation identified 3 candidate `.replace()` sites in `src/ui/`:
   - `ComposeBox.tsx:1194` `collapseNewlinesForSend(s)` — 4 send-path call sites; if any caller passes `undefined`, boom.
   - `AppShell.tsx:1239` `t.label.replace(/ \(\d+\)$/, "")` — tab dedup filter, only fires on tab open; unlikely on send.
   - `commandTags.ts:53` `text.replace(COMMAND_BLOCK_RE, ...)` in `preprocessCommandTriplets(text)` — called during ChatMessage render; if a message frame arrives with `content === undefined`, crashes on render.
   Bug #3 needs a fresh repro AFTER bugs #1+#2 land to pin the site (fixing #1 changes what gets rendered → may reveal or hide the trigger).

</domain>

<decisions>
## Implementation Decisions

### Backend architecture (LOCKED — Ashley 2026-08-18 UAT)

**Revert Phase 43 backend rewiring entirely.** Restore backend `-n +1` full-file emission on connect. There is no `historyWindow` on the server, no `fetch_older` WS handler, no `tail -F -n <N>` parameterization, no `readSessionFileRange` / `resolveEventIdToLine` helpers. The observation channel gets the whole file again.

**Files to revert (roughly — planner enumerates precisely):**
- `src/backend/claude-session/session-file-tail.ts` — remove `initialLines` parameter (Plan 43-01), restore hardcoded `-n +1`.
- `src/backend/claude-session/session-file-parser.ts` — delete `readSessionFileRange` + `resolveEventIdToLine` helpers (Plan 43-02).
- `src/backend/claude-session/claude-session-server.ts` — delete `historyWindow` handshake consumer + `fetch_older` WS handler (Plan 43-04).
- Backend wire types in `src/shared/` — delete `fetch_older` request + `fetch_older_batch` response type + `historyWindow` connect field (Plan 43-03).

### Client architecture (LOCKED — Ashley 2026-08-18 UAT)

**Move `historyWindow` to a purely client-side cap on the `messages[]` array during initial hydration only (drop-oldest as they arrive).** The server sends everything on connect; the client keeps only the last N (proposed default: whatever Phase 43 shipped as, likely 50 — planner confirms). No `sendFetchOlder`, no `isFetchOlderBatchEvent`, no scroll-up-to-fetch-older UX affordance.

**Consequences accepted (Ashley UAT verbatim: "More bandwidth on cold load but zero observation-channel damage. This is the honest fix"):**
- Cold-load bandwidth is proportional to session length (not capped). Long sessions retransmit their whole JSONL on every fresh WS attach.
- Older-than-cap messages are LOST from client memory once dropped; there is no fetch-older mechanism to bring them back. Scrolling up in the plain-DOM scroller shows exactly what's in `messages[]` — capped to last N. Loss of scroll-back-forever is explicit trade-off, not a bug.

**Files to rewrite / delete (roughly — planner enumerates precisely):**
- `src/ui/features/pretty-view/PrettyView.tsx` — rewrite hydration path: consume the server's full-file emission, drop-oldest during hydration to enforce the client-side cap. Remove the `fetch_older` request path.
- `src/ui/api/claude-session-api.ts` — delete `sendFetchOlder` + `isFetchOlderBatchEvent` helpers (Plan 43-05).
- Tests: drop the Phase 43 windowed-pagination + fetch_older specs; add client-side hydration-cap spec.

### 9px inter-bubble padding (LOCKED — Ashley verbatim value)

Add `style={{ paddingBottom: 9 }}` to the bubble wrapper at `src/ui/features/pretty-view/PrettyView.tsx:2481` (the `<div key={m.eventId} data-pv-bubble data-event-id={m.eventId}>` in the current plain-DOM `.map`). Use exactly 9 (not 8, not 10). Use PADDING (not margin — Ashley called out the medium explicitly).

### Bug #3 `.replace()` crash

**Defer the fix decision until AFTER bugs #1+#2 land AND Ashley re-triggers a send to produce a fresh minified stack line.** The current dist can't source-map #465's stack, and it's speculative to guard all 3 candidate sites blindly (which might mask the real bug or introduce dead defensive code — see § Learned preferences in role file re: not-shipping-defensive-code-for-scenarios-that-can't-happen). Plan for Bug #3 = one plan that (a) reproduces the crash after Bug #1+#2 fixes are live (or in dev), (b) reads the fresh minified stack, (c) adds a targeted undefined-guard on the confirmed site with a source-comment linking to this phase.

### Test strategy (per fleet rule: full-suite green is precondition for done)

Every plan follows TDD-lite: add failing spec first for the behavior being changed (or restored), then land the code, then verify. Phase 45 must exit with `npx vitest run` exit 0 (matching the fleet standing directive "Never leave tests failing"). Delete Phase 43's stale specs that no longer describe reality — do not tolerate skipped or `.todo` markers.

### Claude's Discretion (planner decides)

- **Plan count + wave layout.** Estimated ~5–7 plans across ~3 waves; planner picks the exact carving.
- **Backend revert atomicity.** Whether backend revert lands as one plan or split by file/subsystem; recommendation is one plan per Phase-43-plan-being-reverted so `git log` reads sensibly on rollback investigations.
- **Cap value.** The exact client-side cap (50? 100? whatever Phase 43 shipped as) — planner reads what Phase 43 used and preserves it; changes only if a specific reason emerges during planning.
- **Test file placement.** Whether Phase 43's `PrettyView.windowed-pagination.test.tsx` gets rewritten in place or deleted-and-recreated.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 43 (the phase being fixed forward)
- `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-CONTEXT.md` — original Phase 43 context; § `<decisions>` still applies for architectural intent (windowed pagination + plain-DOM); § about `-n N` server cap is REPLACED by Phase 45's revert.
- `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-PATTERNS.md` — Phase 43 pattern map; still useful for the plain-DOM parts that survive.
- `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-04-PLAN.md` — backend handshake + fetch_older WS handler that gets deleted here.
- `.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-07b-PLAN.md` + `43-07b-SUMMARY.md` — client windowed-pagination hook that gets rewritten here.

### Pre-Phase-43 state (source-of-truth for what to restore)
- `git show 5bc24f49~1:src/ui/features/pretty-view/PrettyView.tsx` — pre-43-07a PrettyView. Line 2402 is the source-of-truth `paddingBottom: 9` value + wrapper shape.
- Backend pre-Phase-43 state: `git show 4e4da2c6~1:src/backend/claude-session/session-file-tail.ts` (before 43-01), and equivalent for `session-file-parser.ts` / `claude-session-server.ts`.

### Fleet standing directives (from role file, must be respected)
- **Never leave tests failing** — full-suite green precondition for done.
- **`git pull --rebase` before every push** — my HEAD is currently up-to-date with origin (Tanya's P44 rescue-rebase merged clean).
- **Coord room announcement protocol** — announce BEFORE + AFTER any docker build + force-recreate to the box-maintainer coord room.
- **Subagents don't do deploys** — executor's remit stops at code + commit + tests green; orchestrator (me) does the deploy motion.
- **No worktrees** — all work in main tree on `feat/tab-title-from-tmux`.
- **Frontend `tsc --noEmit` does NOT catch backend TS errors** — any plan that touches `src/backend/**` MUST run `npm run build:backend` (or full docker build), not just `npx tsc --noEmit`.
- **Logs are cheap and batched** — instrument at interaction/lifecycle/effect boundaries with structured logs (never `JSON.stringify(event)` on DOM Event objects).

</canonical_refs>

<specifics>
## Specific Ideas

- **9px paddingBottom on the bubble wrapper** — exact insertion point identified: `src/ui/features/pretty-view/PrettyView.tsx:2481` (the current plain-DOM bubble `<div>`).
- **Backend `-n +1` restore** — this is what the pre-Phase-43 code shipped for months, uncontested; not a new behavior, just a revert.
- **Client-side cap during hydration** — implementation shape: as messages arrive on the WS during initial hydration, `setMessages(prev => prev.length >= CAP ? [...prev.slice(1), next] : [...prev, next])`. Once initial hydration completes (server signals done, or after N ms of silence), the cap can either stay (bound memory) or lift (accept unbounded growth for live sessions). Planner picks — recommendation: keep the cap enforced always so long-lived sessions bound their memory the same way Phase 43 intended, minus the observation-channel damage.
- **Bug #3 investigation setup** — after bugs #1+#2 land in dev, run the dev container and reproduce the crash. Get the fresh minified stack line + un-minify via source-map-explorer (or by reading readable src for `.replace(` call sites in the render pipeline). Add one targeted guard, not blanket defensive guards.

</specifics>

<deferred>
## Deferred Ideas

- **Scroll-up-to-fetch-older UX** — the whole reason Phase 43 built `fetch_older` in the first place. Ashley's UAT decision explicitly accepts losing this rather than fixing the observation-channel damage. If she ever wants scroll-back-into-history, that's a new phase with a fundamentally different architecture (probably a separate REST endpoint that reads the JSONL directly, decoupled from the WS observation channel).
- **Cold-load bandwidth optimization** — the accepted trade-off is "more bandwidth on cold load." If long sessions become painful over cellular, a future phase can revisit (e.g., server-side windowed-only-on-initial + client fetch-older via a decoupled channel). Not urgent.
- **Bug #3 defensive audit across the whole `.replace()` surface** — after landing the one targeted guard for the confirmed crash site, do NOT sweep and guard all 25 sites — that violates the "no error handling for scenarios that can't happen" rule. Only guard what's proven to crash.
- **Documenting the "why we reverted" in `skynet-patches.md`** — the #465 entry needs a REVERTED marker + pointer to #466 as part of the ship motion, but that's ship-time bookkeeping, not planner scope.

</deferred>

<scope_fence>
## Scope Fence

**IN scope:**
- Backend revert of Plans 43-01 (initialLines param), 43-02 (readSessionFileRange + resolveEventIdToLine), 43-04 (handshake + fetch_older WS handler), 43-03 (wire types for fetch_older + historyWindow).
- Client rewrite of Plan 43-07b (windowed pagination) → client-side drop-oldest cap on messages[] during hydration.
- Client cleanup of Plan 43-05 (sendFetchOlder + isFetchOlderBatchEvent helpers) — delete them.
- 9px paddingBottom inline restore on bubble wrapper.
- Bug #3 targeted undefined-guard on the confirmed crash site (repro required).
- Test-suite: delete Phase-43-specific windowed-pagination + fetch_older specs that no longer apply; add tests for client-side hydration cap; ensure full-suite green.

**OUT of scope:**
- Any change to the virtualization retirement (Plan 43-07a plain-DOM conversion stays — that was correct).
- Any change to plans 43-06 (useAutoScroll rewrite) — that was correct and unrelated to the three bugs.
- Any change to Plan 43-08 (dependency uninstall + test file cleanup) — those are already correct.
- New features, refactors, or "while I'm in here" improvements. This is a scoped fix-forward.
- Any change to `~/.claude/roles/box-maintainer/skynet-patches.md` (that's ship-time bookkeeping).

**Rebase risk:** LOW. Fork-local files (PrettyView.tsx, claude-session-server.ts, session-file-tail.ts, session-file-parser.ts, claude-session-api.ts, shared wire types). No upstream Skynet surfaces touched. Origin already contains my Phase 43 code (Tanya rebased P44 on top of it); Phase 45's plans graft onto `8325961d` cleanly.
</scope_fence>

---

*Phase: 45-fix-forward-on-phase-43-restore-correct-architecture-for-win*
*Context authored: 2026-08-18 from Ashley's UAT-locked decisions (verbatim quotes preserved in <decisions> and <domain>)*
