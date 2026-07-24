# Patch #129 — Subtle inside-textarea Send button

**Paste target:** `~/.claude/identities/tina/skynet-patches.md`
**Paste timing:** After Ashley greenlights the batched #123-#129 deploy AND UAT passes. Post-deadman-retirement flow per current `deploy-runbook.md`.
**Batch context:** Stacks on the six-patch stack (#123-#128) already awaiting UAT; ships as one build/deploy with them (now a seven-patch stack).
**Ordinal position on paste:** Bump the "ONE HUNDRED TWENTY-SEVEN numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED TWENTY-NINE" — accounting for both #128 (Phase 10 pretty-conversations) and #129 (this patch) landing together at deploy time.

---

## Draft (paste-ready)

   129. `feat(pretty-view/ComposeBox): patch #129 — subtle inside-textarea
        Send button` (committed 2026-07-23 to `feat/tab-title-from-tmux`
        at `37986b2`; deploy batched with #123-#128 pending Ashley
        greenlight).

        * **Motivating gap.** Post-patch-#121 (vestigial-Send trim) the
          ComposeBox had no visible send affordance at all — Enter was
          the sole submit path. Fine on desktop, discoverability gap on
          mobile / for anyone who hadn't internalized the Enter-sends
          contract. Ashley wanted the ChatGPT/iMessage/Slack pattern:
          just the icon inside the textarea's bottom-right, no button
          chrome, quiet enough to belong there without competing with
          the well.

        * **Design lock via console-snippet iteration** (not prototype.html,
          not deploy). Ashley iterated the visual through two DevTools
          console paste rounds injecting a bare button into the live
          textarea wrapper. Round 1 was chromed (border + amber gradient
          + glow — assumed VISUAL-08 was still active); Ashley pulled it
          back: "more subtle, like the ones inside textareas I've seen —
          just the icon, no border, solid fill in a color not incredibly
          vibrant compared to the background." Round 2 stripped all
          chrome, went to warm-cream `rgba(240,235,224,X)` at
          low-opacity rest / high-opacity hover. Ashley then tweaked
          rest 0.5 → 0.3, position 10/8 → 12/10, icon 18 → 24 in her
          own paste, and locked. This iteration codified the third
          preview pattern (**console DOM/CSS injection for tweaking an
          existing live surface**) into tina.md — distinct from
          prototype.html (greenfield design) and served diag.js
          (observation for debugging). All three patterns now catalogued
          in tina.md learned preferences.

        * **Fix.** One-file substantive change (plus test extensions):
          - Import `SendHorizontal` from `lucide-react` (alphabetical position
            in existing import block).
          - Derive `sendDisabled = queueArmed || (canSend === false &&
            !hasAttachments) || (text.trim() === "" && !hasAttachments)`
            as a local const above the JSX. **Strict `canSend === false`**
            is load-bearing — the loose `!canSend` variant the planner
            first spec'd tripped TDD-red because `canSend` defaults to
            `undefined` when the prop is omitted (which the read-only
            PrettyView path exercises), and `!undefined === true` would
            over-disable Send anywhere the prop wasn't threaded. Matches
            the strict-false-check pattern every other button in
            ComposeBox already uses.
          - Add `pr-10` (40px right padding) to the Textarea className so
            typed text doesn't slide under the button icon. Placed AFTER
            `px-4` so tailwind-merge's later-wins keeps left padding at
            16px.
          - Insert bare `<button type="button">` sibling to `<Textarea>`
            AND the queueArmed overlay inside the existing `<div
            className="relative flex-1 self-stretch">` wrapper. Button
            positioning: `absolute right-3 bottom-2.5` (12px right, 10px
            bottom — Ashley's locked values). `p-2` gives 40×40 hit target
            around a 24×24 `SendHorizontal` icon (`className="size-6"`
            `fill="currentColor"` — filled silhouette, NOT stroke; the
            second SendHorizontal path — the internal fold line — is
            elided by fill-only render). WCAG 2.5.5 relaxation acceptable
            because Enter + paperclip aux row remain primary paths.
          - Colors locked verbatim per Ashley: rest
            `text-[rgba(240,235,224,0.3)]`, hover
            `hover:text-[rgba(240,235,224,0.9)]`, disabled
            `text-[rgba(240,235,224,0.15)]` + `cursor-not-allowed`.
            Transition `transition-[color,transform] duration-120`, press
            `active:scale-95`. `aria-label="Send"`, `title="Send"`,
            `disabled={sendDisabled}`.
          - **Click handler routes ENTIRELY through `handleSend()`** at
            ~line 652: `onClick={() => { if (!sendDisabled) handleSend(); }}`.
            No branching duplication in the button — `handleSend`
            already owns the attachment-vs-text routing (checks
            `hasAttachments` and dispatches via
            `onSendWithAttachments?.(caption)` when chips are present,
            otherwise `onSend(collapsed)`), the D-50 newline collapse
            (`\n` → ` `), the COMPOSE-04 clear-textarea-on-success
            contract, and the fail-loud on dispatch-failure behavior.
            Reusing it means Send + Enter are the same code path — no
            drift possible.
          - Placed AFTER the queueArmed overlay in JSX order for
            belt-and-suspenders: overlay's `pointer-events-none inset-0`
            layer visually covers the button when queued, AND
            `sendDisabled` (which includes `queueArmed`) prevents
            interaction. Two independent mechanisms.

        * **Bare `<button>` NOT shadcn `<Button>` — deliberate.** The
          shadcn wrapper carries `dark:bg-input/30 dark:hover:bg-input/50`
          in its `outline` variant base className (specificity 0-2-0);
          any plain `bg-transparent` or arbitrary `bg-[...]` from us
          would be 0-1-0 and silently lose the cascade (the trap that bit
          patch #81 Textarea min-h and patch #117 meter Reset). We want
          ZERO chrome, so we skip the wrapper entirely rather than fight
          the specificity with `!` suffixes. Cleaner CSS, less risk of a
          future wrapper-base-class change silently coloring our button.

        * **VISUAL-08 hard-lock comments (lines 1134/1164/1194/1242)
          left INTENTIONALLY UNTOUCHED.** They describe a hypothetical
          saturated warm-amber Send treatment — the aux-row buttons
          (Paperclip / Stop / ThumbsUp / Queue) all warm-neutral
          precisely to preserve amber for Send. This subtle affordance
          is intentionally NOT that treatment. If cleanup is warranted
          (either delete the comments, or repurpose amber for Send at a
          later date), that's a separate patch — Ashley's directive was
          "quiet ChatGPT/iMessage style," not "activate the amber
          lock." Leaving the comments alone keeps the option open.

        * **Bundled selector-hygiene fix (3 pre-existing failing
          tests).** Tests 7, 8, and Phase 9 aux-row (in
          `ComposeBox.test.tsx`) used
          `getByLabelText(/send message/i)` — the aria-label from the
          old amber Send button that patch #121 removed. STATE.md
          flagged them as "3 pre-existing failures awaiting Phase 11
          test-hygiene sweep." Because #129's new button carries
          `aria-label="Send"` AND the /gsd:quick constraint required
          `npx vitest run ComposeBox.test.tsx all green`, we HAD to
          fix them here — the alternative would be to loosen the
          constraint to "no regressions" which is materially weaker.
          Updated selectors to `getByRole('button', { name: 'Send' })`;
          assertions unchanged.

        * **Bundled test-hygiene fix (localStorage bleed).** Added
          `localStorage.clear()` to both `beforeEach` blocks in
          ComposeBox.test.tsx. Patch #119's compose-draft localStorage
          mirror was surviving across tests within the shared JSDOM
          instance, silently over-disabling Send in tests that ran
          after a typing test. Caught during executor's TDD cycle when
          the "click when text present" test failed with a disabled
          button in an isolated run — root cause was the previous test
          leaving `pv-compose-draft:<paneId>` populated in ls with a
          different session's key mapping. Trivial fix (+2 lines), but
          worth calling out — patch #119 authored the mirror without a
          test-teardown hook and every test file that touches
          ComposeBox will need this same treatment.

        * **Tests added (all green):**
          1. Button renders as bare button (`type="button"`,
             `aria-label="Send"`) inside the textarea wrapper (not the
             aux-row div).
          2. Click when text is present calls `onSend` with the
             trimmed payload; textarea clears after (COMPOSE-04
             preservation check).
          3. Disabled state — Case A: empty text + no attachments,
             button is disabled + click no-op. Case B: canSend=false +
             empty text, button is disabled + click no-op.

        * **Verification.** `npx tsc --noEmit` clean; `npx vitest run
          src/ui/features/pretty-view/ComposeBox.test.tsx` 16/18
          passing (2 remaining failures are the patch #124
          `/send 'yes'/i` ThumbsUp aria-label residual from the
          `works-for-me` → "let's go" rename — both the aux-row test
          AND the desktop-min-h-8 layout test hit the same stale
          selector so they fail together; STATE.md's "1 failure"
          count was one patch stale, real count was 2 tests referencing
          the same stale label; out of scope per plan; noted in
          SUMMARY.md); `npm run build` succeeds in 8.87s.

        * **Files touched:**
          - `src/ui/features/pretty-view/ComposeBox.tsx` (+50/-2 —
            import, sendDisabled const, pr-10 on Textarea, new button
            JSX)
          - `src/ui/features/pretty-view/ComposeBox.test.tsx` (+81/-4
            — 3 new tests + 3 selector-fix tests + 2 localStorage
            teardown lines)

        * **Rebase risk: LOW.** Both files are fork-owned surfaces
          well past the fork/upstream boundary in ComposeBox.tsx (the
          pretty-view feature is 100% fork-added). No dependency on
          upstream `Textarea` or `Button` internals beyond the shadcn
          wrapper contract that's already been stable for months.
          Import shape (lucide alphabetical) survives any upstream
          reordering of `lucide-react`.

        * **Design tokens NOT changed.** Hue system, meter palette,
          Send's reserved amber gradient, all identity-hue focus
          rings — untouched.
