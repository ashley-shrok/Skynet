# Distributor: runBootstrapForHost pre-sweep step + furnish.sh trim

**Created:** 2026-09-05
**Repo:** /home/ubuntu/skynet-tiffany

## Objective

Add `runBootstrapForHost` as a pre-sweep step that handles agent-supervisor systemd bootstrap (linger + unit install + enable) and settings.json patch — then remove those responsibilities from furnish.sh.

## Tasks

1. Add `substrate/user-onboarding/agent-supervisor.service` file (copy from box-maintainer role)
2. Add `agent-supervisor-service-unit` catalog entry in catalog.ts
3. Add `runBootstrapForHost` function in new file `run-bootstrap.ts`
4. Wire `runBootstrapForHost` into `runSweepForHost` before catalog loop
5. Write tests in `run-bootstrap.test.ts` + add catalog.test.ts assertion
6. Trim furnish.sh — drop steps 7 and 13c/d/e/f
7. Reorder runbook moments (register-host before auth)
8. Update bounty + DM Stacy

## Key files

- `substrate/user-onboarding/agent-supervisor.service` — NEW (copy from box-maintainer role)
- `src/backend/distributor/catalog.ts` — add entry
- `src/backend/distributor/run-bootstrap.ts` — NEW
- `src/backend/distributor/run-sweep.ts` — wire bootstrap call
- `src/backend/distributor/run-bootstrap.test.ts` — NEW
- `src/backend/distributor/catalog.test.ts` — add assertion
- `~/.claude/roles/box-maintainer/substrate/user-onboarding/furnish.sh` — trim
- `~/.claude/roles/box-maintainer/runbooks/user-onboarding.md` — reorder moments
