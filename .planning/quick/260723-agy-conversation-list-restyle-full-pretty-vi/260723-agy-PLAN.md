---
phase: quick-260723-agy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/index.css
autonomous: true
requirements:
  - PATCH-136-BUBBLE-EVERY-ROW
  - PATCH-136-AVATAR-BADGE
  - PATCH-136-WIP-DOT-SLOT
  - PATCH-136-PANEL-PROP-THREAD
  - PATCH-136-KEYFRAMES-REDUCED-MOTION

must_haves:
  truths:
    - "Every non-RDP PrettyConversationRow with hue != null renders at FULL bubble intensity (0.55/0.60 gradient, 0.32 hue border, full multi-stop shadow) — not the reduced 0.30/0.35 selected-only treatment."
    - "Hover on a non-selected row lifts the row (translateY(-1px)) and increases hue border/shadow alpha."
    - "Selected row uses the strongest treatment (0.55 hue-border, 1px outer hue ring, translateY(-1px), 56px glow)."
    - "Avatar disc (identity present) uses the linear-gradient + hue border + multi-stop shadow translated from IdentityBadge.tsx:58-62 & :76 (NOT the old radial-gradient)."
    - "RDP-sentinel rows (hue == null AND isRdp) render the neutral (60,65,80 / 30,33,44) glass treatment on both body and avatar."
    - "isWip={true} renders a bare-glyph pulse dot as the LAST child in the right-meta column with aria-label='working', animated by keyframes pv-conv-wip-pulse."
    - "prefers-reduced-motion disables the pulse animation but keeps a static bright dot."
    - "PrettyConversationsPanel passes isWip={false} to every PrettyConversationRow render site (3 call sites — pinned list, unpinned list, and any RDP sentinel render)."
    - "All existing PrettyConversationRow.test.tsx tests still pass (updated computed-style expectations are fine)."
    - "New tests cover: (a) unselected row now has hue-bubble treatment (non-empty computed body style with linear-gradient background), (b) isWip={true} renders aria-label='working' element."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "Full pretty-view bubble+badge restyle; isWip prop + WIP dot slot; RDP + fallback branches"
      contains: "isWip"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "isWip={false} pass-through at every PrettyConversationRow render site"
      contains: "isWip={false}"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx"
      provides: "Preserved existing coverage + new unselected-hue-body + isWip dot tests"
      contains: "aria-label=\"working\""
    - path: "src/ui/index.css"
      provides: "pv-conv-wip-pulse keyframes + prefers-reduced-motion fallback"
      contains: "@keyframes pv-conv-wip-pulse"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      to: "src/ui/index.css"
      via: "animation: pv-conv-wip-pulse 1.35s ease-in-out infinite"
      pattern: "pv-conv-wip-pulse"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      via: "isWip={false} prop pass-through"
      pattern: "isWip=\\{false\\}"
---

<objective>
Patch #136 in the Skynet fork: restyle every `PrettyConversationRow` (not only the SELECTED row) to match the pretty-view assistant-bubble treatment locked in Ashley's prototype v2 — **full bubble intensity + normal density** — with the avatar disc adapted from `IdentityBadge.tsx` lg pill. Add a bare-glyph WIP pulse-dot render slot (`isWip` prop) as a same-file affordance; wire the prop through `PrettyConversationsPanel` as `isWip={false}` so a follow-up patch (#137) can turn it on with a one-line store subscription.

Purpose: Land Ashley's locked visual pass for the conversation list (matches the assistant-bubble+identity-badge language everywhere in pretty-view). Ship the WIP dot render slot now so #137 is a data-only diff.

Output: Restyled `PrettyConversationRow.tsx`, prop-threaded `PrettyConversationsPanel.tsx`, updated tests, `pv-conv-wip-pulse` keyframes in `index.css`.

Batched deploy: LAND CODE + TESTS + COMMIT ONLY. NO build, NO docker up, NO deploy, NO skynet-patches.md write-up.
</objective>

<execution_context>
Batched-deploy mode. No `npm run build`, no `docker compose up`, no deploy verification. Commit only.

Commit message: `feat(pretty-conversations): patch #136 — full pretty-view bubble+badge restyle for every row (locked from Ashley's mock)`
</execution_context>

<context>
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-view/ChatMessage.tsx
@src/ui/features/terminal/IdentityBadge.tsx
@src/ui/index.css

Live prototype (Ashley-approved v2, Full + Normal locked):
http://100.99.149.8:8899/conversation-list-bubble-badge-restyle/prototype.html
Prototype file on disk: /home/ubuntu/.claude/identities/tina/bounties/conversation-list-bubble-badge-restyle/prototype.html
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add pv-conv-wip-pulse keyframes + reduced-motion fallback in index.css</name>
  <files>src/ui/index.css</files>
  <behavior>
    - Keyframe `pv-conv-wip-pulse` scales from 0.85→1.15 and pulses opacity 0.4→1.0→0.4 across 0%/50%/100%.
    - Under `@media (prefers-reduced-motion: reduce)`, elements with `animation-name: pv-conv-wip-pulse` have `animation: none` and their computed `opacity: 1` / `transform: none` (static bright dot).
  </behavior>
  <action>
Append (near the existing pretty-view palette tokens ~lines 117-152 — put the block AFTER the closing brace of the palette rule so it lives at top level and is not scoped to `:root`) two CSS blocks. This is co-location with the rest of the pretty-view palette (per task_spec pick — cleaner than inline `<style>` inside the .tsx).

Block 1 — keyframes:
- Name: `pv-conv-wip-pulse`
- `0%, 100%`: `opacity: 0.4; transform: scale(0.85);`
- `50%`: `opacity: 1; transform: scale(1.15);`

Block 2 — reduced-motion fallback:
- `@media (prefers-reduced-motion: reduce)` wrapping a selector that targets the dot: use an attribute selector `[data-pv-conv-wip-dot="true"]` so the `.tsx` render slot in Task 2 can opt in via a data attribute (avoids coupling to a global class name Ashley hasn't sanctioned).
- Inside the media query set `animation: none !important; opacity: 1; transform: scale(1);` on `[data-pv-conv-wip-dot="true"]`.

Do NOT modify any existing token values. Do NOT touch anything above line ~152 or in the `:root` block.
  </action>
  <verify>
    <automated>grep -q "pv-conv-wip-pulse" src/ui/index.css &amp;&amp; grep -q "prefers-reduced-motion" src/ui/index.css &amp;&amp; grep -q "data-pv-conv-wip-dot" src/ui/index.css</automated>
  </verify>
  <done>Both blocks present; existing palette tokens byte-identical; file parses (a subsequent test run in Task 3 will surface any CSS parse error indirectly via Vitest / jsdom, but CSS parse is not runtime-critical for the visual tests).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Restyle PrettyConversationRow — full bubble + badge for every row + isWip slot</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx</files>
  <behavior>
    - For ANY non-RDP row with hue != null, the body's computed inline `style` (not just when `selected`) contains a `linear-gradient(160deg, hsla(H,50%,38%,0.55), hsla(H,45%,24%,0.60))` background, a hue border color, and the full multi-stop `box-shadow` (0 8px 24px + inset + 0.5px hairline + 32px hue glow).
    - HOVER on a non-selected row transitions to translateY(-1px), border alpha 0.42, hue-hairline alpha 0.28, glow alpha 0.26, outer shadow 0 12px 28px.
    - SELECTED: translateY(-1px), border alpha 0.55, 1px hue ring (not 0.5px), 0 14px 32px outer, 56px glow.
    - Avatar disc (identity present, hue != null): background = `linear-gradient(160deg, hsla(H,45%,25%,0.72), hsla(H,40%,15%,0.82))`, border = `1px solid hsla(H,65%,55%,0.40)`, boxShadow = the three-stop shadow from IdentityBadge.tsx:76 (`0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(H,65%,55%,0.40)`). Fallback letter color `#fbf5e8`.
    - RDP row (isRdp): body bg uses neutral rgba(60,65,80,0.42) → rgba(30,33,44,0.58) linear-gradient; avatar uses rgba(60,65,80,0.72) → rgba(30,33,44,0.82); icon color `var(--color-pv-fg-muted)`.
    - Fallback (hue == null AND NOT isRdp): use the existing cool-slate neutral values (rgba(45,55,80…) / rgba(28,35,55…)) but at the full 0.55/0.60 alphas (bumped from the previous 0.30/0.35 selected-only treatment).
    - Label text `#fbf5e8` `font-weight: 600` (was `font-medium` / 500) with `text-shadow: 0 1px 2px rgba(0,0,0,0.4)` on all rows carrying the bubble.
    - Host secondary line color `rgba(255,235,190,0.65)` (warmer than the current `text-muted-foreground/60`).
    - New optional prop `isWip?: boolean` (default `false`). When true, render a `<span aria-label="working" data-pv-conv-wip-dot="true">` as the LAST child in the right-meta column (after the pin glyph if pinned; on desktop this is still before the hover-reveal PinAction slot — put the dot AFTER PinAction as well so it is unconditionally last).
    - WIP dot inline style: `w-2 h-2 rounded-full`, background `hsla(H,85%,65%,0.95)` (or neutral `rgba(220,225,245,0.95)` when hue is null), boxShadow `0 0 10px 1px hsla(H,85%,55%,0.85), 0 0 20px 2px hsla(H,85%,55%,0.35)` (neutral analog for hue==null), animation `pv-conv-wip-pulse 1.35s ease-in-out infinite`.
    - Panel: at every `<PrettyConversationRow ... />` render site (3 sites, lines ~268, ~317, ~335), thread `isWip={false}`. Do NOT wire to any store.
    - All existing test cases still pass (see Task 3 for updated expectations).
  </behavior>
  <action>
### 2A — PrettyConversationRow.tsx

Rewrite the visual layer. Preserve ALL touch handlers, swipe state machine, `forceClosed`, keyboard handling, pin action semantics, `aria-pressed`, `data-*` attributes, and the panel's swipe coordinator contract (`onSwipeOpenChange`). Do NOT change the prop shape except to ADD one optional field.

1. **Prop signature (top of function, ~line 69-87):** add `isWip?: boolean;` to the destructure and the type annotation. Default via `const isWip = props.isWip === true;` or destructure default `isWip = false`. Add the prop between `forceClosed` and the closing brace.

2. **Delete `selectedStyle` IIFE (lines 132-148).** Replace with a single `bodyStyle` builder that composes the FULL bubble treatment for every non-RDP row + the hover/selected variants + the RDP/fallback branches. Layered CSS-in-JS is fine (all lives on the body div's inline `style`, since Tailwind arbitrary-value pseudo-classes cannot express the multi-stop shadow tuples cleanly).

   Concrete structure:
   ```
   const baseBodyStyle: CSSProperties = (() => {
     if (isRdp || hue == null) {
       // RDP + hue-null fallback share the neutral treatment, but RDP uses
       // the (60,65,80 / 30,33,44) values while the plain-fallback bumps
       // the existing (45,55,80 / 28,35,55) cool-slate to full alpha.
       const [c1, c2, borderRgba, hairlineRgba, glowRgba] = isRdp
         ? ["rgba(60,65,80,0.42)", "rgba(30,33,44,0.58)",
            "rgba(220,225,245,0.14)", "rgba(220,225,245,0.06)",
            "rgba(220,225,245,0.05)"]
         : ["rgba(45,55,80,0.55)",  "rgba(28,35,55,0.60)",
            "rgba(120,140,180,0.32)","rgba(120,140,180,0.16)",
            "rgba(120,140,180,0.08)"];
       return {
         background: `linear-gradient(160deg, ${c1}, ${c2})`,
         border: `1px solid ${borderRgba}`,
         boxShadow: `0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(220,225,245,0.10), 0 0 0 0.5px ${hairlineRgba}, 0 0 32px ${glowRgba}`,
         borderRadius: 14,
         color: "#fbf5e8",
         backdropFilter: "blur(20px) saturate(1.5)",
         WebkitBackdropFilter: "blur(20px) saturate(1.6)",
       };
     }
     // Hue-driven full treatment.
     return {
       background: `linear-gradient(160deg, hsla(${hue}, 50%, 38%, 0.55), hsla(${hue}, 45%, 24%, 0.60))`,
       border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
       boxShadow: `0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 0 0.5px hsla(${hue}, 70%, 55%, 0.20), 0 0 32px hsla(${hue}, 70%, 52%, 0.18)`,
       borderRadius: 14,
       color: "#fbf5e8",
       backdropFilter: "blur(20px) saturate(1.5)",
       WebkitBackdropFilter: "blur(20px) saturate(1.6)",
     };
   })();
   ```

3. **Selected variant:** when `selected === true`, overlay:
   ```
   selectedOverlay = {
     transform: "translateY(-1px)",
     borderColor: hue == null
       ? (isRdp ? "rgba(220,225,245,0.24)" : "rgba(120,140,180,0.55)")
       : `hsla(${hue}, 70%, 60%, 0.55)`,
     boxShadow: `0 14px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.28), 0 0 0 1px ${hueOrNeutral 0.42}, 0 0 56px ${hueOrNeutralGlow 0.34}`,
   };
   ```
   Merge `{...baseBodyStyle, ...selectedOverlay}` into `bodyStyle` when selected.

4. **Hover variant (desktop only, unselected):** Tailwind arbitrary pseudo-class cannot express the multi-stop shadow, so use group-hover with `[&:hover]:` arbitrary variants OR — simpler and readable — attach `onMouseEnter` / `onMouseLeave` handlers that toggle a local `hovered` state, then apply a hoverOverlay object identical in shape to `selectedOverlay` but with the 0.42 / 0.28 / 0.26 alphas and 0 12px 28px outer / 40px glow numbers.
   - Do NOT wire hover on mobile (`if (!isMobile && !selected)` gates the handler attach).
   - `hovered` initial `false`.

5. **Avatar style (replace radial-gradient at lines 111-126):**
   ```
   const avatarStyle: CSSProperties = (() => {
     if (isRdp || hue == null) {
       const [c1, c2, borderRgba] = isRdp
         ? ["rgba(60,65,80,0.72)", "rgba(30,33,44,0.82)", "rgba(220,225,245,0.22)"]
         : ["rgba(45,55,80,0.72)", "rgba(28,35,55,0.82)", "rgba(120,140,180,0.35)"];
       return {
         background: `linear-gradient(160deg, ${c1}, ${c2})`,
         border: `1px solid ${borderRgba}`,
         boxShadow: "0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(220,225,245,0.20), 0 0 24px rgba(220,225,245,0.12)",
         color: "var(--color-pv-fg-muted)",
       };
     }
     return {
       background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
       border: `1px solid hsla(${hue}, 65%, 55%, 0.40)`,
       boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.40)`,
       color: "#fbf5e8",
       textShadow: "0 1px 1px rgba(0,0,0,0.4)",
     };
   })();
   ```
   Keep the avatarSize class strings and the identity/tabIcon rendering fork identical (lines 351-379 stay structurally the same — only the `style` object changes).

6. **Label + host text:**
   - Change the label span's className from `font-medium` to `font-semibold`, always `text-[#fbf5e8]` (drop the ternary that swapped between `text-[#fbf5e8]` and `text-foreground`), and add inline `style={{ letterSpacing: "-0.005em", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}`.
   - Change the host secondary line's `text-muted-foreground/60` classes on both the `Server` icon and the host name `<span>` to inline `style={{ color: "rgba(255,235,190,0.65)" }}`. Drop the `text-muted-foreground/60` classes on those two elements only.

7. **bodyBaseClass:** remove the `hover:bg-white/[0.03]` / `active:bg-white/[0.03]` fragments (the hover treatment now lives on the bubble shadow / lift, not a translucent overlay) and remove the `border border-transparent` fragment (we're setting `border` in inline style now). The remaining class string should stay:
   ```
   const bodyBaseClass =
     `${rowMinH} ${rowPadding} flex items-center ${rowGap} ` +
     "cursor-pointer select-none relative z-10";
   ```

8. **WIP dot render slot (right-meta column, after the desktop PinAction slot at line 437):**
   ```
   {isWip && (
     <span
       aria-label="working"
       data-pv-conv-wip-dot="true"
       className="inline-block w-2 h-2 rounded-full"
       style={{
         background: hue == null
           ? "rgba(220,225,245,0.95)"
           : `hsla(${hue}, 85%, 65%, 0.95)`,
         boxShadow: hue == null
           ? "0 0 10px 1px rgba(220,225,245,0.85), 0 0 20px 2px rgba(220,225,245,0.35)"
           : `0 0 10px 1px hsla(${hue}, 85%, 55%, 0.85), 0 0 20px 2px hsla(${hue}, 85%, 55%, 0.35)`,
         animation: "pv-conv-wip-pulse 1.35s ease-in-out infinite",
       }}
     />
   )}
   ```

9. **Do NOT touch** the header comment block that describes the original avatar radial-gradient (lines 111-113 are prose comments); rewrite those comments to accurately describe the new IdentityBadge-derived linear-gradient. Same for the "Selected-row treatment" comment block (lines 128-131) — update prose to reflect the new "every row gets the bubble; selected/hover overlay on top" reality.

### 2B — PrettyConversationsPanel.tsx

At each `<PrettyConversationRow ... />` opening tag (3 sites — lines ~268, ~317, ~335 based on grep), add `isWip={false}` as a prop. Keep it on its own line for diff cleanliness. NO store subscription, NO conditional, NO import changes.

Comment above the FIRST occurrence:
```
// isWip={false} pass-through — patch #136 render slot; patch #137 will
// wire this to the WIP-vs-idle store subscription (one-line change here).
```
  </action>
  <verify>
    <automated>node -e "const s = require('fs').readFileSync('src/ui/features/pretty-conversations/PrettyConversationRow.tsx','utf8'); if(!s.includes('isWip')) throw new Error('missing isWip prop'); if(!s.includes('pv-conv-wip-pulse')) throw new Error('missing animation name'); if(!s.includes('linear-gradient(160deg, hsla(') &amp;&amp; !s.includes('linear-gradient(160deg, hsla(\${hue}')) throw new Error('missing hue linear-gradient body'); if(!/isWip=\{false\}/.test(require('fs').readFileSync('src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx','utf8'))) throw new Error('panel not threaded');"</automated>
  </verify>
  <done>PrettyConversationRow renders full bubble treatment for every hue-carrying row (no longer gated on `selected`), avatar uses linear-gradient (radial-gradient removed), `isWip` prop accepted + WIP dot slot rendered when true with `aria-label="working"` and `data-pv-conv-wip-dot="true"`, Panel threads `isWip={false}` at all 3 render sites. All touch/swipe/pin/keyboard/RDP semantics preserved.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Update + extend PrettyConversationRow.test.tsx</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx</files>
  <behavior>
    - Existing 11 tests still pass. Any computed-style assertion that referenced the old radial-gradient avatar or the reduced-alpha selected-only body must be updated to the new full-alpha linear-gradient values.
    - New Test 12: unselected non-RDP row with hue set renders a body element whose inline `style.background` contains `linear-gradient(160deg, hsla(` — proves the bubble treatment now applies to unselected rows.
    - New Test 13: `isWip={true}` renders a descendant with `aria-label="working"` and `data-pv-conv-wip-dot="true"`.
    - New Test 14 (defensive): `isWip={true}` on a hue-null RDP row uses the neutral `rgba(220,225,245` background (not `hsla`).
  </behavior>
  <action>
1. Run `npm run test -- PrettyConversationRow --run` (or the repo's equivalent Vitest invocation — check `package.json` scripts if the `test` script differs) FIRST to identify which existing assertions broke from Task 2's visual pass.

2. For each broken test, update the expected computed-style value:
   - Old avatar assertion referencing `radial-gradient(circle at 30% 25%, hsla(` → new expectation `linear-gradient(160deg, hsla(` (still contains `hsla(${hue}` — assertion should probe for a substring).
   - Old selected-body assertion referencing `hsla(${hue}, 50%, 38%, 0.30)` → new `hsla(${hue}, 50%, 38%, 0.55)`.
   - Old selected-body assertion referencing `hsla(${hue}, 45%, 24%, 0.35)` → new `hsla(${hue}, 45%, 24%, 0.60)`.
   - If Test 11 ("No identity-chip in DOM") asserts absence via a class name that shifted, keep the assertion but rescope it to the identity-chip specific selector (session name IS identity name — should still hold; do not weaken).

3. Add Test 12 — unselected row gets bubble treatment:
   ```
   it("unselected non-RDP row with hue renders full hue-bubble body style", () => {
     currentIdentity = makeIdentity({ colorHue: 210 });
     const row = makeRow({ /* fixture with targetTmuxSession matching identity */ });
     const { getByRole } = render(
       <PrettyConversationRow
         row={row} selected={false} pinned={false} variant="desktop"
         onSelect={() => {}} onTogglePin={() => {}}
       />
     );
     const body = getByRole("button");
     const bg = (body as HTMLElement).style.background;
     expect(bg).toContain("linear-gradient(160deg, hsla(210");
     expect(bg).toContain("50%, 38%, 0.55");
   });
   ```

4. Add Test 13 — isWip dot renders with correct a11y:
   ```
   it("isWip={true} renders pulse dot with aria-label='working'", () => {
     currentIdentity = makeIdentity({ colorHue: 210 });
     const row = makeRow({ /* fixture */ });
     const { getByLabelText } = render(
       <PrettyConversationRow
         row={row} selected={false} pinned={false} variant="desktop"
         onSelect={() => {}} onTogglePin={() => {}}
         isWip={true}
       />
     );
     const dot = getByLabelText("working");
     expect(dot.getAttribute("data-pv-conv-wip-dot")).toBe("true");
     expect(dot.style.animation).toContain("pv-conv-wip-pulse");
   });
   ```

5. Add Test 14 — isWip neutral fallback:
   ```
   it("isWip on RDP row uses neutral rgba dot (not hsla)", () => {
     currentIdentity = null;
     const row = makeRow({ rdpHostRow: true });
     const { getByLabelText } = render(
       <PrettyConversationRow
         row={row} selected={false} pinned={false} variant="desktop"
         onSelect={() => {}} onTogglePin={() => {}}
         isWip={true}
       />
     );
     const dot = getByLabelText("working");
     expect(dot.style.background).toContain("rgba(220,225,245");
   });
   ```

6. Update the header comment count from "11 tests" to "14 tests" and add three new bullet lines describing the new coverage.

7. Rerun `npm run test -- PrettyConversationRow --run`. All 14 pass.
  </action>
  <verify>
    <automated>npm run test -- PrettyConversationRow --run 2>&amp;1 | tail -30</automated>
  </verify>
  <done>All 14 tests green; header comment count updated; new tests cover unselected-hue-body + WIP dot a11y + neutral WIP fallback.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| identities-store → row | Runtime `hue` (integer 0-359) is interpolated into inline CSS strings via `${hue}`. |
| WIP dot animation | CSS animation on every visible row when `isWip={true}` (patch #137 will control the boolean). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick136-01 | Injection | `hsla(${hue},…)` template literals in style attrs | mitigate | `hue` is `identity.colorHue: number \| null`. TypeScript enforces number; identities-store validates on write. No user-supplied string ever reaches the CSS template. Existing pattern used verbatim by ChatMessage.tsx:124-127 + IdentityBadge.tsx:58-62. |
| T-quick136-02 | Performance / DoS | pv-conv-wip-pulse animation running on N rows | accept | `isWip={false}` on every render site in this patch — animation never fires. `prefers-reduced-motion` fallback disables animation for users with the OS flag set. Patch #137 will enforce at-most-one-WIP-row invariant at the store level. |
| T-quick136-03 | Tampering | npm/pip/cargo installs | n/a | No package installs in this patch. |
</threat_model>

<verification>
Task 1: `grep -q "pv-conv-wip-pulse"` in `src/ui/index.css` and `grep -q "prefers-reduced-motion"` and `grep -q "data-pv-conv-wip-dot"`.

Task 2: `isWip` prop threaded (grep row .tsx + panel .tsx); `linear-gradient(160deg, hsla(` in row .tsx body path; `radial-gradient` removed from row .tsx avatar path (grep `-v` check).

Task 3: `npm run test -- PrettyConversationRow --run` all green (14 tests).

NO `npm run build`. NO `docker compose up`. NO deploy verification.
</verification>

<success_criteria>
- Every non-RDP `PrettyConversationRow` with `hue != null` renders the full pretty-view bubble treatment (0.55/0.60 gradient, 0.32 hue border, multi-stop shadow) regardless of `selected`.
- Selected & hover states apply the documented alpha overlays.
- Avatar disc uses linear-gradient + hue border + IdentityBadge-derived multi-stop shadow (no radial-gradient anywhere).
- RDP + fallback branches use the neutral values documented in task_spec.
- `isWip` prop accepted; when true renders `aria-label="working"` pulse dot with `data-pv-conv-wip-dot="true"`; keyframes + reduced-motion fallback live in `src/ui/index.css`.
- Panel threads `isWip={false}` at all 3 render sites; comment above the first site marks it as patch-#136-render-slot / patch-#137-wiring-point.
- All 14 Vitest tests pass (11 preserved + 3 new).
- Commit lands (single commit) with the message shape:
  `feat(pretty-conversations): patch #136 — full pretty-view bubble+badge restyle for every row (locked from Ashley's mock)`
- No build, no deploy, no `skynet-patches.md` write-up. Chrome outside `src/ui/features/pretty-conversations/*` and `src/ui/index.css` UNTOUCHED.
</success_criteria>

<output>
Commit as a single fork patch (#136). No SUMMARY file required for a quick patch of this shape (per fleet rules: quick-mode restyles don't get phase SUMMARYs).
</output>
