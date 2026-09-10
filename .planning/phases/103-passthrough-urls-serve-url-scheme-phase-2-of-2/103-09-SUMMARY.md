---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 09
subsystem: docs
tags: [id-skill, documentation, active-vs-passive-framing, fleet-substrate, serve-url, file-url]

# Dependency graph
requires:
  - phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
    provides: original 'Sending files to the user' section (file URL sub-section retained verbatim)
  - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2 (earlier plans)
    provides: serve URL infrastructure (Caddy wildcard, subdomain dispatch, tunnel cache, cookie widen) — this plan closes the loop by teaching agents to construct serve URLs
provides:
  - id-skill guidance that teaches agents BOTH URL schemes with a D-26 active-vs-passive decision rule
  - serve URL bash construction recipe (~/.claude/skynet-parent + ~/.claude/skynet-hostname derivation)
  - expanded rationale ('why we replaced tailnet HTTP-server') covering both URL schemes
affects:
  - every managed box on the fleet — distributor sweeps SKILL.md on next Skynet rebuild+deploy; agents pick up on next /id <name> load
  - future 'Apps' concept work (agents will already be constructing serve URLs deliberately, so the Apps affordance builds on established behavior)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Active vs passive framing for URL-scheme selection (Do you need something running on the other end?)"
    - "Parallel sub-section shape: each URL flavor has grammar, concrete example, bash recipe, round-trip semantics, rules-that-matter list"
    - "No dual-path fallback: obsolete recipes deleted entirely rather than kept as escape hatches"

key-files:
  created: []
  modified:
    - "substrate/skills/id/SKILL.md (section 'Sending files to the user', L843-1047 post-rewrite)"

key-decisions:
  - "D-25 realized: id-skill rewrite lands in Phase 103, not deferred"
  - "D-26 realized: active-vs-passive framing as the FIRST thing an agent reads in the section"
  - "D-27 realized: no dual-path — old tailnet HTTP-server recipe stays deleted (was already gone since Phase 78; expanded 'why we replaced' paragraph now covers both schemes)"
  - "D-28 realized: no auto-serve heuristics documented (agents-aren't-lied-to)"

patterns-established:
  - "Rule-of-thumb sentence as decision surface: 'Do you need something running on the other end for the user to have the right experience?' — one question, two paths"
  - "Symmetric sub-section shape for URL flavors: same rhythm, same recipe shape, same rules-that-matter list — reinforces the shape file's 'symmetric mental model, one contract two shapes' philosophy"
  - "Rules-that-matter section per URL flavor calls out the fallback-avoidance rule inline (no workaround if the URL is broken → tell the user and stop; the old recipe is not a fallback)"

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-09-10
---

# Phase 103 Plan 09: id-skill 'Sending files to the user' rewrite Summary

**Rewrote the id-skill 'Sending files to the user' section to teach agents BOTH URL schemes (file + serve) with a one-question active-vs-passive decision rule — closes the Phase 103 loop by making the whole serve URL infrastructure discoverable to every agent on the fleet.**

## Performance

- **Duration:** ~12 min (Task 1 only; Task 2 human-verify checkpoint pending Ashley's tone/wording review)
- **Started:** 2026-09-10T~current
- **Completed:** 2026-09-10 (Task 1 rewrite + commit)
- **Tasks:** 1/2 complete (Task 2 = checkpoint:human-verify pending)
- **Files modified:** 1

## Accomplishments

- New `### Active vs passive — which URL to construct` sub-section establishes the D-26 decision rule (rule of thumb: *"Do you need something running on the other end for the user to have the right experience?"*) as the FIRST thing an agent reads in the section
- File URL sub-section retained with the Phase 78 bash recipe verbatim (L865-884 of the pre-rewrite section)
- New `### Serve URL — active content, live proxy` sub-section paralleling the file-URL shape:
  - Grammar: `https://<hostname>-<port>.serve.<term-parent>`
  - Concrete example: `https://t1000-3020.serve.term.gigaashley.click`
  - Bash construction recipe reading `~/.claude/skynet-parent` + `~/.claude/skynet-hostname` (same distributor-written per-box config files Phase 78 established)
  - Analog missing-config user-facing error handling
  - Round-trip semantics paragraph (passthrough only; allowlist-strip; wildcard cert = per-origin isolation for modern frontends)
  - Rules-that-matter list mirroring the file-URL section (hostname source, port validity, hostname `-\d+$` collision, missing-config surface, no-fallback rule)
- Expanded `### Why we replaced the old tailnet HTTP-server recipe (both URL schemes)` paragraph covering both URL flavors; underlying reasoning (Chrome insecure-download friction, tailnet-only reach, agent-side server lifecycle burden) preserved and slightly enriched
- Section length: 205 lines (was 92) — within the 100-250 target from acceptance criteria

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite 'Sending files to the user' section with active/passive framing + serve URL sub-section** — `f0c23b47` (docs)
2. **Task 2: Ashley reviews the rewritten section for tone + framing accuracy** — PENDING (human-verify checkpoint, `blocking-human` gate; awaits Ashley greenlight)

**Plan metadata:** (deferred until Task 2 resolves)

## Files Created/Modified

- `substrate/skills/id/SKILL.md` — section 'Sending files to the user' rewritten (L843-1047 post-rewrite; was L843-932 pre-rewrite). Distributor catalog at `src/backend/distributor/catalog.ts:101-107` already points at `/app/fleet-substrate/skills/id/SKILL.md`, and `Dockerfile:80` copies `substrate → /app/fleet-substrate` — modifying this file IS the push mechanism per Phase 103 patterns. No distributor code change needed; next Skynet rebuild+deploy triggers the sweep.

## Decisions Made

None beyond the decisions locked in `103-CONTEXT.md`:
- D-25 (id-skill rewrite lands in Phase 103, not deferred to a follow-up)
- D-26 (active-vs-passive framing with the one-sentence rule of thumb)
- D-27 (delete old tailnet HTTP-server recipe entirely — no dual-path)
- D-28 (no auto-serve heuristics documented)

All four D-decisions realized in the rewrite.

## Deviations from Plan

None — plan executed exactly as written. The `<action>` block in `103-09-PLAN.md` Task 1 provided a full inline template of the rewritten section shape; I followed it, adapted for prose flow (small polish for readability: e.g. the intro sentence lists concrete example categories on both sides of the active/passive divide, the fallback rule appears inside the rules-that-matter list rather than only the "why we replaced" paragraph, and the "no workaround" bullet explicitly says the tailnet recipe stays deleted so agents don't mentally reach for it).

## Verification

Automated verification (from Task 1 `<verify><automated>`):

```
PASS: header (## Sending files to the user)
PASS: active-vs-passive (Active vs passive sub-section)
PASS: serve URL
PASS: .serve. (serve subdomain in URL)
PASS: skynet-parent (bash recipe reads it)
PASS: skynet-hostname (bash recipe reads it)
PASS: why-replaced (Why we replaced the old tailnet HTTP-server recipe paragraph)
tailnet HTTP.server total count: 1 (within acceptance criterion ≤ 3; the single reference is the "Why we replaced..." paragraph header)
python http.server total count: 0 (acceptance criterion: 0 in Sending-files section; passes globally too)
auto-serve count: 0 (D-28 satisfied)
```

Section subheaders (in reading order):
1. `## Sending files to the user`
2. `### Active vs passive — which URL to construct`
3. `### File URL — passive bytes on disk`
4. `### Serve URL — active content, live proxy`
5. `### Why we replaced the old tailnet HTTP-server recipe (both URL schemes)`

Concrete serve URL example present: `https://t1000-3020.serve.term.gigaashley.click`.
Rule-of-thumb sentence present verbatim per D-26: *"Do you need something running on the other end for the user to have the right experience?"*.

## Issues Encountered

None during Task 1 execution.

## Pending — Task 2 human-verify checkpoint

Task 2 is a `checkpoint:human-verify` with `gate="blocking-human"` — Ashley reviews the rewritten section for tone + framing accuracy end-to-end. Verification criteria from the plan:

1. Active/passive rule is the FIRST thing an agent reads (it is — it sits directly under the section intro).
2. File URL and serve URL sub-sections feel PARALLEL (same rhythm, same recipe shape, same rules-that-matter list — they do).
3. Serve URL bash recipe produces a well-formed URL string when copy-pasted (verifiable on t1000 with e.g. a mocked listener on 3020 + `printf` output).
4. Tone matches the rest of the id-skill: warm, specific, not-lecturing (Ashley's judgment call).
5. Ashley approves or requests specific corrections.

Orchestrator will present the rewritten section content to Ashley for greenlight. On "approved" → plan closes and I update this SUMMARY with the final metadata commit. On "revise: …" → I address the corrections, re-commit, re-checkpoint.

## Self-Check: PASSED

- Task 1 commit `f0c23b47` present in git log (verified via `git log --oneline` — commit landed on `feat/tab-title-from-tmux`)
- File `substrate/skills/id/SKILL.md` modified (`git status` clean on this file post-commit; content contains all required section headers and rules-that-matter bullets)
- All automated verify criteria pass (see Verification section above)

## Next Phase Readiness

- Once Ashley greenlights Task 2, this plan closes. Phase 103's remaining work: verify all plans of Phase 103 are complete, then the deploy motion (per box-maintainer directive: full-suite ship gate → Ashley greenlight-at-push → build → force-recreate → verify → distributor sweep on next cycle → id skill lands on every managed box).
- No blockers for the deploy motion introduced by this plan (documentation-only change; no code path affected until the distributor sweep runs).

---
*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Plan: 09*
*Completed (Task 1): 2026-09-10 — Task 2 checkpoint pending Ashley greenlight*
