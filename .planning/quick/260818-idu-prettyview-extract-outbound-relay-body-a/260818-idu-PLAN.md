---
phase: quick-260818-idu-prettyview-extract-outbound-relay-body
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/session-file-parser.ts
  - src/backend/claude-session/session-file-parser.outbound-body.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/RelayOutboundBubble.tsx
autonomous: true
requirements:
  - BOUNTY-pretty-view-outgoing-relay-render

must_haves:
  truths:
    - "When a fleet-standard outbound relay send is classified, the parser extracts the human message body from 7 named shell shapes (BODY-sq/dq, MSG-sq/dq, TEXT/MESSAGE var-assigns, jq-arg-inline-dq/sq, heredoc-to-file, heredoc-inline, inline-json) at ~96% coverage on the real corpus."
    - "Extractor strategies fire in FIRST-MATCH-WINS priority: BODY-sq → BODY-dq → MSG-sq → MSG-dq → TEXT/MESSAGE variants → jq-arg-inline → heredoc-to-file → heredoc-inline → inline-json. When two shapes co-occur (e.g. BODY='...' plus a heredoc-to-file later in the same cmd), the earlier priority wins because the BODY var is the definitive body."
    - "The 3-way classifier gate in `detectRelayOutbound()` (curl + -X PUT + rooms/.../send/m.room.message URL) is UNTOUCHED — extraction runs only after the classifier confirms the turn is an outbound send."
    - "Wire type `RelayOutboundMessage` (backend) and `RelayOutboundEvent` (frontend) both carry a new `body: string | null` field. `null` = extraction fallback path."
    - "Strategy name is NEVER exposed on the wire type. Matched strategy is logged at debug via `sessionParserLogger` (the alias for `databaseLogger`) alongside the existing `[session-parser] classify result=relay_outbound ...` info line, for future diagnostics only."
    - "The `claude-session-server.ts` WS emit case for `relay_outbound` (L2438-2459) forwards the new `body` field on the wire frame — a null-safe passthrough of `parsed.body`."
    - "`RelayOutboundBubble.tsx` — when `body` is a string, renders it as a pretty text bubble ABOVE the rawCommand, styled to visually mirror the pretty-text side of `RelayInboundBubble` (same JetBrains_Mono_Variable header font stack, same `whitespace-pre-wrap` body treatment inside the outbound identity-hue gradient — hue+alignment stays outbound-side, so the treatment is 'symmetric hue-flipped mirror' of inbound, not a color copy). The rawCommand `<pre>` block is COLLAPSED behind an expand-to-see-raw toggle when `body` is present; DEFAULT EXPANDED when `body` is `null` (fallback case)."
    - "The `▸ relay send → {room}` header line and the `via curl` footer line both remain untouched (still visible in both body-present and fallback modes)."
    - "Fixture test file `session-file-parser.outbound-body.test.ts` uses 12-15 REAL command strings from `/tmp/relay-outbound-raw.jsonl` — no synthesized examples. Covers all 7 named extraction shapes plus 2-3 known unextractable shapes (cross-turn file ref, python heredoc) asserting `body === null`."
    - "React children pass-through: body is rendered via `{body}` in JSX, NEVER `dangerouslySetInnerHTML` — preserves T-17-03-01 posture."
    - "`npx vitest run` exits 0. `npm run build:backend && npm run build` both exit 0 (backend TS errors would be missed by frontend-only `tsc --noEmit`, per role-learned preference)."
  artifacts:
    - path: "src/backend/claude-session/session-file-parser.ts"
      provides: "Exported `extractOutboundBody(cmd: string): string | null`, extended `RelayOutboundMessage` type with `body: string | null`, `detectRelayOutbound` return extended with `body`, `parseSessionLine` relay_outbound case forwarding `body`, updated July comment block at L77-85 with reversal note citing bounty slug pretty-view-outgoing-relay-render."
      contains: "extractOutboundBody"
    - path: "src/backend/claude-session/session-file-parser.outbound-body.test.ts"
      provides: "Table-driven vitest suite with 12-15 real corpus fixtures + 2-3 null-expected fixtures + priority-order regression fixture."
      contains: "extractOutboundBody"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "`relay_outbound` WS emit case forwards `body: parsed.body` on the frame (null-safe passthrough) at L2438-2459."
      contains: "body: parsed.body"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "`RelayOutboundEvent` type extended with `body: string | null` field at L160-166."
      contains: "body: string | null"
    - path: "src/ui/features/pretty-view/RelayOutboundBubble.tsx"
      provides: "Bubble accepts `body` prop; when non-null renders pretty text bubble above rawCommand + expand-to-see-raw toggle (raw default collapsed); when null renders rawCommand always-expanded as today."
      contains: "body"
  key_links:
    - from: "src/backend/claude-session/session-file-parser.ts"
      to: "src/backend/claude-session/session-file-parser.ts"
      via: "detectRelayOutbound calls extractOutboundBody(cmd) after the 3-way classifier gate passes; parseSessionLine's relay_outbound case (L560-584) forwards body onto the RelayOutboundMessage return."
      pattern: "extractOutboundBody\\("
    - from: "src/backend/claude-session/claude-session-server.ts"
      to: "src/ui/api/claude-session-api.ts"
      via: "relay_outbound WS frame (L2438-2459) — new `body` field on the JSON payload consumed by the RelayOutboundEvent type."
      pattern: "body: parsed\\.body"
    - from: "src/ui/features/pretty-view/RelayOutboundBubble.tsx"
      to: "src/ui/api/claude-session-api.ts"
      via: "RelayOutboundBubbleProps Pick from RelayOutboundEvent extended to include `body`."
      pattern: "\"room\"\\s*\\|\\s*\"rawCommand\"\\s*\\|\\s*\"body\""
---

<objective>
Realise the deferred July 2026-07-28 follow-up bounty (`pretty-view-outgoing-relay-render`): opportunistically extract the human message body from Bash outbound relay sends and render it as a pretty text preview above a collapsed rawCommand block in `RelayOutboundBubble`. The July note deferred this behind "extraction is unreliable"; the 530-record corpus survey in `~/.claude/roles/box-maintainer/bounties/pretty-view-outgoing-relay-render/PATTERNS.md` proves 96.4% of real fleet sends fall into 7 named regex shapes.

Purpose: pretty view currently shows a wall of curl args for every relay send — Ashley reads through the noise to find the actual message. Extracting the body and floating it above the raw command as a pretty text bubble (with rawCommand behind an expand toggle) turns 96.4% of relay sends into readable one-liners, while the 3.6% fallback path (cross-turn file refs, python heredocs) safely degrades to today's always-expanded mono block.

Output: `extractOutboundBody(cmd)` extractor with 7-strategy priority order in `session-file-parser.ts`; extended `RelayOutboundMessage` / `RelayOutboundEvent` wire types carrying `body: string | null`; WS frame emit forwarding the new field; `RelayOutboundBubble` renders body as pretty text above expand/collapse toggle for raw; corpus-driven fixture test file. Full test + build suites green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/backend/claude-session/session-file-parser.ts
@src/backend/claude-session/session-file-parser.test.ts
@src/backend/claude-session/claude-session-server.ts
@src/ui/api/claude-session-api.ts
@src/ui/features/pretty-view/RelayOutboundBubble.tsx
@src/ui/features/pretty-view/RelayInboundBubble.tsx
@$HOME/.claude/roles/box-maintainer/bounties/pretty-view-outgoing-relay-render/PATTERNS.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add extractOutboundBody + fixture test file (RED then GREEN)</name>
  <files>
    src/backend/claude-session/session-file-parser.ts,
    src/backend/claude-session/session-file-parser.outbound-body.test.ts
  </files>
  <behavior>
Fixture-driven table tests, all 12-15 fixtures pulled DIRECTLY as real command strings from `/tmp/relay-outbound-raw.jsonl` (566 records, one JSONL per line, shape `{project, ts, cmd}` — use `cmd` verbatim, no reformatting). Fixture selection MUST cover:

- 1 fixture BODY-sq — `BODY='...literal...'` with a `'\''` shell-escape somewhere in the body if any survey line has one; otherwise a plain sq
- 1 fixture BODY-dq — `BODY="...literal..."` with a `\"` escape inside if present in corpus
- 1 fixture MSG-sq — `MSG='...literal...'`
- 1 fixture MSG-dq — `MSG="...literal..."`
- 1 fixture jq-arg-inline-dq — tiffany's `BODY=$(jq -nc --arg m "..." '{msgtype:"m.text",body:$m}')` shape (the exact form the July note said "cannot succeed on")
- 1 fixture heredoc-to-file — canonical agent-relay skill shape: `cat > "$STATE_DIR/msg.txt" <<'EOF' ... EOF`
- 1 fixture heredoc-inline — `cat <<'EOF' ... EOF` piped inline (only 1 record in corpus — grep the file for `cat <<'EOF'` without redirection to find it)
- 1 fixture inline-json — `-d '{"msgtype":"m.text","body":"..."}'`
- 1-2 additional fixtures across TEXT= / MESSAGE= / jq-arg-inline-sq if present, else pad with duplicate-shape variants from different corpus records to reach 12-15 total
- 1 fixture UNEXTRACTABLE-cross-turn — a corpus command whose only body payload is `curl ... --data-binary @$STATE_DIR/req.json` (or similar `@`-prefixed file arg), with no BODY=/MSG=/heredoc IN THE SAME COMMAND; expected `body === null`
- 1 fixture UNEXTRACTABLE-python — a `python3 <<'PY' ... urlopen(...send/m.room.message...) ... PY` command from corpus; expected `body === null`
- 1 fixture PRIORITY-REGRESSION — a synthetic-composed command that includes BOTH `BODY='real body'` AND a later `cat > /tmp/decoy <<'EOF'\ndecoy body\nEOF` heredoc; asserts extractor returns `'real body'` (BODY-sq beats heredoc-to-file). This is the ONE allowed non-corpus fixture — its purpose is documenting priority-order, and the composition MUST be commented as such in the test file so a future maintainer knows the exception.

For each corpus fixture: extract the raw `cmd` field from the JSONL line via a comment above the fixture citing the line's `project` + `ts` for provenance (e.g. `// corpus: project=-home-ubuntu-skynet-tanya ts=2026-08-09T09:18:21.779Z — jq-arg-inline-dq shape`). Do NOT include the full JSONL wrapper — just the `cmd` string.

Test shape:
- One `describe("extractOutboundBody — corpus fixtures", ...)` block with one `it()` per fixture asserting `extractOutboundBody(fixture.cmd) === fixture.expectedBody` (or `=== null`).
- One `describe("extractOutboundBody — priority order", ...)` block for the PRIORITY-REGRESSION fixture.
- Fixtures declared as a `const FIXTURES: Array<{name: string; cmd: string; expectedBody: string | null}>` and iterated via `it.each(FIXTURES)`.
  </behavior>
  <action>
Two-part edit, TDD RED→GREEN.

**Part A — write the failing test file FIRST** at `src/backend/claude-session/session-file-parser.outbound-body.test.ts`:

1. Read `/tmp/relay-outbound-raw.jsonl` (566 lines, JSONL). To find candidate fixtures for each shape, use the following greps (never re-read the whole file):
   - BODY-sq: `grep -n "BODY='" /tmp/relay-outbound-raw.jsonl | head -3`
   - BODY-dq: `grep -n 'BODY="' /tmp/relay-outbound-raw.jsonl | head -3`
   - MSG-sq: `grep -n "MSG='" /tmp/relay-outbound-raw.jsonl | head -3`
   - MSG-dq: `grep -n 'MSG="' /tmp/relay-outbound-raw.jsonl | head -3`
   - jq-arg-inline-dq: `grep -n "jq -nc --arg" /tmp/relay-outbound-raw.jsonl | head -3`
   - heredoc-to-file: `grep -n "cat > .* <<" /tmp/relay-outbound-raw.jsonl | head -3`
   - heredoc-inline (rare, only 1): `grep -n "cat <<'EOF'" /tmp/relay-outbound-raw.jsonl | grep -v "cat >" | head -3`
   - inline-json: `grep -nE "\-d '\{\"msgtype" /tmp/relay-outbound-raw.jsonl | head -3`
   - cross-turn fail: `grep -n "\\-\\-data-binary @" /tmp/relay-outbound-raw.jsonl | head -3`
   - python fail: `grep -n "python3 <<" /tmp/relay-outbound-raw.jsonl | head -3`

   Read specifically the matched lines by number (via `sed -n "{n}p" /tmp/relay-outbound-raw.jsonl` or a targeted Read with `offset={n} limit=1` — the file is 566 JSONL lines, each ~1-3KB). For each candidate, `JSON.parse` the wrapper and pull `cmd` verbatim.

2. Compose FIXTURES array — 12-15 total. For each entry:
   ```
   { name: "BODY-sq — coord room deploy start (tanya)",
     cmd: "R=~/.claude/identities/tanya/relay.json\nBASE=...\nBODY='...literal from corpus...'\ncurl ...",
     expectedBody: "...the same literal body string a human would read..." }
   ```
   Prefer short-body corpus records (< 500 char `cmd`) — long commands bloat the test file without adding coverage. If the natural short fixtures don't span all 7 strategies, pick the shortest available per shape.

3. Test file imports `extractOutboundBody` from `./session-file-parser.js` (matching sibling test file import shape at `session-file-parser.test.ts:2-6`).

4. Confirm RED: `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts` — expect all fixture tests to fail with "extractOutboundBody is not a function" (the export doesn't exist yet).

**Part B — implement `extractOutboundBody` in `src/backend/claude-session/session-file-parser.ts` to make Part A green:**

1. Insert `extractOutboundBody(cmd: string): string | null` as an exported function immediately AFTER `detectRelayOutbound` (i.e. after L200, before the `detectRelayInbound` doc block at L202). Implement the 9 strategies in this exact priority order (FIRST MATCH WINS — return on first non-null hit):

   1. `BODY-sq` — regex `/(?:^|\s)BODY='((?:'\\''|[^'])*)'/` with the `'\''` shell-escape sequence decoded (`.replace(/'\\''/g, "'")`) before returning
   2. `BODY-dq` — regex `/(?:^|\s)BODY="((?:\\.|[^"\\])*)"/` with `\\` and `\"` decoded (`.replace(/\\(.)/g, '$1')` scoped conservatively)
   3. `MSG-sq` — symmetric to BODY-sq with `MSG=`
   4. `MSG-dq` — symmetric to BODY-dq with `MSG=`
   5. `TEXT-sq` / `TEXT-dq` / `MESSAGE-sq` / `MESSAGE-dq` — same var-assign shapes, symmetric handling
   6. `jq-arg-inline-dq` — regex `/--arg\s+\w+\s+"((?:\\.|[^"\\])*)"\s+'\{msgtype:/` — the trailing `'{msgtype:` immediately after the arg value is REQUIRED to disambiguate from unrelated `jq --arg u "$USER"` uses; decode `\"`/`\\` inside
   7. `jq-arg-inline-sq` — regex `/--arg\s+\w+\s+'((?:'\\''|[^'])*)'\s+'\{msgtype:/` — symmetric sq variant
   8. `heredoc-to-file` — regex `/cat\s*>\s*(?:"[^"]*"|'[^']*'|\S+)\s*<<\s*'?EOF'?\s*\n([\s\S]*?)\n\s*EOF\b/` — capture between EOF markers (support both `<<'EOF'` and `<<EOF`; body is captured verbatim, no shell-escape decoding since single-quoted heredoc is literal)
   9. `heredoc-inline` — regex `/cat\s*<<\s*'?EOF'?\s*\n([\s\S]*?)\n\s*EOF\b/` — same shape as (8) WITHOUT the `>` file redirection. Priority-ordered AFTER heredoc-to-file so the more specific pattern wins first.
   10. `inline-json` — regex `/-d\s+'(\{"msgtype":"m\.text","body":"(?:\\.|[^"\\])*"\})'/` capturing the JSON object; `JSON.parse` it, return `.body`. Wrap the parse in try/catch → on parse failure return null (do not throw).

   Return `null` if no strategy matches.

   For each successful match, call `sessionParserLogger.debug(\`[session-parser] extract result=outbound_body strategy=\${strategyName} bodyLen=\${body.length}\`, { operation: "session_extract" })`. Log at DEBUG (not INFO) — this is diagnostic only, must not pollute production info stream. Use the existing `sessionParserLogger` alias at L31 (which is `databaseLogger`). If `.debug` is not present on the logger interface, use `.info` with a `verbose=true` flag guard OR fall back silently — check the databaseLogger surface at `src/backend/utils/logger.ts` first and pick whichever debug-tier method it offers (or use `.info` with a `[debug]` prefix if no debug method exists).

2. Extend `RelayOutboundMessage` at L92-98 to add `body: string | null;` as the final field.

3. Update the doc block at L77-85 (the Option D comment) to note the reversal. Replace the "Follow-up bounty (out of scope for this fix, 2026-07-28)" paragraph with a reversal note:
   ```
   // Update (2026-08-18, bounty pretty-view-outgoing-relay-render):
   // The July "extraction unreliable" premise was disproved by a 530-record
   // survey — see PATTERNS.md in the bounty folder. 7 named regex strategies
   // now cover 96.4% of real fleet sends. `extractOutboundBody(cmd)` below
   // runs after the 3-way classifier gate confirms the turn is a real outbound
   // send, and returns `body: string | null` (null = fallback to rawCommand
   // mono block, unchanged from the July behavior — 3.6% cross-turn +
   // python-heredoc tail).
   ```

4. Update the `detectRelayOutbound` doc block at L146-168 similarly — replace the "Option D … extraction removed entirely" paragraph and the "Follow-up bounty (out of scope)" paragraph with a shorter pointer:
   ```
   * Body extraction (2026-08-18, bounty pretty-view-outgoing-relay-render):
   * `extractOutboundBody(cmd)` runs on the confirmed-outbound command and
   * returns `body: string | null`. Extraction is opportunistic (7 named
   * strategies, 96.4% corpus coverage) — null falls back to rawCommand-only
   * render in the bubble, preserving July "faithful record" semantics for
   * the 3.6% tail (cross-turn file refs, python-scripted sends).
   ```

5. Extend `detectRelayOutbound`'s return type at L169-174 to include `body: string | null`. At the return site (L197), call `extractOutboundBody(cmd)` and include the result on the returned object:
   ```
   const body = extractOutboundBody(cmd);
   return { room, rawCommand: cmd, body };
   ```

6. In `parseSessionLine`'s relay_outbound case (L577-583), forward `body: outbound.body` on the `RelayOutboundMessage` construction.

7. Do NOT touch the 3-way classifier regex tests or `detectRelayOutbound`'s existing conjunction gates.

8. Confirm GREEN: `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts` — all fixture tests pass. Then run the full existing parser suite to confirm no regression: `npx vitest run src/backend/claude-session/session-file-parser.test.ts src/backend/claude-session/session-file-parser.id-reset.test.ts`.
  </action>
  <verify>
    <automated>npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts src/backend/claude-session/session-file-parser.test.ts src/backend/claude-session/session-file-parser.id-reset.test.ts</automated>
  </verify>
  <done>
- `session-file-parser.outbound-body.test.ts` exists with 12-15 real-corpus fixtures + 2-3 null-expected + 1 priority-regression fixture.
- All fixture tests pass; strategy priority (BODY-sq beats heredoc-to-file) verified by regression test.
- `extractOutboundBody` exported from `session-file-parser.ts` with 9-strategy priority order.
- `RelayOutboundMessage` wire type carries `body: string | null`.
- `detectRelayOutbound` return + `parseSessionLine` relay_outbound case both include `body`.
- July "Option D" comment blocks at L77-85 + L146-168 updated with reversal note citing bounty slug `pretty-view-outgoing-relay-render`.
- Existing parser tests (`session-file-parser.test.ts`, `session-file-parser.id-reset.test.ts`) still pass — no regression to the 3-way classifier gate.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Forward body on WS frame + extend frontend wire type</name>
  <files>
    src/backend/claude-session/claude-session-server.ts,
    src/ui/api/claude-session-api.ts
  </files>
  <behavior>
- After change: the `relay_outbound` WS frame emitted by `claude-session-server.ts` at L2438-2459 includes a `body` field carrying `parsed.body` (which will be `string | null` per Task 1). The frame shape now: `{ type: "relay_outbound", room, rawCommand, body, eventId, ts }`.
- Frontend `RelayOutboundEvent` type at `src/ui/api/claude-session-api.ts:160-166` includes `body: string | null` — TypeScript compiler enforces that any consumer destructuring the event handles the new field.
- No new tests required at the WS-emit layer (existing `claude-session-server.*.test.ts` files already cover the emit path via `dispatch`); the added field is a passthrough. If existing emit tests assert on the exact frame shape (via `toEqual` on an object literal), those assertions will trip and MUST be updated in place to include the new `body` field with the extracted value (or `null`).
  </behavior>
  <action>
Three-part edit.

**Part A — `src/backend/claude-session/claude-session-server.ts` L2438-2459 (the `relay_outbound` case in the dispatch switch):**

Add `body: parsed.body,` to the `ws.send(JSON.stringify({...}))` object literal, placed between `rawCommand` and `eventId`:
```
ws.send(
  JSON.stringify({
    type: "relay_outbound",
    room: parsed.room,
    rawCommand: parsed.rawCommand,
    body: parsed.body,     // NEW — bounty pretty-view-outgoing-relay-render
    eventId: parsed.eventId,
    ts: parsed.ts,
  }),
);
```

Do NOT touch the surrounding try/catch or the switch's other cases.

**Part B — `src/ui/api/claude-session-api.ts` L160-166 (RelayOutboundEvent type):**

Extend the type with `body: string | null;` as the final field before the closing brace, mirroring the ordering from the backend `RelayOutboundMessage`. Add a one-line comment above it:
```
export type RelayOutboundEvent = {
  type: "relay_outbound";
  room: string | null;
  rawCommand: string;
  /** Extracted message body from the outbound curl command via the 7-strategy
   * shell-var/heredoc/inline-json extractor. null = fallback path (unextractable
   * shape); consumer should render rawCommand as-is (bounty
   * pretty-view-outgoing-relay-render, 2026-08-18). */
  body: string | null;
  eventId: string;
  ts: number;
};
```

Also update the surrounding doc block at L146-158 (specifically the "rawCommand: IS the body (Option D..." paragraph) to reflect that `body` is now the preferred read path and `rawCommand` is the always-preserved faithful record:
```
// RelayOutboundEvent: emitted when the backend parser detects a Bash tool_use
// that is a real Matrix relay send (curl + -X PUT + rooms/X/send/m.room.message/Y
// conjunction). Field notes:
//   body:       extracted human message body via the 7-strategy shell/heredoc/inline-json
//               extractor (bounty pretty-view-outgoing-relay-render, 2026-08-18) —
//               null means the extractor found no known shape, consumer falls back
//               to rendering rawCommand (~3.6% tail: cross-turn file refs, python heredocs).
//   rawCommand: the full Bash command — always preserved as a faithful record even
//               when body is non-null (may contain curl bearer tokens; T-17-01-02).
```

**Part C — sweep existing tests for emit-shape assertions that will break:**

Grep for any test asserting on the `relay_outbound` frame's object shape:
```
grep -rn "type: \"relay_outbound\"" src/backend/claude-session/*.test.ts src/ui/features/pretty-view/*.test.tsx
```

For any hit that uses `expect(...).toEqual({...})` on a relay_outbound frame literal, add `body: null` (or the expected extracted value if the test constructs a specific extractable command) to the expected literal. If a hit uses `expect.objectContaining({...})`, no change needed. If a hit uses `toMatchObject`, no change needed unless it strictly types the object.

Do NOT add new tests in this task — Task 1's fixture suite covers the extractor logic; the WS emit is a null-safe passthrough that existing integration tests continue to cover structurally.
  </action>
  <verify>
    <automated>npx vitest run src/backend/claude-session/ src/ui/api/claude-session-api.aside.test.ts src/ui/api/claude-session-api.count-bounties.test.ts</automated>
  </verify>
  <done>
- `claude-session-server.ts` L2438-2459 emits `body: parsed.body` on the `relay_outbound` WS frame.
- `RelayOutboundEvent` at `claude-session-api.ts:160-166` carries `body: string | null` with doc comment.
- Any existing emit-shape tests updated to include the new field in their expected literal (or continue passing via objectContaining/toMatchObject).
- Full `src/backend/claude-session/` + the two touched api test files vitest suites green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: RelayOutboundBubble body-preview render + expand/collapse toggle</name>
  <files>src/ui/features/pretty-view/RelayOutboundBubble.tsx</files>
  <behavior>
- When `body: string` (non-null): the bubble renders in TWO stacked sections inside the identity-hue gradient bubble frame, in this vertical order:
  1. Header line `▸ relay send → {room}` (unchanged from today)
  2. Pretty text body — `<div className="whitespace-pre-wrap">{body}</div>` — styled to mirror `RelayInboundBubble`'s inline body render (L180). This preserves the "symmetric hue-flipped mirror" — outbound side keeps its identity-hue gradient + left alignment + warm-cream text; only the text-block *treatment* (whitespace-pre-wrap div, no mono background) mirrors the inbound side.
  3. Expand-to-see-raw toggle: a small clickable disclosure element (e.g. `<button>` with `▸ raw command` label when collapsed, `▾ raw command` when expanded). DEFAULT COLLAPSED (`useState(false)`) when body is present.
  4. When expanded: the existing `<pre>` scrollable mono block renders with `{rawCommand}` inside (same shape as today's L80-88).
  5. Footer `via curl` (unchanged from today).
- When `body === null`: the bubble renders EXACTLY as today — header, always-visible `<pre>` mono block with rawCommand, footer. No toggle rendered in this branch (or: toggle rendered but default EXPANDED and the pretty-body section is skipped). The simpler branch is "no toggle at all when body is null; always render the pre block."
- Toggle state is component-local (`useState`) — no lift, no store. Toggle click flips the boolean; no other side effects.
- Security posture unchanged: `{body}` and `{rawCommand}` are React text children (never `dangerouslySetInnerHTML`). Rendered text still auto-escapes.
- `RelayOutboundBubbleProps` extended to `Pick<RelayOutboundEvent, "room" | "rawCommand" | "body">` plus the existing optional `ts?: number`.
  </behavior>
  <action>
Single-file edit at `src/ui/features/pretty-view/RelayOutboundBubble.tsx`.

**Part A — imports + props:**

1. Add `import { useState } from "react";` at the top (currently no React state import).
2. Extend `RelayOutboundBubbleProps` at L28-37 to add `body` to the `Pick<>`:
   ```
   export type RelayOutboundBubbleProps = Pick<
     RelayOutboundEvent,
     "room" | "rawCommand" | "body"
   > & { ts?: number };
   ```
3. Extend the destructure at L39-43 to include `body`.

**Part B — doc block reversal (L4-26):**

Update the "Option D … rawCommand IS the body" comment paragraph at L20-22 with a reversal note citing the bounty slug:
```
// Update (2026-08-18, bounty pretty-view-outgoing-relay-render):
// Body extraction reinstated per PATTERNS.md survey (96.4% coverage of real
// fleet sends across 7 named shell/heredoc/inline-json shapes). When body is
// non-null, we render it as a pretty text block above a COLLAPSED-by-default
// expand-to-see-raw toggle wrapping the mono rawCommand block. When body is
// null (3.6% tail: cross-turn refs, python heredocs), we fall back to the
// July behavior: rawCommand always-visible mono block, no toggle.
//
// Security (T-17-03-01) UNCHANGED: both {body} and {rawCommand} are React
// text children — never dangerouslySetInnerHTML.
```

**Part C — render body:**

Inside the bubble frame (between the header at L67-76 and the footer at L91-98), replace the existing `<pre>` block at L80-88 with a conditional two-branch render:

```
{body !== null ? (
  <>
    {/* Pretty body preview — mirrors RelayInboundBubble.tsx:180 inline body render */}
    {/* Security (T-17-03-01): {body} is a React text child, NEVER dangerouslySetInnerHTML */}
    <div className="whitespace-pre-wrap">{body}</div>

    {/* Expand-to-see-raw toggle — default collapsed */}
    <button
      type="button"
      onClick={() => setRawExpanded((v) => !v)}
      className={cn(
        "mt-2 text-[10px]",
        "text-[rgba(220,_225,_245,_0.5)] hover:text-[rgba(220,_225,_245,_0.8)]",
        "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
        "cursor-pointer bg-transparent border-0 p-0",
      )}
    >
      {rawExpanded ? "▾ raw command" : "▸ raw command"}
    </button>

    {rawExpanded && (
      <pre
        className={cn(
          "mt-1 whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto",
          "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          "bg-black/40 rounded p-2 text-xs",
        )}
      >
        {rawCommand}
      </pre>
    )}
  </>
) : (
  /* Fallback: body extraction returned null — render rawCommand always-visible as today.
     Security (T-17-03-01): {rawCommand} is a React text child, NEVER dangerouslySetInnerHTML */
  <pre
    className={cn(
      "whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto",
      "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
      "bg-black/40 rounded p-2 text-xs",
    )}
  >
    {rawCommand}
  </pre>
)}
```

Declare the toggle state at the top of the component body: `const [rawExpanded, setRawExpanded] = useState(false);` — placed immediately after the function opening brace at L43-44.

**Part D — sweep for callers:**

Grep for `RelayOutboundBubble` usage sites:
```
grep -rn "RelayOutboundBubble" src/ui/
```

For each caller (expected: `src/ui/features/pretty-view/PrettyView.tsx` around L2417), verify the caller destructures the event and passes `body={m.body}` (or via spread that includes body). If a caller passes `rawCommand` and `room` explicitly without spreading, add `body={m.body}` in symmetric position. Do NOT modify test-only harness callers if they construct props inline — the type extension already forces those to compile-fail if they omit `body`, and the TypeScript compiler at build time will surface them.

If existing `RelayOutboundBubble.*.test.tsx` files exist (grep confirms), verify they still pass — the type extension makes `body` required at the type level (via `Pick`). Test callers that construct the props inline without `body` MUST be updated to pass `body: null` at minimum (preserves today's rendering behavior). Do NOT add new bubble unit tests in this task — the fallback branch replicates today's behavior byte-for-byte and existing snapshot/render assertions should continue to hold once `body: null` is passed.

**Part E — full-suite typecheck + tests:**

Run `npm run build:backend && npm run build` — both must exit 0. The frontend `tsc --noEmit` step embedded in `npm run build` will catch any missed caller sites (missing `body` prop in JSX). The `npm run build:backend` step catches the backend TS surface for Task 1 + 2 edits.

Then `npx vitest run` full suite — must exit 0.
  </action>
  <verify>
    <automated>npm run build:backend && npm run build && npx vitest run</automated>
  </verify>
  <done>
- `RelayOutboundBubble.tsx` accepts `body: string | null` prop via extended `RelayOutboundBubbleProps` Pick.
- When `body !== null`: renders pretty text `<div className="whitespace-pre-wrap">{body}</div>` above a default-collapsed `▸ raw command` toggle that expands the existing `<pre>` mono block.
- When `body === null`: renders the `<pre>` mono block always-visible (byte-for-byte matches today's L80-88 behavior).
- `▸ relay send → {room}` header and `via curl` footer both preserved in both branches.
- Doc block at L20-22 updated with reversal note citing bounty slug `pretty-view-outgoing-relay-render`.
- All existing callers (PrettyView.tsx, any tests) pass `body` — TS compiler surfaces any misses at build time.
- `npm run build:backend` exits 0. `npm run build` exits 0. `npx vitest run` exits 0.
  </done>
</task>

</tasks>

<verification>
Full-suite green is the acceptance bar:

1. `npx vitest run` exits 0 — new fixture test file + all existing tests pass.
2. `npm run build:backend` exits 0 — backend TS surface (session-file-parser + claude-session-server) typechecks.
3. `npm run build` exits 0 — frontend TS surface (claude-session-api + RelayOutboundBubble + PrettyView caller) typechecks.
4. Manual eyeball of a fixture: `extractOutboundBody("BODY='hello'\ncurl -X PUT ...")` returns `"hello"`; extractor priority verified by the priority-regression fixture.
5. `RelayOutboundBubble.tsx` render: body-present path shows pretty text above collapsed toggle; body-null path shows rawCommand always-expanded (fallback behavior identical to today).
</verification>

<success_criteria>
- 96%+ of real-corpus outbound sends produce a `body` string on the wire; ~3.6% (cross-turn file refs, python heredocs) produce `body: null` and fall back to today's rawCommand mono block.
- All three test surfaces green: new fixture file, existing session-file-parser tests, full vitest suite.
- Both build commands green (backend + frontend typecheck).
- The 3-way classifier gate in `detectRelayOutbound` (curl + -X PUT + URL) is UNTOUCHED — extraction is strictly additive after the gate confirms outbound.
- Extractor strategy name is logged at debug for future diagnostics but NEVER exposed on the wire type.
- Security posture (React children pass-through, no `dangerouslySetInnerHTML`) preserved for both `{body}` and `{rawCommand}`.
- Comment blocks at `session-file-parser.ts:77-85`, `session-file-parser.ts:146-168`, `claude-session-api.ts:146-158`, and `RelayOutboundBubble.tsx:20-22` all cite the bounty slug `pretty-view-outgoing-relay-render` for future spelunkers tracing the July → August reversal.
</success_criteria>

<output>
Create `.planning/quick/260818-idu-prettyview-extract-outbound-relay-body-a/260818-idu-SUMMARY.md` when done.
</output>
