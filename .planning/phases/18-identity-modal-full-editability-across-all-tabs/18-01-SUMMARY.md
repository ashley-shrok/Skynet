---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: "01"
subsystem: identity-backend
tags:
  - identity-modal
  - backend
  - atomic-write
  - sftp
  - security
  - phase-18
dependency_graph:
  requires: []
  provides:
    - writeIdentityFile
    - writeIdentityHistory
    - writeIdentityHandoff
    - writeMarkdownFileAtomic
    - IDMEDIT_MAX_MARKDOWN_BYTES
    - identity:update-identity-file WS handler
    - identity:update-history WS handler
    - identity:update-handoff WS handler
    - IdentityUpdateIdentityFilePayload
    - IdentityIdentityFileUpdatedEvent
    - IdentityUpdateHistoryPayload
    - IdentityHistoryUpdatedEvent
    - IdentityUpdateHandoffPayload
    - IdentityHandoffUpdatedEvent
  affects:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
tech_stack:
  added: []
  patterns:
    - SFTP tmp+rename atomic write via ssh2 SFTPWrapper (mirrors file-manager-session.ts idiom)
    - promise-wrapped conn.sftp() → sftp.writeFile(tmp) → sftp.rename(tmp, target)
    - Buffer.byteLength byte-cap before SFTP open (mirrors SPEAK_TEXT_MAX pattern)
    - IDENTITY_KEY_RE double-belt validation (handler layer + writer REMOTE branch)
key_files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
decisions:
  - SFTP over execCommand for markdown writes — execCommand in tmux-helper.ts does not support stdin; SFTP streams bytes as a first-class channel with no shell interpolation on payload (D-IDMEDIT-06 / T-18-02)
  - Full-file overwrite semantics — contents carries the full markdown; server writes it atomically; echo returns confirmed server-side content (D-IDMEDIT-01/02/03 shape lock)
  - echo-entries for history:update — HistoryTab already renders entries: string[]; re-reading via readIdentityHistory after write keeps the wire shape consistent with identity:history event
  - IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 — 2MB cap is generous for identity files (~40KB actual) while capping DoS; mirrors SPEAK_TEXT_MAX pattern from voice.ts
metrics:
  duration: "~25 min"
  completed: "2026-07-31"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 3
---

# Phase 18 Plan 01: Shared Atomic-Write Primitive Summary

SFTP tmp+rename atomic writers for the three markdown identity artifacts (identity file, history, handoff) with WS handlers and wire types — backbone for all Phase 18 markdown-tab UI plans.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | writeIdentityFile/History/Handoff + SFTP helper + IDMEDIT_MAX_MARKDOWN_BYTES to identity-artifact-reader.ts | 09fff52 |
| 2 | Three WS handlers (identity:update-identity-file/history/handoff) with fresh-echo to claude-session-server.ts | cd1afc9 |
| 3 | Six wire types to claude-session-api.ts | 58acd1e |

## What Was Built

### identity-artifact-reader.ts additions

- `export const IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000` — module-level byte-cap const
- `type SFTPWrapper = import("ssh2").SFTPWrapper` — inline type import (no new dep)
- `async function writeMarkdownFileAtomic(conn, targetPath, contents)` — private SFTP helper: promise-wraps `conn.sftp()` → `sftp.writeFile(tmp, buf, {mode:0o644})` → `sftp.rename(tmp, target)` with `try/finally sftp.end()` and best-effort `sftp.unlink(tmp)` on error
- `export async function writeIdentityFile(conn, identityKey, contents)` — LOCAL: `fs.writeFile(tmp) + fs.rename(tmp, target)` (mirrors writeIdentityWakeupUpdate lines 713-718); REMOTE: IDENTITY_KEY_RE gate + byte-cap check + `echo $HOME` path resolve + `writeMarkdownFileAtomic`
- `export async function writeIdentityHistory(conn, identityKey, contents)` — same shape, `history.md` target
- `export async function writeIdentityHandoff(conn, identityKey, contents)` — same shape, `handoff.md` target

### claude-session-server.ts additions

Three WS handler blocks inserted after `identity:update-wakeup`, before `identity:archive-bounty`:

- `identity:update-identity-file` → `writeIdentityFile` → re-read via `readIdentityFile` → emit `identity:identity-file-updated { markdown }`
- `identity:update-history` → `writeIdentityHistory` → re-read via `readIdentityHistory` → emit `identity:history-updated { entries }` (parsed entries, mirrors HistoryTab wire shape)
- `identity:update-handoff` → `writeIdentityHandoff` → re-read via `readIdentityHandoff` → emit `identity:handoff-updated { markdown }`

Each handler: IDENTITY_KEY_RE gate on identityKey, string guard on contents, useLocal branching, resolveHostById + connectOneShot for REMOTE with try/finally conn.end(), error-echo on catch (same convention as update-wakeup).

### claude-session-api.ts additions

Six new type exports with JSDoc referencing IDMEDIT_MAX_MARKDOWN_BYTES and 2MB cap:
- `IdentityUpdateIdentityFilePayload` / `IdentityIdentityFileUpdatedEvent`
- `IdentityUpdateHistoryPayload` / `IdentityHistoryUpdatedEvent` (entries: string[])
- `IdentityUpdateHandoffPayload` / `IdentityHandoffUpdatedEvent`

## Security Posture

| Threat | Mitigation | Location |
|--------|------------|----------|
| T-18-01: path traversal via identityKey | IDENTITY_KEY_RE.test(rawKey) at handler | claude-session-server.ts, each handler |
| T-18-02: path traversal in REMOTE branch | IDENTITY_KEY_RE.test(identityKey) inside each writer REMOTE branch | identity-artifact-reader.ts |
| T-18-03: DoS via unbounded payload | Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES throws before SFTP open | identity-artifact-reader.ts REMOTE branch |
| T-18-06: mid-write crash leaves truncated file | tmp+rename on both LOCAL (fs.rename) and REMOTE (sftp.rename) | identity-artifact-reader.ts |
| T-18-07: SFTP handle leak on error | try/finally sftp.end() + fire-and-forget sftp.unlink(tmp) | writeMarkdownFileAtomic |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan delivers backend primitives only. No UI consumers wired yet (Plan 02 handles that).

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary crossings beyond what the threat model already covers.

## Self-Check

### Created files exist:
- No new files created (only modifications)

### Modified files exist:
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts` — FOUND
- `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` — FOUND
- `/home/ubuntu/skynet/src/ui/api/claude-session-api.ts` — FOUND

### Commits exist:
- 09fff52 — FOUND
- cd1afc9 — FOUND
- 58acd1e — FOUND

## Self-Check: PASSED
