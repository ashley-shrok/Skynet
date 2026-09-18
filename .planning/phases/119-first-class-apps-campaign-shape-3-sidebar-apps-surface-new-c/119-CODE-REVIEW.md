# Phase 119 — Unbiased Code Review

**Reviewer:** general-purpose bug/security/correctness sweep (fresh eyes, no conformance context)
**Scope:** commits `dc242c89..HEAD` on `feat/tab-title-from-tmux` (19 commits landing shape 3)
**Date:** 2026-09-18
**Method:** static reading of source + tests + reference implementations; NO app run, NO test run.

## Severity counts

- BLOCKER: 0
- HIGH: 2
- MEDIUM: 4
- LOW: 4
- NOTE: 2
- REQUIRES-VERIFICATION: 1

---

## HIGH

### H1. "Open in new tab" navigates to a URL that does not resolve to the running app

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:183, 197`
- **Issue:** The tile computes `openUrl = /apps/${app.hostId}/${app.slug}` and passes it to `window.open`. There is **no backend or frontend route** that serves `GET /apps/:hostId/:slug` — the only route mounted under `/apps` is `/apps/:hostId/:slug/icon` (see `src/backend/database/routes/apps.ts:53-54` and the mount at `src/backend/database/database.ts:1982`). Skynet-served apps live at the serve-URL subdomain shape `<hostname>-<port>.serve.<domain>[/path]` (see `src/ui/features/pretty-view/editable-file-whitelist.ts:147` and the `subdomain-dispatch` middleware at `src/backend/serve-url/subdomain-dispatch.ts:1-80`), NOT on the primary origin under `/apps/...`. Consequently, when the user clicks "Open in new tab", the fresh tab lands on Skynet's SPA fallback (`src/backend/database/database.ts:2082-2108` serves `index.html` for any GET that accepts HTML), not on the app. The shape's "What would make it wrong" list explicitly names this failure mode: *"Opening a tile in a new tab lands on an unauthenticated page. If the 'Open in new tab' action produces a tab that greets the user with a login prompt (or worse, a blank page), the only user-visible action in this shape has failed."*
- **Note:** `AppState` carries a `port` field (`src/ui/api/fleet-status-types.ts:140`) but no hostname; hostId is a numeric string. The tile has neither the hostname nor the domain to construct the correct serve-URL. Fixing this correctly likely requires (a) surfacing the hostname on the wire (either in `AppState` or via a host-resolver), and (b) computing `<hostname>-<port>.serve.<SKYNET_COOKIE_DOMAIN>` at the tile boundary — or an equivalent Skynet-hosted redirect endpoint that resolves `hostId → hostname` server-side.
- **Suggested fix:** Either (i) add a real `GET /apps/:hostId/:slug` redirect route that resolves the hostId → hostname and issues a 302 to `<hostname>-<port>.serve.<domain>`, or (ii) enrich `AppState` with the hostname + effective serve URL so the tile can navigate directly. The current single-user-visible action of this shape does not reach the app.
- **Rationale:** HIGH because this is the shape's ONE user-visible action and it does not produce the intended behavior; the shape file's failure-mode wording matches this exact bug.

### H2. `.pv-app-tile` inherits the wrong hue (190) from `.dark`, not the shape-specified 216

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/pretty-conversations.css:1397-1470` (and inline comment on `AppTile.tsx:66-71` claims otherwise).
- **Issue:** Every `.pv-app-tile` style uses `hsla(var(--pv-hue), ...)` with NO fallback value (compare to `.pv-avatar` at line 428-431, which does the same but is always nested inside `.pv-row` which sets `--pv-hue: 216` at line 338). `.pv-app-tile` is NOT nested inside `.pv-row` — it renders inside `<div className="pv-panel-group pv-apps-section">` inside `<div id="pv-apps-section-content">`. Neither the `.pv-apps-section` selector nor `.pv-panel-group` sets `--pv-hue`. The next `--pv-hue` up the tree is `.dark { --pv-hue: 190 }` at `src/ui/index.css:196` — an app-wide teal accent, NOT the sidebar row's blue neutral 216. The AppTile source comment at lines 66-71 claims "The .pv-row fallback declared at pretty-conversations.css:338 cascades into .pv-app-tile via CSS inheritance." That claim is wrong: custom properties inherit from ANCESTORS, not siblings, and `.pv-row` is a sibling to `.pv-app-tile`. The CSS comment at line 1382-1384 makes the same wrong claim.
- **Impact:** The app tile visual does not match "the sidebar's default row hue (the hue that identity rows fall back to when no per-cosmetics colour has been supplied)" as the shape requires. Instead it takes the app-wide 190 accent — a visible, contract-violating deviation.
- **Suggested fix:** Either (a) set `--pv-hue: 216` explicitly on `.pv-app-tile` (or on `.pv-apps-section`) so the child rules resolve to the intended hue, or (b) use `hsla(var(--pv-hue, 216), ...)` on every reference inside `.pv-app-tile` + `.pv-app-icon-slot` so the "sidebar row fallback" is baked into the fallback value. Option (a) is closer to the pattern already used by `.pv-row`.
- **Rationale:** HIGH because D-09 is one of the shape's explicit visual invariants and the CSS is provably wrong under inheritance rules. Marking HIGH rather than MEDIUM because the source comments in TWO files (AppTile.tsx + CSS) both assert the false inheritance, so any future edit that trusts the comment will perpetuate the bug.

---

## MEDIUM

### M1. `iconUrl` and `openUrl` do not encode-defensively

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:182-183`
- **Issue:** `` `/apps/${app.hostId}/${app.slug}/icon` `` is a template-string interpolation with no `encodeURIComponent`. Today the backend guarantees `hostId` is a numeric string and `slug` is kebab-case per `APP_SLUG_RE`, so this is safe. But it makes the frontend depend on invariants declared on the OTHER side of the wire; a backend regression that widens the slug shape (or a future migration) would expose an unencoded interpolation. Not a live security issue today.
- **Suggested fix:** `` `/apps/${encodeURIComponent(app.hostId)}/${encodeURIComponent(app.slug)}/icon` `` — cheap, defensive, and matches modern URL-construction discipline. Same for `openUrl`.
- **Rationale:** MEDIUM (not HIGH) because APP_SLUG_RE is enforced on both the write-side (create-app.sh) and the wire (backend AppStateSchema), so the current attack surface is nil.

### M2. `readAppIconFile` remote branch races the `ls` probe against SFTP read

- **Where:** `/home/ubuntu/skynet-vision/src/backend/claude-session/identity-artifact-reader.ts:2656-2671`
- **Issue:** The remote branch runs an `ls` probe, gets a non-empty result, then issues `sftpReadFile(targetPath)`. Between those two SSH round-trips, the file could be deleted (rare, but possible during a sweep or an app-removal in-flight). In that case `sftpReadFile` will throw, which the route catches and turns into a 502 ("app home box unreachable") — but the file is not really unreachable; it's genuinely absent. A user would see 502 instead of the more accurate 404. This mirrors `readAvatarSiblingFile`'s pre-existing behavior at lines 2582-2589, so it's not a regression, but it's worth flagging.
- **Suggested fix:** Catch `ENOENT`-shaped errors from `sftpReadFile` in the REMOTE branch and return `null` (→ 404) rather than throwing (→ 502). Or accept the small inaccuracy for parity with identity-avatar and document it.
- **Rationale:** MEDIUM — status-code correctness bug that misleads clients on a valid race.

### M3. Icon-endpoint error messages are canned but log emissions are absent

- **Where:** `/home/ubuntu/skynet-vision/src/backend/database/routes/apps.ts:92-125`
- **Issue:** The `catch` blocks swallow SSH/SFTP exceptions silently — no `sshLogger.warn/error` call before returning the canned 502 body. Compare to the identity-avatar route at `identities.ts:849-966` which similarly swallows without logging, so this is pattern-parity, but production diagnosability suffers when both routes go silent. A recurring 502 on a specific slug/hostId has no fingerprint in the logs beyond the entry-level access log.
- **Suggested fix:** Add a `sshLogger.warn({ operation: "apps_icon_ssh_error", hostId, slug, errMessage: e.message })` inside each `catch` before the 502 return, and one inside the `try/finally` `catch` around `readAppIconFile`.
- **Rationale:** MEDIUM — the endpoint should be operationally observable; silent 502s are a debugging tax.

### M4. Test coverage misses: (a) icon-endpoint LOCAL branch 502-on-throw; (b) missing route-level test for `SlugRE` inside `readAppIconFile` from the route; (c) no test covers the ETag validation path with an "If-None-Match" that does NOT match

- **Where:** `/home/ubuntu/skynet-vision/src/backend/database/routes/apps.test.ts`
- **Issue:**
  1. T12d asserts LOCAL branch returns 200 on present. No test covers LOCAL branch where `readAppIconFile` throws (e.g., oversized file) — the route's `catch` block would return 502 in that case, but that path is unproven.
  2. The route delegates slug validation to APP_SLUG_RE at the route boundary AND inside `readAppIconFile`. No integration test asserts what happens when a slug that passes the ROUTE regex is somehow rejected by the reader (impossible today, but the defense-in-depth was called out explicitly).
  3. Test T9 covers `if-none-match matches → 304`. No test covers `if-none-match provided but does NOT match → 200 with fresh bytes`. Given the code uses `ifNoneMatch === etag` strict equality, a client sending a stale ETag would (correctly) get 200 — but this path is unproven.
- **Suggested fix:** Add three tests to `apps.test.ts` covering the paths above.
- **Rationale:** MEDIUM — these are code paths in the shipped route with no coverage; not a live bug but a hole in the safety net.

---

## LOW

### L1. `suppressNextClickRef` is dead weight in v1

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:96-106, 148`
- **Issue:** The ref is created, void-referenced to satisfy the lint, set to `true` inside the long-press timer, and never consumed. The extensive comment explains it's a "forward-compat pin for shape 4". This is a genuine judgment call — leaving it in creates cruft; removing it forces re-verification in shape 4. As-is, the code is safe but a reader has to stop and understand why `void suppressNextClickRef;` exists.
- **Suggested fix:** Either delete now and re-add in shape 4 (simplest), or keep the ref but delete the `void suppressNextClickRef;` line by consuming the ref in a real onClick guard (defensive: a synthesized click could still fire from a long-press on some devices; even in v1 with no click behavior, guarding it costs nothing).
- **Rationale:** LOW — a maintainability wart rather than a bug.

### L2. `AppTile` includes `useCallback` wrappers that could be plain functions

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:108-177`
- **Issue:** The handlers are wrapped in `useCallback` but the `<div>` they're attached to is not memoized and the tile does not pass them down to a memoized child. The memoization has no rendering benefit. Not a bug, just noise.
- **Suggested fix:** Optional; drop `useCallback` unless there's a downstream memo consumer.
- **Rationale:** LOW — cosmetic; no impact on correctness or performance.

### L3. `void snapshotVersion;` at bottom of `app-tiles-store.ts` is a code smell

- **Where:** `/home/ubuntu/skynet-vision/src/ui/state/app-tiles-store.ts:209-210`
- **Issue:** The `snapshotVersion` counter is bumped by `notify()` but never read (the `useSyncExternalStore` reader keys off the Map identity, not the counter). The `void snapshotVersion;` line silences the "declared but never read" TS warning. Since the counter has no consumer, it's dead code — the mutation on every notify is pure waste.
- **Suggested fix:** Delete both the `let snapshotVersion = 0;` declaration and the `void snapshotVersion;` line, and remove the `snapshotVersion += 1;` inside `notify()`.
- **Rationale:** LOW — pure dead code.

### L4. `iconUrl` fetched with no cache-busting means an app icon replaced on disk needs a manual reload

- **Where:** `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:182`
- **Issue:** The URL is `/apps/${hostId}/${slug}/icon` with no cache-busting query. Backend sends `Cache-Control: no-store` + `ETag` (`apps.ts:117-118`), so the browser will validate on next navigation but not for images that are already in the layout tree. If a user replaces an app's icon on disk and the WS emits `app-update`, the store re-renders the tile, but the `<img src>` is unchanged so the browser reuses the cached image (300 In-Memory) without re-validating.
- **Suggested fix:** Include a cache-key derived from something that changes when the icon changes — e.g. `?v=${app.createdAtMs}` or a dedicated `iconVersion` field on `AppState`. The current shape doesn't include an iconMtime — a follow-up would need one.
- **Rationale:** LOW — icons don't change often; workaround is a browser hard-reload.

---

## NOTE

### N1. No general HTTP rate limiter on the icon endpoint

- **Where:** `/home/ubuntu/skynet-vision/src/backend/database/routes/apps.ts` (and by extension, all routes on this backend)
- **Issue:** Skynet has no general HTTP rate-limiter middleware. `loginRateLimiter` exists (`src/backend/utils/login-rate-limiter.ts`) but is only wired to auth-flow routes. The icon endpoint is JWT-gated so unauthenticated enumeration is off the table. But a compromised or hostile authenticated user could enumerate (hostId, slug) tuples at wire speed to map the shape of other users' fleets — the 502 body is canned and identical for "unknown host" and "no access", but response TIMING differs (unknown host: fast DB miss; unreachable host: 5s connect timeout). This is a classic timing side channel. Mirrors identity-avatar; not new to this PR. Not a concrete new attack surface.
- **Suggested fix:** Follow-up scope. Either add a per-user request throttle at the middleware layer, or intentionally equalize timing on the 502 path (e.g. `await sleep(500ms)` before returning). Neither is required by the shape.
- **Rationale:** NOTE — inherited pattern, not a regression.

### N2. `execWithTimeout` timer leak (inherited pattern)

- **Where:** `/home/ubuntu/skynet-vision/src/backend/claude-session/identity-artifact-reader.ts:383-396`
- **Issue:** `execWithTimeout` uses `Promise.race` between the real exec and a `setTimeout` reject. When exec resolves first, the setTimeout is NOT cleared — the timer continues to sit in the event loop until it fires. On a busy backend serving many concurrent icon requests, this accumulates thousands of pending timers, each holding a closure reference. Not a live crash; a minor memory/perf tax. Existed before Phase 119.
- **Suggested fix:** Store the timer id, `clearTimeout` in a `.finally()`. Out of scope for this PR; worth a bounty.
- **Rationale:** NOTE — pre-existing, not introduced by this PR.

---

## REQUIRES-VERIFICATION

### V1. Timing side-channel on 502 response between "unknown host" and "unreachable host"

- **Where:** `/home/ubuntu/skynet-vision/src/backend/database/routes/apps.ts:82-97`
- **Issue:** `resolveHostById` returns null for both (a) hostId doesn't exist, and (b) hostId exists but the user has no access. Both return the same canned 502 body immediately (fast). But (c) hostId exists AND user has access AND SSH connection fails takes up to 5s (`connectOneShot(host, 5_000)`). A timing-capable attacker could distinguish (a)+(b) from (c) — i.e., learn WHICH hostIds are in their access set (and by inference, which are not).
- **Verification required:** Confirm whether this is a real threat given the deployment model (single-tenant Skynet per user? multi-tenant with shared backend?). If single-tenant, this is a non-issue. If multi-tenant, it's a real cross-tenant enumeration primitive.
- **Rationale:** Requires-verification — the actual threat depends on deployment topology, not just code shape.

---

## Coverage of the focus areas from the review brief

- **Security: auth gate, path traversal, command injection, ETag, error responses, SSH cleanup, rate-limit** — Auth gate is present and tested (T1). APP_SLUG_RE gates BOTH at the route and inside `readAppIconFile` (defence-in-depth verified). SSH interpolation is safe (regex forbids `/`, `.`, `$`, `;`, `` ` ``, whitespace). ETag correct. Error responses use canned 502 body (no info leak). `finally { conn.end() }` covers 200/304/404/502 exit paths (tests T12/T12b/T12c). Rate-limit gap: see N1.
- **Tabnabbing** — `window.open` invocation at AppTile.tsx:197 has `"noopener,noreferrer"`. Only one invocation site (grep-verified). PASS.
- **Store correctness / atomic reconciliation** — Store replaces `state.map` atomically per publish. No race in single-threaded JS event loop. Sort is stable (title, then compound key tiebreak). Cleanup on unmount handled via `useSyncExternalStore` subscription lifecycle. PASS with L3 note.
- **Type-mirror gap / dispatch** — Three new frame types added to `FrontendOutboundFrame`; three switch arms added in dispatch; three optional callbacks added to `FleetStatusClientOptions`. Tests verify dispatch, unknown-type fallthrough, and callbacks-omitted safety. PASS.
- **Lazy-render invariant** — `{appsExpanded && (<div ...>tiles OR empty prompt</div>)}` gates ENTIRE body; A16 test locks it. PASS.
- **Sidebar placement outside search-vs-three-zone ternary** — Verified at PrettyConversationsPanel.tsx:1879 (outside the ternary at :1927); A19/A20 tests lock it. PASS.

---

## Structured completion signal

```
counts:
  BLOCKER: 0
  HIGH: 2
  MEDIUM: 4
  LOW: 4
  NOTE: 2
  REQUIRES-VERIFICATION: 1
```

---

## Fix pass — 2026-09-18

**Scope:** all 2 HIGH + all 4 MEDIUM findings fixed in a single atomic
pass on `feat/tab-title-from-tmux`. Sequential commits, one per finding
(or one per tightly-coupled group). All tests green. LOW / NOTE / V1 items
NOT touched — they remain open per their severities.

| Finding | Status | Commit | Files touched |
|---------|--------|--------|---------------|
| HIGH-1  | Fixed  | `11eb75fc` | `apps.ts`, `apps.test.ts`, `starter.ts`, `fleet-status/registry-holder.ts` (new) |
| HIGH-2  | Fixed  | `daafb0e5` | `pretty-conversations.css`, `AppTile.tsx`, `AppTile.test.tsx` |
| MEDIUM-1 | Fixed | `03fe725b` | `AppTile.tsx` |
| MEDIUM-2 | Fixed | `327aa65f` | `identity-artifact-reader.ts` |
| MEDIUM-3 | Fixed | `e150df2a` | `apps.ts` |
| MEDIUM-4 | Fixed | `1644540c` | `apps.test.ts` |

### Fix summaries

**HIGH-1 (`11eb75fc`) — GET /apps/:hostId/:slug redirect route.** Added a
new redirect route alongside the icon route in `apps.ts`. Resolves
(hostId, slug) via `resolveHostById` + fleet-status registry snapshot
and issues `302 https://<hostname>-<port>.serve.<SKYNET_COOKIE_DOMAIN>`.
New `fleet-status/registry-holder.ts` module-scope singleton bridges the
closure-scoped registry to HTTP-route context; starter.ts populates it
right after `startFleetStatusServer` returns. 12 new tests cover every
branch (auth / validation / env-missing / host-unresolvable /
registry-missing / app-missing / port-null / 302-happy / D-13 case
preservation).

**HIGH-2 (`daafb0e5`) — explicit `--pv-hue: 216` on `.pv-app-tile`.**
Fixed the false-inheritance bug where `.pv-app-tile` fell through to
`.dark { --pv-hue: 190 }` because it's a SIBLING (not descendant) of
`.pv-row`. Rewrote the misleading docblocks in AppTile.tsx + the CSS to
accurately describe the requirement. Added Test L to AppTile.test.tsx
that injects the CSS rule into JSDOM and asserts computed --pv-hue = 216.

**MEDIUM-1 (`03fe725b`) — encodeURIComponent on AppTile URLs.** Wrapped
`app.hostId` and `app.slug` in `encodeURIComponent` for both iconUrl +
openUrl. Cheap defence-in-depth against future backend regressions
widening either shape.

**MEDIUM-2 (`327aa65f`) — ENOENT catch in readAppIconFile REMOTE branch.**
Wrapped `sftpReadFile` in try/catch; ENOENT-shaped errors (ssh2 code
`=== 2` OR message matches `/no such file|enoent/i`) return null → 404
instead of falling through to the route's 502 catch. Corrects a
status-code mismatch on the ls-probe → SFTP-read race.

**MEDIUM-3 (`e150df2a`) — sshLogger.warn in icon-route error branches.**
Added structured warns at all three 502 branches (host unresolvable,
SSH connect throw, SFTP read throw). Payload discipline mirrors
identity-avatar: minimal (hostId, slug, errMessage). Response body
unchanged (still canned "app home box unreachable").

**MEDIUM-4 (`1644540c`) — three new coverage-gap tests.**
- T13: LOCAL branch 502-on-throw (readAppIconFile rejects)
- T14: slug with `_` fails route-boundary APP_SLUG_RE → 400, reader
  never called (defence-in-depth invariant lock)
- T15: If-None-Match provided but does NOT match → 200 with fresh
  bytes + fresh ETag (stale-client-ETag fall-through)

### Test posture

- `npx vitest run src/backend/database/routes/apps.test.ts` → **30 tests
  pass** (15 pre-fix + 3 MEDIUM-4 + 12 HIGH-1 = 30).
- `npx vitest run src/ui/features/pretty-conversations/AppTile.test.tsx`
  → **12 tests pass** (11 pre-fix + 1 HIGH-2 regression test).
- `npx vitest related --run src/backend/claude-session/identity-artifact-reader.ts`
  → **65 test files, 1091 tests pass**.
- `npx vitest related --run src/ui/features/pretty-conversations/AppTile.tsx`
  → **7 test files, 171 tests pass**.
- `npm run type-check` (frontend) → **exit 0, clean**.
- `npm run build:backend` → 26 pre-existing errors in
  `src/backend/distributor/catalog.ts` (unrelated to this fix pass);
  zero errors in touched files.

### NOT fixed in this pass (out of scope by severity)

- **L1-L4** (4 LOW findings): remain open. Judgment calls / cosmetics.
- **N1** (no HTTP rate limiter): inherited pattern; requires-follow-up.
- **N2** (execWithTimeout timer leak): pre-existing, out of Phase 119
  scope.
- **V1** (timing side-channel between resolve-null and reachable-host):
  requires deployment-topology verification (single-tenant vs multi-
  tenant). The new redirect route's timing surface is smaller than the
  icon route's (no SSH connect on the redirect path), so the risk
  profile does not worsen.

