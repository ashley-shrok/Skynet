---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 10
subsystem: uat
tags:
  - uat
  - end-to-end
  - t1000
  - python-http-server
  - origin-isolation
  - post-deploy-verification
  - blocking-human
  - checkpoint

# Dependency graph
dependencies:
  requires:
    - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
      provides: "Plans 01+02+03a+03b+04+05+06+07+08+09 must be deployed atomically per D-24 before this UAT runs (Caddy wildcard TLS + widened JWT cookie + subdomain dispatch + tunnel cache + proxy factory + WS origin guard + multipart guards + interstitial renderer + id-skill rewrite distributed)"
  provides:
    - "End-to-end verification transcript covering CONTEXT.md Specifics L147 (python -m http.server t1000 origin-isolation test) — realizes shape file rollout step 4"
    - "Ashley's explicit sign-off line confirming Phase 103 shipped correctly (or documented failure transcript for orchestrator gap-closure decision)"
  affects:
    - "Phase 103 close-out — all upstream plans' contribution proven correct end-to-end against real traffic. If UAT fails, orchestrator triggers /gsd-plan-phase 103 --gaps against whichever plan owns the failing surface (dispatch=05, tunnel/proxy=03a/03b, Caddy=01, cookie=02, interstitial UX=03a)."

# Tech tracking
tech-stack:
  added: []  # No code changes — pure UAT documentation + human-verify checkpoint
  patterns:
    - "Post-deploy manual UAT with 4 independent check gates (positive load / origin isolation / auth wall / port-not-listening interstitial) — each check independently falsifiable"
    - "Skeleton-then-transcript pattern — executor writes the fillable structure BEFORE presenting checkpoint; Ashley (or whoever is at t1000) fills each field from real UAT observation. NO invented verification data."

key-files:
  created:
    - .planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/103-10-SUMMARY.md
  modified: []

# Executor decisions
decisions:
  - "Executor wrote the SUMMARY.md skeleton with the 4-check protocol as an Ashley-runnable checklist BEFORE returning the human-verify checkpoint (per plan action step). Fillable transcript fields left blank — Ashley (or the identity at t1000 post-deploy) populates them during the actual UAT run. Do NOT invent verification data."
  - "This plan does NOT deploy. Deploy motion (git push → docker build → docker compose up --force-recreate) is orchestrator-only per box-maintainer standing directive 'Deploy boundary at git push' + 'Subagents don't do deploys.' The UAT below runs POST-DEPLOY, after Ashley's greenlight lands and the atomic ship motion completes."
  - "This plan does NOT push, ship, or run any test suite. It is a documentation + human-verify checkpoint task exclusively. The full-suite ship gate (npx vitest run + npx playwright smoke) runs as the FIRST step of the orchestrator's deploy motion — that's a separate concern from THIS plan."

# Metrics
metrics:
  duration: "~5 min executor time (skeleton write + commit + checkpoint return); UAT itself is post-deploy and owned by Ashley + orchestrator"
  completed: 2026-09-10
---

# Phase 103 Plan 10: End-to-end serve URL verification on t1000 (post-deploy UAT) Summary

## One-liner

Post-deploy manual UAT protocol proving the full serve URL stack (Caddy wildcard TLS → subdomain dispatch → JWT auth → SSH tunnel → proxy) works end-to-end on t1000 via `python -m http.server` + sibling image origin-isolation check.

## What this plan is (and is not)

**IS:** A single blocking-human checkpoint task that (a) enumerates the 4-check UAT procedure as an Ashley-runnable checklist and (b) provides the durable transcript template for recording verification observations.

**IS NOT:** Not a deploy. Not a push. Not a test-suite run. Not an executor-driven UAT. The executor of this plan wrote the skeleton below and returned a `CHECKPOINT REACHED` message. The UAT itself executes **AFTER** the orchestrator's ship motion (git push + docker build + docker compose up --force-recreate + verify), triggered by Ashley on t1000.

## Preconditions (must all be true before the UAT runs)

- [ ] Ashley has greenlit the atomic ship motion for Phase 103 at `git push`.
- [ ] Orchestrator has pushed HEAD, run the full-suite ship gate (`npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium`), completed `docker build` + `docker compose up --force-recreate` for both `caddy` and `skynet` services.
- [ ] `docker logs skynet` and `docker logs caddy` post-recreate show clean startup — every warn/error line understood, expected subsystem-startup lines present (Fleet-substrate orchestrator started, Fleet-substrate sweep completed, Fleet-status poll start), per standing directive "After any container restart, tail the docker logs and understand every line."
- [ ] DNS wildcard `*.serve.term.gigaashley.click` resolves (Route 53 record propagated).
- [ ] Wildcard cert for `*.serve.term.gigaashley.click` issued by Let's Encrypt (or ZeroSSL fallback per D-21) — verify via `docker logs caddy | grep -i certificate`.

## UAT procedure — 4 independent check gates

Ashley (or whichever box-maintainer identity is at t1000 post-deploy) executes each step in order. Fill in the transcript fields below during execution. NO invented data.

---

### Setup (run once before the 4 checks)

**A. SSH into t1000** (or open a terminal directly if physically present).

**B. Create test folder + files:**

```bash
mkdir -p /tmp/serve-url-uat
cd /tmp/serve-url-uat
cat > index.html <<'EOF'
<!DOCTYPE html>
<html><head><title>serve URL UAT</title></head>
<body>
  <h1>serve URL UAT — origin isolation proof</h1>
  <p>If the image below loads, absolute-path assets resolve back through the serve subdomain (origin isolation works).</p>
  <img src="/image.png" alt="test image — MUST load via serve subdomain, not term.gigaashley.click">
</body></html>
EOF
# Any small PNG works — grab a favicon or a system icon
cp ~/.local/share/icons/hicolor/16x16/apps/*.png image.png 2>/dev/null || \
  curl -sSLo image.png https://www.python.org/static/favicon.ico
ls -la  # verify both index.html and image.png present
```

**C. Start python http.server on port 8899** (leave running in a terminal — the log output is the ground-truth signal for whether the proxy reached the box):

```bash
python3 -m http.server 8899
```

**D. Open a FRESH browser window** (Firefox or Chrome, **incognito/private mode**) — ensures clean cookie state so the fresh-sign-in below issues a genuinely new widened JWT.

**E. Sign into Skynet at `https://term.gigaashley.click`** with Ashley's admin credentials. After sign-in, open devtools → Storage → Cookies and locate `skynet_session`. **Verify the `Domain` field reads `term.gigaashley.click`** (NOT blank, NOT `.term.gigaashley.click` without the leading dot handled properly — check that the cookie will match on all `*.term.gigaashley.click` subdomains per D-02). This validates Plan 02's widened cookie shipped.

**Transcript — Setup:**

```
Timestamp (local time on t1000): [FILL IN — YYYY-MM-DD HH:MM TZ]
Browser + version:               [FILL IN — e.g., "Firefox 129.0 (incognito)"]
python http.server started at:   [FILL IN — timestamp of first stdout log line]
skynet_session cookie Domain:    [FILL IN — should read "term.gigaashley.click"]
Preconditions all green?         [YES / NO — if NO, ABORT and report to orchestrator]
```

---

### CHECK 1 — Positive load (proxy plumbing works)

**Action:** In the signed-in browser tab from Setup step D, visit:

```
https://t1000-8899.serve.term.gigaashley.click/
```

**Expected:**

- Browser presents Skynet's HTTPS cert; click padlock → issuer reads "Let's Encrypt" (or ZeroSSL per D-21 fallback).
- Page renders the "serve URL UAT — origin isolation proof" heading.
- `image.png` displays below the heading.
- View source (Ctrl-U): `<img src="/image.png">` — absolute path, NOT rewritten to a full URL.
- Devtools → Network tab: TWO requests visible — `GET /` (returning `text/html`, 200) and `GET /image.png` (returning `image/png`, 200).

**Transcript — Check 1:**

```
Cert issuer (from padlock):          [FILL IN — "Let's Encrypt" or "ZeroSSL"]
Page heading rendered:               [YES / NO]
image.png visually loaded:           [YES / NO]
View-source shows <img src="/image.png">: [YES / NO — MUST be unmodified absolute path]
Devtools Network: GET / → status:    [FILL IN — should be 200]
Devtools Network: GET /image.png → status: [FILL IN — should be 200]
Screenshot / annotated capture:      [FILL IN — attach path or paste base64 or link]
CHECK 1 RESULT:                      [PASS / FAIL — if FAIL, note reason and STOP]
```

---

### CHECK 2 — Origin isolation (per-`(host, port)` wildcard subdomain works per D-01)

**Action:** In the same devtools Network tab from Check 1, inspect the `/image.png` request. **Verify its full request URL.**

**Expected:**

- Image request URL is exactly `https://t1000-8899.serve.term.gigaashley.click/image.png`.
- Image request URL is **NOT** `https://term.gigaashley.click/image.png` (which would prove browser resolved absolute path to the PRIMARY domain — origin isolation broken).
- Image request URL is **NOT** to any other subdomain.

**Cross-check the python http.server terminal from Setup step C.** You should see TWO log lines from Skynet's edge IP (which appears as `127.0.0.1` because Skynet dials the SSH tunnel to your local port; the tunnel makes the connection appear as loopback from python's perspective):

```
127.0.0.1 - - [DD/Mon/YYYY HH:MM:SS] "GET / HTTP/1.1" 200 -
127.0.0.1 - - [DD/Mon/YYYY HH:MM:SS] "GET /image.png HTTP/1.1" 200 -
```

**Transcript — Check 2:**

```
/image.png full request URL (from Network tab): [FILL IN — MUST be t1000-8899.serve.term.gigaashley.click]
python http.server log lines (paste verbatim):
[FILL IN — two "GET" lines with timestamps]
Origin isolation proven?                        [YES / NO]
CHECK 2 RESULT:                                 [PASS / FAIL — if FAIL, D-01 design broken]
```

---

### CHECK 3 — Auth wall (unauthenticated request redirects to login per D-14 auth_missing interstitial)

**Action:** Open a **DIFFERENT browser** (or the SAME browser after clearing cookies for `term.gigaashley.click` — devtools → Application → Storage → Clear site data). Do NOT sign in. Visit:

```
https://t1000-8899.serve.term.gigaashley.click/
```

**Expected:**

- Response is a 302 redirect to `https://term.gigaashley.click/login?return=<encoded-serve-url>` per D-14 `auth_missing` failure class + Plan 03a `interstitial.ts` + Plan 05 dispatch.
- The `return` query parameter contains the URL-encoded original serve URL so post-login the browser can bounce back.
- Browser lands on Skynet's login page (NOT on a bare 401, NOT on the target upstream content).

**Transcript — Check 3:**

```
HTTP response status (from Network tab, un-following redirects if possible): [FILL IN — should be 302]
Location header value:                                                        [FILL IN — should be https://term.gigaashley.click/login?return=...]
Final rendered page:                                                          [FILL IN — should be Skynet login page]
Screenshot of login page (or Network tab redirect chain):                     [FILL IN — attach path]
CHECK 3 RESULT:                                                               [PASS / FAIL]
```

---

### CHECK 4 — Port-not-listening interstitial (Skynet-styled, no auto-refresh per D-14 + Specifics L145)

**Action:**

1. Return to the terminal running `python3 -m http.server 8899` from Setup step C. **Kill it (Ctrl-C).**
2. Return to the SIGNED-IN browser tab from Checks 1+2. **Refresh** `https://t1000-8899.serve.term.gigaashley.click/`.

**Expected:**

- Skynet-styled interstitial page renders (NOT a bare "502 Bad Gateway", NOT a browser-default error page).
- Interstitial body reads something like "port 8899 of t1000 isn't responding" (exact copy per Plan 03a `interstitial.ts` `port_not_listening` template).
- Interstitial has a **plain "Try again" button** — NO auto-refresh, NO meta refresh, NO JavaScript-timed reload (Specifics L145 + D-14: user decides to retry; auto-refresh masks legitimate ongoing outages).
- Devtools Network shows the request resolved (some 2xx or 5xx status from the interstitial layer, NOT a hung/timeout).

**Transcript — Check 4:**

```
Interstitial page rendered (not bare 502): [YES / NO]
Interstitial copy (paste verbatim):        [FILL IN]
"Try again" button present:                [YES / NO]
Auto-refresh present?:                     [MUST BE NO — check view-source for <meta http-equiv="refresh"> AND check whether page reloads on its own without clicking]
Screenshot of interstitial:                [FILL IN — attach path]
CHECK 4 RESULT:                            [PASS / FAIL]
```

---

## Sign-off

**Ashley (or the identity at t1000) fills in ONE of the following after running all 4 checks:**

**IF ALL 4 CHECKS PASSED:**

```
Verified end-to-end by [IDENTITY NAME] on [YYYY-MM-DD HH:MM TZ]. All 4 checks passed.
Phase 103 (passthrough-urls serve URL scheme, phase 2 of 2) is shipped and verified.
```

**IF ANY CHECK FAILED:**

```
Failed at Check [N]: [ONE-LINE REASON].
Diagnostic detail attached below (screenshots + docker logs + curl transcripts).
Returning to orchestrator for gap-closure decision.
```

**Actual sign-off line (fill after UAT):**

```
[FILL IN — one of the two above]
```

---

## Diagnostic transcript (only fill if any check failed)

If Check N failed, capture at minimum:

- **Full screenshot** of the browser state at failure.
- **`docker logs skynet --since 5m 2>&1`** (Skynet backend logs around the failing request time — look for structured logs from subdomain-dispatch, tunnel-cache, proxy-factory, interstitial renderer).
- **`docker logs caddy --since 5m 2>&1`** (Caddy edge logs — look for TLS handshake issues, upstream errors, missing X-Skynet-Serve-Subdomain header).
- **`curl -vv -o /dev/null https://t1000-8899.serve.term.gigaashley.click/`** (raw HTTP transcript with headers).
- **Which plan's surface owns the failure** (best guess, for orchestrator gap-closure targeting):
  - Cert / TLS issue → Plan 01 (Caddy image + Caddyfile)
  - Cookie not reaching subdomain → Plan 02 (cookie widen)
  - Subdomain parse or routing failure → Plan 05 (subdomain-dispatch)
  - Tunnel failure (ECONNREFUSED / SSH-level error) → Plan 03a (tunnel-cache) + Plan 05 (error classifier)
  - Header leaking to upstream (Cookie / Authorization visible in python http.server log line) → Plan 03b (proxy-factory allowlist-strip) + Plan 04 (integration test that missed it)
  - Origin isolation broken (image loads from wrong domain) → Plan 01 (Caddy wildcard) + Plan 05 (dispatch)
  - Interstitial not rendering / auto-refreshing → Plan 03a (interstitial.ts)
  - Auth wall not firing → Plan 05 (dispatch JWT gate) + Plan 03a (auth_missing interstitial)

**Diagnostic capture (fill only if UAT failed):**

```
[FILL IN — attach paths to screenshots, paste log excerpts, paste curl transcript]
```

---

## Deviations from Plan

Executor step: none — skeleton written and committed as designed.

**UAT execution (2026-09-10, post-deploy on t1000):**
- **Target host**: used `thenasty-8899.serve.term.gigaashley.click` instead of `t1000-8899` because this box is registered in Skynet's host DB under the name `Skynet` (id=6), NOT `t1000`. Using thenasty had the added value of proving cross-host reverse-proxy (SSH tunnel to a genuinely-remote box), not self-loopback. Future UAT runs should either register a `t1000` alias or continue with a remote target.
- **http.server location**: moved from t1000 to thenasty for the same reason.

---

## Live UAT transcript (executed 2026-09-10 by tabitha + Ashley)

**Setup:**
- HEAD deployed: `139467d0` initial, then iterative fix commits `840a9fe1` (backend TS), `34ab44c8` (Caddyfile snippet), `500763d3` (on.error interstitial), `e6e33f54` (ECONNRESET classification).
- Deploy-time prereqs surfaced live and fixed (see § UAT-discovered gaps below).
- Cert issuer: Let's Encrypt Production (via DNS-01 route53). Wildcard `*.serve.term.gigaashley.click` obtained clean.
- Ashley used her existing signed-in browser session. Cookie migration required deleting the `jwt` cookie once (pre-widen cookie was host-scoped) and re-logging in.

**CHECK 1 — Positive load: PASS**
- After cookie re-login, `https://thenasty-8899.serve.term.gigaashley.click/` rendered the UAT page from thenasty's python http.server. Sibling image.png loaded as a 1x1 red pixel dot (correct — Ashley confirmed).

**CHECK 2 — Origin isolation: PASS**
- Sibling `<img src="image.png">` resolved to the same subdomain (curl verified: `content-type: image/png`, `server: SimpleHTTP/0.6 Python/3.12.3` — proving the fetch reached the target http.server via SSH tunnel, not primary Skynet).

**CHECK 3 — Auth wall: PASS**
- Ashley's incognito window hit the URL → redirected to `https://term.gigaashley.click/login?return=...`. D-14 auth_missing flow verified.

**CHECK 4 — Port-not-listening interstitial: PASS**
- Killed thenasty:8899, Ashley refreshed. Skynet-styled interstitial rendered with heading "port not responding", body "Port 8899 of thenasty isn't responding. The agent may have stopped whatever was serving there.", Try Again link, "skynet serve URL" footer. Backend log confirmed `errorClass:port_not_listening, errCode:ECONNRESET`.

**Sign-off:**

```
Verified end-to-end by tabitha + Ashley on 2026-09-10 18:08 UTC. All 4 checks passed
after 3 UAT-discovered gap fixes (see below). Phase 103 (passthrough-urls serve URL
scheme, phase 2 of 2) is shipped and verified.
```

---

## UAT-discovered gaps (fixed in-flight)

**GAP 1 — Deploy-time prereqs missing from ship runbook** (fixed at deploy, capture in box-map or ship runbook for next time):
- `SKYNET_COOKIE_DOMAIN=term.gigaashley.click` must be added to `/opt/skynet/skynet.env` BEFORE first `up -d` — otherwise Skynet crash-loops with fail-loud D-23 throw. Backend module-load throw is correct fail-loud; ship runbook needed to prompt.
- `sudo HOME=/home/ubuntu docker compose ...` — the `${HOME}/.aws/config` bind mount in docker-compose.yml expands `$HOME` at parse time; under plain `sudo` (no `-E`) HOME=/root, mount target doesn't exist, docker auto-creates an empty directory at `/root/.aws/config`, caddy's route53 plugin fails to load AWS SDK config.
- DNS A records for `*.serve.term.gigaashley.click` + `serve.term.gigaashley.click` didn't exist pre-deploy. Added via caddy AWS profile (Route53 write scope was broad enough — verified working end-to-end).
- Bare `serve.term.gigaashley.click` block was missing `tls { dns route53 }` clause; Caddy attempted HTTP-01 and got NXDOMAIN + rate-limited. Fixed the Caddyfile snippet to include DNS-01 on both wildcard and bare.

**GAP 2 — nginx short-circuits static-asset requests on serve subdomain** (real Phase 103 bug, fixed at `34ab44c8`):
- Skynet's nginx-https.conf L121-129 has `location ~* \.(js|css|png|jpg|...)$` that serves static assets from `/app/html` and returns nginx 404 for anything not present. On the serve subdomain, this short-circuits ALL image/js/css asset requests BEFORE Skynet's serve-url dispatch middleware fires — meaning `<img src="image.png">` and every JS/CSS import in an agent's served page would 404.
- Concrete UAT symptom: `/image.png` returned nginx 404 with `content-type: text/html`, never reached Express dispatch or the SSH tunnel.
- Fix: on the serve wildcard block only, `reverse_proxy skynet:30001` (Express direct) instead of `skynet:8080` (nginx). Safe because none of nginx's routing logic (SPA index, favicon aliases, static asset caching) applies on the serve subdomain — every request must flow through dispatch.

**GAP 3 — Plan 03b proxy-factory missing on.error handler** (real Phase 103 bug, fixed at `500763d3` + `e6e33f54`):
- `createProxyMiddleware` config had `on: { proxyReq, proxyReqWs }` but no `error` handler. When the SSH tunnel was up but the target port stopped listening between tunnel-open and proxy-time, http-proxy-middleware fell back to its default plain-text "Error occurred while trying to proxy: <url>" body — NOT the Skynet-styled `port_not_listening` interstitial that D-06 promises.
- Fix: extracted `classifyTunnelError` to shared `error-classifier.ts` and wired `on.error` in proxy-factory to classify → renderInterstitial → writeInterstitial. Also added ECONNRESET → port_not_listening classification (ssh2 forwardOut CHANNEL_OPEN_FAILURE surfaces as ECONNRESET on the local socket, not ECONNREFUSED).

**GAP 4 — Login-return not honored** (not fixed; new follow-up bounty opened):
- When an authed user hits a serve URL, dispatch returns 302 to `/login?return=<url>`. Skynet's `/login` frontend does not consume the `return=` param — if the user is already authed on the primary domain, they land on the main app instead of bouncing back to the serve URL. Discovered when Ashley's pre-widen cookie was host-scoped and the serve URL fired the interstitial redirect. Bounty: `serve-url-login-return-honor`.

## Orchestrator UAT completion note

Executor's skeleton write (below) completed as originally scoped. UAT execution transcript above was captured during the orchestrator's post-deploy session with Ashley on 2026-09-10.

## Executor scope statement

This SUMMARY.md was written by the Plan 10 executor on the main tree (`~/skynet-tabitha`), pre-deploy. The executor:

1. Read Plan 10 + CONTEXT.md L145-147 + all preceding SUMMARY.md files (01-09).
2. Wrote this skeleton SUMMARY.md with the 4-check UAT protocol enumerated as an Ashley-runnable checklist with fillable transcript fields.
3. Committed the skeleton atomically.
4. Returned a `CHECKPOINT REACHED` message to the orchestrator awaiting Ashley's post-deploy UAT run.

The executor did **NOT**:

- Attempt to execute the UAT itself (would fail — `t1000-8899.serve.term.gigaashley.click` doesn't resolve pre-deploy).
- Attempt to deploy anything (per standing directive: subagents don't do deploys).
- Push, build, or run tests (per Plan 10 scope: pure UAT documentation).

Ashley (or the identity at t1000 post-deploy) will fill the transcript fields during the actual UAT run and either sign off with the "All 4 checks passed" line OR record the failure diagnostic + return to orchestrator for gap-closure.

## Self-Check: PASSED

- `[ -f .planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/103-10-SUMMARY.md ]` → FOUND
- Skeleton documents all 4 checks (positive load / origin isolation / auth wall / port-not-listening interstitial) with concrete curl/browser steps → CONFIRMED
- Skeleton notes UAT awaits post-deploy execution → CONFIRMED
- Sign-off line template present (both PASS and FAIL variants) → CONFIRMED
