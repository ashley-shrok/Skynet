---
phase: 04-pretty-view-visual-reskin-glass-depth-aesthetic
plan: 03
subsystem: pretty-view visual reskin — build verification + UAT prep + AGENTS.md doc draft
tags:
  - pretty-view
  - visual
  - reskin
  - phase-4
  - verification
  - uat
  - documentation
requires:
  - phase-4-glass-reskin-complete
provides:
  - phase-4-uat-checklist
  - phase-4-agents-md-draft
  - phase-4-code-side-ready-for-deploy
affects: []
tech-stack:
  added: []
patterns:
  - "Verification-only wave (zero source diffs) — build clean confirmed, tokens survived Vite tree-shake, Terminal.tsx untouched sanity check preserved"
key-files:
  created:
    - .planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-UAT-CHECKLIST.md
    - .planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-AGENTS-MD-ENTRY.md
  modified: []
decisions:
  - "Deploy scenario is B (standalone) — bounty dir /home/ubuntu/.claude/identities/tina/bounties/pending-patch-batch-post-60/ does not exist, meaning Phase 3 patches #61-#68 have all been deployed and pinned; Phase 4 ships as its own deploy behind the mandatory 15-min deadman"
  - "Phase 4 becomes patch #69 in AGENTS.md — verified via grep against the current file (#68 is the highest existing entry)"
  - "No production commits from Plan 04-03 — the phase's atomic feat(pretty-view) work landed in commits 06b1f08 (Wave 1) + e04396a (Wave 2); Plan 04-03 is verification + doc-prep only; the AGENTS.md doc entry is deferred to deploy PIN time per the fork's standing rule (tina.md: AGENTS.md write-up at PIN, not deferred)"
metrics:
  duration: ~6min
  completed: 2026-07-18
---

# Phase 4 Plan 3: Build Verification + UAT Prep + AGENTS.md Doc Draft Summary

**One-liner:** Phase 4 code-side ready for deploy — `npm run build` clean, all Phase 4 tokens survived Vite + Tailwind v4 tree-shaking, Terminal.tsx / backend / docker / nginx / dependencies all untouched, and two new artifact files (`04-UAT-CHECKLIST.md` + `04-AGENTS-MD-ENTRY.md`) prepared for Ashley's separate deploy green-light.

## Task 1 — Build Verification

**`npm run build` result**: `✓ built in 9.13s` — zero TypeScript errors, zero unresolved-token warnings. Pre-existing bundle-size warnings for `file-preview-vendor` (1,263 kB) + `codemirror` (1,608 kB) unchanged (unrelated to Phase 4).

**`npx tsc --noEmit` result**: clean — no errors from `src/ui/features/pretty-view/`, `src/ui/features/terminal/IdentityBadge.tsx`, or `src/ui/index.css`.

**Vite + Tailwind v4 tree-shake — Phase 4 tokens survived**:
- `--pv-id-hue` → present in `dist/assets/index-CCE1a_3_.css` + `dist/assets/Terminal-CZuTs-wn.js`
- `--color-pv-base` → present in `dist/assets/index-CCE1a_3_.css` + `dist/assets/Terminal-CZuTs-wn.js`
- `pv-identity-breathe` (the breathing keyframes name) → present in `dist/assets/index-CCE1a_3_.css` + `dist/assets/Terminal-CZuTs-wn.js`

All three tokens made it through the pipeline. The `Terminal-CZuTs-wn.js` chunk carries them because Vite bundles IdentityBadge together with Terminal-related code — expected and fine.

**Terminal.tsx UNTOUCHED**: `git diff --stat src/ui/features/terminal/Terminal.tsx` returns empty. The plan's hardest constraint held.

**Backend / nginx / docker / dependencies UNTOUCHED**: `git diff --stat src/backend/ docker/ package.json package-lock.json` returns empty. CSS-only frontend reskin, as designed.

**Whole-repo diff**: matches the 12 files enumerated across Plans 04-01 + 04-02 (verified in the Wave 2 SUMMARY).

**Docker build**: skipped (no sudo used in this wave). `npm run build` verification is authoritative — the docker build is exactly `npm run build` inside a container, so a clean local build guarantees a clean container build.

## Task 2 — Nyquist UAT Checklist

**Created**: `.planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-UAT-CHECKLIST.md`

**Coverage**: all 10 VISUAL-01 through VISUAL-10 requirements represented as walk-through sections with concrete in-app actions + expected outcomes + failure indicators. Ashley walks the checklist post-deploy, checks boxes, signs off.

**Key structural choices in the checklist**:
- **VISUAL-10 first** as the safety canary — if terminal chrome looks different, STOP and revert. Structural: canary before content check.
- **Prerequisites section** names required setup state (identity panes with/without `colorHue`, non-identity pane, safety-canary check).
- **VISUAL-09 (behavior preservation)** enumerates ALL existing pretty-view features that must still work end-to-end: chat rendering + markdown + code, ComposeBox all 3 send paths (Enter/Reset/Go-ahead), Shift-Enter newlines, context bar semantic HARD LOCK (≥80% RED), all 3 ambient panels, WipBubble, PlanPendingBubble, SessionHoldingBanner sticky-positioning acid test (the FRAGILITY WARNING acid test explicitly called out), draft persistence, message-queue drawer coexistence, patch #60 atomic delete-on-send, jump-to-latest pill, auto-scroll ratchet, keyboard chords (Ctrl+Shift+O/;/L/[/]).
- **Sign-off section** names the pin-deploy command with the **narrow pkill pattern** per AGENTS.md (`pkill -f 'sleep 900; \[ ! -f /tmp/termix-keep-patched'`) — explicitly warns against the bare `sleep 900` match that would kill the guacd-zombie sentinel too.

**Verification**: all 10 VISUAL requirement IDs present in the file, prerequisites + failure-indicator + sign-off sections all present.

## Task 3 — AGENTS.md Entry Draft

**Created**: `.planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-AGENTS-MD-ENTRY.md`

**Current-highest patch number in AGENTS.md**: `#68` (`feat(pretty-view): backgrounded shells panel`). Phase 4 becomes **patch #69** at PIN time.

**Deploy scenario**: **Scenario B — standalone deploy**. Bounty dir `/home/ubuntu/.claude/identities/tina/bounties/pending-patch-batch-post-60/` does not exist, so Phase 3 patches (#61-#68) are already deployed and pinned. Phase 4 ships as its own deploy behind the mandatory 15-min deadman + `sudo docker compose up -d --force-recreate termix` cycle.

**Draft structure follows fork's AGENTS.md patch-entry format**:
- Numbered header with `feat(pretty-view):` prefix and multi-line title.
- Body sections: aesthetic goal, iteration dead-ends (Round 3 / Round 4 / Round 5-7 lessons), token layer, identity-hue plumbing, IdentityBadge size variant, bubble treatment, ambient panels shelf, compose surround, textarea, send button, context bar, SessionHoldingBanner FRAGILITY WARNING acknowledgment, fleet asks that fed into the reskin, verify-post-deploy invariants (docker exec grep checks + live smoke tests), deploy note, rebase risk (with Terminal.tsx UNTOUCHED explicit callout + graceful-degradation posture on the IdentityBadge default prop).
- 3-space indent for `NN.` header, 7-space continuation body indent — matches surrounding entries (#66/#67/#68 as templates).

**Verification checks passed**: draft contains `feat(pretty-view)`, `IdentityBadge size variant`, `VISUAL-06`/`VISUAL-07`/`VISUAL-08`, `FRAGILITY WARNING`, `Rebase risk`, `Scenario`.

**File is a DRAFT** — NOT pasted into AGENTS.md yet. Writeup at PIN time is the standard workflow per tina.md's standing rule ("AGENTS.md write-up at PIN, not deferred" — the patch entry lands in AGENTS.md the moment the deploy is pinned, not before, not after).

## Deviations from Plan

None. All three tasks executed exactly as written.

## Self-Check: PASSED

- `04-UAT-CHECKLIST.md` — FOUND (all 10 VISUAL requirements present + sign-off section + narrow pkill pattern).
- `04-AGENTS-MD-ENTRY.md` — FOUND (all required markers present: feat prefix, IdentityBadge size variant, VISUAL HARD LOCKS, FRAGILITY WARNING, rebase risk, deploy scenario).
- `npm run build` — SUCCEEDED (`✓ built in 9.13s`).
- Terminal.tsx / backend / docker / dependencies — UNTOUCHED (git diff --stat empty for all four).
- Phase 4 tokens (`--pv-id-hue`, `--color-pv-base`, `pv-identity-breathe`) — all three present in Vite output bundles.

## Phase 4 Status — Ready for Deploy

Phase 4 is **code-side complete**. All three plan waves have shipped:
- Wave 1 (`06b1f08`): foundation tokens + IdentityBadge size variant + PrettyView hue plumbing.
- Wave 2 (`e04396a`): per-component Glass reskin across all 9 pretty-view components.
- Wave 3 (this SUMMARY): build verification + UAT prep + AGENTS.md doc draft.

**Between now and deploy-ready**:
1. Ashley reviews `04-UAT-CHECKLIST.md` and gives explicit per-deploy green light (blanket pre-authorization ≠ per-deploy green light per tina.md rule).
2. Arm the mandatory 15-min deadman (`nohup sudo -b bash -c 'sleep 900; [ ! -f /tmp/termix-keep-patched ] && bash /opt/termix/.tmp-revert.sh' > /tmp/termix-revert-bg.log 2>&1`).
3. Run `sudo bash /opt/termix/termix-patches/build-termix.sh` to build `termix-patched:local` on the EC2 from the current branch state.
4. `cd /opt/termix && sudo docker compose up -d --force-recreate termix`.
5. Ashley walks `04-UAT-CHECKLIST.md` to verify visual-01 through visual-10 all pass on the live deploy.
6. On green: pin via the **narrow pkill pattern** (`sudo touch /tmp/termix-keep-patched && sudo pkill -f 'sleep 900; \[ ! -f /tmp/termix-keep-patched'`).
7. Immediately at pin: paste `04-AGENTS-MD-ENTRY.md` into `/home/ubuntu/AGENTS.md` as patch #69 (or whatever the current-highest+1 is at pin time; verify via `grep -E '^   [0-9]+\.' AGENTS.md | tail -3`).

If any UAT step fails: the 15-min deadman auto-reverts, or Ashley can trigger immediate revert via `sudo bash /opt/termix/.tmp-revert.sh`.
