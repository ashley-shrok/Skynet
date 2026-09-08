---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "02"
subsystem: backend-runbooks-editor
tags: [backend, ssh, express, router, runbooks, role-scoped]
dependency_graph:
  requires: [89-01]
  provides: [runbooks-editor-routes, runbooks-editor-nginx, runbooks-editor-mount]
  affects: [database.ts, nginx.conf, nginx-https.conf]
tech_stack:
  added: []
  patterns:
    - SSH-per-request lifecycle (connectOneShot — reused from skills-editor, no new pool)
    - Role-scoped path-safety gate (ROLE_NAME_RE + RUNBOOK_NAME_RE + isSafeRelativePath before SSH)
    - D-15 role-existence check pattern (separate exec to avoid masking role-missing as empty)
    - mtime-409 optimistic concurrency lock (byte-identical to skills-editor shape)
key_files:
  created:
    - src/backend/database/routes/runbooks-editor.ts
    - src/backend/database/routes/runbooks-editor.test.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - D-15: role-existence check uses a separate exec (test -d roleRoot && echo ok || echo missing) rather than relying on find's 2>/dev/null — this keeps the 404-role-not-found path distinct from the 200-empty-list path
  - D-16: ROLE_NAME_RE and RUNBOOK_NAME_RE are both anchored /^[a-zA-Z0-9._-]{1,128}$/ — identical shape to SKILL_NAME_RE; all three gates fire before resolveHostById + connectOneShot
  - D-17: same SSH connection pool as skills-editor (connectOneShot import from ../../ssh/ssh-one-shot.js) — no parallel pool opened
  - detectIsText fix: file-header accidentally used an empty string for the U+FFFD check instead of the actual replacement character; fixed before tests ran
metrics:
  duration: ~35 minutes
  completed: "2026-09-08"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 3
---

# Phase 89 Plan 02: Backend /runbooks-editor router — 7 endpoints, tests, nginx + mount

Role-scoped runbook-editing backend: Express router exposing 7 SSH-backed endpoints keyed on `(hostId, roleName, runbookName, [path])`, with D-15 role-existence check, D-16 three-layer path-safety gate, 55-test vitest coverage file, database.ts mount, and matching nginx location blocks in both HTTP and HTTPS conf files.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create runbooks-editor.ts router | 80bff4b0 | src/backend/database/routes/runbooks-editor.ts |
| 2 | Create runbooks-editor.test.ts + fix detectIsText | 408c8e8d | src/backend/database/routes/runbooks-editor.test.ts, runbooks-editor.ts |
| 3 | Mount in database.ts + nginx location blocks | 03e5cd16 | src/backend/database/database.ts, docker/nginx.conf, docker/nginx-https.conf |

## What Was Built

### Task 1: runbooks-editor.ts (1534 lines)

Express router with 7 endpoints mirroring `skills-editor.ts` shape with three structural adaptations:

1. **Role dimension**: requests carry `(hostId, role, runbook, [path])`. Runbooks live at `~/.claude/roles/<role>/runbooks/<runbook>/...` on the remote host.
2. **D-15 role-existence check**: every handler that touches runbooks runs `test -d <roleRoot> && echo ok || echo missing` as a SEPARATE exec before any runbook I/O, so a missing role returns 404 `{error:"role not found"}` rather than silently appearing as an empty runbook list.
3. **Wider path-safety gate**: `ROLE_NAME_RE` + `RUNBOOK_NAME_RE` + `isSafeRelativePath` — all three fire BEFORE `resolveHostById` + `connectOneShot`. Belt-and-suspenders `absPath.startsWith(runbookRoot + "/")` prefix assertion for read/write/delete-file. Life-critical three-assertion block for DELETE /runbook (`includes("/runbooks/")` + `endsWith("/${runbook}")` + no `..`).

All 7 endpoints:
- `GET /runbooks` — lists runbook subfolders; empty-state when runbooks dir missing; 404 when role missing
- `GET /files` — recursively lists files in a runbook; empty-state when runbook dir missing; 404 when role missing
- `POST /read` — returns `{content, mtime, size, isText}`; content is `""` for binary
- `PUT /write` — atomic write with mtime-409 optimistic concurrency lock (byte-identical to skills-editor)
- `POST /create` — creates new file; 409 if exists; 404 if runbook folder absent (no implicit scaffolding)
- `DELETE /file` — idempotent rm -f; 404 when role missing
- `DELETE /runbook` — rm -rf with three-layer belt-and-suspenders assertion; 404 when role missing

Structured sshLogger entries at every SSH lifecycle boundary per log-first diagnostics rule.

### Task 2: runbooks-editor.test.ts (1217 lines)

Vitest coverage mirroring `skills-editor.test.ts` shape (bare Express + Node http, no supertest):

- 9 describe blocks (8 endpoint blocks + 1 SEC path-safety block)
- 55 individual `it()` tests
- 14 SEC-labeled path-traversal tests — each asserts `expect((connectOneShot as Mock).mock.calls).toHaveLength(0)` proving the gate fires before SSH connect
- Role-404 case covered on 4+ endpoints (D-15 contract)
- mtime-409 UX asserted on PUT /write
- All 55 tests pass

### Task 3: database.ts mount + nginx location blocks

- `database.ts`: import `runbooksEditorRoutes` + `app.use("/runbooks-editor", runbooksEditorRoutes)` alongside the skills-editor pair (2 lines added)
- `docker/nginx.conf`: `location ~ ^/runbooks-editor(/.*)?$` block after skills-editor block (proxy_read_timeout 15s, client_max_body_size 4M)
- `docker/nginx-https.conf`: byte-identical block at mirror site (parity enforced — missing in HTTPS conf would cause index.html 200 in production, crashing the frontend's `.map` call)
- Parity diff between the two conf blocks: empty

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] detectIsText U+FFFD check was empty string**
- **Found during:** Task 2 (first test run — POST /read returning isText:false for plain text)
- **Issue:** The `detectIsText` function's check `decoded.includes("")` was an empty string literal rather than the U+FFFD replacement character (U+FFFD = `�`). Empty string `.includes("")` always returns true, so every file appeared binary (content: "").
- **Fix:** Changed the string literal to the actual Unicode replacement character `"&#xFFFD;"` (byte sequence `\xef\xbf\xbd`). Verified the fix matches the skills-editor.ts implementation.
- **Files modified:** src/backend/database/routes/runbooks-editor.ts
- **Commit:** 408c8e8d (bundled with Task 2 test commit)

**2. [Rule 1 - Bug] Test file-ordering assumption mismatch**
- **Found during:** Task 2 first test run — GET /files test expected alphabetical order
- **Issue:** The mock's `execCommand` returns `"runbook.md\navatar-prompts/amelia.md\n"` in that order. The backend doesn't re-sort in JS (sorting is delegated to the shell `| sort`). The test expected alphabetical order `[avatar-prompts/amelia.md, runbook.md]` but the mock output is unsorted.
- **Fix:** Adjusted test expectation to match mock output order (which is what the router produces from the mocked exec). Added a comment explaining the sort is mocked via execCommand.
- **Files modified:** src/backend/database/routes/runbooks-editor.test.ts
- **Commit:** 408c8e8d

## Self-Check

```bash
# Files exist
[ -f "src/backend/database/routes/runbooks-editor.ts" ] && echo "FOUND: runbooks-editor.ts"
[ -f "src/backend/database/routes/runbooks-editor.test.ts" ] && echo "FOUND: runbooks-editor.test.ts"

# Commits exist
git log --oneline --all | grep -q "80bff4b0" && echo "FOUND: 80bff4b0"
git log --oneline --all | grep -q "408c8e8d" && echo "FOUND: 408c8e8d"
git log --oneline --all | grep -q "03e5cd16" && echo "FOUND: 03e5cd16"
```
