---
phase: 137-interactive-messages-plumbing-first-template
verified: 2026-09-27T20:23:11Z
status: passed
score: 10/10
overrides_applied: 0
---

# Phase 138: Interactive Messages — Plumbing + First Template Verification Report

**Phase Goal:** Prove the end-to-end loop for interactive messages — new folder root, sweep type-tagging, forked URL prefix + proxy path, server-allowlist URL-type discriminator, in-bubble URL detection + iframe swap, invisible-submit-message routing, agent scaffold command, plus ONE template (poll in terminal-on-click mode) end-to-end. No lifecycle infra this phase.

**Verified:** 2026-09-27T20:23:11Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New folder root — sweep reads `~/fleet/interactive-messages/*` as a distinct source-D separate from apps | VERIFIED | `_enumerate_widgets()` at line 1772 of `fleet-status-sweep.py`; `root = os.path.join(home, "fleet", "interactive-messages")` at line 1791; separate from app enumeration at line 1876 |
| 2 | Sweep type-tagging — emits `line_kind:"interactive-message"` additive; SWEEP_SCHEMA_VERSION NOT bumped | VERIFIED | `line_kind: "interactive-message"` at line 1763 of sweep.py; `SCHEMA_VERSION = 1` confirmed; `SWEEP_SCHEMA_VERSION = 1 as const` in sweep-schema.ts line 42; 10 new schema tests pass (50/50) |
| 3 | Forked URL prefix + proxy path — `/interactive/<hostId>/<slug>/pane/*` proxies via port-range cache disambiguation (9601–9699 widgets, 9501–9599 apps) | VERIFIED | `im-pane-router.ts` 522 lines; regex `/^\/interactive\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/` at line 111; `app.use("/interactive", imPaneRouter)` in database.ts line 301; 25 tests pass |
| 4 | Server-allowlist URL-type discriminator — `eligibleUrls` is `Map<string, "file" \| "interactive-message">`; widget URLs classified synchronously, no backend fetch | VERIFIED | `use-editable-file-eligibility.ts` line 67 returns `Map<string, "file" \| "interactive-message">`; `INTERACTIVE_MSG_DISPATCH_RE.test(url)` short-circuits at line 124 with no fetch; 10 new tests pass |
| 5 | In-bubble URL detection + iframe swap — ChatMessage `a`-override dispatches widget URLs to `WidgetBubble`; WidgetBubble retries 2s/4s/8s with cache-bust; dual postMessage `source` + `origin` guard | VERIFIED | `ChatMessage.tsx` line 411: `if (urlType === "interactive-message" && href) return <WidgetBubble ...>`; `RETRY_DELAYS_MS = [2000, 4000, 8000]` in WidgetBubble.tsx line 17; guards at lines 77+81 (`e.source !== iframeRef.current?.contentWindow`, `e.origin !== window.location.origin`); 27 tests pass |
| 6 | Invisible-submit-message routing — `isWidgetSubmit` in PrettyView blacklist gate parallels `isIdCommand`; widget-submit has NO attachment carve-out | VERIFIED | `PrettyView.tsx` line 1660: `if (isWidgetSubmit(payload)) { return; }` unconditional, before `isIdCommand` gate at line 1661; `isIdCommand` has attachment check, `isWidgetSubmit` does not; 11 tests pass |
| 7 | Agent scaffold command — `create-widget.sh` allocates port 9601–9699, exclusive `flock` on `~/fleet/.create-widget-lock` (distinct from app lock), `SKIP_SYSTEMCTL` test hook | VERIFIED | `create-widget.sh` line 104: `LOCK_FILE="$HOME/fleet/.create-widget-lock"`; line 202: `seq 9601 9699`; line 177: `flock -x 200`; 41/41 test checks pass |
| 8 | Poll template end-to-end — BUTTONS not radios; POST to /submit; postMessage to `window.location.origin`; server.py Python stdlib; state.json written under `threading.Lock` | VERIFIED | `widget.html` line 112: `document.createElement("button")`; no `<input type="radio">` found; line 169: `window.location.origin`; `server.py` line 19: `from http.server import BaseHTTPRequestHandler, HTTPServer`; line 24: `_lock = threading.Lock()`; line 21: `STATE_FILE = pathlib.Path(...) / "state.json"` |
| 9 | Widgets stay off sidebar — `FrontendOutboundFrame` union has no widget frame types; `publishWidgetUpdate` has no `fanOut` call | VERIFIED | `wire-protocol.ts` lines 769–779: union contains only Session/App frames (no WidgetSnapshot/WidgetUpdate/WidgetGone); `publishWidgetUpdate` implementation (lines 1065–1073) calls only `widgets.set(key, widget)` — no `fanOut`; Test 9 in registry asserts spy NOT called |
| 10 | Scope boundaries respected — only `poll-terminal-on-click` template; no lifecycle infra; no phase 2/3/4 bleed | VERIFIED | `ls templates/` returns only `poll-terminal-on-click`; `create-widget.sh` line 53: `die "only 'poll' is supported in Phase 138"`; `SKILL.md` lines 199–204 explicitly names Phase 138 limits; no teardown/lifecycle code found in any shipped file |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `substrate/scripts/fleet-status-sweep.py` | Source-D widget enumeration | VERIFIED | 1977 lines; `_enumerate_widgets`, `_build_widget_line`, `_read_widget_unit_file` all present |
| `src/backend/fleet-status/sweep-schema.ts` | `SweepInteractiveMessageLine` + parser dispatch | VERIFIED | 681 lines; interface + union + guard + `interactiveMessageLines` bucket |
| `src/backend/fleet-status/sweep-schema.test.ts` | 10 new tests | VERIFIED | 1013 lines; all Phase 138 tests pass |
| `src/backend/fleet-status/wire-protocol.ts` | `WidgetStateSchema` + `WidgetState`; no widget frame union members | VERIFIED | `WidgetStateSchema` at line 750; `FrontendOutboundFrame` unchanged (lines 769–779) |
| `src/backend/fleet-status/subscription-registry.ts` | `publishWidgetUpdate`, `publishWidgetGoneByHostSlug`, `getWidgetSnapshot` — no fanOut | VERIFIED | All three methods present; `publishWidgetUpdate` body is `widgets.set(key, widget)` only |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | `adaptWidgetLineToState` + `lastTickLiveWidgets` + reconciliation | VERIFIED | Present; Tests W1–W6 all pass |
| `src/backend/apps/im-pane-router.ts` | `/interactive/` proxy router; `getWidgetSnapshot` not `getAppSnapshot` | VERIFIED | 522 lines; `getWidgetSnapshot()` at lines 191 and 460; exports `imPaneRouter` + `handleImPaneUpgrade` |
| `src/backend/database/combined-pane-upgrade-dispatcher.ts` | Routes both `/apps/` and `/interactive/` upgrades | VERIFIED | 70 lines; `IM_PANE_UPGRADE_RE` + dispatch table; wired in database.ts |
| `docker/nginx.conf` | `location ^~ /interactive/` block | VERIFIED | Lines 205–224; byte-parallel to `/apps/` block |
| `docker/nginx-https.conf` | `location ^~ /interactive/` block | VERIFIED | Same block present (lines 216+) |
| `src/ui/features/pretty-view/editable-file-whitelist.ts` | `INTERACTIVE_MSG_URL_RE_CLIENT` export | VERIFIED | Lines 238–239; regex matches `/interactive/<hostId>/<slug>/pane` |
| `src/ui/features/pretty-view/use-editable-file-eligibility.ts` | `Map<string, "file" \| "interactive-message">` return type | VERIFIED | Line 67; widget short-circuit at line 124–126 |
| `src/ui/features/pretty-view/WidgetBubble.tsx` | iframe + retry + dual postMessage guard | VERIFIED | 4522 bytes; `RETRY_DELAYS_MS = [2000, 4000, 8000]`; guards at lines 77+81 |
| `src/ui/features/pretty-view/ChatMessage.tsx` | URL-type dispatch; `onWidgetSubmit` prop | VERIFIED | Lines 397–412; `eligibleUrls.get(href)` dispatch; `onWidgetSubmit` prop at line 116 |
| `src/ui/features/pretty-view/PrettyView.tsx` | `isWidgetSubmit` predicate + blacklist gate + `handleWidgetSubmit` + prop wiring | VERIFIED | Lines 551–552 (predicate); 1660 (gate, unconditional before isIdCommand); 2152 (dispatcher); 4318 (prop wiring to primary mount only) |
| `substrate/skills/interactive-messages/create-widget.sh` | Scaffold; port 9601–9699; distinct lock | VERIFIED | Executable (-rwxr-xr-x); `seq 9601 9699`; `~/fleet/.create-widget-lock` |
| `substrate/skills/interactive-messages/templates/poll-terminal-on-click/widget.html` | Buttons not radios; postMessage to `window.location.origin` | VERIFIED | `document.createElement("button")`; no radio input; `window.location.origin` at line 169 |
| `substrate/skills/interactive-messages/templates/poll-terminal-on-click/server.py` | Python stdlib; state.json; threading.Lock | VERIFIED | `from http.server import ...`; `STATE_FILE`; `threading.Lock()` |
| `substrate/skills/interactive-messages/templates/poll-terminal-on-click/im-SLUG.service.template` | systemd unit template | VERIFIED | Present; 1021 bytes |
| `substrate/skills/interactive-messages/SKILL.md` | Agent instructions; Phase 138 scope limits named | VERIFIED | 245 lines; Phase 138 limits section at line 199 |
| `substrate/skills/interactive-messages/tests/create-widget.test.sh` | 41/41 checks pass | VERIFIED | Ran live — `Results: 41 passed, 0 failed` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `fleet-status-sweep.py` | `SweepInteractiveMessageLine` schema | `line_kind:"interactive-message"` JSON emission | WIRED | Python emits 6-key dict; TS parser dispatches to `interactiveMessageLines` bucket |
| `parseSweepJsonl` | `ssh-poll-orchestrator.ts` | `parsed.interactiveMessageLines` consumed in tick loop | WIRED | Orchestrator iterates `parsed.interactiveMessageLines`; calls `publishWidgetUpdate` per line |
| `subscription-registry.ts` | `im-pane-router.ts` | `getWidgetSnapshot()` port lookup | WIRED | `im-pane-router.ts` line 191: `getRegistry().getWidgetSnapshot()` |
| `im-pane-router.ts` | `database.ts` | `app.use("/interactive", imPaneRouter)` + combined WS upgrade | WIRED | database.ts lines 301 + 2541 |
| `WidgetBubble.tsx` | `ChatMessage.tsx` | URL-type `"interactive-message"` dispatch in `a`-override | WIRED | `ChatMessage.tsx` line 411; `WidgetBubble` import at line 20 |
| `WidgetBubble.tsx` | `PrettyView.tsx` | `onWidgetSubmit` prop → `handleWidgetSubmit` dispatcher | WIRED | `PrettyView.tsx` line 4318 wires `onWidgetSubmit={handleWidgetSubmit}`; primary mount only |
| `handleWidgetSubmit` | WS input frame | `sendInput(payload, mqid)` where payload starts `/widget-submit ` | WIRED | PrettyView.tsx line 2154; `isWidgetSubmit` gate at line 1660 suppresses pending bubble |
| `create-widget.sh` | `~/fleet/interactive-messages/<slug>/` | Scaffolds widget dir + systemd unit | WIRED | Script creates folder, renders templates, calls `systemctl --user enable/start im-<slug>.service` |
| `widget.html` | `server.py` POST /submit | `fetch("/submit")` then `postMessage({type:"widget-submit",...}, window.location.origin)` | WIRED | widget.html line 144 (fetch), line 163 (postMessage after resolve); server.py handles POST /submit |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Sweep schema parses `line_kind:"interactive-message"` | `npx vitest run sweep-schema.test.ts` | 50/50 passed | PASS |
| Widget registry lane — no subscriber fanout | `npx vitest run subscription-registry.test.ts ssh-poll-orchestrator.test.ts` | 249/249 passed | PASS |
| im-pane-router proxy + WS dispatcher | `npx vitest run im-pane-router.integration.test.ts im-pane-upgrade-dispatcher.test.ts` | 25/25 passed | PASS |
| WidgetBubble retry + dual postMessage guard | `npx vitest run WidgetBubble.test.tsx ChatMessage.WidgetBubble.test.tsx` | 27/27 passed | PASS |
| isWidgetSubmit blacklist gate — no pending bubble | `npx vitest run PrettyView.widget-submit.test.tsx` | (part of above) 11 tests passed | PASS |
| useEditableFileEligibility Map return type | `npx vitest run use-editable-file-eligibility.test.tsx` | 10/10 passed | PASS |
| create-widget.sh scaffold + port claim + failure modes | `bash tests/create-widget.test.sh` | 41/41 PASS | PASS |
| widget.html has no radio inputs | `grep -n "radio" widget.html` | no matches | PASS |
| SWEEP_SCHEMA_VERSION unchanged | `grep SWEEP_SCHEMA_VERSION sweep-schema.ts` | `= 1 as const` | PASS |
| No widget frame types in FrontendOutboundFrame | `grep FrontendOutboundFrame wire-protocol.ts` | union has no Widget* types | PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No TBD/FIXME/XXX debt markers found in any Phase 138 modified files; no stubs; no empty return values in rendered paths |

---

### Human Verification Required

None. All observable truths are verifiable via code inspection and test execution. Visual rendering of the iframe inside a chat bubble and end-to-end smoke test on a real identity box are out of scope for automated verification (Phase 138 ships no lifecycle infra, so widgets must be manually scaffolded to test the live loop). These are post-ship acceptance items, not blockers — the code is complete and wired.

---

### Gaps Summary

No gaps found. All 10 observable truths are VERIFIED against the codebase. Every claimed artifact exists, is substantive (not a stub), and is wired into the system. The test suites are green. Scope boundaries are clean — no phase 2/3/4 features bled in.

---

### Recommendation

**ready-to-ship**

All six plans delivered their stated goals and the full end-to-end loop is present in code:

- Sweep discovers `~/fleet/interactive-messages/*` as a distinct source-D.
- The TS schema parser routes those lines into a typed `interactiveMessageLines` bucket.
- The registry holds widget state in a separate Map with no sidebar fan-out.
- The backend proxy `/interactive/<hostId>/<slug>/pane/*` works via a verbatim fork of the app-pane-router, disambiguated by port-range cache key.
- nginx routes `/interactive/` through to Express (both conf files).
- The frontend classifies widget URLs synchronously (Map return type, no extra fetch), swaps `<a>` tags for `<WidgetBubble>` iframes with exponential retry and dual postMessage guard.
- The invisible-submit path fires a WS wake signal that never renders a bubble.
- `create-widget.sh` scaffolds a poll widget with atomic port claim in the 9601–9699 range under a distinct lock.
- The poll template renders as buttons (not radios), writes state.json on submit, fires postMessage after the fetch resolves.

---

_Verified: 2026-09-27T20:23:11Z_
_Verifier: Claude (gsd-verifier)_
