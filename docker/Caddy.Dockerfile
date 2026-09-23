# Custom Caddy image with the Route 53 DNS-01 plugin.
#
# Purpose: enable wildcard TLS via DNS-01 ACME challenges against a
# Route 53 hosted zone. Per-deployment specifics (AWS account IDs,
# hosted zone ID, IAM role ARN, cross-account AssumeRole topology) live
# in the host's ~/.aws/config, not in this repo — see the caddy service
# block in docker/docker-compose.yml for the bind-mount + AWS_PROFILE
# wiring.
#
# ⚠️  LANDMINE — `credential_source` requires a paired `role_arn`.
# Newer AWS SDK Go v2 versions (which caddy-dns/route53 pulls transitively)
# reject a `[profile caddy]` block that sets `credential_source =
# Ec2InstanceMetadata` WITHOUT also setting `role_arn`. Exact error the
# plugin emits — INFO level, so it does NOT surface via any
# `grep -iE 'error|warn'` sanity-check:
#
#     route53: unable to load AWS SDK config, credential type
#     credential_source requires role_arn, profile caddy
#
# Symptom is Caddy spinning on ACME "No TXT record found" because the
# plugin can't write the TXT record — cert acquisition never completes.
# Nastier still: existing certs renew silently in the background, so a
# config that drifts into this shape won't surface until the next
# renewal (~60 days out for a Let's Encrypt 90-day cert). Two valid
# shapes for the profile:
#
#   1. Cross-account (t1000 today): `role_arn = arn:aws:iam::...:role/...`
#      + `credential_source = Ec2InstanceMetadata` + `region = ...`.
#      IMDS creds assume the named role in a different AWS account for
#      Route 53 writes. Requires the pairing.
#
#   2. Same-account: `region = ...` ONLY. Falls through to default IMDS
#      creds, which the instance role must have Route 53 perms for on
#      the target zone. Do NOT include `credential_source` here — it
#      trips the pairing check for no benefit.
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
