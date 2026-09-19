# Phase 120 — Unbiased Code Review

**Reviewer:** general-purpose subagent (unbiased pass, out-of-band from executor).
**Reviewed:** all 38 commits on `feat/tab-title-from-tmux` matching `grep 120-0` (Plans 01-08).
**Scope:** correctness, security, edge-cases, test quality, code hygiene.
**Method:** read every source file the Close-Out enumerates, cross-check against the shape's stated invariants, trace runtime behaviours the tests don't exercise, verify claims made in JSDoc against the actual library / framework behaviour.

---

## Summary

**16 findings across 8 files.** Overall assessment: **significant issues.**

Three findings are HIGH-severity — one very likely to be a production-breaking bug on the shape's central CSRF guarantee, one broken proxy `pathRewrite` that would result in the app receiving a wrong URL prefix, and one small-but-real DoS regression on the primary HTTP port's WS surface. Several MEDIUM findings around anti-clickjacking header preservation, `set-cookie` bleed-through, host-lookup fall-through on reload, and info-leak asymmetries on the WS path.

The functional tests are green because the test fixtures happened to paper over each production-only failure mode (a URL-shaped `SKYNET_COOKIE_DOMAIN` in tests masks the origin-vs-hostname mismatch; the proxy middleware is mocked so the real `pathRewrite` regex never runs). This is the class of gap most worth calling out — the coverage looks strong, but two of the load-bearing invariants aren't actually exercised end-to-end.

The refactor pieces (dispatch table, TabSpec union, drop-target extension), the client wiring, the DB schema addition, and the base-tag injector are clean.

---

## HIGH severity (bugs, correctness, security)

### 1. `appProxyCsrfCheck` compares an Origin URL against a bare hostname — every state-changing request will 403 in production.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-proxy-csrf-check.ts:49-58, 77-83`
**Also:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-router.ts:179, 448`

`PRIMARY_DOMAIN` is loaded from `process.env.SKYNET_COOKIE_DOMAIN`. Everywhere else in the codebase (`src/backend/utils/auth-manager.ts:719, 735`; the `Set-Cookie Domain=…` attribute) that env var is treated as a **bare hostname** (e.g. `term.example.com`, `skynet.taild9b663.ts.net`). The comment on `getSecureCookieOptions` (`auth-manager.ts:713`) says so directly: *"widen JWT session cookie to `Domain=<SKYNET_COOKIE_DOMAIN>` (e.g. 'term.example.com')"*.

The browser's `Origin` header, however, is scheme + host + optional port (e.g. `https://term.example.com`). The check `origin === primaryOrigin` will therefore FAIL on every real state-changing request from a real browser: the Origin `https://term.example.com` is never string-equal to the bare hostname `term.example.com`.

The unit test masks the bug by setting `SKYNET_COOKIE_DOMAIN = "https://skynet.test"` (a URL, not a hostname) so the comparison happens to succeed with a fully-qualified Origin string. The integration test does the same. Production won't.

Equivalent WS path at `app-pane-router.ts:448` (`originHeader !== PRIMARY_DOMAIN`) has the same bug.

**Recommendation:** compare against a computed primary Origin, not the raw cookie-domain env value. Two clean options:

- Construct `PRIMARY_ORIGIN = \`https://${process.env.SKYNET_COOKIE_DOMAIN}\`` at module load, and compare the request Origin against that. Keep the existing env variable; add a new local constant.
- Or accept the URL-shaped value in a new env variable (`SKYNET_PRIMARY_ORIGIN`) and document the semantics explicitly. Fall back to `https://${SKYNET_COOKIE_DOMAIN}` when absent.

Either way, add an integration test that sets `SKYNET_COOKIE_DOMAIN` to a bare hostname (matching production shape) and asserts POST with `Origin: https://<hostname>` succeeds.

### 2. `pathRewrite` regex is anchored to `/apps/…` but the middleware runs inside a `/apps` router mount — the strip never fires.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-proxy-factory.ts:181-183`

The middleware sets:

```ts
pathRewrite: {
  [`^/apps/${hostId}/${slug}/pane`]: "",
},
```

but the router is mounted via `app.use("/apps", appPaneRouter)` in `database.ts:2033`, and inside the router handler `req.url` is scoped to the mount point — Express strips `/apps` from `req.url` before it reaches `proxyMiddleware(req, res, next)`. `http-proxy-middleware` v4 (`node_modules/http-proxy-middleware/dist/http-proxy-middleware.js:172-179`) applies its rewriter against `req.url`, not `req.originalUrl`.

At runtime, `req.url` inside the middleware is `/5/todo/pane/api/list` (mount-stripped). The pathRewrite regex `^/apps/5/todo/pane` does NOT match — the strip is a no-op. The upstream app receives the URL `/5/todo/pane/api/list`, not `/api/list` as intended.

The integration test at `tests/app-pane-router.integration.test.ts:317-329` mocks the factory entirely (`getOrCreateAppPaneProxyForTarget` returns a mock handler that echoes `req.url`), so the pathRewrite branch never runs in the tests. The path-strip test at line 546 asserts only that the FACTORY is called with the right args — not that the resulting middleware actually strips the prefix.

**Recommendation:** either change the pathRewrite pattern to match the mount-relative URL (`^/${hostId}/${slug}/pane` — no leading `/apps`), or set `pathRewrite: (path) => path.replace(new RegExp(`^/${hostId}/${slug}/pane`), "")` for clarity. Add a real end-to-end test that stands up a fake upstream on 127.0.0.1 and asserts it receives the stripped URL. This is verified by running the actual app against a local Svelte dev server.

### 3. `httpServer.on("upgrade", …)` handler leaves non-matching upgrade sockets dangling — DoS regression + resource leak.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-router.ts:361-373`
**Also:** `/home/ubuntu/skynet-vision/src/backend/database/database.ts:2377-2383`

Before Phase 120, the primary `httpServer` had **no** `upgrade` listener. Node's http.Server has a default behavior when there is no `upgrade` listener: the socket is automatically destroyed. Once we attach ANY listener (as Phase 120 does), Node hands the socket to us — the default auto-destroy is disabled.

`handleAppPaneUpgrade` returns without touching the socket on non-matching paths (line 372: `// Not our path — leave the socket alone; other upgrade handlers … may still fire.`). But no other upgrade handler is attached to this `httpServer` — all other WS servers in the codebase (`terminal.ts:120`, `docker-console.ts:26`, `fleet-status-server.ts:214`, `tunnel.ts`, `relay-room-stream-server.ts`) run on their own separate ports.

Net effect: any client can now send an unlimited number of upgrade requests to non-matching paths on the primary HTTP port (e.g. `GET /foo HTTP/1.1` with `Upgrade: websocket`) and the sockets will accumulate forever. Node won't clean them up, we won't either.

**Recommendation:** on the non-match branch, `socket.destroy()` (or write `HTTP/1.1 400 Bad Request` and destroy). Preserve the return-immediately shape but be explicit that the socket is our responsibility now. If future work adds another upgrade consumer that legitimately handles other paths, gate the destroy behind a "no other handler owns this" check — but for now, we're the only listener.

Also file a follow-up bounty on adding a small integration test that hits a non-`/apps/` upgrade path and asserts the server closes the socket within N ms.

---

## MEDIUM severity (edge cases, test quality gaps)

### 4. Anti-clickjacking headers set on the router response are silently overwritten by upstream headers.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-router.ts:222-223`
**Also:** `/home/ubuntu/skynet-vision/node_modules/http-proxy-middleware/dist/handlers/response-interceptor.js:118-138`

The router sets `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self'` before handing off to the proxy. But `responseInterceptor` calls `copyHeaders(proxyRes, res)` which iterates upstream keys and calls `response.setHeader(key, value)` for each — **overwriting anything we set earlier** when the upstream provides its own version.

Consequence: if the upstream app emits its own `Content-Security-Policy` header (very common in modern frameworks — Svelte's starter can), our `frame-ancestors 'self'` clickjacking guard is gone. The comment at line 74 says *"the http-proxy-middleware pipeline preserves upstream-set outgoing response headers, so the anti-frame headers survive to the client"* — that's the exact opposite of the observed behaviour: upstream wins, ours is dropped.

**Recommendation:** wrap the responseInterceptor to re-set the anti-clickjacking headers AFTER `copyHeaders` completes (i.e. inside the interceptor callback, after the buffer is decompressed). Or intercept `res.setHeader` for those two names and force-preserve. Prefer the first — smaller surface.

Add a test that stands up a fake upstream sending `Content-Security-Policy: default-src 'none'` and asserts the final response still carries `frame-ancestors 'self'` (or a merged combined CSP).

### 5. Upstream `Set-Cookie` headers pass through onto Skynet's own primary origin.

**File:** `/home/ubuntu/skynet-vision/node_modules/http-proxy-middleware/dist/handlers/response-interceptor.js:131-137`

`copyHeaders` in the library preserves `set-cookie` from the upstream response, stripping only the `Domain=` attribute. Because the pane URL is served on Skynet's own origin, any cookie the app sets is scoped to Skynet's primary domain. This means:

- An app can set cookies that will be sent on every subsequent request to Skynet (including auth endpoints).
- An app can shadow / overwrite Skynet's own cookies if the names happen to overlap (session name collision, XSRF token collision, etc.).

The header allowlist covers OUTBOUND (`stripToAllowlist` strips cookies going to the app — good), but INBOUND cookie egress from the app to the browser is not filtered.

The shape's philosophy — "the pane is transparent to the app" — arguably implies the reverse too: the app should be transparent to Skynet. It should not be able to set cookies that affect Skynet's own surfaces.

**Recommendation:** in the responseInterceptor, drop or scope-narrow `set-cookie`. If retention is required for app functionality, prefix cookie names or scope via `Path=/apps/<hostId>/<slug>/pane/` so they don't affect Skynet's own routes. Alternatively, strip `set-cookie` from upstream entirely (starter template apps don't need cookies — Skynet's session already carries).

### 6. `Content-Type` check for base-tag injection is case-sensitive; upstream can send `TEXT/HTML`.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-proxy-factory.ts:208-213`

```ts
const contentType = String(proxyRes.headers["content-type"] ?? "");
if (!contentType.startsWith("text/html")) {
  return buffer;
}
```

Node lowercases header **names** but not header **values**. An upstream that emits `Content-Type: Text/HTML; charset=utf-8` (legal per RFC 9110 — media types are case-insensitive) would fail this check, and the response would be forwarded without the `<base>` tag injection, breaking all absolute-path references in the app's HTML.

The value can also be an array if upstream sends duplicate `Content-Type` headers — `String([…]).startsWith("text/html")` would coerce to `"text/html,text/plain"` (joined with comma) and pass, but that's actually incorrect (the response might genuinely be `text/plain` from a broken upstream) and could corrupt a plain-text body.

**Recommendation:**

```ts
const raw = proxyRes.headers["content-type"];
const ct = (Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase();
if (!ct.startsWith("text/html")) return buffer;
```

### 7. `<base>` regex matches `<head>` inside arbitrary text (e.g. JS strings, comments) before a real head tag.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/base-tag-injector.ts:77-79`

`html.match(/<head[^>]*>/i)` matches the first occurrence in the string — including inside `<script>` bodies, comments, or template literals. An app whose HTML happens to embed a literal `<head>` string in a top-of-document script (unlikely but possible with SSR patterns that inline stringified templates) could see the base tag injected mid-script, corrupting the payload.

**Recommendation:** narrow the regex to match `<head>` only when it appears at document-position where a real head tag would live. Practically, restrict to the first 4-8 KB of the document, or require a preceding `<html…>` open tag. Or use a real HTML parser (`parse5`, etc.) — probably overkill for the scale. At minimum, note the assumption in the JSDoc.

Existing document-with-existing-`<base>` handling is also worth documenting: our injection places our `<base>` before the app's, and per HTML spec the first `<base>` wins — so we override. That's arguably correct (that's the point) but the test at `tests/base-tag-injector.test.ts` doesn't exercise this case.

### 8. Different HTTP status codes for different WS-upgrade failure modes leak state to unauthenticated probes.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-router.ts:395-517`

The HTTP path enforces an info-leak invariant: `resolveHostById null` and `checkHostAccess false` both return `403` with byte-identical body. Good.

The WS-upgrade path uses distinct HTTP status codes for distinct reasons:
- `401 Unauthorized` — missing / invalid JWT
- `403 Forbidden` — access denied, missing origin, or wrong origin
- `404 Not Found` — app not currently serving a port
- `502 Bad Gateway` — tunnel error
- `503 Service Unavailable` — registry not populated
- `500 Internal Server Error` — proxy without `.upgrade`

Additionally, the CSRF-fail 403 carries an extra `X-Skynet-Reason: cross-origin` header while other 403s don't.

Consequence: an authenticated user probing paths can distinguish "host+app exists and I have access, tunnel is broken" (502) from "no such app" (404) from "no access" (403). Also, an attacker without auth learns whether the CSRF path was reached before or after auth (X-Skynet-Reason present → auth passed; absent → auth failed).

The HTTP path treats this correctly. The comment at line 355-359 says *"failure modes are indistinguishable at the wire level"* — that's not accurate: the status line is distinguishable.

**Recommendation:** collapse the WS-upgrade rejection status codes for cases 2-5 above to a single `HTTP/1.1 403 Forbidden` with no distinguishing header. Auth-fail (401) can stay distinct since it's client-observable via cookie presence anyway. Or if that's too aggressive, at minimum drop the `X-Skynet-Reason` header — it's a marker that reveals which check fired.

### 9. Reload restore silently drops app tabs whose home host isn't in `allHosts` — even though the app has a hostId in the persisted row.

**File:** `/home/ubuntu/skynet-vision/src/ui/AppShell.tsx:1534-1567`

```ts
const host = saved.hostId
  ? allHosts.find((h) => h.id === String(saved.hostId))
  : undefined;
const hostlessTypes: TabType[] = ["dashboard"];
if (!host && !hostlessTypes.includes(saved.tabType as TabType))
  continue;
```

`hostlessTypes` covers `dashboard` but **not** `app`. If the app's home host was removed from `allHosts` between save and reload (host deleted, credential revoked, box scaled down), the saved app-tab row is silently `continue`'d — the whole tab disappears from the layout.

Per the shape's "gone-at-reload is a display concern, not a behaviour concern" principle, the leaf should render and the proxy should render its interstitial. Instead the leaf never renders because the tab is dropped upstream.

Note: the code path at line 1567+ constructs the `app` tuple only when both `saved.hostId != null && saved.appSlug != null` are populated — good, but that never runs if the tab is dropped at line 1541.

**Recommendation:** add `"app"` to `hostlessTypes`, and thread a null host through to Tab.host for app tabs (they don't need it — `renderAppTab` reads only `tab.app.hostId` and `tab.app.slug`). The app pane will render, the proxy will attempt the tunnel, and the natural failure interstitial will show — exactly the shape's intent.

### 10. `Number(spec.hostId)` on URL restore accepts non-numeric strings, produces `NaN`, and constructs a leaf with `hostId: NaN`.

**File:** `/home/ubuntu/skynet-vision/src/ui/AppShell.tsx:1699`, `1858-1862`

`parseTabParam` for the `app` variant accepts any string as `hostId` (the client-side wire type is `string`; the type-guard at parse time is `!hostId || !slug`). If a URL fragment carries `?tab=app:foo:bar`, `Number("foo")` is `NaN`, and the code proceeds to open a tab with `app: { hostId: NaN, slug: "bar" }`. `AppPane` then builds `/apps/${encodeURIComponent(NaN)}/${encodeURIComponent("bar")}/pane/` — literal `/apps/NaN/bar/pane/`.

Backend regex will reject the `NaN` at the router (`hostIdNum <= 0` catches `NaN`? — actually `NaN <= 0` is false; the `!Number.isFinite(NaN)` guard catches it → 400). So no exploit, but the leaf renders an interstitial for a URL that should never have been constructed.

Also: `parseTabParam` for the app variant has no length cap on `hostId` or `slug` (the relay variant caps `roomId` at 512 chars, per the same file). A URL with `?tab=app:${'9'.repeat(10_000)}:foo` would parse successfully client-side.

**Recommendation:** in `parseTabParam` for the `app` variant, validate `hostId` matches `^[1-9][0-9]{0,9}$` (or similar positive-integer regex) and `slug` matches `/^[a-z0-9-]{1,64}$/` (the same `APP_SLUG_RE` shape the backend enforces). Return `null` if either fails. Matches the "fail-safe: drop the tab" contract of the other variants.

### 11. Integration test for WS upgrade (case 4) verifies dispatch but not real proxy behaviour — false-positive risk if `.upgrade` semantics change.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/tests/app-pane-router.integration.test.ts:397-480`

The WS upgrade test uses a real `http.Server` + real socket — good, that's the BLOCKER 6 fix. But the proxy middleware itself is mocked (`upgradeSpy = vi.fn()`), so what the test actually asserts is:

- The dispatch handler ran through auth + validation + access + CSRF + port + target.
- The mock's `.upgrade` was called with a socket that's `defined`.

It does NOT assert:
- The socket is still `readable / writable` (not `.destroy`ed prematurely by our code).
- The head buffer was passed through unchanged.
- The req headers reached upstream.

A future refactor that accidentally destroys the socket right before proxy handoff would still make this test pass (the spy sees a defined socket). Consider a test that stands up a fake upstream WS server and asserts a full echo — expensive but catches this class of drift.

Not a blocker; noting for the follow-up bounty pass.

---

## LOW severity (code quality, hygiene)

### 12. Two log-channel names, one variable — inconsistency between the two `apps/` modules.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/app-pane-router.ts:87` vs `app-pane-proxy-factory.ts:91`

`app-pane-router.ts` imports `logger as sshLogger` — but `logger` is the SYSTEM logger alias (`utils/logger.ts:337 — export const logger = systemLogger`). `app-pane-proxy-factory.ts` imports the real `sshLogger`. Log lines from these two files will show up under different channels ("SYSTEM" vs "SSH") despite both being named `sshLogger` in-file — confusing during postmortem log scans.

**Recommendation:** rename the router's import to `logger as systemLogger` (matches the underlying identifier) OR change it to `import { sshLogger } from "../utils/logger.js"` to match the factory. Prefer the second — both files are about proxying to a box, `sshLogger` is the right channel.

### 13. `usedTunnel` on `ResolvedTarget` is always `true` — dead field.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/pane-target-resolver.ts:46-50, 77`

The JSDoc explains this is "retained for observability clarity" and "interface stability if a future phase revisits Q1". Fine, but no consumer ever reads it. Grep confirms zero read sites outside the tests that assert it's `true`.

**Recommendation:** either delete the field (with a comment on the return type explaining the historical choice) or actually consume it in logs (e.g. include `usedTunnel: true` in the router's structured warn payload for symmetry with `errorClass`). Otherwise it's a scaffold that reads like a placeholder.

### 14. `void hostId;` on line 73 of `pane-target-resolver.ts` — Voodoo linting workaround.

**File:** `/home/ubuntu/skynet-vision/src/backend/apps/pane-target-resolver.ts:70-73`

The parameter is retained for signature symmetry and never used. The `void hostId;` statement suppresses linter warnings. Cleaner options:

- Rename to `_hostId` (TS/ESLint conventional prefix for intentionally-unused).
- Drop the parameter entirely and add hostId to callers' log statements at the call site (they already have it — they're the ones that pass it in).

Pick one; the current shape reads like an in-progress refactor.

### 15. `console.info` / `console.warn` in production paths — bypasses the logger discipline.

**Files:**
- `/home/ubuntu/skynet-vision/src/ui/shell/SplitView.tsx:670-687` (`[pv-split-drop]` messages)
- `/home/ubuntu/skynet-vision/src/ui/AppShell.tsx:2776-2779` (drop payload)
- `/home/ubuntu/skynet-vision/src/ui/features/pretty-conversations/AppTile.tsx:238-241` (long-press warn)

Some are pre-existing patterns copied from Phase 64/97; others are new. Not a bug — the frontend has no shared logger surface — but worth noting that these lines will show up in prod DevTools consoles for every drop event, which can be noisy and (in the SplitView case) echo user drag payloads including slugs and titles into browser logs. If DevTools access ever becomes evidence, that's a minor forensic trail.

**Recommendation:** consider gating behind `import.meta.env.DEV` or a debug flag. Or accept as-is — matches surrounding pattern.

### 16. `TAB_TTL_MS = 30 minutes` in `open-tabs.ts` — magic number.

**File:** `/home/ubuntu/skynet-vision/src/backend/database/routes/open-tabs.ts:26`

Pre-existing, not introduced by Phase 120, but the persistence-restore path this phase relies on has a 30-min silent-drop threshold that isn't documented anywhere adjacent. If a user closes their laptop, comes back an hour later, the app tab that was persisted is now silently absent. This isn't shape-4 scope but interacts with D-16's promised reload persistence.

**Recommendation:** file a follow-up quick to extract into a named constant + JSDoc explaining the semantic, and probably surface it in the phase's shape doc if it constrains observed UX.

---

## Observations (no fix needed)

- **The dispatch refactor is clean.** Moving `switch(type)` to `Record<TabType, Renderer>` is idiomatic; exhaustiveness is enforced at compile time (verified via `tsc --noEmit` in-plan); the `rdp | vnc | telnet` fall-through was correctly explicit-ified into three rows pointing at the same helper. This is the small refactor the shape asked for and it landed at the right size.
- **The TabSpec union extension is careful.** Each variant carries `?: never` markers for every field the other variants own — narrowing works from either discriminant. Symmetric with the pre-existing relay variant.
- **The Tab.app tuple + isAppTab predicate is right-sized.** The predicate is a compile-time-narrowing helper and consumers use it consistently at the render dispatch call site. Not over-engineered.
- **The header-allowlist strip precedent is followed exactly.** `stripToAllowlist` is duplicated (not shared) from `serve-url/proxy-factory.ts` — the JSDoc explains the trade-off honestly. The permessage-deflate RSV1 fix is duplicated in the same shape. This is the right kind of duplication: the shared thing is a tiny loop, and export-of-internal would be more coupling than the current duplication costs.
- **The pane-target-resolver's unconditional-tunnel decision (D-10 RESOLVED)** is documented well — the "Q1 revisit would add branches back" note keeps the door open without surfacing dead conditionals.
- **The base-tag-injector unit tests genuinely exercise real behaviour** — case-insensitive match, first-match-only, no-`<head>` fallback, encoding on `slug`, UTF-8 multibyte round-trip. Not tautological. (The gap is Finding #7 — HTML-parsing edge cases the regex approach can't handle.)
- **The pane-target-resolver test file's structural assertion "usedTunnel is always true for both local-and-remote hostIds"** is exactly the kind of grep-enforceable single-code-path guard the RESEARCH.md called for. Good pattern.
- **The Close-Out's "Additions" section is honest.** Every drift the executor introduced (interstitial rendering inside the leaf, X-Frame-Options / CSP headers, base-tag injection, host-not-found bytesize equality, fail-loud env check) is called out and justified. That's the level of transparency the /close workflow was designed for.

---

## Notable follow-ups the review surfaces

1. **Finding #1** is a production blocker. The CSRF check is the shape's stated trust boundary; if it 403s every real state-changing request, either the app half-works (only reads succeed) OR the app is broken. UAT would catch it fast, but landing broken is worse than landing with a fix.
2. **Finding #2** is a functional blocker. Apps that expect to receive `/api/list` will receive `/5/todo/pane/api/list` — most SPA routers will 404. UAT would catch it fast too.
3. **Finding #3** is a slow-burn resource leak. Won't break UAT but will surface eventually as a socket accumulation issue in monitoring.

Findings 4-8 each have a legitimate production-facing consequence but each is either narrow (specific upstream headers) or an information leak that requires an authenticated attacker to be interesting. They should be fixed before the campaign closes but don't block UAT.

The rest are hygiene.

---

## Fix pass (2026-09-19)

**Executor:** general-purpose subagent (fix pass, out-of-band from original review).
**Scope:** 3 HIGH + 4 MEDIUM findings. Original findings text above left unmodified.

Each fix landed as its own atomic conventional-commit under `feat/tab-title-from-tmux`
(all commits held locally per the campaign deploy hold — no push). Scoped vitest was
run on touched files after every commit; the full pass ended with 476/476 passing
across the impacted test files.

| Finding  | Commit      | Description                                                                       |
|----------|-------------|-----------------------------------------------------------------------------------|
| HIGH-1   | `d642696d`  | CSRF check compares Origin.hostname vs config hostname                            |
| HIGH-2   | `71ad5541`  | pathRewrite regex matches post-mount req.url                                      |
| HIGH-3   | `dfc2b13b`  | Destroy non-matching WS upgrade sockets                                           |
| MEDIUM-1 | `11423837`  | Preserve anti-clickjacking headers past upstream overwrite                        |
| MEDIUM-2 | `2dd6a171`  | Strip upstream Set-Cookie from pane responses                                     |
| MEDIUM-6 | `f7451f5a`  | Reload restore preserves app tabs whose host is missing                           |
| MEDIUM-7 | `a59272b0`  | Validate app-tab hostId + slug from URL fragment                                  |

### Files changed

- `src/backend/apps/app-proxy-csrf-check.ts` — normalizeToHostname helper; hostname-based comparison (HIGH-1)
- `src/backend/apps/app-pane-router.ts` — Origin.hostname compare on WS path (HIGH-1); socket.destroy on non-match (HIGH-3)
- `src/backend/apps/app-pane-proxy-factory.ts` — mount-relative pathRewrite (HIGH-2); re-set anti-clickjacking + strip Set-Cookie in interceptor (MEDIUM-1 + MEDIUM-2)
- `src/backend/apps/tests/app-proxy-csrf-check.test.ts` — bare-hostname regression coverage + malformed-URL fallthrough (HIGH-1)
- `src/backend/apps/tests/app-pane-router.integration.test.ts` — normalized hostname assertion (HIGH-1); non-matching upgrade destroy test (HIGH-3)
- `src/backend/apps/tests/app-pane-proxy-factory.test.ts` — buildPaneMountPathRewrite direct-unit coverage (HIGH-2); anti-clickjacking re-set (MEDIUM-1); Set-Cookie strip (MEDIUM-2)
- `src/ui/AppShell.tsx` — hostlessTypes includes "app" (MEDIUM-6)
- `src/ui/AppShell.app-tab-restore-fix.test.tsx` — new source-grep regression suite (MEDIUM-6)
- `src/ui/lib/tab-url.ts` — positive-integer + APP_SLUG_RE-shape validators on the "app:..." parse branch (MEDIUM-7)
- `src/ui/lib/tab-url.test.ts` — 20 new cases covering positive/negative validation + workspace round-trip (MEDIUM-7)

### Notable notes / small deviations from the original recommendation

- **HIGH-1 config-shape tolerance:** the fix accepts both `SKYNET_COOKIE_DOMAIN=term.example.com` (bare) and `SKYNET_COOKIE_DOMAIN=https://term.example.com` (URL) — both normalize to hostname. Backward-compat with the URL-shaped value pre-existing tests were using is preserved (they still pass; the assertion on `PRIMARY_DOMAIN` value changed from URL to hostname to reflect the new normalization).
- **HIGH-3 destroy-on-non-match** is unconditional because the primary httpServer's ONLY upgrade listener is `handleAppPaneUpgrade` (grep-verified — the other WS servers all run on their own ports). If a future phase adds another upgrade consumer that legitimately handles other paths on the same server, this destroy must be gated behind a "no other handler owns this" check. JSDoc note flags this.
- **MEDIUM-1 + MEDIUM-2** share a single responseInterceptor callback but ship as two atomic commits — MEDIUM-1 lands the anti-clickjacking re-set; MEDIUM-2 adds the Set-Cookie strip on top. Each commit's tests focus on its own header.
- **MEDIUM-6** could not be tested by mounting AppShell (30+ imports); used the same source-grep pattern the sibling `AppShell.relay-url-restore.test.tsx` established at Phase 97 Plan 05 — five structural tests locking the fix shape.
- **MEDIUM-7** validator is at the URL-parse boundary (parseTabParam) rather than at the AppShell callsite. The AppShell callsite's `Number(spec.hostId)` is now safe because the wire has already enforced the positive-integer shape upstream — no runtime code change at AppShell (structural test at MEDIUM-6's test file locks the callsite shape for future refactor visibility).

### Not addressed by this pass (per the fix-pass scope)

- Findings 4 (upstream CSP-mid-response non-header path — covered inline via MEDIUM-1 fix that re-sets our headers regardless of upstream)
- Findings 6-8, 11-16 — deferred; not in the "3 HIGH + 4 MEDIUM" scope this pass was chartered for. Follow-up bounty pass should sweep the remaining MEDIUM + LOW.

---

## Follow-up fix pass (2026-09-19)

**Executor:** general-purpose subagent (follow-up pass).
**Scope:** two pre-deploy-blocker items (nginx WS upgrade forwarding on `/apps/`,
DatabaseSaveTrigger.forceSave gap in open-tabs.ts writes) + three LOW-severity
cleanups from the original review's LOW-13 / LOW-14 / LOW-15 findings.

Each fix landed as its own atomic conventional-commit under
`feat/tab-title-from-tmux` (all commits held locally per the campaign deploy
hold — no push). Scoped vitest was run on touched files after every code fix
that had test coverage (Fix 1 is nginx-only, no automated coverage; Fix 4 rides
on Fix 3's test coverage). The pass ended with all scoped test files passing.

| Fix    | Commit      | Description                                                                                       |
|--------|-------------|---------------------------------------------------------------------------------------------------|
| Task 16 | `4ca42e9b` | Add `/apps/` nginx location for WS upgrade forwarding (nginx.conf + nginx-https.conf parity)      |
| Task 15 | `eddfc56f` | Call `DatabaseSaveTrigger.forceSave` after POST/PUT/PATCH/DELETE in open-tabs.ts (+ 7 tests)      |
| LOW-13  | `cda42cc3` | Drop unused `usedTunnel` field from `ResolvedTarget` (interface + return + test assertions)      |
| LOW-14  | `f9297939` | Rename `hostId` → `_hostId` in `resolvePaneTarget`, drop the `void hostId;` linter-suppression   |
| LOW-15  | `803d8135` | Replace `console.info` / `console.warn` in Phase 120 drop-dispatch sites with `systemLogger`     |

### Files changed

- `docker/nginx.conf` + `docker/nginx-https.conf` — new `location ^~ /apps/` block
  mirroring Phase 91's `/relay-room/websocket/` WS-forwarding shape (Task 16).
- `src/backend/database/routes/open-tabs.ts` — import `DatabaseSaveTrigger`; add
  try/catch-warn-wrapped `forceSave("open_tabs_upsert|sync|patch|delete")` after
  each of the four write handlers (Task 15).
- `src/backend/database/routes/open-tabs.test.ts` (new) — seven tests covering
  every write-handler forceSave call-site + the PATCH 404 no-save branch.
- `src/backend/apps/pane-target-resolver.ts` — drop `usedTunnel: boolean` from
  `ResolvedTarget` (LOW-13); rename `hostId` → `_hostId` (LOW-14).
- `src/backend/apps/tests/pane-target-resolver.test.ts` — replace `usedTunnel: true`
  assertions with return-shape structural equality; keep the single-code-path
  invariant via call-count on `tunnelCache.getOrCreate` (LOW-13).
- `src/backend/apps/tests/app-pane-router.integration.test.ts` — remove
  `usedTunnel: true` from the mocked resolver return value (LOW-13).
- `src/ui/shell/SplitView.tsx` + `src/ui/AppShell.tsx` — import `systemLogger`
  from `@/lib/frontend-logger`; replace the three Phase 120 drop-dispatch
  `console.info` / `console.warn` sites with structured `systemLogger.info` /
  `systemLogger.warn` calls carrying hostId / slug / edge / errorMessage as
  explicit context fields per the role-file 2026-08-11 directive (LOW-15).

### Notes / small deviations

- **Task 16** used `^~ /apps/` (prefix priority) rather than a bare `location /apps/`
  so the block wins over both regex catch-alls and `location /` static-serve.
  Positioned in the file BEFORE `@express_spa_fallback` for readability; nginx
  location matching is priority-based, not file-order, so position is decorative
  but keeps related blocks together. nginx `-t` verification was skipped —
  nginx binary not installed on the dev box (per task spec).
- **Task 15** covers ALL four write handlers in open-tabs.ts (POST/PUT/PATCH/DELETE),
  not just POST/PUT — PATCH and DELETE are pre-existing paths that had the same
  invariant gap. The PATCH 404 short-circuits BEFORE forceSave (a zero-changes
  update leaves RAM state unchanged; no save needed) — the test suite locks this
  behaviour with SAVE-PATCH-2.
- **LOW-14 rename to `_hostId`** was chosen over "drop the parameter entirely"
  because the parameter is retained for signature symmetry — callers pass hostId
  in for logging + audit tags, and removing it would force every caller into a
  positional-arg reshuffle. The underscore-prefix is the standard TS/ESLint
  convention for intentionally-unused parameters.
- **LOW-15 scope** deliberately excludes AppTile.tsx (the reviewer's site 3) —
  grep-confirmed AppTile.tsx has no `console.*` calls in the current tree; the
  earlier fix pass or an intermediate edit already cleaned it. Also excludes
  every other pre-existing `console.*` call in SplitView.tsx and AppShell.tsx
  (dozens of them, matching the surrounding pattern the reviewer explicitly
  accepted as "matches surrounding pattern"). The fix targets ONLY the three
  Phase 120-added sites the reviewer identified.
