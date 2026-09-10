---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 01
subsystem: infra
tags: [caddy, reverse-proxy, infra, dns-01, route53, wildcard-tls]
dependencies:
  requires: []
  provides:
    - "docker/Caddy.Dockerfile (custom Caddy image with route53 DNS-01 plugin)"
    - "docker/docker-compose.yml caddy service wired to custom Dockerfile + AWS profile mount"
    - "Caddyfile.serve-url-additions.snippet (deploy-time append artifact for /opt/skynet/Caddyfile)"
  affects:
    - "Waves 2-6 downstream (all assume Caddy passes X-Skynet-Serve-Subdomain to backend)"
tech-stack:
  added:
    - "github.com/caddy-dns/route53 (Caddy plugin, compiled into custom binary via xcaddy)"
  patterns:
    - "Two-stage Dockerfile: caddy:2-builder + xcaddy build --with, final stage copies binary onto caddy:2 base (verbatim R&D findings-summary L82-87)"
    - "Cross-account AssumeRole from EC2 instance role via AWS SDK profile file (~/.aws/config bind mount + AWS_PROFILE env)"
    - "Deploy-time snippet artifact under .planning/phases/ appended to on-host Caddyfile at ship time (D-24 single deploy)"
key-files:
  created:
    - "docker/Caddy.Dockerfile"
    - ".planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/Caddyfile.serve-url-additions.snippet"
    - ".planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/103-01-SUMMARY.md"
  modified:
    - "docker/docker-compose.yml (caddy service block only — build reference, AWS config mount, AWS_PROFILE + AWS_REGION env)"
decisions:
  - "Realized D-19 verbatim from R&D recipe — 4-line Dockerfile (caddy:2-builder + xcaddy + caddy:2 base + binary copy)"
  - "Chose docker-compose environment LIST form (- AWS_PROFILE=caddy) over map form to satisfy plan grep gate; both forms are docker-compose-valid"
  - "Reworded snippet TLS-issuer comment to avoid literal 'acme_ca' substring — comment intent was documenting the ABSENCE of an acme_ca pin, but the grep gate on 'no acme_ca directive' could not distinguish comment from directive"
metrics:
  duration_min: 3
  completed_at: "2026-09-10"
  tasks_completed: 3
  files_touched: 3
---

# Phase 103 Plan 01: Caddy custom image + wildcard-serve-subdomain Caddyfile snippet — Summary

## One-liner

Ships the wildcard-TLS reverse-proxy substrate that turns `*.serve.term.gigaashley.click` into an HTTPS-terminating front for the serve URL scheme — custom Caddy binary with the route53 DNS-01 plugin, docker-compose wired to build it with the cross-account AWS profile mount, and a Caddyfile snippet with the wildcard site block (`header_up X-Skynet-Serve-Subdomain {host}` + 5m WS/SSE timeouts) plus a bare-redirect block.

## What Shipped

### Task 1 — `docker/Caddy.Dockerfile` (commit `2e1b5069`)

Two-stage build verbatim from R&D findings-summary L82-87:
1. `FROM caddy:2-builder AS builder` — `RUN xcaddy build --with github.com/caddy-dns/route53`
2. `FROM caddy:2` — `COPY --from=builder /usr/bin/caddy /usr/bin/caddy`

Provenance-comment header cites D-19, the cross-account AssumeRole topology (t1000 `termix-ssm-role` in Aither → personal `caddy-route53-gigaashley` in Ashley's AWS), and the R&D verification checkpoint (`caddy list-modules | grep dns.providers.route53` — verified 2026-09-05).

### Task 2 — `docker/docker-compose.yml` caddy service (commit `85daa4d5`)

Replaced `image: caddy:2` with:
- `build: { context: .., dockerfile: docker/Caddy.Dockerfile }` — context relative to compose file's own dir (matches existing `tg-bridge` service's `context: ../substrate/services/tg-bridge` idiom, resolves to repo root)
- `image: skynet-caddy:local` tag for the built image
- New volume: `${HOME}/.aws/config:/root/.aws/config:ro`
- New env (list form): `- AWS_PROFILE=caddy`, `- AWS_REGION=us-east-1`

Existing `${SKYNET_HOST_DIR:-/opt/skynet}/Caddyfile:/etc/caddy/Caddyfile:ro` mount preserved verbatim. Other services (skynet, guacd, filestash, tg-bridge), volumes, and networks blocks untouched — `git diff` confirms diff is localized to the caddy service block.

### Task 3 — `Caddyfile.serve-url-additions.snippet` (commit `b8435e8a`)

Deploy-time artifact under `.planning/phases/103-…/`. Two site blocks:

1. **`*.serve.term.gigaashley.click`** — wildcard, `tls { dns route53 }` (no explicit issuer pin, uses Caddy default chain: LE prod primary, ZeroSSL fallback per D-21), `reverse_proxy skynet:8080 { header_up X-Skynet-Serve-Subdomain {host}; transport http { response_header_timeout 5m; read_timeout 5m } }` — 5m timeouts accommodate long-lived WS + SSE streams (R&D findings-summary L99-100).

2. **`serve.term.gigaashley.click`** — bare subdomain, `redir https://term.gigaashley.click{uri} permanent` (D-20 accidental-paste UX).

Leading comment documents:
- D-24 single-deploy motion + on-host append instruction (Ashley appends this to `/opt/skynet/Caddyfile` at ship time — deployed Caddyfile lives on-host, not in-repo)
- D-22 HSTS mirror requirement (mirror the exact directive from the existing `term.gigaashley.click` block when appending)
- D-21 intentional absence of ACME-CA pin

## Verification Results

| Check | Result |
|---|---|
| Task 1 — `docker/Caddy.Dockerfile` contains `FROM caddy:2-builder AS builder` | PASS (grep) |
| Task 1 — Dockerfile contains `xcaddy build --with github.com/caddy-dns/route53` | PASS (grep) |
| Task 1 — Dockerfile contains `COPY --from=builder /usr/bin/caddy /usr/bin/caddy` | PASS (grep) |
| Task 1 — `docker build … && caddy list-modules | grep dns.providers.route53` | DEFERRED (see Deferred Verification) |
| Task 2 — no `image: caddy:2` reference remains | PASS (grep -c → 0) |
| Task 2 — caddy service contains `dockerfile: docker/Caddy.Dockerfile` | PASS (grep) |
| Task 2 — caddy service volumes contain `/root/.aws/config:ro` | PASS (grep) |
| Task 2 — caddy service env contains `AWS_PROFILE=caddy` and `AWS_REGION=us-east-1` | PASS (grep) |
| Task 2 — existing Caddyfile mount preserved | PASS (grep) |
| Task 2 — `docker compose -f docker/docker-compose.yml config --quiet` | PASS (exit 0) |
| Task 2 — diff localized to caddy service block | PASS (git diff review) |
| Task 3 — snippet file exists at phase path | PASS |
| Task 3 — wildcard site block present starting with `*.serve.term.gigaashley.click {` | PASS (grep) |
| Task 3 — contains `tls {` + `dns route53` | PASS (grep) |
| Task 3 — contains exact `header_up X-Skynet-Serve-Subdomain {host}` | PASS (grep) |
| Task 3 — contains `reverse_proxy skynet:8080 {` | PASS (grep) |
| Task 3 — contains `response_header_timeout 5m` + `read_timeout 5m` | PASS (grep) |
| Task 3 — bare `serve.term.gigaashley.click` site block with redir | PASS (grep) |
| Task 3 — leading `# HSTS` comment documents D-22 mirror | PASS (grep) |
| Task 3 — no `acme_ca` directive | PASS (grep after Deviation #2 reword) |
| Task 3 — leading comment mentions D-24 + `/opt/skynet/Caddyfile` append instruction | PASS (grep) |
| `npx tsc --noEmit` (root project) | PASS (exit 0, no output) |

## Deviations from Plan

### 1. [Rule 3 — Blocking issue, deferred] Task 1 `docker build` verification not runnable in this executor

- **Found during:** Task 1 verify step
- **Issue:** The plan's `<verify>` block calls for `docker build -f docker/Caddy.Dockerfile -t skynet-caddy:local . && docker run --rm --entrypoint /usr/bin/caddy skynet-caddy:local list-modules | grep -q '^dns.providers.route53'`. The `ubuntu` user in this executor sandbox is not in the `docker` group (`ls -la /var/run/docker.sock` → `root:docker`; `groups` → no `docker`), so `docker build` fails with `permission denied while trying to connect to the docker API`.
- **Why acceptable:** R&D findings-summary L108-113 already end-to-end verified this exact 4-line recipe on 2026-09-05 — `caddy list-modules | grep route53 → dns.providers.route53 present`, Caddy v2.11.4 confirmed, sample Caddyfile with the wildcard block validated cleanly, wildcard cert issued end-to-end for `*.test-scratch.gigaashley.click` via DNS-01. The Dockerfile is byte-identical to the R&D-verified recipe.
- **Files modified:** none (verification only — Dockerfile content unchanged from planned shape)
- **Follow-up:** Ship-time docker build (Ashley's `docker compose up -d --build caddy` motion during the D-24 deploy) will re-verify the module list. Not blocking for plan completion — the static acceptance criteria all pass, and the R&D proof stands.
- **Commit:** N/A (verification deferral only)

### 2. [Rule 1 — Bug: false-positive grep] Task 3 HSTS-comment reword to avoid literal `acme_ca` substring

- **Found during:** Task 3 acceptance criteria check
- **Issue:** The plan's acceptance criterion "file does NOT contain any `acme_ca` directive (per D-21 default issuer chain)" is enforced via `grep 'acme_ca'`. My initial snippet had a leading comment reading "TLS issuer: NO explicit `acme_ca` directive — per D-21…" which documented the ABSENCE of the directive — but grep can't distinguish a comment mention from a directive.
- **Fix:** Reworded the comment to "intentionally NO explicit ACME-CA pin" so the literal string `acme_ca` no longer appears anywhere in the file. Semantics preserved: the comment still explains why we don't pin to a single issuer.
- **Files modified:** `.planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/Caddyfile.serve-url-additions.snippet`
- **Commit:** absorbed into Task 3 commit `b8435e8a` (edit happened before commit)

## Deferred Verifications

- **`docker build` + `caddy list-modules` behavior gate** (Task 1): sandbox docker group access absent. R&D-proven recipe; ship-time build re-verifies.
- **`docker compose up` end-to-end**: outside executor deploy boundary per box-maintainer standing directive "Deploy boundary at git push". Not in scope for this plan.

## Testing Notes

Zero TypeScript / test source files were touched (all changes are Dockerfile + YAML compose + a Caddyfile artifact under `.planning/`). `npx vitest run --related` was attempted but the installed vitest version does not support `--related`; since the change set produces no JS or TS, there are no vitest tests that could relate. `npx tsc --noEmit` on the root project exits 0.

## Threat Model Compliance

Per Phase 103-01 plan `<threat_model>`:

| Threat ID | Disposition | Status |
|---|---|---|
| T-103-01 (client-supplied X-Skynet-Serve-Subdomain spoofing) | mitigate | Task 3 snippet uses `header_up X-Skynet-Serve-Subdomain {host}` — Caddy overwrites any client value with its parsed Host. Verifiable by Wave 2+ subdomain-dispatch middleware trusting only Caddy-set headers. |
| T-103-02 (xcaddy plugin supply chain — caddy-dns/route53) | accept | Dockerfile pulls plugin from `github.com/caddy-dns/route53` — Caddy project official org. Accepted per plan. |
| T-103-03 (AWS IAM creds on host) | mitigate | Task 2 mount is READ-ONLY (`:ro`); `~/.aws/config` uses `credential_source = Ec2InstanceMetadata` (no static creds on disk). |
| T-103-04 (ACME rate limits) | accept | LE production 50-cert/domain/week limit; wildcard cert rotates every 60 days, orders of magnitude under limit. ZeroSSL is fallback. |
| T-103-05 (Route 53 IAM overly broad) | mitigate | Out of executor scope — IAM policy already provisioned per R&D findings-summary L306-332 (scoped to `Z00583511HTO90JKK1MV7`). This plan only wires the container to use it. |
| T-103-SC (xcaddy build supply chain) | mitigate | Only Caddy project official artifacts pulled — caddy:2-builder base image + xcaddy tool + caddy-dns/route53 plugin all under github.com/caddy-dns or caddyserver orgs. No third-party registries. |

No new security-relevant surface introduced beyond what's in the threat register.

## Threat Flags

None. Surface added is entirely covered by the plan's threat model.

## Known Stubs

None. All three artifacts are production-shape complete for this wave; downstream waves will add code that consumes the `X-Skynet-Serve-Subdomain` header the Caddy snippet sets.

## Bounty timeline update

Added `2026-09-10T00:00:00Z started by tabitha` entry to
`~/.claude/roles/box-maintainer/bounties/phase-2-skynet-passthrough-serve-url/bounty.json`
per box-maintainer standing directive for bounty ownership tracking.

## Downstream

Waves 2-6 all assume this substrate is deployed:
- Backend subdomain-dispatch middleware (Plan 05 etc.) reads the `X-Skynet-Serve-Subdomain` header this snippet configures Caddy to set.
- Cookie-widen work (auth-manager.ts change) ships in same D-24 single-deploy motion as this Caddy substrate.
- The `skynet-caddy:local` image tag Task 2 sets is what `docker compose up -d --build caddy` will materialize at ship time.

## Self-Check: PASSED

- Files created:
  - `docker/Caddy.Dockerfile` — FOUND
  - `.planning/phases/103-passthrough-urls-serve-url-scheme-phase-2-of-2/Caddyfile.serve-url-additions.snippet` — FOUND
- Files modified:
  - `docker/docker-compose.yml` — FOUND (change staged and committed)
- Commits:
  - `2e1b5069` — FOUND
  - `85daa4d5` — FOUND
  - `b8435e8a` — FOUND
