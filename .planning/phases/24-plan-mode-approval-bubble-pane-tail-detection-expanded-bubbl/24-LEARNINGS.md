# Phase 24 — Learnings

**Phase:** 24 — Plan-mode approval bubble
**Extracted:** 2026-08-04

## Decisions

- **Detection lives in the pane, not the JSONL.** Reaffirmed the patch #63 → pane-scrape swap: Claude Code Ink v2 buffers `ExitPlanMode` tool_use until after user resolution, so JSONL is silent during the entire pending window. Pane-scrape is the only reliable live signal.
- **Approve/Feedback use `raw_keystrokes` WS → `tmux send-keys -l` (single write)**, not the ComposeBox split-send (patch #67 lesson: Ink Plan Mode does not consume the 60ms-gap `\r`). New WS event type + backend handler.
- **Plan contents fetched via SFTP side-channel on the tab's existing ssh2 Client**, not `cat` over shell (no shell parsing → no path-injection surface), not pane-scrape of the plan content (ANSI-rendered, potentially truncated by Ink pagination). Path validation is fail-closed security boundary with dedicated test coverage.
- **`planPendingActive` prop is a verbatim clone of the `recycleActive` shape** — three independent boolean props (`asideActive` / `recycleActive` / `planPendingActive`), no combined `interactionsDisabled` flag. Send button stays as Send (disabled), unlike asideActive which morphs Send into a Resume affordance.

## Patterns

- **Emit-on-diff WS frames** using `JSON.stringify` sentinel comparison. The `planPendingLastSerialized` idiom carried into the extended `{planFilePath, planContent, contentError}` shape without change — JSON.stringify handles the object-comparison naturally.
- **Trust-boundary rule for WS handlers:** connection-captured `currentTmuxSession`/`currentHostId`, never client-supplied. Mirrors the `aside_dismissed` handler (T-14-02-01). The new `raw_keystrokes` handler follows this verbatim.
- **Per-window token for async lifecycle guards.** For any async operation dispatched from a pending-window that can outlive that window, capture a token at dispatch, compare at resolve, drop stale results. The `.serialized === "null"` sentinel is insufficient because it doesn't detect window-shape changes (different slug appears without going through null).
- **Bottom-slice anchoring for pane-scrape parsers.** Detection AND path extraction both anchor to the last 30 lines. Whole-pane scans can be fooled by prose that quotes the target strings earlier in the transcript.

## Lessons

- **Verifier PASSED but Reviewer found the async race (CR-01).** Verifier's goal-backward analysis confirms "does the code deliver X for the happy path?" but does NOT reason about cross-cutting concurrency invariants (async lifecycle × cache scoping × user-driven window transitions). **Code review gate is load-bearing, not decorative** — do NOT skip it on multi-plan phases with async lifecycle surface even when Verifier is green.
- **Detection code without a real-captured-pane test can silently no-op indefinitely.** `plan-pending-parser.ts` (commit `911dbfb`, quick `260802-rps`) was authored against strings that never appear in the pinned fleet variant. It ran for 2 days doing nothing before this phase caught it. Rule going forward: **any parser anchored to specific external strings MUST include at least one test case built from a real captured pane, not a synthetic reconstruction.**
- **Executor "auto-fixes" that touch controls outside the plan's `files_modified` scope are scope creep**, even when they feel like consistency (WR-02: executor added `!recycleActive` alongside `!planPendingActive` on `showSlotArmButton` because the parity felt natural, silently changing pre-Phase-24 behavior for a control the plan never intended to touch). Rule: executors stay strictly in the plan's declared file × predicate scope; parity/consistency extensions belong in a follow-up plan the user can weigh in on.
- **CONTEXT.md's explicit "same slug regenerate" edge case** was the exact scenario the reviewer's CR-01 fix addresses. When CONTEXT.md flags a subtle case, the planner + executor + verifier chain needs to explicitly wire test/verify coverage for it — mentioning it in prose is necessary but NOT sufficient.

## Surprises

- **The plan-pending-parser had been silently dead for 2 days.** The docblock's "live confirmation on Moxie's workstation 2026-08-02" implied verification had happened, but the strings that landed didn't match the fleet Ink variant — the verification was against a different version at some point in the past, not the currently-pinned fleet. Verifying against a captured pane at commit-time is the fix.
- **The ssh2 `Client` handle IS already exposed** in `claude-session-server.ts:969`. The plan tentatively allowed for a fresh-handshake fallback path if the `Client` wasn't reachable, but pattern-mapper found it exposed and the primary side-channel path was viable from day one. Zero new handshake cost.
- **Fleet-pinned single Ink variant simplifies the parser considerably.** No version-drift OR-branches, no fingerprint alternates, one set of verbatim strings. Worth reaffirming: **fleet pinning is a load-bearing simplification for detection code, not just deployment convenience.**
