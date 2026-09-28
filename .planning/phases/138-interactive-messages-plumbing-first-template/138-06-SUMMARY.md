---
phase: 137-interactive-messages-plumbing-first-template
plan: "06"
subsystem: substrate/skills/interactive-messages
tags: [interactive-messages, widget, scaffold, poll, systemd, python]
dependency_graph:
  requires: []
  provides:
    - substrate/skills/interactive-messages/create-widget.sh
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/
    - substrate/skills/interactive-messages/SKILL.md
  affects:
    - substrate/skills/interactive-messages/**
tech_stack:
  added: []
  patterns:
    - bash scaffold script with atomic flock port claim (mirrors create-app.sh)
    - Python stdlib http.server (zero external deps)
    - systemd --user unit template with substitution markers
    - vanilla HTML + inline JS (no build step)
key_files:
  created:
    - substrate/skills/interactive-messages/create-widget.sh
    - substrate/skills/interactive-messages/SKILL.md
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/widget.html
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/server.py
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/im-SLUG.service.template
    - substrate/skills/interactive-messages/templates/poll-terminal-on-click/metadata.json.template
    - substrate/skills/interactive-messages/tests/create-widget.test.sh
  modified: []
decisions:
  - port-range-9601-9699-verified-free
  - widget-lock-file-distinct-from-app-lock
  - buttons-not-radios-enforced-in-template
  - python3-for-all-substitutions-to-ensure-correct-escaping
metrics:
  duration: "~45 minutes"
  completed: "2026-09-27T19:11:47Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 0
---

# Phase 138 Plan 06: Scaffold Script + Poll Template + Skill Doc Summary

Shipped the substrate skill package for interactive messages: a scaffold command
for creating poll widgets, poll template files (HTML/Python/systemd), and the
SKILL.md agent-facing instruction document.

---

## What Shipped

### Task 1: `create-widget.sh` scaffold script + test harness

`substrate/skills/interactive-messages/create-widget.sh` — a sibling of
`create-app.sh` with the following shape:

```
bash ~/.claude/skills/interactive-messages/create-widget.sh \
  <slug> poll \
  --message-id <mid> --conversation-id <cid> \
  --prompt "Question?" --options optA,optB,optC
```

Key behaviors:
- Kebab-slug validation (`^[a-z][a-z0-9-]*$`, max 40 chars)
- Only `poll` accepted as template; others die with "only 'poll' is supported in Phase 138"
- HOSTID read from `~/.claude/skynet-hostid` — same validation as `create-app.sh`
- Port claim under exclusive `flock` on `~/fleet/.create-widget-lock` (DISTINCT from `~/fleet/.create-lock`)
- Port range: 9601-9699 (verified free; see Port Range section below)
- Scans existing `im-*.service` files + `interactive-messages-archive` to avoid port collisions
- All substitutions done via `python3` inline scripts for correct JSON/escaping
- `SKIP_SYSTEMCTL=1` env var short-circuits systemd calls for test environments
- Cleanup trap rolls back unit file + widget folder on failure after port claim
- Stdout prints `SLUG=<slug>` and `URL=/interactive/<hostId>/<slug>/pane/` for agent harness

Test harness `substrate/skills/interactive-messages/tests/create-widget.test.sh`:
- 41 checks across 8 test cases (happy path + 7 failure modes)
- Runs in a temporary HOME (`mktemp -d`) — no real environment pollution
- All 41 checks pass

### Task 2: Poll template files

`substrate/skills/interactive-messages/templates/poll-terminal-on-click/`

- **`widget.html`** — buttons-only (no radios, per affordance-matches-behavior rule),
  POSTs to `/submit` then fires `window.parent.postMessage({type:"widget-submit",...},
  window.location.origin)` AFTER fetch resolves. Mobile-responsive flex layout,
  dark-mode CSS via `prefers-color-scheme`. Substitution points: `__PROMPT_JSON__`,
  `__OPTIONS_JSON__`, `__WIDGET_ID__`, `__PANE_BASE__`.
- **`server.py`** — Python stdlib `http.server`, binds `127.0.0.1:PORT`, serves
  widget.html on GET /, accepts POST /submit, writes `state.json` under
  `threading.Lock`, forces `template:"poll"` discriminator in state. Reads
  `metadata.json` at startup for debug logging. Substitution point: `__PORT__`.
- **`im-SLUG.service.template`** — systemd unit with `__SLUG__`/`__WIDGET_DIR__`/
  `__PORT__` markers, `Restart=on-failure`, `SyslogIdentifier=im-__SLUG__`.
- **`metadata.json.template`** — shape reference document (not substituted at runtime).

### Task 3: `SKILL.md` agent instructions

`substrate/skills/interactive-messages/SKILL.md` — 245 lines covering:
- What Phase 138 ships (poll only)
- When to use / when not to use (earns-its-interactivity rule)
- CLI shape + worked example + embed pattern
- How to read state.json on submit
- Buttons-not-radios affordance rule
- Phase 138 limits (no lifecycle, no custom widgets, no other templates)
- What-would-make-this-wrong invariants

---

## Port Range Verification

**Pre-flight check result (plan checker HIGH-2 concern):**

```
ss -tlnp | grep -E ':9[6-7][0-9]{2}\b' || echo "range appears free"
```

Result: `range 9601-9799 appears free on this box`

Port range 9601-9699 is confirmed free. No alternative range was needed.
The script bakes `seq 9601 9699` as the widget port range, distinct from
apps' 9501-9599.

---

## Lock File Path

`~/fleet/.create-widget-lock` — distinct from `~/fleet/.create-lock` (create-app.sh).
No flock contention between concurrent create-app and create-widget invocations.

---

## Test Coverage Summary

| Test | Description | Result |
|------|-------------|--------|
| 1 | Happy path: all 7 acceptance criteria files/fields | 27 checks PASS |
| 2 | Missing `~/.claude/skynet-hostid` | PASS |
| 3 | Invalid slug (uppercase) | PASS |
| 3b | Invalid slug (starts with digit) | PASS |
| 4 | Duplicate slug (folder pre-exists) | PASS |
| 5 | Unknown template (`checklist`) | PASS |
| 6 | Fewer than 2 options (1 option + empty string) | 2 checks PASS |
| 7 | All 99 ports in 9601-9699 exhausted via mock units | PASS |

**Total: 41 / 41 checks passing.**

**SKIP_SYSTEMCTL note:** The test harness runs with `SKIP_SYSTEMCTL=1`, which
short-circuits `systemctl --user enable/start`. The file scaffolding, port claim,
substitutions, and metadata write are all tested. Real systemd validation requires
deploying to an identity box with a running user session — out of scope for this
plan's test environment.

---

## Verification Suite Results

All 9 plan verification checks passed:

1. `test -x create-widget.sh` — PASS
2. `bash -n create-widget.sh` — PASS (no syntax errors)
3. Python syntax check on server.py — PASS
4. No radio buttons in widget.html — PASS
5. `window.location.origin` in postMessage — PASS
6. `9601` in create-widget.sh — PASS
7. `.create-widget-lock` in create-widget.sh — PASS
8. Test harness: 41/41 PASS
9. SKILL.md grep-verifiable claims — PASS

---

## Deviations from Plan

None — plan executed exactly as written.

The port range assumption (A1 from RESEARCH) was verified free before committing.
No alternative range selection was necessary.

---

## Known Stubs

None. All substitution points are fully wired:
- `__PROMPT_JSON__` / `__OPTIONS_JSON__` / `__WIDGET_ID__` / `__PANE_BASE__` in widget.html
- `__PORT__` in server.py
- `__SLUG__` / `__WIDGET_DIR__` / `__PORT__` in im-SLUG.service.template

The `metadata.json.template` is intentionally a shape reference, not a runtime
template — documented as such with a top-of-file comment.

---

## Threat Surface Scan

No new network endpoints or trust-boundary surfaces beyond what the plan's
`<threat_model>` explicitly covers:

- T-138-06-SL: slug validated before filesystem mutation (MITIGATED)
- T-138-06-PortRace: exclusive flock on distinct lock file (MITIGATED)
- T-138-06-HTMLInject: prompt JSON-encoded via python3 (MITIGATED)
- T-138-06-postMsgWildcard: template targets `window.location.origin` (MITIGATED)
- T-138-06-DoubleSubmit: buttons disabled on first click before fetch (MITIGATED)

---

## Self-Check: PASSED

Files exist:
- substrate/skills/interactive-messages/create-widget.sh — FOUND
- substrate/skills/interactive-messages/SKILL.md — FOUND
- substrate/skills/interactive-messages/templates/poll-terminal-on-click/widget.html — FOUND
- substrate/skills/interactive-messages/templates/poll-terminal-on-click/server.py — FOUND
- substrate/skills/interactive-messages/templates/poll-terminal-on-click/im-SLUG.service.template — FOUND
- substrate/skills/interactive-messages/templates/poll-terminal-on-click/metadata.json.template — FOUND
- substrate/skills/interactive-messages/tests/create-widget.test.sh — FOUND

Commits exist:
- a6aa62ac feat(138-06-1): add create-widget.sh scaffold script with atomic port claim — FOUND
- a2094222 feat(138-06-2): add poll-terminal-on-click template files — FOUND
- 5a3a96d5 feat(138-06-3): add SKILL.md for interactive-messages — agent instructions for poll widget — FOUND
