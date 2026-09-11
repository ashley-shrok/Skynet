# Custom Caddy image with the Route 53 DNS-01 plugin.
#
# Purpose: enable wildcard TLS via DNS-01 ACME challenges against a
# Route 53 hosted zone. Per-deployment specifics (AWS account IDs,
# hosted zone ID, IAM role ARN, cross-account AssumeRole topology) live
# in the host's ~/.aws/config, not in this repo — see the caddy service
# block in docker/docker-compose.yml for the bind-mount + AWS_PROFILE
# wiring.
#
# Verified check: `caddy list-modules | grep dns.providers.route53`.
# Plugin: github.com/caddy-dns/route53 — Caddy project official plugin
# under the github.com/caddy-dns org.
#
# Two stages by design:
#   1. builder — full Caddy build toolchain (xcaddy) that compiles a fresh
#      caddy binary WITH the route53 plugin baked in.
#   2. runtime — copy that binary onto the standard caddy:2 base so we
#      inherit the base image's entrypoint, working dir, and default config
#      handling. NO additional COPY layers — Caddyfile config comes from a
#      docker-compose bind mount (see docker/docker-compose.yml caddy
#      service block), same pattern as the pre-plugin caddy:2 setup.

FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
