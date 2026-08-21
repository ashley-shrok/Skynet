# Phase 51 Verification — PASSED 8/8

**Verified:** 2026-08-21
**Verifier:** gsd-verifier agent (goal-backward, source-of-truth reads)
**Status:** passed
**Verdict:** ready for deploy

## Phase Goal

The BG-agents panel (rendered above the composebox in pretty view) admits currently-running `Agent{...}` sub-agent invocations from Claude Code v2.1.150+, whose tool_use payload no longer carries `input.run_in_background === true`. Async signal moved to `toolUseResult.isAsync === true` on the tool_result launch-ack. Backward-compat legacy admission path preserved. Bash-branch (empirically still uses legacy shape on 2.1.150+) is NOT modified.

## Commits Shipped

- `1697acdb` `feat(51-01): admit v2.1.150+ async Agent invocations via tool_result launch-ack`
- `87c8d817` `docs(51-01): complete plan — SUMMARY + STATE update`

## Verification Dimensions — 8/8 PASS

1. **Modern-shape async Agent admission** ✅ — stash at `src/backend/claude-session/claude-session-server.ts:465-476` (else-branch → `pendingAgentAdmission.set`); promote on `isAsyncAck` at L517-536 (`backgroundedAgents.set + pendingAgentAdmission.delete`).
2. **Legacy-shape admission preserved** ✅ — fast-path direct admit at L465-468 (`if (b?.input?.run_in_background === true) backgroundedAgents.set(b.id, info)`).
3. **Sync Agent scratch drop** ✅ — non-async completion else-branch at L537-558 drops `pendingAgentAdmission.delete(b.tool_use_id)` at L555 alongside pre-existing `backgroundedAgents.delete` at L547.
4. **Bash branch untouched** ✅ — pre-phase Bash body (`git show 96aa11a3:...ts:2527-2547`) byte-identical to post-phase L478-499 modulo extraction-indent. Zero `pendingAgentAdmission` references in Bash branch.
5. **Fixture coverage** ✅ — `claude-session-server.bg-agents-async-ack.test.ts` has 4 fixtures (A modern-async, B modern-sync-drop, C legacy full-lifecycle, D modern full-lifecycle) all passing.
6. **Non-regression** ✅ — `npx vitest run src/backend/claude-session/` → 33 files / 440 tests pass / EXIT=0.
7. **No forbidden touches** ✅ — code commit touched only the two intended files. Two-commit span shows only STATE.md + SUMMARY.md + the two src files. Zero matches for docker|nginx|frontend|coord|skynet-patches|src/ui.
8. **Live-diagnostic tie-back** ✅ — traced end-to-end against taylor's real `toolu_01C3yz4A5NV4AamxHQRZH7DH` — modern shape stashes to `pendingAgentAdmission`, matching async-ack promotes to `backgroundedAgents`, WS frame serializes, panel renders.

## Additional confirmations

- Scratch map lifecycle: declared L2377-2385, cleared at both reset sites (L2602 destroy, L3272 recycle).
- Helper `__admitBackgroundedAgentsLineForTests` called from production correlator at L2782-2786 — same code exercised by tests.
- No new dependencies, no TBD/FIXME/XXX in modified regions, scratch entries carry full `{toolUseId, subagentType, description, startedAt}` shape.

## Bounty resolution

Bug 1 of `claude-code-2-1-214-pretty-view-compat` (BG-agent panel misses async subagents on modern Claude Code) — **resolved**. Bug 2 (plan-pending bubble via `permission-mode` events) remains open on the bounty for a future phase.

---

*Verification complete: 2026-08-21 by gsd-verifier*
