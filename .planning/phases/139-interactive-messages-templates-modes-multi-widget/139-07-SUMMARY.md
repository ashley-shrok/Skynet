---
phase: 138-interactive-messages-templates-modes-multi-widget
plan: "07"
subsystem: interactive-messages
tags: [interactive-messages, skill-doc, integration-test, widgets, phase-139]
dependency_graph:
  requires: [139-01, 139-02, 139-03, 139-04, 139-05, 139-06]
  provides: [agent-facing-six-template-reference, integrated-scaffold-test]
  affects: [substrate/skills/interactive-messages]
tech_stack:
  added: []
  patterns: [bash-test-harness, substrate-skill-doc]
key_files:
  created:
    - substrate/skills/interactive-messages/tests/all-templates-scaffold.test.sh
  modified:
    - substrate/skills/interactive-messages/SKILL.md
    - substrate/skills/interactive-messages/tests/run-all.sh
decisions:
  - "Used find instead of quoted glob for cross-cutting unit-file count — quoted path+glob does not expand in bash"
  - "Used postMessage.*\"*\" pattern for wildcard origin check to avoid false-positive match on comment text 'never \"*\"'"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-27"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 139 Plan 07: Skill doc + integrated scaffold test Summary

SKILL.md rewritten for all six templates with mode assignments, CLI shapes, state.json shapes, affordance rules, and worked examples; integrated scaffold test proves all six templates coexist in one HOME with distinct ports, slugs, and arc-wide invariants satisfied.

---

## What was built

### Task 1: SKILL.md rewritten for six-template menu

Replaced the Phase 137 poll-only SKILL.md with a comprehensive six-template reference. Structure:

1. **Overview** — earns-its-interactivity principle restated, all six template slugs named
2. **Template menu** — table with mode, reach-for-it-when, and terminal act for all six
3. **CLI dispatch** — both invocation forms (flag-based canonical + positional back-compat)
4. **Per-template reference** — one H3 per template: poll, checklist, form, ranking, list-actions, color-picker. Each section includes CLI shape, state.json shape, affordance rule, do-not-use-when guidance, and a worked example with stdout and sample state.json
5. **Shared reading pattern** — how to read state.json after waking
6. **Buttons vs passive selectors** — restates the affordance split for terminal-on-click vs terminal-on-submit
7. **Phase 139 limits** — explicitly names: no non-terminal modes (Phase 139), no multi-widget (Phase 139), no teardown (Phase 140), no backstop (Phase 140), no custom widgets (Phase 141)
8. **What would make this wrong** — four Phase 137 invariants preserved plus fifth: mode is fixed per template in Phase 139

State.json shapes documented for all six templates match what each Wave 2 widget.html POSTs:
- `poll`: `{template, choice, submitted_at}`
- `checklist`: `{template, checked[], submitted_at}`
- `form`: `{template, fields{}, submitted_at}`
- `ranking`: `{template, order[], submitted_at}`
- `list-actions`: `{template, rows[{item,action}], submitted_at}`
- `color-picker`: `{template, color, submitted_at}`

**Metrics:** 589 lines (within 200–800 range). All 18 acceptance criteria grep checks pass.

### Task 2: Integrated all-templates scaffold test + run-all.sh update

Created `tests/all-templates-scaffold.test.sh` — the Phase 139 integrated end-to-end test. Scaffolds one instance of every template in a shared temp HOME (SKIP_SYSTEMCTL=1), then asserts per-template and cross-cutting invariants.

**Per-template assertions (×6):**
- Exit 0
- widget.html, server.py, metadata.json exist
- metadata.json discriminator matches template name
- systemd unit file exists with port in 9601-9699
- server.py forces template discriminator (`data["template"] = "<name>"`)

**Cross-cutting assertions:**
- Exactly 6 distinct systemd unit files
- 6 distinct ports claimed (9601–9606 sequential in this run)
- All ports in 9601-9699 range
- 6 distinct widget folders (slug isolation confirmed)
- Zero `type="radio"` across all six widget.html files (arc-wide affordance invariant)
- No `postMessage` wildcard origin (`"*"`) in any widget.html
- All 6 widget.html files use `window.location.origin` in postMessage

Updated `run-all.sh` to explicitly invoke `all-templates-scaffold.test.sh` after the glob-discovered per-template tests, with a comment distinguishing the three test tiers (base, per-template, integrated).

**Results:** 55 assertions pass in the integrated test. Full suite: 7/7 test files pass.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Quoted glob does not expand in bash for cross-cutting unit file count**
- **Found during:** Task 2 — first test run showed 0 unit files in cross-cutting check despite per-template checks passing
- **Issue:** `ls "$SHARED_HOME/.config/systemd/user/im-*.service"` — when the glob is inside double-quotes with a variable prefix, bash does not expand it. Per-template checks used explicit `$UNIT_POLL` variables set to concrete paths (no glob), which is why they passed.
- **Fix:** Replaced `ls "$VAR/path/im-*.service" | wc -l` with `find "$VAR/path" -name "im-*.service" | wc -l` for the cross-cutting unit file count. Also replaced `ls -d "$VAR/"*/` with `find "$VAR" -mindepth 1 -maxdepth 1 -type d` for the widget folder count.
- **Files modified:** `tests/all-templates-scaffold.test.sh`
- **Commit:** included in 16defd5e

**2. [Rule 1 - Bug] grep '"[*]"' matched comment text, not postMessage wildcard**
- **Found during:** Task 2 — cross-cutting check for wildcard origin failed (6 matches) despite all widget.html files containing `// never "*"` in a comment
- **Issue:** Poll template widget.html contains the comment `// Target window.location.origin explicitly — never "*".` which includes the literal `"*"`. The grep pattern `'"[*]"'` matched this comment text, producing 6 false positives.
- **Fix:** Changed grep pattern to `'postMessage.*"\*"'` — requires the `"*"` to appear after `postMessage` on the same line, which excludes comment-only lines.
- **Files modified:** `tests/all-templates-scaffold.test.sh`
- **Commit:** included in 16defd5e

---

## Known Stubs

None. SKILL.md is a documentation file with no data stubs. The test file scaffolds real widgets with real template invocations.

---

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. SKILL.md is static text; the test file runs in an isolated temp HOME and cleans up on exit.

---

## Self-Check

File existence:
- `substrate/skills/interactive-messages/SKILL.md` — FOUND
- `substrate/skills/interactive-messages/tests/all-templates-scaffold.test.sh` — FOUND
- `substrate/skills/interactive-messages/tests/run-all.sh` — FOUND (modified)

Commits:
- `592fc500` — docs(139-07): rewrite SKILL.md for full six-template menu — FOUND
- `16defd5e` — test(139-07): add integrated all-templates scaffold test + update run-all.sh — FOUND

## Self-Check: PASSED
