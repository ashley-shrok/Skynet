# Migration brief — moving modals onto the kit (shape-ux-foundation)

You are moving a batch of Skynet modals (and the tabs/panes they render) onto the shared kit. Work in `/home/ubuntu/fleet/identities/copper-box-maintainer-2/workspace/skynet` (React + Tailwind v4, vitest).

## Read first
- `.planning/campaigns/apple-ux/shape-ux-foundation.md` — the agreement. Especially "Shape", "What would make it wrong", "Scope edges".
- `src/ui/components/kit/` — the kit (`index.ts` exports everything; `kit.css` is the look). Also `src/ui/components/modal.tsx` (the shell — already in look A: ModalHead/Body/Foot/Tabs/Sidebar).
- `.planning/campaigns/apple-ux/tasting-ux-foundation.js` — the approved visual reference (the "kit" section shows each part).
- `.planning/campaigns/apple-ux/modal-element-inventory.md` — where hand-rolled elements live (file:line pointers).

## What to do in your files
1. Every button, field, dropdown, multi-line box, search box, label, switch/checkbox/radio/slider, segmented choice, chip, pick-chip, list row, settings row, host picker, toolbar/breadcrumbs, empty/loading/problem state inside a modal comes from the kit. Remove hand-rolled versions and their ad-hoc colour classes (hsla(var(--pv-id-hue)…), bg-black/20, #fbf5e8, inline style objects, `--color-pv-*`). Text colours inside modals use the kit tokens (`var(--k-t1)`, `--k-t2`, `--k-t3`) via Tailwind arbitrary values when you need plain text styling.
2. The old shared `Button` (`@/components/button`), `Input`, `Switch`, `Textarea`, `MultiSelect` inside modals → kit equivalents.
3. Every `window.confirm` / `window.prompt` / `window.alert` (or bare `confirm(`/`alert(`/`prompt(`) in your files → `await kitConfirm({...})` / `kitPrompt` / `kitAlert` from `@/components/kit`. Make the handler async. Write good dialog copy: a short title (the question), an optional body, a specific confirm label ("Delete", "Archive", "Discard"), `destructive: true` for can't-undo actions. Use `kitPrompt`'s `validate` where the old code re-prompted or rejected input.
4. A modal with its own hand-made header (avatar, chips, close button) → rebuild on `ModalHead` (use its `leading` slot for the avatar, `actions` for header buttons, `children` for chips/extra lines). Keep everything it shows. You may reposition things where that fits the kit better (e.g. move a dropdown out of a header into a settings row) — broad strokes, the user nitpicks later. Don't add features; don't redesign the modal's overall layout beyond what using kit parts implies.
5. Settings-heavy screens (preferences panes, admin panes, forms with label+control pairs) → `KitSettingsGroup` + `KitSettingsRow` where it reads naturally; forms with free text → `KitField` + controls.
6. Drop modal `className` overrides that fight the shell (e.g. `max-h-[90vh]`, custom borders/backgrounds) unless needed for layout.
7. Keep every behaviour, including read-only states (view-only editors, disabled controls, admin-only branches). Keep every `data-testid`, `aria-label`, role and the `data-slot="dialog-title"` hook. Where a test relied on a removed class name or on `window.confirm` being mocked, update the test to drive the kit (e.g. click `kit-dialog-confirm` / `kit-dialog-cancel`, type into `kit-prompt-input`; `__resetKitDialogsForTests()` in afterEach). Never weaken what a test checks about behaviour.
8. The kit dialogs mount themselves; nothing to wire.

## If the kit lacks a part
Do NOT edit files under `src/ui/components/kit/` or `src/ui/components/modal.tsx` — other agents are working in parallel. Compose from existing kit parts if at all possible. If something is truly missing, put a minimal local component in your feature folder built only from kit classes/tokens, and list it in your report as "kit candidate" so the orchestrator can promote it.

## Rules
- Touch ONLY the files in your batch (plus their own `*.test.tsx`). Shared files outside your batch: don't edit; report what you'd change.
- NO git commands that change state (no add/commit/stash/checkout/reset). The orchestrator commits. NEVER use git worktrees.
- Tests: run scoped only — `npx vitest related --run <your files>` — and fix what you broke. Don't run the full suite.
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "error TS" | grep -E "<your file names>"` — introduce no new errors in your files (the repo has ~510 pre-existing errors elsewhere; ignore those).
- Don't deploy, push, or touch docker.

## Report back (concise)
- Files changed; for each modal, one line on what changed visibly (incl. anything repositioned).
- Every pop-up replaced (file + old text → new title/confirm label).
- Kit candidates / shared-file changes you'd want.
- Test results (counts) and any test you changed + why.
- Anything you couldn't do or that looks risky.
