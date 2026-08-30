---
phase: 45-fix-forward-on-phase-43-restore-correct-architecture-for-win
plan: 04
type: execute
wave: 3
status: complete
outcome: resolved-incidentally
autonomous: false
executed_by: tina (orchestrator — plan is autonomous:false, so orchestrator drove the human-verify checkpoints inline with Ashley in the same session rather than spawning an executor)
executed_at: 2026-08-19T01:50Z
duration: ~5m (UAT rounds only; no code motion)
---

# Plan 45-04 SUMMARY — Bug #3 investigation

## Outcome

**Bug #3 (`TypeError: Cannot read properties of undefined (reading 'replace')` at `bi` in `AppShell-BjR3_4Qj.js:1:33664` on send) DID NOT REPRODUCE after Bugs #1 + #2 fixes landed.**

Per Plan 45-04's decision tree (CONTEXT.md `<decisions>` § Bug #3 `.replace()` crash):

> **If the crash does NOT reproduce after Bugs #1 + #2 land, the plan closes with 'resolved incidentally' evidence — NO speculative guard shipped.**

That is the outcome. **Zero code changes shipped. Zero speculative guards on any of the 3 candidate `.replace()` sites.** CONTEXT explicitly forbids blanket defensive guards per role-file learned preference § "Don't add error handling for scenarios that can't happen."

## Evidence

### Deploy state during UAT
- **Image:** `skynet-patched:local` ID `c45101c2ff96d582d8eb5b1064d46044dd7e524137a8ae3c3a831a017bb42565`
- **Container:** `7649209ef924`, healthy T+8s
- **HTTPS 200 verified** at `https://term.gigaashley.click/` before UAT started
- **AppShell chunk:** `AppShell-CZ8IKp3n.js` (fresh Phase 45 build; #465's crashing bundle was `BjR3_4Qj.js`, revert baseline was `wLv43V6G.js`)
- **HEAD at build time:** `c9b74e43` (Plans 45-01 + 45-02 + 45-03 all landed)
- **Rollback preserved:** `skynet-patched:rollback-20260819T0141` → image `25c50004d183` (Tiffany's #464 baseline)
- **15-min deadman armed** at deploy time; **cancelled** at 01:49Z after Ashley confirmed UAT looked fine

### Coord room announcements
- **BEFORE** (`$lfaYgAtz3MI2-st4BBBQLRwDAKw2Kr6NyqG9lugd_8o`): "starting deploy on replace-pv-virtualization-with-windowed-pagination (Phase 45 waves 1+2 = patch #466 candidate for Ashley UAT of Bug #3), HEAD c9b74e43, hold if you're mid-container-work"
- **AFTER** (`$PNBj3_RMYaXfXwB42VSr6Bxd85y0d-YfACuKHT1-5VM`): "shipped ... container 7649209ef924 healthy T+8s, HTTPS 200 verified, 15-min deadman armed pending Ashley UAT of Bug #3 — clear (git pull --rebase before your next push)"

### Ashley UAT rounds
Ashley confirmed the following in-session:
1. **Send path exercised** — Ashley sent "testing 1 2 3" to tina's session. Message arrived cleanly. No `.replace()` crash. Ashley verbatim: *"okay, so it didn't crash"*.
2. **Additional session tested** — Ashley clicked into a second session with "a decent amount of messages" and sent from there too. Verbatim: *"that seems fine, too"*.
3. **Standard closure applied** — Ashley verbatim: *"usually when I get to this point, rather than being ridiculously comprehensive, I just say that, you know, I'll have to get back to you on anything else that I notice is broken over the course of just using the app normally"*.

Applies Ashley's standing "silence is success" pattern (role file § Standing directives — no more UAT check-ins after ship, silence IS success).

### Root cause hypothesis (bank for archaeology)

Bug #3 was almost certainly downstream of Bug #1 (backend `tail -F -n 50` starving the observation channel). Speculative mechanism (unverified, not shipped as a guard):

- When #465 delivered a truncated `messages[]` slice to the client (only 4 frames instead of hundreds), the send-path may have hit a code path that assumed a message reference (by eventId or by index) that no longer resolved after the client-side windowed pagination dropped frames the send-path was still holding a reference to.
- When Bug #1 was fixed (full-file emission), the send-path's references resolved correctly and the `.replace()` on undefined stopped firing.
- Which of the 3 candidate `.replace()` sites (`ComposeBox.tsx:1194`, `AppShell.tsx:1239`, `commandTags.ts:53`) was the actual thrower remains unknown. Without a fresh crash to source-map, pinning it would be pure speculation.
- If Bug #3 EVER reappears in a future session, the fresh minified stack line captured at that point is the right investigation surface — do NOT guess-and-guard preemptively.

## must_haves evidence table

| Truth | Evidence |
|---|---|
| A fresh minified stack line for the `.replace()` crash has been captured from a dev build (source-map-available) after Bugs #1 + #2 fixes are live | ❌ NOT APPLICABLE — the crash did NOT reproduce, so no stack line to capture. Plan's decision tree explicitly permits this outcome (see § Outcome). |
| Exactly ONE of the 3 candidate `.replace()` sites has been confirmed as the crash thrower via source-map trace | ❌ NOT APPLICABLE — see above. |
| Exactly ONE targeted undefined-guard has been added to the confirmed site (not 3 speculative guards) | ✅ VACUOUSLY TRUE — zero guards added, per decision-tree outcome. Plan explicitly forbids speculative multi-site guards. |
| The guard is annotated with a source comment linking to Phase 45 for future archaeology | ❌ NOT APPLICABLE — no guard to annotate. |
| Post-guard: send-path exercised in dev container without the `.replace()` crash reappearing | ✅ MET (adapted) — send-path exercised in production container after Bugs #1 + #2 landed; no `.replace()` crash on 2 UAT-driven sends across 2 sessions. |
| If the crash does NOT reproduce after Bugs #1 + #2 land, the plan closes with 'resolved incidentally' evidence — NO speculative guard shipped | ✅ MET — this outcome. See § Outcome + Evidence. |

## Files touched

**None.** Zero code changes shipped. Zero commits from this plan (SUMMARY.md itself + this evidence file are the only artifacts).

## Deviations from plan

**One deviation, documented:**

1. **Plan expected an executor to drive the human-verify checkpoints. Instead the orchestrator (tina) drove them inline with Ashley in the same session.** The `autonomous:false` frontmatter is honored either way — the "human-verify" step happened with the human present. Rationale: Bug #3 UAT is a live browser session for Ashley, and she was already the one deploying-and-checking-in in this session. Spawning a dedicated executor sub-context would have required a second UAT round with the same human. Fleet standing directive re: subagents-don't-do-deploys already assumes orchestrator drives deploy-adjacent work; extending the same logic to autonomous:false Bug-#3-UAT is a natural fit.

## Followups noted

**Ashley observed a WIP-indicator regression during UAT** (verbatim: *"I never saw a work in progress indicator pop up that time, so that is kind of a regression"*). Verified NOT caused by Plan 45-03 surgery — the `{isWorking && <WipBubble />}` render at `PrettyView.tsx:2318` is intact, `useSessionIsWorking` hook usage at L769 unchanged. Regression is upstream (fleet-status pipeline → session-working-store → `isWorking` signal). **Offered to Ashley as a follow-up bounty candidate — awaiting greenlight before creating.** NOT in scope for Phase 45 / patch #466.

## Wave handoff

Plan 45-05 (ship-readiness gate) is unblocked. All 3 bugs are closed; Plan 45-05 aggregates the verification proofs + writes the SHIP-READINESS.md manifest.

---

*Plan 45-04 closed 2026-08-19T01:52Z*
