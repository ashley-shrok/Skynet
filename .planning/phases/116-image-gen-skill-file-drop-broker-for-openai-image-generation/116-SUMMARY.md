---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
subsystem: infra + substrate
tags: [openai, gpt-image-1, image-gen, skill, file-drop-broker, rate-limiting, token-bucket, worker-pool, phi-directive, distributor, e2e-tests]
status: complete
completed: 2026-09-18

# Rollup of 4 plans (2 waves)
plans:
  - 116-01: Wave 1 backend leaves (types + parser + token bucket + adapter)
  - 116-02: Wave 1 caller side (SKILL.md + bash helper + 2 catalog rows)
  - 116-03: Wave 2 backend wiring (queue + worker + scan-orch + starter.ts + writeBinaryFileAtomic export)
  - 116-04: Wave 2 integration validation (bash test driver + vitest e2e wire test)

# Decision → implementing plan mapping (D-01..D-28)
# One-line status per decision: Implemented / Deferred / N/A
---

# Phase 116: image-gen-skill — file-drop broker for OpenAI image generation Summary

**Ships an on-demand-loaded image-gen skill for every managed host — one-line `image-gen "prompt"` invocation → file-drop request at `~/fleet/image-gen-requests/<uuid>.json` → Skynet backend's always-on scan-orchestrator claims via atomic mv → 5-worker pool with hand-rolled token bucket (default 30 RPM) throttles OpenAI gpt-image-1 calls under the provider's own limit → response PNGs + metadata JSON drop back to the same folder → helper polls, moves images to `~/fleet/image-gen-outputs/`, cleans wire files, prints paths on stdout — with the OpenAI credential locked to the backend env and a top-plus-inline PHI directive in the skill body as the v1 compliance control (Bedrock-provider swap deferred). Full 28-decision (D-01..D-28) implementation across 4 plans in 2 waves, 15 commits (12 feat + 3 docs — Task 3 SUMMARY commit for each plan), 8 test files with 109 tests + 1 bash test driver with 5 tests, tsc clean, all offline & hermetic.**

## Performance

- **Started:** 2026-09-18T00:42:11Z
- **Completed:** 2026-09-18T01:28:00Z
- **Wall clock (execution):** ~46 min across 4 plans
  - 116-01: ~15 min (Wave 1 backend leaves)
  - 116-02: ~4 min (Wave 1 caller side — smallest plan)
  - 116-03: ~14 min (Wave 2 backend wiring — largest plan)
  - 116-04: ~6 min (Wave 2 integration validation)
- **Waves:** 2 (Wave 1 = 116-01 + 116-02 in parallel; Wave 2 = 116-03 → 116-04 sequential — Plan 04 depends on Plan 03's runtime being wired)
- **Files created:** 18 (10 source + 8 test files, including this rollup)
- **Files modified:** 3 (identity-artifact-reader.ts, starter.ts, distributor/catalog.ts)
- **Total commits:** 15 (12 feat/test + 3 docs)

## Files Shipped

**Backend subsystem (`src/backend/image-gen-requests/` — created):**
- `types.ts` (110 LOC) — ImageGenRequestBody + PendingImageGen + SuccessResponse + 7-value FailureReason union + FailureResponse (D-06, D-08, D-09, D-27)
- `parse-request-body.ts` (200 LOC) — pure D-06-explicit-reject parser with KNOWN_KEYS set + PROMPT_MAX_LENGTH=4000 + N_MIN/N_MAX + REF_PATTERN dashed-UUID shape
- `token-bucket.ts` (100 LOC) — hand-rolled `createTokenBucket(rpm)` factory with capacity = max(1, floor(rpm×5/60)), FIFO waiter queue, .unref()'d 100ms refill (D-21)
- `adapter.ts` (310 LOC) — raw-fetch `callOpenAiImageGen(body, refImage?)` with never-throw AdapterResult, AbortController 60s timeout, 429/5xx/400/401 status mapping, secret-safe logging (D-23, D-24, D-25, D-26, D-27)
- `queue.ts` (243 LOC) — 5-worker pool with FIFO waiter list, WORKER_COUNT=5 exported constant, drain-error containment (D-20)
- `worker.ts` (370 LOC) — processImageGen 7-step flow: log → malformed shortcut → TTL-at-dequeue → token acquire → adapter → PNGs-before-JSON drop (D-22, Pitfalls 3 + 5)
- `scan-orchestrator.ts` (410 LOC) — always-on IMAGE_GEN_SCAN_CMD tick + parseImageGenRequestBatch + fetchCompanionRef (cat|base64), ZERO ssh-poll-orchestrator imports (RESEARCH.md Q2 invariant)

**Backend subsystem tests (`src/backend/image-gen-requests/` — created):**
- `types.test.ts` (110 LOC, 4 tests)
- `parse-request-body.test.ts` (245 LOC, 25 tests)
- `token-bucket.test.ts` (195 LOC, 9 tests)
- `adapter.test.ts` (280 LOC, 14 tests)
- `queue.test.ts` (240 LOC, 9 tests)
- `worker.test.ts` (285 LOC, 9 tests)
- `scan-orchestrator.test.ts` (395 LOC, 21 tests)
- `end-to-end.test.ts` (496 LOC, 9 tests) — composed queue + worker + real adapter + scan-orch + mocked fetch/SSH

**Backend integration (`src/backend/` — modified):**
- `claude-session/identity-artifact-reader.ts` (+95 LOC) — public `writeBinaryFileAtomic(conn, targetPath, bytes)` export with full LOCAL+REMOTE branches
- `starter.ts` (+170 LOC) — image-gen boot block immediately after spawn-scan block: SKYNET_IMAGE_GEN_RPM → singleton tokenBucket → setWorkerDeps → setProcessImageGen → startPool → createImageGenScanOrchestrator + SIGTERM cleanup

**Substrate distribution (created + modified):**
- `substrate/skills/image-gen/SKILL.md` (63 LOC) — H1 + one-line intro + D-17 PHI directive (top primacy, `⚠️` heading, `MUST NOT include PHI` phrasing) + Invocation section with D-18 echo (recency reinforcement) + Response shape (D-14 stdout/stderr split) + Failure handling with D-19 content_blocked one-liner + D-27 7-reason table
- `substrate/scripts/image-gen` (323 LOC, mode 755) — bash helper: arg-parse (positional prompt + flags), atomic .tmp+mv writes for request JSON + optional companion ref file, Pitfall-3 ref-before-json write order, dual-cadence poll (500ms first 30s then 2s), IMAGE_GEN_TIMEOUT_SEC env override, success branch (move PNGs, print paths on stdout, cleanup), failure branch (print JSON on stderr, cleanup), timeout branch (synthesize `{"reason":"expired"}`)
- `src/backend/distributor/catalog.ts` (+22 LOC) — 2 new BundledCatalogEntry rows: `image-gen-skill` (skill body → `~/.claude/skills/image-gen/SKILL.md`) + `image-gen-helper` (bash helper → `~/.local/bin/image-gen`)

**Test infrastructure (`substrate/scripts/tests/` — created):**
- `image-gen.test.sh` (434 LOC, mode 755) — hermetic 5-test bash driver (request-drop, ref-before-json inotify-based order proof, IMAGE_GEN_TIMEOUT_SEC timeout, planted success, planted failure)

**Documentation (`.planning/phases/116-.../` — created):**
- `116-01-SUMMARY.md`
- `116-02-SUMMARY.md`
- `116-03-SUMMARY.md`
- `116-04-SUMMARY.md`
- `116-SUMMARY.md` (this rollup)

## Decision-to-Plan Mapping (D-01..D-28)

| Decision | Description | Implemented in | Status |
|----------|-------------|----------------|--------|
| D-01 | Piggyback on fleet-status per-host sweep | 116-03 scan-orchestrator.ts | **Implemented (adjusted)** — RESEARCH.md Q2 correction: use dedicated always-on scan-orchestrator (post-2026-09-11 pattern), not literal piggyback on ssh-poll-orchestrator.ts |
| D-02 | Single atomic read-and-delete exec per tick per host | 116-03 IMAGE_GEN_SCAN_CMD | Implemented — byte-for-byte mirror of SPAWN_REQUESTS_SCAN_CMD with folder swap |
| D-03 | Missing folder is not an error | 116-03 scan-orchestrator.ts (`cd ... 2>/dev/null || exit 0`) | Implemented |
| D-04 | Response file in same folder as request | 116-03 worker.ts (`IMAGE_GEN_DIR = $HOME/fleet/image-gen-requests`) | Implemented |
| D-05 | Response file cleanup is helper's job on happy path | 116-02 image-gen helper (success + failure branches both `rm -f`) | Implemented |
| D-06 | Request shape `{prompt, size?, quality?, n?, ref?}` + explicit-reject unknown params | 116-01 parse-request-body.ts (KNOWN_KEYS set) | Implemented |
| D-07 | Reference image via companion file `<uuid>.ref.<ext>`, NOT base64 | 116-01 REF_PATTERN + 116-02 helper (`--ref` flag) + 116-03 fetchCompanionRef | Implemented |
| D-08 | Success response `<uuid>.success.json` + `<uuid>.success.<i>.png` | 116-01 SuccessResponse type + 116-03 worker.writeSuccessResponse | Implemented |
| D-09 | Failure response `<uuid>.failure.json {reason, message?}` | 116-01 FailureResponse type + 116-03 worker.writeFailureFile | Implemented |
| D-10 | Atomic .tmp → mv writes for both request and response | 116-02 helper + 116-03 writeBinaryFileAtomic + writeMarkdownFileAtomic (via identity-artifact-reader) | Implemented |
| D-11 | Response writes over SFTP on fleet-status per-host channel (or same-channel exec) | 116-03 worker.ts uses `connectOneShot` (single conn for all N+1 writes on REMOTE branch) | Implemented — dedicated per-request one-shot connection, not the fleet-status channel (see D-01 adjustment) |
| D-12 | Skill ships with helper script via fleet-substrate distributor | 116-02 substrate/scripts/image-gen + catalog row | Implemented |
| D-13 | Helper arg shape: positional prompt + flags + `--json` escape hatch | 116-02 helper arg-parse loop | Implemented |
| D-14 | Helper stdout = paths, stderr = success/failure JSON | 116-02 helper output ordering | Implemented |
| D-15 | Helper output dir `~/fleet/image-gen-outputs/<uuid>-<i>.png` (overridable via `--out`) | 116-02 helper success branch | Implemented |
| D-16 | Helper polling timeout 5 min | 116-02 helper `TIMEOUT_SEC=300` (env-overridable via IMAGE_GEN_TIMEOUT_SEC) | Implemented |
| D-17 | PHI directive with `MUST NOT` phrasing | 116-02 SKILL.md verbatim | Implemented |
| D-18 | PHI directive placement: top + invocation-section echo | 116-02 SKILL.md structure | Implemented |
| D-19 | content_blocked one-liner in failure section | 116-02 SKILL.md Failure section | Implemented |
| D-20 | Worker pool N=5 | 116-03 queue.ts `WORKER_COUNT = 5` | Implemented |
| D-21 | Token bucket env SKYNET_IMAGE_GEN_RPM (default 30), capacity = RPM × 5s | 116-01 token-bucket.ts + 116-03 starter.ts wiring | Implemented |
| D-22 | Queue TTL 5 min from requested_at → drop failure `reason:expired` | 116-03 worker.ts IMAGE_GEN_TTL_MS check | Implemented |
| D-23 | OpenAI 429 → fail immediately with `rate_limited`, no retry | 116-01 adapter.ts status mapping | Implemented |
| D-24 | OpenAI 5xx / network / timeout → fail immediately with `provider_unavailable`, no retry | 116-01 adapter.ts status mapping + AbortController | Implemented |
| D-25 | Reuse `process.env.OPENAI_API_KEY` | 116-01 adapter.ts (missing key → `not_configured`) | Implemented |
| D-26 | Model locked to `gpt-image-1`, not caller-exposed | 116-01 adapter.ts `OPENAI_MODEL` constant + KNOWN_KEYS omits `model` | Implemented |
| D-27 | Failure enum: 7 values (content_blocked, rate_limited, provider_unavailable, not_configured, malformed, expired, unknown) | 116-01 types.ts FailureReason union + 116-04 e2e test covers all 7 | Implemented |
| D-28 | Executor stops at code + commit + tests green; no push/build/deploy | All 4 plans respect this — orchestrator owns ship motion | Implemented |

**Summary:** 28/28 decisions implemented. Zero deferred, zero N/A. D-01 was implemented with an adjustment (dedicated always-on scan-orchestrator instead of literal piggyback on `ssh-poll-orchestrator.ts`) per the RESEARCH.md Q2 correction — this SUPERSEDES the CONTEXT.md wording since the always-on pattern is the post-2026-09-11 canonical shape.

## Threat Register Roll-Up

Every plan carried its own threat register; consolidated here (25 threats total, all mitigated or accepted per register):

**T-116-01-* (Plan 01, 7 threats):** All MITIGATED or ACCEPTED. Adapter never logs Authorization/OPENAI_API_KEY. AbortController(60s) prevents hung-upstream stalls. parse-request-body KNOWN_KEYS rejects `model` smuggle. PROMPT_MAX_LENGTH=4000. T-116-01-06 (uuid-in-ref == request-uuid check) PARTIAL — shape check + backend-controlled prefix prevent path traversal; embedded-uuid match deferred.

**T-116-02-* (Plan 02, 6 threats):** All MITIGATED or ACCEPTED. Helper uses jq --arg + printf %s only (zero shell interpolation of prompt). SKILL.md provider-agnostic (grep-verified: zero mentions of openai/gpt-image-1/token-bucket/avatar). Response-file cleanup deferred until AFTER caller sees stdout/stderr.

**T-116-03-* (Plan 03, 8 threats):** All MITIGATED or ACCEPTED. Scan uses parse-request-body's D-06 explicit-reject. Per-host in-flight guard (wilma pattern) prevents SSH pileup. Worker writes PNGs BEFORE JSON (Pitfall-3-response-side commit order). writeBinaryFileAtomic export delegates to existing private helper — no new SFTP behaviour.

**T-116-04-* (Plan 04, 4 threats):** All MITIGATED. Every helper invocation in bash tests prefixed with HOME=$FIXTURE. vi.stubGlobal("fetch") intercepts every OpenAI call. drainQueue() microtask-flush avoids real setTimeout waits. Fixture mktemp+trap cleanup.

## Test Coverage (final)

**Full backend subsystem test:** `npx vitest run src/backend/image-gen-requests/` → **8 files / 109 tests / all green in 2.47s**.
- types.test.ts: 4 tests
- parse-request-body.test.ts: 25 tests
- token-bucket.test.ts: 9 tests
- adapter.test.ts: 14 tests
- queue.test.ts: 9 tests
- worker.test.ts: 9 tests
- scan-orchestrator.test.ts: 21 tests
- end-to-end.test.ts: 9 tests

**Regression check:** `npx vitest run src/backend/claude-session/` → **52 files / 820 passed + 1 skipped in 28.14s**. No regression from Plan 03's writeBinaryFileAtomic export.

**Bash test driver:** `bash substrate/scripts/tests/image-gen.test.sh` → **PASS: 5 / FAIL: 0 / SKIP: 0**. Test 2 (ref-before-json order) ran (inotifywait present).

**Type check:** `npx tsc --noEmit` → **exit 0** across the entire backend.

**Total test surface added by Phase 116:** 114 automated tests (109 vitest + 5 bash).

## Deferred (per shape file — out of scope for v1)

All items from CONTEXT.md `<deferred>` remain deferred:
- Second provider path (Bedrock) for BAA-restricted deployments — v1 uses PHI directive
- Per-caller attribution / metering / rate limiting
- Post-processing on skill side (gamma, style, watermarking)
- Avatar-flow bleed-in
- Model choice exposed to caller
- Multiple simultaneous providers per host
- Long-running generation with async job-handle
- Cross-provider abstraction of parameters
- Admin surface for on-the-fly provider reconfiguration
- Response-file aging / auto-reaper on Skynet side
- Broker-pattern factoring into shared infrastructure
- Bounded token bucket burst-capacity tuning (default = RPM × 5s)
- Per-host quota inside the fleet

Additionally deferred from research:
- Assumption A3 (OpenAI /edits multipart shape) — validated only on the user's first image-to-image call after ship
- T-116-01-06 uuid-in-ref == request-uuid check — shape check + backend-controlled prefix suffice for v1

## What's Ready to Ship

After the user's ship greenlight (D-28 — orchestrator-owned, not executor):

1. Backend deploy — `docker compose up -d --force-recreate skynet` will pick up the new image-gen backend subsystem + starter.ts wiring + writeBinaryFileAtomic export. The 15-min deadman rollback timer applies per fleet rule.
2. Fleet-substrate distributor sweep — will land `substrate/skills/image-gen/SKILL.md` at `~/.claude/skills/image-gen/SKILL.md` and `substrate/scripts/image-gen` at `~/.local/bin/image-gen` on every managed host that has `runsFleetSubstrate:true`. Typically completes within minutes of container restart.
3. Optional operator config: set `SKYNET_IMAGE_GEN_RPM` env in the skynet container if OpenAI tier exceeds Tier 2 (default 30 RPM is safe for any tier past new-account).

**No user-visible failure modes on rollback:** the new skill is on-demand-loaded (harnesses only read it when an agent explicitly asks for image-gen) and the helper script requires a running backend to succeed — so a container rollback simply prevents new image-gen invocations from succeeding (they time out with `reason:expired` after 5 min) rather than breaking any existing flow.

## Phase Metrics Summary

- **Plans executed:** 4/4 (100%)
- **Tasks executed:** 12 (all `type="auto"`, no checkpoints)
- **Deviations:** 4 (all auto-fixed: 1 REF_PATTERN regex typo in plan text, 1 DOM-type import blocker, 2 tsc discriminated-union narrowing quirks)
- **Auto-fix events:** 4 (Rule 1: 1, Rule 3: 3)
- **Architectural questions raised:** 0
- **Blocked plans:** 0
- **Test failures:** 0
- **Regression failures:** 0

## Code Review Fixes

Post-ship `/build` unbiased-review pass on 2026-09-18 (after phase close) surfaced 10 MEDIUM-severity findings that were applied as follow-up commits. Each fix is atomic (or grouped per subsystem), each covered by at least one new/updated test that would have caught the original bug. `npx vitest run src/backend/image-gen-requests/` and `bash substrate/scripts/tests/image-gen.test.sh` both green (139 vitest tests, 6 bash tests). `npx tsc --noEmit` clean.

| # | Finding | File(s) | Commit |
|---|---------|---------|--------|
| 1 | UUID_RE too loose — accepted 36 hyphens / pathological 36-char basenames | `scan-orchestrator.ts` + `.test.ts` | `8185a7f7` |
| 2 | `ref` companion filename UUID not matched to request UUID (cross-request confusion) | `scan-orchestrator.ts` + `.test.ts` + `end-to-end.test.ts` | `e5850670` |
| 3+4+9 | 408/425 → provider_unavailable + parse 429 Retry-After + end-to-end 502/504 test coverage | `adapter.ts` + `adapter.test.ts` + `end-to-end.test.ts` | `1f83e05d` |
| 5 | Unbounded queue depth — added MAX_QUEUE_DEPTH=10_000 + overflow-drop failure.json | `queue.ts` + `queue.test.ts` + `worker.ts` (façade export) | `3112bfc4` |
| 6 | Unbounded companion ref size — added MAX_REF_BYTES=20MiB with `head -c` cap | `scan-orchestrator.ts` + `.test.ts` | `08ac0e7b` |
| 7 | jq-missing corrupts JSON — removed unsafe fallback, require jq at startup | `substrate/scripts/image-gen` + `image-gen.test.sh` | `bdaf7c61` |
| 8 | Token bucket displays fractional tokens — floor in getState() | `token-bucket.ts` + `.test.ts` | `ac64d586` |
| 10 | Test gap: unknown top-level key rejected via full scan → worker pipeline | `end-to-end.test.ts` | `98da1842` |

**Summary of impact:**
- **Security/hardening:** FIX 1 (strict UUID regex), FIX 2 (cross-request ref confusion), FIX 5 (OOM protection), FIX 6 (companion size DoS)
- **Correctness:** FIX 3 (408/425 status mapping), FIX 4 (Retry-After parsing), FIX 7 (jq fallback JSON corruption), FIX 8 (fractional tokens in logs)
- **Test coverage:** FIX 9 (502/504 end-to-end), FIX 10 (unknown top-level key end-to-end)

---
*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Completed: 2026-09-18*
*Code Review Fixes: 2026-09-18*
*Rollup of 116-01, 116-02, 116-03, 116-04*
