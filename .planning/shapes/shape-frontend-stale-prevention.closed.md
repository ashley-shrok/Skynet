# Shape: ensure users are never running on anything client-side stale for any amount of time

**Opened:** 2026-09-21
**Vehicle:** GSD phase

## What this is

Skynet is about to be rolled out to a hundred new users. This work adds a mechanism that guarantees the version of the app running in any user's browser is always in agreement with the version of the app the server is currently deployed as — and if the two ever diverge, the browser locks itself out of doing further work and shows the user a plain surface asking them to reload. There is no in-between state; a session is either provably current or provably stale, and stale sessions cannot silently continue.

## Shape

Four parts, working together:

**A version tag, produced at every deploy.** The server always knows the tag of what it is currently serving. The browser carries the tag of the version it loaded, from the moment it started running.

**A stamp on every meaningful exchange.** The browser attaches its own tag to every request it makes. The server attaches its own tag to every response it sends and every message it emits over its persistent connection to each tab. In both directions, either side notices drift on the very next exchange.

**A refusal at the server.** The server rejects any request whose stamp does not match its own current tag. This runs before any business logic sees the request. Requests without any stamp pass through unaffected — this is only a check for mismatched stamps, not for absence.

**A lock at the browser.** On the first drift signal — a rejected request, a response with a differing tag, or a mismatched handshake on the persistent connection — the app enters a locked state. All further activity halts: new requests do not go out, incoming updates do not paint, running interactions stop. A plain surface fills the screen with a single button that reloads the app. The user clicks it, the browser reloads, the tab now runs the current version.

Around those four, two supporting disciplines:

**The shell page the browser first fetches is never served from cache.** Every visit refetches the shell, so it always points at the correct asset names for the current deploy. The referenced assets themselves are named uniquely per build, so caching them aggressively is safe and desired.

**The check distinguishes stale from server-temporarily-down.** A failed request during a deploy restart is not the same as a mismatched-tag response. The lock only fires on a successful response with a mismatched tag, never on failures. The existing reconnecting-affordance handles the restart window.

## Philosophy

The stance is strict. There is no third state between "provably current" and "provably stale." A session that cannot verify its version is not trusted to keep going. The response to drift is uniform: hard lock, one button, click to reload. No dismissal, no delay, no countdown.

Deliberately not doing:

- **No dismissible modal.** The lock is non-negotiable.
- **No draining of typed-but-unsent text into browser storage.** Unsaved compose text is lost on reload. Users learn to send before leaving the app open indefinitely.
- **No cross-tab coordination.** Each tab is on its own; a user with five tabs open through a deploy sees five modals and clicks five times. Simpler mechanism, no wrong states to debug.
- **No update-worker path.** The web platform's resident background helper concept — the standard progressive-web-app answer — adds a layer of subtle lifecycle bugs for a benefit (offline-first version detection) Skynet does not need. An offline Skynet cannot do anything useful anyway.
- **No timeout-based warning banners.** No "this tab has been open a while, consider refreshing." The mechanism catches drift when drift actually occurs, not on a clock.
- **No per-user opt-out.** This is a fleet-wide safety property, not a preference.

The spirit is caught if the mechanism works reliably. That is the only failure mode.

## Prior context

Skynet is a browser-facing app served from a single container behind an edge proxy. Deploys are atomic: the container recreates, the process restarts, there is no rolling window where two versions of the server exist simultaneously. The app keeps a persistent bidirectional connection open to every open tab — for terminal streams, remote-desktop panes, chat — and that connection can be reused as a detection surface for free.

The reference implementation for the mechanism is Ashley's own separately-maintained framework (vms), which shipped this exact class of feature as a hard-lock. Its philosophy — hard modal, user-consented reload, no third state — is what this design adopts. The mechanism it uses — stamping every request and response with a version tag — carries over directly, extended for Skynet by additionally stamping the messages on the persistent connection, because Skynet has that channel available where the reference implementation's target apps do not.

The immediate motivating context: the app is about to be handed to a hundred new users, and stale-frontend bugs are a known class of report noise that grows with user count. This work removes that class from the possible reports.

Two pieces of the surrounding system that the design assumes but does not yet verify — worth a factual check at plan- or execute-time:
- Whether the shell page is currently subjected to a policy that guarantees it is never cached at the edge or in the browser under any condition.
- What the deterministic source of the version tag will be, that both the browser bundle and the running server can agree on (the compiled asset manifest, the commit identifier, a build-time nonce — a plan-time decision).

## What would make it wrong

The mechanism fails to fire when it should. A code path exists that a stale session can travel that does not stamp its request, so the server never learns of the mismatch. A stale session interacts and gets a valid-looking response from the current server because the check was skipped somewhere.

The mechanism fires when it should not. A user on the current version is falsely flagged as stale and locked out of a working app. Possible causes: the server-computed tag and the browser-baked tag drift apart despite the code being identical (a hashing inconsistency between them), a race between deploy completion and the server picking up its own new tag, a bug in how the tag is compared.

The reload does not deliver a fresh session. The user clicks the button, the browser reloads, and the shell page is served from cache — so the reloaded app is still stale, and the mechanism fires again on the very next interaction. The mechanism must never enter a loop that a user cannot escape.

## Scope edges

**In:**
- Every browser-facing request path Skynet exposes
- The persistent connection between the browser and the server
- The shell page the browser first fetches
- The lock experience on the browser

**Out:**
- The separately-branded file-browsing surface fronted alongside Skynet at the edge; different app.
- The remote-desktop pane's own version-drift concern; the underlying protocol is not Skynet's code.
- Non-browser callers hitting Skynet's server (the substrate distributor, scripted testing, external agents driving the API); these do not carry a stamp and are unaffected by mismatch-only enforcement.

**Deferred:** None identified. The user's grill answer: "we kind of caught all the edges already."

**Tempting but no:**
- The resident-background-helper path for detection.
- Any cross-tab coordination of the lock or the reload.
- Any preservation of unsaved work through the lock.
- Any per-user preference to soften the lock.

## Vehicle notes

**Vehicle:** GSD phase. Phase-sized: several coordinated pieces (build-time tag production, server-side stamping and refusal, client-side interception and handshake, lock surface, shell-page cache-header discipline) that ship as a unit and become user-visible on every deploy after this lands. Warrants a plan, a review, and verification against a real staging.

**Identity holding this:** rio, on t1000, in the box-maintainer role.

**Working tree:** `~/fleet/identities/rio/workspace/skynet` on the currently active branch.

**Downstream note:** the same code also serves a downstream deployment maintained separately. Whatever ships here rides along on the downstream's next pull; that consumer sees the same behavior by design. Not a follow-up bounty — the mechanism is universal.

**Baseline factual check worth doing at plan- or execute-time:** whether the shell page is currently cached at the edge or by the browser under any conditions today. That drives whether the cache-header discipline in this phase is a change or a codification.

**Closing artifact:** `/close` at the end of the arc.

---

## Close-Out

**Closed:** 2026-09-23
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Version-tag agreement mechanism between browser and server; drift produces a hard lock with reload-only recovery.
- **Shape: A version tag produced at every deploy** — present · Vite `define` bakes `VITE_BUILD_ID`; Dockerfile propagates `SKYNET_BUILD_SHA` through all three stages; server reads once at module load; both sides derive from the same env source.
- **Shape: A stamp on every meaningful exchange** — present · Axios interceptor stamps `X-Skynet-Client-Build` across all 8 instances; `stampedFetch` wraps raw-fetch sites; EventSource uses `?build=` query param; WS handshake URLs include `?build=`; server stamps every response with `X-Skynet-Server-Build`; JSON-envelope WS servers piggyback `build:` on every outbound message; guacamole uses encrypted-token `buildId`.
- **Shape: A refusal at the server** — present · Middleware refuses mismatched-tag requests with 409 `stale_client`; mounted AFTER `serveUrlHandler` and BEFORE `bodyParser`; absence of stamp passes through unaffected.
- **Shape: A lock at the browser** — present · Store is idempotent first-drift-wins; modal mounted at App root as sibling of Toaster; `role=dialog`, `aria-modal`, full-viewport backdrop, `inert` on `#root`, single Reload button, no Esc/click-outside handlers.
- **Shape: Shell page never served from cache** — present · `no-store` in both nginx configs, mirrored by Express in two sites; vitest presence-guards defend against removal. Bundled assets remain immutably cacheable via Vite content-hash filenames.
- **Shape: Distinguish stale from server-temporarily-down** — present · Response interceptor lock only fires on successful responses or explicit 409 `stale_client`; connection-level failures fall through to the existing retry/backoff path without locking.
- **Philosophy: strict — no third state, uniform hard-lock response** — present · One modal, one button, no dismissal path in the code; idempotent so first drift wins.
- **Philosophy: no dismissible modal** — present · No X, no Esc handler, no backdrop onClick — verified by reading.
- **Philosophy: no draining of typed text to storage** — present · No code writes compose text to browser storage on lock; reload discards it.
- **Philosophy: no cross-tab coordination** — present · Sentinel uses `sessionStorage` (per-tab) not `localStorage`; store is module-scope per-tab.
- **Philosophy: no update-worker path added** — present · Pre-existing PWA service-worker hook NOT modified this phase; no new SW-driven version-detection added.
- **Philosophy: no timeout-based warning banners** — present · No "tab open a while" timer anywhere in the diff.
- **Philosophy: no per-user opt-out** — present · No preferences flag governing the lock; unconditional.
- **Prior context: single container, atomic deploy, persistent connection reused** — present · All 5 JSON-envelope WS surfaces (terminal, docker-console, claude-session, fleet-status, relay-room-stream) plus guacamole use their existing connection as a drift-detection surface.
- **Prior context: shell-page caching factual check** — present · The plan-time factual check landed as explicit codification with load-bearing comments and vitest guards.
- **Prior context: deterministic tag source decision** — present · `SKYNET_BUILD_SHA` is the deterministic source, threaded through docker-compose → Dockerfile ARG → ENV `VITE_BUILD_ID`; byte-identical on both ends.
- **What would make it wrong: a code path that skips the client stamp** — present · Axios factory covers all 8 instances; `stampedFetch` covers raw-fetch call sites with two annotated third-party exemptions; EventSource stamps via query param; WS URLs include `?build=` at all four sites plus guacamole encrypted token.
- **What would make it wrong: false positive lock on a current-version user** — present · Both sides read the same `VITE_BUILD_ID` env from the same `SKYNET_BUILD_SHA` ARG; no per-side hashing; exact-string comparison on both lanes.
- **What would make it wrong: reload does not deliver a fresh session (loop)** — present · Three-layer `no-store` plus vitest presence guards; reload-loop sentinel activates fatal-mode with support-message after 4 attempts in 60s.
- **Scope: browser-facing HTTP paths + persistent connection + shell + lock experience** — present · All four in-scope surfaces covered.
- **Scope out: file-browsing subdomain, remote-desktop protocol proper, non-browser callers** — present · Serve-url subdomain traffic bypasses the middleware; remote-desktop protocol frames not stamped (Pitfall 1 acknowledged in code); non-browser HTTP callers pass through because refusal is mismatch-only.

### Additions (in the result, not in the shape)

- None.

### Follow-ups

- None.

### Notes

The mechanism is airtight-by-construction as the shape's philosophy demands. Three implementation details worth carrying forward: (a) EventSource stamps via query-param because the browser's SSE API cannot attach custom headers — the middleware accepts either lane; (b) guacamole's third-party wire format prevents per-frame piggyback, so its encrypted-token `buildId` is the sole drift-refusal point, mirrored on the client via a distinguishable `SKYNET_STALE_CLIENT:` error prefix analogous to the existing takeover-refusal `SKYNET_SUPERSEDED:`; (c) the sessionStorage-per-tab reload sentinel with 4-attempts-in-60s fatal-mode cleanly instantiates the shape's "must never enter a loop the user cannot escape" failure mode. Live deploy behavioral verification against production remains a UAT gate outside `/close`'s scope.
