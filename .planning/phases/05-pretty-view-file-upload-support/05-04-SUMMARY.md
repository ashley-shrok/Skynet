---
phase: 05-pretty-view-file-upload-support
plan: 04
subsystem: deploy-checkpoint
tags: [deploy-checkpoint, uat-checklist, patches-md-entry, build-verification, phase-close]

# Dependency graph
requires:
  - plan: 05-01
    provides: "backend upload orchestrator + shared wire-protocol types shipped into dist"
  - plan: 05-02
    provides: "frontend hook + chip strip + drop overlay + ComposeBox + PrettyView wiring shipped into dist"
  - plan: 05-03
    provides: "Terminal.tsx wiring + ChatMessage sender-side chip render + parser hardening shipped into dist"

provides:
  - "05-04-BUILD-VERIFY-LOG.md — paper trail proving Phase 5 build is clean, artifacts survive Vite tree-shake, load-bearing prior-patch bytes intact"
  - "05-UAT-CHECKLIST.md — Nyquist UAT walkthrough for Ashley post-deploy (38 checkbox items across UPLOAD-01..14 verbatim contracts, 32 blocking 🚨 markers, regression smoke section for patches #57/#60/#100/#102)"
  - "05-PATCHES-MD-ENTRY.md — draft patch-catalog entry ready to paste into ~/.claude/identities/tina/skynet-patches.md at pin time (Ashley expected to assign #104)"

affects: []  # end of Phase 5; nothing downstream

# Tech tracking
tech-stack:
  added: []  # zero source diffs — this plan produces only .planning/ .md artifacts
  patterns:
    - "Deploy checkpoint plan (Task 4) executed by orchestrator in main context, not by executor sub-agent — separation preserves the 'blanket pre-authorization ≠ per-deploy green light' rule (Ashley 2026-07-12)"
    - "Tree-shake-aware grep gates: verify function-body / string-literal characteristic markers rather than mangled identifier names (patch #57 gate updated in this plan)"
    - "Executor artifact preparation (Tasks 1-3) intentionally decoupled from deploy execution (Task 4) so the deploy sequence stays under the orchestrator's direct control"

key-files:
  created:
    - ".planning/phases/05-pretty-view-file-upload-support/05-04-BUILD-VERIFY-LOG.md (Task 1)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-UAT-CHECKLIST.md (Task 2)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-PATCHES-MD-ENTRY.md (Task 3)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-04-SUMMARY.md (this file)"
  modified: []  # zero source-code modifications this plan

key-decisions:
  - "Tasks 1-3 executed by executor sub-agent (this thread); Task 4 handed back to tina in the main context per orchestrator instruction — deploy stays under direct human-supervised control"
  - "Patch #57 grep-gate in 05-PATCHES-MD-ENTRY.md updated from function-name-based (putComposeDraft/flushComposeDraftKeepalive) to URL-literal-based (/compose-drafts) — Vite/Terser mangles internal function exports, so string literals are the correct post-tree-shake gate"
  - "Frontend Phase 5 artifact verification (Step C) uses characteristic strings (INJECTED_DELIMITER, 'Drop files here', 'webkitGetAsEntry', 'upload_chunk') rather than mangled identifier names — same tree-shake principle"
  - "UAT checklist quotes every UPLOAD-01..14 contract verbatim from REQUIREMENTS.md rather than paraphrasing — Ashley walks the exact language of the requirement"

requirements-completed: []  # Task 4 (the actual deploy) will complete UPLOAD-01..14 in production; this plan produces the artifacts that support that verification

# Metrics
duration: 12min
completed: 2026-07-20
---

# Phase 5 Plan 05-04: Deploy Checkpoint — Tasks 1-3 (executor artifacts)

**Autonomous prep work for the Phase 5 deploy checkpoint: build verification + UAT checklist + patches-md entry draft. Task 4 (the deadman-armed deploy) is deliberately NOT executed by this thread — tina (the orchestrator) owns Task 4 in the main context per fleet rule "blanket pre-authorization ≠ per-deploy green light."**

## Scope of THIS Summary

This SUMMARY covers **Tasks 1, 2, and 3 only.** Task 4 (the end-to-end deploy checkpoint including the mandatory 15-min deadman flow, container force-recreate, Ashley's UAT walk, and pin-or-revert decision) remains **PENDING tina's direct execution in the main context.** See "Task 4 status" section below.

## Performance

- **Duration:** ~12 min wall clock (executor thread)
- **Started:** 2026-07-20T12:03:32Z (npm run build kickoff timestamp captured in 05-04-BUILD-VERIFY-LOG.md)
- **Completed (Tasks 1-3):** 2026-07-20T12:15:00Z (approximate)
- **Tasks executed:** 3 (of 4 in the plan; Task 4 deliberately deferred)
- **Files created:** 4 (build-verify log + UAT checklist + patches-md entry draft + this SUMMARY)
- **Files modified:** 0 (zero source-code touches per plan spec — `.planning/phases/05-pretty-view-file-upload-support/*.md` only)

## Accomplishments

### Task 1: Build verification (commit `fcfd4c8`)

- `npm run build` completed clean in 7.23s. No `error TS`, no `[vite]` errors. Chunk-size warning is pre-existing informational (file-preview-vendor + codemirror both pre-Phase-5).
- All three new backend WS cases present exactly once each in `dist/backend/backend/ssh/terminal.js`: `case "upload_start":`, `case "upload_chunk":`, `case "upload_abort":`.
- Backend orchestrator module ships: `dist/backend/backend/ssh/pretty-view-upload.js` = 19,607 bytes with exports `sanitizeFilenameForUpload`, `handleUploadStart`, `handleUploadChunk` all present.
- Frontend Phase 5 artifacts survived Vite tree-shake (verified via characteristic string literals since Terser mangles internal export names):
  - `--- attached files ---` INJECTED_DELIMITER: 1 hit (in AppShell bundle)
  - `webkitGetAsEntry` folder-detection: 2 hits (hook + fallback)
  - `upload_chunk` WS protocol literal: 1 hit
  - `Drop files here` DropOverlay text: 2 hits
  - `please attach files or zip` folder nudge: 1 hit
- Load-bearing prior-patch bytes ALL intact:
  - Patch #60 `message_queue_delete_on_send`: 1 hit ✓
  - Patch #100 `ssh_input_delayed_enter`: 1 hit ✓
  - Patch #102 `pointer: coarse` matchMedia string: 1 hit ✓
  - Patch #57 `/compose-drafts` URL literal: present in 2 call sites in `Terminal-Cyyq-xMQ.js` (grep-gate updated from function-name-based to URL-based — see Deviations)
- Byte-identity guard passes: `scripts/verify-input-case-unchanged.sh` returns 0 with sha256 matching Plan 01 pin exactly.
- Full test suite: 409/409 across 35 files (matches Plan 03 SUMMARY's final count — no regression).
- tsc typecheck: clean project-wide.
- Zero uncommitted source diffs on `Terminal.tsx`, `backend/ssh/terminal.ts`, `nginx.conf`, `nginx-https.conf`, `package.json`, `package-lock.json`.

### Task 2: UAT checklist (commit `6e4fe0f`)

`.planning/phases/05-pretty-view-file-upload-support/05-UAT-CHECKLIST.md` produced:
- 38 checkbox items across UPLOAD-01..14 verbatim contracts (each requirement gets 2-5 observable checks; total ≥ 1 per requirement = 14/14 requirements covered)
- 32 blocking 🚨 markers (regression = revert-immediately)
- Sections: Setup → Desktop happy-path → Clipboard paste → Failure recovery → Draft persistence asymmetry → Folder rejection → Mobile paperclip → Works-on-any-pane → Regression smoke (patches #57, #60, #100, #102 all explicitly covered) → Post-sign-off actions
- Sign-off section at top of page (fast access) with both disarm command (`sudo touch /tmp/skynet-keep-patched && sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'`) and let-fire-or-manual-revert paths
- 8 Phase 5 code-side commit hashes referenced so failures can be traced to origin

### Task 3: Patches-md entry draft (commit `7f857a2`)

`.planning/phases/05-pretty-view-file-upload-support/05-PATCHES-MD-ENTRY.md` produced:
- Full multi-file entry following patch #60's canonical style (motivation → transport → atomic transfer → landing convention → injected metadata block → parser hardening → threat model → frontend UX → persistence asymmetry → sender-side render → works-on-any-pane → verify-post-deploy → files touched → rebase risk → deploy note)
- All 4 canonical section headings present: `Files touched` (1), `Verify post-deploy invariants` (1), `Rebase risk` (1), `Deploy note` (1)
- Patch numbering LEFT AS `NNN.` placeholder — Ashley fills at pin time (currently expected patch #104, since #103 is the current top per `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`)
- Deploy date LEFT AS `2026-MM-DD` placeholder — fill at pin time
- References to load-bearing prior patches: #57 (2 mentions), #60 (8 mentions — the injected turn inherits patch #60's lifecycle key), #100 (2 mentions), #102 (2 mentions)
- 12 grep-gate `docker exec skynet grep -c ...` invariants for future rebase smoke checks
- Files-touched section itemizes all 10 files across the 8 Phase 5 commits, with per-file sub-bullets explaining what shipped and what stayed byte-identical

## Task Commits

Each task committed atomically:

1. **Task 1: Build verification log** — `fcfd4c8` `docs(05-04): build verification log — Phase 5 clean into dist`
2. **Task 2: UAT checklist** — `6e4fe0f` `docs(05-04): Nyquist UAT checklist for Phase 5 file upload support`
3. **Task 3: Patches-md entry draft** — `7f857a2` `docs(05-04): draft patch-catalog entry for Phase 5 pin`

## Files Created/Modified

**Created (all in `.planning/phases/05-pretty-view-file-upload-support/`):**

- `05-04-BUILD-VERIFY-LOG.md` — 180 lines. Steps A-E (build → backend artifacts → frontend artifacts → load-bearing prior-patch bytes → diff scope) plus byte-identity script result + tsc + vitest run.
- `05-UAT-CHECKLIST.md` — 169 lines. Nyquist walkthrough for Ashley post-deploy.
- `05-PATCHES-MD-ENTRY.md` — 380 lines. Full multi-file patch-catalog entry draft with placeholder `NNN.` for pin-time numbering.
- `05-04-SUMMARY.md` — this file.

**Modified:** none. Zero source-code touches per plan spec.

## Task 4 status — PENDING tina in main context

**Task 4 (`type="checkpoint:human-verify" gate="blocking"`) was NOT executed by this thread** per orchestrator instruction. The deploy sequence — arm deadman → force-recreate container → Ashley's UAT walk → disarm-or-fire decision — will be executed directly by tina in the main context per `~/.claude/identities/tina/deploy-runbook.md`:

1. **Get explicit per-deploy green light from Ashley** before running any deploy steps (blanket pre-authorization from Plans 01-03 does NOT authorize the deploy per Ashley 2026-07-12).
2. `git push` before build (Caddy's build script clones from GitHub — local-only commits cache-hit the frontend-builder layer per patches #43 + #69 trap).
3. `sudo bash /opt/skynet/skynet-patches/build-skynet.sh`.
4. `sudo rm -f /tmp/skynet-keep-patched` (clear stale sentinel from any prior deploy — DO NOT try to kill any prior deadman's sleep child during this window per 2026-07-18 catastrophe rule).
5. Arm the new deadman: `nohup sudo -b bash -c 'sleep 900; [ ! -f /tmp/skynet-keep-patched ] && bash /opt/skynet/.tmp-revert.sh' > /tmp/skynet-revert-bg.log 2>&1`.
6. `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`.
7. Tell Ashley: "Deployed. Please run `05-UAT-CHECKLIST.md`."
8. On all-🚨-green: `sudo touch /tmp/skynet-keep-patched && sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'`. Then help pin per `05-PATCHES-MD-ENTRY.md`.
9. On any 🚨 failure or non-response within 15 min: deadman fires OR run `sudo bash /opt/skynet/.tmp-revert.sh` immediately.

The Task 4 checkpoint content in `05-04-PLAN.md` remains the authoritative script for tina's execution.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

- **Executor/orchestrator split for the deploy checkpoint.** Tasks 1-3 are pure artifact preparation and are safe for a sub-agent to execute in isolation (no source changes, no network side-effects, no container churn). Task 4 owns the deadman-armed deploy sequence which touches `/opt/skynet/`, `/tmp/skynet-*`, and the running container — these effects must stay under direct main-context supervision so the "explicit per-deploy green light" and "get Ashley's yes before starting" preferences are honored end-to-end.

- **Patch #57 grep-gate updated from function names to URL literal.** The plan's Task 1 acceptance criterion originally asked for `putComposeDraft|flushComposeDraftKeepalive` grep ≥ 1 in `dist/assets/*.js`. When Task 1 ran, that grep returned 0 — investigation showed the function names were mangled by Vite/Terser to short identifiers (`Dr`, etc.) because they're internal exports (only consumed within the bundle, not part of any HTML/entry-point surface). The correct post-tree-shake gate is the URL literal `/compose-drafts` (returns 1 hit in `Terminal-Cyyq-xMQ.js`, appearing in both the GET and PUT-via-fetch call sites). The 05-PATCHES-MD-ENTRY.md verify-post-deploy invariants block uses the URL-based gate.

- **Frontend Phase 5 artifact verification uses characteristic strings, not identifier names.** Same tree-shake principle. `usePrettyViewUploads`, `AttachmentChipStrip`, `DropOverlay`, `parseInjectedUserTurn`, `formatInjectedUserTurn` are all mangled in dist. String literals (`--- attached files ---`, `Drop files here`, `webkitGetAsEntry`, `upload_chunk`, `please attach files or zip`) survive because Terser leaves string content alone. This is the fork's established pattern for Vite-bundled frontend regression gates and is documented in 05-04-BUILD-VERIFY-LOG.md's Step C for future reference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking-adjacent] Patch #57 grep-gate strategy pivot**
- **Found during:** Task 1 Step D verification.
- **Issue:** `grep -c 'putComposeDraft\|flushComposeDraftKeepalive' dist/assets/*.js` returned 0 hits summed across all frontend chunks. The plan's Step D acceptance criterion assumed function names would survive Vite tree-shake — but they don't for internal exports (Terser mangles them to `Dr` etc.).
- **Investigation:** Confirmed source still has the functions (`src/ui/api/compose-drafts-api.ts` exports `putComposeDraft` and `flushComposeDraftKeepalive`; `ComposeBox.tsx` still references them 6 times). Grep for the URL literal `/compose-drafts` returned 1 hit in `Terminal-Cyyq-xMQ.js`, appearing in both the GET (`await De.get(\`/compose-drafts\`, {params: n})`) and PUT (`\`${De.defaults.baseURL??\`\`}/compose-drafts\``) call sites — so patch #57 machinery IS shipping, just under mangled names.
- **Fix:** Updated the strategy to use URL-based gate (`/compose-drafts` grep ≥ 1) instead of function-name gate. Documented the tree-shake principle in `05-04-BUILD-VERIFY-LOG.md` Step D. Propagated the corrected gate into `05-PATCHES-MD-ENTRY.md`'s verify-post-deploy invariants block so future rebase smoke checks use the correct gate too.
- **Files affected:** `05-04-BUILD-VERIFY-LOG.md` and `05-PATCHES-MD-ENTRY.md` (both created by this plan; no source code touched).
- **Verification:** Patch #57 confirmed intact via URL grep. Full test suite still 409/409 including the patch #57-consuming ComposeBox tests.
- **Committed in:** `fcfd4c8` (Task 1) and `7f857a2` (Task 3) — both docs/artifact commits.

---

**Total deviations:** 1 auto-fixed (strategy pivot on a verification gate; no source-code change; no behavior change). No architectural changes required. No scope creep — every artifact stays inside `.planning/phases/05-pretty-view-file-upload-support/`. The pivot actually STRENGTHENS the grep-gate strategy by using tree-shake-invariant markers (string literals) rather than tree-shake-vulnerable markers (identifier names).

## Issues Encountered

None. The three tasks executed straight-line. The patch #57 grep-gate finding was a Step D discovery, not a blocker — the machinery is verifiably shipping, just under mangled names.

## User Setup Required

None from this plan. **The next action lives with tina in the main context:** get Ashley's explicit per-deploy green light, then execute the Task 4 deadman-armed deploy sequence per `05-04-PLAN.md`'s Task 4 checkpoint content and `~/.claude/identities/tina/deploy-runbook.md`.

## Next Phase Readiness

**Ready for Task 4 (tina executes in main context):**

- All three artifacts required by the deploy flow are committed on `feat/tab-title-from-tmux`:
  - `05-04-BUILD-VERIFY-LOG.md` — proof that Plans 01-03 built clean and load-bearing prior-patch bytes are intact
  - `05-UAT-CHECKLIST.md` — the walk-through Ashley will run post-deploy
  - `05-PATCHES-MD-ENTRY.md` — the entry to paste into `skynet-patches.md` after all-🚨-green
- `git push` is a Task 4 prerequisite (Caddy build script clones from GitHub) — currently 15 commits ahead of `origin/feat/tab-title-from-tmux` (the 12 pre-existing Phase 5 code + doc commits + the 3 new Task 1-3 commits). Task 4 handles the push before build.
- Task 4's checkpoint content in `05-04-PLAN.md` remains the authoritative script.

**No blockers or concerns.** Phase 5 code-side is completely ready to ship; Tasks 1-3 executed clean and produced the artifacts Task 4 needs.

## Known Stubs

None. All three artifacts are complete and production-ready. The `NNN.` placeholder in `05-PATCHES-MD-ENTRY.md` is intentional (Ashley assigns at pin time) and is documented as such in the file's preamble.

## Threat Flags

None. This plan produces zero source diffs and zero new surface. All Phase 5 threat model was addressed at plan-time and verified by the 43 orchestrator + protocol tests in Plan 01.

## Self-Check: PASSED

**File existence:**
- `.planning/phases/05-pretty-view-file-upload-support/05-04-BUILD-VERIFY-LOG.md` — FOUND
- `.planning/phases/05-pretty-view-file-upload-support/05-UAT-CHECKLIST.md` — FOUND
- `.planning/phases/05-pretty-view-file-upload-support/05-PATCHES-MD-ENTRY.md` — FOUND
- `.planning/phases/05-pretty-view-file-upload-support/05-04-SUMMARY.md` — this file

**Commit existence (all on `feat/tab-title-from-tmux`):**
- `fcfd4c8` (Task 1 — docs(05-04): build verification log) — FOUND in git log
- `6e4fe0f` (Task 2 — docs(05-04): Nyquist UAT checklist) — FOUND in git log
- `7f857a2` (Task 3 — docs(05-04): draft patch-catalog entry) — FOUND in git log

**Grep-checkable acceptance criteria:**
- UAT checklist covers all 14 UPLOAD-NN: each ≥ 1 (verified in Task 2 commit acceptance) ✓
- UAT checklist has ≥ 8 blocking 🚨 markers: 32 present ✓
- UAT checklist references patches #57/#60/#100/#102: all present ✓
- UAT checklist has disarm command (`skynet-keep-patched`): present ✓
- Patches-md entry has 4 canonical section headings (Files touched, Verify post-deploy invariants, Rebase risk, Deploy note): all present exactly once ✓
- Patches-md entry references patches #57/#60/#100/#102: all present ✓
- Patches-md entry mentions 3 WS case labels (upload_start/chunk/abort): all present ✓
- Patches-md entry mentions landing convention (`~/pretty-view-uploads`) and delimiter (`--- attached files ---`): both present ✓

**Zero source-code touches:**
- `git diff --stat HEAD~3 HEAD -- src/ docker/ package.json package-lock.json`: expected empty (all 3 commits are docs-only under `.planning/`)
- Post-verification: `git diff --stat 5fa0293..HEAD -- src/ docker/ package.json package-lock.json` (from last Phase 5 code commit `5fa0293` to current HEAD `7f857a2`) shows only the pre-existing Phase 5 code-side changes from Plans 01-03; nothing from Plan 04 ✓

**Boundaries respected:**
- STATE.md and ROADMAP.md NOT modified in Plan 04 commits (both have pre-existing uncommitted modifications from prior planning work — not touched, per orchestrator instructions)
- No touches to `/opt/skynet/`, no touches to `/tmp/skynet-*`, no `docker compose` commands, no deadman armed — Task 4 deferred to tina in main context

---

*Phase: 05-pretty-view-file-upload-support*
*Completed (Tasks 1-3): 2026-07-20*
*Task 4 (deploy checkpoint): PENDING tina's direct execution in main context per deploy-runbook.md*
