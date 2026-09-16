---
phase: quick-260914-liu
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260914-LIU]
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
  - tests/e2e/golden-create-agent.spec.ts
  - tests/e2e/feature-sweep.spec.ts

must_haves:
  truths:
    - "The conversation-list panel header renders NO Filter icon and no filter popover anywhere in the DOM"
    - "The header renders four icon buttons left-to-right: New agent, Edit roles, Edit global files, kebab"
    - "Clicking the New agent header icon opens the NewSessionDialog (title 'New agent')"
    - "Clicking the Edit roles header icon opens the RolesListModal (title 'Roles')"
    - "Clicking the Edit global files header icon opens the GlobalFilesModal"
    - "The kebab menu contains exactly two items: 'New group conversation' then 'Edit global skills...'"
    - "All four header buttons disappear together when onCreateSession is undefined"
    - "Scoped vitest suite for src/ui/features/pretty-conversations/ is green and tsc --noEmit is clean"
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Header chrome with three promoted icon buttons; zero filter-popover markup"
      contains: "pv-header-new-agent-button"
    - path: "src/ui/features/pretty-conversations/pretty-conversations.css"
      provides: "Filter-specific rules pruned; .pv-pencil rules intact including mobile bump"
      contains: ".pv-panel-header .pv-pencil"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "setNewSessionDialogOpen / setRolesListModalOpen / setGlobalFilesModalOpen"
      via: "onClick handlers on the three promoted header buttons"
      pattern: "pv-header-(new-agent|edit-roles|global-files)-button"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "pretty-conversations.css .pv-panel-header .pv-pencil"
      via: "className pv-pencil on all four header buttons (incl. mobile 48px media bump)"
      pattern: "className=\"pv-pencil\""
---

<objective>
Conversation-list panel header chrome restructure. Remove the Filter icon and its
entire popover; promote three kebab items ("New agent", "Edit roles...", "Edit global
files...") into dedicated header icon buttons using lucide `SquarePen`, `Drama`, `Globe`.

Purpose: flatten the information architecture of the panel header — the three most-used
actions become one-click instead of two-click, and the Ready-filter affordance (which
the user does not use) stops occupying header real estate.

Output: cosmetic / IA change only. Every promoted action opens EXACTLY the modal it opens
today. No behavior change to any action, no new CSS classes, no new state.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/pretty-conversations.css

**Branch:** stay on `feat/tab-title-from-tmux`. Do NOT create a branch. NEVER use git worktrees.

**PREFLIGHT — `node_modules/` is ABSENT in this workspace.** Neither `vitest` nor `tsc`
can run until dependencies are installed. Before the Task 3 gate, run `npm ci` from the
repo root (`.npmrc` already sets `legacy-peer-deps=true`; `postinstall` runs four patch
scripts). Allow a generous timeout (600000ms) — large lockfile with native builds
(better-sqlite3, nan). Do this ONCE, at the start of Task 3.

**Verified facts (do not re-investigate):**
- `lucide-react@1.28.0` is the pinned version (package-lock) and exports all three icons —
  `SquarePen`, `Drama`, `Globe` each have a `declare const` in `dist/lucide-react.d.ts`.
  `Globe` is already imported elsewhere in the app (`src/ui/user/LanguageSwitcher.tsx:10`),
  confirming the import shape.
- `Popover` / `PopoverTrigger` / `PopoverContent` (imported at `:134` from
  `@/components/popover`) have NO consumer in this file other than the filter block. All 15
  `Popover` grep hits live in the import line, the block at `:1721-1784`, or comments inside
  it. The import line therefore MUST be deleted.
- `.pv-filter*` appears ONLY in `pretty-conversations.css` repo-wide (23 hits). No other
  stylesheet references it.
- `.pv-panel-header .pv-pencil` already carries: 32x32 base chrome, hover treatment, 18x18
  svg sizing (`:105-131`), AND a mobile `@media (max-width: 767.98px)` bump to 48x48 /
  24x24 svg (`:1332-1342`). Reusing `pv-pencil` on the three new buttons gets all of that
  for free — which is exactly why no new CSS is needed.
- `.pv-header-actions` (`:136-140`) is `inline-flex` with `gap: 6px` (10px on mobile), so
  four children lay out correctly with zero CSS change.
- `filterLabel` (`:1636`, i18n key `nav.conversations.filterPinnedBounties`) is ALREADY
  dead today — its only other mention is a comment inside the block being deleted. It is
  pre-existing dead code, NOT something this change creates. **Leave it alone.**

**Toolchain permissiveness (why the deliberate dead code below is safe):**
`tsconfig.app.json` and `tsconfig.node.json` both set `noUnusedLocals: false` and
`noUnusedParameters: false`. `eslint.config.mjs` sets `@typescript-eslint/no-unused-vars: off`
and `unused-imports/no-unused-vars: "warn"` (non-blocking). Only
`unused-imports/no-unused-imports` is `"error"` — which is why unused *imports* (`Filter`,
`Popover*`) MUST go, while unused *locals* may stay.
</context>

<deliberate_dead_code>
**EXPLICIT USER DECISION — DO NOT "helpfully" clean these up. A change that removes them
is WRONG and will be rejected.**

The Ready-filter machinery stays in place as dead code:

| Location | Binding |
|----------|---------|
| `PrettyConversationsPanel.tsx:808` | `const [readyOnly, setReadyOnly] = useState(false)` |
| `PrettyConversationsPanel.tsx:810` | `const anyFilterOn = readyOnly` |
| `PrettyConversationsPanel.tsx:831-870` | the `rowSessionStates` `useSyncExternalStore` block |
| `PrettyConversationsPanel.tsx:889-911` | `matchesFilterForRow` useMemo |
| `PrettyConversationsPanel.tsx:929-933` | `displayedPinned` / `displayedMiddle` |

the user's verbatim words: *"i don't really care whether we delete the ready filter feature
itself, i just want the filter icon gone for right now. like, if it's trivial to remove,
then that's fine. and if not, just leave it as dead code because it's not going to hurt
anything else."*

Investigation established that feature-removal is NOT trivial: the `useSyncExternalStore`
block exists solely to feed the Ready predicate, and its output flows through
`displayedPinned` / `displayedMiddle` into the render path at `:1927` and `:1956`. So
dead-code-retention is the chosen path.

After this change `anyFilterOn` is permanently `false`, so `displayedPinned` /
`displayedMiddle` pass rows through unfiltered. **That is intended and correct.**

**The ONLY `anyFilterOn` references you remove are the two INSIDE the deleted Popover JSX:**
the `data-active` at `:1730` and the `pv-filter-dot` conditional at `:1734`. They vanish
along with the block. `anyFilterOn`'s declaration at `:810` and its uses at `:929` / `:932`
stay untouched. Likewise `setReadyOnly` loses its only caller (`:1774`, inside the deleted
block) — that is fine and expected.
</deliberate_dead_code>

<hard_scope_boundary>
**Do NOT edit `src/ui/sidebar/NewSessionDialog.tsx`.** A peer agent (`camelot`) owns that
file in parallel right now. Editing it would collide with concurrent work.

`src/ui/sidebar/NewSessionDialog.test.tsx:526` references `pv-header-menu-button` for a
document-order check. The kebab still exists, so **that test needs NO change** — leave it.

Do NOT touch `tests/e2e/probe-create-role.spec.ts` or `tests/e2e/probe-new-session.spec.ts`.
They are diagnostic probes with pre-existing staleness (probe-create-role already clicks a
`/new role/i` menuitem that was renamed to "Edit roles..." phases ago) and are not part of
any gate.

`src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx` uses the kebab
only to reach "New group conversation", which REMAINS a kebab item. **Verify it needs no
change; do not edit it.**
</hard_scope_boundary>

<ship_discipline>
Your remit STOPS at: code + atomic commits + scoped tests green.

**FORBIDDEN in this plan — do not run, do not add as a step:**
- `git push` (any form)
- `docker build`, `docker compose up`, any `npm run dev:docker*`
- Any deploy, ship, or release action
- Full-suite `npx vitest run` with no path filter (that is a deploy-time gate; we are not
  deploying)

Deploys are orchestrator-only and the user gates every push personally.

**Also forbidden:**
- Committing docs artifacts (`PLAN.md`, `SUMMARY.md`, `STATE.md`) — the orchestrator
  handles the docs commit separately.
- Updating `ROADMAP.md` — quick tasks are tracked separately.
</ship_discipline>

<tasks>

<task type="auto">
  <name>Task 1: Delete the Filter popover from the panel and prune its dead CSS</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/pretty-conversations.css</files>
  <action>
Two coordinated deletions. Line numbers are current-state hints — anchor on the quoted
identifiers, not the numbers.

**A. `PrettyConversationsPanel.tsx`**

1. Line `:59` — drop `Filter` from the lucide-react import. The line becomes an import of
   `ChevronDown, ChevronRight, EyeOff, Loader2, Monitor, MoreVertical, Search, X`. Keep the
   existing alphabetical order, minus `Filter`.
2. Line `:134` — delete the entire import line for `Popover`, `PopoverTrigger`,
   `PopoverContent` from `@/components/popover`. This is safe: the filter block is the sole
   consumer in this file (verified — see context). Deleting it is REQUIRED because
   `unused-imports/no-unused-imports` is an eslint error.
3. Line `:809` — delete the `filterPopoverOpen` / `setFilterPopoverOpen` useState
   declaration. Leave `readyOnly` / `setReadyOnly` on `:808` and `anyFilterOn` on `:810` in
   place (see deliberate_dead_code). Update the preceding comment block (`:801-807`) to drop
   its now-stale trailing sentence about `filterPopoverOpen` and Test 30 Escape-closes
   semantics; keep the rest, which still explains `readyOnly`.
4. Lines `:1714-1784` — delete the leading JSX comment (the "Phase 26 D-03/D-05 (Phase 52
   Plan 02 restyle): Filter button to shadcn Popover..." block) AND the whole
   `Popover` element from its opening tag through its closing tag. This removes in one shot:
   the `PopoverTrigger` button (`className="pv-filter"`,
   `data-testid="pv-filter-toggles"`, the `Filter` icon element, the
   `data-active={anyFilterOn ...}` attribute, the `pv-filter-dot` span), the
   `PopoverContent` (`className="pv-filter-popover"`,
   `data-testid="pv-filter-toggles-popover"`, its ~18-line inline style object), and the
   single `pv-filter-toggle-ready` `menuitemcheckbox` with its `pv-filter-check` span and
   inline check SVG.
   After this deletion the `pv-header-actions` div at `:1713` has exactly one child: the
   `showPencilButton`-guarded kebab button.

**B. `pretty-conversations.css`** — remove every filter-only rule. Delete these blocks
together with their dedicated leading comments:

- `:142-162` — the "Patch #167 — pinned-bounty filter toggle" comment and the base
  `.pv-panel-header .pv-filter` rule.
- `:164-168` — `.pv-panel-header .pv-filter:hover`.
- `:170-174` — `.pv-panel-header .pv-filter[data-active="true"]`.
- `:176-179` — `.pv-panel-header .pv-filter[data-active="true"]:hover`.
- `:181-185` — `.pv-panel-header .pv-filter svg`.
- `:187-193` — the "Phase 26 D-03: small dot indicator" comment and the
  `.pv-panel-header .pv-filter { position: relative; }` rule.
- `:194-203` — `.pv-panel-header .pv-filter .pv-filter-dot`.
- `:204-212` — the "Mobile bump: ~14px dot" comment and its
  `@media (max-width: 767.98px)` wrapper (the media block contains ONLY the dot rule, so the
  whole media block goes).
- `:214-228` — the "Phase 52 Plan 02" comment and the intentionally-empty
  `.pv-filter-popover` rule.
- `:229-256` — `.pv-filter-menu-item`, its `:hover`, its `:active`, and the
  `@media (max-width: 767.98px)` block that contains only `.pv-filter-menu-item` (whole
  media block goes).
- `:257-286` — `.pv-filter-check`, `.pv-filter-check[data-checked="true"]`,
  `.pv-filter-check svg`, `.pv-filter-check[data-checked="true"] svg`.

Then FOUR SURGICAL edits — these are shared selector lists / prose, NOT whole-block deletes:

- `:1332-1337` — the mobile bump is a two-selector list: `.pv-panel-header .pv-pencil,`
  then `.pv-panel-header .pv-filter { width: 48px; ... }`. Remove ONLY the `.pv-filter`
  half and the trailing comma on the `.pv-pencil` line. **The `.pv-pencil` half MUST
  survive** — it is what gives the four header buttons their 48px mobile touch target.
- `:1338-1342` — same shape for the svg sizing list: `.pv-panel-header .pv-pencil svg,`
  then `.pv-panel-header .pv-filter svg { width: 24px; ... }`. Remove ONLY the
  `.pv-filter svg` half and the trailing comma. **Keep `.pv-pencil svg`.**
- `:1419` — prose inside a comment block lists
  `.pv-pencil, .pv-filter, .pv-pin-action, .pv-deactivate-action, .pv-hide-action.`
  Drop `.pv-filter, ` from that list so the comment stays truthful.
- `:133-135` — the `.pv-header-actions` comment says it "wraps the filter + pencil".
  Update the prose to describe the new reality (it wraps the promoted action buttons plus
  the kebab so they align flush-right). Do NOT change the rule body — `inline-flex` plus
  `gap: 6px` already handles four children.

Commit as `refactor(pretty-conversations): remove the header Filter icon and its popover`.

Note: the vitest suite goes RED after this task (tests still assert on `pv-filter-toggles`).
That is expected — Task 3 restores green. Do not run the vitest gate yet.
  </action>
  <verify>
    <automated>
cd /home/ubuntu/fleet/identities/alpha/workspace/skynet-alpha
set -eu
F=src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
C=src/ui/features/pretty-conversations/pretty-conversations.css
test "$(grep -c 'pv-filter' "$F")" = 0
test "$(grep -c 'filterPopoverOpen' "$F")" = 0
test "$(grep -cE '(Filter />|Filter/>|components/popover|PopoverTrigger|PopoverContent)' "$F")" = 0
test "$(grep -c 'pv-filter' "$C")" = 0
test "$(grep -cE '^[[:space:]]*\.pv-panel-header \.pv-pencil( svg)?[[:space:],{]' "$C")" = 4
test "$(grep -c 'anyFilterOn' "$F")" = 3
test "$(grep -c 'readyOnly' "$F")" -ge 4
echo GATE-OK
    </automated>
  </verify>
  <done>
`pv-filter` has zero occurrences in both the panel and the stylesheet. `filterPopoverOpen`,
the `Filter` JSX element, and all three `@/components/popover` imports are gone. The
`.pv-pencil` base rule, `:hover`, `svg` sizing, and BOTH halves of the mobile bump (now
`.pv-pencil`-only) survive — the `= 4` count covers `.pv-pencil {` and `.pv-pencil svg {`
at `:105`/`:127` plus the two de-listed mobile-bump selectors. `anyFilterOn` still has
exactly 3 occurrences (declaration at `:810` plus uses at `:929`/`:932`), and `readyOnly`
retains at least 4 — proving the deliberate dead code survived and only the two in-Popover
references went away.
  </done>
</task>

<task type="auto">
  <name>Task 2: Promote New agent / Edit roles / Edit global files into header icon buttons</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx</files>
  <action>
**A. Import the three locked icons.** Add `Drama`, `Globe`, `SquarePen` to the lucide-react
import at `:59`, preserving alphabetical ordering. Final import set:
`ChevronDown, ChevronRight, Drama, EyeOff, Globe, Loader2, Monitor, MoreVertical, Search, SquarePen, X`.

**ICON CHOICES ARE LOCKED.** the user picked `SquarePen`, `Drama`, `Globe` after reviewing a
rendered preview of candidates. Do NOT substitute alternatives. Do NOT "improve" them.

**B. Add three buttons inside the `pv-header-actions` div, BEFORE the existing kebab
button**, so final left-to-right order is: New agent, Edit roles, Edit global files, kebab.

Wrap all four buttons in ONE `showPencilButton &&` guard using a JSX fragment. That
collapses the existing per-kebab guard into a single shared guard and preserves the gating
contract exactly (`showPencilButton` is `typeof onCreateSession === "function"` at `:1115`).
The kebab's existing attributes — `ref={menuButtonRef}`, `onClick={openMenu}`,
`data-testid="pv-header-menu-button"`, `aria-label="More actions"`, `aria-haspopup="menu"`,
`aria-expanded={menuOpen}`, `className="pv-pencil"` — move inside the fragment UNCHANGED.

Each new button:
- `type="button"`
- `className="pv-pencil"` — **do NOT invent new CSS classes and do NOT add any CSS.**
  `pv-pencil` already supplies 32x32 chrome, hover treatment, 18x18 svg sizing, and the
  48x48 / 24x24 mobile bump.
- icon rendered at `size={18}`, matching the existing `MoreVertical size={18}`
- `aria-label` and `title` both set to the label below
- stable `data-testid` per existing convention

| Order | Icon | aria-label / title | data-testid | onClick |
|-------|------|--------------------|-------------|---------|
| 1 | `SquarePen size={18}` | `New agent` | `pv-header-new-agent-button` | `() => setNewSessionDialogOpen(true)` |
| 2 | `Drama size={18}` | `Edit roles` | `pv-header-edit-roles-button` | `() => setRolesListModalOpen(true)` |
| 3 | `Globe size={18}` | `Edit global files` | `pv-header-global-files-button` | `() => setGlobalFilesModalOpen(true)` |
| 4 | `MoreVertical size={18}` | `More actions` (existing) | `pv-header-menu-button` (existing) | `openMenu` (existing) |

These setters are the EXACT same ones the kebab items call today (`:2287`, `:2288`, `:2289`),
so every promoted action opens exactly the modal it opens today. No new state, no new
handlers, no `closeMenu()` call (these buttons never open the menu).

Replace the stale JSX comment at `:1785-1789` (which describes the Phase 23 pencil-to-kebab
collapse and claims "Three items") with a comment describing the new four-button header and
noting all four share the `showPencilButton` gate.

**C. Trim the kebab items array (`:2285-2290`) to the two survivors, preserving their
relative order:** first `New group conversation` calling `setNewConversationModalOpen(true)`,
then `Edit global skills...` calling `setSkillsEditorModalOpen(true)`. Delete the three
promoted entries. Leave the `.map(...)` render body, the button styling, the
`onMouseEnter` / `onMouseLeave` hover handlers, and the portal wrapper untouched.

**D. Update the "KEEP ORDER" comment at `:2279`.** It currently locks the five-item order
and cites the Phase 44 Pitfall 8 no-reshuffle guard. That guard exists to prevent
*accidental* reshuffling; we are *legitimately* restructuring, so update it to describe the
new reality rather than obeying it blindly. New comment must state: the kebab now holds two
items in locked order (New group conversation, then Edit global skills...); the other three
moved to dedicated header icon buttons (quick-260914-liu); the Phase 44 Pitfall 8
no-reshuffle guard still applies to the two survivors. Drop the now-obsolete Phase 90 D-07
and Phase 91 provenance sentences that only explained the removed entries.

Commit as `feat(pretty-conversations): promote New agent, Edit roles, Edit global files to header icons`.
  </action>
  <verify>
    <automated>
cd /home/ubuntu/fleet/identities/alpha/workspace/skynet-alpha
set -eu
F=src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
test "$(grep -c 'pv-header-new-agent-button' "$F")" = 1
test "$(grep -c 'pv-header-edit-roles-button' "$F")" = 1
test "$(grep -c 'pv-header-global-files-button' "$F")" = 1
test "$(grep -cE '(SquarePen|Drama|Globe) size=\{18\}' "$F")" = 3
test "$(grep -c 'className="pv-pencil"' "$F")" = 4
test "$(grep -cE '^[[:space:]]+\{ label: "' "$F")" = 2
test "$(grep -c 'label: "New agent"' "$F")" = 0
test "$(grep -c 'label: "Edit roles' "$F")" = 0
test "$(grep -c 'label: "Edit global files' "$F")" = 0
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const ids=["pv-header-new-agent-button","pv-header-edit-roles-button","pv-header-global-files-button","pv-header-menu-button"];const o=ids.map(t=>s.indexOf(t));if(o.some(i=>i<0))throw new Error("missing testid");for(let i=1;i<o.length;i++)if(o[i]<o[i-1])throw new Error("header button order wrong: "+o.join(","));console.log("ORDER-OK")' "$F"
echo GATE-OK
    </automated>
  </verify>
  <done>
All three promoted `data-testid`s exist exactly once, in source order New agent, Edit roles,
Edit global files, kebab (verified positionally by the node check). Exactly three icons are
rendered at `size={18}`. `className="pv-pencil"` appears exactly 4 times (three new buttons
plus the untouched kebab), proving no new CSS class was invented. The kebab items array
holds exactly 2 entries and none of the three promoted labels remain in it.
  </done>
</task>

<task type="auto">
  <name>Task 3: Repoint tests at the new header buttons, retire filter-popover-only coverage, run the green gate</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx, tests/e2e/golden-create-agent.spec.ts, tests/e2e/feature-sweep.spec.ts</files>
  <action>
**PREFLIGHT (once, first):** `node_modules/` is absent. Run `npm ci` from the repo root
with a 600000ms timeout before any test or typecheck command.

**Guiding rule:** where a test's intent was "user can reach action X", RE-POINT it at the new
promoted header button. Where a test's SOLE purpose was verifying Ready-filter popover
behavior (open / close / Escape / toggle semantics / popover chrome), DELETE it — that UI no
longer exists. Do NOT delete coverage wholesale.

---

**File 1: `PrettyConversationsPanel.test.tsx`**

(1a) DELETE the entire describe block
`"PrettyConversationsPanel: bounty-count filter popover (Phase 26)"` (`:2305-2358`,
between the `Test 23` / `Test 24` / `Test 30` bodies). All three tests exist solely to
verify filter-button `data-active`, dot presence, popover open-on-click, the Ready
menuitemcheckbox, and Escape-closes semantics. Remove the preceding section banner comment
(`:2301-2303`) with it.

(1b) DELETE the entire describe block
`"PrettyConversationsPanel: Phase 52 — filter popover restyle + Ready toggle"`
(`:4118-4365`) along with its section banner (`:4114-4116`). This covers P50-1 through P50-8,
its `afterEach`, and its local `setupTinaRow()` helper. Every one of these tests drives the
UI exclusively through `getByTestId("pv-filter-toggles")` and
`getByTestId("pv-filter-toggle-ready")`; with the popover gone there is no way to set
`readyOnly`, so the Ready predicate is unreachable from the DOM and the coverage is
untestable by construction. This is the "sole purpose was Ready-filter popover behavior"
case — deletion is correct.

**Do NOT delete the module-level mock scaffolding it shared.** `mockIsWorkingByKey` (`:356`),
`mockIsDormantByKey` (`:357`), `mockIsRecyclingByKey` (`:361`), `mockWorkingSnapshot`
(`:366`), `getSessionWorkingSnapshotSpy` (`:376`), and their `beforeEach` resets
(`:516-520`) are module-scoped and referenced by other suites in this file. They stay.
Only the block-local `afterEach` (`:4123-4129`) and `setupTinaRow` (`:4137-4148`) go, since
they live inside the deleted describe.

(1c) `Test 5` (`:1303-1354`, describe `"header menu opens NewSessionDialog"`) — REPOINT.
Its intent is "user can reach New agent and it opens the NewSessionDialog". Rewrite as a
one-step flow: assert `getByTestId("pv-header-new-agent-button")` exists, carries
`className` containing `pv-pencil`, has `aria-label="New agent"` and `title="New agent"`;
click it; then assert the `[role="dialog"]` portal mounts and its
`[data-slot="dialog-title"]` matches `/^\s*new agent\s*$/i` (that assertion is unchanged and
still valid). Drop the `getByRole("menu")` and menuitem steps — the action no longer routes
through the menu. Update the `it(...)` title and the stale Phase-23 preamble comment to
describe the new one-click flow and cite quick-260914-liu.

(1d) `Test 6` (`:1362-1372`, describe `"menu button gate"`) — EXTEND. It asserts the kebab
is absent when `onCreateSession` is undefined. Keep that assertion and add the same
null-check for all three new testids, since all four now share the single
`showPencilButton` guard. Update the `it(...)` title to say all four header buttons are
gated.

(1e) `Test 8` mobile-header assertion (`:1463-1468`) — the `pv-header-menu-button` +
`pv-pencil` class check still holds (kebab unchanged). **No change needed.** Optionally add
the three new testids to the same `pv-pencil` class-parity check; if you do, keep it a pure
addition.

(1f) `Test 4` in the NewConversationModal describe (`:5050-5074`) — REWRITE. It asserts the
five-item locked kebab order. The kebab now has two items. Rewrite to assert
`getAllByRole("menuitem")` yields exactly `["New group conversation", "Edit global skills…"]`
in that order (note: the ellipsis is the single-char `…`, matching the source label). Update
the `it(...)` title and the Phase 90 / Phase 91 preamble comment to describe the two-item
reality and cite quick-260914-liu. Tests 1, 2, 3, 5, 6 in that describe only use
"New group conversation" or the kebab gate — **leave them alone.**

---

**File 2: `PrettyConversationsPanel.new-role-button.test.tsx`**

(2a) `Test 21a` (`:182-211`) — REPOINT. Intent is "the Edit roles surface is reachable".
Replace the open-kebab-then-find-menuitem flow with an assertion that
`screen.getByTestId("pv-header-edit-roles-button")` exists with
`aria-label="Edit roles"` / `title="Edit roles"`. Replace the five-label
`expect(items).toEqual([...])` array with a kebab-contents assertion of exactly
`["New group conversation", "Edit global skills…"]`. Keep the spirit of the "old New role
entry is GONE" check by asserting no menuitem matches `/^new role$/i` AND no menuitem
matches `/edit roles/i` (Edit roles is now a header button, not a menu item).

(2b) `Test 21b` (`:213-225`) — EXTEND with the three new testids, same as (1d). All four
share one gate.

(2c) `Test 21c` (`:227-255`) — REPOINT. Replace open-kebab-then-click-menuitem with a single
`fireEvent.click(screen.getByTestId("pv-header-edit-roles-button"))`. The
`waitFor` block asserting the dialog's `textContent` matches `/^Roles/` is unchanged and
still the correct detection signal.

(2d) Update the file's header comment (`:1-7`) — it describes the "New role to Edit roles..."
menu-item rewrite. Add a line noting Edit roles has since been promoted out of the kebab into
a dedicated header button (quick-260914-liu).

---

**File 3: `PrettyConversationsPanel.role-management-flow.test.tsx`**

Four flows (`:346-351`, `:403-407`, `:467-471`, `:514-518`) all use the identical two-step
preamble: `fireEvent.click(screen.getByTestId("pv-header-menu-button"))`, then
`Array.from(menu.querySelectorAll('[role="menuitem"]')).find(b => b.textContent?.includes("Edit roles"))`,
then click that element. In ALL FOUR, replace the two-step preamble with a single
`fireEvent.click(screen.getByTestId("pv-header-edit-roles-button"))` and delete the
now-unused `menu` lookup and `find(...)` for that step. Everything downstream of "RolesListModal
is open" (row click, RoleModal open, Esc dismissal, the `+ New role` swap-not-stack
assertions, the identity-modal title-line jump) is UNCHANGED — do not touch it.

Update the file's flow-description comment at `:9` ("panel-header to three-dots to
'Edit roles...' to RolesListModal") to describe the new one-click entry point.

---

**File 4: `tests/e2e/golden-create-agent.spec.ts`** (Playwright — not run by the gate, but
keep it truthful)

Lines `:36-46`: replace the two-step "open kebab, then click the New agent menu item" with a
single click on `[data-testid="pv-header-new-agent-button"]`. Delete the now-dead
`kebab` locator at `:37-39` and the `newAgentItem` `getByText(/^new agent$/i)` at `:44-46`.
Fix the stale comment at `:41-43` that cites the old five-item KEEP ORDER list.

⚠️ Line `:58` uses `.filter({ hasNot: page.locator('[data-testid="pv-header-menu-button"]') })`
to exclude the kebab from the host-candidate list. The kebab still exists, so this line is
still correct — but the new header buttons are also `role="button"` candidates. Extend that
`hasNot` (or the host-candidate selector) so all four header testids are excluded, otherwise
the host-picker click can land on a header icon. Update the header comment at `:4` to
describe the new flow.

**File 5: `tests/e2e/feature-sweep.spec.ts`**

- `:80-90` — the "edit skills" step opens the kebab and finds a `/edit skills/i` menuitem.
  "Edit global skills..." REMAINS a kebab item, so this step still works. **No change.**
- `:91-99` — the "Edit global files" step opens the kebab and looks for a
  `/edit global files/i` menuitem, which is now a header button. Replace the kebab click
  plus menuitem lookup with a direct click on
  `[data-testid="pv-header-global-files-button"]`, preserving the surrounding
  `waitForTimeout` / `screenshot` / `Escape` scaffolding and the `isVisible().catch(() => false)`
  defensive guard shape.
- `:64-79` — inspect this step before editing; only change it if it targets one of the three
  promoted labels. If it targets "New group conversation" or "New role", leave it (the
  latter is pre-existing staleness outside our scope).

---

**GREEN GATE (run both; both must pass):**

1. `npx vitest run src/ui/features/pretty-conversations/` — SCOPED. Do NOT run the full
   suite; that is a deploy-time gate and we are not deploying.
2. `npx tsc --noEmit` — this change is frontend-only (no `src/backend/` files touched).

If either fails, fix and re-run. Do not proceed to commit with a red gate.

Commit as `test(pretty-conversations): repoint header-action coverage at promoted icon buttons`.
Commit the two Playwright edits in the same commit (they are the same logical change).
  </action>
  <verify>
    <automated>
cd /home/ubuntu/fleet/identities/alpha/workspace/skynet-alpha
set -eu
test -d node_modules
D=src/ui/features/pretty-conversations
test "$(grep -rc 'pv-filter' $D/PrettyConversationsPanel.test.tsx)" = 0
test "$(grep -rlc 'pv-filter' $D tests/e2e 2>/dev/null | wc -l)" = 0
test "$(grep -c 'pv-header-new-agent-button' $D/PrettyConversationsPanel.test.tsx)" -ge 1
test "$(grep -c 'pv-header-edit-roles-button' $D/PrettyConversationsPanel.new-role-button.test.tsx)" -ge 1
test "$(grep -c 'pv-header-edit-roles-button' $D/PrettyConversationsPanel.role-management-flow.test.tsx)" = 4
test "$(grep -c 'pv-header-menu-button' $D/PrettyConversationsPanel.role-management-flow.test.tsx)" = 0
test "$(grep -c 'pv-header-new-agent-button' tests/e2e/golden-create-agent.spec.ts)" -ge 1
test "$(grep -c 'pv-header-global-files-button' tests/e2e/feature-sweep.spec.ts)" -ge 1
grep -q 'mockWorkingSnapshot' $D/PrettyConversationsPanel.test.tsx
grep -q 'getSessionWorkingSnapshotSpy' $D/PrettyConversationsPanel.test.tsx
npx tsc --noEmit
npx vitest run src/ui/features/pretty-conversations/
echo GATE-OK
    </automated>
  </verify>
  <done>
`node_modules` is installed. Zero `pv-filter` references remain anywhere under
`src/ui/features/pretty-conversations/` or `tests/e2e/`. Each promoted header testid is
asserted in the test that owns its flow; all four role-management-flow preambles now click
the header button directly and none of them opens the kebab. Shared module-level mock
scaffolding (`mockWorkingSnapshot`, `getSessionWorkingSnapshotSpy`) survived the describe-block
deletions. `npx tsc --noEmit` exits clean and the scoped
`npx vitest run src/ui/features/pretty-conversations/` suite is fully green. Three atomic
commits exist on `feat/tab-title-from-tmux`; nothing has been pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | This change adds no input surface. Three buttons call three existing local `useState` setters with the literal `true`. No network calls, no user-supplied data, no serialization, no new props. The deleted popover removed one local-state toggle. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-liu-01 | Elevation of Privilege | The three promoted header buttons | accept | The buttons are gated on the exact same `showPencilButton` predicate (`typeof onCreateSession === "function"`) that gated the kebab items they replace, so reachability is unchanged. Authorization for the underlying actions lives in the modals and their backend routes, which are untouched. Task 1's gate pins `className="pv-pencil"` count at 4 and Tasks 1/2 gates pin the single shared guard; Tests 6 / 21b assert all four vanish together when `onCreateSession` is undefined. |
| T-liu-02 | Tampering | Concurrent edit to `src/ui/sidebar/NewSessionDialog.tsx` by peer agent `camelot` | mitigate | Hard scope boundary in this plan forbids touching that file. `NewSessionDialog.test.tsx` needs no change (its `pv-header-menu-button` reference still resolves — the kebab survives). `files_modified` frontmatter excludes both. |
| T-liu-03 | Denial of Service | Accidental deletion of `.pv-pencil` CSS while pruning the shared mobile-bump selector lists at `:1332-1342` | mitigate | Task 1's gate asserts exactly 4 surviving `.pv-panel-header .pv-pencil` selector occurrences. Losing the mobile bump would silently shrink all four header buttons below the 44px touch target on mobile — the gate catches it. |
| T-liu-04 | Tampering | Over-eager cleanup of the deliberate Ready-filter dead code | mitigate | Explicit `<deliberate_dead_code>` section with the user's verbatim decision. Task 1's gate pins `anyFilterOn` at exactly 3 occurrences and `readyOnly` at >= 4, so removal fails the gate. |
| T-liu-05 | Information Disclosure | Loss of test coverage for reachable actions | mitigate | Repoint-not-delete rule stated explicitly per test. Deletion is authorized ONLY for the two describe blocks whose subject UI no longer exists (Phase 26 filter popover, Phase 52 Ready toggle). Every "user can reach action X" test is re-pointed at the promoted button, and Task 3's gate asserts each promoted testid appears in the test that owns its flow. |
| T-liu-SC | Tampering | `npm ci` dependency install | accept | No new packages are added — `lucide-react@1.28.0` is already a pinned dependency in `package.json` and `package-lock.json`, and `SquarePen` / `Drama` / `Globe` are pre-existing exports of that version (verified against the resolved package). `npm ci` installs the existing lockfile verbatim with no resolution changes, so there is no new package to audit for legitimacy. |
</threat_model>

<verification>
1. `npx tsc --noEmit` exits 0.
2. `npx vitest run src/ui/features/pretty-conversations/` is fully green.
3. `grep -rn 'pv-filter' src tests` returns nothing.
4. `git log --oneline -3` shows exactly three new commits on `feat/tab-title-from-tmux`
   (refactor, feat, test) and `git status --short` is clean of source changes.
5. `git log origin/feat/tab-title-from-tmux..HEAD` is non-empty — confirming nothing was
   pushed.
6. No `.planning/` file is staged or committed by the executor.
</verification>

<success_criteria>
- Filter icon, its popover, its state, its lucide import, its `@/components/popover` imports,
  and all 23 `.pv-filter*` CSS references are gone.
- `.pv-pencil` CSS (base, hover, svg sizing, mobile 48px/24px bump) is intact.
- Header renders exactly four `pv-pencil` buttons in order: `pv-header-new-agent-button`,
  `pv-header-edit-roles-button`, `pv-header-global-files-button`, `pv-header-menu-button` —
  each with `aria-label` + `title` + `size={18}` icon.
- Kebab retains exactly two items in order: `New group conversation`, `Edit global skills…`.
- Every promoted action opens the same modal it opened as a kebab item (no behavior change).
- Ready-filter dead code retained exactly as specified in `<deliberate_dead_code>`.
- `src/ui/sidebar/NewSessionDialog.tsx` untouched.
- Scoped vitest green, `tsc --noEmit` clean, three atomic commits, NOTHING pushed.
</success_criteria>

<output>
Create `.planning/quick/260914-liu-conversation-list-header-chrome-drop-fil/260914-liu-SUMMARY.md`
when done. Do NOT commit it — the orchestrator handles the docs commit.
</output>
