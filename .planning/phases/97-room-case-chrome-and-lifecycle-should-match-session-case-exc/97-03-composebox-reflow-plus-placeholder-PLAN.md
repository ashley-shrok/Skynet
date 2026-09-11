---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 03
type: execute
wave: 2
depends_on:
  - 97-02
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
requirements:
  - F-3
  - F-6
  - D-08
  - D-09
  - D-10
  - D-14

must_haves:
  truths:
    - "In relay case: ComposeBox textarea has no `pl-11` (44px) left gutter — the ghost gutter reserved for the hidden Paperclip button is removed."
    - "In relay case: QueuePlusTab pebble (top-edge affordance) has enough vertical headroom that its clip-path silhouette is not clipped by the ComposeBox outer container edge."
    - "In relay case: ComposeBox's total vertical geometry (bounding rect height at same viewport) matches the harness case within 1px, satisfying D-09 vertical parity."
    - "In relay case: ComposeBox placeholder reads `Message room…` (capital M, U+2026 ellipsis) — not `Message Claude…`, not `Message undefined…`, not blank."
    - "In harness case: byte-identical to pre-plan — Row 1 renders, Paperclip renders when showPaperclip is true, pl-11 gutter present, placeholder reads `Message <identityName>…` unchanged."
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Mode-gated pl-11 (relay case: absent) + relay-case vertical spacer for QueuePlusTab headroom"
      contains: "mode !== \"relay\""
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Case-branched identityName='room' for relay ComposeBox mount"
      contains: "source.kind === \"relay\" ? \"room\" :"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx:4249"
      to: "src/ui/features/pretty-view/ComposeBox.tsx:2750 (placeholder template)"
      via: "identityName prop"
      pattern: "identityName={source.kind === \"relay\" \\? \"room\" :"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (mode prop)"
      to: "textarea className computation at L2836"
      via: "mode !== \"relay\" gate"
      pattern: "showPaperclip && mode !== \"relay\" && \"pl-11\""
---

<objective>
Ship two file-adjacent slices in Wave 2 that together give the relay-case ComposeBox visual parity with the harness case (D-09 no accidental inheritance): (F-3) kill the ghost `pl-11` left-gutter on the textarea + give the QueuePlusTab top-edge pebble vertical headroom via a mode-conditional spacer; (F-6) case-branch the `identityName` prop at the PrettyView call site so the placeholder reads `Message room…` in the relay case.

Purpose: Phase 93 D-11 hid Row 1 monolithically when `mode === "relay"` at ComposeBox.tsx:2334, but the reflow that should have followed never happened — the textarea's `pl-11` (44px left padding) at ComposeBox.tsx:2836 still reserves space for a Paperclip that no longer renders, and the QueuePlusTab pebble (positioned relative to the primary wrapper at ComposeBox.tsx:2695) has no headroom because Row 1's ~32-44px above the textarea is gone. Alice's third symptom (input vertical shortness) is a knock-on: the whole compose column is short. Fixing the ghost gutter + adding a mode-conditional vertical spacer restores geometry parity. Separately, the placeholder currently falls back to `Message Claude…` because `pvIdentity` is undefined in the relay case; per D-14 the case-branched value is the literal string `"room"` yielding `Message room…`.

Output: two files touched; mode-conditional class tokens at ComposeBox.tsx (relay case: no `pl-11`, plus a spacer skeleton for QueuePlusTab headroom); a case-branch at PrettyView.tsx:4249 flowing `"room"` into `identityName` when `source.kind === "relay"`.

Sequenced AFTER Plan 02 because both plans touch PrettyView.tsx — this plan modifies the relay ComposeBox mount call at L4249 while Plan 02 modifies the veil-arm effects at L2002-2020. File-conflict resolution: Plan 02 first (Wave 1), Plan 03 second (Wave 2).
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
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-02-SUMMARY.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| None | Pure client-side render — no new trust boundary crossed; string literals only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-03-01 | Tampering | Harness case ComposeBox chrome | mitigate | All new class tokens gated on `mode === "relay"` (or its inverse `mode !== "relay"`) — the harness path is either unchanged or explicitly the default branch. Regression covered by existing `ComposeBox.mode-hide.test.tsx`. |
| T-97-03-02 | Tampering | Placeholder string in harness case | mitigate | Ternary at PrettyView.tsx:4249 with harness case as the false-branch keeps existing `pvIdentity?.displayName` flow unchanged for `source.kind === "harness"`. |
| T-97-03-SC | Tampering | package installs | accept | No package installs; RESEARCH § Package Legitimacy Audit confirms zero. |

Severity: LOW / none-new. Two Tailwind class token changes + one string literal case-branch. No new endpoints, no user input parsing, no crypto surface.
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Kill ghost pl-11 gutter + add QueuePlusTab vertical spacer (F-3)</name>
  <files>
    src/ui/features/pretty-view/ComposeBox.tsx
  </files>
  <read_first>
    - src/ui/features/pretty-view/ComposeBox.tsx (targeted reads: L2320-2350 for Row 1 mode-gate reference pattern at L2334; L2680-2740 for the primary wrapper at L2695 + QueuePlusTab call site at L2704-2710; L2790-2860 for the textarea className computation with the `pl-11` at L2836; L2900-2920 for the Paperclip mode-gate at L2908; L3160-3220 for the QueuePlusTab function body with its absolute `-top-N` offset)
    - src/ui/features/pretty-view/ComposeBox.mode-hide.test.tsx (existing test file — read for the Row 1 hide + Paperclip hide test patterns; this test file will be extended, not replaced)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 3" (all subsections — three-step fix approach; landmines "do NOT hide the pebble", "do NOT reintroduce Row 1 chrome", "do NOT touch min-h-8! specificity", "do NOT let reflow spill into harness")
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 3 — ComposeBox ghost gutter + vertical fit + pebble headroom" (both Option A padding-top and Option B invisible spacer are documented; use Option B — the invisible Row 1 spacer skeleton per RESEARCH recommendation "Option B is cleaner (preserves geometry byte-for-byte; Alice's ask is parity in feel)")
  </read_first>
  <action>
    Two atomic changes in `src/ui/features/pretty-view/ComposeBox.tsx`:

    **Change 1 — Mode-gate the `pl-11` gutter at L2836 (Step 1 in RESEARCH):**

    Locate the textarea className computation. The current line at L2836 reads:

    ```
    showPaperclip && "pl-11",
    ```

    Change to:

    ```
    showPaperclip && mode !== "relay" && "pl-11",
    ```

    Mirror the exact idiom used at L2334 (Row 1 gate) and L2908 (Paperclip gate) — Phase 93 D-11's monolithic mode-gate discipline. Do NOT change any other className token in this list. Do NOT touch `min-h-8!`, `dark:bg-input/30`, or any other `!` specificity marker (RESEARCH landmine: "load-bearing against shadcn Textarea").

    **Change 2 — Add relay-mode invisible Row 1 spacer skeleton (Step 2 in RESEARCH, Option B):**

    Locate the Row 1 mode-gate at L2334. Current shape:

    ```
    {mode !== "relay" && (
    <div data-testid="compose-row-1" className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
      ... entire Row 1 body ...
    </div>
    )}
    ```

    Add a peer conditional block immediately after this Row 1 mode-gate (i.e. as a sibling in the JSX; placement: right after the closing `)}` of the Row-1 conditional). The new block:

    ```
    {mode === "relay" && (
      <div
        data-testid="compose-row-1-relay-spacer"
        aria-hidden="true"
        className={cn(
          "mb-[3px]",
          isTouchDevice ? "min-h-[44px]" : "min-h-8",
        )}
      />
    )}
    ```

    This spacer's dimensions are byte-identical to the Row 1's outer envelope (same `mb-[3px]`, same `min-h-[44px]` / `min-h-8` conditional on `isTouchDevice`). It provides the vertical headroom above the textarea's primary wrapper that Row 1 provides in the harness case — so QueuePlusTab's `-top-N` absolute offset (positioned relative to the primary wrapper at L2695) has room to sit above the textarea without clipping the ComposeBox outer container edge.

    `aria-hidden="true"` per accessibility discipline — the spacer is purely visual scaffolding, invisible in the a11y tree. `data-testid="compose-row-1-relay-spacer"` gives the reflow test a query hook.

    Do NOT change the Row 1's `mode !== "relay"` gate itself (still hides monolithically per D-11). Do NOT add any Row 1 content INTO the relay spacer (RESEARCH landmine: "do NOT reintroduce Row 1 chrome to solve pebble headroom"). Do NOT add mode-conditional `pt-N` to the primary wrapper (that was Option A; use Option B per RESEARCH recommendation).

    Do NOT touch the primary wrapper at L2695 (`<div className="relative flex-1 self-stretch" data-testid="compose-primary-wrapper">`) — leave it as-is; the vertical geometry is now handled by the spacer above.

    Do NOT modify the QueuePlusTab function body at L3167-3210 — its `-top-N` offset is unchanged; the spacer above the primary wrapper gives it the room it needs.

    Extend `ComposeBox.mode-hide.test.tsx` with two new assertions:
    - When `mode="relay"` is passed to ComposeBox, the textarea does NOT have the `pl-11` class (query the textarea via existing test-id or role, check its classList).
    - When `mode="relay"` is passed, an element with `data-testid="compose-row-1-relay-spacer"` exists in the DOM.
    - When `mode="harness"` (or default) is passed, the textarea HAS the `pl-11` class AND the spacer does NOT exist (regression floor).

    If the test file structure doesn't accommodate these additions cleanly, add them to a new file `ComposeBox.relay-reflow.test.tsx` — mirror the existing test file's setup.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'showPaperclip && mode !== "relay" && "pl-11"' src/ui/features/pretty-view/ComposeBox.tsx && \
      grep -q 'data-testid="compose-row-1-relay-spacer"' src/ui/features/pretty-view/ComposeBox.tsx && \
      grep -q 'aria-hidden="true"' src/ui/features/pretty-view/ComposeBox.tsx && \
      grep -c 'mode !== "relay"' src/ui/features/pretty-view/ComposeBox.tsx | awk '$1 >= 3 { exit 0 } { exit 1 }' && \
      grep -c 'mode === "relay"' src/ui/features/pretty-view/ComposeBox.tsx | awk '$1 >= 1 { exit 0 } { exit 1 }' && \
      npx vitest run --related src/ui/features/pretty-view/ComposeBox.tsx 2>&1 | tee /tmp/97-03-task1-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - ComposeBox.tsx contains exactly the string `showPaperclip && mode !== "relay" && "pl-11"` (grep-verifiable, single occurrence — the extended `pl-11` gate).
    - ComposeBox.tsx contains a JSX block with `data-testid="compose-row-1-relay-spacer"` and `aria-hidden="true"` (both attributes grep-verifiable on nearby lines).
    - Grep count of `mode !== "relay"` in ComposeBox.tsx is >= 3 (Row 1 gate at L2334, Paperclip gate at L2908, and the new pl-11 gate).
    - Grep count of `mode === "relay"` in ComposeBox.tsx is >= 1 (the new spacer skeleton).
    - No modification to the primary wrapper at L2695 (`<div className="relative flex-1 self-stretch"` — grep-verifiable string still present unchanged).
    - No modification to QueuePlusTab function body at L3167-3210 (grep for its function signature, verify it exists and no `-top-` numeric offset in it was changed).
    - No modification to Textarea's `min-h-8!` or shadcn-related `!` specificity markers (grep count of `min-h-8!` unchanged from pre-plan baseline).
    - Scoped Vitest run against ComposeBox.tsx passes green including new assertions for pl-11 absence in relay mode + spacer presence in relay mode + regression floor for harness mode.
    - No modification to Row 1's own body content (grep: `data-testid="compose-row-1"` still exists exactly once; Row 1 mode-gate at L2334 still gates on `mode !== "relay"`).
  </acceptance_criteria>
  <done>ComposeBox.tsx has `pl-11` gated on `mode !== "relay"` + a new relay-mode invisible spacer skeleton peer of Row 1. Existing ComposeBox tests pass green including new mode-hide assertions.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Case-branch identityName='room' at PrettyView ComposeBox mount (F-6)</name>
  <files>
    src/ui/features/pretty-view/PrettyView.tsx
  </files>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.tsx (targeted reads: L4160-4270 for the entire ComposeBox mount block including the existing case-branches at L4171 `onOptimisticSend={source.kind === "relay" ? undefined : handleOptimisticSend}` and L4204 `canSend` override; L4249 for the identityName prop line; L1800-1830 for the pvIdentity derivation site for reference)
    - src/ui/features/pretty-view/ComposeBox.tsx (targeted read: L2750 — the placeholder template `\`Message ${identityName || "Claude"}…\`` — confirm the Unicode `…` at U+2026 verbatim)
    - src/ui/features/pretty-view/PrettyView.relay-source.test.tsx (existing test file — read for the mock ComposeBox assertion patterns; this test file will be extended with the placeholder verification)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 6" (Shape A recommended — case-branch at PrettyView call site; landmines about ellipsis U+2026 vs three dots, capital `Message` M, harness regression floor)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 6 — Placeholder copy" (Shape A extension shape verbatim, discipline about ellipsis preservation)
  </read_first>
  <action>
    Single-line change in `src/ui/features/pretty-view/PrettyView.tsx` at L4249.

    Current L4249:

    ```
    identityName={pvIdentity?.displayName}
    ```

    Change to:

    ```
    identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}
    ```

    Rationale: ComposeBox's template at ComposeBox.tsx:2750 (`placeholder={\`Message ${identityName || "Claude"}…\`}`) will now render `Message room…` for `source.kind === "relay"`, preserving the harness template's capital-M convention (per RESEARCH § Finding 6 landmine "capital M matches harness template convention"). D-14 verbatim (from CONTEXT.md): "Placeholder in the room case reads `message room` — Alice's phrasing." RESEARCH's SOFT judgment: capital M matches template convention. Lock: `Message room…`.

    Do NOT change:
    - The `\`Message ${identityName || "Claude"}…\`` template at ComposeBox.tsx:2750 (Shape B alternative is explicitly not the chosen path — Shape A concentrates case-branch discipline at the ComposeBox call site per Phase 93 D-11 discipline).
    - The ellipsis character — the existing template uses `…` (U+2026), NOT three dots. This case-branch passes a string that will be interpolated; the ellipsis lives in the template, not in the branched value. NO change needed to any ellipsis character.
    - Adjacent props at L4160-4270 (`onOptimisticSend`, `canSend`, `mode`, `handleTextareaClick`, etc.) — this is a single-line change on L4249 only.

    Extend `PrettyView.relay-source.test.tsx` with an assertion:
    - When mounted with `source={{kind:"relay",...}}`, the ComposeBox receives `identityName="room"` (assert via a mock ComposeBox that records its props, OR by mounting the real ComposeBox and querying the textarea's placeholder attribute for the string `Message room…`).

    If the test setup uses a real ComposeBox render, assert `screen.getByPlaceholderText("Message room…")` (with the U+2026 ellipsis verbatim). Verify the U+2026 character by copying it from ComposeBox.tsx:2750 into the test — do NOT hand-type three dots and expect the assertion to pass.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}' src/ui/features/pretty-view/PrettyView.tsx && \
      grep -c 'identityName={pvIdentity?.displayName}' src/ui/features/pretty-view/PrettyView.tsx | grep -q '^0$' && \
      grep -q '"Message ' src/ui/features/pretty-view/ComposeBox.tsx && \
      npx vitest run --related src/ui/features/pretty-view/PrettyView.tsx 2>&1 | tee /tmp/97-03-task2-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - PrettyView.tsx contains exactly the string `identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}` (grep-verifiable, single occurrence).
    - PrettyView.tsx no longer contains the un-branched string `identityName={pvIdentity?.displayName}` (grep count = 0 — old form completely replaced).
    - ComposeBox.tsx:2750 placeholder template is unchanged: still uses `Message ` prefix + ` ${identityName || "Claude"}` interpolation + `…` (U+2026) suffix.
    - PrettyView.relay-source.test.tsx contains an assertion that the ComposeBox receives / renders `Message room…` when mounted with `source.kind === "relay"`.
    - Scoped Vitest run against PrettyView.tsx passes green.
    - Regression floor: mount with `source={{kind:"harness",...}}` and `pvIdentity={{displayName: "Claude"}}` — placeholder should still read `Message Claude…` (existing PrettyView.test.tsx snapshot for harness case unchanged).
    - No other line at L4160-4270 modified beyond L4249 (git diff scope check).
  </acceptance_criteria>
  <done>PrettyView.tsx L4249 case-branches identityName between `"room"` (relay) and `pvIdentity?.displayName` (harness). Placeholder renders as `Message room…` in the relay case. Harness placeholder byte-identical. All scoped tests green.</done>
</task>

</tasks>

<verification>
- Task 1 grep gates confirm: pl-11 gate mode-gated, spacer skeleton present, existing chrome untouched.
- Task 2 grep gates confirm: single-line identityName case-branch present, old form gone, ellipsis U+2026 preserved.
- Visual verification (during execute-plan run — live browser): open a relay room, confirm (a) no left gutter on the textarea, (b) QueuePlusTab pebble not clipped, (c) placeholder reads `Message room…`, (d) overall ComposeBox height feels comparable to a harness-mode compose.
- Regression floor: harness-mode compose unchanged — Row 1 renders, Paperclip button + pl-11 gutter present, placeholder reads `Message <name>…`.
- Regression floor tests: ComposeBox.mode-hide.test.tsx + PrettyView.test.tsx pass green.
</verification>

<success_criteria>
- ComposeBox.tsx: `pl-11` gated on `mode !== "relay"`; relay-mode invisible spacer skeleton exists with `data-testid="compose-row-1-relay-spacer"` and `aria-hidden="true"` and dimensions byte-identical to Row 1's outer envelope.
- PrettyView.tsx L4249: `identityName={source.kind === "relay" ? "room" : pvIdentity?.displayName}` — single-line case-branch.
- Relay case ComposeBox renders `Message room…` in the placeholder.
- Relay case has no ghost `pl-11` left gutter.
- Relay case has QueuePlusTab headroom (pebble not clipped).
- Relay case has bounding-rect height comparable to harness case within 1px (D-09 vertical parity — verify visually or via getBoundingClientRect in a scoped test).
- Harness case byte-identical: Row 1 renders, Paperclip renders when showPaperclip is true, pl-11 gutter present, placeholder reads `Message <identityName>…`.
- All scoped Vitest runs pass green.
</success_criteria>

<output>
Create `.planning/phases/97-.../97-03-SUMMARY.md` when done. Include:
- Screenshot or descriptive comparison of relay-mode ComposeBox before/after (paste in a "Visual verification" section)
- Whether D-09 vertical parity is satisfied by construction (spacer replaces Row 1's vertical envelope) or required a residual fine-tune
- Confirmation that placeholder ellipsis is U+2026 (not three dots)
</output>
