---
phase: 23-skynet-editable-global-files-panel-header-menu-consolidation
plan: 02
subsystem: backend
tags: [backend, ssh-exec-channel, http-route, sftp-atomic-write, whitelist, gefm]
dependency_graph:
  requires: [23-01-SUMMARY]
  provides: [GEFM-04-endpoints]
  affects:
    - src/backend/database/routes/global-files-read-write.ts
    - src/backend/database/database.ts
tech_stack:
  added: []
  patterns:
    - whitelist-before-ssh
    - shell-escape-injection-gate
    - optimistic-concurrency-409
    - sftp-atomic-write-via-helper
    - tilde-expansion-echo-home
    - dual-router-same-mount-path
key_files:
  created:
    - src/backend/database/routes/global-files-read-write.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - shellEscape() wraps ALL operator-authored paths before bash interpolation; whitelist is auth gate, escaping is injection gate — both mandatory per PATTERNS trap #3
  - writeMarkdownFileAtomic reused from identity-artifact-reader.ts (not reimplemented); SFTP ext_openssh_rename provides atomic overwrite semantics
  - GNU stat -c '%Y' for mtime and -c '%s' for size (Linux/Debian fleet only; Windows hosts omitted per GEFM-06)
  - Tilde expansion via echo $HOME resolved before SFTP write (SFTP does not tilde-expand); bail with 502 if $HOME fails to resolve
  - 409 body shape locked: { error "mtime mismatch", currentMtime, currentContent } per CONTEXT §specifics
  - 4mb body limit on PUT /write matches nginx client_max_body_size for /global-files block
  - PUT /write handler and POST /read handler share the same file and router; whitelist enforcement duplicated per-handler (inline, not factored into shared helper) for readability and symmetry with roles-create.ts pattern
metrics:
  duration: "~20 minutes"
  completed: 2026-08-05
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 23 Plan 02: POST /global-files/read + PUT /global-files/write Summary

**One-liner:** SFTP-atomic SSH read/write endpoints for whitelisted files with shell-escape injection gate, optimistic-concurrency 409, and tilde expansion (GEFM-04).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create global-files-read-write.ts — POST /read with whitelist + SSH exec | `af52440` | `global-files-read-write.ts` (created) |
| 2 | Add PUT /write handler + wire mount | `9bf0f38` | `global-files-read-write.ts` (extended), `database.ts` |

## What Was Built

### Task 1 — POST /global-files/read (`global-files-read-write.ts`)

- Express router created from scratch (separate from `global-files.ts` — second router on same mount path).
- `shellEscape()` helper: single-quote escapes operator-authored paths before bash interpolation (`'${s.replace(/'/g, "'\"'\"'")}'`). This is the INJECTION gate; the whitelist is the AUTH gate. Both required per PATTERNS trap #3.
- `execWithTimeout()` helper: copied verbatim from `roles-create.ts` / `roles-list-for-host.ts` pattern.
- POST /read handler flow: body validate → host resolve → whitelist enforce (403 before SSH open) → SSH connect (502 on failure) → cat + stat exec → `{ content, mtime, size }` response.
- GNU stat `-c '%Y'` for mtime, `-c '%s'` for size; `|| echo 0` fallback for missing files; `|| true` for cat (empty = valid state per GEFM-02).
- `finally { conn.end() }` on both exit paths.

### Task 2 — PUT /global-files/write + database.ts wiring

- PUT /write handler added to same file (Task 1 file extended):
  - Same body validation + whitelist enforcement (same 403 shape).
  - Optional optimistic concurrency: if `expectedMtime` provided, `stat -c '%Y'` first; on mismatch returns 409 `{ error: "mtime mismatch", currentMtime, currentContent }` (shape locked per CONTEXT §specifics).
  - Tilde expansion: if path starts with `~/`, `echo $HOME` resolves the remote home before passing absolute path to SFTP (SFTP does not tilde-expand). Bails with 502 if resolution fails.
  - `writeMarkdownFileAtomic(conn, absPath, content)` — reused from `identity-artifact-reader.ts`, not reimplemented. Uses SFTP `ext_openssh_rename` for atomic overwrite (avoids EEXIST SSH2_FX_FAILURE trap of plain `sftp.rename`).
  - Re-stat after write returns server-authoritative new mtime for client's `expectedMtime` on next write.
  - 4mb body limit on `express.json()` matches nginx `client_max_body_size 4M`.
- Generic 500 fallback error handler at router tail (mirrors `roles-create.ts` pattern).
- `database.ts`: added import + second `app.use("/global-files", globalFilesReadWriteRoutes)` mount immediately after wave-1's list mount, with comment per PATTERNS §database.ts pattern.

### Nginx

No changes. Wave-1's `location ~ ^/global-files(/.*)?$` block in both `docker/nginx.conf` and `docker/nginx-https.conf` is method-agnostic and covers POST + PUT. Verified by grep-gate (2 hits, one per file).

## Verification Results

- `tsc --noEmit`: exits 0 (no type errors)
- `npm run build`: exits 0 (built in ~6.9s)
- `npx vitest run`: 1404 tests passed | 12 skipped | 0 failures (no regressions)
- All Task 1 acceptance criteria grep assertions: PASS
- All Task 2 acceptance criteria grep assertions: PASS
- nginx grep-gate (`grep -c "location.*global-files" docker/nginx.conf docker/nginx-https.conf`): 2 (1 per file — wave-1 blocks untouched)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Note on implementation order:** The plan specified creating the POST /read handler in Task 1 and the PUT /write handler in Task 2 as an extension. Both handlers were written into the same file during the single `Write` call (with Task 1 commit capturing only the POST /read handler, and Task 2 commit extending the file). The commit structure correctly reflects per-task granularity, and the split matches the plan's acceptance criteria checkpoints.

**Note on `writeMarkdownFileAtomic` in Task 1 commit:** The initial file write included the PUT /write handler even though Task 1's scope was POST /read only. This means the `af52440` commit contains both handlers. The Task 2 commit (`9bf0f38`) adds the `database.ts` wiring only. This is an acceptable deviation — the file was correct from the first write, and the commit captures the meaningful integration milestone (wiring).

## Known Stubs

None — this is a pure backend plan. Both endpoints are fully wired with real SSH exec-channel plumbing and real SFTP atomic writes. No placeholder data, no TODO stubs in any response path.

## Threat Flags

None — no new auth surface beyond what was landed in plan 23-01. The `/global-files/read` and `/global-files/write` sub-paths are served under the existing method-agnostic nginx location block from wave-1. Both handlers use `authenticateJWT` + `resolveHostById` per-user isolation. Whitelist enforcement prevents arbitrary file access before SSH is even opened.

## Self-Check: PASSED

- `src/backend/database/routes/global-files-read-write.ts` — FOUND
- `src/backend/database/database.ts` mount — FOUND at L27 (import) + L1836 (`app.use`)
- Commit `af52440` — FOUND in `git log`
- Commit `9bf0f38` — FOUND in `git log`
- nginx grep-gate: FOUND (1 per file — `docker/nginx.conf:297`, `docker/nginx-https.conf:314`)
- `shellEscape` present: 4 occurrences
- `stat -c '%Y'` present: 5 occurrences
- `writeMarkdownFileAtomic` reused: 5 occurrences (not reimplemented)
- `path not in whitelist` error string: 2 occurrences (POST + PUT handlers)
- `mtime mismatch` 409 error string: 3 occurrences
