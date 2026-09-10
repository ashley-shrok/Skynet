# Shape: more universal file sharing and web serving than what the id skill offers now

**Opened:** 2026-09-05
**Vehicle:** R&D spike (this session, runway-generous) → two GSD phases (file-URL first, serve-URL second)

## What this is

Two matching URL schemes hosted by Skynet so agents on any Skynet-managed host can make files and locally-served pages accessible to the user with a single URL that works over the same HTTPS surface the user is already on. Replaces the current pattern where agents stand up their own HTTP servers on the tailnet and hand the user tailnet IPs — a pattern that only works on tailnet-attached Skynets and trips Chrome's insecure-download friction.

## Shape

Two URL schemes, both constructed by agents themselves, both symmetric in mental model:

- The **file URL** points at a specific file at an absolute path on a host. Skynet reads the file from the host on request and surfaces it in the message bubble with the existing view + pencil-edit affordance. Read-only from Skynet's side.
- The **serve URL** points at a port on a host. Skynet reverse-proxies HTTP (WebSocket upgrade included) through to whatever the agent has running on that port. Skynet doesn't care what's on the other side — plain static content, a live dev server, a diagnostic stream, whatever the agent stood up.

Both URLs use the host's real name (not an internal identifier) so agents can construct them with one command they already know how to run. Both inherit Skynet's existing per-user-per-host access grants — a user who can't access a host today can't reach it through either URL either.

The edit affordance for files stays exactly as it works today: click the pencil, edit in a modal, hit save, the edited file gets attached to the compose box the way a locally-picked file would, and travels with the user's next message. Skynet has zero write authority into any host's filesystem — every write goes through the agent, driven by the attached file in the next message.

Agents on Skynet-registered hosts have this affordance. Agents on unregistered boxes don't — and they wouldn't have any way to make things accessible to the user anyway, chicken-and-egg.

Each managed box needs to know its own parent Skynet's domain so agents can construct URLs. That per-box config exists as part of this shape and is pushed through the same distributor mechanism that keeps the rest of the fleet substrate current.

## Philosophy

**Agents aren't lied to.** The URL an agent writes into a message is the actual URL the user clicks. No rewriting, no dressing localhost as something else, no Skynet-side detection that surfaces "some" paths as clickable while leaving others plain. Agents construct URLs deliberately, users learn to recognize the shape, and the affordance is exactly-when-you-see-it. Both sides share the same picture of what's happening.

**Skynet is the delivery surface, not the agent.** The bytes live on the agent's box; the agent's job is to say where. Skynet is what the user actually talks to over HTTPS. This is what lets us drop the tailnet dependency, kill the Chrome insecure warnings, and cover Skynet deployments (T800 and future user-VMs) that never sit on the fleet tailnet.

**Files are read-only from Skynet's side; edits round-trip through the user's next message.** Skynet never overwrites files at arbitrary paths on arbitrary hosts. The user's edit becomes an attachment to their next message; the agent decides what to do with it. This clean lack-of-write-authority means "Skynet as universal file access" doesn't quietly become "Skynet as universal file writer" — a much wider blast radius we don't want.

**Passthrough for served pages, no assumptions about what's on the other side.** Skynet doesn't try to host arbitrary agent content — it just proxies. Agents can stand up literally anything that speaks HTTP and it works, because Skynet doesn't interpret the payload.

**Symmetric mental model, one contract two shapes.** File URLs and serve URLs are the same idea addressed at different granularities: Skynet as a proxy to hosts it manages, addressed by URL. Users and agents both benefit from the symmetry.

## Prior context

The id skill currently tells agents to bundle files into a temporary directory, launch a small local HTTP server on the tailnet IP, and hand the user a link to that server. Works, but:

- Requires the box to be on the fleet tailnet — T800 (Aither Health deployment, Stacy-maintained) doesn't have this, future customer VMs on their own AWS networks won't either.
- Chrome flags every HTTP-to-IP download as insecure — user has to right-click "save as" and then confirm "keep" in the downloads tray. Every time.
- Agents have to actively serve — stand up their own local server, wrap it to declare correct MIME types on Markdown, kill it by explicit process ID after use, and steer clear of the process-killing patterns that match their own command line.
- The current section in the id skill has real gotchas baked in (charset handling, process lifecycle, subdirectory serving) — all of that goes away when Skynet is the delivery surface.

Skynet already has the machinery this rebuild needs: per-host encrypted SSH credentials, SSH client for terminal sessions, per-user-per-host access grants, and a message-rendering pipeline that today detects tailnet-served links and surfaces an edit-in-bubble affordance. This isn't a greenfield build — most pieces exist and get repointed or extended.

The edit-in-bubble affordance's specific flow is worth calling out because it's structurally load-bearing: the save button doesn't write back to source. It takes the edited bytes and attaches them to the compose box as if the user had picked a local file. The next message the user sends carries the attachment along with automatic wording telling the agent where to find it. This flow stays exactly as-is.

## What would make it wrong

- **Agents construct a URL and it silently doesn't work.** User clicks and it hangs or returns a confusing error. This is the load-bearing failure mode — the affordance's credibility depends on "if you can see it, it works." Broken URLs undermine every future URL.
- **The serve URL claims passthrough but silently drops WebSockets or breaks live reactivity.** An agent stands up a live dev server, hands the URL to the user, the page loads but hot-reload never fires. Neither side has a signal something's wrong. This is the class of bug that reintroduces the "we fixed this and it's still broken" pain from other tangled layers.
- **Origin isolation gets skipped and modern frontends silently break under path-prefix serve URLs.** A frontend framework that emits absolute-path asset references (most of them do) served at a path prefix will have those references resolve against Skynet's origin instead of the served app's origin. Half the page loads with the rest silently missing. This is why the plan phase for serve has to commit to some form of per-host-per-port origin isolation up front — retrofitting later is much worse than getting it right the first time.
- **Auth grants stop being respected on the new routes.** A user on T800 who wasn't granted access to another user's VM discovers they can reach it via a proxy URL. This isn't a hypothetical — T800 is going multi-tenant and this door has to inherit the existing gate, not open a wider one.
- **Skynet's read access falls short on paths agents actually write to.** Agent writes a scratch file, cites the URL, Skynet's SSH access on that host can't read it. Agent has no easy signal from their side; user sees a broken URL. Whatever mechanic Skynet uses to reach the file has to actually cover the space of paths agents write to.
- **The tailnet-serve pattern lives on in agent muscle memory because the id skill rewrite is unclear.** Agents keep spinning up their own local HTTP servers because they read the new id skill and didn't quite believe the URL-scheme thing works. The section rewrite has to be affirmative and specific enough that the new pattern is obvious and the old one is clearly retired.
- **The parent-Skynet-domain config doesn't reliably land on every managed box.** An agent doesn't know what URL to construct because the config file is missing or stale. Silent — the agent falls back to guessing or omitting the URL entirely. The distributor push for this config has to be as reliable as the rest of the substrate.

## Scope edges

**In:**
- File-URL scheme, backend fetch from host, frontend URL detection + repointed edit affordance
- Serve-URL scheme, reverse proxy with WebSocket upgrade, origin isolation for served pages
- Per-user-per-host auth on both routes
- id-skill section rewrite (file half after phase 1, serve half after phase 2)
- Per-box parent-Skynet-domain config mechanism pushed via the distributor

**Out:**
- Directory browsing via file URL (agents list multiple URLs instead)
- Skynet writing directly into files on hosts (edits round-trip through user's next message)
- Any affordance for agents on unregistered hosts
- MCP, custom tool-calls, or any active integration protocol beyond agents-write-URLs-in-messages
- Streaming/uploading bytes from agent up to Skynet (Skynet always pulls from the host)

**Deferred:**
- Anything beyond raw HTTP+WebSocket passthrough on the serve URL (rate limits, per-URL revocation, custom headers, request-body inspection) — add if a real need surfaces after shipping
- Skynet-side surfacing of "which files are being shared right now" as a dashboard or history — no state to display; URLs are ephemeral by nature
- Cross-user "share my agent-built app with another user" — belongs to the future first-class **Apps** concept (persistent Skynet-managed apps, user-owned not agent-owned, own UI panel, own sharing model, split-view droppable alongside chats). Not a serve URL gap — the two are distinct primitives. See bounty `first-class-agent-apps-in-skynet` for the design arc.

**Tempting but no:**
- Skynet-side path detection that auto-surfaces any plausible-looking path from agent chatter as clickable. Would silently be inconsistent (some paths surface, some don't; some resolve, some 403 depending on user's per-host grants) and confuse both sides. The whole design turns on agents CONSTRUCTING URLs deliberately.
- Rewriting agent-written localhost URLs into Skynet-side proxy URLs. Introduces mismatch between what the agent believes and what the user sees, which is exactly the lying-to-agents pattern to avoid.
- Fallback to tailnet-serve on boxes that happen to be on the tailnet. Dual-path in the id skill invites the wrong pattern to persist; single-path is cleaner even where fallback would technically work.

## Vehicle notes

**R&D spike first (this session).** Because phase 2 has real infrastructure unknowns (origin-isolation via wildcard subdomain + TLS + DNS-provider integration, reverse-proxy behavior with WebSockets and modern frontends, SSH tunnel machinery patterns), focused R&D happens BEFORE either phase's plan lands. Ashley's direction: take runway, don't optimize for efficiency, pressure-test until things actually work under real conditions. Findings inform both phase plans and land in bounty `skynet-passthrough-urls-rd` under the box-maintainer role's bounty pool. Concrete questions to answer:

1. **Wildcard TLS + subdomain routing end-to-end.** What DNS provider does `gigaashley.click` sit on? Does Caddy have a plugin for it? Can we issue a wildcard cert and route wildcards to Skynet's backend on a test subdomain without disrupting production? What secrets/config additions does the Caddy setup need?
2. **Reverse-proxy + WebSocket + real frontends.** Pick a Node reverse-proxy approach; stand up a POC; pressure-test with a Vite dev server (does hot-reload survive?), a WebSocket-heavy app, an SSE stream, a POST-heavy API, cookie flows, static assets served at absolute paths. Find the gotchas before phase 2 commits.
3. **SSH tunnel machinery in Skynet's existing SSH stack.** How does the current SSH usage layer for tunnels vs terminal sessions? Persistent tunnels vs per-request? Connection pooling? Cleanup lifecycle? Any pattern to reuse.
4. **Origin-isolation alternatives sanity check.** Confirm wildcard subdomain is the right approach vs any less-heavy alternative (path prefix with response rewriting, per-app base-path config, etc.) — not by argument but by trying the failure modes and confirming they're actually bad.

Ashley offered to hook this up with the Aither VPC team if AWS/DNS resources need to be created for testing.

**Then, two GSD phases run sequentially:**

**Phase 1 — file URL.** Higher confidence, immediately useful, delivers the "file sharing" half of the pain. Puts the URL-detection framework and per-user-per-host auth wiring in place — infrastructure phase 2 reuses. Scope: backend route for `/file/<host>/<absolute-path>`, host file read via existing SSH credentials, frontend URL detection + repointed edit modal, id-skill section update (file half only), per-box parent-Skynet-domain config mechanism (needed on first phase since even the file URL requires it).

**Phase 2 — serve URL.** Real substantive work — reverse proxy with WebSocket upgrade, tunnel machinery for reaching arbitrary ports on managed hosts, and the origin-isolation infrastructure for served content. The origin-isolation piece (some form of URL structure where each host+port presents as its own web origin so absolute-path references from proxied apps don't leak into Skynet's own origin) is a specific known unknown; the plan phase should commit to a specific approach — likely wildcard subdomains with wildcard TLS — before code lands. Retrofitting is worse than getting it right the first time. id-skill section gets the serve half added after this ships.

Both phases affect `~/skynet-tiffany/` (my working tree) — Skynet backend + frontend code lives in this repo. id-skill update pushes through the fleet-substrate distributor to every managed box.

Ship discipline as normal: coord room announces, source pulled and rebased before push, full test suite green as deploy gate. Both phases are backend + frontend work — normal Skynet build + force-recreate deploy motion.

Handoff: this shape file is at `.planning/shapes/shape-skynet-passthrough-urls.md`. R&D findings live in bounty `skynet-passthrough-urls-rd`. Both phases reference this shape; `/close skynet-passthrough-urls` at the end of phase 2 verifies the built result against this agreement. If R&D or phase 1 discovers something that changes the shape, come back to this file and update it before proceeding — the shape governs.

## Phase 2 locked decisions — from `/open` discussion 2026-09-10 (tabitha + Ashley)

Post-R&D `/open` session on 2026-09-10 pressure-tested and locked the following Phase 2 design decisions. These are LOCKED and seed the CONTEXT.md for Phase 2's `/gsd:discuss-phase`.

### Q1 — Auth model

- URL nesting: `<host>-<port>.serve.term.<skynet-domain>` (one label deeper than the primary domain, NOT directly under the registrable domain).
- Widen Skynet's JWT session cookie to `Domain=term.<skynet-domain>` — precisely one label deeper, NOT the whole registrable domain. Covers `term.<skynet-domain>` + all `*.term.<skynet-domain>` subdomains and stops there. Siblings on the registrable domain (e.g. `files.gigaashley.click`) are untouched.
- Serve-subdomain proxy validates JWT + per-user-per-host permission at the edge.
- **Allowlist-strip** at the proxy before forwarding to upstream — everything is denied by default, only a small explicit set of headers passes (Host, Connection, Upgrade, `Sec-WebSocket-*`, Content-Type, Content-Length, method + body). NO cookies, NO `Authorization`, NO `X-Skynet-*`.
- **CI integration test**: echo-server upstream, assert no `Cookie:` header (esp. `skynet_session=`) reaches upstream on any code path — GET, POST, WebSocket upgrade, SSE, streaming, uploads, redirects, everything. Belt.
- **Runtime header-fingerprint sampler** alerts on any header anomaly hitting upstream. Suspenders.
- Primary domain (`term.<skynet-domain>`) refuses `Access-Control-Allow-Origin` for serve subdomains. Any state-changing endpoint requiring CORS preflight (JSON POST, PUT, DELETE, custom header) is blocked from cross-origin CSRF by the browser's preflight layer.
- **CSRF audit of every state-changing endpoint on `term.<domain>`** is Phase 2 work, not a follow-up. Any endpoint that accepts form-encoded POST or has GET-with-side-effects becomes a CSRF vector once the cookie widens — add CSRF tokens or convert to preflight-triggering shapes.
- WebSocket endpoints on `term.<domain>` need explicit `Origin`-header checks that reject `*.serve.term.<domain>` (WS doesn't do CORS preflight).

### Q2 — URL parse rules

- Grammar: `<host>-<port>.serve.term.<skynet-domain>`. Split on the LAST dash of the leftmost DNS label; right side must be all-digits (the port); everything left is the hostname.
- **Registration constraint**: no hostname may end in `-\d+`. Enforced at host-add time. Current fleet hosts (thenasty, workstation, ashley-beelink, aither-cloud, aither-cloud2, aither-sftp, t1000, t800, GIGAASHLEYPC, ZoeyBattlestation) all pass the constraint.
- Case: keep display case in DB, lowercase for lookup (`LOWER(hostname) = LOWER($input)`) — no schema migration needed for existing mixed-case rows.

### Q3 — Broken-serve UX + tunnel lifecycle

- Skynet-styled interstitial rendered on the serve subdomain itself, one page per failure class: port-not-listening, host-unreachable, permission-denied, SSH-level-failure, auth-missing/expired (redirect to primary for re-auth). Plain "Try again" button; NO auto-refresh (masks legitimate outages).
- Tunnel death (network flap, sshd restart, target reboot): transparent recovery on the next request — pool re-establishes on demand. In-flight HTTP requests fail with a proper error; in-flight WebSockets close with a meaningful close code (1011 "internal error" or similar) so client-side reconnect logic knows it's transport-level.
- **No cache eviction built now.** Per-target proxy instances live for the container lifetime; SSH connection lifecycle already handled by the existing pool. Add eviction later only if resource pressure surfaces.

### Q4 — id-skill guidance

- Framing: **active vs passive.** *Active* = something running on the other end (dev server, jupyter, WS stream, static server for multi-file content) → serve URL. *Passive* = bytes on disk (a doc, screenshot, log, config, downloadable binary) → file URL. Compact decision rule in the id-skill: "Do you need something running on the other end for the user to have the right experience?"
- The old tailnet-HTTP-server recipe is DELETED from the id-skill entirely — no dual-path (the shape's "What would make it wrong" lists tailnet-serve muscle-memory persistence as a failure mode).
- NO auto-serve heuristics that would rewrite file URLs into serve URLs (agents-aren't-lied-to philosophy).

### Q5 — Multi-tenancy resolution

- Backend serve URL routing calls existing `resolveHostByName(name, userId)` from Phase 78 — **owned-only**, matches file URL precedent (Phase 78 comment: *"no shared-access branch to walk"*).
- Grants (`hostAccess`) deliberately out of scope for name resolution. Cross-user serve URL handoff is not supported.
- Works uniformly on t1000 (single-tenant, no collisions possible) and T800 (multi-user; each user's own hosts are their own namespace; other users' hosts are invisible via name resolution).
- Cross-user "share my app with another user" use case is NOT a serve URL gap — it belongs to the future "Apps" concept (see Deferred section above).

### Q6 — Domain layout

- Wildcard cert: `*.serve.term.gigaashley.click` (single-level wildcard). Existing hosted zone `gigaashley.click` (Z00583511HTO90JKK1MV7); R&D-established cross-account AssumeRole path (Aither `termix-ssm-role` → personal `caddy-route53-gigaashley`) already covers this zone.
- Same Caddy container as `term.gigaashley.click` and `files.gigaashley.click`; add a new site block for the wildcard. Requires custom Caddy build (two-line Dockerfile change: `caddy:2-builder` + `xcaddy build --with github.com/caddy-dns/route53`).
- Bare `serve.term.gigaashley.click` (no host prefix) redirects to `term.gigaashley.click` — one-line redirect so typos land somewhere sensible.
- ACME: **Let's Encrypt production** preferred (LE prod is more permissive than LE staging that R&D got tripped by on contact validation; ZeroSSL remains automatic fallback via Caddy's issuer chain).
- HSTS: mirror whatever `term.gigaashley.click` currently sets (verify against existing Caddyfile during plan).
- T800 (Stacy's deployment): entirely her domain + Route53 (or whatever DNS provider Aither uses) + Caddy config — no shared infra. Ships as a Stacy-briefing patch under the fleet-substrate rule; no code Phase 2 needs to write handles T800 differently.

### Rollout sequence

1. Build custom Caddy image with route53 plugin.
2. Update `/opt/skynet/Caddyfile` with the wildcard block + bare-redirect block.
3. Deploy — first request against the wildcard subdomain issues the cert via DNS-01.
4. Test with a single subdomain (e.g. `t1000-8899.serve.term.gigaashley.click`) pointed at a `python -m http.server` on t1000 to verify HTTPS + WS + proxy stack end-to-end.
5. Only after that verified, flip agent URL construction to use the new scheme + update id-skill.
