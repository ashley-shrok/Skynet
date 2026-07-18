# Phase 4: Pretty view visual reskin — Glass depth aesthetic — Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Source:** Design iterated in-turn with Ashley 2026-07-18. Reference mock built + refined live over 8 rounds of feedback. Design spec is the mock's Glass tab final state; iteration lessons captured below.

<domain>

## Phase Boundary

This phase reskins **pretty view only** — the top-pane mode introduced by patch #43 (Ctrl+Shift+O toggle) — from Termix's current flat-brutalist styling to a warm dark **Glass depth aesthetic** with real physical dimensionality and per-pane identity-hue carry-through.

**CSS-only.** Zero behavior changes. Every existing pretty-view feature must work byte-identically after this phase:
- Chat rendering (react-markdown + remark-gfm, patches #47/#48)
- ComposeBox split-send / reset-send / go-ahead paths (patches #40/#44/#52a/#58)
- HarnessTasksPanel (patch #52c/#53), BackgroundedAgentsPanel (patch #61/#66), BackgroundedShellsPanel (patch #68)
- WipBubble (patch #51 rework), PlanPendingBubble (patch #63/#67)
- Auto-scroll ratchet + jump-to-latest pill (patch #45/#50)
- Compose draft persistence (patch #57)
- Context-% fill bar (patch #52b/#56/#59)
- Message-queue drawer coexistence (unchanged)
- Session-changeover holding/changed banners (Phase 3 — WILL land before this phase deploys; adopt matching visual language)
- Empty state, error states, all keyboard chords

**Scope confined to** `src/ui/features/pretty-view/` + closely related shared components:
- `PrettyView.tsx`, `ChatMessage.tsx`, `ComposeBox.tsx`
- `HarnessTasksPanel.tsx`, `BackgroundedAgentsPanel.tsx`, `BackgroundedShellsPanel.tsx`
- `WipBubble.tsx`, `PlanPendingBubble.tsx`
- `IdentityBadge.tsx` — special case; see IdentityBadge constraint below
- Possibly minor additions to `src/ui/index.css` for `@theme inline {}` tokens
- Possibly minimal additions to Terminal.tsx or shared hooks if identity-hue plumbing requires — see decision below, minimize surface area

**Explicitly OUT of scope**:
- Terminal / RDP / VNC / file manager / dashboard / sidebar / AppRail / TabBar chrome — pretty view is a themed island
- Any backend change (no new WS message types, no route changes, no nginx changes)
- Font family / size / weight / line-height changes — the reskin is depth + color, not typography
- Any behavior change to any component's props / state / effects / WebSocket handling

</domain>

<design_spec>

## Design Spec — Reference Mock

**Path:** `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html` (Glass tab — final iterated state after 8 rounds of Ashley's feedback loop)

**Served over tailnet at** `http://100.99.149.8:8090/` during development. Python http.server bound to tailscale interface only (invisible from public internet).

**CSS values in the mock are TARGETS, not exact copies.** Translate to Tailwind v4 idiom:
- Shared vocabulary → `@theme inline {}` custom tokens in `src/ui/index.css` (e.g. `--color-pv-bg-base`, `--shadow-pv-raised-md`, `--pv-id-hue`)
- Per-component one-offs → scoped Tailwind arbitrary-value classes (e.g. `bg-[rgba(255,240,215,0.025)]`, `shadow-[0_8px_24px_rgba(0,0,0,0.5)]`)
- Complex multi-layer shadows → probably worth a custom `@theme` token entry to keep the class list readable

**Key mock techniques worth naming so the planner spots them**:
1. **Warm-neutral dark base** — NOT cool navy-black, NOT pure black. Mock uses `linear-gradient(160deg, #14120e 0%, #100e0b 50%, #0a0907 100%)` for pv-root; feels warm off-black. Text color `#e8e4d8` (warm off-white).
2. **Atmospheric depth via radial gradients on the base surface** — mock layers two low-opacity radial gradients (one warm from top-left, one cool from bottom-right) to imply an ambient light source. NOT flat fill.
3. **Multi-layer shadow stacks on raised elements** — mock uses e.g. `box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.12) inset, 0 0 0 0.5px rgba(255,255,255,0.05)` — ambient shadow + inset rim highlight (load-bearing "catches light from above" cue) + hairline outer stroke.
4. **`backdrop-filter: blur() saturate()`** on translucent bubbles so they read as glass planes over the depth, not opaque cards.
5. **Identity-hue color chain** — Tina's amber (~35deg / #d4a054) subtly tints: user bubble bg gradient + border + outer glow, panel tags bg + border + text, context-bar fill gradient + glow, send-button bg + text + glow, textarea focus ring, identity-badge border + avatar rim. One coherent color story tells you which agent this pane is talking to. Mock hardcodes amber; real code plumbs dynamically per pane (see decision below).
6. **Bigger identity badge** — 56px avatar (up from patch #17/#38's smaller size), name + title stacked to right, subtle 5s breathing brightness animation.
7. **Ambient panels shelf** — HarnessTasks/BackgroundedAgents/BackgroundedShells all wrapped in a single subtle floating card treatment (light warm tint, small border, small drop shadow, backdrop blur). Findable but calm.
8. **Intentionally-quiet compose** — the compose surface itself does NOT get card treatment. It blends into the atmospheric base with only a subtle inset shadow shading the bottom strip. Compose does NOT compete for attention; you go there when you're ready to type.
9. **Lightest-touch textarea outline** — 1px warm-white border at ~9% opacity is the ONLY affordance that makes the textarea findable within its otherwise-blending compose surround. Focused textarea gets an identity-hue focus ring (thin ring + soft outer glow).
10. **Send button glow** — retains a saturated identity-hue gradient bg + rim highlight + outer glow. THIS is the ONE intentional attention-grab-point in the compose area.

**Iteration lessons that shaped the final mock** (each was a real dead-end that Ashley pushed back on — do NOT reintroduce):

- **Round 3 dead-end**: Made the compose a raised card with bright top rim + drop shadow to distinguish it from panels. Ashley: "the compose shouldn't draw as much attention as it does because it's never something that I want to draw attention." Recovery: compose lost its card treatment entirely.
- **Round 4 dead-end**: Bright brightness contrast + hard top-edge separators between message area / panels / compose. Ashley: "as much as it does improve the issue of them blending together, I like it less so." Recovery: switched to shadow-based separation, same visual language as bubbles above (subtle floating cards), not stepped chrome.
- **Round 5 dead-end**: Near-black textarea (rgba(14,10,6,0.7)) with hard inset shadow — read as a "hole" not a "welcoming receptacle." Ashley: "textarea just a little brighter, we might hit the sweet spot." Recovery: warm mid-dark textarea with soft inset shadow.
- **Round 6 dead-end**: Textarea then went too bright. Ashley wanted halfway. Final: mock's current textarea values (`rgba(31,24,16,0.625)` top / `rgba(42,33,22,0.485)` bottom) — halfway between "hole" and "loud field."
- **Round 7 pivot**: Ashley: "actually want to go back to before on the Compose box... and just try a slight outline or box shadow or whatever on the text area itself. Lightest touch we can do." Final compose = blends into atmosphere (no card), textarea = plain `rgba(255,255,255,0.03)` bg with 1px warm-white 9% outline + focus ring on interaction.

**Final attention-hierarchy that Ashley signed off on:**
1. Chat bubbles = loud primary (full depth treatment, backdrop blur, multi-layer shadows)
2. Ambient panels + compose surround = quiet ambient (subtle floating card / blends into atmosphere)
3. Identity badge = grounding anchor (bigger + breathing glow, always present but not shouting — pill-shape corner card)
4. Send button + focused textarea ring = intentional grab-points (saturated identity hue when user is ready to fire)

</design_spec>

<decisions>

## Implementation Decisions (already made — planner does NOT re-litigate these)

### 1. Tailwind v4 `@theme inline {}` tokens vs per-component scoped classes

Termix uses Tailwind v4 with `@import "tailwindcss"` + `@theme inline {}` in `src/ui/index.css`. Patches #47/#48 already added `@plugin "@tailwindcss/typography"` and `@import "@fontsource-variable/inter"` in the same neighborhood.

**Split**: shared visual vocabulary (base colors, common shadow stacks, dynamic identity hue) becomes `@theme inline {}` custom properties; per-component one-offs stay as Tailwind arbitrary-value classes on the specific element. Planner enumerates specific tokens to add — expected set is roughly:

- Color tokens: `--color-pv-base` (warm off-black), `--color-pv-surface-quiet` (ambient panel/compose tint), `--color-pv-fg` (warm off-white text), `--color-pv-fg-muted`, `--color-pv-fg-dim`
- Structural tokens: `--radius-pv-bubble`, `--radius-pv-card`
- Shadow tokens: `--shadow-pv-raised-md` (multi-layer shadow stack for raised bubbles), `--shadow-pv-quiet-card` (subtle floating-card shadow for ambient panels + compose)
- Dynamic hue: `--pv-id-hue` (CSS custom property set per-pane, defaults to a neutral fallback; see below)

Planner's judgment call: any additional tokens for reused values that show up in ≥3 components.

### 2. Dynamic identity-hue wiring (HARD LOCK on approach — planner decides mechanism details)

The mock hardcodes Tina's amber. Real code needs to pull the identity's stored `colorHue` (patch #17 identities registry, 0-360 degrees) dynamically and apply it per-pane, so a Bella pane feels pink, a Zoey pane feels blue, etc.

**Approach**: Expose the identity's hue via a CSS custom property on a scoping root element per pane (probably `<PrettyView>`'s root div). Downstream Tailwind arbitrary-value classes read from that var:

```tsx
// PrettyView.tsx (rough shape — planner refines)
const { identity } = useSessionIdentity(tmuxSessionName);
const hue = identity?.colorHue ?? null;
const style = hue !== null
  ? { '--pv-id-hue': String(hue) } as React.CSSProperties
  : undefined;
return <div className="pv-root" style={style}>{...}</div>;
```

Then components consume via arbitrary values like:
- `bg-[hsla(var(--pv-id-hue),75%,52%,0.18)]`
- `shadow-[0_0_24px_hsla(var(--pv-id-hue),75%,52%,0.35)]`
- `border-[hsla(var(--pv-id-hue),75%,52%,0.28)]`

**Fallback for identities with no `colorHue` set**: use a neutral warm accent (roughly `hsla(35,45%,55%,...)` — a very muted amber that reads as neutral). Planner picks final fallback values. Do NOT use a hash of the session name as a fallback in pretty view (that behavior lives in the terminal pane per patch #26, and pretty view should be more deliberate — identity or neutral, no third path).

**Where the identity comes from**: `useSessionIdentity` hook from `src/ui/features/terminal/session-hue.ts` (patch #30 lifted the reader). It takes the tmux session name and returns the matched identity + hue. This hook already exists and is used by Terminal.tsx + SessionRow.tsx. Import + reuse; do not duplicate.

### 3. IdentityBadge — used in TWO surfaces, needs variant support

`IdentityBadge` (patch #17 + patch #38 hover-fade) is mounted in:
- **Terminal panes** (existing, current size ~40-44px avatar — do NOT change this size or its patch #38 hover-fade behavior)
- **Pretty view top-right** (NEW size treatment for this phase — ~56px avatar, name + title stacked, breathing glow)

**Approach**: Add a `size` prop (default `"md"` = current, add `"lg"` = pretty-view treatment). OR wrap `IdentityBadge` in a `PrettyViewIdentityCard` component that adapts the badge's visual to the larger treatment. Planner picks between prop-flag vs wrapper — prop-flag is simpler + preserves single source of truth; wrapper is cleaner if the two treatments diverge too much.

**Preserve patch #38 hover-fade behavior in BOTH sizes** — the "hover to see through the badge" affordance is load-bearing when the badge overlaps terminal content and should stay in pretty view too (in case Claude's chat output ever crowds the top-right corner).

**Breathing brightness animation** — new-in-phase-4, ~5s cycle, uses `filter: brightness(1)` → `brightness(1.08)` → back via `@keyframes`. Reduced-motion users get no animation (respect `@media (prefers-reduced-motion: reduce)`). Applied only in `size="lg"` treatment.

### 4. Rebase-risk hotspot: Terminal.tsx

Terminal.tsx is Termix's most-touched file (per AGENTS.md drift caveat, patches #1/#3/#6/#13/#17/#24/#26/#28/#33/#39/#40/#41/#44/#50/#51/#52/#60 all touch it). **Minimize any change here.** If IdentityBadge needs a prop change (§3), the Terminal.tsx call site changes MINIMALLY (add one prop). If identity-hue plumbing needs a shared hook change (§2), do it in `session-hue.ts` not Terminal.tsx.

Planner should identify all Terminal.tsx touches upfront and call them out in PLAN.md so the rebase-cost is explicit at review time.

### 5. Deploy discipline

Ashley's blanket "ship it harder than drarry" (2026-07-18) authorized code work through build. Deploy is a SEPARATE green-light per fleet-standing rule (`BLANKET PRE-AUTHORIZATION ≠ PER-DEPLOY GREEN LIGHT`, patch #35 lesson in tina.md).

Phase 4 execution ends at: **"committed to `feat/tab-title-from-tmux`, build clean, ready for Ashley's distinct deploy green-light."** The 15-min mandatory deadman + force-recreate cycle from AGENTS.md deploy runbook runs at deploy time, not during execution.

If Phase 3's undeployed patches (currently queued in bounty `pending-patch-batch-post-60`) are still undeployed when Phase 4 finishes, they batch together for one deploy. If Phase 3 has already been deployed by then, Phase 4 deploys standalone.

**Deploy plan artifact**: probably worth a small deploy-checkpoint plan in this phase (like patch #43's Phase 1 Wave 5) covering rebuild + deadman-armed deploy + post-deploy UAT checklist. Planner decides whether that's a separate plan or a note in the final code plan.

### 6. UAT criteria (planner writes into the final plan's Nyquist section)

Ashley UAT-tests visually, not via metrics. UAT probes:
- Open pretty view on tina pane → sees amber color chain (user bubbles, ctx bar, send, focus ring)
- Open pretty view on a different-hue identity's pane (e.g. bella if she has a colorHue set, or use SQL to set one temporarily) → color chain shifts to that hue
- Open pretty view on an identity with NO colorHue → sees neutral fallback, does not visually break
- Bubbles visually read as physical raised objects (not flat rectangles)
- Panels + compose read as calm ambient (do NOT draw eye away from chat when Claude is speaking)
- Textarea findable via its subtle outline when eye lands there; focus ring lights up on click
- Send button glow reads as the primary attention grab when ready
- Identity badge is prominent, breathes subtly, still fades on hover
- Every existing feature works byte-identically (chat rendering, ComposeBox modes, ambient panels populated, session-changeover if Phase 3 deployed, keyboard chords, message-queue drawer, empty state, error states)
- Terminal / RDP / dashboard / sidebar / file-manager surfaces are visually unchanged

</decisions>

<constraints>

## Constraints

- **Tailwind v4** — use `@theme inline {}` for tokens, arbitrary-value classes for one-offs. Do NOT introduce a traditional `tailwind.config.js`.
- **Cross-browser**: `backdrop-filter` needs `-webkit-backdrop-filter` fallback (already Termix-standard, mock uses both).
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` skips the identity-badge breathing animation.
- **No new fonts** — Inter for prose + JetBrains Mono for code already loaded via patches #47/#48.
- **No behavior changes** — CSS-only. Every event handler, WebSocket dispatch, prop signature, state hook, ref, effect stays byte-identical.
- **Rebase safety** — every touch to Terminal.tsx must be minimal and called out in PLAN.md drift-caveat section.
- **Fork PR-ability** — atomic commit(s), clear commit message referencing patch number (will be #69 or higher — check current AGENTS.md at execute time for exact next number).

</constraints>

<files>

## Files expected to change

**Certain**:
- `src/ui/features/pretty-view/PrettyView.tsx` — root element gains `--pv-id-hue` CSS var wiring + reskin classes
- `src/ui/features/pretty-view/ChatMessage.tsx` — bubble depth treatment, backdrop-filter, user-bubble identity-hue accents
- `src/ui/features/pretty-view/ComposeBox.tsx` — quiet compose surround, textarea outline + focus ring, send button glow, context bar identity-hue
- `src/ui/features/pretty-view/HarnessTasksPanel.tsx` — ambient panel treatment
- `src/ui/features/pretty-view/BackgroundedAgentsPanel.tsx` — ambient panel treatment
- `src/ui/features/pretty-view/BackgroundedShellsPanel.tsx` — ambient panel treatment
- `src/ui/features/pretty-view/WipBubble.tsx` — depth treatment on the bubble
- `src/ui/features/pretty-view/PlanPendingBubble.tsx` — depth treatment on the bubble
- `src/ui/features/terminal/IdentityBadge.tsx` — add `size` prop OR wrap with a pretty-view-specific variant component
- `src/ui/index.css` — add `@theme inline {}` tokens for the reskin vocabulary

**Possible (planner decides)**:
- New file `src/ui/features/pretty-view/PrettyViewIdentityCard.tsx` — if wrapper approach is picked for IdentityBadge size variant
- `src/ui/features/terminal/session-hue.ts` — no changes expected unless the identity-hue reader needs a minor add
- `src/ui/features/pretty-view/SessionHoldingBanner.tsx` — if Phase 3 lands first, this exists and adopts the same visual language

**Explicitly untouched**:
- `src/ui/features/terminal/Terminal.tsx` — unless minimum-viable prop-forwarding on IdentityBadge is needed
- Any file outside `src/ui/features/pretty-view/`, `src/ui/features/terminal/IdentityBadge.tsx`, `src/ui/features/terminal/session-hue.ts`, `src/ui/index.css`
- All backend files
- Nginx configs
- Docker/build config

</files>

<references>

## References

- **Design mock (definitive spec)**: `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html`
- **AGENTS.md fork runbook**: `/home/ubuntu/AGENTS.md` — patch catalog, deploy discipline, rebase-risk hotspots
- **Prior identity-hue implementation reference**: `src/ui/features/terminal/session-hue.ts` (patch #26 + #30 + #36)
- **IdentityBadge reference**: `src/ui/features/terminal/IdentityBadge.tsx` (patch #17 initial + patch #38 hover-fade)
- **Tailwind v4 setup reference**: `src/ui/index.css` (patches #47/#48 for typography + Inter font import)
- **Existing pretty-view components (reskin targets)**: `src/ui/features/pretty-view/*` — patches #43, #44, #45, #47, #48, #50, #51, #52, #57, #61, #63, #66, #67, #68
- **Ashley's iteration bounty (feedback trail)**: `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-visual-overhaul/`

</references>
