#!/usr/bin/env bash
# Phase 05 / Plan 05-01 regression guard.
#
# The `case "input":` block in src/backend/ssh/terminal.ts is byte-critical:
# patch #60 (atomic delete-on-send via messageQueueItemId) and patch #100
# (split-and-delay Enter for pretty-view submits) both live there and any
# whitespace/reorder change risks re-introducing dropped-Enter bugs or
# ghost queue rows.
#
# This script extracts the block via awk pattern-match on the `case
# "input": {` opener up to the following `case "ping":` opener, then
# diffs against a checked-in sha256 pinned when Plan 05-01 wired the
# three new upload_* cases alongside without touching the input case.
#
# If this script fails, either:
#   (a) You intentionally changed the input case — update EXPECTED_SHA256
#       below AND re-verify the split-Enter + delete-on-send behaviour
#       manually (there's no unit test for them; only integration on a
#       live pane exercises the path).
#   (b) You didn't mean to — revert your input-case changes.
#
# See .planning/phases/05-pretty-view-file-upload-support/05-01-PLAN.md
# threat T-05-08 and the "existing case "input": untouched" acceptance
# criterion.
set -euo pipefail

TARGET="${1:-src/backend/ssh/terminal.ts}"
EXPECTED_SHA256="d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709"

if [ ! -f "$TARGET" ]; then
  echo "verify-input-case-unchanged: $TARGET not found" >&2
  exit 2
fi

# Extract from `case "input": {` through its closing `      }` at the
# same 6-space indentation (the `case "input":` block is wrapped in
# braces to declare block-scoped locals, so the closing `      }`
# uniquely terminates it — the following case block starts with either
# a blank line, a comment, or another `case "..."`.
#
# awk pattern-match on line content so refactors elsewhere in the file
# don't spuriously fail this check.
BLOCK="$(awk '
  /^      case "input": \{$/ { in_block=1; print; next }
  in_block && /^      \}$/    { print; exit }
  in_block                    { print }
' "$TARGET")"

if [ -z "$BLOCK" ]; then
  echo "verify-input-case-unchanged: could not extract input case from $TARGET" >&2
  exit 3
fi

ACTUAL_SHA256="$(printf '%s\n' "$BLOCK" | sha256sum | awk '{print $1}')"

if [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ]; then
  echo "verify-input-case-unchanged: OK (sha256=$ACTUAL_SHA256)"
  exit 0
fi

echo "verify-input-case-unchanged: FAIL" >&2
echo "  expected: $EXPECTED_SHA256" >&2
echo "  actual:   $ACTUAL_SHA256" >&2
echo "" >&2
echo "The 'case \"input\":' block in $TARGET changed. Patches #60 (atomic" >&2
echo "delete-on-send) and #100 (split-and-delay Enter) live there and are" >&2
echo "byte-critical. If the change is intentional, update EXPECTED_SHA256" >&2
echo "in scripts/verify-input-case-unchanged.sh AND re-verify split-Enter" >&2
echo "+ delete-on-send behaviour manually on a live pane." >&2
exit 1
