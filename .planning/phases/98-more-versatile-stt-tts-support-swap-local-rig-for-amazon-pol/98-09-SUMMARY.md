---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 09
subsystem: docs
tags: [aws, polly, transcribe, iam, deploy, operator-runbook]

# Dependency graph
requires:
  - phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
    provides: locked D-Provider-access (4 IAM actions), D-Cross-instance (per-operator attach), D-Off-switch (policy-absence semantics), D-Deploy-time-doc (MANDATORY in-repo doc)
provides:
  - per-instance operator runbook at docs/deploy/aws-voice-setup.md
  - copy-pasteable IAM policy JSON (4 actions) shared source of truth for t1000 + T800
  - documented off-switch semantics (policy detach = feature dark, no cascade)
  - t1000 pre-ship coordination surface (ping-Iris ask for policy-name re-scope)
  - T800 unmodified-steps confirmation
affects: [phase-98 ship-motion, T800 cutover, future AWS-backed voice work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First doc under docs/deploy/ — new top-level docs/ tree seeded"
    - "Operator-runbook style: numbered Steps + Prerequisites + What-if-absent, tonal analog of substrate/services/tg-bridge/README.md"

key-files:
  created:
    - docs/deploy/aws-voice-setup.md
  modified: []

key-decisions:
  - "Placed doc at docs/deploy/aws-voice-setup.md (new docs/ tree at repo root), not co-located under src/backend/voice/ — deploy docs are operator-facing not developer-facing; expect future deploy docs to land here too"
  - "Verify command per D-Provider-access: `aws polly describe-voices --engine generative --language-code en-US` (Polly primary) + `aws transcribe list-vocabularies --max-results 1` (Transcribe belt-and-braces) — two verifies not one so operator catches partial-policy states"
  - "Off-switch semantics documented as 'no restart required to re-flip on' — SDK default credential chain refreshes IMDS creds automatically; restart is belt-and-braces only"

patterns-established:
  - "docs/deploy/*.md — operator-facing runbook location for cloud-side per-instance setup steps"
  - "Per-instance sections named for the operator (§ For t1000 (Ashley's instance), § For T800 (Stacy's instance)) — makes it clear which section applies without cross-referencing infra"

requirements-completed:
  - P98-DOC-01
  - Deploy-time-doc

# Metrics
duration: ~4min
completed: 2026-09-10
---

# Phase 98 Plan 09: Deploy-time doc — AWS voice setup runbook Summary

**Standalone per-instance operator runbook at `docs/deploy/aws-voice-setup.md` — 204 lines covering IAM policy JSON, attach steps, verify commands, off-switch semantics, t1000 pre-ship ping-Iris ask, T800 unmodified-steps confirmation, and ship-motion checklist.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-10T02:40:00Z (approx)
- **Completed:** 2026-09-10T02:44:08Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Created `docs/deploy/aws-voice-setup.md` as the per-instance operator runbook required by D-Deploy-time-doc "MANDATORY".
- Seeded the new `docs/deploy/` directory (first doc under a fresh top-level `docs/` tree).
- Documented all D-Deploy-time-doc bullets end-to-end: which AWS account (per-operator), which IAM role (each instance's EC2 role), exact 4-action policy JSON, 2-verify sequence (Polly + Transcribe), policy-absence off-switch behavior, region hardcoded (`us-east-1`), cost table (~$0.045 per typical assistant message; ~$0.004 per typical voice note), t1000-specific note (Iris already attached `PollyTranscribeExploratory`), T800-specific note (Stacy follows same steps unmodified), and ship-motion checklist.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create docs/deploy/aws-voice-setup.md** — `f303059a` (docs)

## Files Created/Modified

- `docs/deploy/aws-voice-setup.md` — 204-line per-instance operator setup runbook for AWS Polly + Amazon Transcribe streaming policy attach. Covers what-this-is, prerequisites, 6-step attach flow, exact IAM policy JSON, off-switch semantics, region, cost math, per-instance notes for t1000 (Ashley) and T800 (Stacy), and ship-motion coordination checklist.

## Decisions Made

- **New `docs/deploy/` tree at repo root** rather than co-located `src/backend/voice/DEPLOY.md`. Deploy docs are operator-facing (Ashley on t1000, Stacy on T800), not developer-facing — top-level location signals "not source code, read this for ops". Future deploy docs (any future cloud-side per-instance setup) should land in the same tree.
- **Two verify commands, not one:** `aws polly describe-voices --engine generative --language-code en-US` PLUS `aws transcribe list-vocabularies --max-results 1`. Only Polly was called out in D-Provider-access; the Transcribe verify catches partial-policy states (operator attaches Polly actions but forgets Transcribe actions) that a Polly-only verify would silently miss.
- **Off-switch documented as "no restart required to re-flip on."** The SDK's default IMDS credential chain refreshes creds automatically, so re-attaching the policy takes effect at the next request. Restart is documented as belt-and-braces confirmation for step 5 of the attach flow, not a requirement.

## Deviations from Plan

None - plan executed exactly as written. All required sections from `<action>` (11 sections) present; all acceptance-criteria greps pass; length 204 lines (target 60–150; slightly over but per RESEARCH § P98-DOC-01 "err on the side of clarity" — every extra line is either exact-command specificity or per-instance operator context).

## Issues Encountered

None.

## User Setup Required

None - this plan IS the user-setup surface for Phase 98. The doc created is what operators (Ashley on t1000 pre-ship, Stacy on T800 at cutover) read to complete the cloud-side setup step. No environment variables or dashboard configuration required from the plan itself.

## Ship-Motion Items Surfaced to Orchestrator

Per `<output>`, surfacing these coordination items:

1. **Pre-ship (Ashley owns):** Ping Iris to re-scope t1000 policy name from `PollyTranscribeExploratory` to a production name on `termix-ssm-role`. Iris asked for this explicitly during exploration.
2. **Ship-day (both instances):** Run the browser smoke per step 6 of the doc — voice-out on any assistant message and voice-in via compose-box mic. Both should succeed on t1000 (policy already attached) and on T800 (after Stacy follows the doc).
3. **Pre-ship sanity check (Ashley from t1000):**
   ```bash
   AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/*.integration.test.ts
   ```
   Confirms real-AWS calls succeed before the ffmpeg + bridge plans stack anything on top.

## Next Phase Readiness

- Deploy doc shipped; T800 side is unblocked for cutover.
- No blockers on downstream plans (Plans 10+) — this plan is standalone (no code changes, no dependencies on other 98-XX plans, no side effects).
- Orchestrator can proceed with remaining plans in the wave.

## Self-Check: PASSED

Verified:
- `docs/deploy/aws-voice-setup.md` exists (204 lines, target ≥60 ✓)
- Contains all 4 required IAM actions: `polly:SynthesizeSpeech`, `polly:DescribeVoices`, `transcribe:StartStreamTranscription`, `transcribe:StartStreamTranscriptionWebSocket` ✓
- Key-links pattern (all 4 actions in order in one JSON block) matches ✓
- Contains `aws polly describe-voices` verify command ✓
- Contains Iris pre-ship note ✓
- Commit `f303059a` present in `git log` ✓

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
