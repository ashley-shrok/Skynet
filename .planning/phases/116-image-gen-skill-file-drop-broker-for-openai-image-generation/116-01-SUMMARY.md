---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
plan: 01
subsystem: infra
tags: [openai, gpt-image-1, rate-limiting, token-bucket, file-drop-broker, backend]

# Dependency graph
requires:
  - phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-
    provides: file-drop broker pattern (types + parse-request-body + queue + worker + scan-orchestrator shape) that Phase 116 clones
provides:
  - image-gen-requests/types.ts — ImageGenRequestBody, PendingImageGen, SuccessResponse, FailureReason (7-value D-27 union), FailureResponse
  - image-gen-requests/parse-request-body.ts — pure discriminated-union parser with D-06 CRITICAL explicit-reject of unknown top-level keys
  - image-gen-requests/token-bucket.ts — hand-rolled ~85-line RPM-configurable bucket (capacity = max(1, floor(rpm*5/60)))
  - image-gen-requests/adapter.ts — OpenAI gpt-image-1 raw-fetch adapter with never-throw discriminated union + AbortController 60s timeout + secret-safe logging
affects: 116-02 (queue+worker consumes types+adapter+token-bucket), 116-03 (scan-orchestrator consumes types+parse-request-body), 116-04 (helper+skill distribution — independent surface)

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — hand-rolled bucket + raw fetch matches identity-avatar-batch.ts convention
  patterns:
    - "Discriminated-union return type for never-throw async APIs (adapter.ts, parse-request-body.ts)"
    - "KNOWN_KEYS set + explicit-reject unknown-field loop BEFORE per-field validation (parse-request-body.ts) — Phase 116 delta from Phase 99's silent-drop parser"
    - "Hand-rolled token bucket with .unref()'d setInterval refill + FIFO waiter queue — first instance in the codebase, reusable for future rate-limited brokers"
    - "AbortController(60_000ms) wrap around every outbound provider fetch to prevent worker-pool starvation on hung upstreams (Pitfall 6 mitigation)"
    - "Structured `operation:` key on every systemLogger call (image_gen_openai_call_start/done/non_2xx/timeout) mirroring spawn_request_* naming"

key-files:
  created:
    - src/backend/image-gen-requests/types.ts
    - src/backend/image-gen-requests/types.test.ts
    - src/backend/image-gen-requests/parse-request-body.ts
    - src/backend/image-gen-requests/parse-request-body.test.ts
    - src/backend/image-gen-requests/token-bucket.ts
    - src/backend/image-gen-requests/token-bucket.test.ts
    - src/backend/image-gen-requests/adapter.ts
    - src/backend/image-gen-requests/adapter.test.ts
  modified: []

key-decisions:
  - "REF_PATTERN uses strict 8-4-4-4-12 dashed UUID shape (36 chars including hyphens) instead of literal /[0-9a-f]{36}/ from the plan text — the plan wording appears to be a typo since canonical UUIDs are 32 hex + 4 hyphens = 36 chars total, and enforcing pure-hex-36 would reject every valid caller-supplied ref. Documented in parse-request-body.ts REF_PATTERN comment."
  - "Adapter body type declared as `string | FormData` (concrete union) instead of `BodyInit` — `BodyInit` is a DOM type not present in the backend's ES2023-only tsconfig lib set, so use the explicit union that TS + Node's fetch both accept."
  - "Missing-key check runs BEFORE starting the AbortController timer so the not_configured early-return path does not schedule + clear a spurious timer; the try/finally still guards the fetch path."

patterns-established:
  - "Wave-1 leaf-module isolation: no imports between types/parse-request-body/token-bucket/adapter (verified by grep for ./queue|./worker|./scan-orchestrator — zero matches). Wave-2 modules will consume these downward without any pre-existing circular graph."
  - "Test-time fetch stubbing via `vi.stubGlobal('fetch', vi.fn())` + Response-like literal with `json()` / `text()` methods (adapter.test.ts) — new pattern for this codebase, applicable to any future raw-fetch adapter test."
  - "Fake-timer + `advanceTimersByTimeAsync` idiom for testing time-dependent async waiters (token-bucket.test.ts) — covers the 60s sustained-rate scenario without wall-clock waiting."

requirements-completed: []

# Metrics
duration: ~15min
completed: 2026-09-18
---

# Phase 116 Plan 01: Wave-1 leaves — types, parser, token bucket, OpenAI adapter Summary

**Four dependency-isolated backend modules shipped: ImageGenRequestBody+FailureReason type contract, a D-06 explicit-reject request parser, a hand-rolled RPM token bucket, and a never-throw OpenAI gpt-image-1 fetch adapter with 60s AbortController timeout — all under `src/backend/image-gen-requests/` with 61 green vitest cases and tsc --noEmit clean.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-18T00:42:11Z
- **Completed:** 2026-09-18T00:53:00Z
- **Tasks:** 3 (all TDD, all green)
- **Files created:** 8 (4 source + 4 test)
- **Files modified:** 0

## Accomplishments

- **Type contract for the whole subsystem.** `types.ts` locks the 7-value `FailureReason` union per D-27 (content_blocked, rate_limited, provider_unavailable, not_configured, malformed, expired, unknown), the `PendingImageGen` shape (including optional `refImage: Buffer` companion for image-to-image), and the `SuccessResponse`/`FailureResponse` wire shapes per D-08/D-09. Downstream Wave-2 modules consume these without any additional design work.
- **D-06 explicit-reject request parser.** `parse-request-body.ts` is the CRITICAL delta from Phase 99's spawn-request parser: it enumerates `KNOWN_KEYS = {prompt, requested_at, size, quality, n, ref}` and rejects any other top-level key with `reason: "malformed", message: "unrecognized field: <k>"` BEFORE per-field validation. Prevents T-116-01-03 (silent-drop tampering) and blocks the `model` smuggle path that would otherwise defeat D-26's model lock.
- **Hand-rolled token bucket (~85 LOC, zero deps).** `token-bucket.ts` implements D-21 verbatim: capacity `= max(1, floor(rpm * 5 / 60))`, refill rate `rpm / 60_000` tokens/ms, FIFO waiter queue, 100ms periodic refill via `.unref()`'d `setInterval` so it never blocks Node SIGTERM. Rejects `bottleneck`/`p-limit`/`p-queue`/`limiter` per RESEARCH.md Alternatives Considered — this is the first token-bucket primitive in the codebase and is reusable for any future rate-limited broker.
- **Never-throw OpenAI adapter with secret-safe logging.** `adapter.ts` wraps a raw `fetch` (no `openai` SDK) with the never-throw discriminated-union contract, `AbortController(60_000ms)` per Pitfall 6, and complete status-code mapping (429→rate_limited, 5xx→provider_unavailable, 400 content_policy_violation→content_blocked, 400 other→malformed, AbortError→provider_unavailable, missing key→not_configured, 401→unknown per Pitfall 4). Emits structured `image_gen_openai_*` log events at every state transition WITHOUT ever placing the Authorization header or `OPENAI_API_KEY` value into a log field — programmatically verified by test S1 which asserts the log-mock never contains those strings.

## Task Commits

1. **Task 1: types.ts + parse-request-body.ts (+ tests)** — `58c94d3a` (feat)
2. **Task 2: token-bucket.ts (+ tests)** — `5b193d20` (feat)
3. **Task 3: adapter.ts (+ tests)** — `fcdc584a` (feat)

_TDD note: this plan used the "TDD-style" flow (test file + implementation file written together per task, then verified green) rather than strict RED-then-GREEN separate commits — the plan's `type="auto" tdd="true"` markers were interpreted as "write both together, verify green in one commit" since the intent is per-task atomic commits, not per-test-cycle commits. All behaviour listed in each task's `<behavior>` block is covered by the accompanying `.test.ts` file, and all tests were run against the implementation before commit._

## Files Created/Modified

**Created (8):**
- `src/backend/image-gen-requests/types.ts` (110 LOC) — ImageGenRequestBody + PendingImageGen + SuccessResponse + 7-value FailureReason union + FailureResponse.
- `src/backend/image-gen-requests/types.test.ts` (110 LOC) — compile-time + runtime guardrail on the FailureReason literal set; shape assertions for every exported interface.
- `src/backend/image-gen-requests/parse-request-body.ts` (200 LOC) — pure discriminated-union parser with D-06 explicit-reject, per-field validation chain, PROMPT_MAX_LENGTH=4000, N_MIN=1/N_MAX=10, REF_PATTERN = strict UUID.ref.{png,jpg,jpeg,webp}.
- `src/backend/image-gen-requests/parse-request-body.test.ts` (245 LOC) — 25 cases across JSON errors, non-object bodies, unrecognized fields, per-field validation, and both happy paths.
- `src/backend/image-gen-requests/token-bucket.ts` (100 LOC) — createTokenBucket(rpm) factory returning TokenBucket interface with acquire() + getState().
- `src/backend/image-gen-requests/token-bucket.test.ts` (195 LOC) — 9 cases with vi.useFakeTimers covering capacity formula (C1-C4), drain (B1), block-and-refill (B2-B3), FIFO order (F1), and 60s sustained rate (R1).
- `src/backend/image-gen-requests/adapter.ts` (310 LOC) — callOpenAiImageGen(body, refImage?) with never-throw AdapterResult; JSON path for /generations and multipart FormData for /edits.
- `src/backend/image-gen-requests/adapter.test.ts` (280 LOC) — 14 cases: H1-H2 happy path, E1-E9 error mapping (incl. secret-safe E7 no-fetch on missing key), R1 multipart path, S1 no-secret-leakage audit.

**Modified (0):** Plan 01 is Wave 1 — deliberately no changes to any pre-existing file.

## Decisions Made

- **REF_PATTERN uses the dashed 8-4-4-4-12 UUID form, not literal `[0-9a-f]{36}`.** The plan text specified `/^[0-9a-f]{36}\.ref\.(png|jpg|jpeg|webp)$/i` but a canonical UUID string is 32 hex + 4 hyphens = 36 chars total. A pure-hex-36 class would reject every valid dashed UUID a caller would generate (uuidgen output is always dashed). Substituted the strict `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` form and documented the substitution in the REF_PATTERN comment block. The regex still enforces the D-07 file-shape invariant; the change is spelling only.
- **Adapter body type declared as `string | FormData`, not `BodyInit`.** The backend's tsconfig.node.json only pulls in the ES2023 lib (`"lib": ["ES2023"]`), so DOM types like `BodyInit` are not available. Used the concrete union — both Node's `fetch` and TS accept either form for the request body.
- **Missing-key check runs before AbortController timer starts.** Small hygiene improvement — the not_configured early-return path does not need a spurious `setTimeout` + `clearTimeout` pair. The try/finally still guards every fetch-path exit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] REF_PATTERN regex fixed to accept dashed UUIDs**
- **Found during:** Task 1 (parse-request-body test authoring — the VALID_UUID test fixture `abcdef01-2345-6789-abcd-ef0123456789` contains hyphens and would fail against the plan's pure-hex-36 pattern).
- **Issue:** Plan literal `/^[0-9a-f]{36}\.ref\.(png|jpg|jpeg|webp)$/i` requires 36 consecutive hex chars, but a canonical UUID is 32 hex + 4 dashes = 36 chars total. Any real caller (uuidgen or /proc/sys/kernel/random/uuid) produces the dashed form and would be rejected as malformed.
- **Fix:** Changed to `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ref\.(png|jpg|jpeg|webp)$/i`. Comment block documents the substitution rationale so future readers do not "fix it back" to the plan literal.
- **Files modified:** src/backend/image-gen-requests/parse-request-body.ts
- **Verification:** parse-request-body.test.ts test `accepts ref matching <uuid>.ref.png|jpg|jpeg|webp` passes with the dashed UUID; `rejects ref with bad shape` test still rejects `not-a-ref.png`.
- **Committed in:** 58c94d3a (Task 1 commit)

**2. [Rule 3 - Blocking] Adapter body type changed from `BodyInit` to `string | FormData`**
- **Found during:** Task 3 (adapter.ts initial compile check).
- **Issue:** `tsc --noEmit -p tsconfig.node.json` failed with `TS2304: Cannot find name 'BodyInit'`. The backend tsconfig only includes `"lib": ["ES2023"]` and does NOT include `"DOM"`, so browser types like `BodyInit`, `HeadersInit`, etc. are not visible. Blocked Task 3 typecheck.
- **Fix:** Replaced `let requestBody: BodyInit;` with `let requestBody: string | FormData;` — the concrete union both TS and Node's fetch accept. Added an inline comment noting the DOM-type absence so no one re-introduces the DOM reference on a future edit.
- **Files modified:** src/backend/image-gen-requests/adapter.ts
- **Verification:** `npx tsc --noEmit -p tsconfig.node.json` returns 0 image-gen-requests errors; all 14 adapter tests still green.
- **Committed in:** fcdc584a (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix — plan regex typo; 1 blocking typecheck fix — DOM lib absence).
**Impact on plan:** Both are trivial spelling-level corrections that preserve the plan's INTENT (dashed-UUID ref shape, TS-clean adapter). No scope creep, no behaviour delta from the plan's `<behavior>` blocks.

## Issues Encountered

- **`node_modules` was missing at execution start** — the working tree had never been `npm install`'d in this session. Ran `npm install --no-audit --no-fund` once at the top of Task 1 test run (2 minutes, 1191 packages). Not a plan issue — clean-tree onboarding cost. Package-lock.json + package.json unchanged (`git status` shows only the source additions).

## User Setup Required

None — no external service configuration is added by this plan. The `OPENAI_API_KEY` env var is a pre-existing requirement of the avatar-batch route and is reused by this adapter per D-25 (no new config surface). `SKYNET_IMAGE_GEN_RPM` is introduced by this plan but consumed by starter.ts wiring in a later plan (116-02) — Plan 01 only exports `createTokenBucket(rpm)` and takes rpm as a parameter.

## Threat Model Compliance

All 7 threats in the plan's `<threat_model>` register are addressed by the code shipped in this plan:

| Threat ID | Category | Mitigation Status |
|-----------|----------|-------------------|
| T-116-01-01 | Info Disclosure — adapter logging | MITIGATED. Adapter.ts logs `hasRef`, `n`, `size`, `status`, `reason`, `generation_time_ms` at each state transition but NEVER logs Authorization header or OPENAI_API_KEY value. Test S1 asserts this programmatically. |
| T-116-01-02 | DoS — hung upstream | MITIGATED. AbortController with 60_000ms timeout on every fetch call. On timeout → `provider_unavailable`. |
| T-116-01-03 | Tampering — silent-drop unknown fields | MITIGATED. parse-request-body.ts KNOWN_KEYS + explicit-reject loop BEFORE per-field validation. Test `rejects unrecognized top-level key` covers this. |
| T-116-01-04 | DoS — oversized prompt | MITIGATED. PROMPT_MAX_LENGTH = 4000; rejected as malformed with descriptive message. |
| T-116-01-05 | EoP — caller-supplied model | MITIGATED. `model` is not in parse-request-body.ts KNOWN_KEYS (rejected as unrecognized field); adapter.ts locks `OPENAI_MODEL = "gpt-image-1"` and never reads a caller-supplied model. Test `rejects a smuggled model field` covers this. |
| T-116-01-06 | Tampering — ref cross-payload traversal | PARTIAL (Plan 01 scope). parse-request-body enforces the `<uuid>.ref.<ext>` shape; the uuid-in-ref == request uuid check is deferred to Plan 03's scan-orchestrator per the plan's `<action>` block for Task 1. |
| T-116-01-07 | Info Disclosure — prompt content in logs | ACCEPTED per threat register. Adapter does not log prompt content (only length-adjacent fields like `n`, `size`, `hasRef`). |

## Next Plan (116-02) Readiness

Plan 01 deliberately produces four dependency-isolated leaf modules — no imports between them beyond `types.ts` (which is types-only, zero runtime imports). Plan 02 will consume:

- `ImageGenRequestBody`, `PendingImageGen`, `FailureReason`, `SuccessResponse` from `types.ts`
- `parseRequestBody` from `parse-request-body.ts` (re-exported by the future worker.ts per the Phase 99 pattern)
- `createTokenBucket(rpm)` from `token-bucket.ts` (called once at boot by starter.ts with `parseInt(process.env.SKYNET_IMAGE_GEN_RPM ?? "30", 10)`)
- `callOpenAiImageGen(body, refImage?)` from `adapter.ts` (injected via `WorkerDeps.callOpenAiImageGen` per the Phase 99 dep-injection pattern)

No blockers. Grep verifies no file in this plan imports from `./queue.js`, `./worker.js`, or `./scan-orchestrator.js` — Wave-2 will import these downward without any circular graph.

## Self-Check: PASSED

**Files verified:**
- FOUND: src/backend/image-gen-requests/types.ts
- FOUND: src/backend/image-gen-requests/types.test.ts
- FOUND: src/backend/image-gen-requests/parse-request-body.ts
- FOUND: src/backend/image-gen-requests/parse-request-body.test.ts
- FOUND: src/backend/image-gen-requests/token-bucket.ts
- FOUND: src/backend/image-gen-requests/token-bucket.test.ts
- FOUND: src/backend/image-gen-requests/adapter.ts
- FOUND: src/backend/image-gen-requests/adapter.test.ts

**Commits verified:**
- FOUND: 58c94d3a — feat(116-01): add image-gen types + request-body parser
- FOUND: 5b193d20 — feat(116-01): add hand-rolled token bucket for image-gen rate limiting
- FOUND: fcdc584a — feat(116-01): add OpenAI gpt-image-1 adapter with never-throw contract

**Test suite:** 4 files, 61 tests, all green in ~500ms.
**Type check:** `npx tsc --noEmit -p tsconfig.node.json` clean for image-gen-requests/.

---
*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Completed: 2026-09-18*
