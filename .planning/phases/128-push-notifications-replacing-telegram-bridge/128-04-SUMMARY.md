---
phase: 126-push-notifications-replacing-telegram-bridge
plan: 04
subsystem: notifications
tags: [push-notifications, service-worker, ios-pwa, D-06, D-08, D-09, D-13]

# Dependency graph
requires:
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 01
    provides: "push_subscriptions table + POST /push-subscriptions route (the SW pushsubscriptionchange handler POSTs re-minted subscriptions back to this route with credentials:'include' for JWT cookie auth)"
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 02
    provides: "web-push VAPID key infrastructure (backend will encrypt payloads with the VAPID keypair; SW receives them opaquely via the browser push service)"
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 03
    provides: "derivePreviewText + resolveAgentDisplayName — populate the payload's title + body fields that this SW's push handler renders via showNotification()"
provides:
  - "public/sw.js push event handler — parses payload, wraps showNotification() in event.waitUntil() (Pitfall 3: iOS invalidates silent-push subscriptions), tags per-room for iOS-native grouping (D-09)"
  - "public/sw.js notificationclick handler — reads roomId from notification.data, focuses existing PWA window with .navigate(/?openRoom=<roomId>) if available, else openWindow (D-08 deep-link)"
  - "public/sw.js pushsubscriptionchange handler — re-mints subscription via pushManager.subscribe() using oldSubscription.options.applicationServerKey, re-POSTs to /push-subscriptions with credentials:'include' (D-13 silent iOS rotation recovery)"
  - "arrayBufferToBase64Url(buffer) helper — pure function converting p256dh/auth ArrayBuffers to base64url strings matching the wire format /push-subscriptions POST route (Plan 01) expects"
affects: [128-05-push-sender, 128-07-appshell-openroom-param, 128-11-close]

# Tech tracking
tech-stack:
  added:
    - "(no new npm deps — three vanilla ServiceWorkerGlobalScope event handlers + one pure helper appended to hand-written sw.js)"
  patterns:
    - "Every SW async body wrapped in event.waitUntil() — matches existing install/activate/fetch discipline at sw.js:12,25 (Pitfall 3: iOS terminates SW early otherwise)"
    - "Push handler defense-in-depth: try/catch around event.data.json() with two-tier fallback (`{title:SKYNET,body:''}` when no data, `{title:SKYNET,body:'(empty message)'}` when parse throws) — Pitfall 3 iOS subscription-survival requirement encoded at the handler, not upstream"
    - "tag: `room-<roomId>` per-notification — iOS stacks by tag natively (D-09 grouping without app-side coalescing); tag fallback to 'skynet-push' if roomId absent"
    - "notificationclick uses clients.matchAll + focus-first-existing-then-navigate — bounded window count per conversation (T-126-18 mitigation); openWindow only when no window exists"
    - "pushsubscriptionchange defensive early-return when oldSubscription.options is null — some browsers don't populate it; silent recovery preferred over throw"
    - "Root-relative URLs throughout (`/`, `/push-subscriptions`, `/?openRoom=<roomId>`) — do NOT prepend BASE_PATH; Pitfall 9 warns __SKYNET_SW_BASE_PATH__ placeholder is unhydrated (literal string in the file), out-of-scope to fix in this plan"

key-files:
  created: []
  modified:
    - public/sw.js  # +78 lines appended after line 97 (three handlers + arrayBufferToBase64Url helper); lines 1-97 byte-identical

key-decisions:
  - "Rule 2 deviation from RESEARCH.md § Pattern 3 verbatim copy: wrapped `event.data.json()` in try/catch. Pattern 3 in RESEARCH.md does NOT catch — it uses `event.data ? event.data.json() : fallback`. The PLAN <action> explicitly overrides this: 'The push handler MUST call showNotification unconditionally — even when payload is malformed, fall back to showNotification(\"SKYNET\", {body:\"(empty message)\"}) rather than returning silently (per Pitfall 3, iOS revokes subscriptions that receive silent pushes).' A malformed JSON payload throwing out of the arrow function without an outer catch would bypass showNotification entirely → silent push → iOS revokes subscription over time. Added try/catch that funnels both branches (no-data + parse-throw) through showNotification with distinct fallback bodies for debuggability. This is Rule 2 (missing critical functionality — iOS subscription-lifetime correctness)."
  - "Rule 2 defense-in-depth: `title = payload.title || \"SKYNET\"` and `body = payload.body || \"\"` — even a well-formed JSON payload with a null/missing title would pass `undefined` to showNotification() which silently no-ops on some browsers. Coerce to safe defaults at the boundary."
  - "Rule 2 defense-in-depth: tag falls back to `\"skynet-push\"` when roomId is absent (rather than `\"room-undefined\"` which would collide across all room-less notifications). Not currently reachable in practice (Plan 05 backend always sets roomId) but the SW handler must be defensive against malformed payloads."
  - "Preserved the RESEARCH.md § Pattern 3 shape faithfully for the other two handlers: notificationclick's clients.matchAll → focus-then-navigate → openWindow cascade + pushsubscriptionchange's re-mint-then-POST cascade + arrayBufferToBase64Url helper — all copied verbatim from research doc lines 439-488 with no functional changes."
  - "Did NOT touch the `__SKYNET_SW_BASE_PATH__` placeholder at sw.js:2 per Pitfall 9 guidance. Placeholder is unhydrated (literal string flows into the STATIC_ASSETS cache paths) — a separate out-of-scope bug to fix (its own plan or triage). This plan's blast radius stayed inside the appended block."
  - "Did NOT add sw.js vitest coverage — RESEARCH.md § Existing Tests notes the repo has no service-worker test pattern (SW is served literally without build/bundle, so vitest's jsdom environment can't exercise the real push event flow). Manual iOS-PWA UAT deferred to deploy time per plan <action> explicit note."

patterns-established:
  - "Hand-written sw.js Append Convention: new handlers land after the last existing handler (fetch, line 97); do NOT reorder, do NOT reformat existing code; every async body wrapped in event.waitUntil() to match the existing install/activate discipline; every push MUST call showNotification (Pitfall 3 is load-bearing on iOS)."
  - "Payload-parse safety pattern: `let payload; try { payload = event.data ? event.data.json() : safe_default; } catch { payload = safe_fallback; }` — reusable for any future SW push handler variants; iOS's silent-push-invalidation heuristic makes this a correctness invariant, not defensive polish."

requirements-completed: [D-06, D-08, D-09, D-13]

# Metrics
duration: 8min
completed: 2026-09-21
---

# Phase 128 Plan 04: Service worker push + notificationclick + pushsubscriptionchange handlers Summary

**Three ServiceWorker event handlers + one pure helper appended to `public/sw.js` (78 new lines, lines 1-97 byte-identical): `push` shows a notification for every event with tag-per-room iOS-native grouping and Pitfall-3 unconditional-showNotification discipline; `notificationclick` deep-links into `/?openRoom=<roomId>` focusing an existing PWA window first; `pushsubscriptionchange` re-mints the subscription via pushManager.subscribe and re-POSTs to /push-subscriptions with credentials:"include" to survive iOS's silent 1-2-week rotation. All acceptance-criteria greps pass; frontend build exit 0; iOS manual UAT deferred to deploy time.**

## Performance

- **Duration:** ~8 min executor time (single-file append, no TDD gate for sw.js — no repo-wide vitest coverage for service workers).
- **Started:** 2026-09-21T02:11:00Z.
- **Completed:** 2026-09-21T02:19:00Z.
- **Tasks:** 1 total (`type="auto"`, no `tdd="true"`).
- **Files created:** 0.
- **Files modified:** 1 (`public/sw.js` — appended 78 lines after line 97).

## Accomplishments

### Task 1 — Append push + notificationclick + pushsubscriptionchange handlers to public/sw.js

- **`push` handler.** Wraps its body in `event.waitUntil()`. Parses `event.data.json()` inside a try/catch (Rule 2 deviation — see below) with two-tier fallback: `{title:"SKYNET", body:""}` when `event.data` is missing, `{title:"SKYNET", body:"(empty message)"}` when JSON parse throws. Coerces `title` and `body` to safe defaults at the boundary. Calls `self.registration.showNotification(title, {body, data:{roomId, agentMxid}, tag:room-<roomId>})` — every branch reaches showNotification unconditionally, which is the load-bearing Pitfall-3 invariant: iOS silently invalidates subscriptions that receive silent pushes. `tag: room-<roomId>` gives iOS the grouping key it needs to stack per-conversation notifications natively (D-09 — no app-side coalescing). `tag` falls back to `"skynet-push"` when roomId is absent so room-less pushes don't collide under `"room-undefined"`. Deliberately does NOT set `renotify: false` — every message must fire a fresh buzz per D-09.
- **`notificationclick` handler.** Wraps its body in `event.waitUntil()`. Calls `event.notification.close()` first. Reads `roomId` from `event.notification.data`. Constructs `targetUrl = roomId ? "/?openRoom=" + encodeURIComponent(roomId) : "/"` — root-relative per Pitfall 9 (BASE_PATH placeholder is unhydrated). Uses `self.clients.matchAll({type:"window", includeUncontrolled:true})`, iterates and focuses the first existing PWA window, calls `.navigate(targetUrl)` if the client supports it, and returns; otherwise falls through to `self.clients.openWindow(targetUrl)`. This bounds the number of PWA windows per conversation (T-126-18 mitigation). The `/?openRoom=<roomId>` shape is consumed by AppShell — Plan 07's remit (Assumption A6).
- **`pushsubscriptionchange` handler.** Wraps its body in `event.waitUntil()`. Reads `event.oldSubscription.options` defensively and early-returns silently when it's null (some browsers don't populate it — Pattern 3's own defensive shape). Re-mints via `self.registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: oldOptions.applicationServerKey})` — re-using the same VAPID pubkey is intended per MDN docs (T-126-20 accepted risk). POSTs the fresh subscription to `/push-subscriptions` with `credentials: "include"` (JWT cookie for T-126-19 spoofing mitigation — backend's authenticateJWT gate validates user-id), `Content-Type: application/json`, body shape matching what Plan 01's POST route expects (`{endpoint, keys:{p256dh, auth}}`). Recovers from iOS's silent 1-2-week / ~100-push rotation (D-13, Pitfall 1) without user re-consent.
- **`arrayBufferToBase64Url(buffer)` helper.** Pure function; converts an ArrayBuffer to a URL-safe base64 string by walking the bytes, applying `btoa`, then replacing `+` with `-`, `/` with `_`, and stripping trailing `=` padding. Used inside `pushsubscriptionchange` to encode both `p256dh` and `auth` keys before POSTing. Wire format matches what web-push and the browser push service expect (RFC 8291 §3.1 semantic).

## Verification

**Automated grep suite (from PLAN <verify> block — all pass):**
| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c 'addEventListener("push"' public/sw.js` | ≥ 1 | **1** |
| `grep -c 'addEventListener("notificationclick"' public/sw.js` | ≥ 1 | **1** |
| `grep -c 'addEventListener("pushsubscriptionchange"' public/sw.js` | ≥ 1 | **1** |
| `grep -c "self.registration.showNotification" public/sw.js` | ≥ 1 | **1** |
| `grep -c "event.waitUntil" public/sw.js` | ≥ 6 (3 existing + 3 new) | **6** |
| `grep -c "openRoom=" public/sw.js` | ≥ 1 | **1** |
| `grep -c "arrayBufferToBase64Url" public/sw.js` | ≥ 2 (def + call sites) | **3** (def + 2 call sites — p256dh + auth) |
| `grep -c 'credentials: "include"' public/sw.js` | ≥ 1 | **1** |
| `grep -c "__SKYNET_SW_BASE_PATH__" public/sw.js` | exactly 1 (preserved) | **1** |
| Lines 1-97 unchanged (`git diff HEAD~1 -- public/sw.js | grep -E "^-" | grep -v "^---" | wc -l`) | 0 | **0** |

**Frontend build gate:** `npm run build` — **exit 0** (15.46s). SW file itself is served literally without build (existing pattern: `public/` static passthrough), so build isn't validating sw.js syntax directly — but no other frontend file references sw.js in a way the build could break.

**Vitest scoped:** N/A — repo has zero service-worker vitest coverage (verified: `grep -r "public/sw.js" src/` returns empty; `find src -name "sw.test.*"` returns empty). Consistent with RESEARCH.md § Existing Tests note: "there is no existing service-worker test pattern in the repo... [SW tests are deferred] to manual UAT since the SW is served literally without a build step." Manual iOS-PWA UAT deferred to deploy time (orchestrator scope, not executor's remit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Wrapped `event.data.json()` in try/catch (iOS subscription-lifetime correctness)**

- **Found during:** Task 1 handler assembly (before commit).
- **Issue:** RESEARCH.md § Pattern 3 (the verbatim source per PLAN <action>) uses `const payload = event.data ? event.data.json() : { title: "SKYNET", body: "" };` — no catch. A malformed push payload (any non-JSON bytes on the wire) throws SyntaxError out of the arrow function → the `event.waitUntil(self.registration.showNotification(...))` line never executes → silent push from iOS's perspective → iOS invalidates the subscription over time (Pitfall 3, D-13 silent-rotation heuristic). The PLAN <action> explicitly overrides the verbatim-copy directive here: "The push handler MUST call showNotification unconditionally — even when payload is malformed, fall back to `showNotification(\"SKYNET\", { body: \"(empty message)\" })` rather than returning silently." Rule 2 applies — this is a correctness requirement for the iOS PWA subscription lifetime.
- **Fix:** Added try/catch around the parse. Two-tier fallback structure: no-data branch keeps the original `{title:"SKYNET", body:""}` fallback (empty body is a valid deliberate case — e.g. reaction-only or system-triggered generic push, though not in this phase's D-scope); catch branch uses `{title:"SKYNET", body:"(empty message)"}` (distinct body for debuggability — Ashley or a log-grep would be able to tell "the backend sent malformed JSON" from "the backend sent no data" if she ever sees these). Also coerced `title = payload.title || "SKYNET"` and `body = payload.body || ""` — even a well-formed JSON payload with null/missing title would pass `undefined` to showNotification() (silent no-op on some browsers, another Pitfall-3 trap). And made the tag fall back to `"skynet-push"` when `roomId` is absent (avoids `"room-undefined"` collision across all room-less pushes).
- **Files modified:** `public/sw.js` (push handler block only — added ~8 lines vs the verbatim Pattern 3).
- **Commit:** `f5fd2be4`.

No architectural deviations. No Rule 4 (ask-user) escalations. Zero blockers.

## Threat Flags

None — this plan's threat surface stays within `<threat_model>` in `128-04-PLAN.md`. All five threats (T-126-16 through T-126-20) are mitigated per the plan's disposition: JSON-parse fallback + unconditional showNotification (T-126-16/17), clients.matchAll focus-first (T-126-18), credentials:"include" carries the user's JWT for backend's authenticateJWT gate at Plan 05 (T-126-19), applicationServerKey re-use is accepted per MDN semantics (T-126-20).

## Known Stubs

None. The three handlers are fully wired. The `notificationclick` handler produces a URL (`/?openRoom=<roomId>`) that AppShell must consume in a future plan (Plan 07 per Assumption A6) — this is a documented cross-plan dependency, not a stub; a click on a notification today produces a well-formed navigation event that AppShell will honor once Plan 07 lands. The `pushsubscriptionchange` handler POSTs to `/push-subscriptions` which Plan 01 already landed — this leg is end-to-end complete.

## Runtime State (nothing new)

This plan does not introduce or mutate any stored data, live service config, OS-registered state, or secrets. It appends dead code to a static file — nothing wakes up until (a) a browser installs the updated SW at next PWA update and (b) the backend actually sends a push (Plans 05 + 06, not shipped yet).

## Manual UAT (deferred to deploy time — orchestrator scope)

Per PLAN <action> explicit note and RESEARCH.md § Existing Tests policy: this executor did NOT test on a real iOS device. The three handlers land as syntactically-valid JavaScript that passes the acceptance-criteria greps and does not break the frontend build. End-to-end validation (a real APNs-routed push landing on the lock screen of Ashley's PWA, tapping it opening the room, silent subscription rotation triggering re-POST) happens at deploy time when the full stack (Plans 01-11) is on production. That UAT is the orchestrator's remit, not this executor's.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `f5fd2be4` | feat(128-04-1): append push + notificationclick + pushsubscriptionchange handlers to sw.js |

## Self-Check: PASSED

- `public/sw.js` exists at expected path and contains all four new symbols (three handlers + helper): **FOUND**
- Commit `f5fd2be4` exists in `git log --oneline --all`: **FOUND**
- No untracked files, no unstaged changes after commit: **CLEAN**
- Lines 1-97 of `public/sw.js` unchanged (git diff shows +78 additions, 0 deletions): **VERIFIED**
