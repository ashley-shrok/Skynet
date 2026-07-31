---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: "02"
subsystem: identity-modal-ui
tags:
  - identity-modal
  - frontend
  - editor
  - ui
  - phase-18
dependency_graph:
  requires:
    - writeIdentityFile (Plan 01)
    - writeIdentityHistory (Plan 01)
    - writeIdentityHandoff (Plan 01)
    - identity:update-identity-file WS handler (Plan 01)
    - identity:update-history WS handler (Plan 01)
    - identity:update-handoff WS handler (Plan 01)
    - IdentityUpdateIdentityFilePayload (Plan 01)
    - IdentityIdentityFileUpdatedEvent (Plan 01)
    - IdentityUpdateHistoryPayload (Plan 01)
    - IdentityHistoryUpdatedEvent (Plan 01)
    - IdentityUpdateHandoffPayload (Plan 01)
    - IdentityHandoffUpdatedEvent (Plan 01)
  provides:
    - IdentityFileTab edit-mode (onSave prop, Edit/Save/Cancel toolbar, textarea)
    - HandoffTab edit-mode (onSave prop, Edit/Save/Cancel toolbar, textarea)
    - HistoryTab edit-mode (onSave prop, textarea seeded with raw markdown body)
    - updateIdentityFile handler in IdentityModal
    - updateHistory handler in IdentityModal
    - updateHandoff handler in IdentityModal
    - readIdentityHistory now returns { entries, markdown } (additive widening)
    - IdentityHistoryEvent.markdown field
    - IdentityHistoryUpdatedEvent.markdown field
  affects:
    - src/ui/features/pretty-view/IdentityFileTab.tsx
    - src/ui/features/pretty-view/HistoryTab.tsx
    - src/ui/features/pretty-view/HandoffTab.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
tech_stack:
  added: []
  patterns:
    - Optional onSave prop gates edit-mode toolbar — tabs render read-only when prop absent
    - Server-echo-driven rehydrate — tab exits edit-mode after await onSave resolves (T-18-12)
    - Copy-paste over shared abstraction — two copies of Edit/Save/Cancel pattern (IdentityFileTab + HandoffTab) per patch #17g plan rule
    - sendIdentityMutation generic used for all three save handlers (mirrors updateWakeup shape)
    - Additive widening of readIdentityHistory return type — existing entries consumers unaffected
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/IdentityFileTab.tsx
    - src/ui/features/pretty-view/HistoryTab.tsx
    - src/ui/features/pretty-view/HandoffTab.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
decisions:
  - Two copies of Edit/Save/Cancel toolbar (IdentityFileTab + HandoffTab) — per patch #17g plan rule; each tab file stays self-contained
  - HistoryTab textarea seeded from state.data.markdown (raw body), not reconstructed from entries — entries are parsed/reversed, reconstructing would lose comments and exact whitespace
  - Server-echo drives exit from edit-mode — handleSave calls setEditing(false) after await onSave resolves; parent's state.data refresh batches with React re-render
  - readIdentityHistory widening is additive — both LOCAL and REMOTE branches assign raw file body to `markdown` before the existing split/filter/reverse pipeline for `entries`
metrics:
  duration: "~35 min"
  completed: "2026-07-31"
  tasks_completed: 3
  tasks_total: 4
  files_modified: 7
---

# Phase 18 Plan 02: Markdown-Tab Editors (IdentityFileTab, HistoryTab, HandoffTab) Summary

Edit/Save/Cancel toolbar with monospace textarea editor for the three markdown identity tabs, backed by the Plan 01 WS write handlers. Server-echo-driven rehydrate with dirty-confirm Cancel. PAUSED at Task 4 (Ashley UAT checkpoint).

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Edit/Save/Cancel toolbar + textarea editor to IdentityFileTab and HandoffTab | 0eeadb2 |
| 2 | Widen HistoryTab to editable — raw markdown alongside parsed entries (backend + server + wire types + modal + tab) | 3c7aa3a |
| 3 | Wire three save handlers in IdentityModal and thread onSave props to all three tab renderers | c8e0984 |

## Tasks Pending

| Task | Description | Reason |
|------|-------------|--------|
| 4 | Ashley UAT — LOCAL + REMOTE markdown writes | checkpoint:human-verify — requires Ashley to deploy and run 13-step UAT |

## What Was Built

### IdentityFileTab.tsx

- `onSave?: (contents: string) => Promise<void>` optional prop — read-only when absent
- `editing`, `draft`, `saving`, `saveError` local state via useState hooks
- Toolbar (flex justify-end) renders when `state.status === "ready" && onSave` — shows Edit button in read mode; Save + Cancel in edit mode
- Edit onClick: sets `draft = state.data`, clears `saveError`, sets `editing = true`
- Save disabled when `saving || draft === state.data` (no-op prevention + in-flight gate)
- Save text toggles "Saving…" while in flight
- handleSave: `setSaving(true)` → `await onSave(draft)` → `setEditing(false)` (success) or `setSaveError(...)` (error) → `setSaving(false)` in finally
- handleCancel: if `draft === state.data` → immediate exit; else `window.confirm("Discard unsaved changes?")` → exit on OK only
- Textarea: `font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]`
- saveError surfaces below textarea in `text-sm text-[color:var(--color-pv-code-fg)]`
- Loading/error/empty branches unchanged; ReactMarkdown prose className chain unchanged

### HandoffTab.tsx

- Identical Edit/Save/Cancel shape to IdentityFileTab (two copies per plan rule)
- Same onSave prop, state hooks, toolbar, textarea, handleSave, handleCancel patterns

### HistoryTab.tsx

- State type widened from `TabState<string[]>` to `TabState<{ entries: string[]; markdown: string }>`
- `onSave?: (contents: string) => Promise<void>` optional prop
- Read-mode: uses `state.data.entries` for the existing reverse-chronological list rendering (parseHistoryLine unchanged)
- Edit-mode: textarea seeded with `state.data.markdown` (raw file body)
- Empty-state branch updated: now shows Edit toolbar even when entries list is empty (so user can add first history entry)
- Same Edit/Save/Cancel toolbar shape, handleSave, handleCancel as IdentityFileTab

### identity-artifact-reader.ts

- `readIdentityHistory` return type widened from `Promise<{ entries: string[] }>` to `Promise<{ entries: string[]; markdown: string }>`
- LOCAL branch: reads file into `markdown`, derives `entries` from same string
- REMOTE branch: assigns `execWithTimeout` result to `markdown`, derives `entries` from it
- ENOENT paths return `{ entries: [], markdown: "" }` — additive, no consumer breakage

### claude-session-server.ts

- `identity:get-history` handler: destructures `{ entries, markdown }` from `readIdentityHistory`; emits `{ type: "identity:history", entries, markdown }` (success) and `{ ..., markdown: "" }` (error paths)
- `identity:update-history` handler: same widening — destructures `{ entries, markdown }` post-write; emits `{ type: "identity:history-updated", entries, markdown }` so HistoryTab rehydrates both read-mode list and edit-mode textarea from server truth

### claude-session-api.ts

- `IdentityHistoryEvent` widened: `markdown?: string` added (optional for backward compat)
- `IdentityHistoryUpdatedEvent` widened: `markdown?: string` added

### IdentityModal.tsx

- `historyState` type: `TabState<{ entries: string[]; markdown: string }>` (was `TabState<string[]>`)
- `openOneShot` callback for identity:history: `setHistoryState({ status: "ready", data: { entries: ev.entries, markdown: ev.markdown ?? "" } })`
- Six new imports from claude-session-api: three Payload types + three UpdatedEvent types
- Three new async handlers inserted after `updateWakeup`:
  - `updateIdentityFile(contents)`: sendIdentityMutation → setIdentityFileState({ status: "ready", data: res.markdown })
  - `updateHistory(contents)`: sendIdentityMutation → setHistoryState({ status: "ready", data: { entries: res.entries, markdown: res.markdown ?? contents } })
  - `updateHandoff(contents)`: sendIdentityMutation → setHandoffState({ status: "ready", data: res.markdown })
- Three tab mount sites updated with onSave props:
  - `<IdentityFileTab state={identityFileState} onSave={updateIdentityFile} />`
  - `<HistoryTab state={historyState} onSave={updateHistory} />`
  - `<HandoffTab state={handoffState} onSave={updateHandoff} />`

## Security Posture

| Threat | Mitigation | Status |
|--------|------------|--------|
| T-18-08: shell metacharacters in textarea | Payload never touches a shell — SFTP streams bytes (Plan 01) | Inherited |
| T-18-09: DoS via large paste | Server-side 2MB cap from Plan 01; error echoed inline | Inherited |
| T-18-12: client trusts own draft after Save | setIdentityFileState/setHandoffState use res.markdown (server echo); setHistoryState uses res.entries + res.markdown ?? contents | Mitigated |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three tabs are fully wired. Edit/Save/Cancel is functional end-to-end pending Ashley UAT (Task 4).

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary crossings beyond what the plan's threat model already covers.

## Self-Check

### Modified files exist:
- `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityFileTab.tsx` — FOUND
- `/home/ubuntu/skynet/src/ui/features/pretty-view/HistoryTab.tsx` — FOUND
- `/home/ubuntu/skynet/src/ui/features/pretty-view/HandoffTab.tsx` — FOUND
- `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityModal.tsx` — FOUND
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts` — FOUND
- `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` — FOUND
- `/home/ubuntu/skynet/src/ui/api/claude-session-api.ts` — FOUND

### Commits exist:
- 0eeadb2 — Task 1
- 3c7aa3a — Task 2
- c8e0984 — Task 3

## Self-Check: PASSED
