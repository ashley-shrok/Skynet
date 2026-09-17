# Phase 112: pretty-markdown-editing-across-all-frontend-markdown-editing — Pattern Map

**Mapped:** 2026-09-16
**Files analyzed:** 13 (3 new + 10 modified)
**Analogs found:** 13 / 13

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/MarkdownEditor.tsx` (NEW) | shared UI component (controlled editor) | request-response (props in / onChange out) | `src/ui/features/pretty-view/GlobalFileTab.tsx` (edit-mode block) + `src/ui/features/terminal/Terminal.tsx:34-39, 3386-3402` (lazy-load shape) + `src/ui/ssh/dialogs/SSHAuthDialog.tsx` (heavy-editor child) | composite (role-match + shape-match) |
| `src/ui/features/pretty-view/mdxeditor.dark.css` (NEW) | stylesheet / theme override | static | `src/ui/index.css` §115-165 (palette source) | palette-source only (no direct CSS-module analog in repo) |
| `src/ui/features/pretty-view/MarkdownEditor.test.tsx` (NEW) | vitest component test | request-response | `src/ui/features/pretty-view/GlobalFileTab.test.tsx` | exact (structure + mocking style) |
| `src/ui/features/pretty-view/IdentityFileTab.tsx` (MOD) | tab wrapper (view/edit toggle + `onSave`) | request-response | self (surgical swap: L137-142 textarea → `<MarkdownEditor>`) | in-place refactor |
| `src/ui/features/pretty-view/RoleFileTab.tsx` (MOD) | tab wrapper (view/edit toggle + `onSave`) | request-response | self (surgical swap: L133-138 textarea → `<MarkdownEditor>`) | in-place refactor |
| `src/ui/features/pretty-view/GlobalFileTab.tsx` (MOD) | tab wrapper (always-edit + mtime concurrency) | request-response w/ optimistic-concurrency | self (add `filename` prop; swap L106-111 textarea → `<MarkdownEditor>`) | in-place refactor |
| `src/ui/features/pretty-view/SkillFileTab.tsx` (MOD) | tab wrapper (always-edit + mtime + isText + delete) | request-response w/ optimistic-concurrency | self (add `filename` prop; swap L120-125 textarea → `<MarkdownEditor>`) | in-place refactor |
| `src/ui/features/pretty-view/GlobalFilesModal.tsx` (MOD) | modal call site (tab host) | wire filename prop | self (L316-321, one-line add) | one-line prop-thread |
| `src/ui/features/pretty-view/SkillsEditorModal.tsx` (MOD) | modal call site (tab host) | wire filename prop | self (L570-579, one-line add) | one-line prop-thread |
| `src/ui/features/pretty-view/RunbookEditorModal.tsx` (MOD) | modal call site (tab host) | wire filename prop | self (L456-465, one-line add) | one-line prop-thread |
| `src/ui/features/pretty-view/EditableFileModal.tsx` (MOD) | modal call site (single-tab host) | wire filename prop | self (L487-491, one-line add; filename already in scope L194) | one-line prop-thread |
| `src/ui/features/pretty-view/BountyCard.tsx` (MOD) | inline field editor (premise) | request-response | self (L1061-1069 `<Textarea>` → `<MarkdownEditor>` with synthetic `filename="premise.md"`) | in-place refactor |
| `src/ui/features/pretty-view/AddWakeupDialog.tsx` (MOD) | inline field editor (instruction) | request-response | self (L415-426 `<textarea>` → `<MarkdownEditor>` with synthetic `filename="wakeup.md"`; raise `min-h-[60px]` → `min-h-[160px]`) | in-place refactor |
| `package.json` (MOD) | dependency manifest | build-time | self (add `"@mdxeditor/editor": "^4.2.5"` to `dependencies`) | trivial |

**No test file for IdentityFileTab** — it's covered via `IdentityModal.*.test.tsx` integration tests. Planner should either (a) rely on those for the refactor's regression, or (b) add `IdentityFileTab.test.tsx` alongside the new `MarkdownEditor.test.tsx`. RESEARCH.md §Pitfall 5 recommends mocking `@mdxeditor/editor` in the shim's tests to avoid jsdom/Lexical friction.

---

## Pattern Assignments

### `src/ui/features/pretty-view/MarkdownEditor.tsx` (NEW) — shared controlled editor

**Analogs (composite):**
- `src/ui/features/pretty-view/GlobalFileTab.tsx` (the raw-textarea fallback markup — copy VERBATIM, matches the four tabs' "tuned" styling)
- `src/ui/features/terminal/Terminal.tsx:34-39, 3386-3402` (lazy + Suspense pattern for heavy editor deps)
- `src/ui/ssh/dialogs/SSHAuthDialog.tsx:13-15` (module-top imports of the editor library inside the lazy-child)

**Imports pattern** — mirror `SSHAuthDialog.tsx:1-15` for a heavy-lib child + `IdentityFileTab.tsx:1-5` for the standard React + Skynet ergonomics:

```tsx
// From IdentityFileTab.tsx:1-5 (canonical Skynet pretty-view file header — React first, then @/components alias)
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
```

**Lazy-load pattern** — copy VERBATIM shape from `Terminal.tsx:10-11, 34-39`:

```tsx
// Terminal.tsx:10-11
import {
  ...
  lazy,
  Suspense,
} from "react";

// Terminal.tsx:34-39
// Lazy-loaded: SSHAuthDialog pulls @uiw/react-codemirror + @codemirror/*
// (388 KB uncompressed). Deferring to first-open saves that from cold-shell
// for every user; the dialog is manually invoked on SSH auth failure only.
const SSHAuthDialog = lazy(() =>
  import("@/ssh/dialogs/SSHAuthDialog.tsx").then((m) => ({ default: m.SSHAuthDialog })),
);
```

**Suspense usage** — from `Terminal.tsx:3386-3402`:

```tsx
{showAuthDialog && (
  <Suspense fallback={null}>
    <SSHAuthDialog
      isOpen={showAuthDialog}
      ...
    />
  </Suspense>
)}
```

Adapt for MarkdownEditor: the lazy target is a sibling `MdxEditorImpl.tsx` file that owns the heavy `@mdxeditor/editor` imports (mirror of how `SSHAuthDialog.tsx` owns the heavy `@uiw/react-codemirror` imports). Use `<Suspense fallback={<TextareaFallback ... />}>` so there's no layout jump (RESEARCH §Pattern 1 line 244-247).

**Raw-textarea fallback pattern** (used when filename doesn't match `/\.md$/i`) — **copy VERBATIM** from `GlobalFileTab.tsx:106-111`:

```tsx
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
  spellCheck={false}
/>
```

The comment at `GlobalFileTab.tsx:102-103` is load-bearing:
> *"Textarea styling copied VERBATIM from RoleFileTab.tsx L134 per CONTEXT §specifics 'do NOT reinvent, it's tuned'."*

Do the same when moving it into `MarkdownEditor.tsx`. The four tabs will drop this markup once the shared component wraps it.

**Controlled-input pattern** — from `GlobalFileTab.tsx:22-27`:

```tsx
// GlobalFileTab.tsx:22-27 — controlled draft owned by parent-effect,
// component exposes {state, onSave, [onDraftChange]}.
export default function GlobalFileTab({
  state,
  onSave,
  onDraftChange,
}: {
  state: TabState<GlobalFileTabData>;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {
```

**But** for `MarkdownEditor` we invert this: parent owns the string, we take `{filename, content, onChange, disabled}`. RESEARCH §Pattern 4 (line 445-459) is the canonical prop shape:

```tsx
interface MarkdownEditorProps {
  filename: string;                       // drives the gate — required
  content: string;                        // controlled
  onChange: (next: string) => void;       // every keystroke
  disabled?: boolean;                     // "saving" or "not editable"
  placeholder?: string;                   // optional
}
```

**Filename gate logic** — pure and trivial:

```tsx
const isMarkdown = /\.md$/i.test(filename);
if (!isMarkdown) return <RawTextarea ... />;
return <Suspense fallback={<RawTextareaFallback ... />}><MdxEditorImpl ... /></Suspense>;
```

**Anti-pattern to avoid** (from RESEARCH §Anti-Patterns line 510):
> *Do NOT try to make the shared component accept `TabState<T>` directly.* The four tabs have three different `T` shapes (`string`, `{content, mtime}`, `{content, mtime, isText}`). Keep the tab as the shim; `MarkdownEditor` is a boring `{content: string}` controlled input.

---

### `src/ui/features/pretty-view/mdxeditor.dark.css` (NEW) — dark-theme overrides

**Analog:** `src/ui/index.css` §115-165 — the source of the `--color-pv-*` tokens the CSS must consume.

**Key palette tokens** (verbatim from `src/ui/index.css`):

```css
/* src/ui/index.css:143-159 */
--color-pv-base: #141520;               /* cool off-black top of gradient */
--color-pv-base-mid: #101118;
--color-pv-base-end: #0a0b12;
--color-pv-surface-quiet: rgba(25, 26, 34, 0.5);
--color-pv-surface-quiet-alt: rgba(15, 16, 22, 0.55);
--color-pv-border-quiet: rgba(220, 225, 245, 0.06);
--color-pv-border-quiet-strong: rgba(220, 225, 245, 0.1);
--color-pv-fg: #e8e4d8;                 /* warm off-white primary text */
--color-pv-fg-muted: #a89a80;
--color-pv-fg-dim: #7a6f60;
--color-pv-code-fg: #ffb896;
```

**Dynamic identity hue** (per-pane var, live at runtime — do NOT read from `--background`/`--foreground`):
`hsla(var(--pv-id-hue, 220), 80%, 60%, X)` — the exact expression the four tabs use for focus rings (`GlobalFileTab.tsx:109` `focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]`) and Save button chrome (`GlobalFileTab.tsx:120`).

**Read-mode code styling** (must match this in fenced/inline code inside MDXEditor) — from `IdentityFileTab.tsx:158-164`:

```
prose-pre:bg-[rgba(10,12,20,0.6)] prose-pre:border prose-pre:border-white/[0.06]
prose-pre:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]
prose-code:rounded prose-code:px-1 prose-code:py-0.5
prose-code:font-[JetBrains_Mono_Variable,ui-monospace,monospace]
prose-code:bg-white/[0.08] prose-code:text-[var(--color-pv-code-fg)]
prose-code:border prose-code:border-white/[0.06]
```

The CSS-module file's `.cm-editor` and `code:not(pre code)` rules must reproduce these visuals so a user switching between read-mode preview and edit-mode WYSIWYG sees no jump (D-12 + RESEARCH §specifics).

RESEARCH §Pattern 3 (line 342-434) has the full stylesheet skeleton ready to copy — it maps MDXEditor's `--baseBg`/`--baseText`/`--accentText` vars to the Skynet tokens above.

---

### `src/ui/features/pretty-view/MarkdownEditor.test.tsx` (NEW) — component tests

**Analog:** `src/ui/features/pretty-view/GlobalFileTab.test.tsx` — closest existing shape in the pretty-view folder; same testing-library patterns will be reused.

**Test-file header + imports** (mirror `GlobalFileTab.test.tsx:1-24`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";  // named export, not default
```

**Mocking strategy** — RESEARCH §Pitfall 5 (line 594-605) is emphatic that `@mdxeditor/editor` must be `vi.mock`'d in vitest because jsdom + Lexical's contentEditable have partial-fidelity issues. RESEARCH §Example 1 (line 621-666) has a ready-to-use mock:

```tsx
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: any) => <div data-testid="mdxeditor">{props.markdown}</div>,
  // stub every named export the impl imports (headingsPlugin, listsPlugin, ...)
}));
```

**Query patterns** — `GlobalFileTab.test.tsx:26-56` shows the canonical shape:

```tsx
// GlobalFileTab.test.tsx:25-29 — loading branch assertion
it("test 1: loading → Skeleton, no textarea, no error", () => {
  render(<GlobalFileTab state={{ status: "loading" }} onSave={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/Couldn't load file/i)).toBeNull();
});

// GlobalFileTab.test.tsx:43-56 — controlled-input assertion
const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
expect(ta.value).toBe("hello");
const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
expect(saveBtn.disabled).toBe(true);
fireEvent.change(ta, { target: { value: "hello world" } });
expect(saveBtn.disabled).toBe(false);
```

**Filetype-gate tests** — copy the 5-case matrix from RESEARCH §Example 1 (line 636-667):
- `.md` → mocked MDXEditor renders (`getByTestId("mdxeditor")`)
- `.MD` (uppercase) → mocked MDXEditor renders (case-insensitive gate)
- `.json` → textarea only, no mdxeditor
- no extension (e.g. `Dockerfile`) → textarea only
- `.sh` → textarea only

**Round-trip test (D-05, D-14):** — outside vitest per RESEARCH §Pitfall 5. Port the tasting's `frontmatter-check.mjs` (at `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/frontmatter-check.mjs`) as either (a) a Playwright e2e if Skynet acquires that surface, or (b) an out-of-band verification step run against a dev server. Planner decision.

---

### `src/ui/features/pretty-view/IdentityFileTab.tsx` (MOD) — swap edit-mode textarea

**Analog:** self. This is a surgical in-place swap.

**Current edit-mode textarea** (`IdentityFileTab.tsx:135-148`):

```tsx
{editing ? (
  <div className="flex flex-col flex-1 min-h-0">
    <textarea
      className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      spellCheck={false}
    />
    {saveError && (
      <div className="text-sm text-[color:var(--color-pv-code-fg)] mt-2">
        Save failed: {saveError}
      </div>
    )}
  </div>
) : (
```

**After refactor:**

```tsx
{editing ? (
  <div className="flex flex-col flex-1 min-h-0">
    <MarkdownEditor
      filename="identity.md"    // synthetic — always pretty (D-06 gate hits .md)
      content={draft}
      onChange={setDraft}
      disabled={saving}
    />
    {saveError && (
      <div className="text-sm text-[color:var(--color-pv-code-fg)] mt-2">
        Save failed: {saveError}
      </div>
    )}
  </div>
) : (
```

**Unchanged:**
- `TabState<T>` export (`IdentityFileTab.tsx:21-24`) — every downstream call site depends on it (D-08).
- `handleSave` / `handleCancel` (L38-62).
- Loading / error / empty branches (L64-88).
- Toolbar Edit/Save/Cancel (L93-131).
- Read-mode `ReactMarkdown` block (L149-177).

---

### `src/ui/features/pretty-view/RoleFileTab.tsx` (MOD) — same swap as IdentityFileTab

**Analog:** self + `IdentityFileTab.tsx` (byte-shape mirror per L8-13 of RoleFileTab).

**Current edit-mode textarea** (`RoleFileTab.tsx:131-144`) is byte-identical to IdentityFileTab's — swap is byte-identical too, with `filename="role.md"` (synthetic, always-pretty).

---

### `src/ui/features/pretty-view/GlobalFileTab.tsx` (MOD) — add filename prop, swap textarea

**Analog:** self.

**Props change** — new required `filename` prop, threaded from parent modal:

```tsx
// BEFORE (GlobalFileTab.tsx:21-27)
export default function GlobalFileTab({
  state,
  onSave,
  onDraftChange,
}: {
  state: TabState<GlobalFileTabData>;
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {

// AFTER
export default function GlobalFileTab({
  state,
  filename,                                                 // NEW — required
  onSave,
  onDraftChange,
}: {
  state: TabState<GlobalFileTabData>;
  filename: string;                                         // NEW — required
  onSave: (content: string, expectedMtime: number) => Promise<void>;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {
```

**Current textarea** (`GlobalFileTab.tsx:106-111`):

```tsx
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
  spellCheck={false}
/>
```

**After refactor:**

```tsx
<MarkdownEditor
  filename={filename}                    // gate on file extension (D-06)
  content={draft}
  onChange={setDraft}
  disabled={saving}
/>
```

**Unchanged (load-bearing):**
- mtime-reseed effect (`GlobalFileTab.tsx:45-51`) — the shared component is agnostic; the tab still owns this.
- `onDraftChange` divergence effect (`L57-61`) — same.
- `handleSave` (L63-74) — same optimistic-concurrency signature.
- Loading + error branches (L77-93).
- Save button chrome (L115-124) — the raise/hover accent uses `--pv-id-hue`; don't move it into MarkdownEditor.

---

### `src/ui/features/pretty-view/SkillFileTab.tsx` (MOD) — add filename prop, swap textarea

**Analog:** self + `GlobalFileTab.tsx` (byte-shape mirror per SkillFileTab.tsx:8-9).

Same shape as GlobalFileTab's refactor. Add `filename: string` to the props destructure + interface. Swap `L120-125` textarea for `<MarkdownEditor filename={filename} content={draft} onChange={setDraft} disabled={saving} />`.

**Two unchanged tab-owned branches:**
- Non-text placeholder (`SkillFileTab.tsx:100-112`) — this branch runs BEFORE the textarea; `data.isText === false` → AlertTriangle placeholder, no editor at all. Do NOT move this into MarkdownEditor.
- Trash2 delete-file trigger (`L129-137`) — sits next to Save. Same footer, unchanged.

---

### `src/ui/features/pretty-view/GlobalFilesModal.tsx` (MOD) — one-line filename thread

**Analog:** self, L316-321.

**Current:**

```tsx
// GlobalFilesModal.tsx:316-321
<GlobalFileTab
  state={tabData.get(file.path) ?? { status: "loading" }}
  onSave={(content, expectedMtime) =>
    handleSave(file.path, content, expectedMtime)
  }
/>
```

**After (add `filename={file.path}`):**

```tsx
<GlobalFileTab
  state={tabData.get(file.path) ?? { status: "loading" }}
  filename={file.path}
  onSave={(content, expectedMtime) =>
    handleSave(file.path, content, expectedMtime)
  }
/>
```

`file.path` is already the authoritative filename (used as key L312, value L313, onSave arg L319). Reuse verbatim.

---

### `src/ui/features/pretty-view/SkillsEditorModal.tsx` (MOD) — one-line filename thread

**Analog:** self, L570-579. Same shape as GlobalFilesModal — add `filename={file.path}` to the `<SkillFileTab>` call.

---

### `src/ui/features/pretty-view/RunbookEditorModal.tsx` (MOD) — one-line filename thread

**Analog:** self, L456-465. Same as SkillsEditorModal (RunbookEditorModal mounts `<SkillFileTab>` too; L444 comment says *"Mirrors SkillsEditorModal L558-634"*). Add `filename={file.path}`.

---

### `src/ui/features/pretty-view/EditableFileModal.tsx` (MOD) — one-line filename thread

**Analog:** self, L487-491. `filename` is ALREADY in scope at the component-prop level (`EditableFileModal.tsx:194`), so:

**Current:**

```tsx
// EditableFileModal.tsx:487-491
<GlobalFileTab
  state={fetchState}
  onSave={handleSave}
  onDraftChange={setIsDirty}
/>
```

**After:**

```tsx
<GlobalFileTab
  state={fetchState}
  filename={filename}                    // already in scope from EditableFileModalProps
  onSave={handleSave}
  onDraftChange={setIsDirty}
/>
```

---

### `src/ui/features/pretty-view/BountyCard.tsx` (MOD) — premise WYSIWYG swap

**Analog:** self, L1061-1069.

**Current `<Textarea>` (shadcn wrapper)** — `BountyCard.tsx:1061-1069`:

```tsx
<Textarea
  value={premiseDraft}
  onChange={(e) => setPremiseDraft(e.target.value)}
  onKeyDown={onPremiseKeyDown}
  disabled={savingPremise}
  rows={8}
  autoFocus
  className="text-sm font-mono bg-white/5 border-white/20 text-[#f0ebe0] resize-y"
/>
```

**After:**

```tsx
<MarkdownEditor
  filename="premise.md"                  // synthetic — always pretty (D-06 gate hits .md)
  content={premiseDraft}
  onChange={setPremiseDraft}
  disabled={savingPremise}
/>
```

**Load-bearing surrounding code (unchanged):**
- `startEditPremise` / `cancelEditPremise` / `savePremise` handlers (L470-500).
- `onPremiseKeyDown` (L502-505) — Escape + Cmd+Enter shortcuts. **Note:** the shortcut handler wires directly to the textarea's `onKeyDown` today; MarkdownEditor will need to either surface an `onKeyDown` passthrough, OR the caller will need to accept that these shortcuts only fire when focus is on non-editable chrome. RESEARCH doesn't explicitly cover this — planner should decide (recommend: shortcuts stay on the outer wrapper `<div>` if practical, since MDXEditor's own Escape/Enter behaviour is defined internally).
- Save + Cancel `<Button>`s (L1071-1091).
- `premiseError` display (L1092-1094).

**Remove import** (once no other call site in BountyCard uses `<Textarea>`): `BountyCard.tsx:7` — `import { Textarea } from "@/components/textarea";`. Grep the file first; if `<Textarea>` is used elsewhere (todos, keywords, etc. — RESEARCH's deferred list says those DO stay as raw), the import stays.

---

### `src/ui/features/pretty-view/AddWakeupDialog.tsx` (MOD) — instruction WYSIWYG swap

**Analog:** self, L415-426.

**Current raw `<textarea>`** — `AddWakeupDialog.tsx:415-426`:

```tsx
<textarea
  id="add-wakeup-instruction"
  value={instructionDraft}
  onChange={(e) => setInstructionDraft(e.target.value)}
  rows={3}
  placeholder="What should the agent do when this fires?"
  className={cn(
    "bg-black/30 text-[#e8e4d8] border border-white/10",
    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
    "resize-y min-h-[60px]",
  )}
/>
```

**After** (per RESEARCH §Open Question 2 recommendation — raise min-height to accommodate toolbar):

```tsx
<div className="min-h-[160px]">
  <MarkdownEditor
    filename="wakeup.md"                    // synthetic — always pretty
    content={instructionDraft}
    onChange={setInstructionDraft}
    placeholder="What should the agent do when this fires?"
  />
</div>
```

**Why the wrapper `<div>`:** MDXEditor's toolbar is ~40px tall; the current `min-h-[60px]` would leave ~20px for the editing area (unusable). RESEARCH §Open Question 2 recommends option (b): raise the min-height. `min-h-[160px]` gives ~120px of edit surface + toolbar, matching the spatial feel of the current 3-row textarea while accommodating WYSIWYG chrome.

**Load-bearing surrounding code (unchanged):**
- Label (`L408-414`).
- `instructionDraft` state (elsewhere in the component).
- Save enable predicate — `validateForm` returns null only when instruction is non-empty; MarkdownEditor's `onChange` fires on every keystroke so the same predicate still works.

---

### `package.json` (MOD) — add `@mdxeditor/editor`

**Analog:** package.json itself.

**Add to `dependencies`:**

```json
"@mdxeditor/editor": "^4.2.5",
```

Alphabetical order (existing `dependencies` block is sorted). Run `npm install` — verifies lockfile and resolves peer deps against React ^19.2.5 (peer `react >= 18 || >= 19` — satisfied per RESEARCH line 118).

---

## Shared Patterns

### Shared Pattern A — Skynet import conventions (React first, then `@/` aliases, then feature-local)

**Source:** Standard shape across every pretty-view file. `IdentityFileTab.tsx:1-5`, `GlobalFileTab.tsx:1-3`, `SkillFileTab.tsx:1-4` all follow it.

```tsx
// 1. React + framework
import { useState /*, useEffect, useCallback, ... */ } from "react";
// 2. Third-party libs (react-markdown, remark-gfm, lucide-react, radix-ui)
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Trash2 } from "lucide-react";
// 3. @/ path aliases (Skynet's tsconfig alias for src/)
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
// 4. Feature-local relative imports (types, siblings)
import type { TabState } from "./IdentityFileTab";
```

**Apply to:** `MarkdownEditor.tsx`, `MarkdownEditor.test.tsx`. Feature-local sibling `MdxEditorImpl.tsx` (the lazy child, if planner splits it) uses the same order.

### Shared Pattern B — controlled draft + `useState` per surface

**Source:** all four tabs + BountyCard + AddWakeupDialog use `useState` for the draft string, the parent owns "confirmed" content in props/state, `disabled` flips during in-flight save.

Example from `IdentityFileTab.tsx:33-36`:

```tsx
const [editing, setEditing] = useState(false);
const [draft, setDraft] = useState("");
const [saving, setSaving] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);
```

**Apply to:** the shim contract. MarkdownEditor itself is controlled (parent owns `content` + `onChange`). The tabs KEEP their `draft`/`saving`/`saveError` state.

### Shared Pattern C — save-handler dispatch (Promise-returning, error captured)

**Source:** `IdentityFileTab.tsx:38-50` (simple `(contents: string) => Promise<void>`) + `GlobalFileTab.tsx:63-74` (`(content: string, expectedMtime: number) => Promise<void>`).

Simple variant (IdentityFileTab.tsx:38-50):

```tsx
async function handleSave() {
  if (!onSave) return;
  setSaving(true);
  setSaveError(null);
  try {
    await onSave(draft);
    setEditing(false);
  } catch (e) {
    setSaveError(e instanceof Error ? e.message : String(e));
  } finally {
    setSaving(false);
  }
}
```

mtime variant (GlobalFileTab.tsx:63-74):

```tsx
const handleSave = useCallback(async () => {
  if (state.status !== "ready") return;
  setSaving(true);
  setSaveError(null);
  try {
    await onSave(draft, state.data.mtime);
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : "Save failed");
  } finally {
    setSaving(false);
  }
}, [state, draft, onSave]);
```

**Apply to:** Nothing new; both handlers survive the refactor untouched. Shared component doesn't know or care about save.

### Shared Pattern D — Skeleton loading + error branches

**Source:** identical shape in all four tabs (`IdentityFileTab.tsx:64-79`, `GlobalFileTab.tsx:77-93`, `SkillFileTab.tsx:77-95`, `RoleFileTab.tsx:60-75`).

```tsx
if (state.status === "loading") {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
    </div>
  );
}

if (state.status === "error") {
  return (
    <div className="text-sm text-[color:var(--color-pv-code-fg)]">
      Couldn&apos;t load file: {state.error}
    </div>
  );
}
```

**Apply to:** all four tabs (unchanged). MarkdownEditor is never called in loading/error branches — those tab-level branches short-circuit before we get there.

### Shared Pattern E — palette authority (`--color-pv-*`, never `--background`/`--foreground`)

**Source:** CONTEXT.md canonical refs L156-157 + `src/ui/index.css:143-159`.

Every colour reference in pretty-view derives from `--color-pv-*` tokens or the per-pane `--pv-id-hue` var. Cross-surface colour must never touch Skynet's global `--background`/`--foreground` (project directive).

**Apply to:** `mdxeditor.dark.css`. Every colour override targets `--color-pv-*` OR `hsla(var(--pv-id-hue, 220), ...)`. Never `--background`/`--foreground`.

### Shared Pattern F — vitest imports + Skynet mocking style

**Source:** every `.test.tsx` under `src/ui/features/pretty-view/`.

```tsx
// Header block (from GlobalFileTab.test.tsx:16-18)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GlobalFileTab from "./GlobalFileTab";

// beforeEach vi.clearAllMocks()  — from GlobalFileTab.test.tsx:21-23
beforeEach(() => {
  vi.clearAllMocks();
});
```

**Apply to:** `MarkdownEditor.test.tsx` — mirror this header verbatim.

---

## No Analog Found

None. Every file this phase touches has an in-repo analog. The only NEW-territory element is `mdxeditor.dark.css` — but its palette source (`src/ui/index.css` §115-165) is clear, and its structural template (RESEARCH §Pattern 3) is spelled out in the research doc. No pattern-mapping gap.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` — all tab, modal, and card files (13 read)
- `src/ui/features/terminal/Terminal.tsx` — lazy-load pattern
- `src/ui/ssh/dialogs/SSHAuthDialog.tsx` — heavy-lib child pattern
- `src/ui/index.css` — palette source

**Files scanned:** 15 (13 read in full for extraction, 2 skimmed for palette/lazy patterns)

**Pattern extraction date:** 2026-09-16

**Planner note:** every file in "Modified files" is a surgical, in-place refactor with `self` as its own analog — the tab files ARE the standard shape they inherit from. The one true NEW component (`MarkdownEditor.tsx`) composes three well-established patterns (controlled-input, lazy+Suspense, textarea-fallback) that already exist in the repo. This phase is fundamentally wiring, not net-new architecture — pattern-mapping bore that out.

## PATTERN MAPPING COMPLETE
