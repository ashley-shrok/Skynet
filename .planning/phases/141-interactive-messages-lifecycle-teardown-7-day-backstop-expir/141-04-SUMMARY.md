---
phase: 140-interactive-messages-lifecycle-teardown-7-day-backstop-expir
plan: "04"
subsystem: interactive-messages/skill-docs
tags: [interactive-messages, skill, docs, lifecycle, teardown, backstop]

dependency_graph:
  requires:
    - substrate/skills/interactive-messages/teardown-widget.sh  # Plan 01
    - substrate/scripts/interactive-messages-gc.py              # Plan 03
  provides:
    - substrate/skills/interactive-messages/SKILL.md (Lifecycle section + Phase 141 limits)
  affects: []

tech_stack:
  added: []
  patterns:
    - Surgical SKILL.md edit: new section inserted between existing sections, no template blocks touched

key_files:
  created: []
  modified:
    - substrate/skills/interactive-messages/SKILL.md

decisions:
  - teardown-widget.sh documented with both positional (Form A) and flag (--slug) (Form B) invocation shapes, matching actual CLI
  - --force flag documented as defensive-cleanup-only, with explicit "do NOT in normal use" guidance
  - Seven-day backstop paragraph names the consequence (URL fails → expired-placeholder) and explicitly links to Phase 141 expired-placeholder UI
  - Recovery guidance for broken-widget user reports is a dedicated named paragraph, not buried in caveats
  - Phase 141 limits section retains port-range constraint with updated teardown-aware guidance; removes now-shipped teardown/backstop/expired-placeholder items

metrics:
  duration: "59s"
  completed: "2026-09-27T23:09:43Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 1
---

# Phase 141 Plan 04: SKILL.md Lifecycle section + Phase 141 limits Summary

One-line: Surgical SKILL.md addition of a Lifecycle section (teardown-widget.sh CLI, seven-day backstop rule, reconstruction guidance) and replacement of Phase 139 limits with Phase 141 limits naming only Phase 141 deferrals.

## What Was Built

Two surgical edits to `substrate/skills/interactive-messages/SKILL.md`. No template reference blocks were touched; all six per-template `### <template>` headings and their "Do NOT use it when" bullets are byte-identical to the pre-edit state.

### Edit 1: New `## Lifecycle` section

Inserted between the `## Multi-widget per message` section and the `## Shared reading pattern` section. Contains:

**Agent-driven teardown (primary):** Documents `teardown-widget.sh` with both invocation forms (positional `<slug>` and `--slug <slug>` flag), the five atomic steps the script performs, the machine-readable stdout (`TORN_DOWN=<slug>`), "When to invoke" (terminal-mode: after reading state; non-terminal: when collaboration cycle is complete), "When NOT to invoke" (mid-collaboration; before reading state), and the `--force` flag semantics (defensive cleanup only, not for normal use).

**Seven-day backstop (safety net):** Names `interactive-messages-gc.timer` as the daily sweep mechanism, states the 7-day threshold explicitly, explains the consequence (systemd unit + port + state.json removed; expired-placeholder UI renders in the chat bubble instead of a broken iframe), and provides recovery guidance: when a user reports a broken or expired widget, recognize it as likely seven-day expiration, do NOT troubleshoot the widget, and **reconstruct the widget on the next reply** using `create-widget.sh` with the same configuration.

### Edit 2: `## Phase 139 limits` → `## Phase 141 limits`

The old section listed teardown, backstop, and expired-placeholder as deferred to Phase 141. All three shipped in Phase 141 (Plans 01, 02, 03). The new section carries forward only what actually remains deferred:

- No custom widget authoring guidance (Phase 141)
- No comprehensive mobile audit (Phase 141)
- Port range (updated: names teardown-widget.sh and the daily backstop as the remediation path, replacing the Phase 139 "delete manually" guidance)

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All automated checks passed post-commit:

| Check | Result |
|-------|--------|
| `grep -q '^## Lifecycle$'` | PASS |
| `grep -q '^## Phase 141 limits$'` | PASS |
| `! grep -q '^## Phase 139 limits$'` | PASS |
| `grep -c 'teardown-widget.sh'` = 4 (≥ 3) | PASS |
| `grep -qE 'seven[- ]day\|7[- ]day'` | PASS |
| `grep -q 'reconstruct the widget'` | PASS |
| `grep -c '^### \`'` = 6 (6 per-template headings preserved) | PASS |
| `grep -ci 'do not use it when'` = 6 (all 6 template blocks intact) | PASS |
| Line count: 751 (was 664; net +87, within 80–120 expected range) | PASS |
| Unexpected file deletions | None |

## Known Stubs

None.

## Threat Flags

None — SKILL.md is a distributor-shipped doc file; no new network endpoints, auth paths, or trust boundary crossings introduced.

## Self-Check: PASSED

- `substrate/skills/interactive-messages/SKILL.md` modified: CONFIRMED
- Commit 5b12505f (docs(141-04)): CONFIRMED
- `## Lifecycle` heading present: CONFIRMED
- `## Phase 141 limits` heading present: CONFIRMED
- `## Phase 139 limits` heading absent: CONFIRMED
- `teardown-widget.sh` mentioned 4 times (≥ 3): CONFIRMED
- `reconstruct the widget` present: CONFIRMED
- All 6 per-template `### \`` headings preserved: CONFIRMED
