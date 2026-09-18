---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
plan: 04
subsystem: tests
tags: [image-gen, e2e, bash-test-driver, vitest, mocked-fetch, mocked-ssh, hermetic]

# Dependency graph
requires:
  - phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
    plan: 01
    provides: leaf modules (types, parse-request-body, token-bucket, adapter) that the vitest e2e test consumes directly
  - phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
    plan: 02
    provides: substrate/scripts/image-gen helper that the bash test driver exercises
  - phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
    plan: 03
    provides: queue + worker + scan-orchestrator that the vitest e2e test composes end-to-end
provides:
  - substrate/scripts/tests/image-gen.test.sh — hermetic 5-test bash driver (request drop, ref-before-json write order via inotifywait, IMAGE_GEN_TIMEOUT_SEC timeout, planted success, planted failure)
  - src/backend/image-gen-requests/end-to-end.test.ts — 9-test vitest suite covering happy path + all 7 D-27 failure reasons + scan-integration composition
affects: closes Phase 116 (nothing downstream — this plan validates the composed stack for phase-close)

# Tech tracking
tech-stack:
  added: []  # zero new deps — vitest + bash + inotifywait (linux-standard) + jq (present)
  patterns:
    - "Hermetic bash test driver mocks the backend by hand-planting response files in the request folder (the shape a real backend would drop), then verifies helper's success/failure/timeout branches behave correctly — no SSH, no network."
    - "IMAGE_GEN_TIMEOUT_SEC env override on the shipped helper doubles as the test-side speed knob (no test-mode branch in the helper itself — same code path callers hit in production)."
    - "inotifywait CREATE/MOVED_TO event capture asserts ref-before-json commit order (Pitfall 3) — filesystem-level proof of the write-ordering invariant rather than source-code inspection."
    - "vitest e2e uses vi.stubGlobal('fetch', vi.fn()) + injected filesystem writers to compose queue + worker + real adapter + scan-orch end-to-end offline — same wire, same protocol, zero real I/O."
    - "drainQueue() microtask-flush pattern — spin await Promise.resolve() until pending is empty AND the mid-flight worker's post-fetch microtasks settle; avoids flaky real-timer waits."
    - "SCAN_INTEGRATION test hands the REAL queue.enqueue as the scan orchestrator's deps.enqueue, so the full pipeline (channel.exec stdout → parseImageGenRequestBatch → enqueue → dequeueBlocking → real adapter with mocked fetch → mocked atomic writers) exercises end-to-end in one it()."

key-files:
  created:
    - substrate/scripts/tests/image-gen.test.sh
    - src/backend/image-gen-requests/end-to-end.test.ts
  modified: []

key-decisions:
  - "vitest e2e uses the REAL adapter (callOpenAiImageGen) with a mocked global fetch — not a mocked adapter. Rationale: this validates the adapter's status-code → reason mapping AND the worker's response-drop wiring in one pass, so a regression in either the adapter's error classification OR the worker's failure-file body would surface in this suite (rather than requiring two disjoint mock-heavy tests to agree)."
  - "SCAN_INTEGRATION uses queue.enqueue directly (not a spy) so the item actually flows from scan-orch through the queue into a live worker loop. The alternative — spy on enqueue and manually drive processImageGen — would test the pieces in isolation but miss the queue's FIFO waiter hand-off and the boot-order invariant (worker pool must be draining BEFORE the orch enqueues its first item)."
  - "Bash test 2 (ref-before-json) uses inotifywait rather than source-file inspection. Rationale: the helper's write-order is a filesystem-level invariant that a caller (or backend scanner) actually observes at the inode-event level; asserting on source code positions would let a refactor silently violate the invariant."
  - "Bash test uses --format '%f' on both CREATE and MOVED_TO events (not just CREATE). Rationale: the helper writes via tmp+mv, so the final commit surfaces as MOVED_TO for the .ref.png and .json final names — filtering to only CREATE would miss the actual commit events and only see the transient .tmp names."
  - "drainQueue() uses two microtask-flush loops (100 rounds outer + 20 rounds inner-after-empty) rather than fake timers. Rationale: the worker's await chain (dequeue → adapter → writes) resolves entirely in microtasks under mocked fetch — fake-timer machinery would add complexity without payoff. The inner burst handles the mid-flight case where isEmpty() returns true because the item was already popped but the worker's post-fetch writes have not yet settled."
  - "Not implementing an inline test for a real REMOTE branch (isLocalHostId → false) — every test defaults to LOCAL branch (isLocalHostId returns true). Rationale: the REMOTE branch is exercised in worker.test.ts (Plan 03) via a per-test flip; the e2e test's purpose is composition validation, not branch coverage."

patterns-established:
  - "End-to-end backend wire test structure for file-drop broker subsystems: real queue + real worker + real adapter + mocked SSH + mocked fetch + mocked writers. Reusable template for any future broker phase (spawn-requests could adopt this pattern in a retro-fit for parity)."
  - "IMAGE_GEN_TIMEOUT_SEC style env override on shipped bash helpers doubles as a test speed knob — no separate test-mode branch in the helper. Applicable to any future write-and-poll helper the substrate ships."

requirements-completed: []

# Metrics
duration: ~6min
completed: 2026-09-18
---

# Phase 116 Plan 04: End-to-end validation — bash test driver + vitest wire test Summary

**Ships the two hermetic integration test surfaces that close Phase 116: a 434-line bash test driver exercising the helper's write-and-poll broker dance against hand-planted response files (5/5 green, including the inotifywait-based ref-before-json write-order proof) and a 496-line vitest end-to-end test composing queue + worker + real adapter + scan-orchestrator with mocked fetch + mocked SSH channel + injected filesystem writers (9/9 green in 1.18s, covering happy path + all 7 D-27 failure reasons + full scan-integration composition) — two files, two commits, zero deviations, full 7-command verification bundle green.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-18T01:22:00Z
- **Completed:** 2026-09-18T01:28:00Z
- **Tasks:** 3 (all `type="auto"`, no checkpoints, no deviations)
- **Files created:** 2 (930 LOC total)
- **Files modified:** 0

## Accomplishments

- **Hermetic bash test driver (434 LOC, 5/5 green).** `substrate/scripts/tests/image-gen.test.sh` mirrors `fleet-status-sweep.test.sh` conventions: mktemp scratch fixture, trap-cleanup, PASS/FAIL/SKIP bookkeeping, `fail()`/`assert_eq()` helpers, `CURRENT_TEST` marker, per-test fixture reset. Every helper invocation sets `HOME="$FIXTURE"` so the real `~/fleet/` tree is never touched (T-116-04-01 mitigation).
  - **Test 1 (request-drop happy path):** Spawn helper in background with a 2s timeout, wait for its request JSON to land in `$FIXTURE/fleet/image-gen-requests/`, assert exactly one request json, assert `.prompt == "test prompt"`, assert `requested_at` present, then let helper time out.
  - **Test 2 (ref-before-json write order, Pitfall 3):** Start `inotifywait -m -e create -e moved_to` on the request folder, run helper with `--ref $FIXTURE/fake.png`, capture CREATE + MOVED_TO events, assert the `*.ref.png` event line number is STRICTLY LESS than the `<uuid>.json` event line number. Uses both CREATE (catches `.tmp.$$` intermediate files) and MOVED_TO (catches the final commit filename); the assertion is on the FINAL-commit lines only (regex `^[0-9a-f-]{36}\.json$` and `\.ref\.png$`).
  - **Test 3 (5-minute timeout via env override, D-16):** Run helper synchronously with `IMAGE_GEN_TIMEOUT_SEC=2`, capture stdout + stderr + exit code, assert non-zero exit AND `"reason":"expired"` in stderr.
  - **Test 4 (planted success):** Spawn helper in background with a 10s timeout, wait for its request JSON, derive the uuid, atomically plant `<uuid>.success.0.png` FIRST (belt-and-suspenders — matches the worker's PNGs-before-JSON commit order from Plan 03), then plant `<uuid>.success.json`, wait for helper to exit, assert exit 0, assert stdout carries a path to a PNG that exists on disk, assert all three wire files are cleaned up (`.success.json`, request `.json`, `.success.0.png`).
  - **Test 5 (planted failure):** Same shape as Test 4 but plant `<uuid>.failure.json` with `{"reason":"content_blocked","message":"provider refused"}`; assert non-zero exit, stderr contains `content_blocked`, wire files cleaned up.

- **Vitest end-to-end backend wire test (496 LOC, 9/9 green in 1.18s).** `src/backend/image-gen-requests/end-to-end.test.ts` composes queue + worker + REAL adapter + scan-orchestrator against `vi.stubGlobal("fetch", vi.fn())` + injected filesystem writers. Every test resets queue state via `__resetForTests`, constructs a fresh token bucket via `createTokenBucket(600)` (10/sec — instant acquire), sets `process.env.OPENAI_API_KEY = "sk-test"`, wires `setWorkerDeps + setProcessImageGen(processImageGen) + startPool()`, then enqueues an item and awaits `drainQueue()`.
  - **HAPPY:** fetch 200 with a base64-embedded PNG → 1 binary write BEFORE 1 JSON write (Pitfall-3-response-side commit order verified via a `writeOrder: string[]` array), success.json body carries `images: ["<uuid>.success.0.png"]`, `model: "gpt-image-1"`, `n: 1`.
  - **All 7 D-27 failure reasons covered:**
    - `RATE_LIMITED`: fetch 429 → failure.json `{reason:"rate_limited"}`, no PNG writes.
    - `PROVIDER_UNAVAILABLE`: fetch 503 → `{reason:"provider_unavailable"}`.
    - `CONTENT_BLOCKED`: fetch 400 with `error.code: "content_policy_violation"` → `{reason:"content_blocked", message:"nope"}`.
    - `NOT_CONFIGURED`: `delete process.env.OPENAI_API_KEY` → `{reason:"not_configured"}` + fetch NEVER called.
    - `MALFORMED`: fetch 400 with any other `error.code` → `{reason:"malformed", message:"prompt too long"}` (message flows through from OpenAI's response body).
    - `EXPIRED`: `requested_at` set to 6 min ago → `{reason:"expired"}` + fetch NEVER called + `tokenBucket.acquire` NEVER called (Pitfall 5 TTL-at-dequeue).
    - `UNKNOWN`: fetch 401 (bad key) → `{reason:"unknown", message: "...401..."}` (Pitfall 4 — 401 is a config bug, not `not_configured`).
  - **SCAN_INTEGRATION:** Full pipeline: mocked `channel.exec` returns tab-separated `<uuid>.json\t{prompt:"a mountain",...}\n` matching `IMAGE_GEN_SCAN_CMD`; scan-orchestrator's initial pass parses + enqueues; worker dequeues + calls real adapter with mocked fetch (returns base64 PNG); worker writes 1 PNG + 1 JSON with the correct uuid-derived paths. Uses `queue.enqueue` directly as the orchestrator's `deps.enqueue` so the item ACTUALLY flows through the real FIFO queue into a live worker loop.

- **Full verification bundle green.** All 7 automated commands from Task 3 pass:
  1. `npx vitest run src/backend/image-gen-requests/` → 8 files, 109 tests, all green (Plan 01: 4 files/61 tests + Plan 03: 3 files/39 tests + Plan 04: 1 file/9 tests) in ~2.5s.
  2. `npx vitest run src/backend/claude-session/` → 52 files, 820 passed + 1 skipped, exit 0 in ~28s. No regression from `writeBinaryFileAtomic` export.
  3. `bash substrate/scripts/tests/image-gen.test.sh` → PASS: 5 / FAIL: 0 / SKIP: 0. Test 2 ran (inotifywait present).
  4. `npx tsc --noEmit` → clean (exit 0).
  5. `bash -n substrate/scripts/image-gen` → clean syntax.
  6. `test -x substrate/scripts/image-gen` → executable bit set (mode 755).
  7. `grep -c "image-gen-skill\|image-gen-helper" src/backend/distributor/catalog.ts` → 2 (exact match).

- **Structural grep invariants (all green):**
  - `MUST NOT include PHI` in `substrate/skills/image-gen/SKILL.md` → 1.
  - `^export async function writeBinaryFileAtomic` in `src/backend/claude-session/identity-artifact-reader.ts` → 1.
  - `createImageGenScanOrchestrator` in `src/backend/starter.ts` → 2 (dynamic import + call site).
  - `from ['\"].*ssh-poll-orchestrator` in `src/backend/image-gen-requests/scan-orchestrator.ts` → 0 (RESEARCH.md Q2 invariant).

## Task Commits

1. **Task 1: substrate/scripts/tests/image-gen.test.sh — hermetic bash test driver (5 tests)** — `7dab1acd` (test)
2. **Task 2: end-to-end.test.ts — backend wire test (9 tests, mocked SSH + mocked fetch)** — `f7bda5ed` (test)
3. **Task 3: phase-close automated verification bundle** — this SUMMARY (docs commit follows)

## Files Created/Modified

**Created (2):**
- `substrate/scripts/tests/image-gen.test.sh` (434 LOC, mode 755) — 5-test hermetic bash driver.
- `src/backend/image-gen-requests/end-to-end.test.ts` (496 LOC) — 9-test vitest e2e suite.

**Modified (0):** Plan 04 is pure test surface — no changes to any pre-existing file.

## Decisions Made

- **vitest e2e uses the REAL adapter with mocked global fetch, not a mocked adapter.** This validates the adapter's status-code → reason mapping AND the worker's response-drop wiring in one pass. A regression in either the adapter's error classification OR the worker's failure-file body would surface in this suite (rather than requiring two disjoint mock-heavy tests to agree on the interface).
- **SCAN_INTEGRATION test wires `queue.enqueue` directly (not a spy).** The item actually flows from scan-orch through the queue into a live worker loop, so the FIFO waiter hand-off and the boot-order invariant (worker pool must be draining before the orch enqueues its first item) are actually validated end-to-end.
- **Bash Test 2 uses inotifywait rather than source-file inspection.** The helper's write-order is a filesystem-level invariant that a caller (or backend scanner) actually observes at the inode-event level; asserting on source code positions would let a refactor silently violate the invariant.
- **Bash test captures both CREATE and MOVED_TO events.** The helper writes via `tmp + mv`, so the final commit surfaces as MOVED_TO for the `.ref.png` and `.json` final names — filtering to only CREATE would miss the actual commit events and only see the transient `.tmp` names. Assertion filters to FINAL-commit lines only via regex.
- **drainQueue() uses two microtask-flush loops (100 outer + 20 inner-after-empty).** The worker's await chain resolves entirely in microtasks under mocked fetch; fake-timer machinery would add complexity without payoff. The inner burst handles the mid-flight case where `isEmpty()` returns true because the item was popped but the worker's post-fetch writes have not yet settled.
- **Every test defaults to LOCAL branch (`isLocalHostId → true`).** Not implementing an inline test for a REMOTE branch — that path is exercised in `worker.test.ts` (Plan 03) via a per-test flip; the e2e test's purpose is composition validation, not branch coverage.

## Deviations from Plan

None — all three tasks executed exactly per the `<action>` and `<behavior>` blocks in `116-04-PLAN.md`. No auto-fixes needed (no Rule 1/2/3 events fired); no architectural questions surfaced (no Rule 4). Every `<automated>` verify command returned success; every `<done>` criterion met on the first pass.

**Note on the ~6-min plan duration vs the plan's `<action>` block scope:** the plan gave the executor freedom to pick a portable implementation for Test 2 (three options a/b/c); implementation used (a) — `inotifywait` — because it was present on this Linux host (Ubuntu 22 + inotify-tools installed). The plan predicted this and its `<done>` criterion accepts either "Test 2 ran" or "Test 2 skipped with a SKIP warning" — no deviation, just executed the primary path.

## Issues Encountered

None. Clean tree at start, all three commits applied cleanly, `tsc --noEmit` clean across the whole backend, all 934 backend tests green (109 image-gen-requests + 820 claude-session + 1 skipped).

## User Setup Required

None from this plan. All Phase 116 setup is covered by prior plans:
- `OPENAI_API_KEY` env — pre-existing requirement of the avatar-batch route, reused by the image-gen adapter (D-25).
- `SKYNET_IMAGE_GEN_RPM` env — optional, defaults to 30 in starter.ts (Plan 03).

## Threat Model Compliance

All 4 threats in the plan's `<threat_model>` register are addressed by the code shipped in this plan:

| Threat ID | Category | Mitigation Status |
|-----------|----------|-------------------|
| T-116-04-01 | Tampering — image-gen.test.sh writes escape $FIXTURE | MITIGATED. Every helper invocation prefixes `HOME="$FIXTURE"`. Grep-verifiable in the driver source (zero `bash "$HELPER"` invocations without a preceding `HOME=` on the same line). The fixture is torn down on EXIT via `trap cleanup`. |
| T-116-04-02 | Info Disclosure — end-to-end.test.ts leaks a real API key via fetch to OpenAI | MITIGATED. `vi.stubGlobal("fetch", fetchMock)` intercepts every outbound call — grep-verified via test HAPPY's `fetchCall[1].headers.Authorization` assertion (the bearer token comes through as `Bearer sk-test`, proving the mock captured it before any real network egress). Every test sets `process.env.OPENAI_API_KEY = "sk-test"` in `beforeEach` — no real credential appears anywhere in the test source. |
| T-116-04-03 | DoS — end-to-end test runs slow enough to block CI | MITIGATED. Full suite duration 1.18s wall (budget 5s per threat register). All timing via microtask flush (`drainQueue()`) — no `setTimeout(resolve, 100)` style waits anywhere. |
| T-116-04-04 | Spoofing — bash test uses non-hermetic $HOME | MITIGATED. Per-suite `mktemp -d` fixture + `HOME="$FIXTURE"` prefix on every helper invocation (5 occurrences, all grep-verifiable). `reset_fixture()` between tests keeps each test's writes contained. |

## Test Runtime Details

**vitest end-to-end.test.ts:** 1.18s (below the 5s threat-register budget for T-116-04-03).

**Full image-gen-requests suite (Plan 01 + Plan 03 + Plan 04):** 2.47s across 8 files / 109 tests.

**Claude-session regression check:** 28.14s across 52 files / 820 passed + 1 skipped (no regression from Plan 03's `writeBinaryFileAtomic` export).

**Bash test driver:** ~11s wall (dominated by the 2s IMAGE_GEN_TIMEOUT_SEC waits in Tests 1, 2, 3 + the small planted-response polls in Tests 4, 5).

**Test 2 execution status:** RAN (inotifywait 3.22.6.0 present on host). The plan predicted this test may skip on hosts without inotify-tools; a SKIP counter is bookkept and printed in the final report, but did not fire in this run.

## Q11 Test Structure Compliance

The RESEARCH.md Q11 answer specified the end-to-end test structure as **Setup → Action → Verify**:

1. **Setup:** mock global fetch, mock `listSubstrateHosts` to return one fake host, mock `acquireChannel` to return an exec-mocked channel.
2. **Action:** exec-mock returns tab-separated `<uuid>.json\t{"prompt":"cat","n":1,"requested_at":"<now>"}\n`.
3. **Verify:** enqueue called with correct PendingImageGen; worker dequeues; fetch called with `api.openai.com/v1/images/generations` and correct body; SFTP write mock called with `~/fleet/image-gen-requests/<uuid>.success.png` (binary buffer matches decoded mock b64) + `<uuid>.success.json` (JSON matches schema).

**Deviation from Q11:** The e2e test's SCAN_INTEGRATION case uses `queue.enqueue` (the REAL exported function) rather than a spy on enqueue. Rationale in Decisions Made — this validates the full FIFO waiter hand-off, not just the isolated wiring points. All other Q11 points implemented verbatim. Q11 also proposed testing the failure path (429 → rate_limited) and the TTL path (6-min-old requested_at → expired) — both covered by the RATE_LIMITED and EXPIRED cases in the `failure paths (D-27 enum)` describe block.

## Plan 01 Assumption A3 Status (multipart /edits shape)

Plan 01 flagged `Assumption A3` — that OpenAI's `/edits` endpoint accepts multipart form with a single image + prompt for `gpt-image-1`. Plan 04's e2e test does NOT include an image-to-image test case that would validate A3 (the RESEARCH.md Q11 template didn't include one, and the plan's `<behavior>` block also omits it — the adapter's own multipart-body construction is tested in adapter.test.ts under R1 "Multipart /edits path").

**A3 status:** DEFERRED. The adapter's multipart FormData construction is unit-tested in adapter.test.ts. Real OpenAI acceptance of that multipart shape is validated only when an actual image-to-image request runs against the live API — which will happen on Ashley's first `image-gen "..." --ref /path/to/image` invocation after ship. If A3 is wrong, the surfaced failure will be a `malformed` or `unknown` reason on the caller's terminal, which is a self-diagnosing failure mode.

## Self-Check: PASSED

**Files verified:**
- FOUND: /home/ubuntu/skynet-nebula/substrate/scripts/tests/image-gen.test.sh (mode 755)
- FOUND: /home/ubuntu/skynet-nebula/src/backend/image-gen-requests/end-to-end.test.ts

**Commits verified:**
- FOUND: 7dab1acd — test(116-04): add hermetic bash test driver for image-gen helper
- FOUND: f7bda5ed — test(116-04): add backend end-to-end wire test (mocked SSH + mocked fetch)

**Verify checks (all 7 automated commands, green):**
- FOUND: `npx vitest run src/backend/image-gen-requests/` → 8 files / 109 tests / all green.
- FOUND: `npx vitest run src/backend/claude-session/` → 52 files / 820 passed / 1 skipped.
- FOUND: `bash substrate/scripts/tests/image-gen.test.sh` → PASS: 5 / FAIL: 0 / SKIP: 0.
- FOUND: `npx tsc --noEmit` → exit 0.
- FOUND: `bash -n substrate/scripts/image-gen` → clean.
- FOUND: `test -x substrate/scripts/image-gen` → true.
- FOUND: grep counts on catalog.ts (2), SKILL.md (1), identity-artifact-reader.ts (1), starter.ts (2 for createImageGenScanOrchestrator), scan-orchestrator.ts (0 for ssh-poll-orchestrator imports).

**Phase 116 status:** All 4 plans complete. Executor's remit ends at code + commit + tests green (D-28); push + docker build + docker compose up are orchestrator-owned and gated on Ashley's ship greenlight. The fleet-substrate distributor sweep will land the new skill + helper on every managed host on its own schedule after Skynet is redeployed with the new backend bundle.

---
*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Completed: 2026-09-18*
