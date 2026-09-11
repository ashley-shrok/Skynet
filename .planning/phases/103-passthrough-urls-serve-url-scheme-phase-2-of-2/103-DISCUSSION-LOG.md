# Phase 103: Passthrough URLs — serve URL scheme (phase 2 of 2) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-10
**Phase:** 103-passthrough-urls-serve-url-scheme-phase-2-of-2
**Areas discussed:** rollout gating, CSRF audit scope, id-skill rewrite coupling, frontend serve-URL affordance

**Note on scope:** Q1-Q6 of the load-bearing design decisions were resolved in the preceding `/open` session (see `.planning/shapes/shape-skynet-passthrough-urls.md` § "Phase 2 locked decisions"). Discuss-phase only tackled the four remaining gray areas listed below.

---

## Rollout gating

| Option | Description | Selected |
|--------|-------------|----------|
| Single deploy | Caddy image rebuild + cookie widen + subdomain routing + agent URL construction all live at once | ✓ |
| Feature flag + dark-first | Ship infra dark, verify against manually-poked test subdomain, then flip agents' URL construction in a follow-up | |

**User's choice:** Single deploy.
**Notes:** Alice explicitly framed this whole build as "not in a rush, do this thing right" — combined with R&D having been thorough enough that infra unknowns are gone, single deploy is fine. No feature-flag ceremony needed.

---

## CSRF audit scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full audit | Every route in `src/backend/database/routes/` classified read-only vs state-changing; every state-changing verified preflight-triggering or CSRF-tokenized | ✓ |
| Targeted audit | Only hot / sensitive endpoints (auth, host CRUD, identity CRUD, message send) audited; everything else assumed OK | |

**User's choice:** Full audit.
**Notes:** Alice verbatim: "full audit because we're gonna take our time and do this whole thing right. We are not in a rush." The cookie widen is a security posture change; half-audits are how you ship CSRF holes.

---

## id-skill rewrite coupling

| Option | Description | Selected |
|--------|-------------|----------|
| In Phase 103 | id-skill "Sending files to the user" section rewrite (add serve-URL sub-section, delete tailnet-HTTP pattern) ships as part of Phase 103 | ✓ |
| Follow-up patch | id-skill rewrite ships as a follow-up patch after Phase 103 infra is verified live | |

**User's choice:** Option A — in Phase 103.
**Notes:** No hedging needed — the infra will be verified before the deploy ships (single-deploy per rollout choice, full ship gate), so agents picking up the new pattern on next distributor sweep + `/id <name>` reload lands on infrastructure that already works.

---

## Frontend serve-URL affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Plain clickable link | Same tailnet-URL-detection stack Phase 78 extended; add serve URL regex; render as clickable, that's it | ✓ (for Phase 103 only) |
| Custom render in Phase 103 | Live-app icon / preview card / distinctive Skynet-proxied render inline in the message bubble | |
| Custom render as its own future shape | Deferred — Alice wants a tasting session for both file AND serve URL visual affordances together | ✓ (as follow-up) |

**User's choice:** Plain clickable link for Phase 103; custom visual render (for both file and serve URLs) becomes its own shape.
**Notes:** Alice verbatim: "I really did want to do something special for both files and serving stuff links. Um, so, I don't necessarily know if it needs to be part of like exactly what we're gonna do... or if it gets like tacked on later on in the campaign, but I think this is a good opportunity to hit that stuff. But I think like that should probably be its own shape. cause I'm gonna wanna do a tasting and other stuff like that." → Phase 103 ships plain links; visual affordance is its own build later.

---

## Claude's Discretion

- Wave / plan sequencing across the ~10-15 Phase 103 implementation items — planner divides into waves based on dependency ordering; recommended rough grouping in CONTEXT.md D-decisions area.
- Exact regex shape for serve URL detection — mirror `TAILNET_URL_RE_CLIENT` + Phase 78 file-URL regex.
- Specific SSH-pool function selection (`getConnection` vs `withConnection` etc.) — planner scouts.
- Test file structure + test count for the CI cookie-egress harness + runtime header sampler + WS Origin check + CSRF audit output artifact — planner + researcher decide.
- Whether the `python -m http.server` verification of the wildcard-cert path (rollout step 4 of shape file) becomes an automated E2E test or stays manual UAT — planner discretion.

## Deferred Ideas

- **First-class "Apps" concept in Skynet** — persistent, Skynet-managed apps, Bun/SQLite stack, own UI panel, split-view droppable, cross-user "share my app" belongs here not to serve URL. Bounty `first-class-agent-apps-in-skynet` opens at end of session.
- **Custom visual affordance shape** for BOTH file URLs and serve URLs — Alice wants a tasting session; deferred out of Phase 103. Bounty `serve-and-file-url-visual-affordances` opens at end of session.
- **Per-URL revocation / rate-limiting / custom headers on serve URLs** — shape-file-deferred. Add if a real need surfaces.
- **Skynet dashboard for "live serve URLs right now"** — shape-file-deferred. URLs are ephemeral; no state to display.
- **Per-user disambiguation UX for the (rare) case of a user owning two hosts with the same name** — first-match-wins + warning log for now; add richer UX only if it bites.
</content>
</invoke>