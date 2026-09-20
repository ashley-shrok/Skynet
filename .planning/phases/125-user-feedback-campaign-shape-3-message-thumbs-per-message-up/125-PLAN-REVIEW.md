# Phase 125 Plan Check — Iteration 1

**Reviewer:** gsd-plan-checker (Opus 4.7)
**Phase:** 124-user-feedback-campaign-shape-3-message-thumbs-per-message-up
**Plans reviewed:** 125-01-PLAN.md, 125-02-PLAN.md
**Verdict:** ISSUES FOUND

---

## Coverage summary

All 54 D-XX decisions from CONTEXT.md appear in at least one plan's `requirements` frontmatter field:

- Plan 01 covers: D-01..D-11, D-15..D-23, D-26..D-32, D-38..D-40, D-47..D-54 (38 items).
- Plan 02 covers: D-12..D-14, D-18..D-19, D-23..D-25, D-27, D-32..D-38, D-41..D-46, D-53..D-54 (24 items).
- Union across both plans = D-01..D-54 (100% by ID).
- No CONTEXT.md decision is silently dropped; no plan action reduces a decision's scope with `v1` / `simplified` / `hardcoded` / `stub` / `later` language. `grep` for scope-reduction tokens returned only benign contextual hits.

D-53's eleven test cases split across plans:
- Plan 01 test file: cases 1, 2, 3, 4 (click-fires-callback slice), 5 (click-fires-callback slice), 6, 7 — plus test 8 (user-bubble unaffected slice) and test 9 (missing-eventId defensive).
- Plan 02 test file: cases 4 (modal-open+submit), 5 (modal-open+dismiss), 8 (RelayInboundBubble), 9 (WaitingBubble), 10 (user-bubble at PrettyView scope), 11 (exchangeText with and without prior turn), plus a T-125-05 relay-skip test.
- Combined coverage: all 11 D-53 cases are exercised across the two test files. Case 3 (thumbs-up flow) has the postFeedback+toast half in Plan 02 and the callback-fires+pressed-visual half in Plan 01 — together they satisfy the case, but neither plan test alone does.

Executor-constraint compliance:
- No `git push`, no `docker build`, no `docker compose up`, no HTTPS-verify commands present in either plan.
- Verify blocks use `npx vitest related --run <files>` — never `npx vitest run` (full suite).
- `npx tsc --noEmit` used — executor-scoped per fleet rule.
- No worktree references.
- "Commit made on branch `feat/tab-title-from-tmux`" appears in success criteria — code+commit only, deploy deferred.

Shape-3-specific structural checks:
- Plan 01 `files_modified` = only ChatMessage.tsx + its new test file → does NOT touch shape-1 or shape-2 files (D-36 honored).
- Plan 02 `files_modified` = only PrettyView.tsx + its new test file → does NOT touch shape-1 or shape-2 files, does NOT touch AppShell.tsx (per PATTERNS.md option B).
- Neither plan modifies RelayInboundBubble.tsx or WaitingBubble.tsx (D-12/D-13 honored).
- D-22 (second-tap-no-op) is in Plan 01 Task 1 `<action>` explicitly ("both thumbs buttons check `if (pressed) return;` BEFORE calling the callback and BEFORE `setPressed(true)`").
- D-29 (both-thumbs-allowed) has a dedicated test 7 in Plan 01 with independent-pressed-state assertions.
- D-20 (identity-hue fill + 100% opacity override on pressed) is actionable in Plan 01 Task 1 action ("`background: thumbsUpPressed ? \"hsla(var(--pv-id-hue),65%,55%,0.36)\" : ...`", "`opacity: thumbsUpPressed ? 1 : undefined`").

Frontmatter validity:
- Both plans have valid `wave`, `depends_on`, `files_modified`, `autonomous`, `requirements`, `must_haves` fields.
- Dependency graph: 125-01 wave 1 (no deps), 125-02 wave 2 (depends_on 125-01). Sequential, no cycles.

---

## Blocker 1 (BLOCKER) — Plan 02's prior-turn discriminator is factually wrong

**Dimension:** requirement_coverage / architectural_tier_compliance
**Plan:** 125-02
**Task:** 1
**Severity:** BLOCKER — executor following the action literally will produce a broken exchangeText computation that fails D-33/D-34.

Plan 02 Task 1 `<action>` says:

> "A helper function `computeExchangeText(assistantEventId: string): string` that: locates the assistant message in `effectiveMessages` by `eventId === assistantEventId` and `type === undefined` (regular ChatMessage entry — not image/relay/malformed) and `role === "assistant"`; walks backward from that index; skips entries whose `type` is not `undefined` (image/relay/malformed frames are non-exchange turns); returns the labeled two-block string if a `role === "user"` ChatMessage entry is found"

Plan 02 Task 1 `<behavior>` reinforces the same claim:

> "Prior-user-turn lookup: walk `effectiveMessages` backward from the assistant message's index, and select the first entry whose `type` is undefined (i.e., a regular ChatMessage-type entry — StreamEvent's variants with `type === "image"|"relay_outbound"|"relay_inbound"|"malformed_line"` are NOT chat exchange turns)"

**The codebase discriminator is NOT `undefined`.** `src/ui/api/claude-session-api.ts:43-46` defines:

```typescript
export type MessageEvent = {
  type: "message";
  role: "user" | "assistant";
  ...
};
```

`MessageEvent` (imported into PrettyView.tsx as `ChatMessageEvent`) always carries `type: "message"`. PrettyView.tsx L3346 already uses this correctly: `if (m.type === "message" && m.role === "user")`. The ChatMessage-branch in the render map at L3950-3971 is the `else` fall-through after four `m.type === "image"|"relay_outbound"|"relay_inbound"|"malformed_line"` checks — but that's a rendering shortcut, not a claim that `m.type` is undefined. It is `"message"`.

**Impact:** an executor writing `if (m.type === undefined && m.role === "user")` will match ZERO messages, and every assistant thumbs-up/down will emit an assistant-only exchangeText (D-35's edge case, mistakenly the default). Test 1 in Plan 02's test file specifically asserts the exchangeText contains BOTH `"What is 2+2?"` AND `"It is 4."` — that test would fail, catching the bug at test time, but the plan action is nonetheless factually incorrect and should be fixed before execution.

**Fix hint:** Replace both `type === undefined` occurrences in Plan 02 Task 1 (in `<behavior>` and in `<action>`) with `type === "message"`. Prefer the exact idiom already established at PrettyView.tsx L3346: `m.type === "message" && m.role === "user"`. The assistant-message locator should similarly use `m.type === "message" && m.eventId === assistantEventId && m.role === "assistant"`.

---

## Blocker 2 (BLOCKER) — Plan 02 Task 1 `<action>` does not stabilize `computeExchangeText` for the `useCallback` deps

**Dimension:** task_completeness
**Plan:** 125-02
**Task:** 1
**Severity:** BLOCKER — the plan will lint-fail under `react-hooks/exhaustive-deps` and produce a subtle correctness bug where stale closures capture a stale `effectiveMessages`.

Plan 02 Task 1 action prescribes:

```
const handleThumbsUp = useCallback((eventId: string): void => {
  const exchangeText = computeExchangeText(eventId);
  void postFeedback({ ... });
  toast.success(...);
}, [effectiveMessages]);
```

But `computeExchangeText` is described as a "helper function" whose enclosing scope reads `effectiveMessages`. If it is defined at component-body scope as `function computeExchangeText(...)` or `const computeExchangeText = (...)` (without `useCallback`), each render re-creates the function and captures the CURRENT-render `effectiveMessages`. If `handleThumbsUp` closes over the helper via reference, the `useCallback` deps list `[effectiveMessages]` is stale relative to the identity of the helper — `react-hooks/exhaustive-deps` will flag the missing `computeExchangeText` dep.

Either:
1. Inline `computeExchangeText`'s body inside each `useCallback` (both handlers), OR
2. Wrap `computeExchangeText` in its own `useCallback(..., [effectiveMessages])` and list it in the handlers' deps as `[computeExchangeText]`.

**Impact:** The plan as written will either produce an ESLint error blocking commit (if the project's `react-hooks/exhaustive-deps` is `error`) or a stale-closure bug where `handleThumbsUp` from an earlier render fires with a stale exchange (subtle in autoscroll / streaming scenarios). Given the codebase does uphold hooks-exhaustive-deps discipline elsewhere, this needs to be nailed down in the plan.

**Fix hint:** Rewrite Plan 02 Task 1 `<action>` to either (a) inline the exchange lookup inside each handler's `useCallback`, or (b) explicitly define `computeExchangeText = useCallback(..., [effectiveMessages])` first and then use `[computeExchangeText]` as the deps for the two handlers. Pick one and put it in the action prose.

---

## Warning 1 (WARNING) — Plan 02 Task 2 modal-close test path may not actually trigger `onDismissWithoutSubmit`

**Dimension:** task_completeness / verification_derivation
**Plan:** 125-02
**Task:** 2
**Severity:** WARNING — a fallback selector strategy is present, but the primary strategy risks a false-pass.

Plan 02 Task 2 Test 5 (modal dismiss) asks the executor to locate the close-X via aria-label. FeedbackModal.tsx L167 sets `aria-label="Close without note"` on the close button, wrapped in `DialogPrimitive.Close asChild`. Radix's `DialogPrimitive.Close` fires `onOpenChange(false)`, which then routes through FeedbackModal.tsx L124-134's wrapper — firing `onDismissWithoutSubmit()` for the thumbs_down variant. Good — this path IS wired.

However, the plan action includes: "If ambiguous, use `fireEvent.keyDown(document.body, { key: 'Escape' })`". Radix Dialog handles Escape at the DialogPrimitive.Content level, not at document.body — a `keyDown` on `document.body` in jsdom may not actually reach Radix's `onEscapeKeyDown` handler. Prefer `fireEvent.keyDown(screen.getByTestId("feedback-dialog"), { key: "Escape" })` or click the `data-testid="feedback-close"` (this testid exists at FeedbackModal.tsx L168).

**Fix hint:** Replace the Escape-on-body fallback in Plan 02 Task 2 Test 5 with either (a) click on `screen.getByTestId("feedback-close")` (stable testid FeedbackModal.tsx L168), or (b) `fireEvent.keyDown(document, { key: "Escape" })` bubbling from `document` (Radix listens on document by default in jsdom). Give the executor ONE concrete selector rather than an ambiguous "if" chain — the current wording lets a lazy executor pick the flaky path.

---

## Warning 2 (WARNING) — `grep -c '^  it('` acceptance-criteria fragility

**Dimension:** task_completeness
**Plans:** 125-01, 125-02
**Task:** 2 in each plan
**Severity:** WARNING — an executor's minor whitespace choice makes the source assertion misleadingly fail.

Plan 01 Task 2 and Plan 02 Task 2 both assert:

```
grep -c '^  it(' <test file>
```

This counts `it(` starting at exactly 2 spaces of indent. If the executor writes tests indented under a `describe(...)` block AT ALL, they typically use 2 spaces (matching the codebase) — but nested `describe` blocks (or a formatter's alternative indentation) would break the count. A safer assertion is `grep -c '\bit(' <test file>` (matching word-boundary `it(` regardless of leading whitespace). Alternatively, use `awk '/^\s*it\(/' <file> | wc -l`.

**Fix hint:** Loosen the acceptance-criteria regex in both Plan 01 and Plan 02 Task 2 to `grep -c 'it(' <test file>` (with a note that this counts all `it(` occurrences, so make it `-c 'it("'` if quote-anchoring is required). Or drop the exact count and instead assert `>= 9` and rely on the test-command exit-0 to be the real proof of coverage.

---

## Warning 3 (WARNING) — Plan 02 acceptance-criteria for `postFeedback` count is loosely worded

**Dimension:** task_completeness
**Plan:** 125-02
**Task:** 1
**Severity:** WARNING — the plan says "returns at least 3 (... but if all inline the count may vary; `>= 2` acceptable if the executor consolidated)". This is exactly the kind of hedge that lets a plan pass with two callers when three-plus are required (thumbs-up handler + modal submit + modal dismiss = 3 separate fire sites minimum).

**Fix hint:** State the exact expected count. Three call sites is the minimum contract (thumbs-up path, thumbs-down submit path, thumbs-down dismiss path). Plus one import = 4 total occurrences. Assertion: `grep -c 'postFeedback' src/ui/features/pretty-view/PrettyView.tsx` returns exactly 4 (import + 3 call sites). Reject the "if the executor consolidated" carve-out — the three fire paths deliver three distinct D-XX behaviors (D-18/D-25 submit/D-25 dismiss) and consolidating them would elide the D-25 lock that submit-OR-dismiss both fire.

---

## Warning 4 (WARNING) — Plan 01 test 8 belongs conceptually to Plan 02 but is duplicated

**Dimension:** requirement_coverage / scope_sanity
**Plan:** 125-01
**Task:** 2
**Severity:** WARNING — informational; not blocking, but worth surfacing.

Plan 01 Task 2 test 8 tests "User bubble unaffected when feedback ON" by rendering `<ChatMessage role="user" ...>` directly. This is valid ChatMessage-scope coverage. Plan 02 Task 2 test 8 tests the same D-53 case 10 by rendering `<PrettyView>` with a user-message fixture. Both are legitimate but there is exact duplication of the case. Given both plans are marked `wave 1` / `wave 2` autonomous and the tests are cheap, this is fine to keep — but the plan should acknowledge the intentional overlap (belt-and-suspenders D-14 coverage at two levels) rather than leaving the impression that D-53 case 10 has one home.

**Fix hint:** Note in Plan 01 Task 2 test 8 that it is a ChatMessage-internal coverage of D-14 and that PrettyView-level coverage of D-53 case 10 additionally lives in Plan 02 test 8. Not a code change — a rationale annotation.

---

## Verification Architecture (Nyquist) — PASS

- Every `<task>` has an `<automated>` verify command.
- No watch-mode flags, no >30s delays, no full-suite invocations.
- Each wave's tasks include at least one `<automated>` verify (2/2 in Wave 1, 2/2 in Wave 2 — sampling ≥ 2 in a 3-task window is trivially met).
- Wave 0 does not apply (no `MISSING` markers in `<automated>`).
- VALIDATION.md is not required for this phase per the local convention — plans provide the acceptance criteria + colocated tests inline.

---

## Threat Model — PASS (no gaps)

Both plans enumerate shape-3-scope threats (T-125-01 through T-124-07 + T-124-SC), correctly reference shape 1's T-121-* for shared transport/backend surface, and mark all shape-3-scope threats LOW severity. T-125-05 (relay-frame leakage into exchangeText) has a specific test case (Plan 02 test 9). No new backend surface, no new payload fields, no new modal variants.

---

## Recommendation

Return to planner with Blockers 1 and 2 called out explicitly. Warnings 1-4 should also be addressed in the same revision pass since they're small and clarify executor behavior.

Blocker 1 is the most consequential: the `type === undefined` discriminator will collapse D-33/D-34 into D-35 behavior for every assistant message with a prior user turn, silently. Blocker 2 is a hooks-lint-fail waiting to happen. Warning 3's hedge is a scope-reduction risk that lets the executor consolidate three D-XX-distinct call sites into fewer.
