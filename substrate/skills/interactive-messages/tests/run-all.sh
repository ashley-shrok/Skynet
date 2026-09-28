#!/usr/bin/env bash
# run-all.sh — runs the base test harness plus every per-template test file.
#
# Three tiers of tests:
#   Tier 1: create-widget.test.sh — base dispatcher harness
#   Tier 2: create-widget-<template>[-(non-terminal)].test.sh — per-template
#            tests (terminal and non-terminal variants, auto-discovered via glob)
#   Tier 3: all-templates-scaffold.test.sh (Phase 138 integrated test) and
#            all-templates-non-terminal-scaffold.test.sh (Phase 139 integrated
#            test) — each scaffolds all six template variants in a shared temp
#            HOME and asserts cross-cutting invariants.
#
# Adding a new template does NOT require editing this file — tier 2 globs
# create-widget-*.test.sh automatically.
#
# Invoke with: `bash substrate/skills/interactive-messages/tests/run-all.sh`
#
# Exit 0 if all test files pass; exit 1 if any fail.
# Accumulates failures across all files (does NOT abort on first failure).

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

PASS=0
FAIL=0
FAIL_FILES=""

run_file() {
    local f="$1"
    local name
    name=$(basename "$f")
    printf '\n=== Running: %s ===\n' "$name"
    if bash "$f"; then
        PASS=$((PASS + 1))
        printf '  [PASS] %s\n' "$name"
    else
        FAIL=$((FAIL + 1))
        FAIL_FILES="$FAIL_FILES $name"
        printf '  [FAIL] %s\n' "$name"
    fi
}

# Run the base create-widget test harness
run_file "$SCRIPT_DIR/create-widget.test.sh"

# Discover and run all per-template test files.
# The glob matches 0 files in Wave 1 (that is normal — not an error).
# Wave 2 template plans each add tests/create-widget-<template>.test.sh.
shopt -s nullglob
per_template_files=("$SCRIPT_DIR"/create-widget-*.test.sh)
shopt -u nullglob

for f in "${per_template_files[@]}"; do
    run_file "$f"
done

# Run the integrated all-templates scaffold test (Phase 138).
# Named explicitly — not globbed — because it uses a different naming convention
# (all-templates-scaffold.test.sh, not create-widget-*.test.sh).
run_file "$SCRIPT_DIR/all-templates-scaffold.test.sh"

# Run the integrated all-templates non-terminal scaffold test (Phase 139).
# Scaffolds one of each non-terminal template in a shared temp HOME and asserts
# arc-wide non-terminal invariants (zero postMessage, /update present, /submit
# absent, updated_at present, submitted_at absent, no submit-btn markers, all
# six metadata.json files marked mode=non-terminal).
run_file "$SCRIPT_DIR/all-templates-non-terminal-scaffold.test.sh"

# Run the mobile-friendliness audit (Phase 141). Grep-audits every template
# widget.html for viewport meta, ≥44px touch targets, no overflow-x hacks,
# postMessage-origin discipline, and no streaming/polling markers.
run_file "$SCRIPT_DIR/mobile-audit.test.sh"

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
printf '\n=================================================\n'
printf 'run-all.sh: %d/%d test files passed\n' "$PASS" "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
    printf 'FAIL: %d, FAILURES:%s\n' "$FAIL" "$FAIL_FILES"
    exit 1
fi

printf 'All test files passed.\n'
exit 0
