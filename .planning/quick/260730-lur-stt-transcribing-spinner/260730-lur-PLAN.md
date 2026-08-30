---
phase: 260730-lur-stt-transcribing-spinner
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
autonomous: true
requirements:
  - 260730-lur-01
must_haves:
  truths:
    - "While voice.state === 'transcribing', the ComposeBox send button renders a spinning Loader2 icon instead of the paper-plane."
    - "The send button remains disabled and keeps aria-label='Send' while transcribing (rapid-tap double-fire guard from T-16-16 preserved)."
    - "When voice.state !== 'transcribing' AND asideActive === false, the send button still renders the exact original inline paper-plane SVG (patch #130 regression guard)."
    - "When asideActive === true, the button still renders the lucide X (Resume affordance) — untouched by this change."
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Loader2 spinner in send button during STT round-trip"
      contains: "Loader2"
    - path: "src/ui/features/pretty-view/ComposeBox.voice.test.tsx"
      provides: "Test coverage for the transcribing-state spinner branch"
      contains: "animate-spin"
  key_links:
    - from: "src/ui/features/pretty-view/ComposeBox.tsx"
      to: "lucide-react"
      via: "import { Loader2 } alongside existing Hourglass/X/etc."
      pattern: "Loader2.*lucide-react|lucide-react.*Loader2"
    - from: "ComposeBox send button else-of-asideActive branch"
      to: "showTranscribingSend flag (voice.state === 'transcribing')"
      via: "ternary that picks Loader2 vs inline paper-plane SVG"
      pattern: "showTranscribingSend.*Loader2|Loader2.*animate-spin"
---

<objective>
Swap the ComposeBox send button icon from the static paper-plane to a spinning `Loader2` while `voice.state === "transcribing"`, so Ashley gets visible in-button feedback that STT is in flight. The button already renders disabled during transcribing (via `showTranscribingSend` on line 1779); this change adds the visual signal that "something is happening" during the 1-3s round-trip to `/voice/transcribe`.

Purpose: Close the perceptual gap where the send button today just dims (disabled tint) with no motion — Ashley can't tell whether her Send-transcript tap registered or the app is stuck. A spinner in the same slot resolves that ambiguity without moving any layout.

Output: Single ComposeBox source edit (icon-branch swap + one added lucide import) plus one new test in the existing voice test file asserting the transcribing branch renders `animate-spin` and does NOT render the paper-plane path.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/ComposeBox.voice.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Render Loader2 in send button during voice.state === "transcribing"</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx, src/ui/features/pretty-view/ComposeBox.voice.test.tsx</files>
  <behavior>
    - Test A (new, appended to `describe("ComposeBox — Phase 16 voice flow")` block in `ComposeBox.voice.test.tsx` after Test 10, numbered as Test 11): While the STT fetch is in flight (voice.state === "transcribing"), the send button contains a spinning Loader2 element (selector: `button[aria-label="Send"] svg.animate-spin` OR `button[aria-label="Send"] [class*="animate-spin"]` — match the existing test file's stable-selector style, no reliance on internal lucide DOM), does NOT contain the paper-plane path (query for `path[d^="M14.536 21.686"]` inside the Send button and assert it is null), is still `disabled`, and keeps `aria-label="Send"`. To hold the transcribing state open, override the default fetch mock in beforeEach with `vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))` inside the test body (never-resolving promise), then follow the Test 8 pattern: click MicButton → await `Send transcript` button → `act()`-push a data chunk → click `Send transcript` → `await waitFor` until the disabled Send button re-appears (recording controls unmount) → assert the four properties above. Do NOT call `fetch.mockResolvedValue()` or advance any timers — the whole point is to freeze the transcribing state so the spinner is observable.
    - Test B (new, immediately follows Test A as Test 12): Idle regression guard — when voice is idle (no MicButton click), the send button renders the paper-plane inline SVG (`path[d^="M14.536 21.686"]` query returns a non-null element) and does NOT contain `animate-spin`. This proves the spinner is scoped to the transcribing branch and the paper-plane path is byte-preserved (patch #130 guard).
    - Do NOT modify Tests 1-10. Do NOT touch `ComposeBox.test.tsx`, `ComposeBox.aside-morph.test.tsx`, `ComposeBox.aside-props.test.tsx`, or `ComposeBox.recycle-disable.test.tsx` — this file is the additive voice test suite per its own header comment (lines 22-23).
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/ComposeBox.tsx`:

    1. Import addition (line 2): Add `Loader2` to the existing `lucide-react` named import so it reads (alphabetical position between `ListPlus` and `Paperclip`): `import { Hourglass, Lightbulb, ListPlus, Loader2, Paperclip, RefreshCw, RotateCcw, Square, Target, ThumbsUp, X } from "lucide-react";`. Do NOT split into a separate import statement; do NOT reorder the other names.

    2. Button icon branch (inside the `else` of `asideActive ? … : (…)` at lines 1800-1822): Replace the inline paper-plane `<svg>…</svg>` block with a ternary that picks Loader2 when `showTranscribingSend === true` and falls back to the byte-identical original paper-plane SVG otherwise. Concretely, the `else` branch becomes: `showTranscribingSend ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /></svg>`. The paper-plane markup is copied verbatim from lines 1813-1821 — do NOT reformat, do NOT collapse whitespace, do NOT change attribute order, do NOT swap for `<SendHorizontal />` (patch #130 fixed exactly that mistake — the load-bearing comment at lines 1808-1812 documents why). Preserve the comment block at lines 1808-1812; extend it with one additional line above the ternary noting that when `showTranscribingSend === true` a `Loader2` spinner replaces the paper-plane for the STT round-trip duration (references quick 260730-lur).

    3. Do NOT touch: the `asideActive` X-icon branch (line 1806); the button's `className`, `disabled` predicate, `onClick`, `aria-label`, `title`, or the `right-1 bottom-0.5 / p-2` positioning; any other file; anything under `src/backend/`; anything under `~/.claude/identities/tina/`.

    Then edit `src/ui/features/pretty-view/ComposeBox.voice.test.tsx`:

    4. Append Tests 11 and 12 inside the existing `describe("ComposeBox — Phase 16 voice flow", () => { … })` block (immediately after Test 10 at line 356, before the closing `});` on line 357). Follow the exact stylistic pattern of the surrounding tests: `it("Test 11: …", async () => { … })` and `it("Test 12: …", async () => { … })`. Reuse the existing helpers (`baseProps`, `MockMediaRecorder`) and the beforeEach mock infrastructure (getUserMedia, MediaRecorder). For Test 11's never-resolving fetch, call `vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))` at the top of the test body — this overrides the beforeEach default and `afterEach`'s `vi.unstubAllGlobals()` cleans up. Full implementation of both tests per the `<behavior>` block above.

    5. Do NOT change the header comment (lines 1-23), the existing test list numbering scheme, or any of Tests 1-10.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&amp;1 | tail -20 && npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx 2>&amp;1 | tail -30</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0 (no type errors introduced by the `Loader2` import or the ternary).
    - `npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx` reports 12 passed, 0 failed.
    - Grep confirms: `grep -c "Loader2" src/ui/features/pretty-view/ComposeBox.tsx` returns >= 2 (one import, one JSX usage).
    - Grep confirms: `grep -c "M14.536 21.686" src/ui/features/pretty-view/ComposeBox.tsx` returns exactly 1 (paper-plane path preserved byte-for-byte, not duplicated).
    - `git diff --stat` shows exactly two files modified: `ComposeBox.tsx` and `ComposeBox.voice.test.tsx`. No other files, especially no files under `src/backend/` and no files under `~/.claude/identities/tina/`.
  </done>
</task>

</tasks>

<verification>
Post-task global checks (run once after Task 1 commits):

1. Type check clean: `cd /home/ubuntu/skynet && npx tsc --noEmit` exits 0.
2. Voice test suite green: `npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx` reports 12 passed / 0 failed.
3. No regressions in sibling ComposeBox suites: `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` all green.
4. Frontend-only change confirmed: `git diff --name-only HEAD~1` (post-commit) shows only files under `src/ui/`. No `src/backend/` files — full `npm run build:backend` is intentionally NOT run per task spec.
5. Scope guards: `git diff --name-only HEAD~1` shows NO files under `~/.claude/identities/tina/`, NO `skynet-patches.md`, NO bounty files.
6. Terminal boundary: STOP at `git commit` on `feat/tab-title-from-tmux`. Do NOT `git push`, do NOT `docker build`, do NOT `docker compose up`, do NOT touch skynet-ec2. Identity-side bookkeeping (patch catalog, bounty status) is the orchestrator's job after this executor completes.
</verification>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user → ComposeBox UI | Local UI-only change; no data crosses a trust boundary. Tap events flow into existing `voice.state` machinery. |
| ComposeBox → `/voice/transcribe` | Existing boundary — unchanged by this patch. This change only affects the visual state during the round-trip. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lur-01 | Tampering | ComposeBox send-button branch | mitigate | Ternary is scoped to `showTranscribingSend` (already-computed flag on line 1041). The paper-plane path is preserved byte-for-byte and gated by the same `!asideActive` predicate — no new attack surface. Grep gate in `<done>` (`grep -c "M14.536 21.686"` == 1) prevents accidental duplication or omission of the paper-plane. |
| T-lur-02 | Denial of Service | Rapid-tap Send during STT | accept | Pre-existing `disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}` on line 1779 already blocks rapid-tap double-fire (T-16-16 from Phase 16). This patch keeps the button disabled during transcribing — spinner is purely visual. No change to double-fire posture. |
| T-lur-SC | Tampering | `lucide-react` package | accept | `lucide-react` is already a direct dependency imported at line 2 (Hourglass, Lightbulb, ListPlus, Paperclip, RefreshCw, RotateCcw, Square, Target, ThumbsUp, X). `Loader2` is a first-party lucide export from the same package — no new dependency added, no new supply-chain surface. Zero install tasks in this plan → package-legitimacy checkpoint gate does not apply. |
</threat_model>

<success_criteria>
- `voice.state === "transcribing"` renders a spinning `Loader2` (`className="size-6 animate-spin"`) in the send button slot.
- `voice.state !== "transcribing"` AND `asideActive === false` renders the original inline paper-plane SVG verbatim (byte-identical to the pre-patch markup at lines 1813-1821).
- `asideActive === true` still renders the lucide `X` (Resume affordance) — untouched.
- Send button stays `disabled` and keeps `aria-label="Send"` during transcribing (T-16-16 double-fire guard preserved).
- `Loader2` added to the existing `lucide-react` import at line 2 (single import statement, no split).
- Button `className`, positioning (`right-1 bottom-0.5 p-2`), `onClick`, `title`, and `disabled` predicate are byte-for-byte unchanged.
- Two new tests (11 and 12) appended to `ComposeBox.voice.test.tsx`; existing tests 1-10 untouched.
- `npx tsc --noEmit` exits 0.
- `npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx` = 12 pass / 0 fail.
- Sibling ComposeBox test files all green (no regression).
- Single atomic commit on `feat/tab-title-from-tmux`. Executor stops at commit boundary — no push, no build, no deploy, no identity-side edits.
</success_criteria>

<output>
Create `.planning/quick/260730-lur-stt-transcribing-spinner/260730-lur-01-SUMMARY.md` when done, documenting:
- Exact line-range of the ComposeBox.tsx edit (import line + button-branch ternary line range)
- The two new test names/line-ranges added to ComposeBox.voice.test.tsx
- Commit SHA on `feat/tab-title-from-tmux`
- Verification output (tsc exit code, vitest pass counts for the voice suite and the three sibling suites)
- Explicit confirmation: no push, no docker build, no docker compose, no files touched under `src/backend/` or `~/.claude/identities/tina/`
</output>
