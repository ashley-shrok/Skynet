# Phase 49: Research

**Compiled:** 2026-08-20
**Status:** Research complete (empirical validation done pre-planning)

## Summary

Research consisted of (a) tracing Nelly's truncation to Strategy 1 (BODY-sq)
of the extractor, (b) confirming the mechanism via her raw command
(bash `'"'"'` escape idiom for embedding `'` inside a single-quoted string),
(c) building a Python prototype that ports both the current extractor and
the proposed sanitize-pass alternative, (d) running the prototype against a
182-send corpus from all box-maintainer identities on this box, (e)
tabulating the delta. Ashley greenlit the approach 2026-08-20. Full prototype
+ corpus + comparison harness live in
`~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/`.

## Root cause (verified)

The extractor at `src/backend/claude-session/session-file-parser.ts:224`
`extractOutboundBody` is a first-match-wins battery of 10 regex strategies
run over the raw Bash command string. **No strategy is shell-quoting-aware**.
The four single-quoted-body strategies (BODY-sq, MSG-sq, TEXT/MESSAGE-sq,
jq-arg-inline-sq) use the regex shape `\bBODY='((?:'\\'\'|[^'])*)'`. The
alternation `(?:'\\'\'|[^'])` lets the capture group swallow the bash `'\''`
sequence (close-single + `\'` + open-single, POSIX portable) as a legal
inner "quote." But it does NOT handle the OTHER common bash idiom
`'"'"'` (close-single + `"'"` + open-single), which is what many identities
(including Nelly) actually use. When the regex hits `BODY='Relaying Ashley'"'"'s reply: …'`,
it captures `Relaying Ashley` and stops at the first bare `'`.

## The fix

Ashley (2026-08-20, verbatim): *"what if we strip the characters from the
entire command instead of just the body? would parsing to find the body get
any easier and cleaner then?"* — greenlit.

Approach: **upfront sanitize pass over the whole command**, replacing both
bash single-quote-escape idioms with a placeholder character (`U+E000`,
private-use area — never in real text), then run the regex battery, then
restore `'` at the end. The four single-quoted-body regexes simplify from
`((?:'\\'\'|[^'])*)` to `([^']*)`. Per-strategy `.replace(/'\\''/g, "'")`
post-processing calls disappear. Placeholder-restore preserves apostrophes,
so zero fidelity loss.

## Prototype (validated logic to port)

Location: `~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/`

Files (in order of interest):

1. **`parsers.py`** — the reference implementation. Contains BOTH
   `extract_current(cmd)` (byte-for-byte port of today's TS extractor, for
   comparison) and `extract_sanitized(cmd)` (the new logic to port). New
   logic is at `parsers.py:117-206`, plus `sanitize_bash_sq_escape_idioms`
   at line 103, `restore_apostrophes` at line 111.
2. **`compare_extractors.py`** — runs both against `corpus.jsonl`, buckets
   results, writes `buckets/*.jsonl` + `summary.txt`.
3. **`extract_corpus.py`** — walks `~/.claude/projects/-home-ubuntu-skynet*`
   JSONLs, extracts every Bash tool_use.input.command that matches the
   outbound classifier (URL_RE + CURL_RE + PUT_RE), dumps to `corpus.jsonl`.
4. **`REPORT.md`** — corpus validation summary.
5. **`buckets/differ_longer.jsonl`** — the 12 rescues. Biggest: tanya's
   supervisor-bug report to tiffany, 840 → 2863 chars (3.4× more).
6. **`buckets/both_null.jsonl`** — the 1 unextractable case (tiffany's
   file-backed send).
7. **`corpus.jsonl`** — 182 records, format
   `{project, session, ts, cmd}` one per line.
8. **`bounty.json`** — bounty record + timeline.

## Corpus validation results

| Bucket | Count | Pct | Meaning |
|---|---|---|---|
| identical | 169 | 92.9% | byte-for-byte same output as current |
| both_null | 1 | 0.5% | unextractable-by-design (file-backed send) |
| only_current | 0 | 0.0% | ZERO regressions |
| only_new | 0 | 0.0% | — |
| differ_longer | 12 | 6.6% | RESCUES — up to 3.4× more body preserved |
| differ_shorter | 0 | 0.0% | zero fidelity loss (apostrophes preserved) |
| differ_other | 0 | 0.0% | — |

**Corpus:** 182 outbound-relay Bash sends from every local JSONL on this box
(5 box-maintainer identities: tiffany 97, tanya 81, tina 3, tabitha 1). All
12 rescues came from `'"'"'` idiom truncation.

## Concrete port points (line-by-line map)

Target: `src/backend/claude-session/session-file-parser.ts`

**Add** (adjacent to `extractOutboundBody`, before its definition or in a
neighboring block):

```typescript
const APOS_MARKER = "";

function sanitizeBashSqEscapeIdioms(cmd: string): string {
  // Replace bash's two single-quote-escape idioms with a private-use-area
  // placeholder that regex captures can traverse. Restored to `'` post-match.
  //   '"'"'  — close-sq + "'" + open-sq  → literal '
  //   '\\''   — close-sq + \'  + open-sq  → literal '
  return cmd.replace(/'"'"'/g, APOS_MARKER).replace(/'\\''/g, APOS_MARKER);
}

function restoreApostrophes(body: string | null): string | null {
  if (body === null) return null;
  return body.replaceAll(APOS_MARKER, "'");
}
```

**Refactor** `extractOutboundBody` to:

1. First statement: `const s = sanitizeBashSqEscapeIdioms(cmd);`
2. All existing strategies run against `s` (not `cmd`).
3. Wrap every strategy's return value with `restoreApostrophes(...)`, OR
   collect the result into a local `body` variable and return
   `restoreApostrophes(body)` at the end.

**Simplify** the 4 single-quoted-body strategy regexes:

- Strategy 1 (BODY-sq) — `session-file-parser.ts:228`:
    - FROM: `/(?:^|\s)BODY='((?:'\\'\'|[^'])*)'/`
    - TO:   `/(?:^|\s)BODY='([^']*)'/`
- Strategy 3 (MSG-sq) — `session-file-parser.ts:254`:
    - FROM: `/(?:^|\s)MSG='((?:'\\'\'|[^'])*)'/`
    - TO:   `/(?:^|\s)MSG='([^']*)'/`
- Strategy 5a (TEXT/MESSAGE-sq) — `session-file-parser.ts:280`:
    - FROM: `/(?:^|\s)(?:TEXT|MESSAGE)='((?:'\\'\'|[^'])*)'/`
    - TO:   `/(?:^|\s)(?:TEXT|MESSAGE)='([^']*)'/`
- Strategy 7 (jq-arg-inline-sq) — `session-file-parser.ts:320-321`:
    - FROM: `/--arg\s+\w+\s+'((?:'\\'\'|[^'])*)'\s+'\{msgtype:/`
    - TO:   `/--arg\s+\w+\s+'([^']*)'\s+'\{msgtype:/`

**Drop** the per-strategy post-processing `.replace(/'\\''/g, "'")` calls:

- `session-file-parser.ts:230` (BODY-sq)
- `session-file-parser.ts:256` (MSG-sq)
- `session-file-parser.ts:282` (TEXT/MESSAGE-sq)
- `session-file-parser.ts:324` (jq-arg-inline-sq)

The single `restoreApostrophes(...)` wrapper handles all four.

**Leave unchanged:** Strategies 2, 4, 5b, 6 (double-quoted), 8, 9 (heredoc),
10 (inline-json). None use bash single-quote-escape idioms in their capture
region.

## Test additions

Target: `src/backend/claude-session/session-file-parser.outbound-body.test.ts`

**NELLY-SHAPE fixture** (real corpus, add to the `FIXTURES` array):

```typescript
{
  // corpus: nelly's DM to tabitha 2026-08-20, room !pCARzCxigsTfPfxsfc
  // bash '"'"' idiom for embedding ' in single-quoted BODY (produces literal ')
  name: "NELLY-SHAPE — BODY-sq with '\"'\"' apostrophe escape (bash close-sq/'/open-sq)",
  cmd: `TOK=$(jq -r .access_token ~/.claude/identities/nelly/relay.json); BASE=$(jq -r .base ~/.claude/identities/nelly/relay.json); ROOM='!wNhqmNRUNlHesCshwg:thenasty.taild9b663.ts.net'; BODY='Relaying Ashley'"'"'s reply: hi'; curl -sS -X PUT "$BASE/rooms/$ROOM/send/m.room.message/$TXID" -d "$(jq -nc --arg b "$BODY" '{msgtype:"m.text", body:$b}')"`,
  expectedBody: "Relaying Ashley's reply: hi",
},
```

**KNOWN-LIMITATION test** for the self-referential heredoc-content-bleed (add
in a NEW `describe` block, not in FIXTURES — this test documents behavior,
not correctness):

```typescript
describe("extractOutboundBody — known limitations", () => {
  it("SELF-REFERENTIAL: BODY='...' substring inside heredoc content still gets matched by BODY-sq before heredoc-inline (documented, not fixed by Phase 49)", () => {
    // The BODY='...' inside the heredoc's CONTENT gets matched by Strategy 1
    // before heredoc-inline (Strategy 9) fires. Sanitize pass doesn't address
    // this — it's a shell-quoting-context bug, not a bash-escape-idiom bug.
    // If a future phase addresses this (heredoc-first reorder, mask heredoc
    // contents from earlier regexes, shell-aware parser), this test flips
    // from documentation to regression guard.
    const cmd = `BODY=$(cat <<'EOF'
Hey — the extractor's BODY='relaying Ashley' bug matched inside my heredoc content instead of the real body.
EOF
)
curl -sS -X PUT "$BASE/rooms/$ROOM/send/m.room.message/$TXID" \\
  -d "$(jq -nc --arg b "$BODY" '{msgtype:"m.text", body:$b}')"`;
    // Current behavior: BODY-sq matches the inner substring, returns 'relaying Ashley'.
    expect(extractOutboundBody(cmd)).toBe("relaying Ashley");
  });
});
```

**PRIORITY-REGRESSION test** at line 361 — MUST continue to pass unchanged.
The sanitize pass doesn't affect tiffany's fixture (her BODY='@tina got …'
doesn't contain any single-quote-escape idiom in the captured region).

## Ship path (orchestrator, not executor)

Per box-maintainer role file directive "executors don't do deploys — the
orchestrator does": the plan's remit STOPS at code committed + tests green.
The deploy motion (coord BEFORE + docker build + force-recreate +
HTTPS 200 verify + byte-verify + coord AFTER + git push + patch entry in
`skynet-patches.md`) is orchestrator-only, not in any plan task.

Deploy vehicle: full docker build + force-recreate (backend TypeScript change,
node process must reload — fast-path `docker cp` covers only frontend
`/app/html/`, not `/app/backend/`). Reference:
`~/.claude/roles/box-maintainer/deploy-runbook.md`.

## Nothing else needs research

- **Consumer (RelayOutboundBubble):** already correctly renders `body !== null`
  branch; no change needed.
- **Wire type (RelayOutboundEvent):** unchanged (`body: string | null`).
- **Classifier (detectRelayOutbound):** unchanged.
- **Coverage of unextractable-by-design 3.6% tail:** out of scope.
- **Self-referential heredoc-content-bleed:** documented, deferred per Ashley
  (see CONTEXT.md § Deferred Ideas).
