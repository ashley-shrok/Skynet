---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 04
type: execute
wave: 2
depends_on: []
files_modified:
  - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
autonomous: false
requirements:
  - F-5
  - D-12
  - D-13

must_haves:
  truths:
    - "In relay case (agent participant with meter): the appendage below each agent's IdentityBadge reads visually as a drawer peeking from behind the pill — top edge tucked ~8px behind the pill's bottom, squared top corners, rounded bottom corners (6px), no visible top border on the meter-well."
    - "The pill's existing drop-shadow (IdentityBadge.tsx:121, `0 8px 24px rgba(0,0,0,0.6)`) lands on the drawer surface, cementing the layering."
    - "Meter well internals (12-segment amber/green/red bar + reset button + band computation) are byte-identical to pre-plan — only chrome (wrapper geometry + border-radius + border-top tokens) changed."
    - "IdentityBadge.tsx is read-only in this plan (scope constraint per CONTEXT.md)."
  artifacts:
    - path: "src/ui/features/pretty-view/AgentBadgeWithMeter.tsx"
      provides: "Drawer wrapper around data-appendage div with tuck geometry per Variant A prototype"
      contains: "data-drawer=\"true\""
  key_links:
    - from: "src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (new drawer wrapper)"
      to: "existing data-appendage=\"true\" div at L189"
      via: "DOM parent-child wrapping"
      pattern: "data-drawer=\"true\""
    - from: "the drawer's z-index/margin-top"
      to: "the pill's implicit stacking context above"
      via: "z-index: 1 on drawer, pill's drop-shadow lands on drawer surface"
      pattern: "z-index"
---

<objective>
Wrap the existing `data-appendage="true"` div in `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` with a drawer container implementing Variant A ("simple slotted drawer") of the meter-tasting prototype at `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html`. Adjust the meter-well's corner-radius + border-top tokens so the drawer reads as "the meter is being pulled out from behind the pill." Zero change to meter internals (segments, reset button, band computation).

Purpose: Ship F-5 per D-12/D-13. The design tasting on 2026-09-10 converged on Variant A "simple slotted"; the prototype's CSS at meter-tasting.html:164-177 is the locked visual reference. In the shipped Phase 93 tree, the appendage sits `mt-1` (4px) below the pill and reads as a free-floating chip. The drawer treatment tucks the appendage's top edge behind the pill's bottom (margin-top: -8px, z-index: 1 vs pill's z-index: 2), rounds only the bottom corners (6px), and removes the top border (invisible tuck edge). The pill's existing drop-shadow lands on the drawer surface reinforcing "pill is in front."

Output: one file touched (AgentBadgeWithMeter.tsx); the `data-appendage="true"` div is wrapped in a new drawer container; the meter-well's border-radius / border-top classes are adjusted per prototype. Zero change to IdentityBadge, meter segments, reset button, or band-computation logic.

Wave 2 in parallel with Plan 03 — file-disjoint (Plan 03 touches ComposeBox + PrettyView; this touches only AgentBadgeWithMeter). Includes a checkpoint:human-verify at the end because the drawer geometry has one landmine (the pill is `absolute top-4 right-5` inside its own rootClassName — the tuck math might need executor discretion per D-13 within the 6-10px range).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/shapes/shape-phase-93-uat-polish-arc.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-CONTEXT.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| None | Pure client-side render — Tailwind class + wrapper JSX changes only. No new data flow. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-04-01 | Tampering | Meter well internals (segments, reset, band computation) | mitigate | Scope discipline — this plan modifies wrapper + corner-radius + border-top tokens ONLY. Byte-identical parity with the ComposeBox harness meter enforced per Phase 93 D-10 (AgentBadgeWithMeter.tsx:44-47 header comment). Regression covered by existing AgentBadgeWithMeter.test.tsx. |
| T-97-04-02 | Tampering | IdentityBadge primitive | mitigate | IdentityBadge.tsx explicitly out-of-scope per CONTEXT.md; grep-verify zero touches. |
| T-97-04-SC | Tampering | package installs | accept | No package installs. |

Severity: LOW / none-new. Pure CSS chrome change on a single client-side component. No new endpoints, no new state, no auth surface.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Wrap appendage in drawer + adjust meter-well corners per Variant A prototype</name>
  <files>
    src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
  </files>
  <read_first>
    - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (targeted reads: L1-50 for the file header + Phase 93 provenance comment; L80-105 for props + signature; L183-220 for the root cell + IdentityBadge mount + appendage div at L189-192; L189-298 for the meter-well body — segments, reset button, gradient/band logic — this is the byte-preserved zone)
    - ~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html (targeted read L150-230 — Variant A CSS at L164-177 is the locked reference; also grep for `v-a .drawer` and `v-a .meter-well` for the two selectors' rule bodies)
    - src/ui/features/pretty-view/IdentityBadge.tsx (targeted read L100-140 for rootClassName + drop-shadow definition at L121; L82 for the isDragSource gate — read-only, do NOT modify)
    - src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx (existing test file — read for class-list assertion patterns on the appendage)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 5" (all subsections — pill absolute positioning landmine; "safer alternative: re-parent into an absolute-positioned wrapper" note; overflow:hidden parent check; discipline about meter-well internals byte-identical)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 5 — Meter drawer chrome" (prototype CSS verbatim; extension shape verbatim; landmines)
  </read_first>
  <action>
    Single file modified: `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx`.

    **Change 1 — Wrap the `data-appendage="true"` div at L189-192 in a drawer container:**

    Current shape (L189-192):

    ```
    <div
      data-appendage="true"
      data-role="agent-appendage"
      className="mt-1 flex flex-row items-stretch gap-0"
    >
      {/* meter-well body — segments + reset button ... */}
    </div>
    ```

    Extension shape — wrap with a `data-drawer="true"` container and REMOVE the `mt-1` (4px spacer) from the appendage (replaced by the drawer's negative margin + padding):

    ```
    {/* Phase 97 Finding 5: drawer wrapper — Variant A "simple slotted"
        per meter-tasting.html L164-177. margin-top: -8px tucks the drawer's
        top edge behind the pill's bottom; padding-top: 10px keeps the meter
        body away from the tucked edge; z-index: 1 sits behind the pill's
        implicit stacking so the pill's drop-shadow lands on the drawer. */}
    <div
      data-drawer="true"
      className="relative -mt-2 pt-[10px]"
      style={{ zIndex: 1 }}
    >
      <div
        data-appendage="true"
        data-role="agent-appendage"
        className="flex flex-row items-stretch gap-0"
      >
        {/* meter-well body — segments + reset button — unchanged */}
      </div>
    </div>
    ```

    Note: the drawer wrapper uses `-mt-2` (Tailwind: -8px) matching the prototype's `margin-top: -8px`. `pt-[10px]` uses Tailwind arbitrary-value syntax matching `padding-top: 10px`. `zIndex: 1` via inline style because Tailwind's `z-1` may map to `z-index: 1` but the arbitrary syntax `z-[1]` is safer if there's any concern; inline style is explicit and unambiguous.

    The `mt-1` on the appendage is REMOVED — its 4px spacer role is replaced by the drawer's negative-margin + padding-top geometry. This is the key visual difference: the drawer's `-8px` margin-top puts the meter under the pill's bottom edge; the drawer's `10px` padding-top adds space back inside the drawer above the meter body.

    **Change 2 — Adjust the meter-well corner-radius + border-top tokens:**

    Locate the meter-well div inside the appendage (grep for `rounded-md` or similar within the L189-298 block; the exact line varies by shipped state — read the file after the wrapper change to identify). The current meter-well className presumably includes `rounded-md` (all corners rounded) plus a top border via `border` shorthand.

    Change tokens per Variant A prototype (meter-tasting.html L170-176):
    - Add `rounded-b-md` — bottom corners 6px rounded.
    - REMOVE `rounded-md` — replaced by rounded-b-md above.
    - Add `border-t-0` — no top border (drawer edge invisible).
    - Preserve `border`, `border-[rgba(220,225,245,0.1)]` and other border tokens as-is (only the top border is removed).

    If the meter-well uses `rounded-md` AND `rounded-t-md` explicitly as separate tokens, remove `rounded-t-md` and replace `rounded-md` with `rounded-b-md`. If the meter-well uses ONLY `rounded-md`, replace with `rounded-b-md`. The end state is: top corners squared, bottom corners 6px rounded, top border 0.

    Do NOT modify:
    - **IdentityBadge.tsx** — scope constraint (grep-verify: `git diff --name-only` after this plan should show only `AgentBadgeWithMeter.tsx`).
    - **Segments, reset button, band computation** — the meter-well's INNER body (segment divs, reset button JSX, gradient/band logic at L~200-280 range depending on shipped state) is byte-identical.
    - **`AgentBadgeWithMeterProps` interface** — no new props for this task (Plan 06 will add `tabId?` if it ships; this task does not).
    - **Root `<div className="relative flex flex-col items-center gap-1">` at L183** — cell layout preserved.

    Landmine handling (per RESEARCH § Finding 5):
    - **The pill is `absolute top-4 right-5` inside its own rootClassName.** Before committing this task, verify visually in DevTools that the `-mt-2` (i.e. margin-top: -8px on the drawer) achieves the tucked-behind-pill look. If the pill's absolute-positioning inside the flex-col cell makes the negative margin land elsewhere than intended, switch the drawer to absolute positioning explicitly:
      ```
      style={{ position: "absolute", top: "calc(<pill-height-computed> - 8px)", left: 0, right: 0, zIndex: 1 }}
      ```
      Or replace `-mt-2` with a computed `top-N` value. Executor's call per D-13 "6-10px tuck" tolerance. Document the chosen approach in the SUMMARY.
    - **Verify `overflow: hidden` does not clip the drawer.** MultiBadgeAnchor's cell at MultiBadgeAnchor.tsx:173 is `flex flex-col items-stretch` — no overflow clip per RESEARCH landmine — should be safe. Confirm with DevTools.
    - **z-index: 1 is deliberately BELOW pill's stacking.** Do NOT set drawer to z-index 2 or above (inverts layering).

    Add / extend `AgentBadgeWithMeter.test.tsx` with two assertions:
    - The rendered output has an element with `data-drawer="true"` wrapping an element with `data-appendage="true"` (DOM structure assertion — use `getByAttribute` or querySelector).
    - The `data-drawer="true"` element's className contains `-mt-2` and `pt-[10px]` (class list assertion).
    - The meter-well element (find via its existing test-id or data attribute) has `rounded-b-md` and `border-t-0` classes; does NOT have `rounded-md` (full-rounded) or `rounded-t-md`.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'data-drawer="true"' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q '\-mt-2' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q 'pt-\[10px\]' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q 'zIndex: 1' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q 'rounded-b-md' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      grep -q 'border-t-0' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx && \
      (grep -c 'data-appendage="true"' src/ui/features/pretty-view/AgentBadgeWithMeter.tsx | grep -q '^1$') && \
      (git diff --name-only src/ui/features/pretty-view/IdentityBadge.tsx | wc -l | grep -q '^0$') && \
      npx vitest run --related src/ui/features/pretty-view/AgentBadgeWithMeter.tsx 2>&1 | tee /tmp/97-04-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - AgentBadgeWithMeter.tsx contains `data-drawer="true"` exactly once (grep count = 1).
    - AgentBadgeWithMeter.tsx contains `-mt-2` (drawer negative margin, tuck depth) — grep-verifiable.
    - AgentBadgeWithMeter.tsx contains `pt-[10px]` (drawer padding-top, meter body clearance) — grep-verifiable.
    - AgentBadgeWithMeter.tsx contains `zIndex: 1` in an inline style (behind pill's implicit stacking) — grep-verifiable.
    - AgentBadgeWithMeter.tsx contains `rounded-b-md` (bottom corners only) — grep-verifiable.
    - AgentBadgeWithMeter.tsx contains `border-t-0` (no top border on meter-well) — grep-verifiable.
    - AgentBadgeWithMeter.tsx `data-appendage="true"` count is still exactly 1 (single inner div preserved, not duplicated).
    - AgentBadgeWithMeter.tsx does NOT contain `mt-1` (or the `mt-1` that was on the appendage is removed, replaced by drawer's `-mt-2 pt-[10px]` geometry) — grep count of `mt-1` on the appendage line = 0.
    - IdentityBadge.tsx is NOT modified — `git diff --name-only src/ui/features/pretty-view/IdentityBadge.tsx` returns empty (or `git status` shows it untouched).
    - AgentBadgeWithMeterProps interface unchanged from pre-plan (no new fields; Plan 06 handles tabId if it ships).
    - Scoped Vitest run passes green including new drawer-structure + class-list assertions.
    - Meter well internals (segments, reset button, band computation) byte-identical: grep count of `SEG_COUNT` (or equivalent segment-count constant), reset button JSX, and band computation function unchanged.
  </acceptance_criteria>
  <done>AgentBadgeWithMeter.tsx has a drawer wrapper around the appendage div, with -mt-2 + pt-[10px] + zIndex 1 per Variant A prototype. Meter-well has rounded-b-md + border-t-0 tokens. Meter internals byte-identical. IdentityBadge untouched. All scoped tests green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Human verification of drawer visual — "meter reads as pulled from behind the pill"</name>
  <what-built>
    - AgentBadgeWithMeter.tsx: drawer wrapper (data-drawer="true", -mt-2, pt-[10px], zIndex: 1) around the existing data-appendage div.
    - Meter-well: rounded-b-md (bottom corners only) + border-t-0 (no top border).
    - Meter internals byte-identical; IdentityBadge untouched.
  </what-built>
  <how-to-verify>
    1. Run the dev server; open a relay room that has at least one agent participant in the participant list.
    2. Inspect an agent's badge + meter chrome visually. Confirm:
       a. The meter's top edge tucks BEHIND the pill's bottom (not below it with a visible gap).
       b. The meter's bottom corners are rounded (6px); top corners are squared.
       c. The pill's drop-shadow lands on the drawer surface (visible dark halo below the pill onto the meter).
       d. The 12-segment amber/green/red bar renders identically to before — no color/spacing/tick change.
       e. The reset button inside the meter well is at its usual position.
    3. If the drawer geometry looks off (e.g. the meter doesn't visually tuck, or overlaps the pill instead of tucking under), execute the RESEARCH fallback: switch to absolute positioning per the "safer alternative" note in RESEARCH § Finding 5 landmines. Document the change in the SUMMARY.
    4. Executor may fine-tune the tuck depth in the 6-10px range per D-13 (from -mt-1.5 = -6px to -mt-2.5 = -10px, using Tailwind arbitrary values `[-6px]` or `[-10px]` if needed). Reviewer at /close time verifies the drawer READS as pulled from behind the pill; exact numbers below that threshold are executor's call per CONTEXT.md § Claude's Discretion.
    5. Approve or flag issues.
  </how-to-verify>
  <resume-signal>
    Type one of:
    - "approved" — proceed.
    - "adjust tuck to <Npx>" — executor tunes and re-verifies.
    - "issues: <describe>" — return to Task 1 to revise.
  </resume-signal>
</task>

</tasks>

<verification>
- Task 1 grep gates confirm: drawer wrapper present with correct chrome tokens; meter-well corner + border tokens adjusted; IdentityBadge untouched.
- Task 2 human-verify checkpoint gates on visual outcome per D-13 (prototype-matching within tuck-depth tolerance).
- Regression floor: harness case doesn't render MultiBadgeAnchor at all (the AgentBadgeWithMeter component is only mounted in the relay case per PATTERNS.md § "Harness case regression floor" item 5). Existing AgentBadgeWithMeter.test.tsx assertions continue to pass.
</verification>

<success_criteria>
- AgentBadgeWithMeter.tsx: drawer wrapper with data-drawer="true", -mt-2, pt-[10px], zIndex 1; meter-well: rounded-b-md + border-t-0.
- IdentityBadge.tsx: untouched.
- Meter internals (segments, reset button, band computation): byte-identical.
- Visual outcome: drawer reads as pulled from behind the pill, per Variant A prototype.
- All scoped Vitest runs pass green.
- Human-verify checkpoint returns "approved" (possibly with a fine-tune to the tuck depth within 6-10px).
</success_criteria>

<output>
Create `.planning/phases/97-.../97-04-SUMMARY.md` when done. Include:
- Chosen tuck depth (e.g. -8px, -6px, -10px) and whether positioning is via `-mt-N` or absolute positioning per RESEARCH fallback
- Confirmation that pill's drop-shadow visually lands on the drawer surface
- Screenshot or descriptive comparison of drawer chrome before/after
</output>
