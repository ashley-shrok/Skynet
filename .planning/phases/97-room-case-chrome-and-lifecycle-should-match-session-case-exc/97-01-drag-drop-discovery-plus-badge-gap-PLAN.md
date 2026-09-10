---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/shell/SplitView.tsx
  - src/ui/features/pretty-view/MultiBadgeAnchor.tsx
autonomous: false
requirements:
  - F-2
  - F-4
  - D-05
  - D-06
  - D-07
  - D-11

must_haves:
  truths:
    - "Ashley's UAT reproduction of 'plain-session split-view broken after opening a room' is either confirmed (structural reshape needed → split-out) or refuted (case-branch fill-in only, ship F-2 fix in Plan 06)."
    - "MultiBadgeAnchor's inner gap between badge cells reads visibly tighter than gap-2 (8px) — halved to gap-1 (4px)."
    - "Structured diagnostic logs at native dragover/drop on a relay-showing Pane land in the console during discovery so future maintenance has a forensic trail."
    - "Harness-case behavior byte-identical: no change to session-case badge gap, no change to session-case drop-target behavior, no new production side-effects."
  artifacts:
    - path: "src/ui/shell/SplitView.tsx"
      provides: "Temporary [pv-split-drop-diag] structured log at native dragover/drop"
      contains: "pv-split-drop-diag"
    - path: "src/ui/features/pretty-view/MultiBadgeAnchor.tsx"
      provides: "ROOT_ANCHOR_CLASS with gap-1 in place of gap-2"
      contains: "gap-1"
    - path: ".planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md"
      provides: "Discovery reproduction findings + split-out verdict + drag-source root-cause narrative"
      min_lines: 20
  key_links:
    - from: "src/ui/shell/SplitView.tsx"
      to: "console"
      via: "console.info template-string log with operation slug"
      pattern: "pv-split-drop-diag"
    - from: "src/ui/features/pretty-view/MultiBadgeAnchor.tsx"
      to: "the flex-row-reverse container between cells"
      via: "ROOT_ANCHOR_CLASS token change"
      pattern: "gap-1"
---

<objective>
Ship two file-disjoint slices in Wave 1: (a) F-2 drag-drop discovery — instrument the SplitView native drop-target listener, reproduce Ashley's "plain-session split broken after room open" flow, and produce a written verdict at a blocking human-verify checkpoint that either DECLARES the F-2 fix as a case-branch fill-in (Plan 06 ships as planned) or FLAGS a structural reshape needed (Plan 06 drops from Phase 97 and gets its own /open per D-07 split-out gate); (b) F-4 MultiBadgeAnchor inner gap tighten from `gap-2` to `gap-1` per D-11.

Purpose: The F-2 discovery MUST run before any F-2 fix so the split-out decision surfaces early (per Phase 97 D-07 split-out contract from CONTEXT.md; per RESEARCH.md § "Split-out assessment for finding 2" which says most-likely-outcome is "split-out DOES NOT apply — root cause is missing tabId in MultiBadgeAnchor" but demands live confirmation). F-4 is co-located here because it touches MultiBadgeAnchor (a single-token change) but is file-disjoint from every other Wave 1 plan and from Plan 06's tabId-threading (Plan 06 modifies props/render body of the same file; the ROOT_ANCHOR_CLASS constant is a separate identifier — Plan 06 depends on this plan to avoid re-touching gap tokens).

Output: instrumentation in SplitView.tsx (may remain as ambient forensic instrumentation post-ship per RESEARCH landmines), a discovery-notes markdown file at `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md`, and a `gap-1` token in `ROOT_ANCHOR_CLASS` at MultiBadgeAnchor.tsx:193.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/shapes/shape-phase-93-uat-polish-arc.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-CONTEXT.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Client DOM event → SplitView listener | Native DOM dragover/drop events cross into the Pane's outer listener; already trusted-client-side and validated via MIME-type parsing at existing code paths. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-01-01 | Information Disclosure | `[pv-split-drop-diag]` structured log | mitigate | Log only pane path + payload-lengths + source-tabId; NEVER JSON.stringify a DOM Event object; NEVER log dataTransfer body content. Follows Phase 93 Landmine 6 discipline. |
| T-97-01-02 | Tampering | dataTransfer MIME payload (`application/x-skynet-badge`) | accept | No new attack surface added — existing MIME contract at IdentityBadge.tsx:203-214 unchanged. Diagnostic log observes but does not modify. |
| T-97-01-SC | Tampering | package installs | accept | No package installs in this plan; RESEARCH.md § Package Legitimacy Audit confirms zero. |

Severity: LOW / none-new. This slice is client-side UI instrumentation + a single Tailwind token change. No new endpoints, no user input parsing, no crypto surface, no auth surface changes.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add [pv-split-drop-diag] instrumentation at SplitView native dragover/drop</name>
  <files>src/ui/shell/SplitView.tsx</files>
  <read_first>
    - src/ui/shell/SplitView.tsx (targeted read L265-580: native drop-target listener effect + existing structured log sites)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 2" and § "Split-out assessment for finding 2" (full sections — root cause hypotheses H1-H5, verdict paths, landmines about "do NOT plumb window-level state changes")
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 2 — src/ui/shell/SplitView.tsx (DISCOVERY + INSTRUMENT)" (full section — existing structured-log pattern + diagnostic log shape)
    - src/ui/features/terminal/IdentityBadge.tsx (targeted read L200-244: dataTransfer MIME contract — `application/x-skynet-badge: JSON.stringify({tabId})` at L203-214)
  </read_first>
  <action>
    Extend the native drop-target listener effect at src/ui/shell/SplitView.tsx L297-575 with a temporary diagnostic log at both the `dragover` handler and the `drop` handler. Log shape MUST mirror the existing `[pv-split-preview]` template-string at L356-360 (single-line, template literal, explicit fields — NOT `console.info({...})` object form for these particular logs, since the existing pv-split-* logs in this file use the template-string convention).

    Log emit points and exact tokens:
    - Inside the `onDragOver` handler (existing function within the L297-575 effect), immediately after the `zone` is determined and BEFORE the coral overlay/preview state is set, emit: `console.info(\`[pv-split-drop-diag] phase=dragover pane path=${JSON.stringify(path)} zone=${zone} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}\`);`
    - Inside the `onDrop` handler (existing function within the L297-575 effect), at the top BEFORE any dispatch, extract the tabId from `e.dataTransfer.getData("text/plain")` (already the existing pattern — read it, do NOT double-read) into a local const, and the badge-JSON length via `e.dataTransfer.getData("application/x-skynet-badge").length`, then emit: `console.info(\`[pv-split-drop-diag] phase=drop pane path=${JSON.stringify(path)} tabIdSource=${sourceTabId} hasBadgePayload=${badgeJsonLen > 0} hasRowPayload=${rowJsonLen > 0}\`);` (use whatever local variable names already exist in the drop handler for those getData reads — do NOT introduce redundant getData calls; if the handler does not already extract the tabId at the top, extract it once into a local and log from that local).

    Forbidden: do NOT `JSON.stringify(e)` on the DOM Event object (Phase 93 Landmine 6 verbatim + fleet directive verbatim). Do NOT log `e.dataTransfer.getData("application/x-skynet-badge")` payload body — only its `.length`. Do NOT log full URL fragments or roomIDs (defense-in-depth per V8).

    The logs are labeled `[pv-split-drop-diag]` (with the `-diag` suffix) to distinguish them from the existing production `[pv-split-preview]` and `[pv-split-drop]` logs — per RESEARCH § Finding 2 landmines, these MAY stay as ambient forensic instrumentation post-ship, so the `-diag` suffix must be preserved. If discovery in Task 3 concludes the logs are noise-level, the discovery-notes markdown file (Task 3 output) documents the removal disposition; the removal itself is out of scope for this plan (do NOT remove the logs in this plan — orchestrator or a follow-up polish plan handles removal disposition).

    Do NOT modify the effect's outer-listener attach/detach logic, do NOT change the window-level `dragend` listener at L558, do NOT reshape the ownership boundary (per RESEARCH landmine: "do NOT plumb window-level state changes"). This is a log-add only.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && grep -c 'pv-split-drop-diag' src/ui/shell/SplitView.tsx | grep -v '^0$' && grep -q "phase=dragover" src/ui/shell/SplitView.tsx && grep -q "phase=drop" src/ui/shell/SplitView.tsx && ! grep -q 'JSON\.stringify(e)' src/ui/shell/SplitView.tsx && npx tsc --noEmit 2>&1 | tee /tmp/97-01-tsc.log | (grep -E 'src/ui/shell/SplitView\.tsx' && exit 1 || exit 0)
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'pv-split-drop-diag' src/ui/shell/SplitView.tsx` returns exactly 2 (one for dragover, one for drop) — NOT 0, NOT > 2 (no re-emit inside a loop).
    - The dragover log line contains the tokens `phase=dragover`, `pane path=`, `zone=`, `clientX=`, `clientY=` (grep-verifiable).
    - The drop log line contains the tokens `phase=drop`, `pane path=`, `tabIdSource=`, `hasBadgePayload=`, `hasRowPayload=` (grep-verifiable).
    - `grep -c 'JSON\.stringify(e)' src/ui/shell/SplitView.tsx` returns 0 (no DOM Event stringified — Phase 93 Landmine 6 preserved).
    - `npx tsc --noEmit` reports zero errors touching `src/ui/shell/SplitView.tsx` (typecheck clean on the modified file — the tsc command may report unrelated project-wide type-drift; only SplitView.tsx errors block).
    - Existing `[pv-split-preview]` template-string log at L356-360 is byte-untouched (`grep -c 'pv-split-preview' src/ui/shell/SplitView.tsx` unchanged from pre-plan baseline).
  </acceptance_criteria>
  <done>Two `[pv-split-drop-diag]` log emit points added inside the existing native drop-target effect at L297-575. No other code changed in this task. Existing production logs preserved. TypeScript compiles cleanly.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Tighten MultiBadgeAnchor inner gap from gap-2 to gap-1</name>
  <files>src/ui/features/pretty-view/MultiBadgeAnchor.tsx</files>
  <read_first>
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx (full file — 265 lines; specifically L192-193 for ROOT_ANCHOR_CLASS constant, L173 for cell class-list context, L195-264 for the render body that consumes ROOT_ANCHOR_CLASS)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 4: MultiBadgeAnchor inner gap too wide" (full section — root cause analysis, single-token change directive, landmines)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 4 — MultiBadgeAnchor gap tighten" (full section — current + extension shape, discipline notes)
    - src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx (existing test file — read to find the assertion that currently expects `gap-2` in the class list, since this token change requires a test update)
  </read_first>
  <action>
    Change exactly one token in `ROOT_ANCHOR_CLASS` at src/ui/features/pretty-view/MultiBadgeAnchor.tsx:193.

    Current (L192-193):
    ```
    const ROOT_ANCHOR_CLASS =
      "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2";
    ```

    After:
    ```
    const ROOT_ANCHOR_CLASS =
      "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-1";
    ```

    Rationale: `gap-2` (8px) matches the harness case's OUTER instrument-row gap in ComposeBox Row 1 (ComposeBox.tsx:2335 `flex items-center gap-2`); applied as an INNER gap between MultiBadgeAnchor cells, it reads as "too wide" — badges look like separate zones. Halving to `gap-1` (4px) per D-11 (CONTEXT.md).

    Do NOT change: `absolute`, `top-4`, `right-5`, `z-[101]`, `flex`, `flex-row-reverse`, `items-start`. Do NOT reshape sort order, loading placeholder, self-exclusion filter, HumanBadgeCell / AgentBadgeCell bodies (all Phase 93 locks per RESEARCH § Finding 4 landmines). Do NOT touch the `mt-1 flex flex-row items-stretch gap-0` on the appendage in AgentBadgeWithMeter (that is Plan 04's territory — a different `gap-0` token in a different file).

    Update the existing test `src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx`: any assertion that asserts `gap-2` on the root anchor class list must change to `gap-1`. Grep for `gap-2` in the test file first; if it appears, change; if it does not appear (test may assert other tokens only), no test update needed.

    If MultiBadgeAnchor.test.tsx does not exist, that is fine — do not create one for this single-token change; Task 2 verification runs against the existing file only.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && grep -c 'items-start gap-1' src/ui/features/pretty-view/MultiBadgeAnchor.tsx | grep -v '^0$' && (grep -c 'items-start gap-2' src/ui/features/pretty-view/MultiBadgeAnchor.tsx | grep -q '^0$') && npx vitest run --related src/ui/features/pretty-view/MultiBadgeAnchor.tsx 2>&1 | tee /tmp/97-01-task2-vitest.log | grep -E '(passed|Tests +[0-9]+ passed)' | head -1
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'items-start gap-1' src/ui/features/pretty-view/MultiBadgeAnchor.tsx` returns >= 1 (new token present in ROOT_ANCHOR_CLASS).
    - `grep -c 'items-start gap-2' src/ui/features/pretty-view/MultiBadgeAnchor.tsx` returns 0 (old token gone).
    - `npx vitest run --related src/ui/features/pretty-view/MultiBadgeAnchor.tsx` exits 0 with all tests passing.
    - No other token in ROOT_ANCHOR_CLASS changed: L193 still contains `absolute top-4 right-5 z-[101] flex flex-row-reverse items-start` verbatim (grep-verifiable).
    - HumanBadgeCell body at L129 and AgentBadgeCell body at L164 unchanged (grep: `<IdentityBadge identityKey={identityKey} />` still appears at both locations — this is Plan 06's territory to modify).
  </acceptance_criteria>
  <done>ROOT_ANCHOR_CLASS constant at L193 contains `gap-1` (not `gap-2`). Existing MultiBadgeAnchor tests pass green. Zero other tokens in the file mutated.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Reproduce Ashley's flow + write DISCOVERY-NOTES.md with split-out verdict</name>
  <files>.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md</files>
  <read_first>
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 2" + § "Split-out assessment for finding 2" (full sections — hypotheses H1-H5, structural-reshape scenarios, verdict paths)
    - src/ui/shell/SplitView.tsx (after Task 1 completes — the `[pv-split-drop-diag]` logs are the observation instrument)
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx:129, L164 (the missing `tabId={tabId}` sites — RESEARCH's most-likely root cause for the drag-source symptom)
    - src/ui/features/pretty-view/IdentityBadge.tsx:82 (the `isDragSource = !!tabId && !isMobile` gate)
  </read_first>
  <action>
    Reproduce Ashley's flow in a live browser (Chrome DevTools console open, filter for `pv-split-drop`), and produce `.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md` documenting:

    1. **Preconditions:** git SHA at test time; branch name; dev server URL; browser + version.
    2. **Reproduction steps A (drag-source ask, per D-05):**
       a. Open the app in a fresh tab.
       b. Open a plain terminal session (any host).
       c. Open a relay room via the room list.
       d. From the room-showing surface, attempt to drag any participant badge onto the plain-session Pane's center zone.
       e. Record: does a `dragstart` fire? Do the `[pv-split-drop-diag] phase=dragover` logs fire on the target Pane? Does the drop route to `onOpenSessionInTree`? Does a split open?
    3. **Reproduction steps B (Ashley's "shared-state corruption" claim, per D-06):**
       a. Open the app in a fresh tab.
       b. Open plain session A.
       c. Open a relay room.
       d. Close the relay room's tab.
       e. From the tab bar, drag plain session B (a second session tab) onto plain session A's Pane center zone — expect a split to open (this is the baseline session→session drag-drop flow that Ashley reports is broken).
       f. Record: does the `[pv-split-drop-diag] phase=dragover` log fire on the target Pane? Does the coral overlay paint? Does the drop route through? Does the split open?
       g. If it fails, repeat WITHOUT the intermediate room-open (skip step c-d). Record whether the failure only manifests AFTER a room has been mounted at least once.
    4. **Verdict — pick exactly ONE of the two paths, per D-07:**
       - **VERDICT A: Case-branch fill-in only, Plan 06 ships as planned.** Selected when reproduction A fails (drag-source not firing — confirms missing `tabId` in MultiBadgeAnchor) AND reproduction B succeeds (no shared-state corruption — plain-session split-view still works after room open/close cycle). Write "Plan 06 SHIPS — F-2 fix is threading tabId through MultiBadgeAnchor per PATTERNS.md § Finding 2. No SplitView changes required. The `[pv-split-drop-diag]` logs may stay as ambient forensic instrumentation or be removed in a follow-up polish plan (disposition: TBD by orchestrator)."
       - **VERDICT B: Structural reshape needed, F-2 splits out.** Selected when reproduction B fails (shared-state corruption confirmed) AND diagnosis identifies which of the structural scenarios in RESEARCH § "Structural reshape scenarios" applies (shared drag-registry, window-level dragend rearchitecture, or AppShell outer-container drop handler refactor). Write "Plan 06 DROPS FROM PHASE 97 — F-2 requires structural reshape. Remaining Phase 97 plans (02, 03, 04, 05) ship as planned. Follow-up phase to be opened via /open on this finding; specific reshape shape: <specific hypothesis from RESEARCH>." Include the specific log evidence in the notes.
    5. **Structured log excerpts:** Paste representative `[pv-split-drop-diag]` log lines from the console for each reproduction step. Redact any full URL fragments or roomIDs (localpart-only) per Phase 93 Landmine 6.
    6. **Recommendation to orchestrator:** One sentence — either "Proceed to Plan 06" or "Cut Plan 06; open follow-up phase for F-2."

    Minimum 20 lines. Verbatim reproduction steps + verdict + evidence — NOT a summary or an outline.
  </action>
  <verify>
    <automated>
      test -f /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md && test $(wc -l < /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md) -ge 20 && grep -qE '(VERDICT A|VERDICT B)' /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md && grep -qE '(Plan 06 SHIPS|Plan 06 DROPS)' /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md && grep -q 'Recommendation to orchestrator' /home/ubuntu/skynet-taylor/.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` exists and is >= 20 lines.
    - File contains exactly one of `VERDICT A` or `VERDICT B` (grep-verifiable).
    - File contains either `Plan 06 SHIPS` (Verdict A path) or `Plan 06 DROPS` (Verdict B path) — matching the verdict.
    - File contains a "Recommendation to orchestrator" section with a single-sentence directive.
    - File contains at least one representative `[pv-split-drop-diag]` log excerpt from live browser reproduction.
    - No full Matrix roomID appears in the file (only localparts — grep-verifiable: any `!` character followed by more than 12 alphanumeric chars followed by `:` fails the check).
  </acceptance_criteria>
  <done>DISCOVERY-NOTES.md exists at the specified path, documents reproduction steps A and B verbatim with log evidence, and selects exactly one verdict path with a recommendation to the orchestrator.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Human verification of drag-drop discovery verdict + split-out decision</name>
  <what-built>
    - `[pv-split-drop-diag]` structured logs added at native dragover + drop in SplitView.tsx (Task 1).
    - MultiBadgeAnchor.tsx ROOT_ANCHOR_CLASS `gap-2` → `gap-1` (Task 2).
    - `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` with reproduction steps + verdict + recommendation (Task 3).
  </what-built>
  <how-to-verify>
    1. Read `.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md` end-to-end.
    2. Confirm the reproduction steps A and B match Ashley's UAT findings (open plain session → open room → try drag-source; open plain session A → open room → close room → drag plain session B onto A).
    3. Confirm the verdict path selected (Verdict A "Plan 06 SHIPS" OR Verdict B "Plan 06 DROPS FROM PHASE 97") is consistent with the log evidence pasted in the notes.
    4. Confirm the recommendation to orchestrator is clear and actionable.
    5. Visually inspect the running app: open a relay room, look at MultiBadgeAnchor — the inner gap between participant badges should read visibly tighter than before (4px vs 8px). No other visual change to the badge row.
    6. If Verdict B is selected, confirm the specific structural-reshape hypothesis matches one of the scenarios in RESEARCH § "Split-out assessment for finding 2".
    7. Approve or flag issues.
  </how-to-verify>
  <resume-signal>
    Type one of:
    - "approved verdict a" — Plan 06 ships; proceed to Wave 2 (Plan 03, 04) and Wave 3 (Plan 06).
    - "approved verdict b" — Plan 06 drops from Phase 97; proceed to Wave 2 only; orchestrator opens follow-up phase for F-2.
    - "issues: <describe>" — return to Task 3 to revise.
  </resume-signal>
</task>

</tasks>

<verification>
- Task 1 grep gates confirm the `[pv-split-drop-diag]` logs are present at exactly the two emit points with the required tokens; no DOM Event stringified.
- Task 2 grep gates confirm `gap-1` in ROOT_ANCHOR_CLASS and `gap-2` absent from the same line.
- Task 3 grep gates confirm DISCOVERY-NOTES.md exists at ≥ 20 lines with a selected verdict path and a recommendation.
- Task 4 blocking checkpoint gates on human review of the verdict — this is the D-07 split-out decision point.
- Regression floor: `npx vitest run --related src/ui/features/pretty-view/MultiBadgeAnchor.tsx` passes green (harness case untouched, MultiBadgeAnchor render unchanged apart from gap token).
- Regression floor: existing `[pv-split-preview]` and `[pv-split-drop]` logs in SplitView.tsx preserved (grep-verifiable).
</verification>

<success_criteria>
- SplitView.tsx has two `[pv-split-drop-diag]` emit points at dragover and drop, mirroring the existing template-string log format.
- MultiBadgeAnchor's ROOT_ANCHOR_CLASS carries `gap-1` instead of `gap-2`; existing MultiBadgeAnchor tests pass green.
- `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` exists with reproduction A and B, live log evidence, a selected verdict, and a recommendation to the orchestrator.
- Task 4 human-verify checkpoint returns an approved verdict (A or B) that determines whether Plan 06 ships or drops.
- No harness-case regression: harness single-badge site at PrettyView.tsx:3539-3555 untouched.
- No production side-effects added beyond the two `-diag` log emits.
</success_criteria>

<output>
Create `.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-SUMMARY.md` when done. Include:
- Verdict selected + rationale (one paragraph)
- Git SHA of the commit shipping this plan
- Whether Plan 06 remains in Phase 97 scope or drops
- Confirmation that gap-1 is visually tighter (screenshot ref or descriptive one-liner)
</output>
