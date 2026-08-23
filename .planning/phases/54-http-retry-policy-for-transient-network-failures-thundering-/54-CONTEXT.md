# Phase 54: HTTP retry policy for transient network failures (thundering-herd resilience) — Context

**Gathered:** 2026-08-23
**Status:** Ready for planning
**Source:** Direct-seeded from discussion + log-dive evidence; discuss-phase skipped per `/build` feature-mode convention.

## What this is

Ashley runs ~10 Skynet Chrome windows on one box. When Chrome crashes (or the OS
kills the tab-set), she hits Chrome's Restore button. All ~10 tabs load
simultaneously — each fires its own SPA bootstrap request storm (session-check,
identities list, host list, sessions list, fleet-status subscribe, three WS
upgrade attempts each) against a single Node backend fronted by a single
in-container nginx worker. A subset of those requests transiently fail, and
each failed tab shows the "Server connection lost, recovering…" toast —
requiring her to refresh each tab by hand. This is thundering-herd, not
rate-limiting.

Evidence from a 20k-request Caddy sample (2026-08-23):
- Zero `429` responses (confirms no traditional rate limit)
- 9× 404 GET `/fleet-status/ws`
- 6× 404 GET `/claude-session/websocket/`
- 18× 502 POST `/debug/console-log`
- 14× 400 POST `/pretty-view/fetch-tailnet-url`

The 404s on WS upgrades are the smoking gun for the WS side; the 502s are the
smoking gun for the HTTP side (backend momentarily overloaded / recycling).

The fix is a comprehensive retry policy — every request that could transiently
fail retries with jittered exponential backoff, so the herd of failed requests
spreads out on retry instead of re-clumping into a new herd one round later.

## Shape

Two moving parts, each with a specific classification tree.

### Part 1 — Axios HTTP retry interceptor (frontend)

A new `retry` response interceptor in `src/ui/main-axios.ts` sits BEFORE the
existing `dbHealthMonitor.reportDatabaseError` call, so retries happen first
and only sustained failure (after retries exhaust) surfaces as a toast.

**Retry classification tree — retry these:**
- Network errors: `ERR_NETWORK`, `ECONNREFUSED`, `ECONNABORTED`, `ECONNRESET`,
  `ETIMEDOUT`, axios timeout (30s), `err.response === undefined`
- 5xx responses: `502`, `503`, `504` (`500` and `501` do NOT retry — those are
  server bugs / not-implemented, no transient shape)

**Never retry these:**
- Any `4xx` — the 401 fast-path must still hit `session-expired` immediately;
  `400`/`403`/`404`/`409`/`413`/`422`/`429` are deterministic
- Requests already marked `__silentRetry` (progressive `/status` retry already
  has its own logic — don't double-retry)
- Requests marked `__noRetry: true` (escape hatch for callers that need it)

**Idempotency safeguard — HTTP method matters:**
- `GET`, `HEAD`, `OPTIONS`: retry freely on any retry-eligible failure
- `POST`, `PUT`, `PATCH`, `DELETE`: retry ONLY when the failure is
  **connection-never-established** (`ECONNREFUSED`, `ERR_NETWORK` with no
  response) — do NOT retry on `5xx` because the server may have processed
  the request and the client just didn't hear the response. Rare in practice,
  but the discipline prevents duplicate writes.

**Backoff shape:**
- Attempt cap: 3 total attempts (initial + 2 retries)
- Base delay: 300ms
- Jitter: full jitter — `delay = random(0, base * 2^attempt)`. NOT
  `base * 2^attempt + random(0, jitter)` — full-jitter is the specifically
  anti-thundering-herd shape (AWS Architecture Blog canonical form)
- Max total wall-clock: ~4-6s across all retries
- Concrete math: attempt-1 fails → sleep `random(0, 600ms)` → retry
  attempt-2 fails → sleep `random(0, 1200ms)` → retry attempt-3 (final)

**Success handling:** on a successful retry, call
`dbHealthMonitor.reportDatabaseSuccess()` so any prior sustained-error toast
clears.

**Instrumentation:** each retry attempt emits a structured client log via the
existing logger contract at `main-axios.ts` — fields: `requestId`, `method`,
`url`, `attempt` (1-indexed), `delayMs`, `errorCode`, `errorMessage`. On final
give-up, one summary line: `retries_exhausted attempts=3 finalErrorCode=…`.
These forward through `/debug/console-log` and land in the console-forward log
alongside backend logs — the forensic trail rule (`box-maintainer.md` §
Standing directives).

### Part 2 — WebSocket reconnect audit (verify existing jitter)

Three WS endpoints have reconnect logic today:
- `/claude-session/websocket/` — PrettyView pane, `PrettyView.tsx` around
  `wsRef` and the reconnect path introduced by patch #148
- `/fleet-status/ws` — fleet-status subscription
- `/ssh/websocket/` — Terminal SSH pane

The patch #231/#232 arc explicitly touched WS reconnect timings (bumped
frontend/backend timeouts 30s → 300s). Whether that arc left the reconnect
ladder JITTERED is unknown as of this phase kickoff.

Audit outcome must be one of:
- **Already jittered** — document the current shape in the plan's audit
  section, no code change needed
- **Fixed ladder** — add jitter (same full-jitter shape as Part 1 — random
  0…N ms instead of exactly N ms) in the minimum-touch shape that closes the
  re-clumping risk

The audit is not a rewrite — WS reconnect logic is already load-bearing. Only
add jitter where it's absent; do NOT change the retry cap, initial delay
scale, or termination conditions.

## Philosophy

**Retries are cheap on transient failures and destructive on non-transient
ones.** Every retry decision splits on that axis: is this failure something a
few-hundred-ms wait can fix (transient — herd, momentary backend restart,
brief route-not-attached window), or is it a deterministic verdict from the
server (401 = session expired, 400 = bad request, 404 = route doesn't exist)?
Retrying the second class is destructive: it either loops forever waiting for
a truth that won't change, or it hides a bug the user needs to see.

**Jitter is what makes retries actually work against a herd.** A fixed-delay
retry ladder converts N simultaneous failures at T=0 into N simultaneous
retries at T=+D, which is the same herd one round later — often worse
because the backend hasn't finished draining the first wave. Full jitter
(uniform random 0…N ms per attempt) spreads the retries across the whole
window, which is exactly what the backend needs to make progress. This is
canonical (AWS Architecture Blog, "Exponential Backoff and Jitter",
Marc Brooker). We don't get to be clever about jitter shape; the well-known
one wins.

**Idempotency is the trap.** POST-then-retry is only safe when the first
attempt didn't reach the server. A 5xx means the server got it and something
went wrong AFTER — retrying is a coin-flip between "double-apply" and
"just-fine, first attempt didn't stick." The GET/POST-DELETE split above is
the industry-standard hedge; when in doubt, favor "let the user see the
error" over "silently double the write."

**Silence is not success.** Every retry attempt logs. Every give-up logs.
When Ashley next reports a "can't connect" toast, the console-forward log
must show ONE line per attempt with the actual `errorCode`/`errorMessage`
so I can distinguish "network genuinely down" from "backend behind on
requests" from "something new is broken." Zero-log retries would rob me of
the forensic trail I'll need when this class of bug reappears in a new
shape.

## What this is deliberately NOT doing

- **NOT adding a global backend rate limiter.** The failures here are
  transient-under-momentary-load, not "malicious client spamming the server."
  A rate limiter would make the herd's failure MORE consistent, not less.
- **NOT rewriting the WS reconnect logic wholesale.** The reconnect state
  machines have their own patch history and shipping bugs (patch #231/#232
  arc). Add jitter if it's absent; do not touch termination conditions or
  cap counts.
- **NOT batching bootstrap requests into one endpoint.** Long-term that
  might be worth doing (single `/bootstrap` returning session+identities+
  hosts+sessions in one round-trip), but it's a bigger design change and
  doesn't compose with in-flight patches; retries are the small, load-bearing
  fix that eats the specific pain today.
- **NOT jittering the frontend bootstrap request sequence.** A jittered
  delay on page-load would break the herd on the SEND side too, but it
  adds visible latency (~500ms) to every cold-load, not just the 10-tab-
  restore case. Retries are strictly better: they cost nothing when
  requests succeed first-attempt (the common case) and cost 300ms-6s
  only when they'd otherwise have failed.

## Success criterion

Ashley closes Chrome (10 Skynet tabs open), hits Restore, and sees ZERO
"Server connection lost, recovering…" toasts on tab-restore. (Or at most
1 sustained toast if the backend is truly down and retries exhaust — that
IS the intended behavior of the retry policy.)

Secondary success: measurable. Before/after console-forward-log check —
count of `dbHealthMonitor` degraded fires per 10-tab-restore cycle drops
from ~N to ~0.

## Requirements

- **R-54-01** — Axios interceptor: retry classification tree implemented
  (network errors + 5xx retry; 4xx never retry; POST/PUT/DELETE only retry
  on connection-never-established)
- **R-54-02** — Full-jitter exponential backoff (base 300ms, cap 3
  attempts, max ~4-6s total)
- **R-54-03** — Session-expired 401 fast-path preserved — a 401 with a
  session-expired code MUST reach `dbHealthMonitor.reportSessionExpired()`
  on the first attempt with zero retry delay
- **R-54-04** — `__silentRetry` and `__noRetry` escape hatches respected
- **R-54-05** — Per-attempt + give-up structured logging via existing
  logger contract
- **R-54-06** — Success on a retry clears any prior sustained-error state
  via `dbHealthMonitor.reportDatabaseSuccess()`
- **R-54-07** — WS reconnect audit: for each of `/claude-session/websocket/`,
  `/fleet-status/ws`, `/ssh/websocket/`, document current jitter shape;
  add full-jitter if absent (minimum-touch)
- **R-54-08** — Tests: classification tree (retry/no-retry per method +
  error-code combinations), jitter shape (statistical assertion — retries
  spread across the expected window, not clumped), 401-fast-path (no
  retry delay), success-clears-degraded

## Canonical References

- `src/ui/main-axios.ts:299-538` — `createApiInstance` — where the retry
  interceptor lands (BEFORE the existing error handler that fires
  `dbHealthMonitor.reportDatabaseError`)
- `src/ui/main-axios.ts:473-527` — 401 fast-path (SESSION_EXPIRED /
  SESSION_NOT_FOUND / AUTH_REQUIRED) — MUST be preserved
- `src/ui/lib/db-health-monitor.ts:72-135` — `reportDatabaseError` /
  `reportDatabaseSuccess` — retry interceptor calls
  `reportDatabaseSuccess` on a successful retry
- `src/ui/AppShell.tsx:836-864` — toast wiring (`connectionDegraded` /
  `backendReconnected`) — reference only, no change
- `src/ui/features/pretty-view/PrettyView.tsx` around `wsRef` — WS
  reconnect audit target (patch #148 + #231/#232 arc)
- Fleet-status WS + SSH WS reconnect paths — audit targets
- AWS Architecture Blog, "Exponential Backoff and Jitter" (Marc Brooker)
  — canonical full-jitter shape reference

## Deferred

- Single-shot `/bootstrap` endpoint that returns session + identities +
  hosts + sessions in one round-trip (would eliminate the request storm
  itself rather than mitigate it) — deferred as bigger design change
- Backend WS-upgrade route pre-registration (fix the underlying 404-on-
  upgrade race directly rather than mitigating with client retry) —
  deferred until we know how often this fires post-retry-policy
- Extending retry to non-HTTP call paths (voice STT direct blob POST,
  file uploads via multipart) — case-by-case, out of scope for this
  phase

---

*Phase: 54-http-retry-policy-for-transient-network-failures-thundering-*
*Context seeded: 2026-08-23 (Tanya, box-maintainer) — direct from
discussion + log dive; discuss-phase skipped per /build feature-mode
convention (phase-53 precedent).*
