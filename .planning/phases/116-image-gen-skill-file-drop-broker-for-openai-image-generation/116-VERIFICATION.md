---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
verified: 2026-09-18T02:15:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 116: image-gen-skill — file-drop broker for OpenAI image generation — Verification Report

**Phase Goal:** Give agents inside Skynet's managed chat surface a native way to
generate images from prompts, WITHOUT exposing the OpenAI credential to those
agents or humans on the same box. Ships (1) a Skynet-side backend broker
holding the credential + scanner + queue + worker pool + rate limiter + OpenAI
adapter, and (2) a distributed skill on managed hosts with a helper script that
speaks the file-drop broker protocol.

**Verified:** 2026-09-18T02:15:00Z (initial verification — no prior VERIFICATION.md)
**Status:** PASSED

---

## Goal-Achievement Verdict: PASS

The full request → response wire is present, wired, and demonstrably working
under the hermetic tests. An agent invoking `image-gen "prompt"` on a managed
host (after the next fleet-substrate distributor sweep post-ship) will:

1. Exec `~/.local/bin/image-gen "prompt"` (delivered by catalog row
   `image-gen-helper`).
2. Helper writes `~/fleet/image-gen-requests/<uuid>.json` atomically
   (`.tmp.$$` → `mv`).
3. Skynet's `createImageGenScanOrchestrator` (wired in starter.ts:1314) ticks
   every 10s, atomically claims the request via mv-based scan
   (`IMAGE_GEN_SCAN_CMD`), parses via `parseRequestBody`, fetches any
   companion `.ref.<ext>` bytes over the same SSH channel, and calls
   `queue.enqueue(item)`.
4. One of 5 worker loops (`WORKER_COUNT = 5` in queue.ts:39) dequeues,
   checks TTL against `requested_at + 5*60*1000` (worker.ts:329-340 — the
   Pitfall-5 dequeue-time check), acquires a token from the shared
   `tokenBucket` (worker.ts:345), calls `callOpenAiImageGen` which reads
   `process.env.OPENAI_API_KEY` at request time (adapter.ts:133) and POSTs to
   `api.openai.com/v1/images/generations` (or `/edits` with multipart when
   `refImage` present) via raw `fetch` (no openai SDK dep).
5. On success, worker writes N PNGs FIRST then success.json LAST (worker.ts
   writeSuccessResponse, lines 229-236 / 262-269) to the origin host via
   `writeBinaryFileAtomic` + `writeMarkdownFileAtomic` (the former exported
   at identity-artifact-reader.ts:2166 by this phase).
6. On failure, worker writes only failure.json with `{reason, message?}` —
   all 7 D-27 reasons enumerable.
7. Helper polls (500ms fast for 30s, then 2s), branches on success/failure,
   moves PNGs to `~/fleet/image-gen-outputs/<uuid>-<i>.png`, cleans wire
   files, prints paths on stdout / JSON on stderr, exits 0 or 1.

Every link is present in the codebase. Every link is exercised in the
end-to-end tests. Every observable truth passes.

---

## Observable Truths

| #   | Truth                                                                                                                                                                                                                             | Status     | Evidence                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Helper → request-file wire: `image-gen "prompt"` drops `<uuid>.json` (and optional `<uuid>.ref.<ext>` companion) atomically to `~/fleet/image-gen-requests/`                                                                       | VERIFIED   | substrate/scripts/image-gen:137-233 (uuid derivation + `.tmp.$$` write + `mv`); bash test PASS `test_1_request_drop_happy_path` |
| 2   | Ref file written BEFORE json (Pitfall 3 commit-order invariant)                                                                                                                                                                    | VERIFIED   | substrate/scripts/image-gen: `mv "$ref_tmp" "$ref_dest"` at line 160 precedes `mv "$req_tmp" "$req_path"` at line 228; bash test PASS `test_2_ref_before_json_write_order` (inotify-based) |
| 3   | Backend scan-orchestrator claims via atomic mv, parses via parseRequestBody, fetches companion refs, enqueues PendingImageGen                                                                                                       | VERIFIED   | src/backend/image-gen-requests/scan-orchestrator.ts:134-322 (`IMAGE_GEN_SCAN_CMD` mv-based scan + `parseImageGenRequestBatch` + `fetchCompanionRef` + `scanImageGenRequests`); tests S1-S3 T1-T2 E1-E3 all green |
| 4   | 5-worker pool with FIFO waiter list dequeues items and applies TTL-at-dequeue (Pitfall 5) → token acquire → adapter → response drop                                                                                                | VERIFIED   | queue.ts:39 (`WORKER_COUNT = 5`); worker.ts:329-345 (TTL check BEFORE token acquire); end-to-end.test.ts EXPIRED test covers TTL short-circuit |
| 5   | OpenAI adapter reads OPENAI_API_KEY at request time (not boot), raw fetch (no openai SDK), 60s AbortController, all 7 D-27 reasons mapped                                                                                          | VERIFIED   | adapter.ts:133 (env read inside `callOpenAiImageGen`); grep for `from "openai"` returns 0; `AbortController` at line 150; end-to-end.test.ts covers all 7 reasons |
| 6   | Response files: PNGs written FIRST, success.json LAST (Pitfall-3 response-side); one connection per response drop                                                                                                                  | VERIFIED   | worker.ts:229-236 (LOCAL branch), 262-269 (REMOTE branch — single conn); end-to-end.test.ts HAPPY test asserts writeOrder via `.mock.invocationCallOrder` |
| 7   | Skill body + helper distributed via 2 new catalog rows (image-gen-skill → ~/.claude/skills/image-gen/SKILL.md, image-gen-helper → ~/.local/bin/image-gen); no OpenAI credential in caller-side files                              | VERIFIED   | catalog.ts:311-316 + catalog.ts:377-382; grep `OPENAI_API_KEY` in SKILL.md returns 0, in helper returns 0                       |

**Score:** 7/7 truths verified

---

## Required Artifacts

| Artifact                                                        | Expected                                                        | Status    | Details                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| `src/backend/image-gen-requests/types.ts`                       | ImageGenRequestBody + PendingImageGen + SuccessResponse + FailureReason (7-value union) + FailureResponse (D-06, D-08, D-09, D-27) | VERIFIED  | 113 LOC; all 5 exports present; FailureReason literal count = 10 (7 union + 3 more in code)         |
| `src/backend/image-gen-requests/parse-request-body.ts`          | Explicit-reject unknown top-level keys (D-06)                    | VERIFIED  | 201 LOC; KNOWN_KEYS set at line 51; reject loop at lines 99-103            |
| `src/backend/image-gen-requests/token-bucket.ts`                | Factory with capacity = max(1, floor(rpm×5/60)), FIFO waiters, .unref() interval (D-21) | VERIFIED  | ~85 LOC; `capacity = Math.max(1, Math.floor(rpm * 5 / 60))`; `.unref()` on setInterval |
| `src/backend/image-gen-requests/adapter.ts`                     | Raw fetch, AbortController 60s, secret-safe logging, discriminated-union never-throw (D-25, D-26, D-27) | VERIFIED  | 298 LOC; missing-key check at line 133 BEFORE timer; AbortController at line 150; no Authorization/API_KEY in log statements |
| `src/backend/image-gen-requests/queue.ts`                       | 5-worker pool with FIFO waiter list, drain-error containment, WORKER_COUNT const (D-20) | VERIFIED  | 232 LOC; `WORKER_COUNT = 5` exported constant at line 39                    |
| `src/backend/image-gen-requests/worker.ts`                      | processImageGen with TTL-at-dequeue (Pitfall 5), PNGs-before-JSON (Pitfall 3 response side) | VERIFIED  | 373 LOC; TTL check at lines 329-340 (BEFORE token acquire); PNGs before JSON in writeSuccessResponse |
| `src/backend/image-gen-requests/scan-orchestrator.ts`           | Always-on tick with IMAGE_GEN_SCAN_CMD + parseImageGenRequestBatch + fetchCompanionRef; NO ssh-poll-orchestrator import (RESEARCH Q2) | VERIFIED  | 467 LOC; `IMAGE_GEN_SCAN_CMD` at lines 134-144; locally-declared `SshChannel` interface; grep `from ".*ssh-poll-orchestrator"` = 0 |
| `src/backend/claude-session/identity-artifact-reader.ts`        | Public `writeBinaryFileAtomic` export with LOCAL+REMOTE branches | VERIFIED  | Export at line 2166                                                        |
| `src/backend/starter.ts`                                        | Image-gen boot block wiring token bucket, worker pool, scan orchestrator | VERIFIED  | Block at lines 1186-1354; SKYNET_IMAGE_GEN_RPM read at 1234; createTokenBucket at 1237; startPool at 1249; createImageGenScanOrchestrator at 1314 |
| `src/backend/distributor/catalog.ts`                            | Exactly 2 new rows (image-gen-skill + image-gen-helper) | VERIFIED  | Rows at lines 311-316 + 377-382; grep count = 2                             |
| `substrate/skills/image-gen/SKILL.md`                           | D-17 PHI directive verbatim at top + D-18 inline echo + D-27 failure table | VERIFIED  | 63 LOC; PHI directive at lines 11-13 verbatim `MUST NOT include PHI`; inline echo at line 34; failure table at lines 55-63 with all 7 reasons |
| `substrate/scripts/image-gen`                                   | Bash helper: write-and-poll broker with ref-before-json (Pitfall 3), dual-cadence poll, IMAGE_GEN_TIMEOUT_SEC env override, D-14 stdout/stderr split, D-15 output dir | VERIFIED  | 323 LOC; mode 755; `bash -n` clean; ref mv at line 160 before json mv at 228; dual poll cadence at lines 250-254; `IMAGE_GEN_TIMEOUT_SEC` env at line 51 |
| `substrate/scripts/tests/image-gen.test.sh`                     | Hermetic bash test driver: 5 tests including inotify ref-before-json proof | VERIFIED  | 434 LOC; mode 755; `bash -n` clean; running yields PASS: 5 / FAIL: 0 / SKIP: 0 |
| `src/backend/image-gen-requests/end-to-end.test.ts`             | Vitest e2e: happy path + all 7 D-27 failures + scan integration | VERIFIED  | 496 LOC; 9 tests all green in ~1.2s under `vi.stubGlobal("fetch", ...)`     |

**Total artifacts verified:** 14/14

---

## Key Link Verification

| From                                                              | To                                                                 | Via                                                                          | Status  | Details                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| substrate/scripts/image-gen (helper)                              | ~/fleet/image-gen-requests/<uuid>.json                             | atomic .tmp.$$ + mv                                                          | WIRED   | Script lines 138-233                                                                             |
| scan-orchestrator.ts scanImageGenRequests                          | queue.ts enqueue                                                    | deps.enqueue(item) via ImageGenScanOrchestratorDeps                          | WIRED   | scan-orchestrator.ts:92 + starter.ts:1319 wiring                                                 |
| queue.ts worker loop                                              | worker.ts processImageGen                                          | setProcessImageGen injection at boot                                          | WIRED   | starter.ts:1248 (`setImageGenProcessFn(processImageGen)`)                                        |
| worker.ts                                                         | adapter.ts callOpenAiImageGen                                      | deps.callOpenAiImageGen(item.body, item.refImage) via WorkerDeps            | WIRED   | worker.ts:353 + buildProductionDeps at 122                                                       |
| worker.ts                                                         | token-bucket.ts tokenBucket.acquire                                | deps.tokenBucket.acquire() (boot-time singleton)                             | WIRED   | worker.ts:345; starter.ts:1237 (single createTokenBucket) → 1246 (buildProductionDeps)          |
| worker.ts writeSuccessResponse / writeFailureFile                 | identity-artifact-reader.ts writeMarkdownFileAtomic + writeBinaryFileAtomic | deps.writeMarkdownFileAtomic + deps.writeBinaryFileAtomic                    | WIRED   | worker.ts imports at lines 36-40; buildProductionDeps at 114-126 wires real imports              |
| adapter.ts                                                        | process.env.OPENAI_API_KEY                                         | Runtime env read inside callOpenAiImageGen (line 133)                        | WIRED   | Missing key → not_configured BEFORE any fetch                                                    |
| starter.ts image-gen boot block                                    | scan-orchestrator + queue + worker                                 | Dynamic imports + createImageGenScanOrchestrator + startPool + orch.start()  | WIRED   | Lines 1200-1354; ordering: token bucket → workerDeps → setProcessImageGen → startPool → createOrch → start |
| substrate/scripts/image-gen (helper)                              | ~/fleet/image-gen-outputs/<uuid>-<i>.png                           | mv on success branch                                                          | WIRED   | Helper lines 280-305                                                                             |
| distributor catalog.ts image-gen-skill row                        | /app/fleet-substrate/skills/image-gen/SKILL.md                     | bundledPath + installPath                                                    | WIRED   | catalog.ts:313-314                                                                               |
| distributor catalog.ts image-gen-helper row                       | /app/fleet-substrate/scripts/image-gen                             | bundledPath + installPath                                                    | WIRED   | catalog.ts:379-380                                                                               |

All 11 key links present and wired.

---

## Data-Flow Trace (Level 4)

The image-gen broker is a live subsystem — data flows via the queue at
runtime, not a stored dataset. Data-flow traces:

| Artifact                                        | Data Variable                       | Source                                                                       | Produces Real Data | Status    |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | ------------------ | --------- |
| worker.ts (SuccessResponse.images)              | `filenames: string[]`                | Populated as writeBinaryFileAtomic completes each PNG (worker.ts:233, 266)   | Yes (populated per write) | FLOWING   |
| adapter.ts (AdapterResult.images: Buffer[])     | `parsed.data.map((d) => Buffer.from(d.b64_json, "base64"))` | Decoded from OpenAI's real response (line 263)                               | Yes                | FLOWING   |
| scan-orchestrator.ts (PendingImageGen items)    | `parseImageGenRequestBatch(stdout, hostId)` | Parsed from real SSH stdout of atomic scan (line 287)                        | Yes                | FLOWING   |
| worker.ts (item.refImage: Buffer)               | `fetchCompanionRef` return via scan-orchestrator | base64-decoded from `cat ... | base64 -w0` real SSH exec (line 253)          | Yes                | FLOWING   |

No hollow-prop / static-fallback / disconnected-source issues found. The e2e
test explicitly validates the full data flow through mocked fetch/SSH
producing real bytes that traverse the wire.

---

## Behavioral Spot-Checks

| Behavior                                                                 | Command                                                                          | Result                                                            | Status   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| Backend vitest suite (8 files, 109 tests)                                | `npx vitest run src/backend/image-gen-requests/`                                 | 8 files / 109 tests / all green in 3.70s                          | PASS     |
| TypeScript type check (whole repo)                                       | `npx tsc --noEmit`                                                               | Exit 0, no output                                                 | PASS     |
| Bash test driver (5 tests, hermetic)                                     | `bash substrate/scripts/tests/image-gen.test.sh`                                 | PASS: 5 / FAIL: 0 / SKIP: 0                                       | PASS     |
| Helper syntax check                                                      | `bash -n substrate/scripts/image-gen`                                            | Clean (no output)                                                 | PASS     |
| Helper executable bit                                                    | `test -x substrate/scripts/image-gen && echo OK`                                 | OK (mode 755)                                                     | PASS     |
| No openai SDK import in adapter                                          | `grep -c "from ['\"]openai" src/backend/image-gen-requests/adapter.ts`           | 0                                                                 | PASS     |
| No openai SDK in package.json deps                                       | package.json → dependencies + devDependencies                                    | absent in both                                                    | PASS     |
| No ssh-poll-orchestrator import in scan-orchestrator (Q2 invariant)     | `grep -c "from ['\"].*ssh-poll-orchestrator" src/backend/image-gen-requests/scan-orchestrator.ts` | 0                                                                 | PASS     |
| Both catalog rows present                                                | `grep -c "image-gen-skill\|image-gen-helper" src/backend/distributor/catalog.ts` | 2                                                                 | PASS     |
| Ref before JSON in helper (Pitfall 3)                                    | inotify-based bash test #2                                                       | PASS                                                              | PASS     |
| No OPENAI_API_KEY in SKILL.md or helper (security invariant)             | grep `OPENAI_API_KEY` in both                                                    | 0 in both                                                         | PASS     |
| OPENAI_API_KEY read at request time in adapter                           | grep `process.env.OPENAI_API_KEY` in adapter.ts                                  | Present at line 133 inside `callOpenAiImageGen` (runtime)         | PASS     |
| SKILL.md D-17 PHI directive verbatim                                     | grep `MUST NOT include PHI`                                                      | 1 match, verbatim from CONTEXT.md D-17                            | PASS     |
| SKILL.md D-18 inline echo                                                | grep `Before invoking: confirm the prompt`                                       | Present at line 34 verbatim                                       | PASS     |
| D-27 all 7 failure reasons in types.ts                                   | grep for all 7 literal strings                                                   | 10 occurrences (7 in union + 3 in doc comments)                   | PASS     |
| starter.ts wiring                                                        | grep `createImageGenScanOrchestrator\|SKYNET_IMAGE_GEN_RPM\|createTokenBucket`   | 7 (>= 3 required)                                                 | PASS     |

All 16 spot-checks pass.

---

## D-Decision Coverage (D-01..D-28)

All 28 CONTEXT.md decisions verified as implemented on-disk:

| Decision | Verified In                                                                    | Status                                           |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| D-01     | scan-orchestrator.ts (always-on tick — adjusted per RESEARCH Q2 correction)   | Implemented (adjusted)                            |
| D-02     | scan-orchestrator.ts:134-144 IMAGE_GEN_SCAN_CMD (atomic mv-based)              | Implemented                                       |
| D-03     | scan-orchestrator.ts:135 (`cd ... 2>/dev/null || exit 0`) + helper:121 mkdir  | Implemented                                       |
| D-04     | worker.ts:67 IMAGE_GEN_DIR (`$HOME/fleet/image-gen-requests`)                  | Implemented                                       |
| D-05     | helper:264, 318-321 (rm on both success + failure branches)                    | Implemented                                       |
| D-06     | parse-request-body.ts:51 KNOWN_KEYS + lines 99-103 explicit-reject loop        | Implemented                                       |
| D-07     | parse-request-body.ts:63 REF_PATTERN + helper `--ref` flag + scan fetch       | Implemented                                       |
| D-08     | types.ts:78-85 SuccessResponse + worker.ts writeSuccessResponse                | Implemented                                       |
| D-09     | types.ts:109-112 FailureResponse + worker.ts writeFailureFile                  | Implemented                                       |
| D-10     | helper:156-164, 228 atomic .tmp+mv on both request + ref files                 | Implemented                                       |
| D-11     | worker.ts uses connectOneShot (independent per-request SSH conn) — deviation from D-01's shared channel but consistent with the RESEARCH Q2 dedicated-orchestrator pattern | Implemented (adjusted per Q2) |
| D-12     | substrate/scripts/image-gen + catalog row                                       | Implemented                                       |
| D-13     | helper:75-101 arg-parse (positional + flags + --json escape)                    | Implemented                                       |
| D-14     | helper:307-314 (metadata to stderr, paths to stdout)                           | Implemented                                       |
| D-15     | helper:280-296 (~/fleet/image-gen-outputs default, --out override)             | Implemented                                       |
| D-16     | helper:51 TIMEOUT_SEC=300 with IMAGE_GEN_TIMEOUT_SEC env override              | Implemented                                       |
| D-17     | SKILL.md lines 11-13 verbatim `MUST NOT include PHI` block                     | Implemented (verbatim)                            |
| D-18     | SKILL.md line 34 inline echo verbatim                                          | Implemented (verbatim)                            |
| D-19     | SKILL.md line 51 content_blocked one-liner verbatim                            | Implemented (verbatim)                            |
| D-20     | queue.ts:39 WORKER_COUNT = 5 constant + starter.ts:1249 startPool()            | Implemented                                       |
| D-21     | token-bucket.ts + starter.ts:1234-1237 (SKYNET_IMAGE_GEN_RPM env, default 30, singleton) | Implemented                             |
| D-22     | worker.ts:329-340 TTL-at-dequeue (BEFORE token acquire, BEFORE adapter call)   | Implemented                                       |
| D-23     | adapter.ts:194 429 → rate_limited (no retry)                                   | Implemented                                       |
| D-24     | adapter.ts:202 5xx / AbortError → provider_unavailable (no retry)              | Implemented                                       |
| D-25     | adapter.ts:133 process.env.OPENAI_API_KEY at request time; missing → not_configured | Implemented                                  |
| D-26     | adapter.ts:58 OPENAI_MODEL="gpt-image-1"; KNOWN_KEYS omits `model`             | Implemented                                       |
| D-27     | types.ts:92-99 FailureReason union with all 7 values; adapter + worker map each | Implemented                                       |
| D-28     | Phase git log contains only feat + test + docs commits (no push/build/deploy) | Implemented                                       |

**Summary:** 28/28 D-decisions implemented. Two implemented-with-adjustment
(D-01, D-11) per the RESEARCH.md Q2 correction that supersedes the CONTEXT.md
piggyback wording. Rationale is documented in the SUMMARY, the RESEARCH.md
Q2 section, and the scan-orchestrator.ts file header.

---

## RESEARCH.md Correction Compliance

| Correction                                                          | Verified                                                                                                                      | Status  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| Q2: scan-orchestrator is NEW module (not fleet-status piggyback)   | scan-orchestrator.ts declares its own SshChannel interface; grep `from ".*ssh-poll-orchestrator"` returns 0                    | PASS    |
| Pitfall 3: helper writes ref file BEFORE json                       | helper.sh line 160 (ref mv) < line 228 (json mv); bash test #2 uses inotifywait to prove this at inode-event level             | PASS    |
| Pitfall 5: TTL check inside worker at dequeue (not scan/enqueue)    | worker.ts lines 329-340; check occurs BEFORE token acquire (line 345) and BEFORE adapter call (line 353)                       | PASS    |
| Q3: raw fetch (not openai SDK)                                      | adapter.ts imports only logger + types; `fetch(url, {...})` at line 178; `openai` absent from package.json deps + devDeps       | PASS    |

All RESEARCH corrections honored.

---

## Security Invariant Verification

The OpenAI credential (`OPENAI_API_KEY`) is present ONLY in the Skynet
backend's process env at request time. Verified by:

| Check                                                                              | Result | Status |
| ---------------------------------------------------------------------------------- | ------ | ------ |
| `grep OPENAI_API_KEY substrate/skills/image-gen/SKILL.md`                          | (empty) | PASS   |
| `grep OPENAI_API_KEY substrate/scripts/image-gen`                                  | (empty) | PASS   |
| `grep OPENAI_API_KEY src/backend/image-gen-requests/adapter.ts`                    | 4 hits (2 in header docstring, 1 in `process.env.OPENAI_API_KEY` at line 133, 1 in a log-message string) | PASS   |
| Adapter reads at request time, not boot                                            | Line 133 is INSIDE `callOpenAiImageGen`, not module top-level                                          | PASS   |
| Authorization header never in log fields                                           | Manual code review of adapter.ts: log calls at lines 135, 141, 189, 197, 212, 219, 230, 245, 257, 266, 280, 286 — none include Authorization or apiKey | PASS   |

Security invariant HOLDS. The `OPENAI_API_KEY` value does not appear in any
caller-side file, does not appear in any log field, and is read from
`process.env` only when a request is being processed (returning
`not_configured` cleanly when unset).

---

## Requirements Coverage

Phase 116 declares no formal REQUIREMENTS.md IDs (all plans' `requirements`
frontmatter is `[]`). Instead, requirements are captured in CONTEXT.md as the
D-01..D-28 decision list. Coverage of all 28 decisions verified in the
D-Decision Coverage table above — 28/28 implemented.

---

## Anti-Patterns Found

None. No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers in
any phase-created or phase-modified file. No debt-marker gate violations.

Additionally:
- No `openai` SDK import (raw fetch convention preserved)
- No `bottleneck` / `p-limit` / `p-queue` / `limiter` npm libs (hand-rolled bucket preserved)
- No modification to `identity-avatar-batch.ts` (avatar-flow separation preserved)
- No modification to `ssh-poll-orchestrator.ts` (Q2 always-on-orchestrator invariant preserved)
- No push / docker build / docker compose up in phase commits (D-28 executor-remit boundary preserved)

---

## File-Count Sanity

SUMMARY.md rollup lists 18 created files + 3 modified files. Disk state:

- **Backend source (7):** types.ts, parse-request-body.ts, token-bucket.ts, adapter.ts, queue.ts, worker.ts, scan-orchestrator.ts — all present.
- **Backend tests (8):** types.test.ts, parse-request-body.test.ts, token-bucket.test.ts, adapter.test.ts, queue.test.ts, worker.test.ts, scan-orchestrator.test.ts, end-to-end.test.ts — all present.
- **Substrate (2):** substrate/skills/image-gen/SKILL.md, substrate/scripts/image-gen — both present, helper mode 755.
- **Bash test (1):** substrate/scripts/tests/image-gen.test.sh — present, mode 755.
- **Modified (3):** src/backend/distributor/catalog.ts (2 rows added), src/backend/claude-session/identity-artifact-reader.ts (writeBinaryFileAtomic exported), src/backend/starter.ts (image-gen boot block added).

Actual on-disk: 18 files created (matching SUMMARY count if 5 SUMMARY .md files are included in the created count as they are). 3 files modified matching SUMMARY. No phantom files, no missing files.

---

## Test Coverage Summary

| Suite                                             | Files | Tests | Result       | Wall Time |
| ------------------------------------------------- | ----- | ----- | ------------ | --------- |
| `npx vitest run src/backend/image-gen-requests/`  | 8     | 109   | all green    | 3.70s     |
| `bash substrate/scripts/tests/image-gen.test.sh`  | 1     | 5     | 5 pass, 0 fail, 0 skip | ~11s   |
| `npx tsc --noEmit`                                | -     | -     | exit 0 clean | ~28s      |

Total: 114 automated tests, all green, tsc clean.

---

## Gaps Summary

**None.** All observable truths pass, all artifacts present and substantive
and wired, all key links verified, all D-decisions implemented, all
RESEARCH corrections honored, security invariant holds, no debt markers, no
anti-patterns. The end-to-end wire is exercised and green under hermetic
tests.

Two items are deliberately deferred per SUMMARY documentation:
- **Assumption A3** (OpenAI /edits multipart shape) — the adapter's multipart
  FormData construction is unit-tested; real OpenAI acceptance validates on
  the first real image-to-image call post-ship. Adapter classifies a wrong
  shape as `malformed` or `unknown` — self-diagnosing.
- **T-116-01-06** (uuid-in-ref == request-uuid check) — the parser enforces
  `<uuid>.ref.<ext>` SHAPE; the additional check that the embedded uuid
  matches the request's own uuid is deferred. Backend-controlled path prefix
  + shape check prevent path traversal regardless.

Neither deferred item blocks goal achievement.

---

## Human Verification Required

None. Every truth is verifiable programmatically (file existence, grep
patterns, test outcomes). No visual/UX/real-time/external-service
verification is needed at phase-close time — the D-28 executor remit stops
at code + commit + tests green; the substrate distributor + Skynet redeploy
are orchestrator-owned motions that happen on Ashley's ship greenlight.

The only truly-live validation is Assumption A3 (multipart /edits shape),
and that surfaces automatically as `malformed` or `unknown` on Ashley's
first image-to-image request — a self-diagnosing path.

---

## Final Status: PASSED

Phase 116 achieves its goal: agents inside Skynet's managed chat surface can
invoke `image-gen "prompt"` and receive an image path back via a file-drop
broker that never exposes the OpenAI credential outside the Skynet backend.
All 28 D-decisions implemented, all RESEARCH corrections honored, 114 tests
green, tsc clean, no debt markers, executor remit respected (no push /
build / deploy).

**status: passed**

---

*Verified: 2026-09-18T02:15:00Z*
*Verifier: Claude (gsd-verifier)*
