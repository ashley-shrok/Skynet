---
phase: 127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-
plan: "01"
subsystem: spawn-requests
tags: [schema-extension, type-extension, input-validation, tdd]
dependency_graph:
  requires: []
  provides:
    - SpawnRequestBody with roles[]/skills?/prompt
    - PendingBirth with roles[]/skills?/prompt
    - parseRequestBody validates extended schema
    - All in-tree PendingBirth consumers updated
  affects:
    - src/backend/spawn-requests/types.ts
    - src/backend/spawn-requests/parse-request-body.ts
    - src/backend/spawn-requests/worker.ts
    - src/backend/spawn-requests/queue.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
tech_stack:
  added: []
  patterns:
    - D-13 bridge: roles[0] passthrough at BirthOptions.role with TODO comment
    - discriminated union return for validation failures
key_files:
  created: []
  modified:
    - src/backend/spawn-requests/types.ts
    - src/backend/spawn-requests/parse-request-body.ts
    - src/backend/spawn-requests/worker.ts
    - src/backend/spawn-requests/queue.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/spawn-requests/worker.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - "D-12 bridge via roles[0] in BirthOptions.role — multi-role work adopts when BirthOptions is extended"
  - "malformed-branch PendingBirth uses roles:[],prompt:\"\" as empty defaults — malformedReason drives behavior, not these fields"
  - "ssh-poll-orchestrator.test.ts updated under Rule 1 — 4 tests directly broken by parseRequestBody schema change"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-21"
  tasks: 3
  files: 7
---

# Phase 127 Plan 01: TS spawn-requests schema extension Summary

Extended the spawn-requests ingress pipeline to accept the new global-wake-up request-file shape (`{roles:[...], skills:[...], prompt:..., task:null, requested_at:...}`) without rejecting extended bodies as malformed.

## What Changed

### Task 1: types.ts (cdce64c4)

**SpawnRequestBody** — replaced `role: string` with:
- `roles: string[]` — one or more role names (D-12)
- `skills?: string[]` — optional skill slugs (D-04)
- `prompt: string` — first user message to newborn agent (D-05)
- `task: string | null` and `requested_at: string` unchanged

**PendingBirth** — same three fields replace `role: string`. All other fields (`hostId`, `hostIdNum`, `uuid`, `task`, `requested_at`, `userId`, `malformedReason`) preserved verbatim with their existing JSDoc.

Lines changed: +9 / -5

### Task 2: parse-request-body.ts + worker.test.ts (091b3b13)

**parse-request-body.ts** — replaced single-string `role` validation block with:
1. `roles[]` — must be non-empty array; each element non-empty string satisfying `ROLE_NAME_PATTERN`
2. `skills[]` — optional; if present must be array of non-empty strings; no pattern validation
3. `prompt` — required non-empty string; no length cap (D-06)
4. Return body updated to `{ roles, skills: skills as string[] | undefined, prompt, task, requested_at }`

Lines changed: ~+35 / -10

**worker.test.ts** — 13 `parseRequestBody` tests total (7 rewritten + 6 new):
- Test 1: rewritten — valid extended body asserts roles/skills/prompt
- Test 2: unchanged (malformed JSON)
- Test 3: rewritten — "missing roles" (was "missing role")
- Test 4: rewritten — `roles:["INVALID ROLE WITH SPACES"]` (was `role:`)
- Test 5: rewritten — long task uses `roles:[...], prompt:`
- Test 6: rewritten — null task uses `roles:[...], prompt:`
- Test 7: rewritten — missing requested_at uses `roles:[...], prompt:`
- Tests 8-13: new — extended body; empty roles; invalid role element; missing prompt; non-array skills; skills absent
- `makePendingBirth` helper: `role: "coordinator"` → `roles: ["coordinator"], prompt: "test-prompt"`
- All pre-existing test numbers renumbered: mapEndedEventToReason 8-10c → 14-16c; processBirth 11-21 → 17-27

Lines changed: ~+140 / -80

### Task 3: worker.ts + queue.ts + ssh-poll-orchestrator.ts + ssh-poll-orchestrator.test.ts (92c91898)

**worker.ts**:
- `systemLogger.info` at doBirth start: `role: item.role` → `role: item.roles?.[0] ?? "(none)"`, added `roles_count: item.roles?.length ?? 0`
- `BirthOptions.role`: `item.role` → `item.roles[0]` with `// TODO: multi-role — pass full roles[] once BirthOptions accepts it (D-13, RESEARCH Assumption A2)` comment

**queue.ts**:
- `enqueue` log: `role: item.role` → `role: item.roles?.[0] ?? "(none)"`, added `roles_count: item.roles?.length ?? 0`

**ssh-poll-orchestrator.ts `parseSpawnRequestBatch`**:
- Malformed branch: `role: ""` → `roles: [], prompt: ""`  (on one line per acceptance-criteria grep)
- Happy path: `role: parsed.body.role` → `roles: parsed.body.roles, skills: parsed.body.skills, prompt: parsed.body.prompt`

Lines changed: +12 / -8

**ssh-poll-orchestrator.test.ts** (Rule 1 auto-fix — 4 tests broken by parseRequestBody schema change):
- "valid request file" test: body `role:` → `roles:[...], prompt:`, assertion `item.role` → `item.roles`/`item.prompt`
- "malformed JSON" test: `item.role === ""` → `item.roles === []`, `item.prompt === ""`
- "role failing ROLE_NAME_PATTERN" test: body `role:` → `roles:[...]`, renamed test
- "multiple valid request files" test: both bodies `role:` → `roles:[...], prompt:`

Lines changed: +10 / -6

## Tests Added / Rewritten

| Describe block | Tests before | Tests after | Notes |
|----------------|-------------|-------------|-------|
| parseRequestBody | 7 | 13 | Tests 1,3,4,5,6,7 rewritten; Tests 8-13 new |
| mapEndedEventToReason | 5 | 5 | Renumbered only (14-16c) |
| processBirth | 13+ | 13+ | Renumbered only (17-27) |
| ssh-poll-orchestrator scan helpers | 4 (spawn-request) | 4 | Updated to new schema |

Final `npx vitest run src/backend/spawn-requests/ src/backend/fleet-status/`: **22 test files, 622 tests, 0 failures**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ssh-poll-orchestrator.test.ts broken by parseRequestBody schema change**
- **Found during:** Task 3 test run
- **Issue:** 4 tests in ssh-poll-orchestrator.test.ts constructed spawn-request bodies with the old `role:` single-string field and asserted on `item.role` — these failed once parseSpawnRequestBatch stopped producing `role:` on PendingBirth
- **Fix:** Updated body construction to `roles:[...], prompt:` and assertions to `item.roles`/`item.prompt`; renamed "role failing ROLE_NAME_PATTERN" test to "roles element failing ROLE_NAME_PATTERN"
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`
- **Commit:** 92c91898 (included in Task 3 commit)

## TODO Markers Left in Code

Exactly one, per D-13 design:
```
src/backend/spawn-requests/worker.ts:
  role: item.roles[0], // TODO: multi-role — pass full roles[] once BirthOptions accepts it (D-13, RESEARCH Assumption A2)
```

## Threat Model Coverage

T-127-01-T (Tampering — roles[] content): mitigated — per-element ROLE_NAME_PATTERN validation applied; empty arrays rejected.
T-127-01-T2 (Tampering — prompt): mitigated — non-empty string required; no length cap per D-06.
T-127-01-T3 (Tampering — skills[]): mitigated — elements validated as non-empty strings; no pattern validation (deferred per threat register).

## Known Stubs

None — all consumers wired to actual parsed data; no placeholder values reach workers.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes at trust boundaries beyond what the plan's threat model covers.

## Self-Check: PASSED

- [x] `src/backend/spawn-requests/types.ts` modified and committed (cdce64c4)
- [x] `src/backend/spawn-requests/parse-request-body.ts` modified and committed (091b3b13)
- [x] `src/backend/spawn-requests/worker.ts` modified and committed (92c91898)
- [x] `src/backend/spawn-requests/queue.ts` modified and committed (92c91898)
- [x] `src/backend/fleet-status/ssh-poll-orchestrator.ts` modified and committed (92c91898)
- [x] `src/backend/spawn-requests/worker.test.ts` modified and committed (091b3b13)
- [x] `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` modified and committed (92c91898)
- [x] 22 test files, 622 tests, 0 failures
- [x] `grep -c "roles: string\[\]" types.ts` = 2
- [x] `grep -c "prompt: string" types.ts` = 2
- [x] `grep -c "skills?: string\[\]" types.ts` = 2
- [x] No non-comment `role: string` lines in types.ts
- [x] `grep -c "item\.roles\[0\]" worker.ts` = 1
- [x] `grep -q "TODO: multi-role" worker.ts` exits 0
- [x] `grep -c "roles: parsed\.body\.roles" ssh-poll-orchestrator.ts` = 1
- [x] `grep -c 'roles: \[\], prompt: ""' ssh-poll-orchestrator.ts` = 1
