# Phase 18 / Plan 18-03 — SCRATCH REPORT (waived)

**Status:** SCRATCH ITERATION WAIVED by Ashley 2026-07-31.
**Ashley's verbatim greenlight:** *"I feel like you don't need to show me anything, just get something functional in there and then I will probably come back later wanting to polish it on my own at some point."*

Per plan Task 1 Option C: Ashley explicitly waived the scratch prerequisite. Design decisions below are unilateral defaults chosen by Tina to give Plan 05's executor an unambiguous spec. Ashley reserves the right to open follow-up polish bounties for any specific field once the functional shape is in her hands.

**Task 1 outcome:** Option C (skip scratch — explicit waiver, per Ashley verbatim above).
**Task 2 outcome:** N/A (skipped per waiver).
**Task 3 outcome:** This document.

---

## Guiding principles for the "functional-not-polished" default set

1. **Match Wave 2's markdown-tab shape wherever possible** — Edit/Save/Cancel toolbar buttons with `cursor-pointer`, `variant="outline"` for Edit + Cancel, `variant="default"` for Save. Same colors, same typography, same glass tokens. Consistency > novelty.
2. **Prefer edit-mode toggle over always-editable** for anything that competes with a natural read view (premise textarea, todos list). Always-editable OK for atomic scalars where the field IS the input (title, deadline).
3. **shadcn primitives, not hand-rolled DOM.** Use `Input`, `Textarea`, `Checkbox`, `Button` from `src/components/`. Avoid bare `<input>` / `<textarea>` unless a shadcn primitive doesn't cover the shape.
4. **`window.confirm("Discard unsaved changes?")` on dirty-cancel** — same guard used in IdentityFileTab/HistoryTab/HandoffTab.
5. **Server-echoed truth wins.** Save response returns the fresh bounty; card re-hydrates from server state (mirrors Wave 2's `identity:*-updated` echo pattern).
6. **`cursor-pointer` on every button** (regression the Wave 2 UAT caught — do not repeat).
7. **No polish, no animations, no drag-and-drop library.** Ship functional. If a field would take 30 min to polish vs 10 min to ship functional, ship functional and let Ashley pick the polish bounty later.

---

## Locked Field Editor Shapes

### 1. `title` (string)

- **Editor type:** Inline `<Input>` inside the card header row, replacing the `bounty.title` `<span>` while editing.
- **Trigger:** Pencil icon (lucide `Pencil`, 14px) rendered next to the title in the expanded body header — click to enter edit mode. Not in the collapsed row header (avoid noise on the scannable list).
- **Save:** Enter key **OR** dedicated Save button below the input.
- **Cancel:** Escape key **OR** dedicated Cancel button. Dirty-confirm on Cancel.
- **Validation:** Non-empty (trim; reject `""` on save with inline error).
- **Wire field:** `title: string`

### 2. `premise` (string, often multi-paragraph)

- **Editor type:** `<Textarea>` (shadcn) filling the expanded body's premise slot. Monospace font (`font-mono`) matching the markdown-tab editor pattern.
- **Trigger:** Pencil icon inline with the "Premise" label (or on the premise block itself). Click to enter edit mode; textarea replaces the read-mode wrapped text.
- **Save:** Dedicated Save button (Cmd+Enter / Ctrl+Enter shortcut secondary). No Enter-to-save — premise is often multi-line and Enter must insert a newline.
- **Cancel:** Escape **OR** Cancel button. Dirty-confirm on Cancel.
- **Validation:** No length cap (server enforces via existing `IDMEDIT_MAX_BOUNTY_JSON_BYTES` = 100KB). Empty premise IS allowed (bounties can genuinely have no premise).
- **Wire field:** `premise: string`

### 3. `todos` (`{ text: string; done: boolean }[]`) — 5 sub-interactions

- **List editor** rendered as an editable version of the existing read-only todo list. Always in edit mode when the card is expanded — no explicit toggle. Each todo row:
  - `<Checkbox>` on the left (toggle `done`). Click anywhere on the checkbox toggles.
  - Text as an `<Input>` (auto-sized, or `<Textarea>` if the text is long). Blur commits. Enter commits.
  - `<Button variant="ghost" size="icon">` with lucide `X` on the right (per-row remove).
  - Drag handle (lucide `GripVertical`, 14px) on the far left for reorder — **defer drag implementation; use up/down arrows for functional-first.** Up arrow (`ChevronUp`) and down arrow (`ChevronDown`) buttons appear on hover/focus of the row. Drag-and-drop is a polish-later bounty candidate.
- **Add-todo control:** A dedicated `<Input placeholder="Add todo…">` at the bottom of the list. Enter adds + clears the input for the next; the plus-button (lucide `Plus`) also adds.
- **Debounce:** Text edits debounced 400ms before wire save. Toggle-done, remove, reorder, and add fire immediately.
- **Save trigger:** Autosave (debounced 400ms after any change). No explicit Save/Cancel — matches "list of todos" mental model where each row is its own tiny commit.
- **Validation:** Empty-string todo text is not saved (add-input requires non-empty; blur on an emptied edit removes the row with a dirty-confirm).
- **Wire field:** `todos: { text: string; done: boolean }[]` — send the full list on any change; server replaces wholesale (partial per-index patching is overkill for a bounded list).

### 4. `keywords` (`string[]`)

- **Editor type:** Chip-list editor. Each existing keyword renders as a chip (`<Badge>` shadcn primitive with an `X` icon on the right for removal). An `<Input>` at the end for adding new keywords.
- **Add:** Type in the input → Enter adds the keyword (trimmed, deduplicated, lowercased) → input clears. Comma also acts as add (typing `foo,` adds `foo`).
- **Remove:** Click the chip's `X`. No confirm — undo-by-retype is trivial.
- **Save trigger:** Autosave immediately on add/remove.
- **Validation:** Non-empty, deduplicated (case-insensitive), max 20 keywords (soft cap — no enforcement in wire, just UI clamp).
- **Wire field:** `keywords: string[]`

### 5. `source_links` (`string[]`)

- **Editor type:** Same chip-list pattern as `keywords`, but with URL semantics.
- **Add:** Type URL in `<Input placeholder="Add link (URL)…">` → Enter adds. Blur-with-content also adds.
- **Remove:** Chip's `X`.
- **Save trigger:** Autosave immediately.
- **Validation:** Basic URL shape (`^https?://` OR `^/`) — reject with inline error on invalid.
- **Wire field:** `source_links: string[]`
- **Display in read mode:** Each source_link renders as a clickable `<a href={link} target="_blank" rel="noopener noreferrer">` — XSS mitigation from the plan-checker (T-18-26): filter `href` through a `safeHref` helper that rejects `javascript:` and `data:` schemes.

### 6. `deadline` (`string | null`, ISO-8601)

- **Editor type:** `<Input type="date">` (browser-native date picker). **Date-only, not datetime** — matches "get it done by X day" use case. A datetime picker for hour-precise deadlines is a polish-later concern.
- **Trigger:** Always-editable input in the expanded body. Empty input = no deadline (`null`).
- **Save:** On change (native date picker's `onChange` fires on pick).
- **Cancel:** N/A (edit is atomic — pick a date or clear it).
- **Validation:** Any parseable ISO date. Server accepts both `YYYY-MM-DD` and full-ISO-with-time; UI writes only `YYYY-MM-DD`.
- **Wire field:** `deadline: string | null` (send `null` to clear).

### 7. `meeting_questions` (`{ text: string; answered: boolean }[]`)

Per IDMEDIT-08: user-only-authored. UI-layer enforcement only.

- **Editor type:** List editor, similar to `todos` but simpler (no reorder, no per-row edit-in-place — questions are usually written once):
  - Each row: `<Checkbox>` for `answered`, question text as read-only span, `X` to remove.
  - Bottom: `<Input placeholder="Add meeting question…">` + Enter to add.
- **Trigger:** Always in edit mode when card is expanded.
- **Save:** Autosave on add/toggle-answered/remove (same as todos).
- **Validation:** Non-empty question text (empty input doesn't add).
- **Wire field:** `meeting_questions: { text: string; answered: boolean }[]`

---

## Locked Wire Contract

Wave 4 implements `identity:update-bounty-fields`:

**Payload:**
```typescript
{
  type: "identity:update-bounty-fields";
  identityKey: string;
  hostId: number;
  bountySlug: string;
  fields: {
    title?: string;
    premise?: string;
    todos?: { text: string; done: boolean }[];
    keywords?: string[];
    source_links?: string[];
    deadline?: string | null;  // ISO-8601 YYYY-MM-DD or full ISO; null clears
    meeting_questions?: { text: string; answered: boolean }[];
  };
}
```

**Response:**
```typescript
{
  type: "identity:bounty-fields-updated";
  bounties: Bounty[];         // fresh open list
  archivedBounties: Bounty[]; // fresh archive list
  error?: string;
}
```

Server-side behavior (per plan 18-04):
- Atomic tmp+rename write.
- `changedFields` enumerated from the caller's `fields` keys — id / created_at / updated_at / timeline / pinned / requested_by are NEVER writable via this handler.
- `updated_at` bumped to `new Date().toISOString()`.
- One `timeline` entry appended per changed field, format: `<ISO-Z> <field> updated via identity modal` (matches patch #154 convention in `writeIdentityBountyPriority` line 768).
- Both LOCAL (fs) and REMOTE (SFTP, from Wave 1's helper) branches.
- Response echoes fresh bounty lists so BountyCard re-hydrates from server truth (mirrors Wave 2's echo pattern).

---

## IDMEDIT-08 Semantics — Explicitly Confirmed

- **`meeting_questions[]` is user-only-authored.** The bounty-field editor exposes add + mark-answered as UI affordances. No agent-callable programmatic-add path is introduced. No new server WS handler is added that a bounty-updating agent flow could invoke to add a `meeting_question` on the user's behalf. The `identity:update-bounty-fields` wire handler DOES accept `meeting_questions` writes from any authenticated caller (matching the existing bounty-write convention where the wire doesn't enforce field-level authorship), but UI convention is the semantic guard — mirrors Ashley's 2026-07-08 note on the bounty schema. Rationale: leaking user-only semantics into the wire would also block legitimate agent-driven bounty-create flows that co-populate multiple fields; UI-layer convention is sufficient and matches the existing `pinned` treatment.

- **`pinned` is NOT surfaced as a bounty-field editor field.** The header star toggle from patch #172 remains the sole path to flip `pinned`. Plan 05 does not add a pinned checkbox / toggle / editor field. The `identity:update-bounty-fields` handler explicitly rejects `pinned` in `fields` (fail-loud with `error: "pinned is not editable via update-bounty-fields; use update-bounty-pinned"`).

---

## Open Items (deferred for follow-up bounties Ashley will open on her own)

Per Ashley's verbatim: *"I will probably come back later wanting to polish it on my own at some point."*

The following are consciously deferred to polish-later bounties (Ashley will park them herself when she gets to them):

- **Drag-and-drop todo reorder** — up/down arrows ship in Wave 5. Drag handle is polish-later.
- **Datetime deadline** — date-only ships in Wave 5. Hour-precise is polish-later.
- **Rich `premise` editor** (markdown preview, code highlighting) — plain textarea ships in Wave 5.
- **Undo / redo across field edits** — no history stack in Wave 5.
- **Inline conflict resolution** if two clients edit the same bounty concurrently — Wave 5 ships last-write-wins with server-echo re-hydration; conflict UX is polish-later.
- **Autosave visual feedback** (saved indicator, save-in-flight spinner) — Wave 5 ships silent autosave; visual feedback is polish-later.
- **Keyboard shortcut hints in the UI** — Wave 5 assumes discoverability; hint UI is polish-later.

---

## Ashley's Greenlight Quote

**Verbatim:** *"I feel like you don't need to show me anything, just get something functional in there and then I will probably come back later wanting to polish it on my own at some point."*

**Context:** 2026-07-31, in the Phase 18 execute-phase flow, at the Wave 3 Task 1 scratch-approach decision point, immediately after Tina presented the A/B/C options plainly. Ashley picked Option C (waive scratch).

## Scratch Artifacts Reference

No scratch overlays were produced. The scratch iteration was fully waived at Task 1.
