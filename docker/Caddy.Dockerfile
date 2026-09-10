# Phase 103 D-19 — custom Caddy image with the Route 53 DNS-01 plugin.
#
# Purpose: enable wildcard TLS for *.serve.term.gigaashley.click via DNS-01
# ACME challenges against the gigaashley.click Route 53 hosted zone
# (Z00583511HTO90JKK1MV7 in Ashley's personal AWS account 984318380039,
# reached via cross-account AssumeRole from t1000's termix-ssm-role in
# Aither AWS account 662442740806 — see R&D findings-summary "Cross-account
# AssumeRole" section L271-334).
#
# Provenance:
#   - Recipe: R&D findings-summary L82-87 (2026-09-05, verified end-to-end).
#   - Verified check: `caddy list-modules | grep dns.providers.route53` — R&D
#     findings-summary L110.
#   - Plugin: github.com/caddy-dns/route53 — Caddy project official plugin
#     under the github.com/caddy-dns org (threat_model T-103-02 accept +
#     T-103-SC mitigate — supply chain trusted).
#
# Two stages by design:
#   1. builder — full Caddy build toolchain (xcaddy) that compiles a fresh
#      caddy binary WITH the route53 plugin baked in.
#   2. runtime — copy that binary onto the standard caddy:2 base so we
#      inherit the base image's entrypoint, working dir, and default config
#      handling. NO additional COPY layers — Caddyfile config comes from a
#      docker-compose bind mount (see docker/docker-compose.yml caddy
#      service block), same pattern as the pre-Phase-103 caddy:2 setup.

FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
