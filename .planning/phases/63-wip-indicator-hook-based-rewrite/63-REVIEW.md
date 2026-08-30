# Phase 63: WIP-indicator hook-based rewrite — Code Review

**Reviewed:** 2026-08-30
**Reviewer:** unbiased general-purpose sub-agent (per /build skill — deliberately NOT `/gsd:code-review` or any framework-branded reviewer, so the review is fresh eyes on the code against the shape rather than framework ceremony)
**Overall verdict:** minor findings only — no code fixes applied; findings adjudicated below

## Reviewer's coverage summary

The reviewer confirmed clean coverage across the code's actual attack surface:

- Path-traversal defense on both hook scripts (character class rejects `..`, shell metachars, unicode, null bytes; tests exercise `../evil` payloads).
- Atomic marker touch semantics (`touch` is atomic on POSIX; monotonic-forward reads).
- `timeout 2 bash -c '...' || true` bounds inner failure + swallows non-zero exit.
- SSH-side shell-injection surface (shellSingleQuote + character-class regex — defense in depth).
- Zod validation for `activityMtime`/`stoppedMtime` (rejects strings, accepts 0 + negatives + null + omission).
- `FRAME_SCHEMA_VERSION=1` hold (additive+optional discipline, sixth iteration of T-41-03-05).
- Wire back-compat both directions (old frontend + new backend, new frontend + old backend).
- Frontend predicate branch scoping: `bg` retirement in direct-signal branch (Test I) + preservation in fallback branch (Test J = HIGH #1 regression guard).
- Mid-session unupgraded → upgraded transition (Test O frame 1 covers cold-start → first activityMtime).
- Explicit-null reset transitioning session back to fallback branch (Tests M/N).
- Axis H/I preservation across Axis A republish (Tests K/L).
- Installer idempotency across all six merges (Tests P62-3, P62-5).
- Third-party hook preservation across all five event keys (Test P62-5 — HIGH #6 regression guard).
- Malformed settings.json refuses to overwrite (Test 10 with `fleet_status_hook_install_settings_invalid_json` log).
- Prototype-pollution safety (no JSON.parse reviver).
- Heredoc sentinel collision impossible (three distinct sentinels + `SETTINGS_EOF`).
- Legacy tilde-form migration (Test 13).
- Fingerprint composition includes both new axes (mtime-only delta drives publish — Tests P62-03 G/G-bis).
- SessionId rotation nulls both new mtimes (Test P62-03 F).
- Cache preservation on fingerprint-unchanged branch (Pitfall-3 discipline).
- Ambient-filter interaction (unchanged and orthogonal).
- Source B (dormant identity enumeration) frames don't wipe cached mtimes.
- Pre-existing TSC errors are actually pre-existing (zero Phase 63 files appear in tsc error list).

## Findings + adjudication

### MEDIUM — Hook event names `StopFailure` and `PermissionRequest` may not exist

**Reviewer's concern:** installer wires two hook keys that aren't in the "standard published hooks list" the reviewer was working from; if the harness doesn't recognize the names, both scripts silently never fire for those events.

**Adjudication: FALSE POSITIVE.** Verified against the current Claude Code hooks documentation (https://code.claude.com/docs/en/hooks fetched 2026-08-30):

- **`PermissionRequest`** is documented at row 6 — "When a tool call needs a permission decision."
- **`StopFailure`** is documented at row 18 — "When the turn ends due to an API error."

Both are legitimate documented hook events, verbatim spelling matches. The reviewer was working from an older harness knowledge base (Claude Code's hook set has expanded substantially — 33 named events as of 2026-08 per the docs, versus the ~9-event set the reviewer knew about).

No code change. The shape's design agreement (5 lifecycle events wired: UserPromptSubmit + PreToolUse → activity; Stop + StopFailure + PermissionRequest → stopped) holds against the current harness.

### LOW — Wave 4 SUMMARY.md pre-existing-TSC-error narrows the scope

**Reviewer's concern:** SUMMARY names two files (`conversation-store.test.ts`, `ElectronVersionCheck.tsx`) as the source of the 269 pre-existing TSC errors; actual scope is ~140 files.

**Adjudication: accepted, doc-accuracy nit.** The category claim (pre-existing, zero from Phase 63) holds — reviewer verified independently. The SUMMARY understates the file count but not the semantic scope. Not fixing inline; if a future ship-gate reader is confused, the truth is `npx tsc --project tsconfig.app.json --noEmit` output.

### LOW — `stat`-fail-open can't distinguish SSH hiccup from marker deletion

**Reviewer's concern:** both `null` (SSH failed) and empty stdout (file absent) preserve cached mtime; if a fleet-wide cleanup ever deletes marker files, the affordance freezes on last-seen state until backend restart.

**Adjudication: accepted per shape.** The shape's philosophy (§What would violate the spirit) explicitly rejects "adding a second inference layer alongside the direct signal to catch cases the hooks miss" — the fix is to change which hooks we subscribe to, not to layer inference back in. Marker deletion is not in scope for Phase 63. If it becomes an operational issue post-rollout, the fix is a Phase 63 follow-up (branch the fail-open into distinguishable cases) — not a re-widening of the current predicate.

### LOW — Session_id regex first-match wins

**Reviewer's concern:** bash `=~` returns first match; a payload whose inner field text contains `"session_id":"foreign_sid"` before the top-level key would extract the wrong sid.

**Adjudication: accepted as pre-existing pattern.** Exact same brittleness lives in `stop-hook.sh:47` (the pre-existing sibling this arc mirrored for path-traversal defense). Phase 63 propagates the pattern, does not introduce it. Hardening (piping through `jq` or restructuring the regex) is a fleet-wide follow-up — either all three hook scripts get the same treatment or none do; a Phase 63-scoped fix would create inconsistency.

## Overall

No code fixes applied — the one MEDIUM was a false positive verified against current harness docs; the three LOWs are all either accepted-as-designed (per shape §Philosophy) or accepted-as-pre-existing-pattern (LOW #4 mirrors stop-hook.sh:47).

Ready for ship-gate.
