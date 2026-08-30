---
phase: 260730-ujq-quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/CopyableBlock.tsx
  - src/ui/features/pretty-view/CopyableBlock.test.tsx
  - src/ui/features/pretty-view/ChatMessage.tsx
autonomous: true
requirements:
  - QUICK-260730-ujq
must_haves:
  truths:
    - "Every ``` fenced code block inside a pretty-view ChatMessage renders a small copy button in its top-right corner."
    - "Every markdown blockquote inside a pretty-view ChatMessage renders a small copy button in its top-right corner."
    - "On desktop (hover: hover), the button is dim (~opacity 0) at rest and reveals on hover of the block; on touch devices (pointer: coarse), the button is always visible."
    - "Clicking the button copies the block's plain text (code text for <pre>, quoted text for <blockquote>) to the system clipboard via navigator.clipboard.writeText."
    - "After a successful copy the button shows a Copied / checkmark affordance for ~1500ms then reverts to its idle state."
    - "The button styling uses the pv-* palette (cool-cream rims at 6-10% alpha, warm off-white text) and reads as consistent with the assistant-bubble glass aesthetic."
    - "The existing ChatMessage.test.tsx suite still passes (chip-strip, quick-reply, injected-turn behaviors unchanged)."
    - "The full frontend vitest suite passes with zero failed tests and zero unhandled promise rejections."
  artifacts:
    - path: "src/ui/features/pretty-view/CopyableBlock.tsx"
      provides: "CopyableBlock React component wrapping <pre>/<blockquote> children with an overlaid copy button"
      exports: ["CopyableBlock"]
    - path: "src/ui/features/pretty-view/CopyableBlock.test.tsx"
      provides: "Unit tests for CopyableBlock: click copies to mocked clipboard, Copied state appears then reverts after ~1500ms"
    - path: "src/ui/features/pretty-view/ChatMessage.tsx"
      provides: "ReactMarkdown `pre` and `blockquote` component overrides that mount CopyableBlock"
      contains: "CopyableBlock"
  key_links:
    - from: "src/ui/features/pretty-view/ChatMessage.tsx"
      to: "src/ui/features/pretty-view/CopyableBlock.tsx"
      via: "components={{ pre: (...) => <CopyableBlock>..., blockquote: (...) => <CopyableBlock>... }} on ReactMarkdown"
      pattern: "CopyableBlock"
    - from: "src/ui/features/pretty-view/CopyableBlock.tsx"
      to: "navigator.clipboard.writeText"
      via: "onClick handler; window.electronClipboard.writeText fallback when available (matches HostKeyVerificationDialog / WarpgateDialog / ConnectionLog pattern)"
      pattern: "navigator\\.clipboard\\.writeText"
---

<objective>
Add a small, glass-styled copy-to-clipboard button to every code block and blockquote rendered inside the pretty-view `ChatMessage` (per task-shape, this is what the shape called "MessageBubble" — the actual file is `ChatMessage.tsx`). Purpose: let Ashley one-click-copy assistant code snippets and quoted excerpts without dragging a text selection through the glass bubble.

Purpose: reduce friction on the most-repeated copy target in pretty-view (fenced code blocks and quoted excerpts). The bubble is a Ship-of-Theseus-locked surface; the button must slot into the existing glass aesthetic without disturbing prose flow or existing chip-strip / injected-turn / quick-reply behavior.

Output: a new `CopyableBlock` component + its unit tests, wired into `ChatMessage`'s `ReactMarkdown` `components` map for `pre` and `blockquote`. Full vitest suite green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/ui/features/pretty-view/ChatMessage.tsx
@src/ui/features/pretty-view/ChatMessage.test.tsx
@src/ui/lib/clipboard-provider.ts
@src/ui/index.css
@vitest.setup.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create CopyableBlock component + unit tests</name>
  <files>src/ui/features/pretty-view/CopyableBlock.tsx, src/ui/features/pretty-view/CopyableBlock.test.tsx</files>
  <behavior>
    - Test A (renders children unchanged): Rendering `<CopyableBlock as="pre"><code>hello</code></CopyableBlock>` puts the `<code>hello</code>` inside a `<pre>` in the DOM. Rendering with `as="blockquote"` uses a `<blockquote>` wrapper.
    - Test B (button present): The rendered output contains a button with an accessible name matching /copy/i. The button carries a `data-testid="copyable-block-copy"` for stable targeting.
    - Test C (click copies to clipboard): With `navigator.clipboard.writeText` mocked as a `vi.fn().mockResolvedValue(undefined)`, clicking the button calls `writeText` exactly once with the block's plain text content (use `userEvent.click`). For `<pre><code>hello world</code></pre>` the argument is `"hello world"`. For a blockquote whose children include multiple text nodes, the argument is the concatenated `textContent` of the wrapper's children.
    - Test D (Copied affordance appears then reverts): Immediately after click, the button's accessible name matches /copied/i (and shows a check-mark glyph via `data-testid="copyable-block-check"`). Using `vi.useFakeTimers()` + `vi.advanceTimersByTime(1500)` (wrapped in `act`), after 1500ms the button reverts to the /copy/i state and the check-mark testid is no longer in the DOM. Remember to restore real timers in `afterEach`.
    - Test E (electron path preferred when present): When `window.electronClipboard = { writeText: vi.fn().mockResolvedValue(true), readText: vi.fn() }` is set on the test window, clicking calls `window.electronClipboard.writeText` and does NOT call `navigator.clipboard.writeText`. Clean up by deleting `window.electronClipboard` in the test's cleanup so it doesn't leak to other tests.
    - Test F (write failure does not throw): When `navigator.clipboard.writeText` is mocked to reject, clicking the button does not throw and the Copied affordance does NOT appear (button stays in idle /copy/i state). The rejection must be caught (no unhandled promise rejection — this is the exact bug pattern flagged in the task-shape exit-code trap).
  </behavior>
  <action>
    Create `src/ui/features/pretty-view/CopyableBlock.tsx` exporting a `CopyableBlock` React component.

    Props: `{ as: "pre" | "blockquote"; className?: string; children: React.ReactNode }` (plus rest-spread of native element props so ReactMarkdown-passed attrs like `node` are stripped and the rest forwarded to the wrapper element).

    Behavior:
    - Renders a wrapper element of the requested tag (`pre` or `blockquote`), forwards native props + className, and positions itself as `relative` so the button can absolute-position inside it.
    - Places a small `<button type="button">` in the top-right corner (absolute-positioned, ~6-8px inset). Button contains a `Copy` icon (from `lucide-react`, already used elsewhere in pretty-view — see `ThumbsUp` import in `ChatMessage.tsx`) in the idle state and a `Check` icon in the Copied state. Both icons `size-3.5` or `size-4`. Add `data-testid="copyable-block-copy"` on the button and `data-testid="copyable-block-check"` on the Check icon (only rendered in Copied state).
    - Accessible label: `aria-label="Copy"` in idle state, `aria-label="Copied"` in success state. Include a visually-hidden `<span className="sr-only">` mirroring the aria-label for testing-library `getByRole("button", { name: /copy/i })` support.
    - Styling: glass-cohesive — background `bg-white/[0.06]` (cool-cream at ~6% alpha, matches `--color-pv-border-quiet`), hover `hover:bg-white/[0.12]`, `border border-white/[0.08]`, rounded `rounded`, padded `p-1`, text `text-[color:var(--color-pv-fg)]`. Visibility gate via Tailwind media modifiers: at rest `opacity-0`, on group hover `group-hover:opacity-100`, and on touch devices always visible via a `[@media(pointer:coarse)]:opacity-100` variant. Transition `transition-opacity duration-150`. The wrapper element needs the `group` class so `group-hover` triggers correctly.
    - Copy handler: extracts plain text via a ref on the wrapper (`ref.current?.textContent ?? ""`) — this is the most reliable way to get code text regardless of whether ReactMarkdown wraps content in `<code>` (for `<pre>`) or paragraph nodes (for `<blockquote>`). Do NOT walk children manually.
    - Clipboard write: prefer `window.electronClipboard?.writeText(text)` when defined, otherwise `navigator.clipboard.writeText(text)`. Both paths return promises; await inside a `try { ... } catch { /* swallow; leave button in idle state */ }` so a rejection does not become an unhandled promise rejection (the exact failure mode called out in task-shape).
    - On successful write, `setCopied(true)` and start a `window.setTimeout` for 1500ms that flips it back to `false`. On unmount, clear the timer. Reset any pending timer if the user clicks again while a prior success is still displayed (clear + restart).
    - Do NOT import `RobustClipboardProvider` — that's an `IClipboardProvider` (xterm) implementation with focus-listener side effects, unsuitable for a per-block button. The direct `window.electronClipboard` -> `navigator.clipboard` two-step matches the existing pattern in `HostKeyVerificationDialog.tsx:42`, `WarpgateDialog.tsx:34`, and `ConnectionLog.tsx:69`.

    Create `src/ui/features/pretty-view/CopyableBlock.test.tsx`:
    - Use `vitest`, `@testing-library/react`, `@testing-library/user-event` (all already in `devDependencies` — confirmed in `package.json` scripts block).
    - Mock `navigator.clipboard` per-test via `Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() } })`. `vitest.setup.ts`'s `afterEach(() => vi.restoreAllMocks())` handles function-mock restore; explicitly delete `window.electronClipboard` in per-test cleanup where it was set (Test E) to avoid leakage.
    - For Test D (timer-based revert): call `vi.useFakeTimers({ shouldAdvanceTime: true })` (or plain `vi.useFakeTimers()` and drive `userEvent` with `advanceTimers`), advance 1500ms wrapped in `await act(async () => { vi.advanceTimersByTime(1500); })`, then assert the idle state. Restore real timers in `afterEach` with `vi.useRealTimers()`.
    - Do NOT snapshot-test — behavior assertions only.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/CopyableBlock.test.tsx 2>&1 | tee /tmp/copyable-block-test.log; grep -Eq "FAIL|failed|✗|Unhandled Rejection|UnhandledPromiseRejection" /tmp/copyable-block-test.log && (echo "COPYABLE TESTS FAILED"; exit 1) || echo "COPYABLE TESTS PASS"</automated>
  </verify>
  <done>
    - `src/ui/features/pretty-view/CopyableBlock.tsx` exists and exports `CopyableBlock`.
    - `src/ui/features/pretty-view/CopyableBlock.test.tsx` exists with all six behavior tests (A-F).
    - `npx vitest run src/ui/features/pretty-view/CopyableBlock.test.tsx` reports all tests passing with zero failed and zero unhandled rejections in the output (verified by grep gate above).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire CopyableBlock into ChatMessage's ReactMarkdown pre/blockquote overrides</name>
  <files>src/ui/features/pretty-view/ChatMessage.tsx, src/ui/features/pretty-view/ChatMessage.test.tsx</files>
  <behavior>
    - Test G (fenced code block gets a copy button): Rendering `<ChatMessage role="assistant" content="here is code:\n\n\`\`\`\nnpm test\n\`\`\`\n" />` produces exactly one element with `data-testid="copyable-block-copy"` inside the bubble. Its accessible name matches /copy/i.
    - Test H (blockquote gets a copy button): Rendering `<ChatMessage role="assistant" content="quote:\n\n> hello world\n" />` produces exactly one `data-testid="copyable-block-copy"` element. Its ancestor is a `<blockquote>`.
    - Test I (plain prose does NOT get a copy button): Rendering `<ChatMessage role="assistant" content="just a plain paragraph." />` produces zero `data-testid="copyable-block-copy"` elements.
    - Test J (existing behaviors preserved — regression guard): The existing Tests 9-14c in `ChatMessage.test.tsx` still pass unchanged. In particular Test 10 ("plain user message renders as markdown WITHOUT any chip strip") must still pass — the new pre/blockquote overrides must NOT affect the paragraph render path or the injected-turn / quick-reply short-circuits.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/ChatMessage.tsx`:

    1. Add import: `import { CopyableBlock } from "./CopyableBlock";`
    2. In the `<ReactMarkdown ... components={{...}}>` object (currently has `a` and `p` overrides), add two more overrides:
       - `pre: ({ node, children, ...props }) => (<CopyableBlock as="pre" {...props}>{children}</CopyableBlock>)`
       - `blockquote: ({ node, children, ...props }) => (<CopyableBlock as="blockquote" {...props}>{children}</CopyableBlock>)`
       Strip `node` (ReactMarkdown-internal prop) via destructure so it isn't spread onto the DOM element. Spread the remaining `props` onto CopyableBlock so ReactMarkdown-provided className / etc. flow through.
    3. Do NOT alter the existing `a` or `p` overrides.
    4. Do NOT alter the injected-turn / quick-reply / ThumbsUp branches — these short-circuit before ReactMarkdown and must remain untouched.
    5. Leave the existing `prose-pre:*` and `prose-code:*` Tailwind classes on the bubble wrapper unchanged. The CopyableBlock wrapper is the same `<pre>` element ReactMarkdown would have emitted, so the prose classes still apply.

    Append four new tests (G, H, I, J-as-comment-note) to `src/ui/features/pretty-view/ChatMessage.test.tsx` inside a new `describe("ChatMessage — copy button on code blocks and blockquotes (quick 260730-ujq)")` block. Reuse the existing imports and render helper. Assertions use `data-testid="copyable-block-copy"` and `queryAllByTestId` for count assertions. Test J is implicit: the existing describe block's tests run untouched, so vitest verifies the regression guard automatically.

    Do NOT touch anything outside `src/ui/features/pretty-view/ChatMessage.tsx` and `src/ui/features/pretty-view/ChatMessage.test.tsx` in this task.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx src/ui/features/pretty-view/CopyableBlock.test.tsx 2>&1 | tee /tmp/chatmessage-test.log; grep -Eq "FAIL|failed|✗|Unhandled Rejection|UnhandledPromiseRejection" /tmp/chatmessage-test.log && (echo "CHATMESSAGE TESTS FAILED"; exit 1) || echo "CHATMESSAGE TESTS PASS"</automated>
  </verify>
  <done>
    - `ChatMessage.tsx` has `pre` and `blockquote` overrides wired to `CopyableBlock`.
    - `ChatMessage.test.tsx` has new tests G, H, I asserting the copy button appears exactly where expected and nowhere else.
    - Both `ChatMessage.test.tsx` and `CopyableBlock.test.tsx` pass with zero failed and zero unhandled rejections in the output.
    - Original chip-strip / quick-reply / injected-turn tests (9 through 14c) still pass.
  </done>
</task>

<task type="auto">
  <name>Task 3: Full frontend test suite regression sweep</name>
  <files>(no source changes — validation only)</files>
  <action>
    Run the full vitest suite. This catches any snapshot break or unexpected interaction with other pretty-view tests (e.g. `PrettyView.test.tsx`, `PrettyView.aside.test.tsx`, `AsideBubble.test.tsx`) that render assistant messages through `ChatMessage`.

    If a test breaks:
    - If the break is a legitimate snapshot update caused by the new button DOM (button + sr-only span appearing inside a `<pre>` or `<blockquote>`): update the snapshot ONLY if the change is exactly the CopyableBlock addition and nothing else. Do NOT blanket-update snapshots.
    - If the break is a real behavioral regression: fix `CopyableBlock.tsx` or the ChatMessage wiring. Do NOT modify unrelated tests to make them pass.
    - Any unhandled promise rejection in the output counts as a failure (per task-shape's Tina-2026-07-30 note), even if vitest reports "0 failed" in the summary line. The grep gate below enforces this.

    Do NOT run `npm run build`. Do NOT run `docker compose`. Do NOT git-commit — the orchestrator handles bookkeeping.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npm test 2>&1 | tee /tmp/full-suite.log; grep -Eq "FAIL|failed|✗|Unhandled Rejection|UnhandledPromiseRejection" /tmp/full-suite.log && (echo "FULL SUITE FAILED"; exit 1) || echo "FULL SUITE PASS"</automated>
  </verify>
  <done>
    - `npm test` completes with zero failed tests.
    - `grep -Eq "FAIL|failed|✗|Unhandled Rejection|UnhandledPromiseRejection"` on the captured output finds no matches (the exit-code trap called out in task-shape is defused by the grep gate).
    - No files outside `src/ui/features/pretty-view/CopyableBlock.tsx`, `src/ui/features/pretty-view/CopyableBlock.test.tsx`, `src/ui/features/pretty-view/ChatMessage.tsx`, and `src/ui/features/pretty-view/ChatMessage.test.tsx` were modified in this quick task.
  </done>
</task>

</tasks>

<verification>
Manual smoke (visual verification is out of scope for this autonomous quick task — orchestrator/Ashley can visually verify after commit):
- Open pretty-view, render an assistant message that contains a fenced code block. On desktop, hover the block: the copy button fades in top-right. Click it: icon flips to a checkmark, then reverts after ~1.5s. Paste into another app — the code block text is on the clipboard.
- Repeat for a blockquote (`> quoted text`).
- On a touch device (or DevTools mobile-emulation with `pointer: coarse`), the button is visible without hover.

Automated:
- `npx vitest run src/ui/features/pretty-view/CopyableBlock.test.tsx src/ui/features/pretty-view/ChatMessage.test.tsx` passes.
- `npm test` (full frontend suite) passes with zero failures and zero unhandled promise rejections.
</verification>

<success_criteria>
- `CopyableBlock` component exists and is exercised by unit tests covering: render, button presence, successful copy (both `navigator.clipboard` and `window.electronClipboard` paths), Copied-state timer revert at 1500ms, and swallowed rejection on write failure.
- `ChatMessage` renders exactly one copy button per fenced code block AND exactly one per blockquote inside every assistant/user message, with the button styled from the pv-* palette and hidden-on-desktop-hover / always-visible-on-touch via CSS media queries.
- Full `npm test` suite green with zero failed tests and zero unhandled promise rejections (verified by explicit grep gate, per task-shape).
- No files outside `src/ui/features/pretty-view/` (except no `src/ui/index.css` changes are required — the button styles inline via Tailwind + `var(--color-pv-*)` tokens) were touched.
- No identity-side files (`~/.claude/identities/tina/`), no build, no deploy, no commit — orchestrator handles those.
</success_criteria>

<output>
Create `.planning/quick/260730-ujq-add-copy-to-clipboard-button-to-code-blo/260730-ujq-SUMMARY.md` when done, capturing:
- Files touched (exact list)
- Test counts (new tests added, full suite pass count)
- Any deviations from this plan (e.g. if `data-testid` names or aria-labels had to change for reasons discovered during implementation)
- Explicit confirmation that `grep -Eq "FAIL|failed|✗|Unhandled Rejection"` on the final `npm test` log found zero matches
</output>
