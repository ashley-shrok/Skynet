# Plan 23-05 Summary — Bootstrap doc + skynet-ec2 seed

**Plan:** 23-05 (Wave 4, GEFM-06)
**Status:** COMPLETE
**Executor:** Tina (box-maintainer) — Ashley approved seed write via `let's go` at checkpoint
**Date shipped:** 2026-08-05

## What was built

**Task 1 (info gathering) — direct docker inspect on skynet-ec2:**
- Volume name: `skynet_skynet-data` (compose project prefix `skynet` from `/opt/skynet/docker-compose.yml`)
- Host-side Mountpoint: `/var/lib/docker/volumes/skynet_skynet-data/_data`
- `global-files.json` absent from the volume at start (fresh write — no destructive overwrite risk)
- 8 unix fleet host names confirmed against `~/.claude/roles/box-maintainer/box-map.md`

**Task 2 (bootstrap doc) — committed at `20df4bb`:**
- `.planning/phases/23-skynet-editable-global-files-panel-header-menu-consolidation/23-BOOTSTRAP.md`
- Contents: exact volume path, SSM-only workflow (box is SSM-only, no inbound SSH),
  seed JSON blob, jq-validate step, smoke-test procedure.

**Task 3 (human checkpoint → applied) — seed written directly on skynet-ec2:**
- Path: `/var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json`
- Owner: `root:root`, mode `0644`, size 748 bytes
- Content: 8 host entries (`thenasty`, `workstation`, `ashley-beelink`,
  `ZoeyBattlestation`, `aither-cloud`, `aither-cloud2`, `aither-sftp`,
  `skynet-ec2`), each with `~/.claude/CLAUDE.md` at label `User CLAUDE.md`
- Validated with `jq '.hosts | keys | length'` → 8
- Windows hosts omitted per CONTEXT §GEFM-06 (`GIGAASHLEYPC` etc.)

## Post-conditions

- Container currently running does NOT yet have the `/global-files` endpoint
  (canonical build + recreate pending). The seed sits waiting; the moment we
  canonicalize, `GET /global-files?hostId=<n>` will read this file and the
  modal will show the configured entry for each host.
- No destructive edits made — the volume had no prior `global-files.json`.
- Seed is DLM-snapshotted automatically (crown-jewel volume, per
  `~/.claude/roles/box-maintainer/box-map.md`).

## Deviations from plan

- None. Ashley greenlit the seed at checkpoint; agent wrote via direct `sudo tee`
  (no SSM start-session needed — we're on the box).

## Follow-ups

- Post-canonicalize + recreate: Ashley smoke-tests per `23-BOOTSTRAP.md` §
  "Verifying the seed lands" (open modal → pick host → confirm CLAUDE.md
  loads). This is the last remaining Phase 23 UAT + Plan 23-04 UAT (menu
  consolidation eyeball) — both fold into one deploy round-trip.
- If additional per-host files are ever wanted, edit the JSON in place via
  the workflow in `23-BOOTSTRAP.md`.

## Requirements satisfied

- **GEFM-06** — bootstrap doc + skynet-ec2 initial population — DONE.
