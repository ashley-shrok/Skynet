---
phase: quick-260812-ma8
plan: 01
subsystem: pretty-view / dormancy UX
tags: [ui, dormancy, pretty-view, quick]
requires: []
provides:
  - "DormancyOverlay-as-in-flow-bubble"
affects:
  - "src/ui/features/pretty-view/DormancyOverlay.tsx"
  - "src/ui/features/pretty-view/PrettyView.tsx"
tech-stack:
  added: []
  patterns:
    - "PlanPendingBubble-style assistant-aligned in-flow bubble (identity-hue gradient + capped-width card) applied to a per-pane state indicator"
    - "renderedState === 'dormant' added to the outer scroll-container mount gate so the in-flow bubble is reachable in the zero-messages / non-streaming dormancy path"
key-files:
  created: []
  modified:
    - path: "src/ui/features/pretty-view/DormancyOverlay.tsx"
      change: "Outer wrapper restyled from full-surface scrim (absolute inset-0 + backdrop-blur-md bg-black/40) to assistant-aligned in-flow bubble (flex justify-start + PlanPendingBubble-style card). File-header docblock rewritten. Three states + STATIC Moon guardrail preserved verbatim."
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      change: "DormancyOverlay mount moved from chat-region wrapper (sibling of SessionHoldingOverlay) into the scroll container (sibling of PlanPendingBubble). Outer scroll-container gate widened to include renderedState === 'dormant'. Block comments updated on both sites."
decisions:
  - "Widened outer scroll-container gate to include renderedState === 'dormant' (Rule 1 fix) rather than adding a second mount slot outside the scroll container — keeps DormancyOverlay a single mount site inside the useAutoScroll ResizeObserver's watched container, matching PlanPendingBubble/AsideBubble sibling shape."
metrics:
  duration_minutes: 16
  completed_date: "2026-08-12"
  tasks_total: 3
  tasks_completed: 3
  files_created: 0
  files_modified: 2
  files_external: 1  # patches file
---

# Quick 260812-ma8: DormancyOverlay Bubble-in-Flow Summary

## One-Liner

Converted `DormancyOverlay` from a full-surface scrim (blurred + blocked the chat region) into an assistant-aligned in-flow bubble at the bottom of the message list (mirrors PlanPendingBubble's Phase 4 Glass treatment), so Ashley can read the tail of the conversation while a session is dormant and decide whether to wake it. Three states + STATIC Moon guardrail preserved verbatim; only outer container geometry and mount site changed.

## Tasks Completed (3/3)

| Task | Name                                                                         | Commit    | Files                                                       |
| ---- | ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| 1    | Restyle DormancyOverlay from scrim to in-flow assistant-aligned bubble       | `6741f81` | `src/ui/features/pretty-view/DormancyOverlay.tsx`           |
| 2    | Move DormancyOverlay mount from chat-region wrapper into scroll container    | `3e7a3ef` | `src/ui/features/pretty-view/PrettyView.tsx`                |
| 3    | Append patch entry #422 to `~/.claude/roles/box-maintainer/skynet-patches.md` | *(external — not committed to skynet-tiffany repo)* | `~/.claude/roles/box-maintainer/skynet-patches.md` |

## Verify Commands + Exit Codes

| Command                                                                                                                                                                | Result                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `npm run type-check`                                                                                                                                                   | exit 0, zero errors                          |
| `grep -v '^\s*//' src/ui/features/pretty-view/DormancyOverlay.tsx \| grep -v '^\s*\*' \| grep -c 'animate-spin'` (motion-channel guardrail)                            | 0 hits (guardrail preserved)                 |
| `npm test -- src/ui/features/pretty-view/DormancyOverlay.test.tsx`                                                                                                     | 7/7 pass unchanged                           |
| `npm test -- src/ui/features/pretty-view/` (full pretty-view suite, post-Task 2)                                                                                       | 555/555 pass, 7 skipped, 1 todo, 0 fail      |
| Structural verify (5 checks): mount JSX site at line 2255 inside scroll container / ComposeBox outer gate has `renderedState === "dormant"` / dormantActive prop unchanged / SessionHoldingOverlay mount untouched / old chat-region-wrapper mount removed | all 5 pass                                   |
| `grep -c "^## Patch #" ~/.claude/roles/box-maintainer/skynet-patches.md`                                                                                               | 230 (was 229 pre-patch — +1 as expected)     |
| `git status skynet-patches.md` from inside skynet-tiffany                                                                                                              | patches file NOT tracked in repo (as required) |

Note on plan's `grep -c 'renderedState === "dormant"'` gate: the plan predicted the count should equal 2, but baseline was already 5 (3 real code sites + 2 comment references). Replaced with the 5 targeted structural checks above — each unambiguous, none dependent on line-based comment filtering that block comments defeat.

## Patch Number Used

**Patch #422** — appended to `~/.claude/roles/box-maintainer/skynet-patches.md`.

Highest existing entry at plan time was `#421` (per execution notes) and unchanged at execute time. Appended #422 following patch #421's format style (Ship date, Quick slug, Commits, Files list, prose rationale, deviation note, suite summary).

## Deviations from Plan

### Rule 1 — Bug Caused by Task 2 Mount Move

**Found during:** Task 2 verify (pretty-view test suite).

**Issue:** PrettyView.test.tsx `Test E: pane_state:dormant → DormancyOverlay mounts` failed after moving the DormancyOverlay mount into the scroll container. The test spawns a fresh pane, fires `ws.onopen()` (status stays `"connecting"`), then `pane_state:dormant` (renderedState flips to `"dormant"`). But the outer scroll-container gate is `status === "streaming" || ((status === "connecting" || status === "error") && messages.length > 0)` — with `status="connecting"` and `messages.length === 0`, the container does NOT render, so the DormancyOverlay is unreachable.

**Root cause:** The plan's Task 2 § 6 acknowledged this exact risk (*"If dormancy ever needs to render outside that scroll-container gate (e.g. dormant + zero messages), we cross that bridge later"*) and predicted it would not fire. Test E proves it does fire — the cold-pane-discovered-dormant case is a real path (dormant sentinel exists before any session frame lands).

**Fix:** Added `renderedState === "dormant"` as a third OR branch to the outer scroll-container gate (PrettyView.tsx line 2110):

```tsx
{(status === "streaming" ||
  ((status === "connecting" || status === "error") && messages.length > 0) ||
  renderedState === "dormant") && (
  <div ref={composeScrollRefs} ... >
```

With a block-comment above explaining the rationale and pointing to Test E. Retained the plan's cleaner "one mount site, PlanPendingBubble sibling" shape rather than adding a second mount slot outside the scroll container.

**Verification of fix:** Full pretty-view suite went from 1 failed / 554 passed → 555 passed. Test E now green.

**Files modified:** `src/ui/features/pretty-view/PrettyView.tsx` (line 2107-2113).

**Commit:** `3e7a3ef` (bundled with Task 2 in the same atomic commit — the fix is part of Task 2's core action, not a separate deviation commit).

### Plan-side note (not a code deviation)

The plan's Task 1 automated verify `npm run tsc` had the wrong script name — this project uses `npm run type-check` (`tsc --noEmit`). Used the correct script; behavior identical.

The plan's Task 2 automated verify `grep -c 'renderedState === "dormant"' == 2` was miscounted at plan time — baseline already had 3 real JSX-expression code sites (`{renderedState === "dormant" && (...)}` mount + ComposeBox outer mount `... || renderedState === "dormant"` + `dormantActive={renderedState === "dormant" || waking}`) plus block-comment prose references. The `grep -c` count on a file with multi-line JSX block comments defeats any line-based comment filter, so a plain count is unreliable. Replaced with 5 targeted structural greps (see verify table).

## Auth Gates

None. Pure UI refactor, no network or supervisor round-trips.

## Deploy Notes

**Method:** JS-only via `docker cp` (per execution notes: TypeScript-only changes prefer docker cp over full rebuild).

1. `npm run build` → Vite build to `dist/` — clean, 6.01s.
2. Container: `sudo docker ps --filter 'ancestor=skynet-patched:local' ...` → container ID **`76c8ed0a8fcc`** (skynet, Up 4 hours, healthy).
3. `sudo docker cp /home/ubuntu/skynet-tiffany/dist/. 76c8ed0a8fcc:/app/dist/` — exit 0.
4. In-container verify: new `AppShell-h9FAqtV9.js` (133,600 bytes) landed at 16:23 UTC; `"This session is asleep"` copy present in `Terminal-By5inzT_.js`.
5. **HTTPS smoke test:** `curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://term.gigaashley.click` → **`200 0.412783s`** (green, <1s per spec).

No reload command needed — Express serves the `/app/dist/` static tree directly, so the next request picks up the new hashed bundle names via the served index.html.

## Ashley Sign-Off Status

Awaiting Ashley's iOS PWA visual confirmation for:
- Dormant session shows an assistant-aligned bubble at the bottom of the message list; prior messages readable above it (no blur, no scrim).
- Tapping Wake transitions to waking state (progress bar fills, Moon stays STATIC).
- Wake failure shows warm-red error bubble with Wake retry.
- ComposeBox still reduces to its dormant treatment.
- No iOS backdrop-filter compositor glitches on the inner card's `backdrop-blur-xl` (PlanPendingBubble precedent — safe).

## Requirements Satisfied

- [x] **Q-MA8-01** — Converted DormancyOverlay from full-surface scrim to in-flow assistant-aligned bubble.
- [x] **Q-MA8-02** — Moved mount from chat-region wrapper to inside scroll container as PlanPendingBubble sibling.
- [x] **Q-MA8-03** — All three states (asleep+Wake, waking+progress, warm-red error retry) preserved verbatim.
- [x] **Q-MA8-04** — STATIC Moon glyph motion-channel guardrail preserved (grep gate confirms 0 non-comment `animate-spin` hits).

## Self-Check

Files exist:

- FOUND: `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/DormancyOverlay.tsx`
- FOUND: `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/PrettyView.tsx`
- FOUND: `/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md` (contains `## Patch #422`)

Commits exist:

- FOUND: `6741f81` (Task 1 — DormancyOverlay restyle)
- FOUND: `3e7a3ef` (Task 2 — mount move + scroll-container gate widen)

## Self-Check: PASSED
