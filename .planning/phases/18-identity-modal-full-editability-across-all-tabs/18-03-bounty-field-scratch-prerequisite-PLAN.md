---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: 03
type: execute
wave: 3
depends_on:
  - 18-02
files_modified: []
autonomous: false
requirements:
  - IDMEDIT-08
tags:
  - identity-modal
  - scratch
  - design-lock
  - human-verify
  - phase-18

must_haves:
  truths:
    - "A working docker-cp'd BountyCard scratch with editors for title (inline input), premise (textarea), todos (add/edit-text/toggle-done/remove/reorder), keywords[] (list editor), source_links[] (list editor), deadline (date-or-datetime picker), and meeting_questions[] (add + mark-answered ONLY — no agent-add path) is running inside the LIVE Skynet docker container (not just a local dev branch)."
    - "Ashley has walked the scratch against a real bounty on a real identity (recommend `file-editing-in-identity-modal` under tina/bounties/ — the phase's own bounty of record — since it has real todos + keywords + premise + timeline entries) and greenlit the shape."
    - "The scratch is a NON-COMMITTED overlay: it runs in the container via `docker cp` of built artifacts, does NOT touch the fork branch, does NOT ship to git. Ashley's greenlight is the design-lock signal — Plan 05 then implements the greenlit shape as the actual ship code."
    - "Design decisions locked from the scratch UAT are recorded in a scratch-report artifact at .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md so Plan 05 executor has an unambiguous spec (which editor for each field, keyboard behavior on Enter/Escape, drag-vs-arrows for todo reorder, date-only-vs-datetime for deadline, meeting_questions[] add UX)."
    - "The meeting_questions[] design decision from IDMEDIT-08 is EXPLICITLY confirmed in the scratch: the editor surface shows an add-question input + per-question mark-answered checkbox, but there is NO 'add on behalf of user' path, NO agent-callable API endpoint added, NO server-side handler introduced that a bounty-updating agent flow could invoke to programmatically add a meeting_question on the user's behalf. User-reserved-authoring semantics preserved at the UI layer."
    - "The pinned field is EXPLICITLY confirmed as NOT surfaced in the bounty-field editor per IDMEDIT-08 — the header star toggle from patch #172 remains the only path to flip pinned. Plan 05 does not add a pinned-editing field."
  artifacts:
    - path: ".planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md"
      provides: "written record of scratch design decisions per field editor, keyboard behaviors, and confirmed IDMEDIT-08 semantics"
      contains: "meeting_questions"
  key_links:
    - from: "18-03-SCRATCH-REPORT.md"
      to: "18-05-PLAN.md"
      via: "Plan 05 executor reads the scratch report as the authoritative shape spec — no re-litigation of any decision recorded in the report"
      pattern: "written spec for field editors"
---

<objective>
BLOCKING scratch prerequisite for Wave 4 (backend bounty-fields writer)
and Wave 5 (BountyCard UI). This plan produces NO ship code and NO fork
commits. Its output is a design-locked SCRATCH-REPORT.md capturing every
UX decision that Plan 05 will implement.

Purpose: Per the Phase 18 ROADMAP entry Success Criteria #5 and
Non-negotiables, bounty-field editing is a rich UX surface — todos alone
carries 5 interactions (add, edit text, toggle done, remove, reorder), and
keywords[] / source_links[] / deadline / meeting_questions[] each carry
their own shape decisions. Shipping ANY of these without an Ashley-UAT-lock
via a live-container scratch violates the fleet's learned preference (per
CLAUDE.md + Ashley's convention): rich UX surfaces on existing app
surfaces get docker-cp scratch iteration BEFORE the design is committed
to the fork branch.

The scratch iteration workflow: build a candidate BountyCard rewrite in a
throwaway working copy, `docker cp` the compiled asset(s) into the live
skynet container, run Ashley through the shape on real bounty data,
iterate 1-N rounds until she greenlights, THEN record decisions in
SCRATCH-REPORT.md.

Output: SCRATCH-REPORT.md at .planning/phases/18-identity-modal-full-
editability-across-all-tabs/18-03-SCRATCH-REPORT.md — machine-readable
spec that Plan 05 executor consumes to produce the ship code without
re-litigating shape decisions.

CRITICAL: Do NOT commit BountyCard changes to the fork branch in this
plan. Do NOT open a PR. The scratch is a throwaway overlay whose PURPOSE
is to lock shape via UAT. Plan 05 reproduces the locked shape as fresh
ship code.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@CLAUDE.md
</context>

<tasks>

<task type="checkpoint:decision" gate="blocking">
  <name>Task 1: Scratch approach decision — full BountyCard rewrite vs field-by-field overlay</name>
  <decision>
    Which docker-cp scratch shape does Ashley want to iterate on?
  </decision>
  <context>
    BountyCard.tsx is 622 lines and has 8 existing edit surfaces (status, priority, pinned, archive, delete, plus expand/collapse for premise + timeline). Two scratch approaches:

    Option A (full rewrite): Build a BountyCard-scratch.tsx that owns ALL current edit surfaces PLUS the new fields (title, premise, todos, keywords, source_links, deadline, meeting_questions). Ashley UATs the entire card end-to-end. Slower to iterate (large surface); most-comprehensive UAT signal.

    Option B (field-by-field overlay): Ship one field editor at a time as separate docker-cp scratches (e.g. Round 1: title inline input only, Round 2: premise textarea only, Round 3: todos add/edit/toggle/remove/reorder only). Each round is a small overlay on the CURRENT BountyCard. Faster iteration per round; more rounds total.

    The 2026-07-31 markdown-tab scratch used Option B (one field at a time — Edit/Save/Cancel only). That precedent + the "todos alone is 5 interactions" call-out in the ROADMAP suggests Option B is the Ashley-preferred flow.

    Recommend Option B unless Ashley explicitly prefers a big-bang scratch.
  </context>
  <options>
    <option id="option-a">
      <name>Full BountyCard-scratch rewrite (one scratch, all fields at once)</name>
      <pros>Most comprehensive UAT signal; catches cross-field interaction bugs; Plan 05 has a single reference shape</pros>
      <cons>Slower per iteration (622-line component under revision); harder to bisect which specific field-editor UX pattern Ashley disliked in a round; requires the executor to hold more context per pass</cons>
    </option>
    <option id="option-b">
      <name>Field-by-field overlays (multiple scratches, one field per round)</name>
      <pros>Matches the 2026-07-31 markdown-scratch precedent; fast iteration; clear signal per field; smaller executor context per pass; Ashley can defer any given field's design without blocking others</pros>
      <cons>More Ashley-interruption events across the day; Plan 05 must stitch multiple scratch reports into one ship implementation</cons>
    </option>
    <option id="option-c">
      <name>Skip scratch entirely — commit shape decisions in this planning doc and ship in Plan 05 directly</name>
      <pros>Fastest to ship</pros>
      <cons>Violates the Wave B scratch prerequisite explicitly called out in ROADMAP Success Criteria #5 AND the Phase 18 Non-negotiable list. NOT acceptable unless Ashley explicitly waives the scratch. Do NOT pick this without her explicit "skip the scratch" statement.</cons>
    </option>
  </options>
  <resume-signal>Select: option-a, option-b, or option-c (with waiver rationale)</resume-signal>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Execute the scratch iteration until Ashley greenlights the shape</name>
  <what-built>
    Working docker-cp'd BountyCard scratch(es) running inside the LIVE skynet container, exercising the field editors decided in Task 1.
  </what-built>
  <how-to-verify>
    This task is Ashley-and-Claude collaborative work per D-IDMEDIT-08 (scratch is a design surface, not a ship surface). Executor loop:

    1. In a throwaway working copy (NOT the fork branch — use `git worktree add` is forbidden per fleet rule 2026-07-31, so use a plain git stash approach or a separate uncommitted-file scratch dir under /tmp), build the candidate BountyCard variant with the field editor(s) from Task 1's chosen option.

    2. Build the frontend: `npm run build` in the throwaway copy, or `npx vite build` — produces dist/assets/*.js.

    3. `docker cp dist/assets/<the-relevant-bundle>.js skynet:/app/dist/assets/<same-name>.js` — overlays the running container's frontend bundle with the scratch. Note: hashes may change; find the matching file via `docker exec skynet ls /app/dist/assets/`. If the hash mismatch defeats overlay, cp the entire dist/assets dir.

    4. Ashley reloads her browser (hard refresh to bypass service-worker cache; on iPhone: close+reopen the tab). She opens an identity modal on tina, navigates to Bounties, and exercises the field editor(s) on `file-editing-in-identity-modal` bounty (or another live bounty of her choosing).

    5. Ashley reports impressions ("this feels right", "keyboard nav is wrong", "the reorder should be drag not arrows", "date-only not datetime", etc.).

    6. Executor iterates the scratch — repeat steps 1-5 until Ashley greenlights the shape ("locked" / "ship this" / "yes, this is it").

    7. After each container recreate (which happens whenever Ashley or a deploy-checkpoint recreates the container for another reason), the overlay is wiped — the scratch is inherently ephemeral. If a mid-day recreate happens, re-apply the overlay from step 3.

    8. IDMEDIT-08 explicit check: at some point in the iteration, exercise the meeting_questions[] add + mark-answered flow. Confirm with Ashley that adding a question via the editor is EXPLICITLY a user action (no agent-add path is introduced by this design). Confirm pinned is NOT surfaced as an editable field (star toggle in header remains sole path).

    9. Do NOT git-commit any scratch code. Do NOT push. The scratch is intentionally uncommitted work; the fork branch stays clean.
  </how-to-verify>
  <resume-signal>Type "locked — proceed to Task 3" once Ashley greenlights the final shape. If Ashley wants to defer a specific field's design, type "defer &lt;field&gt; — proceed" and the deferred field is documented in the scratch report as OPEN (Plan 05 will re-run scratch for it).</resume-signal>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Write SCRATCH-REPORT.md capturing the locked design decisions</name>
  <files>.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md</files>
  <read_first>
    - .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-bounty-field-scratch-prerequisite-PLAN.md (this plan — you are producing its declared output artifact)
    - .planning/REQUIREMENTS.md IDMEDIT-04 and IDMEDIT-08 sections (constraints the report must honor)
    - Notes from the Task 2 iteration (executor's own working memory + Ashley's greenlight statement)
  </read_first>
  <action>
Author 18-03-SCRATCH-REPORT.md as a machine-readable spec Plan 05 will consume. Structure with these sections:

## Locked Field Editor Shapes

For each of the seven editable fields — title, premise, todos, keywords, source_links, deadline, meeting_questions — write a section documenting:

- Editor type (inline input / textarea / composite list editor / date picker / etc.)
- Trigger to enter edit mode (click on the field / dedicated edit button / always-editable)
- Save trigger (Enter / blur / dedicated Save button / debounced auto-save)
- Cancel trigger (Escape / dedicated Cancel / dirty-confirm)
- Validation rules (max length / required / format)
- Any Ashley-specific keyboard preferences (e.g. Ctrl+Enter to save in textarea)

For todos specifically, document ALL FIVE sub-interactions:
- Add: where does the add-todo control live in the card? What is the empty-input shape?
- Edit text: click-to-edit or hover-to-edit? Which key commits?
- Toggle done: checkbox click, or click anywhere on the row?
- Remove: dedicated × control or context menu?
- Reorder: drag-and-drop with a handle, up/down arrows, or something else?

## Locked Wire Contract

The single WS payload identity:update-bounty-fields that Plan 04 will implement — enumerate the fields it must accept as partial JSON patch:

- title?: string
- premise?: string
- todos?: { text: string; done: boolean }[]
- keywords?: string[]
- source_links?: string[]
- deadline?: string | null (ISO-8601; null clears; date-only vs datetime format decided in Task 2)
- meeting_questions?: { question: string; answered: boolean; answer?: string }[] (schema shape confirmed in scratch — actual field names may adjust based on existing bounty.json convention)

The server bumps updated_at and appends one timeline entry per changed field (Plan 04 owns this — the report just declares the ISO-Z + field-name format for consistency with writeIdentityBountyPriority timeline convention).

## IDMEDIT-08 Semantics — Explicitly Confirmed

- meeting_questions[]: user-only-author semantics. Editor surface: add + mark-answered ONLY. No agent-add path. No new server WS handler that a bounty-updating agent flow could invoke to add a meeting_question. Semantics enforced at UI layer only (wire-level guard NOT introduced — deliberately, since restricting the wire would leak semantics into a place where agents adding "user-provided" bounty descriptions can also legitimately co-populate other fields at bounty-create time; UI-level convention is sufficient per Ashley's 2026-07-08 note on schema).
- pinned: NOT in the bounty-field editor. Header star toggle from patch #172 remains sole path.

## Open Items (if any deferred in Task 2)

If Ashley deferred any field, document which field + why + a plan for its own follow-up scratch. Plan 05 skips deferred fields cleanly (its scope shrinks to only Ashley-locked shapes).

## Ashley's Greenlight Quote

Verbatim quote from Ashley when she said "locked" or equivalent, with date + time context.

## Scratch Artifacts Reference

If any scratch overlay was tar'd or otherwise preserved for reproducibility, note its location. If it was purely ephemeral (docker-cp'd + wiped on next container recreate), state so.

Length: 200-500 lines. The report is a spec artifact — it should read as unambiguous instructions to Plan 05's executor, not as a narrative.
  </action>
  <verify>
    <automated>ls -la .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md && wc -l .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md && grep -c "## Locked Field Editor Shapes\|## Locked Wire Contract\|## IDMEDIT-08 Semantics\|meeting_questions\|pinned" .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md</automated>
  </verify>
  <acceptance_criteria>
    - File .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md exists
    - File has at least 100 lines (a shorter report is likely underspecified — reject and iterate)
    - Contains section headers for "Locked Field Editor Shapes", "Locked Wire Contract", "IDMEDIT-08 Semantics"
    - Contains explicit mention of meeting_questions and pinned per IDMEDIT-08 confirmation
    - Contains Ashley's verbatim greenlight quote (search for "locked" or "ship this" or "yes")
  </acceptance_criteria>
  <done>SCRATCH-REPORT.md written; captures the locked design for every editable bounty field, the wire contract for identity:update-bounty-fields, IDMEDIT-08 semantics confirmation, and Ashley's greenlight quote. Plan 05 executor has unambiguous spec to work from.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| scratch overlay ↔ live container | Overlay is Ashley-executed via docker cp; no persistent trust boundary crossed since scratch is throwaway and wiped on container recreate |
| SCRATCH-REPORT.md ↔ Plan 05 executor | Report is the source of truth for Plan 05 field-editor shapes; Plan 05 must not deviate |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-18-13 | Elevation of Privilege | scratch overlay accidentally committed to fork branch | mitigate | Task 2 step 9 explicitly forbids git-commit. Executor uses a throwaway working copy or plain scratch dir (not a git worktree per fleet rule 2026-07-31). Any accidental commit is caught by pre-push local check + Ashley's habit of reviewing patch numbers. |
| T-18-14 | Tampering | Ashley greenlights shape but SCRATCH-REPORT.md misrecords a decision | mitigate | Task 3 explicitly captures Ashley's verbatim greenlight quote; Plan 05 executor cross-references the report against the greenlight quote before implementing. |
| T-18-15 | Information Disclosure | scratch overlay leaks user data through console.log or debug UI | accept | Scratch is Ashley's own container; log data stays under her control; no cross-user boundary crossed. |
| T-18-16 | Denial of Service | scratch iteration is open-ended and blocks Wave 4 indefinitely | accept | This is the POINT of the prerequisite — the design must lock BEFORE Wave 4 ships. If iteration is dragging, Ashley can defer specific fields (Task 3's Open Items section) so Plan 05's scope shrinks rather than blocking indefinitely. |
| T-18-SC | Tampering | npm/pip/cargo installs | mitigate | No new packages installed in the ship code; scratch may install ephemeral packages (e.g. a date picker library) but any packages that survive into Plan 05's implementation will be scrutinized then. |
</threat_model>

<verification>
- 18-03-SCRATCH-REPORT.md exists with all required sections
- Ashley's greenlight is verbatim-recorded
- Task 1 decision recorded in the report (Option A or B or C-with-waiver)
- Task 2 iteration completed and greenlight received
- Zero commits to fork branch from this plan (git log on the branch should show no new commits from Plan 03)
</verification>

<success_criteria>
- Ashley greenlights the bounty-field editor shape via live-container scratch UAT
- SCRATCH-REPORT.md written with unambiguous spec for Plan 05
- IDMEDIT-08 semantics explicitly confirmed (meeting_questions add-only-by-user, pinned not in editor)
- Zero ship code committed to fork branch in this plan
</success_criteria>

<output>
Create `.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SUMMARY.md` when done. Also produces the SCRATCH-REPORT.md artifact as the main deliverable.
</output>
