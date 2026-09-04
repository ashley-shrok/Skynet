---
phase: quick-260809-eqk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/terminal/Terminal.wiring.test.ts
autonomous: true
requirements:
  - quick-260809-eqk
user_setup: []

must_haves:
  truths:
    - "When a Terminal pane's isVisible flips true→false, the SSH WebSocket (webSocketRef.current) is closed and any pending reconnect timer is cleared."
    - "When a Terminal pane's isVisible flips false→true and attach is true, a reconnect is initiated via the existing attemptReconnection()/setup-effect path (no new connect path invented)."
    - "attemptReconnection() early-returns without scheduling when isVisibleRef.current is false — patch #148-analog auto-reconnect cannot fight the pause."
    - "The iOS PWA visibilitychange handler at Terminal.tsx:375 early-returns without calling connectToHost when isVisibleRef.current is false — foreground events cannot reopen a hidden pane's WS."
    - "PrettyView diag registerPane snapshotFn reports the current live isVisible (via isVisibleRef.current), not a stale-closured value from first registration."
    - "The main WS-setup effect at Terminal.tsx:2903 stays keyed on attach (NOT isVisible) — URL-restored active-set members still open their WS on mount even offscreen. The new pause effect then immediately closes it (accepted tradeoff — tmux persists across WS disconnects)."
    - "npx tsc --noEmit passes."
    - "npx vitest run reports zero failures; regression-check against iter 1 baseline 1556 pass / 6 skip."
  artifacts:
    - path: "src/ui/features/terminal/Terminal.tsx"
      provides: "WS-pause layer on isVisible + guards on attemptReconnection() and visibilitychange handler"
      contains: "useEffect"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "diag emitter stale-closure fix in registerPane snapshotFn (isVisible → isVisibleRef.current)"
      contains: "isVisibleRef.current"
    - path: "src/ui/features/terminal/Terminal.wiring.test.ts"
      provides: "structural-grep assertions for new pause effect + guards"
      contains: "isVisibleRef.current"
  key_links:
    - from: "src/ui/features/terminal/Terminal.tsx (new pause useEffect on [isVisible])"
      to: "webSocketRef.current.close() + attemptReconnection()"
      via: "readyState check on webSocketRef + clearTimeout(reconnectTimeoutRef) belt-and-suspenders"
      pattern: "webSocketRef\\.current\\.close|attemptReconnection"
    - from: "src/ui/features/terminal/Terminal.tsx:945 (attemptReconnection)"
      to: "isVisibleRef.current guard"
      via: "top-of-function early return"
      pattern: "if \\(!isVisibleRef\\.current\\) return"
    - from: "src/ui/features/terminal/Terminal.tsx:377 (handleVisibilityChange, iOS PWA)"
      to: "isVisibleRef.current guard on visible branch"
      via: "early return before connectToHost"
      pattern: "if \\(!isVisibleRef\\.current\\) return"
    - from: "src/ui/features/pretty-view/PrettyView.tsx:1276 (snapshotFn return)"
      to: "isVisibleRef.current"
      via: "s/isVisible/isVisibleRef.current/ in the returned object (deps unchanged)"
      pattern: "isVisible: isVisibleRef\\.current"
---

<objective>
Iter 2 of the hidden-pane-cost-mitigation-empirical-rotation. Apply the iter-1 WS-pause pattern (commit `4a3c21c`, patch #344, quick-260808-b74) to Terminal.tsx's SSH WebSocket so hidden terminal panes stop paying for a live SSH WS + xterm write stream. Iter 1 measured hidden PrettyViews dropping from ~10-13 → ~5 WS frames/30s; this plan targets the equivalent drop for hidden Terminal panes.

Also fix a stale-closure bug in PrettyView's diag `registerPane` snapshotFn (lines 1266-1285): the returned `isVisible` field is closured from render scope at first registration, so post-iter-1 diag logs are dishonest. Fixing this in the SAME COMMIT is required for post-ship measurement of iter 2's effect.

Purpose: reduce hidden-pane cost (SSH WS bytes + xterm churn + reconnect chatter) with a single-knob `isVisibleRef` gate mirroring the iter-1 shape exactly. Do NOT invent a new architecture — the pattern is proven and we want the diff to read as a copy of iter 1.

Output: modified Terminal.tsx (pause effect + two guards), modified PrettyView.tsx (2-line diag fix), extended Terminal.wiring.test.ts (structural-grep assertions matching Terminal's existing test style — Terminal is NOT mount-tested per its wiring-test header comment). Single atomic commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
Reference implementation (READ THIS FIRST):
```bash
git show 4a3c21c -- src/ui/features/pretty-view/PrettyView.tsx
```
Key iter-1 landmarks in that diff:
- `isVisible: boolean` prop added to PrettyViewProps (~line 136)
- `isVisibleRef` declared (~line 510) + mirror useEffect (~line 1150-1156)
- Guard on onclose retry scheduler (~line 911): `if (!isVisibleRef.current) return;`
- Guard on visibilitychange handler (~line 970): `if (!isVisibleRef.current) return;`
- New pause useEffect (~line 1007-1084) with `[isVisible]` deps, closes WS on hidden / bumps `setRetryKey((k) => k + 1)` on visible

Files to modify:
@src/ui/features/terminal/Terminal.tsx
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/terminal/Terminal.wiring.test.ts
@src/ui/lib/diag-registry.ts

Terminal.tsx landmarks already confirmed by the planner:
- `webSocketRef` at line 153
- `isVisibleRef` already declared at line 321 (initialized `false`)
- `reconnectTimeoutRef` at line 323
- iOS PWA visibilitychange handler at lines 375-405 (guarded by `isIosPwa()`)
- Mirror effect `isVisibleRef.current = isVisible` at lines 579-581 (already present, DO NOT duplicate)
- Diag registerPane at lines 588-609 (already correctly reads `isVisibleRef.current` at line 602 — Terminal is the good example; PrettyView is the buggy one)
- `attemptReconnection()` at line 945 (existing early-return guard block at lines 946-955; add new `isVisibleRef` check at top of function body)
- Main WS-setup effect at line 2903 (keyed on `attach`, NOT `isVisible` — intentional for URL-restore contract; DO NOT change deps)

PrettyView.tsx landmarks:
- `isVisibleRef` mirror effect at lines 1150-1156 (iter 1) — already fresh
- Diag registerPane at lines 1266-1285 (buggy — reads `isVisible` from closure at line 1276)

Terminal.wiring.test.ts style (from file header comment):
- Terminal.tsx is NOT mount-tested — the wiring test uses **structural grep on the source file** for pinning shape.
- New assertions must follow that same style (readFileSync + regex/substring assertions on Terminal.tsx contents). Do NOT attempt to render `<Terminal />`.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add [isVisible] WS-pause layer to Terminal.tsx + fix PrettyView diag stale closure + structural-grep tests</name>
  <files>src/ui/features/terminal/Terminal.tsx, src/ui/features/pretty-view/PrettyView.tsx, src/ui/features/terminal/Terminal.wiring.test.ts</files>

  <behavior>
    Structural-grep test assertions to add to Terminal.wiring.test.ts (following its existing pattern of `readFileSync(SRC_PATH, "utf8")` + substring/regex expects):

    - Assert Terminal.tsx source contains a `useEffect` block whose deps array is exactly `[isVisible]` AND whose body contains BOTH `webSocketRef.current.close()` AND `attemptReconnection()` (or the reconnect entry point chosen in the Action). Use a regex spanning the effect (e.g. anchor on a distinctive comment tag like `quick-260809-eqk` planted in the code so the test is self-anchoring).
    - Assert `attemptReconnection` function body opens with `if (!isVisibleRef.current) return;` — regex looking for the exact line inside the first ~5 lines after `function attemptReconnection() {`.
    - Assert the iOS PWA visibilitychange handler (`if (!isIosPwa()) return;` effect at line ~375) contains `if (!isVisibleRef.current) return;` on the visible branch (i.e. after the `if (document.hidden) { ... return; }` block).
    - Assert Terminal.tsx does NOT contain a duplicated `isVisibleRef.current = isVisible` mirror — count occurrences and expect exactly 1 (the pre-existing one at line 579-581).
    - Assert the main WS-setup effect at line ~2903 still gates on `attach` and NOT on `isVisible` (guard against accidental deps change — regex for the effect's deps array and negative-assert `isVisible` is absent from it).
    - Assert PrettyView.tsx `registerPane` snapshotFn returns `isVisible: isVisibleRef.current` (not bare `isVisible`) — targets lines 1266-1285.
    - Assert PrettyView.tsx `registerPane` useEffect deps array is unchanged: `[hostId, tmuxSession]` (guard against a well-meaning fix that adds `isVisible` to deps, which would re-register the pane on every visibility flip and defeat the stable-key design).

    (Optional: a tiny standalone unit test on a hand-rolled reconnect-guard helper is out of scope — Terminal isn't unit-mountable per its wiring-test header comment, so structural-grep is the fleet-accepted pattern.)
  </behavior>

  <action>
Read the iter-1 reference commit first (`git show 4a3c21c -- src/ui/features/pretty-view/PrettyView.tsx`) so the diff shape is fresh, then make three edits landing in a single atomic commit.

**Edit A — Terminal.tsx: new WS-pause useEffect (place immediately after the existing `isVisibleRef` mirror effect at lines 579-581, keeping it near its sibling for reviewer discoverability).**

Insert a `useEffect(..., [isVisible])` whose body:

1. On `!isVisible`: read `webSocketRef.current`; if non-null AND `readyState` is `WebSocket.OPEN` or `WebSocket.CONNECTING`, first clear `reconnectTimeoutRef.current` (guarded null check + `clearTimeout` + null it out — belt), then call `webSocketRef.current.close()`. The existing `webSocketRef.current.onclose` handler will fire; the new early-return we add in Edit B at `attemptReconnection` prevents the retry loop from immediately reopening.
2. On `isVisible` becoming `true`: read `webSocketRef.current`; if it is `null` OR `readyState` is `WebSocket.CLOSING` or `WebSocket.CLOSED`, AND `attach` is truthy, call `attemptReconnection()` directly. Rationale for calling `attemptReconnection()` rather than PrettyView's `setRetryKey(k => k + 1)` trick: Terminal already has a dedicated reconnect entrypoint (`attemptReconnection` at line 945) with full guard logic (isReconnectingRef, isConnectingRef, wasDisconnectedBySSH, maxReconnectAttempts, etc.) — reusing it is safer than trying to re-trigger the setup effect at line 2903 via a new state variable. Also reset `reconnectAttempts.current = 0` first (mirrors the "Fresh budget" comment at line 383/970 in the existing PWA handler) so the max-8 backoff doesn't kill a legit re-show.
3. Include an eslint-disable-next-line for `react-hooks/exhaustive-deps` and a comment explaining that the deps are `[isVisible]` only — the reads are all `.current` on stable refs plus a call to `attemptReconnection` (a stable function reference in this file). Mirror PrettyView.tsx:1084 comment shape.
4. Plant a distinctive comment tag `// quick-260809-eqk` above the effect so the structural-grep tests in Edit C can anchor deterministically.

Do NOT change the `attach`-gated setup effect at line 2903. Add a code comment (2-3 lines above the setup effect or above the new pause effect) explicitly noting the accepted tradeoff: URL-restored hidden active-set members will briefly open a WS on mount, and the new pause effect will immediately close it — tmux persists across WS disconnects so no session state is lost. This aligns with the existing line 2904 comment that already justifies gating on `attach` for the URL-restore contract.

**Edit B — Terminal.tsx: two `isVisibleRef.current` guards.**

- At `attemptReconnection()` (line 945), add `if (!isVisibleRef.current) return;` as the very first statement inside the function body, BEFORE the existing early-return guard block at lines 946-955. Comment tag: `// quick-260809-eqk: hidden panes must not fight the WS-pause effect`.
- At the iOS PWA visibilitychange handler (lines 375-405, inside the `useEffect(() => { if (!isIosPwa()) return; ...})`), add `if (!isVisibleRef.current) return;` on the visible branch — insert it right after the `if (isUnmountingRef.current) return;` line (~388) but BEFORE the state-reset block (`shouldNotReconnectRef.current = false; ...`). Comment tag: `// quick-260809-eqk: pane hidden → do not open WS from foreground event`.

**Edit C — PrettyView.tsx: stale-closure fix in diag snapshotFn (lines 1266-1285).**

In the object returned by `snapshotFn`, change the `isVisible` field from `isVisible` (bare closure read) to `isVisibleRef.current`. This is a one-token edit at line ~1276. Add an inline comment: `// quick-260809-eqk: read isVisibleRef so diag reflects live visibility (mirror effect at lines 1150-1156 keeps it fresh); do NOT add isVisible to effect deps — key must stay stable`. Do NOT modify the useEffect deps array — it MUST remain `[hostId, tmuxSession]` so the pane registration slot stays stable across visibility flips.

**Edit D — Terminal.wiring.test.ts: structural-grep assertions (see behavior block).**

Add a new `describe("quick-260809-eqk — hidden-pane WS-pause + diag fix", ...)` suite at the bottom of the file. Each assertion follows the existing pattern:
- `const src = readFileSync(SRC_PATH, "utf8");`
- `expect(src).toMatch(/regex/)` or `expect(src.split("...").length - 1).toBe(N)` for occurrence counts.
- For PrettyView.tsx assertions, add a second constant path `const PV_SRC_PATH = join(HERE, "..", "pretty-view", "PrettyView.tsx");` and read separately.

Anchor Terminal.tsx assertions on the `quick-260809-eqk` comment tags planted in Edits A + B for deterministic matching that survives future reformatting.

**Do NOT:**

- push to remote
- run `docker build` or `docker compose up`
- edit `~/.claude/roles/box-maintainer/skynet-patches.md`
- edit any bounty JSON files under `~/.claude/roles/box-maintainer/bounties/`

Those are orchestrator (tiffany) motions handled AFTER the executor returns (fleet rule 2026-08-08: subagents don't do deploys).
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
  </verify>

  <done>
    - `npx tsc --noEmit` exits 0.
    - `npx vitest run` reports zero failures; test-count matches iter 1 baseline (1556 pass / 6 skip) PLUS the new structural-grep assertions added in Edit D (test count should INCREASE by the number of new `it(...)` blocks; NEVER decrease).
    - Terminal.tsx contains exactly one `isVisibleRef.current = isVisible` mirror (no duplication).
    - Terminal.tsx contains exactly one new `useEffect` with `[isVisible]` deps whose body references both `webSocketRef.current.close()` and `attemptReconnection()`.
    - `attemptReconnection()` at line 945 opens with `if (!isVisibleRef.current) return;` as its first statement.
    - The iOS PWA visibilitychange handler at line ~375 contains `if (!isVisibleRef.current) return;` on the visible branch.
    - PrettyView.tsx line ~1276 reads `isVisible: isVisibleRef.current` (not `isVisible: isVisible`).
    - PrettyView.tsx registerPane useEffect deps at line ~1285 remain `[hostId, tmuxSession]` (unchanged).
    - No modifications to `~/.claude/roles/box-maintainer/*` files; no `git push`; no `docker` invocations.
    - Single atomic commit created with message referencing `quick-260809-eqk` and iter 2 of the hidden-pane-cost-mitigation-empirical-rotation.
  </done>
</task>

</tasks>

<verification>
Full stop conditions (fleet rule — never leave tests failing):

1. `cd /home/ubuntu/skynet-tiffany && npx tsc --noEmit` — must exit 0.
2. `cd /home/ubuntu/skynet-tiffany && npx vitest run` — full suite, zero failures. Iter 1 baseline: 1556 pass / 6 skip. Do not regress. New structural-grep tests are additive.
3. Executor stops here. Deploy / patch-registry / bounty-JSON motions are orchestrator responsibilities post-return.
</verification>

<success_criteria>
- Terminal.tsx has a new `useEffect(..., [isVisible])` pause layer with the exact iter-1 shape: close-when-hidden (clearing pending reconnect timer first), reopen-when-visible via `attemptReconnection()` after resetting `reconnectAttempts.current = 0`.
- `attemptReconnection()` and the iOS PWA visibilitychange handler both early-return on `!isVisibleRef.current` so patch-#148-analog auto-reconnect logic cannot fight the pause.
- Main WS-setup effect at line 2903 is UNTOUCHED — deps stay `[attach, ...]` (whatever they currently are, minus any `isVisible` addition) to preserve the URL-restore contract for offscreen active-set members. Accepted tradeoff documented in a code comment.
- PrettyView.tsx diag snapshotFn reports live visibility via `isVisibleRef.current`; useEffect deps remain `[hostId, tmuxSession]`.
- Terminal.wiring.test.ts extended with structural-grep assertions matching the file's existing test style (Terminal is NOT unit-mounted per the file header comment).
- `npx tsc --noEmit` + `npx vitest run` both green; suite count ≥ 1556 pass / 6 skip + new assertions.
- One atomic commit; no push, no docker, no patch-registry edits, no bounty JSON edits.
</success_criteria>

<output>
Create `.planning/quick/260809-eqk-pause-hidden-terminal-ws/260809-eqk-SUMMARY.md` when done, following the standard summary template. Include: files modified with line ranges, the exact diff shape of the pause effect + guards, the PV diag fix line, before/after vitest count, and any observed surprises (especially anything Terminal.tsx does differently from PrettyView.tsx that forced a deviation from the iter-1 pattern).
</output>
