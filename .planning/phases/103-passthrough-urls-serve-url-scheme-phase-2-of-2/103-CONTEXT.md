# Phase 103: Passthrough URLs — serve URL scheme (phase 2 of 2) - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the serve URL half of the two-phase passthrough URLs shape (phase 1 = file URL, shipped as Phase 78). Agents on any Skynet-managed host construct `<hostname>-<port>.serve.term.<skynet-domain>` URLs; users click them; Skynet reverse-proxies HTTP + WebSocket traffic through an SSH tunnel to whatever the agent has running on that port. Wildcard-subdomain-per-`(host, port)` provides origin isolation so modern frontends (Vite / Next.js / anything with absolute-path assets) work without silent breakage. Per-user-per-host auth is enforced at the edge via a widened JWT cookie + full defense stack (allowlist-strip on proxy forward, CI + runtime cookie-egress checks, CORS-based CSRF defense, WebSocket Origin checks).

Also in scope: rewriting the id-skill "Sending files to the user" section to add the serve-URL guidance (active-vs-passive framing) and DELETE the old tailnet-HTTP-server recipe entirely — no dual-path.

Not in scope: cross-user app sharing (goes through the future first-class "Apps" concept), custom frontend visual affordance for serve/file URLs (its own future shape with a tasting session).

</domain>

<decisions>
## Implementation Decisions

The shape file's `## Phase 2 locked decisions` section at `.planning/shapes/shape-skynet-passthrough-urls.md` is the LOAD-BEARING source of truth for the Q1–Q6 decisions listed briefly here. Planner and researcher MUST read that section — this file summarizes but does not restate the full detail.

### Auth (from shape Q1)
- **D-01:** URL grammar: `<host>-<port>.serve.term.<skynet-domain>` (one label deeper than the primary domain, NOT directly under registrable domain).
- **D-02:** Widen JWT session cookie to `Domain=term.<skynet-domain>` (in `src/backend/utils/auth-manager.ts:709` `getSecureCookieOptions`). Covers `term.<skynet-domain>` + all `*.term.<skynet-domain>` subdomains only. Siblings on the registrable domain (`files.example.com`) untouched.
- **D-03:** Serve-subdomain proxy validates JWT + per-user-per-host permission at the edge before forwarding.
- **D-04:** **Allowlist-strip** at the proxy before forwarding to upstream — everything denied by default, only Host, Connection, Upgrade, `Sec-WebSocket-*`, Content-Type, Content-Length, method, body pass. NO cookies, NO `Authorization`, NO `X-Skynet-*`. Test-enforced.
- **D-05:** CI integration test: echo-server upstream, assert no `Cookie: skynet_session=` (or any auth cookie) reaches upstream across GET / POST / WebSocket upgrade / SSE / streaming / uploads / redirects. Test lives with the phase 103 code, MUST pass to merge.
- **D-06:** Runtime header-fingerprint sampler alerting on any header anomaly hitting upstream. Second layer of defense.
- **D-07:** Primary domain `term.<domain>` refuses `Access-Control-Allow-Origin` for `*.serve.term.<domain>`. CSRF from serve subdomains blocked at browser preflight layer for any state-changing endpoint requiring preflight.
- **D-08:** WebSocket endpoints on `term.<domain>` need explicit `Origin`-header checks rejecting `*.serve.term.<domain>` (WS doesn't do CORS preflight).

### CSRF audit (from discuss-phase Q2)
- **D-09:** **Full audit** of every route in `src/backend/database/routes/`. Classify each as read-only or state-changing. For state-changing: verify preflight-triggering shape (JSON POST / PUT / DELETE / PATCH / custom header) OR add CSRF token. Take the time to do this comprehensively — no partial-audit shipping.
- **D-10:** Multipart form-upload endpoints on `term.<domain>` need explicit origin checks or CSRF tokens (multipart is a CORS-simple content type, doesn't preflight).

### URL parse rules (from shape Q2)
- **D-11:** Parse rule: split on the LAST dash of the leftmost DNS label; right side must be all-digits (port); everything left is the hostname. Reject on parse failure with a clear 400.
- **D-12:** Enforce at host registration: no hostname may end in `-\d+`. Add validation to the host-add code path. Current fleet passes (thenasty, workstation, linux-beelink, aither-cloud/cloud2/sftp, t1000, t800, WINDOWS-PC, ZoeyBattlestation).
- **D-13:** Hostname lookup uses `LOWER(hostname) = LOWER($input)` — no schema migration for existing mixed-case rows. Display case preserved.

### Broken-serve UX + tunnel lifecycle (from shape Q3)
- **D-14:** Skynet-styled interstitial rendered on the serve subdomain itself, one page per failure class: port-not-listening, host-unreachable, permission-denied, SSH-level-failure, auth-missing/expired (last one redirects to primary for re-auth). Plain "Try again" button, NO auto-refresh.
- **D-15:** Tunnel death (network flap, sshd restart, target reboot): transparent recovery on next request. In-flight WebSockets close with meaningful close code (1011 or similar) — client-side reconnect logic knows it's transport-level.
- **D-16:** NO cache eviction built. Per-target proxy instances live for container lifetime; SSH connection lifecycle handled by existing pool. Add eviction only if resource pressure surfaces post-ship.

### Multi-tenancy resolution (from shape Q5)
- **D-17:** Backend serve URL routing calls existing `resolveHostByName(name, userId)` from `src/backend/ssh/host-resolver.ts:373` — **owned-only**, matches Phase 78 file URL precedent. Grants (`hostAccess` table) deliberately out of scope for name resolution. Works uniformly on t1000 (single-tenant) and T800 (multi-user).

### Domain layout + rollout (from shape Q6 + discuss-phase Q1)
- **D-18:** Wildcard cert: `*.serve.term.example.com`. Existing hosted zone `example.com` (<personal-hosted-zone-id>). R&D-established cross-account AssumeRole path (Aither `termix-ssm-role` → personal `<caddy-route53-role>`) covers this zone.
- **D-19:** Same Caddy container as `term.example.com` and `files.example.com`. Custom Caddy build (two-line Dockerfile change: `caddy:2-builder` + `xcaddy build --with github.com/caddy-dns/route53`). New wildcard site block added to `/opt/skynet/Caddyfile`.
- **D-20:** Bare `serve.term.example.com` (no host prefix) redirects to `term.example.com`.
- **D-21:** ACME issuer: **Let's Encrypt production** preferred; ZeroSSL remains automatic fallback via Caddy's default issuer chain.
- **D-22:** HSTS: mirror whatever `term.example.com` currently sets (verify against existing Caddyfile during plan).
- **D-23:** T800 (Stacy): entirely her domain + DNS + Caddy config. No code Phase 103 writes handles T800 differently. Ships as a Stacy-briefing patch under the fleet-substrate rule after Phase 103 lands on t1000.
- **D-24:** **Single deploy** — Caddy image rebuild + cookie widen + subdomain routing + agent URL construction all live in one atomic ship motion. No feature flag, no dark-first infra deploy.

### id-skill guidance (from shape Q4 + discuss-phase Q3)
- **D-25:** id-skill "Sending files to the user" section rewrite lands **in Phase 103**, not as a follow-up. Distributor sweeps the new skill body to every managed box; agents pick up the new pattern on next `/id <name>` load.
- **D-26:** Framing: **active vs passive**. *Active* = something running on the other end (dev server, jupyter, WS stream, static server for multi-file content) → serve URL. *Passive* = bytes on disk (a doc, screenshot, log, config, downloadable binary) → file URL. Rule of thumb: "Do you need something running on the other end for the user to have the right experience?"
- **D-27:** DELETE the old tailnet-HTTP-server recipe entirely — no dual-path. Shape philosophy: dual-path invites the wrong pattern to persist.
- **D-28:** NO auto-serve heuristics that would rewrite file URLs into serve URLs (agents-aren't-lied-to).

### Frontend surface (from discuss-phase Q4)
- **D-29:** Phase 103 frontend delivers **plain clickable link** for serve URLs — no custom visual affordance. Same tailnet-URL-detection stack Phase 78 extended; add serve URL regex; render as clickable, that's it.
- **D-30:** Custom visual render for BOTH file URLs and serve URLs (icon, preview, "live app" indicator, whatever design lands) becomes its own future shape with a tasting session. See Deferred.

### Claude's Discretion
- Wave/plan sequencing across the ~10-15 implementation items (Caddy image rebuild + Caddyfile + backend subdomain dispatch + `http-proxy-middleware` new dep + per-target proxy cache + SSH tunnel wiring via `guacamole/routes.ts:295-395` pattern + JWT domain widen + allowlist-strip + CI cookie-egress test + runtime header sampler + WS Origin check + CSRF audit + hostname registration validation + frontend URL detection + id-skill rewrite) — planner picks wave boundaries and dependency ordering. Suggested rough grouping (planner refines): infra-first wave (Caddy image + Caddyfile), auth wave (cookie widen + allowlist-strip + CI test + CSRF audit), routing wave (subdomain dispatch + tunnel + proxy), UX wave (interstitials + frontend detection), id-skill wave (skill rewrite + distributor).
- Exact regex shape for serve URL detection — mirror `TAILNET_URL_RE_CLIENT` and the file-URL regex from `src/ui/features/pretty-view/editable-file-whitelist.ts`.
- Which existing SSH-pool functions to call (`getConnection` vs `withConnection` etc.) — planner scouts.
- Specific test files + test count — planner + researcher decide.
- Which route-file-level or middleware-level allowlist-strip mechanism to use in `http-proxy-middleware` — planner selects the correct proxy-lib hook.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape + R&D (LOAD-BEARING — read first)
- `.planning/shapes/shape-skynet-passthrough-urls.md` — the two-phase shape agreed with Alice 2026-09-05, plus the **Phase 2 locked decisions** section at end (added 2026-09-10 post-`/open`) that captures the resolved Q1-Q6 detail this CONTEXT.md summarizes. THIS SECTION IS THE PRIMARY SOURCE OF TRUTH for Phase 103 decisions.
- `~/.claude/roles/box-maintainer/bounties/archive/skynet-passthrough-urls-rd/findings-summary.md` — R&D findings (7 POCs, gotcha catalog, cross-account AssumeRole proof, real cert issuance walk-through). Read for: implementation-item breakdown at "Inputs to phase 2 plan (serve URL)"; the 5 GOTCHAs (esp. GOTCHA 1 permessage-deflate stripping); the Caddy + Route 53 build recipe; the AWS SDK profile config that Caddy container needs; the exact IAM inline policy JSON.
- `~/.claude/roles/box-maintainer/bounties/archive/skynet-passthrough-urls-rd/poc/` — reference POC code, esp. `proxy-full-stack.mjs` (POC 6: subdomain vhost + SSH tunnel + per-target-cached proxy + extension-strip WS fix) and `caddy-r53/Dockerfile` + `caddy-r53/Caddyfile.sample`.

### Phase 78 precedent (file URL — same shape, phase 1)
- `.planning/phases/78-passthrough-urls-file-url-scheme-phase-1-of-2/78-CONTEXT.md` — Phase 78's context. Especially the file-URL infrastructure decisions (D-01 URL grammar, D-02 passive-render + on-click error, D-03 parent-Skynet-domain config, D-04 SSH-user-based auth). Phase 103 mirrors many of these choices.
- `.planning/phases/78-passthrough-urls-file-url-scheme-phase-1-of-2/78-VERIFICATION.md` — what was verified for Phase 78; use as UAT template shape for Phase 103.
- `src/backend/ssh/host-resolver.ts` — `resolveHostByName(name, userId)` at line 373. Phase 103 REUSES this verbatim for owned-only host lookup (per D-17).
- `src/backend/database/routes/pretty-view-fetch-host-file.ts` — Phase 78 backend file-fetch route. Reference for auth wiring (`permissionManager.canAccessHost`) and structured error shape.

### Reusable infrastructure (do NOT fork)
- `src/backend/ssh/ssh-connection-pool.ts` — SSH connection pool (3 conns/host, health-checked). Phase 103 tunnel setup uses `getConnection`/`withConnection` from here. `MaxSessions=10` × 3 conns per host = ~30 concurrent channels per host (documented in R&D GOTCHA 3).
- `src/backend/guacamole/routes.ts:295-395` — canonical `net.createServer` + `sshClient.forwardOut` + `sock.pipe(stream).pipe(sock)` pattern. Phase 103's SSH tunnel setup follows this pattern almost verbatim.
- `src/backend/ssh/tunnel.ts` + `src/backend/ssh/tunnel-ssh-primitives.ts` — established tunnel machinery + algorithm negotiation. Reference; Phase 103 uses the higher-level pool + guac pattern rather than these primitives directly.
- `src/backend/utils/auth-manager.ts:709` — `getSecureCookieOptions`. Phase 103 modifies to add `Domain=term.<skynet-domain>` (D-02).
- `src/backend/utils/permission-manager.ts` — `PermissionManager.canAccessHost(userId, hostId, action)`. Phase 103 route uses this for the per-user-per-host auth check (matches Phase 78 pattern).
- `src/ui/features/pretty-view/editable-file-whitelist.ts` — Phase 40+78 URL detection stack (client-side + backend mirror). Phase 103 adds a SIBLING regex for serve URLs; the whitelist itself doesn't apply (serve URLs render as plain clickable links per D-29, not through the edit-file affordance).
- `src/backend/utils/cors-config.ts` — existing CORS config. Phase 103 adds serve-subdomain rejection rules per D-07.

### Config + distributor
- `/opt/skynet/docker-compose.yml` — the compose file that references the Caddy service. Phase 103 changes: build reference to point at custom Caddy Dockerfile.
- `/opt/skynet/Caddyfile` — the deployed Caddyfile. Phase 103 adds new wildcard site block + bare-redirect block per D-19/D-20.
- `docker/` — Skynet's Dockerfile directory. New sibling Dockerfile or a two-stage extension for Caddy custom build.
- Fleet-substrate distributor (owned by this role) — the sweep that pushes `~/.claude/skills/*`. Phase 103's id-skill rewrite lands here; agents pick up on next distributor sweep + `/id <name>` reload.

### Role standing directives (verify against before ship)
- `~/.claude/roles/box-maintainer/box-maintainer.md` — standing directives section. Especially:
  - **Container mutations serialize** — coord-room BEFORE + AFTER posts, dormancy check.
  - **Test discipline** — scoped during dev, full suite as first step of deploy motion (not before push).
  - **Deploy boundary at `git push`** — commit + scoped-green ok autonomously; `git push` needs fresh per-push greenlight from Alice.
  - **Full suite ship gate** — `npx vitest run` (no scope) + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` — both exit 0.
  - **After container restart, tail docker logs and understand every line** — startup-line spot check.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **SSH connection pool** (`src/backend/ssh/ssh-connection-pool.ts`) — Phase 103 tunnel setup calls `getConnection`/`withConnection`; do NOT open new SSH clients or a parallel pool.
- **Guacamole reverse-proxy pattern** (`src/backend/guacamole/routes.ts:295-395`) — `net.createServer` + `sshClient.forwardOut` + `pipe` streams. Phase 103's per-`(host, port)` tunnel setup mirrors this pattern; wrap in a `Map<target, tunnelInstance>` cache.
- **Permission manager** (`src/backend/utils/permission-manager.ts`) — `canAccessHost(userId, hostId, action)`. Phase 103 route uses this exactly like Phase 78 file URL route does.
- **JWT cookie setup** (`src/backend/utils/auth-manager.ts:709` `getSecureCookieOptions`) — currently sets no `Domain`. Phase 103 modifies to widen to `Domain=term.<skynet-domain>` (single-file change, but ships as part of the same deploy as the serve-URL infra per D-24).
- **CORS config** (`src/backend/utils/cors-config.ts`) — Phase 103 extends to reject `*.serve.term.<domain>` origins.
- **Existing Phase 78 backend route** (`src/backend/database/routes/pretty-view-fetch-host-file.ts`) — the file-URL analog; Phase 103 backend serve-URL route follows the same auth-wiring + error-shape patterns.

### Established Patterns
- **In-memory SQLite `DatabaseSaveTrigger.forceSave` rule** (from box-maintainer.md load-bearing invariants) — Phase 103 doesn't obviously touch DB writes (routing is per-request, no persistent state), but the host-registration validation change (D-12) IS a DB-adjacent code path — if it writes, needs `forceSave`. Planner check.
- **Host record trap** (from box-maintainer.md) — editing a host's protocol/RDP tab nulls its SSH key. Phase 103's host-registration validation (D-12) touches the host CRUD flow; ensure the validation happens WITHOUT walking into the null-key trap.
- **Enable flags** (`enableSsh`/`enableRdp`/`enableTerminal`) — required combos on any PUT. Serve URL access doesn't need a new enable flag but shouldn't accidentally reset these.
- **Guac pattern uses `pipeTunnelStreams` from `tunnel-ssh-primitives.ts`** — Phase 103 tunnel wiring can use the same helper or drop to `sock.pipe(stream)` directly per POC 6's simpler shape.

### Integration Points
- **Caddy edge → Skynet backend** — Caddy adds `header_up X-Skynet-Serve-Subdomain {host}` (per R&D Caddyfile shape); backend middleware parses out `<hostname>-<port>` and dispatches. Fallback: no serve subdomain matches → falls through to existing Skynet frontend serving.
- **Backend serve-URL route → SSH tunnel → agent's local port** — new dispatch layer plugged on top of existing SSH pool + guac tunnel pattern. Zero new SSH infrastructure needed.
- **id-skill "Sending files to the user" section** — currently has the file-URL sub-section (Phase 78 rewrite). Phase 103 adds serve-URL sub-section beside it + decision-guidance section (active vs passive) + DELETES the pre-Phase-78 tailnet-HTTP recipe (which the current SKILL.md may or may not still contain — check).

</code_context>

<specifics>
## Specific Ideas

- **Interstitial "try again" button** must NOT auto-refresh (per D-14). User decides to retry — auto-refresh masks legitimate ongoing outages.
- **Interstitial pages MUST be Skynet-styled**, not bare 502s. User sees "port 3020 of nexthost isn't responding" not "Bad Gateway."
- **Test with `python -m http.server` on t1000** as the first end-to-end verification per shape file rollout step 4. Concrete: agent construct `t1000-8899.serve.term.example.com` pointing at a python http.server serving a folder with a few files including one HTML that references a sibling image (proves origin isolation works). Manual UAT is fine; automated verification is Claude's discretion.
- **Vite HMR test** — POC 2 already proved the `sec-websocket-extensions: ""` fix on `proxyReqWs` works for Vite's `vite-hmr` subprotocol. Phase 103 code MUST include this fix from day one (per R&D GOTCHA 1) — bake into the proxy factory, not left as a follow-up.
- **CSRF audit output** should produce a checklist (route path, state-changing yes/no, preflight-triggering yes/no, remediation applied, verified). Attach to phase artifacts (SUMMARY.md or a dedicated CSRF-AUDIT.md) so future audits can start from this baseline instead of re-doing the classification.

</specifics>

<deferred>
## Deferred Ideas

### Ideas that surfaced during /open + discuss-phase but belong elsewhere

- **First-class "Apps" concept in Skynet** — persistent, Skynet-managed apps as their own feature (not tied to specific identity), Bun/SQLite stack (per Stacy's app-stack skill), Apps panel UI, droppable into the split-view shell alongside chats, own sharing model (fork vs share instance). Cross-user "share my agent-built app with another user" belongs to THIS concept, NOT to serve URL. Whole shape file worth of design conversation eventually. Bounty `first-class-agent-apps-in-skynet` to open at end of tabitha's session 2026-09-10.

- **Custom visual affordance for BOTH file URLs and serve URLs in the chat surface** — Phase 78 file URLs currently get the pencil-edit affordance (function-specific); Phase 103 serve URLs will land as plain clickable links per D-29. The CUSTOM RENDER work (icon, preview card, "live app" indicator, distinguishing Skynet-proxied URLs from random web links, whatever design lands) becomes its own shape after Alice tastes options. Not tacked onto Phase 103. Bounty `serve-and-file-url-visual-affordances` to open at end of tabitha's session 2026-09-10.

- **Per-URL revocation / rate-limiting / custom headers / request-body inspection on serve URLs** — deferred per shape file scope edges. Add if a real need surfaces after shipping. Not Phase 103.

- **Skynet-side dashboard showing "which serve URLs are live right now"** — deferred per shape file scope edges. URLs are ephemeral by nature; no state to display.

- **Per-user disambiguation UX for the (rare) case where a user owns two hosts with the same name** — Phase 103 first-match-wins with a warning-logged event (per D-17 with Alice's Q5 discussion). If it ever bites in practice, add richer disambiguation then.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Context gathered: 2026-09-10*
</content>
</invoke>