---
phase: quick-260729-gsv-pinned-rows-show-host-instead-of-title
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
autonomous: true
requirements:
  - QUICK-260729-GSV
must_haves:
  truths:
    - "Pinned conversation rows render `identity.title ?? identity.displayName` as their sublabel (no Server-icon + hostname) when an identity resolves for the row's tmux session."
    - "Pinned rows with no resolvable identity still render the Server icon + `row.host.name` sublabel (safety-net fallback, unchanged from previous behavior)."
    - "Active-set and RDP render sites remain untouched — they still omit `subtitleMode` and render the default `hostname` mode."
    - "The grouped block continues to render `identity.title ?? identity.displayName` (no regression from patch #149 behavior)."
    - "Frontend typecheck (`npx tsc --noEmit`) passes."
    - "Frontend Vite build (`npm run build`) succeeds."
    - "Vitest suite `src/ui/features/pretty-conversations/` remains green (baseline 67 → 68 with the new assertion)."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Pinned render site passes `subtitleMode=\"identityTitle\"`"
      contains: 'subtitleMode="identityTitle"'
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "Updated JSDoc/inline comments no longer list `pinned` in the render-sites-that-omit-subtitleMode enumeration"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "New regression test asserting pinned rows render identity title (not hostname) when identity resolves"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      via: "PrettyConversationRowLive forwards subtitleMode prop"
      pattern: 'subtitleMode="identityTitle"'
---

<objective>
Patch #184 (quick-260729-gsv): flip pinned conversation rows in the pretty-conversations panel to render `identity.title ?? identity.displayName` as their sublabel — matching the grouped block — instead of the default `Server icon + row.host.name`.

The rendering machinery already exists inside `PrettyConversationRow.tsx` (patch #149 / f9v): passing `subtitleMode="identityTitle"` swaps the sublabel branch, and the null-identity fallback path is retained as the safety net. This patch is a single-line prop addition at the pinned render site plus a two-line doc-comment correction plus one regression test.

Purpose: Ashley's pinned tier should visually match the grouped tier's identity-first treatment. The Server icon + hostname sublabel duplicates information already available elsewhere in her UI — the pin glyph itself already signals the row is pinned, and the identity title/displayName carries the meaningful per-session context.

Output: One commit on `feat/tab-title-from-tmux` bumping patch count to 184, with the three-file diff (panel prop wiring + row JSDoc correction + panel regression test).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire `subtitleMode="identityTitle"` at the pinned render site, correct the row-file JSDoc, and add a regression test</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    - New Vitest case (append to the existing panel test file): seed `mockIdentitiesByKey` with an entry keyed by the pinned row's `sessionMatchKey(row.targetTmuxSession)` (lowercased tmux session name per the file's session-hue mock at lines 42-45) whose value carries `identityKey`, `title: "Tina's Laptop"`, and `displayName: "tina@laptop"` fields. Render the panel with exactly one pinned row (`pinned: [makeConversationRow({ id: "pinned-1", label: "…", targetTmuxSession: "tina-session", host: hostA })]`, `pinnedIds: new Set(["pinned-1"])`, empty `activeSet`/`grouped`). Assertions:
        1. The pinned row's `.pv-host` sublabel contains the text `"Tina's Laptop"`.
        2. The pinned row's `.pv-host` sublabel does NOT contain the hostname (`hostA`) — confirming the swap.
        3. Query the pinned row scope for `.pv-avatar` or the row container, then assert NO `<svg>` descendant of `.pv-host` (Server icon is dropped in identityTitle path). Simplest form: `expect(pinnedRow.querySelector('.pv-host svg')).toBeFalsy()`.
       Scope every DOM query to the `[data-pinned-group="true"]` wrapper so the assertions are unambiguous (there is no active-set or grouped row in the fixture, but scoping keeps the test future-proof).
    - The mock identity value type in the test file is currently declared as `Map<string, { identityKey: string }>` (test file line 50). Widen the local mock map's value type to include optional `title?: string | null` and `displayName?: string | null` fields (both nullable — mirrors real identity shape). Use a structurally compatible cast `as unknown as Map<string, { identityKey: string }>` only if the compiler complains; preferred fix is to broaden the `let mockIdentitiesByKey` type declaration to `Map<string, { identityKey: string; title?: string | null; displayName?: string | null }>`. Existing tests use only `identityKey` so they remain source-compatible.
    - Follow the existing test-block conventions: place the new `describe`/`it` block near the existing subtitle/identity-related tests (after Test 28 at end of file is fine; or near the grouped-block identityTitle territory if such a test already exists). Name it `Test 29: pinned rows render identity title when identity resolves (patch #184 / quick-260729-gsv)` (bumping the running test number).
  </behavior>
  <action>
    Three surgical edits + one new test. Do NOT touch active-set, RDP, or grouped render sites. Do NOT modify styles, palette, layout, or any adjacent logic. Do NOT introduce a per-host divider chip in the pinned group (side effect ACCEPTED — see plan header).

    Edit 1 — `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`, pinned render site (currently around lines 644-664 inside `<div className="pv-panel-group" data-pinned-group="true">` → `displayedPinned.map((row) => <PrettyConversationRowLive … />)`):
      - Add the prop `subtitleMode="identityTitle"` to the `<PrettyConversationRowLive>` call, alongside the existing props (`inActiveSet`, `sessionKey`, etc.). Place it on its own line for diff clarity, mirroring the grouped site's formatting at the current line 765.
      - Do NOT modify any other prop, the surrounding `<div>` wrapper, or the sibling comment block at lines 634-643. The `PrettyConversationRowLive` wrapper already declares and forwards `subtitleMode` verbatim (see `PrettyConversationsPanel.tsx` lines 108-111 and 116-121), so no wrapper changes are needed.

    Edit 2 — `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`, JSDoc/inline comment on the `subtitleMode` prop (currently around lines 137-138):
      - Change the line reading `// Only passed by the panel at the non-RDP grouped render site. Active-` and its continuation `// set, pinned, and RDP render sites omit the prop → default "hostname".` to accurately reflect the new reality after this patch. Rewrite as:
          `// Passed by the panel at the non-RDP grouped render site AND the pinned`
          `// render site (patch #184 / quick-260729-gsv). Active-set and RDP render`
          `// sites omit the prop → default "hostname".`
      - Also review the render-block comment around lines 429-445 (the `/* Body: label + host secondary line. quick-260727-f9v: … */` block): the fallback-chain prose remains correct (paths 1/2/3 are unchanged behaviorally), so leave that block untouched UNLESS its enumeration explicitly says "pinned rows omit subtitleMode" or similar — in that case, edit the same way (drop `pinned` from the omit list). A quick `grep -n "pinned" src/ui/features/pretty-conversations/PrettyConversationRow.tsx` will surface any other stale mention; correct only mentions that describe which render sites omit the prop. Do NOT rewrite unrelated prose.

    Edit 3 — `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`, append the new regression test per `<behavior>` above. Broaden `mockIdentitiesByKey`'s value type declaration to include optional `title` and `displayName` fields. Seed the mock in the test body (do NOT mutate the top-level default — beforeEach resets it), render the panel, and assert per behavior spec. Follow existing test style — use `render(...)` from `@testing-library/react`, scope queries via `container.querySelector('[data-pinned-group="true"] [data-conversation-id="pinned-1"]')`, use `toContain` / `toBeTruthy` / `toBeFalsy` matchers to match the file's existing idiom.

    Do NOT run `npm run build:backend` (patch touches zero backend files — per tina's rule the backend build is unnecessary).

    Do NOT commit `PLAN.md`, `SUMMARY.md`, or `STATE.md` — the orchestrator handles those artifacts.

    Commit: before crafting the message, run `git log --oneline -10` to confirm the recent style, then produce a single commit matching the fork's numbered-patch idiom (see e.g. `patch: co-render MicButton beside Send button in textarea (drop text/attachments gates)` — subject-only, no scope prefix). Suggested subject: `patch: pinned rows render identity title (drop Server+hostname sublabel) (#184)`. Reference patch #184 in the subject or body. Stage exactly the three modified src files.

    Do NOT push, do NOT run `docker compose`, do NOT touch nginx configs. Stop after `git commit`.
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-conversations/ &amp;&amp; npx tsc --noEmit &amp;&amp; npm run build</automated>
  </verify>
  <done>
    - `PrettyConversationsPanel.tsx` pinned render site now passes `subtitleMode="identityTitle"` (grep confirms: `grep -n 'subtitleMode="identityTitle"' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns two hits — one at the grouped site (existing) and one at the pinned site (new)).
    - `PrettyConversationRow.tsx` JSDoc comment no longer lists `pinned` in the "render sites that omit subtitleMode" enumeration (grep confirms: `grep -n 'pinned' src/ui/features/pretty-conversations/PrettyConversationRow.tsx | grep -i "omit\|default \"hostname\""` returns zero matches).
    - `PrettyConversationsPanel.test.tsx` contains one new `it(...)` block referencing patch #184 / quick-260729-gsv that asserts pinned rows render identity title text and NOT hostname when identity resolves. Vitest reports the panel folder at 68 passing (was 67).
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
    - Exactly one new git commit on `feat/tab-title-from-tmux` staging only the three modified src files; commit subject references patch #184.
    - No changes to active-set, RDP, or grouped render sites; no changes to styles/palette/layout; no touched backend files.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run src/ui/features/pretty-conversations/` — full panel test folder green (68 pass; baseline 67 + 1 new regression test for patch #184).
- `npx tsc --noEmit` — frontend TypeScript compilation clean; no new errors introduced by the widened `mockIdentitiesByKey` value type.
- `npm run build` — Vite production build succeeds; the canonicalizing build catches any prod-only bundle issues the dev pipeline might miss.
- Manual grep sanity checks documented in the task `<done>` block (two hits of `subtitleMode="identityTitle"` in the panel; zero stale "pinned omits subtitleMode" mentions in the row file).
- `git log --oneline -1` on `feat/tab-title-from-tmux` shows the new commit referencing patch #184.
</verification>

<success_criteria>
Pinned rows visually match the grouped block's sublabel treatment: they render `identity.title ?? identity.displayName` when identity resolves, and cleanly fall back to Server + hostname when it doesn't. The full pretty-conversations vitest folder + `tsc --noEmit` + `npm run build` all pass. Strict scope maintained: only the three files listed in `files_modified` were touched, and no adjacent behaviors regressed. A single patch-#184 commit lands on `feat/tab-title-from-tmux`, ready for Ashley's deploy greenlight.
</success_criteria>

<output>
Do NOT create a SUMMARY.md or update STATE.md — the orchestrator handles those docs artifacts.
</output>
