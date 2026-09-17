# Phase 112: pretty-markdown-editing-across-all-frontend-markdown-editing - Research

**Researched:** 2026-09-16
**Domain:** React WYSIWYG markdown editor integration (frontend UX polish)
**Confidence:** HIGH (engine, plugin composition, dark-theme mechanism, filename-plumbing route all verified against installed source or live sample; a small band of MEDIUM-confidence detail around exact dialog-scoped CSS selectors surfaces as `[VERIFIED: dist/style.css]` where confirmed and `[ASSUMED]` where not)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Editor engine**
- **D-01: MDXEditor is the chosen engine.** Locked on a 4-way tasting (MDXEditor vs. Milkdown / Crepe vs. BlockNote vs. Toast UI) at `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/`. MDXEditor was the only one of the four that preserves the top-of-file settings block ("frontmatter") through a body-only save — the other three destroy the fences and/or the keys. Round-trip diffs and DOM probes are in that folder.
- **D-02: Add `@mdxeditor/editor` (^4.2.5) as a dependency** and lazy-load it the same way `@uiw/react-codemirror` is lazy-loaded in `SSHAuthDialog.tsx` — the editor is heavy and only the file-editing surfaces need it.
- **D-03: MDXEditor plugin set (starting point):** `headingsPlugin`, `listsPlugin`, `quotePlugin`, `thematicBreakPlugin`, `linkPlugin` + `linkDialogPlugin`, `tablePlugin`, `codeBlockPlugin` + `codeMirrorPlugin` (for fenced-code syntax highlighting), `frontmatterPlugin`, `markdownShortcutPlugin`, and `toolbarPlugin` with an appropriate button set. Planner may adjust the set after research; frontmatter is the load-bearing plugin and stays.

**Frontmatter (settings block)**
- **D-04: Frontmatter is handled via MDXEditor's built-in "Edit frontmatter" toolbar button.** Clicking it opens a dialog that populates from what's already in the file and lets the user edit keys/values as form fields. The pretty view for body prose does NOT show or fold the frontmatter into running text.
- **D-05: Preservation contract — a body-only edit MUST round-trip the frontmatter block untouched.** This is the one shape where byte-for-byte round-trip fidelity is required. Verified in the tasting: MDXEditor scored 0 lines rewritten on frontmatter when only body was edited; the three losers scored ~4–5. Tests must enforce this invariant.

**Filetype gate (mixed-content surfaces)**
- **D-06: On `SkillFileTab` and `GlobalFileTab`, extension check decides the mode.** `.md` (case-insensitive) → pretty editor. Anything else (`.json`, `.sh`, `.txt`, no-extension, etc.) → the existing plain monospace textarea, kept exactly as it is today. Decision keyed off `state.data`'s file name — the backend already surfaces it via the tab's props.
- **D-07: One mode visible at a time.** No user-facing toggle to swap between pretty and raw. The gate is deterministic from the filename; a user who wants raw editing for a `.md` file is not a scenario we need to support.
- **D-08: The four file-tab surfaces reduce to ONE shared component.** The current near-byte-identical clones (`IdentityFileTab`, `RoleFileTab`, `GlobalFileTab`, `SkillFileTab`) become thin wrappers over a shared `MarkdownEditor` (or equivalent) component. Preserving the existing `TabState<T>` contract exported from `IdentityFileTab.tsx` is required — every downstream call site depends on it.

**Reformatting policy**
- **D-09: Byte-for-byte prose fidelity is NOT required.** MDXEditor normalises emphasis characters (`*` vs `_`), list bullet characters, and indentation. That's fine.
- **D-10: No back-end changes.** The on-disk file-format contract is unchanged.

**Dark-theme styling (Skynet-native)**
- **D-11: MDXEditor ships light-mode defaults. Ship it dark, matching Skynet's chrome.** Internal elements need force-styled to readable light-on-dark; toolbar matches Skynet's `--color-pv-*` tokens (`src/ui/index.css:117-146`) rather than MDXEditor's defaults.
- **D-12: Inline code (single backticks) and fenced code blocks (triple backticks) both need proper dark-theme styling and must be styled together.** Use the app's existing `--color-pv-code-*` tokens as the source of truth (same colours used for code in chat message bubbles and in the read-mode markdown preview today).
- **D-13: The frontmatter dialog's inputs also need dark-theme styling.** MDXEditor opens it as a Radix Dialog; its default styles need overriding to match Skynet.

**Testing**
- **D-14: Round-trip test is required for the frontmatter preservation contract (D-05).** At minimum: load a file with frontmatter, edit only the body, save, assert the frontmatter fence + keys survive byte-identically.
- **D-15: Filetype gate test is required for D-06.** Load `SkillFileTab` and `GlobalFileTab` with a `.md` file → asserts pretty editor renders. Load them with `.json` / `.sh` → asserts the plain textarea renders.
- **D-16: Existing vitest suites for the four file tabs are the natural regression boundary.** All must still pass after the refactor to the shared component.

### Claude's Discretion
- Naming and location of the new shared component (typical path: `src/ui/features/pretty-view/MarkdownEditor.tsx` or under a small subfolder).
- Exact toolbar button set within MDXEditor's plugin catalogue (D-03 lists the starting set; planner+executor may add/remove based on research).
- How the dark-theme CSS is packaged (a dedicated CSS file? Tailwind classes? A small `mdxeditor.dark.css` that ships alongside the component?).
- Test file structure — mirror the existing `.test.tsx` per-tab layout, or one consolidated test file for the shared component; either is fine.

### Deferred Ideas (OUT OF SCOPE)
- Pretty editor on plain-text bounty fields (bounty title, todos, keywords, source links, meeting questions) — those are not markdown; their raw inputs are the correct control.
- Undo/redo overlay, autosave visual feedback, keyboard-hint UI, drag-drop todo reorder, datetime deadline, rich premise editor, conflict UX — the polish items the earlier `file-editing-in-identity-modal` bounty scratch-report deferred. Not this phase.
- WYSIWYG editing of code content inside fenced blocks. Code stays as monospaced non-rendered content.
- Chat message rendering changes — that surface uses read-only `react-markdown` and is already correct; unchanged.
- Mirror-hygiene followups from Phase 44 — planner may fold any that naturally land in-path; anything that doesn't stays in that bounty.
- The T800 D-07 CSRF regex-gap — Cairo's finding from the sibling `serve-url-cors-deny-breaks-module-based-dev-servers` bounty. Orthogonal work.
</user_constraints>

## Summary

Phase 112 replaces the raw `<textarea>` in eight frontend markdown-editing surfaces with MDXEditor, a battle-tested React WYSIWYG whose defining feature (relative to the three competitors) is **round-trip preservation of YAML `---`-delimited frontmatter**. The engine is locked (D-01); this research validates the plugin composition, resolves the dark-theme strategy, plumbs the filename to the mixed-content tabs (which today don't receive it), and specifies the shape of the shared component that replaces the four near-identical file-tab clones.

Two findings materially shape the plan:

1. **MDXEditor has an official first-class dark-theme mechanism** — assign the class `dark-theme` (or, conveniently, the `.dark` class Skynet already uses on `<html>`) and its bundled CSS flips to a Radix-colours palette. The tasting harness's sledgehammer `.mdxeditor * { color: ... !important }` approach is throw-away; the production component should adopt `className="dark-theme"` plus CSS-variable overrides mapping MDXEditor's tokens to Skynet's `--color-pv-*` tokens. The frontmatter dialog is portaled to `editorRootElementRef?.current` (i.e. WITHIN the editor root), so its Radix Dialog inherits the same theme scope. No sledgehammer needed.

2. **The filename lives ONE prop layer up from the tab component today.** `GlobalFilesModal.tsx:316` and `SkillsEditorModal.tsx:570` (and their runbook/editable-file cousins) instantiate the tab with `state={tabData.get(file.path) ...}` — `file.path` is the filename but is never passed INTO the tab. The filetype gate (D-06) requires the shared component to receive filename as a new prop. That's a call-site touch at each of the ~4 mounting points, not a backend change.

**Primary recommendation:** Build a shared `MarkdownEditor` component at `src/ui/features/pretty-view/MarkdownEditor.tsx` that takes `{filename, content, onChange, disabled}` — a controlled-value editor with a filetype gate baked in (returns `<textarea>` when filename doesn't match `/\.md$/i`, MDXEditor otherwise). Wrap that in a per-tab shim that adapts `TabState<T>` → `content` and the tab's save-handler shape (varies by tab). Lazy-load the whole MDXEditor module inside the shared component (dynamic import + Suspense). Package the dark theme as a dedicated `mdxeditor.dark.css` sibling that maps `--baseText`/`--accentText`/etc. to Skynet's `--color-pv-*` tokens, and layer app-side `.dark-theme code { ... }` / `.dark-theme .cm-editor { ... }` overrides for the code paths.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WYSIWYG markdown rendering + editing | Browser / Client | — | Pure frontend; MDXEditor is a React component with a Lexical state tree, no server round-trips. |
| Frontmatter round-trip parsing/serialisation | Browser / Client | — | `frontmatterPlugin` uses `mdast-util-frontmatter` + `js-yaml` on the client. On-disk format contract unchanged (D-10). |
| Filetype gate decision (`.md` vs. other) | Browser / Client | — | A pure `filename.endsWith(".md")` check inside the shared component. |
| Save handler (SFTP write, mtime conflict) | API / Backend | — | Existing `PUT /global-files/write`, `PUT /skills-editor/write` endpoints — unchanged. |
| Dark-theme styling | Browser / Client | — | CSS + `.dark-theme` class + `--color-pv-*` token overrides. |
| Frontmatter dialog UI (Radix Dialog) | Browser / Client | — | Portaled inside MDXEditor root, theme scope inherited. |
| Lazy-load bundle split | Browser / Client (Vite build) | — | Dynamic `import("@mdxeditor/editor")` splits MDXEditor into a separate chunk. |

**Sanity check:** No capability crosses tiers. Backend is genuinely untouched (D-10).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mdxeditor/editor` | ^4.2.5 [VERIFIED: npm registry, 2026-09-13 modified] | React WYSIWYG editor with plugin architecture; frontmatter-preserving | Locked in tasting (D-01); ~892k weekly downloads [VERIFIED: npmjs.com/downloads]; single maintainer `petyosi` but 3+ year old package with actively-maintained repo `mdx-editor/editor` [VERIFIED: gh api] |

### Supporting (already installed — reuse, do not re-add)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` | ^19.2.5 | Base runtime | MDXEditor peer-dep `>= 18 \|\| >= 19` [VERIFIED: npm view peerDependencies] |
| `react-dom` | ^19.2.3 | Base runtime | ditto |
| `react-markdown` | ^10.1.0 | Read-mode markdown rendering | UNCHANGED — `IdentityFileTab`/`RoleFileTab` read-mode preview keeps using it |
| `remark-gfm` | ^4.0.1 | GFM support in read-mode | UNCHANGED |
| `@testing-library/react` | ^16.3.2 | Component tests | Existing patterns; use for the shared component tests |
| `vitest` | ^4.1.8 | Test runner | Frontend project uses `jsdom` [VERIFIED: vitest.config.ts:56] |

MDXEditor bundles its own copies of `lexical`, `@codemirror/*`, `mdast-util-frontmatter`, `js-yaml`, `react-hook-form`, `micromark-extension-frontmatter` — no direct imports required from us; those are internal transitive deps.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MDXEditor | Milkdown / Crepe, BlockNote, Toast UI | Tasted; all three destroy the `---` frontmatter fences on body-only save. Not viable given D-05. |
| Full plugin set | Minimal plugin set | Every plugin listed in D-03 is justified by a real markdown feature these files contain — headings, lists, quotes, links, tables, fenced code. Dropping any means the WYSIWYG becomes lossy for that feature. Do NOT trim below D-03. |
| Custom dark-theme CSS from scratch | MDXEditor's built-in `dark-theme` class + Skynet-token overrides | Reinventing means we own every future MDXEditor internal change. Use the built-in — override only what deviates from Skynet's palette. |

**Installation:**
```bash
npm install @mdxeditor/editor@^4.2.5
```

**Version verification:**
- `npm view @mdxeditor/editor version` → `4.2.5` [VERIFIED: 2026-09-16]
- `npm view @mdxeditor/editor time.modified` → `2026-09-13T07:01:13.844Z` (fresh release)
- `npm view @mdxeditor/editor peerDependencies` → `react >= 18 || >= 19`, `react-dom >= 18 || >= 19` — Skynet on React 19.2 is well within range.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@mdxeditor/editor` | npm | 3.2 years (created 2023-06-27) [VERIFIED: npm view time.created] | ~892k / week [VERIFIED: api.npmjs.org/downloads/point/last-week] | [github.com/mdx-editor/editor](https://github.com/mdx-editor/editor) [VERIFIED: gh api] | not available | Approved (manually verified) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**slopcheck not available at research time.** Per the Package Legitimacy Gate protocol, `@mdxeditor/editor` above is technically tagged `[ASSUMED]` pending automated audit. However, manual audit confirms:
1. Registry age (3+ years) and download volume (~892k/wk) rule out slopsquat.
2. Source repo `github.com/mdx-editor/editor` is real, actively-committed, MIT-licensed, and matches the npm homepage `mdxeditor.dev`.
3. Sole maintainer is `petyosi <underlog@gmail.com>` — Petyo Ivanov, known author of `react-virtuoso` and other well-established React libraries. Consistent identity across public projects.
4. `npm view @mdxeditor/editor scripts.postinstall` → empty (no postinstall hook). [VERIFIED]

The planner may still gate the install behind a `checkpoint:human-verify` if project policy requires it, but the manual evidence above is unusually strong; the tasting harness already exercised the exact `4.2.5` build across the four-engine comparison without incident.

## Architecture Patterns

### System Architecture Diagram

```
                      ┌──────────────────────────────────────────────────────┐
                      │  Caller surface (one of 8)                           │
                      │                                                       │
                      │  IdentityModal → IdentityFileTab                     │
                      │  RoleModal → RoleFileTab                             │
                      │  GlobalFilesModal ─→ GlobalFileTab                   │
                      │  SkillsEditorModal ─→ SkillFileTab                   │
                      │  RunbookEditorModal ─→ SkillFileTab                  │
                      │  EditableFileModal ─→ GlobalFileTab                  │
                      │  BountyCard (premise field, inline)                  │
                      │  AddWakeupDialog (instruction field, inline)         │
                      │                                                       │
                      │  Each caller owns:                                    │
                      │   - TabState<T> or raw string draft                   │
                      │   - save handler (varies by surface)                  │
                      │   - filename (known at caller — file.path etc.)      │
                      └───────────────────────┬───────────────────────────────┘
                                              │  { filename, content, onChange, disabled? }
                                              ▼
                      ┌──────────────────────────────────────────────────────┐
                      │  MarkdownEditor (NEW shared component)               │
                      │  src/ui/features/pretty-view/MarkdownEditor.tsx      │
                      │                                                       │
                      │        ┌──────────────────────────────┐              │
                      │        │  Filename gate               │              │
                      │        │  /\.md$/i.test(filename)     │              │
                      │        └──┬──────────────────┬────────┘              │
                      │    match  │                  │  no match             │
                      │           ▼                  ▼                        │
                      │  ┌────────────────┐   ┌──────────────────────┐      │
                      │  │  MDXEditor     │   │  Raw <textarea>       │      │
                      │  │  (lazy-loaded) │   │  (existing markup,    │      │
                      │  │  ─ dark-theme  │   │   verbatim classes)   │      │
                      │  │  ─ plugins D-03│   │                       │      │
                      │  └────┬───────────┘   └──────┬────────────────┘      │
                      └───────┼─────────────────────┼─────────────────────────┘
                              │  onChange(md)       │  onChange(text)
                              ▼                     ▼
                       Caller draft state (setDraft) → save handler → API
                                                                       │
                                                                       ▼
                       PUT /global-files/write   (unchanged)
                       PUT /skills-editor/write  (unchanged)
                       updateIdentity, writeRoleFile, updateBounty  (unchanged)
```

### Recommended Project Structure

```
src/ui/features/pretty-view/
├── MarkdownEditor.tsx          # NEW — the shared component
├── MarkdownEditor.test.tsx     # NEW — filetype gate + round-trip tests
├── mdxeditor.dark.css          # NEW — dark-theme overrides, imported by MarkdownEditor
├── IdentityFileTab.tsx         # SHRUNK — becomes thin wrapper; keeps exporting TabState<T>
├── RoleFileTab.tsx             # SHRUNK
├── GlobalFileTab.tsx           # SHRUNK — gains `filename` prop, threaded from parent
├── SkillFileTab.tsx            # SHRUNK — gains `filename` prop, threaded from parent
├── GlobalFilesModal.tsx        # 1-line: passes filename={file.path} through
├── SkillsEditorModal.tsx       # 1-line: passes filename={file.path} through
├── RunbookEditorModal.tsx      # 1-line: passes filename={file.path} through
├── EditableFileModal.tsx       # 1-line: passes filename={filename} through (already has it)
├── BountyCard.tsx              # premise: replace <Textarea> with <MarkdownEditor filename="premise.md" …/>
├── AddWakeupDialog.tsx         # instruction: replace <textarea> with <MarkdownEditor filename="wakeup.md" …/>
```

Why the `filename="premise.md"` synthetic name on BountyCard/AddWakeupDialog: these are NOT files — they're markdown-content fields. The synthetic `.md` name unconditionally forces the pretty-editor branch of the filetype gate. Alternative: add an explicit `alwaysPretty?: boolean` prop; either shape is fine per D-08's discretion clause. Recommendation: **synthetic filename**, because it keeps the component's API surface small and communicates the intent ("this is markdown content").

### Pattern 1: Lazy-load MDXEditor inside the shared component

**What:** Import MDXEditor via `lazy()` from React (or dynamic `import()` at module scope with `Suspense` at the render site), so the bulk (~1.5 MB of Lexical + CodeMirror + Radix) is code-split into its own chunk and not paid for by callers that mount the component without opening the editor.

**When to use:** Every mount of `MarkdownEditor`. The tab surfaces themselves are already lazy-loaded via their parent modals; the shared component is a further sub-split.

**Example (mirror of SSHAuthDialog pattern):**
```tsx
// MarkdownEditor.tsx — top of file, module scope
import { lazy, Suspense } from "react";

// Lazy-loaded: @mdxeditor/editor bundles Lexical + CodeMirror + Radix Dialog +
// react-hook-form + js-yaml — ~1.5MB uncompressed. Only paid for on first mount
// of a .md file editor. Mirrors src/ui/features/terminal/Terminal.tsx L37 pattern.
const MdxEditorImpl = lazy(() =>
  import("./MdxEditorImpl").then((m) => ({ default: m.MdxEditorImpl }))
);

export function MarkdownEditor({ filename, content, onChange, disabled }: Props) {
  const isMarkdown = /\.md$/i.test(filename);

  if (!isMarkdown) {
    // Raw textarea — verbatim styling from the existing GlobalFileTab/SkillFileTab.
    return (
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
      />
    );
  }

  return (
    <Suspense fallback={<TextareaFallback content={content} />}>
      <MdxEditorImpl content={content} onChange={onChange} disabled={disabled} />
    </Suspense>
  );
}
```

The Suspense fallback should render the plain textarea style so there's no layout jump. The tasting confirms MDXEditor mounts in ~1-2s on a lightly-loaded box; users won't see a bare skeleton.

### Pattern 2: MDXEditor plugin composition (verified against tasting)

**Source:** `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/src/editors/MdxEditorPane.tsx` — this exact configuration ran through the tasting successfully.

```tsx
// MdxEditorImpl.tsx
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  ListsToggle,
  InsertFrontmatter,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./mdxeditor.dark.css";

export function MdxEditorImpl({ content, onChange, disabled }: Props) {
  return (
    <MDXEditor
      markdown={content}
      onChange={onChange}
      readOnly={disabled}
      className="dark-theme skynet-mdxeditor"
      contentEditableClassName="mdx-prose"
      plugins={[
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <UndoRedo />
              <BoldItalicUnderlineToggles />
              <BlockTypeSelect />
              <ListsToggle />
              <CreateLink />
              <InsertTable />
              <InsertFrontmatter />
            </>
          ),
        }),
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: "bash" }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            bash: "Bash",
            sh: "Shell",
            js: "JavaScript",
            ts: "TypeScript",
            tsx: "TSX",
            jsx: "JSX",
            json: "JSON",
            yaml: "YAML",
            md: "Markdown",
            py: "Python",
            "": "Plain",
          },
        }),
        frontmatterPlugin(),
        markdownShortcutPlugin(),
      ]}
    />
  );
}
```

Notes on the plugin set (versus the tasting starting point):
- **`codeBlockLanguages` expanded.** Tasting had 4 languages; production should map every language that appears in Skynet's markdown files (bash, sh, ts, tsx, js, jsx, json, yaml, py, md). If a fence uses an unmapped language, MDXEditor falls back to plain text — visible but ugly. [CITED: MDXEditor codeMirrorPlugin docs, mdxeditor.dev/editor/docs/code-blocks]
- **`readOnly` prop** covers the disabled/saving state without additional wiring. [CITED: MDXEditor React props]
- **`InsertFrontmatter` toolbar button** is the "Edit frontmatter" button referenced in D-04. When a file already has a frontmatter block, clicking it opens the dialog seeded with existing keys; when the file has no frontmatter, it inserts a `"": ""` placeholder block and opens the dialog empty. [VERIFIED: `src/plugins/frontmatter/index.ts` `insertFrontmatter$` action]

### Pattern 3: Dark-theme via `.dark-theme` class + Skynet-token overrides

**Source:** MDXEditor bundled `style.css` at `node_modules/@mdxeditor/editor/dist/style.css` has 16 `.dark, .dark-theme { ... }` rules covering every internal element. [VERIFIED: grep of installed CSS] The bundle imports Radix Colors and defines base/accent variables; assigning `dark-theme` on the MDXEditor root flips the whole tree to dark automatically.

**Example — `mdxeditor.dark.css`:**
```css
/* Skynet-native theming for MDXEditor.
 * Layered on top of MDXEditor's built-in `.dark-theme` class:
 *   1. `.dark-theme` (from @mdxeditor/editor/style.css) sets Radix-dark base tokens.
 *   2. `.skynet-mdxeditor` (our companion class on the same root) remaps a subset
 *      of the MDXEditor CSS variables to Skynet's `--color-pv-*` palette so the
 *      toolbar/panel chrome matches the app.
 * Never draw from Skynet's --background / --foreground for cross-surface
 * styling (project directive; see role file § Palette authority).
 */

.mdxeditor.skynet-mdxeditor {
  /* Panel + base surfaces: pull from Skynet pretty-view tokens (src/ui/index.css:143-155). */
  --baseBg: rgba(255, 255, 255, 0.06);
  --baseBgSubtle: rgba(255, 255, 255, 0.04);
  --baseBgHover: rgba(255, 255, 255, 0.09);
  --baseBgActive: rgba(255, 255, 255, 0.12);
  --baseBorder: rgba(220, 225, 245, 0.10);
  --baseBorderHover: rgba(220, 225, 245, 0.18);
  --baseText: #e8e4d8;              /* --color-pv-fg */
  --baseTextContrast: #f0ebe0;
  --baseSolid: rgba(255, 255, 255, 0.12);
  --baseSolidHover: rgba(255, 255, 255, 0.18);
  --basePageBg: transparent;

  /* Accent — Skynet identity hue (blue by default; per-identity via --pv-id-hue).
   * Toolbar active-button + link colour drive off these. */
  --accentText: hsla(var(--pv-id-hue, 220), 80%, 68%, 1);
  --accentBg: hsla(var(--pv-id-hue, 220), 80%, 60%, 0.20);
  --accentBgHover: hsla(var(--pv-id-hue, 220), 80%, 60%, 0.30);
  --accentBorder: hsla(var(--pv-id-hue, 220), 80%, 60%, 0.40);
  --accentSolid: hsla(var(--pv-id-hue, 220), 80%, 60%, 0.35);

  /* Typography — match Skynet's fonts (index.css uses Inter + JetBrains Mono). */
  font-family: Inter Variable, ui-sans-serif, system-ui, sans-serif;
  --font-mono: JetBrains Mono Variable, ui-monospace, monospace;
  background: transparent;
}

/* Inline code (single backticks) and fenced code blocks.
 * MDXEditor renders inline code via the `.code` class in lexical-theme.module.css
 * — that maps to a hashed class in the built bundle. We can't target it by name.
 * Instead we target the LEXICAL DOM: `code` outside a `pre` is inline;
 * `code` inside `pre` (or the .cm-editor code-mirror pane) is fenced.
 * Skynet's --color-pv-code-fg (#ffb896) is the single source of truth (D-12). */

.mdxeditor.skynet-mdxeditor .mdx-prose code:not(pre code) {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--color-pv-code-fg);
  padding: 1px 4px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.94em;
}

/* Fenced code (CodeMirror). Match ChatMessage's read-mode code-block treatment
 * (prose-pre styling in IdentityFileTab L157-159): dark navy panel with inset
 * shadow. --color-pv-code-fg still drives the text colour. */
.mdxeditor.skynet-mdxeditor .cm-editor {
  background: rgba(10, 12, 20, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
}
.mdxeditor.skynet-mdxeditor .cm-content,
.mdxeditor.skynet-mdxeditor .cm-line {
  color: var(--color-pv-code-fg);
  font-family: var(--font-mono);
}
.mdxeditor.skynet-mdxeditor .cm-gutters {
  background: transparent;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

/* Frontmatter dialog — Radix Dialog portaled to editorRootElementRef (INSIDE
 * the .mdxeditor root — verified in src/plugins/frontmatter/FrontmatterEditor.tsx
 * L67), so these scoped selectors reach it. */
.mdxeditor.skynet-mdxeditor [role="dialog"] input,
.mdxeditor.skynet-mdxeditor [role="dialog"] textarea {
  background: rgba(0, 0, 0, 0.3);
  color: #e8e4d8;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 4px;
  padding: 4px 8px;
}
```

**Why this approach beats the tasting's `!important` sledgehammer:**

- The tasting used `.mdxeditor * { color: var(--fg) !important; }` because it was A/B'ing four engines and needed a fast dark override. That works but fights the framework and breaks toolbar-active states, disabled states, and any future MDXEditor enhancement.
- MDXEditor's own `.dark-theme` class was DESIGNED for this — it uses semantic variable names (`--baseBg`, `--accentText`) so downstream apps can remap them without touching the framework's rules.
- Skynet's `<html>` root already has the `.dark` class (see `src/ui/index.css:191`). The MDXEditor `.dark, .dark-theme` bundled selector means Skynet's global `.dark` class ALREADY partially themes the editor for free. We just layer our companion class (`skynet-mdxeditor`) for the Skynet-specific remaps.

### Pattern 4: The shared component's API — `MarkdownEditor` props

```tsx
interface MarkdownEditorProps {
  /** Filename (including extension) — drives the filetype gate. Pass a
   *  synthetic `.md` name for markdown-content fields that don't map to a
   *  file (BountyCard premise, AddWakeupDialog instruction). */
  filename: string;
  /** Current content (controlled). */
  content: string;
  /** Called on every keystroke (pretty mode) / every input event (raw mode). */
  onChange: (next: string) => void;
  /** When true, the editor is read-only. Wire from saving state or view mode. */
  disabled?: boolean;
  /** When true, show a placeholder in empty state. Optional; defaults to no placeholder. */
  placeholder?: string;
}
```

Rationale for this API:
- **Controlled** (parent owns state) — matches how the four file tabs already work (they own `draft` via `useState`).
- **No `onSave`** — the shared component doesn't know or care what "save" means. Each tab keeps its own save handler; the shared component only manages the editor.
- **No mode toggle** — the view/edit toggle on IdentityFileTab/RoleFileTab remains AT THE TAB LEVEL, not inside the shared component. When the tab is in view mode, it renders `<ReactMarkdown>` as it does today; when in edit mode, it renders `<MarkdownEditor>`. That keeps the shared component focused on one job (editing).
- **`filename` is required** — no optional filename with implicit `.md` fallback. Explicit at the call site is safer; unit tests can assert both branches deterministically.
- **`disabled`** covers "saving in progress" + "not editable at all" — both surfaces need this today.

### Pattern 5: The shrunken tab wrapper — thin adapter

```tsx
// IdentityFileTab.tsx AFTER refactor
import { MarkdownEditor } from "./MarkdownEditor";
export type TabState<T> = /* unchanged from existing L21-24 */ …;

export function IdentityFileTab({ state, onSave }: { state: TabState<string>; onSave?: (contents: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // handleSave / handleCancel: unchanged from existing L38-62

  // Loading / error / empty branches: unchanged from existing L64-88

  // Ready branch:
  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar (Edit / Save / Cancel): unchanged from existing L93-131 */}
      {editing ? (
        <div className="flex flex-col flex-1 min-h-0">
          <MarkdownEditor
            filename="identity.md"        {/* synthetic — always pretty */}
            content={draft}
            onChange={setDraft}
            disabled={saving}
          />
          {saveError && <div className="text-sm text-…">Save failed: {saveError}</div>}
        </div>
      ) : (
        <div className="prose …">  {/* unchanged read-mode ReactMarkdown from L146-177 */}
      )}
    </div>
  );
}
```

The `TabState<string>` export stays intact — `RoleFileTab.tsx`, `GlobalFileTab.tsx`, `SkillFileTab.tsx` all `import type { TabState } from "./IdentityFileTab"` and that import survives.

### Anti-Patterns to Avoid

- **Do NOT try to make the shared component accept `TabState<T>` directly.** The four tab surfaces have three different `T` shapes: `string` (Identity, Role), `{content, mtime}` (Global), `{content, mtime, isText}` (Skill). Trying to unify these forces a generic layer over what should stay a boring `{ content: string }` controlled input. Keep the tab as the shim.
- **Do NOT lazy-load individual plugins.** MDXEditor's plugin registration is synchronous and the plugin tree is small; the payload weight is Lexical + CodeMirror themselves, not the plugin wrappers. Lazy-load the whole `MDXEditor` component, not its plugins.
- **Do NOT use `!important` for base theming.** Only reach for `!important` if MDXEditor's own selectors are more specific than yours; the `.mdxeditor.skynet-mdxeditor …` chain gives you enough specificity for every case observed in the tasting. Reserve `!important` for the two-or-three cases you find in QA that can't be won with specificity alone.
- **Do NOT keep the tasting's `.mdxeditor *` sledgehammer.** Delete it. The `dark-theme` class + variable remaps replace it entirely.
- **Do NOT change the tab component's existing tests before writing the shared component.** The existing tests are the regression contract (D-16); write the new shared-component tests FIRST, land those green, then refactor the tabs, then adjust their tests to match the new call shape.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parsing/serialisation | Custom YAML round-trip | `frontmatterPlugin` (bundles `mdast-util-frontmatter` + `js-yaml`) | The whole point of picking MDXEditor was that its bundled frontmatter handling is the only one that survives the round-trip. Rebuilding it defeats the selection criterion. |
| Dark theme from zero | Every-selector `!important` overrides | MDXEditor's `dark-theme` class + Skynet-token variable remaps | The engine already has semantic vars for theming. Fight it and you own every future internal change. |
| Toolbar layout | Custom toolbar with custom keybindings | `toolbarPlugin` with the primitive component set (`UndoRedo`, `BoldItalicUnderlineToggles`, etc.) | These are the pre-wired MDXEditor button primitives; they handle disabled state, focus tracking, and accessibility. |
| Code fence syntax highlighting | Custom highlighter | `codeMirrorPlugin` with `codeBlockLanguages` | CodeMirror is already installed for SSH auth; MDXEditor bundles its own but shares the same CodeMirror version. |
| Filename→extension detection | Complex MIME sniffing | `/\.md$/i.test(filename)` | The only two file types that matter here are "markdown" and "not markdown". A regex is fine. |
| Lazy-load boilerplate | Custom dynamic-import machinery | `React.lazy()` + `Suspense` (already used at `Terminal.tsx:37` for SSHAuthDialog) | Established Skynet pattern, mirror verbatim. |

**Key insight:** Every piece of value MDXEditor brings is the piece we'd otherwise hand-roll and get wrong. This phase is fundamentally about **wiring**, not building — the composition of pre-existing pieces (MDXEditor plugins, Skynet CSS tokens, React.lazy, the existing tab component shell) into eight surfaces.

## Runtime State Inventory

**This is a code/refactor phase, not a rename/migration.** No runtime state carries the old-vs-new distinction across a boundary that would survive a code deploy. Every relevant surface reads-and-writes the same on-disk markdown files it did before; the only thing changing is the input control the user sees.

Explicit category check for the sake of completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — file contents on disk are unchanged; D-10 is explicit that backend + file-format contracts don't move | none |
| Live service config | None — no n8n workflows, Datadog dashboards, Tailscale ACLs, or Cloudflare Tunnels reference this UI | none |
| OS-registered state | None — no Task Scheduler tasks, pm2 processes, systemd units | none |
| Secrets/env vars | None | none |
| Build artifacts | Vite dev server + build output will change (new `@mdxeditor/editor` chunk in the dist). `npm install` on any developer machine that pulls this branch will need to re-resolve `package-lock.json`. Docker image rebuild needed for anything that ships the frontend bundle. | `npm install` on each dev checkout; frontend image rebuild pipeline picks up automatically |

**Prose fidelity is explicitly deferred (D-09).** Existing markdown files edited through this UI will be normalised (emphasis chars, list bullet chars, indent) on first save. That's a **runtime effect** but it's an accepted decision — noted here so the planner is clear it does not need mitigation.

## Common Pitfalls

### Pitfall 1: MDXEditor mounts before markdown is set → editor starts empty

**What goes wrong:** `<MDXEditor markdown={content} />` uses `markdown` as the INITIAL value. Once mounted, subsequent changes to the `markdown` prop are NOT reflected — the editor owns its own state. The tasting harness (`MdxEditorPane.tsx:36-41`) works around this with an imperative ref + `setMarkdown` call inside a `useEffect`.

**Why it happens:** MDXEditor is uncontrolled after mount — it maintains a Lexical state tree that would fight with a controlled `markdown` prop if it re-hydrated on every keystroke.

**How to avoid:** Two options:
1. **Keyed remount.** Give `MDXEditor` a `key={filename}` (or `key={fetchedMtime}`) so it remounts when the underlying content changes. Simplest; matches how MDXEditor is meant to be used.
2. **Imperative ref.** Copy the tasting pattern verbatim — hold a ref, and when the parent's `content` prop changes and differs from the editor's current markdown, call `ref.current.setMarkdown(newValue)`.

**Recommendation:** Option 1 (keyed remount) for tab-level surfaces where the "file changed" signal is discrete (mtime, filename). Option 2 for the bounty premise / wakeup instruction where the parent is the source of truth for the initial value only.

**Warning signs:** Save handler fires, gets echoed by the server, tab re-renders with the new mtime — but the editor content stays stale. If tests catch a "save doesn't refresh the editor" bug, this is why.

### Pitfall 2: Empty frontmatter → "Edit frontmatter" button doesn't appear

**What goes wrong:** If a `.md` file has NO frontmatter block, MDXEditor renders no frontmatter node — and `InsertFrontmatter` (the toolbar button from D-04) inserts a placeholder `"": ""` block on click, then opens the dialog. That's fine for adding frontmatter. But if the file already has frontmatter, the button toggles the existing dialog open — same button, two behaviours.

**Why it happens:** Design choice in `src/plugins/frontmatter/index.ts` — `insertFrontmatter$` action either appends a new node or opens the dialog for the existing one. [VERIFIED: `hasFrontmatter$` cell tracks presence]

**How to avoid:** Nothing — this is correct behaviour. Just document it in the shared component so QA doesn't file it as a bug. Tests can drive both branches deterministically.

**Warning signs:** User reports "the frontmatter button doesn't do anything on my new file" — they clicked it, saw a placeholder `"": ""` row in the dialog, and dismissed it thinking nothing happened. Copy in the dialog says "Key" and "Value" clearly enough that this shouldn't confuse.

### Pitfall 3: `js-yaml` strict-mode failure on hand-edited settings blocks

**What goes wrong:** MDXEditor's FrontmatterEditor calls `YamlParser.load(yaml)` (js-yaml) on the current YAML string. If a user has a value like `task: Fix: bug in module` (unquoted, containing colon-space), `js-yaml` throws — the SAME parse failure the backend logs at `identity-artifact-reader.ts:288-309`. When it throws, the dialog opens EMPTY even though the file has entries.

**Why it happens:** Bare colon-space in YAML plain scalars is ambiguous. Both js-yaml and the backend parser handle it the same way (throw). The tasting didn't exercise this case.

**How to avoid:**
- On the READ path: MDXEditor's `frontmatterPlugin` uses `mdast-util-frontmatter` to detect the fence, then `js-yaml` on the block. If the block is malformed, the plugin still shows the frontmatter as a decorator (the fence + raw YAML text), but the DIALOG will be empty because parse fails.
- **Test to add:** load a file with `task: Fix: bug` (or similar unquoted-colon-space value), click frontmatter button, assert the dialog either shows the entry or errors gracefully. If it silently opens empty, we need to escalate to the user — this maps to the backend's fallback logging pattern.
- Alternative: pre-validate the YAML at render time and, if malformed, show a warning instead of opening a broken dialog.

**Warning signs:** User with an existing identity file with unquoted values opens the frontmatter dialog, sees empty rows, clicks Save — the frontmatter is nuked and the identity loses its role on next backend read. This is EXACTLY the D-05 preservation contract failure mode. The round-trip test (D-14) must include a malformed-YAML fixture.

### Pitfall 4: Lazy-load chunk fetch fails when offline

**What goes wrong:** `lazy(() => import(...))` fetches the chunk on first render. If the browser is offline or the CDN 404s, the Suspense fallback renders forever and the user sees a blank textarea placeholder.

**Why it happens:** Same as any code-split — the chunk lives at a URL that has to be reachable.

**How to avoid:** Wrap the `Suspense` in an `ErrorBoundary` that falls back to the raw textarea on chunk-load failure. Skynet doesn't have an established error-boundary pattern for lazy chunks that I could find — mention this in the plan; a simple 20-line boundary is fine.

**Warning signs:** In dev, `vite`'s hot-module-reload can trip transient chunk-load failures during rebuild. If the editor blank-screens on save-and-reload, this is why.

### Pitfall 5: `contentEditable`-based editor conflicts with jsdom in tests

**What goes wrong:** MDXEditor uses Lexical, which relies on `contentEditable=true` DOM behaviour that jsdom (Vitest's frontend environment per `vitest.config.ts:56`) implements partially. Existing tests use `screen.getByRole("textbox")` which returns the `<textarea>` in raw mode — but in pretty mode, the editor's contenteditable region has role `"textbox"` too, and jsdom may or may not surface it correctly.

**Why it happens:** Real browser vs. jsdom fidelity gap. The tasting used Playwright (real Chromium) for its round-trip verification, which is why it didn't hit this.

**How to avoid:**
- **Test the shared component's filetype gate at the unit level** using a stubbed MDXEditor. The gate is pure logic (`filename.endsWith(".md")` → which component to render); assert the RIGHT thing renders, not the internal editor behaviour. E.g. `vi.mock("@mdxeditor/editor", () => ({ MDXEditor: (props) => <div data-testid="mdxeditor">{props.markdown}</div>, ... }))`.
- **Test the round-trip in a Playwright script**, not vitest. The tasting already has a working `frontmatter-check.mjs` under `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/` — port that shape to the Skynet e2e/smoke test surface (if there is one) or run it as a bounty-adjacent verification step.
- **The four existing vitest suites (D-16)** were written when the tab used a plain textarea. After refactor, they'll be testing the shim's behaviour (state management, save handler wiring) — the MDXEditor internals are stubbed. This keeps them green without needing to add Lexical/jsdom compat layers.

**Warning signs:** After the refactor, existing tests like `GlobalFileTab.test.tsx` test 3 (`getByRole("textbox")` returns the textarea) start passing/failing intermittently. That's the jsdom gap. Mock the MDXEditor module in the shim's tests.

### Pitfall 6: The tasting harness stays where it is — do not check it into src/

The tasting lives at `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/` and is durable (the operator 2026-09-16). Do NOT copy `MdxEditorPane.tsx` verbatim into `src/` — use it as a reference implementation only. The tasting has `key={filename}`-less mount patterns, sledgehammer CSS, and simplified plugin sets that need refinement for production.

## Code Examples

### Example 1: Filename-gate unit test

```tsx
// MarkdownEditor.test.tsx (NEW)
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub MDXEditor so jsdom + Lexical don't collide in tests.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: any) => <div data-testid="mdxeditor">{props.markdown}</div>,
  // stub every named export the impl imports:
  headingsPlugin: () => ({}), listsPlugin: () => ({}), quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}), markdownShortcutPlugin: () => ({}),
  linkPlugin: () => ({}), linkDialogPlugin: () => ({}), tablePlugin: () => ({}),
  codeBlockPlugin: () => ({}), codeMirrorPlugin: () => ({}), frontmatterPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null, BoldItalicUnderlineToggles: () => null,
  BlockTypeSelect: () => null, CreateLink: () => null, InsertTable: () => null,
  ListsToggle: () => null, InsertFrontmatter: () => null,
}));

import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor — filetype gate", () => {
  it(".md filename → renders MDXEditor", async () => {
    render(<MarkdownEditor filename="README.md" content="# hi" onChange={vi.fn()} />);
    // Suspense-fallback then MDXEditor mounts:
    expect(await screen.findByTestId("mdxeditor")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it(".MD (uppercase) filename → renders MDXEditor (case-insensitive)", async () => {
    render(<MarkdownEditor filename="NOTES.MD" content="" onChange={vi.fn()} />);
    expect(await screen.findByTestId("mdxeditor")).toBeTruthy();
  });

  it(".json filename → renders raw <textarea>, no MDXEditor", () => {
    render(<MarkdownEditor filename="settings.json" content='{"a":1}' onChange={vi.fn()} />);
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe('{"a":1}');
  });

  it("no extension → renders raw <textarea>", () => {
    render(<MarkdownEditor filename="Dockerfile" content="FROM node" onChange={vi.fn()} />);
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it(".sh filename → renders raw <textarea>", () => {
    render(<MarkdownEditor filename="deploy.sh" content="#!/bin/bash" onChange={vi.fn()} />);
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
```

### Example 2: Frontmatter round-trip test (Playwright — port from tasting)

```javascript
// e.g. tests/e2e/mdxeditor-frontmatter-roundtrip.spec.ts
// Ported from /home/ubuntu/fleet/roles/box-maintainer/bounties/
//   pretty-markdown-editing-in-frontend/tasting/frontmatter-check.mjs
import { test, expect } from "@playwright/test";

test("frontmatter round-trip: body edit does not modify --- block", async ({ page }) => {
  // Open a mock identity file with known frontmatter.
  await page.goto("/dev/mdxeditor-fixture?file=identity-with-frontmatter.md");

  // The frontmatter node renders as a decorator; the body is contenteditable.
  const editable = page.locator('[contenteditable="true"]').last();  // largest
  await editable.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");

  // Read serialised markdown via the ref/getMarkdown() surface exposed by the
  // fixture page.
  const serialized = await page.evaluate(() =>
    (window as any).__editorGetMarkdown?.() ?? "",
  );

  // Assert every load-bearing key survives verbatim.
  expect(serialized).toMatch(/^---\nrole: box-maintainer\n/);
  expect(serialized).toMatch(/displayName: Cedar\n/);
  expect(serialized).toContain("task:");
  expect(serialized).toMatch(/---\n\n#/);   // fence closes cleanly before body

  // Body has the appended " edited" fragment.
  expect(serialized).toMatch(/ edited\s*$/);
});
```

**Note:** if Skynet doesn't have a Playwright e2e harness set up for the frontend, this could alternatively be a Vitest test using a real `MDXEditor` mount in a `jsdom` environment with Lexical polyfills — but that path is fragile. The tasting's Playwright approach is the durable one; port it.

### Example 3: Adapter shim for GlobalFileTab (with filename)

```tsx
// GlobalFileTab.tsx AFTER refactor
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";
import { MarkdownEditor } from "./MarkdownEditor";

export type GlobalFileTabData = { content: string; mtime: number };

export default function GlobalFileTab({
  state,
  filename,            // NEW — required, threaded from GlobalFilesModal / EditableFileModal
  onSave,
  onDraftChange,
}: {
  state: TabState<GlobalFileTabData>;
  filename: string;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Effect: seed draft from state.data on mtime change — UNCHANGED from L46-51
  // Effect: fire onDraftChange — UNCHANGED from L57-61
  // handleSave — UNCHANGED from L63-74

  // Loading/error branches — UNCHANGED from L77-93

  return (
    <div className="flex flex-col h-full gap-2">
      <MarkdownEditor
        filename={filename}
        content={draft}
        onChange={setDraft}
        disabled={saving}
      />
      {saveError && <div className="text-sm text-red-400 px-1">{saveError}</div>}
      <div className="flex justify-end gap-2 shrink-0">
        <button onClick={() => void handleSave()} disabled={saving || draft === state.data.content} …>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
```

Call sites updated in one line each:
- `GlobalFilesModal.tsx:316` → `<GlobalFileTab state={…} filename={file.path} onSave={…} />`
- `SkillsEditorModal.tsx:570` → `<SkillFileTab state={…} filename={file.path} onSave={…} />`
- `RunbookEditorModal.tsx:456` → `<SkillFileTab state={…} filename={file.path} onSave={…} />`
- `EditableFileModal.tsx:487` → `<GlobalFileTab state={…} filename={filename} onSave={…} />` (already has filename in scope)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom rich-text editors built on contenteditable directly | Lexical-based editors (MDXEditor, BlockNote) | ~2022-2023 | MDXEditor uses Meta's Lexical framework — battle-tested, accessible, undo/redo built in. Do not roll your own. |
| Tailwind `!important` overrides for third-party components | CSS custom properties + framework-provided theming classes | 2023- (Radix Colors era) | MDXEditor exposes `--baseText` etc. so app-side themes don't have to fight specificity. Use it. |
| Monaco / CodeMirror for markdown editing | WYSIWYG (Lexical) for markdown; CodeMirror as embedded fenced-code-block editor inside WYSIWYG | 2024- | This is exactly the codeBlockPlugin + codeMirrorPlugin composition — Lexical for prose, CodeMirror for the code panes inside prose. |

**Deprecated/outdated:**
- MDXEditor v1/v2 API is different from v3+/v4. The tasting used v4.2.5; do not reference v1/v2 docs.
- The `contentEditable={true}` hand-roll approach is dead — every real WYSIWYG in 2026 is a framework atop it (Slate, Lexical, ProseMirror).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Skynet's existing `.dark` class on the app root already partially themes MDXEditor's internals (via MDXEditor's `.dark, .dark-theme { … }` selector at `dist/style.css`). | Pattern 3 | If wrong, the dark theme still works — we just also apply `dark-theme` on the MDXEditor root ourselves. No user-visible impact; adds one `className` addition. |
| A2 | Skynet has no established `<ErrorBoundary>` component for lazy-load failures. | Pitfall 4 | If wrong, we reuse the existing one. If right, we build a 20-line one. Low risk either way. |
| A3 | Playwright is not yet set up as a first-class e2e surface in Skynet. | Example 2 | If wrong, use it. If right, the round-trip test either lives in vitest with a Lexical-friendly setup or ships as a bounty-adjacent verification step (tasting-style). Planner + user decide. |
| A4 | Bounty premise + wakeup instruction should get the WYSIWYG unconditionally (synthetic `.md` filename). | Recommended Project Structure | This IS what the shape says — "the freeform paragraph field on a bounty card is markdown in content." But it's an implicit assumption in the code layout; discuss-phase never flagged an alternative. |
| A5 | `js-yaml` strict-mode parse failures on unquoted colon-space values (Pitfall 3) will affect the frontmatter dialog. The backend already logs this at `identity-artifact-reader.ts:288`. | Pitfall 3 | This is derived from source-code reading of MDXEditor's `FrontmatterEditor.tsx` (uses `YamlParser.load`) + Skynet's own backend log site. Verified by inspection; not tested end-to-end. If the parse actually succeeds (js-yaml relaxed mode changed?), the pitfall is a non-issue. |
| A6 | jsdom will surface issues rendering Lexical in vitest. This is a reasonable assumption based on how contentEditable + Lexical rely on real browser APIs, but not empirically verified for MDXEditor 4.x under vitest 4.x. | Pitfall 5 | If wrong (MDXEditor renders fine in jsdom), the mock-based unit tests are simpler than necessary but still correct. Low risk. |
| A7 | The bundled `@mdxeditor/editor/style.css` selectors like `.dark, .dark-theme { ... }` cover every dark-mode need. | Pattern 3 | If wrong, we add more specific rules in `mdxeditor.dark.css`. The 16 dark-mode rules in `dist/style.css` [VERIFIED via grep] suggest broad coverage. |

## Open Questions

1. **Do we need a settings-block preservation regression test at the `PUT /global-files/write` level too?**
   - What we know: MDXEditor preserves frontmatter through its editor state; when the user saves, `onChange(md)` receives the serialised markdown; the tab's `handleSave` passes that string to `writeGlobalFile`; the backend writes it verbatim (D-10). The test at Example 2 above covers the editor half of the round-trip.
   - What's unclear: Does the backend's SFTP write path do ANY line-ending normalisation, encoding conversion, or trailing-newline munging that might mutate the frontmatter fence? A quick backend read of the write handlers would resolve this in the plan phase.
   - Recommendation: **Planner adds a task to grep `write-file` handlers for line-ending or encoding normalisation**; if found, add a backend-level test. If not, the editor-level test is sufficient.

2. **What's the target for the wakeup instruction field?**
   - What we know: Shape file calls it "the small paragraph a person types when they set up a wake-up" and marks it markdown. Current code (`AddWakeupDialog.tsx:415-426`) uses a 3-row textarea sized `min-h-[60px]`.
   - What's unclear: Does MDXEditor render acceptably at 60px min-height with a toolbar? The toolbar is ~40px tall; the editing area at 20px min is too small. Options: (a) drop the toolbar for this surface via a `variant` prop, (b) raise the min-height to `min-h-[160px]`, (c) skip WYSIWYG on this specific surface.
   - Recommendation: **Planner picks (b) — raise min-height and keep toolbar consistency across all eight surfaces.** The shape file's scope is unambiguous about including this field.

3. **Do we adopt any of the `skills-editor-mirror-wide-hygiene-followups` in this phase?**
   - What we know: CONTEXT deferred-ideas list mentions this bounty explicitly and says "planner may fold any that naturally land in-path." I do not have visibility into the specific 5 items on that list.
   - What's unclear: Whether any of the 5 items touch the shared file-tab shell in a way that would be cleaner to land in-path.
   - Recommendation: **Planner reads that bounty's scratch-report** during plan-writing, then decides per-item. If unclear, defer all 5 to the standalone bounty.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime | Vite dev + build | ✓ | Skynet already runs on Node — verified by existing `package.json` scripts | — |
| `npm` | Package install | ✓ | Present | — |
| `@mdxeditor/editor` @ 4.2.5 | Editor engine | ✗ (not yet installed in `skynet-cedar`) | Will be added by this phase | — (this IS the install step) |
| Vite | Build | ✓ | ^8.0.13 [VERIFIED: package.json] — compatible with MDXEditor per tasting | — |
| React 19 | MDXEditor peer dep | ✓ | ^19.2.5 — meets `react >= 18 \|\| >= 19` [VERIFIED: npm view peerDependencies] | — |
| Vitest + jsdom | Frontend tests | ✓ | Vitest ^4.1.8, jsdom project [VERIFIED: vitest.config.ts:56] | — |
| Playwright (for round-trip test) | Optional e2e | ✗ | Tasting has Playwright installed at `tasting/node_modules`, but Skynet main repo — needs a grep to confirm | Vitest with a real MDXEditor + jsdom (fragile; see Pitfall 5) OR keep the tasting harness durable and re-run its `frontmatter-check.mjs` as a manual verification step |

**Missing dependencies with no fallback:** none — every install is either standard or already present.

**Missing dependencies with fallback:** Playwright for the frontmatter round-trip test. If Skynet doesn't have it, the durable tasting harness at `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/` remains the verification-of-record — the CONTEXT explicitly notes it stays durable while the bounty is open.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.8 (Skynet frontend project) [VERIFIED: package.json + vitest.config.ts] |
| Config file | `/home/ubuntu/skynet-cedar/vitest.config.ts` |
| Quick run command | `npx vitest run --project frontend src/ui/features/pretty-view/MarkdownEditor` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

Because this phase is bounty-driven (no REQUIREMENTS.md IDs), the requirement column maps to the CONTEXT.md D-XX decisions.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-05 | Frontmatter round-trip — body edit preserves `---` block byte-identically | e2e (Playwright) OR integration | `npx playwright test tests/e2e/mdxeditor-frontmatter-roundtrip.spec.ts` | ❌ Wave 0 (both test file AND Playwright setup if not present) |
| D-06 | `.md` filename → MDXEditor renders; other filename → textarea renders (both mixed-content tabs) | unit | `npx vitest run src/ui/features/pretty-view/MarkdownEditor.test.tsx` | ❌ Wave 0 |
| D-06 (integration) | GlobalFileTab / SkillFileTab receive filename prop and thread it correctly | integration | `npx vitest run src/ui/features/pretty-view/GlobalFileTab.test.tsx` (extended) | ✓ (needs new tests added) |
| D-08 | The four file-tab surfaces reduce to thin wrappers over `MarkdownEditor`; existing suites still green | regression | `npx vitest run src/ui/features/pretty-view/IdentityFileTab src/ui/features/pretty-view/RoleFileTab src/ui/features/pretty-view/GlobalFileTab src/ui/features/pretty-view/SkillFileTab` | ✓ (existing) |
| D-11, D-12, D-13 | Dark theme applied — code, inline code, frontmatter dialog inputs are readable | manual UAT (visual) | n/a (no automated visual regression in Skynet today) | manual verification list |
| D-16 | Existing test suites still pass | regression | `npx vitest run` full suite | ✓ (existing) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/ui/features/pretty-view/` (all pretty-view tests, ~30s under normal load)
- **Per wave merge:** `npx vitest run` (full frontend suite) + Playwright round-trip if wired
- **Phase gate:** Full suite green + manual UAT of dark-theme rendering on at least 2 identity files, 1 role file, 1 global file (`.md`), 1 global file (`.json` — regression), 1 bounty premise edit, 1 wakeup instruction edit before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/ui/features/pretty-view/MarkdownEditor.test.tsx` — filetype gate + basic prop pass-through
- [ ] Playwright e2e harness (if not present) OR alternative round-trip verification wiring for D-05
- [ ] `mdxeditor.dark.css` — dark-theme override rules
- [ ] Optional: an `ErrorBoundary` component if none exists (Pitfall 4)

*(Framework install: not needed — Vitest + jsdom already configured for the frontend project.)*

## Security Domain

This is a pure frontend UI-polish phase with no auth, no session handling, no crypto, no privilege boundary changes. The security surface it touches is essentially "does MDXEditor sanitise user input safely for rendering?" — and the answer is yes, because Lexical only ever renders the parsed AST, not raw HTML strings.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (unchanged) |
| V3 Session Management | no | (unchanged) |
| V4 Access Control | no | (unchanged — the same SFTP-based write paths the raw textarea uses) |
| V5 Input Validation | yes (light) | Filename check for the filetype gate is a regex, not a sanitiser. Not a security concern — the filename comes from the caller-side props, not user input. Content passes through unchanged to the backend, which already validates on write. |
| V6 Cryptography | no | (unchanged) |

### Known Threat Patterns for React + MDXEditor

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via markdown link URLs (e.g. `[click me](javascript:alert(1))`) | Tampering | MDXEditor + Lexical strip `javascript:` schemes by default. [ASSUMED — not empirically verified in this session; add a task to grep Lexical's LinkNode source or write a quick test.] |
| XSS via inline HTML in markdown | Tampering | Same story — Lexical does not render raw HTML from markdown source unless explicitly configured (no `directives` plugin here). |
| Frontmatter YAML deserialisation gadget | Tampering | `js-yaml` uses `safeLoad`-equivalent by default in modern versions; not vulnerable to `!!python/object` or similar. [ASSUMED — grep js-yaml version in bundled deps.] |
| Dependency supply chain | Tampering | `@mdxeditor/editor` was verified in Package Legitimacy Audit above. Transitive deps (`lexical`, `codemirror`, `js-yaml`, `react-hook-form`) are all first-tier ecosystem packages with well-known maintainers. |

**Recommendation:** the planner should add ONE small security-verification task to the wave — write a unit test that confirms `MarkdownEditor` with `[click me](javascript:alert(1))` content does not produce an `href="javascript:..."` link in the rendered DOM. That's the highest-marginal-value security check for this phase.

## Sources

### Primary (HIGH confidence — Context7 / official docs / installed source code)
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/shape-pretty-markdown-editing.md` — the shape agreement (load-bearing)
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/src/editors/MdxEditorPane.tsx` — verified working plugin composition
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/node_modules/@mdxeditor/editor/dist/style.css` — 16 `.dark, .dark-theme { ... }` rules VERIFIED via grep
- `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/src/styles.css` — first-pass dark-theme (source of the "sledgehammer" pattern this research supersedes)
- `github.com/mdx-editor/editor` source code — read via `gh api` at `src/plugins/frontmatter/FrontmatterEditor.tsx`, `src/plugins/frontmatter/index.ts`, `src/plugins/frontmatter/FrontmatterNode.tsx`, `src/examples/dark-editor.css`, `src/styles/globals.css`, `src/styles/lexical-theme.module.css`, `src/styles/ui.module.css`
- Skynet codebase: `src/ui/features/pretty-view/IdentityFileTab.tsx`, `RoleFileTab.tsx`, `GlobalFileTab.tsx`, `SkillFileTab.tsx`, `GlobalFilesModal.tsx`, `SkillsEditorModal.tsx`, `RunbookEditorModal.tsx`, `EditableFileModal.tsx`, `BountyCard.tsx`, `AddWakeupDialog.tsx`, `SSHAuthDialog.tsx`, `Terminal.tsx`, `index.css`, `vitest.config.ts`, `identity-artifact-reader.ts` — all read directly
- npm registry: `npm view @mdxeditor/editor version peerDependencies time.created time.modified scripts.postinstall maintainers` — all VERIFIED 2026-09-16

### Secondary (MEDIUM confidence — WebFetch of official docs)
- [MDXEditor Theming](https://mdxeditor.dev/editor/docs/theming) — WebFetch confirmed the `dark-theme` class mechanism and the accent/base variable list
- [MDXEditor Code Blocks](https://mdxeditor.dev/editor/docs/code-blocks) — WebFetch confirmed `codeMirrorPlugin` + `codeBlockPlugin` composition and `codeBlockLanguages` API shape
- [MDXEditor GitHub Repo](https://github.com/mdx-editor/editor) — WebFetch + `gh api` for source-code inspection
- [MDXEditor Dark Theme demo](https://github.com/mdx-editor/mdx-editor-dark-theme) — WebSearch surfaced this as a companion project

### Tertiary (LOW confidence — general web search)
- [WebSearch: "MDXEditor dark theme CSS class dark-theme how to enable"](https://mdxeditor.dev/editor/docs/theming) — cross-verified with primary docs above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed source code inspected; version + peer-deps verified against live npm registry.
- Architecture (shared component, filename plumbing): HIGH — every call site read and citation-annotated.
- Plugin composition: HIGH — verified against the tasting harness's working code.
- Dark theme mechanism (`.dark-theme` class + CSS vars): HIGH — confirmed in official docs AND in the installed CSS bundle.
- Filetype gate: HIGH — a regex, trivially verified.
- Pitfalls: MEDIUM — Pitfalls 1, 2, 3 are grounded in specific source code (MDXEditor's own AND Skynet's backend parser); Pitfalls 4, 5 are informed by common React lazy-load and jsdom+Lexical gaps but not empirically hit in this research session.
- Test strategy: MEDIUM — the vitest+mock pattern is a specific, actionable recommendation; the Playwright pattern is a port of a proven tasting script but assumes Skynet has (or will add) a Playwright surface.
- Security domain: LOW-MEDIUM — the surface is narrow (frontend only, no auth changes) so the risk of missing something is low, but the two `[ASSUMED]` items in the threat table (link-scheme sanitisation, js-yaml safe-mode) deserve a small verification task each.

**Research date:** 2026-09-16
**Valid until:** ~2026-10-16 (30 days — MDXEditor is stable but the `@mdxeditor/editor` package updates frequently; verify version + peer-deps if planning slips past mid-October)

---

*Phase: 111-pretty-markdown-editing-across-all-frontend-markdown-editing*
