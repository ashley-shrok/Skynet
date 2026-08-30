# Phase 31: Whole-app structured-logging backfill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-11
**Phase:** 31-whole-app-structured-logging-backfill
**Areas discussed:** Scope, Log schema/conventions, Volume/throttle, Testing, Backend parallel, Fix in-scope or out

---

## Scope of the initial backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Narrow — the two symptom-bounty surfaces only | WS lifecycle + pause-gate + reopen ladder + session-open + TTS + voice-recording only | |
| Wide — anywhere a bug might surface | Everything above PLUS PWA/service-worker, auth, compose/draft, keyboard/tap, backend, etc. | ✓ |

**User's choice:** Wide — "anywhere that can have an issue that might need to be diagnosed is fair game."
**Notes:** Ashley 2026-08-11 verbatim: *"I would rather overdo it than underdo it, because like we talked about, it's not expensive to add the lines, nor to have them be logging during runtime."* Codified as D-01 + D-08 in CONTEXT.md.

---

## Log schema and conventions

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON per line + canonical prefix taxonomy | Ashley delegated to me; I chose this | ✓ |
| Free-form prose-with-prefix per subsystem | Leave the current zoo of prefixes as-is | |

**User's choice:** Deferred to me. Ashley 2026-08-11 verbatim: *"the conventions should be whatever makes it easiest for you to find and figure out issues, because I won't be looking at the logs, you will."*
**Notes:** Chose structured `[subsystem] event key=value` format on top of the existing `{ts, level, tabId, msg}` envelope; canonical subsystem prefix taxonomy consolidates the current mixed zoo. Never `JSON.stringify(event)`. See D-09..D-16.

---

## Volume / throttle discipline

| Option | Description | Selected |
|--------|-------------|----------|
| No dedup — trust log line judgment | Log everything, no runtime dedup | |
| Client-side dedup (syslog-style) | "last message repeated N times" pattern; standard practice | ✓ |
| Aggressive throttling | Rate-limit every subsystem | |

**User's choice:** Dedup, syslog-style. Ashley 2026-08-11 verbatim: *"any easy way to batch lines that are the same? … there'd be some way to have the line in there once with like a counter of how many times it happened … I'm sure there are standards for this kind of thing and so we probably just follow that."*
**Notes:** N=3, W=5s starting defaults; applied selectively to hot paths (visibility flap, scroll, per-render, DIAG-REPORT); per-event lines (WS close, play-attempt) stay individually logged. See D-17..D-19.

---

## Test strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Contract tests for every log line | Assert exact log shape on every event | |
| Light smoke tests for critical lines | WS close, pause-gate, TTS play-attempt only | ✓ |
| No tests | Diagnostic-only logs, no test coverage | |

**User's choice:** Light. Ashley 2026-08-11 verbatim: *"testing is potentially helpful but probably not totally necessary."*
**Notes:** See D-20. Non-blocking — missing smoke test doesn't fail phase, wrong-shape one does.

---

## Backend parallel

| Option | Description | Selected |
|--------|-------------|----------|
| Frontend only | Backend stays on Docker stdout | |
| Include backend on same log stream | Pipe backend logs to console-forward for unified grep | ✓ |
| Separate backend log stream | Structured log stream for backend, separate file | |

**User's choice:** Deferred to me. Chose unified stream (same console-forward endpoint with `source=backend` marker).
**Notes:** Cheapest unification path — one file to grep, cross-correlation of frontend/backend events on the same timeline. See D-03 + D-16.

---

## Fix in-scope or out (Phase 31 vs Phase 32-candidate)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Instrumentation only | Phase 31 = logs only; fixes are follow-up phases | ✓ |
| (b) Instrumentation + minimum fix | Bundle fix for the two symptom bounties into Phase 31 | |

**User's choice:** (a) after I explained #6 plainly. Ashley: "let's go" confirming (a).
**Notes:** Locked at D-21 + D-22. Discipline: if I notice root cause during backfill, capture as bounty; do NOT fix inline. Preserves phase-31 scope discipline; the fix phase then works from real data.

---

## Claude's Discretion

- **Which specific files/hooks/components under each subsystem get touched** (D-01 gave me wide latitude; planning will enumerate).
- **Exact dedup rate limits per subsystem** — starting at N=3 W=5s but tunable per observed noise.
- **Backend log-forward transport** — probably in-process buffer + periodic POST to console-forward with `source=backend`, but details settled at plan time.
- **Wave ordering** — likely groups by subsystem, but planner will chunk based on file overlap and rebase risk.

## Deferred Ideas

- Log-shipping / dashboards (Grafana/Loki style).
- Log rotation policy — folded into existing "container-writable-layer bloat" open plan.
- Full contract tests on every log line.
- User-facing log-viewer surface in the app.
- Fix for `ws-pause-gate-stuck-connect-cycling` — becomes its own phase after Phase 31.
- Fix for `speak-button-broken-on-cellular` — becomes its own bounty/phase after Phase 31.
- Reconnect-ladder redesign (single canonical head-of-ladder) — the fix Phase 31 enables.
- Softening the "Connection rejected by server" full-screen overlay UX.
