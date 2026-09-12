---
phase: 107-hide-identity-rows-via-disk-sentinel
plan: 01
subsystem: infra
tags: [ssh, sftp, per-identity-file, sentinel, hidden, whitelist, tdd]

requires:
  - phase: 105-pin-sentinel-migration
    provides: per-identity-file primitive (writeIdentityFile / removeIdentityFile / identityFileExists) + ALLOWED_REL_PATHS whitelist foundation

provides:
  - ALLOWED_REL_PATHS whitelist extended to include ".hidden" (three entries: relay.json, .pinned, .hidden)
  - writeIdentityFile / removeIdentityFile / identityFileExists now accept ".hidden" relPath through same LOCAL/REMOTE branches, same gates, same audit surface as ".pinned"
  - Ten H-01..H-10 primitive contract tests locking whitelist admission, whitelist bound preservation, LOCAL/REMOTE write/remove/exists cycles, zero-byte body preservation, no-chmod invariant, identityKey gate parity

affects: [107-02-backend-fanout, 107-03-schema-migration, 107-04-frontend-rewire]

tech-stack:
  added: []
  patterns:
    - "Single-entry ALLOWED_REL_PATHS whitelist extension — one Set literal addition, no new function, no new gate, no new export"
    - "TDD RED/GREEN: failing tests committed first (H-01..H-10 fail at assertValidRelPath); whitelist entry committed second; both commits on feat/tab-title-from-tmux"

key-files:
  created: []
  modified:
    - src/backend/claude-session/per-identity-file.ts
    - src/backend/claude-session/per-identity-file.test.ts

key-decisions:
  - "ALLOWED_REL_PATHS extended by one Set entry (.hidden) — no new function, no new export, no new gate; all three primitive exports accept the new relPath through existing branches unchanged"
  - "Test 2 (whitelist-size assertion) updated from size==2 to size==3 and adds .hidden membership check — correctly reflects the new intentional state; also updates the test description string to name all three entries"
  - "H1 lock preserved: IDENTITY_KEY_RE imported (not redefined), Test 11 .source+.flags assertion unchanged"

requirements-completed: [D-01, SC-1]

duration: ~4min
completed: 2026-09-12T14:37:44Z
---

# Phase 107 Plan 107-01: ALLOWED_REL_PATHS extended to include `.hidden` Summary

**Single-line whitelist addition: `".hidden"` added to `ALLOWED_REL_PATHS` in `per-identity-file.ts`, plus ten H-01..H-10 primitive contract tests mirroring the `.pinned` test coverage — Plan 02 unblocked to wire the backend fanout and disk-probe read path for the hidden sentinel.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-12T14:34:33Z
- **Completed:** 2026-09-12T14:37:44Z
- **Tasks:** 1 (TDD RED + GREEN)
- **Files modified:** 2

## Accomplishments

- **ALLOWED_REL_PATHS widened:** `per-identity-file.ts` Set now contains three entries: `"relay.json"`, `".pinned"`, `"`.hidden"`. Module-header docblock updated to name all three; ALLOWED_REL_PATHS docblock updated to attribute Phase 107 Plan 107-01.
- **Ten new H-01..H-10 tests added** to `per-identity-file.test.ts` in a `Phase 107 Plan 107-01: .hidden sentinel primitive coverage` describe block. All 38 tests pass (10 new + 28 pre-existing).
- **No function body touched:** `writeIdentityFile`, `removeIdentityFile`, `identityFileExists`, `assertValidRelPath`, `assertValidIdentityKey`, `localTargetPath`, `remoteTargetPath`, `removeRemoteFileIdempotent`, `remoteStatExists`, `isEnoent` — all unchanged. The gate at `assertValidRelPath` reads the Set dynamically; adding an entry requires no code change there.
- **Backend build clean:** `npm run build:backend` (`tsc -p tsconfig.node.json`) exits 0.

## Task Commits

1. `1c608ec7` (test) — RED: 10 failing H-01..H-10 tests for `.hidden` sentinel coverage (fail at `assertValidRelPath` with "invalid relPath — allowed: relay.json, .pinned")
2. `c0ae295b` (feat) — GREEN: `".hidden"` added to ALLOWED_REL_PATHS; Test 2 size assertion updated from 2→3; all 38 tests pass; backend build clean

## Files Modified

- **`src/backend/claude-session/per-identity-file.ts`** — ALLOWED_REL_PATHS Set extended by one entry (`".hidden"`). Module-header docblock "two" → "three", name `.hidden` alongside the others. ALLOWED_REL_PATHS docblock updated to attribute Phase 107. Diff: ~10 lines (Set entry + docblock), no function body touched.
- **`src/backend/claude-session/per-identity-file.test.ts`** — 335 new lines: `Phase 107 Plan 107-01: .hidden sentinel primitive coverage` describe block with ten `it(...)` bodies (H-01..H-10). Also: header comment `(T2)` updated "two" → "three"; Test 2 `it` description updated + size assertion 2→3 + `.hidden` membership check added.

## Four Contracts Locked by H-01..H-10

| Contract | Tests | Description |
|----------|-------|-------------|
| Whitelist admission | H-01 | writeIdentityFile / removeIdentityFile / identityFileExists all accept ".hidden"; no "invalid relPath" throw |
| Whitelist bound preservation | H-02 | ".hidden.old", "hidden" (no dot), ".hiddenx" still throw "invalid relPath"; Set-membership discipline confirmed |
| LOCAL/REMOTE write/remove/exists cycles | H-03..H-08 | LOCAL: fs.writeFile + fs.rename (tmp→final), empty body, correct path; REMOTE: writeMarkdownFileAtomic + $HOME literal + zero-byte buffer; remove idempotent (ENOENT/SSH_FX_NO_SUCH_FILE swallowed); exists fail-closed (stat error → false) |
| Zero-byte body + no-chmod + identityKey gate parity | H-03, H-09, H-10 | Empty string passes unchanged (H-03); no execCommand/fs.chmod when opts.chmod omitted (H-09); uppercase/dot/slash/empty keys still throw at assertValidIdentityKey before any whitelist gate (H-10) |

## Grep-Hygiene Snapshot

| Check | Result | Expected |
|-------|--------|----------|
| `grep -c '".hidden"' src/backend/claude-session/per-identity-file.ts` | 3 | >= 1 |
| `grep -c '".pinned"' src/backend/claude-session/per-identity-file.ts` | 3 | unchanged (still present) |
| `grep -c '"relay.json"' src/backend/claude-session/per-identity-file.ts` | 3 | unchanged (still present) |
| `grep -c '".hidden"' src/backend/claude-session/per-identity-file.test.ts` | 37 | >= 10 |
| `git diff HEAD~1 src/backend/claude-session/per-identity-file.ts` line count | ~25 lines | <= ~5 behavioral lines (Set entry + docblock) — confirmed minimal |

## Plan 02 Unblocked

`writeIdentityFile(k, ".hidden", "", { hostId, conn })` — ready as the hidden-fanout write path (PUT /user-preferences).
`removeIdentityFile(k, ".hidden", { hostId, conn })` — ready as the hidden-fanout remove path.
`identityFileExists(k, ".hidden", { hostId, conn })` — ready as the per-identity disk-probe read path (GET /identities `hidden: boolean` field).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 2 whitelist-size assertion updated 2→3**

- **Found during:** GREEN phase (after adding `.hidden` to ALLOWED_REL_PATHS)
- **Issue:** The pre-existing Test 2 asserted `expect(ALLOWED_REL_PATHS.size).toBe(2)` — which correctly locked the whitelist size before this plan's extension. After adding `.hidden`, the Set has 3 entries and this assertion fails. The plan's intent is to have a test that locks the whitelist to exactly the current set of entries — so the assertion must be updated to reflect the new intentional state.
- **Fix:** Updated Test 2 `it` description from "whitelist is exactly {relay.json, .pinned}" to "whitelist is exactly {relay.json, .pinned, .hidden} — Phase 107 Plan 107-01 extended to three entries"; size assertion from `toBe(2)` → `toBe(3)`; added `expect(ALLOWED_REL_PATHS.has(".hidden")).toBe(true)`. Also updated the file header comment `(T2)` from "exactly two literals" to "exactly three literals".
- **Files modified:** src/backend/claude-session/per-identity-file.test.ts
- **Commit:** `c0ae295b` (part of GREEN commit)

## Threat Flags

None — this plan makes no changes to network endpoints, auth paths, or file access patterns beyond what the plan's threat model already covers. The whitelist addition is the singular change; all three STRIDE threats (T-107-01-01, T-107-01-02, T-107-01-03) are mitigated by tests H-10, H-03, H-02 respectively.

## Self-Check: PASSED

- Modified files:
  - `src/backend/claude-session/per-identity-file.ts` — FOUND (grep -c '".hidden"' returns 3)
  - `src/backend/claude-session/per-identity-file.test.ts` — FOUND (grep -c '".hidden"' returns 37)
- Commits:
  - `1c608ec7` — FOUND (RED: failing H-01..H-10 tests)
  - `c0ae295b` — FOUND (GREEN: ALLOWED_REL_PATHS extended)
- Scoped test result: 38/38 tests pass in per-identity-file.test.ts
- Backend build: `npm run build:backend` exits 0

---

*Phase: 107-hide-identity-rows-via-disk-sentinel*
*Completed: 2026-09-12*
