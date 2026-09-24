---
phase: 133-role-archival
verified: 2026-09-24T13:22:00Z
status: passed
score: 22/22 D-decisions verified; 6/6 negative-case checks pass; end-to-end path wired end-to-end
overrides_applied: 0
---

# Phase 133: Role archival — Verification Report

**Phase Goal (from shape + CONTEXT):** "Add the missing 'retire a role' capability to Skynet. One operator gesture in the UI drops one sentinel on the role folder; the supervisor cascades — retires every identity currently holding the role, then moves the role folder to a roles-archive sibling. Sentinel is one-shot. Cascade is fail-soft. Role folder moves only when every cascaded identity retired cleanly. Also refactors retire_identity() to inline per-step retries (on steps 1 + 4b only per D-13a), removing the cross-tick fail-counter + retire-stuck sentinel machinery entirely from both scanners."

**Verified:** 2026-09-24T13:22:00Z
**Status:** PASS
**Re-verification:** No — initial verification

---

## Executive Summary

**Verdict: PASS.** All 22 D-decisions from CONTEXT.md are implemented in the actual committed code (not just described in plans). The end-to-end gesture is wired byte-for-byte from `RolesListModal.tsx` onContextMenu handler through the double `window.confirm` flow through `archiveRole()` fire-and-forget through `POST /roles/:name/archive` through `writeRoleFile()` sentinel drop through supervisor `scan_role_archive_requested_sentinels()` cascade through refactored `retire_identity()` (with inline retries on steps 1+4b only) through role folder `mv` to `~/fleet/roles-archive/<name>/`. All six "what would make it wrong" negative-case checks from the shape file are prevented in code. All new test suites are green (22 backend + 5 frontend api + 26 UI + 9 substrate scanner + 73 identity-archive regression). Zero live references to `retire-fail-count` or `retire-stuck` in supervisor code (only 2 historical comment references in the new scanner's docstring, contextualising the removed mechanism). Docs section in `substrate/skills/id/SKILL.md` matches the shipped mechanism and contains zero references to removed machinery.

---

## End-to-End Trace (User Click → Sentinel Written → Cascade → Folder Moved)

Line-by-line, citing actual committed code:

### 1. Operator right-clicks a role row

**File:** `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/src/ui/features/pretty-view/RolesListModal.tsx`
- **Line 418-427:** `onContextMenu={(e) => { e.preventDefault(); setMenuOpen({ x: e.clientX, y: e.clientY, roleName: role.name, roleDisplayLabel: label, hue }); }}` — row `<button>` handler suppresses browser's native menu, opens `PrettyConversationContextMenu` at cursor coords.
- **Line 533-551:** `{menuOpen && (<PrettyConversationContextMenu x={menuOpen.x} y={menuOpen.y} hue={menuOpen.hue} items={[{ label: "Archive", danger: true, onClick: () => handleArchiveClick(...) }]} onClose={() => setMenuOpen(null)} />)}` — menu is portal-mounted (via component's own createPortal), one item `Archive` with `danger: true` styling (red).

### 2. Click "Archive" → double `window.confirm`

**Same file, `handleArchiveClick` at line 156-187:**
- **Line 165-167:** `const affected = identities.filter((i) => i.role === roleName && i.hostId === hostId);` — cascade preview computed from `useIdentities()` (D-04). Complete list, no truncation. Off-role and same-role-different-host identities filtered out.
- **Line 169-173:** first dialog string: N=0 → `"archive role X? no identities hold it."`; N>0 → header + one line per identity: `• ${i.task || i.displayName}` (D-03 blast-radius disclosure, task-or-displayName fallback matches `AppShell.tsx:894`).
- **Line 174:** `if (!window.confirm(dialog1)) return;` — cancel stops.
- **Line 177:** `if (!window.confirm("are you sure? this can't be undone.")) return;` — sanity tap, byte-identical to identity-archive copy.
- **Line 179-186:** `void archiveRole(hostId, roleName).catch((err) => { console.warn({ operation: "role_archive_failed", hostId, roleName, errMessage: ... }); });` — fire-and-forget (D-01), structured warn on failure.

### 3. `archiveRole` POSTs

**File:** `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/src/ui/api/role-archive-api.ts`
- **Line 23-34:** `archiveRole(hostId, roleName)` → `authApi.post(\`/roles/${encodeURIComponent(roleName)}/archive\`, { hostId })`. Errors surfaced through `handleApiError(error, "archive role")`. No un-archive companion, no batch shape.

### 4. Backend accepts, validates, drops sentinel

**File:** `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/src/backend/database/routes/role-archive.ts`
- **Line 93-176:** `router.post("/:name/archive", authenticateJWT, ...)` — handler flow: `hostId` validation (400 on bad shape) → `ROLE_NAME_PATTERN.test(name)` (400 on failure) → `resolveHostById(hostId, userId)` (404 on cross-user, no probe leak) → `isLocalHostId` LOCAL/REMOTE branch (504 on unreachable REMOTE) → `writeRoleFile(name, ".archive-requested", "", { hostId, conn })` in try/finally → 200 on success (500 with generic message on write failure, log to `databaseLogger.error`). Audit log at line 154-156: `role archive requested: userId=X, hostId=Y, name=Z`.

**Route mounted first in `/roles`:**
- **File:** `src/backend/database/database.ts`
- **Line 82:** import — `import roleArchiveRoutes from "./routes/role-archive.js";`
- **Line 2061:** `app.use("/roles", roleArchiveRoutes);` ← FIRST
- **Line 2065:** `app.use("/roles", rolesListForHostRoutes);`
- **Line 2070:** `app.use("/roles", rolesCreateRoutes);`
- **Line 2075:** `app.use("/roles", rolesRoutes);`

Verified via `grep -n 'app.use("/roles"' database.ts` — role-archive is the FIRST `/roles` mount, guaranteed non-shadowing by any future generic `/:roleName` handler.

### 5. `writeRoleFile` primitive drops sentinel

**File:** `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/src/backend/claude-session/per-role-file.ts`
- **Line 79-81:** `export const ALLOWED_ROLE_REL_PATHS = new Set([".archive-requested"]);` — bounded whitelist, exactly one entry.
- **Line 174-198:** `writeRoleFile(name, relPath, contents, opts)`:
  - Line 180-181: `assertValidRoleName(name)` + `assertValidRoleRelPath(relPath)` fire BEFORE any I/O (belt-and-suspenders gates against T-133-01-02 path traversal).
  - Line 183-190: LOCAL branch — `getLocalRolesRoot()` (env-honoring for `ROLES_HOST_DIR`) + tmp+rename via `fs.writeFile` + `fs.rename`.
  - Line 192-197: REMOTE branch — requires `opts.conn` non-null (throws `"conn required for remote host"` if violated); delegates to `writeMarkdownFileAtomic(opts.conn, "fleet/roles/${name}/${relPath}", contents)` (relative path, no `$HOME/` prefix). Exactly ONE call site to `writeMarkdownFileAtomic` — one-audit-surface discipline.

### 6. Supervisor reconcile tick picks up sentinel

**File:** `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/substrate/scripts/agent-supervisor.sh`
- **Line 48-49:** `ROLES_DIR="${AGENT_ROLES_DIR:-$HOME/fleet/roles}"` and `ROLES_ARCHIVE_DIR="${AGENT_ROLES_ARCHIVE_DIR:-$HOME/fleet/roles-archive}"` — env-overridable constants (test hermeticity + D-16 archive location).
- **Line 349-364:** `identity_has_role()` — awk-between-first-two-fences frontmatter parser with substring-safety (exact-match `$0 == "role: " w`), tolerates quoted variants, emits post-hoc `log "WARN: ..."` on quoted (fleet-drift signal).
- **Line 1109-1166:** `scan_role_archive_requested_sentinels()`:
  - Line 1111-1114: outer walk over `$ROLES_DIR/*/`; `.archive-requested` guard skips folders without sentinel.
  - Line 1118-1127: FRESH ENUMERATION on every scan (D-07) — walks `$IDENTITIES_DIR/*/*.md`, filters via `identity_has_role`. No snapshot.
  - Line 1131-1144: FAIL-SOFT CASCADE (D-08) — loops over `to_retire[]`, invokes `retire_identity "$ident"` per identity, accumulates `failed` count + `failed_names`. Does NOT check `.pinned`, `.no-dormancy`, or `coordinator: true` (D-10 guard bypass verified via grep — zero mentions in scanner body).
  - Line 1149-1164: CONDITIONAL FOLDER MOVE (D-09) — `if [ "$failed" -eq 0 ]`: `mkdir -p "$ROLES_ARCHIVE_DIR"` + plain `mv "$d" "$ROLES_ARCHIVE_DIR/$role_name"` (D-17 verbatim, no filter/scrub) + cleanup travelled sentinel + log completion. Else: LOUD `ERROR: role '...' cascade PARTIAL: N/M identities failed:names. Role folder retained in live tree. Retry via UI.` + delete live sentinel (D-06 always-delete).
  - Line 1146-1147: sentinel deletion is unconditional on both branches (D-06 one-shot).

- **Line 2496:** reconcile wire-up — `scan_role_archive_requested_sentinels` runs immediately after `scan_archive_requested_sentinels` (line 2495), every tick (~15s), no gate (per D-20 user-initiated-only).

### 7. Cascade calls refactored `retire_identity()`

**Same file, `retire_identity()` at ~L590-925:**
- **Line 677-774:** STEP 1 (matrix deactivate) — inline `for _attempt in 1 2 3; do ...; sleep $((2 ** _attempt)); done` retry loop at line 729 (D-13a). Permanent 4xx → hard-fail on first attempt (line 754). Transient 5xx/empty http_code → per-attempt log + fall through to sleep. After 3 exhausted attempts → LOUD `ERROR: '$name' retire step 1 (matrix deactivate) FAILED after 3 attempts ...` (line 774) + `return 1`.
- **Line 779-830:** STEP 2 (graceful harness exit) — NO retry wrap. Explicit anti-drift comment at line 784: `# Do NOT add a for _attempt in 1 2 3 loop here.` (D-13a exclusion).
- **Line 833-853:** STEP 3 (tmux kill-session) — NO retry wrap. Explicit anti-drift comment at line 838 (D-13a exclusion).
- **Line 857-863:** STEP 4a (sentinel delete) — inside `retire_identity`, runs after steps 1-3 succeed. On step-1 fail, step 4a never runs → sentinel stays on identity folder → next reconcile tick retries naturally.
- **Line 874-925:** STEP 4b (folder move) — inline retry loop at line 889 (D-13a). State 1 mv fail → transient, retry with backoff. State 2 (already-moved) → break immediately. State 3 collision → HARD FAIL, no retry (line 907). State 4 anomaly → HARD FAIL, no retry (line 911).

### 8. D-14 removal (cross-tick machinery)

**`run_archive_scan()` at line 951-989:** No counter reads, no counter writes, no `retire-stuck` drop. Simplified to `if retire_identity "$name"; then log succeeded; else log "ERROR: ... retire FAILED — will retry next daily pass"; fi` (line 982-986).

**`scan_archive_requested_sentinels()` at line 1043-1064:** No counter reads/writes, no `retire-stuck` drop, no `retire-stuck`-skip guard at top of loop iteration. Simplified to `if retire_identity "$name"; then log succeeded; else log "ERROR: ... retire_identity FAILED — sentinel retained; next tick will retry"; fi` (line 1059-1063).

**grep verification:** `grep -cE 'retire-fail-count|retire-stuck' agent-supervisor.sh` returns 2 — BOTH matches are inside historical comments in the new `scan_role_archive_requested_sentinels` docstring, contextualising the removed mechanism ("mirrors the D-15 silent-by-design carve-out that the removed retire-stuck logging used to occupy" at line 1089; "same status as the removed retire-stuck logging in the D-14 refactor" at line 1105). ZERO live code references. Historical context comments do not constitute live references.

---

## D-Decision Coverage Matrix (D-01 through D-21 + D-13a)

| D#      | Semantic                                                             | Code Citation                                                                                                       | Verified |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| D-01    | Single operator gesture; cascade lives in supervisor, no frontend fan-out | `RolesListModal.tsx:179` single `archiveRole()` call; `role-archive-api.ts:23-34` single POST                       | ✓        |
| D-02    | Right-click context menu on RolesListModal rows (NOT on RoleModal)   | `RolesListModal.tsx:418-427` `onContextMenu` on row `<button>`; `PrettyConversationContextMenu` reused              | ✓        |
| D-03    | Double `window.confirm`: blast-radius list + sanity tap              | `RolesListModal.tsx:174` first confirm; `177` second confirm exact string `"are you sure? this can't be undone."`   | ✓        |
| D-04    | Cascade preview computed frontend-side via useIdentities()           | `RolesListModal.tsx:134` hook + `165-167` filter                                                                    | ✓        |
| D-05    | Sentinel filename `.archive-requested` at `~/fleet/roles/<name>/`    | `role-archive.ts:149` + `per-role-file.ts:79-81` whitelist                                                          | ✓        |
| D-06    | One-shot sentinel: deleted at end of tick regardless of outcome      | `agent-supervisor.sh:1153, 1158, 1163` — three rm-f branches all remove sentinel unconditionally                     | ✓        |
| D-07    | Fresh enumeration each scan                                          | `agent-supervisor.sh:1118-1127` walks `$IDENTITIES_DIR/*/*.md` on every scan; no snapshot state                     | ✓        |
| D-08    | Fail-soft cascade                                                    | `agent-supervisor.sh:1131-1144` — for loop over `to_retire[]`, accumulate `failed` + `failed_names`, no abort       | ✓        |
| D-09    | Role folder moves ONLY if all identities retired cleanly             | `agent-supervisor.sh:1149` `if [ "$failed" -eq 0 ]:` gate on the mv                                                 | ✓        |
| D-10    | Guard bypass for cascade identities                                  | `agent-supervisor.sh:1109-1166` — scanner body has ZERO mentions of `.pinned`, `.no-dormancy`, `coordinator`, `is_coordinator` | ✓        |
| D-11    | Retry = operator re-clicks Archive; fresh scan skips already-archived | `agent-supervisor.sh:1118-1127` fresh enumeration means only live identities are picked up on retry                 | ✓        |
| D-12    | Empty cascade → folder move fires immediately                        | `agent-supervisor.sh:1134` `if [ "$total" -gt 0 ]` short-circuit + `failed=0` initial → mv fires on 0-cascade       | ✓        |
| D-13    | Inline per-step retries with exponential backoff                     | `agent-supervisor.sh:729` (STEP 1 loop) + `889` (STEP 4b loop) — both `for _attempt in 1 2 3; do ... sleep $((2 ** _attempt))` | ✓        |
| D-13a   | Retries ONLY on steps 1 + 4b; steps 2 + 3 keep single-attempt         | `agent-supervisor.sh:784` "Do NOT add a for _attempt in 1 2 3 loop here" (step 2); `:838` same for step 3            | ✓        |
| D-14    | Delete cross-tick retire-fail-count + retire-stuck machinery         | `grep -cE 'retire-fail-count\|retire-stuck' agent-supervisor.sh` → 2 (both historical comments); zero live references | ✓        |
| D-15    | Both callers of retire_identity get clean semantic                   | `run_archive_scan():982-986` and `scan_archive_requested_sentinels():1059-1063` — both simplified to atomic `if retire_identity; then; else log ERROR` | ✓        |
| D-16    | Archive at `~/fleet/roles-archive/<name>/`                           | `agent-supervisor.sh:49` `ROLES_ARCHIVE_DIR=...`; `:1150-1151` `mkdir -p + mv` to that location                     | ✓        |
| D-17    | Verbatim move, no scrubbing                                          | `agent-supervisor.sh:1151` plain `mv "$d" "$ROLES_ARCHIVE_DIR/$role_name"` — no `--exclude`, no filter, no scrub    | ✓        |
| D-18    | Per-box only, no cross-box coordination                              | `agent-supervisor.sh:1111` `for d in "$ROLES_DIR"/*/` walks local disk only; no cross-box logic anywhere            | ✓        |
| D-19    | One-way, no un-archive                                               | `role-archive-api.ts` exports only `archiveRole`; `role-archive.ts` registers POST-only; `SKILL.md:937-944` docs   | ✓        |
| D-20    | User-initiated only                                                  | No `run_role_archive_scan_if_due` sibling; scanner runs unconditionally per tick (no 24h gate)                       | ✓        |
| D-21    | Legacy on-disk state left as archaeology                             | No cleanup loops added for old `retire-stuck` or `retire-fail-count-*` files; new code simply doesn't read/write them | ✓        |

---

## Negative-Case Checks ("What Would Make It Wrong")

| # | Failure Mode                                              | Verified? | Evidence                                                                                                                                     |
| - | --------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Two clicks instead of one gesture                         | ✓ prevented | Single `void archiveRole(...)` at `RolesListModal.tsx:179` — no per-identity fan-out; cascade lives in supervisor scanner                    |
| 2 | Sentinel becomes chatty across ticks                      | ✓ prevented | Sentinel `rm -f` on ALL three cascade branches (`agent-supervisor.sh:1153, 1158, 1163`). No persistent state files. No re-attempt-with-memory. |
| 3 | First confirmation lies about blast radius                | ✓ prevented | `RolesListModal.tsx:173` — `.map(...).join("\n")` renders EVERY affected identity, no `.slice()` truncation. Task-or-displayName fallback used exactly. |
| 4 | Retries live across ticks                                 | ✓ prevented | `grep -cE 'retire-fail-count\|retire-stuck' agent-supervisor.sh` → 2 hits, both in historical comments. Zero live code references. Test `test_scanner_no_longer_writes_counter_or_retire_stuck` pins this. |
| 5 | Role folder half-archives                                 | ✓ prevented | `agent-supervisor.sh:1149` — `if [ "$failed" -eq 0 ]:` gate on `mv`. Partial cascade leaves role folder in place. Test `test_role_cascade_fail_soft_partial` pins this. |
| 6 | Pinned identity blocks cascade                            | ✓ prevented | `scan_role_archive_requested_sentinels()` body contains ZERO checks for `.pinned`, `.no-dormancy`, `coordinator`, or `is_coordinator`. Test `test_role_cascade_guard_bypass` pins this. |
| 7 | Credential files get special handling                     | ✓ prevented | `agent-supervisor.sh:1151` is a plain `mv "$d" "$ROLES_ARCHIVE_DIR/$role_name"` — no filter, no exclude, no scrub. Entire role folder travels verbatim (D-17). |

---

## Test Suite Health

Spot-checked all four Phase 133 test suites in this verification session:

| Suite                                                            | Result           |
| ---------------------------------------------------------------- | ---------------- |
| `substrate/scripts/tests/agent-supervisor-role-archive.test.sh`  | `PASS: 9  FAIL: 0`  |
| `substrate/scripts/tests/agent-supervisor-archive-scan.sh`       | `PASS: 73  FAIL: 0` (regression suite after D-14 refactor + collateral test rewrites) |
| `npx vitest run` on Phase 133 UI + backend tests (4 files)       | 53/53 tests passed (per-role-file + role-archive route + role-archive-api + RolesListModal) |

Zero failures across 135 total tests spanning bash + TypeScript + React.

---

## Documentation Alignment

**File:** `substrate/skills/id/SKILL.md`
- New `## On archiving a role` section at line 838 (128 lines added).
- Existing `## On archiving an identity` section UNCHANGED (`git diff --stat` per SUMMARY: 128 insertions, 0 deletions).
- `grep -cE 'retire-stuck|retire-fail-count'` → 0 (zero references to removed mechanism anywhere in SKILL.md).
- Section documents: USER-INITIATED ONLY callout (line 848), mechanism 5-step walkthrough (line 857 onward), failure semantics (line 887), guard bypass (line 915), click-vs-scan enumeration race (line 924), not-reversible-yet (line 937), what-travels-with-archive (line 946), per-box scope (line 956).
- Docs describe the ACTUAL mechanism shipped in code — no aspirational or behavior-not-in-code claims spot-checked.

---

## Anti-Pattern Scan

None detected. All Phase 133-modified files (`per-role-file.ts`, `role-archive.ts`, `database.ts`, `role-archive-api.ts`, `RolesListModal.tsx`, `agent-supervisor.sh`, test files, `SKILL.md`) are free of:
- TODO/FIXME/XXX markers on lines of production concern
- Empty implementations (`return null` in critical paths)
- Hardcoded empty data flowing to UI
- Console.log-only handlers

---

## Gaps Summary

None. Phase 133 delivers on its goal end-to-end. All 22 D-decisions from CONTEXT.md are implemented in the actual committed code. All 6 "what would make it wrong" negative cases from the shape file are prevented in code. All test suites are green. Docs align with shipped behavior.

---

_Verified: 2026-09-24T13:22:00Z_
_Verifier: Claude (Opus 4.7, goal-backward verification)_
