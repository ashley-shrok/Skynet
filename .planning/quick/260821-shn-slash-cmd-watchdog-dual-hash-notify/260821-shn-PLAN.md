---
phase: quick-260821-shn-slash-cmd-watchdog-dual-hash-notify
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.compose-send.test.ts
autonomous: true
requirements:
  - QUICK-260821-SHN-01  # Extract reconstructRawSlashCommand pure helper for wrapper→raw-body decoding
  - QUICK-260821-SHN-02  # Dual-hash notifyPvSendMatched on the tail-side onLine block so slash-command sends clear their pending watchdog
  - QUICK-260821-SHN-03  # Vitest coverage: 6 cases (with-args, no-args, empty-args, multi-line-args, non-slash control, malformed wrapper) against the extracted seam

must_haves:
  truths:
    - "A slash-command send from PrettyView (e.g. `/id tabitha`) whose wrapper lands as JSONL with `<command-name>/id</command-name><command-args>tabitha</command-args>` CLEARS its pending pv-send-watchdog: no `pv_send_watchdog_retry` log fires at T+2500ms, no `pv_send_watchdog_full_resend` log fires at T+5500ms, no `paste_send_failed` frame is emitted"
    - "A normal (non-slash) user turn like `hello` continues to clear its pending watchdog via a SINGLE notifyMatched call — behavior byte-identical to pre-fix (control invariant)"
    - "The pure helper `reconstructRawSlashCommand(content)` returns `/NAME` when `<command-args>` is absent OR when its inner text trimmed is empty, and `/NAME ARGS` (single space, args verbatim without inner trim) when `<command-args>` inner text is non-empty"
    - "The pure helper returns `null` (falls through to single-hash notify — no crash, no second call) when the wrapper is malformed: `<command-name>` tag missing, or `<command-name>` inner text does not start with `/`, or content contains `<command-name>` without any sibling `<command-message>` or `<command-args>` wrapper tag"
    - "Multi-line args land verbatim inside the reconstructed body (no whitespace normalization, no newline stripping) — a slash-command with `<command-args>line one\\nline two</command-args>` reconstructs to `/name line one\\nline two`"
    - "The dual-hash notify site emits an INFO log `[pv-send-watchdog] dual-hash notify: slash-command wrapper detected sessionId=<id> name=<name> argsLen=<n>` on the wrapper-detected path; NO log on the non-slash pass-through (hot path stays silent per 'logging is cheap and batched' role directive — batched here means not-per-message on the common path)"
    - "Scoped vitest suite `claude-session-server.compose-send.test.ts` passes in full (pre-existing tests + 6 new cases), executed from `/home/ubuntu/skynet-tabitha` on branch `feat/tab-title-from-tmux`"
  artifacts:
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "reconstructRawSlashCommand pure helper + __applyOnLineNotifyForTests test seam + refactored inline notify block that calls both"
      contains: "reconstructRawSlashCommand"
    - path: "src/backend/claude-session/claude-session-server.compose-send.test.ts"
      provides: "New describe block covering reconstructRawSlashCommand (unit) and __applyOnLineNotifyForTests (integration-seam)"
      contains: "reconstructRawSlashCommand"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts (onLine tail callback ~L3498-3510)"
      to: "src/backend/claude-session/pv-send-watchdog.ts notifyMatched"
      via: "TWO notifyPvSendMatched calls per user-turn frame when wrapper matches (wrapper-hash + raw-hash); ONE call otherwise"
      pattern: "notifyPvSendMatched\\(sessionIdFromFile, "
    - from: "compose-send.test.ts new describe block"
      to: "reconstructRawSlashCommand + __applyOnLineNotifyForTests exports"
      via: "direct import from ./claude-session-server.js — mirrors existing __applyInputMessageForTests test pattern"
      pattern: "reconstructRawSlashCommand|__applyOnLineNotifyForTests"
---

<objective>
Fix the PrettyView slash-command triple-bubble + double-submit bug caused by a
hash-derivation mismatch between the frontend pv-send-watchdog arm site
(hashes raw body `/id tabitha`) and the backend tail-side onLine notify site
(hashes the Claude Code JSONL wrapper `<command-message>id</command-message><command-name>/id</command-name><command-args>tabitha</command-args>`).

Root cause verbatim from the bug report:
1. Frontend composer arms watchdog with `sha256("/id tabitha").slice(0,32)`.
2. Backend tail-watcher at claude-session-server.ts:3498-3509 sees the wrapped
   JSONL and computes `contentHash = sha256(wrappedContent).slice(0,32)`.
3. Hashes never match → pending watchdog never cleared → three-stage
   escalation fires:
   - T+2500ms: retry Enter → duplicate optimistic bubble in PrettyView
   - T+5500ms: full re-send → SECOND submission of the slash-command into
     the harness (the actual data-corrupting bug)
   - T+20000ms: paste_send_failed frame (not observed in the tina session
     snippet because the second submit likely produced its own eventual
     user-turn signal, but same escalation shape).

Live evidence (tina's session, 20:19:54-20:20:00 UTC 2026-08-21):
```
20:19:54.699 [compose] submit-entry hostId=6 tmuxSession=tina bodyLen=20 trigger=send-button
20:19:57.565 WARN  pv-send-watchdog: no signal within 2500ms, firing retry Enter
20:20:00.566 WARN  pv-send-watchdog: no signal within 5500ms, firing full re-send
```

Fix (dual-hash notify on the backend):
1. Extract a pure helper `reconstructRawSlashCommand(content: string): string | null`
   that detects the slash-command wrapper shape and reconstructs the raw
   `/<name>[ <args>]` form the frontend actually hashed. Returns null when
   the content is not a slash-command wrapper (non-slash user turns fall
   through unchanged) or when the wrapper is malformed.
2. Extract the existing L3498-3510 inline notify block into a small
   internal helper `__applyOnLineNotifyForTests(...)` so a test can spy on
   `notifyMatched` calls and assert single-vs-double invocation.
3. Add the second notifyPvSendMatched call: after the existing
   `notifyPvSendMatched(sessionIdFromFile, wrapperHash)`, if the helper
   returns a non-null raw body, compute `sha256(rawBody).slice(0,32)` and
   call `notifyPvSendMatched(sessionIdFromFile, rawHash)` a second time.
   Log INFO at that promotion point (hostId not available in the tail
   closure — sessionId is, per the existing block's guard).
4. Non-slash user turns: helper returns null → no second call → identical
   to current behavior (control invariant).
5. Malformed wrappers (`<command-name>` present but missing `/` prefix, or
   only one sibling wrapper tag): helper returns null + logs at INFO
   `reconstructRawSlashCommand: malformed slash-command wrapper skipped
   contentLen=<n>` and the caller falls through to single-hash notify.
6. Test seam and helper both exported from claude-session-server.ts;
   6 test cases added to the existing compose-send.test.ts file.

Purpose:
- Stops the frontend from double-submitting slash-commands (data-corrupting
  in identity/wakeup commands like `/id`, `/rest`, `/wakeup`).
- Removes the spurious extra optimistic bubbles that clutter PrettyView on
  every slash-command send.
- Restores the hash-derivation contract's load-bearing invariant documented
  at pv-send-watchdog.ts:39-49 for the specific frontend/backend pairing
  where the frontend hashes what the USER typed and the backend must be
  able to derive the same string from what CLAUDE wrote to disk.

Output:
- One pure exported helper (`reconstructRawSlashCommand`).
- One test seam (`__applyOnLineNotifyForTests`).
- One refactored inline block calling both.
- Six new test cases in the existing compose-send suite.
- Two atomic commits (RED then GREEN).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260821-shn-slash-cmd-watchdog-dual-hash-notify/260821-shn-PLAN.md

# Source files being modified (read these before editing)
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/pv-send-watchdog.ts
@src/backend/claude-session/claude-session-server.compose-send.test.ts

# Parser context — sanity-check that content strings arriving at the tail
# onLine callback carry the wrapper tags verbatim (session-file-parser
# does NOT strip them for kind:"message" role:"user" — the wrapper stripping
# is handled elsewhere for a DIFFERENT concern, so the string reaching
# L3505's createHash().update(frame.content) is the wrapped form).
@src/backend/claude-session/session-file-parser.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add failing tests for reconstructRawSlashCommand + dual-hash notify seam (RED)</name>
  <files>src/backend/claude-session/claude-session-server.compose-send.test.ts</files>
  <behavior>
    Append a new describe block to the existing compose-send test file:
    `describe("reconstructRawSlashCommand + __applyOnLineNotifyForTests — dual-hash notify (quick-260821-shn)", ...)`.

    Tests reference symbols that do NOT YET EXIST — the run MUST fail with a
    module-import error or "not exported" error until Task 2 lands.

    Import additions at the top of the file:
    ```
    import {
      reconstructRawSlashCommand,
      __applyOnLineNotifyForTests,
    } from "./claude-session-server.js";
    ```

    Six test cases, each named for the bug report's test scope (§ test_scope):

    **Test 1 (with-args):** Wrapper content =
    `<command-message>id</command-message><command-name>/id</command-name><command-args>tabitha</command-args>`.
    Assertions:
    - `reconstructRawSlashCommand(content) === "/id tabitha"`.
    - Wire `__applyOnLineNotifyForTests({ frame: { type:"message", role:"user", content }, sessionIdFromFile: "sess-A", notifyMatched: spy })`
      → `spy` called EXACTLY TWICE with `("sess-A", <32-hex-string>)`.
    - First call's hash equals `sha256(content).slice(0,32)` (wrapper hash — unchanged from pre-fix).
    - Second call's hash equals `sha256("/id tabitha").slice(0,32)` (raw hash — the fix).
    - Order is wrapper-first, raw-second (documented ordering; tests should
      pin it so a later refactor that swaps the order surfaces immediately).

    **Test 2 (no-args, missing `<command-args>` block entirely):** Wrapper content =
    `<command-message>help</command-message><command-name>/help</command-name>`.
    Assertions:
    - `reconstructRawSlashCommand(content) === "/help"` (no trailing space).
    - `spy` called TWICE; second-call hash === `sha256("/help").slice(0,32)`.

    **Test 3 (empty `<command-args></command-args>` block):** Wrapper content =
    `<command-message>help</command-message><command-name>/help</command-name><command-args></command-args>`.
    Assertions:
    - `reconstructRawSlashCommand(content) === "/help"` (empty args → treated
      identically to missing tag; no trailing space).
    - `spy` called TWICE; second-call hash === `sha256("/help").slice(0,32)`.

    **Test 4 (multi-line args verbatim):** Wrapper content =
    `<command-message>note</command-message><command-name>/note</command-name><command-args>line one\nline two</command-args>`
    (`\n` is a real newline literal in the string).
    Assertions:
    - `reconstructRawSlashCommand(content) === "/note line one\nline two"`
      (newline preserved; no whitespace normalization inside args).
    - `spy` called TWICE; second-call hash === `sha256("/note line one\nline two").slice(0,32)`.

    **Test 5 (NON-slash control — proves no regression):** Content = `"hello"`.
    Assertions:
    - `reconstructRawSlashCommand("hello") === null`.
    - Wire the seam with the plain-text frame → `spy` called EXACTLY ONCE
      with `("sess-A", sha256("hello").slice(0,32))`. This is the byte-
      identical pre-fix behavior for the common path.

    **Test 6 (malformed wrapper — has `<command-message>` but no `<command-name>`):**
    Content = `<command-message>foo</command-message>this is bare text`.
    Assertions:
    - `reconstructRawSlashCommand(content) === null` (no `<command-name>` tag).
    - `spy` called EXACTLY ONCE with the wrapper-hash (no second call — safe
      fallthrough, no crash).
    - An INFO log fires on the malformed path (executor may either spy on
      the `sshLogger` module or accept an injected logger via
      `__applyOnLineNotifyForTests` deps — see Task 2 for the exact seam
      shape; the test asserts the log fires but does not pin the exact
      logger transport).

    Additional guardrails inside the describe block:
    - Use `createHash` from `node:crypto` directly to compute the expected
      hashes inside each test (mirrors the pattern of `contentHashOf` at
      claude-session-server.compose-send.test.ts L402).
    - Every test uses `sessionIdFromFile: "sess-A"` (arbitrary non-empty
      string; not load-bearing across cases).
    - No fake timers needed — this seam is purely synchronous.
    - No pv-send-watchdog module reset needed — tests spy on
      `notifyMatched` directly rather than exercising the module-level
      pending Map.

    Do NOT modify any pre-existing test in the file. Do NOT reorder
    existing describes. Append the new describe block at the END of the
    file.

    Run the suite to confirm RED:
    `cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts`
    Expected: pre-existing tests pass; all 6 new tests fail with either an
    import error (module has no export `reconstructRawSlashCommand` or
    `__applyOnLineNotifyForTests`) or an assertion mismatch.
  </behavior>
  <action>
    Open `src/backend/claude-session/claude-session-server.compose-send.test.ts`.

    1. Extend the existing top-of-file import block that already imports
       `__applyInputMessageForTests, __applyInterruptMessageForTests` from
       `./claude-session-server.js` — add `reconstructRawSlashCommand` and
       `__applyOnLineNotifyForTests` to that same import statement (single
       import, alphabetized or grouped by seam type per executor discretion).

    2. Append a new describe block at the END of the file after the last
       existing `describe(...)` closes. Name it:
       `describe("reconstructRawSlashCommand + __applyOnLineNotifyForTests — dual-hash notify (quick-260821-shn)", () => { ... })`.

    3. Inside the describe, no `beforeEach` reset is required for the
       watchdog module (this seam does not exercise it). Add a per-test
       `vi.clearAllMocks()` in an `afterEach` — mirrors the existing test
       file's convention.

    4. Implement the 6 tests exactly as specified in the behavior block.
       For the `__applyOnLineNotifyForTests` seam call shape, mirror the
       injectable-deps pattern of `__applyInputMessageForTests` — pass
       `frame`, `sessionIdFromFile`, and `notifyMatched` (spy) as named
       properties. If Task 2's final seam shape adds an optional
       `logger` param for the Test 6 malformed-path INFO log assertion,
       inject a spy logger there.

    5. Do NOT create any new test file. All additions land in the existing
       compose-send.test.ts.

    6. Do NOT touch `src/backend/claude-session/claude-session-server.ts`
       in this task — the RED phase requires the module to still be missing
       the new exports so the tests fail.

    7. Run the scoped suite:
       `cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts 2>&1 | tail -40`.
       Verify the pre-existing tests still pass and the 6 new ones fail on
       the missing exports. If a pre-existing test now fails, revert the
       change — the RED task's guarantee is "additive-only, no regression
       to green suite".

    8. Commit atomically:
       ```
       git add src/backend/claude-session/claude-session-server.compose-send.test.ts
       git commit -m "test(quick-260821-shn): failing dual-hash notify tests (RED)"
       ```
       Do NOT push. Do NOT run the full suite. Do NOT touch any file
       outside the scoped test file.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts 2>&1 | tail -30 | grep -Ei 'reconstructRawSlashCommand|__applyOnLineNotifyForTests|failed|passed' | head -20</automated>
  </verify>
  <done>
    - New describe block appended to compose-send.test.ts with the 6 named tests.
    - Import line updated to include `reconstructRawSlashCommand` and `__applyOnLineNotifyForTests`.
    - Scoped vitest run shows the 6 new tests FAIL (module has no such
      exports yet); ALL pre-existing tests continue to PASS.
    - One atomic commit exists with message
      `test(quick-260821-shn): failing dual-hash notify tests (RED)`.
    - No changes to claude-session-server.ts in this task.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement reconstructRawSlashCommand + dual-hash notify seam (GREEN)</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <behavior>
    Add two new named exports to `claude-session-server.ts`:

    **A. Pure helper `reconstructRawSlashCommand(content: string): string | null`**

    Detection contract (executor MUST implement exactly this shape, not a
    heuristic):

    - Content is a slash-command wrapper IFF it contains BOTH:
      (i) A `<command-name>/NAME</command-name>` tag whose inner text
          starts with `/` and contains at least one non-`/` character (i.e.
          name is non-empty after the slash).
      (ii) At least ONE of the sibling wrapper tags `<command-message>...</command-message>`
           or `<command-args>...</command-args>` present anywhere in the content.
    - Both conditions must hold. If (i) is absent, or if (i) is present but
      (ii) is absent, return `null` (safe fallthrough).

    Extraction:
    - Extract `NAME` (without the leading `/`) from `<command-name>/NAME</command-name>`.
      Use a non-greedy regex like `/<command-name>\/([^<]+)<\/command-name>/`.
    - Extract `ARGS` (verbatim inner text) from `<command-args>ARGS</command-args>`
      IF the tag is present. Use `/<command-args>([\s\S]*?)<\/command-args>/`
      (dotall-equivalent so multi-line args are captured — the `[\s\S]*?`
      idiom is the load-bearing choice; do NOT use `.*?` which is
      newline-sensitive).
    - If `<command-args>` tag missing OR captured ARGS `.trim() === ""`,
      reconstruct as `/NAME` (no trailing space).
    - Otherwise reconstruct as `/NAME ARGS` (single space separator; ARGS
      inserted verbatim without inner trim — only the "is-it-empty" check
      trims).

    Malformed handling:
    - `<command-name>` present but content starts with a non-`/` character
      after the tag → return null.
    - `<command-name>` present but is EMPTY (`<command-name></command-name>`)
      or contains only whitespace → return null.
    - `<command-name>foo</command-name>` (no leading slash) → return null.
    - `<command-name>/</command-name>` (slash only, no name) → return null.
    - Log at INFO level via `sshLogger.info` on the malformed path:
      `[pv-send-watchdog] reconstructRawSlashCommand: malformed slash-command wrapper skipped contentLen=<n>`
      (with `operation: "pv_send_watchdog_malformed_wrapper"` in the meta).
      Do NOT log on the "no wrapper at all" pass-through (that's the hot
      path — non-slash user turns).

    **B. Test seam `__applyOnLineNotifyForTests`**

    Extract the existing inline block at claude-session-server.ts:3498-3510
    (the `if (frame.type === "message" && frame.role === "user" && …)` +
    contentHash derivation + notifyPvSendMatched call) into a small named
    helper. Signature:

    ```
    export function __applyOnLineNotifyForTests(deps: {
      frame: { type?: string; role?: string; content?: unknown };
      sessionIdFromFile: string | null;
      notifyMatched: (sessionId: string, contentHash: string) => void;
      logger?: {
        info: (msg: string, meta?: Record<string, unknown>) => void;
        debug: (msg: string, meta?: Record<string, unknown>) => void;
      };
    }): void
    ```

    Behavior:
    1. Guard exactly as the current inline block does: skip unless
       `frame.type === "message" && frame.role === "user" &&
       typeof frame.content === "string" && frame.content.length > 0 &&
       sessionIdFromFile` is a non-empty string.
    2. Compute `wrapperHash = createHash("sha256").update(frame.content).digest("hex").slice(0, 32)`.
    3. Call `notifyMatched(sessionIdFromFile, wrapperHash)` — UNCHANGED
       behavior from pre-fix.
    4. Call `reconstructRawSlashCommand(frame.content)`. If it returns a
       non-null string:
       - Compute `rawHash = createHash("sha256").update(rawBody).digest("hex").slice(0, 32)`.
       - Log INFO: `[pv-send-watchdog] dual-hash notify: slash-command wrapper detected sessionId=<id> name=<name> argsLen=<n>`
         where `name` is the extracted NAME (without leading slash), `n`
         is `rawBody.length - (1 + name.length + (rawBody.length > 1 + name.length ? 1 : 0))`
         — or more simply: the length of the args portion after the space,
         or 0 if none. Include `operation: "pv_send_watchdog_dual_hash_notify"` meta.
       - Call `notifyMatched(sessionIdFromFile, rawHash)` — the SECOND
         call. This is the fix.
    5. If `reconstructRawSlashCommand` returns null, do nothing further —
       the single wrapper-hash notify is the pre-fix behavior for
       non-slash content.
    6. Logger defaults to `sshLogger` when not injected.

    **C. Refactor the inline call site**

    At claude-session-server.ts:3498-3510, replace the inline
    `if (frame.type === "message" ...) { const contentHash = ...; notifyPvSendMatched(...); }`
    block with a single call:

    ```
    __applyOnLineNotifyForTests({
      frame,
      sessionIdFromFile,
      notifyMatched: notifyPvSendMatched,
    });
    ```

    Preserve the surrounding comment block (L3490-3497) that documents the
    hash-derivation contract. UPDATE that comment to reflect the dual-hash
    change: append a paragraph explaining that a second notify call now
    fires for slash-command wrappers, and reference this quick's ID:
    `See quick-260821-shn for slash-command wrapper → raw-body reconstruction`.

    **D. Non-regression requirements**

    - `notifyPvSendMatched` re-import stays unchanged (imported from
      `./pv-send-watchdog.js` at L22).
    - The `queueEnqueueDedup` suppress path at L3468-3483 remains
      unchanged — dual-hash notify runs AFTER the suppress check
      (i.e. inside the `if (!suppress) { ws.send(...); <HERE> }` block).
    - No changes to any other file in `src/backend/claude-session/`.
    - No changes to the frontend arm-time hash derivation — the fix is
      purely additive on the backend.

    After implementation, run the scoped suite. All 6 new tests + all
    pre-existing tests MUST pass. If Task 1's Test 6 asserts on the
    injected logger's `info` mock but the current helper design defaults
    to `sshLogger`, Task 1's test may need a small adjustment to pass in a
    mock logger via `__applyOnLineNotifyForTests`'s optional `logger` dep
    — that's a legitimate green-phase test tweak, NOT a change to the
    tested behavior.
  </behavior>
  <action>
    1. Open `src/backend/claude-session/claude-session-server.ts`.

    2. Add the `reconstructRawSlashCommand` export near the other
       small pure helpers in the file (e.g. adjacent to
       `reshapeParsedLineToWireFrame` at L285, OR just above the
       `__applyOnLineNotifyForTests` seam you're about to add).

       Suggested implementation shape (executor may adjust naming so
       long as behavior matches the § behavior contract exactly):

       ```
       // Non-greedy, dotall-safe patterns. [\s\S] matches newlines,
       // .*? does not — multi-line args land verbatim per quick-260821-shn.
       const CMD_NAME_RE = /<command-name>\/([^<]+)<\/command-name>/;
       const CMD_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
       const CMD_SIBLING_RE = /<command-message>|<command-args>/;

       export function reconstructRawSlashCommand(content: string): string | null {
         const nameMatch = CMD_NAME_RE.exec(content);
         if (nameMatch === null) return null;
         const name = nameMatch[1];
         if (typeof name !== "string" || name.trim().length === 0) {
           sshLogger.info(
             `[pv-send-watchdog] reconstructRawSlashCommand: malformed slash-command wrapper skipped contentLen=${content.length}`,
             { operation: "pv_send_watchdog_malformed_wrapper" },
           );
           return null;
         }
         if (!CMD_SIBLING_RE.test(content)) {
           // <command-name> alone — no sibling wrapper tag → treat as malformed.
           sshLogger.info(
             `[pv-send-watchdog] reconstructRawSlashCommand: malformed slash-command wrapper skipped contentLen=${content.length}`,
             { operation: "pv_send_watchdog_malformed_wrapper" },
           );
           return null;
         }
         const argsMatch = CMD_ARGS_RE.exec(content);
         const args = argsMatch !== null ? argsMatch[1] : "";
         return args !== undefined && args.trim().length > 0
           ? `/${name} ${args}`
           : `/${name}`;
       }
       ```

       Do NOT paste that block verbatim as fenced code inside the file —
       transcribe as real TypeScript. Above is guidance.

    3. Add the `__applyOnLineNotifyForTests` export just below the pure
       helper (executor discretion on exact placement — the file already
       clusters test seams together; group with them if that pattern is
       cleaner).

       Signature and body match the § behavior spec (B) exactly. Use
       `createHash` from the top-of-file import (already present at L2).

    4. Refactor the inline block at ~L3498-3510: replace the entire
       `if (frame.type === "message" && frame.role === "user" && …) { const contentHash = …; notifyPvSendMatched(…); }`
       body with a single call to `__applyOnLineNotifyForTests({ frame, sessionIdFromFile, notifyMatched: notifyPvSendMatched });`.
       Preserve the surrounding comment block; append a sentence about
       the dual-hash change referencing `quick-260821-shn`.

    5. If Test 6 (malformed-wrapper) fails because the default logger
       posts to the real `sshLogger` rather than a mock, adjust the test
       (not the production code) to inject a mock `logger` via the seam's
       optional `logger` dep. This is a legitimate green-phase test
       adjustment; document it inline with a comment like
       `// green-phase test adjustment: inject logger to observe INFO on malformed path`.

    6. Run the scoped suite:
       `cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts 2>&1 | tail -40`.
       All tests MUST pass — pre-existing + the 6 new ones.

    7. Run the related-file scan to catch adjacent regressions:
       `cd /home/ubuntu/skynet-tabitha && npx vitest run --related src/backend/claude-session/claude-session-server.ts 2>&1 | tail -20`.
       All discovered tests MUST pass. If a discovered test fails and is
       obviously related to this change (e.g. another test suite asserts
       on notifyPvSendMatched call counts), fix it in this same task.
       If a failure is unrelated pre-existing brokenness, note it in the
       SUMMARY under "Follow-ups" and do NOT attempt to fix here.

    8. Do NOT run the full test suite. Do NOT run `docker build`. Do NOT
       run `git push`. Do NOT touch any file outside `claude-session-server.ts`
       and the test file adjusted per step 5 (if applicable).

    9. Commit atomically:
       ```
       git add src/backend/claude-session/claude-session-server.ts \
              src/backend/claude-session/claude-session-server.compose-send.test.ts
       git commit -m "fix(quick-260821-shn): dual-hash notify for slash-command wrappers (GREEN)"
       ```
       If step 5 required no test tweak, only claude-session-server.ts is
       staged in this commit.

    10. Return control to orchestrator. Do NOT proceed to deploy.
        Orchestrator owns the ship-gate (full suite + docker build).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tabitha && npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    - `reconstructRawSlashCommand` exported from claude-session-server.ts with the exact contract from § behavior (A).
    - `__applyOnLineNotifyForTests` exported with the seam shape from § behavior (B).
    - The inline notify block at ~L3498-3510 replaced with a single call to `__applyOnLineNotifyForTests`, comment block updated to reference quick-260821-shn dual-hash change.
    - Scoped vitest run: all 6 new tests + all pre-existing compose-send tests PASS.
    - Related-file scan (`vitest run --related src/backend/claude-session/claude-session-server.ts`) shows no new regressions attributable to this change (any pre-existing brokenness is documented in SUMMARY, not fixed here).
    - One atomic commit `fix(quick-260821-shn): dual-hash notify for slash-command wrappers (GREEN)` on `feat/tab-title-from-tmux`.
    - Zero `git push`, zero `docker build`, zero full-suite vitest runs.
  </done>
</task>

</tasks>

<verification>
Overall checks (executor runs after both tasks complete, before writing SUMMARY):

1. **Scoped suite green:**
   ```
   cd /home/ubuntu/skynet-tabitha && \
     npx vitest run src/backend/claude-session/claude-session-server.compose-send.test.ts
   ```
   All tests pass (pre-existing + 6 new).

2. **Related-file scan green:**
   ```
   cd /home/ubuntu/skynet-tabitha && \
     npx vitest run --related src/backend/claude-session/claude-session-server.ts 2>&1 | tail -10
   ```
   No regressions attributable to this quick's change.

3. **Wrapper detection grep:**
   ```
   grep -n 'reconstructRawSlashCommand\|__applyOnLineNotifyForTests' \
     src/backend/claude-session/claude-session-server.ts
   ```
   At LEAST 3 hits: helper definition, seam definition, refactored call site.

4. **Dual-notify wire-up:**
   ```
   grep -n 'notifyPvSendMatched\|notifyMatched(' \
     src/backend/claude-session/claude-session-server.ts | head -10
   ```
   Confirms `notifyPvSendMatched` is passed as the `notifyMatched` dep into
   `__applyOnLineNotifyForTests`, and the raw inline block (with the
   `createHash` + `slice(0,32)` + `notifyPvSendMatched(sessionIdFromFile, contentHash)`
   inline shape at L3505-3509) is GONE (moved into the seam).

5. **Two atomic commits present:**
   ```
   git log --oneline -3 | grep -E 'quick-260821-shn'
   ```
   Two commits: RED (test-only) then GREEN (implementation + optional test tweak).

6. **No untouched-file drift:**
   ```
   git diff --stat feat/tab-title-from-tmux~2..feat/tab-title-from-tmux
   ```
   Exactly TWO files touched:
   - `src/backend/claude-session/claude-session-server.ts`
   - `src/backend/claude-session/claude-session-server.compose-send.test.ts`

7. **Executor STOPS here.** Do NOT deploy. Do NOT push. Orchestrator owns
   the ship-gate.
</verification>

<success_criteria>
Ready-for-orchestrator-handoff when:

- `reconstructRawSlashCommand` correctly reconstructs `/id tabitha` from the
  wrapper that the bug report grepped out of tina's session JSONL —
  verified by Test 1 hash equality.
- `__applyOnLineNotifyForTests` calls `notifyMatched` EXACTLY TWICE for
  slash-command frames and EXACTLY ONCE for non-slash frames — verified
  by Tests 1-4 (two calls) and Test 5 (one call).
- Malformed wrappers (Test 6) fall through to single-call behavior + INFO
  log; no crash.
- Scoped vitest suite is fully green; related-file scan surfaces no new
  regressions.
- Two atomic commits on `feat/tab-title-from-tmux`, prefixed `quick-260821-shn`.
- SUMMARY.md written to `.planning/quick/260821-shn-slash-cmd-watchdog-dual-hash-notify/260821-shn-SUMMARY.md`.
- Control returned to orchestrator; no deploy attempted.

**NOT in this plan's scope** (orchestrator handles):
- Running the full vitest suite (ship-gate).
- `docker compose build` / `docker compose up -d --force-recreate`.
- `git push` to origin.
- 15-minute deadman rollback timer arming.
- Live verification on a real PrettyView slash-command send post-deploy.
- Updating `skynet-patches.md` (orchestrator bookkeeping per constraint).
</success_criteria>

<output>
Create `.planning/quick/260821-shn-slash-cmd-watchdog-dual-hash-notify/260821-shn-SUMMARY.md` when done, following the standard SUMMARY template.
</output>
