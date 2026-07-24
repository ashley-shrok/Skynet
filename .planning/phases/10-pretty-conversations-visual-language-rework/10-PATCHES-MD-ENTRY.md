# Patch #128 — Pretty-Conversations visual-language rework (Phase 10)

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** After Ashley greenlights the batched #123-#128 deploy AND UAT passes on the 19 non-negotiable items. Post-deadman-retirement flow per current `deploy-runbook.md` (the 15-min deadman regime was retired 2026-07-21).
**Batch context:** Stacks on the pending #123-#127 stack (paperclip decouple, ThumbsUp "yes"→"let's go" rename, Skynet rebrand + PWA install, PWA safe-area polish, plus whatever #127 landed as). Single build/deploy per current fork discipline.
**Ordinal position on paste:** Update the "ONE HUNDRED TWENTY-SEVEN numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED TWENTY-EIGHT".

---

## Draft (paste-ready — matches the multi-commit-under-one-pin convention from patches #104 and #105)

   128. `feat(sidebar): patch #128 — pretty-conversations visual-language
        rework (Phase 10, presentation-only follow-up to Phase 6/7)`
        (committed 2026-07-22 to `feat/tab-title-from-tmux`; deploy
        batched with #123-#127 pending Ashley greenlight).

        * **Motivating gap** (three-part, all Ashley-called):
          (a) The Phase 6/7 ConversationsPanel + ConversationRow felt
          like a Skynet retrofit — dense rows, small tap targets, no
          identity presence — not mobile-native and out of step with
          pretty-view's visual language. Rows read as generic terminal-
          list entries rather than "conversations with an identity."
          (b) The mobile tap-bug on existing/pinned rows (Phase 7 UAT
          regression, F3-diag couldn't converge without mobile
          devtools) was formally inherited-and-abandoned — the
          redesign IS the fix (fresh component tree, new touch
          handlers, generous tap targets). Patch #111e F3-diag
          console-log telemetry retired in the same cutover.
          (c) At Ashley's typical desktop window width (~600-800px)
          the collapsed-sidebar's thin clickable strip disappeared
          entirely, making the sidebar unreachable without resizing
          the window. A persistent top-left toggle survives at ALL
          window widths and fixes this.

        * **Fix summary**. Replaced the shadcn-derived ConversationsPanel
          + ConversationRow + NewSessionButton with a clean-slate
          `src/ui/features/pretty-conversations/` component tree
          (mirrors Phase 4's `src/ui/features/pretty-view/` pattern).
          Chunky Telegram-style rows (72px mobile / 62px desktop
          min-height) with a 48/40px identity-hue avatar disc
          (radial-gradient with a `hsla(colorHue, 65%, 55%, 0.45)`
          hue-ring, matches prototype.html design source-of-truth),
          primary label = session name = identity name (Ashley
          convention, so no separate IdentityBadge chip on rows),
          secondary line = Server-glyph + host name. Selected-row
          treatment mirrors ChatMessage.tsx assistant-bubble class
          strings VERBATIM (`hsla(hue,50%,38%,0.30)` →
          `hsla(hue,45%,24%,0.35)` gradient + hue-border + inset+outer
          glow) adapted for row geometry with reduced alpha per
          prototype.html lines 231-239 (background dilution vs. bubble
          focal treatment) — inline hsla per Ashley's naming rule (no
          new CSS vars unless a value is reused 3+ times). Flat list,
          no "Pinned" section header, no per-host semibold section
          headers (pin glyph on row IS the marker). Sentinel HostGroup
          (id `__rdp__`) still renders at the bottom with a subtle
          "Remote desktop" divider chip + Monitor-glyph avatars, no
          hue, no pin (T-Test-34 preserved). Empty state uses a
          PlanPendingBubble-style idle glass card centered in the
          scroll region.

        * **Mobile pin mechanism**. Swipe-left on a row past 40px
          reveals a hue-tinted 48x48 pin/unpin action strip. Vertical-
          swipe angle tolerance ~12° yields to native scroll (touch
          handlers never `preventDefault()`). Only one row can be
          swiped-open at a time via the panel-level `currentlySwipedId`
          state driving each row's `forceClosed` prop. RDP rows skip
          the touch listener entirely via early-return on
          `row.rdpHostRow === true`. Tap-body-closes semantic on
          swiped-open rows (no accidental navigation).

        * **Desktop pin mechanism**. Hover-reveal 24x24 rounded pin
          button in the row's right column; always visible on pinned
          rows with the filled `Pin` glyph tinted to the identity hue.
          Same PinAction component as mobile, `size: "desktop"` variant.

        * **New-session affordance downgraded**. The full-width labeled
          "New Session" CTA is REPLACED with a compact 34x34 pencil
          icon-button in the panel header (Telegram-native).
          NewSessionDialog reused verbatim on submit (dialog `open`
          state moves to PrettyConversationsPanel's local state).
          On mobile the pencil is the ONLY thing in the header (no
          title text, no gear — the gear moved to the mobile
          SettingsRow at the bottom of the scroller per Phase 6 TG-18
          dedup). On desktop the header shows label ("Conversations")
          + compact 34x34 pencil + compact 34x34 gear (right-aligned).

        * **AppShell mount site swap**. Single JSX swap at the sole
          sidebar mount site:
          `<ConversationsPanel .../>` →
          `<PrettyConversationsPanel variant={isTouchDevice ? "mobile" : "desktop"} .../>`.
          Same prop shape (hostTree, onCreateSession,
          onConversationSelected, onRailClick, isAdmin,
          onDetachedRowClick, onRdpRowClick, settingsRowSlot) plus the
          new `variant` prop. Zero touches to conversation-store.ts,
          identities-store.ts, or the tabNodesRef DOM-move mechanism
          (patch #35) — T-06-02-01 mount-lifecycle contract preserved
          byte-for-byte via the same openTab + selectConversationDeferred
          chain that Phase 6 established.

        * **Persistent top-left sidebar toggle**. New 32x32 chevron
          button added to AppShell root at fixed `top: 8px, left: 8px,
          z-index: 30` with glass-treatment matching desktop.html mock
          (subtle backdrop-blur + thin border). Rotates 180° when
          `sidebarOpen` is true vs false. Fixes the small-window
          sidebar-affordance regression Ashley called out (at her
          typical narrow-window width ~600-800px the old collapsed-
          sidebar thin-strip disappeared entirely, making the sidebar
          unreachable). The old narrow-window thin-strip at
          AppShell:1844-1852 removed in the same commit — single
          canonical toggle at all widths.

        * **Old files DELETED post-cutover** (no dual-mode ship per the
          shape file rule that Ashley signed off on 2026-07-22):
          `src/ui/sidebar/ConversationsPanel.tsx` (430 LOC),
          `src/ui/sidebar/ConversationRow.tsx` (150 LOC),
          `src/ui/sidebar/NewSessionButton.tsx` (40 LOC). Deletions
          landed as three atomic commits (one per file) so a future
          `git bisect` can pinpoint any regression to a single file
          removal. Patch #111e F3-diag console.warn spew fully
          retired in this cutover — the origin site lived inside
          ConversationsPanel.tsx line 161, and its AppShell mirror
          site was already retired by Wave 3 at AppShell.tsx:1482
          (comment-only historical annotation preserved). Zero code
          references to `F3-diag` remain in `src/`; three
          comment-only mentions describe the retirement for future
          engineers wondering why there's no diagnostic instrumentation
          on those code paths.

        * **New test coverage** (36 new-Phase-10 tests, all green):
          - `PrettyConversationRow.test.tsx` — 12 cases: swipe state
            machine including 12° angle-tolerance-bails-to-scroll,
            RDP-no-swipe on BOTH mobile and desktop variants
            (Test 7 split into 7 + 7b for symmetric T-Test-34 coverage),
            hover-reveal desktop pin, selected-state hue interpolation
            (reads raw `getAttribute("style")` to bypass jsdom CSSOM
            hsla→rgba normalization), avatar initial-letter fallback,
            `e.stopPropagation` on pin click, zero IdentityBadge
            references in the DOM.
          - `PrettyConversationsPanel.test.tsx` — 15 cases: empty state
            renders PlanPendingBubble-style card, pinned-first ordering,
            no "Pinned" or host section headers rendered,
            RDP-sentinel-at-bottom with "Remote desktop" divider,
            variant-based header (mobile: pencil-only; desktop: label +
            pencil + gear), header pencil opens NewSessionDialog,
            gear desktop-only, settingsRowSlot mobile bottom render,
            row dispatcher routes RDP / fleetOnly / plain correctly,
            onConversationSelected fires on every branch.
          - `NewSessionDialog.test.tsx` — Test 1 (NewSessionButton
            isolation) PRUNED; Test 10 RETARGETED to
            PrettyConversationsPanel's header pencil. 9/9 green.

        * **Data-store contract UNCHANGED**. `conversation-store.ts` +
          `conversation-store.test.ts` untouched (data source, ordering
          rules, pin persistence, session-persistence contract,
          RDP-sentinel emission, `fleetOnly` INTERNAL routing marker —
          all preserved verbatim; Phase 10 is presentation-only).
          `identities-store.ts`, `session-hue.ts`, `tabUtils.tsx` also
          untouched.

        * **Scope fence held**. Zero touches to pretty-view internals
          (ChatMessage, ComposeBox, WipBubble, PlanPendingBubble,
          HarnessTasksPanel), terminal/RDP/guacamole panes, message-
          queue drawer, or identity-store. Phase 10 boundary: sidebar
          rendering + AppShell mount-site swap + AppShell persistent
          top-left toggle. Nothing else.

        * **Files touched**:
          - Created: `src/ui/features/pretty-conversations/tokens.ts`
            (50 LOC), `PinAction.tsx` (123 LOC),
            `PrettyConversationRow.tsx` (441 LOC),
            `PrettyConversationRow.test.tsx` (529 LOC),
            `PrettyConversationsPanel.tsx` (442 LOC),
            `PrettyConversationsPanel.test.tsx` (749 LOC).
          - Modified: `src/ui/AppShell.tsx` (mount-site JSX swap +
            persistent top-left chevron toggle addition + narrow-
            window thin-strip removal + F3-diag console.warn retirement),
            `src/ui/sidebar/NewSessionDialog.test.tsx` (Test 1 pruned +
            file-header comment update + imports scoped to survivors +
            Test 10 retargeted to PrettyConversationsPanel).
          - Deleted: `src/ui/sidebar/ConversationsPanel.tsx` (430 LOC),
            `src/ui/sidebar/ConversationRow.tsx` (150 LOC),
            `src/ui/sidebar/NewSessionButton.tsx` (40 LOC).

        * **Design source-of-truth** (locked, Ashley signed off
          2026-07-22):
          `/home/ubuntu/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/prototype.html`
          (mobile v0.3) and `.../desktop.html` (desktop v0.1). Full
          timeline in the bounty's `bounty.json`. Assistant-bubble
          verbatim source-of-truth for the selected-row treatment:
          `src/ui/features/pretty-view/ChatMessage.tsx` (Phase 4
          patches #51 through #96 stack).

        * **Verification** (Wave 5 build-verify log at
          `.planning/phases/10-pretty-conversations-visual-language-rework/10-BUILD-VERIFY-LOG.md`):
          `npx tsc --noEmit` exits clean (zero errors). `npx vitest run`
          reports **499 / 503 passing**. The 4 failures are all
          pre-existing test-fixture drift in `ComposeBox.test.tsx`
          inherited from patch #121 (Send-button removal, stale
          `getByLabelText(/send 'yes'/i)` anchors at Tests 7-8) +
          patch #124 (ThumbsUp aria-label rename, same anchor
          invalidation at two Phase 9 Layout tests) — documented at
          `.planning/phases/10-pretty-conversations-visual-language-rework/deferred-items.md`,
          out of Phase 10 scope per GSD SCOPE BOUNDARY rule.
          All 36 new-Phase-10 tests green (12 row + 15 panel + 9
          dialog). `npm run build` succeeds in 13.60s; AppShell bundle
          delta vs Phase 7 baseline is +5,288 bytes (+1.19%) — net
          effect of the new pretty-conversations component tree (~1006
          LOC source) minus the 620 LOC of retired sidebar files.
          Terminal/index/backend bundles untouched by Phase 10 (Terminal
          bundle delta from #118-#126 sits behind Phase 10 in git
          history).

        * **Rebase risk**: MEDIUM-LOW. The three sidebar-file
          deletions are in fork-only paths (Phase 6/7 shipped them,
          upstream never had them) — no upstream rebase conflict
          possible on the deletes. `AppShell.tsx`'s cutover is a
          surgical swap at the sole mount site — if upstream reworks
          its own AppShell in the same region there could be a
          textual merge conflict but the resolution is mechanical
          (keep the new PrettyConversationsPanel mount + prop wiring).
          The persistent top-left chevron toggle is a new addition to
          AppShell root — low-risk (upstream doesn't have this affordance
          at all). Grep for `PrettyConversationsPanel` in any post-
          rebase AppShell.tsx to sanity-check that the mount survived.

        * **Commits** (all on `feat/tab-title-from-tmux`):
          - Wave 1: `06c12fc` (tokens + PinAction), `55624a9`
            (PrettyConversationRow), `06d8a93` (Row 12/12 vitest),
            `be58042` (10-01 SUMMARY).
          - Wave 2: `3cab53e` (PrettyConversationsPanel), `b003207`
            (Panel 15/15 vitest), `fc82696` (10-02 SUMMARY).
          - Wave 3: `a2868e6` (AppShell cutover), `65c572c` (persistent
            top-left toggle + thin-strip removal), `8cf4c8b` (Test 10
            retarget), `0d39c43` (10-03 SUMMARY).
          - Wave 4: `5d17167` (delete ConversationsPanel.tsx), `b61503b`
            (delete ConversationRow.tsx), `40ee620` (prune
            NewSessionDialog.test.tsx Test 1), `c45312a` (delete
            NewSessionButton.tsx), `ebf0c43` (10-04 SUMMARY).
          - Wave 5: `[Wave-5 docs SHA — fill in after commit]`
            (10-BUILD-VERIFY-LOG.md + 10-UAT-CHECKLIST.md + this
            patches-md entry draft + STATE.md).

        * **Deploy status**. Code-complete on
          `feat/tab-title-from-tmux` at `[Wave-5 tip SHA]`. NOT YET
          pushed, NOT YET deployed, image NOT YET built. Batched with
          the pending #123-#127 stack pending Ashley's morning
          greenlight on visual behavior. Deploy sequence documented
          at `.planning/phases/10-pretty-conversations-visual-language-rework/10-UAT-CHECKLIST.md`
          under "Post-UAT deploy runbook".

---

## Fill-in placeholders (before pasting)

Before pasting into skynet-patches.md, replace the following if not already resolved:

- `[Wave-5 docs SHA — fill in after commit]` — from `git rev-parse --short HEAD` immediately after the Wave 5 docs commit.
- `[Wave-5 tip SHA]` — the same SHA (Wave 5 is the tip after the docs commit).

The LOC counts + vitest count (499/503) + AppShell bundle delta (+5,288 bytes) are all resolved from `10-BUILD-VERIFY-LOG.md` and don't need further substitution.

## Post-paste bookkeeping

After pasting into skynet-patches.md:

1. Update the count line near the top of the file from "ONE HUNDRED TWENTY-SEVEN numbered patches" to "ONE HUNDRED TWENTY-EIGHT numbered patches" (or whatever the actual pre-paste count reads — verify with `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3`).
2. Commit the pin: `docs(patches): pin patch #128 — pretty-conversations visual-language rework`.
3. `/close pretty-conversations-panel-redesign` on the Phase 10 bounty at `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/`.
4. Update `~/.claude/identities/tina/tina.md` compact overview if warranted (typically only for phase-scoped patches that alter tina's operating envelope — Phase 10 is presentation-only so likely no tina.md update needed; check convention).
