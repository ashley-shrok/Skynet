---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: "04"
subsystem: backend
tags:
  - identity-modal
  - backend
  - bounty
  - json-patch
  - security
  - phase-18
dependency_graph:
  requires:
    - 18-01 (writeMarkdownFileAtomic SFTP helper, IDMEDIT_MAX_MARKDOWN_BYTES)
    - 18-03 (SCRATCH-REPORT.md locked wire contract — meeting_questions shape, deadline format)
  provides:
    - writeIdentityBountyFields (partial-JSON-patch writer, LOCAL + REMOTE branches)
    - IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000 byte-cap constant
    - sftpReadFile private SFTP read helper
    - extended normalizeBounty (source_links / deadline / meeting_questions pass-through)
    - extended Bounty wire type (three new fields)
    - BountyFieldsPatch type (backend local; UI wire type in claude-session-api.ts)
    - IdentityUpdateBountyFieldsPayload + IdentityBountyFieldsUpdatedEvent wire types
    - identity:update-bounty-fields WS handler with identity:bounty-fields-updated echo
  affects:
    - 18-05 (BountyCard field editors — consumes new WS handler + wire types)
tech_stack:
  added: []
  patterns:
    - SFTP tmp+rename via existing writeMarkdownFileAtomic helper (content-agnostic despite name)
    - sftpReadFile private helper mirroring writeMarkdownFileAtomic promise-wrap discipline
    - partial-JSON-patch semantics with ALLOWED_BOUNTY_PATCH_KEYS guard (T-18-17)
    - changedFields derived from allowed-key intersection (not raw Object.keys) to block server-owned-field stomps
    - backend local BountyFieldsPatch type (mirrors UI wire type; tsconfig boundary prevents direct import)
key_files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
decisions:
  - "BountyFieldsPatch duplicated as local type in identity-artifact-reader.ts (not imported from UI api) because tsconfig.node.json backend compilation pulls in browser globals from claude-session-api.ts and fails; local type documented to stay in sync"
  - "meeting_questions shape locked as { text: string; answered: boolean } per SCRATCH-REPORT.md locked wire contract (not { question: string; answered: boolean; answer? } from PLAN.md placeholder — PLAN explicitly said to cross-check the report)"
  - "writeMarkdownFileAtomic reused for SFTP tmp+rename write in writeIdentityBountyFields REMOTE branch — content-agnostic despite the markdown name; no new writeJsonFileAtomic needed"
  - "ALLOWED_BOUNTY_PATCH_KEYS Set used as allowlist for changedFields derivation (T-18-17: prevents client from stomping server-owned fields by sneaking extra keys into patch)"
metrics:
  duration: "~25 minutes"
  completed: "2026-07-31"
  tasks_completed: 3
  files_modified: 3
---

# Phase 18 Plan 04: Backend Bounty-Fields Writer Summary

**One-liner:** Partial-JSON-patch bounty writer (writeIdentityBountyFields) with sftpReadFile, byte-cap, ALLOWED_BOUNTY_PATCH_KEYS guard, normalizeBounty widening, and identity:update-bounty-fields WS handler echoing fresh bounty lists.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend normalizeBounty + Bounty type + wire types | ab3bc07 | identity-artifact-reader.ts, claude-session-api.ts |
| 2 | Add writeIdentityBountyFields writer | bf8c433 | identity-artifact-reader.ts |
| 3 | Add identity:update-bounty-fields WS handler | 58d195d | claude-session-server.ts |

## What Was Built

### Task 1 — Extend normalizeBounty + Bounty type + wire types

Three additive changes:

1. `normalizeBounty` in `identity-artifact-reader.ts` extended with three new pass-through fields using safe defaults (`[]` / `null`) — existing bounty.json files without these fields produce valid Bounty objects on read without any migration:
   - `source_links: Array.isArray(parsed.source_links) ? parsed.source_links : []`
   - `deadline: typeof parsed.deadline === "string" ? parsed.deadline : null`
   - `meeting_questions: Array.isArray(parsed.meeting_questions) ? parsed.meeting_questions : []`

2. `Bounty` type in `claude-session-api.ts` widened with three matching optional fields.

3. New wire types exported from `claude-session-api.ts`:
   - `BountyFieldsPatch` — partial patch shape with all fields optional
   - `IdentityUpdateBountyFieldsPayload` — client→server payload with `patch: BountyFieldsPatch`
   - `IdentityBountyFieldsUpdatedEvent` — server→client echo with fresh `{bounties, archivedBounties}`

### Task 2 — writeIdentityBountyFields writer

New exported function + two supporting additions:

- `IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000` — exported constant alongside `IDMEDIT_MAX_MARKDOWN_BYTES`
- `sftpReadFile(conn, remotePath)` — private SFTP read helper; promise-wraps `conn.sftp → sftp.readFile → sftp.end()` in finally; returns Buffer
- `BountyFieldsPatch` — local type (mirrors UI wire type; tsconfig boundary prevents direct import)
- `ALLOWED_BOUNTY_PATCH_KEYS` — Set of the 7 writable field names; used to derive `changedFields` safely
- `writeIdentityBountyFields(conn, identityKey, bountySlug, patch)`:
  - Upfront pinned rejection guard (throws with "use update-bounty-pinned" message)
  - Per-field type validation before any I/O (title ≤500, premise ≤50000, todos array shape, keywords ≤200 each, source_links ≤2000 each, deadline string|null, meeting_questions array shape)
  - `changedFields` derived from `ALLOWED_BOUNTY_PATCH_KEYS ∩ Object.keys(patch)` — client cannot stomp server-owned fields by sneaking extra keys
  - LOCAL branch: `fs.readFile → JSON.parse → for-loop merge → updated_at bump → timeline appends → byte-cap check → tmp+rename`
  - REMOTE branch: `IDENTITY_KEY_RE + IDENTITY_SLUG_RE gates → execWithTimeout("echo $HOME") → sftpReadFile → JSON merge in Node memory → byte-cap check → writeMarkdownFileAtomic SFTP tmp+rename`

### Task 3 — identity:update-bounty-fields WS handler

Handler block added to `claude-session-server.ts` after `identity:update-bounty-pinned`, before `identity:update-bounty-priority`:

- Imports: `writeIdentityBountyFields`, `BountyFieldsPatch` added to existing identity-artifact-reader import block
- Handler: `IDENTITY_KEY_RE + IDENTITY_SLUG_RE + object-type` guards at handler level; per-field validation inside writer
- LOCAL path: `writeIdentityBountyFields(null,...) → readIdentityBounties(null,...) → ws.send(identity:bounty-fields-updated)`
- REMOTE path: `resolveHostById → connectOneShot → try { writeIdentityBountyFields(conn,...) → readIdentityBounties(conn,...) } finally { conn.end() } → ws.send`
- Error path: `identity:bounty-fields-updated` with `{bounties:[], archivedBounties:[], error: message}`
- Header docblock updated with both new wire strings

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] meeting_questions shape corrected to SCRATCH-REPORT locked contract**
- **Found during:** Task 1 implementation
- **Issue:** PLAN.md placeholder used `{ question: string; answered: boolean; answer?: string | null }` but explicitly said to cross-check the SCRATCH-REPORT. SCRATCH-REPORT locked wire contract (line 119) uses `{ text: string; answered: boolean }` with no `answer` field.
- **Fix:** Changed Bounty type, BountyFieldsPatch, and validation to use `{ text: string; answered: boolean }` matching the SCRATCH-REPORT's locked contract
- **Files modified:** `src/ui/api/claude-session-api.ts` (both Bounty type and BountyFieldsPatch), `src/backend/claude-session/identity-artifact-reader.ts` (BountyFieldsPatch local type + validation)
- **Commit:** Folded into ab3bc07 + bf8c433

**2. [Rule 3 - Blocking] BountyFieldsPatch duplicated as local type instead of cross-repo import**
- **Found during:** Task 2 backend build
- **Issue:** `tsconfig.node.json` includes only `src/backend/**/*.ts` but importing from `src/ui/api/claude-session-api.ts` caused tsc to pull in browser globals (`window`), failing the backend build with TS2304
- **Fix:** Local `BountyFieldsPatch` type in `identity-artifact-reader.ts` with a sync-required comment; PLAN.md explicitly anticipated this as the fallback at lines 203-204
- **Files modified:** `src/backend/claude-session/identity-artifact-reader.ts`
- **Commit:** Folded into bf8c433

## Security Notes

Per threat model:
- **T-18-17:** `ALLOWED_BOUNTY_PATCH_KEYS` Set gates `changedFields` derivation — client cannot stomp `id`, `created_at`, `requested_by` by sneaking extra keys into patch. `updated_at` + `timeline` unconditionally overwritten by server post-merge.
- **T-18-18:** `IDENTITY_SLUG_RE` gate applied at handler AND inside REMOTE branch (defense in depth).
- **T-18-19:** `IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000` byte-cap on serialized post-patch JSON before write on both branches.
- **T-18-22:** `parsed.updated_at = nowIso` and timeline rebuild are unconditional after merge loop — client-supplied `updated_at` in patch is silently dropped.
- **IDMEDIT-08:** `meeting_questions` accepted from any authenticated WS caller; user-reserved-authoring is UI convention only (wire-level guard explicitly rejected by SCRATCH-REPORT.md).

## Known Stubs

None. All fields are fully wired from normalizeBounty → Bounty type → WS handler → writer. No placeholder values.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries beyond what the threat model already covers.

## Self-Check: PASSED

- [x] `src/backend/claude-session/identity-artifact-reader.ts` modified — exists at that path
- [x] `src/backend/claude-session/claude-session-server.ts` modified — exists at that path
- [x] `src/ui/api/claude-session-api.ts` modified — exists at that path
- [x] Commit ab3bc07 exists (`git log --oneline -5` confirmed)
- [x] Commit bf8c433 exists (confirmed)
- [x] Commit 58d195d exists (confirmed)
- [x] `npx tsc --noEmit` exits 0 (verified)
- [x] `npm run build:backend` exits 0 (verified)
