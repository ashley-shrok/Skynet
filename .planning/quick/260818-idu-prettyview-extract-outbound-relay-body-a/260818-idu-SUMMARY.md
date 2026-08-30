---
phase: quick-260818-idu-prettyview-extract-outbound-relay-body
plan: "01"
subsystem: pretty-view / relay-bubbles / session-parser
tags:
  - relay
  - outbound-bubble
  - session-parser
  - extraction
  - body-preview
dependency_graph:
  requires:
    - RELAYBUB-01 (phase 17: relay_outbound wire type + bubble scaffold)
    - RELAYBUB-02 (phase 17: relay_inbound wire type)
  provides:
    - extractOutboundBody (7-strategy FIRST-MATCH-WINS extractor)
    - RelayOutboundMessage.body (string | null on backend wire type)
    - RelayOutboundEvent.body (string | null on frontend wire type)
    - RelayOutboundBubble body-preview + expand/collapse toggle
  affects:
    - claude-session-server.ts (relay_outbound WS frame)
    - PrettyView.tsx (RelayOutboundBubble caller)
tech_stack:
  added: []
  patterns:
    - FIRST-MATCH-WINS priority extraction (9 strategies via regex cascade)
    - TDD RED→GREEN per-task commit discipline (2 commits per TDD task)
key_files:
  created:
    - src/backend/claude-session/session-file-parser.outbound-body.test.ts
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/RelayOutboundBubble.tsx
    - src/ui/features/pretty-view/RelayOutboundBubble.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.autoplay.test.tsx
    - src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx
decisions:
  - "FIRST-MATCH-WINS strategy order: BODY-sq → BODY-dq → MSG-sq → MSG-dq →
    TEXT/MESSAGE variants → jq-arg-inline-dq → jq-arg-inline-sq →
    heredoc-to-file → heredoc-inline → inline-json; priority confirmed by
    PRIORITY-REGRESSION fixture."
  - "null body = fallback path: RelayOutboundBubble renders rawCommand always-
    visible (byte-for-byte matches July Option D behavior) — ~3.6% of fleet sends."
  - "Toggle state component-local (useState), default collapsed when body present;
    no lift to store per spec."
  - "heredoc-to-file before heredoc-inline: more specific pattern (cat > file)
    must fire before generic (cat <<EOF piped)."
metrics:
  duration: "approx 45 minutes"
  completed: "2026-08-18"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 8
---

# Phase quick-260818-idu Plan 01: extractOutboundBody + RelayOutboundBubble Preview Summary

**One-liner:** 7-strategy shell/heredoc/inline-json body extractor (96.4% corpus coverage) wired through RelayOutboundMessage → WS frame → RelayOutboundBubble with default-collapsed expand-to-see-raw toggle.

## What Was Built

Realised the deferred July 2026-07-28 follow-up bounty `pretty-view-outgoing-relay-render`.
The PATTERNS.md survey of 530 real fleet sends proved the July "extraction unreliable"
premise wrong — 7 named regex strategies cover 511/530 = 96.4% of corpus records.

### Task 1: extractOutboundBody + corpus fixture tests (RED→GREEN)

**Commits:**
- `2b331f39` — `test(quick-260818-idu-01)`: 15-fixture RED test file (all fail with "not a function")
- `8628b72c` — `feat(quick-260818-idu-01)`: GREEN implementation, all 15 pass

**Key implementation details:**

`extractOutboundBody(cmd: string): string | null` in `session-file-parser.ts` implements
9 strategies in FIRST-MATCH-WINS priority:

1. `BODY-sq` — `BODY='...'` with `'\''` shell-escape decoded
2. `BODY-dq` — `BODY="..."` with backslash decoded
3. `MSG-sq` — `MSG='...'` (symmetric)
4. `MSG-dq` — `MSG="..."` (symmetric)
5. `TEXT/MESSAGE-sq/dq` — same forms for TEXT= and MESSAGE=
6. `jq-arg-inline-dq` — `--arg <word> "literal" '{msgtype:` (trailing filter required to disambiguate)
7. `jq-arg-inline-sq` — `--arg <word> 'literal' '{msgtype:`
8. `heredoc-to-file` — `cat > <path> <<'EOF' ... EOF`
9. `heredoc-inline` — `cat <<'EOF' ... EOF` (without file redirect; also matches `BODY=$(cat <<'EOF' ... EOF)`)
10. `inline-json` — `-d '{"msgtype":"m.text","body":"..."}' with JSON.parse

Each match logs at `.debug` via `sessionParserLogger` (strategy name + bodyLen). Not on wire.

**Corpus fixture coverage:**
- 13 real corpus fixtures from `/tmp/relay-outbound-raw.jsonl` (verbatim `cmd` fields)
- 1 synthetic PRIORITY-REGRESSION composite (explicitly commented in test file)
- 2 null-expected fixtures (UNEXTRACTABLE-cross-turn, UNEXTRACTABLE-python)

**Type changes in `session-file-parser.ts`:**
- `RelayOutboundMessage` → added `body: string | null`
- `detectRelayOutbound` return type → added `body: string | null`; calls `extractOutboundBody(cmd)` at return site
- `parseSessionLine` relay_outbound case → forwards `body: outbound.body`
- July Option D comment block at L77-85 + L146-168 → updated with reversal note citing `pretty-view-outgoing-relay-render`

### Task 2: WS frame emit + frontend wire type (commit `7daf5a32`)

- `claude-session-server.ts` L2447: `body: parsed.body` added to `relay_outbound` JSON frame
- `claude-session-api.ts` L160-166: `RelayOutboundEvent` extended with `body: string | null` field + doc comment
- `claude-session-api.ts` L146-158: doc block updated — body is now preferred read path; rawCommand is always-preserved faithful record
- `PrettyView.autoplay.test.tsx` + `PrettyView.estimateSize.test.tsx`: added `body: null` to relay_outbound test frame literals (TS compiler requires new field)

### Task 3: RelayOutboundBubble render (commit `d1022c30`)

- `RelayOutboundBubble.tsx`: extended `RelayOutboundBubbleProps` to `Pick<RelayOutboundEvent, "room" | "rawCommand" | "body">` + `ts?: number`
- Two-branch conditional render:
  - **body !== null** (96.4% of fleet): pretty `<div className="whitespace-pre-wrap">{body}</div>` above default-collapsed `▸ raw command` toggle; toggle click expands `<pre>` mono block
  - **body === null** (3.6% tail): always-visible `<pre>` mono block (byte-for-byte matches July Option D behavior)
- `▸ relay send → {room}` header and `via curl` footer both preserved in both branches
- Toggle state: `useState(false)` component-local, default collapsed when body present
- Security (T-17-03-01): `{body}` and `{rawCommand}` are React text children, never `dangerouslySetInnerHTML`
- `PrettyView.tsx` caller updated: `body={m.body}` added
- `RelayOutboundBubble.test.tsx`: all 4 tests updated to pass `body={null}` (fallback branch preserves existing behavior)

## Deviations from Plan

None — plan executed exactly as written.

The one fixture design decision worth noting: the corpus line 188 (tiffany, 2026-08-11T19:33:30.925Z)
contains BOTH a `python3 <<'PY'` block AND a subsequent `BODY='...'` var-assign. Rather than
asserting `body === null` for this fixture (it would have been wrong — BODY-sq IS extractable),
I replaced the "UNEXTRACTABLE-python" slot with a truncated synthetic that tests the pure-python3
case (a command whose only send path is inside the PY heredoc with no shell-var body in the same
command). This is technically a deviation from the plan's fixture sourcing for the python case, but
is the correct behavior — the plan's stated intent was "python3 heredoc send with no extractable
shell var," and the test asserts exactly that. The corpus line 188 as-is has an extractable BODY-sq
after the PY block, which the extractor correctly returns (covered by the BODY-sq-after-python fixture).

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. The extraction runs
server-side on already-in-session-file command strings; the result is a text string passed
through the existing WS relay path. `body` field on the wire is a null-safe passthrough of
existing command content already disclosed by `rawCommand` (accepted T-17-01-02).

## Self-Check

- `src/backend/claude-session/session-file-parser.outbound-body.test.ts` — FOUND
- `src/backend/claude-session/session-file-parser.ts` — FOUND, contains `extractOutboundBody`
- `src/backend/claude-session/claude-session-server.ts` — FOUND, contains `body: parsed.body`
- `src/ui/api/claude-session-api.ts` — FOUND, contains `body: string | null`
- `src/ui/features/pretty-view/RelayOutboundBubble.tsx` — FOUND, contains `body` prop
- Commits: `2b331f39` (RED), `8628b72c` (GREEN), `7daf5a32` (Task 2), `d1022c30` (Task 3) — all present in git log
- `npx vitest run` — 2444 tests passed, 9 skipped, 0 failed (192 test files)
- `npm run build:backend` — exit 0
- `npm run build` — exit 0

## Self-Check: PASSED
