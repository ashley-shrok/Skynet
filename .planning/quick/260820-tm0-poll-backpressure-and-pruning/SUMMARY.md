---
status: complete
quick_id: 260820-tm0
slug: poll-backpressure-and-pruning
---

# SUMMARY — poll-backpressure-and-pruning

Two atomic backend fixes shipped to production as patch #475.

## Commits
- `75c35892` feat(fleet-status): per-host in-flight guard on pollOneHost (quick-260820-tm0 fix 1/2)
- `35ef0e5e` feat(fleet-status): perHostState pruning on refresh + starter release actually closes ssh2 Client (quick-260820-tm0 fix 2/2)

## What changed
- **Fix 1 (in-flight guard):** `pollAllHosts` now consults an `inFlight` Set before calling `pollOneHost` for each host; if the previous iteration for that hostId hasn't returned, skip the tick (increment a per-host skip counter for observability). `finally` block clears the flag so a throw doesn't leak. Fixes the 2026-08-20 runaway where wilma's slow-responding sshd let 392 iterations stack into 392 concurrent be-child sessions.
- **Fix 2 (perHostState pruning + real release):** The periodic refresh in `pollAllHosts` now diffs `perHostState` keys against `freshHosts` and evicts hostIds no longer in the identity-host list (with paired cleanup of `inFlight`/`skipCount`). Eviction calls `deps.releaseSshChannel(...)` which was a no-op in `starter.ts` — updated to actually `client.end()` + delete the `hostClients` map entry + delete `hookInstallAttempted`. Without this, admin-disabling a host required a container restart to take effect on the poll rotation.

## Gates (all green)
- Targeted tests: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → 39 passed / 0 failed / 10.6s
- Full suite: `npx vitest run` → exit 0 (ran to completion in background)
- `npm run build:backend` → exit 0
- `npm run build` → exit 0

## Ship
- Image `a32b523620bb` (build start 02:40:04Z, freshly built — no buildx tag quirk)
- Container force-recreated, healthy in 7s, HTTPS 200 in 701ms
- Post-restart verification: workstation (host 7) in poll rotation under new code
- HEAD `35ef0e5e` pushed to `origin/feat/tab-title-from-tmux`

## Deviations from plan
None. Executor followed the plan structure exactly (2 atomic commits, tests colocated with each fix, gate task at end).

## Notable follow-ups (not in this quick's scope)
- Vitest suite runs slowly / occasionally hangs even solo — root cause investigation warranted (potentially unresolved async handles in some test)
- Docker build takes 3-6min — Dockerfile optimization pass (BuildKit + npm cache mount) would reduce to <1min
