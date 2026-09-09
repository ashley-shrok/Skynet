# Plan 91-07 — Human UAT (deferred until arc-close deploy)

**Status:** deferred (`autonomous: false`, code-complete-not-deployed)
**Files modified:** none — pure human-verify checkpoint

## What this plan is

Three human-verify checkpoints Ashley runs against the deployed instance:
1. Mobile UAT (iPhone PWA)
2. Desktop UAT
3. End-to-end sidebar materialization + pane-open

## Why it's deferred

Ashley's arc-wide ship-hold: Slice C stays code-complete-not-deployed until sub-slice E + `/close relay-mediated-group-conversations` (master shape) also complete. No deployed environment exists for Ashley to UAT against until the arc ships together.

## When to run this UAT

After the arc-close ship motion completes (push → docker build → docker compose up --force-recreate → HTTPS 200 verify). At that point Ashley drives the three checkpoints in Plan 07's task blocks against the live instance.

If any Blocking issue surfaces, a gap-closure plan gets spawned via `/gsd:plan-phase --gaps 91`. Non-blocking cosmetic notes get captured here for a possible V2 revision.

## Preservation note

This plan file (`91-07-PLAN.md`) stays intact — Ashley reads it during the UAT session to know what to check. This SUMMARY documents the deferral status.

## Followup

Once arc ships and Ashley UATs, replace this file with the actual UAT record: which checkpoints passed, any Blocking findings, any V2 notes.
