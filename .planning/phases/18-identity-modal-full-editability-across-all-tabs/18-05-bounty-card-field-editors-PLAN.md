---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: 05
type: execute
wave: 5
depends_on:
  - 18-03
  - 18-04
files_modified:
  - src/ui/features/pretty-view/BountyCard.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
autonomous: false
requirements:
  - IDMEDIT-07
tags:
  - identity-modal
  - frontend
  - bounty
  - editor
  - phase-18

must_haves:
  truths:
    - "BountyCard renders inline editors for title, premise, todos, keywords, source_links, deadline, and meeting_questions per the shapes locked in 18-03-SCRATCH-REPORT.md. Each editor honors the trigger, save, cancel, and validation rules recorded in the report."
    - "All new editors dispatch identity:update-bounty-fields WS payloads with a partial patch object (only the changed field(s) present). Server response identity:bounty-fields-updated { bounties, archivedBounties } drives the modal's setBounties + setArchivedBounties atomically."
    - "Existing edit surfaces on BountyCard are UNCHANGED byte-for-byte per IDMEDIT-07 non-regression: status pill row (StatusRow), priority row (PriorityRow), header star pin toggle, Archive button, Delete button, expand/collapse chevron for premise + todos + timeline. The window.confirm() gate on Delete is preserved."
    - "IdentityModal.tsx gains one new save handler updateBountyFields(bountySlug, patch) that mirrors updateBountyPriority (line 516-542): dispatches IdentityUpdateBountyFieldsPayload via sendIdentityMutation, awaits IdentityBountyFieldsUpdatedEvent, sets bounties + archivedBounties on success, invalidates the panel's bounty count cache (invalidateBountyCount) per the existing convention."
    - "updateBountyFields is threaded to BountyCard as a new optional prop onFieldsChange?: (patch: BountyFieldsPatch) => Promise<void>. Threaded for ALL FOUR partitions (in_progress / rest / other / archive) — same coverage as onStatusChange and onPinnedChange. Archived cards can also have their fields edited (e.g. add a meeting_question retrospectively) so onFieldsChange is threaded to sortedArchive.map's BountyCard mount too."
    - "meeting_questions[] editor surfaces per IDMEDIT-08 semantics from SCRATCH-REPORT.md: add-input for new questions plus per-row mark-answered checkbox; NO agent-add path introduced anywhere. pinned remains off the field editor (header star from patch #172 sole path)."
    - "Existing tests continue to pass (BountyCard test file if one exists — grep confirms; if none exists this is out of scope for Plan 05 and Plan 06 UAT is the acceptance surface). No test regression."
    - "IDMEDIT-07 non-regression walkthrough is exercised in the Task 3 Ashley UAT: Wakeups spec CRUD (patch #154 + quick 260731-2pa), Bounties status/priority/pinned/archive/delete (patches #154, #172, quick 260727-v0b, quick 260727-wd0, quick 260729-g5r, quick 260728-sqk), Identity-tab title/avatar/voice (quick 260731-1c8 + patch #223), plus markdown-tab editors from Plan 02 all continue to work."
  artifacts:
    - path: "src/ui/features/pretty-view/BountyCard.tsx"
      provides: "field editors for title, premise, todos, keywords, source_links, deadline, meeting_questions; onFieldsChange prop; save state per editor"
      contains: "onFieldsChange"
    - path: "src/ui/features/pretty-view/IdentityModal.tsx"
      provides: "updateBountyFields save handler; threading of onFieldsChange to all BountyCard mount sites"
      contains: "updateBountyFields"
  key_links:
    - from: "src/ui/features/pretty-view/BountyCard.tsx editors"
      to: "src/ui/features/pretty-view/IdentityModal.tsx updateBountyFields"
      via: "onFieldsChange prop callback dispatched from each editor's Save handler"
      pattern: "onFieldsChange\\("
    - from: "src/ui/features/pretty-view/IdentityModal.tsx updateBountyFields"
      to: "src/backend/claude-session/claude-session-server.ts identity:update-bounty-fields handler"
      via: "sendIdentityMutation<IdentityUpdateBountyFieldsPayload, IdentityBountyFieldsUpdatedEvent>"
      pattern: "identity:update-bounty-fields"
    - from: "18-03-SCRATCH-REPORT.md Locked Field Editor Shapes"
      to: "BountyCard.tsx implementation"
      via: "shape spec — implementation mirrors the report byte-for-byte, no re-litigation"
      pattern: "one editor per locked shape"
---

<objective>
Ship the bounty-field editor UI in BountyCard: inline editors for title,
premise, todos, keywords, source_links, deadline, meeting_questions per
the shapes locked in Wave 3 (18-03-SCRATCH-REPORT.md). Wire them through
IdentityModal.tsx to the backend handler delivered in Plan 04. Preserve
every existing edit surface byte-for-byte per IDMEDIT-07.

Purpose: This IS the acceptance surface for IDMEDIT-04 (bounty field
editability) and IDMEDIT-07 (no-regression on existing edit surfaces).
The design is LOCKED from Wave 3's Ashley UAT; this plan's job is
faithful implementation, not further design work. If the executor
encounters a shape question not answered in SCRATCH-REPORT.md, stop and
escalate — do NOT invent a shape.

Output: BountyCard.tsx expanded with editor UI + one prop; IdentityModal
gets one new save handler + threads the prop to all four BountyCard mount
sites (three open partitions + archive). Ashley UAT (Task 3) walks
IDMEDIT-04 + IDMEDIT-07 + IDMEDIT-08 end-to-end.
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
@.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add field editors to BountyCard.tsx per SCRATCH-REPORT.md shape lock</name>
  <files>src/ui/features/pretty-view/BountyCard.tsx</files>
  <read_first>
    - src/ui/features/pretty-view/BountyCard.tsx (READ IN FULL — 622 lines; you are adding editor surfaces INSIDE the expanded-body region alongside the existing PriorityRow + StatusRow + Archive + Delete + premise + todos + timeline sections; do NOT touch the header row's pin star or the status/priority editors)
    - .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md (READ IN FULL — this is your shape spec; every editor MUST implement the trigger/save/cancel/validation rules the report locked; if any decision is missing from the report, STOP the task and escalate — do NOT invent a shape)
    - src/ui/api/claude-session-api.ts (READ the extended Bounty type from Plan 04 Task 1 — you consume source_links, deadline, meeting_questions off bounty.* just like existing todos/keywords consumption)
    - src/ui/api/claude-session-api.ts (READ BountyFieldsPatch and IdentityUpdateBountyFieldsPayload from Plan 04 Task 1 — the patch shape you'll import for the onFieldsChange prop signature)
    - src/components/button.tsx and src/components/checkbox.tsx (glance — reused unchanged from existing BountyCard editors)
  </read_first>
  <action>
Add editors to BountyCard.tsx for the seven fields locked in SCRATCH-REPORT.md: title, premise, todos, keywords, source_links, deadline, meeting_questions. Also add the new optional prop onFieldsChange.

Prop signature addition (append to the existing prop list at lines 216-252):

  /** Plan 04/05: when supplied, expanded body renders inline editors for
   *  title, premise, todos, keywords, source_links, deadline, and
   *  meeting_questions. Each editor dispatches a partial patch via this
   *  callback. Threaded for ALL FOUR partitions (in_progress / rest /
   *  other / archive) since even archived bounties can have fields
   *  edited (e.g. retrospective meeting_question). */
  onFieldsChange?: (patch: BountyFieldsPatch) => Promise<void>;

Import BountyFieldsPatch from @/api/claude-session-api at the existing import block.

Editor shapes — implement each per the corresponding section in SCRATCH-REPORT.md. General pattern for each editor:

- Local component state: `editing<Field>: boolean` (default false), `<field>Draft: <type>` (default = current bounty.<field>), `saving<Field>: boolean` (default false), `<field>Error: string | null` (default null).
- Edit trigger: per SCRATCH-REPORT.md (likely click-to-edit or dedicated pencil icon per field).
- Save trigger: per SCRATCH-REPORT.md; on Save, call `await handleFieldsChange({ <field>: <field>Draft })` which wraps onFieldsChange with try/catch + saving flag management, matching the existing handleStatusChange pattern at BountyCard.tsx:280-291.
- Cancel: per SCRATCH-REPORT.md; on Cancel with dirty state, revert draft to current bounty.<field>.
- Disabled state: Save disabled when saving OR when draft byte-equal to current bounty.<field>.
- Error surfacing: inline `<div className="text-xs text-rose-300 mt-1">{<field>Error}</div>` below the editor when the field's error is set.

Editor-specific notes:

- **title**: inline input replacing the existing `<span>{bounty.title}</span>` at line 384; edit trigger and save/cancel per SCRATCH-REPORT.md.
- **premise**: textarea replacing the existing `<div>{bounty.premise}</div>` at line 553; monospace or prose per SCRATCH-REPORT.md; preserves the "Show more/less" collapse behavior when NOT in edit mode.
- **todos**: replaces the existing DISABLED checkbox rendering at lines 569-596 with an EDITABLE list per SCRATCH-REPORT.md's five interactions (add / edit text / toggle done / remove / reorder). The read-mode display stays a plain DISABLED list when onFieldsChange is not threaded (defensive fallback for future call sites that omit the prop).
- **keywords[]**: chip strip with add-input + per-chip × control; matches SCRATCH-REPORT.md.
- **source_links[]**: same list-editor pattern as keywords but with URL-shaped values (SCRATCH-REPORT.md may specify whether to render as clickable anchors in read-mode).
- **deadline**: HTML5 `<input type="date">` or `<input type="datetime-local">` per SCRATCH-REPORT.md; empty value maps to null in the patch.
- **meeting_questions[]**: per IDMEDIT-08 semantics from SCRATCH-REPORT.md: add-question input + per-row mark-answered checkbox + inline answer display; NO agent-add-only surface.

Do NOT reorganize the existing card layout. Do NOT touch the header row (title + status pill + priority icon + expand chevron + pin star). Do NOT touch StatusRow / PriorityRow / Archive / Delete implementations — they remain functional and byte-identical.

Handle the archived bounty case: SCRATCH-REPORT.md may specify that some editors are disabled for archived bounties (Ashley's decision). Honor that gate — if the report says "title is read-only on archived cards", do not render the title editor when `archived === true`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "BountyCard\.tsx|error TS" | head -20 ; echo "---" ; grep -c "onFieldsChange\|editingTitle\|editingPremise\|editingTodos\|editingKeywords\|editingSourceLinks\|editingDeadline\|editingMeetingQuestions\|BountyFieldsPatch" src/ui/features/pretty-view/BountyCard.tsx</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - onFieldsChange optional prop declared in the props type and destructured in the component signature
    - BountyFieldsPatch imported from @/api/claude-session-api
    - At least seven editing-state useState hooks or their functional equivalents (one per field) — grep confirms editing/saving state per field
    - Existing PriorityRow, StatusRow, Archive button, Delete button, header pin star all render UNCHANGED (grep for `onPriorityChange`, `onStatusChange`, `onPinnedChange`, `onArchive`, `onDelete` should show byte-identical prop consumption and same disabled/gate conditions as before)
    - Each new editor's Save handler dispatches `onFieldsChange({ <field>: <draft> })` (grep for onFieldsChange invocation with each field name)
    - meeting_questions editor exposes add + mark-answered ONLY per IDMEDIT-08 (grep confirms no separate "agent-add" or "programmatic-add" path)
    - pinned NOT rendered as an editor field (grep should NOT match `editingPinned` or similar)
    - SCRATCH-REPORT.md decisions honored (executor cross-checks each editor against the report)
  </acceptance_criteria>
  <done>BountyCard exposes editors for the seven fields locked in SCRATCH-REPORT.md; each editor dispatches partial patches via onFieldsChange; existing edit surfaces byte-identical; archived-bounty gates honored per report; IDMEDIT-08 semantics preserved at the UI layer.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Add updateBountyFields save handler in IdentityModal.tsx and thread onFieldsChange to all four BountyCard mount sites</name>
  <files>src/ui/features/pretty-view/IdentityModal.tsx</files>
  <read_first>
    - src/ui/features/pretty-view/IdentityModal.tsx (READ lines 516-542 for the updateBountyPriority template you are byte-shape-mirroring; also READ lines 1122-1206 for the four existing BountyCard mount sites — three in the OPEN_STATUS_ORDER map at 1122-1166 plus one in the sortedArchive.map at 1180-1207)
    - src/ui/api/claude-session-api.ts (READ IdentityUpdateBountyFieldsPayload + IdentityBountyFieldsUpdatedEvent + BountyFieldsPatch from Plan 04 Task 1)
  </read_first>
  <action>
Two edits:

1. Add updateBountyFields handler as a sibling to updateBountyPriority (line 516-542). Placement: after updateBountyPinned (line 597) and before archiveBounty (line 604). Shape (byte-shape-mirror updateBountyPriority):

  async function updateBountyFields(
    bountySlug: string,
    patch: BountyFieldsPatch,
  ): Promise<void> {
    if (!identity.identityKey) throw new Error("no identity key");
    const payload: IdentityUpdateBountyFieldsPayload = {
      type: "identity:update-bounty-fields",
      identityKey: identity.identityKey,
      hostId,
      bountySlug,
      patch,
    };
    const res = await sendIdentityMutation<
      IdentityUpdateBountyFieldsPayload,
      IdentityBountyFieldsUpdatedEvent
    >(payload, "identity:bounty-fields-updated");
    if (res.error) throw new Error(res.error);
    setBounties(res.bounties);
    setArchivedBounties(res.archivedBounties);
    // Rebuild the pinned-count cache — a field edit (especially todos state
    // changes or a meeting_questions add) can flip counts indirectly if the
    // panel's count derivation ever expands beyond raw pinned. Fire-and-
    // forget matches the existing convention.
    void invalidateBountyCount(identity.identityKey, hostId);
  }

2. Thread onFieldsChange to all four BountyCard mount sites in the render tree:

  - Three OPEN partitions (in_progress / rest / other) at lines 1122-1166: add `onFieldsChange={(patch) => updateBountyFields(b.slug, patch)}` to each BountyCard — mirrors how onStatusChange and onPinnedChange are threaded to all three.
  - Archive partition at lines 1180-1207: add `onFieldsChange={(patch) => updateBountyFields(b.slug, patch)}` — per Task 1 acceptance, archived cards can still have fields edited (SCRATCH-REPORT.md may gate specific fields as read-only inside the card).

Do NOT modify existing onPriorityChange / onStatusChange / onPinnedChange / onArchive / onDelete threading. Do NOT add/remove any BountyCard mount site.

Import BountyFieldsPatch, IdentityUpdateBountyFieldsPayload, IdentityBountyFieldsUpdatedEvent from @/api/claude-session-api at the existing import block.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "IdentityModal\.tsx|error TS" | head -20 ; echo "---" ; grep -c "async function updateBountyFields\|onFieldsChange={(patch)" src/ui/features/pretty-view/IdentityModal.tsx</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep prints 1 for `async function updateBountyFields` and 4 for `onFieldsChange={(patch)` — one handler, four mount-site props threaded
    - Handler uses sendIdentityMutation with the correct type-argument pair from Plan 04
    - Handler calls setBounties + setArchivedBounties + invalidateBountyCount on success (mirrors updateBountyPriority)
    - Existing updateBountyPriority / updateBountyStatus / updateBountyPinned / archiveBounty / deleteBounty implementations UNCHANGED (grep should show byte-identical function bodies)
    - Existing four onPriorityChange / onStatusChange / onPinnedChange / onArchive / onDelete prop threadings UNCHANGED
  </acceptance_criteria>
  <done>updateBountyFields handler wired; onFieldsChange threaded to all four BountyCard mount sites. TypeScript clean. Existing bounty edit handlers and prop threadings unchanged.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Ashley UAT — bounty-field editors work end-to-end plus IDMEDIT-07 non-regression walkthrough</name>
  <what-built>
    BountyCard exposes editable inline surfaces for title, premise, todos (add/edit/toggle/remove/reorder), keywords, source_links, deadline, and meeting_questions (add + mark-answered only). Each Save dispatches a partial patch through identity:update-bounty-fields, atomically updates bounty.json with updated_at + timeline appends, and echoes fresh bounty lists so the modal re-renders. Existing edit surfaces (Wakeups, Bounties status/priority/pinned/archive/delete, Identity-tab title/avatar/voice, markdown-tab editors from Plan 02) all continue to work byte-for-byte.
  </what-built>
  <how-to-verify>
    Prereqs: Skynet deployed with Plan 01 + Plan 02 + Plan 04 + Plan 05 changes. Test bounty: `file-editing-in-identity-modal` under tina/bounties/ (this phase's bounty of record — it has real todos + keywords + a premise + timeline entries). REMOTE test bounty on nelly's box for IDMEDIT-05 re-verification.

    IDMEDIT-04 field editor UAT (walk each field per SCRATCH-REPORT.md's shape):

    1. Open the identity modal on tina, navigate to Bounties, expand file-editing-in-identity-modal.
    2. **title**: edit trigger + save + cancel per SCRATCH-REPORT.md. Confirm edit persists after modal close+reopen. Confirm bounty.json on disk has updated_at bumped + one timeline entry `<ISO-Z> title updated via identity modal`.
    3. **premise**: same pattern — edit, save, disk check.
    4. **todos**: exercise all 5 sub-interactions.
       - Add: add a new todo item.
       - Edit text: change the text of an existing todo.
       - Toggle done: check/uncheck the checkbox on an existing todo.
       - Remove: delete a todo.
       - Reorder: reorder two todos.
       Confirm each results in a fresh timeline entry `<ISO-Z> todos updated via identity modal` and the todos array persists correctly on disk.
    5. **keywords[]**: add a new keyword; remove an existing keyword. Disk check.
    6. **source_links[]**: add a new link; remove an existing link. Disk check. Confirm read-mode renders links per SCRATCH-REPORT.md decision (clickable anchor vs plain text).
    7. **deadline**: pick a date (or datetime per SCRATCH-REPORT.md). Confirm bounty.json has the ISO-8601 string. Clear the deadline (empty input); confirm bounty.json has `deadline: null` or the field's absent per the writer's convention. Disk check both cases.
    8. **meeting_questions[]** (IDMEDIT-08 explicit verification):
       - Add a new question via the editor. Confirm bounty.json has the question appended.
       - Mark an existing question as answered via the checkbox. Confirm bounty.json reflects it.
       - Verify NO server-side path exists that an AGENT flow could invoke to add a meeting_question (this is a code review + design check — grep the codebase for any bounty-updating agent-callable code path that could write to meeting_questions and confirm none exists beyond identity:update-bounty-fields which is user-initiated via the modal).

    IDMEDIT-05 REMOTE-branch UAT re-verification (already done in Plan 02, re-verify for bounty writes):

    9. Open the identity modal on nelly (thenasty box, REMOTE branch). Edit any bounty field. Confirm SFTP write round-trips and disk on thenasty shows the edit.

    IDMEDIT-07 non-regression walkthrough:

    10. **Bounties existing surfaces**:
        - Change status of a bounty (in_progress → waiting → done). Confirm status pill updates + timeline entry `status set to X via identity modal`.
        - Change priority (urgent → medium). Confirm priority icon + timeline entry.
        - Toggle pin star in header. Confirm pinned flips + pinned bounty count invalidates on the panel.
        - Archive an open bounty. Confirm it moves to the Archive accordion.
        - Delete a bounty (window.confirm prompt fires). Confirm it disappears from both lists.
    11. **Wakeups spec CRUD** (patch #154 + quick 260731-2pa):
        - Toggle enable/disable on a wakeup. Confirm persistence.
        - Edit a wakeup's name / instruction / schedule via the form. Confirm persistence.
    12. **Identity-tab title/avatar/voice** (quick 260731-1c8 + patch #223):
        - Edit the identity title, save. Confirm broadcast to sidebar rows.
        - Pick a new avatar file, save. Confirm avatar updates in badge + rows.
        - Edit voice string, save. Confirm persistence.
    13. **Markdown tabs from Plan 02**:
        - Edit tina.md via the Identity tab, save. Confirm persistence.
        - Edit history.md, save. Confirm persistence + entries list re-renders.
        - Edit handoff.md, save. Confirm persistence.

    Any regression on steps 10-13 fails the UAT — Plan 05 must not touch those surfaces except through additive prop threading.
  </how-to-verify>
  <resume-signal>Type "approved" if all UAT steps pass, or describe the failing step(s) so the plan can be revised.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser editor state → WS server | Each editor's Save dispatches a fully-user-controlled partial patch; travels via authenticated WS to server for validation (per Plan 04) + write |
| BountyCard onFieldsChange prop → IdentityModal updateBountyFields | Prop callback is scoped to a single bounty (bountySlug is bound in the arrow) — a compromised BountyCard render cannot write to a different bounty than the one it renders |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-18-23 | Elevation of Privilege | client dispatches patch containing pinned or timeline or id to hijack server-managed fields | mitigate | Inherited from Plan 04 T-18-17 + T-18-22 — server's writeIdentityBountyFields enforces changedFields enumeration and unconditional post-merge overwrite of updated_at and timeline. This plan does not add UI paths that surface those fields for editing, so a compromised client would need to bypass BountyCard entirely — server-side gate remains authoritative. |
| T-18-24 | Denial of Service | user rapid-fires 100 keystrokes into title editor, dispatching 100 patches | mitigate | Save is disabled while a save is in flight per Task 1 acceptance (`saving<Field>` state gates the Save button). Client sends one payload per Save click, not per keystroke — no debounced auto-save was locked in SCRATCH-REPORT.md unless the report says otherwise (executor cross-checks). Inherited byte-cap protection from Plan 04 IDMEDIT_MAX_BOUNTY_JSON_BYTES. |
| T-18-25 | Repudiation | user edits meeting_question then blames agent | accept | Per IDMEDIT-08 semantics + Wave 3 SCRATCH-REPORT.md — meeting_questions user-authoring is a UI convention. Ashley is the only user; audit trail is bounty.json timeline entries (each meeting_questions edit generates one `<ISO-Z> meeting_questions updated via identity modal` line). Repudiation surface accepted. |
| T-18-26 | Tampering | XSS via title / premise / source_links markdown rendering | mitigate | Existing BountyCard rendering uses React text nodes (auto-escaped by React) and does not use dangerouslySetInnerHTML anywhere in the existing render tree. New editors continue this pattern — plain text via React children. source_links, if rendered as anchors per SCRATCH-REPORT.md, use React's `<a href={link}>` which does NOT auto-escape javascript: URLs — MUST validate the href starts with http:// or https:// or mailto: at render time. Codify: `const safeHref = /^(https?|mailto):/i.test(link) ? link : "#"`. Include this in the read-mode source_links rendering. |
| T-18-SC | Tampering | npm/pip/cargo installs | mitigate | No new packages installed unless SCRATCH-REPORT.md locked a date-picker library. If so, the added package MUST appear in a Package Legitimacy Audit before install — halt and escalate if the audit is missing. If purely HTML5 native inputs, no packages added. |
</threat_model>

<verification>
- npx tsc --noEmit exits 0
- npx vitest run passes (or unchanged from baseline)
- Ashley UAT Task 3 approved on all 13 steps
- Grep confirms BountyCard has editors for all seven fields plus the onFieldsChange prop
- Grep confirms IdentityModal has updateBountyFields handler plus four onFieldsChange prop threadings
- Existing edit surfaces byte-identical (grep counts of onPriorityChange / onStatusChange / onPinnedChange / onArchive / onDelete threadings unchanged from pre-Plan-05 baseline)
</verification>

<success_criteria>
- BountyCard exposes editable surfaces for title / premise / todos / keywords / source_links / deadline / meeting_questions per SCRATCH-REPORT.md
- Each editor dispatches partial patches via identity:update-bounty-fields
- Server-echoed fresh bounty lists drive atomic modal rehydrate
- IDMEDIT-07 non-regression: all 8 pre-existing edit surfaces (5 bounty + 1 wakeup + 3 identity-tab + 3 markdown-tab) continue to work byte-identical
- IDMEDIT-08 semantics preserved at UI layer (meeting_questions user-add only, pinned NOT in editor)
- Ashley approves UAT
</success_criteria>

<output>
Create `.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-05-SUMMARY.md` when done.
</output>
