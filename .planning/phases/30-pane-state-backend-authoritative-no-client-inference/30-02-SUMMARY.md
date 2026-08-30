---
phase: 30-pane-state-backend-authoritative-no-client-inference
plan: 02
subsystem: backend/claude-session
tags: [backend, parser, id-reset, holding, pane-state, wave-2]
dependency-graph:
  requires:
    - "Plan 30-01: pane-state-emitter.ts + createPaneStateEmitter factory + per-connection paneStateEmitter instantiation in claude-session-server.ts"
  provides:
    - "detectIdReset(obj) pure predicate exported from session-file-parser.ts — usable by any consumer that wants to observe /id reset events at the raw JSONL object level"
    - "onLine consumer wiring: paneStateEmitter.emit('holding', 'id_reset') fires on the FIRST-priority parser observation channel (before Layer 1 tail-state reducer), giving pretty-view the earliest real 'recycling starts now' signal per PS30-02"
    - "HARD LOCK-preserving detection design: /id reset user turns still render as normal chat bubbles in pretty view (per Ashley's slash-command visibility doctrine at claude-session-server.ts:1620-1623 — unchanged) AND fire the pane_state:holding transition — orthogonal channels"
  affects:
    - "src/backend/claude-session/session-file-parser.ts (new export; parseSessionLine untouched)"
    - "src/backend/claude-session/claude-session-server.ts (onLine gains observation channel; Layer 1 arm_holding branch INTACT per F2 acknowledgment)"
tech-stack:
  added: []
  patterns:
    - "pure predicate pattern (mirrors detectRelayInbound/detectRelayOutbound in the same file)"
    - "parallel JSON.parse observation channel (mirrors backgrounded-agents scan posture at ~L1665)"
    - "orthogonal detection + emission channels (detection observes; parseSessionLine emits; neither suppresses the other)"
    - "defense-in-depth redundancy across two disjoint code paths (object-based in parser, raw-string in layer1-detect.ts) — safe under emitter dedupe iff Test 12 round-trip invariant holds"
key-files:
  created:
    - src/backend/claude-session/session-file-parser.id-reset.test.ts
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "Parser observation channel placed BEFORE Layer 1 dispatch in onLine (not between Layer 1 and backgrounded-agents scan). Rationale documented in Deviations §1 — resolves plan-text ambiguity in favor of the F2 example comment's 'above' wording + PS30-02's 'earliest real signal' goal."
  - "Layer 1 arm_holding branch kept INTACT (F2 acknowledgment). Deletion rejected on three grounds: (a) defense-in-depth against future parser regression via disjoint code paths, (b) Layer 1 ALSO owns the clear_holding transition that arm_holding is symmetric with, (c) preserves the holdingReason === 'id_reset' guard at L2232 in transitionFromHoldingToActiveSameFile that only the arm branch produces."
  - "detectIdReset excludes ARRAY-shaped user content at the object level — mirrors layer1-detect.ts:85's `line.includes('\"tool_result\"')` exclusion but implemented on the parsed object. User turns with array content are tool_result feedback (agent-side synthetic); Test 7 covers this spoof vector."
metrics:
  duration: "~15m active (session-limit reset added ~65m clock gap between commits 1a7ca9e and b623776)"
  completed: "2026-08-10T11:20:27Z"
  test_count: "13 new tests (session-file-parser.id-reset.test.ts) + 24 backend claude-session files / 305 tests total green"
---

# Phase 30 Plan 30-02: Backend Parser /id reset Observation Channel Summary

Teaches `session-file-parser.ts` to detect `/id reset` in user turns via a pure `detectIdReset(obj)` predicate, and wires `onLine` in `claude-session-server.ts` to fire `paneStateEmitter.emit("holding", "id_reset")` on the observation — the earliest real "recycling starts now" signal per PS30-02. The `/id reset` user turn CONTINUES to render as a normal chat bubble in pretty view (Ashley's slash-command visibility HARD LOCK preserved verbatim per the revised B1 CONTEXT.md design). Layer 1 tail-state reducer's `arm_holding` branch stays intact as defense-in-depth (F2 acknowledgment).

## What Shipped

### New files

- **`src/backend/claude-session/session-file-parser.id-reset.test.ts`** (~320 LOC, 13 vitest cases): Tests 1-2 cover bare + freeform `/id reset` positive detection; Tests 3-5 cover the negative `/id save|list|tanya` subcommands; Test 6 rejects assistant-turn spoof; Test 7 rejects `tool_result` user-turn spoof; Test 8 rejects non-user, non-assistant types; **Tests 9-11 assert `parseSessionLine(...).kind === "message"` for `/id reset` (bare + freeform) AND `/id save` — the HARD LOCK regression gate**; Test 12 proves `detectIdReset` and `layer1-detect.ts:isIdResetUserTurn` agree on truth for the same input (the round-trip invariant that keeps emitter dedupe safe); **Test 13 proves detection AND message-emission fire independently on the same `/id reset` line — the load-bearing orthogonality invariant of the B1-revised design**.

### Modified files

- **`src/backend/claude-session/session-file-parser.ts`** (+57 lines, 0 deletions): Adds `export function detectIdReset(obj: Record<string, unknown>): boolean` immediately before `extractImageRefs`. Predicate returns true iff (a) `obj.type === "user"`, (b) `obj.isMeta !== true`, (c) `message.content` is a STRING (array-shaped content is `tool_result` feedback — mirrors layer1-detect.ts:85 exclusion at the object level), and (d) content contains BOTH `<command-name>/id</command-name>` AND `<command-args>reset` (PREFIX match so freeform explanations still fire). `parseSessionLine` is UNTOUCHED — the message-emission path for `/id reset` user turns is byte-identical to pre-plan behavior.

- **`src/backend/claude-session/claude-session-server.ts`** (+44 / -1 line): Import extended from `parseSessionLine` alone to `parseSessionLine, detectIdReset`. `onLine` gains a parser observation channel BEFORE the Layer 1 dispatch: a fresh `JSON.parse(line)` (mirroring the backgrounded-agents scan posture at ~L1665) with `if (detectIdReset(obj)) paneStateEmitter.emit("holding", "id_reset")`. New F2 acknowledgment comment sits between the observation channel and the existing Layer 1 doctrine block, documenting why the Layer 1 `arm_holding` branch stays despite being redundant for wire emission (defense-in-depth against future parser regression + Layer 1's ownership of the `clear_holding` transition + the `holdingReason === "id_reset"` guard at L2232 coupling).

## HARD LOCK Preservation — Verification Evidence

Ashley's pre-existing slash-command visibility HARD LOCK (`claude-session-server.ts:1620-1623` — the "slash commands must remain visible in pretty view. The state transition is orthogonal to whether the /id reset text renders as a chat bubble. DO NOT `return` here." doctrine block) is byte-identical:

- `git diff src/backend/claude-session/claude-session-server.ts | grep -cE '^-.*(HARD LOCK|slash commands|visible in pretty view|DO NOT|return.*here)'` → **0** (no lines from the doctrine block removed).
- Tests 9, 10, 11 in `session-file-parser.id-reset.test.ts` assert `parseSessionLine(<any /id reset or /id save line>).kind === "message"` — the /id reset text emits as a normal chat bubble via the unchanged `case "message"` dispatch branch.
- Test 13 asserts BOTH `detectIdReset(JSON.parse(rawLine)) === true` AND `parseSessionLine(rawLine).kind === "message"` on the same `/id reset` line — orthogonality invariant verified.

Parser regression gates green:
- `grep -c 'why: "id_reset"' src/backend/claude-session/session-file-parser.ts` → **0** (parser NEVER returns a skip.why=id_reset shape — the observation channel is exclusively the exported predicate)
- `grep -cE "return\s*\{\s*kind:\s*[\"']skip[\"']\s*,\s*why:\s*[\"']id_reset[\"']" src/backend/claude-session/session-file-parser.ts` → **0** (belt-and-suspenders check on the return shape)
- `grep -c 'kind: "message"' src/backend/claude-session/session-file-parser.ts` → **3** (unchanged from pre-plan baseline — no message-return line was removed)

## F2 Acknowledgment — Layer 1 arm_holding INTACT

Per plan Task 2 F2 acknowledgment, the Layer 1 tail-state reducer's `transitionToHolding("id_reset")` at L1668 (post-plan line number; was L2191 in the pre-plan doc block referenced by the plan) stays intact even though the parser observation channel above it catches every real `/id reset` on the first pass. Rationale documented inline via a new comment block:

```
// Phase 30 F2 acknowledgment: after the parser observation channel
// above fires paneStateEmitter.emit("holding", "id_reset") on real
// /id reset lines, this Layer 1 arm_holding path is functionally
// redundant for wire emission (emitter dedupe collapses both to
// one frame). The branch stays intact as defense-in-depth against
// future parser regressions (raw-string detection in layer1-detect.ts
// is a disjoint code path from object-based detection in
// session-file-parser.ts:detectIdReset), and because Layer 1 ALSO
// owns the clear_holding transition + the holdingReason === "id_reset"
// guard at L2232 in transitionFromHoldingToActiveSameFile that this
// arm path is the sole producer of. Do NOT delete this branch.
```

Redundancy proof: the emitter dedupe (Plan 30-01 pane-state-emitter.ts:174-184) treats back-to-back identical `("holding", "id_reset")` emits as a single wire frame. Parser observation channel fires first (line 1625), Layer 1 dispatches second and calls `transitionToHolding("id_reset")` which internally calls `paneStateEmitter.emit("holding", reason)` at L2191 — the second emit is a dedupe-hit no-op. Result: ONE wire frame per real `/id reset` line, regardless of whether one or both detection paths fire.

## Round-trip Invariant Verified (Test 12)

`layer1-detect.ts:isIdResetUserTurn` (raw-string byte-match) and `session-file-parser.ts:detectIdReset` (object-level predicate) MUST agree on truth for every input line — otherwise one detection path could fire without the other, breaking the emitter dedupe assumption. Test 12 walks 2 positive lines (bare + freeform `/id reset`) and 4 negative lines (`/id save`, `/id list`, assistant echo, tool_result user turn) through BOTH detectors and asserts equal truth values. All 6 cases pass.

Both detectors use the SAME semantic gates:
- User-turn check: `isUserTurn` (raw-string `"type":"user"` + `"tool_result"` exclusion) vs. `detectIdReset` (object `type === "user"` + `Array.isArray(content)` exclusion — the object equivalent of the tool_result exclusion since tool_results in user turns live in array-shaped content).
- Command-name/args check: `line.includes("<command-name>/id</command-name>") && line.includes("<command-args>reset")` in both — identical strings, identical prefix semantics on `reset`.

## Test Results

```
$ npx vitest run src/backend/claude-session/session-file-parser.id-reset.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ npx vitest run src/backend/claude-session/session-file-parser.test.ts
 Test Files  1 passed (1)
      Tests  38 passed (38)                    ← existing suite untouched, still green

$ npx vitest run src/backend/claude-session/
 Test Files  24 passed (24)
      Tests  305 passed (305)                  ← 292 pre-plan (Plan 30-01) + 13 new = 305 ✓

$ npx tsc --noEmit
(exit 0, no output)
```

Backend claude-session suite went from 23 files / 292 tests post-30-01 to 24 files / 305 tests post-30-02 — the delta is exactly the new `session-file-parser.id-reset.test.ts` file with 13 tests. Every pre-existing test still passes, proving no regression to non-id_reset parser paths AND no regression to the previously-`kind:"message"` /id reset lines.

## Deviations from Plan

### 1. [Rule 3 - Blocking-issue resolution] Resolved plan-text ambiguity on parser observation placement

- **Found during:** Task 2 wire-in
- **Issue:** The plan text had a semantic conflict between two placement directives:
  - `<action>` block said: *"Add the parser observation channel between steps 2 and 3"* (i.e., BETWEEN Layer 1 dispatch and backgrounded-agents scan — so AFTER Layer 1).
  - F2 example comment used the phrase *"after the parser observation channel above fires..."* — the word "above" implies the observation channel is placed ABOVE the Layer 1 dispatch block, not below it.
- **Fix:** Placed the parser observation channel BEFORE Layer 1 dispatch. This resolution is consistent with:
  1. The F2 comment's "above" wording (which is the load-bearing text the plan asks to preserve verbatim).
  2. PS30-02's stated goal that the parser observation is "the earliest real signal" — placing it first in the code flow makes it also first in temporal ordering.
  3. The emitter dedupe semantics — either ordering produces the same one-wire-frame outcome due to Plan 30-01's dedupe on strict `(state, reason)` equality, but the before-Layer-1 placement makes the observation-channel-first design explicit in code order.
- **Files modified:** `src/backend/claude-session/claude-session-server.ts` (observation channel at L1600-1629, above Layer 1 dispatch that now starts at L1650+)
- **Commit:** `b623776`

### 2. [Plan-arithmetic error — same pattern as Plan 30-01 SUMMARY §1] Grep-count acceptance criteria off by JSDoc/comment references

- **Task 1 acceptance:** `grep -c 'detectIdReset(' src/backend/claude-session/session-file-parser.ts` returns 3, not the specified 1. The 3 hits are: (a) one function declaration (`export function detectIdReset(...)`), plus (b) two JSDoc references (`* JSONL line, \`detectIdReset(JSON.parse(line))\` and`, `* for a real /id reset line, BOTH \`detectIdReset(JSON.parse(line)) === true\``). The B1 intent — *parseSessionLine does NOT call detectIdReset* — is exactly met: zero actual code call sites exist in the parser (verified via `grep -cE "^[^*/]*[^ ]detectIdReset\(" ...` returning 0). The two extra grep hits are documentation-only.
- **Task 2 acceptance:** `grep -c 'paneStateEmitter\.emit("holding", "id_reset")' src/backend/claude-session/claude-session-server.ts` returns 2, not the specified 1. The 2 hits are: (a) the observation-channel call at line 1625, plus (b) one reference inside the F2 acknowledgment comment (`// above fires paneStateEmitter.emit("holding", "id_reset") on real`). Only 1 actual code call site exists.
- **Task 2 acceptance:** `grep -c "slash commands must remain visible in pretty view"` returns 0, not 1. The string legitimately spans two comment lines in the pre-existing HARD LOCK block (`// a message (per Ashley's HARD LOCK: slash commands must remain` / `// visible in pretty view).`). The plan-text criterion was written as if the string were on one line. HARD LOCK preservation was verified via the diff-based check `git diff | grep -cE '^-.*(HARD LOCK|slash commands|visible in pretty view|DO NOT|return.*here)'` returning 0 — no lines removed from the doctrine block.
- **Fix:** None needed for the code — all criteria's INTENTS are met. Documented for future planner-tool arithmetic-precision improvements. This matches the Plan 30-01 SUMMARY §Deviations §1 pattern (`createPaneStateEmitter` grep count off by 1 due to the import statement being counted).

### 3. [Not a deviation — scope-boundary compliance] Parallel-wave 30-03 uncommitted diffs in src/ui/ NOT touched

During the session-limit reset, Wave 2 sibling agent 30-03 was executing in parallel. When my session resumed I found uncommitted diffs on `src/ui/features/pretty-view/PrettyView.tsx` (+246/-303) and `src/ui/api/claude-session-api.ts` (+30/-0). Per the plan prompt's no-worktree note ("You MUST NOT touch any file in src/ui/features/pretty-view/ (30-03's territory)"), I did not stage, revert, or otherwise touch those files. Only `src/backend/claude-session/*` files were staged for my commits.

## Surprises & Notes for Downstream

- **No surprises with the parallel JSON.parse.** The observation channel's fresh `JSON.parse(line)` runs cleanly alongside parseSessionLine's own internal JSON.parse; malformed lines fall through the try/catch and parseSessionLine subsequently surfaces them as `kind:"malformed"` via its own error path. Aggregate cost of two JSON.parses per line is negligible at live tail volumes (single-digit lines/sec typical, hundreds/sec worst-case during heavy tool-use bursts).
- **Emitter dedupe order verified in-head, not empirically.** The parser observation channel fires `emit("holding", "id_reset")` at line 1625; if Layer 1's tail-state reducer subsequently arms via `applyLineToLayer1State(...)` returning `"arm_holding"` and dispatches to `transitionToHolding("id_reset")`, that helper's own `paneStateEmitter.emit("holding", reason)` at L2191 (reason forwards as `"id_reset"`) is a strict `(state, reason)` equality hit against the observation channel's just-set `current` — the dedupe returns without calling `wsSend`. Wire result: one frame per real `/id reset`. No integration test in this plan directly asserts the "one wire frame" outcome — that would require spinning up a WebSocketServer + ssh2 fake pair or wiring an integration seam. If a bug ever surfaces here, the fix is to add such a seam. For now the invariant is guaranteed by (Test 12 round-trip) + (Plan 30-01 emitter unit tests proving dedupe on strict equality).
- **No new `holdingReason` mutation path.** The plan does not add a new mutation of `holdingReason`; that state variable is set inside `transitionToHolding` (Layer 1's path) at L2192-2193. The parser observation channel bypasses `transitionToHolding` and emits directly to the emitter, so `holdingReason` stays `null` on the observation-only fast path UNLESS Layer 1 subsequently dispatches on the same line (which it will for any real `/id reset` per Test 12 agreement). This is correct — `holdingReason` is a Layer 2 same-file-active bookkeeping flag; if the parser observation somehow fired without Layer 1 following up (Test 12 says this cannot happen), the `holdingReason === "id_reset"` guard at L2232 would not gate and Layer 2's same-file-active clear could false-fire. But Test 12 makes that scenario impossible.

## Consumer Guidance (for downstream Plan 30-03)

Plan 30-03 (frontend consumer) reads `pane_state` wire frames from the WebSocket. The parser observation channel added here does NOT add any new reason codes to Plan 30-03's already-documented vocabulary — `"id_reset"` was already in the reason vocabulary published by Plan 30-01 SUMMARY (see the "Full Reason-Code Vocabulary" table in `30-01-SUMMARY.md`). The only wire-observable difference for a fresh `/id reset` after this plan lands is: the `pane_state:holding` frame will appear ~milliseconds earlier (when the parser sees the raw JSONL line) instead of waiting for the Layer 1 tail-state reducer's dispatch — but the frame's payload `{ type: "pane_state", state: "holding", reason: "id_reset" }` is byte-identical.

## Self-Check: PASSED

- `[ -f src/backend/claude-session/session-file-parser.id-reset.test.ts ]` → FOUND (320 lines, 13 vitest cases)
- `[ -f src/backend/claude-session/session-file-parser.ts ]` → FOUND (+57 lines of detectIdReset + JSDoc; parseSessionLine untouched)
- `[ -f src/backend/claude-session/claude-session-server.ts ]` → FOUND (+44 / -1 line onLine observation channel + F2 comment; HARD LOCK doctrine block byte-identical)
- Commit hashes in git log:
  - `4678432` test(30-02): add failing tests for detectIdReset pure predicate → FOUND
  - `1a7ca9e` feat(30-02): implement detectIdReset pure predicate → FOUND
  - `b623776` feat(30-02): wire detectIdReset observation channel into onLine dispatch → FOUND
- `npx vitest run src/backend/claude-session/` → 24 files, 305 tests, 0 failures (green)
- `npx tsc --noEmit` → exit 0

## TDD Gate Compliance

Task 1 followed strict RED / GREEN cycle:
- RED gate: `test(30-02): add failing tests for detectIdReset pure predicate` (`4678432`) — 10 tests fail on `detectIdReset is not a function`, 3 tests already green (Tests 9/10/11 exercise parseSessionLine's unchanged message-emission path, which works pre-plan since /id reset lines were always kind:"message" — that's the whole HARD LOCK point).
- GREEN gate: `feat(30-02): implement detectIdReset pure predicate` (`1a7ca9e`) — all 13 new tests pass, 38 existing session-file-parser tests still green, tsc clean.

Task 2 was `tdd="false"` per the plan frontmatter (`type="auto"` without `tdd="true"`) — verification via full backend claude-session suite still passing (regression coverage over the wiring) rather than net-new unit tests for the wiring itself. All 305 backend tests green.
