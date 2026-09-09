---
phase: 260909-e9w
plan: 01
subsystem: fleet-distributor + id-skill
tags: [distributor, bootstrap, skynet-parent-sibling, skynet-hostname, cloud-vm, unknown-host-fix]
requires:
  - src/backend/distributor/run-bootstrap.ts (existing Step 4 skynet-parent write)
  - substrate/skills/id/SKILL.md § "Sending files to the user"
provides:
  - Step 5 bootstrap write of ~/.claude/skynet-hostname on every managed host
  - BootstrapResult.skynetHostnameOk boolean surfaced in bootstrap summary log
  - id skill file-URL recipe reading the hostname from that file (not $(hostname))
affects:
  - Every managed box will grow a new ~/.claude/skynet-hostname file on next sweep
  - Every agent invocation of the id-skill file-share recipe now reads that file
tech-stack:
  added: []
  patterns:
    - "Content-diff idempotency (RESEARCH Pitfall 3): [ -f X ] && [ \"$(cat X)\" = \"$NEW\" ] → no-op"
    - "Atomic write: printf → $X.new → mv → $X"
    - "NEVER-THROW distributor step: outer try/catch + channel-null guard + missing-sentinel guard, all mark hadError without rejecting"
    - "Single-quote shell escape via .replace(/'/g, \"'\\\\''\") for host.name literal"
key-files:
  created: []
  modified:
    - src/backend/distributor/run-bootstrap.ts
    - src/backend/distributor/run-bootstrap.test.ts
    - substrate/skills/id/SKILL.md
decisions:
  - "Step 5 always runs (no env-var skip path) because host.name is always in scope from Skynet's DB, unlike SKYNET_PUBLIC_URL which is a process env var."
  - "Extended pre-existing (a)/(b)/(c)/(d)/(e)/(k) and sp-2/3/3b/5/10 test handler maps with the new 'skynet-hostname' → sentinel entry — necessary because Step 5 always runs and their previously-unmocked exec would otherwise return null → hadError=true. Test assertions unchanged."
metrics:
  duration_min: 6
  completed: 2026-09-09T10:27:00Z
  task_count: 2
  file_count: 3
---

# Quick Task 260909-e9w: Distributor writes ~/.claude/skynet-hostname Summary

Distributor Step 5 now writes `~/.claude/skynet-hostname` (single-line file containing Skynet's canonical `host.name`) on every sweep, and the id skill's Skynet file-URL recipe reads the hostname from that file instead of `$(hostname)` — eliminating the `unknown_host` 404 that cloud VMs (e.g. AWS boxes whose OS hostname is `ip-172-31-243-143`) hit whenever an agent tries to share a file.

## What was built

- **Step 5 in `run-bootstrap.ts`** — direct mirror of Step 4 (skynet-parent write) with two structural differences: (a) no env-var skip path — Step 5 always runs because `host.name` is always in scope from the caller; (b) target file variable name `SH` (paralleling `SP`) writing `~/.claude/skynet-hostname` with the `__SKYNET_HOSTNAME_OK__` sentinel. Content-diff idempotency guard preserved (RESEARCH Pitfall 3 — no mtime churn on the 2s sweep). NEVER-THROW contract preserved end-to-end.
- **`BootstrapResult.skynetHostnameOk: boolean`** — new field emitted in the `fleet_substrate_bootstrap_result` info log payload alongside `skynetParentOk`, so fleet-status dashboards can spot per-host failures.
- **Eight new hn-* tests (`hn-1` … `hn-8`)** appended to the existing `runBootstrapForHost` describe block, mirroring the structure of the sp-* suite: field presence, log-payload presence, happy path, channel-null, missing-sentinel, thrown-error, single-quote host.name escape (`o'brien-box` → `NEW='o'\''brien-box'`), and the content-diff no-op path (indistinguishable from happy path at the channel-mock level, as documented in an inline comment).
- **id skill recipe update** — the `## Sending files to the user` recipe swaps `HOST=$(hostname)` for `HOST=$(cat ~/.claude/skynet-hostname)` with a matching empty-string guard using the same clean user-facing error pattern the skynet-parent branch uses. Rules-bullet updated to explicitly forbid `$(hostname)`, and the "Missing …" bullet merged into a unified bullet covering both files with both exact user-facing sentences.

## Files modified

| File | Change |
|------|--------|
| `src/backend/distributor/run-bootstrap.ts` | +1 field on `BootstrapResult`, +1 local var, +58-line Step 5 block after Step 4, +1 field in returned `result`, +10-line JSDoc entry at file top |
| `src/backend/distributor/run-bootstrap.test.ts` | +hn-1..hn-8 describe block (223 lines) after step-4 block, +18-line JSDoc addendum, +1 handler entry (`"skynet-hostname": "__SKYNET_HOSTNAME_OK__"`) on 11 pre-existing tests |
| `substrate/skills/id/SKILL.md` | 4 edits inside `## Sending files to the user`: recipe code block, preceding prose paragraph, "Use the hostname" rules-bullet, unified "Missing …" bullet |

## Commits

| SHA | Message |
|-----|---------|
| `daa75fe0` | feat(distributor): step 5 write ~/.claude/skynet-hostname on every sweep |
| `4d0b0dc4` | substrate(id-skill): file-URL recipe reads hostname from ~/.claude/skynet-hostname |

## Verification

- `npx vitest run src/backend/distributor/run-bootstrap.test.ts` → **32/32 green** (21 pre-existing + 8 new hn-* + 3 hn-* variants; all sp-* still green).
- `npm run build:backend` → **exit 0, zero TS errors**.
- SKILL.md verify grep chain (plan's `<automated>` for Task 2) → all 4 checks passed:
  - `HOST=$(hostname)` no longer present
  - `cat ~/.claude/skynet-hostname` present
  - `my Skynet hostname config is missing` present (new error sentence)
  - `skynet-hostname` referenced

Section-level re-read confirms prose flows end-to-end: intro unchanged → recipe now reads both files → round-trip semantics paragraph unchanged → rules bullets coherent → "why we replaced the tailnet HTTP-server recipe" paragraph unchanged.

## Deviations from Plan

**1. [Rule 3 – Blocking test failure] Extended handler maps on 11 pre-existing tests**
- **Found during:** Task 1 first `npx vitest run` after wiring Step 5 into `run-bootstrap.ts`
- **Issue:** Because Step 5 always runs (no env-var skip path, per the plan's explicit design), every `runBootstrapForHost` call now issues a channel.exec for `skynet-hostname`. The pre-existing tests `(a)/(b)/(c)/(d)/(e)/(k)` and `sp-2/sp-3/sp-3b/sp-5/sp-10` build channel mocks via `makeChannel({...})` whose handler maps have no `"skynet-hostname"` entry. With `defaultResponse: null`, Step 5's exec returned `null` in those tests, tripping the channel-null branch and setting `hadError=true` — which broke their `expect(result.hadError).toBe(false)` assertions.
- **Plan constraint tension:** The plan says *"Do NOT modify any sp-* test bodies. The hn-* block is purely additive."* but also lists as a done criterion *"existing sp-* pass unchanged"*. Once Step 5 exists and always runs, those two are only jointly achievable if the sp-* handler maps grow the one entry that keeps Step 5 happy — the same shape the plan already prescribes for hn-* tests in the opposite direction (*"Keep the skynet-parent handler present in every hn-* test with a happy-path sentinel so Step 4 never fails and cannot muddy hadError assertions"*).
- **Fix:** Added `"skynet-hostname": "__SKYNET_HOSTNAME_OK__"` to the handler map of each of the 11 affected tests. No assertion or test-body logic changed — the fix is strictly at the handler-map level and mirrors the pattern already used by the plan for the reverse case.
- **Verification:** all 32 tests green including all 11 patched pre-existing tests.
- **Files modified:** `src/backend/distributor/run-bootstrap.test.ts`
- **Commit:** `daa75fe0` (bundled into the Task 1 commit since it's part of the same atomic backend + tests unit the plan prescribes)

## Auth Gates

None — task was entirely local (edit + test + commit). No network, no auth surface.

## Threat Flags

None. The threat model's five entries (T-e9w-01 through T-e9w-SC) are all addressed by design as planned:
- T-e9w-01 (shell injection via host.name): mitigated by `.replace(/'/g, "'\\''")` — asserted by `hn-7`.
- T-e9w-02 (mtime churn DoS): mitigated by content-diff idempotency guard.
- T-e9w-03 (Step 5 blocking sweep): NEVER-THROW contract preserved — asserted by `hn-4/hn-5/hn-6`.
- T-e9w-04 (info disclosure via error strings): static sentences, no host/user/path leakage.
- T-e9w-05 (hostname mismatch with resolveHostByName): this bounty IS the fix.
- T-e9w-SC (supply chain): no new package installs.

No new surface introduced beyond what the threat model already covers.

## Known Stubs

None.

## Self-Check: PASSED

Files:
- FOUND: `src/backend/distributor/run-bootstrap.ts` (modified, contains `__SKYNET_HOSTNAME_OK__` sentinel)
- FOUND: `src/backend/distributor/run-bootstrap.test.ts` (modified, contains `step 5: skynet-hostname write` describe block)
- FOUND: `substrate/skills/id/SKILL.md` (modified, contains `cat ~/.claude/skynet-hostname` and `my Skynet hostname config is missing`)

Commits:
- FOUND: `daa75fe0` on `feat/tab-title-from-tmux` (`git log --oneline -3`)
- FOUND: `4d0b0dc4` on `feat/tab-title-from-tmux` (`git log --oneline -3`)

Both commits authored on branch `feat/tab-title-from-tmux` as required. No worktree used. No push/build/deploy performed (executor scope).
