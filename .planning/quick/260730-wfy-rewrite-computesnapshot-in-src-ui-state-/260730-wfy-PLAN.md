---
phase: 260730-wfy-rewrite-computesnapshot
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
autonomous: true
requirements:
  - QUICK-260730-WFY-01
must_haves:
  truths:
    - "Tier 1 activeSet rows are ordered alphabetically by row.label (locale-aware, case-insensitive, numeric-natural)."
    - "Tier 2 pinned rows are ordered alphabetically by row.label."
    - "Within each Tier 3 host bucket (including the orphan-host fallback bucket), rows are ordered alphabetically by row.label."
    - "The Tier 3 __rdp__ sentinel bucket's rows are ordered alphabetically by row.label."
    - "Host ORDER in Tier 3 remains the hostTree walk order (only rows within each host bucket get sorted)."
    - "Header comment at src/ui/state/conversation-store.ts:1-15 documents the new alphabetical sort rule."
    - "conversation-store.test.ts tier-order assertions match the new alphabetical expectations, and a new regression test locks in pinned-tier alphabetical ordering."
    - "tsc --noEmit, npm run build:backend, npm run build, targeted vitest run, and full vitest run all pass (or their failure output is reported verbatim)."
  artifacts:
    - path: "src/ui/state/conversation-store.ts"
      provides: "computeSnapshot with alphabetical row sort within activeSet, pinned, per-host Tier 3 buckets, and RDP sentinel bucket + updated header comment"
      contains: "localeCompare"
    - path: "src/ui/state/conversation-store.test.ts"
      provides: "Updated tier-order tests + new regression test for pinned alphabetical ordering"
      contains: "alphabetically sorted by row.label"
  key_links:
    - from: "src/ui/state/conversation-store.ts computeSnapshot"
      to: "row.label alphabetical comparator"
      via: "a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })"
      pattern: "localeCompare\\("
---

<objective>
Rewrite `computeSnapshot` in `src/ui/state/conversation-store.ts` so that Tier 1 (activeSet), Tier 2 (pinned), Tier 3 per-host buckets (including orphan-host fallback), and the Tier 3 RDP sentinel bucket all sort rows alphabetically by `row.label` using a locale-aware, case-insensitive, numeric-natural comparator. Host ORDER in Tier 3 remains hostTree walk order — only rows WITHIN each host bucket get sorted. Update the header comment (lines 1-15) to document the new rule, update `conversation-store.test.ts` tier-order assertions to alphabetical expectations, and add ONE new regression test locking in pinned-tier alphabetical ordering.

Purpose: Deterministic user-facing ordering in the ConversationsPanel that no longer depends on openTabs / fleetSessions source order.

Output: Modified `conversation-store.ts` (sort logic + header comment) and modified `conversation-store.test.ts` (updated expectations + new regression test). NO changes to any other file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/ui/state/conversation-store.ts
@src/ui/state/conversation-store.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add alphabetical sort to computeSnapshot tiers + update header comment</name>
  <files>src/ui/state/conversation-store.ts</files>
  <behavior>
    - After the Tier 1 loops populate `activeSetRows`, sort in place by `row.label` using `a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })`.
    - After the Tier 2 loops populate `pinned`, sort in place by `row.label` with the same comparator.
    - After the Tier 3 hostTree walk populates each `HostGroup`'s `rows` array (both the primary walk over `orderedHosts` AND the orphan-host fallback loop over `byHostId`), sort each group's `rows` array in place with the same comparator BEFORE pushing/inserting the group into `grouped`. Equivalently: sort the bucket before wrapping it in the `HostGroup` object.
    - After `rdpRows` is fully populated (both the `orderedHosts` pass and the orphan `hostsFlat` pass), sort `rdpRows` in place with the same comparator BEFORE the `grouped.push({ hostId: "__rdp__", ... })` line.
    - Host ORDER in Tier 3 stays hostTree walk order — do NOT sort `orderedHosts` and do NOT reorder the entries of `grouped`. Only rows WITHIN each host's bucket are sorted.
    - Extract the comparator into a single module-scoped `const compareByLabel = (a: ConversationRow, b: ConversationRow) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });` (or equivalent local helper) so the four sort sites reference the same comparator.
    - Header comment at lines 1-15 currently contains the bullet `- Order below pins = existing sidebar host-tree order (depth-first). No new sort rule, no recency shuffle, no alphabetical override.` — REPLACE that bullet with a bullet documenting the new rule: rows within each tier (Tier 1 activeSet, Tier 2 pinned, Tier 3 per-host bucket, Tier 3 RDP sentinel bucket) are sorted alphabetically by `row.label` using `localeCompare(other.label, undefined, { numeric: true, sensitivity: "base" })`; host ORDER in Tier 3 remains hostTree walk order.
  </behavior>
  <action>
    Edit `src/ui/state/conversation-store.ts` per the behavior block above. Do NOT alter tier eligibility rules, dedup semantics, `emittedIds` sequencing, the openTabs-first iteration precedence during BUCKET POPULATION, the hostTree walk order at the `grouped` level, or the `__rdp__` sentinel placement — the ONLY behavior change is that four row arrays (activeSetRows, pinned, each host bucket's rows, rdpRows) are sorted in place with the shared `compareByLabel` comparator AFTER population and BEFORE emission. Update the header comment bullet at lines 6-7 as specified. Do NOT introduce any new imports. Do NOT touch any file outside `~/skynet/`. Do NOT modify `~/.claude/identities/tina/**` or `skynet-patches.md`.
  </action>
  <verify>
    <automated>cd ~/skynet && npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC EXIT: $?"; tail -30 /tmp/tsc.log</automated>
  </verify>
  <done>computeSnapshot sorts activeSetRows, pinned, each Tier 3 host bucket (primary + orphan fallback), and rdpRows in place by `row.label` via the shared `compareByLabel` (localeCompare with `{ numeric: true, sensitivity: "base" }`); host order in Tier 3 unchanged; header comment at lines 1-15 documents the new alphabetical rule; `npx tsc --noEmit` exits 0.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Update tier-order test expectations + add pinned alphabetical regression test</name>
  <files>src/ui/state/conversation-store.test.ts</files>
  <behavior>
    - For each existing test that constructs sessions in a specific source-order and then asserts `activeSet[i]`, `pinned[i]`, or `grouped[i].rows[j]` in that SAME source-order, update the expected ordering to alphabetical-by-`label` under the new comparator (`localeCompare` with `{ numeric: true, sensitivity: "base" }`). Enumerate hits via `grep -nE 'activeSet\[|pinned\[|grouped\[' src/ui/state/conversation-store.test.ts` (28 hits at lines 183, 189, 196, 220, 221, 256, 391, 410, 747, 748, 749, 779, 780, 815, 816, 820, 850, 910, 911, 912, 986, 999, 1023, 1024, 1026, 1049, 1074, 1095). For each hit, inspect the surrounding `describe`/`it` block AND the `.label` of every session/tab the test constructs to determine whether the assertion asserts an ORDER across multiple rows (needs update) or a single-row identity assertion / hostId / hostName / rows.length / row shape assertion (no update needed).
    - Assertions that read a single row (e.g. `snap.grouped[0].rows[0]`, `snap.pinned[0]`, `snap.activeSet[0]`) only need updating if the test constructs 2+ eligible rows for that bucket AND the pre-existing expectation depends on source-order winning the index-0 slot; if only one row lands in the bucket, or if the test cares only about a shape/identity property rather than which of several rows wins, leave the assertion unchanged.
    - Assertions on `hostId`, `hostName`, `rows.length`, or membership-only (`.map((r) => r.id)` compared as a set / with `toContain`) do NOT change.
    - Add ONE new test titled roughly `"pinned tier is alphabetically sorted by row.label regardless of source"` that: constructs two openTabs with labels `["z", "m"]` in that order, constructs two fleet sessions with labels `["a", "n"]` in that order, marks all four pinned via `state.pinnedIds`, calls `__getSnapshotForTest()` (or the equivalent snapshot entry point used elsewhere in the file), and asserts `snap.pinned.map((r) => r.label)` deep-equals `["a", "m", "n", "z"]`. Add the test alongside existing pinned-tier tests (match the surrounding `describe` block's setup helpers and naming style). The test must FAIL against the pre-change store (which would emit `["z", "m", "a", "n"]`) and PASS against the post-change store.
  </behavior>
  <action>
    Edit `src/ui/state/conversation-store.test.ts` per the behavior block above. Do NOT modify any production source, any other test file, or any file outside `~/skynet/` (specifically NOT `~/.claude/identities/tina/**` and NOT `skynet-patches.md`). If any of the 28 grep hits requires no update per the rules above (e.g. it asserts `hostId` / `hostName` / `rows.length`, or the surrounding test constructs only ONE eligible row for that bucket, or it asserts a single-row shape property that is invariant under sort), leave it unchanged — do NOT invent expected values.
  </action>
  <verify>
    <automated>cd ~/skynet && npx vitest run src/ui/state/conversation-store.test.ts src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx --reporter=verbose > /tmp/targeted.log 2>&1; echo "TARGETED EXIT: $?"; tail -100 /tmp/targeted.log</automated>
  </verify>
  <done>Every previously-source-ordered `activeSet[i]` / `pinned[i]` / `grouped[i].rows[j]` assertion now reflects alphabetical-by-`label` expectations under the new comparator; the new pinned-tier regression test exists, is titled per behavior spec, and passes; targeted vitest exits 0.</done>
</task>

<task type="auto">
  <name>Task 3: Full-build + full-suite gate</name>
  <files>(no file writes — verification only)</files>
  <action>
    Run the full verification sequence in order and report vitest's summary counts (X passed / Y failed / Z skipped) verbatim per L508 (runner "0 failed" alone is not authoritative — grep the log too). DO NOT push, DO NOT build the docker image beyond the `npm run build` step required here, DO NOT recreate any container, DO NOT edit `~/.claude/identities/tina/**` (specifically NOT `skynet-patches.md`). The orchestrator handles all downstream deploy steps. If any step exits non-zero, STOP and report the tail-30/tail-100 output of the failing log verbatim to the orchestrator — do not attempt speculative fixes.
  </action>
  <verify>
    <automated>cd ~/skynet && npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC EXIT: $?"; tail -30 /tmp/tsc.log && cd ~/skynet && npm run build:backend > /tmp/build-backend.log 2>&1; echo "BACKEND EXIT: $?"; tail -30 /tmp/build-backend.log && cd ~/skynet && npm run build > /tmp/build.log 2>&1; echo "BUILD EXIT: $?"; tail -30 /tmp/build.log && cd ~/skynet && npx vitest run src/ui/state/conversation-store.test.ts src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx --reporter=verbose > /tmp/targeted.log 2>&1; echo "TARGETED EXIT: $?"; tail -100 /tmp/targeted.log && cd ~/skynet && npx vitest run --reporter=verbose > /tmp/fullsuite.log 2>&1; echo "FULLSUITE EXIT: $?"; grep -cE "PASS|FAIL" /tmp/fullsuite.log; grep -E "FAIL|failed|✗|Unhandled Rejection" /tmp/fullsuite.log | head -20</automated>
  </verify>
  <done>All five verification commands report a zero exit code AND the full-suite grep for `FAIL|failed|✗|Unhandled Rejection` returns no unexpected matches; vitest summary counts reported verbatim to the orchestrator. HARD STOP after this task — no push, no docker image rebuild beyond `npm run build`, no container recreate, no edits under `~/.claude/identities/tina/**`.</done>
</task>

</tasks>

<verification>
- `computeSnapshot` in `src/ui/state/conversation-store.ts` sorts Tier 1 activeSet, Tier 2 pinned, each Tier 3 host bucket (primary hostTree walk + orphan-host fallback), and the Tier 3 RDP sentinel bucket rows by `row.label` using `localeCompare(other.label, undefined, { numeric: true, sensitivity: "base" })`.
- Host order in Tier 3 remains hostTree walk order (only rows *within* each bucket sorted).
- Header comment at `src/ui/state/conversation-store.ts:1-15` documents the new alphabetical rule (replaces the "No new sort rule, no recency shuffle, no alphabetical override." bullet).
- `src/ui/state/conversation-store.test.ts` tier-order assertions updated to alphabetical expectations; new regression test `"pinned tier is alphabetically sorted by row.label regardless of source"` exists and passes.
- `npx tsc --noEmit`, `npm run build:backend`, `npm run build`, targeted vitest, and full-suite vitest all exit 0; full-suite grep shows no unexpected `FAIL|failed|✗|Unhandled Rejection` matches.
- No files outside `~/skynet/` touched; specifically no changes under `~/.claude/identities/tina/**` and no changes to `skynet-patches.md`.
</verification>

<success_criteria>
- All three tasks' `<done>` criteria met.
- All five commands in the Task 3 verification block exit 0.
- Vitest summary counts (X passed / Y failed / Z skipped) reported verbatim, matching Ashley's L508 lesson.
- No push, no docker image rebuild beyond the local `npm run build` verification step, no container recreate, no edits under `~/.claude/identities/tina/**`, no edits to `skynet-patches.md`.
</success_criteria>

<output>
Create `.planning/quick/260730-wfy-rewrite-computesnapshot-in-src-ui-state-/260730-wfy-SUMMARY.md` when done. The summary must include:
- The exact vitest full-suite summary line (X passed / Y failed / Z skipped) verbatim.
- The list of `grep -nE 'activeSet\[|pinned\[|grouped\[' src/ui/state/conversation-store.test.ts` hits that WERE updated vs. those that were left unchanged (with a one-line reason each for the unchanged ones).
- Confirmation that no files outside `~/skynet/` were touched.
</output>
