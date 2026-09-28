---
phase: 139-interactive-messages-non-terminal-mode-variants-multi-widget
verified: 2026-09-27T22:35:00Z
status: passed
score: 9/9
overrides_applied: 0
---

# Phase 140: Interactive messages — non-terminal mode variants + multi-widget per message

**Phase Goal:** Add non-terminal mode variants for every template (6 templates → 6 new `<template>-non-terminal/` dirs). Non-terminal mode = widget contributes to a text reply that hasn't happened yet; state persists on every interaction; NO submit signal fires; agent reads state on demand. `create-widget.sh --mode <mode>` extension. Multi-widget per message support (frontend verification). SKILL.md updates.
**Verified:** 2026-09-27T22:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `create-widget.sh --mode` dispatches to `templates/<template>-<mode>/` | VERIFIED | `grep` confirms `TEMPLATE_DIR="$SCRIPT_DIR/templates/$TEMPLATE-$MODE"` at line 254; no glob remaining; syntax clean |
| 2 | Default-mode fallback preserves Phase 138 back-compat | VERIFIED | `default_mode_for_template()` function present; `run-all.sh` 14/14 passes including all Phase 138 per-template tests |
| 3 | Unsupported combos rejected with clear error before filesystem mutation | VERIFIED | `is_supported_combo()` checked before port claim; test cases 13-15 pass in base harness |
| 4 | All 6 non-terminal template dirs exist with 5 required files each | VERIFIED | `ls templates/` shows all 12 dirs (6 terminal + 6 non-terminal); each non-terminal dir has widget.html, server.py, args.sh, im-SLUG.service.template, metadata.json.template |
| 5 | Zero `postMessage` / `window.parent` in all non-terminal widget.html files | VERIFIED | Grep across all 6 non-terminal widget.html files returns zero matches |
| 6 | All non-terminal server.py have `/update` endpoint and NO `/submit` endpoint | VERIFIED | Each server.py has 4-5 `/update` hits and 0 `/submit` hits; confirmed via grep |
| 7 | Multi-widget frontend tests present and passing | VERIFIED | `ChatMessage.multi-widget.test.tsx` (5 tests) and `WidgetBubble.multi-mount.test.tsx` (4 tests) exist; `npx vitest run` reports 9/9 passed |
| 8 | SKILL.md rewritten with three-mode taxonomy + non-terminal + multi-widget sections | VERIFIED | SKILL.md 663 lines; `## Non-terminal mode` at line 500, `## Multi-widget per message` at line 535, `## Phase 140 limits` at line 611; Modes column in template menu; `--mode` global flag documented |
| 9 | `all-templates-non-terminal-scaffold.test.sh` scaffolds all 6 non-terminal variants and passes 60 assertions | VERIFIED | Test file exists; `bash tests/run-all.sh` reports 14/14 pass (60/60 assertions in non-terminal scaffold test) |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `substrate/skills/interactive-messages/create-widget.sh` | `--mode` arg + default-mode map + combo enforcement | VERIFIED | Lines 131/153: `--mode` arg; line 191: `default_mode_for_template()`; line 201: `is_supported_combo()`; line 254: explicit path resolution |
| `substrate/skills/interactive-messages/tests/create-widget.test.sh` | `--mode` dispatch + rejection cases | VERIFIED | Contains `--mode` in 6+ test cases; tests 10-15 present |
| `templates/poll-non-terminal/` (5 files) | Radio selectors, /update, no postMessage | VERIFIED | All 5 files exist; zero postMessage; /update present (5 hits); updated_at present |
| `templates/checklist-non-terminal/` (5 files) | Live-persist checkboxes, rejects `--submit-label` | VERIFIED | All 5 files exist; args.sh rejects `--submit-label` (line 10 documents rejection) |
| `templates/form-non-terminal/` (5 files) | Debounced live-persist, no submit button | VERIFIED | All 5 files exist; `scheduleSave()` with 400ms debounce; no submit button or postMessage |
| `templates/ranking-non-terminal/` (5 files) | Drag + arrow reorder, live-persist, no submit | VERIFIED | All 5 files exist; `persistOrder()`; drag-handle + up/down arrow buttons confirmed; no submit-btn |
| `templates/list-actions-non-terminal/` (5 files) | Per-row live-persist, no Done button | VERIFIED | All 5 files exist; `persistRows()` with 5 `/update` references; "no Done button" comment at line 136 |
| `templates/color-picker-non-terminal/` (5 files) | Radio-group swatch selection, live-persist, no postMessage | VERIFIED | All 5 files exist; `.selected` toggle; POST to `/update`; zero postMessage/window.parent |
| `src/ui/features/pretty-view/ChatMessage.multi-widget.test.tsx` | 5 tests for N-iframe rendering + per-widget routing | VERIFIED | File exists; substantive (5 test cases, real WidgetBubble used, not mocked) |
| `src/ui/features/pretty-view/WidgetBubble.multi-mount.test.tsx` | 4 tests for concurrent-mount independence | VERIFIED | File exists; substantive (4 test cases, per-mount isolation + cleanup proven) |
| `substrate/skills/interactive-messages/SKILL.md` | Three-mode taxonomy + non-terminal + multi-widget sections | VERIFIED | 663 lines; all required sections present |
| `substrate/skills/interactive-messages/tests/all-templates-non-terminal-scaffold.test.sh` | 60 assertions across all 6 non-terminal templates | VERIFIED | File exists; 60/60 PASS confirmed by running `run-all.sh` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `create-widget.sh --mode` flag | `templates/<template>-<mode>/` directory | Explicit path: `TEMPLATE_DIR="$SCRIPT_DIR/templates/$TEMPLATE-$MODE"` | VERIFIED | No glob; exact path composition after allowlist validation |
| `is_supported_combo()` check | filesystem mutation gate | Called before port claim and widget folder creation | VERIFIED | `is_supported_combo` appears before `TEMPLATE_DIR` assignment |
| `default_mode_for_template()` | Phase 138 back-compat | Returns canonical default for each template | VERIFIED | poll/color-picker → terminal-on-click; others → terminal-on-submit |
| non-terminal widget.html | `/update` POST | Inline fetch to `PANE_BASE + "/update"` or `"/update"` | VERIFIED | Every non-terminal widget.html uses `/update` path, never `/submit` |
| `all-templates-non-terminal-scaffold.test.sh` | `run-all.sh` | Explicit `run_file` call at end of run-all.sh | VERIFIED | run-all.sh calls both integrated tests explicitly |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `create-widget.sh` syntax | `bash -n create-widget.sh` | exit 0 | PASS |
| Base + non-terminal test suite | `SKIP_SYSTEMCTL=1 bash tests/run-all.sh` | 14/14 test files pass | PASS |
| Multi-widget frontend tests | `npx vitest run ChatMessage.multi-widget.test.tsx WidgetBubble.multi-mount.test.tsx` | 9/9 tests pass | PASS |
| All non-terminal widget.html zero postMessage | `grep -r postMessage templates/*-non-terminal/widget.html` | 0 matches | PASS |
| All non-terminal server.py have /update, no /submit | grep across 6 server.py files | 4-5 /update hits each, 0 /submit hits each | PASS |

---

### Requirements Coverage

ROADMAP.md marks requirements as "TBD" for Phase 140. Success criteria verification derives from phase goal decomposition and the 9-plan structure.

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 6 non-terminal template dirs created (5 files each) | SATISFIED | All 12 dirs exist; all 5 files per non-terminal dir confirmed |
| `create-widget.sh --mode` extension | SATISFIED | Flag accepted; explicit path dispatch; default-mode fallback |
| Curated combo enforcement | SATISFIED | `is_supported_combo()` present and tested |
| Zero postMessage in non-terminal widgets | SATISFIED | Grep zero across all 6 widget.html |
| `/update` endpoint, no `/submit` in non-terminal server.py | SATISFIED | Grep confirms all 6 |
| `updated_at` in state shape | SATISFIED | Present in all 6 server.py (1-2 occurrences each) |
| Multi-widget frontend proof | SATISFIED | 9/9 vitest tests pass |
| SKILL.md three-mode taxonomy | SATISFIED | All three required sections in 663-line SKILL.md |
| No lifecycle/teardown code (deferred to Phase 140) | SATISFIED | No teardown/backstop/expired-placeholder references in Phase 140 template files |
| No deploy motions | SATISFIED | Phase 140 commits are all `feat`/`test`/`docs` — no nginx, docker, or deploy commits |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `create-widget.sh` | 395 | `XXXXXX` in `mktemp` template string | INFO — false positive | Shell mktemp syntax, not a debt marker |

No actual TBD/FIXME/XXX debt markers in any Phase 140 modified files.

---

### Human Verification Required

None. All must-haves are verifiable programmatically.

The multi-widget visual rendering (N iframes in one bubble, each independently interactive) would benefit from human UAT against a live session, but the automated tests (ChatMessage renders N distinct iframes, WidgetBubble mounts are independent) provide sufficient mechanical proof of correctness.

---

### Gaps Summary

No gaps. All 9 plans delivered their stated artifacts, all tests pass, scope boundaries are respected (no teardown, no deploy, no custom-widget authoring).

---

_Verified: 2026-09-27T22:35:00Z_
_Verifier: Claude (gsd-verifier)_
