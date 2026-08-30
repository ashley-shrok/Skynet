# Patch #140 — Skynet transformation: conversation list lift-from-mock (final Ship-of-Theseus slice) — Phase 13

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** Only after Ashley greenlights the batched Phase 11 + Phase 12 + Phase 13 Ship-of-Theseus movement deploy AND UAT passes on the 26 non-negotiable items in `13-UAT-CHECKLIST.md`. Post-deadman-retirement flow per current `~/.claude/identities/tina/deploy-runbook.md` (the 15-min deadman regime was retired 2026-07-21).
**Batch context:** Patch #140 is the FINAL Phase-13-cluster patch (patch #138 = Phase 11 first slice; #139 = Phase 12 second slice; #140 = this Phase 13 final slice). Per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23), it does NOT ship standalone. Batches with patches #138 + #139 into a single grouped-semantic-unit deploy ("the Ship-of-Theseus movement complete") — the whole three-phase Skynet SHAPE transformation lands in ONE Ashley-verified deploy window.

Explicit contract line for the fork-catalog integrity gate: **patch #140 batches with patches #138 + #139 as the Ship-of-Theseus movement completion.** No Co-Authored-By trailer per fork convention (also called out at the top of this file).
**Ordinal position on paste:** Update the count line near the top of `skynet-patches.md`. Current baseline is "ONE HUNDRED THIRTY-SEVEN numbered patches" (patches #138 + #139 not yet pinned). Bump to "ONE HUNDRED FORTY" — pin patches #138 (Phase 11) + #139 (Phase 12) + #140 (Phase 13) together at the batch-deploy moment as the Ship-of-Theseus movement completion. If patches #138 + #139 were pinned earlier as an interstitial bump, bump from whatever the current count is to "ONE HUNDRED FORTY".
**No Co-Authored-By trailer** — fork convention (per 260723-bbt quick task pattern and Phase 10 + Phase 11 + Phase 12 patches-md-entry precedents).

---

## Draft (paste-ready — matches the multi-commit-under-one-pin convention from patches #104, #105, #128, #138, and #139)

   140. `feat(pretty-conversations,app-shell): patch #140 — Skynet transformation:
        conversation list lift-from-mock (final Ship-of-Theseus slice) (Phase 13
        — conversation-list row rewrite + panel-header lift + PinAction bare-icon-
        with-hue-glow + AppShell chevron rebase; all lifted verbatim from LOCKED
        mock v4; presentation-only, backend untouched)`
        (committed 2026-07-23 to `feat/tab-title-from-tmux`; deploy batched
        with patches #138 (Phase 11 first slice) + #139 (Phase 12 second slice)
        per Ashley 2026-07-23 fleet-standing "batch patches into meaningful
        deploys" rule; not deployed standalone unless Ashley explicitly
        greenlights; the three-patch batch tells the "we deleted the Skynet
        client surfaces AND lifted the remaining conversation-list surface
        verbatim from the mock" story = the Ship-of-Theseus movement complete).

        * **Motivating gap** (Ashley's direct call-outs, this-session 2026-07-23):
          Ashley kept saying "get away from this skynet front end stuff" through
          Phases 11 + 12 while stripping the dead surfaces. Phase 13 is the
          LAST slice — the surface Ashley kept calling out as "still looks
          Skynet" after Phases 11 + 12 shipped. Verbatim quotes this session:
          - "The bar at the top that says like conversations or something that
            to me looks like it's coming out of old Skynet stuff" — the
            PrettyConversationsPanel's `.panel-header` with the 13px mixed-case
            chunky title + filled-glass pencil pill (rewritten to UPPERCASE +
            0.1em tracking + transparent pencil per mock v4).
          - "Active conversations like ones that I've already loaded into
            since I loaded the page are not glowing fully like they were
            supposed to. It seems like they more get like a glowing border or
            something." — ambient recession was too aggressive (0.16 alpha bg
            was nearly invisible; only the faint border showed) OR the
            `inActiveSet` flag wasn't propagating. Fixed by lifting the mock's
            Reduced-intensity ambient values verbatim into `.pv-row.ambient`
            AND by preserving activeSet propagation through the row rewrite.
          - "The pin buttons are totally obnoxious" — retire the button chrome
            (rounded-md, `bg-transparent hover:bg-white/[0.06]`, Skynet
            muted-gray icon color) and lift the mock's bare-icon-with-hue-
            drop-shadow, hidden when not pinned.
          - "The bar at the top that says the name of the session still looks
            Skynet" — the AppShell top-left persistent sidebar-toggle chevron
            (rebased from opaque-glass filled pill to `--color-pv-*`
            transparent bare-icon, matching the panel-header pencil aesthetic).
          The LOCKED mock v4 at `~/.claude/identities/tina/bounties/skynet-
          transformation/prototype.html` (Ashley signed off 2026-07-23 07:20Z,
          Full-intensity + Normal density + active-set/ambient recession +
          ONE dot with ONE meaning) is the source of truth this patch lifts
          verbatim.

        * **Fix summary — row lift-from-mock** (SHAPE-01). Rewrote
          `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`
          (709 → 425 lines, **-284 lines net**, -40%). Retired: all
          JS-computed CSSProperties for base body / avatar / ambient / selected
          / hover overlays (`useState(hovered)` + onMouseEnter/onMouseLeave
          machine gone); Tailwind layout scaffolding (`flex-1 min-w-0 flex
          flex-col gap-0.5`, `shrink-0 flex items-center gap-1.5`, `rounded-
          full`, `w-12 h-12` / `w-10 h-10`, `px-4 py-3` / `px-3 py-2.5`,
          `gap-3` / `gap-2.5` on the row/avatar/body/meta divs); Skynet theme
          classes (`bg-background`, `bg-card`, `text-foreground`, `border-
          border`, `text-muted-foreground/60`, `hover:text-foreground`).
          Kept: identity resolution, `isAmbient = !isRdp && !inActiveSet`
          derivation (now feeds a class toggle instead of a style-object
          branch), mobile swipe state machine (byte-preserved — Ashley's
          iPhone swipe-reveal affordance UNCHANGED), ready-dot conditional
          render (`{inActiveSet && isWorking === false && <span
          className="pv-ready-dot" style={{display: "block"}} />}`), avatar
          image src selection, click / keyboard / touch handlers, PinAction
          wiring, `--pv-hue` custom-property emission for hue-bearing rows.
          Class-toggle contract emitted: `pv-row` base + state variants
          `selected`, `active-set`, `working`, `pinned`, `ambient`, `rdp` +
          density variants `pv-row--mobile` (72px min-height, 48px avatar) /
          `pv-row--desktop` (62px min-height, 40px avatar).

        * **Fix summary — CSS foundation** (SHAPE-01). Created
          `src/ui/features/pretty-conversations/pretty-conversations.css`
          (472 lines in Plan 01; grew to 533 in Plan 03 via SHAPE-03
          augmentation). Lifted verbatim from prototype.html mock v4 lines
          219-449 (verified line-by-line hsla / border / shadow value
          alignment). Selectors declared: `.pv-panel`, `.pv-panel-header`
          (14px 16px padding + hairline `border-bottom: 1px solid --color-pv-
          border-quiet` + `display: flex; justify-content: space-between`),
          `.pv-panel-scroll`, `.pv-panel-header .pv-title` (12px + 700 +
          0.1em letter-spacing + UPPERCASE + `--color-pv-fg`),
          `.pv-panel-header .pv-pencil` (32x32 + transparent bg + transparent
          border + 8px radius + `--color-pv-fg-muted` icon +
          `rgba(220,225,245,0.06)` hover), `.pv-panel-header .pv-pencil svg`
          (18x18); `.pv-row` base full-bubble treatment (160deg `hsla(hue,
          50%, 38%, 0.55)` → `hsla(hue, 45%, 24%, 0.60)` gradient, 0.32 hue
          border, multi-stop shadow with warm inset rim + hue trace + hue
          outer glow at 32px, `backdrop-filter: blur(20px) saturate(1.5)`,
          `translateY(-1px)` on hover, `translateY(-1px)` + 0.55 border +
          1px hue ring on `.selected`); `.pv-avatar` (40x40 hue-gradient
          badge with 0.40 hue border + warm inset + hue outer glow);
          `.pv-body`, `.pv-body .pv-label` (14px semibold cream +
          text-shadow), `.pv-body .pv-host` (12px muted warm-cream);
          `.pv-meta`, `.pv-meta .pv-pin`, `.pv-row:not(.pinned) .pv-meta
          .pv-pin { display: none }`; `.pv-ready-dot` (steady, hue-cream fill
          + hue outer glow, `display: none` default) + `.pv-row.active-set:
          not(.working) .pv-ready-dot { display: block }` gate; `.pv-row.
          ambient` (flat `hsla(hue, 40%, 20%, 0.16)` background, 0.14 alpha
          border, minimal inset + hairline shadow, no backdrop-filter,
          muted foreground — the mock's Reduced-intensity ambient values
          Ashley called out as needing to be lifted); `.pv-row.rdp` (neutral
          60,65,80/30,33,44 glass treatment; EXEMPT from ambient);
          `.pv-rdp-divider` (muted uppercase 10px label with flanking
          gradient rules); density variants `.pv-row--mobile` +
          `.pv-row--desktop`; hover-reveal `.pv-row.pv-row--desktop:not
          (.pinned):not(:hover) .pv-meta [data-testid="pin-action"] {
          opacity: 0 }` (later superseded by the SHAPE-03 class-based
          `display: none` rule for defense-in-depth). Every hue-driven
          hsla() uses `var(--pv-hue)` custom property (30 hits in the CSS
          file; Wave 4 diagnostic pass confirmed CSS specificity resolves
          correctly — inline `style="display: block"` on the dot span always
          wins).

        * **Fix summary — panel header lift** (SHAPE-02). Rewrote
          `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
          header block (429 → 426 lines). `<div className="pv-panel-header
          shrink-0">` + `<span className="pv-title">` + `<button className=
          "pv-pencil">`. Scroll region + empty state + NewSessionDialog
          wiring preserved byte-for-byte (no touch of lines 275-410 area
          equivalent). Inner `<div className='flex items-center gap-1'>`
          wrapper around the pencil unwrapped — plan's discretion note ("only
          one right-side control exists"); gear was retired in patch #133,
          pencil is the sole right-side control. Retired: `text-[13px] font-
          semibold` title typography, `w-[34px] h-[34px] rounded-full bg-
          white/[0.04]` pencil pill chrome. Kept `shrink-0` alongside the
          new `pv-panel-header` class (defends against parent-flex shrinking;
          unchanged from pre-Phase-13). Test-file updates: Test 5 asserts
          `.pv-pencil` class on the pencil button; Test 7 asserts `.pv-title`
          on title + `.pv-panel-header` on the header row container; Test 8
          asserts mobile-variant treatment. 11 other tests untouched.

        * **Fix summary — AppShell chevron rebase** (SHAPE-04). Rebased
          `src/ui/AppShell.tsx` top-left persistent sidebar-toggle chevron
          block (STRICTLY within L1407-1479; `git diff --stat` reports 15
          insertions + 4 deletions all within that range). className string
          rebased from `bg-[rgba(20,22,28,0.85)] backdrop-blur-[10px]
          backdrop-saturate-150 border border-white/[0.08] shadow-[0_2px_8px_
          rgba(0,0,0,0.35)] text-muted-foreground hover:text-foreground`
          (Skynet filled-glass pill treatment) to `bg-transparent border
          border-transparent text-[color:var(--color-pv-fg-muted)] hover:bg-
          [rgba(220,225,245,0.06)] hover:border-[color:var(--color-pv-
          border-quiet)] hover:text-[color:var(--color-pv-fg)]` (mock's
          transparent bare-icon-with-rounded-md aesthetic). Kept `fixed flex
          items-center justify-center w-8 h-8 rounded-lg transition-colors
          cursor-pointer` (positioning + 32x32 + 8px radius + transitions +
          affordance). Inline `style` block for safe-area top/left + zIndex
          30 unchanged. `<span>` rotate transform + `<ChevronLeft className=
          "size-4" />` icon unchanged. JSDoc comment updated to describe
          the SHAPE-04 rebase in semantic terms (avoiding exact retired-
          class-string mentions that would trip post-condition grep gates).
          Nothing outside the chevron block modified in AppShell.tsx (Section
          G.1 scope-fence held).

        * **Fix summary — PinAction lift** (SHAPE-03). Rewrote
          `src/ui/features/pretty-conversations/PinAction.tsx` (124 → 113
          lines). Desktop branch: `<button className="pv-pin-action-desktop">`
          — bare button, no wrapper chrome. CSS class handles all visual
          definition. `pretty-conversations.css` augmented (472 → 533 lines,
          +61 lines) with `.pv-pin-action-desktop` selector block: base 20x20
          inline-flex, transparent bg, border 0, hue-cream fill `hsla(var(--
          pv-hue, 216), 80%, 70%, 0.95)`, drop-shadow `hsla(var(--pv-hue,
          216), 80%, 60%, 0.55)` — verbatim from prototype.html mock v4 lines
          333-337. Icon size handled in CSS: `.pv-pin-action-desktop svg {
          width: 14px; height: 14px; stroke-width: 2 }` (replaces retired
          `w-3.5 h-3.5` Tailwind classes). `:hover` glow boost to
          `drop-shadow(0 0 6px hsla(var(--pv-hue, 216), 80%, 60%, 0.75))` +
          `:focus-visible` 2px hue-tinted outline (a11y additions — the
          retired button chrome had `hover:bg-white/[0.06]` as the only
          affordance signal; the new bare-icon needs its own hover + focus
          signals for keyboard-nav accessibility). Hide-on-unpinned-non-
          hovered-non-focused rule: `.pv-row.pv-row--desktop:not(.pinned):
          not(:hover):not(:focus-within) .pv-pin-action-desktop { display:
          none }` — mock's `.row:not(.pinned) .meta .pin { display: none }`
          invariant lifted verbatim, with `:focus-within` added for keyboard-
          nav pinning. RDP defensive override: `.pv-row.rdp .pv-pin-action-
          desktop { color: var(--color-pv-fg-muted); filter: none }` (RDP
          rows never render PinAction per Row contract, but the override
          costs nothing and preempts a future-refactor bug class).
          `var(--pv-hue, 216)` CSS fallback (216 = neutral blue) preferred
          over JS `hue == null` branch — one CSS line vs a JS state branch;
          matches how `.pv-row { --pv-hue: 216 }` already declares its own
          fallback. **Mobile branch (`size='mobile'`) preserved BYTE-FOR-BYTE
          in code** — only comments annotated with "UNCHANGED by Phase 13
          Plan 03". The 48x48 hue-tinted disc treatment is identical to
          pre-Phase-13; Ashley's iPhone swipe-reveal affordance is
          uncompromised.

        * **Fix summary — final Skynet theme-class purge** (SHAPE-03 deep).
          Purged the last 2 Skynet theme-class hits in the conversation-list
          subtree (PinAction.tsx pre-plan lines 97-101 had `text-muted-
          foreground/60`, `hover:text-foreground`). Full-subtree grep for
          `text-muted-foreground|hover:text-foreground|bg-background|bg-card|
          text-foreground|border-border|muted-foreground` in `src/ui/features/
          pretty-conversations/` now returns **0 non-comment code hits** (1
          raw hit is a `//` line-comment historical annotation in PinAction.
          tsx documenting the retired treatment; Phase 10 Wave 4 + Phase 12
          tip comment-only policy). **The subtree is 100% palette-tokenized
          / class-toggle-driven.** No more Skynet theme classes in the
          conversation-list surface — the last vestiges of the Skynet look
          are gone.

        * **Fix summary — post-lift diagnostic pass** (SHAPE-05 preparation).
          Plan 04 authored `13-04-UAT-DIAG-LOG.md` (951 lines) with static-
          analysis pre-UAT verdicts for the 4 diagnostic candidates
          (Candidate A Terminal.tsx isIdle null-start = SUSPECT; Candidate
          B sessionWorkingKey mismatch = MISMATCH DETECTED for fresh-terminal
          path; Candidates C activeSet sessionStorage + D PrettyConversationRow
          Live Rules-of-Hooks = PASS) + Ashley's UAT observation template
          (Sections 2A-2G) + exhaustive route-back matrix (Sections 3A-3F
          enumerating every UAT-outcome → follow-up-work → owner). No source
          edits during Plan 04 — Terminal.tsx and AppShell.tsx were READ-ONLY
          diagnostics; the concrete failure hypotheses surfaced (Candidate
          B.1 fresh-terminal path key mismatch; AppShell.tsx:1400 missing
          paddingBottom for safe-area) are documented as route-backs for
          follow-up plans (13-06 or master-bounty patches per Section 3).
          SHAPE-05 closure requires Ashley's live UAT — deferred to her post-
          deploy walkthrough per `13-UAT-CHECKLIST.md` items 6 + 15.

        * **Preserved verbatim** (SHAPE-06 lockout — the LOAD-BEARING scope
          fence). `src/ui/features/pretty-view/**` UNCHANGED (bubbles,
          ComposeBox, IdentityBadge, message rendering, chat-column
          background). `src/ui/components/**` UNCHANGED (shadcn primitives —
          input, skeleton, sidebar, card, sheet, sonner, password-input,
          command, tabs, alert-dialog, switch, etc.; they still serve RDP/SSH
          dialogs and xterm.js chrome). `src/ui/ssh/**` UNCHANGED
          (OPKSSHDialog, SSHAuthDialog, TmuxSessionPicker, WarpgateDialog,
          ConnectionLog). `src/ui/features/terminal/**` UNCHANGED (xterm.js
          chrome). Verified: `git diff --stat f1c77fd..HEAD -- src/ui/
          features/pretty-view/ src/ui/components/ src/ui/ssh/ src/ui/
          features/terminal/ | wc -l` returns 0. Ship-of-Theseus rule
          preserves them for upstream Skynet rebase-ability. Backend routes
          untouched — Phase 13 is UI-only, no server changes; backend-cleanup
          for now-orphaned routes was deferred forever per Ashley 2026-07-23
          mid-purge discussion (kept for rebase-ability, zero user impact) —
          the phase-13-backend-routes-cleanup phase is dead. `git log
          --name-only f1c77fd..HEAD | grep "^src/backend/" | wc -l` = 0. RDP
          preservation carried forward from Phase 11 + Phase 12: `case "rdp"`
          in tabUtils.tsx = 2, repo-wide `case "rdp"` = 6, `onRdpRowClick`
          in AppShell.tsx = 1 — all identical to Phase 12 tip baseline.

        * **Bundle-size headline — Ship-of-Theseus purge landed in bytes,
          final wave.** AppShell chunk delta vs Phase 12 tip: **−6.18 kB /
          −8.32%** (raw) / **−1.53 kB / −7.57%** (gzip). The AppShell shrink
          comes from the 284-line net strip in `PrettyConversationRow.tsx`
          — JS-computed inline CSSProperties for base body + avatar + ambient
          + selected + hover overlays retired in favor of class-toggle
          emission; the mobile-branch hovered state machine retired. Some
          strip moves into the CSS chunk (pretty-conversations.css added
          ~600 lines / ~15 kB uncompressed pre-Rolldown; index-*.css chunk
          grew slightly), but Vite's CSS minifier compresses CSS harder than
          JS so net across-chunks delta is negative (raw AppShell shrink
          exceeds CSS chunk grow). **Cumulative Phase 11 + Phase 12 + Phase
          13 delta vs Phase 10 tip:**
          - AppShell chunk: 448.82 kB → 68.06 kB = **−380.76 kB / −84.8%**
          - AppShell gzip: 87.63 kB → 18.68 kB = **−68.95 kB / −78.7%**
          The three-patch batch (#138 + #139 + #140) tells the full Ship-of-
          Theseus movement story in bytes: Phase 11 shrank AppShell by 373 kB
          (imports stripped → panels became unreachable async chunks); Phase
          12 removed the unreachable async chunks entirely (files deleted →
          async chunks gone from Rolldown output); Phase 13 shed the last
          ~6 kB from AppShell as the row's inline styles collapsed into a
          real CSS file that lifts the mock verbatim.

        * **Scope fence held.** Zero touches to `src/backend/**`, docker/
          caddy/nginx config, the encrypted-SQLite schema, guacd/RDP/VNC
          render paths, terminal renderer (xterm.js), pretty-view internals
          (ChatMessage, ComposeBox, WipBubble, PlanPendingBubble,
          HarnessTasksPanel, IdentityBadge), message-queue drawer,
          identity-store, session-hue, conversation-store,
          session-working-store logic, or shadcn/SSH dialog surfaces. Only
          9 files under `src/` modified in the whole phase (verified by
          `git diff --name-only f1c77fd..HEAD -- 'src/**'`):
          `src/main.tsx`, `src/ui/AppShell.tsx`, `src/ui/features/pretty-
          conversations/{PinAction,PrettyConversationRow,PrettyConversationRow
          .test,PrettyConversationsPanel,PrettyConversationsPanel.test,
          pretty-conversations.css,tokens}.{tsx,ts,css}`. Phase 13's
          boundary: conversation-list row rewrite + panel header rewrite +
          PinAction bare-icon lift + AppShell chevron rebase + tokens.ts
          prune. Nothing else.

        * **New test coverage** (net 0 tests over Phase 12 baseline). Phase
          13 rewrote 2 test files at the assertion level (className presence
          checks replacing inline-hsla-style probes — the JSDOM-reliable
          signal for class-toggle-driven visibility per Plan 01 T-13-01
          mitigation, since CSS pseudo-selectors don't run in jsdom). Full-
          suite total unchanged: 524/526 passing (byte-identical Phase 11 +
          Phase 12 baseline; 2 pre-existing ComposeBox failures inherited
          from patches #121 + #124). Per-file:
          - `PrettyConversationRow.test.tsx`: 15 → 20 tests (added 7b + 18b
            splits + 3 net-new class-based tests where pre-Phase-13 versions
            probed styles instead)
          - `PrettyConversationsPanel.test.tsx`: 14 tests (unchanged — 3
            tests updated for the mock's new markup, 11 untouched)

        * **Data-store contract UNCHANGED.** `conversation-store.ts` +
          `conversation-store.test.ts` untouched. `identities-store.ts`,
          `session-hue.ts`, `session-working-store.ts` untouched.
          `tabUtils.tsx` untouched — Phase 13 does not modify any tab-
          content routing; only the row/panel/pin/chevron surfaces the
          conversation-list panel emits.

        * **Files touched** (all on `feat/tab-title-from-tmux`):
          - **Created**:
            - `src/ui/features/pretty-conversations/pretty-conversations.css`
              (533 LOC — 472 lines from Plan 01 + 61 lines from Plan 03
              SHAPE-03 augmentation)
          - **Modified**:
            - `src/main.tsx` (+1 line — CSS import wire, Plan 01 Task 1)
            - `src/ui/AppShell.tsx` (chevron block only, +15 insertions / -4
              deletions, strictly within L1407-1479, Plan 02 Task 2)
            - `src/ui/features/pretty-conversations/PinAction.tsx` (124 →
              113 lines, desktop branch rewrite + mobile branch preserved
              byte-for-byte, Plan 03 Task 1)
            - `src/ui/features/pretty-conversations/PrettyConversationRow.
              test.tsx` (rewrite — assertions migrated from inline-hsla-style
              probes to className presence checks; 15 → 20 tests, all green;
              Plan 01 Task 2)
            - `src/ui/features/pretty-conversations/PrettyConversationRow.
              tsx` (709 → 425 lines, -284; row rewrite with class-toggle
              state variants; Plan 01 Task 2)
            - `src/ui/features/pretty-conversations/PrettyConversationsPanel.
              test.tsx` (713 → 748 lines; 3 header tests updated — Test 5,
              7, 8; 11 other tests untouched; Plan 02 Task 1b)
            - `src/ui/features/pretty-conversations/PrettyConversationsPanel.
              tsx` (429 → 426 lines; header block rewrite; Plan 02 Task 1a)
            - `src/ui/features/pretty-conversations/tokens.ts` (retired
              `PC_ROW_MIN_H_MOBILE` + `PC_ROW_MIN_H_DESKTOP`, -11 lines;
              preserved `PC_SWIPE_REVEAL`, `PC_SWIPE_THRESHOLD`,
              `PC_SWIPE_ANGLE_TOLERANCE`; Plan 01 Task 2)
          - **Deleted**: none

        * **Verification** (per `.planning/phases/13-skynet-transformation-
          conversation-list-lift-from-mock/13-BUILD-VERIFY-LOG.md`):
          `npx tsc --noEmit` exits clean (zero errors). `npx vitest run`
          reports **524 / 526 passing** — byte-identical Phase 12 baseline.
          The 2 failures are the same pre-existing test-fixture drift in
          `ComposeBox.test.tsx` inherited from patch #121 (Send-button
          removal, stale `getByLabelText(/send 'yes'/i)` anchors) + patch
          #124 (ThumbsUp aria-label rename) — documented at `.planning/
          phases/10-.../deferred-items.md`, out of Phase 13 scope per SHAPE-06
          lockout (`src/ui/features/pretty-view/` is explicitly off-limits).
          Zero net-new Phase 13 regressions. `npm run build` succeeds in
          8.87s; AppShell bundle delta vs Phase 12 tip is **−6.18 kB /
          −8.32%** (raw) / **−1.53 kB / −7.57%** (gzip). Cumulative Phase
          11 + Phase 12 + Phase 13 vs Phase 10 tip: AppShell **−380.76 kB
          / −84.8%** (raw), gzip **−68.95 kB / −78.7%**.

        * **Grep-hygiene gates** (21 total, all PASS per 13-BUILD-VERIFY-
          LOG.md § Section 4):
          - **SHAPE-01 gates (4):** `pretty-conversations.css` exists;
            `^\.pv-row` selector count = 27 (target ≥ 5); `pv-row` in
            PrettyConversationRow.tsx = 15 (target ≥ 3); row line count =
            425 (target 350-550).
          - **SHAPE-02 gates (2):** `pv-panel-header|pv-title|pv-pencil`
            count in PrettyConversationsPanel.tsx = 5 (target ≥ 3); retired
            `w-[34px] h-[34px] rounded-full` + `text-[13px] font-semibold`
            non-comment hits = 0.
          - **SHAPE-03 gates (3):** `pv-pin-action-desktop` in PinAction.tsx
            = 4 (target ≥ 1); `pv-pin-action-desktop` in pretty-conversations.
            css = 6 (target ≥ 1); **SHAPE-03 deep gate** (full-subtree
            Skynet theme-class purge) = 0 non-comment code lines under
            improved awk-based filter (1 raw hit is a `//` line-comment
            historical annotation in PinAction.tsx documenting the retired
            treatment; Phase 10 Wave 4 policy: acceptable).
          - **SHAPE-04 gates (3):** chevron block extracted (53 lines);
            `--color-pv|pv-pencil` in chevron block = 4 (target ≥ 1); retired
            filled-glass classes non-comment hits in chevron block = 0.
          - **SHAPE-06 scope-boundary gates (4):** `git diff --stat
            f1c77fd..HEAD` on `src/ui/features/pretty-view/`, `src/ui/
            components/`, `src/ui/ssh/`, `src/ui/features/terminal/` all
            return 0 lines each — the four locked directories are byte-
            preserved from Phase 12 tip through Phase 13 tip.
          - **SHAPE-07 gates (3):** tsc + vitest + npm run build all PASS
            (see Verification above).
          - **Baseline preservation gates carried from Phase 11 + Phase 12
            (4):** `case "rdp"` in tabUtils.tsx = 2; repo-wide `case "rdp"`
            = 6; `onRdpRowClick` in AppShell.tsx = 1; backend touches during
            Phase 13 = 0 files.

        * **Design source-of-truth** (LOCKED, no re-litigation per CONTEXT.md):
          - `~/.claude/identities/tina/bounties/skynet-transformation/`
            — the **MASTER** bounty for the entire Ship-of-Theseus movement.
            Ashley's UAT sign-off on this patch closes it. **NO SIBLING
            BOUNTIES were created for Phase 13 progress or closeout** — per
            CONTEXT.md § meta-lesson (Ashley 2026-07-23 verbatim: "I
            fragmented the Ship-of-Theseus movement into sibling bounties
            instead of tracking it all inside the master bounty"). This
            session merged all prior fragment bounties into the master
            (archived under `~/.claude/identities/tina/bounties/archive/`);
            only the master `skynet-transformation` is referenced going
            forward. Phase 13 progress + closeout updates go IN the master
            bounty's timeline+todos, NOT in any sibling.
          - `~/.claude/identities/tina/bounties/skynet-transformation/
            prototype.html` — LOCKED mock v4 (Ashley signed off 2026-07-23
            07:20Z). Full-intensity + Normal density + active-set/ambient
            recession + ONE dot with ONE meaning is what ships. Every
            selector, gradient, shadow, hsla stop, and alpha value in
            `pretty-conversations.css` lifted verbatim from prototype.html
            lines 219-449. Only the class-name prefix (`.row` → `.pv-row`,
            etc.) and the hue custom-property name (`--hue` → `--pv-hue`)
            were transformed; every numeric value preserved.
          - `.planning/phases/13-skynet-transformation-conversation-list-
            lift-from-mock/13-CONTEXT.md` — the phase boundary + scope-fence
            + LOCKED implementation decisions.
          - `~/.claude/identities/tina/tina.md` § "Skynet direction — the
            app IS Telegram" — the two-surfaces rule (pretty-view chat
            surface = DONE and LOCKED; conversation list + shell chrome =
            final unfinished piece, now completed by this patch). The "one
            bounty for the entire movement" rule (all Ship-of-Theseus work
            folds into `skynet-transformation` master bounty; no siblings).
          - `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)
            — the AUTHORITATIVE current deploy source (the fork CLAUDE.md's
            15-min deadman reference is STALE, retired 2026-07-21, separate
            `claude-md-15min-deadman-stale` bounty tracks the update).
          - `.planning/phases/11-.../11-PATCHES-MD-ENTRY.md` — patch #138
            precedent this draft mirrors.
          - `.planning/phases/12-.../12-PATCHES-MD-ENTRY.md` — patch #139
            precedent this draft mirrors.

        * **Rebase risk**: MEDIUM — the row treatment is entirely fork-
          native now (the mock lifted verbatim into pretty-conversations.
          css and the row emits fork-specific class names). When we next
          rebase against upstream `main`, upstream Skynet's conversation-
          list surface (which never had this look and never will) may add
          new interactions in the same file region; conflicts resolve to
          "keep fork's class-toggle contract + evaluate any upstream new
          interactions for whether they preserve the mock v4 SHAPE
          (accept) or introduce Skynet regression (reject)." The AppShell
          chevron block edit (L1407-1479) is a targeted delta that will
          likely conflict if upstream reworks the same region; resolution
          is mechanical (accept the palette-token rebase). The PinAction
          rewrite is fork-native; upstream doesn't have PinAction at all
          (fleet-list features are all fork additions). No hard upstream
          conflicts expected. Grep for `text-muted-foreground`, `bg-white/
          [0.06]`, `w-[34px] h-[34px] rounded-full` in any post-rebase
          conversation-list surface source tree to sanity-check that no
          Skynet theme-class regression survived the merge.

        * **Commits** (all on `feat/tab-title-from-tmux`, in order landed):
          - **Plan 01 (Wave 1 — row + CSS foundation)**: 4 commits
            - `e7eb080` `feat(13-01): lift mock CSS into pretty-conversations.
              css + wire import`
            - `aabd216` `feat(13-01): rewrite PrettyConversationRow with
              class-toggle state variants` (source + tests combined per
              plan's Task-2 executor discretion)
            - `9994062` `refactor(13-01): retire unused row-min-height
              layout tokens`
            - `a4d5d10` `docs(13-01): summary — conversation-list row lift-
              from-mock complete`
          - **Plan 02 (Wave 2 — panel header + AppShell chevron)**: 4 commits
            - `d165e02` `feat(13-02): rewrite PrettyConversationsPanel
              header to mock's class-toggle treatment`
            - `7cfee26` `test(13-02): update PrettyConversationsPanel header
              tests to assert pv-panel-header/pv-title/pv-pencil`
            - `cfc92c0` `feat(13-02): rebase AppShell sidebar-toggle
              chevron to --color-pv-* palette + mock pencil treatment`
            - `42ac07c` `docs(13-02): summary — panel header + AppShell
              chevron lift-from-mock complete`
          - **Plan 03 (Wave 3 — PinAction)**: 2 commits
            - `c2e48de` `feat(13-03): rewrite PinAction desktop to mock's
              bare-icon-with-hue-glow` (source + CSS augmentation combined
              per plan's Task-1 executor discretion)
            - `1f854dd` `docs(13-03): summary — PinAction bare-icon-with-
              hue-glow lift-from-mock complete`
          - **Plan 04 (Wave 4 — pre-UAT diagnostic pass)**: 2 commits
            - `843942e` `docs(13-04): pre-UAT diagnostic sweep + UAT
              template + route-back matrix`
            - `ee4de1e` `docs(13-04): summary — pre-UAT diagnostic pass
              complete; blocked on Ashley live UAT`
          - **Plan 05 (Wave 5 — docs closeout)**: 2 commits (this draft +
            summary)
            - `[Plan-05 docs SHA — fill in after commit]` — combined
              `docs(13-05): build-verify log + UAT checklist + patch #140
              draft`
            - `[Plan-05 summary SHA — fill in after commit]` —
              `docs(13-05): summary — Ship-of-Theseus movement complete
              pending Ashley UAT and deploy greenlight`

          Total: 14 commits for Phase 13 fork sequence (8 code commits +
          4 SUMMARY docs + 2 Plan 05 docs). Cumulative Phase 11 + Phase 12
          + Phase 13 commit count: ~42 across the three phases.

        * **Deploy status**. Code-complete on `feat/tab-title-from-tmux`
          at `[Plan-05 tip SHA — fill in after commit]`. NOT YET pushed,
          NOT YET deployed, image NOT YET built. Batched with patches #138
          (Phase 11 first slice) + #139 (Phase 12 second slice) into the
          "Ship-of-Theseus movement complete" deploy per Ashley 2026-07-23
          fleet-standing "batch patches into meaningful deploys" rule.
          Deploy sequence documented at `.planning/phases/13-skynet-
          transformation-conversation-list-lift-from-mock/13-UAT-CHECKLIST.md`
          under "Post-UAT deploy runbook" (authoritative source cited:
          `~/.claude/identities/tina/deploy-runbook.md`, NOT the fork
          CLAUDE.md's stale 15-min deadman reference which is retired
          fleet-wide since 2026-07-21).

        * **Master bounty closeout note**. Ashley's UAT sign-off on this
          patch (via `13-UAT-CHECKLIST.md`) is what triggers the closure
          of `~/.claude/identities/tina/bounties/skynet-transformation/`
          — the master bounty for the entire Ship-of-Theseus movement.
          The three-slice narrative:
          - Phase 11 (patch #138): landing swap + AppRail retirement +
            SettingsRow retirement + rail-view state-machine strip
          - Phase 12 (patch #139): 30 sidebar panel files + 17 dashboard/
            files + shell/Tab.tsx deleted + PURGE-09 writer+reader atomic
            retirement + dead locale-key strip
          - Phase 13 (patch #140, THIS): conversation-list row rewritten
            to mock's flat CSS class-toggle contract + panel header lifted
            to mock's UPPERCASE + transparent-pencil treatment + PinAction
            lifted to bare-icon-with-hue-drop-shadow + AppShell chevron
            rebased to `--color-pv-*` palette; the LOCKED mock v4 lifted
            verbatim onto the conversation-list surface
          Ashley's next set of Skynet bounties will be NEW-FEATURE work
          (pretty-view enhancements, message-queue improvements,
          translation asides, tool-use bubble upgrades) — not further
          Ship-of-Theseus purge. The Skynet SHAPE (Telegram-mobile-app-of-
          Skynet) is done.

---

## Fill-in placeholders (before pasting)

Before pasting into skynet-patches.md, replace the following (obtain from
`git rev-parse --short HEAD` immediately after the Plan 05 docs commits):

- `[Plan-05 docs SHA — fill in after commit]` — from
  `git rev-parse --short HEAD` right after the combined `docs(13-05):
  build-verify log + UAT checklist + patch #140 draft` commit lands.
- `[Plan-05 summary SHA — fill in after commit]` — from
  `git rev-parse --short HEAD` right after the `docs(13-05): summary`
  commit lands.
- `[Plan-05 tip SHA — fill in after commit]` — same as the summary SHA
  (Plan 05 tip is the second Plan-05 docs commit).

The bundle-size delta values (−6.18 kB / −8.32% raw AppShell; cumulative
Phase 11 + Phase 12 + Phase 13 = −380.76 kB / −84.8% on AppShell), vitest
counts (524/526), and grep-gate results are all resolved from
`13-BUILD-VERIFY-LOG.md` and do not need further substitution.

## Post-paste bookkeeping

After pasting into skynet-patches.md:

1. **Update the count line** near the top of the file. Current baseline
   is "ONE HUNDRED THIRTY-SEVEN numbered patches". Recommended: pin
   patches #138 + #139 + #140 together at the batch-deploy moment as the
   Ship-of-Theseus movement completion — bump from "ONE HUNDRED THIRTY-
   SEVEN" to "ONE HUNDRED FORTY". If patches #138 + #139 were pinned
   earlier as an interstitial bump (unlikely given the batching rule),
   adjust accordingly. Verify current count first with `grep "numbered
   patches" ~/.claude/identities/tina/skynet-patches.md | head -3`.
2. **Commit the pin.** Recommended combined pin (matches the natural
   batching unit): `docs(patches): pin patches #138 + #139 + #140 —
   Skynet transformation Ship-of-Theseus movement complete`. Solo pin
   variant if the batch was already partially pinned: `docs(patches):
   pin patch #140 — Skynet transformation final slice (conversation-
   list lift-from-mock)`.
3. **Close `/close skynet-transformation`** master bounty at
   `~/.claude/identities/tina/bounties/skynet-transformation/`. This is
   the LOAD-BEARING closeout for the entire Ship-of-Theseus movement —
   the whole three-slice narrative (Phases 11 + 12 + 13) is complete;
   Ashley UAT-verified; deploy landed; the Skynet SHAPE (Telegram-mobile-
   app-of-Skynet) is done. No SIBLING bounty exists to close (per the
   meta-lesson pinned in CONTEXT.md); the master IS the bounty.
4. **Update `~/.claude/identities/tina/tina.md`** compact overview if
   warranted. The "Skynet direction — the app IS Telegram" section
   should be updated to reflect the movement completion — remove the
   "final unfinished piece" framing on the conversation-list surface;
   mark the two-surfaces rule as fully-locked. If Ashley's next bounties
   are pretty-view feature additions (message-queue rendering, tool-use
   rendering, translation asides), tina.md's box-map may want to reflect
   the Skynet frontend as "shape-complete-and-Ashley-loves-it" for future-
   me's mental-model anchoring.
