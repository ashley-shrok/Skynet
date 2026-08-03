---
phase: 20-identity-creation-ui
plan: "01"
subsystem: backend
tags: [avatar, openai, gpt-image-1, gamma, nginx, identity]
dependency_graph:
  requires: []
  provides:
    - POST /identities/avatar/batch
    - GET /identities/avatar/candidate/:id
  affects:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
tech_stack:
  added:
    - sharp@^0.34.5 (already present; used for raw pixel gamma correction)
    - nanoid (already present; used for candidate ID generation)
  patterns:
    - In-memory candidate cache with TTL (10 min) and userId scope guard
    - Raw pixel gamma correction via sharp raw decode/encode cycle
    - Promise.all for parallel gpt-image-1 calls
    - AbortController per fetch call (30s archetype, 60s image gen)
    - No-body-leak 502 error handling (T-16-03 mirror)
key_files:
  created:
    - src/backend/database/routes/identity-avatar-batch.ts
    - src/backend/database/routes/identity-avatar-batch.test.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "Use raw pixel manipulation for gamma 0.7 (not sharp.gamma()) because sharp's .gamma(g) does sRGB linearization, not a plain power curve; verified output: 128 -> 157 matching Python numpy reference"
  - "Gamma parameter 1/0.7 passed to sharp would apply sRGB decode + re-encode which produces wrong results; raw Math.pow(v/255, 0.7)*255 matches runbook recipe exactly"
  - "Mount /identities/avatar BEFORE /identities in both express and nginx to ensure more-specific path wins"
metrics:
  duration: "~25 minutes"
  completed: "2026-08-03"
  tasks_completed: 3
  files_changed: 5
---

# Phase 20 Plan 01: Identity Avatar Batch Backend Summary

Backend LLM-archetype-draft + 3-parallel-gpt-image-1 + gamma-0.7-corrected candidate pipeline
with in-memory TTL cache, BOTH nginx configs updated.

## What Was Built

### POST /identities/avatar/batch
- Accepts `{ name, title, brief }` JSON body
- Validates all 3 required non-empty (400 otherwise)
- Checks `OPENAI_API_KEY` at request time — 503 with `{error: "OpenAI not configured"}` if missing; does NOT crash on boot
- Step 1: calls `POST https://api.openai.com/v1/chat/completions` (gpt-4o-mini, 30s AbortController) with MOBA-champion archetype system prompt (inline, derived from avatar-flow runbook §2-3)
- Step 2: fires 3 parallel `POST https://api.openai.com/v1/images/generations` (gpt-image-1, n=1, 1024x1024, quality=high, 60s AbortController each) via `Promise.all`
- Step 3: applies gamma 0.7 to each returned PNG via raw pixel manipulation
- Step 4: stores 3 corrected images in module-level `Map<string, CandidateEntry>` keyed by nanoid(), scoped to userId
- Step 5: returns `{ candidates: [{ id, url }, ...] }` — 3 candidates

### GET /identities/avatar/candidate/:id
- Authenticates via JWT, scopes by userId
- Returns 404 `{ error: "candidate expired" }` if: id not found, TTL exceeded (10 min), or userId mismatch
- Returns 200 with `Content-Type: image/png` bytes on success

### Nginx
- Both `docker/nginx.conf` and `docker/nginx-https.conf` have `location ~ ^/identities/avatar(/.*)?$` declared BEFORE `location ~ ^/identities(/.*)?$`
- `client_max_body_size 8M`, `proxy_read_timeout 120s` (gpt-image-1 batch can take ~90s)

## Confirmed Details

### Sharp Installation
Sharp version `^0.34.5` was already present in `package.json` (line 166). No new install needed.

### OPENAI_API_KEY Handling
Route reads `process.env.OPENAI_API_KEY` at request time (not at boot). If missing:
```
503 { error: "OpenAI not configured" }
```
Server does not crash on startup if the key is absent.

### Cache TTL
`CANDIDATE_TTL_MS = 10 * 60 * 1000` (10 minutes). Matches D-CONTEXT §Avatar spec.

### Gamma Correction
The plan stated `(128/255)^0.7 * 255 ≈ 177`. The correct value is **≈ 157**, confirmed by:
- Python numpy: `np.power(128/255, 0.7) * 255 = 157.40`
- Node implementation: `Math.round(Math.pow(128/255, 0.7) * 255) = 157`

Implementation uses raw pixel manipulation (NOT `sharp.gamma()`):
```typescript
data[i] = Math.round(Math.pow(data[i] / 255, 0.7) * 255);
```

`sharp.gamma(g)` applies sRGB linearization (not a plain power curve) — `gamma(1.4286)` for input 128 produces 127 (essentially no-op for this value) rather than the expected 157. The manual approach matches the Python+numpy runbook recipe exactly.

Sharp's `.gamma(1/0.7)` was tested and found to apply linear-light colorspace transforms, NOT the `output = input^0.7` plain power curve the runbook specifies. Raw manipulation is the correct implementation.

### Archetype System Prompt
System prompt is inline in the route file, derived from avatar-flow runbook §2-3:
- Starts with the MOBA-champion cel-shaded portrait anchor
- Specifies tight head-and-shoulders, distinct silhouette, domain-sigil mark
- Includes "SATURATED GLOWING LUMINOUS BRIGHT THICK BOLD" directives (avoids softening modifiers per runbook trap list)
- No user-visible prompt — prompt is a black box per D-CONTEXT §Regen semantics

The system prompt is intentionally opinionated toward the fleet aesthetic. Plan 05 should note that regeneration variance comes from the LLM re-drafting from the same name+title+brief inputs (not same-prompt-different-seeds), so variance per-regen is genuine.

### No Push / Build / Deploy
No `git push`, `docker build`, or `docker compose` was invoked. Container stays at `sha256:07547f6c4185` per held-queue posture.

## Tests

All 11 tests pass:
- Test 1: 3 candidates with distinct IDs and matching URL pattern
- Test 2: archetype draft called exactly once per request
- Test 3: all 3 image gens receive the same prompt (the archetype draft output)
- Test 4: gamma correction spot-check — 128 -> 157 (±3 tolerance)
- Test 5: TTL expiry — 200 within 10 min, 404 after `vi.advanceTimersByTime(601_000)`
- Test 6: userId scope guard — User B gets 404 for User A's candidates
- Test 7: 401 without JWT, fetch not called
- Test 8: 502 with `{error: "avatar generation failed"}` on image-gen non-2xx, no upstream body leak
- Test 9 (3 sub-tests): 400 on empty name / empty title / empty brief

Testing approach: direct express app + Node `http.request()` (not supertest — not in project deps). Auth middleware mocked via `vi.mock("../../utils/auth-manager.js")`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] sharp.gamma(1/0.7) does not produce output = input^0.7**
- **Found during:** Task 2 (GREEN phase, Test 4 gamma spot-check)
- **Issue:** Plan said to use `sharp(pngBuffer).gamma(1/0.7).png().toBuffer()`. Sharp's `.gamma(g)` applies sRGB linearization transforms, not a plain power curve. For input=128, `sharp.gamma(1.4286)` returned 127 (essentially no-op) instead of the expected ~157.
- **Fix:** Implemented gamma 0.7 via raw pixel manipulation: `sharp(pngBuffer).raw() → Math.pow(v/255, 0.7)*255 → sharp(raw).png()`. This matches the Python numpy reference recipe exactly.
- **Files modified:** `src/backend/database/routes/identity-avatar-batch.ts`, `src/backend/database/routes/identity-avatar-batch.test.ts`
- **Commit:** 6316699

**2. [Rule 1 - Bug] Plan's stated gamma output value is incorrect**
- **Found during:** Task 2 (Green phase)
- **Issue:** Plan stated `(128/255)^0.7 * 255 ≈ 177` in the Test 4 acceptance criteria. Actual value is ≈ 157.4 (verified via Python numpy and Node Math.pow). Test expectations updated to `[155, 160]` range.
- **Fix:** Updated test expectations to the correct value; documented the deviation in test code.
- **Files modified:** `src/backend/database/routes/identity-avatar-batch.test.ts`
- **Commit:** 6316699

**3. [Rule 3 - Blocker] TypeScript error on req.params.id**
- **Found during:** Task 2 (npm run build:backend check)
- **Issue:** Express 5 types: `req.params.id` returns `string | string[]`, not `string`. `candidateCache.get(id)` required `string`.
- **Fix:** Changed to `const id = String(req.params.id)` mirroring the pattern in `identities.ts` (L286: `const id = String(req.params.id)`).
- **Files modified:** `src/backend/database/routes/identity-avatar-batch.ts`
- **Commit:** 6316699

**4. [Rule 3 - Blocker] Missing OPENAI_API_KEY in test environment**
- **Found during:** Task 2 test run
- **Issue:** Tests returned 503 because `process.env.OPENAI_API_KEY` was not set in test environment.
- **Fix:** Added `process.env.OPENAI_API_KEY = "test-key-not-real"` in `beforeEach` and cleanup in `afterEach`.
- **Files modified:** `src/backend/database/routes/identity-avatar-batch.test.ts`
- **Commit:** 6316699

## Threat Flags

No new threat surface beyond what was planned. The route:
- Requires JWT authentication (no unauthed paths)
- Does not persist the `brief` field anywhere
- Does not leak OpenAI error responses
- Scopes candidate cache by userId

## Known Stubs

None. The implementation is fully wired to OpenAI APIs. The actual API key must be populated via `OPENAI_API_KEY` env in the running container before the route is functional (documented in plan `user_setup`).

## Self-Check: PASSED

Files exist:
- `src/backend/database/routes/identity-avatar-batch.ts` — FOUND
- `src/backend/database/routes/identity-avatar-batch.test.ts` — FOUND
- `docker/nginx.conf` location block — FOUND (line 211)
- `docker/nginx-https.conf` location block — FOUND (line 222)
- `src/backend/database/database.ts` — import + mount at 2 locations — FOUND

Commits exist:
- a086d74: test(20-01): add failing tests — FOUND
- 6316699: feat(20-01): implement identity-avatar-batch router — FOUND
- e9fc3b2: feat(20-01): add nginx location blocks — FOUND

Build:
- `npm run build:backend` exits 0 — VERIFIED
- All 11 tests pass — VERIFIED
