---
phase: quick-260910-gxl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/relay-room-create.ts
  - src/backend/database/routes/relay-room-participants.ts
  - src/ui/features/pretty-view/sources/use-relay-adapter.ts
autonomous: true
requirements:
  - QUICK-260910-GXL-01
must_haves:
  truths:
    - "Structured log at relay-room-create.ts:446-447 emits `humansExclViewer` and `agentsExclViewer` (not `humansCount`/`agentsCount`)"
    - "Structured log at relay-room-participants.ts:225-226 emits `humansExclViewer` and `agentsExclViewer` — value already excludes viewer per D-07 (uses `humansOther.length`)"
    - "Console log at use-relay-adapter.ts:595-596 emits `humansExclViewer` and `agentsExclViewer`"
    - "Each of the three sites has a one-line comment clarifying viewer is excluded from the count"
    - "`grep -rn 'humansCount\\|agentsCount' src/` returns zero matches after change"
    - "`tsc` succeeds and `eslint` is clean on the three touched files"
  artifacts:
    - path: "src/backend/database/routes/relay-room-create.ts"
      provides: "renamed log fields at line 446-447 with excl-viewer clarification comment"
      contains: "humansExclViewer"
    - path: "src/backend/database/routes/relay-room-participants.ts"
      provides: "renamed log fields at line 225-226 with excl-viewer clarification comment"
      contains: "humansExclViewer"
    - path: "src/ui/features/pretty-view/sources/use-relay-adapter.ts"
      provides: "renamed console.info fields at line 595-596 with excl-viewer clarification comment"
      contains: "humansExclViewer"
  key_links:
    - from: "relay-room-participants.ts (D-07 self-exclusion block, line 214-219)"
      to: "log emission (line 225-226)"
      via: "`humansOther.length` already reflects viewer-exclusion; new field name makes this semantically explicit"
      pattern: "humansExclViewer:\\s*humansOther\\.length"
---

<objective>
Rename three log-field pairs `humansCount`/`agentsCount` → `humansExclViewer`/`agentsExclViewer` at three sites (relay-room-create, relay-room-participants, use-relay-adapter). All three counts already exclude the viewing user (see D-07 comment block at relay-room-participants.ts:214-219 where `humansOther` filters out viewer's mxid), but the current field names imply raw totals. Renaming eliminates the misleading label and adds a one-line comment at each site making the exclusion contract explicit for future readers.

Purpose: Address bounty `relay-room-create-log-field-names-misleading-viewer-excluded` — field names must reflect the semantic contract (viewer-excluded) so log consumers/dashboards do not misinterpret counts as raw totals.

Output: Six identifier renames across three files, three one-line clarification comments, and a post-change tsc+eslint gate.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/backend/database/routes/relay-room-create.ts
@src/backend/database/routes/relay-room-participants.ts
@src/ui/features/pretty-view/sources/use-relay-adapter.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename log fields at three sites with excl-viewer clarification comments</name>
  <files>src/backend/database/routes/relay-room-create.ts, src/backend/database/routes/relay-room-participants.ts, src/ui/features/pretty-view/sources/use-relay-adapter.ts</files>
  <action>Rename `humansCount` → `humansExclViewer` and `agentsCount` → `agentsExclViewer` at exactly three sites. Additive-only: do not touch any other log fields, do not reorder keys, do not modify any other lines in these files.

Site 1 — `src/backend/database/routes/relay-room-create.ts` line 446-447 (inside the `databaseLogger.info("relay_room_create ok", { ... })` block):
- Change `humansCount: humanMxids.length,` → `humansExclViewer: humanMxids.length,`
- Change `agentsCount: agentMxids.length,` → `agentsExclViewer: agentMxids.length,`
- Insert a single-line comment immediately above line 446 (before `humansExclViewer:`) reading: `// Counts exclude the room creator (viewer); creator is joined separately post-create.`

Site 2 — `src/backend/database/routes/relay-room-participants.ts` line 225-226 (inside the `databaseLogger.info("relay_room_participants ok", { ... })` block):
- Change `humansCount: humansOther.length,` → `humansExclViewer: humansOther.length,`
- Change `agentsCount: classified.agents.length,` → `agentsExclViewer: classified.agents.length,`
- Insert a single-line comment immediately above line 225 (before `humansExclViewer:`) reading: `// Counts exclude the viewing user per D-07 (see self-exclusion block above).`

Site 3 — `src/ui/features/pretty-view/sources/use-relay-adapter.ts` line 595-596 (inside the `console.info({ ... })` call in the `case "participants":` branch):
- Change `humansCount: parsed.humans.length,` → `humansExclViewer: parsed.humans.length,`
- Change `agentsCount: parsed.agents.length,` → `agentsExclViewer: parsed.agents.length,`
- Insert a single-line comment immediately above line 595 (before `humansExclViewer:`) reading: `// Counts exclude the viewing user — backend applies D-07 self-exclusion in /participants response.`

Do NOT modify `humanCount`/`agentCount` (singular) elsewhere — bridge-config-writer.ts is out of scope per constraints. Do NOT rename any type/interface fields (this rename applies only to structured-log payload keys at these three call sites).</action>
  <verify>
    <automated>test $(grep -c "humansExclViewer\|agentsExclViewer" src/backend/database/routes/relay-room-create.ts src/backend/database/routes/relay-room-participants.ts src/ui/features/pretty-view/sources/use-relay-adapter.ts | awk -F: '{s+=$2} END {print s}') -eq 6 &amp;&amp; test $(grep -rn "humansCount\|agentsCount" src/ | wc -l) -eq 0</automated>
  </verify>
  <done>All three files contain `humansExclViewer` and `agentsExclViewer` at the specified sites (6 total new identifier occurrences); `grep -rn "humansCount\|agentsCount" src/` returns zero results; each of the three sites has a one-line clarification comment on the line above the renamed keys.</done>
</task>

<task type="auto">
  <name>Task 2: Post-change tsc + eslint gate on the three touched files</name>
  <files>src/backend/database/routes/relay-room-create.ts, src/backend/database/routes/relay-room-participants.ts, src/ui/features/pretty-view/sources/use-relay-adapter.ts</files>
  <action>Run TypeScript compilation and ESLint against the three touched files to confirm the rename introduced no type or lint regressions. Use the project's configured tsc invocation (typically `npx tsc --noEmit` from repo root — this validates the whole project graph and will surface any consumer that still references the old names as a type error). Then run eslint scoped to the three touched files. If either command reports errors originating from the three touched files or from consumers of these log payloads, stop and fix before completing. If tsc reports pre-existing errors in files outside the touched set, note them in the summary but do not attempt to fix them (out of scope).</action>
  <verify>
    <automated>npx tsc --noEmit &amp;&amp; npx eslint src/backend/database/routes/relay-room-create.ts src/backend/database/routes/relay-room-participants.ts src/ui/features/pretty-view/sources/use-relay-adapter.ts</automated>
  </verify>
  <done>`npx tsc --noEmit` exits 0 (or any residual errors are pre-existing and unrelated to the rename, documented in summary); `npx eslint` on the three touched files exits 0.</done>
</task>

</tasks>

<verification>
Automated gates already declared per-task cover the full plan surface:
1. Grep count of new identifiers = 6, grep count of old identifiers = 0 (Task 1).
2. tsc + eslint clean on touched files (Task 2).
No additional phase-level verification required — this is a mechanical, additive rename with zero test-file impact (grep confirmed no test reads these keys).
</verification>

<success_criteria>
- Six log-field identifiers renamed across three files (2 per file at exact line locations specified).
- Three one-line clarification comments added (one per site) explicitly documenting viewer-exclusion semantics.
- Zero remaining references to `humansCount` or `agentsCount` in `src/`.
- `tsc --noEmit` passes; `eslint` clean on the three touched files.
- No other lines in the three files touched (additive-only rename).
</success_criteria>

<output>
Create `.planning/quick/260910-gxl-rename-humanscount-agentscount-humansexc/260910-gxl-01-SUMMARY.md` when done, recording:
- Final identifier count (should be exactly 6 new, 0 old)
- Any tsc pre-existing warnings encountered (unrelated to rename)
- Confirmation that D-07 self-exclusion semantics are now reflected in field names
</output>
