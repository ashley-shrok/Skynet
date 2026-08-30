# Phase 49: PrettyView relay-outbound extractor sanitize pass — Context

**Gathered:** 2026-08-20
**Status:** Ready for planning
**Source:** Direct discussion with Ashley 2026-08-19 → 2026-08-20 (verbatim quotes below).

<domain>
## Phase Boundary

Ashley reported that Nelly's most recent outbound relay bubble in PrettyView
rendered only the words "relaying Ashley" — the rest of her ~1000-char body
was silently dropped. Diagnosis traced the failure to Strategy 1 (`BODY-sq`) of
the extractor at `src/backend/claude-session/session-file-parser.ts:224
extractOutboundBody`: a first-match-wins regex over the raw Bash command with
zero shell-quoting awareness. Two demonstrated failure classes both truncate
identically:

1. **Nelly's bug (bash `'"'"'` idiom):** to embed a literal `'` inside a
   single-quoted BODY, bash requires close-single + `"'"` + open-single — the
   whole thing concatenates into one shell string at parse time. The existing
   regex `(?:^|\s)BODY='((?:'\\'\'|[^'])*)'` only understands the OTHER escape
   idiom (`'\''`), so the first bare `'` terminates the capture.
2. **Self-referential (heredoc content bleed):** if the body TEXT contains a
   substring shaped like `BODY='…'` (e.g. discussing the extractor bug itself),
   the regex matches it INSIDE a heredoc that constructs the real body via
   `BODY=$(cat <<'EOF' … EOF)`, and returns the substring instead of the real
   payload.

This phase implements Ashley's chosen fix: an upfront sanitize pass over the
WHOLE command string that replaces both bash single-quote-escape idioms with
a private-use-area placeholder before regex, then restores `'` at the end.
Simplifies the sq-strategy regexes (drops the `'\''` alternation) and drops
per-strategy `.replace(/'\''/g, "'")` post-processing.

**Scope:** ONE backend file (session-file-parser.ts extractOutboundBody), its
test file (session-file-parser.outbound-body.test.ts), and the vitest suite
green precondition. No frontend changes (RelayOutboundBubble consumes `body`
identically). No wire-protocol change. No DB change. No nginx change. No
Dockerfile change. Fast-path deploy eligible (backend-only bundle change goes
through `docker cp` on the running container per box-maintainer role file).

</domain>

<decisions>
## Implementation Decisions (LOCKED)

### The Fix

- **Add** `sanitizeBashSqEscapeIdioms(cmd: string): string` — replaces both
  bash idioms with a private-use-area placeholder character (`U+E000`,
  literal string `""`). Both idioms are:
    - `'"'"'` — close-single + `"'"` + open-single (7 chars → 1 char placeholder)
    - `'\''`  — close-single + `\'` + open-single (4 chars → 1 char placeholder)
- **Add** `restoreApostrophes(body: string | null): string | null` — swaps
  every placeholder back to `'` in the extracted body. Null passes through.
- **Refactor** `extractOutboundBody(cmd)` to:
    1. Call `sanitizeBashSqEscapeIdioms(cmd)` FIRST (whole command, once).
    2. Run the strategy battery against the sanitized string.
    3. Wrap the final result in `restoreApostrophes(result)` before return.
- **Simplify** the 4 single-quoted-body strategy regexes (BODY-sq, MSG-sq,
  TEXT/MESSAGE-sq, jq-arg-inline-sq): the `((?:'\\'\'|[^'])*)` alternation
  collapses to `([^']*)` since the sanitize pass removed every embedded
  single-quote-escape sequence.
- **Drop** the per-strategy post-processing `.replace(/'\\''/g, "'")` calls in
  the same 4 strategies — the placeholder-restore handles apostrophe recovery
  at a single point.
- **Leave unchanged** the double-quoted strategies (BODY-dq, MSG-dq, TEXT-dq,
  jq-arg-inline-dq) — they don't use single-quote-escape idioms.
- **Leave unchanged** the heredoc strategies (heredoc-to-file, heredoc-inline)
  — they don't use single-quote-escape idioms in their capture body.
- **Leave unchanged** the inline-json strategy — JSON.parse handles its own
  escapes.
- **Leave unchanged** the strategy priority ordering (first-match-wins). The
  existing `PRIORITY-REGRESSION` test (tiffany's python-heredoc + BODY-sq
  where BODY-sq correctly wins) continues to pass unchanged.

### Placeholder character

- Choose `U+E000` (private-use area). Rationale: (a) not in any real message
  body — private-use area is by definition not assigned to any Unicode
  character; (b) single-code-point (1 char) makes regex `[^']*` traversal
  trivial; (c) round-trip through JSON serialization + WS transport
  preserves it.
- Store as a module-level constant `APOS_MARKER = ""`.

### Fidelity trade-off

**Zero fidelity loss.** The placeholder-restore preserves every apostrophe.
Cross-validated against the local 182-send corpus: 92.9% identical output,
6.6% rescues (up to 3.4× more body preserved on the worst case), 0
regressions, 0 fidelity loss (0 cases where the new returns fewer chars).

### Test additions

- **NELLY-SHAPE fixture:** the exact command from Nelly's DM to tabitha
  2026-08-20 with a `'"'"'` idiom embedded in the BODY. Expected extraction:
  the full body including the apostrophe restored.
- **SELF-REFERENTIAL fixture:** a `BODY=$(cat <<'EOF' … EOF)` command whose
  heredoc CONTENT contains a substring `BODY='...'`. Expected extraction: the
  full heredoc body (via the heredoc-inline strategy). The current extractor
  incorrectly returns the inner substring; the sanitize pass does NOT fix this
  — but Ashley greenlit accepting the self-referential case since it's rare
  enough to only trigger on messages ABOUT the extractor itself, and closing
  it would require a much larger rewrite.

Wait — clarify: the self-referential bug is a HEREDOC-CONTENT-BLEED, not a
sq-escape-idiom bug. The sanitize pass alone won't fix it. The self-referential
test fixture should be included but marked as a **KNOWN-LIMITATION** test that
DOCUMENTS the still-present behavior, not asserts a fix. If we later want to
address it (via a heredoc-first reorder or a shell-aware parser), the test
converts from documentation to regression guard.

### Priority regression test

- **Keep unchanged.** `PRIORITY-REGRESSION: BODY-sq beats heredoc-to-file
  when both appear in same command` at `session-file-parser.outbound-body.test.ts:361`
  MUST continue to pass byte-for-byte — tiffany's fixture where BODY='real
  body' is the real payload and the heredoc is unrelated python is a
  canonical shape.

### Ashley's stated priorities (verbatim, 2026-08-19)

- On extractor fidelity: *"I don't normally read the messages that show up
  that way. Like, I might sometimes but they're not super important to the
  info that I'm usually getting or the workflow"* — outbound bubble is
  context, not workflow; sanitize trade-off (dropped apostrophes) would have
  been acceptable, but the placeholder-restore variant eliminates even that.
- On approach: *"what if we strip the characters from the entire command
  instead of just the body? would parsing to find the body get any easier
  and cleaner then?"* — greenlit: strip idioms upfront, whole command, once,
  before any regex.

### Ship approach

- **Fast-path deploy eligible** — backend-only bundle rebuild goes through
  `docker cp dist-backend/. skynet:/app/backend/` per box-maintainer role
  file `runbooks/deploy-runbook.md` (adapted for backend). Actually — no:
  the fast-path runbook covers FRONTEND (`docker cp dist/. skynet:/app/html/`)
  only. Backend TypeScript changes require a full container recreate to
  reload the Node.js process (`docker compose up -d --force-recreate skynet`),
  so this ships via the full deploy runbook, not the fast path.
- Test discipline: full `npx vitest run` green (exit 0, zero failures) is a
  precondition per box-maintainer role file's "never leave tests failing"
  directive.
- Coord protocol: BEFORE post to box-maintainer coord room, docker build,
  force-recreate, HTTPS 200 verify, byte-verify sanitize function present in
  built bundle, AFTER post to coord, git push, patch entry in
  skynet-patches.md.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The prototype (validated logic to port)

- `~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/parsers.py`
  — the reference Python implementation. Contains BOTH `extract_current` (a
  byte-for-byte port of today's TS extractor for comparison) and
  `extract_sanitized` (the new logic to port to TS). The new logic is at
  `parsers.py:117-206`, plus `sanitize_bash_sq_escape_idioms` at :103, plus
  `restore_apostrophes` at :111. Port this to TypeScript.
- `~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/REPORT.md`
  — corpus validation summary (182 sends, 92.9% identical, 6.6% rescues, 0
  regressions, 0 fidelity loss).
- `~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/buckets/differ_longer.jsonl`
  — the 12 rescue cases; sample rescue quoted in REPORT.md.

### The target files

- `src/backend/claude-session/session-file-parser.ts:224-394` —
  `extractOutboundBody` function. Modify in place. Add `APOS_MARKER`,
  `sanitizeBashSqEscapeIdioms`, `restoreApostrophes` helpers alongside it.
- `src/backend/claude-session/session-file-parser.outbound-body.test.ts` —
  add NELLY-SHAPE + SELF-REFERENTIAL fixtures. Existing 12 test cases +
  PRIORITY-REGRESSION test MUST continue to pass unchanged.
- `src/backend/claude-session/session-file-parser.ts:127+` — `extractText`
  helper (unaffected, reference-only).

### The classifier (unchanged, reference-only)

- `src/backend/claude-session/session-file-parser.ts:40-42` — OUTBOUND_URL_RE,
  OUTBOUND_CURL_RE, OUTBOUND_PUT_RE constants. NOT touched by this phase.
- `src/backend/claude-session/session-file-parser.ts:166-198` —
  `detectRelayOutbound` classifier. NOT touched by this phase.

### The consumer (unchanged, reference-only)

- `src/ui/features/pretty-view/RelayOutboundBubble.tsx` — consumes
  `RelayOutboundBubbleProps.body`. Since `body` is now correctly populated,
  the consumer's `body !== null` branch renders as designed. No changes.

### Fleet role file directives that apply

- Box-maintainer role file `~/.claude/roles/box-maintainer/box-maintainer.md`:
  - "Never leave tests failing, regardless of where they came from" —
    precondition for ship.
  - "Executors don't do deploys — the orchestrator does" — plan's remit
    stops at code + commit + tests green.
  - "Container mutations serialize across identities — announce in coord
    room before AND after" — orchestrator ships, not planner/executor.

</canonical_refs>

<specifics>
## Specific Ideas

### Port mapping (Python → TypeScript)

| Python (parsers.py) | TypeScript (session-file-parser.ts) |
|---|---|
| `_APOS_MARKER = ""` | `const APOS_MARKER = "";` |
| `sanitize_bash_sq_escape_idioms(cmd)` | `function sanitizeBashSqEscapeIdioms(cmd: string): string` |
| `restore_apostrophes(body)` | `function restoreApostrophes(body: string \| null): string \| null` |
| `extract_sanitized(cmd)` wrapper | Refactor `extractOutboundBody(cmd)` in place |
| `_extract_from_sanitized(s)` inner | Body of `extractOutboundBody` after sanitize; the inner helper is a Python artifact of the wrap-return pattern — in TS, inline it and wrap the FINAL result with `restoreApostrophes(...)`. |

### Regex simplifications

Four strategies have their `((?:'\\'\'|[^'])*)` alternation collapsed to
`([^']*)`:

- Strategy 1 (BODY-sq): line 228
- Strategy 3 (MSG-sq): line 254
- Strategy 5a (TEXT/MESSAGE-sq): line 280
- Strategy 7 (jq-arg-inline-sq): line 320-321

Four `.replace(/'\\''/g, "'")` calls dropped (immediately follow each match):

- Line 230, 256, 282, 324

The whole return path funnels through a single `restoreApostrophes(...)`
wrapper.

### Logging

Existing DEBUG-level `sessionParserLogger.debug` calls at each strategy
match stay unchanged — they log `bodyLen` which reflects the RESTORED body
length (measured after `restoreApostrophes` if we log after the wrapper).
Actually — the current pattern logs INSIDE each strategy branch before the
return. To keep the log lines meaningful (bodyLen == what the frontend
receives), log inside each strategy branch as today but use the pre-restore
length; the +apostrophes recovered are typically 0-5, not a material
distinction for diagnostics. Simplest port: leave the logs where they are,
they show the pre-restore length which is off-by-N where N is the apostrophe
count, and that's fine for diagnostics. Alternative: move the log to a
single point after `restoreApostrophes`; equally fine. Pick whichever is
cleaner in the ported code.

</specifics>

<deferred>
## Deferred Ideas

### Self-referential heredoc-content-bleed

The self-referential bug (BODY='...' substring inside a heredoc body content
gets matched by the outer regex) is NOT fixed by the sanitize pass. Fixing
it would require either:
- A heredoc-first reorder in the strategy priority (breaks the existing
  PRIORITY-REGRESSION test), OR
- A pre-pass that masks heredoc contents from subsequent regex matches, OR
- A full shell-aware parser (major rewrite).

Deferred rationale (Ashley greenlit 2026-08-20): the self-referential class
only triggers when someone writes a message ABOUT the extractor shape. Rare
enough to accept. If it becomes a real fleet issue, open a follow-up phase.

The SELF-REFERENTIAL test fixture goes in as a KNOWN-LIMITATION test that
documents the still-present behavior (assertions describe what actually
happens today), not asserts a fix. This makes the test convert to a
regression guard once/if we later address it.

### The unextractable-by-design case

Tiffany's `jq -Rs '{msgtype:"m.text",body:(.|rtrimstr("\n"))}' file > req.json;
curl … --data-binary @req.json` shape reads the body from a file on disk
that's not embedded in the command. Genuinely unextractable at the command
level. This is the 3.6%-tail case from the original bounty
`pretty-view-outgoing-relay-render` — falls through to raw-command bubble
render. Not addressed by this phase.

### Heredoc-first strategy reorder

Considered and deferred 2026-08-20. Would make canonical `BODY=$(cat <<'EOF' …
EOF)` sends byte-perfect (they already are; the current heredoc-inline
strategy catches them). But it would break the PRIORITY-REGRESSION test where
BODY-sq legitimately beats heredoc-to-file for tiffany's python-heredoc
fixture. Ashley greenlit the simpler sanitize pass alone; heredoc-first is
NOT in this phase's scope.

</deferred>

---

*Phase: 49-prettyview-relay-outbound-extractor-sanitize-pass-bash-sq-es*
*Context gathered: 2026-08-20 via direct discussion with Ashley*
