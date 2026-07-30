---
phase: quick-260730-tuo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/AppShell.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
autonomous: true
requirements:
  - QUICK-260730-TUO
must_haves:
  truths:
    - "Desktop sidebar-open persistent chevron renders as an attached tab flush against the sidebar's right border (no 8px gap, no left border/rounding, matches sidebar bg)."
    - "Closed-state sidebar chevron + touch/mobile back affordance still render as the floating pill (rounded-lg + border + translucent bg) — visual unchanged."
    - "`.pv-panel-header` no longer receives 48px left-padding on desktop when sidebar is open (chevron is anchored right of the sidebar, not overlapping the title)."
    - "Desktop panel-header renders the Skynet brand lockup: 20×20 rounded logo (`/apple-touch-icon-192.png`, aria-hidden, alt=\"\") + literal text \"Skynet\", inline-flex row with 8px gap."
    - "Browser tab title reads \"Skynet\" on cold-load AND after the all-tabs-closed → dashboard-recreate path (both dashboard-tab label initializers hardcode \"Skynet\", document.title falls through to it)."
    - "`npm run build` EXIT 0, `npx tsc --noEmit` EXIT 0, full `npx vitest run` = 0 failures."
  artifacts:
    - path: "src/ui/AppShell.tsx"
      provides: "Two dashboard-tab label initializers hardcoding 'Skynet' (L178 + L1189-ish); prop condition flipped at L1382; chevron className+left updated for attached-tab treatment at L1506-1555."
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Brand-lockup `<span className='pv-title'>` at L546 (img + text 'Skynet', inline-flex with gap)."
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "Test 7 (desktop header title) updated to assert 'Skynet' brand-lockup structure (img + text) instead of literal 'Conversations'; Test 8 (mobile) also updated."
  key_links:
    - from: "src/ui/AppShell.tsx sidebarToggleOverlaps prop (L1382)"
      to: "src/ui/features/pretty-conversations/pretty-conversations.css .pv-panel-header[data-sidebar-toggle-overlaps='true']"
      via: "prop → data attribute → CSS padding-left"
      pattern: "sidebarToggleOverlaps=\\{isMobile && !isTouchDevice && sidebarOpen\\}"
    - from: "src/ui/AppShell.tsx document.title effect (L410)"
      to: "activeTab?.label fallback to 'Skynet'"
      via: "tmux || activeTab?.label || 'Skynet' — dashboard tabs now start with label='Skynet'"
      pattern: "label: \"Skynet\""
---

<objective>
Quick task 260730-tuo — ship four already-in-working-tree design polish changes as one atomic commit, plus update the two test files whose Conversations→Skynet copy assertions will break.

Purpose:
1. Close pinned bounty `sidebar-header-left-gap-after-collapse-button-moved` (parked 2026-07-30 in Ashley's tina identity). Root cause: patch #193 (commit `1e14cba`) moved the persistent sidebar-toggle chevron from viewport-left to `left: sidebarWidth + 8px` on desktop-open, but the 48px padding-left clearance in `.pv-panel-header` (patch #142 Fix 5) was still firing on desktop-open — reserving space for a chevron that had already moved elsewhere. Change #1 (prop flip) stops the clearance from firing when the chevron is not at viewport-left. Change #2 (attached-tab treatment) makes the chevron read as visually part of the sidebar so no gap even looks needed.
2. Ship the Skynet brand identity into the two surfaces where it belongs — sidebar-header (brand lockup with logo) and browser tab title (hardcoded string, not localizable).

Output:
- 3 files changed in one atomic commit landing all four visual changes + the two test updates.
- Verification green: build + tsc + full vitest suite.
- Ships as patch #214 (tina writes the skynet-patches.md entry post-commit).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Source files with the four changes already made (unstaged) — verify they match spec:
@src/ui/AppShell.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx

# Test files that need updates:
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx

# CSS that the sidebarToggleOverlaps prop drives (read-only context):
@src/ui/features/pretty-conversations/pretty-conversations.css

# Fleet-rule reminders:
@CLAUDE.md

## Pre-existing work already on disk (unstaged)

All four source changes are ALREADY MADE in the working tree by tina via docker cp fast-path
into the running skynet container and eyeballed live by Ashley. DO NOT reimplement.
DO NOT second-guess the design. The executor's job is:

1. Verify the four changes are present and match the spec (spot-check via `git diff`).
2. Update the two test-file assertions that will break due to the "Conversations" → "Skynet" copy change.
3. Run verification.
4. Stage + commit atomically.

### Change #1 — src/ui/AppShell.tsx L1382 (sidebarToggleOverlaps prop condition flip)

Diff already on disk:
- Before: `sidebarToggleOverlaps={!isMobile && !isTouchDevice && sidebarOpen}`
- After:  `sidebarToggleOverlaps={isMobile && !isTouchDevice && sidebarOpen}`

Why: patch #193 anchored the persistent chevron to `left: sidebarWidth + 8px` on desktop-open,
so the chevron no longer overlaps `.pv-panel-header` at the LEFT edge. The `[data-sidebar-toggle-overlaps='true']`
CSS rule (`padding-left: 48px`) was reserving clearance for a chevron that had already moved
elsewhere. Post-flip, the clearance only fires in the narrow-desktop Sheet mode where the chevron IS
still at viewport-left over the sheet panel (isMobile && !isTouchDevice → sheet mode).

### Change #2 — src/ui/AppShell.tsx L1506-1555 (attached-tab treatment for the chevron)

Two edits in the persistent sidebar-toggle chevron block:
- `left` drops the `+ 8` gap → sits at exactly `${sidebarEditing ? 560 : sidebarWidth}px`,
  flush against the sidebar's right border.
- `className` splits by state via inline ternary:
  * Attached-tab state (`!isTouchDevice && sidebarOpen`): `rounded-r-lg border-y border-r`
    (no left border/rounding) + `bg-[color:var(--color-pv-base)]` (matches sidebar bg so the
    sidebar's right border appears to extrude the button as a tab). Hover states preserved.
  * Closed-state + touch/mobile "back" affordance: keeps the previous floating-pill treatment
    (`rounded-lg border` + `bg-[rgba(220,225,245,0.06)]`).

Ashley's feedback: "chevron should look like part of the sidebar, not a floating mystery button."

### Change #3 — src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx L546 (brand lockup)

The `<span className="pv-title">{headerLabel}</span>` becomes a brand lockup:
- `<span className="pv-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>`
- `<img src="/apple-touch-icon-192.png" alt="" aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} />`
- Literal text `Skynet` (no i18n binding — brand mark is not localizable).

The `headerLabel` const at L494 (`t("nav.conversations.title", { defaultValue: "Conversations" })`)
is no longer referenced in the header render. Leaving it in place is HARMLESS; the executor
may leave it OR remove it if unused elsewhere (grep confirms it's not used elsewhere in this file).

Note on logo path: `/apple-touch-icon-192.png` is the CORRECT logo — the one the PWA manifest
+ browser tab already reference. Do NOT swap to `public/icon.svg` (that's dead fork-residue;
separate parked bounty covers purging it).

### Change #4 — src/ui/AppShell.tsx L178 + L1189 (dashboard tab label hardcoded to "Skynet")

Both dashboard-tab `label` initializers replace:
- Before: `label: t("nav.conversations.title", { defaultValue: "Conversations" }),`
- After:  `label: "Skynet",`

Sites: the initial `useState` at ~L175-182 AND the "re-create dashboard tab when all tabs closed"
path at ~L1183-1191. The `document.title` effect at L410 is `document.title = tmux || activeTab?.label || "Skynet"`
— by making both label initializers hardcode "Skynet", the browser tab title reads "Skynet" on cold-load
AND after the all-tabs-closed → dashboard-recreate path (previously showed "Conversations" via i18n).

## Test surface that WILL break

Two test files reference the old "Conversations" copy:

- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`** — Test 7
  (`describe("PrettyConversationsPanel: desktop header title", ...)` at L1148-1178) asserts
  `queryByText(/^conversations$/i)` and `expect(titleEl!.className).toContain("pv-title")`.
  Post-brand-lockup, the `<span className="pv-title">` no longer contains the literal text
  "Conversations" (contains "Skynet" and an `<img>`). Test needs to assert on the new structure:
  * `queryByText(/^skynet$/i)` truthy OR query `.pv-title` and assert it contains an `<img>` +
    text node "Skynet".
  * Preserve the existing `.pv-title` class assertion + the `.pv-panel-header` descendant assertion.
  * Preserve the `<img>` shape assertion (recommend: `expect(titleEl!.querySelector('img[aria-hidden="true"]'))
    .toBeTruthy()` and assert `src` ends with `apple-touch-icon-192.png`, `alt === ""`).

  Test 8 (`describe("PrettyConversationsPanel: mobile header title (patch #144)", ...)` at
  L1184+) has the same `queryByText(/^conversations$/i)` assertion — update mirror-symmetric
  to Test 7.

- **`src/ui/AppShell.persistence.test.tsx`** — grep shows the only "document.title" references
  are in COMMENTS (L45, L59) describing tests DEFERRED to Plan 06-05 UAT. There is NO actual
  document.title runtime assertion in this file, so NO code change is required. Leave the
  comments alone (they're accurate history).

## Fleet guardrails (STANDING)

- DO NOT PUSH, DO NOT DEPLOY, DO NOT touch `docker compose`. Deploy queue is HELD per Ashley's
  not-shipping-until-shape-lock rule (extends to patch #214 as one more entry in the batch).
- The changes are already visible in the running container via docker cp fast-path (no compose up,
  no deadman armed). Verification means "type-check + build + tests pass"; NOT "deploy."
- Fork bookkeeping (`~/.claude/identities/tina/skynet-patches.md` patch #214 entry, bounty archive
  under `~/.claude/identities/tina/bounties/`) LIVES OUTSIDE THIS REPO and is handled by tina
  post-commit — NOT the executor's job.
- Backend build NOT required (patch touches zero backend files — per patch #154 rule, frontend-only
  patches validated with `tsc --noEmit` + vitest + frontend `npm run build`).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify the four working-tree changes are present as specified, update the two test assertions in PrettyConversationsPanel.test.tsx (Tests 7 + 8), and remove the now-unused `headerLabel` const if grep confirms zero remaining references in the file.</name>
  <files>
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (const cleanup only, IFF grep confirms unused)
  </files>
  <action>
    Step 1 — Spot-check the four working-tree changes with `git diff` (do NOT edit):

    a. `git diff src/ui/AppShell.tsx` must show:
       - L178-ish: `label: t("nav.conversations.title", ...)` → `label: "Skynet",` (dashboard tab initial useState)
       - L1189-ish: same substitution in the re-create-dashboard path
       - L1382: `sidebarToggleOverlaps={!isMobile && !isTouchDevice && sidebarOpen}` → `sidebarToggleOverlaps={isMobile && !isTouchDevice && sidebarOpen}`
       - L1529-1541 (chevron className split): plain className string → inline ternary with `!isTouchDevice && sidebarOpen` branch (rounded-r-lg + border-y + border-r + bg-pv-base) vs else branch (rounded-lg + border + translucent bg)
       - L1541-ish `left`: `${(sidebarEditing ? 560 : sidebarWidth) + 8}px` → `${sidebarEditing ? 560 : sidebarWidth}px`

    b. `git diff src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` must show:
       - L543-ish: `<span className="pv-title">{headerLabel}</span>` → inline-flex span with img (apple-touch-icon-192.png, 20×20, aria-hidden, alt="") + literal "Skynet".

    If ANY of the four changes is missing or differs from spec, STOP and report. Do not
    silently re-apply — Ashley eyeballed the current diff live and greenlit it as-is.

    Step 2 — Update `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` Test 7
    (describe block "PrettyConversationsPanel: desktop header title" at ~L1151-1178):

    - Rename the `it()` description from `'Test 7: desktop variant renders "Conversations" title text ...'`
      to `'Test 7: desktop variant renders Skynet brand lockup (img + text) in .pv-title with .pv-panel-header treatment (quick-260730-tuo)'`.
    - Replace `queryByText(/^conversations$/i)` with `queryByText(/^skynet$/i)` for the title-text assertion.
    - After confirming `titleEl` truthy and has `.pv-title` class, add TWO new assertions on the
      brand-lockup structure:
      * `const brandImg = titleEl!.querySelector('img'); expect(brandImg).toBeTruthy();`
      * `expect(brandImg!.getAttribute('src')).toBe('/apple-touch-icon-192.png');`
      * `expect(brandImg!.getAttribute('alt')).toBe('');`
      * `expect(brandImg!.getAttribute('aria-hidden')).toBe('true');`
    - Preserve the existing `.pv-panel-header` descendant assertion at the tail — the header row
      class treatment did not change.
    - Update the block comment header (L1148-1149) from "Test 7 — Desktop header shows title
      \"Conversations\"" to "Test 7 — Desktop header shows Skynet brand lockup (img + text)"
      to match.

    Step 3 — Update the same file Test 8 (describe block "PrettyConversationsPanel: mobile header title
    (patch #144)" at ~L1184-...):

    - Rename the `it()` description mirror-symmetrically from `"Test 8 (spec change patch #144 f):
      mobile variant renders the Conversations title ..."` to `"Test 8 (spec change patch #144 f
      + quick-260730-tuo): mobile variant renders Skynet brand lockup (same shape as desktop)"`.
    - Replace `queryByText(/^conversations$/i)` with `queryByText(/^skynet$/i)`.
    - Add the same brand-lockup img assertions as Test 7 (src, alt, aria-hidden). The mobile
      variant renders the same `<span className="pv-title">` shape (patch #144 fix f made mobile
      + desktop render identical title treatment), so the lockup shape is identical.
    - Preserve the `.pv-title`-class assertion at the tail.

    Also skim Test 7 + Test 8 for any other reference to the literal string "Conversations" in
    assertions or comments; update to "Skynet" where it references the rendered copy (leave
    historical prose comments about "Phase 13" etc. alone).

    Do NOT touch Tests 1-6, Tests 9+ in this file — they exercise unrelated store/row/deactivate
    behavior and the diff greps show zero other "Conversations"-copy assertions there.

    Step 4 — Also grep the whole `src/` tree to catch any OTHER test that hardcodes the string
    "Conversations" as a UI assertion:
    `grep -rn '/\\^conversations\\$/i\\|queryByText.*Conversations\\|getByText.*Conversations' src/ 2>/dev/null`
    Expect: only the two Tests 7/8 hits in PrettyConversationsPanel.test.tsx (already handled).
    If additional hits surface, update them symmetric to the pattern above.

    Step 5 — Optional cleanup: check whether `headerLabel` (declared at
    `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:494`) is still referenced
    anywhere in that file:
    `grep -c 'headerLabel' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
    If the count is 1 (only the declaration line), DELETE the 3-line declaration
    (`const headerLabel = t("nav.conversations.title", { defaultValue: "Conversations" });`)
    to keep the file clean and avoid a dead-code snag for future maintainers. If the count is
    ≥2, LEAVE it — some other consumer still needs it.

    Do NOT touch any files outside the two listed in `<files>`. Do NOT edit backend, do NOT
    touch `~/.claude/identities/tina/**`, do NOT touch `docker/`, do NOT touch nginx configs
    (this patch is source-only, no route additions).
  </action>
  <verify>
    <automated>
    git diff --stat src/ui/AppShell.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | grep -E "AppShell|PrettyConversationsPanel" &&
    npx tsc --noEmit &&
    npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx &&
    grep -c 'Skynet' src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx | awk '$1 >= 4 { exit 0 } { exit 1 }' &&
    ! grep -Fn '/^conversations$/i' src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    </automated>
  </verify>
  <done>
    - `git diff` on the two source files still shows the four working-tree changes as specified
      (executor did not clobber them).
    - `PrettyConversationsPanel.test.tsx` Tests 7 + 8 now assert on the Skynet brand lockup
      (img[src=/apple-touch-icon-192.png, alt="", aria-hidden="true"] + text "Skynet") instead
      of the string "Conversations".
    - `npx tsc --noEmit` EXIT 0.
    - `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
      passes all tests (Tests 7 + 8 pass with new assertions; all other tests unchanged and passing).
    - The `.test.tsx` file contains ≥4 "Skynet" references (2 renamed it-descriptions + brand-img
      src assertions in Tests 7 + 8).
    - No `/^conversations$/i` regex assertions remain in the panel test file.
    - `headerLabel` const in `PrettyConversationsPanel.tsx` either deleted (if unused) or left
      in place (if still referenced) — executor's discretion per grep result.
  </done>
</task>

<task type="auto">
  <name>Task 2: Full verification pass (tsc + frontend build + full vitest suite), then stage all files and commit atomically with a descriptive message covering the four visual changes + the test updates.</name>
  <files>
    - (git stage + commit only; no source edits in this task)
  </files>
  <action>
    Step 1 — Full verification pass. Run these in order and confirm each is green before
    proceeding to Step 2:

    a. `npx tsc --noEmit` — EXIT 0 required. No new type errors from the brand-lockup img
       inline style, the chevron className ternary, or the test-file assertion updates.

    b. `npm run build` — EXIT 0 required. Frontend build validates Vite can serve
       `/apple-touch-icon-192.png` (already in `public/`; grep-confirmed present in
       working-tree spot-check). Should complete in ~5s.

    c. `npx vitest run` — full frontend suite. Expected: matches or exceeds the baseline
       from patch #213 (76 files / 861 passed / 6 skipped / 0 failed). Two files change:
       PrettyConversationsPanel.test.tsx (Tests 7 + 8 updated — still same test count) and
       zero net vitest count change (no tests added or removed). If any test failure
       surfaces that is NOT in the two files we touched, spot-check whether it's a
       pre-existing unrelated failure (per STATE.md L173-L182 recent history, some
       ComposeBox.voice.test.tsx failures were noted then resolved by patch #211 —
       verify none re-surface). Grep-gate the log for `FAIL|failed|✗` per the L508
       learned preference (don't trust summary lines alone).

    d. Backend build NOT required (patch touches zero backend files).

    Step 2 — Scope check via `git diff --name-only`:
    Expected file list (exactly 3):
       - src/ui/AppShell.tsx
       - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
       - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    If additional files surface (backend/, identity dirs, docker configs), STOP and report.

    Step 3 — Stage the three files with explicit paths (NEVER `git add -A` or `git add .`
    per Standing Directive):
    `git add src/ui/AppShell.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`

    Step 4 — Commit atomically with a HEREDOC message on the current `feat/tab-title-from-tmux`
    branch. Message shape (this is a fork-authored quick, follow the file's `feat(quick-XXX):`
    convention observed across the last 20 commits):

    ```
    git commit -m "$(cat <<'EOF'
    feat(quick-260730-tuo): sidebar-header Skynet brand lockup + attached-tab chevron + document.title=Skynet

    Four coordinated visual polish changes shipping as one atomic patch (#214),
    closing pinned bounty sidebar-header-left-gap-after-collapse-button-moved.

    1. AppShell.tsx L1382: sidebarToggleOverlaps prop flipped
       from (!isMobile && !isTouchDevice && sidebarOpen)
       to   (isMobile && !isTouchDevice && sidebarOpen)
       — patch #193 moved the persistent chevron to left: sidebarWidth+8px on
       desktop-open, so the 48px .pv-panel-header padding-left clearance was
       reserving space for a chevron that had already moved. Post-flip the
       clearance only fires in narrow-desktop Sheet mode where the chevron IS
       still at viewport-left.

    2. AppShell.tsx L1506-1555: persistent chevron gets an attached-tab
       treatment when !isTouchDevice && sidebarOpen — left drops the +8 gap
       so the chevron sits flush against the sidebar's right border, and the
       className switches to rounded-r-lg + border-y + border-r + bg-pv-base
       (matches sidebar bg so the sidebar's right border extrudes the button
       as a tab). Closed-state + touch/mobile back affordance keeps the prior
       floating-pill treatment. Ashley: "chevron should look like part of the
       sidebar, not a floating mystery button."

    3. PrettyConversationsPanel.tsx L546: <span className='pv-title'> becomes
       a brand lockup — inline-flex row with 20×20 rounded /apple-touch-icon-192.png
       (aria-hidden, alt='') + literal 'Skynet' text. Retires the
       nav.conversations.title i18n binding for the panel header (brand mark
       is not localizable).

    4. AppShell.tsx L178 + L1189: both dashboard-tab label initializers
       hardcode 'Skynet' in place of t('nav.conversations.title', ...) —
       document.title (L410) falls through to activeTab?.label || 'Skynet',
       so the browser tab now reads 'Skynet' on cold-load AND after the
       all-tabs-closed → dashboard-recreate path.

    Test updates:
    - PrettyConversationsPanel.test.tsx Tests 7 + 8 flipped from asserting
      /^conversations$/i to /^skynet$/i, plus new assertions on the brand-img
      shape (src=/apple-touch-icon-192.png, alt='', aria-hidden='true').

    Verification: npx tsc --noEmit EXIT 0; npm run build EXIT 0; npx vitest
    run full suite green.

    Closes pinned bounty ~/.claude/identities/tina/bounties/sidebar-header-left-gap-after-collapse-button-moved/
    (Tina archives + writes skynet-patches.md #214 post-commit).

    NO push, NO docker build, NO deploy — stopped at commit boundary per
    fleet rule (Ashley 2026-07-27).
    EOF
    )"
    ```

    Step 5 — Confirm the commit landed cleanly:
    `git status` should show a clean working tree (the .planning/quick/260727-s8g-* untracked
    dir may still exist — that's from a different task; ignore).
    `git log --oneline -1` should show the new feat(quick-260730-tuo): ... commit.

    DO NOT push. DO NOT docker build. DO NOT docker compose. Stop at the commit boundary.

    Post-commit follow-up (docs commit) is a separate scope — leave for the /gsd-quick
    workflow's SUMMARY.md + STATE.md row generation step to handle. Executor's job ends here.
  </action>
  <verify>
    <automated>
    npx tsc --noEmit &&
    npm run build &&
    npx vitest run 2>&1 | tee /tmp/vitest-260730-tuo.log &&
    ! grep -E '^\s*(FAIL|✗)' /tmp/vitest-260730-tuo.log &&
    git log --oneline -1 | grep -q "quick-260730-tuo" &&
    git status --porcelain | grep -Ev "^\?\?" | wc -l | grep -q "^0$"
    </automated>
  </verify>
  <done>
    - `npx tsc --noEmit` EXIT 0.
    - `npm run build` EXIT 0 (frontend build succeeds; Vite serves /apple-touch-icon-192.png).
    - `npx vitest run` reports 0 failed tests (grep-gate on FAIL/✗ empty per L508 learned
      preference; summary matches or exceeds patch #213 baseline of 861 passed).
    - `git diff --name-only HEAD~1 HEAD` shows exactly 3 files: AppShell.tsx,
      PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx. No backend/, no
      identity dirs, no docker/.
    - Latest commit message starts with `feat(quick-260730-tuo):` and describes all four
      changes + the test updates.
    - `git status` shows no unstaged tracked-file changes (untracked planning dirs from
      other tasks are OK — those are not part of this quick).
    - NO push, NO docker build, NO deploy performed.
  </done>
</task>

</tasks>

<verification>
Phase-level checks (both tasks combined):

1. `git diff HEAD~1 HEAD --stat` shows exactly 3 files: 2 source + 1 test.
2. `git log --oneline -1` shows the atomic `feat(quick-260730-tuo):` commit.
3. `npx tsc --noEmit` EXIT 0.
4. `npm run build` EXIT 0.
5. `npx vitest run` full frontend suite = 0 failed (grep-gate on FAIL|failed|✗ empty).
6. Fleet guardrails observed:
   - No `git push` performed.
   - No `docker compose` invoked.
   - No `docker build` invoked.
   - No edits under `src/backend/`.
   - No edits under `~/.claude/identities/tina/**`.
7. Post-commit branch: still `feat/tab-title-from-tmux`; deploy queue extends to #198→#214,
   still HELD per shape-lock rule.
</verification>

<success_criteria>
Measurable completion:

- [x] Four working-tree changes verified present as spec'd (git diff spot-check green).
- [x] `PrettyConversationsPanel.test.tsx` Tests 7 + 8 updated to assert Skynet brand lockup
      (img shape + "Skynet" text) instead of "Conversations".
- [x] Optional `headerLabel` const cleanup applied IFF grep confirms zero remaining refs.
- [x] `npx tsc --noEmit` EXIT 0.
- [x] `npm run build` EXIT 0.
- [x] Full `npx vitest run` = 0 failed.
- [x] Single atomic commit `feat(quick-260730-tuo): ...` on branch `feat/tab-title-from-tmux`
      touching exactly 3 files.
- [x] NO push, NO docker build, NO deploy.
</success_criteria>

<output>
Post-execution deliverables (handled by the /gsd-quick workflow, NOT the executor):
- `.planning/quick/260730-tuo-sidebar-header-brand-lockup-attached-tab/260730-tuo-SUMMARY.md`
- New row in `.planning/STATE.md` "Quick Tasks Completed" table matching the format used by
  patch #213 (`260730-sjf`) and the surrounding rows.
- Docs commit landing PLAN + SUMMARY + STATE row.

Post-executor bookkeeping (handled by tina identity holder, NOT this workflow):
- Add patch #214 entry to `~/.claude/identities/tina/skynet-patches.md`.
- Archive `~/.claude/identities/tina/bounties/sidebar-header-left-gap-after-collapse-button-moved/`
  to `bounties/archive/`.
</output>
