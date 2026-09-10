---
phase: quick-260910-gqi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/lib/tab-url.ts
  - src/ui/lib/tab-url.test.ts
autonomous: true
requirements:
  - QUICK-GQI-01
must_haves:
  truths:
    - "parseTabParam('tmux:%ZZ:session') returns null instead of throwing URIError"
    - "parseTabParam('tmux:host:%ZZ') returns null instead of throwing URIError"
    - "parseTabParam('rdp:%ZZ') returns null instead of throwing URIError"
    - "parseTabParam('vnc:%ZZ') returns null instead of throwing URIError"
    - "parseTabParam('terminal:%ZZ') returns null instead of throwing URIError"
    - "URIError paths log a structured console.info event with operation name + restLen (and protocol on host branch)"
    - "Existing relay-branch behavior (Test 11) is unchanged — additive only"
  artifacts:
    - path: "src/ui/lib/tab-url.ts"
      provides: "parseTabParam tmux + generic-host branches with URIError guard"
      contains: "parse_tab_param_tmux_malformed_uri"
    - path: "src/ui/lib/tab-url.test.ts"
      provides: "regression tests mirroring Test 11 for tmux + generic-host"
      contains: "Test 11b\\|Test 11c"
  key_links:
    - from: "src/ui/lib/tab-url.ts"
      to: "console.info structured event"
      via: "operation + restLen (+ protocol on host branch)"
      pattern: "parse_tab_param_(tmux|host)_malformed_uri"
    - from: "src/ui/lib/tab-url.test.ts"
      to: "parseTabParam tmux + host branches"
      via: "expect(...).toBeNull() on '%ZZ' / '%' / '%2' inputs"
      pattern: "parseTabParam\\(\"(tmux|rdp|vnc|terminal):.*%(ZZ|2?)\\b"
---

<objective>
Extend the Phase 97 code-review Fix 5 URIError guard to the two remaining
`parseTabParam` branches (tmux + generic-host) that still call
`decodeURIComponent` unwrapped. Currently only the `relay` branch (lines
114-135 of `src/ui/lib/tab-url.ts`) is protected. A malformed percent-encoded
`tmux:` / `rdp:` / `vnc:` / `terminal:` fragment (e.g. bookmarked, hand-typed,
or corrupted by a URL rewriter) will throw a `URIError` on tab restoration,
matching the class of bug Fix 5 already patched for `relay:`.

Purpose: Uniform fail-safe contract across every protocol branch in
`parseTabParam` — malformed URI encoding returns `null`, never throws.
Prevents tab-restore crashes for the tmux/terminal/rdp/vnc/telnet paths.

Output:
- `parseTabParam` tmux branch (lines 136-142) wraps both `decodeURIComponent`
  calls in try/catch, logs `parse_tab_param_tmux_malformed_uri`, returns null.
- `parseTabParam` generic-host branch (lines 144-146) wraps its
  `decodeURIComponent` in try/catch, logs `parse_tab_param_host_malformed_uri`
  with `protocol` included (since it covers terminal/rdp/vnc/telnet), returns
  null.
- Regression tests mirror Test 11 for both branches.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/ui/lib/tab-url.ts
@src/ui/lib/tab-url.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add regression tests for tmux + generic-host URIError guard (RED)</name>
  <files>src/ui/lib/tab-url.test.ts</files>
  <behavior>
    - Test 11b (tmux host component malformed): `parseTabParam("tmux:%ZZ:session")`, `parseTabParam("tmux:%:session")`, `parseTabParam("tmux:%2:session")` each return `null` (not throw).
    - Test 11c (tmux session component malformed): `parseTabParam("tmux:host:%ZZ")`, `parseTabParam("tmux:host:%")`, `parseTabParam("tmux:host:%2")` each return `null` (not throw).
    - Test 11d (generic-host branch — terminal): `parseTabParam("terminal:%ZZ")`, `parseTabParam("terminal:%")`, `parseTabParam("terminal:%2")` each return `null`.
    - Test 11e (generic-host branch — rdp): `parseTabParam("rdp:%ZZ")` returns `null`.
    - Test 11f (generic-host branch — vnc): `parseTabParam("vnc:%ZZ")` returns `null`.
    - Test 11g (generic-host branch — telnet): `parseTabParam("telnet:%ZZ")` returns `null`.
    - Assertions use `expect(...).toBeNull()`. No `expect(...).not.toThrow()` wrapper — the current unwrapped `decodeURIComponent` throws synchronously, so a bare `parseTabParam(...)` call inside `expect(...).toBeNull()` will surface the URIError as a test failure, achieving RED without extra scaffolding.
  </behavior>
  <action>
    Append new `it(...)` blocks (Tests 11b through 11g) at the end of the
    existing `describe("tab-url — relay: protocol grammar widening (Phase 97
    Plan 05)", ...)` block in `src/ui/lib/tab-url.test.ts` (which currently
    ends at line 241 with the closing `});` of Test 11 and the describe).
    Insert BEFORE the describe's closing `});`.

    Follow the exact naming/comment pattern of Test 11 (line 230) — reference
    "Phase 97 code-review Fix 5" and extend the rationale to note this is the
    tmux/generic-host mirror. Do NOT modify Test 11 itself. Do NOT modify any
    other existing test. Do NOT introduce new imports — `parseTabParam` is
    already imported at line 118.

    Run the test file first; the new cases MUST fail (URIError thrown from
    unwrapped `decodeURIComponent` in tab-url.ts lines 139, 140, 144). This is
    the RED step of the TDD cycle. Do NOT modify `tab-url.ts` in this task.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-taylor && npx vitest run src/ui/lib/tab-url.test.ts 2>&1 | grep -E "Test 11[b-g]|FAIL|✗" | head -20</automated>
  </verify>
  <done>New Tests 11b/11c/11d/11e/11f/11g are present in the file, each fails when run (throws URIError), and no pre-existing test regresses (Tests 1-11 + splitTree suite still pass).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wrap decodeURIComponent in tmux + generic-host branches (GREEN)</name>
  <files>src/ui/lib/tab-url.ts</files>
  <behavior>
    - tmux branch (currently lines 136-142): both `decodeURIComponent` calls (host + session) are wrapped in a single `try { ... } catch { ... }`. On catch: log `console.info({ operation: "parse_tab_param_tmux_malformed_uri", restLen: rest.length })` and `return null`.
    - Generic-host branch (currently lines 144-146): the `decodeURIComponent(rest)` call is wrapped in try/catch. On catch: log `console.info({ operation: "parse_tab_param_host_malformed_uri", restLen: rest.length, protocol })` and `return null`. Include `protocol` because this branch handles all four of terminal/rdp/vnc/telnet — the protocol is a useful forensic signal that the relay branch (single protocol) and tmux branch (single protocol) don't need.
    - The `!host` / `!host || !session` early-return checks remain after the successful decode (unchanged behavior for empty strings).
    - The `relay` branch (lines 114-135) is NOT modified. Confirm by diffing.
    - Both new catch blocks carry the same eslint-disable comment used by the relay branch (`// eslint-disable-next-line no-console`) and the same rationale comment referencing "Phase 97 code-review Fix 5" and noting this is the tmux / generic-host mirror.
  </behavior>
  <action>
    Edit `src/ui/lib/tab-url.ts`:

    (1) Replace the tmux branch body (lines 137-141 inside the `if (protocol
    === "tmux")` block) so both `decodeURIComponent` calls sit inside a single
    try. On URIError, emit the structured `console.info` with operation
    `parse_tab_param_tmux_malformed_uri` and `restLen: rest.length`, then
    `return null`. Keep the `idx2 === -1` guard BEFORE the try (it isn't a
    URI-decoding concern). Keep the `!host || !session` empty-string guard
    AFTER the successful decode.

    (2) Replace the generic-host branch (lines 144-146) so
    `decodeURIComponent(rest)` sits inside try. On URIError, emit the
    structured `console.info` with operation `parse_tab_param_host_malformed_uri`,
    `restLen: rest.length`, and `protocol` (the already-narrowed union member),
    then `return null`. Keep the `!host` empty-string guard after the
    successful decode.

    (3) Mirror the relay branch's comment style — a short block referencing
    "Phase 97 code-review Fix 5" and noting the additive tmux / generic-host
    coverage.

    Do NOT touch the relay branch. Do NOT touch `encodeTabSpec`,
    `encodeWorkspaceSpec`, `readTabPayloadFromUrl`, `snapshotPendingTab`,
    `consumePendingWorkspace`, `writeWorkspaceToUrl`, or `specForTab`. Do NOT
    change the `PROTOCOLS` array or the `TabSpec` union.

    Rerun the tests from Task 1; they MUST now pass, and the full file's
    existing tests MUST still pass. This is the GREEN step.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-taylor && npx vitest run src/ui/lib/tab-url.test.ts 2>&1 | tail -15</automated>
  </verify>
  <done>
    - All new tests (11b through 11g) pass.
    - All pre-existing tests in the file still pass (Tests 1-11 + splitTree suite).
    - `git diff src/ui/lib/tab-url.ts` shows changes ONLY inside the tmux `if` block (lines ~136-142) and the trailing generic-host block (lines ~144-146). No diff hunks inside the relay `if` block (lines 114-135).
    - `grep -n "parse_tab_param_tmux_malformed_uri\|parse_tab_param_host_malformed_uri" src/ui/lib/tab-url.ts` returns exactly two matches (one per branch).
  </done>
</task>

<task type="auto">
  <name>Task 3: Type-check + lint pass on both files</name>
  <files>src/ui/lib/tab-url.ts, src/ui/lib/tab-url.test.ts</files>
  <action>
    Run the project's TypeScript check and lint over the two files to make
    sure the try/catch narrowing (particularly `protocol` inside the
    generic-host branch — it's the discriminated-union member NOT `"tmux"`
    NOT `"relay"`) is still correctly typed and no eslint rule fires from the
    new `console.info` calls.

    If tsc surfaces a narrowing complaint on `protocol` (unlikely; the
    variable is declared at line 103 as `TabSpec["protocol"]` and never
    reassigned), add an inline cast or use the existing narrowing — do NOT
    widen the union.

    If eslint flags `no-console`, add the same
    `// eslint-disable-next-line no-console` comment used by the relay
    branch's `console.info` at line 122.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-taylor && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tab-url\.(ts|test\.ts)" | head -20 ; cd /home/ubuntu/skynet-taylor && npx eslint src/ui/lib/tab-url.ts src/ui/lib/tab-url.test.ts 2>&1 | tail -10</automated>
  </verify>
  <done>Zero tsc errors on either file; zero eslint errors on either file (warnings acceptable only if pre-existing on the same lines).</done>
</task>

</tasks>

<verification>
Full end-to-end check:

```bash
cd /home/ubuntu/skynet-taylor
npx vitest run src/ui/lib/tab-url.test.ts
grep -c "parse_tab_param_tmux_malformed_uri" src/ui/lib/tab-url.ts   # == 1
grep -c "parse_tab_param_host_malformed_uri" src/ui/lib/tab-url.ts   # == 1
grep -c "parse_tab_param_relay_malformed_uri" src/ui/lib/tab-url.ts  # == 1 (unchanged)
# Confirm relay branch untouched:
git diff src/ui/lib/tab-url.ts -- | grep -E "^[+-]" | grep -c "parse_tab_param_relay_malformed_uri"   # == 0
```

All vitest cases in the file pass. The three `grep -c` counts are 1/1/1 and
the diff-scoped count on the relay identifier is 0 (proves additive-only).
</verification>

<success_criteria>
- Both tmux and generic-host branches of `parseTabParam` return `null` on
  malformed percent-encoding instead of throwing `URIError`.
- Each new failure path emits a structured `console.info` event with a
  distinct operation name (`parse_tab_param_tmux_malformed_uri` /
  `parse_tab_param_host_malformed_uri`) and `restLen`; the host branch also
  includes `protocol`.
- Regression tests (11b-11g) cover both branches and all four generic-host
  protocols (terminal, rdp, vnc, telnet — matching PROTOCOLS minus `tmux` and
  `relay`).
- Relay branch (lines 114-135) is byte-identical to pre-change state (proven
  by `git diff` in verification).
- No new TypeScript or ESLint errors introduced.
</success_criteria>

<output>
Create `.planning/quick/260910-gqi-extend-parsetabparam-urierror-fix-to-tmu/260910-gqi-SUMMARY.md` when done, capturing the diff summary, test additions, and confirmation that the relay branch was not modified.
</output>
