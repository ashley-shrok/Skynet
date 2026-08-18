---
phase: 44
slug: frontend-skill-editing-editor-surface-for-skill-folders-on-a
status: draft
shadcn_initialized: true
preset: radix-lyra
created: 2026-08-18
---

# Phase 44 — UI Design Contract

> Visual and interaction contract for the skill editor surface — a **sibling of `GlobalFilesModal`** reached from the same header menu on `PrettyConversationsPanel`. **This spec is written as "same as global-files editor except X, Y, Z"** because the shape file (`.planning/shapes/shape-frontend-skill-editing.md`) and CONTEXT D-02 mandate reuse of that modal's chrome, host dropdown, tab-bar pattern, and editor pane. Fresh visual work is intentionally minimized.

**Reference implementations to mirror (do NOT re-invent):**

| Contract | Mirror this file | Notes |
|----------|------------------|-------|
| Modal shell / overlay / dialog primitives | `src/ui/features/pretty-view/GlobalFilesModal.tsx` L186-217 | Portal, `absolute inset-4`, `z-[110]` overlay + `z-[120]` content, rounded `24px`, glass gradient `hsla(220,45%,25%,0.82) → hsla(220,40%,15%,0.88)`, `backdrop-filter: blur(28px) saturate(1.4)` |
| Header row (title + host `<select>` + glass X close) | `GlobalFilesModal.tsx` L221-271 | Add a **second `<select>`** immediately after the host `<select>` for skill picker; identical styling |
| Body loading / error / empty branches | `GlobalFilesModal.tsx` L274-298 | Same skeleton/spinner idiom, same copy tone |
| Per-tab lazy-load + `TabState<T>` cache | `GlobalFilesModal.tsx` L91-149 + `GlobalFileTab.tsx` | Same pattern per file |
| Bottom icon-bar tab strip (selected pill + FileText icon + truncate label) | `GlobalFilesModal.tsx` L321-370 | **Wrap in horizontal-scroll container** for D-06 fallback |
| Editor pane (monospace textarea + Save button + mtime conflict) | `GlobalFileTab.tsx` (whole file) | Reuse verbatim for text files |
| Menu entry site | `PrettyConversationsPanel.tsx` L1613-1617 | Add fourth item `"Edit skills…"` right below `"Edit global files…"` |

**Fast-path priority (shape file):** three selections max — menu → host → skill — then a tab click. This is Ashley's trigger; the whole UX is subordinate to it.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (existing project init — `components.json` present) |
| Preset | `radix-lyra` (baseColor `neutral`, cssVariables true) |
| Component library | Radix primitives (`radix-ui` — `Dialog`, `Tabs`) via `@/components/*` shadcn wrappers |
| Icon library | `lucide-react` (`FileText`, `X`, `Plus`, `Trash2`, `AlertTriangle`) |
| Font | Body/UI: Inter Variable (`@fontsource-variable/inter`). Code/editor: JetBrains Mono Variable (`@fontsource-variable/jetbrains-mono`) via `font-mono` Tailwind class |
| Palette authority | Skynet fleet UI convention: `--color-pv-*` tokens at `src/ui/index.css:143-176` (NOT stripped shadcn `--background`/`--foreground`). Ambient modal hue = `220` (matches GlobalFilesModal — this is a sibling entry in the same menu, so it inherits the same "modal-ambient blue" for coherence; per-identity `--pv-id-hue` is NOT threaded here because the menu-triggered modal has no active-session context, per GlobalFilesModal L1587 precedent) |

---

## Spacing Scale

Declared values (all multiples of 4). Uses Tailwind's default spacing scale as already consumed throughout the pretty-view surface.

| Token | Value | Usage in this phase |
|-------|-------|--------------------|
| xs | 4px | Icon-to-label gaps inside tab buttons (`gap-1`) |
| sm | 8px | Compact element spacing inside header row (`gap-2`), tab-strip padding (`px-2 py-1`) |
| md | 16px | Header horizontal padding (`px-6` = 24 → close enough exception below) not applicable — see exceptions |
| lg | 24px | Modal outer inset from viewport (`inset-4` = 16px; header `px-6` = 24px) |
| xl | 32px | Empty-state vertical rhythm |
| 2xl | 48px | Not used — modal fills viewport-4 |
| 3xl | 64px | Not used |

**Exceptions (mirror global-files editor exactly, do not touch):**
- Modal `absolute inset-4` = 16px viewport inset (matches GlobalFilesModal L204)
- Modal border-radius `24px` (matches GlobalFilesModal L205 `rounded-[24px]`)
- Header `px-6 py-4` = 24px / 16px (matches GlobalFilesModal L223)
- Editor textarea `min-h-[400px]` (matches GlobalFileTab L109)
- Tab strip button `px-2 py-1.5` = 8px / 6px (matches GlobalFilesModal L344 — 6px is a deliberate exception for tight bottom-bar density; do NOT normalize)
- Mobile menu-item vertical padding `max-md:py-[18px]` (matches PrettyConversationsPanel L1623 — mobile touch-target inflation, keep verbatim)

---

## Typography

Skynet fleet fonts, mirroring existing pretty-view surface.

| Role | Size | Weight | Line Height | Family | Usage in this phase |
|------|------|--------|-------------|--------|--------------------|
| Modal title | 15px | 600 (semibold) | 1.4 | Inter Variable | "Edit skills" title in header (mirrors GlobalFilesModal L226 `text-[15px] font-semibold`) |
| Body / UI | 14px | 400 (regular) | 1.5 | Inter Variable | Dropdowns, empty-state prose, error copy, menu items (mirrors GlobalFilesModal `text-sm`) |
| Tab label | 10px | 400 (regular selected → 600 semibold) | 1.3 | Inter Variable | Bottom icon-bar labels (mirrors GlobalFilesModal L344 `text-[10px]`) |
| Editor content | 14px (`text-sm`) | 400 (regular) | 1.5 | JetBrains Mono Variable | Textarea contents (mirrors GlobalFileTab L109 `font-mono text-sm`) |

Only 2 weights (400, 600). Only 3 UI sizes (15/14/10) + 1 editor size (14 mono).

---

## Color

60/30/10 split expressed against Skynet pretty-view palette. All values are those already present in the palette or mirrored verbatim from `GlobalFilesModal.tsx`.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))` over `--color-pv-base` `#141520` | Modal surface (glass gradient over app background); Skynet fleet UI convention per role file |
| Secondary (30%) | `rgba(0,0,0,0.20)` (dropdowns), `linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))` (bottom tab-strip), `rgba(220, 225, 245, 0.10)` (dividers/rims) | `<select>` fills, bottom icon-bar surround, header/footer borders |
| Accent (10%) | `hsla(220, 80%, 60%, 0.18)` fill + `hsla(220, 80%, 70%, 0.28)` inset ring for selected tab pill; `hsla(220, 80%, 60%, 0.20)` → hover `0.30` for Save button; `hsla(220, 80%, 60%, 0.50)` for focus-ring on textarea | **Reserved for:** (a) selected file-tab pill in bottom bar, (b) primary Save button on editor pane, (c) primary "Add file" button when at least one skill is picked, (d) textarea focus ring. NOTHING ELSE. |
| Destructive | `#f87171` (Tailwind `text-red-400`) for inline error copy; `hsla(0, 75%, 55%, 0.20)` fill + `hsla(0, 75%, 65%, 0.35)` inset ring for delete-confirmation "Delete" button; `hsla(0, 75%, 55%, 0.30)` on hover | **Reserved for:** (a) load/save error copy, (b) Delete-file confirmation modal's destructive button, (c) Delete-skill confirmation modal's destructive button, (d) `Trash2` icon color on hover of the delete-file / delete-skill triggers |
| Foreground text | `#f0ebe0` (primary/hi-contrast), `#e8e4d8` (default), `#a89a80` (muted) — from `--color-pv-fg` family | Copy across all surfaces (mirrors GlobalFilesModal literals) |

**Accent reserved for (explicit list — never "all interactive elements"):**
1. Currently-selected file tab in the bottom icon bar (hue-tinted glass pill)
2. Editor pane's `Save` button (inherits Save button treatment from `GlobalFileTab.tsx` L120)
3. `+ Add file` button in the header row (only rendered when a skill is picked)
4. Textarea focus ring inside the editor pane

Everything else (host dropdown, skill dropdown, menu items, tab labels at rest, Delete-skill trigger, close X) uses neutral warm-white foreground on the glass surface — no accent color.

---

## Copywriting Contract

Every string below is prescriptive. Executor uses these verbatim. Tone: matter-of-fact, no exclamation, no emoji, no "Oops!"; matches GlobalFilesModal precedent (`"Loading…"`, `"Pick a host to load its configured files."`).

### Menu entry (new)

| Element | Copy |
|---------|------|
| Menu item label (added to `PrettyConversationsPanel.tsx` L1613 menu, positioned **after** `"Edit global files…"`) | `Edit skills…` |
| ARIA `DialogTitle` (sr-only) | `Edit skills` |
| Visible modal header title | `Edit skills` |

**Menu-order rationale:** `Edit global files…` above, `Edit skills…` below — both live in the same section as file-editor tools. The two entries are visually indistinguishable (same font/size/color/hover); differentiation is by label only. Per Ashley's fleet UX preference, no icon, no keyboard shortcut hint, no "beta" badge.

### Selector labels

| Element | Copy |
|---------|------|
| Host `<select>` placeholder option | `Pick a host…` (verbatim from GlobalFilesModal L236) |
| Skill `<select>` placeholder option — no host picked | `Pick a host first…` (disabled state) |
| Skill `<select>` placeholder option — host picked, skills loaded | `Pick a skill…` |

### Loading / error / empty states

**enumerate-skills (after host is picked):**

| Branch | Copy |
|--------|------|
| Loading | `Loading skills…` (centered, `text-[#a89a80] text-sm`, mirrors GlobalFilesModal L279-281) |
| Error | `{err.message}` prefixed with `Couldn't load skills:` (centered, `text-red-400 text-sm`, mirrors GlobalFilesModal L283) |
| Empty (host has zero skills) | Heading: `No skills on this host.` Body: `Skills live in ~/.claude/skills/ on the host. Nothing to edit here yet.` (centered, `text-[#a89a80] gap-2 text-sm text-center px-6`, mirrors empty-state pattern at GlobalFilesModal L286-298) |

**enumerate-files (after skill is picked):**

| Branch | Copy |
|--------|------|
| Loading | `Loading files…` |
| Error | Prefixed `Couldn't load files:` + `{err.message}` |
| Empty (skill has zero files) | Heading: `This skill has no files.` Body: `Use "+ Add file" to create one.` |

**read-file (per-tab, inside `GlobalFileTab`-analog):**

| Branch | Copy |
|--------|------|
| Loading | `Skeleton` (verbatim from GlobalFileTab L77-84 — three stacked skeletons) |
| Error | `Couldn't load file: {err.message}` (verbatim from GlobalFileTab L88-93) |

**write-file (save):**

| Branch | Copy |
|--------|------|
| Save button idle | `Save` (verbatim from GlobalFileTab L122) |
| Save button in-flight | `Saving…` (verbatim from GlobalFileTab L122) |
| Save error inline | `{err.message}` (whatever server returns; renders as `text-sm text-red-400 px-1`, verbatim from GlobalFileTab L112-114) |
| mtime conflict (409) | `window.confirm("The file changed on disk since you started editing. Reload from disk and lose your local edits?")` — **verbatim** from GlobalFilesModal L163-165. This is one of the "no confirmation beyond global-files" cases per D-12; the mtime confirm is inherited behavior, not new. |

### Non-text file placeholder (D-08 — Claude's Discretion; **prescribed here**)

Where the editor pane would render, replace with a centered card containing:

- **Icon:** `AlertTriangle` from lucide, size 20px, color `#a89a80` (muted)
- **Heading:** `Not a text file` (14px semibold, `#e8e4d8`)
- **Body:** `This file isn't text and can't be edited here.` (14px regular, `#a89a80`)
- **Layout:** vertical flex, `gap-2`, centered both axes, fills the editor-pane rectangle so height matches a loaded text file (no layout jump when switching tabs)

Tab-bar treatment for non-text file tabs: **identical to text files** — same FileText icon, same label, same selected-pill treatment. Do NOT visually mark them as non-editable in the tab bar (per D-08 "appear as tabs (not hidden)"; Ashley wants zero pre-flight ceremony; the "can't edit" reveal happens on click).

### "New file" affordance (D-09 — Claude's Discretion; **prescribed here**)

**Shape decision:** a text-labeled button `+ Add file` sitting in the modal header row, immediately right of the skill dropdown, **only rendered when a skill is picked**. NOT a plus-tab on the bottom bar (would compete with real files for the horizontal-scroll fallback and hide behind the scroll clip when the skill has many tabs; also breaks the "tabs are files" mental model). NOT a menu action (three-tap for a hot-path action).

- **Copy:** `+ Add file` (with leading `+` as a literal character — no icon needed; matches Skynet's terse dialog verbiage seen at `NewSessionDialog.tsx`)
- **Trigger behavior:** on click, opens a small inline prompt (`window.prompt("New file name (relative to skill root):", "")` — matches Skynet's window-prompt tradition seen elsewhere in the codebase for one-string inputs); on non-empty return, calls the create-file backend endpoint, then refetches the file list and auto-selects the new tab. Empty / cancelled prompt = no-op. Duplicate name = backend rejects; surface via existing loading/error branch on the tab strip.
- **Styling:** `px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm cursor-pointer` — visually a peer to the two dropdowns beside it (same height, same corner radius, same idle color). Accent hover: `bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)]` (matches the Save button treatment because "+ Add file" is the header-row primary action). Disabled state (`opacity-40 cursor-not-allowed`) when no skill is picked or file list is still loading.
- **Placement rationale:** the shape file's fast-path (menu → host → skill → tab click) is preserved because add-file is a supplementary action, not the primary path; it visually clusters with the two selectors it depends on rather than the tab strip.

### Destructive actions

Two destructive actions in this phase. Both use a **modal-in-modal confirmation** (a small centered card layered on top of the skill-editor modal, dimming it) — NOT `window.confirm` (this is user-initiated destruction of visible content and deserves a real design surface, not a native browser blocker Ashley cannot style; the mtime-conflict `window.confirm` above is inherited and different — it's an infrequent system-triggered clarification, not a user-triggered destruction).

**Delete file (D-10, only explicit user confirmation Ashley requested):**

| Element | Copy |
|---------|------|
| Trigger — placement | Small `Trash2` icon-button (16px, `#a89a80` idle → `#f87171` hover, `size-6 rounded-md hover:bg-white/[0.06]`) rendered inside the editor pane's action row, to the **left** of the Save button (so it's contextually next to what it destroys) |
| Trigger — tooltip | `Delete this file` (via `title` attribute — same idiom as GlobalFilesModal close X) |
| Confirmation dialog heading | `Delete file?` |
| Confirmation dialog body | `{skill}/{path}` on its own line as monospace, then plain: `This can't be undone.` |
| Confirmation dialog primary button | `Delete` (destructive-colored per Color contract) |
| Confirmation dialog secondary button | `Cancel` (neutral: `bg-transparent border border-white/10 text-[#e8e4d8]`) |
| In-flight primary label | `Deleting…` |
| Error inline on failure | `Couldn't delete: {err.message}` (red text, dialog stays open) |
| On success | Dialog closes; file removed from tab list; if it was the active tab, select the next tab to the right (or previous, or none if it was the last) |

**Delete skill (D-11 — Ashley did NOT explicitly ask for a confirm here, but plain-editor philosophy + magnitude of destruction (removes folder + everything inside) warrants the same modal-in-modal shape; the philosophy anchor is "the user is trusted, editor is a fast tool, not a safety harness" — so we do NOT add extra guards like typing the skill name, but we do surface the blast radius with one click of friction):**

| Element | Copy |
|---------|------|
| Trigger — placement | Small `Trash2` icon-button (same treatment as delete-file trigger) rendered inside the header row, immediately to the right of the `+ Add file` button, **only rendered when a skill is picked** |
| Trigger — tooltip | `Delete this skill` |
| Confirmation dialog heading | `Delete skill?` |
| Confirmation dialog body | `{skill}` on its own line as monospace, then plain: `This removes the skill folder and every file inside it. This can't be undone.` |
| Confirmation dialog primary button | `Delete skill` (destructive-colored) |
| Confirmation dialog secondary button | `Cancel` |
| In-flight primary label | `Deleting…` |
| Error inline on failure | `Couldn't delete: {err.message}` (red text, dialog stays open) |
| On success | Dialog closes; skill removed from skill dropdown; if it was the picked skill, dropdown reverts to placeholder state and tab list clears (mirrors host-change behavior) |

**Confirmation dialog visual shape (both destructive dialogs):**
- Portaled via `DialogPrimitive.Portal` with `z-[130]` (above the parent modal's `z-[120]` content)
- Overlay: `bg-black/40` fills the parent modal's `inset-4` region (not the full viewport — dim the modal, not the app)
- Content: centered, `max-w-[400px] w-[85%]`, `rounded-[16px]`, same glass gradient family as parent modal but slightly darker (`linear-gradient(160deg, hsla(220, 45%, 20%, 0.92), hsla(220, 40%, 12%, 0.94))`) so the layer stack reads as "raised further"
- Header: `Delete file?` / `Delete skill?` at 15px semibold `#f0ebe0`
- Body: 14px regular, `#e8e4d8`, includes a monospace `<code>` inline for the file path or skill name (matches empty-state pattern at GlobalFilesModal L293)
- Button row: right-aligned, `gap-2`, `Cancel` left / destructive right (matches Skynet fleet convention seen at IdentityModal delete flows)
- Focus trap: primary destructive button auto-focuses when dialog opens (mirrors `NewSessionDialog` primary-focus pattern)
- Esc dismisses = Cancel; Enter with primary focused = Delete

---

## Keyboard & Focus Contract

**Focus order on modal open** (D-52-item Claude's Discretion — prescribed here):

1. Host `<select>` (auto-focus if no `defaultHostId`; if `defaultHostId` is set, jump to step 2)
2. Skill `<select>` (auto-focus after host selection commits; disabled/skipped when no host picked)
3. First file tab in the bottom bar (auto-focus after skill selection commits and file list is non-empty)
4. Editor textarea (auto-focus on tab activation, cursor at end of content)

**Key bindings:**

| Key | Behavior |
|-----|----------|
| `Tab` / `Shift+Tab` | Native forward/back through focusable elements — host → skill → `+ Add file` → delete-skill → bottom-bar tabs → editor textarea → Save → delete-file. Native browser order, no custom trap beyond Dialog's own. |
| `Enter` on a `<select>` option | Native commit (native `<select>` per GlobalFilesModal precedent — do NOT swap for a Radix `Select` in this phase; keeps mobile behavior aligned) |
| `Esc` | Native Dialog `onOpenChange(false)` — closes the modal (matches DialogPrimitive close-on-escape default which is preserved by NOT setting `onEscapeKeyDown`, mirroring GlobalFilesModal L197-202 which only overrides `onInteractOutside`) |
| `Cmd/Ctrl+S` inside the textarea | **NOT bound in this phase.** GlobalFileTab does not bind it either. Save is button-only. (Deferred so the mtime-conflict UX stays predictable; can layer on later without contract change.) |
| Arrow keys on bottom tab bar | Native left/right cycling through tab buttons (Radix Tabs primitive already handles this; keep default) |

**Mobile / iOS PWA notes:**
- Header row wraps on narrow viewports — the two `<select>`s stack vertically above `+ Add file` + delete-skill trigger (use `flex-wrap gap-2`)
- All interactive elements meet the fleet-wide 44px touch-target via existing `touch-action: manipulation` `[role="button"]` rule at `src/ui/index.css:58-72` — do NOT add per-element overrides
- Menu item padding uses `max-md:py-[18px] max-md:px-[14px]` (verbatim from PrettyConversationsPanel L1623) so the new `Edit skills…` entry inflates to touch-friendly height on mobile
- The modal's `absolute inset-4` inset means it consumes viewport-minus-16px; existing safe-area-inset handling on the parent panel is inherited (no per-modal work needed)

---

## Component Inventory (what the executor adds)

New files (mirror-and-fork from GlobalFilesModal cluster):

| File | Mirrors | What's different |
|------|---------|------------------|
| `src/ui/features/pretty-view/SkillsEditorModal.tsx` | `GlobalFilesModal.tsx` | Adds second `<select>` (skill picker) after host; adds `+ Add file` + delete-skill buttons in header; wraps bottom tab bar in horizontal-scroll container (`overflow-x-auto` with `-webkit-overflow-scrolling: touch`); title copy = `Edit skills`; empty/loading/error copy per Copywriting contract; mounts `DeleteFileConfirmDialog` + `DeleteSkillConfirmDialog` internally |
| `src/ui/features/pretty-view/SkillFileTab.tsx` | `GlobalFileTab.tsx` | Two branches added: (a) **non-text file placeholder** rendering `AlertTriangle` + heading + body per Copywriting; (b) delete-file `Trash2` trigger next to Save. Otherwise identical: same TabState, same skeleton, same textarea, same monospace, same save-button treatment, same mtime-conflict handling |
| `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` | (new — no direct mirror; visual shape prescribed in Copywriting) | Generic destructive-confirm dialog, portaled with `z-[130]`; consumed by both delete-file and delete-skill flows via props (heading, body-node, primary-label, on-confirm) |
| `src/ui/api/skills-api.ts` | `src/ui/api/global-files-api.ts` | Same axios idiom, same `TabState`, same 409 mtime-conflict typed error, plus: `listSkills(hostId)`, `enumerateSkillFiles(hostId, skill)`, `createSkillFile(hostId, skill, path)`, `deleteSkillFile(hostId, skill, path)`, `deleteSkill(hostId, skill)`. Reuses `GlobalFileMtimeConflictError` semantics for save conflicts (import + re-export, or duplicate the class — planner's call) |

Modified files:

| File | Change |
|------|--------|
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Add `[skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false)`; add `<SkillsEditorModal ... />` sibling of `<GlobalFilesModal ... />` at L1583; add menu item `{ label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) }` at L1616 (position: **after** the `Edit global files…` entry) |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | `@/components/dialog` (Dialog primitives — already installed), `@/components/tabs` (Tabs primitive — already installed), `@/components/skeleton` (Skeleton — already installed) | not required (shadcn official) |
| lucide-react | `FileText`, `X`, `Plus` (or literal `+` character), `Trash2`, `AlertTriangle` — all already installed at `lucide-react@^1.28.0` | not required (lucide is first-party) |

No third-party registries declared. No vetting gate required.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
