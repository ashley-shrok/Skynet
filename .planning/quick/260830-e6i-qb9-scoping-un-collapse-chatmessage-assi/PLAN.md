---
quick_id: 260830-e6i
slug: qb9-scoping-un-collapse-chatmessage-assi
date: 2026-08-30
status: in-progress
---

# qb9 Scoping Follow-up (three parts)

Three surgical follow-ups after this morning's ship (HEAD `20c8ad33`). Ashley's UAT feedback:

- **Part A**: qb9's collapse-by-default was over-broad — it collapsed her local agent's ChatMessage assistant bubbles too, which she can't read without clicking. Revert ChatMessage assistant to always-expanded; keep RelayInbound + RelayOutbound collapse-by-default (those were the actual target).
- **Part B**: The Relay collapsed bubbles are visually too big (14/18 padding) vs the ChatMessage pill it was patterned after (7/12). Shrink Relay padding when collapsed only.
- **Part C**: r9i's `goodbye_echo` skip only catches `"<local-command-stdout>Goodbye!</local-command-stdout>"` — Ashley's exit routine emits three more variants that also need to skip: `"Catch you later!"`, `"See ya!"`, `"Bye!"`. Widen the predicate to match any of the four literal strings.

---

## Part A — un-collapse ChatMessage assistant

### Files

1. **`src/ui/features/pretty-view/ChatMessage.tsx`** — remove qb9's assistant-branch collapse split. Revert to the pre-qb9 shape where assistant branch renders body + speak button unconditionally.
   - Use `git show f49da842^:src/ui/features/pretty-view/ChatMessage.tsx` vs `git show f49da842:src/ui/features/pretty-view/ChatMessage.tsx` (or `git diff f49da842^..f49da842 -- src/ui/features/pretty-view/ChatMessage.tsx`) to see exactly what qb9 changed on the assistant branch — undo THAT part only.
   - The `chatmessage-collapsed-header` `<button>`, the `assistant ▶` pill, and the `collapsed ? ... : ...` conditional rendering all go away.
   - Assistant branch's outer container padding was changed from the pre-qb9 shape to `"pl-[12px] pr-[42px] py-[7px]"` in qb9; restore the pre-qb9 shape (check the pre-qb9 file at `f49da842^`).
   - **Do NOT touch** the user-branch code path (unchanged by qb9 — user bubbles were always expanded).

2. **`src/ui/features/pretty-view/ChatMessage.test.tsx`** — remove qb9's additions:
   - Delete the C1-C4 collapse regression tests qb9 added for the ASSISTANT branch.
   - Remove any `fireEvent.click(getByTestId('chatmessage-collapsed-header'))` expand steps qb9 added.
   - **Keep** the C1-C4 USER-bubble regression guard tests — user branch was always expanded and stays that way; those tests still make sense.

3. **7 qb9-followup test files** (from commit `20c8ad33`) — remove click-to-expand steps for `chatmessage-collapsed-header` (they'll throw when the testid disappears):
   - `src/ui/features/pretty-view/ChatMessage.autoplay.test.tsx`
   - `src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx`
   - `src/ui/features/pretty-view/ChatMessage.instrumentation.test.tsx`
   - `src/ui/features/pretty-view/ChatMessage.speak.test.tsx`
   - `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx`
   - `src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx`
   - `src/ui/features/pretty-view/PrettyView.test.tsx`

   Three flavors:
   - `fireEvent.click(screen.getByTestId('chatmessage-collapsed-header'))` — delete the line.
   - `queryAllByTestId` loops that iterate over multiple headers (`chatmessage-collapsed-header` + `relay-inbound-header` + `relay-outbound-header`, e.g. in PrettyView.plain-dom) — remove `chatmessage-collapsed-header` from the loop's testid list; keep the relay ones.
   - Narrowed `button[aria-label='Speak message']` selectors the executor added in ChatMessage.speak.test.tsx Tests 6 & 7 — either keeping them narrowed (defensively future-proof) or reverting to the broader selectors is fine. Executor's judgment.

---

## Part B — shrink Relay collapsed padding

### Files

1. **`src/ui/features/pretty-view/RelayInboundBubble.tsx` line 140** — currently `"rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]"` (applies always, both collapsed and expanded).
   Change to conditional-on-collapsed:
   ```tsx
   "rounded-[var(--radius-pv-bubble)]",
   collapsed ? "px-[12px] py-[7px]" : "px-[18px] py-[14px]",
   ```
   Match the file's existing class-merging idiom (cn / clsx / template literal — whatever's there).

2. **`src/ui/features/pretty-view/RelayOutboundBubble.tsx` line 64** — same shape swap.

3. **Tests** — `RelayInboundBubble.test.tsx` + `RelayOutboundBubble.test.tsx` — add ONE test each proving the collapsed variant uses tight padding (`px-[12px] py-[7px]`) and the expanded variant uses roomy padding (`px-[18px] py-[14px]`). Assert via `toHaveClass("px-[12px]")` etc. **Do NOT modify** the C1-C4 collapse regression tests qb9 added — those still hold (only visual pixels shrank; collapse behavior unchanged).

---

## Part C — widen r9i `goodbye_echo` predicate to 4 literals

### The bug Ashley reported

`session-file-parser.ts` line 1279:
```ts
if (content.trim() === "<local-command-stdout>Goodbye!</local-command-stdout>") {
  return { kind: "skip", why: "goodbye_echo" };
}
```

Only catches `Goodbye!`. Ashley's session-end routine also emits three other variants — all of them equally session-lifecycle noise:
- `<local-command-stdout>Catch you later!</local-command-stdout>`
- `<local-command-stdout>See ya!</local-command-stdout>`
- `<local-command-stdout>Bye!</local-command-stdout>`

### Fix

Widen the predicate to a set-membership check. Suggested shape (keep the code style consistent with the surrounding block):

```ts
const GOODBYE_ECHO_VARIANTS = new Set([
  "<local-command-stdout>Goodbye!</local-command-stdout>",
  "<local-command-stdout>Catch you later!</local-command-stdout>",
  "<local-command-stdout>See ya!</local-command-stdout>",
  "<local-command-stdout>Bye!</local-command-stdout>",
]);
// …
if (GOODBYE_ECHO_VARIANTS.has(content.trim())) {
  return { kind: "skip", why: "goodbye_echo" };
}
```

Constant belongs at module scope (top of file, near existing regex constants), not inline in the function. If the surrounding code style prefers inline `||` chains over a Set, that's fine — but a Set is idiomatic for N-way string membership and cheap.

Also update the two comment references to the "narrow to Goodbye!" language in the same file (grep for `Goodbye` — around line 1268-1269) so they describe the widened set: "narrow to the four literal exit-echo variants (Goodbye! / Catch you later! / See ya! / Bye!) — other `<local-command-stdout>` blocks still render".

### Tests

`src/backend/claude-session/session-file-parser.test.ts` — the existing r9i tests (see `describe("parseSessionLine — session-lifecycle noise skips (quick-260829-r9i)")`) currently has one test for `Goodbye!`. Extend that block:
- Positive skip tests for each of the 3 new variants (Catch you later!, See ya!, Bye!) — assert `kind: "skip"`, `why: "goodbye_echo"`.
- The existing Goodbye! test stays.
- Preserve the existing negative-passthrough test that ensures OTHER `<local-command-stdout>...</local-command-stdout>` bodies (e.g. `<local-command-stdout>output of /model</local-command-stdout>`) still render as `kind:"message"` (still true under the widened predicate — the Set is closed, not a substring match).

---

## Constraints (apply to ALL three parts)

- Working directory: `/home/ubuntu/skynet-tina`, branch `feat/tab-title-from-tmux`. Do NOT use git worktrees (fleet rule).
- **Do NOT deploy.** Commit only. Orchestrator (Tina) handles ship motion after Ashley greenlights push.
- **Do NOT touch** `~/.claude/roles/box-maintainer/skynet-patches.md`.
- **Do NOT run full-suite `npx vitest run`** — orchestrator's ship-gate. Only scoped tests.
- Part A + Part B are frontend-only (`src/ui/features/pretty-view/`); Part C is backend-only (`src/backend/claude-session/`) — no overlap.

## Scoped verification

- **After Part A**: `npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx src/ui/features/pretty-view/ChatMessage.autoplay.test.tsx src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx src/ui/features/pretty-view/ChatMessage.instrumentation.test.tsx src/ui/features/pretty-view/ChatMessage.speak.test.tsx src/ui/features/pretty-view/PrettyView.editable-file.test.tsx src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx` — exit 0.
- **After Part B**: `npx vitest run src/ui/features/pretty-view/RelayInboundBubble.test.tsx src/ui/features/pretty-view/RelayOutboundBubble.test.tsx` — exit 0.
- **After Part C**: `npx vitest run src/backend/claude-session/session-file-parser.test.ts` — exit 0.
- **Final aggregate**: rerun all 11 files together — exit 0, zero failures.

## Commits (three atomic — one per part)

**Commit A** (frontend un-collapse):
```
revert(quick-260830-e6i): un-collapse ChatMessage assistant bubbles

qb9 (f49da842) collapsed all left-side agent-produced bubbles by default,
which was over-broad — Ashley wanted only the REMOTE-source ones
(RelayInboundBubble, RelayOutboundBubble from other agents) collapsed,
not the local agent's own ChatMessage assistant replies.

Ashley: "the whole point of that change was supposed to be that we
collapse the relay message bubbles on the left side, and we leave
non-relay bubbles alone."

- ChatMessage.tsx assistant branch restored to always-expanded (pre-qb9 shape)
- ChatMessage.test.tsx: C1-C4 assistant-collapse regression tests deleted;
  user-branch C1-C4 kept as regression guard
- 7 downstream test files (qb9-followup 20c8ad33): expand steps for
  chatmessage-collapsed-header removed since the testid no longer exists

RelayInboundBubble + RelayOutboundBubble collapse-by-default retained
(that's the working part; padding fix in the follow-up commit).
```

**Commit B** (Relay padding shrink):
```
fix(quick-260830-e6i): shrink Relay collapsed-header padding to match ChatMessage pill

Ashley's computed-styles measurement of the qb9 collapsed relay bubbles
(14px top/bottom, 18px left/right) vs the pre-revert ChatMessage assistant
pill (7px top/bottom, 12px left) — collapsed relay bubbles were visually
too big. Shrink the outer container padding to symmetric px-[12px]/py-[7px]
when collapsed; keep the current px-[18px]/py-[14px] when expanded.

- RelayInboundBubble.tsx: conditional padding on collapsed state
- RelayOutboundBubble.tsx: same
- One test per file proving tight-when-collapsed / roomy-when-expanded
```

**Commit C** (goodbye variants):
```
fix(quick-260830-e6i): widen goodbye_echo predicate to 4 exit-echo variants

r9i's goodbye_echo predicate (session-file-parser.ts) only skipped the
literal "<local-command-stdout>Goodbye!</local-command-stdout>". Ashley's
session-end routine emits three more that are equally session-lifecycle
noise:

- <local-command-stdout>Catch you later!</local-command-stdout>
- <local-command-stdout>See ya!</local-command-stdout>
- <local-command-stdout>Bye!</local-command-stdout>

Widen the predicate to a Set-membership check over the 4 literal strings.
Other <local-command-stdout>...</local-command-stdout> bodies (e.g. /model
or /status output) still render as normal bubbles — the Set is closed,
not a substring match.

Docblock updated. session-file-parser.test.ts r9i describe block extended
with one positive-skip test per new variant + preserves the existing
negative-passthrough test proving non-exit local-command-stdout still renders.
```

## Return

Report to me: three commit SHAs (A, B, C), per-file test count deltas, and any surprises. The full ship motion (push → build → deploy) is my job — do NOT push, build, or force-recreate.
