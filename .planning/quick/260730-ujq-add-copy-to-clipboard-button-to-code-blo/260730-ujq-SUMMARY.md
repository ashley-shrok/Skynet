---
phase: 260730-ujq-quick
plan: "01"
type: quick
tags: [ui, clipboard, pretty-view, react, lucide, tailwind]
dependency_graph:
  requires: []
  provides: [CopyableBlock component, ChatMessage copy-button wiring]
  affects: [src/ui/features/pretty-view/]
tech_stack:
  added: []
  patterns: [lucide-react icons, Tailwind group-hover visibility gate, window.navigator Proxy for jsdom testing]
key_files:
  created:
    - src/ui/features/pretty-view/CopyableBlock.tsx
    - src/ui/features/pretty-view/CopyableBlock.test.tsx
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/ChatMessage.test.tsx
decisions:
  - Use window.navigator Proxy in tests to correctly intercept navigator.clipboard in vitest jsdom (Object.defineProperty on navigator is shadowed; the component sees real jsdom Clipboard through a different reference)
  - Clone wrapper node and remove copy button before extracting textContent so button label does not bleed into clipboard payload
  - Use data-testid='copyable-block-copy' to locate and strip the button from the clone
metrics:
  duration: ~25 minutes
  completed: 2026-07-30
---

# Quick 260730-ujq: Add Copy-to-Clipboard Button to Code Blocks and Blockquotes — Summary

**One-liner:** Glass-styled copy button on every pre/blockquote in pretty-view, using lucide Copy/Check icons with group-hover reveal and window.electronClipboard fallback.

## What Was Built

### Task 1: CopyableBlock component + unit tests

Created `src/ui/features/pretty-view/CopyableBlock.tsx` exporting `CopyableBlock`:
- Props: `{ as: "pre" | "blockquote"; className?: string; children?: ReactNode }` + rest spread (strips `node` from ReactMarkdown)
- Renders wrapper with `group relative` classes so the overlaid button positions correctly
- Copy button: `absolute top-1.5 right-1.5`, glass-cohesive styling (`bg-white/[0.06]`, `hover:bg-white/[0.12]`, `border border-white/[0.08]`, `text-[color:var(--color-pv-fg)]`)
- Visibility: `opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-150`
- Icons: `<Copy size={14}>` idle, `<Check size={14} data-testid="copyable-block-check">` in Copied state
- Accessible: `aria-label="Copy"` / `aria-label="Copied"` + `<span className="sr-only">` for testing-library compatibility
- Clipboard: prefers `window.electronClipboard?.writeText` (electron bridge), falls back to `navigator.clipboard.writeText`
- Text extraction: clones wrapper, removes button by `data-testid`, reads `textContent` — prevents button label from bleeding into clipboard payload
- Timer: `window.setTimeout` 1500ms revert; clears on re-click and on unmount via `useEffect` cleanup

Created `src/ui/features/pretty-view/CopyableBlock.test.tsx` with 8 tests covering behaviors A–F:
- A: children render inside correct wrapper tag (`pre` / `blockquote`)
- B: copy button present with `data-testid="copyable-block-copy"` and accessible name matching `/copy/i`
- C: click calls `navigator.clipboard.writeText` with block plain text (code text or blockquote textContent)
- D: Copied state appears immediately, reverts to idle after 1500ms via fake timers
- E: `window.electronClipboard.writeText` preferred when defined; `navigator.clipboard` not called
- F: rejection from `writeText` swallowed silently; button stays in idle state; no unhandled promise rejection

### Task 2: ChatMessage wiring

Modified `src/ui/features/pretty-view/ChatMessage.tsx`:
- Added `import { CopyableBlock } from "./CopyableBlock"`
- Added `pre` and `blockquote` overrides in the `ReactMarkdown components` map alongside existing `a` and `p` overrides
- `node` prop destructured out (ReactMarkdown-internal) before spreading to `CopyableBlock`
- No changes to `a`, `p`, injected-turn, quick-reply, or ThumbsUp branches

Modified `src/ui/features/pretty-view/ChatMessage.test.tsx`:
- Appended new `describe("ChatMessage — copy button on code blocks and blockquotes (quick 260730-ujq)")` block
- Test G: fenced code block renders exactly one `data-testid="copyable-block-copy"` element
- Test H: blockquote renders exactly one copy button, button is a descendant of `<blockquote>`
- Test I: plain prose produces zero copy buttons

### Task 3: Full test suite sweep

`npm test` passed with zero modifications — no snapshot breaks, no regressions.

## Test Counts

| Scope | New tests | Total suite |
|---|---|---|
| CopyableBlock.test.tsx | 8 (A–F) | 8 |
| ChatMessage.test.tsx | 3 (G–I) | 11 (existing 8 + 3 new) |
| Full npm test | 0 new | 872 passed / 6 skipped |

## Files Touched

- `src/ui/features/pretty-view/CopyableBlock.tsx` (created)
- `src/ui/features/pretty-view/CopyableBlock.test.tsx` (created)
- `src/ui/features/pretty-view/ChatMessage.tsx` (modified — import + 2 component overrides)
- `src/ui/features/pretty-view/ChatMessage.test.tsx` (modified — appended 3 tests in new describe block)

No files outside `src/ui/features/pretty-view/` were modified.

## Commits

- `0212822` — `feat(260730-ujq-01): add CopyableBlock component with clipboard integration`
- `26cd804` — `feat(260730-ujq-01): wire CopyableBlock into ChatMessage pre/blockquote overrides`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed textContent including copy button label**
- **Found during:** Task 1 Test C
- **Issue:** `wrapperRef.current?.textContent` returned `"hello worldCopy"` because the button ("Copy" / "Copied") is a child of the wrapper element, so its text bleeds into the payload.
- **Fix:** Clone the wrapper node, remove the button by `data-testid` selector, then read `textContent` from the clone.
- **Files modified:** `src/ui/features/pretty-view/CopyableBlock.tsx`
- **Commit:** 0212822

**2. [Rule 1 - Bug] jsdom navigator.clipboard test isolation**
- **Found during:** Task 1 Tests C, E, F
- **Issue:** `Object.defineProperty(navigator, 'clipboard', ...)` in vitest jsdom tests only patches the test module's navigator view. The React component module accesses `navigator.clipboard` through the actual jsdom prototype chain and sees the real `Clipboard [EventTarget]` object, not the mock. This caused: (a) Test C showing 0 calls on the mock even though the component called writeText; (b) Test F showing "Copied" state when a rejecting mock was installed (because the real jsdom Clipboard's `writeText` resolves).
- **Fix:** Replace `window.navigator` with a `Proxy` that intercepts the `clipboard` getter to return the mock. The component's `navigator.clipboard` access goes through `window.navigator`, which is the proxy.
- **Files modified:** `src/ui/features/pretty-view/CopyableBlock.test.tsx`
- **Commit:** 0212822

## Grep Gate Confirmation

`grep -Eq "FAIL|failed|✗|Unhandled Rejection|UnhandledPromiseRejection"` on `/tmp/full-suite.log` (the captured `npm test` output) found **zero matches**.

Full suite output: `Tests 872 passed | 6 skipped (878)`, `Test Files 77 passed (77)`.

## Known Stubs

None.

## Threat Flags

None. `CopyableBlock` accesses browser clipboard APIs only. No new network endpoints, auth paths, or trust boundaries introduced. ReactMarkdown continues to sanitize content (no raw HTML).

## Self-Check: PASSED

- CopyableBlock.tsx: FOUND
- CopyableBlock.test.tsx: FOUND
- ChatMessage.tsx: FOUND
- ChatMessage.test.tsx: FOUND
- SUMMARY.md: FOUND
- Commit 0212822: FOUND
- Commit 26cd804: FOUND
