---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: 02
type: execute
wave: 2
depends_on:
  - 18-01
files_modified:
  - src/ui/features/pretty-view/IdentityFileTab.tsx
  - src/ui/features/pretty-view/HistoryTab.tsx
  - src/ui/features/pretty-view/HandoffTab.tsx
  - src/ui/features/pretty-view/IdentityModal.tsx
autonomous: false
requirements:
  - IDMEDIT-01
  - IDMEDIT-02
  - IDMEDIT-03
  - IDMEDIT-05
tags:
  - identity-modal
  - frontend
  - editor
  - ui
  - phase-18

must_haves:
  truths:
    - "IdentityFileTab, HistoryTab, and HandoffTab each render an Edit / Save / Cancel control cluster in their tab toolbar (top-right of the tab pane) when state.status === 'ready'; the cluster is hidden while state.status is 'loading' or 'error'."
    - "Clicking Edit swaps the ReactMarkdown preview for a monospace textarea filling the pane height; textarea starts populated with the current file contents (IdentityFileTab and HandoffTab: state.data; HistoryTab: the RAW markdown re-fetched via a fresh identity:get-history call — see Task 2's history-specific handling)."
    - "Clicking Save fires the appropriate WS mutation (identity:update-identity-file, identity:update-history, or identity:update-handoff) with { identityKey, hostId, contents: <textarea value> }, awaits the *-updated echo, and on success replaces the tab's local state with the server-echoed markdown/entries and exits edit-mode; on error surfaces the error string inline below the textarea and stays in edit-mode."
    - "Clicking Cancel with unsaved changes (textarea value !== confirmed markdown) prompts window.confirm('Discard unsaved changes?'); Yes exits edit-mode and reverts textarea to confirmed markdown; No stays in edit-mode. Clicking Cancel without unsaved changes exits edit-mode immediately without prompt."
    - "Server echo drives client rehydrate — the tab does NOT trust its local textarea value after Save; on receiving *-updated, the tab replaces state.data with the echo's markdown (IdentityFileTab, HandoffTab) or entries (HistoryTab), then exits edit-mode with the fresh textarea value derived from server truth."
    - "Save is disabled while a save is in flight (saving state true) AND when textarea value is byte-identical to the confirmed markdown (no-op save prevention, matches Identity-tab Save disabled logic at IdentityModal.tsx:1046-1055)."
    - "Cancel is disabled while a save is in flight."
    - "IdentityModal.tsx owns the three new save handlers (updateIdentityFile, updateHistory, updateHandoff) as siblings to the existing updateWakeup / updateBountyPriority / updateBountyStatus / updateBountyPinned / archiveBounty / deleteBounty functions, using the same sendIdentityMutation<Payload,Event> generic helper at line 461-490."
    - "The three save handlers are threaded to their respective tab renderers as props (onSaveIdentityFile, onSaveHistory, onSaveHandoff), each returning Promise<void> and throwing on backend error (per the sendIdentityMutation contract at IdentityModal.tsx:508-512 which throws when res.error is truthy)."
    - "On successful save, IdentityModal.tsx replaces the tab's state via setIdentityFileState / setHistoryState / setHandoffState with { status: 'ready', data: <echoed markdown or entries> } — mirrors the existing setWakeupsState pattern at line 513."
    - "History tab requires a distinct 'raw markdown' fetch path — the existing readIdentityHistory returns parsed entries[], not the raw file body suitable for a textarea editor. Solution baked into Task 2: the HistoryTab requests raw markdown via a one-shot identity:get-history-raw WS call on Edit-click (implemented as a client-side helper that opens a WS, sends identity:get-identity-file with a modified path? NO — see Task 2 for the clean approach: extend the existing identity:get-history handler and event to CARRY BOTH entries AND markdown so no new wire type is needed)."
    - "IDMEDIT-05 verification acceptance: with Skynet-EC2's frontend connected via browser, an edit to nelly.md against nelly's identity folder on a remote box (hostId ≠ skynet-ec2's local hostId) round-trips via SFTP and the confirmed contents echo back to the modal within ~1-3 seconds. The Ashley UAT task in this plan explicitly walks the cross-machine case."
  artifacts:
    - path: "src/ui/features/pretty-view/IdentityFileTab.tsx"
      provides: "Edit/Save/Cancel toolbar + editable textarea mode; toggles between markdown preview (existing) and monospace textarea editor"
      contains: "onSaveIdentityFile"
    - path: "src/ui/features/pretty-view/HistoryTab.tsx"
      provides: "Edit/Save/Cancel toolbar + editable textarea mode; textarea populated with raw markdown body (not parsed entries), Save writes full-file overwrite"
      contains: "onSaveHistory"
    - path: "src/ui/features/pretty-view/HandoffTab.tsx"
      provides: "Edit/Save/Cancel toolbar + editable textarea mode; toggles between markdown preview (existing) and monospace textarea editor"
      contains: "onSaveHandoff"
    - path: "src/ui/features/pretty-view/IdentityModal.tsx"
      provides: "updateIdentityFile, updateHistory, updateHandoff save handlers threaded to tab renderers as props; setHistoryState re-typed to carry both entries + raw markdown for the editor's needs"
      contains: "updateIdentityFile|updateHistory|updateHandoff"
  key_links:
    - from: "src/ui/features/pretty-view/IdentityFileTab.tsx"
      to: "src/ui/features/pretty-view/IdentityModal.tsx"
      via: "onSaveIdentityFile prop callback → dispatches identity:update-identity-file WS payload"
      pattern: "onSaveIdentityFile\\?:.*\\(.*Promise"
    - from: "src/ui/features/pretty-view/IdentityModal.tsx"
      to: "src/ui/api/claude-session-api.ts"
      via: "sendIdentityMutation<IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent> called with 'identity:identity-file-updated' as expectedType"
      pattern: "IdentityUpdateIdentityFilePayload|IdentityUpdateHistoryPayload|IdentityUpdateHandoffPayload"
    - from: "src/ui/features/pretty-view/IdentityModal.tsx"
      to: "backend WS handler (Plan 01 Task 2)"
      via: "sendIdentityMutation opens WS, sends payload, awaits expectedType response"
      pattern: "identity:update-identity-file|identity:update-history|identity:update-handoff"
---

<objective>
Ship the frontend editor mode for the three markdown identity tabs
(IdentityFileTab, HistoryTab, HandoffTab), backed by the WS write
handlers delivered in Plan 01. Each tab gains an Edit / Save / Cancel
toolbar in top-right, a monospace textarea that fills the tab pane on
Edit, atomic Save via the plan-01 WS handlers with server-echoed
rehydrate, Cancel with dirty-confirm, and error surfacing.

Purpose: This IS the acceptance surface for IDMEDIT-01, IDMEDIT-02,
IDMEDIT-03. Ashley must be able to open the identity modal on nelly (or
any identity), click Edit on any markdown tab, edit the raw markdown,
click Save, and see her edit persist through a modal re-open and (for
IDMEDIT-05 verification) through a cross-machine edit — nelly.md edited
from a phone against nelly's live folder on thenasty via the skynet-ec2
frontend.

Output: three tab renderers gain edit-mode + toolbar + textarea; the
IdentityModal owns the three save handlers using the existing
sendIdentityMutation generic; HistoryTab specifically threads a raw
markdown body alongside the existing parsed entries[] since a line-based
list is not editable in a textarea. Design shape is LOCKED from the
2026-07-31 file-editing-in-identity-modal scratch UAT (Ashley
docker-cp'd a scratch into the live container and greenlit "worked") — do
NOT re-litigate the shape here.

Contains a MANDATORY human-verify Ashley UAT checkpoint at end (see Task
4) walking IDMEDIT-01, IDMEDIT-02, IDMEDIT-03, IDMEDIT-05 against a live
Skynet with both LOCAL (skynet-ec2 own identity) and REMOTE (nelly on
thenasty) test cases.
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

<task type="auto" tdd="false">
  <name>Task 1: Add edit-mode toolbar + textarea to IdentityFileTab and HandoffTab (identical shape)</name>
  <files>src/ui/features/pretty-view/IdentityFileTab.tsx, src/ui/features/pretty-view/HandoffTab.tsx</files>
  <read_first>
    - src/ui/features/pretty-view/IdentityFileTab.tsx (READ IN FULL — 76 lines; you are converting this from read-only ReactMarkdown to a toggle between ReactMarkdown preview and textarea edit-mode; the TabState<T> type export lives here and is consumed by History/Handoff/Wakeups too — do NOT rename it)
    - src/ui/features/pretty-view/HandoffTab.tsx (READ IN FULL — 72 lines; identical shape to IdentityFileTab, receives identical treatment)
    - src/ui/features/pretty-view/IdentityModal.tsx (READ lines 950-1070 for the existing identity-tab edit toolbar shape — title input + Save/Cancel Button pair with disabled-when-clean plus disabled-when-saving; this is your visual template)
    - src/components/button.tsx (glance at Button component API — Button variant="outline"/"default" size="sm" plus disabled prop, used unchanged from identity-tab pattern)
    - Bounty scratch reference: `/home/ubuntu/.claude/identities/tina/bounties/file-editing-in-identity-modal/` — Ashley greenlit this shape on the docker-cp scratch 2026-07-31. Consult if any shape question arises; do not re-litigate.
  </read_first>
  <action>
Convert IdentityFileTab and HandoffTab from read-only markdown displays to toggle between preview and editor. Both files receive IDENTICAL treatment; do NOT abstract into a shared component — the tabs have historically stayed self-contained per patch #17g plan comments (each tab file is self-contained; copy-paste over shared abstraction), and BountyCard has diverged from the identity-tab shape enough that a shared abstraction would leak. Two copies is the right amount of duplication.

Shape for BOTH files:

1. Add new prop to the tab component: `onSave?: (contents: string) => Promise<void>` — optional so the tab still renders in read-only mode when the parent does not thread a handler; the toolbar is hidden when onSave is undefined.

2. Add local state via useState hooks: `editing: boolean` (default false), `draft: string` (default ""), `saving: boolean` (default false), `saveError: string | null` (default null).

3. Toolbar block placement: BEFORE the existing prose-wrapped ReactMarkdown div (the return block starting around line 46 of IdentityFileTab). Toolbar renders only when state.status === "ready" AND onSave is defined. Structure: a flex row with justify-end (buttons top-right), 3 buttons:
   - Edit button (variant="outline" size="sm"), hidden when editing===true, onClick sets editing=true and draft=state.data
   - Save button (variant="default" size="sm"), visible when editing===true, disabled when (saving || draft === state.data), onClick fires handleSave (async: setSaving(true); setSaveError(null); try { await onSave(draft); } catch(e) { setSaveError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }; note: on success the parent replaces state.data via its own setState — the tab observes state.status stays "ready" but state.data changes, so we detect success by comparing draft === new state.data OR by having handleSave setEditing(false) inside the try after await), text is "Saving…" when saving else "Save"
   - Cancel button (variant="outline" size="sm"), visible when editing===true, disabled when saving, onClick fires handleCancel which checks if draft === state.data (no dirty) and if so setEditing(false) directly; otherwise calls window.confirm("Discard unsaved changes?") and only setEditing(false) + reset draft on confirm

4. Body swap: when editing===true, render a `<textarea>` with className `font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]`, value={draft}, onChange={e => setDraft(e.target.value)}, spellCheck={false}. When editing===false, render the existing ReactMarkdown block unchanged.

5. Save error surfacing: when saveError is truthy, render below the textarea (or below the body div) a `<div className="text-sm text-[color:var(--color-pv-code-fg)] mt-2">Save failed: {saveError}</div>`.

6. Server-echo-driven exit from edit-mode: the parent's onSave awaits the WS *-updated echo and then replaces state.data via setState. The tab detects this by comparing draft vs incoming state.data — but that comparison is fiddly. Simpler contract: onSave's Promise resolves only when the echo has been received, so handleSave can setEditing(false) inside the try block immediately after `await onSave(draft)` succeeds. Parent's state.data will refresh on the next render (React batches state updates), and the read-only ReactMarkdown re-mounts with the fresh state.data — the tab does not need to explicitly re-sync draft.

Ensure the existing loading / error / empty-state branches are UNCHANGED (they short-circuit before the toolbar-and-editor block). Ensure the existing className prose chain on the ReactMarkdown wrapper is UNCHANGED byte-for-byte.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "IdentityFileTab\.tsx|HandoffTab\.tsx|error TS" | head -20 ; echo "---" ; grep -c "onSave\|editing\|draft\|textarea\|handleCancel\|window\.confirm" src/ui/features/pretty-view/IdentityFileTab.tsx src/ui/features/pretty-view/HandoffTab.tsx</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0 (new prop is optional so existing IdentityModal call sites still compile)
    - Both IdentityFileTab.tsx and HandoffTab.tsx contain: `onSave?:`, `useState<boolean>(false)` (for editing state), `<textarea`, `window.confirm(`, `handleCancel`, and `Discard unsaved changes?`
    - Both files import Button from @/components/button
    - The existing loading / error / empty branches are unchanged (grep for `state.status === "loading"` and `state.status === "error"` returns same count as before)
    - The ReactMarkdown block className chain (`prose prose-sm max-w-none ...`) is byte-identical to the pre-edit version
    - Toolbar visibility gated on `state.status === "ready"` AND `onSave` truthy
  </acceptance_criteria>
  <done>IdentityFileTab and HandoffTab each render an Edit/Save/Cancel toolbar and a full-height monospace textarea in edit-mode; onSave prop is optional so existing (Task 3 not-yet-wired) call sites remain safe; Cancel with dirty state prompts window.confirm.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Convert HistoryTab to editable — carry raw markdown alongside parsed entries</name>
  <files>src/ui/features/pretty-view/HistoryTab.tsx, src/backend/claude-session/identity-artifact-reader.ts, src/backend/claude-session/claude-session-server.ts, src/ui/api/claude-session-api.ts</files>
  <read_first>
    - src/ui/features/pretty-view/HistoryTab.tsx (READ IN FULL — 89 lines; the parseHistoryLine function at lines 14-32 is the read-only rendering path and must stay working for the read-mode display, but the editor needs the RAW markdown, not the parsed entries)
    - src/backend/claude-session/identity-artifact-reader.ts (READ readIdentityHistory at lines 247-288 — this parses the file into entries. Your task widens its return type to include the raw markdown body alongside the parsed entries.)
    - src/backend/claude-session/claude-session-server.ts (READ the identity:get-history handler and its identity:history event emission — you are widening the event shape to also carry raw markdown)
    - src/ui/api/claude-session-api.ts (READ IdentityHistoryEvent at line 350 — you are widening this event type to include an optional markdown field)
    - src/ui/features/pretty-view/IdentityModal.tsx (READ lines 200-360 — historyState is typed as TabState<string[]>; you will widen this to TabState<{ entries: string[]; markdown: string }> so the tab has access to both)
  </read_first>
  <action>
This is the biggest task in Plan 02 because HistoryTab needs the RAW markdown body for the textarea editor, not the parsed entries. Solution: widen the readIdentityHistory backend function's return type to include both, widen the identity:history WS event to carry both, widen the frontend historyState type to hold both, then adapt HistoryTab to render entries in read-mode and edit raw markdown in edit-mode.

Steps in order:

1. Backend — identity-artifact-reader.ts readIdentityHistory: Widen return type from `Promise<{ entries: string[] }>` to `Promise<{ entries: string[]; markdown: string }>`. Both LOCAL and REMOTE branches: after reading the file (contents/stdout), assign it to a local `markdown` var, THEN run the existing split/filter/reverse pipeline to derive entries. Return { entries, markdown }. When file is missing (ENOENT path), return { entries: [], markdown: "" }. Consumers that only read `entries` still work — additional field is additive.

2. Backend — claude-session-server.ts identity:get-history handler: Update the ws.send emission to include the new markdown field: `ws.send(JSON.stringify({ type: "identity:history", entries, markdown }))`. Update the identity:history-updated echo from Plan 01 Task 2 similarly — echo `{ type: "identity:history-updated", entries, markdown }` (both fields carried).

3. Wire types — claude-session-api.ts: Widen IdentityHistoryEvent to `{ type: "identity:history"; entries: string[]; markdown?: string; error?: string }` (markdown optional to keep backward compatibility with any callers that JSON.parse an older-shape payload — but the server WILL always emit it now). Same widening for IdentityHistoryUpdatedEvent added in Plan 01 Task 3: `{ type: "identity:history-updated"; entries: string[]; markdown?: string; error?: string }`.

4. IdentityModal.tsx historyState: Change type from `TabState<string[]>` to `TabState<{ entries: string[]; markdown: string }>`. Update setHistoryState calls at line 328-330 to set `{ status: "ready", data: { entries: ev.entries, markdown: ev.markdown ?? "" } }`. Update the HistoryTab prop passthrough at line 1223 to pass `state={historyState}` unchanged (the component absorbs the type widening).

5. Frontend — HistoryTab.tsx: Update the component signature from `state: TabState<string[]>` to `state: TabState<{ entries: string[]; markdown: string }>`. In the read-mode branches, use `state.data.entries` instead of `state.data` when mapping over history lines. Add the edit-mode block from Task 1 (identical toolbar + textarea + Cancel dirty-confirm shape) — the textarea's initial draft is `state.data.markdown`. Save calls `onSave(draft)` which dispatches identity:update-history.

6. Add the onSave prop `onSave?: (contents: string) => Promise<void>` to HistoryTab, identical to Task 1's shape.

The widening is deliberately additive to preserve backward compat with the existing read paths (no consumer of the `entries` field is broken; the modal's parseHistoryLine still works; only shape-consumers who explicitly destructure `state.data as string[]` would break — grep confirms only IdentityModal is such a consumer and it is updated in this same task).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "HistoryTab\.tsx|identity-artifact-reader\.ts|claude-session-server\.ts|claude-session-api\.ts|IdentityModal\.tsx|error TS" | head -30 ; echo "---" ; grep -n "state\.data\.entries\|state\.data\.markdown\|readIdentityHistory.*Promise" src/ui/features/pretty-view/HistoryTab.tsx src/backend/claude-session/identity-artifact-reader.ts | head -10</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0 (widening is additive; all consumers updated in this same task)
    - readIdentityHistory return type is `Promise<{ entries: string[]; markdown: string }>` (grep confirms)
    - claude-session-server.ts identity:history emission JSON includes both entries and markdown fields
    - IdentityHistoryEvent type in claude-session-api.ts includes both entries: string[] and markdown?: string
    - IdentityHistoryUpdatedEvent from Plan 01 Task 3 widened same way
    - HistoryTab.tsx consumes state.data.entries in read-mode AND state.data.markdown as textarea seed in edit-mode
    - IdentityModal.tsx historyState is typed TabState<{ entries: string[]; markdown: string }>
    - Existing tests still pass (parseHistoryLine unchanged; entries[] rendering unchanged)
  </acceptance_criteria>
  <done>HistoryTab is editable; its Save writes the full markdown body via identity:update-history and receives entries+markdown back for atomic rehydrate. Backend read function, WS handler emission, and wire types are widened to carry both fields. Existing entries-based read path unchanged.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Wire three save handlers in IdentityModal.tsx and thread onSave props to the three tabs</name>
  <files>src/ui/features/pretty-view/IdentityModal.tsx</files>
  <read_first>
    - src/ui/features/pretty-view/IdentityModal.tsx (READ lines 461-643 for the existing save-handler shape — sendIdentityMutation generic helper, updateWakeup / updateBountyPriority / updateBountyStatus / updateBountyPinned / archiveBounty / deleteBounty; your three new handlers are byte-shape mirrors of updateWakeup lines 493-514, differing only in payload type + event type + setState target)
    - src/ui/features/pretty-view/IdentityModal.tsx (READ lines 1067, 1223, 1239 — the three <IdentityFileTab />, <HistoryTab />, <HandoffTab /> mount sites that need onSave props threaded in)
    - src/ui/api/claude-session-api.ts (import the three new payload types + three new event types from Plan 01 Task 3: IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent, IdentityUpdateHistoryPayload, IdentityHistoryUpdatedEvent, IdentityUpdateHandoffPayload, IdentityHandoffUpdatedEvent)
  </read_first>
  <action>
Add three new save-handler functions to IdentityModal.tsx and thread them as onSave props to the three markdown-tab renderers.

Placement of handlers: sibling to updateWakeup and updateBountyPriority — insert after updateWakeup (ends ~line 514) and before updateBountyPriority (starts ~line 516). Function names: updateIdentityFile, updateHistory, updateHandoff.

Handler shape (byte-shape-mirror updateWakeup at lines 493-514):

updateIdentityFile(contents: string): Promise<void>:
  if (!identity.identityKey) throw new Error("no identity key");
  const payload: IdentityUpdateIdentityFilePayload = { type: "identity:update-identity-file", identityKey: identity.identityKey, hostId, contents };
  const res = await sendIdentityMutation<IdentityUpdateIdentityFilePayload, IdentityIdentityFileUpdatedEvent>(payload, "identity:identity-file-updated");
  if (res.error) throw new Error(res.error);
  setIdentityFileState({ status: "ready", data: res.markdown });

updateHistory(contents: string): Promise<void>:
  if (!identity.identityKey) throw new Error("no identity key");
  const payload: IdentityUpdateHistoryPayload = { type: "identity:update-history", identityKey: identity.identityKey, hostId, contents };
  const res = await sendIdentityMutation<IdentityUpdateHistoryPayload, IdentityHistoryUpdatedEvent>(payload, "identity:history-updated");
  if (res.error) throw new Error(res.error);
  setHistoryState({ status: "ready", data: { entries: res.entries, markdown: res.markdown ?? contents } });

updateHandoff(contents: string): Promise<void>:
  if (!identity.identityKey) throw new Error("no identity key");
  const payload: IdentityUpdateHandoffPayload = { type: "identity:update-handoff", identityKey: identity.identityKey, hostId, contents };
  const res = await sendIdentityMutation<IdentityUpdateHandoffPayload, IdentityHandoffUpdatedEvent>(payload, "identity:handoff-updated");
  if (res.error) throw new Error(res.error);
  setHandoffState({ status: "ready", data: res.markdown });

Thread the props at the three mount sites:

- Line ~1067-1068: `<IdentityFileTab state={identityFileState} onSave={updateIdentityFile} />`
- Line ~1223: `<HistoryTab state={historyState} onSave={updateHistory} />`
- Line ~1239: `<HandoffTab state={handoffState} onSave={updateHandoff} />`

Do NOT invalidateBountyCount (irrelevant for markdown edits). Do NOT touch existing updateWakeup / updateBountyPriority / updateBountyStatus / updateBountyPinned / archiveBounty / deleteBounty. Do NOT change setIdentityFileState / setHistoryState / setHandoffState declarations beyond what Task 2 already did for setHistoryState.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "IdentityModal\.tsx|error TS" | head -20 ; echo "---" ; grep -n "async function updateIdentityFile\|async function updateHistory\|async function updateHandoff\|onSave={updateIdentityFile}\|onSave={updateHistory}\|onSave={updateHandoff}" src/ui/features/pretty-view/IdentityModal.tsx</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep prints exactly 6 lines: three `async function update*` handler declarations and three `onSave={...}` prop bindings on the three tab mount sites
    - Each of the three handlers uses sendIdentityMutation<Payload, Event> with the correct type-argument pair from Plan 01 Task 3
    - Each of the three handlers writes to the correct setState (setIdentityFileState / setHistoryState / setHandoffState) with a { status: "ready", data: ... } value
    - No modifications to existing handlers or existing mount sites beyond adding the onSave prop
    - IdentityFileTab, HistoryTab, HandoffTab are imported unchanged (the new prop is additive, no import list churn)
  </acceptance_criteria>
  <done>Three save handlers wired in IdentityModal.tsx and threaded to the three markdown-tab renderers. TypeScript clean. Existing edit surfaces (Wakeups, Bounties status/priority/pinned/archive/delete, Identity-tab title/avatar/voice) unchanged.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Ashley UAT — markdown-tab edits work both LOCAL and REMOTE</name>
  <what-built>
    Three markdown identity tabs (Identity file, History, Handoff) are editable with an Edit/Save/Cancel toolbar. Save writes the full file atomically via tmp+rename — LOCAL branch via fs.writeFile+rename, REMOTE branch via SFTP.writeFile+rename. Server echoes back the confirmed markdown after write so the tab rehydrates from truth. Cancel with unsaved changes prompts window.confirm.
  </what-built>
  <how-to-verify>
    Prereqs: Skynet is deployed with Plan 01 backend + Plan 02 UI changes (Ashley does the deploy per fork DEPLOY DISCIPLINE — 15-min deadman rollback). Test identity `tina` lives on skynet-ec2 (LOCAL bind-mount branch); test identity `nelly` lives on thenasty (REMOTE SSH branch).

    LOCAL branch UAT (IDMEDIT-01, IDMEDIT-02, IDMEDIT-03):

    1. Open Skynet in a browser, navigate to a Tina Claude Code session. Open the identity modal (existing patch-#191 gear/tab-strip mechanism).
    2. Click the "Identity" tab (which shows tina.md). Click Edit. Confirm the ReactMarkdown preview is replaced by a monospace textarea populated with the current tina.md content. Confirm the Save button is disabled (no changes yet) and the Cancel button is enabled.
    3. Type a small edit ("test line " + current timestamp) at the end of the textarea. Confirm the Save button becomes enabled. Click Save. Confirm the button reads "Saving…" briefly, then the textarea is replaced by the ReactMarkdown preview with the new content visible. No error surfaces.
    4. Close and re-open the modal. Confirm the edit persists (tina.md on disk now has the added line). Confirm `cat ~/.claude/identities/tina/tina.md | tail -3` on skynet-ec2 shows the edit.
    5. Click Edit again, add another line, then click Cancel. Confirm the window.confirm("Discard unsaved changes?") prompt appears. Click Cancel on the prompt (No). Confirm the textarea still shows the dirty edit. Click Cancel again, this time click OK on the prompt (Yes). Confirm the tab reverts to ReactMarkdown preview with the original content (the second line addition is gone).
    6. Repeat steps 2-5 for the History tab and Handoff tab against tina. For History, confirm the entries[] list re-renders after Save with the freshly added line at the top (since history.md is reverse-chronological rendered).

    REMOTE branch UAT (IDMEDIT-05):

    7. From Ashley's phone, connect to term.gigaashley.click. Navigate to a Nelly Claude Code session (Nelly runs on thenasty, a remote box — hostId is NOT in IDENTITIES_LOCAL_HOST_IDS).
    8. Open the identity modal on Nelly. Click Identity tab. Click Edit. Add "phone test line " + timestamp. Click Save. Confirm the edit round-trips within ~1-3 seconds (SFTP is fast on tailnet), the ReactMarkdown preview re-renders with the new content, no error.
    9. From a shell on thenasty (via a separate SSH), run `cat ~/.claude/identities/nelly/nelly.md | tail -3` and confirm the phone-added line is present on disk on the remote box.
    10. Repeat step 7-9 for History and Handoff tabs on Nelly.

    Non-regression walkthrough:

    11. Open Bounties tab — confirm bounty cards render, status/priority pills work, pin star toggles, archive+delete buttons work.
    12. Open Wakeups tab — confirm wakeup cards render, enable toggle + spec editing work.
    13. Identity tab — confirm title/avatar/voice edit + Save still work.
  </how-to-verify>
  <resume-signal>Type "approved" if all 13 steps pass, or describe the failing step(s) so the plan can be revised.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser textarea → WS server | Textarea value is fully-user-controlled markdown; travels via authenticated WS to server for validation + write |
| WS server → identity file on disk | userId is authenticated at WS-open time; identityKey is regex-validated at handler entry (per Plan 01); write path is regex-validated inside the writer (defense in depth per Plan 01) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-18-08 | Tampering | textarea payload with embedded shell metacharacters (backticks, $(...), etc.) | mitigate | Payload never touches a shell — Plan 01 REMOTE branch uses SFTP.writeFile which streams UTF-8 bytes as a first-class ssh2 channel. No shell interpolation on `contents` at any point in the write path. Inherited from Plan 01 T-18-01, T-18-02. |
| T-18-09 | Denial of Service | very large paste into textarea (e.g. 10MB) | mitigate | Server-side IDMEDIT_MAX_MARKDOWN_BYTES = 2MB cap from Plan 01; on overflow the writer throws and the WS handler emits { markdown: "", error: "markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES" }; the frontend surfaces the error inline below the textarea. User can shorten and retry. No client-side length gate needed — server is authoritative. |
| T-18-10 | Repudiation | multiple simultaneous editors on same identity file (browser tab A saves stale, overwriting tab B's fresh edit) | accept | Last-write-wins is the intended behavior — identity files are single-user single-editor by workflow convention. No optimistic locking or version field added; adding one would violate the "no re-litigation" rule on the LOCKED shape from the 2026-07-31 scratch UAT. |
| T-18-11 | Information Disclosure | error echo leaks server-side path info | mitigate | Writer throws use static strings ("invalid identityKey", "markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES", "no updates") — never interpolate the file path or hostname into the error. SSH-layer exceptions ("Command exited with code X", "no such file") CAN leak; those are wrapped by execWithTimeout and re-emitted via the echo's error field. Accept the SSH-layer leakage — it is the same shape that already leaks via existing update-wakeup and update-bounty-priority handlers, and Ashley is the only user. |
| T-18-12 | Tampering | client trusts its own textarea after Save instead of server echo | mitigate | Task 3 explicitly writes setIdentityFileState({ status: "ready", data: res.markdown }) — uses the SERVER echo, not the client draft. History uses res.entries + res.markdown ?? contents (fallback to draft only if server does not echo markdown, which per the widening it always does). This eliminates the class of bug where a server-side normalization (e.g. trailing newline fix) diverges from client-side truth. |
| T-18-SC | Tampering | npm/pip/cargo installs | mitigate | No new packages installed in this plan. |
</threat_model>

<verification>
- npx tsc --noEmit exits 0
- npx vitest run passes (or unchanged from baseline; no new tests introduced here)
- Ashley UAT Task 4 approved on all 13 steps
- Grep confirms both IdentityFileTab.tsx and HandoffTab.tsx render identical Edit/Save/Cancel toolbar shapes (byte-shape mirror OK; two copies expected)
- HistoryTab.tsx has the same toolbar shape plus consumes the widened state.data.markdown for textarea seed
- IdentityModal.tsx has three new updateIdentityFile / updateHistory / updateHandoff handlers wired
</verification>

<success_criteria>
- IdentityFileTab, HistoryTab, HandoffTab each editable with server-echoed rehydrate
- Cross-machine (REMOTE-branch) writes work per IDMEDIT-05 verification steps 7-10
- Cancel with dirty state prompts window.confirm and honors user choice
- Save is disabled when draft === confirmed and when saving is in flight
- No regression to existing edit surfaces (Wakeups, Bounties status/priority/pinned/archive/delete, Identity-tab title/avatar/voice) per steps 11-13
- Ashley approves UAT
</success_criteria>

<output>
Create `.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-02-SUMMARY.md` when done.
</output>
