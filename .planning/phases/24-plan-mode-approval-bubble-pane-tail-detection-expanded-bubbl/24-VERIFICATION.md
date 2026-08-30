---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
verified: 2026-08-04T20:50:00Z
status: passed
score: 9/9 must-haves verified
human_verification:
  - test: "Live plan-approval on a fleet pane"
    expected: "Presence bubble mounts within ~one setInterval tick after Claude Code prints the plan prompt; header + plan file contents appear; Approve fires option 1; Feedback modal Submit lands feedback into Ink"
    why_human: "Requires a real Claude Code session that has just emitted the ExitPlanModeV2 prompt on the pinned fleet Ink variant — cannot be exercised without a live LLM turn"
  - test: "Ashley cannot accidentally approve via ComposeBox Enter during plan-pending"
    expected: "With bubble mounted, pressing Enter in the ComposeBox does NOT send anything and does NOT dispatch the raw_keystrokes '1\\r' payload"
    why_human: "Requires a real WS-connected pane with a real live plan_pending frame; the unit test proves the swallow at the handleKeyDown level, but the end-to-end wiring (WS frame → planPending state → planPendingActive prop → Enter swallow) benefits from a live tick to observe"
  - test: "Backend SFTP fetch pulls a real plan file over the pane's existing SSH Client"
    expected: "Within ~one setInterval tick after the presence emit, the WS delivers a second plan_pending frame carrying non-null planContent matching the file at ~/.claude/plans/<slug>.md on the target host"
    why_human: "Requires a real ssh2 Client with a real host, a real plans/ directory, and a real .md file present — the vitest suite proves the code path against mocks, not a live sftp subsystem"
  - test: "Aesthetic — bubble visual growth against real identity hue"
    expected: "Card grows downward while keeping the Phase 4 Glass identity-hue treatment; Approve reads as primary, Feedback reads as secondary; inline modal is legible and centered"
    why_human: "Visual/aesthetic — cannot be programmatically verified"
---

# Phase 24: Plan-mode approval bubble — Verification Report

**Phase Goal:** Make the Claude Code plan-approval prompt actionable from the pretty view. Ashley can now approve plan-mode prompts from the browser, see the plan she's approving, and give feedback via modal — without accidentally approving via compose-box Enter.

**Verified:** 2026-08-04T20:50:00Z
**Status:** PASSED

## Goal Achievement

### Observable Truths / Must-Haves

| # | Must-have | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Detection actually fires on the pinned fleet Ink variant with the correct verbatim strings (NOT the old strings) | PASS | `src/backend/claude-session/plan-pending-parser.ts:75` matches `shift+tab to approve with this feedback` (bottom-30 slice); L82-84 matches `Claude has written up a plan and is ready to execute. Would you like to proceed?`. Grep counts: new header = 2 occurrences, footer marker = 2, old strings (`No, keep planning` / `Here is Claude's plan:` / `Ready to code?`) = 0. Positive fixture at `plan-pending-parser.test.ts:26-38` uses the pinned-variant strings verbatim. Vitest: 5/5 isPlanPending cases pass. |
| 2 | Plan file path is extracted from the pane footer with the exact double-space + `·` (U+00B7) separator | PASS | `parsePlanFilePath` at `plan-pending-parser.ts:121-126` uses regex `/ctrl-g to edit in\s+Vim\s+·\s+(~\/\.claude\/plans\/[a-z0-9-]+\.md)/`. Tests at `plan-pending-parser.test.ts:92-138` cover happy path (returns `~/.claude/plans/groovy-watching-leaf.md`) + 5 rejection cases (null footer, uppercase slug, slash, backtick, non-`.md`). Vitest: 6/6 pass. Returns `null` on miss (does not throw). |
| 3 | Plan contents fetched via SFTP side-channel (not shell `cat`); path validation is fail-closed | PASS | `src/backend/ssh/plan-file-fetch.ts:246-277` implements `fetchPlanFile(sshConn, planFilePath)` using ssh2 `.sftp()` subsystem + `sftp.realpath(".")` + `sftp.stat()` + `sftp.readFile()` — zero shell. `validateFormat` (L147-179) runs SYNCHRONOUSLY before ANY `.sftp()` call, rejecting `..`, backticks, quotes, `$`, absent `.claude/plans/` prefix, missing `.md`, and slug outside `^[a-z0-9-]+$`. `MAX_PLAN_BYTES = 500 * 1024` (L39). No `cat` / `execCommand` shell fallback exists (grep -nE '\bcat\s|execCommand.*echo\s+\$HOME' returns 0 in this module). Vitest: 14/14 pass, 9 rejection tests assert `.sftp`/`.realpath`/`.stat`/`.readFile` are NEVER called. |
| 4 | WS `plan_pending` frame carries the extended `{planFilePath, planContent, contentError}` shape | PASS | Frontend type at `src/ui/api/claude-session-api.ts:117-124` declares `PlanPendingEvent.pending: { planFilePath: string \| null; planContent: string \| null; contentError: string \| null } \| null`. Backend emit sites: pane-scrape at `claude-session-server.ts:3452-3468` constructs `{planFilePath, planContent: cached?.content ?? null, contentError: cached?.error ?? null}` and JSONL-scan fallback at L1494 widened to match. Re-emit after async fetch at L3502-3520 carries populated `planContent` or `contentError`. De-dup via `planPendingLastSerialized` preserved. |
| 5 | Bubble renders plan contents inline with Approve + Feedback + inline Feedback modal (no spinner glyphs) | PASS | `src/ui/features/pretty-view/PlanPendingBubble.tsx` — 5-prop `PlanPendingBubbleProps` interface (L82-122); component (L124-276) renders header (ClipboardList + text), 4-state middle section (skip / error dim / italic "Loading plan…" text — no lucide spinner import / `<pre>` monospace with `max-h-[40vh]`), and footer with Approve (identity-hue HSLA primary) + Feedback (quiet secondary opening modal). Inline modal at L227-273: `fixed inset-0 z-50` backdrop with click-to-close, autoFocus textarea, Cancel + Submit (disabled while trimmed empty). Only lucide import is `ClipboardList` — no `Loader`/`RefreshCw`/`Spinner` glyphs. |
| 6 | Approve sends `1\r` via `raw_keystrokes` WS → `tmux send-keys -l` (NOT split-send) | PASS | `PrettyView.tsx:400-408` — `handlePlanApprove` sends `JSON.stringify({ type: "raw_keystrokes", bytes: "1\r" })`. Backend handler at `claude-session-server.ts:3196-3218` dispatches on `msg.type === "raw_keystrokes"` and calls `execCommand(sshConn, \`tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}\`)` — the `-l` (literal) flag is the load-bearing anti-split-send guarantee. Single `execCommand` call, no gap, no separate `\r` send. |
| 7 | Feedback modal Submit sends `3<feedback>\r` via same `raw_keystrokes` path | PASS | `PrettyView.tsx:410-420` — `handlePlanFeedback(feedback)` sends `JSON.stringify({ type: "raw_keystrokes", bytes: \`3${feedback}\r\` })`. Bubble's Submit handler (`PlanPendingBubble.tsx:135-141`) trims the input, refuses empty, calls `onFeedback(trimmed)`. Same backend handler as #6 → same `tmux send-keys -l` single-call path. |
| 8 | Compose-box disables reset/send/mic/queue/thumbs/recap when planPendingActive; textarea stays typeable; no new visual affordance | PASS | `ComposeBox.tsx` — `planPendingActive?: boolean` prop declared L297; destructured L326. OR-in'd at 11 sites matching recycleActive parity: Enter-swallow (L1395), showPrimaryArmButton (L1467), sendDisabled (L1500), Reset (L1637), ThumbsUp (L1859), Recap (L1889), QueuedRow pass-through (L1933), queued-Paperclip (L2627), handleVoiceSend primary+slot (L1188, L1201), showSlotArmButton (L2474). Textarea `disabled={primaryArmed}` at L1998 is UNCHANGED (does NOT include planPendingActive) — stays typeable. Primary Paperclip + MicButton disable predicates also unchanged (mic-available parity). No banner, no tooltip, no new affordance added. Truth-table vitest suite: 10/10 pass (`ComposeBox.plan-pending-disable.test.tsx`). |
| 9 | `raw_keystrokes` handler uses connection-captured tmuxSession, ignores client payload | PASS | `claude-session-server.ts:3196-3218` — handler early-returns if `!sshConn \|\| !currentTmuxSession` (connection-captured state). Only reads `msg.bytes` from payload; passes `currentTmuxSession` (NOT any `msg.hostId` / `msg.tmuxSession`) to `shellQuote()` in the send-keys command. Frontend `RawKeystrokesPayload` type (`claude-session-api.ts:297-300`) intentionally carries ONLY `{type, bytes}` — no hostId/tmuxSession fields exist to send. Trust boundary docblock at L3190-3195 explicitly names T-14-02-01 pattern reuse. |

**Score:** 9/9 must-haves verified

### Automated Test Results

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | 0 errors, exit 0 |
| `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts` | 11/11 passing |
| `npx vitest run src/backend/ssh/plan-file-fetch.test.ts` | 14/14 passing |
| `npx vitest run src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` | 10/10 passing |
| Combined (all three) | **35/35 passing** in 3.96s |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `claude-session-server.ts` pane-scrape emit | `parsePlanFilePath` | `import { ... parsePlanFilePath } from "./plan-pending-parser.js"` (L12) + call at L3435 | WIRED |
| `claude-session-server.ts` pane-scrape | `fetchPlanFile` | `import { fetchPlanFile } from "../ssh/plan-file-fetch.js"` (L13) + call at L3488 | WIRED |
| `claude-session-server.ts` raw_keystrokes handler | tmux PTY | `execCommand(sshConn, \`tmux send-keys -l -t <session> <bytes>\`)` at L3201-3204 | WIRED |
| `PrettyView.tsx` planPending state | `PlanPendingBubble` | Mounted L1322-1330 passing all 5 props | WIRED |
| `PrettyView.tsx` `handlePlanApprove`/`handlePlanFeedback` | Backend `raw_keystrokes` handler | `wsRef.current.send(JSON.stringify({type:"raw_keystrokes", bytes: ...}))` at L404 + L414-416 | WIRED |
| `PrettyView.tsx` planPending state | `ComposeBox.planPendingActive` | `planPendingActive={planPending !== null}` at L1449 | WIRED |

### Data-Flow Trace

| Artifact | Data Variable | Source | Real Data? | Status |
|---------|---------------|--------|-----------|--------|
| `PlanPendingBubble` | `planContent` prop | PrettyView `planPending.planContent` state ← WS `plan_pending` frame ← backend re-emit ← `fetchPlanFile()` ← SFTP `readFile()` | Yes (real SFTP subsystem call on ssh2 Client) | FLOWING |
| `PlanPendingBubble` | `planFilePath` prop | PrettyView `planPending.planFilePath` ← backend `parsePlanFilePath(output)` ← real pane text from `tmux capture-pane -p` | Yes | FLOWING |
| `ComposeBox` | `planPendingActive` prop | PrettyView `planPending !== null` boolean derivation | Yes | FLOWING |

### Anti-Patterns Scanned

| Concern | Result |
|---------|--------|
| Old fingerprint strings persist in parser | 0 matches (`No, keep planning` / `Here is Claude's plan:` / `Ready to code?` all absent) |
| Shell `cat` / `execCommand("echo $HOME")` for plan file | 0 matches — SFTP subsystem is the sole read path |
| Split-send used for Approve/Feedback | Not present — sole path is `tmux send-keys -l` single call |
| Spinner glyph in bubble | 0 lucide spinner imports (only `ClipboardList`); "Loading plan…" is italic text |
| Trust-boundary violation in raw_keystrokes | None — handler ignores msg payload beyond `bytes`; uses connection-captured `currentTmuxSession` |
| Unresolved TBD/FIXME/XXX debt markers | None in files modified by this phase |

### Human Verification Required

Four items (visual/real-time/external-service verification that grep cannot cover). See `human_verification` in frontmatter.

## Gaps Summary

None. Every must-have from CONTEXT.md's 5-piece phase-boundary breakdown is present in the shipped code, wired end-to-end (WS ↔ backend ↔ SFTP ↔ frontend), covered by automated tests where testable, and correctly gated at the trust boundary. tsc is clean; the 35 phase-specific vitest cases all pass.

The four human-verification items are inherent to the feature's nature (live plan-mode Ink prompt against a real Claude Code session, real SFTP fetch against a real host, live WS wiring end-to-end, and aesthetic review) — they are not gaps in the delivered code.

---

*Verified: 2026-08-04T20:50:00Z*
*Verifier: Claude (gsd-verifier)*
