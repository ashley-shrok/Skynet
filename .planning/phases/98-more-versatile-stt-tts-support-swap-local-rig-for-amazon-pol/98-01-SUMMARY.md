---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 01
subsystem: infrastructure
tags: [docker, ffmpeg, aws-sdk, dependencies, ship-blocker-fix]
requires:
  - human-verified package legitimacy for @aws-sdk/client-polly + @aws-sdk/client-transcribe-streaming (Task 1 checkpoint, approved 2026-09-10)
provides:
  - ffmpeg binary available inside runtime docker image (Stage 5)
  - "@aws-sdk/client-polly": "^3.1129.0" as production dep
  - "@aws-sdk/client-transcribe-streaming": "^3.1129.0" as production dep
affects:
  - all Phase 98 downstream plans (04+ backend adapters) — unblocks them
  - runtime docker image size (~+30MB for ffmpeg — accepted per RESEARCH § A8)
tech-stack:
  added:
    - "@aws-sdk/client-polly@3.1129.0 (production)"
    - "@aws-sdk/client-transcribe-streaming@3.1129.0 (production)"
    - "@aws-sdk/credential-provider-node@3.972.83 (transitive)"
    - "ffmpeg (Debian bookworm apt) — runtime docker only"
  patterns: []
key-files:
  created: []
  modified:
    - docker/Dockerfile
    - package.json
    - package-lock.json
decisions:
  - "Caret pin ^3.1129.0 on both AWS SDK packages (allows patch updates within tested 3.x line per RESEARCH § Standard Stack)"
  - "Both AWS SDK packages placed in production dependencies (loaded by backend voice adapters at request time); NOT devDependencies"
  - "Did NOT install @aws-sdk/credential-provider-node explicitly — comes as transitive dep of both clients (3.972.83) so the SDK's tested combination isn't broken by direct-dep version drift"
  - "ffmpeg added ONLY to Stage 5 runtime; Stage 1/4 build stages left untouched (ffmpeg is a runtime binary, not a build tool)"
metrics:
  duration: "3 minutes"
  completed: 2026-09-10
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 3
---

# Phase 98 Plan 01: Infrastructure Prerequisites (ffmpeg + AWS SDK) Summary

Landed the two hard prereqs that unblock Phase 98 waves 2+: added `ffmpeg` to the runtime docker image (SHIP BLOCKER fix per RESEARCH § Pitfall 7 — voice-in `handleTranscribe` would fail with `ENOENT` on first upload without it) and installed `@aws-sdk/client-polly` + `@aws-sdk/client-transcribe-streaming` at `^3.1129.0` as production deps, gated behind a blocking-human package-legitimacy verification against npmjs.com.

## Tasks

### Task 1: Package legitimacy human-verify — APPROVED

Blocking-human checkpoint per RESEARCH § Package Legitimacy Audit. Both packages were marked `[ASSUMED VERIFIED]` at research time (slopcheck unavailable), so per gate policy install could not proceed without a human confirming npm-registry identity.

**Human verification result (orchestrator-recorded, 2026-09-10):**
- `@aws-sdk/client-polly` — version 3.1129.0, maintainer `aws-sdk-bot <aws-sdk-js-automation@amazon.com>` + `amzn-oss <osa-3p@amazon.com>`, repository `git+https://github.com/aws/aws-sdk-js-v3.git`. Canonical.
- `@aws-sdk/client-transcribe-streaming` — same maintainer/repository, version 3.1129.0. Canonical.
- Verified via `npm view` from t1000. No typosquat detected. Both are the AWS-authored SDK v3 packages the researcher intended.

Approval recorded, execution advanced to Task 2. No commit for this task (checkpoint gate).

### Task 2: Add ffmpeg to Dockerfile Stage 5 — COMPLETE

**Commit:** `eea5e090` — `fix(98-01): add ffmpeg to Dockerfile Stage 5 apt-get line`

Modified line 67 of `docker/Dockerfile`:

```diff
-RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget && \
+RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget ffmpeg && \
```

- ffmpeg appended to the Stage 5 apt-get install list only
- Stage 1 (line 5) and Stage 4 (line 43) builder stages unchanged (ffmpeg is a runtime binary, not a build tool)
- The `rm -rf /var/lib/apt/lists/*` cleanup tail is preserved so the image doesn't bloat with the apt cache
- One-line diff, no formatting drift (`git diff docker/Dockerfile` = 1 insertion, 1 deletion)

**Gate:** `grep -E 'apt-get install .*ffmpeg' docker/Dockerfile | grep -v '^#' | wc -l` → 1. `grep -cE 'apt-get install .* nginx .* ffmpeg' docker/Dockerfile` → 1.

### Task 3: Install @aws-sdk/client-polly + @aws-sdk/client-transcribe-streaming — COMPLETE

**Commit:** `b4e47382` — `chore(98-01): install @aws-sdk/client-polly + client-transcribe-streaming`

Ran `npm install @aws-sdk/client-polly@^3.1129.0 @aws-sdk/client-transcribe-streaming@^3.1129.0` from repo root. Both packages resolved to exact version `3.1129.0`. Additions in `package.json > dependencies`:

```json
"@aws-sdk/client-polly": "^3.1129.0",
"@aws-sdk/client-transcribe-streaming": "^3.1129.0",
```

- Placed in `dependencies` (production), not `devDependencies` — confirmed via `require.resolve()` and by grepping devDeps (both undefined there).
- `@aws-sdk/credential-provider-node` (3.972.83) landed as a transitive dep — verified in `package-lock.json` (grep count = 2 entries).
- `git diff package.json` shows only the two additions; no unrelated dependency drift.
- `package-lock.json` regenerated (`npm install` reported 31 added, 24 removed, 1117 audited — the swap is transitive SDK dep housekeeping, not our direct-dep change).

**Gate:** `node -e "require.resolve('@aws-sdk/client-polly'); require.resolve('@aws-sdk/client-transcribe-streaming');"` exits 0.

**Resolved versions:**
| Package | Resolved version | Placement |
|---|---|---|
| @aws-sdk/client-polly | 3.1129.0 | dependencies |
| @aws-sdk/client-transcribe-streaming | 3.1129.0 | dependencies |
| @aws-sdk/credential-provider-node | 3.972.83 | transitive (via both clients above) |

## Deviations from Plan

None — plan executed exactly as written. Human-verify checkpoint was approved with the exact npm-registry evidence anticipated by the plan; both Tasks 2 and 3 met their acceptance gates on first attempt.

## Authentication Gates

None encountered in this plan. (AWS credential configuration is a downstream concern for the adapter plans; nothing in Plan 01 exercises the network.)

## Ship-Motion Checklist (deferred, not this plan's gate)

Recorded here so it is not lost before phase ship:

1. `docker build -f docker/Dockerfile -t skynet:dev .` — should complete without apt-get failing on ffmpeg.
2. `docker run --rm skynet:dev ffmpeg -version` — must exit 0 and print a version banner. This is the true end-to-end proof that RESEARCH § Pitfall 7 is closed.
3. On the first Phase 98 adapter deploy, watch `handleTranscribe` for `ENOENT: ffmpeg not found` in the backend log for the first minute after `docker compose up -d --force-recreate skynet` — if it appears the Stage 5 apt edit landed but the deployed image is stale (bust the cache).

These are downstream integration checks, not this plan's automated gate (docker builds take minutes and would slow the plan-execution loop).

## Known Stubs

None. This plan touches only build-time infrastructure (apt package + npm deps). No runtime data flow was introduced.

## Self-Check: PASSED

- `[ -f docker/Dockerfile ]` → FOUND; grep for `ffmpeg` on the apt-get install line → 1 match
- `[ -f package.json ]` → FOUND; `@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming` present in `dependencies`
- `[ -f package-lock.json ]` → FOUND; `@aws-sdk/credential-provider-node` transitive entries → 2
- Commit `eea5e090` exists in `git log` (Task 2)
- Commit `b4e47382` exists in `git log` (Task 3)
- `node -e "require.resolve('@aws-sdk/client-polly'); require.resolve('@aws-sdk/client-transcribe-streaming');"` → exit 0
