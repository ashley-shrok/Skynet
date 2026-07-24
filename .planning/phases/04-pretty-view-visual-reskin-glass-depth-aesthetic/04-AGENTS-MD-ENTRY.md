# AGENTS.md Draft Entry — Phase 4 (Patch #69)

**Insertion point in AGENTS.md**: After patch #68 (the current-highest as of 2026-07-18). Follow the same indentation and formatting as the surrounding entries — 3-space indent for the `NN.` header, 7-space indent for continuation body lines.

**Deploy-batch scenario**: **Scenario B (standalone deploy)** — Phase 3 patches (#61/#62/#63) have already been deployed (bounty dir `/home/ubuntu/.claude/identities/tina/bounties/pending-patch-batch-post-60/` does not exist as of pre-pin check 2026-07-18). Phase 4 ships as its own deploy behind the mandatory 15-min deadman + `docker compose up -d --force-recreate skynet` cycle.

**Adjust at PIN time**: replace `NN` → actual next patch number if #68 has been incremented since draft (should still be #69), replace `YYYY-MM-DD` with actual deploy date.

---

## Draft body (paste into AGENTS.md as patch #NN)

   NN. `feat(pretty-view): Glass depth reskin — atmospheric base +
       physical bubbles + per-pane identity-hue color chain + bigger
       IdentityBadge` — three commits shipped as one Phase 4 execution
       arc (Wave 1 `06b1f08` foundation tokens + IdentityBadge size
       variant + PrettyView root hue plumbing; Wave 2 `e04396a`
       per-component Glass reskin across 9 files; Wave 3 no source
       diffs — build-verify + UAT prep + this doc entry drafted).
       CSS-only across **12 files** — 9 under
       `src/ui/features/pretty-view/`, plus
       `src/ui/features/terminal/IdentityBadge.tsx` (add-a-prop with
       default preserving patch #17/#38 behavior byte-identically),
       plus `src/ui/index.css` (Phase 4 tokens + breathing keyframes).
       Terminal / RDP / VNC / file manager / dashboard / sidebar / tab
       bar / AppRail chrome **COMPLETELY unchanged**.
       * **Aesthetic goal**: pretty view was flat-brutalist to match
         the rest of Skynet; Ashley wanted a distinct visual identity
         — a **"warm dark Glass depth aesthetic with real physical
         dimensionality"** — that reads as a themed island for the
         surface where she coordinates parallel Claude Code sessions.
         Design iterated live in-turn over 8 rounds of feedback
         (bounty `pretty-view-visual-overhaul/` reference-mock at
         `~/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html`,
         Glass tab final state). The mock has 4 tabs (Glass / Chip /
         Print / a 4th if kept); Glass was the elected treatment.
       * **Iteration dead-ends** (each was a real recovery moment,
         preserved in `.planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-CONTEXT.md`
         § design_spec iteration lessons):
         - Round 3: made compose a raised card with bright top rim +
           drop shadow. Ashley: *"compose shouldn't draw as much
           attention as it does because it's never something I want
           to draw attention."* Recovery: compose lost its card
           treatment entirely — **VISUAL-06 HARD LOCK**.
         - Round 4: bright brightness contrast + hard top-edge
           separators between message area / panels / compose.
           Ashley: *"as much as it does improve the issue of them
           blending together, I like it less so."* Recovery:
           switched to shadow-based separation, same visual language
           as bubbles above (subtle floating cards), not stepped
           chrome.
         - Round 5-7: textarea iteration. Near-black hole → too
           bright → halfway between; final `rgba(255,255,255,0.03)`
           bg with 1px warm-white 9% outline as the ONLY affordance
           making it findable, focus ring identity-hue glow —
           **VISUAL-07 HARD LOCK**.
       * **Token layer** (`src/ui/index.css` additive to `@theme
         inline {}`): 12 colors under `--color-pv-*` including
         `--color-pv-base` warm off-black gradient triple,
         `--color-pv-surface-quiet` ambient-panel tint,
         `--color-pv-fg` warm off-white text, `--color-pv-code-fg`
         warm coral for inline code; 2 radii
         (`--radius-pv-bubble` 14px, `--radius-pv-card` 10px);
         3 shadow stacks — `--shadow-pv-raised-md` (bubbles,
         3-layer: ambient drop + inset top-rim highlight + hairline
         outer stroke), `--shadow-pv-quiet-card` (panels, 2-layer),
         `--shadow-pv-root`. Plus `@keyframes pv-identity-breathe`
         (5s brightness cycle: `filter: brightness(1) → 1.08 → 1`)
         with `@media (prefers-reduced-motion: reduce) {
         .pv-identity-breathe { animation: none !important; } }`
         override for accessibility. All Phase 4 values are
         theme-independent (hardcoded from the mock, not `oklch()`
         derivations from theme vars) — pretty view is a themed
         island (VISUAL-10) that keeps its Glass aesthetic
         regardless of which Skynet theme is active.
       * **Identity-hue plumbing**: PrettyView reads the pane's
         identity via the existing `useSessionIdentity` hook
         (patch #30 lifted from Terminal.tsx), gets `identityHue`
         (0-360 from patch #17's `identities.color_hue` field),
         sets it as a CSS custom property `--pv-id-hue` on the root
         div's inline style with a fallback of hue 35 (warm amber,
         matches mock's Tina). Downstream components read via
         Tailwind arbitrary-value classes like
         `hsla(var(--pv-id-hue),75%,52%,0.18)`. Fallback for
         unmatched panes: hue 35 across the whole chain (user
         bubble accents, context-bar fill, send-button glow,
         textarea focus ring, subagentType tag pill in
         BackgroundedAgentsPanel). **NO hash-based fallback** like
         patch #26's terminal-pane tint — pretty view is
         deliberately more restrained: identity or neutral, no
         third path.
       * **IdentityBadge size variant** (`size?: "md" | "lg"`): the
         `md` default preserves patch #17 (120px pill + 80px avatar
         + name-below + title-below) AND patch #38
         (`transition-opacity duration-150 hover:opacity-0`)
         byte-identically for the terminal-pane call site in
         `Terminal.tsx:2888` (which passes NO size prop so defaults
         to `md`). The `lg` treatment used only in pretty view:
         56px avatar on LEFT, name+title stacked to the RIGHT,
         `flex-row items-center gap-3`, `backdrop-filter: blur(24px)
         saturate(1.4)` + `WebkitBackdropFilter` fallback,
         warm-glass linear-gradient base, identity-hue rim + outer
         glow, subtle 5s breathing brightness via the
         `.pv-identity-breathe` class marker (respects
         prefers-reduced-motion via the `@media` rule).
         **Patch #38 hover-fade PRESERVED in both size branches** —
         the terminal-content-showing-through affordance is
         load-bearing even in pretty view (in case Claude's chat
         output ever crowds the top-right corner).
       * **Bubble treatment** (ChatMessage assistant + user +
         WipBubble + PlanPendingBubble share the same recipe):
         rounded `--radius-pv-bubble` + `backdrop-blur-xl
         saturate-150` + `[-webkit-backdrop-filter:...]` vendor
         fallback + `--shadow-pv-raised-md` 3-layer shadow stack
         (ambient drop + inset rim highlight + hairline outer
         stroke) + `border-white/8`. Assistant bubbles: translucent
         mid-blue-gray gradient (`rgba(45,55,80,0.5) →
         rgba(28,35,55,0.55)`). User bubbles: identity-hue gradient
         (`hsla(var(--pv-id-hue),60%,45%,0.55) →
         hsla(var(--pv-id-hue),55%,30%,0.6)`) + hue-tinted rim +
         outer glow. prose-code renders in `--color-pv-code-fg`
         (warm coral) on a subtle chip. prose-pre gains inner
         shadow + hairline border. **VISUAL-02 + VISUAL-03
         delivered in one cascade.**
       * **Ambient panels shelf** (HarnessTasksPanel +
         BackgroundedAgentsPanel + BackgroundedShellsPanel): each
         panel wraps in the SAME quiet-card treatment (translucent
         warm-tint gradient bg + `backdrop-blur-md` + webkit
         fallback + `--shadow-pv-quiet-card` subtle drop +
         `--radius-pv-card` + `--color-pv-border-quiet` border).
         Reads as a shelf of three related cards distinct from the
         messages above but visually calm — **VISUAL-05**. Motion
         channel preserved: **STILL NO SPINNERS** in any of the
         three panels (patch #53 discipline extended to Phase 4;
         BackgroundedShellsPanel is patch #68's Terminal-icon glyph
         static). BackgroundedAgentsPanel subagentType tag pill
         gets identity-hue accents (bg + border + text all
         `hsla(var(--pv-id-hue),...)`) per mock.
       * **Compose surround intentionally quiet** (**VISUAL-06 HARD
         LOCK** from Round-3 recovery): no card, no bright top
         rim, no visible separator from the panels above. ONE cue:
         subtle inset shadow shading the bottom strip
         (`shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]`) over a
         faint darkening linear-gradient. Compose is chrome you go
         to when you're ready, not chrome that demands attention.
       * **Textarea lightest-touch** (**VISUAL-07 HARD LOCK** from
         Round-7 pivot): 1px warm-white 9% opacity outline
         (`--color-pv-border-quiet-strong`), subtle inset shadow,
         warm-mid-dark bg (`bg-white/[0.03]`), placeholder text
         warm-dim (`--color-pv-fg-dim`). Focus reveals identity-hue
         border + focus ring (thin ring + soft outer glow),
         transition ~200ms on box-shadow + border-color. shadcn's
         built-in `focus-visible:ring` + `focus-visible:border-ring`
         defaults suppressed via `focus-visible:ring-0` +
         `focus-visible:outline-none` so Phase 4 identity-hue focus
         ring wins cleanly.
       * **Send button ONE grab-point** (**VISUAL-08 HARD LOCK**):
         saturated identity-hue gradient bg + warm-cream rim +
         outer glow, deep-dark text for contrast. Reset (RotateCcw)
         and Go-Ahead (ThumbsUp) buttons above it get the QUIETER
         treatment: subtle warm-dark gradient + faint rim, hover
         reveals hue-tinted rim + glow. Preserves the "compose has
         ONE intentional attention-grab-point" attention hierarchy.
       * **Context bar identity-hue** (with red-at-80 semantic
         **HARD LOCK**): `<50` = identity-hue full-strength
         gradient + glow; `50-79` = same hue but reduced glow
         alpha; `>=80` = **RED** (`hsla(0,75%,60%,1)`) —
         approaching-full stays alarming regardless of pane
         identity because "context is about to run out" is a
         semantic that overrides per-pane color signal. Track
         becomes `bg-black/55` with inset shadow.
       * **SessionHoldingBanner reskin** (Phase 3 preserved):
         adopts the ambient-panel treatment (translucent warm bg +
         backdrop-blur-md + soft shadow), NOT the raised-bubble
         treatment — it's chrome, not content. The Plan 03-02
         sticky-positioning mechanism (`sticky top-0 z-10 -mx-4
         -mt-3 mb-3 px-4 py-2`) preserved **byte-identically**
         alongside the FRAGILITY WARNING code comment. **PrettyView
         root INTENTIONALLY does NOT gain** `backdrop-filter` /
         `transform` / `will-change` / `filter` / `perspective` —
         any of those would establish a new containing block and
         break the sticky banner's positioning per the Plan 03-02
         warning. Root atmospheric depth is `background` +
         `background-image` (both safe for sticky-descendant
         positioning). The root radial-gradient uses the RESOLVED
         numeric `${pvHue}` (not `hsla(var(--pv-id-hue),...)`) to
         avoid cross-browser `@property` interpolation edge cases;
         inner components' `hsla(var(...))` work fine because they
         resolve at paint time.
       * **Fleet asks that fed into this reskin**: Ashley's
         many-parallel-Claude workflow benefits from per-pane color
         identification at a glance (patch #26 tint on terminal
         panes, patch #17 identity badges, patch #30 shared row
         helpers, patch #32 tab-bar identity carry-through). Phase
         4 extends the "which agent is this?" grounding into pretty
         view via the full color chain + bigger badge. The compose
         area's quiet-vs-attention hierarchy (Round-3 recovery)
         reflects Ashley's actual workflow: pretty view is for
         reading Claude's output; compose is for firing back when
         she's ready. Chrome that shouts for attention when she's
         reading is a friction cost.
       * **Verify post-deploy invariants** (for future rebase smoke
         checks):
         - `sudo docker exec skynet grep -l '\-\-pv-id-hue' /app/dist/assets/*.css /app/dist/assets/*.js`
           should return `≥1` file (Vite + Tailwind v4 tree-shake
           did not drop the identity hue custom property).
         - `sudo docker exec skynet grep -l '\-\-color-pv-base' /app/dist/assets/*.css`
           should return `≥1` file.
         - `sudo docker exec skynet grep -l 'pv-identity-breathe' /app/dist/assets/*.css`
           should return `≥1` file (the breathing keyframes made it
           through).
         - Live smoke: flip to pretty view on any identity-matched
           pane → bigger badge appears in top-right with breathing
           + hue rim; chat bubbles read as raised objects with
           backdrop-blur; user bubble carries pane's identity hue;
           compose is quiet chrome; textarea focus ring is
           identity-hue.
         - Terminal panes (tmux mode) visually **UNCHANGED** — the
           safety canary.
         - SessionHoldingBanner sticky-positioning acid test: fire
           `/id reset` on any pretty-view pane; banner appears at
           top of scroll region and STAYS STUCK as messages scroll
           beneath it; dismisses on `session_changed`; WebSocket
           does NOT drop.
       * **Deploy note**: shipped standalone via mandatory 15-min
         deadman + `sudo docker compose up -d --force-recreate
         skynet`, pinned after Ashley's UAT green-light on
         `.planning/phases/04-pretty-view-visual-reskin-glass-depth-aesthetic/04-UAT-CHECKLIST.md`,
         YYYY-MM-DD. Phase 3 patches (#61-#68) had already deployed
         before Phase 4 landed, so this was not a batch deploy.
       * **Rebase risk**: **LOW-to-MEDIUM**.
         - `src/ui/features/pretty-view/*` — all fork-only files
           (created in patches #43/#44/#45/#47/#48/#50/#51/#52/#57/
           #61/#63/#68). No upstream conflict surface exists.
         - `src/ui/features/terminal/IdentityBadge.tsx` — patch #17
           + patch #38 territory. Phase 4 is the first patch after
           #38 to touch it (add-a-prop with default). If a future
           rebase drops the `size` prop, terminal panes still
           render correctly because `size` defaults to `"md"`
           (byte-identical to patch #17/#38 behavior). Pretty view
           would degrade to no-badge-in-pretty until IdentityBadge
           is patched back — a **graceful degradation**, not a
           broken deploy.
         - `src/ui/index.css` — patches #47/#48 added
           `@plugin @tailwindcss/typography` and
           `@import @fontsource-variable/inter` at the top. Phase 4
           adds tokens INSIDE the existing `@theme inline {}` block
           (additive, no reordering) + `@keyframes
           pv-identity-breathe` + reduced-motion rule at the bottom
           (in the neighborhood of the existing `@keyframes blink`
           + `.session-tint`). Upstream rarely touches this file so
           conflict risk is LOW.
         - `Terminal.tsx` — the highest-rebase-risk file on the
           fork (patches #1/#3/#6/#13/#17/#24/#26/#28/#33/#39/#40/
           #41/#44/#50/#51/#52/#60) — was **DELIBERATELY LEFT
           UNTOUCHED**. IdentityBadge default `size="md"`
           guaranteed the terminal-pane call site
           `<IdentityBadge identityKey={identityKey} />` renders
           byte-identically.
         - **Design mock preserved** at
           `~/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html`
           for reference in future revisions. If a future Phase-5+
           wants to iterate the aesthetic, the mock's 4 tabs
           (Glass / Chip / Print / [4th]) are ready as
           design-conversation starters.

---

**End of draft.** Do NOT paste into AGENTS.md until deploy PIN time per the fork's standing rule.
